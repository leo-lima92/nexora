-- ============================================================
-- Migration: fix_rls_security
-- Version:   1.0.0
-- Date:      2026-04-15
-- Author:    @devops (Gage) — Security hotfix
-- Reason:    Supabase alert: rls_disabled_in_public
--            cnae_codes table had RLS disabled, exposing it
--            to unauthenticated access without explicit policy.
-- ============================================================

-- ─────────────────────────────────────────
-- ENABLE RLS
-- ─────────────────────────────────────────
alter table public.cnae_codes enable row level security;

-- ─────────────────────────────────────────
-- POLICY: SELECT público (tabela de referência)
-- Qualquer usuário autenticado pode ler CNAEs.
-- Nenhuma escrita é permitida via client — dados
-- são gerenciados apenas por migrations.
-- ─────────────────────────────────────────
create policy "cnae_select_all"
  on public.cnae_codes
  for select
  using (true);

-- ─────────────────────────────────────────
-- REVOKE: garantir que INSERT/UPDATE/DELETE
-- não sejam possíveis via client-side.
-- (Supabase herda GRANT do postgres role,
--  mas as políticas abaixo bloqueiam via RLS)
-- ─────────────────────────────────────────
-- Sem policy de INSERT → blocked by RLS
-- Sem policy de UPDATE → blocked by RLS
-- Sem policy de DELETE → blocked by RLS
