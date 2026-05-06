/**
 * Apify Client Service
 * Story: E-02.01 — Apify Client Service
 *
 * Encapsulates all communication with the Apify API.
 * Provides actor execution, run polling, and dataset retrieval
 * with built-in retry, rate-limit handling, and structured logging.
 */

import { env } from '../lib/env.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ApifyRunStatus =
  | 'READY'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMING-OUT'
  | 'TIMED-OUT'
  | 'ABORTING'
  | 'ABORTED';

export interface ApifyRun {
  id: string;
  actId: string;
  status: ApifyRunStatus;
  startedAt: string;
  finishedAt: string | null;
  defaultDatasetId: string;
  defaultKeyValueStoreId: string;
  stats: {
    inputBodyLen: number;
    restartCount: number;
    durationMillis: number;
  };
}

export interface ApifyDatasetItem {
  [key: string]: unknown;
}

export interface ApifyDatasetPage<T = ApifyDatasetItem> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  count: number;
}

export interface WaitForRunOptions {
  /** Polling interval in ms. Default: 3000 */
  intervalMs?: number;
  /** Max wait time in ms. Default: 300_000 (5 min) */
  timeoutMs?: number;
}

export class ApifyError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly runId?: string,
  ) {
    super(message);
    this.name = 'ApifyError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const MAX_RETRIES = 3;
const TERMINAL_STATUSES: ApifyRunStatus[] = ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'];

export class ApifyClient {
  private readonly token: string;

  constructor(token?: string) {
    this.token = token ?? env.APIFY_API_TOKEN;
  }

  // ─── Actor Execution ──────────────────────────────────────────────────────

  /**
   * Starts an Apify Actor run asynchronously.
   * Returns the run metadata immediately without waiting for completion.
   */
  async runActor(actorId: string, input: Record<string, unknown>): Promise<ApifyRun> {
    const start = Date.now();
    const run = await this.request<{ data: ApifyRun }>(
      'POST',
      `/acts/${encodeURIComponent(actorId)}/runs`,
      { body: input },
    );
    this.log('actor_started', { actorId, runId: run.data.id, durationMs: Date.now() - start });
    return run.data;
  }

  /**
   * Returns the current status of a run without waiting.
   */
  async getActorRunStatus(runId: string): Promise<ApifyRun> {
    const result = await this.request<{ data: ApifyRun }>('GET', `/actor-runs/${runId}`);
    return result.data;
  }

  /**
   * Polls a run until it reaches a terminal status (SUCCEEDED | FAILED | TIMED-OUT | ABORTED).
   * Throws ApifyError if the run fails or the local timeout is exceeded.
   */
  async waitForRun(runId: string, options: WaitForRunOptions = {}): Promise<ApifyRun> {
    const { intervalMs = 3_000, timeoutMs = 300_000 } = options;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const run = await this.getActorRunStatus(runId);
      this.log('run_polled', { runId, status: run.status });

      if (TERMINAL_STATUSES.includes(run.status)) {
        if (run.status !== 'SUCCEEDED') {
          throw new ApifyError(`Actor run ended with status: ${run.status}`, undefined, runId);
        }
        return run;
      }

      await sleep(intervalMs);
    }

    throw new ApifyError(`Timed out waiting for run ${runId} after ${timeoutMs}ms`, undefined, runId);
  }

  // ─── Dataset ──────────────────────────────────────────────────────────────

  /**
   * Retrieves items from an Apify dataset with pagination.
   *
   * Apify's `/datasets/{id}/items` returns the items as a raw JSON array in the
   * body and pagination metadata in `X-Apify-Pagination-*` response headers
   * (not wrapped in the usual `{ data: ... }` envelope).
   */
  async getDataset<T = ApifyDatasetItem>(
    datasetId: string,
    { offset = 0, limit = 1000 }: { offset?: number; limit?: number } = {},
  ): Promise<ApifyDatasetPage<T>> {
    const response = await this.rawRequest(
      'GET',
      `/datasets/${datasetId}/items`,
      { params: { offset: String(offset), limit: String(limit), format: 'json' } },
    );

    const items = (await response.json()) as T[];
    const total = Number(response.headers.get('x-apify-pagination-total') ?? items.length);
    const count = Number(response.headers.get('x-apify-pagination-count') ?? items.length);
    const respOffset = Number(response.headers.get('x-apify-pagination-offset') ?? offset);
    const respLimit = Number(response.headers.get('x-apify-pagination-limit') ?? limit);

    this.log('dataset_fetched', { datasetId, count, offset: respOffset, total });
    return { items, total, offset: respOffset, limit: respLimit, count };
  }

  /**
   * Retrieves ALL items from a dataset, handling pagination automatically.
   *
   * Stop criterion is `items.length < limit` (last page) — we intentionally do
   * NOT rely on `X-Apify-Pagination-Total` because the Apify API propagates
   * that header asynchronously and it can report `0` for a few seconds after
   * a run completes, even when the body already contains items.
   */
  async getAllDatasetItems<T = ApifyDatasetItem>(datasetId: string): Promise<T[]> {
    const items: T[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const page = await this.getDataset<T>(datasetId, { offset, limit });
      items.push(...page.items);
      if (page.items.length < limit) break;
      offset += limit;
    }

    return items;
  }

  // ─── Run + Wait convenience method ───────────────────────────────────────

  /**
   * Runs an Actor and waits for completion, returning all dataset items.
   * This is the primary method used by extractor services.
   */
  async runAndCollect<T = ApifyDatasetItem>(
    actorId: string,
    input: Record<string, unknown>,
    waitOptions?: WaitForRunOptions,
  ): Promise<{ run: ApifyRun; items: T[] }> {
    const run = await this.runActor(actorId, input);
    const finishedRun = await this.waitForRun(run.id, waitOptions);
    const items = await this.getAllDatasetItems<T>(finishedRun.defaultDatasetId);
    this.log('run_collected', { actorId, runId: run.id, itemCount: items.length });
    return { run: finishedRun, items };
  }

  // ─── HTTP layer ───────────────────────────────────────────────────────────

  /**
   * Executes an HTTP request with retry on 429/503 and returns the raw Response.
   * Use this when you need access to response headers (e.g. dataset pagination).
   */
  private async rawRequest(
    method: string,
    path: string,
    options: { body?: unknown; params?: Record<string, string> } = {},
    attempt = 1,
  ): Promise<Response> {
    const url = new URL(`${APIFY_BASE_URL}${path}`);
    url.searchParams.set('token', this.token);

    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, value);
      }
    }

    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(url.toString(), init);

    // Retry on 429 and 503
    if ((response.status === 429 || response.status === 503) && attempt <= MAX_RETRIES) {
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      this.log('retry', { path, status: response.status, attempt, backoffMs });
      await sleep(backoffMs);
      return this.rawRequest(method, path, options, attempt + 1);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ApifyError(
        `Apify API error ${response.status}: ${text}`,
        response.status,
      );
    }

    return response;
  }

  /**
   * Convenience wrapper: executes a request and parses the body as JSON.
   */
  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; params?: Record<string, string> } = {},
  ): Promise<T> {
    const response = await this.rawRequest(method, path, options);
    return response.json() as Promise<T>;
  }

  // ─── Logging ─────────────────────────────────────────────────────────────

  private log(event: string, meta: Record<string, unknown>) {
    console.log(JSON.stringify({ service: 'apify-client', event, ...meta, ts: new Date().toISOString() }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

let _client: ApifyClient | undefined;

/**
 * Returns a singleton ApifyClient instance.
 * Initializes on first call using APIFY_API_TOKEN from env.
 */
export function getApifyClient(): ApifyClient {
  if (!_client) {
    _client = new ApifyClient();
  }
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
