/**
 * Test: Apify API Connectivity Check
 * Story: E-02.01 — Apify Client Service
 *
 * Valida que:
 *   1. APIFY_API_TOKEN está presente no process.env
 *   2. O ApifyClient instancia sem lançar ApifyError
 *   3. A API do Apify responde ao token (endpoint /users/me)
 *
 * Como rodar (Node 22+):
 *   node --env-file=.env --experimental-strip-types src/executions/test-apify.ts
 *
 * Alternativa com tsx:
 *   npx tsx --env-file=.env src/executions/test-apify.ts
 */

import { ApifyClient, ApifyError } from '../services/apify-client.js';

const APIFY_ME_URL = 'https://api.apify.com/v2/users/me';

interface ApifyUser {
  id: string;
  username: string;
  email?: string;
  plan?: { id: string };
}

async function main(): Promise<void> {
  console.log('─'.repeat(60));
  console.log('Apify Connectivity Test — Story E-02.01');
  console.log('─'.repeat(60));

  // 1. Env resolution
  const tokenPresent = Boolean(process.env['APIFY_API_TOKEN']);
  console.log(`[1/3] APIFY_API_TOKEN presente no env: ${tokenPresent ? 'OK' : 'AUSENTE'}`);
  if (!tokenPresent) {
    console.error('   → Certifique-se de rodar com --env-file=.env');
    process.exit(1);
  }

  // 2. Client instantiation
  let client: ApifyClient;
  try {
    client = new ApifyClient();
    console.log('[2/3] ApifyClient instanciado: OK');
  } catch (err) {
    if (err instanceof ApifyError) {
      console.error(`[2/3] ApifyClient falhou: ${err.message}`);
    } else {
      console.error('[2/3] ApifyClient falhou com erro inesperado:', err);
    }
    process.exit(1);
  }

  // 3. Live API check via /users/me
  const token = process.env['APIFY_API_TOKEN']!;
  const start = Date.now();
  try {
    const response = await fetch(`${APIFY_ME_URL}?token=${encodeURIComponent(token)}`);
    const durationMs = Date.now() - start;

    if (!response.ok) {
      const body = await response.text();
      console.error(`[3/3] API respondeu ${response.status} em ${durationMs}ms`);
      console.error(`   → body: ${body.slice(0, 200)}`);
      process.exit(1);
    }

    const payload = (await response.json()) as { data: ApifyUser };
    console.log(`[3/3] API respondeu 200 em ${durationMs}ms`);
    console.log('─'.repeat(60));
    console.log('User:');
    console.log(`   id:       ${payload.data.id}`);
    console.log(`   username: ${payload.data.username}`);
    console.log(`   plan:     ${payload.data.plan?.id ?? 'n/a'}`);
    console.log('─'.repeat(60));
    console.log('✓ Conexão viva. Token válido.');

    // Suprime warning "unused variable" — client é validado via instanciação
    void client;
  } catch (err) {
    console.error(`[3/3] Falha de rede em ${Date.now() - start}ms:`, err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro não tratado:', err);
  process.exit(1);
});
