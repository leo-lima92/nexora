-- ============================================================================
-- 0145 — CONVERGÊNCIA: extraction_runs, rpc_upsert_lead e a fusão de `contacts`
--
-- Quita a dívida declarada na 0144. Três peças, todas aditivas.
--
-- ── A DECISÃO CENTRAL: `contacts` é UMA tabela, não duas ────────────────────
--
-- `contacts` do AIOS e `contacts` do chassi nunca foram "a mesma tabela com
-- nomes diferentes": são DUAS TABELAS que colidiram no mesmo nome durante o
-- fork. O `tenancy_shim` (20260428000001) registrou a intenção de deixar os
-- dois modelos coexistirem. Esta migration encerra essa intenção, porque ela
-- não sobrevive ao produto:
--
--   `public.contacts` do chassi é o HUB. Vinte e uma tabelas apontam para ele
--   — conversations, messages, crm_leads, lead_state, followup_enrollments,
--   demandas, llm_calls, send_ledger, job_queue, before_send_traces… Se o
--   prospect raspado do Google Maps virasse linha numa tabela paralela, ele
--   NUNCA poderia receber um WhatsApp, entrar num funil ou ser trabalhado por
--   um agente. O Closed Loop — extrair, contatar, converter — morreria entre a
--   extração e o contato. Uma pessoa = uma linha não é preferência estética; é
--   a única topologia em que o funil é contínuo.
--
-- Então o chassi vence como canônico (ele carrega LGPD, consentimento, CPF
-- criptografado, anonimização e merge), e o AIOS ganha as colunas que trazem
-- fato NOVO. Campo a campo, por DIRC:
--
--   org_id          -> organization_id (JÁ EXISTE)  — ver nota de segurança abaixo
--   phone           -> phone_number    (JÁ EXISTE)  — via fn_e164_or_null()
--   first/last_name -> name            (JÁ EXISTE)  — juntados na RPC
--   owner_id        -> created_by_user_id (JÁ EXISTE) — o mapper já chama o
--                      argumento de `createdBy`: é o mesmo fato
--   do_not_contact  -> is_blocked      (JÁ EXISTE)  — mesmo fato; o detector de
--                      STOP do chassi já escreve nessa coluna
--   email/source/tags                  (JÁ EXISTEM) — delta zero
--   company_id      -> COLUNA NOVA — o vínculo B2B, fato que o chassi não tinha
--
-- POR QUE NÃO DUPLICAR A CHAVE DE TENANT: adicionar `org_id` ao lado de
-- `organization_id` seria a mudança de menor atrito e a mais perigosa do
-- repositório. A RLS de `contacts` filtra `organization_id`; um segundo campo
-- pode divergir num UPDATE e a linha passa a ser visível ao tenant errado — ou
-- invisível ao dono. Duas fontes para o mesmo fato é o anti-pattern nº 2 do
-- CLAUDE.md, e sobre a coluna que separa clientes ele é falha de isolamento.
-- O writer converge; a chave de tenant continua única.
--
-- POR QUE O TELEFONE NÃO É "SÓ UM RENAME": `phone_number` do chassi tem CHECK
-- E.164 (`^\+\d{8,15}$`); `phone` do AIOS é texto raspado. A constraint NÃO é
-- relaxada — é alimentada por `fn_e164_or_null()`, que normaliza apenas quando
-- o valor é inequivocamente internacional. Número nacional ("(11) 3000-0000")
-- devolve NULL em vez de virar "+1130000000": prefixar `+` num número sem
-- código de país produz E.164 de formato válido e DESTINO ERRADO, e alguém
-- mandaria mensagem para um estranho. O valor cru é preservado em
-- `source_metadata.phone_raw` — nada se perde, e um telefone incidental nunca
-- derruba o lead inteiro.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. extraction_runs — tabela AIOS-nativa (sem contraparte no chassi)
--
-- Colunas conforme `src/services/extraction-run.service.ts` e o types que o
-- Hono compila. Sem `updated_at`: o service não escreve e o types não declara.
-- `created_by` apontava para `profiles` na migration AIOS original; o chassi
-- não tem `profiles`, então aponta para auth.users (mesma decisão da 0144).
-- CHECKs de source/status vêm da migration AIOS 20260419000000 (domínio já
-- expandido para succeeded/aborted e os apelidos curtos de source).
-- ---------------------------------------------------------------------------
create table if not exists public.extraction_runs (
  id                uuid default gen_random_uuid() not null,
  org_id            uuid not null,
  source            text not null,
  status            text default 'pending' not null,
  apify_actor_id    text,
  apify_run_id      text,
  query             text,
  cnae_codes        text[],
  location          text,
  max_results       integer default 100 not null,
  results_count     integer default 0 not null,
  companies_created integer default 0 not null,
  contacts_created  integer default 0 not null,
  raw_data          jsonb,
  error_message     text,
  created_by        uuid,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz default now() not null,
  constraint extraction_runs_pkey primary key (id),
  constraint extraction_runs_org_id_fkey foreign key (org_id)
    references public.organizations(id) on delete cascade,
  constraint extraction_runs_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null,
  constraint extraction_runs_source_check check (source in (
    'google_maps', 'apify_google_maps',
    'linkedin', 'apify_linkedin',
    'instagram', 'apify_instagram',
    'manual', 'phantombuster_linkedin', 'cnae_scraper'
  )),
  constraint extraction_runs_status_check check (status in (
    'pending', 'running', 'completed', 'succeeded', 'failed', 'aborted'
  ))
);

