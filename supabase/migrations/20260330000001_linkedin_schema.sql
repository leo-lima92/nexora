-- ============================================================
-- Nexora — LinkedIn Schema Extension
-- Version: 1.0.1 (Supabase-compatible)
-- Date: 2026-03-30
-- NOTE: linkedin_threads, linkedin_messages e campos linkedin_*
--       foram consolidados na migration 00000.
--       Esta migration adiciona apenas colunas adicionais de
--       perfil LinkedIn nos contatos e empresas que foram
--       omitidas na migration inicial.
-- ============================================================

alter table contacts
  add column if not exists linkedin_profile_id  text,
  add column if not exists linkedin_connection  text default 'none'
    check (linkedin_connection in ('none','pending','1st','2nd','3rd')),
  add column if not exists linkedin_headline    text,
  add column if not exists linkedin_summary     text,
  add column if not exists linkedin_skills      text[] not null default '{}',
  add column if not exists linkedin_scraped_at  timestamptz;

alter table companies
  add column if not exists linkedin_company_id    text,
  add column if not exists linkedin_followers     integer,
  add column if not exists linkedin_employee_count integer,
  add column if not exists linkedin_scraped_at    timestamptz;

create index if not exists idx_contacts_linkedin_profile_id
  on contacts(linkedin_profile_id) where linkedin_profile_id is not null;

create index if not exists idx_contacts_linkedin_connection
  on contacts(org_id, linkedin_connection);

create index if not exists idx_companies_linkedin_company_id
  on companies(linkedin_company_id) where linkedin_company_id is not null;
