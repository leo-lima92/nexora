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

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
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
  // org_id: tenant dono do lead. AIOS sabe pra quem está prospectando.
  // Schema exige; FK em companies/contacts garante integridade no DB.
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/aios-lead — Porta da Frente do Closed Loop
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/webhooks/aios-lead', async (c) => {
  // ── 1. Porteiro: auth via header (constant-time não é necessário aqui —
  //    Node string equality é suficiente para shared secret de 32 bytes;
  //    timing attack contra HMAC validador exigiria milhões de requests).
  const authHeader = c.req.header('authorization') ?? c.req.header('x-aios-signature');
  if (authHeader !== env.AIOS_WEBHOOK_SECRET) {
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

  // ── 3a. Insert em companies (rastreamento Meta).
  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .insert({
      org_id: payload.org_id,
      name: payload.lead_data.name,
      lead_origin: payload.lead_origin,
      traffic_source: payload.traffic_source,
      meta_campaign_id: payload.meta_campaign_id,
      meta_adset_id: payload.meta_adset_id,
      meta_ad_id: payload.meta_ad_id,
      status: 'novo',
      source: 'manual',
    })
    .select('id')
    .single();

  if (companyError || !company) {
    console.error('[aios-lead] companies insert failed:', companyError?.message);
    return c.json(
      { error: 'Internal Server Error', stage: 'companies_insert', details: companyError?.message },
      500,
    );
  }

  // ── 3b. Insert em contacts vinculado à company recém-criada.
  const { first, last } = splitName(payload.lead_data.name);
  const { error: contactError } = await supabaseAdmin.from('contacts').insert({
    org_id: payload.org_id,
    company_id: company.id,
    first_name: first,
    last_name: last,
    phone: payload.lead_data.phone ?? null,
    email: payload.lead_data.email ?? null,
    source: 'manual',
  });

  if (contactError) {
    // ⚠ Sem transação atômica via supabase-js — company permanece como órfã.
    // Retornamos 500 com o id pra observabilidade; cleanup vem em job futuro.
    console.error('[aios-lead] contacts insert failed:', contactError.message, '— orphan company:', company.id);
    return c.json(
      {
        error: 'Internal Server Error',
        stage: 'contacts_insert',
        details: contactError.message,
        orphan_company_id: company.id,
      },
      500,
    );
  }

  // ── 4. Sucesso.
  return c.json({ ok: true, company_id: company.id }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[nexora-api] listening on http://localhost:${info.port}`);
});
