-- ============================================================
-- Nexora — Initial Schema Migration
-- Version: 1.0.2 (Supabase-compatible)
-- Date: 2026-03-30
-- ============================================================

-- ─────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────
create extension if not exists "vector";
create extension if not exists "pg_cron";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";

-- ─────────────────────────────────────────
-- ORGANIZATIONS
-- ─────────────────────────────────────────
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  logo_url      text,
  domain        text,
  plan          text not null default 'starter'
                check (plan in ('starter','growth','pro','enterprise')),
  plan_seats    integer not null default 5,
  trial_ends_at timestamptz,
  is_active     boolean not null default true,
  settings      jsonb not null default '{}',
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  full_name     text not null,
  avatar_url    text,
  role          text not null default 'rep'
                check (role in ('admin','manager','rep','viewer')),
  timezone      text not null default 'America/Sao_Paulo',
  locale        text not null default 'pt-BR',
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  onboarded_at  timestamptz,
  preferences   jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- INVITATIONS
-- ─────────────────────────────────────────
create table invitations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  email         text not null,
  role          text not null default 'rep',
  -- md5 de dois UUIDs = 32 hex chars, sem dependência de pgcrypto em defaults
  token         text not null unique default md5(gen_random_uuid()::text || gen_random_uuid()::text),
  invited_by    uuid not null references profiles(id),
  accepted_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '7 days'),
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- COMPANIES
-- ─────────────────────────────────────────
create table companies (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  domain          text,
  website         text,
  linkedin_url    text,
  logo_url        text,
  industry        text,
  size_range      text,
  annual_revenue  bigint,
  country         text,
  city            text,
  description     text,
  tags            text[] not null default '{}',
  enriched_at     timestamptz,
  enrichment_data jsonb not null default '{}',
  cnae_code       text,
  cnae_description text,
  cnpj            text,
  source          text default 'manual'
                  check (source in ('manual','apify_google_maps','apify_instagram','apify_linkedin','phantombuster_linkedin','cnae_scraper','apollo','clearbit')),
  apify_run_id    text,
  owner_id        uuid references profiles(id),
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  embedding       vector(1536)
);

-- ─────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────
create table contacts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  company_id      uuid references companies(id) on delete set null,
  first_name      text not null,
  last_name       text,
  email           text,
  phone           text,
  mobile          text,
  linkedin_url    text,
  instagram_handle text,
  title           text,
  department      text,
  seniority       text,
  avatar_url      text,
  timezone        text,
  preferred_channel text default 'email'
                  check (preferred_channel in ('email','whatsapp','linkedin','phone','instagram')),
  tags            text[] not null default '{}',
  do_not_contact  boolean not null default false,
  enriched_at     timestamptz,
  enrichment_data jsonb not null default '{}',
  source          text default 'manual'
                  check (source in ('manual','apify_google_maps','apify_instagram','apify_linkedin','phantombuster_linkedin','cnae_scraper','apollo','clearbit')),
  apify_run_id    text,
  owner_id        uuid references profiles(id),
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  embedding       vector(1536)
);

