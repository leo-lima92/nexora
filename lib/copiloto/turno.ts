/**
 * FORK NEXORA — UM turno do Copiloto: a conversa vai ao modelo, as ferramentas
 * rodam, o texto volta.
 *
 * ─── A cobrança é a do seam, e não há outra ─────────────────────────────────
 *
 * A chamada passa por `runModelCall` com `purpose: "copiloto_setup"` (ponto do
 * registro `lib/ai/pontos/registro.ts`). Ali, e só ali, acontecem:
 *  - a credencial: chave própria da organização (`ai_provider_credentials`) ou,
 *    sem ela, a da plataforma — a mesma resolução dos agentes do CRM;
 *  - a escolha de modelo do ponto (IA › Provedores), ou o padrão da organização;
 *  - o orçamento mensal da organização (`ai_budgets`) e o teto de uso de IA do
 *    PLANO, ambos conferidos ANTES de sair byte para o provedor;
 *  - o custo em `llm_calls` (tokens + `cost_cents`), que é o que o uso, a
 *    cobrança e a tela IA › Execuções leem.
 * Este arquivo não sabe de chave, preço nem saldo — e não deve saber.
 *
 * ─── O histórico é do cliente, e é cortado aqui ─────────────────────────────
 *
 * A rota não guarda a conversa: a tela manda o histórico a cada turno. Por isso
 * o corte (`HISTORICO_MAX`) e o teto de tamanho são do servidor — a tela não é
 * confiável para limitar o que se paga.
 */
import type pg from "pg";

import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
  LlmNotConfiguredError,
  LlmProviderUnknownError,
  runModelCall,
  type LlmEdgeConfig,
  type ModelMessage,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import type { ProviderRegistry } from "@/lib/agent-engine/edge/llm/providers";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { MOTIVO_TETO_DO_PLANO } from "@/lib/agent-engine/edge/llm/orcamento";
import { FRASE_DA_FALHA } from "@/lib/ai/conversa-do-caso/frases";

import { ferramentasDoCopiloto, type DepsDasFerramentas } from "./ferramentas";
import type { NomeDaFerramenta } from "./eventos";
import { SYSTEM_DO_COPILOTO } from "./prompt";

/** O id do ponto de IA. Casa com `lib/ai/pontos/registro.ts`. */
export const PONTO_DO_COPILOTO = "copiloto_setup";

/** Mensagens da conversa que vão ao modelo. As mais antigas saem primeiro. */
export const HISTORICO_MAX = 20;
/**
 * Passos do laço de ferramentas: ler os funis, criar, responder — com folga
 * para uma recusa e uma segunda tentativa. Mais que isso é laço, não conversa.
 */
export const PASSOS_MAX = 6;
/** Teto de saída. Um desenho de prompt de SDR cabe com folga. */
export const SAIDA_MAX_TOKENS = 2000;

export interface MensagemDoHistorico {
  papel: "pessoa" | "copiloto";
  texto: string;
}

export interface ResultadoDoTurno {
  texto: string;
  callId: string | null;
  ferramentas: NomeDaFerramenta[];
  funisCriados: string[];
}

/** A falha do turno, já em frase de gente. `codigo` vai ao audit e ao evento. */
export interface FalhaDoTurno {
  codigo: string;
  mensagem: string;
}

/** Frases do Copiloto que não existiam no chat de caso. A chave do dicionário É o texto. */
export const FRASE_DO_COPILOTO = {
  teto_do_plano:
    "O uso de IA incluído no plano acabou neste mês. Troque de plano em Configurações › Plano e cobrança, cadastre uma chave de IA própria ou aguarde o próximo mês.",
  copiloto_indisponivel:
    "O Copiloto não conseguiu responder agora. Tente de novo; se continuar, mande este código para quem instalou o sistema.",
} as const;

/**
 * Erro do seam → código + frase acionável. Os três primeiros acontecem ANTES do
 * `try` do seam e NÃO viram linha em `llm_calls`: sem esta tradução, a
 * instalação fresca sem chave de IA mostraria "não foi possível" e ninguém
 * descobriria que falta configurar. As frases são as do chat de caso
 * (`lib/ai/conversa-do-caso/frases.ts`), já traduzidas no dicionário.
 */
export function falhaDoTurno(erro: unknown): FalhaDoTurno {
  if (erro instanceof LlmNotConfiguredError) {
    return { codigo: "llm_not_configured", mensagem: FRASE_DA_FALHA.llm_not_configured };
  }
  if (erro instanceof LlmBudgetExceededError) {
    return erro.message === MOTIVO_TETO_DO_PLANO
      ? { codigo: "teto_do_plano", mensagem: FRASE_DO_COPILOTO.teto_do_plano }
      : { codigo: "orcamento_esgotado", mensagem: FRASE_DA_FALHA.orcamento_esgotado };
  }
  if (erro instanceof LlmModelNotEnabledError || erro instanceof LlmProviderUnknownError) {
    return { codigo: "modelo_indisponivel", mensagem: FRASE_DA_FALHA.modelo_indisponivel };
  }
  return { codigo: "copiloto_indisponivel", mensagem: FRASE_DO_COPILOTO.copiloto_indisponivel };
}

/**
 * O histórico como o modelo o lê: só os últimos `HISTORICO_MAX`, e começando
 * por uma fala da PESSOA — alguns provedores recusam conversa que abre com o
 * assistente, e o corte pode ter deixado uma resposta órfã na ponta.
 */
export function mensagensParaOModelo(historico: MensagemDoHistorico[]): ModelMessage[] {
  const recorte = historico.slice(-HISTORICO_MAX);
  const inicio = recorte.findIndex((m) => m.papel === "pessoa");
  if (inicio < 0) return [];
  return recorte.slice(inicio).map((m) =>
    m.papel === "pessoa"
      ? { role: "user" as const, content: m.texto }
      : { role: "assistant" as const, content: m.texto },
  );
}

export interface DepsDoTurno extends DepsDasFerramentas {
  pool: pg.Pool;
  llmCfg: LlmEdgeConfig;
  registry?: ProviderRegistry;
  log?: Logger;
  abortSignal?: AbortSignal;
}

export async function rodarTurnoDoCopiloto(
  deps: DepsDoTurno,
  historico: MensagemDoHistorico[],
): Promise<ResultadoDoTurno> {
  const { ferramentas, usadas, funisCriados } = ferramentasDoCopiloto(deps);
  const messages = mensagensParaOModelo(historico);
  if (messages.length === 0) {
    throw new Error("copiloto: histórico sem nenhuma fala da pessoa");
  }

  const { result, callId } = await runModelCall(
    deps.pool,
    deps.llmCfg,
    {
      tenantId: deps.organizationId,
      purpose: "copiloto_setup",
      system: SYSTEM_DO_COPILOTO,
      messages,
      tools: ferramentas,
      maxSteps: PASSOS_MAX,
      maxOutputTokens: SAIDA_MAX_TOKENS,
      abortSignal: deps.abortSignal,
    },
    { registry: deps.registry, log: deps.log },
  );

  return {
    texto: (result.text ?? "").trim(),
    callId,
    ferramentas: usadas(),
    funisCriados: funisCriados(),
  };
}
