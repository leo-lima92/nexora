// @vitest-environment node
//
// FORK NEXORA — TRÁFEGO AIOS: a rota /api/v1/aios-dispatch (POST e GET) ───────
//
// O que este arquivo mede:
//  - a ordem das guardas: suporte somente-leitura recusa ANTES de tudo, o papel
//    exigido é `manager`, e nada disso chega a gravar linha ou a chamar o motor;
//  - o corpo é estrito: `org_id`/`user_id`/`action` vindos do navegador são
//    recusados, e a organização e a pessoa que vão ao banco e ao motor são as
//    da SESSÃO;
//  - a linha do pedido (`aios_campaign_requests`) nasce ANTES do despacho, pela
//    sessão da pessoa, `queued`, com o `request_id` da tela — e é esse mesmo id
//    que vai no corpo para o motor;
//  - o pedido repetido (23505) NÃO é despachado de novo;
//  - cada desfecho do motor vira o status que a tela sabe ler E o estado da
//    linha: 200 (`queued`, com o protocolo), 502/503 (`failed`, com a frase) e
//    504 (`unconfirmed` — o único em que reenviar pode duplicar a campanha);
//  - o acerto do desfecho usa a service role, SEMPRE com a organização da
//    sessão no filtro e só enquanto a linha está `queued`;
//  - o audit `aios.campaign_dispatched` existe só quando o pedido saiu com
//    efeito possível, e nunca leva o texto do pedido;
//  - o GET lista os pedidos da organização ativa, paginado por cursor.
//
// O motor é dublê (`fetch` global) e o banco também (um cliente falso que anota
// cada cadeia): a rota e `lib/aios/despacho.ts` rodam de verdade, então o corpo
// conferido aqui é o que sairia para o Python. A RLS de verdade é medida em
// `tests/invariants/aios-campaign-requests-rls.test.ts`.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 6, count: 1 })),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { codificarCursorDePedidoAios } from "@/lib/schemas/aios-pedidos";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const LINHA = "44444444-4444-4444-8444-444444444444";
const PEDIDO = "campanha para a clínica que fatura 2 milhões";
const ID_DA_TELA = "5f0c1a7e-0d5b-4c58-9a51-0c6a3c2f9d10";
const CRIADO_EM = "2026-11-11T12:00:00.123456+00:00";

const motor = vi.fn();

// ─── O banco falso ───────────────────────────────────────────────────────────

type Operacao = "insert" | "update" | "select";

interface Cadeia {
  cliente: "sessao" | "admin";
  tabela: string;
  operacao: Operacao | null;
  valores: Record<string, unknown> | null;
  filtros: Array<[string, ...unknown[]]>;
  ordem: Array<[string, boolean]>;
  limite: number | null;
}

interface Resultado {
  data: unknown;
  error: { code?: string; message: string } | null;
}

const cadeias: Cadeia[] = [];
/** A ordem em que as coisas aconteceram: é o que prova "a linha nasce antes do despacho". */
const eventos: string[] = [];
let responder: (c: Cadeia) => Resultado;

function linhaDoBanco(extra: Record<string, unknown> = {}) {
  return {
    id: LINHA,
    request_id: ID_DA_TELA,
    user_id: USER,
    prompt: PEDIDO,
    status: "queued",
    engine_job_id: null,
    response_summary: null,
    campaign_metadata: {},
    error_message: null,
    created_at: CRIADO_EM,
    updated_at: CRIADO_EM,
    ...extra,
  };
}

/** O banco que se comporta: devolve a linha inserida e a linha como ficou depois do acerto. */
function bancoQueFunciona(c: Cadeia): Resultado {
  if (c.operacao === "insert") return { data: linhaDoBanco({ request_id: c.valores?.request_id }), error: null };
  if (c.operacao === "update") return { data: linhaDoBanco({ ...c.valores }), error: null };
  return { data: [], error: null };
}

