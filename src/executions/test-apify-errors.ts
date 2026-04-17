/**
 * Test: Apify Error Handling
 * Story: E-02.01 — Apify Client Service (AC-6)
 *
 * Valida que o `ApifyClient` encapsula erros HTTP em `ApifyError` com os
 * campos `message`, `statusCode` preenchidos, forçando um 404 via consulta
 * a um runId inexistente.
 *
 * Como rodar:
 *   npx tsx --env-file=.env src/executions/test-apify-errors.ts
 */

import { getApifyClient, ApifyError } from '../services/apify-client.js';

const FAKE_RUN_ID = 'does-not-exist-NEXORA-TEST';

async function main(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('Apify Error Handling Test — AC-6');
  console.log('═'.repeat(70));

  const client = getApifyClient();

  console.log(`[1/1] getActorRunStatus('${FAKE_RUN_ID}') → esperando 404 em ApifyError`);

  try {
    await client.getActorRunStatus(FAKE_RUN_ID);
    console.error('✗ FALHA: chamada retornou sem throw. AC-6 NÃO validado.');
    process.exit(1);
  } catch (err) {
    if (!(err instanceof ApifyError)) {
      console.error('✗ FALHA: erro lançado não é ApifyError:', err);
      process.exit(1);
    }

    const ok = err.statusCode === 404;
    console.log('─'.repeat(70));
    console.log('Erro capturado:');
    console.log(`   name:       ${err.name}`);
    console.log(`   statusCode: ${err.statusCode}`);
    console.log(`   runId:      ${err.runId ?? '(n/a)'}`);
    console.log(`   message:    ${err.message.slice(0, 120)}${err.message.length > 120 ? '…' : ''}`);
    console.log('─'.repeat(70));

    if (!ok) {
      console.error(`✗ FALHA: statusCode esperado 404, recebido ${err.statusCode}`);
      process.exit(1);
    }

    console.log('✓ AC-6 validado: ApifyError lançado com statusCode=404.');
  }
}

main().catch((err) => {
  console.error('✗ Erro inesperado:', err);
  process.exit(1);
});
