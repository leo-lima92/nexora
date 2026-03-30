# Nexora — Architecture & Supabase Schema
**Versão:** 1.0
**Data:** 2026-03-30
**Autor:** @architect (Aria)
**Status:** Draft

---

## 1. Visão Arquitetural

### 1.1 Stack Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                  │
│   Browser (Next.js SSR/CSR)   |   Mobile (PWA futura)           │
└──────────────────┬──────────────────────────────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────────────────────────────┐
│                      VERCEL EDGE                                │
│   Next.js 14 App Router │ API Routes │ Middleware (Auth check)  │
└──────┬───────────────────────────────────────┬──────────────────┘
       │                                       │
┌──────▼──────────┐                 ┌──────────▼───────────────┐
│  Supabase Auth  │                 │   Supabase Edge Fns      │
│  (JWT + OAuth)  │                 │   (AI agents, webhooks)  │
└──────┬──────────┘                 └──────────┬───────────────┘
       │                                       │
┌──────▼───────────────────────────────────────▼───────────────┐
│                    SUPABASE PLATFORM                          │
│   PostgreSQL + RLS │ Realtime │ Storage │ pg_cron │ pgvector  │
└──────────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│                    AI LAYER                                  │
│   Anthropic Claude claude-sonnet-4-6 │ Agent SDK │ Embeddings │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Princípios Arquiteturais

- **Multi-tenant first:** RLS em todas as tabelas com `org_id`
- **Realtime nativo:** Supabase Realtime para pipeline e signal feed
- **Agent-centric:** Schema projetado para ações de agentes como cidadãos de primeira classe
- **Vector-ready:** pgvector para buscas semânticas em interações e sentimentos
- **Audit trail:** Soft deletes + tabelas de audit log em operações críticas

---

## 2. Schema Supabase — DDL Completo

### 2.1 Extensões

```sql
-- Habilitar extensões necessárias
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";          -- embeddings (IA Sentimental)
create extension if not exists "pg_cron";         -- jobs agendados
create extension if not exists "pg_trgm";         -- search full-text
create extension if not exists "unaccent";        -- normalização de busca
```

---

### 2.2 TENANT / AUTH

```sql
-- ─────────────────────────────────────────
-- ORGANIZATIONS (Multi-tenant root)
-- ─────────────────────────────────────────
create table organizations (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  slug          text not null unique,              -- nexora.app/org/{slug}
  logo_url      text,
  domain        text,                              -- domínio verificado para SSO
  plan          text not null default 'starter'    -- starter | growth | pro | enterprise
                check (plan in ('starter','growth','pro','enterprise')),
  plan_seats    integer not null default 5,
  trial_ends_at timestamptz,
  is_active     boolean not null default true,
  settings      jsonb not null default '{}',       -- configurações gerais da org
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- PROFILES (extensão de auth.users)
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
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  email         text not null,
  role          text not null default 'rep',
  token         text not null unique default encode(gen_random_bytes(32), 'hex'),
  invited_by    uuid not null references profiles(id),
  accepted_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '7 days'),
  created_at    timestamptz not null default now()
);
```

---

### 2.3 CRM CORE

