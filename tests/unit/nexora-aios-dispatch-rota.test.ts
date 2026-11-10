// @vitest-environment node
//
// FORK NEXORA — TRÁFEGO AIOS: a rota POST /api/v1/aios-dispatch ───────────────
//
// O que este arquivo mede:
//  - a ordem das guardas: suporte somente-leitura recusa ANTES de tudo, o papel
//    exigido é `manager`, e nada disso chega a chamar o motor;
//  - o corpo é estrito: `org_id`/`user_id`/`action` vindos do navegador são
//    recusados, e a organização e a pessoa que vão ao motor são as da SESSÃO;
//  - cada desfecho do motor vira o status que a tela sabe ler: 200 (aceito),
//    502 (recusado ou inalcançável), 503 (endereço mal configurado) e 504 (sem
//    confirmação — o único em que reenviar pode duplicar a campanha);
//  - o audit `aios.campaign_dispatched` existe só quando o pedido saiu com
//    efeito possível, e nunca leva o texto do pedido.
//
// O motor é dublê (`fetch` global): a rota e `lib/aios/despacho.ts` rodam de
// verdade, então o corpo conferido aqui é o que sairia para o Python.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 6, count: 1 })),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const PEDIDO = "campanha para a clínica que fatura 2 milhões";

const motor = vi.fn();

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

beforeEach(() => {
  vi.clearAllMocks();
  motor.mockReset();
  vi.stubGlobal("fetch", motor);
  vi.stubEnv("AIOS_PYTHON_URL", "https://aios.exemplo.com/api/campaign");
  vi.stubEnv("AIOS_PYTHON_TOKEN", "");
  sessaoOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/v1/aios-dispatch — guardas", () => {
  it("suporte somente-leitura recusa ANTES de autenticar ou chamar o motor", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValueOnce(fail("support_readonly", "Somente leitura.", 403, {}) as never);
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
    expect(motor).not.toHaveBeenCalled();
  });

  it("exige manager", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ ok: false, response: fail("forbidden_role", "x", 403, {}) });
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(403);
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("manager");
    expect(motor).not.toHaveBeenCalled();
  });

  it.each([
    ["org_id", { prompt: PEDIDO, org_id: OUTRA_ORG }],
    ["user_id", { prompt: PEDIDO, user_id: OUTRA_ORG }],
    ["action", { prompt: PEDIDO, action: "delete_campaign" }],
  ])("%s no corpo é recusado — quem decide é a sessão e a rota", async (_campo, corpo) => {
    const res = await chamar(corpo);
    expect(res.status).toBe(422);
    expect(motor).not.toHaveBeenCalled();
  });

  it.each([
    ["sem prompt", {}],
    ["prompt vazio", { prompt: "   " }],
    ["prompt longo demais", { prompt: "x".repeat(4001) }],
    ["prompt que não é texto", { prompt: 42 }],
  ])("%s → 422, sem chamar o motor", async (_caso, corpo) => {
    expect((await chamar(corpo)).status).toBe(422);
    expect(motor).not.toHaveBeenCalled();
  });

  it("corpo que não é JSON → 400", async () => {
    expect((await chamar("{nao json")).status).toBe(400);
    expect(motor).not.toHaveBeenCalled();
  });

  it("ritmo estourado → 429 com Retry-After, sem chamar o motor", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, limit: 6, count: 7 } as never);
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(motor).not.toHaveBeenCalled();
  });

  it("o ritmo é contado por pessoa E por organização", async () => {
    motor.mockResolvedValue(json({}));
    await chamar({ prompt: PEDIDO });
    const baldes = vi.mocked(checkRateLimit).mock.calls.map((c) => c[0]);
    expect(baldes).toEqual([`aios:${USER}`, `aios-org:${ORG}`]);
  });
});

describe("POST /api/v1/aios-dispatch — o despacho", () => {
  it("manda ao motor a organização e a pessoa da SESSÃO, com a ação fixa", async () => {
    motor.mockResolvedValue(json({ job_id: "job-7", message: "Recebido. Vou montar a campanha." }, 202));
    const res = await chamar({ prompt: `  ${PEDIDO}  ` });

    expect(res.status).toBe(200);
    const requestId = res.headers.get("X-Request-Id");
    expect(requestId).toBeTruthy();

    expect(motor).toHaveBeenCalledTimes(1);
    const [url, init] = motor.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://aios.exemplo.com/api/campaign");
    expect(JSON.parse(init.body as string)).toEqual({
      org_id: ORG,
      user_id: USER,
      prompt: PEDIDO,
      action: "generate_campaign",
    });
    // O mesmo id vai ao motor e à resposta: é o que casa os dois logs.
    expect((init.headers as Record<string, string>)["X-Request-Id"]).toBe(requestId);

    expect(await res.json()).toEqual({
      data: {
        status: "dispatched",
        action: "generate_campaign",
        job_id: "job-7",
        message: "Recebido. Vou montar a campanha.",
      },
    });
  });

  it("aceite sem corpo → 200 com job_id e message nulos", async () => {
    motor.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: "dispatched", job_id: null, message: null });
  });

  it("audita o despacho confirmado SEM o texto do pedido", async () => {
    motor.mockResolvedValue(json({ job_id: "job-7" }, 202));
    const res = await chamar({ prompt: PEDIDO });

    expect(audit).toHaveBeenCalledTimes(1);
    const entrada = vi.mocked(audit).mock.calls[0]![0];
    expect(entrada).toMatchObject({
      action: "aios.campaign_dispatched",
      actorUserId: USER,
      organizationId: ORG,
      resourceType: "aios_dispatch",
      requestId: res.headers.get("X-Request-Id"),
      metadata: {
        acao: "generate_campaign",
        confirmado: true,
        job_id: "job-7",
        engine_status: 202,
        prompt_chars: PEDIDO.length,
      },
    });
    expect(JSON.stringify(entrada)).not.toContain("2 milhões");
  });
});

describe("POST /api/v1/aios-dispatch — quando o motor não aceita", () => {
  it("motor recusou → 502 com o status dele, sem audit", async () => {
    motor.mockResolvedValue(json({ detail: "org desconhecida" }, 422));
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(502);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("upstream_unavailable");
    expect(corpo.error.details).toEqual({ engine_status: 422 });
    // O que o motor escreveu no corpo da recusa não é repassado à tela.
    expect(JSON.stringify(corpo)).not.toContain("org desconhecida");
    expect(audit).not.toHaveBeenCalled();
  });

  it("motor fora do ar → 502, sem audit", async () => {
    motor.mockRejectedValue(new TypeError("fetch failed"));
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("upstream_unavailable");
    expect(audit).not.toHaveBeenCalled();
  });

  it("prazo estourado → 504, e a dúvida fica auditada como não confirmada", async () => {
    motor.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(504);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("upstream_timeout");
    expect(corpo.error.message).toContain("duas vezes");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      action: "aios.campaign_dispatched",
      metadata: { confirmado: false, job_id: null },
    });
  });

  it("AIOS_PYTHON_URL que não é endereço → 503, sem chamar o motor", async () => {
    vi.stubEnv("AIOS_PYTHON_URL", "aios-sem-protocolo");
    const res = await chamar({ prompt: PEDIDO });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("unavailable");
    expect(motor).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("a falha vai para o log sem o texto do pedido", async () => {
    motor.mockRejectedValue(new TypeError("fetch failed"));
    await chamar({ prompt: PEDIDO });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls[0])).not.toContain("2 milhões");
  });
});
