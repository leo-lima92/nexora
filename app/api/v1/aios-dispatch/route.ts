/**
 * /api/v1/aios-dispatch — FORK NEXORA: os pedidos de campanha da tela
 * `/app/aios` (o Estrategista de Tráfego) ao motor de tráfego (AIOS, Python,
 * fora do CRM).
 *
 *   POST  registra o pedido e o entrega ao motor
 *   GET   lista os pedidos da organização ativa, do mais novo ao mais antigo
 *
 * A rota não gera campanha nenhuma: confere quem pede, grava a linha do pedido
 * (`public.aios_campaign_requests`, migration 9902), monta o corpo e chama o
 * motor (`lib/aios/despacho.ts`). O resultado da campanha não volta pela
 * chamada HTTP — o motor o grava na MESMA linha, com a service key, e a tela o
 * lê pelo GET. Contrato com o lado Python: `docs/AIOS_PYTHON_CONTRACT.md`.
 *
 * ─── Autorização ────────────────────────────────────────────────────────────
 *
 * `manager`+, a mesma régua da tela e a que Meta Ads tinha no upstream: um
 * pedido aqui vira campanha paga com o orçamento de mídia da empresa inteira,
 * e não há recorte por pessoa. A RLS da tabela repete a régua, porque a rota
 * não é a única porta (o PostgREST é alcançável do navegador).
 *
 * `org_id` e `user_id` saem de `requireRole` (JWT/cookie), NUNCA do corpo. O
 * corpo é estrito e só aceita `prompt` e `request_id`: `org_id` vindo do
 * navegador é recusado com 422, em vez de ignorado, para o erro de quem integra
 * aparecer na hora.
 *
 * ─── A ordem do POST: a linha nasce ANTES do despacho ───────────────────────
 *
 *   1. INSERT da linha (`queued`), pela sessão da pessoa — sob RLS.
 *   2. Chamada ao motor, com o `request_id` da linha no corpo.
 *   3. Acerto do desfecho do despacho na linha.
 *
 * Antes, e não depois, por três motivos: o motor precisa achar a linha quando
 * for gravar a resposta (inserir depois abriria uma corrida); uma campanha que
 * o motor aceitou e o CRM não conseguiu registrar não teria onde aparecer; e é
 * o INSERT que barra o pedido repetido — `(organization_id, request_id)` é
 * único, o segundo bate em 23505 e NÃO é despachado.
 *
 * O acerto do passo 3 usa a service role, porque a tabela não tem policy de
 * UPDATE (resposta de campanha só entra pela service key). Ele filtra a
 * organização da sessão e só toca a linha enquanto ela ainda está `queued`: o
 * motor pode ter andado para `processing`/`completed` antes de o CRM voltar da
 * chamada, e o desfecho do despacho não pode passar por cima da resposta.
 *
 * ─── Status: o que cada um promete ──────────────────────────────────────────
 *
 *   200  o motor confirmou que recebeu                    linha: `queued`
 *   409  este `request_id` já foi registrado              nada novo, nada enviado
 *   502  o motor recusou, ou não deu para falar com ele   linha: `failed`
 *   503  `AIOS_PYTHON_URL` não é um endereço              linha: `failed`
 *   504  o motor não confirmou no prazo                   linha: `unconfirmed`
 *
 * 502 e 504 são diferentes de propósito: só no 504 o pedido PODE ter chegado e
 * reenviar pode gerar a mesma campanha duas vezes, e a frase diz isso à pessoa.
 *
 * ─── Auditoria ──────────────────────────────────────────────────────────────
 *
 * `aios.campaign_dispatched` quando o pedido saiu do CRM com efeito possível:
 * confirmado (200) ou sem confirmação (504). Sem o texto do pedido — o que
 * entra em `api_audit_log` não sai pela cascata de LGPD. O texto mora só na
 * linha do pedido.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ACAO_GERAR_CAMPANHA, despacharParaOAios } from "@/lib/aios/despacho";
import { COLUNAS_DO_PEDIDO, type PedidoAios } from "@/lib/aios/pedidos";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import {
  codificarCursorDePedidoAios,
  corpoDoPedidoAios,
  decodificarCursorDePedidoAios,
  listaDePedidosAiosQuery,
} from "@/lib/schemas/aios-pedidos";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABELA = "aios_campaign_requests";

/** Teto por PESSOA. Cada pedido põe o motor para trabalhar numa campanha. */
const TETO_POR_USUARIO = 6;
/** Teto por ORGANIZAÇÃO, para "6 por pessoa" não virar 60 com dez gestores. */
const TETO_POR_ORGANIZACAO = 20;
const JANELA_SEGUNDOS = 60;

