-- ============================================================================
-- 0144 — PONTE DE DADOS AIOS: companies, deals, linkedin_threads
--
-- Fusão do modelo de dados do Módulo de Tráfego AIOS (backend Hono, `src/`)
-- com o chassi DeskcommCRM. O contrato vem de `src/types/database.ts` (tipos
-- que o Hono já compila contra) — o banco é que estava atrás. Nada do chassi
-- é alterado: só três tabelas NOVAS, aditivas, tenant-aware.
--
-- Decisões de fusão (as FKs do contrato citavam tabelas que o chassi não tem):
--   • `profiles`        → não existe no chassi; owner_id referencia `auth.users`.
--   • `pipelines`       → chassi usa `crm_pipelines`; FK re-apontada.
--   • `pipeline_stages` → chassi usa `crm_stages`; FK re-apontada.
--   Os NOMES das constraints seguem o padrão `<tabela>_<coluna>_fkey` que o
--   types cita — o alvo muda, o nome não. Nenhum select do Hono usa embed
--   PostgREST por relação, então o re-apontamento é invisível ao código atual.
--
-- Desvios conscientes da doutrina do chassi (contrato AIOS herdado):
--   • Coluna de tenant chama `org_id` (não `organization_id`) — o módulo Hono
--     inteiro fala `org_id`; renomear quebraria todo `src/`. A RLS usa o MESMO
--     helper `fn_user_org_ids()` do chassi, então o isolamento é idêntico.
--   • `deals.value numeric` + `currency` (não `_cents`) — contrato AIOS.
--   • `deals.status` e `companies.status` sem CHECK — vocabulário aberto
--     (exceção deliberada da doutrina; vocabulário vive no TypeScript).
--
-- Idempotência/dedup (doutrina de external_id):
--   • unique parcial (org_id, google_place_id) — chave de dedup do
--     google-maps-mapper.service.ts.
--   • unique parcial (org_id, linkedin_thread_id) — id externo do LinkedIn.
--
-- Segurança (lição da 0143): tabela nova nasce concedida a `anon` pelo
-- `ALTER DEFAULT PRIVILEGES` do baseline. Estas três não têm caminho anônimo
-- — `revoke all from anon`, além da RLS `tenant_isolation_*_all`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id                      uuid default gen_random_uuid() not null,
  org_id                  uuid not null,
  owner_id                uuid,
  name                    text not null,
  domain                  text,
  website                 text,
  city                    text,
  country                 text,
  industry                text,
  size_range              text,
  annual_revenue          numeric,
  description             text,
  logo_url                text,
  cnpj                    text,
  cnae_code               text,
  cnae_description        text,
  google_place_id         text,
  apify_run_id            text,
  linkedin_url            text,
  linkedin_company_id     text,
  linkedin_employee_count integer,
  linkedin_followers      integer,
  linkedin_scraped_at     timestamptz,
  meta_campaign_id        text,
  meta_adset_id           text,
  meta_ad_id              text,
  traffic_source          text,
  lead_origin             text,
  source                  text,
  status                  text,
  deal_value              numeric,
  tags                    text[] default '{}'::text[] not null,
  enrichment_data         jsonb default '{}'::jsonb not null,
  enriched_at             timestamptz,
  embedding               public.vector(1536),
  is_deleted              boolean default false not null,
  created_at              timestamptz default now() not null,
  updated_at              timestamptz default now() not null,
  constraint companies_pkey primary key (id),
  constraint companies_org_id_fkey foreign key (org_id)
    references public.organizations(id) on delete cascade,
  constraint companies_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete set null
);

comment on table public.companies is
  'Empresa (conta B2B) no escopo do tenant. Origem: Módulo de Tráfego AIOS (Google Maps/LinkedIn/Meta). Dedup por (org_id, google_place_id).';

create unique index if not exists companies_org_place_id_uniq
  on public.companies (org_id, google_place_id) where google_place_id is not null;
create index if not exists companies_org_id_idx on public.companies (org_id);
create index if not exists companies_org_domain_idx
  on public.companies (org_id, domain) where domain is not null;
