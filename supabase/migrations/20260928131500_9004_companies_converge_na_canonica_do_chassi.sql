-- ============================================================================
-- 9004 — `companies` CONVERGE: a tabela canônica é a do chassi (upstream 0448)
--
-- Sincronização com o upstream DeskcommCRM v1.80.0 (2026-10-14). Decisão do
-- CEO: "upstream canônico" — o mesmo princípio que a 9002 aplicou a `contacts`.
--
-- ── O conflito ──────────────────────────────────────────────────────────────
--
-- A 9001 (ponte AIOS) criou `public.companies` com o contrato do Hono:
-- `org_id`, `name`, `cnae_code`, colunas de Google Maps/LinkedIn/Meta. O
-- upstream criou, na 0448 (módulo CRM B2B, desligado por padrão), uma
-- `public.companies` DIFERENTE com o MESMO nome: `organization_id`,
-- `legal_name`/`trade_name`, `normalized_cnpj`, endereço da Receita. As duas não
-- coexistem: a que chega primeiro vence o `create table if not exists`, e a
-- outra quebra no primeiro índice (`organization_id` ou `org_id` inexistente)
-- — no `install.sh`, que roda com `ON_ERROR_STOP=1`, isso é instalação morta.
--
-- ── A convergência, campo a campo (DIRC) ────────────────────────────────────
--
--   org_id            -> organization_id  RENOMEADA (mesmo fato; a chave de
--                        tenant do chassi — nunca as duas lado a lado, pelo
--                        mesmo motivo de segurança documentado na 9002)
--   name              -> trade_name       RENOMEADA (o nome que o AIOS raspa do
--                        Google Maps/LinkedIn é o nome FANTASIA; a razão social
--                        `legal_name` é fato da Receita, que só o B2B traz).
--                        Perde o NOT NULL: o B2B cria empresa só com CNPJ.
--   cnae_code         -> main_cnae_code         RENOMEADA (mesmo fato)
--   cnae_description  -> main_cnae_description  RENOMEADA (mesmo fato)
--   cnpj, city, enriched_at, id, created_at, updated_at   — já iguais
--   owner_id          FICA (dono comercial ≠ `created_by`, quem cadastrou)
--   size_range        FICA (faixa de funcionários do LinkedIn ≠ `company_size`,
--                        o porte ME/EPP da Receita)
--   enrichment_data   FICA (enriquecimento genérico AIOS ≠ `brasilapi_raw`)
--   demais colunas AIOS (domain, website, google_place_id, linkedin_*, meta_*,
--                        tags, embedding, …) FICAM como colunas aditivas
--
-- ── Por que o timestamp é 20260928131500 ────────────────────────────────────
--
-- Logo ANTES da 0448 (20260928132000). Na cadeia do Supabase CLI a 9001 (de
-- 20260910) cria a forma AIOS; esta migration a converte; e a 0448 encontra a
-- tabela já com todas as colunas que os índices, as policies por operação e o
-- trigger dela pedem — o `create table if not exists` dela vira no-op e o resto
-- passa. No `baseline.sql` o bloco desta migration fica na MESMA posição: depois
-- da 9003 e imediatamente antes do bloco da 0448.
--
-- ── Os três estados que ela aceita (idempotente) ────────────────────────────
--
--   (a) sem tabela          → nada (a 0448 cria do zero)
--   (b) forma AIOS          → renomeia, completa as colunas do chassi
--   (c) forma canônica      → só garante as colunas AIOS (re-aplicação do
--                             baseline, ou banco que recebeu a 0448 antes)
--
-- Dados: nenhuma linha é apagada nem reescrita além do rename de coluna.
-- `normalized_cnpj` NÃO é preenchido a partir de `cnpj`: o índice único
-- (organization_id, normalized_cnpj) da 0448 reprovaria duplicata legada e
-- derrubaria a atualização. Fica NULL até o enriquecimento do B2B preencher.
--
-- O que FICA FORA desta migration (tarefa separada, outro repositório): o
-- backend Hono do AIOS (`src/`, no worktree `feat/deskcomm-chassis-import`)
-- passa a escrever `organization_id`/`trade_name`/`main_cnae_*` em `companies`.
-- `deals`, `linkedin_threads` e `extraction_runs` NÃO mudam — continuam `org_id`.
-- A `rpc_upsert_lead` mantém a MESMA assinatura (`p_org_id`, `p_name`, …): quem
-- a chama não muda nada; só o corpo passa a escrever nas colunas canônicas.
-- ============================================================================

