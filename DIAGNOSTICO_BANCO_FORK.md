# Diagnóstico — por que o login estoura na tela de erro

> Medido em 2026-08-11 contra o banco de produção (`qpwkhuvchibrxretubss`, sa-east-1).
> Nenhuma escrita foi feita no banco durante este diagnóstico. Este documento existe para
> a decisão ser tomada com número na mão, não com hipótese.

---

## O sintoma

O CEO criou a conta, confirmou o e-mail, e ao fazer login recebeu um Error Boundary do
Next.js (digest do browser: `180ab31b42614c28bb568eb54c3c017e`).

## A hipótese que estava circulando — e por que está errada

A suspeita inicial era **falta do profile/tenant inicial**: usuário criado em `auth.users` sem
a linha correspondente em `profiles`/`user_organizations`, e a correção seria rodar
`scripts/bootstrap-owner.ts`.

A primeira metade está certa: `profiles` e `user_organizations` estão de fato vazias. **A
correção, não.** O erro do servidor não é relacionamento faltando — é tabela inexistente:

```
⨯ Error: auth_permissions_unavailable: Could not find the table
  'public.platform_admins' in the schema cache
      at loadAuthUser (lib/auth/server.ts:84)
      at async AppLayout (app/app/layout.tsx:19)
```

Código PostgREST `PGRST205`. Junto dele, no mesmo log:

```
[audit] insert error Could not find the table 'public.api_audit_log' in the schema cache
```

`scripts/bootstrap-owner.ts` faz quatro coisas, e a quarta é inserir em `platform_admins`.
Rodá-lo falharia no passo 4 — **depois** de já ter criado usuário e organização, deixando o
banco em estado pior do que o atual. Por isso não foi executado.

Vale registrar que o `lib/auth/server.ts` se comportou exatamente como projetado: ele
**estoura** em vez de degradar a permissão em silêncio. O comentário no próprio arquivo conta
que a alternativa já custou seis diagnósticos errados numa ocasião anterior. A tela de erro é
feia, mas é o comportamento correto — a alternativa seria uma UI mentindo que o usuário não
pertence a organização nenhuma.

---

## O estado real do banco

| Objeto | Estado medido |
|---|---|
| `auth.users` | 1 linha — e-mail confirmado ✓ |
| `public.profiles` | **0 linhas** |
| `public.user_organizations` | **0 linhas** (tabela existe: veio do shim) |
| `public.organizations` | 1 linha (`Agência Agêntica`, criada em 2026-05-06) |
| Total de tabelas em `public` | **35** |

As 35 tabelas são o schema **NEXORA** (`companies`, `deals`, `agent_sessions`, `hit_lists`,
`linkedin_threads`, …) mais os objetos do shim de tenancy. As tabelas do **chassi
DeskcommCRM** que a UI logada exige não existem:

```
AUSENTE  platform_admins      AUSENTE  crm_pipelines
AUSENTE  api_audit_log        AUSENTE  crm_stages
AUSENTE  api_tokens           AUSENTE  crm_leads
AUSENTE  user_recovery_codes  AUSENTE  conversations
AUSENTE  idempotency_keys     AUSENTE  messages
AUSENTE  event_log            AUSENTE  channel_sessions
```

Isto **não é uma surpresa** — é o que o `NEXORA_MANIFEST v1.3` registrou: as 140 migrations do
chassi nunca foram aplicadas em produção, e o `db push` cego delas é proibido. O shim de
tenancy entregou o que prometeu (`user_organizations`, `fn_user_org_ids()`, `fn_is_org_admin()`);
ele nunca prometeu o resto do chassi.

---

## Por que "é só aplicar o baseline.sql" não resolve

O `supabase/baseline.sql` cria 38 tabelas, e confirmadamente inclui todas as ausentes acima.
Mas **4 delas já existem** neste banco, duas com dados:

| Tabela | Linhas hoje |
|---|---|
| `organizations` | 1 |
| `contacts` | 1 |
| `ai_agents` | 0 |
| `user_organizations` | 0 |

E `organizations` **não é a mesma tabela nos dois mundos**:

