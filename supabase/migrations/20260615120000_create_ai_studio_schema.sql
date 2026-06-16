-- ============================================================
-- Nexora — AI Studio (Agent Builder Multi-tenant) Schema
-- Version:   1.0.0
-- Date:      2026-06-15
-- Author:    @data-engineer (Dara) — Missão 1
-- Reason:    Novo Bounded Context (NEXORA_MANIFEST.md §1.5).
--            Usuário final cria agentes SDR dinamicamente; prompt de
--            sistema, tom de voz e config persistidos por org_id.
--            Memória conversacional Lead <-> Bot em agent_sessions +
--            chat_history (com embedding p/ RAG / memória semântica).
--
-- Coexistência: NÃO altera agent_configs (legado, 5 tipos fixos).
--               ai_agents é estrutura independente.
--
-- RLS: estrito por org_id via helper public.get_org_id() (initial_schema).
-- DELETE em chat_history: restrito a admin do org (compliance LGPD).
-- ============================================================

-- ─────────────────────────────────────────
-- AI AGENTS — config dos bots criados pelo usuário
-- ─────────────────────────────────────────
create table ai_agents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,                        -- nome do bot
  system_prompt   text not null,                        -- prompt de sistema (data-driven)
  tone_of_voice   text not null default 'profissional', -- tom de voz
  status          text not null default 'draft'
                  check (status in ('draft','active','paused','archived')),
  -- Parametrização do modelo Anthropic ──────────────────────────────
  model           text not null default 'claude-sonnet-4-6',
  temperature     numeric(3,2) not null default 0.7
                  check (temperature between 0 and 1),
  max_tokens      integer not null default 1024
                  check (max_tokens between 1 and 8192),
  -- Extensibilidade / governança ────────────────────────────────────
  config          jsonb not null default '{}',
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- AGENT SESSIONS — 1 conversa entre um Lead e um Bot
-- ─────────────────────────────────────────
create table agent_sessions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  ai_agent_id     uuid not null references ai_agents(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  deal_id         uuid references deals(id) on delete set null,
  channel         text not null default 'webchat'
                  check (channel in ('webchat','whatsapp','instagram','email','linkedin')),
  status          text not null default 'active'
                  check (status in ('active','paused','closed','handed_off')),
  message_count   integer not null default 0,
  last_message_at timestamptz,
  summary         text,                                 -- resumo rolante (compactação de memória)
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- CHAT HISTORY — memória completa Lead <-> Bot (1 linha = 1 turno)
-- ─────────────────────────────────────────
create table chat_history (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  session_id      uuid not null references agent_sessions(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  role            text not null
                  check (role in ('user','assistant','system','tool')),
  content         text not null,
  -- Observabilidade de custo/uso ────────────────────────────────────
  model           text,
  tokens_input    integer,
  tokens_output   integer,
  stop_reason     text,
  metadata        jsonb not null default '{}',
  -- Fundação RAG / memória semântica ────────────────────────────────
  embedding       vector(1536),
  created_at      timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_ai_agents_org_id  on ai_agents(org_id);
create index idx_ai_agents_active  on ai_agents(org_id, status) where status = 'active';

create index idx_agent_sessions_org_id   on agent_sessions(org_id);
create index idx_agent_sessions_agent    on agent_sessions(ai_agent_id);
create index idx_agent_sessions_contact  on agent_sessions(contact_id);
-- Garante 1 sessão ATIVA por (agente, contato, canal) — evita threads duplicadas.
create unique index uq_agent_sessions_active
  on agent_sessions(org_id, ai_agent_id, contact_id, channel)
  where status = 'active';

create index idx_chat_history_session  on chat_history(session_id, created_at asc);
create index idx_chat_history_org_id   on chat_history(org_id);
-- Vector index p/ busca semântica (memória RAG).
create index idx_chat_history_embedding
  on chat_history using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table ai_agents      enable row level security;
alter table agent_sessions enable row level security;
alter table chat_history   enable row level security;

-- ── Policies: ai_agents (CRUD completo dentro do tenant) ──
create policy "ai_agents_select" on ai_agents for select using (org_id = public.get_org_id());
create policy "ai_agents_insert" on ai_agents for insert with check (org_id = public.get_org_id());
create policy "ai_agents_update" on ai_agents for update using (org_id = public.get_org_id());
create policy "ai_agents_delete" on ai_agents for delete using (org_id = public.get_org_id());

-- ── Policies: agent_sessions ──
create policy "agent_sessions_select" on agent_sessions for select using (org_id = public.get_org_id());
create policy "agent_sessions_insert" on agent_sessions for insert with check (org_id = public.get_org_id());
create policy "agent_sessions_update" on agent_sessions for update using (org_id = public.get_org_id());

-- ── Policies: chat_history ──
-- Memória append-only no fluxo normal: SELECT + INSERT dentro do tenant.
create policy "chat_history_select" on chat_history for select using (org_id = public.get_org_id());
create policy "chat_history_insert" on chat_history for insert with check (org_id = public.get_org_id());
-- DELETE restrito ao admin do org (compliance LGPD — exclusão de dados sob demanda).
create policy "chat_history_delete_lgpd" on chat_history for delete using (
  org_id = public.get_org_id() and public.get_user_role() = 'admin'
);

-- ============================================================
-- REALTIME
-- UI reflete o agente digitando/respondendo ao vivo.
-- ============================================================
alter publication supabase_realtime add table agent_sessions;
alter publication supabase_realtime add table chat_history;