comment on table public.extraction_runs is
  'Execução de extração (Apify/scraper) no escopo do tenant. Ciclo de vida em src/services/extraction-run.service.ts.';

create index if not exists extraction_runs_org_created_idx
  on public.extraction_runs (org_id, created_at desc);

-- Índice parcial para `assertNoActiveRun`, que busca (org_id, source) ativa.
-- DELIBERADAMENTE NÃO-ÚNICO: um UNIQUE aqui viraria garantia de banco para o
-- "máximo 1 run ativa", mas proibiria duas extrações legítimas do MESMO source
-- com queries diferentes (google_maps de São Paulo e do Rio ao mesmo tempo). A
-- política é opt-in no service por design — o índice só a torna barata.
create index if not exists extraction_runs_active_by_source_idx
  on public.extraction_runs (org_id, source)
  where status in ('pending', 'running');

alter table public.extraction_runs enable row level security;

drop policy if exists tenant_isolation_extraction_runs_all on public.extraction_runs;
create policy tenant_isolation_extraction_runs_all on public.extraction_runs
  using ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin())
  with check ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin());

revoke all on table public.extraction_runs from anon;

-- ---------------------------------------------------------------------------
-- 2. contacts — as três colunas que trazem fato novo
--
-- Só entra o que tem writer ou reader HOJE. As demais colunas do types AIOS
-- (linkedin_*, seniority, department, mobile, timezone, embedding, is_deleted…)
-- ficam de fora: nenhum código as escreve, e campo sem writer numa tabela que
-- carrega LGPD é peso morto. `is_deleted` em especial seria armadilha — o
-- chassi não filtra por ela em lugar nenhum, então um contato "excluído"
-- continuaria aparecendo no CRM: falha-em-verde clássica.
-- ---------------------------------------------------------------------------
alter table public.contacts add column if not exists company_id       uuid;
alter table public.contacts add column if not exists apify_run_id     text;
alter table public.contacts add column if not exists preferred_channel text;

comment on column public.contacts.company_id is
  'Empresa (conta B2B) a que esta pessoa pertence. Vínculo que torna o funil contínuo: prospect raspado vira contato que o agente trabalha.';
