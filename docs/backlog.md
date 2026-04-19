# Nexora — Backlog do Módulo de Extração
**Versão:** 1.0
**Data:** 2026-04-15
**Owner:** @po (Pax) + @pm (Morgan)
**Foco:** E-02 — Módulo de Extração (Apify + PhantomBuster)

---

## Épico E-02: Módulo de Extração

> Braço de prospecção ativa do Nexora. Coleta leads de fontes públicas (Google Maps, LinkedIn, Instagram, CNAEs) via Apify e PhantomBuster, deduplicados e enriquecidos antes de entrar no pipeline.

**Critério de done do épico:** Usuário consegue iniciar uma extração via Extraction Hub, acompanhar o progresso em tempo real e ver os leads criados automaticamente no CRM com Sniper Score inicial calculado.

---

## Stories Prioritizadas

### Sprint 1 — Fundação da Integração Apify

---

#### E-02.01 — Apify Client Service ✅ CONCLUÍDA (2026-04-16)
**Status:** `Done`
**Prioridade:** P0 — Critical path
**Estimativa:** 3 pts

**Como** desenvolvedor,
**Quero** um serviço TypeScript encapsulando a Apify API,
**Para** que todos os módulos de extração reutilizem um cliente único com tratamento de erros, retry e logging.

**Critérios de Aceite:**
- [x] `ApifyClient` instancia com `APIFY_API_TOKEN` do env
- [x] Método `runActor(actorId, input)` inicia um Actor assíncrono e retorna `runId`
- [x] Método `waitForRun(runId, options)` faz polling até `SUCCEEDED | FAILED | TIMED_OUT`
- [x] Método `getDataset(datasetId)` retorna itens paginados do dataset de resultado
- [x] Método `getActorRunStatus(runId)` retorna status atual sem esperar
- [x] Todos os erros HTTP encapsulados em `ApifyError` com `statusCode`, `message`, `runId`
- [x] Retry automático em 429 (rate limit) e 503 com exponential backoff (max 3 tentativas)
- [x] Logs estruturados em cada operação (`runId`, `actorId`, `status`, `durationMs`)

**Arquivo alvo:** `src/services/apify-client.ts`

**Evidências:**
- `src/executions/test-apify.ts` — conectividade (AC-1) · user `nexora_leo`, plan FREE
- `src/executions/test-apify-actor.ts` — fluxo e2e contra `apify/rag-web-browser` (AC-2, 3, 4, 5, 8) · 2 items reais coletados em ~10s
- `src/executions/test-apify-errors.ts` — tratamento de erros (AC-6) · 404 → `ApifyError(statusCode=404)`

**Bugs encontrados & corrigidos no smoke:**
1. `getDataset` assumia envelope `{ data: {...} }` — Apify retorna array JSON puro + paginação em headers `X-Apify-Pagination-*`. Refatorado: `rawRequest()` (Response) + `request<T>()` (JSON).
2. `X-Apify-Pagination-Total` tem eventual consistency (~5-10s) após run SUCCEEDED. Loop de `getAllDatasetItems` trocou critério de parada para `page.items.length < limit` — não depende de header volátil.

---

#### E-02.02 — Extraction Run Model (DB Layer) ✅ CONCLUÍDA (2026-04-19)
**Status:** `Concluído`
**Prioridade:** P0
**Estimativa:** 2 pts

**Como** sistema,
**Quero** um service de acesso à tabela `extraction_runs`,
**Para** criar, atualizar e consultar runs de extração com tipagem gerada pelo Supabase.

**Critérios de Aceite:**
- [x] `createRun(payload)` insere registro com status `pending`
- [x] `updateRunStatus(runId, status, meta)` atualiza status + timestamps
- [x] `getRunById(id)` retorna run com tipagem completa
- [x] `listRunsByOrg(orgId, filters)` lista runs paginados
- [x] Tipagem 100% derivada de `src/types/database.ts` (sem tipos manuais)

**Arquivo alvo:** `src/services/extraction-run.service.ts`

