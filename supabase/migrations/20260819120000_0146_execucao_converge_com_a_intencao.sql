-- ============================================================================
-- 0146 — A TERCEIRA ORIGEM DE `EXECUTE`
--
-- Forward-fix da 0145. Ela terminou com o ritual que o CLAUDE.md §9 manda:
--
--     revoke execute on function ... from public, anon;
--     grant  execute on function ... to service_role;
--
-- e declarou, no comentário da própria RPC, "Caller esperado: service_role".
-- O ACL real do banco, medido depois de aplicada, era outro:
--
--     rpc_upsert_lead : postgres=X  authenticated=X  service_role=X
--     fn_e164_or_null : postgres=X  authenticated=X  service_role=X
--
-- Porque a doutrina nomeia DUAS origens de EXECUTE e existem TRÊS. O baseline
-- tem quatro linhas irmãs, não duas:
--
--     ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO "anon";           (3960)
--     ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO "authenticated";  (3961)
--
-- Toda função criada DEPOIS delas — isto é, todo apêndice novo — nasce com as
-- duas. O `revoke ... from public, anon` tira a de `anon` e a que o Postgres dá
-- a PUBLIC na criação; não tira a de `authenticated`, que ninguém escreveu e
-- que por isso não aparece em code review. O gate fica verde e a função fica
-- alcançável por RPC PostgREST para qualquer sessão logada.
--
-- ── O QUE ISTO É, E O QUE NÃO É ────────────────────────────────────────────
--
-- NÃO é vazamento cross-tenant, e a medição é a prova: um `viewer` do tenant A
-- chamando `rpc_upsert_lead(p_org_id => B)` recebe
--
--     42501 — new row violates row-level security policy for table "companies"
--
-- O `security invoker` da 0145 — escolhido contra `definer` justamente para
-- isto — segurou. Essa decisão está VALIDADA, não apenas argumentada.
--
-- Também não concede capacidade nova: a policy `tenant_isolation_contacts_all`
-- não tem gate de papel, então o mesmo usuário já podia `insert into contacts`
-- direto. A RPC era um atalho para algo que ele alcançava de outro jeito.
--
-- É DERIVA entre a intenção declarada e o estado real — e a deriva importa
-- porque o guarda-costas é uma única palavra. No dia em que alguém trocar
-- `security invoker` por `definer` para resolver um erro de permissão (a
-- "correção" mais natural do mundo), o grant a `authenticated` que ninguém
-- sabia que existia vira escrita cross-tenant no mesmo commit. Fechar agora
-- custa duas linhas; fechar depois custa um incidente.
--
-- Vigiado daqui em diante por tests/invariants/convergencia-aios-contacts.test.ts,
-- que afirma o CONJUNTO EXATO de grantees em vez de procurar `anon` numa lista
-- — a asserção anterior passava verde com `authenticated` presente, que é o
-- defeito que este arquivo conserta, uma camada acima.
-- ============================================================================

revoke execute on function public.fn_e164_or_null(text)
  from public, anon, authenticated;
grant  execute on function public.fn_e164_or_null(text)
  to service_role;

revoke execute on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rpc_upsert_lead(
  uuid, text, text, text, text, text, text, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
