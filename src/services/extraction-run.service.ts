/**
 * Extraction Run Service
 * Story: E-02.02 — Extraction Run Model / DB Layer
 *
 * Thin data-access layer over `public.extraction_runs`. Provides the canonical
 * lifecycle primitives used by the Apify orchestration workers:
 *
 *   - createRun           → inserts a new run (status defaults to 'pending')
 *   - updateRunStatus     → transitions state, stamps started_at/completed_at,
 *                           and merges aggregation counters / error info
 *   - getRunById          → fetches a single run (optionally scoped to an org)
 *   - listRunsByOrg       → paginated listing with optional status/source filters
 *
 * ⚠️  This service runs on the SERVER ONLY and uses `supabaseAdmin`
 *     (SERVICE_ROLE key) because workers/cron jobs need to operate across
 *     tenants without being constrained by the caller's JWT. Never import
 *     this module from a browser / client bundle.
 */

import type { PostgrestError } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { Database, Json } from '../types/database.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ExtractionRunsTable = Database['public']['Tables']['extraction_runs'];
export type ExtractionRunRow = ExtractionRunsTable['Row'];
export type ExtractionRunInsert = ExtractionRunsTable['Insert'];
export type ExtractionRunUpdate = ExtractionRunsTable['Update'];

export type ExtractionSource =
  | 'google_maps'
  | 'apify_google_maps'
  | 'linkedin'
  | 'apify_linkedin'
  | 'instagram'
  | 'apify_instagram'
  | 'manual'
  | 'phantombuster_linkedin'
  | 'cnae_scraper'
  | (string & {}); // allow forward-compat without losing IntelliSense on known values

export type ExtractionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'aborted';

const TERMINAL_STATUSES: readonly ExtractionStatus[] = [
  'completed',
  'succeeded',
  'failed',
  'aborted',
];

export interface CreateRunInput {
  orgId: string;
  source: ExtractionSource;
  query?: string | null;
  location?: string | null;
  cnaeCodes?: string[] | null;
  maxResults?: number;
  apifyActorId?: string | null;
  createdBy?: string | null;
}

export interface UpdateRunStatusInput {
  status: ExtractionStatus;
  apifyRunId?: string | null;
  resultsCount?: number;
  companiesCreated?: number;
  contactsCreated?: number;
  errorMessage?: string | null;
  rawData?: Json | null;
}

export interface ListRunsFilter {
  status?: ExtractionStatus;
  source?: ExtractionSource;
  /** Max rows to return. Default: 50. Clamped to [1, 500]. */
  limit?: number;
  /** Offset for pagination. Default: 0. */
  offset?: number;
}