**Evidências:**
- `src/lib/supabase.ts` — clients `supabase` (ANON) e `supabaseAdmin` (SERVICE_ROLE) com guardrails
- `src/services/extraction-run.service.ts` — `createRun`, `updateRunStatus`, `getRunById`, `listRunsByOrg` com carimbo automático de `started_at` / `completed_at` e scoping por `org_id`
- `src/executions/test-extraction-run.ts` — ciclo de vida ponta-a-ponta validado contra Supabase real (pending → running → succeeded, getRunById, listRunsByOrg, scoping cross-org)
- `supabase/migrations/20260419000000_update_extraction_runs_constraints.sql` — expande CHECK constraints (`status ∈ {pending, running, completed, succeeded, failed, aborted}`; `source` aceita apelidos curtos e prefixados por provider) — aplicada via `supabase db push`

**Decisões arquiteturais:**
1. Divergência semântica entre service (status: `succeeded`/`aborted`) e migration inicial (`completed` apenas) resolvida via Opção B — DB alinhado ao código (semântica rica preservada, valores legados mantidos).
2. DROP de constraints feito idempotentemente com `DO $$ ... EXCEPTION WHEN undefined_object` para permitir reexecução segura da migration.

---

#### E-02.03 — Google Maps Extractor (Orquestração) ✅ CONCLUÍDA (2026-04-19)
**Status:** `Concluído (orquestração) · mapping/dedup deferido para E-02.03b`
**Prioridade:** P0
**Estimativa:** 5 pts

**Como** SDR,
**Quero** extrair empresas do Google Maps por cidade e CNAE/categoria,
**Para** gerar uma lista de prospectos locais qualificados sem pesquisa manual.

**Critérios de Aceite:**
- [x] Actor `compass/crawler-google-places` chamado com `searchStringsArray`, `countryCode`, `maxCrawledPlacesPerSearch`
- [ ] Resultados mapeados para `Company` (nome, telefone, endereço, site, lat/lng, rating) — **E-02.03b**
- [ ] Deduplicação por domínio e telefone antes de inserir — **E-02.03b**
- [x] `extraction_run` atualizado com `companies_created`, `contacts_created`, `results_count` (counters populados; `results_count=3` no smoke)
- [x] Erros de Actor salvos em `extraction_run.error_message` (catch global com normalização de `ApifyError`)
- [ ] Rate limiting: máx 1 run simultâneo por `org_id` — **E-02.03b**

**Arquivo alvo:** `src/services/google-maps-extractor.service.ts`

**Evidências:**
- `src/services/google-maps-extractor.service.ts` — `extractGoogleMaps({orgId, query, maxResults, ...})` com fluxo [A] createRun → [B] running → [C][D] runAndCollect → [E] succeeded → [F] failed em catch
- `src/executions/test-google-maps-extractor.ts` — smoke live com `maxResults=3` e cleanup automático
- Smoke run real (2026-04-19): 22.466ms end-to-end, 3/3 academias de Vila Velha/ES raspadas, persistência confirmada via `getRunById`

**Decisões arquiteturais:**
1. Assinatura com objeto-param (`ExtractGoogleMapsInput`) em vez de 3 args posicionais — consistente com `createRun(input)` do service layer.
2. `[B]` (transição para `running`) movido para dentro do try/catch — falha aqui também cai no handler `failed`.
3. `rawData` persiste metadados sintéticos do actor run (stats, timestamps, itemCount) — útil para auditoria; payload cru dos items NÃO é persistido para evitar explosão da coluna jsonb.
4. `runAndCollect` consolida `runActor + waitForRun + getAllDatasetItems` em uma chamada — mantém o orchestrator enxuto.

**Observações para E-02.03b (mapping) capturadas no smoke:**
- Dedup primário por `placeId` (chave estável do Google); fallbacks: `phoneUnformatted` + domínio normalizado
- Edge cases observados: `phone=""` (Smart Fit), `website=linktr.ee/...` (agregador, não domínio canônico), `categories[]` variando de 1 a 6 entradas
- Campos ricos p/ sniper-score futuro: `totalScore`, `reviewsCount`, `imagesCount`, `openingHours`, `additionalInfo`

---

#### E-02.03b — Google Maps Mapper + Dedup + Rate Limit ✅ CONCLUÍDA (2026-04-19)
**Status:** `Concluído`
**Prioridade:** P0
**Estimativa:** 3 pts
**Depende de:** E-02.03

