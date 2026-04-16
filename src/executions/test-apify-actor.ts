/**
 * Test: Apify Actor End-to-End Smoke Test
 * Story: E-02.01 — Apify Client Service (AC-2, AC-3, AC-4, AC-5, AC-8)
 *
 * Exercita o fluxo completo do ApifyClient contra `apify/hello-world`:
 *   - runActor()            → inicia Actor async
 *   - waitForRun()          → polling até status terminal
 *   - getAllDatasetItems()  → coleta paginada do dataset
 *
 * Logs estruturados do próprio ApifyClient (service=apify-client) aparecem
 * intercalados com as etapas deste script (phase=...).
 *
 * Como rodar:
 *   npx tsx --env-file=.env src/executions/test-apify-actor.ts
 */

import { getApifyClient, ApifyError } from '../services/apify-client.ts';

// Nota: `apify/hello-world` não grava em dataset (hasNoDataset=true) — escreve só
// em KeyValueStore. Para validar getAllDatasetItems() com dados reais e exercitar
// o mesmo padrão que os extractors de E-02 (Google Maps, LinkedIn, Instagram) vão
// usar, rodamos `apify/rag-web-browser` — Actor público, free-tier friendly,
// grava dataset e aceita input minimalista.
const ACTOR_ID = 'apify/rag-web-browser';
const ACTOR_INPUT = {
  query: 'Apify web scraping',
  maxResults: 2,
  outputFormats: ['markdown'],
};

function phase(step: string, meta: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      service: 'test-apify-actor',
      phase: step,
      ...meta,
      ts: new Date().toISOString(),
    }),
  );
}

async function main(): Promise<void> {
  console.log('═'.repeat(70));
  console.log(`Apify Actor Smoke Test — ${ACTOR_ID}`);
  console.log('Story E-02.01 · ACs exercitados: 2, 3, 4, 5, 8');
  console.log('═'.repeat(70));

  const client = getApifyClient();
  const t0 = Date.now();

  // ── Fase 1: runActor (AC-2) ────────────────────────────────────────────
  phase('run_actor.start', { actorId: ACTOR_ID, input: ACTOR_INPUT });
  const run = await client.runActor(ACTOR_ID, ACTOR_INPUT);
  phase('run_actor.done', {
    runId: run.id,
    status: run.status,
    datasetId: run.defaultDatasetId,
  });

  // ── Fase 2: waitForRun (AC-3) ──────────────────────────────────────────
  phase('wait_for_run.start', { runId: run.id, intervalMs: 2000, timeoutMs: 120_000 });
  const finishedRun = await client.waitForRun(run.id, {
    intervalMs: 2_000,
    timeoutMs: 120_000,
  });
  phase('wait_for_run.done', {
    runId: finishedRun.id,
    status: finishedRun.status,
    durationMs: finishedRun.stats.durationMillis,
  });

  // ── Fase 3: getAllDatasetItems (AC-4) ──────────────────────────────────
  phase('get_dataset.start', { datasetId: finishedRun.defaultDatasetId });
  const items = await client.getAllDatasetItems(finishedRun.defaultDatasetId);
  phase('get_dataset.done', { datasetId: finishedRun.defaultDatasetId, itemCount: items.length });

  // ── Summary ────────────────────────────────────────────────────────────
  const totalMs = Date.now() - t0;
  console.log('═'.repeat(70));
  console.log('RESULTADO');
  console.log('═'.repeat(70));
  console.log(`Actor:      ${ACTOR_ID}`);
  console.log(`Run ID:     ${finishedRun.id}`);
  console.log(`Status:     ${finishedRun.status}`);
  console.log(`Dataset:    ${finishedRun.defaultDatasetId}`);
  console.log(`Items:      ${items.length}`);
  console.log(`Duração run (Apify):  ${finishedRun.stats.durationMillis}ms`);
  console.log(`Duração total (e2e):  ${totalMs}ms`);
  console.log('─'.repeat(70));
  console.log('Dataset output:');
  console.log(JSON.stringify(items, null, 2));
  console.log('═'.repeat(70));
  console.log('✓ Fluxo ApifyClient end-to-end validado.');
}

main().catch((err) => {
  if (err instanceof ApifyError) {
    console.error('✗ ApifyError:', {
      message: err.message,
      statusCode: err.statusCode,
      runId: err.runId,
    });
  } else {
    console.error('✗ Erro inesperado:', err);
  }
  process.exit(1);
});
