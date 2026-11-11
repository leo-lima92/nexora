-- manifest: **O pedido de campanha da tela Tráfego Agêntico ganha registro durável: `public.aios_campaign_requests` guarda cada pedido despachado ao motor de tráfego (AIOS, Python) e é por ela que a RESPOSTA do motor volta ao CRM.** Até aqui o pedido vivia só no estado do React e numa linha de `api_audit_log` sem o texto; o motor não tinha onde devolver o resultado. O CRM insere a linha (`queued`, com o `request_id` gerado na tela, único por organização) ANTES de chamar o motor e só acerta o desfecho do despacho (`unconfirmed` no prazo estourado, `failed` na recusa); quem escreve `processing`/`completed`/`failed`, `engine_job_id`, `response_summary`, `campaign_metadata` e `error_message` é o motor, com a service key. RLS exige `manager` para ler e para inserir (a mesma régua da tela e da rota), o INSERT de `authenticated` só aceita linha nascendo `queued`, vazia e em nome de quem está logado, e não há policy de UPDATE/DELETE: resposta de campanha só entra pela service key. `anon` sem privilégio nenhum. Contrato com o lado Python em `docs/AIOS_PYTHON_CONTRACT.md`. Gate: `tests/invariants/aios-campaign-requests-rls.test.ts`.

-- 9902 — o pedido de campanha vira linha, e a resposta do motor volta por ela
--
-- ─── O que esta tabela é ────────────────────────────────────────────────────
-- A Fase 5A (`POST /api/v1/aios-dispatch`) entrega ao motor AIOS o pedido que a
-- pessoa escreveu na tela `/app/aios`. O motor monta a campanha do lado dele e
-- o resultado NÃO volta pela chamada HTTP — a decisão do produto é que volte
-- pelo Supabase. Esta é a tabela por onde ele volta: uma linha por pedido, que
-- o CRM cria e o motor completa.
--
-- ─── Quem escreve o quê ─────────────────────────────────────────────────────
--   CRM, no INSERT (sessão da pessoa, sob RLS):
--     organization_id, user_id, request_id, prompt, status = 'queued'
--   CRM, depois do despacho (service role, filtrando organização e SÓ enquanto
--   a linha ainda está 'queued' — o motor pode ter andado antes):
--     status = 'unconfirmed'  o motor não confirmou no prazo (pode ter chegado)
--     status = 'failed' + error_message   o motor recusou / não foi alcançado
--     engine_job_id           o protocolo que o motor devolveu no aceite
--   Motor AIOS (service key, que ignora RLS):
--     status → 'processing' → 'completed' | 'failed'
--     engine_job_id, response_summary, campaign_metadata, error_message
--
-- `updated_at` é do banco (trigger): nenhum dos dois lados precisa lembrar.
--
-- ─── Por que `request_id` é texto e único por organização ───────────────────
-- É o id que a TELA gera para cada pedido e que acompanha o pedido até o motor
-- (campo `request_id` do corpo do despacho). É a chave que o motor usa para
-- achar a linha — `(organization_id, request_id)` — e é o que impede o mesmo
-- pedido de virar duas linhas (e duas campanhas) num reenvio: o segundo INSERT
-- bate em 23505 e a rota não despacha de novo. Texto, e não uuid, porque quem
-- chama a rota sem a tela (integração) pode trazer o próprio identificador.
--
-- ─── Por que a RLS exige `manager`, e por que só SELECT e INSERT ────────────
-- Um pedido aqui vira campanha paga com a verba da empresa inteira; a tela e a
-- rota já exigem `manager`. A rota não é a única porta — o PostgREST é
-- alcançável do navegador com o JWT da pessoa —, então a policy repete a régua
-- (o mesmo desenho de `webhook_lead_captures`).
--
-- O INSERT de `authenticated` só aceita a linha no estado em que um pedido
-- NASCE: `queued`, em nome de `auth.uid()`, sem protocolo, sem resposta e sem
-- erro. Sem isso um gestor gravaria pelo PostgREST uma linha `completed` com um
-- `response_summary` escrito por ele, e a tela a mostraria como resposta do
-- motor. Não há policy de UPDATE nem de DELETE, e o GRANT não os concede: o
-- desfecho de uma campanha só entra pela service key.
--
-- `fn_is_platform_admin()` (função pura) só na LEITURA: é o mesmo critério do
-- par `_read`/`_write` da 9005 — `support_readonly` segue lendo, e ninguém de
-- plataforma insere pedido em nome de cliente.
--
-- ─── `user_id`: RESTRICT, não CASCADE ───────────────────────────────────────
-- Apagar o login de quem pediu não pode levar junto o histórico de campanhas
-- pagas da empresa (anti-pattern "cascade fantasma"). A exclusão de
-- ORGANIZAÇÃO não é barrada: `organization_id` cascateia e as linhas saem
-- antes de `lib/tenants/exclusao.ts` tentar remover os logins.
--
-- ─── Tetos ──────────────────────────────────────────────────────────────────
-- Os CHECKs de tamanho protegem a tela do que o motor escrever: a listagem
-- devolve as linhas inteiras, e um `response_summary` sem teto viraria megabytes
-- a cada atualização. Os números estão no contrato; estourar é 23514.
--
-- ─── GRANTs ─────────────────────────────────────────────────────────────────
-- No Supabase real o default ACL de `public` concede TUDO a `anon`,
-- `authenticated` e `service_role` em toda tabela nova. Enumerar não retira:
-- por isso o `revoke all` explícito antes dos `grant`.
--
-- Idempotente: `create table if not exists`, `create index if not exists`,
-- `drop ... if exists` antes de cada trigger/policy, e `revoke`/`grant`
-- reaplicáveis. SQL literal (sem `execute format()`): a conferência de
-- isolamento do `update.sh` lê os `create policy` deste arquivo.

