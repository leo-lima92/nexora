/**
 * Smoke Test: Google Maps Mapper + Dedup + Rate Limit — LIVE run
 * Story: E-02.03b — Google Maps Mapper / Dedup / Rate Limit
 *
 * ⚠️  Este script consome créditos Apify reais. Capado em maxResults=3.
 *     Ele executa 2 runs sequenciais obrigatórias + 2 runs concorrentes
 *     (Phase 3, opcional) — worst-case 4 extrações Apify.
 *
 * Plano de teste:
 *   Phase 1 — primeira run:   companiesCreated=3, companiesSkipped=0
 *   Phase 2 — segunda run:    companiesCreated=0, companiesSkipped=3 (dedup)
 *   Phase 3 — 2 runs em Promise.allSettled: 1 deve rejeitar com
 *             ActiveRunConflictError (rate limit via assertNoActiveRun).
 *             A outra roda normal (dedup kicks in → skipa tudo).
 *
 * Cleanup: remove contacts → companies → extraction_runs → organization.
 *
 * How to run:
 *   npx tsx --env-file=.env src/executions/test-google-maps-mapper.ts
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { extractGoogleMaps } from '../services/google-maps-extractor.service.js';
import { ActiveRunConflictError } from '../services/extraction-run.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const HR = '─'.repeat(72);
const QUERY = 'academias em Vila Velha, ES';
const MAX_RESULTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(step: string, msg: string): void {
  console.log(`[${stamp()}] [${step}] ${msg}`);
}

async function createDedicatedOrg(): Promise<string> {
  const slug = `nexora-e0203b-${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({ name: 'Nexora E-02.03b Smoke (Mapper)', slug })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`[setup] createOrg: ${error?.message ?? 'unknown'}`);
  }
  log('setup', `org dedicada criada id=${data.id} slug=${slug}`);
  return data.id;
}

async function cleanup(orgId: string): Promise<void> {
  // Ordem: deps primeiro (contacts → companies → runs), depois a org.
  // Mesmo que haja CASCADE, fazer explícito deixa logs claros se algo falhar.
  // `contacts` é a tabela canônica do chassi e usa `organization_id`; as
  // AIOS-nativas (companies, extraction_runs) usam `org_id` — migration 0145.
  const { error: contactsErr } = await supabaseAdmin
    .from('contacts')
    .delete()
    .eq('organization_id', orgId);
  if (contactsErr) log('cleanup', `falha ao limpar contacts: ${contactsErr.message}`);

  const tables = ['companies', 'extraction_runs'] as const;
  for (const table of tables) {
    const { error } = await supabaseAdmin.from(table).delete().eq('org_id', orgId);
    if (error) log('cleanup', `falha ao limpar ${table}: ${error.message}`);
  }
  const { error } = await supabaseAdmin.from('organizations').delete().eq('id', orgId);
  if (error) log('cleanup', `falha ao deletar org ${orgId}: ${error.message}`);
  else log('cleanup', `org ${orgId} e rows dependentes removidas`);
}

async function countRow(table: 'companies' | 'contacts', orgId: string): Promise<number> {
  // A coluna de tenant difere por origem da tabela (ver cleanup): `contacts` é
  // do chassi (organization_id), `companies` é AIOS-nativa (org_id).
  const { count, error } =
    table === 'contacts'
      ? await supabaseAdmin
          .from('contacts')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
      : await supabaseAdmin
          .from('companies')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId);
  if (error) {
    log('count', `falha ao contar ${table}: ${error.message}`);
    return -1;
  }
  return count ?? 0;
}

interface PhaseResult {
  companiesCreated: number;
  companiesSkipped: number;
  contactsCreated: number;
  errors: number;
  items: number;
  durationMs: number;
  runStatus: string;
}

async function runPhase(label: string, orgId: string): Promise<PhaseResult> {
  log('flow', `▶ ${label}: extractGoogleMaps({ maxResults=${MAX_RESULTS} })`);
  const start = Date.now();
  const { run, items, mapping } = await extractGoogleMaps({
    orgId,
    query: QUERY,
    maxResults: MAX_RESULTS,
  });
  const durationMs = Date.now() - start;

  log(
    label,
    `status=${run.status}  duration=${durationMs}ms  items=${items.length}`,
  );
  log(
    label,
    `mapping: companiesCreated=${mapping.companiesCreated}  companiesSkipped=${mapping.companiesSkipped}  contactsCreated=${mapping.contactsCreated}  errors=${mapping.errors.length}`,
  );
  if (mapping.errors.length > 0) {
    console.log('   errors:', JSON.stringify(mapping.errors, null, 2));
  }

  return {
    companiesCreated: mapping.companiesCreated,
    companiesSkipped: mapping.companiesSkipped,
    contactsCreated: mapping.contactsCreated,
    errors: mapping.errors.length,
    items: items.length,
    durationMs,
    runStatus: run.status ?? 'unknown',
  };
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return String(reason);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(HR);
  console.log('Google Maps Mapper — LIVE Smoke Test (Story E-02.03b)');
  console.log(
    `query="${QUERY}"  maxResults=${MAX_RESULTS}  plan: 2 runs sequenciais + 2 concorrentes`,
  );
  console.log(HR);

  // 0. Env já validado via cofre Zod no boot (src/lib/env.ts) — fail-fast upstream.
  log('env', 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + APIFY_API_TOKEN validados pelo cofre Zod');

  const orgId = await createDedicatedOrg();
  let pass = true;

  try {
    // ─── Phase 1 — Primeira run: esperado C=3 S=0 ──────────────────────────
    console.log(HR);
    const first = await runPhase('phase1', orgId);
    if (first.companiesCreated === 3 && first.companiesSkipped === 0) {
      console.log('   ✓ assertion: 3 companies novas criadas (0 skipadas)');
    } else {
      console.error(
        `   ✗ assertion falhou: esperado C=3 S=0, got C=${first.companiesCreated} S=${first.companiesSkipped}`,
      );
      pass = false;
    }
    const companiesAfter1 = await countRow('companies', orgId);
    const contactsAfter1 = await countRow('contacts', orgId);
    log('db', `DB state após phase1: companies=${companiesAfter1} contacts=${contactsAfter1}`);

    // ─── Phase 2 — Segunda run (mesma query): esperado C=0 S=3 ─────────────
    console.log(HR);
    const second = await runPhase('phase2', orgId);
    if (second.companiesCreated === 0 && second.companiesSkipped === 3) {
      console.log('   ✓ assertion: dedup por google_place_id funcionando — 3 skipadas, 0 novas');
    } else {
      console.error(
        `   ✗ assertion falhou: esperado C=0 S=3, got C=${second.companiesCreated} S=${second.companiesSkipped}`,
      );
      pass = false;
    }
    const companiesAfter2 = await countRow('companies', orgId);
    const contactsAfter2 = await countRow('contacts', orgId);
    log('db', `DB state após phase2: companies=${companiesAfter2} contacts=${contactsAfter2}`);
    if (companiesAfter2 !== companiesAfter1 || contactsAfter2 !== contactsAfter1) {
      console.error('   ✗ assertion falhou: contagem de rows mudou entre phase1 e phase2 (dedup deveria ser idempotente)');
      pass = false;
    } else {
      console.log('   ✓ assertion: contagem de rows idempotente entre runs duplicadas');
    }

    // ─── Phase 3 — 2 runs concorrentes: esperamos 1 rejeitada ─────────────
    console.log(HR);
    log('flow', '▶ phase3: 2 runs em Promise.allSettled (teste do assertNoActiveRun)');
    const results = await Promise.allSettled([
      extractGoogleMaps({ orgId, query: QUERY, maxResults: MAX_RESULTS }),
      extractGoogleMaps({ orgId, query: QUERY, maxResults: MAX_RESULTS }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    log('phase3', `fulfilled=${fulfilled.length}  rejected=${rejected.length}`);

    for (const r of rejected) {
      const reason = r.reason;
      if (reason instanceof ActiveRunConflictError) {
        console.log(
          `   ✓ ActiveRunConflictError capturada: activeRunId=${reason.activeRunId} source=${reason.source}`,
        );
      } else {
        console.log(`   rejeitada por outro motivo: ${describeReason(reason)}`);
      }
    }

    const conflictCaught = rejected.some((r) => r.reason instanceof ActiveRunConflictError);
    if (conflictCaught) {
      console.log('   ✓ rate limit via SELECT funcionou — 1 run bloqueada antes de chamar Apify');
    } else if (fulfilled.length === 2) {
      console.warn(
        '   ⚠ ambas as runs concluíram — race condition aceitável (lock best-effort), mas lock não atingiu alvo',
      );
      // Não falhamos o teste aqui: o service documenta que assertNoActiveRun é best-effort.
      // Se quisermos garantia forte, precisa de advisory lock (out of scope).
    } else {
      console.error('   ✗ nenhuma das runs foi rejeitada por ActiveRunConflictError');
      pass = false;
    }

    console.log(HR);
    if (pass) {
      console.log('✓ E-02.03b — Todas as assertions passaram.');
      console.log('  ─ Phase 1: 3 empresas criadas do zero');
      console.log('  ─ Phase 2: 0 empresas criadas, 3 skipadas (dedup por placeId)');
      console.log(
        `  ─ Phase 3: ${conflictCaught ? 'lock best-effort honrado' : 'lock best-effort não atingiu alvo (race condition aceitável)'}`,
      );
    } else {
      console.error('✗ Algumas assertions falharam — revisar log acima.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(HR);
    console.error('✗ Smoke test falhou (exceção não tratada):');
    if (err instanceof Error) {
      console.error(`   ${err.name}: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  } finally {
    console.log(HR);
    log('cleanup', 'removendo companies, contacts, runs e org criados pelo teste...');
    await cleanup(orgId);
    console.log(HR);
  }
}

main().catch((err: unknown) => {
  console.error('Erro não tratado na main:', err);
  process.exit(1);
});