function clienteFalso(cliente: Cadeia["cliente"]) {
  return {
    from(tabela: string) {
      const c: Cadeia = { cliente, tabela, operacao: null, valores: null, filtros: [], ordem: [], limite: null };
      cadeias.push(c);
      const resolver = () => {
        eventos.push(`${cliente}:${c.operacao}`);
        return Promise.resolve(responder(c));
      };
      const cadeia = {
        insert(valores: Record<string, unknown>) {
          c.operacao = "insert";
          c.valores = valores;
          return cadeia;
        },
        update(valores: Record<string, unknown>) {
          c.operacao = "update";
          c.valores = valores;
          return cadeia;
        },
        select() {
          c.operacao ??= "select";
          return cadeia;
        },
        eq(coluna: string, valor: unknown) {
          c.filtros.push(["eq", coluna, valor]);
          return cadeia;
        },
        is(coluna: string, valor: unknown) {
          c.filtros.push(["is", coluna, valor]);
          return cadeia;
        },
        or(expressao: string) {
          c.filtros.push(["or", expressao]);
          return cadeia;
        },
        order(coluna: string, opcoes: { ascending: boolean }) {
          c.ordem.push([coluna, opcoes.ascending]);
          return cadeia;
        },
        limit(n: number) {
          c.limite = n;
          return cadeia;
        },
        single: resolver,
        maybeSingle: resolver,
        then(aoResolver: (r: Resultado) => unknown, aoRejeitar?: (e: unknown) => unknown) {
          return resolver().then(aoResolver, aoRejeitar);
        },
      };
      return cadeia;
    },
  };
}

const daSessao = () => cadeias.filter((c) => c.cliente === "sessao");
const doAdmin = () => cadeias.filter((c) => c.cliente === "admin");

// ─── Sessão e requisições ────────────────────────────────────────────────────

function sessaoOk() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {
      id: USER,
      email: "g@x.com",
      full_name: null,
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR",
      organizations: [],
    },
    org: { orgId: ORG, name: "Org", role: "manager" },
  } as never);
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/v1/aios-dispatch", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

async function chamar(body: unknown) {
  const { POST } = await import("@/app/api/v1/aios-dispatch/route");
  return POST(post(body));
}

