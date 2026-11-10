/**
 * FORK NEXORA — as ferramentas do Copiloto.
 *
 * ─── O escopo da organização não passa pelo modelo ──────────────────────────
 *
 * Nenhuma ferramenta recebe `organization_id` como argumento. A organização é
 * fechada AQUI, no momento em que o ToolSet é montado, com o valor que a rota
 * resolveu da sessão (`requireRole` → JWT). O modelo só escolhe O QUÊ — nome do
 * funil, etapas —, nunca ONDE. E o client é o da sessão de quem perguntou: a
 * RLS vale em toda leitura e escrita, e o filtro explícito de
 * `organization_id` é a rede que sobra se a policy mudar (CLAUDE.md,
 * multi-tenancy). Service role não entra neste arquivo.
 *
 * ─── Criar funil é a MESMA operação da tela ─────────────────────────────────
 *
 * `criar_funil` chama `criarFunil` (`lib/pipelines/criar-funil.ts`), a mesma
 * função que `POST /api/v1/pipelines` usa: validação de nome, slug, compensação
 * se as etapas falharem e o audit `pipeline.created` (com `origem: "copiloto"`).
 * A recusa volta ao modelo com a frase escrita para gente, e ele a explica.
 *
 * ─── Teto por turno ─────────────────────────────────────────────────────────
 *
 * Um modelo em laço criaria funil atrás de funil. `CRIACOES_POR_TURNO` corta
 * isso no servidor, sem depender de o modelo obedecer ao prompt.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { tool, type ToolSet } from "@/lib/agent-engine/edge/llm/run-model-call";
import { ApiError } from "@/lib/api/types";
import { criarFunil, ETAPAS_ABERTAS_MAX, NOME_DE_ETAPA_MAX } from "@/lib/pipelines/criar-funil";
import type { EventoDoCopiloto, NomeDaFerramenta } from "./eventos";

export interface DepsDasFerramentas {
  supabase: SupabaseClient;
  /** Resolvida da sessão pela rota. NUNCA do body nem do modelo. */
  organizationId: string;
  actorUserId: string;
  requestId: string;
  /** Empurra um evento para o stream da tela. */
  emitir: (evento: EventoDoCopiloto) => void;
}

/** Funis criados num mesmo turno. Dois cobre "crie o de vendas e o de pós-venda". */
export const CRIACOES_POR_TURNO = 2;
/** Teto de leitura: o contexto vai inteiro ao prompt, e cada token é pago. */
export const FUNIS_LIDOS_MAX = 30;

type Recusa = { ok: false; erro: string };

export interface EtapaLida {
  nome: string;
  tipo: "aberta" | "ganho" | "perda";
}
export interface FunilLido {
  id: string;
  nome: string;
  padrao: boolean;
  etapas: EtapaLida[];
}

