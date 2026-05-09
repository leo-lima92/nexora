/**
 * Smoke Test E2E — GET /api/outbound/conversions
 * Comando 3 — Torneira de Dados (CAPI Feedback Loop) — autossuficiência do time Nexora.
 *
 * Pré-requisitos:
 *   1. `.env` preenchido com todas as chaves do cofre Zod (incl. AIOS_PULL_TOKEN).
 *   2. Servidor Hono rodando: `npm run dev` (na porta env.PORT, default 3000).
 *
 * Como rodar:
 *   npx tsx --env-file=.env src/executions/test-outbound-conversions.ts
 *
 * Cenários cobertos:
 *   1. 401 Unauthorized — request sem header Authorization.
 *   2. 401 Unauthorized — token errado.
 *   3. 400 Bad Request — `since` inválido (string não-ISO, ex: "ontem").
 *   4. 200 OK — token válido + params válidos. Valida schema { items: Array, count: number }.
 *   5. (Bonus) 429 Too Many Requests — 101 requests sequenciais num bucket isolado
 *      (header x-forwarded-for=198.51.100.42, faixa RFC 5737 TEST-NET-2). Os primeiros
 *      100 devem retornar 200, o 101º retorna 429 com header Retry-After.
 *
 * Por que NÃO hardcodar o token: SECURITY_POLICIES.md §3 — todo acesso a credenciais
 * é mediado pelo cofre Zod em src/lib/env.ts. O AIOS_PULL_TOKEN de produção está no .env
 * (rotacionado e validado em handshake AIOS Python).
 */

import { env } from '../lib/env.js';
import { supabaseAdmin } from '../lib/supabase.js';

const HR = '─'.repeat(70);
const log = (tag: string, msg: string): void => console.log(`[${tag}] ${msg}`);

const BASE_URL = `http://localhost:${env.PORT}/api/outbound/conversions`;

// IP fixo da faixa TEST-NET-2 (RFC 5737) — reservada para documentação/testes,
// nunca roteada na internet. Usar como x-forwarded-for isola o cenário 5 num
// bucket de rate limit dedicado, sem contaminar os cenários 1-4.
const RATE_LIMIT_TEST_IP = '198.51.100.42';

// ─────────────────────────────────────────────────────────────────────────────
// Harness — cada cenário é uma função async que joga true/false na lista.
// Mantém execução atômica: uma falha não interrompe os demais cenários,
// mas o relatório final reporta exit code != 0.
// ─────────────────────────────────────────────────────────────────────────────

type CheckResult = { label: string; ok: boolean; detail?: string };
const results: CheckResult[] = [];

