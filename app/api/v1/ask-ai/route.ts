/**
 * POST /api/v1/ask-ai — FORK NEXORA: um turno do Copiloto (Ask AI).
 *
 * Quem chama é o painel `components/ask-ai/AskAI.tsx`, com a sessão por cookie.
 * O corpo é o histórico da conversa (a rota não guarda nada); a resposta é um
 * stream NDJSON de eventos — contrato em `lib/copiloto/eventos.ts`, que explica
 * por que o que vai em tempo real são as FERRAMENTAS e não os tokens.
 *
 * ─── Autorização ────────────────────────────────────────────────────────────
 *
 * `manager`+ na rota inteira, e não só na ferramenta de criar: o Copiloto é o
 * engenheiro de SETUP, e o que ele cria (funil) já exige `manager` na tela de
 * Funis. Decidir o papel por ferramenta obrigaria comparar `ROLE_RANK` à mão
 * dentro de `app/api` — o anti-pattern que `pnpm lint:role-rank` reprova,
 * porque o gate de MFA só existe dentro de `requireRole`.
 *
 * A organização sai de `requireRole` (JWT/cookie), nunca do body, e chega às
 * ferramentas já fechada (`lib/copiloto/ferramentas.ts`). O client do banco é
 * o da SESSÃO: a RLS vale em tudo que o modelo lê ou escreve.
 *
 * ─── Erros: antes do stream é JSON, depois é evento ─────────────────────────
 *
 * Tudo que dá para recusar sem chamar o modelo (sessão, papel, suporte, corpo,
 * limite de ritmo, banco fora) sai pelo `fail()` de sempre, com status HTTP. Uma
 * vez aberto o stream o status já foi 200, então a falha do modelo vira evento
 * `erro` com a frase acionável — e o stream fecha sempre com `fim`.
 *
 * ─── Auditoria ──────────────────────────────────────────────────────────────
 *
 * Um `ai.copiloto_turn` por turno, SEM o texto da conversa: `api_audit_log` é
 * append-only e fica fora da cascata de LGPD. Vai o que permite reconstituir o
 * que aconteceu: a linha de custo (`llm_call_id`), as ferramentas e os funis
 * criados — e cada funil criado tem ainda o seu próprio `pipeline.created`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { linhaDoEvento, TIPO_DO_STREAM, type EventoDoCopiloto } from "@/lib/copiloto/eventos";
import { falhaDoTurno, rodarTurnoDoCopiloto, type ResultadoDoTurno } from "@/lib/copiloto/turno";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Teto por PESSOA. Cada pergunta é uma chamada paga ao provedor. */
const TETO_POR_USUARIO = 10;
/** Teto por ORGANIZAÇÃO: "10 por pessoa" com 10 gestores seria 100/min na chave dela. */
const TETO_POR_ORGANIZACAO = 40;
const JANELA_SEGUNDOS = 60;

/** Uma fala. 4000 é limite de CUSTO: cabe um prompt de SDR colado para revisão. */
const TEXTO_MAX = 4000;
/** Soma do histórico que o servidor aceita — a tela não é confiável para limitar o que se paga. */
const HISTORICO_CARACTERES_MAX = 40_000;

const corpoDoPost = z
  .object({
    mensagens: z
      .array(
        z
          .object({
            papel: z.enum(["pessoa", "copiloto"]),
            texto: z.string().trim().min(1).max(TEXTO_MAX),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict()
  .refine((c) => c.mensagens[c.mensagens.length - 1]?.papel === "pessoa", {
    message: "a última mensagem é a pergunta da pessoa",
  })
  .refine((c) => c.mensagens.reduce((n, m) => n + m.texto.length, 0) <= HISTORICO_CARACTERES_MAX, {
    message: "conversa longa demais",
  });

/** O modelo encerrou o laço sem texto (acontece no teto de passos). A tela não pode ficar muda. */
const RESPOSTA_SEM_TEXTO = "Pronto. Se quiser, eu explico o que fiz ou seguimos para o próximo passo.";

export async function POST(req: NextRequest): Promise<Response> {
  // PRIMEIRO passo: sem a guarda de suporte, um admin de plataforma em
  // acompanhamento somente-leitura gastaria o orçamento de IA do cliente e
  // criaria funil na organização dele.
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "copiloto" });
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
    return fail("validation_failed", t("Não entendi a mensagem enviada ao Copiloto."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const porUsuario = await checkRateLimit(`copiloto:${userId}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  const porOrganizacao = await checkRateLimit(`copiloto-org:${orgId}`, TETO_POR_ORGANIZACAO, JANELA_SEGUNDOS);
  if (!porUsuario.allowed || !porOrganizacao.allowed) {
    return fail("rate_limited", t("Muitas perguntas seguidas. Tente em um minuto."), 429, {
      requestId,
      headers: {
        "Retry-After": String(JANELA_SEGUNDOS),
        "X-RateLimit-Limit": String(porUsuario.limit),
        "X-RateLimit-Remaining": String(Math.max(0, porUsuario.limit - porUsuario.count)),
      },
    });
  }

  let pool;
  try {
    pool = getRequestPool();
  } catch {
    return fail("unavailable", t("O Copiloto está indisponível nesta instalação (configuração)."), 503, {
      requestId,
    });
  }

  const supabase = await createClient();
  const deps = requestTurnDeps();
  const historico = parsed.data.mensagens;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const codificador = new TextEncoder();
      let aberto = true;
      const emitir = (evento: EventoDoCopiloto) => {
        if (!aberto) return;
        try {
          controller.enqueue(codificador.encode(linhaDoEvento(evento)));
        } catch {
          // A pessoa fechou o painel: o stream morreu, o turno segue até o fim
          // (a escrita no banco não pode ficar pela metade).
          aberto = false;
        }
      };

      emitir({ tipo: "inicio", request_id: requestId });

      let resultado: ResultadoDoTurno | null = null;
      let codigoDeErro: string | null = null;
      try {
        resultado = await rodarTurnoDoCopiloto(
          {
            supabase,
            organizationId: orgId,
            actorUserId: userId,
            requestId,
            emitir,
            pool,
            llmCfg: deps.llmCfg,
            registry: deps.registry,
            log: deps.log,
          },
          historico,
        );
        emitir({ tipo: "resposta", texto: resultado.texto || t(RESPOSTA_SEM_TEXTO) });
      } catch (erro) {
        const falha = falhaDoTurno(erro);
        codigoDeErro = falha.codigo;
        // Os erros de configuração acontecem ANTES do seam e não geram linha em
        // `llm_calls`: sem este log, a única pista viveria no painel.
        logger.error("[copiloto] o turno não respondeu", {
          requestId,
          organizationId: orgId,
          motivo: falha.codigo,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
        emitir({ tipo: "erro", codigo: falha.codigo, mensagem: t(falha.mensagem) });
      }

      void audit({
        action: "ai.copiloto_turn",
        actorUserId: userId,
        organizationId: orgId,
        resourceType: "copiloto",
        resourceId: null,
        requestId,
        metadata: {
          llm_call_id: resultado?.callId ?? null,
          ferramentas: resultado?.ferramentas ?? [],
          funis_criados: resultado?.funisCriados ?? [],
          mensagens: historico.length,
          respondeu: codigoDeErro === null,
          error_code: codigoDeErro,
        },
      });

      emitir({ tipo: "fim" });
      if (aberto) controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": TIPO_DO_STREAM,
      "Cache-Control": "no-store",
      // Caddy/nginx seguram resposta em buffer por padrão; sem isto o "pensando"
      // da tela não vê nenhum evento até o fim.
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}