/** Os funis vivos da organização com as etapas vivas, na ordem do quadro. */
export async function lerFunisComEtapas(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<FunilLido[]> {
  const { data: funis, error } = await supabase
    .from("crm_pipelines")
    .select("id, name, is_default, position")
    .eq("organization_id", organizationId)
    .eq("is_archived", false)
    .order("position", { ascending: true })
    .limit(FUNIS_LIDOS_MAX);
  if (error) throw new Error(error.message);
  const lista = (funis ?? []) as Array<{ id: string; name: string; is_default: boolean }>;
  if (lista.length === 0) return [];

  const { data: etapas, error: etapasErr } = await supabase
    .from("crm_stages")
    .select("pipeline_id, name, is_won, is_lost, position")
    .eq("organization_id", organizationId)
    .eq("is_archived", false)
    .in(
      "pipeline_id",
      lista.map((f) => f.id),
    )
    .order("position", { ascending: true });
  if (etapasErr) throw new Error(etapasErr.message);

  const porFunil = new Map<string, EtapaLida[]>();
  for (const e of (etapas ?? []) as Array<{
    pipeline_id: string;
    name: string;
    is_won: boolean;
    is_lost: boolean;
  }>) {
    const atual = porFunil.get(e.pipeline_id) ?? [];
    atual.push({ nome: e.name, tipo: e.is_won ? "ganho" : e.is_lost ? "perda" : "aberta" });
    porFunil.set(e.pipeline_id, atual);
  }
  return lista.map((f) => ({
    id: f.id,
    nome: f.name,
    padrao: f.is_default,
    etapas: porFunil.get(f.id) ?? [],
  }));
}

const nomeDeEtapa = z.string().trim().min(1).max(NOME_DE_ETAPA_MAX);

export const ENTRADA_DE_CRIAR_FUNIL = z.object({
  nome: z.string().trim().min(1).max(80).describe("Nome do funil, como aparece na lista de Funis."),
  descricao: z.string().trim().max(280).optional().describe("Uma linha dizendo para que serve o funil."),
  etapas_abertas: z
    .array(nomeDeEtapa)
    .min(1)
    .max(ETAPAS_ABERTAS_MAX)
    .describe("As etapas abertas, na ordem do quadro. NÃO inclua Ganho nem Perdido — elas entram sozinhas no fim."),
  etapa_de_ganho: nomeDeEtapa.optional().describe('Nome da coluna de ganho. Padrão: "Ganho".'),
  etapa_de_perda: nomeDeEtapa.optional().describe('Nome da coluna de perda. Padrão: "Perdido".'),
});

/** O ToolSet de UM turno, com a organização e a sessão já fechadas. */
export function ferramentasDoCopiloto(deps: DepsDasFerramentas): {
  ferramentas: ToolSet;
  usadas: () => NomeDaFerramenta[];
  funisCriados: () => string[];
} {
  const usadas: NomeDaFerramenta[] = [];
  const funisCriados: string[] = [];

  async function rodar<T>(nome: NomeDaFerramenta, corpo: () => Promise<T | Recusa>): Promise<T | Recusa> {
    usadas.push(nome);
    deps.emitir({ tipo: "ferramenta", estado: "inicio", nome });
    let resultado: T | Recusa;
    try {
      resultado = await corpo();
    } catch (err) {
      // Recusa de domínio volta ao modelo com a frase da regra; falha de banco
      // volta como frase genérica — o texto do Postgres não vai ao prompt.
      resultado = {
        ok: false,
        erro:
          err instanceof ApiError
            ? err.message
            : "Não consegui acessar os funis agora. Peça para a pessoa tentar de novo em instantes.",
      };
    }
    const ok = !(typeof resultado === "object" && resultado !== null && (resultado as Recusa).ok === false);
    deps.emitir({ tipo: "ferramenta", estado: "fim", nome, ok });
    return resultado;
  }

  const ferramentas: ToolSet = {
    listar_funis: tool({
      description:
        "Lê os funis (pipelines) ativos desta organização e as etapas de cada um, na ordem do quadro. Use antes de propor ou criar um funil.",
      inputSchema: z.object({}),
      execute: async () =>
        rodar("listar_funis", async () => ({
          ok: true as const,
          funis: await lerFunisComEtapas(deps.supabase, deps.organizationId),
        })),
    }),
    criar_funil: tool({
      description:
        "Cria um funil novo nesta organização com as etapas abertas pedidas, mais as colunas de Ganho e Perdido no fim. Só use depois que a pessoa confirmar o nome e as etapas.",
      inputSchema: ENTRADA_DE_CRIAR_FUNIL,
      execute: async (entrada) =>
        rodar("criar_funil", async () => {
          if (funisCriados.length >= CRIACOES_POR_TURNO) {
            return {
              ok: false as const,
              erro: `Neste pedido já criei ${funisCriados.length} funis, o máximo de uma vez. Confirme com a pessoa antes de criar mais.`,
            };
          }
          const criado = await criarFunil(
            {
              supabase: deps.supabase,
              organizationId: deps.organizationId,
              actorUserId: deps.actorUserId,
              requestId: deps.requestId,
              origem: "copiloto",
            },
            {
              nome: entrada.nome,
              descricao: entrada.descricao ?? null,
              etapasAbertas: entrada.etapas_abertas,
              etapaDeGanho: entrada.etapa_de_ganho,
              etapaDePerda: entrada.etapa_de_perda,
            },
          );
          funisCriados.push(criado.pipelineId);
          const etapas = criado.etapas.map((e) => e.name);
          deps.emitir({ tipo: "funil_criado", pipeline_id: criado.pipelineId, nome: criado.nome, etapas });
          return {
            ok: true as const,
            funil: { id: criado.pipelineId, nome: criado.nome, padrao: criado.isDefault, etapas },
          };
        }),
    }),
  };

  return { ferramentas, usadas: () => [...usadas], funisCriados: () => [...funisCriados] };
}
