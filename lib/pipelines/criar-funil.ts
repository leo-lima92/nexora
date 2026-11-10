/**
 * CRIAR UM FUNIL COM AS ETAPAS COM QUE ELE NASCE — a operação, fora da rota.
 *
 * ⚠️ POR QUE ISTO SAIU DE `app/api/v1/pipelines/route.ts`. A sequência (validar o
 * nome contra os funis da organização, escolher o slug que não colide nem com
 * arquivado, inserir o funil, inserir as etapas, DESFAZER o funil se as etapas
 * falharem, auditar) morava dentro do Route Handler. Desde o fork Nexora, o
 * Copiloto (`lib/copiloto/`) também cria funil — e duas superfícies escrevendo
 * na mesma tabela por caminhos diferentes fariam a que ficasse para trás mentir
 * para quem a usa. É o mesmo motivo, e o mesmo desenho, de
 * `lib/leads/stage-operations.ts` (BRIEFING §3, Decisão 4).
 *
 * O que ficou na rota: transporte (JSON, papel, `Response`). O que veio para cá:
 * tudo que decide. A recusa viaja como `ApiError`, e a `message` é escrita para
 * o dono do negócio — vai inteira para a tela e para o modelo, que precisa
 * entender por que não pôde.
 *
 * O client é SEMPRE o da sessão de quem pediu: a RLS vale, e o filtro explícito
 * de `organization_id` é a convenção do repo e a rede que sobra se a policy
 * mudar. Esta função nunca recebe client de service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerFunis } from "@/lib/pipelines/ler-funis";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { chaveDeNome, slugDeNome } from "@/lib/leads/stage-editing";
import {
  ETAPAS_INICIAIS,
  posicaoEntre,
  slugDeFunil,
  validarNomeDeFunil,
  type FunilEditavel,
} from "@/lib/pipelines/pipeline-editing";

export interface DepsDeFunil {
  supabase: SupabaseClient;
  /** Resolvida de fonte confiável (cookie/JWT) pelo chamador — NUNCA do body nem do modelo. */
  organizationId: string;
  actorUserId: string;
  requestId: string;
  /** Quem pediu, para o audit: a tela de Funis ou o Copiloto. */
  origem?: "tela" | "copiloto";
}

/** Uma etapa como o funil vai nascer com ela. */
export interface EtapaPedida {
  name: string;
  slug: string;
  is_won: boolean;
  is_lost: boolean;
}

export interface PedidoDeFunil {
  nome: string;
  descricao?: string | null;
  /**
   * As etapas ABERTAS, na ordem do quadro. Ausente = as etapas padrão do produto
   * (`ETAPAS_INICIAIS`), que é o que a tela de Funis sempre fez.
   */
  etapasAbertas?: string[];
  /** Nome da coluna de ganho. Só vale junto de `etapasAbertas`. Padrão: "Ganho". */
  etapaDeGanho?: string;
  /** Nome da coluna de perda. Só vale junto de `etapasAbertas`. Padrão: "Perdido". */
  etapaDePerda?: string;
}

export interface FunilCriado {
  pipelineId: string;
  nome: string;
  slug: string;
  isDefault: boolean;
  etapas: EtapaPedida[];
  /** Os funis da organização DEPOIS da escrita, relidos do banco. */
  funis: FunilEditavel[];
}

/** O topo de uma coluna do quadro, não um parágrafo — o mesmo teto da rota de etapa. */
export const NOME_DE_ETAPA_MAX = 80;
/** Um quadro com mais colunas que isto não cabe na tela de ninguém. */
export const ETAPAS_ABERTAS_MAX = 12;

function recusa(requestId: string, mensagem: string, status = 422, code = "unprocessable_entity"): ApiError {
  return new ApiError(status, code, undefined, requestId, mensagem);
}

/**
 * As etapas com que o funil nasce, já validadas. Lança `ApiError` 422 com a
 * frase que a pessoa (ou o modelo) precisa ler para corrigir o pedido.
 *
 * Regras, todas medidas no schema:
 *  - no máximo UMA etapa de ganho e UMA de perda ativas por funil
 *    (`uniq_crm_stages_pipeline_won` / `uniq_crm_stages_pipeline_lost`) — por
 *    isso ganho e perda não vêm da lista aberta, vêm de campo próprio;
 *  - slug único no funil (`uniq_crm_stages_pipeline_slug`) e no formato
 *    `^[a-z0-9_-]{2,40}$` (`crm_stages_slug_format`), que é o que `slugDeNome`
 *    produz;
 *  - nome que a pessoa leria como repetido é recusado ANTES do banco, pela
 *    mesma chave (`chaveDeNome`) que a tela de etapas usa.
 */
