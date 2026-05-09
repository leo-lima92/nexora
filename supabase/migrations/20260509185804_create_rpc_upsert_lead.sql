-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: RPC atômica `rpc_upsert_lead` — Inbound webhook (Comando 2)
-- Date:      2026-05-09
-- Context:   POST /api/webhooks/aios-lead hoje faz dois INSERTs separados
--            (companies, depois contacts). Sem transação, falha no segundo
--            deixa company órfã. Esta RPC envelopa os dois numa única
--            transação implícita do PL/pgSQL — falha em qualquer ponto faz
--            ROLLBACK e nenhuma row é persistida.
--
--            Decisões (alinhadas com Leonardo em 2026-05-09):
--            - SEM dedup. Cada chamada cria 1 company + 1 contact, idêntico
--              ao comportamento atual. Preserva atribuição multi-touch Meta
--              e zero risco para o contrato Outbound CAPI homologado.
--            - Mantém schema vigente: contacts.company_id → companies.id.
--            - Nome `rpc_upsert_lead` reflete o pedido original; o comportamento
--              real é INSERT puro atômico (sem ON CONFLICT). "Upsert" no nome
--              fica como hook semântico para evolução futura, se autorizada.
--            - SECURITY INVOKER (default): só callers com privilégio para
--              inserir nas tabelas (ex.: service_role) conseguem invocar.
--              Anon/authenticated batem em RLS de companies/contacts e falham.
--            - search_path lockado em `public, pg_temp` — defesa contra
--              search_path injection (CVE-2018-1058 family).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.rpc_upsert_lead(
  p_org_id            uuid,
  p_name              text,
  p_lead_origin       text,
  p_traffic_source    text,
  p_meta_campaign_id  text,
  p_meta_adset_id     text,
  p_meta_ad_id        text,
  p_first_name        text,
  p_last_name         text,
  p_phone             text,
  p_email             text
)
returns table (company_id uuid, contact_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_contact_id uuid;
begin
  -- ── 1. Insert na company com tracking Meta completo ────────────────────
  insert into public.companies (
    org_id,
    name,
    lead_origin,
    traffic_source,
    meta_campaign_id,
    meta_adset_id,
    meta_ad_id,
    status,
    source
  )
  values (
    p_org_id,
    p_name,
    p_lead_origin,
    p_traffic_source,
    p_meta_campaign_id,
    p_meta_adset_id,
    p_meta_ad_id,
    'novo',
    'manual'
  )
  returning id into v_company_id;

  -- ── 2. Insert no contact apontando pra company recém-criada ────────────
  -- Se este insert falhar, a transação inteira faz rollback e v_company_id
  -- não é persistida — sem órfãos.
  insert into public.contacts (
    org_id,
    company_id,
    first_name,
    last_name,
    phone,
    email,
    source
  )
  values (
    p_org_id,
    v_company_id,
    p_first_name,
    p_last_name,
    p_phone,
    p_email,
    'manual'
  )
  returning id into v_contact_id;

  -- ── 3. Retorna ambos os IDs para observabilidade ───────────────────────
  return query select v_company_id, v_contact_id;
end;
$$;

comment on function public.rpc_upsert_lead is
  'Insere atomicamente 1 company + 1 contact vinculados — webhook Inbound (Comando 2). '
  'SEM dedup: cada chamada cria registros novos. Falha em qualquer insert faz ROLLBACK total. '
  'Retorna (company_id, contact_id). Caller esperado: service_role via supabaseAdmin.';

-- ── Permissões: revogamos do PUBLIC e damos só ao service_role ─────────────
-- (anon e authenticated não devem invocar — webhook é server-to-server only).
revoke all on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public;

grant execute on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) to service_role;