create table if not exists public.aios_campaign_requests (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_id text not null
    constraint aios_campaign_requests_request_id_tamanho
      check (char_length(request_id) between 8 and 100),
  prompt text not null
    constraint aios_campaign_requests_prompt_preenchido
      check (btrim(prompt) <> ''),
  status text not null default 'queued'
    constraint aios_campaign_requests_status_check
      check (status in ('queued', 'processing', 'completed', 'failed', 'unconfirmed')),
  engine_job_id text
    constraint aios_campaign_requests_engine_job_id_tamanho
      check (engine_job_id is null or char_length(engine_job_id) <= 200),
  response_summary text
    constraint aios_campaign_requests_response_summary_tamanho
      check (response_summary is null or char_length(response_summary) <= 20000),
  campaign_metadata jsonb not null default '{}'::jsonb
    constraint aios_campaign_requests_campaign_metadata_objeto
      check (jsonb_typeof(campaign_metadata) = 'object'
             and octet_length(campaign_metadata::text) <= 65536),
  error_message text
    constraint aios_campaign_requests_error_message_tamanho
      check (error_message is null or char_length(error_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aios_campaign_requests_org_request_id_key unique (organization_id, request_id)
);

-- A listagem da tela: os pedidos da organização, do mais novo para o mais
-- antigo, com `id` como desempate do cursor.
create index if not exists aios_campaign_requests_org_criado_idx
  on public.aios_campaign_requests (organization_id, created_at desc, id desc);

-- A FK de `user_id` é RESTRICT: sem índice, cada remoção de login varreria a
-- tabela inteira para conferir se a pessoa tem pedido.
create index if not exists aios_campaign_requests_user_idx
  on public.aios_campaign_requests (user_id);

comment on table public.aios_campaign_requests is
  'FORK NEXORA (migration 9902) — pedidos de campanha despachados ao motor de tráfego (AIOS) pela tela /app/aios, e o retorno do motor. O CRM insere (queued) e marca o desfecho do despacho; o motor completa com a service key. Contrato: docs/AIOS_PYTHON_CONTRACT.md.';
comment on column public.aios_campaign_requests.request_id is
  'Id do pedido gerado na tela (ou pela rota, quando ausente). Único por organização; é a chave que o motor usa para achar a linha e vai no campo request_id do corpo do despacho.';
comment on column public.aios_campaign_requests.status is
  'queued = registrado e à espera do motor; unconfirmed = o motor não confirmou o recebimento no prazo (pode ter chegado); processing = o motor está montando; completed = terminou (response_summary); failed = não deu (error_message). Vocabulário espelhado em lib/aios/pedidos.ts.';
comment on column public.aios_campaign_requests.engine_job_id is
  'Protocolo do motor. O CRM grava o que vier no aceite do despacho; o motor pode gravar/corrigir.';
comment on column public.aios_campaign_requests.response_summary is
  'Resposta do motor, em texto, mostrada como está na tela. Só o motor escreve (service key). Teto de 20.000 caracteres.';
comment on column public.aios_campaign_requests.campaign_metadata is
  'Objeto JSON livre do motor (ids de campanha, verba, links). A tela não lê caminho nenhum daqui. Teto de 64 KB.';
comment on column public.aios_campaign_requests.error_message is
  'Por que falhou, em texto para a pessoa. O CRM escreve quando o despacho não é aceito; o motor escreve quando a campanha falha. Teto de 2.000 caracteres.';

drop trigger if exists trg_aios_campaign_requests_updated_at on public.aios_campaign_requests;
create trigger trg_aios_campaign_requests_updated_at
  before update on public.aios_campaign_requests
  for each row execute function public.fn_set_updated_at();

alter table public.aios_campaign_requests enable row level security;

drop policy if exists aios_campaign_requests_manager_read on public.aios_campaign_requests;
create policy aios_campaign_requests_manager_read on public.aios_campaign_requests
  for select
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists aios_campaign_requests_manager_insert on public.aios_campaign_requests;
create policy aios_campaign_requests_manager_insert on public.aios_campaign_requests
  for insert
  with check (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'manager')
    and user_id = (select auth.uid())
    and status = 'queued'
    and engine_job_id is null
    and response_summary is null
    and error_message is null
    and campaign_metadata = '{}'::jsonb
  );

revoke all on table public.aios_campaign_requests from public, anon, authenticated, service_role;
grant select, insert on table public.aios_campaign_requests to authenticated;
grant select, insert, update, delete on table public.aios_campaign_requests to service_role;
