-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Expand extraction_runs check constraints
-- Story:     E-02.02 — Extraction Run Model / DB Layer
-- Context:   O service `src/services/extraction-run.service.ts` usa semântica
--            mais rica que a migration inicial (20260330000000):
--              • status terminal distingue succeeded / aborted (vs. apenas completed)
--              • source aceita apelidos curtos (google_maps) além dos nomes
--                prefixados por provider (apify_google_maps)
--
--            Optamos por alinhar o banco ao service (semântica rica preservada),
--            mantendo também os valores legados para não quebrar dados existentes
--            ou outros callers já em produção.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop constraints antigas de forma idempotente.
-- Se a constraint já tiver sido removida (ou renomeada), o bloco engole o
-- undefined_object e segue adiante — a migration continua reexecutável.

do $$
begin
  alter table public.extraction_runs
    drop constraint extraction_runs_source_check;
exception
  when undefined_object then
    raise notice 'constraint extraction_runs_source_check já não existe — skip';
end $$;

do $$
begin
  alter table public.extraction_runs
    drop constraint extraction_runs_status_check;
exception
  when undefined_object then
    raise notice 'constraint extraction_runs_status_check já não existe — skip';
end $$;

-- Recria constraints com o domínio expandido.

alter table public.extraction_runs
  add constraint extraction_runs_source_check
  check (source in (
    'google_maps',
    'apify_google_maps',
    'linkedin',
    'apify_linkedin',
    'instagram',
    'apify_instagram',
    'manual',
    'phantombuster_linkedin',
    'cnae_scraper'
  ));

alter table public.extraction_runs
  add constraint extraction_runs_status_check
  check (status in (
    'pending',
    'running',
    'completed',
    'succeeded',
    'failed',
    'aborted'
  ));
