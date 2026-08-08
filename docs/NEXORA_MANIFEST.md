# NEXORA — Manifest

**Versão:** 1.2
**Data:** 2026-08-08
**Owners:** @pm (Morgan) — Visão & Produto · @architect (Aria) — Arquitetura & Regras de Ouro
**Audiência:** Engenheiro Sênior externo (CTO) — sincronização de estado absoluto
**Status:** Closed Loop em produção · CODE FREEZE ativo sobre rotas do Loop (desde 2026-05-07) · **AI Studio — infraestrutura de dados APLICADA em produção (Missão 1 concluída)** · ⏸️ **STANDBY ESTRATÉGICO ativo (desde 2026-08-08) — avaliação de chassi de CRM open-source pelo CEO + CTO. Nenhuma alteração de código autorizada.**

> **Changelog v1.2 (2026-08-08):** Missão 1 do AI Studio **concluída e homologada**. A migration `20260615120000_create_ai_studio_schema.sql` (`ai_agents`, `agent_sessions`, `chat_history`) foi **aplicada em produção** no projeto `qpwkhuvchibrxretubss`, com RLS estrito por `org_id` **verificado empiricamente** (tentativa de acesso via `anon` → `401` / Postgres `42501`). O Cofre Zod passou de 8 → **9 variáveis obrigatórias** com a entrada de `ANTHROPIC_API_KEY` (`src/lib/env.ts` + `.env.example` ajustados). §1.5, §2.4, §2.5 e §2.7 atualizadas. Projeto entra em **STANDBY** — ver §0.

> **Changelog v1.1 (2026-06-15):** direcionamento estratégico oficializado por CEO (Leonardo) + CTO — a camada de Inteligência migra de *agentes hardcoded* para o modelo **AI Studio**: o usuário final cria seus próprios SDRs dinamicamente, persistindo prompt de sistema, tom de voz e configurações no banco (multi-tenant por `org_id`). Ver §1.5.

---

## 0. STANDBY ESTRATÉGICO (ativo desde 2026-08-08)

> ⏸️ **Ordem direta do CEO (Leonardo) + CTO:** nenhuma linha de código deve ser alterada até o encerramento desta avaliação.

**Objeto da avaliação:** adoção (ou não) de um **chassi de CRM open-source / pronto** para acelerar o front-end e a estrutura base, em vez de seguir escrevendo do zero.

| Aspecto | Estado |
|---------|--------|
| **Escopo do congelamento** | TODO o código-fonte (`src/**`, `supabase/migrations/**`, frontend não bootstrapped). Mais amplo que o CODE FREEZE do §3.2, que cobre apenas as rotas do Closed Loop. |
| **Permitido** | Leitura, análise, documentação, avaliação técnica de opções de chassi. |
| **Bloqueado** | Implementação, refactor, novas migrations, bootstrap de frontend, commits de código. |
| **Motivo** | Escolher o chassi **antes** de escrever a camada de apresentação evita retrabalho estrutural — a decisão condiciona stack de UI, modelo de auth e organização de módulos. |
| **Desbloqueio** | Somente por ordem explícita de Leonardo. |

**Estado congelado (baseline seguro para retomada):** backend Hono operante, Closed Loop homologado, schema AI Studio aplicado com RLS ativo, Cofre Zod com 9 variáveis. A camada de dados do AI Studio está **pronta e segura** — qualquer chassi escolhido consome esse schema, não o substitui.

**Dívida operacional:** ✅ **Quitada em 2026-08-08.** Os artefatos de código da Missão 1 (migration `20260615120000` + `src/lib/env.ts` + `.env.example`) já estavam commitados e pushados em `af54b55` — `master` sincronizado com `origin/master` (0 commits à frente/atrás). Restava apenas este Manifest v1.2, selado em commit próprio de documentação. `git push` é operação **exclusiva de @devops** (ver `.claude/rules/agent-authority.md`).

---

## 1. Visão Macro

### 1.1 O que é o Nexora