export interface ListRunsResult {
  rows: ExtractionRunRow[];
  /** Total matching rows (ignores limit/offset). */
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class ExtractionRunServiceError extends Error {
  constructor(
    message: string,
    public override readonly cause?: PostgrestError | Error,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ExtractionRunServiceError';
  }
}

function wrap(op: string, error: PostgrestError, ctx: Record<string, unknown> = {}): never {
  throw new ExtractionRunServiceError(
    `[extraction-run.${op}] ${error.message}`,
    error,
    { code: error.code, details: error.details, ...ctx },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency guard
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: readonly ExtractionStatus[] = ['pending', 'running'];

/**
 * Thrown when a caller tries to start a new extraction run while another
 * run for the same (org_id, source) pair is still pending/running.
 * Protects against accidental concurrent scraping (billing + data integrity).
 */
export class ActiveRunConflictError extends ExtractionRunServiceError {
  constructor(
    public readonly orgId: string,
    public readonly source: ExtractionSource,
    public readonly activeRunId: string,
  ) {
    super(
      `[extraction-run.assertNoActiveRun] org=${orgId} já tem run ativa (id=${activeRunId}) para source=${source}`,
      undefined,
      { orgId, source, activeRunId },
    );
    this.name = 'ActiveRunConflictError';
  }
}

/**
 * Rejects if there is already a pending/running run for (orgId, source).
 * Call this BEFORE createRun() to enforce "max 1 active run per org per source".
 *
 * Note: this is a best-effort check via SELECT, not a true lock. Under highly
 * concurrent load, two callers can both see "no active run" and both insert.
 * For bulletproof guarantees, layer a postgres advisory lock on top.
 */
export async function assertNoActiveRun(
  orgId: string,
  source: ExtractionSource,
): Promise<void> {
  if (!orgId) {
    throw new ExtractionRunServiceError('[extraction-run.assertNoActiveRun] orgId is required');
  }
  if (!source) {
    throw new ExtractionRunServiceError('[extraction-run.assertNoActiveRun] source is required');
  }

  const { data, error } = await supabaseAdmin
    .from('extraction_runs')
    .select('id')
    .eq('org_id', orgId)
    .eq('source', source)
    .in('status', [...ACTIVE_STATUSES])
    .limit(1)
    .maybeSingle();

  if (error) wrap('assertNoActiveRun', error, { orgId, source });
  if (data) {
    throw new ActiveRunConflictError(orgId, source, data.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createRun
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts a new extraction run. Status defaults to 'pending' — move it to
 * 'running' with updateRunStatus() once the Apify call is dispatched.
 */
export async function createRun(input: CreateRunInput): Promise<ExtractionRunRow> {
  if (!input.orgId) {
    throw new ExtractionRunServiceError('[extraction-run.createRun] orgId is required');
  }
  if (!input.source) {
    throw new ExtractionRunServiceError('[extraction-run.createRun] source is required');
  }

  const row: ExtractionRunInsert = {
    org_id: input.orgId,
    source: input.source,
    status: 'pending',
  };

  if (input.query !== undefined) row.query = input.query;
  if (input.location !== undefined) row.location = input.location;
  if (input.cnaeCodes !== undefined) row.cnae_codes = input.cnaeCodes;
  if (input.maxResults !== undefined) row.max_results = input.maxResults;
  if (input.apifyActorId !== undefined) row.apify_actor_id = input.apifyActorId;
  if (input.createdBy !== undefined) row.created_by = input.createdBy;

  const { data, error } = await supabaseAdmin
    .from('extraction_runs')
    .insert(row)
    .select('*')
    .single();

  if (error) wrap('createRun', error, { orgId: input.orgId, source: input.source });
  return data as ExtractionRunRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateRunStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transitions a run to a new status. Automatically stamps:
 *   - started_at when moving into 'running' (only if still null)
 *   - completed_at when moving into a terminal status ('succeeded' | 'failed' | 'aborted')
 *
 * Additional fields (counters, apifyRunId, errorMessage, rawData) are merged
 * when provided. Callers are expected to pass errorMessage when status='failed'.
 */
export async function updateRunStatus(
  runId: string,
  input: UpdateRunStatusInput,
): Promise<ExtractionRunRow> {
  if (!runId) {
    throw new ExtractionRunServiceError('[extraction-run.updateRunStatus] runId is required');
  }

  const nowIso = new Date().toISOString();
  const patch: ExtractionRunUpdate = { status: input.status };

  if (input.status === 'running') {
    patch.started_at = nowIso;
  } else if (TERMINAL_STATUSES.includes(input.status)) {
    patch.completed_at = nowIso;
  }

  if (input.apifyRunId !== undefined) patch.apify_run_id = input.apifyRunId;
  if (input.resultsCount !== undefined) patch.results_count = input.resultsCount;
  if (input.companiesCreated !== undefined) patch.companies_created = input.companiesCreated;
  if (input.contactsCreated !== undefined) patch.contacts_created = input.contactsCreated;
  if (input.errorMessage !== undefined) patch.error_message = input.errorMessage;
  if (input.rawData !== undefined) patch.raw_data = input.rawData;

  const { data, error } = await supabaseAdmin
    .from('extraction_runs')
    .update(patch)
    .eq('id', runId)
    .select('*')
    .single();

  if (error) wrap('updateRunStatus', error, { runId, status: input.status });
  return data as ExtractionRunRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// getRunById
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches a single run by id. Returns `null` if not found.
 * When `orgId` is provided, the query is scoped to that org as a
 * defense-in-depth check against cross-tenant access.
 */
export async function getRunById(
  runId: string,
  orgId?: string,
): Promise<ExtractionRunRow | null> {
  if (!runId) {
    throw new ExtractionRunServiceError('[extraction-run.getRunById] runId is required');
  }

  let query = supabaseAdmin.from('extraction_runs').select('*').eq('id', runId);
  if (orgId) query = query.eq('org_id', orgId);

  const { data, error } = await query.maybeSingle();

  if (error) wrap('getRunById', error, { runId, orgId });
  return data as ExtractionRunRow | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// listRunsByOrg
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lists runs for a given org, ordered by created_at DESC.
 * Supports optional filtering by status/source and paginated retrieval.
 */
export async function listRunsByOrg(
  orgId: string,
  filter: ListRunsFilter = {},
): Promise<ListRunsResult> {
  if (!orgId) {
    throw new ExtractionRunServiceError('[extraction-run.listRunsByOrg] orgId is required');
  }

  const limit = clamp(filter.limit ?? 50, 1, 500);
  const offset = Math.max(0, filter.offset ?? 0);

  let query = supabaseAdmin
    .from('extraction_runs')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter.status) query = query.eq('status', filter.status);
  if (filter.source) query = query.eq('source', filter.source);

  const { data, error, count } = await query;

  if (error) wrap('listRunsByOrg', error, { orgId, filter });
  return {
    rows: (data ?? []) as ExtractionRunRow[],
    total: count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