/**
 * O acerto do desfecho do despacho na linha do pedido. Service role, com a
 * organização da SESSÃO no filtro. Devolve a linha como ficou, ou `null`
 * quando nada foi tocado (o motor já tinha andado, ou a escrita falhou — e aí
 * o erro vai para o log: a linha fica `queued`, que é o que a tela mostra).
 */
async function acertarDesfecho(
  orgId: string,
  pedidoId: string,
  requestId: string,
  desfecho:
    | { tipo: "protocolo"; engineJobId: string }
    | { tipo: "sem_confirmacao" }
    | { tipo: "falhou"; frase: string },
): Promise<PedidoAios | null> {
  const admin = createAdminClient();
  const consulta =
    desfecho.tipo === "protocolo"
      ? // O protocolo do aceite só entra se o motor ainda não gravou o dele.
        admin
          .from(TABELA)
          .update({ engine_job_id: desfecho.engineJobId })
          .eq("organization_id", orgId)
          .eq("id", pedidoId)
          .is("engine_job_id", null)
      : admin
          .from(TABELA)
          .update(
            desfecho.tipo === "sem_confirmacao"
              ? { status: "unconfirmed" }
              : { status: "failed", error_message: desfecho.frase },
          )
          .eq("organization_id", orgId)
          .eq("id", pedidoId)
          .eq("status", "queued");

  const { data, error } = await consulta.select(COLUNAS_DO_PEDIDO).maybeSingle();
  if (error) {
    logger.error("[aios] o desfecho do despacho não foi gravado na linha do pedido", {
      requestId,
      organizationId: orgId,
      pedido_id: pedidoId,
      desfecho: desfecho.tipo,
      erro: error.message,
    });
    return null;
  }
  return (data as PedidoAios | null) ?? null;
}