```sql
-- ─────────────────────────────────────────
-- COMPANIES
-- ─────────────────────────────────────────
create table companies (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  domain          text,
  website         text,
  linkedin_url    text,
  logo_url        text,
  industry        text,
  size_range      text,                            -- '1-10','11-50','51-200','201-500','500+'
  annual_revenue  bigint,                          -- em centavos USD
  country         text,
  city            text,
  description     text,
  tags            text[] not null default '{}',
  enriched_at     timestamptz,                     -- última vez que agente enriqueceu
  enrichment_data jsonb not null default '{}',     -- dados brutos Apollo/Clearbit
  owner_id        uuid references profiles(id),
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Vector embedding para busca semântica
  embedding       vector(1536)
);

-- ─────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────
create table contacts (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  company_id      uuid references companies(id) on delete set null,
  first_name      text not null,
  last_name       text,
  email           text,
  phone           text,
  mobile          text,
  linkedin_url    text,
  title           text,                            -- cargo atual
  department      text,
  seniority       text,                            -- 'c_suite','vp','director','manager','ic'
  avatar_url      text,
  timezone        text,
  preferred_channel text default 'email'           -- email | whatsapp | linkedin
                  check (preferred_channel in ('email','whatsapp','linkedin','phone')),
  tags            text[] not null default '{}',
  do_not_contact  boolean not null default false,
  enriched_at     timestamptz,
  enrichment_data jsonb not null default '{}',
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
  id           uuid primary key default uuid_generate_v4(),
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
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  pipeline_id     uuid not null references pipelines(id) on delete cascade,
  name            text not null,
  position        integer not null default 0,
  probability     integer not null default 0 check (probability between 0 and 100),
  color           text not null default '#6366f1',
  is_won          boolean not null default false,
  is_lost         boolean not null default false,
  rotting_days    integer,                         -- dias sem atividade = rotting
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- DEALS
-- ─────────────────────────────────────────
create table deals (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  pipeline_id     uuid not null references pipelines(id),
  stage_id        uuid not null references pipeline_stages(id),
  title           text not null,
  value           bigint not null default 0,       -- em centavos
  currency        text not null default 'BRL',
  probability     integer check (probability between 0 and 100),
  expected_close  date,
  actual_close    date,
  status          text not null default 'open'
                  check (status in ('open','won','lost','archived')),
  lost_reason     text,
  owner_id        uuid references profiles(id),
  company_id      uuid references companies(id) on delete set null,
  -- Sniper fields
  sniper_score    integer default 0 check (sniper_score between 0 and 100),
  sniper_updated_at timestamptz,
  -- Sentiment fields
  sentiment_state text default 'neutral'
                  check (sentiment_state in ('enthusiastic','curious','hesitant','cold','resistant','ready','neutral')),
  sentiment_score decimal(4,3) default 0,          -- -1.0 a 1.0
  sentiment_updated_at timestamptz,
  -- Metadata
  source          text,                            -- origem do lead
  tags            text[] not null default '{}',
  custom_fields   jsonb not null default '{}',
  last_activity_at timestamptz,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- DEAL CONTACTS (M:M)
-- ─────────────────────────────────────────
create table deal_contacts (
  deal_id      uuid not null references deals(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  role         text,                               -- 'champion','decision_maker','influencer'
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (deal_id, contact_id)
);

-- ─────────────────────────────────────────
-- ACTIVITIES (calls, emails, meetings, notes, tasks)
-- ─────────────────────────────────────────
create table activities (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  type            text not null
                  check (type in ('call','email','meeting','note','task','whatsapp','linkedin')),
  title           text not null,
  body            text,
  direction       text check (direction in ('inbound','outbound')),
  duration_secs   integer,                         -- para calls
  occurred_at     timestamptz not null default now(),
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  company_id      uuid references companies(id) on delete set null,
  owner_id        uuid references profiles(id),
  -- Sentiment
  sentiment_score decimal(4,3),
  sentiment_state text,
  -- Agent generated
  agent_generated boolean not null default false,
  agent_id        text,                            -- qual agente gerou
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

---

### 2.4 AGENT HUB

```sql
-- ─────────────────────────────────────────
-- AGENT CONFIGURATIONS
-- ─────────────────────────────────────────
create table agent_configs (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  agent_type      text not null
                  check (agent_type in ('scout','chaser','briefer','closer','analyst')),
  name            text not null,
  is_enabled      boolean not null default true,
  mode            text not null default 'human_in_loop'
                  check (mode in ('full_auto','human_in_loop','suggestions_only')),
  schedule        text,                            -- cron expression para agentes agendados
  config          jsonb not null default '{}',     -- parâmetros específicos do agente
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, agent_type)
);

