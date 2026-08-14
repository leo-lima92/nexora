/**
 * Smoke Test E2E — POST /api/webhooks/aios-lead
 * Comando 2 — Ponte de Dados (Closed Loop) — validação pré-deploy.
 *
 * Pré-requisitos:
 *   1. `.env` preenchido com todas as chaves do cofre Zod.
 *   2. Servidor Hono rodando: `npm run dev` (na porta env.PORT, default 3000).
 *
 * Como rodar:
 *   npx tsx --env-file=.env src/executions/test-aios-lead-webhook.ts
 *
 * O que valida:
 *   1. Resolve um org_id existente no Supabase (reaproveita pattern dos testes).
 *   2. Dispara POST com auth + payload válido.
 *   3. Confirma 201 + company_id no body.
 *   4. Lê company + contact do DB e prova que os 7 campos Closed Loop estão lá.
 *   5. Cleanup (delete contact + company) — não deixa lixo em prod.
 */

import { env } from '../lib/env.js';
import { supabaseAdmin } from '../lib/supabase.js';

const HR = '─'.repeat(70);
const log = (tag: string, msg: string): void => console.log(`[${tag}] ${msg}`);

/** Espelha `public.fn_e164_or_null()` (migration 0145) — ver google-maps-mapper. */
function toE164(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim().startsWith('+')) return null;
  const candidate = `+${raw.replace(/\D/g, '')}`;
  return /^\+\d{8,15}$/.test(candidate) ? candidate : null;
}

async function resolveOrgId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .limit(1);
  if (error) throw new Error(`[resolveOrgId] ${error.message}`);
  if (!data || data.length === 0 || !data[0]) {
    throw new Error('[resolveOrgId] no organizations found — crie uma antes de rodar o smoke');
  }
  log('org', `reusando org id=${data[0].id} slug=${data[0].slug}`);
  return data[0].id;
}

async function main(): Promise<void> {
  console.log(HR);
  console.log('AIOS Lead Webhook — Smoke Test E2E');
  console.log(HR);

  const orgId = await resolveOrgId();
  const url = `http://localhost:${env.PORT}/api/webhooks/aios-lead`;

  // Marker único pra identificar a row deste teste no DB.
  const marker = `SMOKE-${Date.now()}`;

  const payload = {
    org_id: orgId,
    lead_origin: 'inbound',
    traffic_source: 'meta_ads',
    meta_campaign_id: `${marker}-CAMPAIGN`,
    meta_adset_id: `${marker}-ADSET`,
    meta_ad_id: `${marker}-AD`,
    lead_data: {
      name: 'João Teste da Silva',
      phone: '+5511999998888',
      email: `joao.smoke+${Date.now()}@nexora.test`,
    },
  };

  // ── 1. POST autenticado ─────────────────────────────────────────────────
  log('http', `POST ${url}`);
  const start = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: env.AIOS_WEBHOOK_SECRET,
    },
    body: JSON.stringify(payload),
  });
  const durationMs = Date.now() - start;

  const responseBody = (await response.json()) as Record<string, unknown>;
  log('http', `status=${response.status} duration=${durationMs}ms`);
  log('http', `body=${JSON.stringify(responseBody)}`);

  if (response.status !== 201) {
    throw new Error(`[smoke] expected 201, got ${response.status}`);
  }
  const companyId = responseBody['company_id'];
  if (typeof companyId !== 'string') {
    throw new Error(`[smoke] response missing company_id: ${JSON.stringify(responseBody)}`);
  }

  // ── 2. Verificação no DB ────────────────────────────────────────────────
  console.log(HR);
  log('db', `lendo companies/id=${companyId}`);

  const { data: company, error: companyErr } = await supabaseAdmin
    .from('companies')
    .select(
      'id, org_id, name, lead_origin, traffic_source, meta_campaign_id, meta_adset_id, meta_ad_id, status, source',
    )
    .eq('id', companyId)
    .single();

  if (companyErr || !company) {
    throw new Error(`[smoke] company not found: ${companyErr?.message}`);
  }
  log('db', `company: ${JSON.stringify(company, null, 2)}`);

  const { data: contacts, error: contactsErr } = await supabaseAdmin
    .from('contacts')
    .select('id, organization_id, company_id, name, phone_number, email, source')
    .eq('company_id', companyId);

  if (contactsErr) throw new Error(`[smoke] contacts query failed: ${contactsErr.message}`);
  if (!contacts || contacts.length === 0) {
    throw new Error(`[smoke] no contact linked to company ${companyId}`);
  }
  log('db', `contacts (${contacts.length}): ${JSON.stringify(contacts, null, 2)}`);

  // ── 3. Asserções ────────────────────────────────────────────────────────
  console.log(HR);
  const checks: Array<[string, boolean]> = [
    ['company.org_id matches', company.org_id === orgId],
    ['lead_origin=inbound', company.lead_origin === 'inbound'],
    ['traffic_source=meta_ads', company.traffic_source === 'meta_ads'],
    ['meta_campaign_id matches', company.meta_campaign_id === payload.meta_campaign_id],
    ['meta_adset_id matches', company.meta_adset_id === payload.meta_adset_id],
    ['meta_ad_id matches', company.meta_ad_id === payload.meta_ad_id],
    ['status=novo (default)', company.status === 'novo'],
    ['contact.company_id matches', contacts[0]?.company_id === companyId],
    // A 0145 fundiu first_name+last_name na coluna canônica `name` do chassi.
    ['contact.name=João Teste da Silva', contacts[0]?.name === 'João Teste da Silva'],
    // phone_number é E.164 normalizado por fn_e164_or_null — comparar com o
    // payload cru só vale se o payload já vier internacional.
    ['contact.phone_number normalizado', contacts[0]?.phone_number === toE164(payload.lead_data.phone)],
    ['contact.email matches', contacts[0]?.email === payload.lead_data.email],
  ];

  let pass = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) pass = false;
  }

  // ── 4. Cleanup — não deixa lixo em prod ─────────────────────────────────
  console.log(HR);
  log('cleanup', `deletando ${contacts.length} contact(s) + 1 company`);
  await supabaseAdmin.from('contacts').delete().eq('company_id', companyId);
  await supabaseAdmin.from('companies').delete().eq('id', companyId);
  log('cleanup', 'OK');

  console.log(HR);
  if (pass) {
    console.log('✓ SMOKE TEST PASSED');
    process.exit(0);
  } else {
    console.error('✗ SMOKE TEST FAILED — alguma asserção falhou (ver acima)');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