-- ─────────────────────────────────────────
-- PIPELINES
-- ─────────────────────────────────────────
create table pipelines (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  description  text,
  currency     text not null default 'BRL',
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  owner_id     uuid references profiles(id),
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- PIPELINE STAGES
-- ─────────────────────────────────────────
create table pipeline_stages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  pipeline_id     uuid not null references pipelines(id) on delete cascade,
  name            text not null,
  position        integer not null default 0,
  probability     integer not null default 0 check (probability between 0 and 100),
  color           text not null default '#6366f1',
  is_won          boolean not null default false,
  is_lost         boolean not null default false,
  rotting_days    integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- DEALS
-- ─────────────────────────────────────────
create table deals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  pipeline_id     uuid not null references pipelines(id),
  stage_id        uuid not null references pipeline_stages(id),
  title           text not null,
  value           bigint not null default 0,
  currency        text not null default 'BRL',
  probability     integer check (probability between 0 and 100),
  expected_close  date,
  actual_close    date,
  status          text not null default 'open'
                  check (status in ('open','won','lost','archived')),
  lost_reason     text,
  owner_id        uuid references profiles(id),
  company_id      uuid references companies(id) on delete set null,
  sniper_score    integer default 0 check (sniper_score between 0 and 100),
  sniper_updated_at timestamptz,
  sentiment_state text default 'neutral'
                  check (sentiment_state in ('enthusiastic','curious','hesitant','cold','resistant','ready','neutral')),
  sentiment_score decimal(4,3) default 0,
  sentiment_updated_at timestamptz,
  source          text,
  tags            text[] not null default '{}',
  custom_fields   jsonb not null default '{}',
  last_activity_at timestamptz,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- DEAL CONTACTS
-- ─────────────────────────────────────────
create table deal_contacts (
  deal_id      uuid not null references deals(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  role         text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (deal_id, contact_id)
);

-- ─────────────────────────────────────────
-- ACTIVITIES
-- ─────────────────────────────────────────
create table activities (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  type            text not null
                  check (type in ('call','email','meeting','note','task','whatsapp','linkedin','instagram')),
  title           text not null,
  body            text,
  direction       text check (direction in ('inbound','outbound')),
  duration_secs   integer,
  occurred_at     timestamptz not null default now(),
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  company_id      uuid references companies(id) on delete set null,
  owner_id        uuid references profiles(id),
  sentiment_score decimal(4,3),
  sentiment_state text,
  agent_generated boolean not null default false,
  agent_id        text,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- AGENT CONFIGURATIONS
-- ─────────────────────────────────────────
create table agent_configs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  agent_type      text not null
                  check (agent_type in ('scout','chaser','briefer','closer','analyst')),
  name            text not null,
  is_enabled      boolean not null default true,
  mode            text not null default 'human_in_loop'
                  check (mode in ('full_auto','human_in_loop','suggestions_only')),
  schedule        text,
  config          jsonb not null default '{}',
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, agent_type)
);

-- ─────────────────────────────────────────
-- AGENT ACTIONS
-- ─────────────────────────────────────────
create table agent_actions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  agent_type      text not null,
  action_type     text not null,
  status          text not null default 'pending'
                  check (status in ('pending','awaiting_approval','approved','executing','completed','failed','rejected')),
  payload         jsonb not null default '{}',
  result          jsonb,
  error_message   text,
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  rejected_by     uuid references profiles(id),
  rejected_at     timestamptz,
  rejection_reason text,
  scheduled_for   timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  retry_count     integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- AGENT RUNS
-- ─────────────────────────────────────────
create table agent_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  agent_type      text not null,
  trigger_type    text not null
                  check (trigger_type in ('scheduled','manual','signal','webhook')),
  status          text not null default 'running'
                  check (status in ('running','completed','failed','cancelled')),
  actions_created integer not null default 0,
  actions_executed integer not null default 0,
  summary         text,
  error_message   text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  metadata        jsonb not null default '{}'
);

-- ─────────────────────────────────────────
-- EXTRACTION RUNS
-- ─────────────────────────────────────────
create table extraction_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  source          text not null
                  check (source in ('apify_google_maps','apify_instagram','apify_linkedin','phantombuster_linkedin','cnae_scraper')),
  apify_actor_id  text,
  apify_run_id    text,
  status          text not null default 'pending'
                  check (status in ('pending','running','completed','failed')),
  query           text,
  cnae_codes      text[],
  location        text,
  max_results     integer not null default 100,
  results_count   integer not null default 0,
  companies_created integer not null default 0,
  contacts_created  integer not null default 0,
  raw_data        jsonb,
  error_message   text,
  created_by      uuid references profiles(id),
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- CNAE CODES
-- ─────────────────────────────────────────
create table cnae_codes (
  code            text primary key,
  description     text not null,
  section         text,
  division        text,
  group_name      text,
  class_name      text,
  is_active       boolean not null default true
);