create index if not exists companies_tags_gin_idx on public.companies using gin (tags);

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
create table if not exists public.deals (
  id                   uuid default gen_random_uuid() not null,
  org_id               uuid not null,
  company_id           uuid,
  owner_id             uuid,
  pipeline_id          uuid not null,
  stage_id             uuid not null,
  title                text not null,
  value                numeric default 0 not null,
  currency             text default 'BRL' not null,
  status               text default 'open' not null,
  probability          integer,
  expected_close       date,
  actual_close         date,
  lost_reason          text,
  source               text,
  sentiment_score      numeric,
  sentiment_state      text,
  sentiment_updated_at timestamptz,
  sniper_score         numeric,
  sniper_updated_at    timestamptz,
  last_activity_at     timestamptz,
  tags                 text[] default '{}'::text[] not null,
  custom_fields        jsonb default '{}'::jsonb not null,
  is_deleted           boolean default false not null,
  created_at           timestamptz default now() not null,
  updated_at           timestamptz default now() not null,
  constraint deals_pkey primary key (id),
  constraint deals_org_id_fkey foreign key (org_id)
    references public.organizations(id) on delete cascade,
  constraint deals_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete set null,
  constraint deals_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete set null,
  constraint deals_pipeline_id_fkey foreign key (pipeline_id)
    references public.crm_pipelines(id) on delete restrict,
  constraint deals_stage_id_fkey foreign key (stage_id)
    references public.crm_stages(id) on delete restrict,
  constraint deals_probability_range
    check (probability is null or (probability >= 0 and probability <= 100)),
  constraint deals_currency_iso4217 check (currency ~ '^[A-Z]{3}$')
);

comment on table public.deals is
  'Negócio/oportunidade B2B (Módulo AIOS) sobre o funil do chassi (crm_pipelines/crm_stages). value+currency por contrato AIOS.';

create index if not exists deals_org_id_idx on public.deals (org_id);
create index if not exists deals_org_pipeline_stage_idx
  on public.deals (org_id, pipeline_id, stage_id);
create index if not exists deals_company_id_idx
  on public.deals (company_id) where company_id is not null;
create index if not exists deals_tags_gin_idx on public.deals using gin (tags);

-- ---------------------------------------------------------------------------
-- linkedin_threads
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_threads (
  id                 uuid default gen_random_uuid() not null,
  org_id             uuid not null,
  contact_id         uuid,
  deal_id            uuid,
  owner_id           uuid,
  linkedin_thread_id text,
  message_count      integer default 0 not null,
  last_message_at    timestamptz,
  sentiment_score    numeric,
  sentiment_state    text,
  created_at         timestamptz default now() not null,
  updated_at         timestamptz default now() not null,
  constraint linkedin_threads_pkey primary key (id),
  constraint linkedin_threads_org_id_fkey foreign key (org_id)
    references public.organizations(id) on delete cascade,
  constraint linkedin_threads_contact_id_fkey foreign key (contact_id)
    references public.contacts(id) on delete set null,
  constraint linkedin_threads_deal_id_fkey foreign key (deal_id)
    references public.deals(id) on delete set null,
  constraint linkedin_threads_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete set null
);

comment on table public.linkedin_threads is
  'Thread de conversa LinkedIn amarrada a contato/negócio do tenant. Dedup por (org_id, linkedin_thread_id).';

create unique index if not exists linkedin_threads_org_external_uniq
  on public.linkedin_threads (org_id, linkedin_thread_id)
  where linkedin_thread_id is not null;
create index if not exists linkedin_threads_org_id_idx on public.linkedin_threads (org_id);
create index if not exists linkedin_threads_contact_id_idx
  on public.linkedin_threads (contact_id) where contact_id is not null;
create index if not exists linkedin_threads_deal_id_idx
  on public.linkedin_threads (deal_id) where deal_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at (helper canônico do chassi)
-- ---------------------------------------------------------------------------
create or replace trigger companies_updated_at
  before update on public.companies
  for each row execute function public.fn_set_updated_at();
create or replace trigger deals_updated_at
  before update on public.deals
  for each row execute function public.fn_set_updated_at();
create or replace trigger linkedin_threads_updated_at
  before update on public.linkedin_threads
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — mesmo helper e mesma forma do chassi (tenant_isolation_<t>_all)
-- ---------------------------------------------------------------------------
alter table public.companies        enable row level security;
alter table public.deals            enable row level security;
alter table public.linkedin_threads enable row level security;

drop policy if exists tenant_isolation_companies_all on public.companies;
create policy tenant_isolation_companies_all on public.companies
  using ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin())
  with check ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_deals_all on public.deals;
create policy tenant_isolation_deals_all on public.deals
  using ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin())
  with check ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin());

drop policy if exists tenant_isolation_linkedin_threads_all on public.linkedin_threads;
create policy tenant_isolation_linkedin_threads_all on public.linkedin_threads
  using ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin())
  with check ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin());

-- ---------------------------------------------------------------------------
-- anon fora (precedente 0123/0143: tabela nova nasce concedida)
-- ---------------------------------------------------------------------------
revoke all on table public.companies        from anon;
revoke all on table public.deals            from anon;
revoke all on table public.linkedin_threads from anon;

notify pgrst, 'reload schema';
