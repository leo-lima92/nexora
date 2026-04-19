/**
 * Test: Extraction Run Service — Full Lifecycle
 * Story: E-02.02 — Extraction Run Model / DB Layer
 *
 * Exercises every primitive exposed by `src/services/extraction-run.service.ts`
 * against the real Supabase project configured in `.env`:
 *
 *   1. Resolve or create a throwaway organization (FK target for org_id)
 *   2. createRun              — insert a 'pending' Google Maps extraction
 *   3. updateRunStatus        — transition pending → running (stamps started_at)
 *   4. updateRunStatus        — transition running → succeeded with counters
 *   5. getRunById             — fetch the row back and verify timestamps
 *   6. listRunsByOrg          — paginated listing scoped to the test org
 *   7. Cleanup                — delete the created run (and org if self-created)
 *
 * How to run (Node 22+):
 *   npx tsx --env-file=.env src/executions/test-extraction-run.ts
 */

import { supabaseAdmin } from '../lib/supabase.js';
import {
  createRun,
  getRunById,
  listRunsByOrg,
  updateRunStatus,
  type ExtractionRunRow,
} from '../services/extraction-run.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const HR = '─'.repeat(72);

function log(step: string, msg: string): void {
  console.log(`[${step}] ${msg}`);
}

function pick<T extends ExtractionRunRow>(row: T): Record<string, unknown> {
  return {
    id: row.id,
    org_id: row.org_id,
    source: row.source,
    status: row.status,
    query: row.query,
    location: row.location,
    started_at: row.started_at,
    completed_at: row.completed_at,
    results_count: row.results_count,
    companies_created: row.companies_created,
    contacts_created: row.contacts_created,
    apify_run_id: row.apify_run_id,
  };
}

/**
 * Returns the id of an org to use for the test.
 * - Reuses the first existing organization if one is available.
 * - Otherwise creates a throwaway org and flags it for cleanup.
 */
async function resolveTestOrg(): Promise<{ orgId: string; createdByScript: boolean }> {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .limit(1);

  if (selectError) {
    throw new Error(`[resolveTestOrg.select] ${selectError.message}`);
  }

  if (existing && existing.length > 0 && existing[0]) {
    log('org', `reutilizando org existente id=${existing[0].id} slug=${existing[0].slug}`);
    return { orgId: existing[0].id, createdByScript: false };
  }

  const slug = `nexora-test-${Date.now()}`;
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: 'Nexora Test Org', slug })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(`[resolveTestOrg.insert] ${insertError?.message ?? 'unknown'}`);
  }

  log('org', `criada org temporária id=${inserted.id} slug=${slug}`);
  return { orgId: inserted.id, createdByScript: true };
}

async function cleanupRun(runId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('extraction_runs')
    .delete()
    .eq('id', runId);
  if (error) {
    log('cleanup', `falha ao deletar run ${runId}: ${error.message}`);
    return;
  }
  log('cleanup', `run ${runId} removida`);
}