-- ─────────────────────────────────────────
-- ICP PROFILES
-- ─────────────────────────────────────────
create table icp_profiles (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_active       boolean not null default true,
  criteria        jsonb not null default '{}',
  target_cnaes    text[] not null default '{}',
  target_cities   text[] not null default '{}',
  target_instagram_keywords text[] not null default '{}',
  target_linkedin_titles    text[] not null default '{}',
  target_linkedin_companies text[] not null default '{}',
  target_linkedin_skills    text[] not null default '{}',
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- SNIPER SCORES
-- ─────────────────────────────────────────
create table sniper_scores (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  deal_id         uuid references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  score           integer not null check (score between 0 and 100),
  icp_fit         integer not null default 0 check (icp_fit between 0 and 100),
  engagement      integer not null default 0 check (engagement between 0 and 100),
  intent_signals  integer not null default 0 check (intent_signals between 0 and 100),
  timing          integer not null default 0 check (timing between 0 and 100),
  factors         jsonb not null default '{}',
  recommendation  text,
  calculated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- SIGNALS
-- ─────────────────────────────────────────
create table signals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  signal_type     text not null
                  check (signal_type in (
                    'site_visit','email_open','email_click','link_click',
                    'job_change','funding_round','product_launch',
                    'tech_stack_change','competitor_mention',
                    'linkedin_view','linkedin_message','linkedin_connection_accepted',
                    'linkedin_post_engagement','linkedin_company_follow',
                    'instagram_follow','content_download','trial_signup'
                  )),
  source          text not null,
  deal_id         uuid references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  company_id      uuid references companies(id) on delete cascade,
  intensity       integer not null default 50 check (intensity between 0 and 100),
  data            jsonb not null default '{}',
  processed       boolean not null default false,
  triggered_action boolean not null default false,
  detected_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- HIT LISTS
-- ─────────────────────────────────────────
create table hit_lists (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  owner_id        uuid not null references profiles(id),
  list_date       date not null default current_date,
  items           jsonb not null default '[]',
  generated_at    timestamptz not null default now(),
  unique (org_id, owner_id, list_date)
);

-- ─────────────────────────────────────────
-- TRIGGER RULES
-- ─────────────────────────────────────────
create table trigger_rules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_active       boolean not null default true,
  conditions      jsonb not null default '{}',
  actions         jsonb not null default '{}',
  score_impact    integer not null default 0,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- SENTIMENT ANALYSES
-- ─────────────────────────────────────────
create table sentiment_analyses (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  source_type     text not null
                  check (source_type in ('email','whatsapp','linkedin','instagram','call_transcript','note')),
  source_id       uuid not null,
  deal_id         uuid references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  overall_score   decimal(4,3) not null,
  state           text not null
                  check (state in ('enthusiastic','curious','hesitant','cold','resistant','ready','neutral')),
  confidence      decimal(4,3) not null,
  emotions        jsonb not null default '{}',
  key_phrases     text[] not null default '{}',
  red_flags       text[] not null default '{}',
  tone_suggestion text,
  summary         text,
  embedding       vector(1536),
  model_version   text not null default 'claude-sonnet-4-6',
  analyzed_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- EMOTION MAPS
-- ─────────────────────────────────────────
create table emotion_maps (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  deal_id         uuid not null references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  state           text not null,
  score           decimal(4,3) not null,
  trigger_event   text,
  stage_id        uuid references pipeline_stages(id),
  recorded_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- CALL RECORDINGS
-- ─────────────────────────────────────────
create table call_recordings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  activity_id     uuid references activities(id) on delete cascade,
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  storage_path    text,
  duration_secs   integer,
  transcript      text,
  transcript_status text not null default 'pending'
                  check (transcript_status in ('pending','processing','completed','failed')),
  highlights      jsonb not null default '[]',
  action_items    jsonb not null default '[]',
  summary         text,
  sentiment_score decimal(4,3),
  sentiment_state text,
  speaker_sentiments jsonb not null default '{}',
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- BUYER PERSONAS
-- ─────────────────────────────────────────
create table buyer_personas (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  disc_dominant   decimal(4,3) default 0,
  disc_influence  decimal(4,3) default 0,
  disc_steadiness decimal(4,3) default 0,
  disc_compliance decimal(4,3) default 0,
  primary_style   text,
  decision_style  text,
  risk_tolerance  text,
  motivators      text[] not null default '{}',
  communication_preferences jsonb not null default '{}',
  confidence      decimal(4,3) not null default 0,
  interactions_analyzed integer not null default 0,
  last_updated_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (org_id, contact_id)
);

-- ─────────────────────────────────────────
-- LINKEDIN THREADS
-- ─────────────────────────────────────────
create table linkedin_threads (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  contact_id       uuid references contacts(id) on delete set null,
  deal_id          uuid references deals(id) on delete set null,
  owner_id         uuid references profiles(id),
  linkedin_thread_id text,
  last_message_at  timestamptz,
  message_count    integer not null default 0,
  sentiment_score  decimal(4,3),
  sentiment_state  text
                   check (sentiment_state in ('enthusiastic','curious','hesitant','cold','resistant','ready','neutral')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- LINKEDIN MESSAGES
-- ─────────────────────────────────────────
create table linkedin_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  thread_id       uuid not null references linkedin_threads(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  direction       text not null check (direction in ('inbound','outbound')),
  body            text not null,
  sent_at         timestamptz not null,
  sentiment_score decimal(4,3),
  sentiment_state text,
  agent_generated boolean not null default false,
  agent_action_id uuid references agent_actions(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- INTEGRATIONS
-- ─────────────────────────────────────────
create table integrations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  user_id         uuid references profiles(id) on delete cascade,
  provider        text not null
                  check (provider in ('gmail','outlook','google_calendar','twilio','whatsapp','linkedin','linkedin_phantombuster','instagram','apify','apollo','hunter','clearbit')),
  status          text not null default 'active'
                  check (status in ('active','inactive','error','pending_auth')),
  access_token    text,
  refresh_token   text,
  token_expires_at timestamptz,
  config          jsonb not null default '{}',
  last_sync_at    timestamptz,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, user_id, provider)
);

-- ─────────────────────────────────────────
-- WEBHOOKS
-- ─────────────────────────────────────────
create table webhooks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  url             text not null,
  events          text[] not null default '{}',
  is_active       boolean not null default true,
  secret          text not null default md5(gen_random_uuid()::text || gen_random_uuid()::text),
  headers         jsonb not null default '{}',
  last_triggered_at timestamptz,
  failure_count   integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- EMAIL THREADS
-- ─────────────────────────────────────────
create table email_threads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  external_id     text,
  provider        text not null,
  subject         text,
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  owner_id        uuid references profiles(id),
  last_message_at timestamptz,
  message_count   integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────
create table subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  stripe_customer_id   text unique,
  stripe_subscription_id text unique,
  plan                 text not null,
  status               text not null
                       check (status in ('trialing','active','past_due','canceled','unpaid')),
  seats                integer not null default 1,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at          timestamptz,
  trial_end            timestamptz,
  metadata             jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- USAGE METRICS
-- ─────────────────────────────────────────
create table usage_metrics (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  metric_type     text not null,
  value           bigint not null default 0,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_organizations_slug         on organizations(slug);
create index idx_profiles_org_id            on profiles(org_id);
create index idx_companies_org_id           on companies(org_id);
create index idx_companies_domain           on companies(domain) where domain is not null;
create index idx_companies_cnpj             on companies(cnpj) where cnpj is not null;
create index idx_companies_cnae             on companies(cnae_code) where cnae_code is not null;
create index idx_companies_source           on companies(org_id, source);
create index idx_companies_name_trgm        on companies using gin(name gin_trgm_ops);
create index idx_contacts_org_id            on contacts(org_id);
create index idx_contacts_company_id        on contacts(company_id);
create index idx_contacts_email             on contacts(email) where email is not null;
create index idx_contacts_source            on contacts(org_id, source);
create index idx_contacts_name_trgm         on contacts using gin((first_name || ' ' || coalesce(last_name,'')) gin_trgm_ops);
create index idx_contacts_linkedin_id       on contacts(linkedin_url) where linkedin_url is not null;
create index idx_deals_org_id              on deals(org_id);
create index idx_deals_pipeline_id         on deals(pipeline_id);
create index idx_deals_stage_id            on deals(stage_id);
create index idx_deals_owner_id            on deals(owner_id);
create index idx_deals_company_id          on deals(company_id);
create index idx_deals_status              on deals(status) where is_deleted = false;
create index idx_deals_sniper_score        on deals(org_id, sniper_score desc) where is_deleted = false;
create index idx_activities_org_id         on activities(org_id);
create index idx_activities_deal_id        on activities(deal_id);
create index idx_activities_contact_id     on activities(contact_id);
create index idx_activities_occurred_at    on activities(occurred_at desc);
create index idx_signals_org_id            on signals(org_id);
create index idx_signals_deal_id           on signals(deal_id);
create index idx_signals_contact_id        on signals(contact_id);
create index idx_signals_detected_at       on signals(detected_at desc);
create index idx_signals_unprocessed       on signals(org_id, detected_at) where processed = false;
create index idx_agent_actions_org_id      on agent_actions(org_id);
create index idx_agent_actions_status      on agent_actions(org_id, status) where status in ('pending','awaiting_approval');
create index idx_agent_actions_deal_id     on agent_actions(deal_id);
create index idx_extraction_runs_org_id    on extraction_runs(org_id);
create index idx_extraction_runs_status    on extraction_runs(org_id, status);
create index idx_extraction_runs_source    on extraction_runs(org_id, source);
create index idx_sentiment_deal_id         on sentiment_analyses(deal_id);
create index idx_sentiment_contact_id      on sentiment_analyses(contact_id);
create index idx_emotion_maps_deal_id      on emotion_maps(deal_id, recorded_at desc);
create index idx_linkedin_threads_contact  on linkedin_threads(contact_id);
create index idx_linkedin_threads_deal     on linkedin_threads(deal_id);
create index idx_linkedin_messages_thread  on linkedin_messages(thread_id, sent_at desc);

-- Vector indexes
create index idx_contacts_embedding   on contacts   using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_companies_embedding  on companies  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_sentiment_embedding  on sentiment_analyses using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table organizations      enable row level security;
alter table profiles           enable row level security;
alter table invitations        enable row level security;
alter table companies          enable row level security;
alter table contacts           enable row level security;
alter table pipelines          enable row level security;
alter table pipeline_stages    enable row level security;
alter table deals              enable row level security;
alter table deal_contacts      enable row level security;
alter table activities         enable row level security;
alter table agent_configs      enable row level security;
alter table agent_actions      enable row level security;
alter table agent_runs         enable row level security;
alter table extraction_runs    enable row level security;
alter table icp_profiles       enable row level security;
alter table sniper_scores      enable row level security;
alter table signals            enable row level security;
alter table hit_lists          enable row level security;
alter table trigger_rules      enable row level security;
alter table sentiment_analyses enable row level security;
alter table emotion_maps       enable row level security;
alter table call_recordings    enable row level security;
alter table buyer_personas     enable row level security;
alter table linkedin_threads   enable row level security;
alter table linkedin_messages  enable row level security;
alter table integrations       enable row level security;
alter table webhooks           enable row level security;
alter table email_threads      enable row level security;
alter table subscriptions      enable row level security;
alter table usage_metrics      enable row level security;
-- cnae_codes: tabela pública de referência, sem RLS

-- ── Helper functions no schema PUBLIC (auth schema é restrito no Supabase) ──
create or replace function public.get_org_id()
returns uuid language sql stable security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid()
$$;

create or replace function public.get_user_role()
returns text language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ── Policies: Organizations ──
create policy "org_select_own"   on organizations for select using (id = public.get_org_id());
create policy "org_update_admin" on organizations for update using (id = public.get_org_id() and public.get_user_role() = 'admin');

-- ── Policies: Profiles ──
create policy "profiles_select_own_org" on profiles for select using (org_id = public.get_org_id());
create policy "profiles_update_own"     on profiles for update using (id = auth.uid());

-- ── Policies: Companies ──
create policy "companies_select" on companies for select using (org_id = public.get_org_id() and is_deleted = false);
create policy "companies_insert" on companies for insert with check (org_id = public.get_org_id());
create policy "companies_update" on companies for update using (org_id = public.get_org_id());

-- ── Policies: Contacts ──
create policy "contacts_select" on contacts for select using (org_id = public.get_org_id() and is_deleted = false);
create policy "contacts_insert" on contacts for insert with check (org_id = public.get_org_id());
create policy "contacts_update" on contacts for update using (org_id = public.get_org_id());

-- ── Policies: Deals ──
create policy "deals_select" on deals for select using (org_id = public.get_org_id() and is_deleted = false);
create policy "deals_insert" on deals for insert with check (org_id = public.get_org_id());
create policy "deals_update" on deals for update using (
  org_id = public.get_org_id()
  and (owner_id = auth.uid() or public.get_user_role() in ('admin','manager'))
);

-- ── Policies padrão para tabelas restantes ──
create policy "pipelines_select"          on pipelines          for select using (org_id = public.get_org_id());
create policy "pipelines_insert"          on pipelines          for insert with check (org_id = public.get_org_id());
create policy "pipeline_stages_select"    on pipeline_stages    for select using (org_id = public.get_org_id());
create policy "pipeline_stages_insert"    on pipeline_stages    for insert with check (org_id = public.get_org_id());
create policy "activities_select"         on activities         for select using (org_id = public.get_org_id());
create policy "activities_insert"         on activities         for insert with check (org_id = public.get_org_id());
create policy "agent_configs_select"      on agent_configs      for select using (org_id = public.get_org_id());
create policy "agent_actions_select"      on agent_actions      for select using (org_id = public.get_org_id());
create policy "agent_runs_select"         on agent_runs         for select using (org_id = public.get_org_id());
create policy "extraction_runs_select"    on extraction_runs    for select using (org_id = public.get_org_id());
create policy "extraction_runs_insert"    on extraction_runs    for insert with check (org_id = public.get_org_id());
create policy "icp_profiles_select"       on icp_profiles       for select using (org_id = public.get_org_id());
create policy "sniper_scores_select"      on sniper_scores      for select using (org_id = public.get_org_id());
create policy "signals_select"            on signals            for select using (org_id = public.get_org_id());
create policy "hit_lists_select"          on hit_lists          for select using (org_id = public.get_org_id() and owner_id = auth.uid());
create policy "trigger_rules_select"      on trigger_rules      for select using (org_id = public.get_org_id());
create policy "sentiment_analyses_select" on sentiment_analyses for select using (org_id = public.get_org_id());
create policy "emotion_maps_select"       on emotion_maps       for select using (org_id = public.get_org_id());
create policy "call_recordings_select"    on call_recordings    for select using (org_id = public.get_org_id());
create policy "buyer_personas_select"     on buyer_personas     for select using (org_id = public.get_org_id());
create policy "linkedin_threads_select"   on linkedin_threads   for select using (org_id = public.get_org_id());
create policy "linkedin_threads_insert"   on linkedin_threads   for insert with check (org_id = public.get_org_id());
create policy "linkedin_threads_update"   on linkedin_threads   for update using (org_id = public.get_org_id());
create policy "linkedin_messages_select"  on linkedin_messages  for select using (org_id = public.get_org_id());
create policy "linkedin_messages_insert"  on linkedin_messages  for insert with check (org_id = public.get_org_id());
create policy "integrations_select"       on integrations       for select using (org_id = public.get_org_id() and user_id = auth.uid());
create policy "webhooks_select"           on webhooks           for select using (org_id = public.get_org_id());
create policy "subscriptions_select"      on subscriptions      for select using (org_id = public.get_org_id());
create policy "usage_metrics_select"      on usage_metrics      for select using (org_id = public.get_org_id());
create policy "invitations_select"        on invitations        for select using (org_id = public.get_org_id());
create policy "deal_contacts_select"      on deal_contacts      for select using (
  exists (select 1 from deals d where d.id = deal_id and d.org_id = public.get_org_id())
);

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table deals;
alter publication supabase_realtime add table agent_actions;
alter publication supabase_realtime add table signals;
alter publication supabase_realtime add table hit_lists;
alter publication supabase_realtime add table sentiment_analyses;
alter publication supabase_realtime add table emotion_maps;
alter publication supabase_realtime add table extraction_runs;
alter publication supabase_realtime add table linkedin_threads;
alter publication supabase_realtime add table linkedin_messages;

-- ============================================================
-- PG_CRON JOBS
-- NOTA: requerem extensão pg_net habilitada no painel Supabase
-- Habilite em: Database → Extensions → pg_net
-- Após habilitar, execute manualmente via SQL Editor:
-- ============================================================
/*
select cron.schedule('sniper-score-recalc', '0 * * * *',
  $$ select net.http_post(url:='https://qpwkhuvchibrxretubss.supabase.co/functions/v1/sniper-recalc',
     headers:='{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb, body:='{}'::jsonb) $$);

select cron.schedule('hit-list-daily', '0 10 * * *',
  $$ select net.http_post(url:='https://qpwkhuvchibrxretubss.supabase.co/functions/v1/hit-list-generate',
     headers:='{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb, body:='{}'::jsonb) $$);

select cron.schedule('rotting-deals-check', '0 9 * * *',
  $$ select net.http_post(url:='https://qpwkhuvchibrxretubss.supabase.co/functions/v1/rotting-check',
     headers:='{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb, body:='{}'::jsonb) $$);

select cron.schedule('cleanup-agent-actions', '0 2 * * 0',
  $$ delete from agent_actions where status in ('completed','rejected')
     and completed_at < now() - interval '30 days' $$);
*/

-- ============================================================
-- SEED: CNAE codes
-- ============================================================
insert into cnae_codes (code, description, section, division) values
  ('6201-5/01', 'Desenvolvimento de programas de computador sob encomenda', 'J', '62'),
  ('6201-5/02', 'Web design', 'J', '62'),
  ('6202-3/00', 'Desenvolvimento e licenciamento de programas de computador customizáveis', 'J', '62'),
  ('6203-1/00', 'Desenvolvimento e licenciamento de programas de computador não-customizáveis', 'J', '62'),
  ('6204-0/00', 'Consultoria em tecnologia da informação', 'J', '62'),
  ('6209-1/00', 'Suporte técnico, manutenção e outros serviços em tecnologia da informação', 'J', '62'),
  ('4711-3/01', 'Comércio varejista de mercadorias em geral', 'G', '47'),
  ('4712-1/00', 'Comércio varejista de produtos alimentícios em geral', 'G', '47'),
  ('5611-2/01', 'Restaurantes e similares', 'I', '56'),
  ('7319-0/02', 'Promoção de vendas', 'M', '73')
on conflict (code) do nothing;