-- ─────────────────────────────────────────
-- AGENT ACTIONS (fila + histórico)
-- ─────────────────────────────────────────
create table agent_actions (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  agent_type      text not null,
  action_type     text not null,                   -- 'send_email','update_stage','create_task', etc.
  status          text not null default 'pending'
                  check (status in ('pending','awaiting_approval','approved','executing','completed','failed','rejected')),
  payload         jsonb not null default '{}',     -- dados da ação
  result          jsonb,                           -- resultado após execução
  error_message   text,
  -- Referências
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  -- Aprovação
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  rejected_by     uuid references profiles(id),
  rejected_at     timestamptz,
  rejection_reason text,
  -- Execução
  scheduled_for   timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  retry_count     integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- AGENT RUNS (execuções de sessão de agente)
-- ─────────────────────────────────────────
create table agent_runs (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  agent_type      text not null,
  trigger_type    text not null                    -- 'scheduled','manual','signal','webhook'
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
```

---

### 2.5 MÓDULO SNIPER

```sql
-- ─────────────────────────────────────────
-- ICP PROFILES (Ideal Customer Profile)
-- ─────────────────────────────────────────
create table icp_profiles (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_active       boolean not null default true,
  criteria        jsonb not null default '{}',     -- regras de fit
  -- {'industries':['saas','fintech'], 'sizes':['51-200'], 'seniorities':['vp','director']}
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- SNIPER SCORES (histórico por deal/contato)
-- ─────────────────────────────────────────
create table sniper_scores (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  deal_id         uuid references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  score           integer not null check (score between 0 and 100),
  -- Componentes do score
  icp_fit         integer not null default 0 check (icp_fit between 0 and 100),
  engagement      integer not null default 0 check (engagement between 0 and 100),
  intent_signals  integer not null default 0 check (intent_signals between 0 and 100),
  timing          integer not null default 0 check (timing between 0 and 100),
  -- Detalhes
  factors         jsonb not null default '{}',     -- fatores que compõem o score
  recommendation  text,                            -- sugestão gerada por IA
  calculated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- SIGNALS (eventos de compra detectados)
-- ─────────────────────────────────────────
create table signals (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  signal_type     text not null
                  check (signal_type in (
                    'site_visit','email_open','email_click','link_click',
                    'job_change','funding_round','product_launch',
                    'tech_stack_change','competitor_mention',
                    'linkedin_view','content_download','trial_signup'
                  )),
  source          text not null,                   -- 'website','email','linkedin','apollo','manual'
  deal_id         uuid references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  company_id      uuid references companies(id) on delete cascade,
  intensity       integer not null default 50 check (intensity between 0 and 100),
  data            jsonb not null default '{}',     -- dados brutos do sinal
  processed       boolean not null default false,
  triggered_action boolean not null default false,
  detected_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- HIT LISTS (lista diária por rep)
-- ─────────────────────────────────────────
create table hit_lists (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  owner_id        uuid not null references profiles(id),
  list_date       date not null default current_date,
  items           jsonb not null default '[]',     -- [{deal_id, contact_id, score, reason, action}]
  generated_at    timestamptz not null default now(),
  unique (org_id, owner_id, list_date)
);

-- ─────────────────────────────────────────
-- TRIGGER RULES (motor de detecção)
-- ─────────────────────────────────────────
create table trigger_rules (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_active       boolean not null default true,
  conditions      jsonb not null default '{}',     -- condições para disparar
  actions         jsonb not null default '{}',     -- ações a executar
  score_impact    integer not null default 0,      -- impacto no sniper score
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

---

### 2.6 IA SENTIMENTAL

```sql
-- ─────────────────────────────────────────
-- SENTIMENT ANALYSES
-- ─────────────────────────────────────────
create table sentiment_analyses (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  source_type     text not null
                  check (source_type in ('email','whatsapp','linkedin','call_transcript','note')),
  source_id       uuid not null,                   -- FK para activities.id
  deal_id         uuid references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  -- Scores
  overall_score   decimal(4,3) not null,           -- -1.0 a 1.0
  state           text not null
                  check (state in ('enthusiastic','curious','hesitant','cold','resistant','ready','neutral')),
  confidence      decimal(4,3) not null,           -- 0.0 a 1.0 (confiança da análise)
  -- Detalhes
  emotions        jsonb not null default '{}',     -- {joy:0.8, anger:0.1, fear:0.05, ...}
  key_phrases     text[] not null default '{}',    -- frases chave detectadas
  red_flags       text[] not null default '{}',    -- alertas detectados
  tone_suggestion text,                            -- sugestão de tom para próxima msg
  summary         text,                            -- resumo da análise
  -- Vector embedding para busca semântica
  embedding       vector(1536),
  model_version   text not null default 'claude-sonnet-4-6',
  analyzed_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- EMOTION MAPS (histórico emocional por deal)
-- ─────────────────────────────────────────
create table emotion_maps (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  deal_id         uuid not null references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  -- Snapshot do estado emocional em um ponto no tempo
  state           text not null,
  score           decimal(4,3) not null,
  trigger_event   text,                            -- o que causou essa mudança
  stage_id        uuid references pipeline_stages(id),
  recorded_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- CALL RECORDINGS & TRANSCRIPTS
-- ─────────────────────────────────────────
create table call_recordings (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  activity_id     uuid references activities(id) on delete cascade,
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  storage_path    text,                            -- Supabase Storage path
  duration_secs   integer,
  -- Transcrição
  transcript      text,
  transcript_status text not null default 'pending'
                  check (transcript_status in ('pending','processing','completed','failed')),
  -- Highlights gerados por IA
  highlights      jsonb not null default '[]',     -- [{timestamp, text, type, importance}]
  action_items    jsonb not null default '[]',     -- [{text, owner, due_date}]
  summary         text,
  -- Sentiment da call
  sentiment_score decimal(4,3),
  sentiment_state text,
  speaker_sentiments jsonb not null default '{}', -- {rep: score, prospect: score}
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- BUYER PERSONAS (perfil psicológico)
-- ─────────────────────────────────────────
create table buyer_personas (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  -- DISC
  disc_dominant   decimal(4,3) default 0,
  disc_influence  decimal(4,3) default 0,
  disc_steadiness decimal(4,3) default 0,
  disc_compliance decimal(4,3) default 0,
  primary_style   text,                            -- 'D','I','S','C'
  -- Estilo de decisão
  decision_style  text,                            -- 'analytical','driver','expressive','amiable'
  risk_tolerance  text,                            -- 'low','medium','high'
  -- Motivadores
  motivators      text[] not null default '{}',   -- ['roi','innovation','security','status']
  communication_preferences jsonb not null default '{}',
  -- Meta
  confidence      decimal(4,3) not null default 0,
  interactions_analyzed integer not null default 0,
  last_updated_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (org_id, contact_id)
);
```

---

### 2.7 INTEGRAÇÕES

```sql
-- ─────────────────────────────────────────
-- INTEGRATIONS (OAuth tokens e configs)
-- ─────────────────────────────────────────
create table integrations (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  user_id         uuid references profiles(id) on delete cascade,
  provider        text not null
                  check (provider in ('gmail','outlook','google_calendar','twilio','whatsapp','linkedin','apollo','hunter','clearbit')),
  status          text not null default 'active'
                  check (status in ('active','inactive','error','pending_auth')),
  -- Tokens (criptografados via pgcrypto)
  access_token    text,
  refresh_token   text,
  token_expires_at timestamptz,
  -- Config
  config          jsonb not null default '{}',
  last_sync_at    timestamptz,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, user_id, provider)
);

-- ─────────────────────────────────────────
-- WEBHOOKS (outbound)
-- ─────────────────────────────────────────
create table webhooks (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  url             text not null,
  events          text[] not null default '{}',    -- ['deal.won','deal.stage_changed', ...]
  is_active       boolean not null default true,
  secret          text not null default encode(gen_random_bytes(32), 'hex'),
  headers         jsonb not null default '{}',
  last_triggered_at timestamptz,
  failure_count   integer not null default 0,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- EMAIL THREADS
-- ─────────────────────────────────────────
create table email_threads (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  external_id     text,                            -- Gmail thread ID / Outlook conversation ID
  provider        text not null,                   -- 'gmail' | 'outlook'
  subject         text,
  deal_id         uuid references deals(id) on delete set null,
  contact_id      uuid references contacts(id) on delete set null,
  owner_id        uuid references profiles(id),
  last_message_at timestamptz,
  message_count   integer not null default 0,
  created_at      timestamptz not null default now()
);
```

---

### 2.8 BILLING

```sql
-- ─────────────────────────────────────────
-- SUBSCRIPTIONS (Stripe)
-- ─────────────────────────────────────────
create table subscriptions (
  id                  uuid primary key default uuid_generate_v4(),
  org_id              uuid not null references organizations(id) on delete cascade,
  stripe_customer_id  text unique,
  stripe_subscription_id text unique,
  plan                text not null,
  status              text not null
                      check (status in ('trialing','active','past_due','canceled','unpaid')),
  seats               integer not null default 1,
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
-- USAGE METRICS (para billing por uso)
-- ─────────────────────────────────────────
create table usage_metrics (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  metric_type     text not null,                   -- 'ai_tokens','agent_actions','emails_sent'
  value           bigint not null default 0,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  created_at      timestamptz not null default now()
);
```

---

## 3. Indexes Críticos

```sql
-- Organizations
create index idx_organizations_slug on organizations(slug);

-- Profiles
create index idx_profiles_org_id on profiles(org_id);
create index idx_profiles_email on profiles(id);  -- FK para auth.users

-- Companies
create index idx_companies_org_id on companies(org_id);
create index idx_companies_domain on companies(domain) where domain is not null;
create index idx_companies_name_trgm on companies using gin(name gin_trgm_ops);

-- Contacts
create index idx_contacts_org_id on contacts(org_id);
create index idx_contacts_company_id on contacts(company_id);
create index idx_contacts_email on contacts(email) where email is not null;
create index idx_contacts_name_trgm on contacts using gin((first_name || ' ' || coalesce(last_name,'')) gin_trgm_ops);

-- Deals
create index idx_deals_org_id on deals(org_id);
create index idx_deals_pipeline_id on deals(pipeline_id);
create index idx_deals_stage_id on deals(stage_id);
create index idx_deals_owner_id on deals(owner_id);
create index idx_deals_company_id on deals(company_id);
create index idx_deals_status on deals(status) where is_deleted = false;
create index idx_deals_sniper_score on deals(org_id, sniper_score desc) where is_deleted = false;

-- Activities
create index idx_activities_org_id on activities(org_id);
create index idx_activities_deal_id on activities(deal_id);
create index idx_activities_contact_id on activities(contact_id);
create index idx_activities_occurred_at on activities(occurred_at desc);

-- Signals
create index idx_signals_org_id on signals(org_id);
create index idx_signals_deal_id on signals(deal_id);
create index idx_signals_contact_id on signals(contact_id);
create index idx_signals_detected_at on signals(detected_at desc);
create index idx_signals_unprocessed on signals(org_id, detected_at) where processed = false;

-- Agent Actions
create index idx_agent_actions_org_id on agent_actions(org_id);
create index idx_agent_actions_status on agent_actions(org_id, status) where status in ('pending','awaiting_approval');
create index idx_agent_actions_deal_id on agent_actions(deal_id);

-- Sentiment
create index idx_sentiment_deal_id on sentiment_analyses(deal_id);
create index idx_sentiment_contact_id on sentiment_analyses(contact_id);

-- Vector search
create index idx_contacts_embedding on contacts using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_companies_embedding on companies using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_sentiment_embedding on sentiment_analyses using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

---

## 4. Row Level Security (RLS)

```sql
-- Habilitar RLS em todas as tabelas
alter table organizations     enable row level security;
alter table profiles          enable row level security;
alter table invitations        enable row level security;
alter table companies         enable row level security;
alter table contacts          enable row level security;
alter table pipelines         enable row level security;
alter table pipeline_stages   enable row level security;
alter table deals             enable row level security;
alter table deal_contacts     enable row level security;
alter table activities        enable row level security;
alter table agent_configs     enable row level security;
alter table agent_actions     enable row level security;
alter table agent_runs        enable row level security;
alter table icp_profiles      enable row level security;
alter table sniper_scores     enable row level security;
alter table signals           enable row level security;
alter table hit_lists         enable row level security;
alter table trigger_rules     enable row level security;
alter table sentiment_analyses enable row level security;
alter table emotion_maps      enable row level security;
alter table call_recordings   enable row level security;
alter table buyer_personas    enable row level security;
alter table integrations      enable row level security;
alter table webhooks          enable row level security;
alter table email_threads     enable row level security;
alter table subscriptions     enable row level security;
alter table usage_metrics     enable row level security;

-- Helper function: retorna org_id do usuário logado
create or replace function auth.org_id()
returns uuid language sql stable security definer as $$
  select org_id from profiles where id = auth.uid()
$$;

-- Helper function: retorna role do usuário logado
create or replace function auth.user_role()
returns text language sql stable security definer as $$
  select role from profiles where id = auth.uid()
$$;

-- Política padrão: usuário acessa apenas dados da própria org
-- (Padrão aplicado a todas as tabelas com org_id)

-- PROFILES
create policy "profiles_select_own_org" on profiles
  for select using (org_id = auth.org_id());

create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- ORGANIZATIONS
create policy "org_select_own" on organizations
  for select using (id = auth.org_id());

create policy "org_update_admin" on organizations
  for update using (auth.org_id() = id and auth.user_role() = 'admin');

-- DEALS (exemplo representativo — aplicar padrão a todas as tabelas)
create policy "deals_select_own_org" on deals
  for select using (org_id = auth.org_id() and is_deleted = false);

create policy "deals_insert_own_org" on deals
  for insert with check (org_id = auth.org_id());

create policy "deals_update_own_org" on deals
  for update using (
    org_id = auth.org_id()
    and (
      owner_id = auth.uid()
      or auth.user_role() in ('admin','manager')
    )
  );

create policy "deals_delete_manager" on deals
  for update using (
    org_id = auth.org_id()
    and auth.user_role() in ('admin','manager')
  );
```

---

## 5. Realtime Channels

```sql
-- Habilitar realtime nas tabelas críticas
alter publication supabase_realtime add table deals;
alter publication supabase_realtime add table agent_actions;
alter publication supabase_realtime add table signals;
alter publication supabase_realtime add table hit_lists;
alter publication supabase_realtime add table sentiment_analyses;
alter publication supabase_realtime add table emotion_maps;
```

**Canais por feature:**

| Canal | Tabela | Evento | Consumidor |
|-------|--------|--------|-----------|
| `org:{id}:deals` | deals | INSERT/UPDATE | Pipeline Kanban |
| `org:{id}:signals` | signals | INSERT | Signal Feed |
| `org:{id}:agent_actions` | agent_actions | INSERT/UPDATE | Agent Hub |
| `org:{id}:hit_lists` | hit_lists | INSERT | Hit List daily |
| `deal:{id}:sentiment` | sentiment_analyses | INSERT | Emotion Map |

---

## 6. Jobs Agendados (pg_cron)

```sql
-- Sniper Score: recalcular scores a cada hora
select cron.schedule(
  'sniper-score-recalc',
  '0 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.edge_function_url') || '/sniper-recalc',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )
  $$
);

-- Hit List: gerar lista diária às 7h (timezone Brasília)
select cron.schedule(
  'hit-list-daily',
  '0 10 * * *',         -- 10h UTC = 7h Brasília
  $$
    select net.http_post(
      url := current_setting('app.edge_function_url') || '/hit-list-generate',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )
  $$
);

-- Rotting deals: checar inatividade diariamente
select cron.schedule(
  'rotting-deals-check',
  '0 9 * * *',
  $$select net.http_post(url := current_setting('app.edge_function_url') || '/rotting-check', headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')), body := '{}'::jsonb)$$
);

-- Limpeza: purge agent_actions completed > 30 dias
select cron.schedule(
  'cleanup-agent-actions',
  '0 2 * * 0',          -- todo domingo às 2h
  $$
    delete from agent_actions
    where status in ('completed','rejected')
    and completed_at < now() - interval '30 days'
  $$
);
```

---

## 7. Edge Functions (Supabase)

| Função | Trigger | Descrição |
|--------|---------|-----------|
| `sniper-recalc` | pg_cron hourly | Recalcula Sniper Scores via Claude |
| `hit-list-generate` | pg_cron daily | Gera Hit List diária por rep |
| `rotting-check` | pg_cron daily | Detecta deals sem atividade |
| `sentiment-analyze` | DB trigger (activities) | Analisa sentimento de nova atividade |
| `agent-executor` | Queue (agent_actions) | Executa ações de agentes aprovadas |
| `signal-processor` | DB trigger (signals) | Processa sinais e atualiza scores |
| `webhook-dispatcher` | DB trigger (deals, activities) | Dispara webhooks configurados |
| `enrichment-worker` | Manual / agent action | Enriquece contatos e empresas |
| `call-transcribe` | Storage trigger | Transcreve calls via Whisper/Twilio |
| `stripe-webhook` | Stripe → HTTP | Sincroniza billing e planos |

---

## 8. Estrutura de Pastas (Next.js)

```
nexora/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   └── signup/
│   │   ├── (dashboard)/
│   │   │   ├── pipeline/
│   │   │   ├── contacts/
│   │   │   ├── companies/
│   │   │   ├── agents/          # Agent Hub
│   │   │   ├── sniper/          # Módulo Sniper
│   │   │   ├── sentiment/       # IA Sentimental
│   │   │   ├── analytics/
│   │   │   └── settings/
│   │   └── api/
│   │       ├── agents/
│   │       ├── sniper/
│   │       ├── sentiment/
│   │       └── webhooks/
│   ├── components/
│   │   ├── pipeline/
│   │   ├── agents/
│   │   ├── sniper/
│   │   ├── sentiment/
│   │   └── ui/                  # shadcn/ui customizados
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── middleware.ts
│   │   ├── ai/
│   │   │   ├── agents/          # Anthropic Agent SDK
│   │   │   ├── sentiment.ts
│   │   │   └── sniper.ts
│   │   └── integrations/
│   ├── types/
│   │   └── database.ts          # Gerado via supabase gen types
│   └── hooks/
│       ├── use-pipeline.ts
│       ├── use-sniper.ts
│       └── use-sentiment.ts
├── supabase/
│   ├── migrations/
│   │   └── 20260330000000_initial_schema.sql
│   ├── functions/
│   │   ├── sniper-recalc/
│   │   ├── sentiment-analyze/
│   │   ├── agent-executor/
│   │   └── hit-list-generate/
│   └── seed.sql
├── .env.local
└── package.json
```

---

## 9. Variáveis de Ambiente

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic
ANTHROPIC_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Resend (email)
RESEND_API_KEY=

# Twilio (calls)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Integrações de enriquecimento
APOLLO_API_KEY=
HUNTER_API_KEY=

# App
NEXT_PUBLIC_APP_URL=
NEXTAUTH_SECRET=
```

---

## 10. Decisões Arquiteturais

| # | Decisão | Alternativa | Justificativa |
|---|---------|-------------|---------------|
| ADR-01 | Supabase como backend completo | Firebase, PlanetScale | RLS nativa, Realtime, Auth, Storage integrados — zero backend separado |
| ADR-02 | pgvector para embeddings | Pinecone, Weaviate | Co-location com dados relacionais, sem infra adicional |
| ADR-03 | Claude claude-sonnet-4-6 para todos os agentes | GPT-4, Gemini | Superior em raciocínio contextual, Agent SDK nativo |
| ADR-04 | Next.js App Router | Remix, SvelteKit | Server Components para SSR de pipeline, ecosystem maduro |
| ADR-05 | Edge Functions em vez de backend separado | Express API, Fastify | Serverless, co-deployed com Supabase, sem cold starts críticos |
| ADR-06 | pg_cron para jobs | Bull, Temporal | Elimina Redis/worker, jobs dentro do Postgres |
| ADR-07 | Soft delete (is_deleted) | Hard delete | Audit trail, possibilidade de restore, análise histórica |

---

*— Aria, arquitetando o futuro 🏗️*
