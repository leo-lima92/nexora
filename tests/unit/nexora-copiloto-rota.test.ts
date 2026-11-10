// FORK NEXORA — O COPILOTO: a rota POST /api/v1/ask-ai ──────────────────────
//
// O que este arquivo mede:
//  - a ordem das guardas: suporte somente-leitura recusa ANTES de tudo, e o
//    papel exigido é `manager`;
//  - o corpo é estrito: `organization_id` no body é recusado, e a organização
//    que chega ao turno é a da SESSÃO;
//  - o stream: `inicio` → eventos das ferramentas → `resposta` → `fim`, com
//    `X-Request-Id`; e a falha do modelo vira evento `erro` com a frase do gesto;
//  - o audit `ai.copiloto_turn` não leva o texto da conversa.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ sessao: true })) }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn(() => ({ pool: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 10, count: 1 })),
}));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({
  requestTurnDeps: () => ({ llmCfg: { cfg: true }, registry: undefined, log: undefined }),
}));
const turno = vi.hoisted(() => ({ rodar: vi.fn() }));
vi.mock("@/lib/copiloto/turno", async (original) => ({
  ...((await original()) as object),
  rodarTurnoDoCopiloto: turno.rodar,
}));

import { LlmNotConfiguredError } from "@/lib/agent-engine/edge/llm/run-model-call";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { EventoDoCopiloto } from "@/lib/copiloto/eventos";
import type { DepsDoTurno } from "@/lib/copiloto/turno";
import { requireSupportWrite } from "@/lib/impersonate/support";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const SEGREDO = "minha clínica fatura 2 milhões";

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
  return new NextRequest("http://localhost/api/v1/ask-ai", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function eventosDe(res: Response): Promise<EventoDoCopiloto[]> {
  const texto = await res.text();
  return texto
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EventoDoCopiloto);
}

const pergunta = { mensagens: [{ papel: "pessoa", texto: SEGREDO }] };

beforeEach(() => {
  vi.clearAllMocks();
  sessaoOk();
});

describe("POST /api/v1/ask-ai — guardas", () => {
  it("suporte somente-leitura recusa ANTES de autenticar ou chamar o modelo", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValueOnce(fail("support_readonly", "Somente leitura.", 403, {}) as never);
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const res = await POST(post(pergunta));
    expect(res.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
    expect(turno.rodar).not.toHaveBeenCalled();
  });

  it("exige manager", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ ok: false, response: fail("forbidden_role", "x", 403, {}) });
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const res = await POST(post(pergunta));
    expect(res.status).toBe(403);
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("manager");
    expect(turno.rodar).not.toHaveBeenCalled();
  });

  it("organization_id no corpo é recusado — a organização é a da sessão", async () => {
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const res = await POST(post({ ...pergunta, organization_id: "33333333-3333-4333-8333-333333333333" }));
    expect(res.status).toBe(422);
    expect(turno.rodar).not.toHaveBeenCalled();
  });

  it("a última mensagem precisa ser da pessoa", async () => {
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const res = await POST(
      post({ mensagens: [{ papel: "pessoa", texto: "oi" }, { papel: "copiloto", texto: "olá" }] }),
    );
    expect(res.status).toBe(422);
  });

  it("corpo que não é JSON → 400", async () => {
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    expect((await POST(post("{nao json"))).status).toBe(400);
  });

  it("ritmo estourado → 429 com Retry-After, sem chamar o modelo", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, limit: 10, count: 11 } as never);
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const res = await POST(post(pergunta));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(turno.rodar).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/ask-ai — o stream", () => {
  it("inicio → ferramentas → funil_criado → resposta → fim, com a org e o usuário da sessão", async () => {
    turno.rodar.mockImplementation(async (deps: DepsDoTurno) => {
      deps.emitir({ tipo: "ferramenta", estado: "inicio", nome: "criar_funil" });
      deps.emitir({ tipo: "funil_criado", pipeline_id: "p1", nome: "Clínica", etapas: ["A", "Ganho", "Perdido"] });
      deps.emitir({ tipo: "ferramenta", estado: "fim", nome: "criar_funil", ok: true });
      return { texto: "Criei o funil Clínica.", callId: "call-9", ferramentas: ["criar_funil"], funisCriados: ["p1"] };
    });
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const res = await POST(post(pergunta));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    const requestId = res.headers.get("X-Request-Id");
    expect(requestId).toBeTruthy();

    const eventos = await eventosDe(res);
    expect(eventos.map((e) => e.tipo)).toEqual([
      "inicio",
      "ferramenta",
      "funil_criado",
      "ferramenta",
      "resposta",
      "fim",
    ]);
    expect(eventos[0]).toEqual({ tipo: "inicio", request_id: requestId });
    expect(eventos[4]).toEqual({ tipo: "resposta", texto: "Criei o funil Clínica." });

    const deps = turno.rodar.mock.calls[0]![0] as DepsDoTurno;
    expect(deps.organizationId).toBe(ORG);
    expect(deps.actorUserId).toBe(USER);
    expect(deps.supabase, "o client é o da SESSÃO (RLS), não service role").toEqual({ sessao: true });
  });

  it("modelo sem texto (teto de passos) → a tela não fica muda", async () => {
    turno.rodar.mockResolvedValue({ texto: "", callId: null, ferramentas: [], funisCriados: [] });
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const eventos = await eventosDe(await POST(post(pergunta)));
    const resposta = eventos.find((e) => e.tipo === "resposta") as { texto: string };
    expect(resposta.texto.length).toBeGreaterThan(0);
  });

  it("falha do modelo → evento erro com a frase do gesto, e o stream fecha com fim", async () => {
    turno.rodar.mockRejectedValue(new LlmNotConfiguredError());
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    const res = await POST(post(pergunta));
    expect(res.status).toBe(200);
    const eventos = await eventosDe(res);
    expect(eventos.map((e) => e.tipo)).toEqual(["inicio", "erro", "fim"]);
    expect(eventos[1]).toMatchObject({ tipo: "erro", codigo: "llm_not_configured" });
    expect((eventos[1] as { mensagem: string }).mensagem).toContain("IA › Provedores");
  });
});

describe("POST /api/v1/ask-ai — auditoria", () => {
  it("um ai.copiloto_turn por turno, com a linha de custo e os funis, SEM o texto da conversa", async () => {
    turno.rodar.mockResolvedValue({ texto: "ok", callId: "call-1", ferramentas: ["criar_funil"], funisCriados: ["p1"] });
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    await eventosDe(await POST(post(pergunta)));

    expect(audit).toHaveBeenCalledTimes(1);
    const entrada = vi.mocked(audit).mock.calls[0]![0];
    expect(entrada).toMatchObject({
      action: "ai.copiloto_turn",
      organizationId: ORG,
      actorUserId: USER,
      metadata: { llm_call_id: "call-1", funis_criados: ["p1"], respondeu: true, error_code: null },
    });
    expect(JSON.stringify(entrada)).not.toContain(SEGREDO);
  });

  it("turno que falhou também audita, com o código", async () => {
    turno.rodar.mockRejectedValue(new Error("boom"));
    const { POST } = await import("@/app/api/v1/ask-ai/route");
    await eventosDe(await POST(post(pergunta)));
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      metadata: { respondeu: false, error_code: "copiloto_indisponivel" },
    });
  });
});