Nexora é uma **plataforma All-in-One de RevOps Agêntico para B2B** — não um CRM tradicional. O produto unifica três funções que hoje vivem em ferramentas separadas em qualquer operação de vendas:

1. **Aquisição** — extração de leads (Apify: Google Maps, Instagram, LinkedIn) + Inbound de paid media.
2. **Operação** — pipeline kanban, contatos, deals, follow-ups, multi-tenant via `org_id`.
3. **Inteligência** — agentes de IA (Claude Sonnet 4.6 + Anthropic Agent SDK) atuando como SDR autônomo sobre o pipeline.

O **Banco de Dados é o produto**: Supabase (Postgres + RLS + pgvector + pg_cron) no projeto `qpwkhuvchibrxretubss` é a *single source of truth* — todo lead, toque, evento de tracking e venda fechada convergem em `companies` / `contacts` com `org_id` como linha de isolamento de tenant.

### 1.2 Objetivo Estratégico

Ser o **coração de RevOps** onde Inbound (paid + Sniper) e Outbound (extração + cold outreach) se encontram num único sistema de registro, com agentes de IA operando 24/7 sobre o pipeline.

Decisão fundadora (2026-05-05): **integrar, não reconstruir**. O agente Python AIOS de Tráfego Pago já existe como produto autônomo — Nexora não duplica essa competência, ele integra com o AIOS como **bounded contexts complementares**:

- **AIOS Python** = motor de Meta CAPI / Tráfego Pago (owner de `META_CAPI_TOKEN`, otimização de campanhas).
- **Nexora** = sistema de registro do pipeline (owner do lead, do deal e do estado de venda).
- **AI Studio (Nexora)** = Agent Builder multi-tenant (owner da configuração de agentes SDR e da memória conversacional — ver §1.5). Owner de `ANTHROPIC_API_KEY` (**presente no Cofre Zod desde 2026-08-08**).

### 1.3 Diferenciação vs CRM Comum

| Eixo | CRM Comum (Pipedrive, HubSpot CRM, RD Station) | Nexora |
|------|-----------------------------------------------|--------|
| **Input de leads** | Manual ou form embutido | Webhook automatizado AIOS + Apify extraction + Sniper triggers |
| **Atribuição Meta** | Inexistente ou aproximada (UTM apenas) | **Closed Loop CAPI homologado** — tracking IDs Meta (`meta_campaign_id`/`meta_adset_id`/`meta_ad_id`) carregados do anúncio até a venda fechada |
| **Otimização de mídia** | Sem feedback para a plataforma de ads | Endpoint Outbound entrega vendas fechadas ao AIOS, que dispara `Purchase` para Meta CAPI → algoritmo otimiza com sinal real |
| **Agentes de IA** | Plugin opcional (chatbot, redator) | Agentes nativos no pipeline (`Scout`/`Chaser`/`Briefer`/`Closer`/`Analyst`) com ações autônomas configuráveis (full-auto ou human-in-the-loop) |
| **Sniper / Targeting** | Lead scoring estático | Sniper Score dinâmico (ICP fit + sinais de compra + timing) + Hit List diária |
| **Extração** | Não faz | Módulo de Extração próprio (Apify free plan `nexora_leo`, 30 req/s) |
| **Identidade** | Dedup agressiva (1 lead = 1 contato) | **Sem dedup** (decisão arquitetural — ver §3.1) — preserva atribuição multi-touch |

### 1.4 Os 4 Pilares

1. **CRM Agêntico** — pipeline com agentes autônomos.
2. **Módulo Sniper** — priorização cirúrgica (Sniper Score, Trigger Engine, Hit List).
3. **IA Sentimental** — análise emocional/contextual das interações.
4. **Módulo de Extração** — pipeline Apify (google-maps-scraper, instagram-scraper, linkedin-profile-scraper) + PhantomBuster.

### 1.5 AI Studio — Agent Builder Multi-tenant (novo Bounded Context · 2026-06-15)

