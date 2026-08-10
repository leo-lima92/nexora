# NEXORA — Manifest

**Versão:** 1.3
**Data:** 2026-08-10
**Owners:** @pm (Morgan) — Visão & Produto · @architect (Aria) — Arquitetura & Regras de Ouro
**Audiência:** Engenheiro Sênior externo (CTO) — sincronização de estado absoluto
**Status:** ▶️ **STANDBY ENCERRADO (2026-08-10)** · Chassi decidido: **fork estratégico do DeskcommCRM** · Closed Loop em produção · CODE FREEZE ativo sobre rotas do Loop (desde 2026-05-07) · AI Studio — infraestrutura de dados APLICADA em produção (Missão 1 concluída)

> **Changelog v1.3 (2026-08-10):** CEO (Leonardo) + CTO **bateram o martelo**: o Nexora passa a ser um **fork estratégico do DeskcommCRM** (repositório oficial). O STANDBY ESTRATÉGICO é **encerrado** e a seção §0 substituída pela nova diretriz de produto (§0 — Diretriz de Fork). A arquitetura base migra de "backend Hono standalone + frontend Next.js a bootstrappar" para **chassi Next.js + Supabase herdado do DeskcommCRM**, sobre o qual plugamos o diferencial proprietário: o **Módulo de Tráfego AIOS** que fecha o Closed Loop. §2.1 (Stack) atualizada. Próximo passo de engenharia: **clone e inicialização do repositório base** — aguardando ordem de deploy técnico.

> **Changelog v1.2 (2026-08-08):** Missão 1 do AI Studio **concluída e homologada**. A migration `20260615120000_create_ai_studio_schema.sql` (`ai_agents`, `agent_sessions`, `chat_history`) foi **aplicada em produção** no projeto `qpwkhuvchibrxretubss`, com RLS estrito por `org_id` **verificado empiricamente** (tentativa de acesso via `anon` → `401` / Postgres `42501`). O Cofre Zod passou de 8 → **9 variáveis obrigatórias** com a entrada de `ANTHROPIC_API_KEY` (`src/lib/env.ts` + `.env.example` ajustados). §1.5, §2.4, §2.5 e §2.7 atualizadas. Projeto entra em **STANDBY** — ver §0.

> **Changelog v1.1 (2026-06-15):** direcionamento estratégico oficializado por CEO (Leonardo) + CTO — a camada de Inteligência migra de *agentes hardcoded* para o modelo **AI Studio**: o usuário final cria seus próprios SDRs dinamicamente, persistindo prompt de sistema, tom de voz e configurações no banco (multi-tenant por `org_id`). Ver §1.5.

---

## 0. DIRETRIZ DE PRODUTO — Fork Estratégico do DeskcommCRM (2026-08-10)

> ▶️ **STANDBY ENCERRADO.** A avaliação de chassi aberta em 2026-08-08 foi concluída. **Decisão do CEO (Leonardo) + CTO: adotar o chassi do DeskcommCRM (repositório oficial) como base do Nexora, via fork estratégico.**

**Tese:** o Nexora não escreve mais do zero a camada de apresentação nem a infraestrutura conversacional. Herdamos um chassi "AI-First" já maduro e concentramos 100% do esforço proprietário naquilo que **nenhum CRM open-source tem**: o Módulo de Tráfego AIOS que fecha o Closed Loop de atribuição Meta.

### 0.1 O que herdamos vs. o que plugamos

| Camada | Origem | Detalhe |
|--------|--------|---------|
| **UI / Front-end** | 🧬 Herdado (DeskcommCRM) | Next.js App Router + design system pronto. Elimina o bootstrap de frontend que estava em aberto desde §4. |
| **WhatsApp** | 🧬 Herdado | Canal conversacional nativo — não reimplementar. |
| **Guardrails de IA** | 🧬 Herdado | Camada de contenção/validação de resposta dos agentes. |
| **Follow-ups** | 🧬 Herdado | Motor de cadência e reengajamento. |
| **Supabase (Auth + DB + RLS)** | 🧬 Herdado (converge) | Mesma stack já usada pelo Nexora — convergência natural, sem troca de fornecedor de dados. |
| **Módulo de Tráfego AIOS** | ⚡ **Proprietário Nexora** | Inbound webhook + Outbound conversions + atribuição Meta (`meta_campaign_id`/`adset`/`ad`). **É o diferencial.** Ver §2.2. |
| **AI Studio (`ai_agents`, `agent_sessions`, `chat_history`)** | ⚡ **Proprietário Nexora** | Schema já aplicado em produção — ver §2.7. Consumido pelo chassi, não substituído por ele. |
| **Módulo Sniper / Extração Apify** | ⚡ **Proprietário Nexora** | Ver §1.4. |

### 0.2 Consequências arquiteturais