```
NEXORA hoje : id, name, slug, logo_url, domain, plan, plan_seats, trial_ends_at,
              is_active, settings, metadata, created_at, updated_at

Chassi quer : id, slug, legal_name, display_name, cnpj, status, timezone, locale,
              rate_limit_rps, ai_budget_cents, media_retention_days, settings,
              dpo_email, privacy_policy_url, onboarded_at, suspended_at,
              redacted_at, created_at, updated_at, created_by, onboarding_state,
              suspended_reason, suspended_by
```

O chassi lê `organizations.display_name` (ver `lib/auth/server.ts`) — coluna que **não existe**
aqui. `contacts` tem o mesmo tipo de conflito: 33 colunas de outro domínio (`org_id`,
`first_name`, `linkedin_profile_id`, `apify_run_id`) contra o formato que o chassi espera
(`organization_id`, `wa_identity`).

O baseline usa `CREATE TABLE IF NOT EXISTS`. Sobre as 4 colidentes ele **não faz nada** — pula
e segue, criando 34 tabelas novas cujas FKs e policies apontam para um `organizations` sem as
colunas que elas pressupõem.

**Conclusão: aplicar o baseline aqui não é uma correção, é uma fusão de dois modelos de dados
incompatíveis.** Move o erro de lugar em vez de eliminá-lo, e faz isso sobre dados reais.

### O remendo mínimo também não serve

Criar só `platform_admins` + `api_audit_log` e inserir a membership faria o login passar. A
primeira tela (`/app/inbox`) morreria em seguida, em `conversations`. Toda a UI autenticada
vive em `app/app/*` — inbox, kanban, contacts, pipelines, lgpd, radar — e é inteira do chassi.
Não existe dashboard NEXORA alternativo para onde apontar o login.

---

## Opções, com o custo de cada uma

### A. Projeto Supabase novo, limpo

Criar um projeto Supabase novo, aplicar `baseline.sql` fresh (com `ON_ERROR_STOP=1`, o caminho
que o `install.sh` exercita) e rodar `scripts/bootstrap-owner.ts`. O CEO entra no Dashboard com
o chassi coerente consigo mesmo.

- **Ganha:** caminho curto e previsível; é o fluxo que o produto self-host já suporta e testa.
- **Custo:** trocar as envs de Supabase, recriar a conta.
- **Fica pendente:** os dados NEXORA (1 organização, 1 contato) seguem no banco antigo,
  intocados, aguardando migração.

### B. Fundir os dois modelos neste banco

Escrever uma migration de convergência: adicionar em `organizations`/`contacts` as colunas que
o chassi espera, migrar os dados NEXORA para o formato dele, e só então aplicar o baseline.

- **Ganha:** um banco só, sem perder nada.
- **Custo:** é trabalho de projeto, não de sessão. E roda sobre dados de produção **sem
  Postgres de ensaio disponível** — o Docker não está operacional nesta máquina, então não há
  como validar a migration antes de aplicá-la.

### C. Diagnosticar e decidir depois ← **escolhido em 2026-08-11**

Nenhuma escrita no banco. Este documento é o artefato.

---

## O que NÃO foi feito (deliberadamente)

- **Não** foi executado `scripts/bootstrap-owner.ts` — falharia no passo 4 e sujaria o banco.
- **Não** foi aplicado `supabase/baseline.sql` — pelos motivos da seção acima.
- **Não** foi criada nenhuma tabela, linha ou coluna. O banco está como estava.

## Pendência de segurança, não relacionada ao schema

O log do `next dev` registra os argumentos das Server Actions em texto puro, e isso inclui a
senha digitada no login:

```
└─ ƒ signInWithPassword({"email":"...","password":"<em texto puro>"}) in 938ms
```

O arquivo de log foi apagado (nunca foi versionado — `.gitignore` cobre `.env*` e ele estava
fora do índice). **A senha usada no teste deve ser trocada.** Vale saber que todo
`npm run dev:all` continuará registrando senhas de login no terminal — é comportamento do Next
em desenvolvimento, não defeito introduzido aqui.