async function cleanupOrg(orgId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('organizations')
    .delete()
    .eq('id', orgId);
  if (error) {
    log('cleanup', `falha ao deletar org ${orgId}: ${error.message}`);
    return;
  }
  log('cleanup', `org ${orgId} removida`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(HR);
  console.log('Extraction Run Service — Lifecycle Test (Story E-02.02)');
  console.log(HR);

  // 0. Env sanity
  const haveUrl = Boolean(process.env['SUPABASE_URL']);
  const haveServiceKey = Boolean(process.env['SUPABASE_SERVICE_ROLE_KEY']);
  log('env', `SUPABASE_URL=${haveUrl ? 'OK' : 'MISSING'} SERVICE_ROLE_KEY=${haveServiceKey ? 'OK' : 'MISSING'}`);
  if (!haveUrl || !haveServiceKey) {
    console.error('→ Rode com: npx tsx --env-file=.env src/executions/test-extraction-run.ts');
    process.exit(1);
  }

  const { orgId, createdByScript } = await resolveTestOrg();
  let createdRunId: string | null = null;

  try {
    // 1. createRun
    console.log(HR);
    log('1/5', 'createRun → source=google_maps, status=pending esperado');
    const created = await createRun({
      orgId,
      source: 'google_maps',
      query: 'academias em São Paulo',
      location: 'São Paulo, SP, Brasil',
      cnaeCodes: ['9313-1/00'],
      maxResults: 25,
      apifyActorId: 'compass/crawler-google-places',
    });
    createdRunId = created.id;
    console.log(pick(created));

    if (created.status !== 'pending') {
      throw new Error(`status inicial esperado 'pending', recebido '${created.status}'`);
    }
    if (created.started_at !== null || created.completed_at !== null) {
      throw new Error('started_at e completed_at deveriam iniciar null');
    }

    // 2. running
    console.log(HR);
    log('2/5', "updateRunStatus → 'running' (espera started_at preenchido)");
    const running = await updateRunStatus(createdRunId, {
      status: 'running',
      apifyRunId: 'apify-fake-run-' + Date.now().toString(36),
    });
    console.log(pick(running));

    if (running.status !== 'running') {
      throw new Error(`status esperado 'running', recebido '${running.status}'`);
    }
    if (!running.started_at) {
      throw new Error('started_at deveria estar preenchido após transição para running');
    }

    // 3. succeeded
    console.log(HR);
    log('3/5', "updateRunStatus → 'succeeded' com counters fictícios");
    const succeeded = await updateRunStatus(createdRunId, {
      status: 'succeeded',
      resultsCount: 23,
      companiesCreated: 21,
      contactsCreated: 17,
      rawData: {
        actor: 'compass/crawler-google-places',
        pages: 3,
        durationMs: 45_000,
      },
    });
    console.log(pick(succeeded));

    if (succeeded.status !== 'succeeded') {
      throw new Error(`status esperado 'succeeded', recebido '${succeeded.status}'`);
    }
    if (!succeeded.completed_at) {
      throw new Error('completed_at deveria estar preenchido após transição terminal');
    }
    if (succeeded.results_count !== 23 || succeeded.companies_created !== 21 || succeeded.contacts_created !== 17) {
      throw new Error('counters não foram persistidos corretamente');
    }

    // 4. getRunById
    console.log(HR);
    log('4/5', 'getRunById — deve retornar a mesma linha (scoped por org)');
    const fetched = await getRunById(createdRunId, orgId);
    if (!fetched) throw new Error('getRunById retornou null inesperadamente');
    console.log(pick(fetched));
    if (fetched.id !== createdRunId) {
      throw new Error('id retornado não corresponde ao criado');
    }

    // 4b. getRunById — scoping check: org errada deve retornar null
    const wrongScope = await getRunById(createdRunId, '00000000-0000-0000-0000-000000000000');
    log('4/5', `scoping check (org errada) → ${wrongScope === null ? 'null (OK)' : 'LEAK!'}`);
    if (wrongScope !== null) {
      throw new Error('scoping por org_id falhou — retorno deveria ser null');
    }

    // 5. listRunsByOrg
    console.log(HR);
    log('5/5', 'listRunsByOrg — filtrando por source=google_maps, limit=5');
    const listing = await listRunsByOrg(orgId, {
      source: 'google_maps',
      limit: 5,
    });
    console.log(`   total=${listing.total} rows retornadas=${listing.rows.length}`);
    for (const r of listing.rows.slice(0, 3)) {
      console.log('   •', pick(r));
    }
    if (listing.total < 1) {
      throw new Error('listRunsByOrg deveria conter pelo menos a run criada');
    }

    console.log(HR);
    console.log('✓ Ciclo completo validado contra o Supabase real.');
  } finally {
    // Cleanup — sempre remove a run de teste; remove a org só se criada pelo script.
    console.log(HR);
    if (createdRunId) await cleanupRun(createdRunId);
    if (createdByScript) await cleanupOrg(orgId);
    console.log(HR);
  }
}

main().catch((err) => {
  console.error('✗ Falha no teste de ciclo de vida:');
  if (err instanceof Error) {
    console.error(`   ${err.name}: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  } else {
    console.error(err);
  }
  process.exit(1);
});