export async function POST(req: NextRequest): Promise<Response> {
  // PRIMEIRO passo: um admin de plataforma em acompanhamento somente-leitura
  // não pode pôr o motor para montar campanha na conta do cliente.
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "aios" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("invalid_request", t("Corpo não é JSON válido."), 400, { requestId });
  }
  const parsed = corpoDoPedidoAios.safeParse(bruto);
  if (!parsed.success) {
    return fail("validation_failed", t("Não entendi o pedido enviado ao Estrategista de Tráfego."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const porUsuario = await checkRateLimit(`aios:${userId}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  const porOrganizacao = await checkRateLimit(`aios-org:${orgId}`, TETO_POR_ORGANIZACAO, JANELA_SEGUNDOS);
  if (!porUsuario.allowed || !porOrganizacao.allowed) {
    return fail("rate_limited", t("Muitos pedidos seguidos. Tente em um minuto."), 429, {
      requestId,
      headers: {
        "Retry-After": String(JANELA_SEGUNDOS),
        "X-RateLimit-Limit": String(porUsuario.limit),
        "X-RateLimit-Remaining": String(Math.max(0, porUsuario.limit - porUsuario.count)),
      },
    });
  }

  const prompt = parsed.data.prompt;
  // O id do PEDIDO: o que a tela gerou, ou um novo para quem chama sem ela.
  const idDoPedido = parsed.data.request_id ?? randomUUID();

  // 1. A linha nasce antes do despacho, pela sessão da pessoa: a RLS confere de
  //    novo a organização, o papel e que `user_id` é quem está logado.
  const supabase = await createClient();
  const { data: inserida, error: erroDoInsert } = await supabase
    .from(TABELA)
    .insert({ organization_id: orgId, user_id: userId, request_id: idDoPedido, prompt, status: "queued" })
    .select(COLUNAS_DO_PEDIDO)
    .single();

  if (erroDoInsert || !inserida) {
    if (erroDoInsert?.code === "23505") {
      // O mesmo pedido de novo: não vira segunda linha nem segunda campanha.
      return fail(
        "idempotency_conflict",
        t("Este pedido já foi registrado. Confira a lista de pedidos antes de enviar de novo."),
        409,
        { requestId },
      );
    }
    logger.error("[aios] o pedido não foi registrado; nada foi enviado ao motor", {
      requestId,
      organizationId: orgId,
      erro: erroDoInsert?.message ?? "insert sem linha de volta",
      codigo: erroDoInsert?.code ?? null,
    });
    return fail(
      "internal_error",
      t("Não consegui registrar o pedido, e nada foi enviado ao motor de tráfego. Tente de novo em instantes."),
      500,
      { requestId },
    );
  }
  const linha = inserida as unknown as PedidoAios;

  // 2. O despacho.
  const resultado = await despacharParaOAios({ orgId, userId, prompt, pedidoId: idDoPedido, requestId });

  const auditar = (confirmado: boolean, jobId: string | null, statusDoMotor: number | null) =>
    void audit({
      action: "aios.campaign_dispatched",
      actorUserId: userId,
      organizationId: orgId,
      resourceType: "aios_campaign_request",
      resourceId: linha.id,
      requestId,
      metadata: {
        acao: ACAO_GERAR_CAMPANHA,
        confirmado,
        job_id: jobId,
        engine_status: statusDoMotor,
        pedido_request_id: idDoPedido,
        prompt_chars: prompt.length,
      },
    });

  // 3. O desfecho.
  if (resultado.ok) {
    const comProtocolo = resultado.jobId
      ? await acertarDesfecho(orgId, linha.id, requestId, { tipo: "protocolo", engineJobId: resultado.jobId })
      : null;
    auditar(true, resultado.jobId, resultado.status);
    return ok(
      {
        status: "dispatched" as const,
        action: ACAO_GERAR_CAMPANHA,
        job_id: resultado.jobId,
        message: resultado.mensagem,
        request: comProtocolo ?? linha,
      },
      { requestId },
    );
  }

  // O texto do pedido não entra no log, só o tamanho — mesmo critério do audit.
  logger.error("[aios] o despacho não foi confirmado", {
    requestId,
    organizationId: orgId,
    pedido_id: linha.id,
    motivo: resultado.motivo,
    engine_status: resultado.status,
  });

  if (resultado.motivo === "prazo") {
    await acertarDesfecho(orgId, linha.id, requestId, { tipo: "sem_confirmacao" });
    auditar(false, null, null);
    return fail(
      "upstream_timeout",
      t(
        "O motor de tráfego não confirmou o recebimento a tempo. O pedido pode ter chegado: se você enviar de novo, a campanha pode ser gerada duas vezes.",
      ),
      504,
      { requestId },
    );
  }

  // Daqui para baixo o pedido NÃO foi aceito. A frase que a pessoa lê é a que
  // fica na linha (`error_message`): o histórico diz o mesmo que a conversa.
  if (resultado.motivo === "configuracao") {
    const frase = t(
      "O endereço do motor de tráfego está mal configurado nesta instalação. Avise quem instalou o sistema.",
    );
    await acertarDesfecho(orgId, linha.id, requestId, { tipo: "falhou", frase });
    return fail("unavailable", frase, 503, { requestId });
  }
  if (resultado.motivo === "recusado") {
    const frase = t("O motor de tráfego recusou o pedido. Tente de novo; se continuar, avise quem instalou o sistema.");
    await acertarDesfecho(orgId, linha.id, requestId, { tipo: "falhou", frase });
    return fail("upstream_unavailable", frase, 502, { requestId, details: { engine_status: resultado.status } });
  }
  const frase = t(
    "Não consegui falar com o motor de tráfego. Tente de novo em instantes; se continuar, avise quem instalou o sistema.",
  );
  await acertarDesfecho(orgId, linha.id, requestId, { tipo: "falhou", frase });
  return fail("upstream_unavailable", frase, 502, { requestId });
}

/**
 * GET — os pedidos da organização ativa, do mais novo ao mais antigo.
 *
 * Leitura pela sessão da pessoa (RLS): `manager`+ lê os da própria
 * organização. Admin de plataforma lê (`allowPlatformAdmin: "leitura"`), como
 * na policy. Paginação keyset sobre (created_at DESC, id DESC).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "aios", allowPlatformAdmin: "leitura" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = listaDePedidosAiosQuery.safeParse(params);
  if (!parsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, { requestId, details: parsed.error.flatten() });
  }
  const { limit, cursor } = parsed.data;
  // O cursor é conferido ANTES de qualquer consulta: ele volta do navegador e
  // entra num filtro do PostgREST.
  const recorte = cursor ? decodificarCursorDePedidoAios(cursor) : null;
  if (cursor && !recorte) return fail("invalid_cursor", t("Cursor inválido."), 400, { requestId });

  const supabase = await createClient();
  let consulta = supabase
    .from(TABELA)
    .select(COLUNAS_DO_PEDIDO)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (recorte) {
    consulta = consulta.or(
      `created_at.lt.${recorte.created_at},and(created_at.eq.${recorte.created_at},id.lt.${recorte.id})`,
    );
  }

  const { data, error } = await consulta;
  if (error) {
    logger.error("[aios] a lista de pedidos não foi lida", {
      requestId,
      organizationId: orgId,
      erro: error.message,
    });
    return fail("internal_error", t("Não consegui carregar os pedidos. Tente de novo em instantes."), 500, {
      requestId,
    });
  }

  const linhas = (data ?? []) as unknown as PedidoAios[];
  const temMais = linhas.length > limit;
  const pagina = temMais ? linhas.slice(0, limit) : linhas;
  const ultima = pagina[pagina.length - 1];
  const proximo =
    temMais && ultima ? codificarCursorDePedidoAios({ created_at: ultima.created_at, id: ultima.id }) : null;

  return ok(pagina, { requestId, meta: { cursor: proximo, has_more: temMais } });
}
