-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Closed Loop tracking — Nexora ↔ AIOS Python (Tráfego Pago)
-- Comando:   2 — Ponte de Dados (Inbound + Outbound unificado)
-- Context:   Suporta o ciclo fechado entre Meta Ads → Nexora → CAPI feedback.
--            O agente AIOS Python injeta leads via API preenchendo origem,
--            tráfego e IDs do Meta. O time comercial move `status` e preenche
--            `deal_value` no funil. O AIOS lê esses dados para retroalimentar
--            a Conversions API do Meta (otimização de campanhas).
--
--            Decisões (Aria + Dara):
--            - Sem CHECK constraints em vocabulários (`lead_origin`, `status`,
--              `traffic_source`) — vocabulário ainda em validação. Travar
--              prematuro inviabilizaria evoluções do funil sem migration.
--            - Índices parciais apenas para colunas com query path concreto
--              já descrito: `meta_campaign_id` (CAPI feedback por campanha) e
--              `status` (filtro de funil pelo time comercial).
--            - Idempotência total via `if not exists` — segurança em re-runs.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Origem do lead (outbound = AIOS prospecção; inbound = Meta/Google Ads).
alter table public.companies
  add column if not exists lead_origin varchar(50) default 'outbound';

-- 2. Canal de tráfego pago (preenchido pelo AIOS via API quando inbound).
alter table public.companies
  add column if not exists traffic_source varchar(100);

-- 3. Identificadores de campanha do Meta Ads (hierarquia: campaign → adset → ad).
alter table public.companies
  add column if not exists meta_campaign_id varchar(255);

alter table public.companies
  add column if not exists meta_adset_id varchar(255);

alter table public.companies
  add column if not exists meta_ad_id varchar(255);

-- 4. Status no funil de vendas (movido manualmente pelo time comercial).
alter table public.companies
  add column if not exists status varchar(50) default 'novo';

-- 5. Valor do negócio fechado — input para CAPI retroalimentação (purchase event).
alter table public.companies
  add column if not exists deal_value decimal(12,2);

-- 6. Documentação do contrato com o agente AIOS Python.
comment on column public.companies.lead_origin is
  'Origem do lead: outbound (AIOS prospecção) ou inbound (tráfego pago). Default outbound.';
comment on column public.companies.traffic_source is
  'Canal de tráfego quando inbound. Ex: meta_ads, google_ads, tiktok_ads.';
comment on column public.companies.meta_campaign_id is
  'ID da campanha no Meta Ads. Preenchido pelo agente AIOS via API. Usado para feedback CAPI.';
comment on column public.companies.meta_adset_id is
  'ID do adset no Meta Ads. Preenchido pelo agente AIOS via API.';
comment on column public.companies.meta_ad_id is
  'ID do anúncio (ad) no Meta Ads. Preenchido pelo agente AIOS via API.';
comment on column public.companies.status is
  'Status no funil. Movido pelo time comercial. Ex: novo, qualificado, proposta, venda_fechada, perdido.';
comment on column public.companies.deal_value is
  'Valor do negócio fechado em moeda local. Lido pelo AIOS para retroalimentar a CAPI (purchase value).';

-- 7. Índices justificados pelo caso de uso descrito.
--    7.1 CAPI feedback: o AIOS consulta "deals fechados por campanha" para
--        enviar conversões ao Meta. Index parcial em `meta_campaign_id`.
create index if not exists companies_meta_campaign_id_idx
  on public.companies (meta_campaign_id)
  where meta_campaign_id is not null;

--    7.2 Funil: filtros frequentes por status no CRM. Standalone btree (status
--        tem DEFAULT 'novo' — não vale a pena partial).
create index if not exists companies_status_idx
  on public.companies (status);
