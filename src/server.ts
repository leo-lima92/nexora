/**
 * Nexora HTTP Server — Hono + @hono/node-server
 *
 * Comando 2 — Ponte de Dados (Closed Loop)
 *
 * Primeiro endpoint: POST /api/webhooks/aios-lead
 *   Recebe leads do agente AIOS Python (Tráfego Pago) e injeta em
 *   companies + contacts via supabaseAdmin (bypass RLS, server-only).
 *
 * Como rodar (dev):
 *   npm run dev
 *
 * Como rodar (prod, após build):
 *   npm run build && node dist/server.js
 */

import * as crypto from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { z } from 'zod';

import { env } from './lib/env.js';
import { supabaseAdmin } from './lib/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono();

// Healthcheck — útil pra readiness probe e teste de smoke.
app.get('/health', (c) => c.json({ status: 'ok', service: 'nexora-api' }));

// ─────────────────────────────────────────────────────────────────────────────
// Schema — payload do AIOS Python
// SECURITY_POLICIES.md §2: validação de schema obrigatória na borda.
// ─────────────────────────────────────────────────────────────────────────────

const aiosLeadSchema = z.object({
  // org_id: AFIRMAÇÃO do chamador sobre o tenant, não a decisão sobre ele.
  // Continua obrigatório (o AIOS já o envia, e conferi-lo pega configuração
  // errada cedo), mas quem manda é `env.AIOS_WEBHOOK_ORG_ID`: divergência vira
  // 403 no handler. Ver o porteiro do tenant em POST /api/webhooks/aios-lead.
  org_id: z.string().uuid('org_id deve ser um UUID válido'),

  // Rastreamento Meta Ads — todos opcionais EXCETO os que o user listou
  // como obrigatórios (traffic_source + IDs Meta). lead_origin tem default.
  lead_origin: z.string().min(1).default('inbound'),
  traffic_source: z.string().min(1, 'traffic_source é obrigatório'),
  meta_campaign_id: z.string().min(1, 'meta_campaign_id é obrigatório'),
  meta_adset_id: z.string().min(1, 'meta_adset_id é obrigatório'),
  meta_ad_id: z.string().min(1, 'meta_ad_id é obrigatório'),

  // Dados do contato — name obrigatório, restante opcional/nullable.
  lead_data: z.object({
    name: z.string().min(1, 'lead_data.name é obrigatório'),
    phone: z.string().nullish(),
    email: z.email('email inválido').nullish(),
  }),
});

type AiosLeadPayload = z.infer<typeof aiosLeadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splita "Maria da Silva" em { first: "Maria", last: "da Silva" }.
 * Nome simples → last = null. Trim aplicado para tolerar input sujo.
 */
function splitName(full: string): { first: string; last: string | null } {
  const trimmed = full.trim();
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { first: trimmed, last: null };
  return {
    first: trimmed.slice(0, idx),
    last: trimmed.slice(idx + 1).trim() || null,
  };
}

/**
 * Comparação constant-time de tokens (shared secret).
 *
 * Hasheia ambos os lados com SHA-256 antes de chamar `timingSafeEqual` por dois motivos:
 *   1. Garante buffers de mesmo tamanho (32 bytes) — `timingSafeEqual` exige isso e
 *      lançar quando lengths divergem vazaria informação por timing.
 *   2. Mesmo tokens de tamanhos diferentes geram digests do mesmo tamanho — eliminando
 *      o canal lateral de length que um early-return ingênuo abriria.
 *
 * Retorna `false` para input vazio/ausente sem chegar à comparação criptográfica.
 */
