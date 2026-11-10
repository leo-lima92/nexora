/**
 * POST /api/v1/aios-dispatch — FORK NEXORA: entrega um pedido ao motor de
 * tráfego (AIOS, Python, fora do CRM).
 *
 * Quem chama é a tela `/app/aios` (o Estrategista de Tráfego), com a sessão por
 * cookie. A rota não gera campanha nenhuma e não guarda a conversa: confere
 * quem pede, monta o corpo e chama o motor (`lib/aios/despacho.ts`). O
 * resultado da campanha não volta por aqui — o motor grava no Supabase.
 *
 * ─── Autorização ────────────────────────────────────────────────────────────
 *
 * `manager`+, a mesma régua da tela e a que Meta Ads tinha no upstream: um
 * pedido aqui vira campanha paga com o orçamento de mídia da empresa inteira,
 * e não há recorte por pessoa.
 *
 * `org_id` e `user_id` saem de `requireRole` (JWT/cookie), NUNCA do corpo. O
 * corpo é estrito e só aceita `prompt`: `org_id` vindo do navegador é recusado
 * com 422, em vez de ignorado, para o erro de quem integra aparecer na hora.
 *
 * ─── Status: o que cada um promete ──────────────────────────────────────────
 *
 *   200  o motor confirmou que recebeu
 *   502  o motor recusou, ou não deu para falar com ele — o pedido NÃO foi aceito
 *   503  `AIOS_PYTHON_URL` está preenchida com algo que não é endereço
 *   504  o motor não confirmou no prazo — o pedido PODE ter chegado
 *
 * 502 e 504 são diferentes de propósito: só no 504 reenviar pode gerar a mesma
 * campanha duas vezes, e a frase diz isso à pessoa.
 *
 * ─── Auditoria ──────────────────────────────────────────────────────────────
 *
 * `aios.campaign_dispatched` quando o pedido saiu do CRM com efeito possível:
 * confirmado (200) ou sem confirmação (504). Sem o texto do pedido — o que
 * entra em `api_audit_log` não sai pela cascata de LGPD.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ACAO_GERAR_CAMPANHA, despacharParaOAios } from "@/lib/aios/despacho";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Teto por PESSOA. Cada pedido põe o motor para trabalhar numa campanha. */
const TETO_POR_USUARIO = 6;
/** Teto por ORGANIZAÇÃO, para "6 por pessoa" não virar 60 com dez gestores. */
const TETO_POR_ORGANIZACAO = 20;
const JANELA_SEGUNDOS = 60;

/** O mesmo teto do campo da tela. O servidor não confia na tela para limitar. */
const PROMPT_MAX = 4000;

const corpoDoPost = z.object({ prompt: z.string().trim().min(1).max(PROMPT_MAX) }).strict();

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
  const parsed = corpoDoPost.safeParse(bruto);
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
  const resultado = await despacharParaOAios({ orgId, userId, prompt, requestId });

  const auditar = (confirmado: boolean, jobId: string | null, statusDoMotor: number | null) =>
    void audit({
      action: "aios.campaign_dispatched",
      actorUserId: userId,
      organizationId: orgId,
      resourceType: "aios_dispatch",
      resourceId: null,
      requestId,
      metadata: {
        acao: ACAO_GERAR_CAMPANHA,
        confirmado,
        job_id: jobId,
        engine_status: statusDoMotor,
        prompt_chars: prompt.length,
      },
    });

  if (resultado.ok) {
    auditar(true, resultado.jobId, resultado.status);
    return ok(
      {
        status: "dispatched" as const,
        action: ACAO_GERAR_CAMPANHA,
        job_id: resultado.jobId,
        message: resultado.mensagem,
      },
      { requestId },
    );
  }

  // O texto do pedido não entra no log, só o tamanho — mesmo critério do audit.
  logger.error("[aios] o despacho não foi confirmado", {
    requestId,
    organizationId: orgId,
    motivo: resultado.motivo,
    engine_status: resultado.status,
  });

  if (resultado.motivo === "prazo") {
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
  if (resultado.motivo === "configuracao") {
    return fail(
      "unavailable",
      t("O endereço do motor de tráfego está mal configurado nesta instalação. Avise quem instalou o sistema."),
      503,
      { requestId },
    );
  }
  if (resultado.motivo === "recusado") {
    return fail(
      "upstream_unavailable",
      t("O motor de tráfego recusou o pedido. Tente de novo; se continuar, avise quem instalou o sistema."),
      502,
      { requestId, details: { engine_status: resultado.status } },
    );
  }
  return fail(
    "upstream_unavailable",
    t("Não consegui falar com o motor de tráfego. Tente de novo em instantes; se continuar, avise quem instalou o sistema."),
    502,
    { requestId },
  );
}
