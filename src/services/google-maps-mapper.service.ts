/**
 * Google Maps Mapper Service
 * Story: E-02.03b — Mapping + Dedup
 *
 * Recebe os `GoogleMapsPlace` crus do orquestrador (E-02.03) e persiste em
 * `companies` + `contacts` aplicando deduplicação SKIP por `google_place_id`
 * scopado por `org_id`.
 *
 * Regras de negócio:
 *   • Dedup primário: `(org_id, google_place_id)` — se já existe, skip total
 *     (nem atualiza nem cria contact). Fallback por website/telefone NÃO é
 *     implementado nesta iteração — `placeId` é a fonte única da verdade.
 *   • Places sem `placeId` são pulados (sem chave de dedup = risco de duplicar).
 *   • Contact só é criado se o telefone raspado chegar a E.164 (ver `toE164`) —
 *     evita "Contato" órfão sem nenhum canal real. Telefone ambíguo é
 *     reportado em `errors[]`, nunca descartado em silêncio.
 *   • `contacts` é a tabela CANÔNICA do chassi (migration 0145): a pessoa
 *     raspada nasce alcançável por WhatsApp, funil e agente. Por isso as
 *     colunas aqui são `organization_id`/`name`/`phone_number` — e não o
 *     `org_id`/`first_name`/`phone` do modelo AIOS antigo. `companies`, essa
 *     sim AIOS-nativa, segue com `org_id`.
 *   • Erros por place são isolados: um INSERT que falhar não para o loop;
 *     a falha é agregada em `errors[]` para o caller decidir o que fazer.
 */

import type { PostgrestError } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase.js';
import type { Database } from '../types/database.js';
import type { GoogleMapsPlace } from './google-maps-extractor.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type CompaniesTable = Database['public']['Tables']['companies'];
type ContactsTable = Database['public']['Tables']['contacts'];
type CompanyInsert = CompaniesTable['Insert'];
type ContactInsert = ContactsTable['Insert'];
type CompanyRow = CompaniesTable['Row'];

export interface MapGoogleMapsInput {
  orgId: string;
  /** Apify run id (para rastreabilidade em `companies.apify_run_id`). */
  apifyRunId: string;
  places: GoogleMapsPlace[];
  /** Opcional: profile.id do dono/criador das rows (companies.owner_id). */
  createdBy?: string | null;
}

export interface MappingError {
  placeId: string | null;
  title: string | undefined;
  message: string;
}