function safeTokenEqual(input: string | undefined | null, secret: string): boolean {
  if (typeof input !== 'string' || input.length === 0) return false;
  const inputDigest = crypto.createHash('sha256').update(input).digest();
  const secretDigest = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(inputDigest, secretDigest);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limit — fixed window, in-memory, escopo: GET /api/outbound/conversions
//
// Proteção contra abuso/loop infinito do consumidor (AIOS Python pulla a cada
// 15min em operação normal; pico tolerável << 100 req/15min). In-memory cabe
// para single-instance Hono atual; ao escalar p/ múltiplas instâncias trocar
// por Redis/Upstash com mesma chave/janela.
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_GC_THRESHOLD = 5000;

type RateBucket = { count: number; resetAt: number };

const conversionsRateBuckets = new Map<string, RateBucket>();

/**
 * Chave de bucket: prefere IP do `x-forwarded-for` (definido pelo proxy upstream
 * — Vercel/Cloudflare — e não falsificável pelo cliente quando o proxy está
 * corretamente configurado). Fallback: hash truncado do token (16 hex chars
 * são suficientes para particionar consumidores sem logar o secret bruto).
 * Último recurso: bucket único `anon` — atende request sem proxy nem auth e
 * mantém o limite ativo mesmo no pior cenário.
 */
function rateLimitKey(c: Context): string {
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return `ip:${xff}`;

  const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (auth) {
    const tokenHash = crypto.createHash('sha256').update(auth).digest('hex').slice(0, 16);
    return `tok:${tokenHash}`;
  }

  return 'anon';
}

/** Limpa buckets já expirados quando o Map cresce demais — evita leak em pico de IPs únicos. */
function gcExpiredBuckets(now: number): void {
  if (conversionsRateBuckets.size < RATE_LIMIT_GC_THRESHOLD) return;
  for (const [key, bucket] of conversionsRateBuckets) {
    if (bucket.resetAt <= now) conversionsRateBuckets.delete(key);
  }
}

async function conversionsRateLimit(c: Context, next: Next): Promise<Response | void> {
  const now = Date.now();
  gcExpiredBuckets(now);

  const key = rateLimitKey(c);
  const bucket = conversionsRateBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    conversionsRateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    await next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    c.header('Retry-After', String(retryAfter));
    console.warn(`[outbound-conversions] rate limit hit — key=${key} retry_after=${retryAfter}s`);
    return c.json(
      { error: 'Too Many Requests', retry_after_seconds: retryAfter },
      429,
    );
  }

  await next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/aios-lead — Porta da Frente do Closed Loop
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/webhooks/aios-lead', async (c) => {
  // ── 1. Porteiro: auth via header com comparação constant-time (timingSafeEqual
  //    sobre digests SHA-256). Aceita formato OAuth2 ("Bearer <token>") ou token cru
  //    — strip do prefixo antes da comparação para interop com clientes padrão
  //    (AIOS Python usa Bearer).
  const rawAuth = c.req.header('authorization') ?? c.req.header('x-aios-signature');
  const token = rawAuth?.replace(/^Bearer\s+/i, '');
  if (!safeTokenEqual(token, env.AIOS_WEBHOOK_SECRET)) {
    console.warn('[aios-lead] auth fail — header missing or mismatch');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // ── 2. Parse + validação Zod do body.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Bad Request', details: 'body must be valid JSON' }, 400);
  }

  const parsed = aiosLeadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Bad Request',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }

  const payload: AiosLeadPayload = parsed.data;

  // ── 2b. PORTEIRO DO TENANT ────────────────────────────────────────────────
  // O passo 1 provou que "o AIOS falou". Não provou "o AIOS falou POR ESTA
  // organização" — `AIOS_WEBHOOK_SECRET` é um segredo único e global, não um
  // por tenant. Enquanto o `org_id` do corpo era usado direto, qualquer
  // portador do segredo escrevia em QUALQUER organização trocando um UUID no
  // JSON, e o `supabaseAdmin` abaixo é service_role — ele BYPASSA a RLS, então
  // o banco não tinha como recusar. Anti-pattern nº 10 do CLAUDE.md.
  //
  // O que vai para a RPC é `env.AIOS_WEBHOOK_ORG_ID`, nunca o corpo. O
  // `org_id` recebido é tratado como AFIRMAÇÃO a conferir: divergir é 403, não
  // reescrita silenciosa. Falhar alto importa — um AIOS mal configurado
  // apontando para o tenant errado precisa aparecer como erro na integração,
  // não como leads sumindo na organização de outra pessoa.
  if (payload.org_id !== env.AIOS_WEBHOOK_ORG_ID) {
    console.warn('[aios-lead] org_id do corpo diverge do tenant desta instância — recusado');
    return c.json(
      {
        error: 'Forbidden',
        details: 'org_id does not match the organization bound to this instance',
      },
      403,
    );
  }

  // ── 3. Persistência atômica via RPC `rpc_upsert_lead` ──────────────────
  // A RPC envelopa os 2 inserts (companies + contacts) numa transação PL/pgSQL.
  // Falha em qualquer ponto faz ROLLBACK total — sem órfãos.
  //
  // Fonte da função: supabase/migrations/20260813180000_0145_convergencia_contacts_e_extracao.sql
  // (a 0145 dropa e recria). As migrations AIOS 20260509185804/20260509190753,
  // que este comentário citava, escreviam num shape de `contacts` que não
  // existe mais — quem for depurar por ali lê a versão errada da verdade.
  //
  // p_last_name/p_phone/p_email são opcionais na função SQL (DEFAULT NULL) —
  // omitir a propriedade aqui faz o PG aplicar NULL no valor.
  const { first, last } = splitName(payload.lead_data.name);
  const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc('rpc_upsert_lead', {
    p_org_id: env.AIOS_WEBHOOK_ORG_ID,
    p_name: payload.lead_data.name,
    p_lead_origin: payload.lead_origin,
    p_traffic_source: payload.traffic_source,
    p_meta_campaign_id: payload.meta_campaign_id,
    p_meta_adset_id: payload.meta_adset_id,
    p_meta_ad_id: payload.meta_ad_id,
    p_first_name: first,
    ...(last !== null ? { p_last_name: last } : {}),
    ...(payload.lead_data.phone ? { p_phone: payload.lead_data.phone } : {}),
    ...(payload.lead_data.email ? { p_email: payload.lead_data.email } : {}),
  });

  if (rpcError) {
    console.error('[aios-lead] rpc_upsert_lead failed:', rpcError.message);
    return c.json(
      { error: 'Internal Server Error', stage: 'rpc_upsert_lead', details: rpcError.message },
      500,
    );
  }

  const row = rpcRows?.[0];
  if (!row) {
    console.error('[aios-lead] rpc_upsert_lead returned empty result');
    return c.json(
      { error: 'Internal Server Error', stage: 'rpc_upsert_lead', details: 'empty result' },
      500,
    );
  }

  // ── 4. Sucesso. Contrato HTTP preservado: { ok, company_id }.
  return c.json({ ok: true, company_id: row.company_id }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/outbound/conversions — Torneira de Dados (CAPI Feedback Loop)
//
// Comando 3 — Closed Loop / Outbound. AIOS Python pulla este endpoint em
// cadência configurada (15min default) e envia eventos Purchase para a
// Conversions API do Meta. Endpoint READ-ONLY e idempotente — cursor (`since`)
// é gerenciado pelo consumidor (AIOS); Nexora NÃO mantém estado de sync.
//
// Bounded context: credenciais Meta (CAPI token, Pixel ID) ficam só no AIOS.
// Aqui validamos só o `AIOS_PULL_TOKEN` que autoriza o pull.
// ─────────────────────────────────────────────────────────────────────────────

const conversionsQuerySchema = z.object({
  org_id: z.string().uuid('org_id deve ser um UUID válido'),
  since: z.iso.datetime({
    offset: true,
    message: 'since deve ser ISO 8601 com offset (ex: 2026-05-01T00:00:00Z)',
  }),
  // limit: query string sempre chega como string. coerce → number, default 100,
  // max 500 para não permitir um pull abusivo de página única.
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(500, 'limit máximo é 500')
    .default(100),
});

app.get('/api/outbound/conversions', conversionsRateLimit, async (c) => {
  // ── 1. Auth: header Authorization deve igualar AIOS_PULL_TOKEN, comparado em
  //    constant-time (timingSafeEqual sobre digests SHA-256). Aceita "Bearer <token>"
  //    ou token cru — strip do prefixo antes da comparação para interop.
  const rawAuth = c.req.header('authorization');
  const token = rawAuth?.replace(/^Bearer\s+/i, '');
  if (!safeTokenEqual(token, env.AIOS_PULL_TOKEN)) {
    console.warn('[outbound-conversions] auth fail — header missing or mismatch');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // ── 2. Validação Zod dos query params.
  const parsed = conversionsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Bad Request',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }

  const { org_id, since, limit } = parsed.data;

  // ── 2b. Porteiro do tenant (mesma razão do webhook, do lado da LEITURA).
  //    `AIOS_PULL_TOKEN` também é global: sozinho ele autorizaria ler as
  //    vendas fechadas de qualquer organização. Aqui o vazamento seria de
  //    dado comercial de terceiros — pior que a escrita, porque é silencioso:
  //    ninguém percebe que foi lido.
  if (org_id !== env.AIOS_WEBHOOK_ORG_ID) {
    console.warn('[outbound-conversions] org_id divergente do tenant desta instância — recusado');
    return c.json(
      {
        error: 'Forbidden',
        details: 'org_id does not match the organization bound to this instance',
      },
      403,
    );
  }

  // ── 3. Query: companies fechadas (status='venda_fechada') desde o cursor,
  //    ordenadas por updated_at ASC para o AIOS avançar o cursor sem pular
  //    registros. O filtro usa a env (fonte confiável), não o parâmetro.
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, deal_value, meta_campaign_id, meta_adset_id, meta_ad_id, updated_at')
    .eq('org_id', env.AIOS_WEBHOOK_ORG_ID)
    .eq('status', 'venda_fechada')
    .gte('updated_at', since)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[outbound-conversions] query failed:', error.message);
    return c.json(
      { error: 'Internal Server Error', details: error.message },
      500,
    );
  }

  const items = data ?? [];
  return c.json({ items, count: items.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[nexora-api] listening on http://localhost:${info.port}`);
});
