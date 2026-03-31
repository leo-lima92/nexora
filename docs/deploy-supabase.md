# Nexora — Deploy Supabase: Guia Operacional
**Preparado por:** @devops (Gage)
**Data:** 2026-03-30

---

## Pré-requisitos (verificar antes de continuar)

```bash
# 1. Supabase CLI instalado?
supabase --version
# Esperado: >= 1.200.0 | Instalar: npm install -g supabase

# 2. GitHub CLI autenticado?
gh auth status
# Esperado: Logged in to github.com account leo-lima92

# 3. Migrações prontas?
ls supabase/migrations/
# Esperado:
#   20260330000000_initial_schema.sql   (846 linhas)
#   20260330000001_linkedin_schema.sql  (LinkedIn extension)
```

---

## PASSO 1 — Criar projeto no painel Supabase

1. Acesse: https://supabase.com/dashboard
2. Clique **"New Project"**
3. Configurações:
   - **Name:** `nexora`
   - **Database Password:** gere uma senha forte e guarde com segurança
   - **Region:** South America (São Paulo) → `sa-east-1`
   - **Plan:** Free (para desenvolvimento)
4. Aguarde ~2 minutos o provisionamento
5. **Copie o Project ID** (formato: `abcdefghijklmnop`, 20 chars) — visível na URL: `supabase.com/dashboard/project/{PROJECT_ID}`

---

## PASSO 2 — Login e Link (executar após ter o Project ID)

```bash
# Login no Supabase CLI
supabase login
# Abrirá browser para autenticação — confirme o acesso

# Linkar projeto local ao projeto remoto
supabase link --project-ref {SEU_PROJECT_ID}
# Exemplo: supabase link --project-ref abcdefghijklmnop
# Pedirá a database password criada no Passo 1
```

---

## PASSO 3 — Subir as migrações

```bash
# Aplicar todas as migrações em ordem
supabase db push

# Output esperado:
#   Applying migration 20260330000000_initial_schema.sql...
#   Applying migration 20260330000001_linkedin_schema.sql...
#   Schema applied successfully!
```

> **Se der erro em extensões (vector, pg_cron):** Vá em Database → Extensions no painel Supabase e habilite `vector`, `pg_cron` e `pg_trgm` manualmente antes de rodar o push.

---

## PASSO 4 — Gerar tipos TypeScript

```bash
# Gera src/types/database.ts com os tipos de todas as tabelas
supabase gen types typescript --linked > src/types/database.ts

# Verificar se foi gerado corretamente
head -20 src/types/database.ts
```

---

## PASSO 5 — Variáveis de ambiente

Após criar o projeto, acesse **Settings → API** no painel Supabase e copie:

```bash
# Crie o arquivo .env.local na raiz do projeto
cat > .env.local << 'EOF'
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://{PROJECT_ID}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY={anon_key}
SUPABASE_SERVICE_ROLE_KEY={service_role_key}

# Anthropic
ANTHROPIC_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Resend
RESEND_API_KEY=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Apify
APIFY_API_TOKEN=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF
```

---

## PASSO 6 — Secrets no GitHub (para CI/CD)

```bash
# Adicionar secrets ao repositório nexora
gh secret set SUPABASE_PROJECT_ID    --body "{PROJECT_ID}"
gh secret set SUPABASE_ACCESS_TOKEN  --body "{supabase_access_token}"
gh secret set ANTHROPIC_API_KEY      --body "{anthropic_key}"
gh secret set STRIPE_SECRET_KEY      --body "{stripe_key}"

# Verificar secrets cadastrados
gh secret list
```

---

## PASSO 7 — Validar deploy

```bash
# Verificar status das migrações aplicadas
supabase migration list

# Confirmar tabelas criadas (requer psql ou usar o SQL Editor no painel)
# No painel: Database → Tables — você deve ver 27+ tabelas
```

---

## Checklist de Deploy

- [ ] Projeto criado no painel Supabase
- [ ] `supabase login` executado
- [ ] `supabase link --project-ref {ID}` executado
- [ ] Extensões habilitadas (vector, pg_cron, pg_trgm)
- [ ] `supabase db push` executado sem erros
- [ ] `supabase gen types typescript` gerado
- [ ] `.env.local` preenchido com as keys do projeto
- [ ] Secrets adicionados ao GitHub via `gh secret set`
- [ ] Tabelas visíveis no painel Supabase (27+ tabelas)

---

## Troubleshooting rápido

| Erro | Solução |
|------|---------|
| `extension "vector" does not exist` | Habilitar manualmente em Database → Extensions |
| `extension "pg_cron" does not exist` | Habilitar manualmente em Database → Extensions |
| `password authentication failed` | Usar a senha definida na criação do projeto |
| `project not found` | Verificar o Project ID (Settings → General) |
| `supabase: command not found` | `npm install -g supabase` ou `brew install supabase/tap/supabase` |

---

## Quando Leonardo fornecer o Project ID

Execute em sequência:
```bash
supabase login
supabase link --project-ref {PROJECT_ID}
supabase db push
supabase gen types typescript --linked > src/types/database.ts
```

— Gage, deployando com confiança 🚀