comment on column public.contacts.apify_run_id is
  'Proveniência: run de extração que criou esta linha. Coluna (não jsonb) por simetria com companies.apify_run_id e por ser chave de busca.';

do $$
begin
  alter table public.contacts
    add constraint contacts_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists contacts_company_id_idx
  on public.contacts (company_id) where company_id is not null;
create index if not exists contacts_org_apify_run_idx
  on public.contacts (organization_id, apify_run_id) where apify_run_id is not null;

-- ---------------------------------------------------------------------------
-- 3. fn_e164_or_null — a ponte entre telefone raspado e a constraint do chassi
--
-- Normaliza para E.164 SOMENTE quando o valor já é internacional (tem `+`).
-- Sem `+` devolve NULL: adivinhar o código de país produziria um número de
-- formato válido e destino errado. IMMUTABLE + search_path travado.
-- ---------------------------------------------------------------------------
create or replace function public.fn_e164_or_null(p_raw text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
    when p_raw is null or btrim(p_raw) = '' then null
    when btrim(p_raw) !~ '^\+' then null
    when '+' || regexp_replace(p_raw, '\D', '', 'g') ~ '^\+\d{8,15}$'
      then '+' || regexp_replace(p_raw, '\D', '', 'g')
    else null
  end
$$;

comment on function public.fn_e164_or_null(text) is
  'Telefone raspado -> E.164 canônico, ou NULL quando ambíguo. Nunca adivinha código de país: E.164 bem-formado com destino errado é pior que ausência de telefone.';

-- Função em public nasce EXPOSTA — as duas origens de EXECUTE (grant direto a
-- anon do ALTER DEFAULT PRIVILEGES, e o grant a PUBLIC que o Postgres dá).
revoke execute on function public.fn_e164_or_null(text) from public, anon;
grant  execute on function public.fn_e164_or_null(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. rpc_upsert_lead — reescrita para o shape do chassi
--
-- ASSINATURA E RETORNO IDÊNTICOS aos da migration AIOS original: 11 parâmetros
-- (3 com DEFAULT NULL) devolvendo (company_id, contact_id). O bloco `Functions`
-- de `src/types/database.ts` continua válido sem uma linha de alteração — a
-- convergência acontece INTEIRA dentro do corpo.
--
-- `p_first_name`/`p_last_name` sobrevivem na assinatura mas convergem para a
-- coluna canônica `name`. Não viram colunas: o chamador real (server.ts) parte
-- de um nome inteiro e o QUEBRA com splitName() só para caber nesta assinatura;
-- guardar as duas metades além do nome junto seria duplicar o mesmo fato.
--
-- SECURITY INVOKER de propósito (não DEFINER): se um grant vazar para anon ou
-- authenticated, a RLS de contacts/companies ainda barra. DEFINER transformaria
-- vazamento de grant em escrita cross-tenant.
--
-- `drop` antes de `create`: a versão AIOS anterior pode existir em clones com
-- os mesmos tipos de parâmetro, e `create or replace` não troca o corpo quando
-- o conjunto de DEFAULTs difere. Idempotente pelo `if exists`.
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
);

create function public.rpc_upsert_lead(
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
  -- 1. Empresa (tabela AIOS-nativa da 0144 — aqui `org_id` é o nome certo).
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

  -- 4. Pessoa, na tabela canônica do chassi — a mesma para a qual apontam
  --    conversations, messages, crm_leads e o resto da máquina de agentes.
  --    Falha aqui faz ROLLBACK da company também: sem órfãos.
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
  'Insere atomicamente 1 company + 1 contact vinculados (webhook Inbound, Comando 2). SEM dedup: cada chamada cria registros novos, preservando atribuição multi-touch Meta. Escreve na `contacts` CANÔNICA do chassi — o contato nasce alcançável por WhatsApp, funil e agente. Falha em qualquer insert faz ROLLBACK total. Caller esperado: service_role.';

revoke all on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon;

grant execute on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
