/**
 * Google Maps Extractor Service
 * Story: E-02.03 — Google Maps Extractor Orchestration
 *
 * Orquestra uma extração do Google Maps unindo `ApifyClient` (E-02.01) com o
 * `ExtractionRunService` (E-02.02). Fluxo completo:
 *
 *   [A] createRun         → persiste a run em status 'pending'
 *   [B] updateRunStatus   → transita para 'running' (carimba started_at)
 *   [C] runActor          → dispara o Actor `compass/crawler-google-places`
 *   [D] waitForRun + ds   → polling até terminal + coleta do dataset
 *   [E] updateRunStatus   → 'succeeded' com resultsCount, apifyRunId e rawData
 *   [F] catch             → 'failed' com error_message, re-throw do erro original
 *
 * ⚠️  Nesta story ainda NÃO fazemos persistência de companies/contacts.
 *     O mapeamento dos `GoogleMapsPlace` crus para entidades do CRM é escopo
 *     de E-02.03b (Mapping + Dedup). Aqui entregamos apenas o ciclo de vida
 *     da run + os itens brutos do dataset Apify prontos para consumo.
 */

import {
  ApifyError,
  getApifyClient,
  type ApifyDatasetItem,
  type ApifyRun,
} from './apify-client.js';
import {
  createRun,
  updateRunStatus,
  type ExtractionRunRow,
} from './extraction-run.service.js';
import type { Json } from '../types/database.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_MAPS_ACTOR_ID = 'compass/crawler-google-places';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape parcial dos itens retornados pelo actor `compass/crawler-google-places`.
 * Propositalmente tolerante: todos os campos são opcionais e o index signature
 * permite acessar payload adicional sem lutar com o tipo. O mapeamento estrito
 * para `Company` acontece na próxima story.
 */
export interface GoogleMapsPlace extends ApifyDatasetItem {
  title?: string;
  placeId?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  categoryName?: string;
  totalScore?: number;
  reviewsCount?: number;
  location?: { lat: number; lng: number };
}

export interface ExtractGoogleMapsInput {
  orgId: string;
  query: string;
  maxResults: number;
  /** Opcional: usuário que disparou a extração (FK profiles.id). */
  createdBy?: string | null;
  /** Opcional: contexto geográfico passado ao actor (ex.: "São Paulo, SP, Brasil"). */
  location?: string | null;
  /** Opcional: idioma dos resultados. Default: 'pt-BR'. */
  language?: string;
  /** Opcional: country code do Google Maps. Default: 'br'. */
  countryCode?: string;
}

export interface ExtractGoogleMapsResult {
  run: ExtractionRunRow;
  items: GoogleMapsPlace[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa uma extração completa do Google Maps ponta-a-ponta.
 *
 * Em caso de falha (banco ou Apify), a run é marcada como `failed` com a
 * mensagem de erro — mas o erro original é re-lançado para o caller tratar.
 */
export async function extractGoogleMaps(
  input: ExtractGoogleMapsInput,
): Promise<ExtractGoogleMapsResult> {
  validateInput(input);

  // [A] Insere a run em pending.
  const pending = await createRun({
    orgId: input.orgId,
    source: 'google_maps',
    query: input.query,
    location: input.location ?? null,
    maxResults: input.maxResults,
    apifyActorId: GOOGLE_MAPS_ACTOR_ID,
    createdBy: input.createdBy ?? null,
  });

  try {
    // [B] Transita para running (carimba started_at).
    await updateRunStatus(pending.id, { status: 'running' });

    // [C] + [D] Dispara o actor, faz polling até terminal e coleta dataset.
    const actorInput = buildActorInput(input);
    const start = Date.now();
    const { run: apifyRun, items } = await getApifyClient().runAndCollect<GoogleMapsPlace>(
      GOOGLE_MAPS_ACTOR_ID,
      actorInput,
    );
    const durationMs = Date.now() - start;

    // [E] Marca sucesso com counters + apifyRunId + rawData sintético.
    const finalRun = await updateRunStatus(pending.id, {
      status: 'succeeded',
      apifyRunId: apifyRun.id,
      resultsCount: items.length,
      rawData: buildRawData(apifyRun, items.length, durationMs),
    });

    return { run: finalRun, items };
  } catch (err) {
    // [F] Marca failed preservando a mensagem — re-throw para o caller decidir.
    //     Se o próprio update falhar (DB off), logamos mas não mascaramos o erro raiz.
    await updateRunStatus(pending.id, {
      status: 'failed',
      errorMessage: toErrorMessage(err),
    }).catch((updateErr: unknown) => {
      console.error(
        '[google-maps-extractor] falha ao marcar run como failed:',
        updateErr,
      );
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateInput(input: ExtractGoogleMapsInput): void {
  if (!input.orgId) {
    throw new Error('[google-maps-extractor] orgId é obrigatório');
  }
  if (!input.query || !input.query.trim()) {
    throw new Error('[google-maps-extractor] query é obrigatória');
  }
  if (!Number.isFinite(input.maxResults) || input.maxResults <= 0) {
    throw new Error('[google-maps-extractor] maxResults precisa ser um número positivo');
  }
}

function buildActorInput(input: ExtractGoogleMapsInput): Record<string, unknown> {
  const actorInput: Record<string, unknown> = {
    searchStringsArray: [input.query],
    maxCrawledPlacesPerSearch: input.maxResults,
    language: input.language ?? 'pt-BR',
    countryCode: input.countryCode ?? 'br',
  };
  if (input.location) {
    actorInput['locationQuery'] = input.location;
  }
  return actorInput;
}

function buildRawData(apifyRun: ApifyRun, itemCount: number, durationMs: number): Json {
  const raw: { [key: string]: Json | undefined } = {
    actorId: GOOGLE_MAPS_ACTOR_ID,
    apifyRunId: apifyRun.id,
    apifyStatus: apifyRun.status,
    startedAt: apifyRun.startedAt,
    finishedAt: apifyRun.finishedAt,
    itemCount,
    durationMs,
    stats: {
      inputBodyLen: apifyRun.stats.inputBodyLen,
      restartCount: apifyRun.stats.restartCount,
      durationMillis: apifyRun.stats.durationMillis,
    },
  };
  return raw;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof ApifyError) {
    const parts: string[] = [`ApifyError: ${err.message}`];
    if (err.statusCode !== undefined) parts.push(`status=${err.statusCode}`);
    if (err.runId !== undefined) parts.push(`apifyRunId=${err.runId}`);
    return parts.join(' | ');
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
