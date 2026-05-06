/**
 * Supabase Client Factory
 * Story: E-02.02 — Extraction Run Model / DB Layer
 *
 * Exports two typed Supabase clients:
 *
 *   - `supabase`      → standard client authenticated with the public ANON key.
 *                       Safe for frontend/browser contexts. Respects RLS on the
 *                       caller's JWT.
 *
 *   - `supabaseAdmin` → privileged client authenticated with the SERVICE_ROLE key.
 *                       Bypasses RLS entirely. Must NEVER leave the backend.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';
import type { Database } from '../types/database.js';

// ─────────────────────────────────────────────────────────────────────────────
// Environment — validated upstream by `env` (src/lib/env.ts, fail-fast no boot)
// SECURITY_POLICIES.md §3: nenhum acesso direto a process.env aqui.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Public client (ANON key) — RLS-aware, safe to use anywhere
// ─────────────────────────────────────────────────────────────────────────────

export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  ADMIN client (SERVICE_ROLE key) — BACKEND / WORKERS ONLY  ⚠️
// ─────────────────────────────────────────────────────────────────────────────
//
//  🚨🚨🚨  DANGER: PRIVILEGED CLIENT — BYPASSES ROW-LEVEL SECURITY  🚨🚨🚨
//
//  The `supabaseAdmin` client below is authenticated with the Supabase
//  SERVICE_ROLE key. It has UNRESTRICTED access to ALL rows, ALL tables,
//  and ALL storage buckets across every tenant.
//
//  Using it incorrectly is a CRITICAL security vulnerability equivalent to
//  giving every user root access to the database.
//
//  STRICT RULES — no exceptions:
//
//    ✅  ALLOWED:
//        • Server-side code (Node workers, cron jobs, background tasks)
//        • Trusted backend services running inside our infrastructure
//        • Admin scripts executed by operators with explicit intent
//
//    ❌  FORBIDDEN:
//        • ANY frontend / browser / mobile / client bundle
//        • Any code path reachable from an untrusted request
//        • Edge functions that echo user input without authorization checks
//        • Logging / serializing the client or its key anywhere
//
//  If you are unsure whether the code path is trusted, DO NOT use this
//  client — use `supabase` (ANON) with explicit RLS policies instead.
//
//  Review: @devops (Gage) must approve every new caller of `supabaseAdmin`.
//
// ─────────────────────────────────────────────────────────────────────────────

export const supabaseAdmin: SupabaseClient<Database> = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