**Decisão estratégica (CEO + CTO):** a camada de Inteligência evolui de *agentes hardcoded* (os 5 tipos fixos `scout/chaser/briefer/closer/analyst` em `agent_configs`) para um modelo **self-service multi-tenant**: cada `org_id` constrói seus próprios agentes SDR dinamicamente.

| Dimensão | Modelo Antigo (`agent_configs`) | AI Studio (`ai_agents`) |
|----------|--------------------------------|--------------------------|
| **Criação** | Tipos fixos hardcoded (enum de 5) | Usuário cria N agentes livremente |
| **Prompt de sistema** | Embutido em código | Persistido em coluna `system_prompt` (data-driven) |
| **Configuração** | `config` jsonb genérico | Nome do bot, tom de voz, status, modelo — por linha |
| **Memória** | — (stateless) | `agent_sessions` + `chat_history` por contato |
| **Isolamento** | `org_id` | `org_id` (RLS estrito) |

**Mecânica:** a API Hono resolve a config do agente (`ai_agents`) e a memória da conversa (`chat_history`) **antes** de acionar o `@anthropic-ai/sdk`, montando `system` (prompt + tom de voz) e `messages` (histórico) dinamicamente por tenant. CAPI permanece no AIOS (§3.3 intacta).

**Coexistência:** `ai_agents` **não substitui** `agent_configs` — são bounded contexts distintos. `agent_configs` governa a automação interna do pipeline; `ai_agents` governa os bots conversacionais voltados ao Lead. Decisão de eventual deprecação de `agent_configs` fica fora desta Missão.

**Pré-requisito de cofre:** ✅ **Resolvido.** `ANTHROPIC_API_KEY` entrou no Cofre Zod conforme Regra de Ouro §3.5 — `src/lib/env.ts:59` (validado com `nonEmpty`) + `.env.example:137`. Cofre agora com **9 variáveis obrigatórias** (ver §2.4).

**Status:** ✅ **Missão 1 CONCLUÍDA.** Schema **aplicado em produção** — ver §2.7 para a topologia de tabelas, índices e políticas RLS homologadas.

**Próxima missão (bloqueada pelo STANDBY §0):** camada de aplicação — resolver `ai_agents` + `chat_history` na API Hono e acionar o `@anthropic-ai/sdk`. Não iniciar sem desbloqueio de Leonardo.

---

## 2. Estado Atual da Arquitetura

### 2.1 Stack (verificado em 2026-05-14)

| Camada | Tecnologia | Versão / Notas |
|--------|-----------|----------------|
| Backend HTTP | **Hono 4.12** + `@hono/node-server` | Entrypoint: `src/server.ts`. Decisão de @architect: web-standard nativo permite migrar p/ Vercel/Edge/Workers sem refactor. Next.js descartado para microsserviço backend. |
| Runtime | Node.js 22+ | `"engines": { "node": ">=22.0.0" }` |
| Frontend | Next.js 14 App Router + TS + Tailwind + shadcn/ui | **Planejado, ainda não bootstrapped.** |
| DB | Supabase (PostgreSQL + RLS + pgvector + pg_cron) | Projeto `qpwkhuvchibrxretubss` — **LIVE em produção**. |
| Auth | Supabase Auth | — |
| IA | Claude `claude-sonnet-4-6` + Anthropic Agent SDK | — |
| Extração | Apify (`nexora_leo`, free plan ~$5/mês, 30 req/s, 100 runs concorrentes) + PhantomBuster | — |
| Validação | Zod 4.4 | Schema-at-the-edge + cofre de env. |
| Deploy | Vercel + Supabase Cloud | — |
| Billing | Stripe | — |
| Email | Resend | — |
| Outbound (parceiro) | **Agente AIOS Python** (Tráfego Pago) | Owner exclusivo de `META_CAPI_TOKEN` e `META_PIXEL_ID`. |

### 2.2 Closed Loop — Ponte de Dados Nexora ↔ AIOS Python

Dois endpoints HTTP compõem o Closed Loop. Ambos **homologados em produção** em 2026-05-07 e sob **CODE FREEZE** desde então.