export function etapasDoPedido(pedido: PedidoDeFunil, requestId: string): EtapaPedida[] {
  if (pedido.etapasAbertas === undefined) {
    return ETAPAS_INICIAIS.map((e) => ({ ...e }));
  }

  const abertas = pedido.etapasAbertas.map((n) => n.trim());
  const ganho = (pedido.etapaDeGanho ?? "Ganho").trim();
  const perda = (pedido.etapaDePerda ?? "Perdido").trim();

  if (abertas.length === 0) {
    throw recusa(requestId, "O funil precisa de pelo menos uma etapa aberta antes de Ganho e Perdido.");
  }
  if (abertas.length > ETAPAS_ABERTAS_MAX) {
    throw recusa(
      requestId,
      `Um funil nasce com no máximo ${ETAPAS_ABERTAS_MAX} etapas abertas. Junte etapas parecidas e tente de novo.`,
    );
  }

  const todas = [...abertas, ganho, perda];
  for (const nome of todas) {
    if (!nome) throw recusa(requestId, "Toda etapa precisa de nome — é o que aparece no topo da coluna.");
    if (nome.length > NOME_DE_ETAPA_MAX) {
      throw recusa(requestId, `O nome «${nome.slice(0, 30)}…» é longo demais para o topo de uma coluna.`);
    }
  }

  const vistas = new Map<string, string>();
  for (const nome of todas) {
    const chave = chaveDeNome(nome);
    const anterior = vistas.get(chave);
    if (anterior !== undefined) {
      throw recusa(requestId, `As etapas «${anterior}» e «${nome}» têm o mesmo nome. Escolha nomes diferentes.`);
    }
    vistas.set(chave, nome);
  }

  const slugs: string[] = [];
  const comSlug = (name: string, is_won: boolean, is_lost: boolean): EtapaPedida => {
    const slug = slugDeNome(name, slugs);
    slugs.push(slug);
    return { name, slug, is_won, is_lost };
  };
  return [
    ...abertas.map((n) => comSlug(n, false, false)),
    comSlug(ganho, true, false),
    comSlug(perda, false, true),
  ];
}

/**
 * Cria o funil e as etapas. Lança `ApiError` — 422 (pedido inválido), 409
 * (corrida com outra aba) ou 500 (banco) — e nunca deixa funil sem etapa.
 */
export async function criarFunil(deps: DepsDeFunil, pedido: PedidoDeFunil): Promise<FunilCriado> {
  const { supabase, organizationId: orgId, requestId } = deps;
  const nome = pedido.nome.trim();
  const descricao = pedido.descricao?.trim() || null;

  // As etapas primeiro: um pedido de etapas inválido não deve nem ler o banco.
  const etapas = etapasDoPedido(pedido, requestId);

  let funis: FunilEditavel[];
  try {
    funis = await lerFunis(supabase, orgId);
  } catch (err) {
    throw new ApiError(500, "internal_error", undefined, requestId, (err as Error).message);
  }

  // ⚠️ VALIDAR ANTES DE TOCAR O BANCO. O índice único é a rede de segurança, não
  // a primeira linha: um 23505 cru não diz QUAL funil já tem esse nome.
  const veredito = validarNomeDeFunil(nome, funis, null);
  if (!veredito.ok) throw recusa(requestId, veredito.erro);

  const row = {
    organization_id: orgId,
    name: nome,
    description: descricao,
    // Arquivados entram na conta do slug: `uniq_crm_pipelines_org_slug` não é parcial.
    slug: slugDeFunil(nome, funis.map((f) => f.slug)),
    // No fim da lista: funil novo aparecendo no meio seria a tela decidindo por
    // quem criou. `lerFunis` vem ordenado.
    position: posicaoEntre(funis[funis.length - 1]?.position ?? null, null),
    // ⚠️ O PRIMEIRO FUNIL DA ORGANIZAÇÃO NASCE PADRÃO. Numa instalação onde o
    // gatilho de seed não rodou, a org fica sem padrão nenhum — e todo lead
    // criado sem funil escolhido não teria para onde ir.
    is_default: funis.filter((f) => !f.is_archived).length === 0,
  };

  const { data: criado, error } = await supabase
    .from("crm_pipelines")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(
        409,
        "state_conflict",
        undefined,
        requestId,
        `«${nome}» mudou enquanto você editava — outro funil já ocupa esse nome ou o lugar de padrão. ` +
          `Recarregue a página e tente de novo.`,
      );
    }
    throw new ApiError(500, "internal_error", undefined, requestId, error.message);
  }
  const pipelineId = (criado as { id: string }).id;

  const { error: etapasErr } = await supabase.from("crm_stages").insert(
    etapas.map((etapa, i) => ({
      organization_id: orgId,
      pipeline_id: pipelineId,
      name: etapa.name,
      slug: etapa.slug,
      position: (i + 1) * 1000,
      is_won: etapa.is_won,
      is_lost: etapa.is_lost,
    })),
  );

  // ⚠️ COMPENSAÇÃO, PORQUE SÃO DUAS ESCRITAS SEM TRANSAÇÃO. Um funil sem etapa é
  // quadro morto: o board abre sem coluna nenhuma e quem criou não tem como
  // saber que aquilo nasceu quebrado. O funil recém-criado ainda não tem
  // negócio, então `crm_leads_pipeline_id_fkey ON DELETE RESTRICT` não atrapalha.
  if (etapasErr) {
    await supabase.from("crm_pipelines").delete().eq("id", pipelineId).eq("organization_id", orgId);
    throw new ApiError(
      500,
      "internal_error",
      { erro: etapasErr.message },
      requestId,
      `Não consegui criar as etapas de «${nome}». Nada foi salvo — tente de novo.`,
    );
  }

  void audit({
    action: "pipeline.created",
    actorUserId: deps.actorUserId,
    organizationId: orgId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: {
      name: nome,
      slug: row.slug,
      is_default: row.is_default,
      origem: deps.origem ?? "tela",
      etapas: etapas.length,
    },
  });

  // Relê em vez de espelhar o que foi pedido: quem chamou mostra o que o banco tem.
  let depois: FunilEditavel[];
  try {
    depois = await lerFunis(supabase, orgId);
  } catch (err) {
    throw new ApiError(500, "internal_error", undefined, requestId, (err as Error).message);
  }

  return { pipelineId, nome, slug: row.slug, isDefault: row.is_default, etapas, funis: depois };
}
