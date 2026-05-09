-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: FIX para `rpc_upsert_lead` — declara parâmetros opcionais com
--            DEFAULT NULL para refletir que last_name/phone/email são nullable
--            nas tabelas.
-- Date:      2026-05-09
-- Context:   Sem o DEFAULT NULL, o `supabase gen types typescript` gerou esses
--            parâmetros como `string` (não-nullable), quebrando a chamada
--            `.rpc(...)` no TS quando o caller passa `null` (ex.: payload sem
--            phone/email/last_name).
--
--            Como a assinatura de função muda apenas em DEFAULTs (mesmos tipos),
--            `create or replace function` substitui in-place sem precisar drop.
--            Comportamento runtime idêntico — só ganha tolerância a NULL no
--            chamador.
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
begin
  insert into public.companies (
    org_id, name, lead_origin, traffic_source,
    meta_campaign_id, meta_adset_id, meta_ad_id,
    status, source
  )
  values (
    p_org_id, p_name, p_lead_origin, p_traffic_source,
    p_meta_campaign_id, p_meta_adset_id, p_meta_ad_id,
    'novo', 'manual'
  )
  returning id into v_company_id;

  insert into public.contacts (
    org_id, company_id, first_name, last_name,
    phone, email, source
  )
  values (
    p_org_id, v_company_id, p_first_name, p_last_name,
    p_phone, p_email, 'manual'
  )
  returning id into v_contact_id;

  return query select v_company_id, v_contact_id;
end;
$$;