```
                      ┌──────────────────────┐
                      │   AIOS Python        │
                      │  (Tráfego Pago)      │
                      └──────────┬───────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │ (1) Inbound        │ (3) Pull           │
            │  POST              │  GET               │
            ▼                    │                    │
   ┌─────────────────────┐       │       ┌────────────┴──────────┐
   │  POST /api/webhooks/│       │       │ GET /api/outbound/    │
   │  aios-lead          │       │       │ conversions           │
   │  (Comando 2)        │       │       │ (Comando 3)           │
   └──────────┬──────────┘       │       └────────────┬──────────┘
              │                  │                    ▲
              ▼                  │                    │
   ┌─────────────────────┐       │       ┌────────────┴──────────┐
   │  rpc_upsert_lead    │       │       │ companies (status=    │
   │  (1 company + 1     │       │       │  'venda_fechada')     │
   │  contact, atômico)  │       │       └───────────────────────┘
   └─────────────────────┘       │
                                 │
                      ┌──────────┴───────────┐
                      │  Meta CAPI           │
                      │ (Purchase events)    │
                      └──────────────────────┘
```

#### 2.2.1 Comando 2 — Inbound Webhook (Porta da Frente)

**Endpoint:** `POST /api/webhooks/aios-lead`
**Direção:** AIOS Python → Nexora (push)
**Arquivo:** `src/server.ts:177`

| Aspecto | Detalhe |
|---------|---------|
| **Auth** | Header `Authorization` (com ou sem prefixo `Bearer ` — strip case-insensitive) **OU** header `x-aios-signature`. Valor comparado contra `env.AIOS_WEBHOOK_SECRET` em **constant-time** (`crypto.timingSafeEqual` sobre digests SHA-256). |
| **Schema (Zod)** | `org_id` (UUID), `traffic_source`, `meta_campaign_id`, `meta_adset_id`, `meta_ad_id` (todos obrigatórios), `lead_origin` (default `'inbound'`), `lead_data { name, phone?, email? }`. |
| **Persistência** | RPC atômica `public.rpc_upsert_lead` — 1 INSERT em `companies` + 1 INSERT em `contacts` numa única transação PL/pgSQL. ROLLBACK total em qualquer falha → **zero órfãos**. |
| **Resposta** | `201 { ok: true, company_id }` |
| **Smoke E2E** | 12/12 verde contra DB LIVE (commit `1fbf1b2`). |

#### 2.2.2 Comando 3 — Outbound Conversions (CAPI Feedback Loop)

**Endpoint:** `GET /api/outbound/conversions?org_id=<uuid>&since=<ISO8601>&limit=<n>`
**Direção:** AIOS Python ← Nexora (**PULL**)
**Arquivo:** `src/server.ts:284`

| Aspecto | Detalhe |
|---------|---------|
| **Padrão** | **PULL** (não Push). AIOS Python pulla a cada 15min em operação normal. Justificativa arquitetural: (1) bounded context — CAPI é competência do AIOS; (2) `META_CAPI_TOKEN` permanece em UM único vault; (3) resiliência delegada ao consumidor; (4) latência B2B tolera 15-60min; (5) padrão simétrico ao Comando 2. |
| **Auth** | Header `Authorization` (Bearer opcional) comparado contra `env.AIOS_PULL_TOKEN` em **constant-time** (mesma função `safeTokenEqual`). |
| **Query (Zod)** | `org_id` UUID obrigatório, `since` ISO 8601 com offset obrigatório, `limit` coerce default 100, max 500. |
| **Rate Limit** | Middleware in-memory `conversionsRateLimit`: fixed window **100 req / 15min**, chave por IP (`x-forwarded-for`) com fallback para hash SHA-256 truncado do token. GC oportunista quando o Map ultrapassa 5000 entries. Resposta de excesso: `429` com header `Retry-After`. Para escalar multi-instância: trocar por Redis/Upstash com mesma chave/janela. |
| **Query SQL** | `companies` WHERE `org_id = $1 AND status = 'venda_fechada' AND updated_at >= since`, ORDER BY `updated_at ASC`, LIMIT. SELECT de 6 campos **sem PII** (`id, deal_value, meta_campaign_id, meta_adset_id, meta_ad_id, updated_at`). |
| **Resposta** | `200 { items, count }` |
| **Cursor** | Gerenciado pelo CONSUMIDOR (AIOS). Nexora é **stateless** — não mantém estado de sync. |
| **Smoke E2E** | 14/14 verde incluindo 401 sem header, 401 token errado, 400 `since` inválido, 200 schema OK, 429 rate limit (commit `1fbf1b2`). |

