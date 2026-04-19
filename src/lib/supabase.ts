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
import type { Database } from '../types/database.js';

// ─────────────────────────────────────────────────────────────────────────────
// Environment — fail fast if any required variable is missing
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_ANON_KEY = process.env['SUPABASE_ANON_KEY'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL) {
  throw new Error('[supabase] Missing environment variable: SUPABASE_URL');
}
if (!SUPABASE_ANON_KEY) {
  throw new Error('[supabase] Missing environment variable: SUPABASE_ANON_KEY');
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('[supabase] Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public client (ANON key) — RLS-aware, safe to use anywhere
// ─────────────────────────────────────────────────────────────────────────────

export const supabase: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
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
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