**Como** sistema,
**Quero** transformar os `GoogleMapsPlace` crus em `companies`/`contacts` deduplicados
**Para** que o Extraction Hub não crie empresas duplicadas e respeite 1 run ativa por org.

**Critérios de Aceite:**
- [x] Migration adiciona `companies.google_place_id VARCHAR(255)` + UNIQUE INDEX scopado por `(org_id, google_place_id)` (partial `WHERE IS NOT NULL`)
- [x] Mapper persiste 1:1 place → company (`name`, `domain`, `website`, `city`, `country`, `tags`)
- [x] Dedup SKIP por `(org_id, google_place_id)` — run repetida conta como `companiesSkipped`, não tenta UPSERT
- [x] Contact criado apenas quando `phoneUnformatted` (ou fallback `phone`) não-vazio; FK via `company_id`
- [x] Agregadores de URL (linktr.ee, bit.ly, t.co, goo.gl, tinyurl, lnk.bio, beacons.ai) descartados do `domain` canônico — resolve edge case real da E-02.03
- [x] Concurrency guard (`assertNoActiveRun`) via SELECT em `extraction_runs` com status `∈ {pending, running}` para `(org_id, source)` — rejeita com `ActiveRunConflictError`
- [x] Orquestrador passa a popular `companies_created` e `contacts_created` reais no `updateRunStatus(succeeded)`; `rawData` ganha bloco `mapping` para auditoria

**Arquivos alvo:**
- `src/services/google-maps-mapper.service.ts` (novo)
- `src/services/google-maps-extractor.service.ts` (integração + guard + counters reais)
- `src/services/extraction-run.service.ts` (adiciona `assertNoActiveRun` + `ActiveRunConflictError`)
- `supabase/migrations/20260419010000_add_tracking_columns_to_companies.sql`

**Decisões arquiteturais:**
1. Dedup SKIP (não UPSERT) — diretriz explícita do PM; counter `companies_created` reflete apenas rows novas.
2. `assertNoActiveRun` é best-effort via SELECT, não lock real. Sob alta concorrência, race condition teórica existe — upgrade para `pg_advisory_xact_lock` quando escalar além de 1 worker.
3. `apify_run_id` já existia em `companies`/`contacts` desde a migration inicial — só adicionamos indexes auxiliares.
4. Types regenerados via `supabase gen types typescript --linked` (2341 linhas) para manter tipagem 100% derivada do DB.

**Fora de escopo (deferido):**
- Fallback de dedup por `website`/`phoneUnformatted` — `placeId` é fonte única da verdade nesta iteração
- Advisory lock Postgres para concurrency bulletproof
- Mapping de `categoryName` → `cnae_code` (requer tabela de tradução)

---

#### E-02.04 — LinkedIn Profile Extractor
**Status:** `Backlog`
**Prioridade:** P1
**Estimativa:** 8 pts

**Como** SDR B2B,
**Quero** extrair perfis LinkedIn por filtros de cargo, empresa e localização,
**Para** montar listas de contatos qualificados sem pesquisa manual no LinkedIn.

**Critérios de Aceite:**
- [ ] Suporte a dois modos: `apify` (cookie-based) e `phantombuster` (session-based)
- [ ] Actor `apify/linkedin-profile-scraper` chamado com `sessionCookie`, `profileUrls`
- [ ] Campos mapeados: `linkedin_profile_id`, `linkedin_headline`, `linkedin_summary`, `linkedin_skills`, `linkedin_connection`
- [ ] Contact criado ou atualizado (upsert por `linkedin_profile_id`)
- [ ] `linkedin_scraped_at` atualizado em cada run
- [ ] Signal criado automaticamente: `type=linkedin_scraped`, triggering Sniper Score update
- [ ] Graceful degradation se cookie expirado: run marcado como `failed` com mensagem clara

**Arquivo alvo:** `src/services/extractors/linkedin.extractor.ts`

---

#### E-02.05 — Instagram Extractor
**Status:** `Backlog`
**Prioridade:** P2
**Estimativa:** 5 pts

**Como** SDR com foco em B2C/consumer brands,
**Quero** extrair perfis de empresas do Instagram por hashtag ou handle,
**Para** identificar prospects que ainda não estão em nenhuma base.