function record(label: string, ok: boolean, detail?: string): void {
  const entry: CheckResult = detail !== undefined ? { label, ok, detail } : { label, ok };
  results.push(entry);
  const icon = ok ? '✓' : '✗';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${icon} ${label}${suffix}`);
}

async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers } | { error: string }> {
  try {
    const response = await fetch(url, init);
    let body: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }
    return { status: response.status, body, headers: response.headers };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve um org_id real do Supabase pra montar query válida no cenário 4.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Cenários
// ─────────────────────────────────────────────────────────────────────────────

async function scenarioMissingAuth(): Promise<void> {
  console.log(HR);
  log('S1', 'GET sem header Authorization → esperar 401');
  const url = `${BASE_URL}?org_id=00000000-0000-0000-0000-000000000000&since=2024-01-01T00:00:00Z`;
  const res = await safeFetch(url);

  if ('error' in res) {
    record('S1: request executada sem erro de transporte', false, res.error);
    return;
  }
  record('S1: status === 401', res.status === 401, `recebido ${res.status}`);
  const bodyHasError =
    typeof res.body === 'object' && res.body !== null && 'error' in (res.body as Record<string, unknown>);
  record('S1: body contém { error }', bodyHasError);
}

async function scenarioWrongToken(): Promise<void> {
  console.log(HR);
  log('S2', 'GET com token errado → esperar 401');
  const url = `${BASE_URL}?org_id=00000000-0000-0000-0000-000000000000&since=2024-01-01T00:00:00Z`;
  const res = await safeFetch(url, {
    headers: { Authorization: 'Bearer este-token-nao-vale-nada-12345' },
  });

  if ('error' in res) {
    record('S2: request executada sem erro de transporte', false, res.error);
    return;
  }
  record('S2: status === 401', res.status === 401, `recebido ${res.status}`);
}

async function scenarioInvalidSince(orgId: string): Promise<void> {
  console.log(HR);
  log('S3', 'GET com token válido + since="ontem" → esperar 400');
  const url = `${BASE_URL}?org_id=${encodeURIComponent(orgId)}&since=ontem`;
  const res = await safeFetch(url, {
    headers: { Authorization: `Bearer ${env.AIOS_PULL_TOKEN}` },
  });

  if ('error' in res) {
    record('S3: request executada sem erro de transporte', false, res.error);
    return;
  }
  record('S3: status === 400', res.status === 400, `recebido ${res.status}`);

  // Confirma que o erro veio da validação Zod do `since` (e não de outro campo).
  const body = res.body as { details?: Array<{ path?: string }> } | null;
  const sinceFlagged =
    Array.isArray(body?.details) &&
    body.details.some((d) => d?.path === 'since');
  record('S3: detalhes apontam para campo `since`', sinceFlagged);
}

async function scenarioHappyPath(orgId: string): Promise<void> {
  console.log(HR);
  log('S4', 'GET com token válido + params válidos → esperar 200');
  const url = `${BASE_URL}?org_id=${encodeURIComponent(orgId)}&since=2020-01-01T00:00:00Z&limit=10`;
  const res = await safeFetch(url, {
    headers: { Authorization: `Bearer ${env.AIOS_PULL_TOKEN}` },
  });

  if ('error' in res) {
    record('S4: request executada sem erro de transporte', false, res.error);
    return;
  }
  record('S4: status === 200', res.status === 200, `recebido ${res.status}`);

  const body = res.body as { items?: unknown; count?: unknown } | null;
  const itemsIsArray = Array.isArray(body?.items);
  const countIsNumber = typeof body?.count === 'number';
  record('S4: body.items é Array', itemsIsArray);
  record('S4: body.count é number', countIsNumber);

  if (itemsIsArray && countIsNumber) {
    const items = body.items as unknown[];
    record(
      'S4: count === items.length (consistência)',
      items.length === body.count,
      `count=${String(body.count)} items.length=${items.length}`,
    );
  }
}

async function scenarioRateLimit(orgId: string): Promise<void> {
  console.log(HR);
  log('S5', `Bonus: 101 requests sequenciais com x-forwarded-for=${RATE_LIMIT_TEST_IP}`);
  log('S5', '       (bucket isolado — primeiros 100 = 200, 101º = 429)');

  const url = `${BASE_URL}?org_id=${encodeURIComponent(orgId)}&since=2020-01-01T00:00:00Z&limit=1`;
  const headers = {
    Authorization: `Bearer ${env.AIOS_PULL_TOKEN}`,
    'x-forwarded-for': RATE_LIMIT_TEST_IP,
  };

  let count200 = 0;
  let count429 = 0;
  let countOther = 0;
  let firstNon200At: number | null = null;
  let lastStatus = 0;
  let retryAfterHeader: string | null = null;

  const start = Date.now();
  for (let i = 1; i <= 101; i += 1) {
    const res = await safeFetch(url, { headers });
    if ('error' in res) {
      record('S5: request executada sem erro de transporte', false, `req#${i} ${res.error}`);
      return;
    }
    lastStatus = res.status;
    if (res.status === 200) count200 += 1;
    else if (res.status === 429) {
      count429 += 1;
      if (firstNon200At === null) firstNon200At = i;
      if (retryAfterHeader === null) retryAfterHeader = res.headers.get('retry-after');
    } else {
      countOther += 1;
      if (firstNon200At === null) firstNon200At = i;
    }
  }
  const durationMs = Date.now() - start;
  log('S5', `executado em ${durationMs}ms — 200=${count200} 429=${count429} outros=${countOther}`);

  record('S5: primeiros 100 requests → 200', count200 === 100, `count200=${count200}`);
  record('S5: 101º request → 429', lastStatus === 429, `lastStatus=${lastStatus}`);
  record('S5: exatamente 1 request rejeitada', count429 === 1, `count429=${count429}`);
  record(
    'S5: header Retry-After presente no 429',
    typeof retryAfterHeader === 'string' && retryAfterHeader.length > 0,
    `Retry-After=${retryAfterHeader ?? '(ausente)'}`,
  );
  record(
    'S5: rate limit acionou no request #101',
    firstNon200At === 101,
    `firstNon200At=${firstNon200At ?? 'nunca'}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(HR);
  console.log('Outbound Conversions — Smoke Test E2E');
  console.log(`alvo: ${BASE_URL}`);
  console.log(HR);

  // Sanity: servidor está up?
  const ping = await safeFetch(`http://localhost:${env.PORT}/health`);
  if ('error' in ping) {
    console.error(
      `\n[fatal] servidor não respondeu em http://localhost:${env.PORT}/health\n` +
        `        Erro: ${ping.error}\n` +
        `        Suba o servidor antes: npm run dev\n`,
    );
    process.exit(1);
  }
  if (ping.status !== 200) {
    console.error(`\n[fatal] /health retornou ${ping.status}, esperado 200\n`);
    process.exit(1);
  }
  log('boot', `servidor up em http://localhost:${env.PORT} (health 200)`);

  const orgId = await resolveOrgId();

  await scenarioMissingAuth();
  await scenarioWrongToken();
  await scenarioInvalidSince(orgId);
  await scenarioHappyPath(orgId);
  await scenarioRateLimit(orgId);

  // ── Relatório ───────────────────────────────────────────────────────────
  console.log(HR);
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;

  console.log(`Resultado: ${passed}/${total} asserções verdes`);
  if (failed > 0) {
    console.log(HR);
    console.error('✗ SMOKE TEST FAILED — asserções com falha:');
    for (const r of results) {
      if (!r.ok) console.error(`  ✗ ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    process.exit(1);
  }
  console.log(HR);
  console.log('✓ SMOKE TEST PASSED — Torneira de Dados blindada e validada');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
