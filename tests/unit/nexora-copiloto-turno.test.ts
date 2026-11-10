// FORK NEXORA — O COPILOTO: um turno do modelo ──────────────────────────────
//
// O que este arquivo mede:
//  - a chamada vai pelo SEAM (`runModelCall`) com o ponto `copiloto_setup` — é o
//    que põe o Copiloto na credencial, no orçamento, no teto do plano e no custo
//    da organização. Trocar por uma chamada direta ao provedor deixa vermelho;
//  - as duas ferramentas chegam ao modelo, e o System Prompt é o do Copiloto;
//  - o histórico é cortado no servidor e começa por uma fala da pessoa;
//  - cada erro do seam vira a frase que diz o GESTO (configurar chave, ajustar
//    orçamento, trocar de plano), e o teto do PLANO não é confundido com o
//    orçamento da organização.

import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ runModelCall: vi.fn() }));
vi.mock("@/lib/agent-engine/edge/llm/run-model-call", async (original) => ({
  ...((await original()) as object),
  runModelCall: seam.runModelCall,
}));

import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
  LlmNotConfiguredError,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import { MOTIVO_TETO_DO_PLANO } from "@/lib/agent-engine/edge/llm/orcamento";
import { PONTOS_DE_IA } from "@/lib/ai/pontos/registro";
import { SYSTEM_DO_COPILOTO } from "@/lib/copiloto/prompt";
import {
  falhaDoTurno,
  HISTORICO_MAX,
  mensagensParaOModelo,
  PONTO_DO_COPILOTO,
  rodarTurnoDoCopiloto,
  type MensagemDoHistorico,
} from "@/lib/copiloto/turno";

const ORG = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("o ponto de IA do Copiloto", () => {
  it("está no registro, exige ferramentas e grava custo em llm_calls", () => {
    const ponto = PONTOS_DE_IA.find((p) => p.id === PONTO_DO_COPILOTO);
    expect(ponto).toBeDefined();
    expect(ponto!.exige.tools).toBe(true);
    expect(ponto!.registraEm).toBe("llm_calls");
    expect(ponto!.emissor).toBe("lib/copiloto/turno.ts");
  });
});

describe("mensagensParaOModelo", () => {
  it("corta nas últimas HISTORICO_MAX e começa por uma fala da pessoa", () => {
    const longo: MensagemDoHistorico[] = Array.from({ length: HISTORICO_MAX + 5 }, (_, i) => ({
      papel: i % 2 === 0 ? "pessoa" : "copiloto",
      texto: `m${i}`,
    }));
    const msgs = mensagensParaOModelo(longo);
    expect(msgs.length).toBeLessThanOrEqual(HISTORICO_MAX);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs.at(-1)).toEqual({ role: "user", content: `m${HISTORICO_MAX + 4}` });
  });

  it("mapeia os papéis", () => {
    expect(
      mensagensParaOModelo([
        { papel: "pessoa", texto: "oi" },
        { papel: "copiloto", texto: "olá" },
        { papel: "pessoa", texto: "cria um funil" },
      ]),
    ).toEqual([
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá" },
      { role: "user", content: "cria um funil" },
    ]);
  });
});

describe("rodarTurnoDoCopiloto — pelo seam, com o ponto e as ferramentas", () => {
  it("chama runModelCall com purpose copiloto_setup, o system do Copiloto, as duas ferramentas e a org da sessão", async () => {
    seam.runModelCall.mockResolvedValue({ result: { text: "  Pronto!  " }, callId: "call-1" });
    const r = await rodarTurnoDoCopiloto(
      {
        supabase: {} as never,
        organizationId: ORG,
        actorUserId: "u1",
        requestId: "req",
        emitir: () => {},
        pool: {} as never,
        llmCfg: {} as never,
      },
      [{ papel: "pessoa", texto: "Quero um funil" }],
    );

    expect(seam.runModelCall).toHaveBeenCalledTimes(1);
    const entrada = seam.runModelCall.mock.calls[0]![2];
    expect(entrada).toMatchObject({
      tenantId: ORG,
      purpose: "copiloto_setup",
      system: SYSTEM_DO_COPILOTO,
      messages: [{ role: "user", content: "Quero um funil" }],
    });
    expect(Object.keys(entrada.tools).sort()).toEqual(["criar_funil", "listar_funis"]);
    // Sem `maxSteps`, o SDK para no primeiro passo e o modelo nunca vê o resultado da ferramenta.
    expect(entrada.maxSteps).toBeGreaterThan(1);
    // O modelo não é escolhido aqui: vem do ponto ou do padrão da organização.
    expect(entrada.model).toBeUndefined();
    expect(r).toEqual({ texto: "Pronto!", callId: "call-1", ferramentas: [], funisCriados: [] });
  });

  it("histórico sem fala da pessoa não chama o modelo", async () => {
    await expect(
      rodarTurnoDoCopiloto(
        {
          supabase: {} as never,
          organizationId: ORG,
          actorUserId: "u1",
          requestId: "req",
          emitir: () => {},
          pool: {} as never,
          llmCfg: {} as never,
        },
        [{ papel: "copiloto", texto: "olá" }],
      ),
    ).rejects.toThrow();
    expect(seam.runModelCall).not.toHaveBeenCalled();
  });
});

describe("falhaDoTurno — o erro do seam vira o gesto que resolve", () => {
  it("sem chave de IA", () => {
    expect(falhaDoTurno(new LlmNotConfiguredError())).toMatchObject({ codigo: "llm_not_configured" });
    expect(falhaDoTurno(new LlmNotConfiguredError()).mensagem).toContain("IA › Provedores");
  });

  it("orçamento da organização e teto do PLANO são falhas diferentes", () => {
    expect(falhaDoTurno(new LlmBudgetExceededError())).toMatchObject({ codigo: "orcamento_esgotado" });
    const plano = falhaDoTurno(new LlmBudgetExceededError(MOTIVO_TETO_DO_PLANO));
    expect(plano.codigo).toBe("teto_do_plano");
    expect(plano.mensagem).toContain("Plano e cobrança");
  });

  it("modelo fora do habilitado", () => {
    expect(falhaDoTurno(new LlmModelNotEnabledError("x"))).toMatchObject({ codigo: "modelo_indisponivel" });
  });

  it("qualquer outra coisa: frase genérica, nunca o texto do erro", () => {
    const f = falhaDoTurno(new Error("ECONNRESET segredo"));
    expect(f.codigo).toBe("copiloto_indisponivel");
    expect(f.mensagem).not.toContain("segredo");
  });
});

describe("o System Prompt declara o escopo", () => {
  it("tráfego pago pertence ao AIOS, e criar exige confirmação", () => {
    expect(SYSTEM_DO_COPILOTO).toContain("Engenheiro de Setup e Operação");
    expect(SYSTEM_DO_COPILOTO).toMatch(/Meta Ads[\s\S]*motor AIOS/);
    expect(SYSTEM_DO_COPILOTO).toMatch(/Só chame criar_funil depois que a pessoa confirmar/);
  });
});
