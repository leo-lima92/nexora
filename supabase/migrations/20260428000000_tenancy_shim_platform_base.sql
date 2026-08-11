-- =============================================================================
-- TENANCY SHIM — "Spec 01 Plataforma Base" ausente no chassi DeskcommCRM
-- =============================================================================
-- Contexto (fork estrategico 2026-08-10, NEXORA_MANIFEST v1.3):
--
-- O chassi DeskcommCRM USA mas NUNCA DEFINE tres objetos de tenancy. Seu
-- `00001_initial_schema.sql` cria apenas extensions e deixa a Spec 01 como TODO:
--
--   objeto                 | uso no chassi                  | quem entrega
--   -----------------------|--------------------------------|---------------
--   organizations          | 65 FKs                         | NOS (20260330000000)
--   user_organizations     | 52 refs no app + 6 no SQL      | ESTA MIGRATION
--   fn_user_org_ids()      | 108 policies RLS               | ESTA MIGRATION
--
-- Sem estes dois objetos, as 108 policies do chassi nao sobem e as ~70 tabelas
-- dele ficam sem isolamento — risco de vazamento cross-tenant.
--
-- Esta migration NAO altera nenhuma tabela nossa. `companies`, `contacts`,
-- `ai_agents`, `agent_sessions` e `chat_history` seguem intactos, com `org_id`
-- e `public.get_org_id()`. Os dois modelos coexistem sobre a MESMA
-- `organizations`:
--
--   nosso  : profiles.org_id           -> get_org_id()      -> 1 org por user
--   chassi : user_organizations        -> fn_user_org_ids() -> N orgs por user
--
-- `profiles` continua sendo a fonte de verdade do nosso lado; esta tabela e a
-- fonte do lado do chassi. O backfill abaixo alinha as duas no momento zero.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_organizations — membership user <-> org (contrato do chassi)
-- -----------------------------------------------------------------------------
-- Colunas derivadas do uso real: lib/auth/provision.ts:79 (insert com user_id,
-- organization_id, role, accepted_at) e app/actions/team/acceptInvite.ts
-- (select id/revoked_at por user_id+organization_id; update role, revoked_at,
-- accepted_at, updated_at). O UNIQUE (user_id, organization_id) e obrigatorio:
-- o app trata o codigo Postgres 23505 como idempotencia no signup.
create table if not exists public.user_organizations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Uniao dos dois vocabularios: chassi usa viewer|agent|manager|admin,
  -- nosso profiles usa admin|manager|rep|viewer. Aceitar ambos evita quebrar
  -- qualquer um dos lados enquanto a nomenclatura nao for unificada.
  role            text not null default 'agent'
                  check (role in ('viewer','agent','rep','manager','admin')),
  invited_by      uuid references auth.users(id) on delete set null,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, organization_id)
);

comment on table public.user_organizations is
  'Membership user<->org do chassi DeskcommCRM. Shim da Spec 01 (Plataforma Base), ausente das migrations do upstream. Convive com profiles.org_id (modelo Nexora) sobre a mesma tabela organizations.';

-- Indices parciais: toda leitura do chassi filtra por revoked_at is null.
create index if not exists idx_user_organizations_user_active
  on public.user_organizations (user_id)
  where revoked_at is null;

create index if not exists idx_user_organizations_org_active
  on public.user_organizations (organization_id)
  where revoked_at is null;

-- -----------------------------------------------------------------------------
-- 2. Backfill a partir de profiles
-- -----------------------------------------------------------------------------
-- Cada profile existente vira uma membership. Idempotente via ON CONFLICT.
-- Mapeamentos:
--   role       : nosso 'rep' -> 'agent' do chassi; admin/manager/viewer coincidem.
--   revoked_at : profiles.is_active = false vira membership REVOGADA. Sem isso,
--                um usuario desativado do nosso lado voltaria a ter acesso pelo
--                chassi (fn_user_org_ids so filtra revoked_at) — vazamento.
insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at)
select p.id,
       p.org_id,
       case when p.role = 'rep' then 'agent' else p.role end,
       coalesce(p.created_at, now()),
       case when p.is_active then null else coalesce(p.updated_at, now()) end
from public.profiles p
on conflict (user_id, organization_id) do nothing;

-- -----------------------------------------------------------------------------
-- 3. fn_user_org_ids() — contrato exigido por 108 policies RLS do chassi
-- -----------------------------------------------------------------------------
-- Usada como: `organization_id in (select * from public.fn_user_org_ids())`.
-- SECURITY DEFINER e obrigatorio aqui: a funcao le user_organizations, que tem
-- RLS ativa. Sem definer, as policies da propria tabela recursariam infinitamente.
-- search_path lockado contra CVE-2018-1058 (search_path injection), padrao ja
-- adotado em rpc_upsert_lead.
create or replace function public.fn_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select uo.organization_id
    from public.user_organizations uo
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
$$;

-- Grants exatamente como o chassi ja declara (ele faz REVOKE/GRANT sobre esta
-- funcao sem nunca cria-la — ver linhas 7865 e 7895 do SQL agregado do upstream).
revoke execute on function public.fn_user_org_ids() from public, anon;
grant execute on function public.fn_user_org_ids() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. fn_is_org_admin() — suporte as policies de escrita
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER pelo mesmo motivo de recursao acima.
create or replace function public.fn_is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.user_organizations uo
     where uo.user_id = auth.uid()
       and uo.organization_id = p_org
       and uo.revoked_at is null
       and uo.role = 'admin'
  )
$$;

revoke execute on function public.fn_is_org_admin(uuid) from public, anon;
grant execute on function public.fn_is_org_admin(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. RLS em user_organizations
-- -----------------------------------------------------------------------------
alter table public.user_organizations enable row level security;

-- SELECT: o membro enxerga as memberships das orgs a que pertence.
drop policy if exists user_orgs_select on public.user_organizations;
create policy user_orgs_select on public.user_organizations
  for select
  using (organization_id in (select * from public.fn_user_org_ids()));

-- INSERT/UPDATE/DELETE: apenas admin da org (contrato declarado em
-- app/actions/team/acceptInvite.ts). O convite de um usuario que ainda NAO e
-- membro roda via service_role, que bypassa RLS — por isso admin aqui nao
-- impede o fluxo de aceite de convite.
drop policy if exists user_orgs_insert on public.user_organizations;
create policy user_orgs_insert on public.user_organizations
  for insert
  with check (public.fn_is_org_admin(organization_id));

drop policy if exists user_orgs_update on public.user_organizations;
create policy user_orgs_update on public.user_organizations
  for update
  using (public.fn_is_org_admin(organization_id))
  with check (public.fn_is_org_admin(organization_id));

drop policy if exists user_orgs_delete on public.user_organizations;
create policy user_orgs_delete on public.user_organizations
  for delete
  using (public.fn_is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- 6. updated_at automatico
-- -----------------------------------------------------------------------------
create or replace function public.fn_user_organizations_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_organizations_touch on public.user_organizations;
create trigger trg_user_organizations_touch
  before update on public.user_organizations
  for each row execute function public.fn_user_organizations_touch();