async function listar(query = "") {
  const { GET } = await import("@/app/api/v1/aios-dispatch/route");
  return GET(new NextRequest(`http://localhost/api/v1/aios-dispatch${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  cadeias.length = 0;
  eventos.length = 0;
  responder = bancoQueFunciona;
  motor.mockReset();
  motor.mockImplementation(async () => {
    eventos.push("motor");
    return json({});
  });
  vi.stubGlobal("fetch", motor);
  vi.stubEnv("AIOS_PYTHON_URL", "https://aios.exemplo.com/api/campaign");
  vi.stubEnv("AIOS_PYTHON_TOKEN", "");
  vi.mocked(createClient).mockImplementation(async () => clienteFalso("sessao") as never);
  vi.mocked(createAdminClient).mockImplementation(() => clienteFalso("admin") as never);
  sessaoOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** O motor responde isto — e o evento "motor" continua anotado. */
function motorResponde(resposta: () => Response | Promise<Response>) {
  motor.mockImplementation(async () => {
    eventos.push("motor");
    return resposta();
  });
}

function motorFalha(erro: Error) {
  motor.mockImplementation(async () => {
    eventos.push("motor");
    throw erro;
  });
}

describe("POST /api/v1/aios-dispatch — guardas", () => {
  it("suporte somente-leitura recusa ANTES de autenticar, gravar ou chamar o motor", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValueOnce(fail("support_readonly", "Somente leitura.", 403, {}) as never);
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
    expect(cadeias).toHaveLength(0);
    expect(motor).not.toHaveBeenCalled();
  });

  it("exige manager", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ ok: false, response: fail("forbidden_role", "x", 403, {}) });
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(403);
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("manager");
    expect(cadeias).toHaveLength(0);
    expect(motor).not.toHaveBeenCalled();
  });

  it.each([
    ["org_id", { prompt: PEDIDO, org_id: OUTRA_ORG }],
    ["organization_id", { prompt: PEDIDO, organization_id: OUTRA_ORG }],
    ["user_id", { prompt: PEDIDO, user_id: OUTRA_ORG }],
    ["action", { prompt: PEDIDO, action: "delete_campaign" }],
    ["status", { prompt: PEDIDO, status: "completed" }],
    ["response_summary", { prompt: PEDIDO, response_summary: "Campanha criada." }],
  ])("%s no corpo é recusado — quem decide é a sessão e a rota", async (_campo, corpo) => {
    const res = await chamar(corpo);
    expect(res.status).toBe(422);
    expect(cadeias).toHaveLength(0);
    expect(motor).not.toHaveBeenCalled();
  });

  it.each([
    ["sem prompt", {}],
    ["prompt vazio", { prompt: "   " }],
    ["prompt longo demais", { prompt: "x".repeat(4001) }],
    ["prompt que não é texto", { prompt: 42 }],
    ["request_id curto demais", { prompt: PEDIDO, request_id: "abc" }],
    ["request_id com caractere de fora", { prompt: PEDIDO, request_id: "pedido 0001; drop" }],
    ["request_id longo demais", { prompt: PEDIDO, request_id: "a".repeat(101) }],
  ])("%s → 422, sem gravar e sem chamar o motor", async (_caso, corpo) => {
    expect((await chamar(corpo)).status).toBe(422);
    expect(cadeias).toHaveLength(0);
    expect(motor).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON → 400", async () => {
    expect((await chamar("{nao json")).status).toBe(400);
    expect(cadeias).toHaveLength(0);
    expect(motor).not.toHaveBeenCalled();
  });

  it("ritmo estourado → 429 com Retry-After, sem gravar e sem chamar o motor", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, limit: 6, count: 7 } as never);
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(cadeias).toHaveLength(0);
    expect(motor).not.toHaveBeenCalled();
  });

  it("o ritmo é contado por pessoa E por organização", async () => {
    await chamar({ prompt: PEDIDO });
    const baldes = vi.mocked(checkRateLimit).mock.calls.map((c) => c[0]);
    expect(baldes).toEqual([`aios:${USER}`, `aios-org:${ORG}`]);
  });
});

describe("POST /api/v1/aios-dispatch — a linha do pedido", () => {
  it("nasce ANTES do despacho, pela sessão, queued, com a organização e a pessoa da SESSÃO", async () => {
    await chamar({ prompt: `  ${PEDIDO}  `, request_id: ID_DA_TELA });

    expect(eventos.slice(0, 2)).toEqual(["sessao:insert", "motor"]);
    const [insert] = daSessao();
    expect(insert!.tabela).toBe("aios_campaign_requests");
    expect(insert!.operacao).toBe("insert");
    expect(insert!.valores).toEqual({
      organization_id: ORG,
      user_id: USER,
      request_id: ID_DA_TELA,
      prompt: PEDIDO,
      status: "queued",
    });
    // O INSERT não passa pela service role: quem confere organização e papel é a RLS.
    expect(doAdmin().filter((c) => c.operacao === "insert")).toHaveLength(0);
  });

  it("o request_id da tela é o da linha E o que vai no corpo para o motor", async () => {
    await chamar({ prompt: PEDIDO, request_id: ID_DA_TELA });
    const corpo = JSON.parse((motor.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(corpo.request_id).toBe(ID_DA_TELA);
    expect(daSessao()[0]!.valores!.request_id).toBe(ID_DA_TELA);
  });

  it("sem request_id no corpo, a rota gera um — o mesmo para a linha e para o motor", async () => {
    await chamar({ prompt: PEDIDO });
    const gravado = daSessao()[0]!.valores!.request_id as string;
    expect(gravado).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const corpo = JSON.parse((motor.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(corpo.request_id).toBe(gravado);
  });

  it("pedido repetido (23505) → 409, e o motor NÃO é chamado de novo", async () => {
    responder = (c) =>
      c.operacao === "insert"
        ? { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
        : bancoQueFunciona(c);
    const res = await chamar({ prompt: PEDIDO, request_id: ID_DA_TELA });
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("idempotency_conflict");
    expect(JSON.stringify(corpo)).not.toContain("duplicate key");
    expect(motor).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("a linha não foi gravada → 500, e o motor NÃO é chamado", async () => {
    responder = (c) =>
      c.operacao === "insert"
        ? { data: null, error: { code: "42501", message: "new row violates row-level security policy" } }
        : bancoQueFunciona(c);
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(500);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("internal_error");
    // O erro do banco vai para o log, não para a tela.
    expect(JSON.stringify(corpo)).not.toContain("row-level security");
    expect(motor).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls[0])).not.toContain("2 milhões");
  });
});

describe("POST /api/v1/aios-dispatch — o despacho", () => {
  it("manda ao motor a organização e a pessoa da SESSÃO, com a ação fixa", async () => {
    motorResponde(() => json({ job_id: "job-7", message: "Recebido. Vou montar a campanha." }, 202));
    const res = await chamar({ prompt: `  ${PEDIDO}  `, request_id: ID_DA_TELA });

    expect(res.status).toBe(200);
    const requestId = res.headers.get("X-Request-Id");
    expect(requestId).toBeTruthy();

    expect(motor).toHaveBeenCalledTimes(1);
    const [url, init] = motor.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://aios.exemplo.com/api/campaign");
    expect(JSON.parse(init.body as string)).toEqual({
      org_id: ORG,
      user_id: USER,
      request_id: ID_DA_TELA,
      prompt: PEDIDO,
      action: "generate_campaign",
    });
    // O mesmo id vai ao motor e à resposta: é o que casa os dois logs. E ele
    // NÃO é o id do pedido — um é da chamada HTTP, o outro é da linha.
    expect((init.headers as Record<string, string>)["X-Request-Id"]).toBe(requestId);
    expect(requestId).not.toBe(ID_DA_TELA);

    expect(await res.json()).toEqual({
      data: {
        status: "dispatched",
        action: "generate_campaign",
        job_id: "job-7",
        message: "Recebido. Vou montar a campanha.",
        request: linhaDoBanco({ engine_job_id: "job-7" }),
      },
    });
  });

  it("o protocolo do aceite entra na linha pela service role, com a organização no filtro", async () => {
    motorResponde(() => json({ job_id: "job-7" }, 202));
    await chamar({ prompt: PEDIDO, request_id: ID_DA_TELA });

    expect(eventos).toEqual(["sessao:insert", "motor", "admin:update"]);
    const [acerto] = doAdmin();
    expect(acerto!.tabela).toBe("aios_campaign_requests");
    expect(acerto!.valores).toEqual({ engine_job_id: "job-7" });
    expect(acerto!.filtros).toEqual([
      ["eq", "organization_id", ORG],
      ["eq", "id", LINHA],
      // Se o motor já gravou o protocolo dele, o do aceite não passa por cima.
      ["is", "engine_job_id", null],
    ]);
  });

  it("aceite sem corpo → 200 com job_id e message nulos, e a linha fica como nasceu", async () => {
    motorResponde(() => new Response(null, { status: 204 }));
    const res = await chamar({ prompt: PEDIDO, request_id: ID_DA_TELA });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      status: "dispatched",
      job_id: null,
      message: null,
      request: { id: LINHA, status: "queued", engine_job_id: null },
    });
    expect(doAdmin()).toHaveLength(0);
  });

  it("o protocolo não foi gravado → o aceite continua 200, com a linha como nasceu", async () => {
    motorResponde(() => json({ job_id: "job-7" }, 202));
    responder = (c) => (c.operacao === "update" ? { data: null, error: { message: "timeout" } } : bancoQueFunciona(c));
    const res = await chamar({ prompt: PEDIDO, request_id: ID_DA_TELA });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ job_id: "job-7", request: { engine_job_id: null } });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("audita o despacho confirmado SEM o texto do pedido, apontando para a linha", async () => {
    motorResponde(() => json({ job_id: "job-7" }, 202));
    const res = await chamar({ prompt: PEDIDO, request_id: ID_DA_TELA });

    expect(audit).toHaveBeenCalledTimes(1);
    const entrada = vi.mocked(audit).mock.calls[0]![0];
    expect(entrada).toMatchObject({
      action: "aios.campaign_dispatched",
      actorUserId: USER,
      organizationId: ORG,
      resourceType: "aios_campaign_request",
      resourceId: LINHA,
      requestId: res.headers.get("X-Request-Id"),
      metadata: {
        acao: "generate_campaign",
        confirmado: true,
        job_id: "job-7",
        engine_status: 202,
        pedido_request_id: ID_DA_TELA,
        prompt_chars: PEDIDO.length,
      },
    });
    expect(JSON.stringify(entrada)).not.toContain("2 milhões");
  });
});

describe("POST /api/v1/aios-dispatch — quando o motor não aceita", () => {
  /** O acerto de uma falha: só toca a linha da organização da sessão, e só se ainda `queued`. */
  const FILTROS_DA_FALHA = [
    ["eq", "organization_id", ORG],
    ["eq", "id", LINHA],
    ["eq", "status", "queued"],
  ];

  it("motor recusou → 502 com o status dele, a linha vira failed com a frase, sem audit", async () => {
    motorResponde(() => json({ detail: "org desconhecida" }, 422));
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(502);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("upstream_unavailable");
    expect(corpo.error.details).toEqual({ engine_status: 422 });
    // O que o motor escreveu no corpo da recusa não é repassado à tela.
    expect(JSON.stringify(corpo)).not.toContain("org desconhecida");
    expect(audit).not.toHaveBeenCalled();

    const [acerto] = doAdmin();
    expect(acerto!.valores).toEqual({ status: "failed", error_message: corpo.error.message });
    expect(acerto!.filtros).toEqual(FILTROS_DA_FALHA);
  });

  it("motor fora do ar → 502, a linha vira failed, sem audit", async () => {
    motorFalha(new TypeError("fetch failed"));
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(502);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("upstream_unavailable");
    expect(audit).not.toHaveBeenCalled();

    const [acerto] = doAdmin();
    expect(acerto!.valores).toEqual({ status: "failed", error_message: corpo.error.message });
    expect(acerto!.filtros).toEqual(FILTROS_DA_FALHA);
  });

  it("prazo estourado → 504, a linha vira unconfirmed, e a dúvida fica auditada", async () => {
    motorFalha(new DOMException("The operation timed out.", "TimeoutError"));
    const res = await chamar({ prompt: PEDIDO, request_id: ID_DA_TELA });
    expect(res.status).toBe(504);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("upstream_timeout");
    expect(corpo.error.message).toContain("duas vezes");

    // `unconfirmed`, e não `failed`: o pedido PODE ter chegado. Sem
    // `error_message` — não há erro a contar, há uma dúvida.
    const [acerto] = doAdmin();
    expect(acerto!.valores).toEqual({ status: "unconfirmed" });
    expect(acerto!.filtros).toEqual(FILTROS_DA_FALHA);

    expect(audit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      action: "aios.campaign_dispatched",
      resourceId: LINHA,
      metadata: { confirmado: false, job_id: null, pedido_request_id: ID_DA_TELA },
    });
  });

  it("AIOS_PYTHON_URL que não é endereço → 503, a linha vira failed, sem chamar o motor", async () => {
    vi.stubEnv("AIOS_PYTHON_URL", "aios-sem-protocolo");
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(503);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("unavailable");
    expect(motor).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();

    const [acerto] = doAdmin();
    expect(acerto!.valores).toEqual({ status: "failed", error_message: corpo.error.message });
    expect(acerto!.filtros).toEqual(FILTROS_DA_FALHA);
  });

  it("a falha vai para o log sem o texto do pedido", async () => {
    motorFalha(new TypeError("fetch failed"));
    await chamar({ prompt: PEDIDO });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls[0])).not.toContain("2 milhões");
  });
});

describe("GET /api/v1/aios-dispatch — a lista de pedidos", () => {
  it("exige manager, e deixa o admin de plataforma LER", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ ok: false, response: fail("forbidden_role", "x", 403, {}) });
    const res = await listar();
    expect(res.status).toBe(403);
    const [papel, opcoes] = vi.mocked(requireRole).mock.calls[0]!;
    expect(papel).toBe("manager");
    expect(opcoes).toMatchObject({ allowPlatformAdmin: "leitura" });
    expect(cadeias).toHaveLength(0);
  });

  it("não passa pela guarda de escrita do suporte: ler não é efeito", async () => {
    await listar();
    expect(requireSupportWrite).not.toHaveBeenCalled();
  });

  it("lê pela sessão, só a organização ativa, do mais novo ao mais antigo", async () => {
    const linhas = [linhaDoBanco({ status: "completed", response_summary: "Campanha criada." })];
    responder = () => ({ data: linhas, error: null });
    const res = await listar();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: linhas, meta: { cursor: null, has_more: false } });

    expect(doAdmin()).toHaveLength(0);
    const [leitura] = daSessao();
    expect(leitura!.tabela).toBe("aios_campaign_requests");
    expect(leitura!.operacao).toBe("select");
    expect(leitura!.filtros).toEqual([["eq", "organization_id", ORG]]);
    expect(leitura!.ordem).toEqual([
      ["created_at", false],
      ["id", false],
    ]);
    // Uma a mais que o pedido: é como a rota sabe se há página seguinte.
    expect(leitura!.limite).toBe(21);
  });

  it("com mais linhas que o limite: corta, avisa has_more e devolve o cursor da última", async () => {
    const tres = ["a", "b", "c"].map((letra, i) =>
      linhaDoBanco({ id: `${letra.repeat(8)}-0000-4000-8000-000000000000`, created_at: `2026-11-11T12:00:0${3 - i}+00:00` }),
    );
    responder = () => ({ data: tres, error: null });
    const res = await listar("?limit=2");
    const corpo = await res.json();

    expect(corpo.data).toHaveLength(2);
    expect(corpo.meta.has_more).toBe(true);
    expect(corpo.meta.cursor).toBe(
      codificarCursorDePedidoAios({ created_at: "2026-11-11T12:00:02+00:00", id: "bbbbbbbb-0000-4000-8000-000000000000" }),
    );
    expect(daSessao()[0]!.limite).toBe(3);
  });

  it("o cursor vira o recorte keyset (data, depois id)", async () => {
    const cursor = codificarCursorDePedidoAios({ created_at: CRIADO_EM, id: LINHA });
    await listar(`?cursor=${cursor}`);
    expect(daSessao()[0]!.filtros).toEqual([
      ["eq", "organization_id", ORG],
      ["or", `created_at.lt.${CRIADO_EM},and(created_at.eq.${CRIADO_EM},id.lt.${LINHA})`],
    ]);
  });

  it.each([
    ["lixo", "nao-e-cursor"],
    // Um cursor forjado para injetar um ramo no filtro do PostgREST.
    ["injeção", Buffer.from(`${CRIADO_EM}|${LINHA}),organization_id.neq.${ORG}`, "utf8").toString("base64url")],
    ["data que não é data", Buffer.from(`ontem|${LINHA}`, "utf8").toString("base64url")],
  ])("cursor inválido (%s) → 400, sem ler o banco", async (_caso, cursor) => {
    const res = await listar(`?cursor=${cursor}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_cursor");
    expect(cadeias).toHaveLength(0);
  });

  it.each(["0", "51", "muitos"])("limit=%s → 422", async (limit) => {
    expect((await listar(`?limit=${limit}`)).status).toBe(422);
    expect(cadeias).toHaveLength(0);
  });

  it("o banco falhou → 500, com o erro no log e não na tela", async () => {
    responder = () => ({ data: null, error: { message: 'relation "aios_campaign_requests" does not exist' } });
    const res = await listar();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("does not exist");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