**Critérios de Aceite:**
- [ ] Actor `apify/instagram-scraper` chamado com `directUrls` ou `hashtags`
- [ ] Dados mapeados: bio, email (quando público), seguidores, engajamento médio
- [ ] Empresa criada com `source=apify_instagram`
- [ ] Deduplicação por handle do Instagram

**Arquivo alvo:** `src/services/extractors/instagram.extractor.ts`

---

#### E-02.06 — Extraction Hub UI (Painel)
**Status:** `Backlog`
**Prioridade:** P1
**Estimativa:** 8 pts

**Como** SDR ou gerente,
**Quero** um painel para iniciar e acompanhar extrações em tempo real,
**Para** ter visibilidade do progresso sem precisar consultar logs técnicos.

**Critérios de Aceite:**
- [ ] Lista de runs com status, fonte, progresso (%) e resultados
- [ ] Formulário de nova extração: selecionar fonte, preencher filtros, confirmar
- [ ] Status atualizado via Supabase Realtime (sem polling manual)
- [ ] Botão "Cancelar run" envia sinal de abort ao Apify
- [ ] Filtros: por fonte, status, período, criado por
- [ ] Link direto do run para os companies/contacts criados

**Arquivos alvo:** `src/app/(dashboard)/extractions/page.tsx`, `src/components/extractions/`

---

#### E-02.07 — Enriquecimento Cascata
**Status:** `Backlog`
**Prioridade:** P2
**Estimativa:** 5 pts

**Como** sistema,
**Quero** que após uma extração Google Maps, o sistema automaticamente busque CNAE e Instagram da empresa,
**Para** entregar um lead mais completo sem intervenção manual.

**Critérios de Aceite:**
- [ ] Edge Function `enrichment-worker` ativada após `extraction_run.status = completed`
- [ ] Busca CNAE via CNPJ na Receita Federal API (se `cnpj` disponível)
- [ ] Busca Instagram handle via busca por nome/domínio (Apify)
- [ ] Campos enriquecidos atualizados em `companies`
- [ ] `enrichment_status` em `companies` reflete progresso

**Arquivo alvo:** `supabase/functions/enrichment-worker/index.ts`

---

#### E-02.08 — Sniper Score Inicial pós-extração
**Status:** `Backlog`
**Prioridade:** P1
**Estimativa:** 3 pts

**Como** sistema,
**Quero** calcular um Sniper Score inicial para cada company/contact criado por extração,
**Para** que o lead já entre no pipeline com uma prioridade estimada.

**Critérios de Aceite:**
- [ ] Score calculado com base em: fit de ICP (CNAE, porte, cidade), source quality, campos preenchidos
- [ ] Score salvo em `sniper_scores` com `source=extraction`
- [ ] Companies/contacts ordenados por score no Extraction Hub após run
- [ ] Leads com score >= 70 automaticamente adicionados à próxima Hit List

**Arquivo alvo:** `src/services/sniper-score.service.ts`

---

## Dependências Técnicas

| Dependência | Status | Bloqueado por |
|-------------|--------|--------------|
| `src/types/database.ts` gerado | ✅ Concluído | — |
| `APIFY_API_TOKEN` no `.env` | ✅ Concluído (2026-04-16, conta `nexora_leo`, plan FREE) | — |
| RLS em todas as tabelas | ✅ Concluído (migration 20260415) | — |
| Supabase Realtime habilitado para `extraction_runs` | ⚠️ Pendente | E-02.06 |
| `src/services/apify-client.ts` esqueleto | ✅ Criado | — |
| `src/services/apify-client.ts` validado end-to-end | ✅ Concluído (E-02.01) | — |
| `src/services/extraction-run.service.ts` + DB layer validados | ✅ Concluído (E-02.02, 2026-04-19) | — |

---

## Definition of Done (E-02)

- [ ] Todos os testes unitários passando (`npm test`)
- [ ] Lint e typecheck limpos (`npm run lint && npm run typecheck`)
- [ ] CodeRabbit review aprovado
- [ ] Extraction Hub funcional em ambiente de dev
- [ ] Pelo menos 1 run completo de Google Maps testado com dados reais
- [ ] `extraction_runs` auditável com logs completos
- [ ] Documentação de cada Actor com parâmetros necessários

---

*Gerado por @sm (River) + @po (Pax) — 2026-04-15*