### 2.3 RPC Atômica — `rpc_upsert_lead`

**Migrations:**
- `supabase/migrations/20260509185804_create_rpc_upsert_lead.sql`
- `supabase/migrations/20260509190753_fix_rpc_upsert_lead_nullable_params.sql`

**Aplicadas em PRODUÇÃO** em 2026-05-09. Características:

- `language plpgsql` · `security invoker` · `search_path = public, pg_temp` (defesa contra CVE-2018-1058 family — search_path injection).
- Permissões: `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role`. Anon/authenticated não conseguem invocar (e bateriam em RLS se tentassem).
- Retorna `(company_id uuid, contact_id uuid)` para observabilidade.
- **SEM dedup** (decisão Leonardo — ver §3.1).

### 2.4 Cofre Zod (Single Source of Truth para env)

**Arquivo:** `src/lib/env.ts`. Único ponto de leitura de `process.env` em todo `src/` — refatorado conforme `SECURITY_POLICIES.md §3`. **9 variáveis obrigatórias** + `PORT` opcional (default 3000), validadas com fail-fast no boot:

| Variável | Owner | Uso |
|----------|-------|-----|
| `SUPABASE_URL` | Nexora | DB connection |
| `SUPABASE_ANON_KEY` | Nexora | Client-side (futuro frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Nexora | **Server-only** — bypass RLS via `supabaseAdmin` |
| `APIFY_API_TOKEN` | Nexora | Módulo de Extração |
| `AIOS_WEBHOOK_SECRET` | Compartilhado | Auth do Inbound (Comando 2) |
| `META_CAPI_TOKEN` | AIOS Python | (presente no env mas **não consumido** por Nexora — CAPI é responsabilidade do AIOS) |
| `META_PIXEL_ID` | AIOS Python | (idem) |
| `AIOS_PULL_TOKEN` | Compartilhado | Auth do Outbound pull (Comando 3) — rotacionado para chave de produção em 2026-05-07 |
| `ANTHROPIC_API_KEY` | Nexora (AI Studio) | Acionamento do `@anthropic-ai/sdk` pelos agentes SDR do AI Studio — 9ª variável, adicionada em 2026-08-08 (`src/lib/env.ts:59`) |

### 2.5 Hardening de Segurança

| Item | Estado | Referência |
|------|--------|-----------|
| Timing-safe token comparison | **Ativo** — `crypto.timingSafeEqual` sobre digests SHA-256 nas duas rotas. Hash garante buffers de mesmo tamanho (elimina canal lateral de length). | commit `974ca91` · `safeTokenEqual` em `src/server.ts:93` |
| Rate limit Outbound | **Ativo** — 100 req/15min in-memory. | commit `974ca91` · `src/server.ts:146` |
| Atomicidade Inbound | **Ativo** — RPC `rpc_upsert_lead`. | commits `ff450d7` + `74b79c6` |
| Cofre Zod env | **Ativo** — fail-fast no boot, validação de URL/tipo. | `src/lib/env.ts` |
| Gate ESLint security | **Ativo** — `npm run security-check` = `npm audit && eslint src`. Resultado atual: **0 vuln, 0 errors, 2 warnings** (falsos positivos conhecidos no mapper Google Maps). | `eslint.config.js` |
| RLS Supabase | Ativo nas tabelas `companies`/`contacts`. | `supabase/migrations/20260415000000_fix_rls_security.sql` |
| `service_role` exposure | **Server-only** — nunca enviada ao bundle browser. | `SECURITY_POLICIES.md §1` |

### 2.6 Estado do Repositório (2026-05-14)

- Branch: `master` · Último commit pushado: `74b79c6` (`refactor(api): use rpc_upsert_lead in inbound webhook for atomicity`).
- Sessão 2026-05-09 fechou 4 dívidas técnicas em 4 commits (`bad7bcd..74b79c6`): timing-safe, rate limit, smoke E2E Outbound, atomicidade.

---

## 3. Regras de Ouro

Estas são **invariantes do produto**. Quebrar uma destas regras quebra o Closed Loop CAPI homologado ou a atribuição Meta. Não negociar sem alinhamento explícito com Leonardo + time AIOS Python.

### 3.1 NÃO deduplicar leads na tabela `companies`

> **Regra:** cada chamada do webhook Inbound (`POST /api/webhooks/aios-lead`) cria 1 row nova em `companies` + 1 row nova em `contacts`. **Não** existe `ON CONFLICT`, não existe merge por email/telefone, não existe lookup prévio.

**Por quê:** dedup quebra a **atribuição multi-touch do Meta CAPI**. Se o mesmo lead clica em 3 anúncios diferentes em 3 dias diferentes, o AIOS Python recebe 3 eventos (`Lead`) com `meta_campaign_id`/`meta_adset_id`/`meta_ad_id` distintos. Deduplicar para 1 row em `companies` significa perder 2 dos 3 contextos de atribuição — o algoritmo do Meta deixa de otimizar corretamente, e o relatório de ROAS por campanha fica errado.

**Como aplicar:**
- Não adicionar `UNIQUE` constraint em `companies(email)`, `companies(phone)` ou `contacts(email)`.
- Não adicionar `ON CONFLICT` na RPC `rpc_upsert_lead`. O nome "upsert" é apenas hook semântico para evolução *futura, se autorizada*; o comportamento real é INSERT puro.
- Telas de UI futuras que mostrarem "leads agrupados" devem fazer isso em **query layer** (view/CTE), nunca em write layer.

### 3.2 CODE FREEZE sobre rotas do Closed Loop

> **Regra:** `POST /api/webhooks/aios-lead`, `GET /api/outbound/conversions` e o cofre Zod (`src/lib/env.ts` nas variáveis do Loop) estão **congelados** desde 2026-05-07.

**Por quê:** ambos os times (Nexora + AIOS Python) homologaram o contrato HTTP em produção. Mudança unilateral quebra o handshake.

**Como aplicar:**
- Hardening **interno** que não altera contrato é permitido (timing-attack fix, rate limit, smoke tests — tudo feito sob freeze).
- Mudança de schema de request/response, de header de auth, ou de query params **exige**: (1) desbloqueio explícito do Leonardo; (2) alinhamento prévio com time AIOS Python; (3) versionamento ou janela de coexistência.

### 3.3 Bounded Context — Meta CAPI mora no AIOS, NÃO no Nexora

> **Regra:** Nexora nunca chama `graph.facebook.com/{pixel_id}/events`. Nexora nunca lê `META_CAPI_TOKEN` em código de aplicação. O Closed Loop é PULL (AIOS pulla Nexora), não Push.

**Por quê:** `META_CAPI_TOKEN` deve viver em **um único vault** (AIOS) para reduzir trust surface. CAPI é competência do AIOS — duplicar essa lógica no Nexora cria duas fontes de verdade para o que foi disparado ao Meta.

**Como aplicar:**
- `META_CAPI_TOKEN` e `META_PIXEL_ID` continuam no env de produção apenas por compatibilidade com `.env.example` antigo — código em `src/` **não importa** essas vars.
- Se aparecer demanda de "Nexora dispara evento CAPI direto" — recuse e redirecione para o AIOS Python via Comando 3.

### 3.4 `service_role` é exclusivamente server-side

> **Regra:** `SUPABASE_SERVICE_ROLE_KEY` jamais entra em bundle browser ou em código que rode no cliente. `supabaseAdmin` (que usa essa key) é importado apenas de `src/server.ts` e scripts em `src/executions/`.

**Por quê:** `service_role` faz bypass de RLS. Vazá-la para o front equivale a publicar credenciais de admin do banco.

**Como aplicar:**
- Quando o frontend Next.js for bootstrapped, ele usará `SUPABASE_ANON_KEY` + sessão de usuário autenticado. Qualquer operação que precise de `service_role` vira endpoint server-side (route handler ou Hono route).

### 3.5 Toda variável de ambiente passa pelo Cofre Zod

> **Regra:** Código em `src/**/*.ts` **não pode** ler `process.env.X` diretamente. Toda leitura passa por `import { env } from './lib/env.js'`.

**Por quê:** garante fail-fast no boot — typo ou variável faltante derruba o processo antes de servir 1 request. Tipagem forte previne `undefined` propagando em produção.

**Como aplicar:**
- Adicionar nova var: (1) acrescentar ao `envSchema`; (2) atualizar `.env.example`; (3) consumir via `env.NOVA_VAR`.
- Lint não bloqueia leitura direta de `process.env` ainda — disciplina é por code review até regra ESLint custom ser adicionada.

### 3.6 Schema validation na borda (SECURITY_POLICIES.md §2)

> **Regra:** Todo body/query/header de request HTTP passa por Zod `safeParse` antes de tocar o banco.

**Por quê:** defesa em profundidade contra payload malicioso, injection, e contratos quebrados pelo consumidor.

**Como aplicar:** rotas novas seguem o padrão dos Comandos 2 e 3 — schema Zod definido no topo do arquivo, `safeParse` retorna 400 com `details[].path` + `details[].message` em caso de falha.

### 3.7 `org_id` é a linha de isolamento multi-tenant

> **Regra:** Toda query em `companies`, `contacts`, e tabelas correlatas inclui `WHERE org_id = $1`. Todo INSERT preenche `org_id` explicitamente. RLS Supabase força isso no banco, mas o app **também** valida.

**Por quê:** vazamento cross-tenant é o pior bug possível num SaaS multi-tenant.

**Como aplicar:** Comando 3 (`GET /api/outbound/conversions`) já exige `org_id` no query schema; Comando 2 já exige `org_id` no payload. Manter o padrão.

---

## 4. Próximos Passos Conhecidos (não bloqueantes)

Áreas livres do freeze, herdadas para sessões futuras:

- **Bootstrap Frontend Next.js 14** — backend Hono permanece, story própria a criar.
- **Single-tenant fallback** — avaliar `NEXORA_DEFAULT_INBOUND_ORG_ID` no env para clientes single-tenant.
- **Cleanup das `.temp/`** — `supabase/.temp/*` e `src/executions/test-google-maps-mapper.ts` permanecem dirty no working tree (não relacionados ao Loop).
- **Suprimir false-positives ESLint** — `security/detect-object-injection` em `google-maps-mapper.service.ts:287, :292` (já documentado — keys são literais internos controlados).

---

## 5. Documentos de Referência

| Documento | Propósito |
|-----------|-----------|
| `docs/PRD.md` | Visão de produto detalhada (3 pilares originais + Módulo de Extração adicionado posteriormente). |
| `docs/architecture.md` | Arquitetura técnica original. |
| `docs/backlog.md` | Backlog de stories e epics. |
| `docs/deploy-supabase.md` | Procedimento de deploy do banco. |
| `SECURITY_POLICIES.md` (raiz) | 3 pilares: zero hardcoded secrets, sanitização Supabase, .env estrito. |
| `.aios-core/constitution.md` | Constituição AIOS — princípios inegociáveis do framework. |

---

*Manifest produzido em colaboração @pm (Morgan) + @architect (Aria) · pt-BR · Synkra AIOS v2.0*
