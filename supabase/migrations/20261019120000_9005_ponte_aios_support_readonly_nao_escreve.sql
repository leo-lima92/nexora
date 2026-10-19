-- manifest: **Platform admin `support_readonly` deixa de escrever nas três tabelas da ponte AIOS (`deals`, `linkedin_threads`, `extraction_runs`) — a conta global de escrita com a função pura volta a 0.** As policies `tenant_isolation_<t>_all` das migrations 9001/9002 do fork aceitavam `fn_is_platform_admin()`, que ignora o scope do JWT: um platform admin só-de-leitura, sem sessão de suporte, escrevia nessas tabelas pela REST. É a classe da #2115 que o upstream fechou na 0529/0533 (troca para `fn_is_platform_admin_full()`), alcançando tabelas que o upstream não tem. Cada uma tinha UMA policy só (`FOR ALL`), então vira o mesmo par de `recurring_entries` na 0533: `_read` (SELECT, função pura — `support_readonly` segue lendo) + `_write` (`FOR ALL`, `_full`; o membro só escreve com papel `agent` ou acima — `viewer` deixa de escrever, e o Hono escreve com service role, que ignora RLS). Gates: `tests/invariants/platform-admin-full-so-escreve.test.ts` ("CONTA GLOBAL") e `tests/invariants/rbac-config-ia-canais.test.ts` ("nenhuma tabela NOVA entra com policy ALL só-tenancy"), medidos vermelhos no `pnpm test:db` de 2026-10-19 antes desta migration.

-- 9005 — a ponte AIOS entra na regra da #2115
--
-- Sincronização com o upstream DeskcommCRM v1.80.0. O upstream trocou, nas
-- migrations 0508/0529/0533, toda policy de ESCRITA que aceitava
-- `fn_is_platform_admin()` pela variante `fn_is_platform_admin_full()`, que só
-- é verdadeira para o scope `full` do JWT. As três tabelas que a ponte AIOS
-- criou (9001: `deals`, `linkedin_threads`; 9002: `extraction_runs`) não
-- existem no upstream e ficaram de fora: cada uma tem uma única policy
-- `tenant_isolation_<t>_all`, `FOR ALL`, com a função pura no `using` e no
-- `with check`.
--
-- O par, e não a troca direta: a `_all` é a ÚNICA policy dessas tabelas, então
-- trocar a função nela tiraria também a LEITURA do `support_readonly`. O
-- desenho é o de `recurring_entries` na 0533:
--   · `_read`  — FOR SELECT, membro ou plataforma (função pura)
--   · `_write` — FOR ALL, membro com papel `agent`+ ou plataforma `full`. O
--     papel fecha a dívida de RBAC (0150): só-tenancy deixava um `viewer`
--     escrever pela REST. Quem escreve de verdade é o Hono do AIOS, com
--     service role, que não passa por RLS.
-- A chave de tenant segue `org_id` (é a dessas tabelas; só `companies` e
-- `contacts` convergiram para `organization_id`).
--
-- `companies` não entra: desde a 9004 ela é a canônica do chassi, e as
-- policies por operação da 0448 (com `_full` desde a 0533) substituem a
-- `tenant_isolation_companies_all` que a 9001 criava.
--
-- Idempotente: `drop policy if exists` antes de cada `create`. As três tabelas
-- existem em todo banco que chega aqui (9001/9002 vêm antes na cadeia e no
-- baseline).

-- SQL estático, uma tabela por vez, e não um `foreach` com `execute format()`:
-- a conferência de isolamento do `update.sh` lê os `create/drop policy`
-- LITERAIS deste arquivo (vale a última operação de cada regra). Escrito em
-- `format()`, o drop da `_all` ficava invisível para ela, que seguia esperando
-- a `_all` da 9001 — e PARAVA a atualização com o CRM fora do ar (medido no
-- `test:db` de 2026-10-19, nas três versões do update.sh).

drop policy if exists tenant_isolation_deals_all on public.deals;
drop policy if exists tenant_isolation_deals_read on public.deals;
create policy tenant_isolation_deals_read on public.deals
  for select
  using ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin());
drop policy if exists tenant_isolation_deals_write on public.deals;
create policy tenant_isolation_deals_write on public.deals
  for all
  using ((org_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(org_id, 'agent'))
         or public.fn_is_platform_admin_full())
  with check ((org_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(org_id, 'agent'))
              or public.fn_is_platform_admin_full());

drop policy if exists tenant_isolation_linkedin_threads_all on public.linkedin_threads;
drop policy if exists tenant_isolation_linkedin_threads_read on public.linkedin_threads;
create policy tenant_isolation_linkedin_threads_read on public.linkedin_threads
  for select
  using ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin());
drop policy if exists tenant_isolation_linkedin_threads_write on public.linkedin_threads;
create policy tenant_isolation_linkedin_threads_write on public.linkedin_threads
  for all
  using ((org_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(org_id, 'agent'))
         or public.fn_is_platform_admin_full())
  with check ((org_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(org_id, 'agent'))
              or public.fn_is_platform_admin_full());

drop policy if exists tenant_isolation_extraction_runs_all on public.extraction_runs;
drop policy if exists tenant_isolation_extraction_runs_read on public.extraction_runs;
create policy tenant_isolation_extraction_runs_read on public.extraction_runs
  for select
  using ((org_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin());
drop policy if exists tenant_isolation_extraction_runs_write on public.extraction_runs;
create policy tenant_isolation_extraction_runs_write on public.extraction_runs
  for all
  using ((org_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(org_id, 'agent'))
         or public.fn_is_platform_admin_full())
  with check ((org_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(org_id, 'agent'))
              or public.fn_is_platform_admin_full());
