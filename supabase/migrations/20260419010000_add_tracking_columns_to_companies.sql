-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Tracking columns para dedup de extrações Google Maps
-- Story:     E-02.03b — Google Maps Mapper (dedup por google_place_id)
-- Context:   Adiciona `google_place_id` em `companies` e um índice UNIQUE
--            escopado por `org_id` — permite que orgs diferentes persistam
--            o mesmo place (multi-tenant correto), mas bloqueia duplicatas
--            internas a uma org.
--
--            `apify_run_id` já existe nas duas tabelas desde a migration
--            inicial (20260330000000, linhas 96 e 131) — documentamos aqui
--            por completude.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Nova coluna `google_place_id` em `companies` (idempotente).
alter table public.companies
  add column if not exists google_place_id varchar(255);

-- 2. Índice UNIQUE scopado por org_id. WHERE IS NOT NULL permite múltiplas
--    companies sem place_id (ex.: criadas manualmente) coexistirem.
create unique index if not exists companies_org_google_place_id_uidx
  on public.companies (org_id, google_place_id)
  where google_place_id is not null;

-- 3. Índice de lookup para queries de dedup (coluna sozinha — plan analyzer
--    pode preferir sobre o UNIQUE composto em WHERE com só google_place_id).
create index if not exists companies_google_place_id_idx
  on public.companies (google_place_id)
  where google_place_id is not null;

-- 4. `apify_run_id` já existe em `companies` e `contacts` desde a migration
--    inicial. Apenas garantimos o índice para queries de auditoria por run.
create index if not exists companies_apify_run_id_idx
  on public.companies (apify_run_id)
  where apify_run_id is not null;

create index if not exists contacts_apify_run_id_idx
  on public.contacts (apify_run_id)
  where apify_run_id is not null;