1. **Next.js deixa de ser "planejado" e passa a ser a base do produto.** A decisão anterior de §2.1 ("Next.js descartado para microsserviço backend") permanece válida **apenas no seu contexto original** — ela justificava não usar Next.js como *backend do microsserviço Hono*. Com o fork, Next.js entra como **chassi da aplicação**, e o Hono é reposicionado (ver §0.3).
2. **Supabase é o ponto de convergência.** Ambos os lados usam Postgres + RLS. A integração dos schemas (chassi + `companies`/`contacts`/`ai_agents` do Nexora) é o primeiro trabalho técnico real de arquitetura pós-clone.
3. **Nenhuma Regra de Ouro (§3) é revogada pelo fork.** Elas passam a valer *dentro* do chassi herdado — em especial §3.1 (sem dedup), §3.2 (CODE FREEZE do Loop), §3.3 (CAPI mora no AIOS), §3.4 (`service_role` server-side) e §3.7 (`org_id`).

### 0.3 Questões abertas (a resolver no deploy técnico, não agora)

| Questão | Estado |
|---------|--------|
| Destino do backend Hono (`src/server.ts`) — permanece como serviço separado para o Loop, ou as rotas migram para route handlers do chassi? | **Em aberto.** Restrição: §3.2 (CODE FREEZE) — o contrato HTTP homologado com o AIOS Python **não pode mudar** em nenhuma das hipóteses. |
| Estratégia de merge de schema Supabase (chassi vs. migrations Nexora existentes) | **Em aberto** — @data-engineer (Dara) após o clone. |
| Modelo de sincronização com o upstream do DeskcommCRM (rebase periódico vs. hard fork) | **Em aberto.** |

### 0.4 Próximo passo de engenharia

> 🎯 **Clone e inicialização do repositório base DeskcommCRM.**

Esta é a **única** próxima ação técnica autorizada em fila. Ela **ainda não foi executada** — @pm e @architect aguardam a ordem explícita de deploy técnico de Leonardo. Nada de código é alterado até lá.

**Baseline preservado (intacto e seguro):** backend Hono operante, Closed Loop homologado em produção, schema AI Studio aplicado com RLS verificado, Cofre Zod com 9 variáveis, `master` sincronizado com `origin/master`. Nenhum desses ativos é descartado pelo fork — todos são **portados** para o chassi.

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

**Próxima missão (reordenada pela decisão de fork — §0):** a camada de aplicação do AI Studio (resolver `ai_agents` + `chat_history` e acionar o `@anthropic-ai/sdk`) passa a ser construída **dentro do chassi DeskcommCRM**, aproveitando os Guardrails e o canal WhatsApp já herdados — em vez de ser escrita do zero na API Hono. Fica **após** o clone e a inicialização do repositório base (§0.4).

---

## 2. Estado Atual da Arquitetura

### 2.1 Stack (atualizada em 2026-08-10 — pós-decisão de fork)

**Arquitetura base: chassi DeskcommCRM (Next.js + Supabase), forkado, com o Módulo de Tráfego AIOS plugado por cima.** Ver §0.

| Camada | Tecnologia | Versão / Notas |
|--------|-----------|----------------|
| **Chassi da aplicação** | **Fork do DeskcommCRM** — Next.js App Router + Supabase | 🧬 **Base oficial do produto (decisão CEO+CTO 2026-08-10).** Traz UI, WhatsApp, Guardrails e Follow-ups prontos. **Ainda não clonado** — ver §0.4. |
| Frontend | Next.js App Router + TS + Tailwind + design system do chassi | Herdado do fork. Substitui o bootstrap "do zero" que estava planejado. |
| Backend HTTP (Loop) | **Hono 4.12** + `@hono/node-server` | Entrypoint: `src/server.ts`. Hospeda as rotas do Closed Loop, **sob CODE FREEZE (§3.2)**. Posicionamento final dentro do chassi em aberto (§0.3). Racional original mantido: web-standard nativo permite migrar p/ Vercel/Edge/Workers sem refactor. |
| Runtime | Node.js 22+ | `"engines": { "node": ">=22.0.0" }` |
| DB | Supabase (PostgreSQL + RLS + pgvector + pg_cron) | Projeto `qpwkhuvchibrxretubss` — **LIVE em produção**. Ponto de convergência entre chassi e Nexora; merge de schema pendente (§0.3). |
| Auth | Supabase Auth | Convergente com o chassi. |
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

## 4. Próximos Passos Conhecidos

**Passo 1 (bloqueante, aguardando ordem de deploy técnico):** clone e inicialização do repositório base DeskcommCRM — ver §0.4.

Demais áreas, livres do freeze e herdadas para sessões futuras:

- ~~**Bootstrap Frontend Next.js 14**~~ — ✅ **Resolvido por decisão estratégica (2026-08-10):** o front-end vem do chassi forkado, não será bootstrapped do zero.
- **Merge de schema Supabase** (chassi DeskcommCRM ↔ migrations Nexora) — @data-engineer, pós-clone.
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
