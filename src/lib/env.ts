/**
 * Environment Configuration — Single Source of Truth
 *
 * SECURITY_POLICIES.md §3 (Uso estrito de variáveis de ambiente):
 *   "Acesso a `process.env` é centralizado em um módulo de config que valida
 *    presença/tipo no boot. Falhar rápido na ausência de variável obrigatória
 *    é o comportamento desejado. Código de aplicação nunca lê `process.env.X`
 *    direto fora desse módulo central."
 *
 * Como usar:
 *   import { env } from './lib/env.js';
 *   const url = env.SUPABASE_URL;  // tipado como string, garantido não-vazio
 *
 * Comportamento:
 *   - Validação roda no primeiro `import` deste módulo (fail-fast no boot).
 *   - Variável faltante ou vazia → throw com mensagem listando TODAS as falhas
 *     (não para na primeira — o operador vê tudo de uma vez).
 *   - `SUPABASE_URL` validada como URL completa para pegar typos cedo.
 *
 * Para adicionar nova variável:
 *   1. Acrescente ao `envSchema` abaixo.
 *   2. Acrescente entrada em `.env.example` com placeholder neutro.
 *   3. Nunca leia `process.env.NOVA_VAR` direto — sempre via `env.NOVA_VAR`.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Schema — toda variável obrigatória do app vive aqui
// ─────────────────────────────────────────────────────────────────────────────

const nonEmpty = (label: string) => z.string().min(1, `${label} não pode ser vazia`);

const envSchema = z.object({
  // ── Supabase (DB / auth / storage) ──────────────────────────────────────
  SUPABASE_URL: z
    .string()
    .url('SUPABASE_URL deve ser uma URL válida (ex: https://xxx.supabase.co)'),
  SUPABASE_ANON_KEY: nonEmpty('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty('SUPABASE_SERVICE_ROLE_KEY'),

  // ── Outbound: extração via Apify ────────────────────────────────────────
  APIFY_API_TOKEN: nonEmpty('APIFY_API_TOKEN'),

  // ── Inbound (Closed Loop): ponte Nexora ↔ AIOS Python + Meta CAPI ───────
  AIOS_WEBHOOK_SECRET: nonEmpty('AIOS_WEBHOOK_SECRET'),
  META_CAPI_TOKEN: nonEmpty('META_CAPI_TOKEN'),
  META_PIXEL_ID: nonEmpty('META_PIXEL_ID'),

  // ── HTTP server ─────────────────────────────────────────────────────────
  // Opcional. Default 3000. `coerce` converte string do .env para number.
  PORT: z.coerce.number().int().positive().default(3000),
});

// ─────────────────────────────────────────────────────────────────────────────
// Parse — fail-fast com mensagem agregada e legível
// ─────────────────────────────────────────────────────────────────────────────

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => {
      const key = issue.path.join('.');
      return `  • ${key}: ${issue.message}`;
    })
    .join('\n');

  throw new Error(
    [
      '',
      '╔══════════════════════════════════════════════════════════════════════╗',
      '║  [env] Falha na validação de variáveis de ambiente                   ║',
      '╠══════════════════════════════════════════════════════════════════════╣',
      '║  O processo NÃO pode iniciar sem todas as variáveis obrigatórias.    ║',
      '║  Verifique seu arquivo .env (referência: .env.example na raiz).      ║',
      '╚══════════════════════════════════════════════════════════════════════╝',
      '',
      'Problemas encontrados:',
      issues,
      '',
    ].join('\n'),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export — objeto imutável, tipado, pronto para consumo
// ─────────────────────────────────────────────────────────────────────────────

export const env = Object.freeze(parsed.data);

export type Env = typeof env;