do $converge_companies$
begin
  if to_regclass('public.companies') is null then
    return;  -- (a): a 0448 cria a tabela canônica do zero
  end if;

  -- (b) forma AIOS → canônica. Cada rename é condicional, para que um banco
  -- parcialmente convergido (rodada interrompida) termine o trabalho.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'org_id')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'organization_id')
  then
    alter table public.companies rename column org_id to organization_id;
    raise notice '9004: companies.org_id -> organization_id';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'name')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'trade_name')
  then
    alter table public.companies rename column name to trade_name;
    alter table public.companies alter column trade_name drop not null;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'cnae_code')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'main_cnae_code')
  then
    alter table public.companies rename column cnae_code to main_cnae_code;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'cnae_description')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'companies' and column_name = 'main_cnae_description')
  then
    alter table public.companies rename column cnae_description to main_cnae_description;
  end if;

  if exists (select 1 from pg_constraint
              where conrelid = 'public.companies'::regclass and conname = 'companies_org_id_fkey')
     and not exists (select 1 from pg_constraint
              where conrelid = 'public.companies'::regclass and conname = 'companies_organization_id_fkey')
  then
    alter table public.companies rename constraint companies_org_id_fkey to companies_organization_id_fkey;
  end if;

  -- A policy `for all` da 9001 sai: a 0448 recria a isolação POR OPERAÇÃO
  -- (select membro; insert/delete manager; update agent). E o trigger de
  -- updated_at da 9001 sai para não haver dois (a 0448 cria
  -- `trg_companies_set_updated_at`, com a mesma função).
  drop policy if exists tenant_isolation_companies_all on public.companies;
  drop trigger if exists companies_updated_at on public.companies;

  -- Colunas canônicas do chassi (as da 0448), para quem chega pela forma AIOS.
  -- Mesmos tipos, defaults e CHECKs da 0448.
  alter table public.companies
    add column if not exists legal_name            text,
    add column if not exists trade_name            text,
    add column if not exists cnpj                  text,
    add column if not exists normalized_cnpj       text,
    add column if not exists registration_status   text,
    add column if not exists legal_nature          text,
    add column if not exists company_size          text,
    add column if not exists share_capital         numeric,
    add column if not exists opened_at             date,
    add column if not exists main_cnae_code        text,
    add column if not exists main_cnae_description text,
    add column if not exists secondary_cnaes       jsonb not null default '[]'::jsonb,
    add column if not exists street                text,
    add column if not exists number                text,
    add column if not exists complement            text,
    add column if not exists district              text,
    add column if not exists city                  text,
    add column if not exists state                 text,
    add column if not exists zip_code              text,
    add column if not exists email                 text,
    add column if not exists phone                 text,
    add column if not exists enrichment_status     text not null default 'pending',
    add column if not exists enriched_at           timestamptz,
    add column if not exists enrichment_error      text,
    add column if not exists brasilapi_raw         jsonb,
    add column if not exists created_by            uuid references auth.users(id) on delete set null;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.companies'::regclass
                    and conname = 'companies_enrichment_status_check') then
    alter table public.companies add constraint companies_enrichment_status_check
      check (enrichment_status in ('pending', 'processing', 'completed', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.companies'::regclass
                    and conname = 'companies_normalized_cnpj_digits') then
    alter table public.companies add constraint companies_normalized_cnpj_digits
      check (normalized_cnpj is null or normalized_cnpj ~ '^\d{14}$');
  end if;

  -- (b) e (c): os fatos que só o AIOS traz, como colunas aditivas da canônica.
  alter table public.companies
    add column if not exists owner_id                uuid references auth.users(id) on delete set null,
    add column if not exists domain                  text,
    add column if not exists website                 text,
    add column if not exists country                 text,
    add column if not exists industry                text,
    add column if not exists size_range              text,
    add column if not exists annual_revenue          numeric,
    add column if not exists description             text,
    add column if not exists logo_url                text,
    add column if not exists google_place_id         text,
    add column if not exists apify_run_id            text,
    add column if not exists linkedin_url            text,
    add column if not exists linkedin_company_id     text,
    add column if not exists linkedin_employee_count integer,
    add column if not exists linkedin_followers      integer,
    add column if not exists linkedin_scraped_at     timestamptz,
    add column if not exists meta_campaign_id        text,
    add column if not exists meta_adset_id           text,
    add column if not exists meta_ad_id              text,
    add column if not exists traffic_source          text,
    add column if not exists lead_origin             text,
    add column if not exists source                  text,
    add column if not exists status                  text,
    add column if not exists deal_value              numeric,
    add column if not exists tags                    text[] not null default '{}'::text[],
    add column if not exists enrichment_data         jsonb not null default '{}'::jsonb,
    add column if not exists embedding               public.vector(1536),
    add column if not exists is_deleted              boolean not null default false;

  -- Índices AIOS, agora sobre a chave canônica. Na forma (b) eles já existem
  -- com estes nomes — o rename de coluna os carrega —, e o `if not exists` os
  -- mantém; na (c) nascem aqui.
  create unique index if not exists companies_org_place_id_uniq
    on public.companies (organization_id, google_place_id) where google_place_id is not null;
  create index if not exists companies_org_id_idx on public.companies (organization_id);
  create index if not exists companies_org_domain_idx
    on public.companies (organization_id, domain) where domain is not null;
  create index if not exists companies_tags_gin_idx on public.companies using gin (tags);

  comment on table public.companies is
    'Empresa (conta B2B) no escopo do tenant. Canônica do chassi (upstream 0448, módulo CRM B2B) com as colunas do Módulo de Tráfego AIOS convergidas pela 9004. Dedup AIOS por (organization_id, google_place_id); dedup B2B por (organization_id, normalized_cnpj).';
end $converge_companies$;

-- ---------------------------------------------------------------------------
-- rpc_upsert_lead — MESMA assinatura da 9002, corpo nas colunas canônicas.
--
-- `create or replace` (e não drop+create): a lista de parâmetros e os DEFAULTs
-- são idênticos aos da 9002, então o Postgres troca só o corpo e o ACL fica. O
-- parâmetro continua `p_org_id` — é contrato com o Hono, não nome de coluna.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_upsert_lead(
  p_org_id            uuid,
  p_name              text,
  p_lead_origin       text,
  p_traffic_source    text,
  p_meta_campaign_id  text,
  p_meta_adset_id     text,
  p_meta_ad_id        text,
  p_first_name        text,
  p_last_name         text default null,
  p_phone             text default null,
  p_email             text default null
)
returns table (company_id uuid, contact_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_contact_id uuid;
  v_name       text;
  v_phone      text;
  v_meta       jsonb;
begin
  -- 1. Empresa, na `companies` canônica (9004): o nome que o AIOS recebe é o
  --    nome fantasia.
  insert into public.companies (
    organization_id, trade_name, lead_origin, traffic_source,
    meta_campaign_id, meta_adset_id, meta_ad_id,
    status, source
  )
  values (
    p_org_id, p_name, p_lead_origin, p_traffic_source,
    p_meta_campaign_id, p_meta_adset_id, p_meta_ad_id,
    'novo', 'manual'
  )
  returning id into v_company_id;

  -- 2. Convergência do nome: as duas metades viram o `name` canônico do chassi.
  v_name := nullif(btrim(concat_ws(' ', nullif(btrim(p_first_name), ''),
                                        nullif(btrim(p_last_name), ''))), '');

  -- 3. Convergência do telefone. O que não normaliza não é jogado fora: fica
  --    cru em source_metadata.phone_raw, onde uma curadoria posterior o acha.
  v_phone := public.fn_e164_or_null(p_phone);
  v_meta := jsonb_build_object('ingested_by', 'rpc_upsert_lead');
  if p_phone is not null and btrim(p_phone) <> '' and v_phone is null then
    v_meta := v_meta || jsonb_build_object('phone_raw', p_phone);
  end if;

  -- 4. Pessoa, na tabela canônica do chassi. Falha aqui faz ROLLBACK da
  --    company também: sem órfãos.
  insert into public.contacts (
    organization_id, company_id, name, email, phone_number,
    source, source_metadata
  )
  values (
    p_org_id, v_company_id, v_name, p_email, v_phone,
    'manual', v_meta
  )
  returning id into v_contact_id;

  return query select v_company_id, v_contact_id;
end;
$$;

comment on function public.rpc_upsert_lead(uuid, text, text, text, text, text, text, text, text, text, text) is
  'Insere atomicamente 1 company + 1 contact vinculados (webhook Inbound, Comando 2). SEM dedup: cada chamada cria registros novos, preservando atribuição multi-touch Meta. Escreve nas tabelas CANÔNICAS do chassi (companies convergida pela 9004; contacts pela 9002). Falha em qualquer insert faz ROLLBACK total. Caller esperado: service_role.';

-- As duas origens de EXECUTE (CLAUDE.md §9) + a terceira que a 9003 fechou.
revoke all on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
