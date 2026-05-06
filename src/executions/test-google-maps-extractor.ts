/**
 * Smoke Test: Google Maps Extractor — LIVE run
 * Story: E-02.03 — Google Maps Extractor Orchestration
 *
 * ⚠️  Este script consome créditos Apify reais.
 *     Está capado em maxResults=3 para manter o custo mínimo (smoke test).
 *
 * Objetivo:
 *   1. Provar ponta-a-ponta que o orquestrador funciona contra APIs reais
 *      (Apify actor compass/crawler-google-places + Supabase).
 *   2. Capturar o SHAPE real dos itens retornados pelo actor para calibrar
 *      o mapeamento GoogleMapsPlace → Company na próxima story (E-02.03b).
 *
 * Fluxo:
 *   1. Resolve ou cria uma org temporária (FK target para extraction_runs.org_id)
 *   2. Dispara extractGoogleMaps({ query, maxResults=3 })
 *   3. Loga cada transição (pending → running → succeeded) via refetch no DB
 *   4. Imprime os itens raspados + rawData persistido
 *   5. Cleanup: remove a run e (se criada pelo script) a org
 *
 * How to run:
 *   npx tsx --env-file=.env src/executions/test-google-maps-extractor.ts
 */

import { supabaseAdmin } from '../lib/supabase.js';
import {
  extractGoogleMaps,
  type GoogleMapsPlace,
} from '../services/google-maps-extractor.service.js';
import { getRunById } from '../services/extraction-run.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const HR = '─'.repeat(72);
const QUERY = 'academias em Vila Velha, ES';
const MAX_RESULTS = 3;

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(step: string, msg: string): void {
  console.log(`[${stamp()}] [${step}] ${msg}`);
}

async function resolveTestOrg(): Promise<{ orgId: string; createdByScript: boolean }> {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('organizations')
    .select('id, slug')
    .limit(1);

  if (selectError) {
    throw new Error(`[resolveTestOrg.select] ${selectError.message}`);
  }

  if (existing && existing.length > 0 && existing[0]) {
    log('org', `reutilizando org existente id=${existing[0].id} slug=${existing[0].slug}`);
    return { orgId: existing[0].id, createdByScript: false };
  }

  const slug = `nexora-e0203-${Date.now()}`;
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: 'Nexora E-02.03 Smoke', slug })
    .select('id')
    .single();

  if (insertError || !inserted) {
    throw new Error(`[resolveTestOrg.insert] ${insertError?.message ?? 'unknown'}`);
  }

  log('org', `criada org temporária id=${inserted.id} slug=${slug}`);
  return { orgId: inserted.id, createdByScript: true };
}

async function cleanupRun(runId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('extraction_runs').delete().eq('id', runId);
  if (error) {
    log('cleanup', `falha ao deletar run ${runId}: ${error.message}`);
    return;
  }
  log('cleanup', `run ${runId} removida`);
}

async function cleanupOrg(orgId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('organizations').delete().eq('id', orgId);
  if (error) {
    log('cleanup', `falha ao deletar org ${orgId}: ${error.message}`);
    return;
  }
  log('cleanup', `org ${orgId} removida`);
}

/**
 * Resolve o id da run criada pelo extractor, mesmo em caminho de erro —
 * retorna o run mais recente da org, que é o único que criamos aqui.
 */
async function findLatestRunId(orgId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('extraction_runs')
    .select('id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    log('cleanup', `findLatestRunId falhou: ${error.message}`);
    return null;
  }
  return data?.id ?? null;
}

function printPlace(index: number, place: GoogleMapsPlace): void {
  console.log(HR);
  console.log(`RESULT #${index + 1}`);
  console.log(HR);
  // Seleciona os campos relevantes para leitura rápida primeiro
  const summary = {
    title: place.title,
    categoryName: place.categoryName,
    address: place.address,
    phone: place.phone,
    website: place.website,
    totalScore: place.totalScore,
    reviewsCount: place.reviewsCount,
    location: place.location,
    placeId: place.placeId,
  };
  console.log('Summary:');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Full payload (shape bruto — usado para mapear em E-02.03b):');
  console.log(JSON.stringify(place, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(HR);
  console.log('Google Maps Extractor — LIVE Smoke Test (Story E-02.03)');
  console.log(`query="${QUERY}"  maxResults=${MAX_RESULTS}`);
  console.log(HR);

  // 0. Env já validado via cofre Zod no boot (src/lib/env.ts) — fail-fast upstream.
  log('env', 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + APIFY_API_TOKEN validados pelo cofre Zod');

  const { orgId, createdByScript } = await resolveTestOrg();
  let runId: string | null = null;

  try {
    log('flow', 'disparando extractGoogleMaps — isso deve levar ~30-120s (actor + polling)...');
    const started = Date.now();

    const { run, items } = await extractGoogleMaps({
      orgId,
      query: QUERY,
      maxResults: MAX_RESULTS,
    });

    const elapsedMs = Date.now() - started;
    runId = run.id;

    console.log(HR);
    log(
      'done',
      `extractGoogleMaps retornou em ${elapsedMs}ms — status=${run.status} resultsCount=${run.results_count}`,
    );

    // Re-fetch para confirmar persistência real no DB (defense-in-depth)
    const persisted = await getRunById(run.id, orgId);
    if (!persisted) {
      throw new Error('run não encontrada após sucesso — algo está muito errado');
    }

    console.log(HR);
    log('db', 'row persistida em extraction_runs:');
    console.log(
      JSON.stringify(
        {
          id: persisted.id,
          status: persisted.status,
          source: persisted.source,
          apify_run_id: persisted.apify_run_id,
          apify_actor_id: persisted.apify_actor_id,
          started_at: persisted.started_at,
          completed_at: persisted.completed_at,
          results_count: persisted.results_count,
          companies_created: persisted.companies_created,
          contacts_created: persisted.contacts_created,
        },
        null,
        2,
      ),
    );

    console.log(HR);
    log('rawData', 'metadados persistidos (coluna raw_data):');
    console.log(JSON.stringify(persisted.raw_data, null, 2));

    console.log(HR);
    log('items', `${items.length} itens retornados pelo actor (shape para E-02.03b):`);
    if (items.length === 0) {
      console.log('   (nenhum item retornado — verifique a query ou o actor)');
    } else {
      items.forEach((place, idx) => printPlace(idx, place));
    }

    console.log(HR);
    console.log(`✓ Smoke test concluído: ${items.length}/${MAX_RESULTS} locais raspados ao vivo.`);
  } catch (err) {
    console.error(HR);
    console.error('✗ Smoke test falhou:');
    if (err instanceof Error) {
      console.error(`   ${err.name}: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    } else {
      console.error(err);
    }
    // Tentamos recuperar o runId para cleanup mesmo em caminho de erro
    if (!runId) runId = await findLatestRunId(orgId);
    process.exitCode = 1;
  } finally {
    console.log(HR);
    if (runId) await cleanupRun(runId);
    if (createdByScript) await cleanupOrg(orgId);
    console.log(HR);
  }
}

main().catch((err: unknown) => {
  console.error('Erro não tratado na main:', err);
  process.exit(1);
});