export interface MapGoogleMapsResult {
  companiesCreated: number;
  companiesSkipped: number;
  contactsCreated: number;
  errors: MappingError[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function mapGoogleMapsResults(
  input: MapGoogleMapsInput,
): Promise<MapGoogleMapsResult> {
  if (!input.orgId) throw new Error('[google-maps-mapper] orgId é obrigatório');
  if (!input.apifyRunId) throw new Error('[google-maps-mapper] apifyRunId é obrigatório');

  const result: MapGoogleMapsResult = {
    companiesCreated: 0,
    companiesSkipped: 0,
    contactsCreated: 0,
    errors: [],
  };

  for (const place of input.places) {
    const placeId = place.placeId ?? null;

    // Places sem placeId são pulados — sem chave de dedup.
    if (!placeId) {
      result.companiesSkipped += 1;
      result.errors.push({
        placeId: null,
        title: place.title,
        message: 'place sem placeId — pulado (dedup requer chave estável)',
      });
      continue;
    }

    try {
      // Dedup primário: já existe company para (org_id, google_place_id)?
      const existing = await findExistingByPlaceId(input.orgId, placeId);
      if (existing) {
        result.companiesSkipped += 1;
        continue;
      }

      // Insert company.
      const company = await insertCompany({
        orgId: input.orgId,
        apifyRunId: input.apifyRunId,
        createdBy: input.createdBy ?? null,
        place,
        placeId,
      });
      result.companiesCreated += 1;

      // Insert contact se o telefone raspado chegar a E.164 — ver toE164().
      const rawPhone = readRawPhone(place);
      const phone = toE164(rawPhone);
      if (phone) {
        await insertContact({
          orgId: input.orgId,
          apifyRunId: input.apifyRunId,
          createdBy: input.createdBy ?? null,
          companyId: company.id,
          companyName: company.name,
          phone,
        });
        result.contactsCreated += 1;
      } else if (rawPhone) {
        // Telefone existe mas é ambíguo. A company fica; o contato não nasce
        // sem canal. Reportado para não sumir em silêncio.
        result.errors.push({
          placeId,
          title: place.title,
          message: `telefone "${rawPhone}" não é E.164 — contato não criado (empresa mantida)`,
        });
      }
    } catch (err) {
      result.errors.push({
        placeId,
        title: place.title,
        message: toErrorMessage(err),
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB ops
// ─────────────────────────────────────────────────────────────────────────────

async function findExistingByPlaceId(
  orgId: string,
  placeId: string,
): Promise<Pick<CompanyRow, 'id'> | null> {
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('org_id', orgId)
    .eq('google_place_id', placeId)
    .maybeSingle();

  if (error) {
    throw new Error(`[google-maps-mapper.findExisting] ${error.message}`);
  }
  return data;
}

interface InsertCompanyArgs {
  orgId: string;
  apifyRunId: string;
  createdBy: string | null;
  place: GoogleMapsPlace;
  placeId: string;
}

async function insertCompany(
  args: InsertCompanyArgs,
): Promise<Pick<CompanyRow, 'id' | 'name'>> {
  const { place } = args;

  const row: CompanyInsert = {
    org_id: args.orgId,
    name: (place.title ?? 'Empresa sem nome').trim() || 'Empresa sem nome',
    google_place_id: args.placeId,
    apify_run_id: args.apifyRunId,
    source: 'apify_google_maps',
  };

  const domain = extractDomain(place.website);
  if (domain) row.domain = domain;
  if (place.website) row.website = place.website;
  if (place.city) row.city = place.city;
  if (place.countryCode) row.country = place.countryCode;

  const tags = buildTags(place);
  if (tags.length > 0) row.tags = tags;

  if (args.createdBy) row.owner_id = args.createdBy;

  const { data, error } = await supabaseAdmin
    .from('companies')
    .insert(row)
    .select('id, name')
    .single();

  if (error) {
    throw new Error(`[google-maps-mapper.insertCompany] ${formatPgError(error)}`);
  }
  return data;
}

interface InsertContactArgs {
  orgId: string;
  apifyRunId: string;
  createdBy: string | null;
  companyId: string;
  companyName: string;
  phone: string;
}

async function insertContact(args: InsertContactArgs): Promise<void> {
  const row: ContactInsert = {
    organization_id: args.orgId,
    company_id: args.companyId,
    name: `Contato ${args.companyName}`,
    phone_number: args.phone,
    preferred_channel: 'phone',
    source: 'apify_google_maps',
    apify_run_id: args.apifyRunId,
  };

  if (args.createdBy) row.created_by_user_id = args.createdBy;

  const { error } = await supabaseAdmin.from('contacts').insert(row);

  if (error) {
    throw new Error(`[google-maps-mapper.insertContact] ${formatPgError(error)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrai o domínio canônico de uma URL. Retorna `null` se a URL for inválida
 * ou se for um agregador conhecido (linktr.ee, bit.ly, etc.) — esses apontam
 * para múltiplas empresas e não servem como chave de empresa.
 */
const AGGREGATOR_HOSTS: ReadonlySet<string> = new Set([
  'linktr.ee',
  'bit.ly',
  't.co',
  'goo.gl',
  'tinyurl.com',
  'lnk.bio',
  'beacons.ai',
]);

function extractDomain(websiteRaw: string | undefined): string | null {
  if (!websiteRaw) return null;
  try {
    const url = new URL(websiteRaw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    if (AGGREGATOR_HOSTS.has(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function readRawPhone(place: GoogleMapsPlace): string | null {
  const unformatted = readString(place, 'phoneUnformatted');
  if (unformatted && unformatted.trim()) return unformatted.trim();

  const formatted = typeof place.phone === 'string' ? place.phone.trim() : '';
  if (formatted) return formatted;

  return null;
}

/**
 * Telefone raspado → E.164 canônico, ou `null` quando ambíguo.
 *
 * Espelha `public.fn_e164_or_null()` (migration 0145) — as duas pontas aplicam
 * a MESMA regra, e `contacts.phone_number` tem CHECK `^\+\d{8,15}$`.
 *
 * Só normaliza o que já é internacional (tem `+`). Número nacional
 * ("(11) 3000-0000") devolve null em vez de virar "+1130000000": prefixar `+`
 * sem código de país produz E.164 de formato válido e destino ERRADO, e o
 * WhatsApp sairia para um estranho. Sem telefone é melhor que telefone errado.
 */
function toE164(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.trim().startsWith('+')) return null;
  const candidate = `+${raw.replace(/\D/g, '')}`;
  return /^\+\d{8,15}$/.test(candidate) ? candidate : null;
}

function buildTags(place: GoogleMapsPlace): string[] {
  const tags: string[] = [];
  const categories = readStringArray(place, 'categories');
  if (categories) {
    for (const c of categories) {
      const trimmed = c.trim();
      if (trimmed) tags.push(trimmed);
    }
  } else if (place.categoryName && place.categoryName.trim()) {
    tags.push(place.categoryName.trim());
  }
  return tags;
}

/**
 * Leitor tipado para campos que estendem o index signature de `GoogleMapsPlace`
 * (`[key: string]: unknown`). Retorna string ou undefined, nunca lança.
 */
function readString(obj: GoogleMapsPlace, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function readStringArray(obj: GoogleMapsPlace, key: string): string[] | undefined {
  const v = obj[key];
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

function formatPgError(error: PostgrestError): string {
  return `${error.code ?? 'PG'}: ${error.message}${error.details ? ` (${error.details})` : ''}`;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
