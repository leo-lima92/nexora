# Checklist de Deploy em Produção — NEXORA

> Documento operacional para o **dia do deploy**. Siga na ordem. Cada variável tem: onde
> conseguir o valor, como gerar quando é segredo nosso, e como saber que ficou certa.
>
> Fonte da verdade deste documento: `lib/env.ts` (app Next.js) e `src/lib/env.ts` (API Hono).
> **Se você mudar um desses arquivos, mude este documento junto** — senão ele vira mentira
> educada, que é pior do que não existir.

---

## Antes de tudo: são DOIS serviços, com DUAS listas de variáveis

Este repositório entrega dois processos que sobem separados e **não compartilham o contrato
de env**:

| Serviço | Arquivo de env | Obrigatórias | Sobe com |
|---|---|---|---|
| **App Next.js** (o CRM, a tela) | `lib/env.ts` | **13** | `pnpm build && pnpm start` |
| **API Hono** (ponte AIOS/Meta) | `src/lib/env.ts` | **9** | `pnpm build:hono && pnpm start:hono` |

São **22 exigências**, não 13 nem 9. Elas se sobrepõem em *valor* mas divergem em *nome* — e
essa é a armadilha número um deste deploy:

| O valor | Nome no Next.js | Nome no Hono |
|---|---|---|
| URL do projeto Supabase | `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` |
| Chave anônima | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY` |
| Chave service role | `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` *(mesmo nome)* |

Preencher só um dos lados faz o outro serviço morrer no boot. Os dois validam no startup e
**falham rápido de propósito** — é melhor não subir do que subir mudo.

**Sobre a Vercel:** só o **app Next.js** vai para lá. A API Hono usa `@hono/node-server`
(`serve()` em `src/server.ts`) — é um processo Node de longa duração, que a Vercel não hospeda
nesse formato. Ela precisa de VPS ou contêiner. Se o plano é "tudo na Vercel", o Hono fica de
fora e a ponte AIOS↔Meta não existe em produção.

---

## Como gerar um segredo (use em todo lugar que este documento pedir "gere")

Onde houver `openssl` (Linux, VPS, Git Bash):

```bash
openssl rand -base64 32
```

No Windows sem `openssl`, com o Node que você já tem:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Regras que valem para **todos** os segredos abaixo:

- **Um valor diferente por variável.** Reaproveitar a mesma string em duas chaves significa
  que vazar uma vaza as duas.
- **Diferente do que você usa em desenvolvimento.** Se o segredo de produção já esteve num
  `.env` local, ele não é mais segredo.
- **Nunca commitado.** O `.gitignore` já cobre `.env*`, mas o erro comum é colar segredo em
  issue, print ou mensagem de chat.
- **Guardado antes de colar.** Você não recupera `SUPABASE_SERVICE_ROLE_KEY` depois; recupera
  só *rotacionando*, o que derruba quem estiver usando a antiga.

---

## Bloco A — App Next.js: as 13 obrigatórias

### A.1 Supabase (3) — obrigatórias até em desenvolvimento

Onde: **Supabase Dashboard → Settings → API**.

| Variável | Valor | Cuidado |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://<ref>.supabase.co`) | Validada como URL — um typo derruba o boot |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` / `public` | Vai para o browser. É seguro **porque a RLS é o guarda real** |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` | **BYPASSA A RLS.** Só servidor. Nunca num `NEXT_PUBLIC_*`. Rotação trimestral |

> Se a `service_role` cair no bundle do browser, qualquer visitante lê e escreve os dados de
> todos os tenants. É a falha mais cara possível neste sistema.

### A.2 `SUPABASE_DB_URL` (1) — leia esta seção inteira antes de copiar

Onde: **Supabase Dashboard → Settings → Database → Connection string**.

Esta é a variável que mais deu trabalho na preparação do ambiente local, e o motivo vale para
produção. Dois erros, os dois silenciosos:

**Erro 1 — o host direto é IPv6-only.** O `db.<ref>.supabase.co` que o dashboard mostra em
destaque publica **apenas registro AAAA**. Se a máquina (VPS, runner de CI, seu notebook) não
tiver IPv6 de saída, a conexão morre em `ETIMEDOUT` depois de um minuto, sem dizer o porquê.

**Use a connection string do modo Session (pooler),** que tem IPv4:

```
postgresql://postgres.<ref>:<SENHA>@aws-<N>-<região>.pooler.supabase.com:5432/postgres
```

Note o `<N>`: neste projeto o pooler certo é o **`aws-1-sa-east-1`**. O `aws-0-sa-east-1`
responde `tenant/user not found` — mesmo formato de URL, host quase idêntico, erro que parece
credencial errada e não é. Confirme o host exato no dashboard.

**Erro 2 — caractere especial na senha quebra a URL.** Se a senha tiver `@`, `#`, `/`, `?` ou
`:`, ela precisa ser **percent-encoded**, senão o parser corta a URL no lugar errado e você
recebe erro de autenticação para uma senha que está correta.

| Caractere | Escreva |
|---|---|
| `@` | `%40` |
| `#` | `%23` |
| `/` | `%2F` |
| `?` | `%3F` |
| `:` (na senha) | `%3A` |

**Verificação:** o repositório já tem o diagnóstico pronto. Ele distingue "URL mal formada" de
"senha realmente inválida" e **não imprime o segredo**:

```bash
node scripts/probe-db-auth.mjs
```

### A.3 Segredos que você gera (4)

Gere um valor novo para cada, com o comando da seção acima.

| Variável | Para que serve | Se ficar errada |
|---|---|---|
| `INTERNAL_SECRET` | Bearer dos endpoints `/api/v1/cron/*`; também assina o state do OAuth Nuvemshop e, na falta de `INVITE_TOKEN_SECRET`, os tokens de convite | Cron não roda e convite de equipe não valida |
| `CPF_ENCRYPTION_KEY` | Passphrase pgcrypto do CPF dos contatos (PII sensível sob LGPD) | **Trocar depois torna ilegível todo CPF já gravado.** Defina uma vez e guarde |
| `WAHA_BYO_ENCRYPTION_KEY` | Passphrase pgcrypto das credenciais de cliente que roda WAHA próprio | Mesma armadilha do CPF: trocar perde o que já foi cifrado |
| `AI_CRED_AES_KEY` | AES-256-GCM das API keys de provedor LLM em `ai_provider_credentials` | **Formato rígido: exatamente 32 bytes em base64.** `openssl rand -base64 32`. Não invente uma frase — `lib/crypto/aes_gcm.ts` rejeita em runtime |

> As três chaves de criptografia são **irrecuperáveis por design**. Guarde no cofre de senhas
> da empresa no mesmo momento em que gerar, antes de colar no painel. Perder `CPF_ENCRYPTION_KEY`
> é perder o CPF de toda a base.

### A.4 WAHA — WhatsApp (3)

| Variável | Valor |
|---|---|
| `WAHA_API_BASE_URL` | URL da sua instância WAHA (ex.: `https://waha.seudominio.com`) |
| `WAHA_API_KEY` | **Plaintext** da chave |
| `WAHA_WEBHOOK_BASE_URL` | URL pública **HTTPS** do app, que o WAHA chama de volta |

A pegadinha do `WAHA_API_KEY`: o **app** recebe o texto puro, e o **contêiner do WAHA** recebe
o **hash SHA512 hex** do mesmo valor. São dois formatos do mesmo segredo, em dois lugares.

```bash
echo -n "sua-chave-aqui" | shasum -a 512   # este hash vai no ENV do contêiner WAHA
```

O `WAHA_WEBHOOK_BASE_URL` precisa ser alcançável da internet — o WAHA chama de fora. `localhost`
aqui significa "nenhuma mensagem jamais entra".

### A.5 Upstash Redis (2)

Onde: **console.upstash.com → seu database → REST API**.

| Variável | Valor |
|---|---|
| `UPSTASH_REDIS_REST_URL` | REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | REST Token |

É o que sustenta rate limit e idempotência. Sem isso a API fica sem freio contra abuso.

---

## Bloco B — API Hono: as 9 obrigatórias

Estas são exigidas **sempre** (não há modo permissivo em desenvolvimento): se faltar uma, o
processo não sobe e lista todas as que faltam de uma vez.

| Variável | Onde conseguir |
|---|---|
| `SUPABASE_URL` | Mesmo valor de `NEXT_PUBLIC_SUPABASE_URL` — **outro nome** |
| `SUPABASE_ANON_KEY` | Mesmo valor de `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **outro nome** |
| `SUPABASE_SERVICE_ROLE_KEY` | Mesmo valor e mesmo nome do bloco A |
| `APIFY_API_TOKEN` | console.apify.com → Settings → Integrations → API token |
| `AIOS_WEBHOOK_SECRET` | **Você gera.** Autentica o AIOS Python chamando `POST /api/webhooks/aios-lead`. O mesmo valor tem de ser configurado do lado do agente Python |
| `AIOS_PULL_TOKEN` | **Você gera.** Autentica o AIOS Python puxando `GET /api/outbound/conversions`. Valor **diferente** do anterior — sentidos opostos, segredos separados |
| `META_CAPI_TOKEN` | Meta Events Manager → seu Pixel → Configurações → Conversions API → gerar token de acesso |
| `META_PIXEL_ID` | Meta Events Manager → o ID numérico do Pixel |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys. Server-only, como a service role — **nunca** no bundle do browser |

### `PORT` — colisão que morde no primeiro minuto

Ambos os serviços têm **3000** como padrão. Subir os dois na mesma máquina sem separar as
portas faz o segundo morrer com `EADDRINUSE`. Defina explicitamente:

```
PORT=3333      # API Hono
```

deixando a 3000 para o Next.js (ou o inverso — o que importa é a decisão ser explícita).

---

## Bloco C — Opcionais que parecem obrigatórias

Estas **não bloqueiam o boot**. Elas quebram funcionalidade em silêncio, e o operador só
descobre quando um cliente reclama. Decida conscientemente sobre cada uma.

| Variável | Sem ela |
|---|---|
| `IMPERSONATE_COOKIE_SECRET` | Fluxo de impersonate devolve **503** em runtime. Exige **≥ 32 caracteres** — mais curto conta como ausente |
| `AI_GATEWAY_API_KEY` ou `ANTHROPIC_API_KEY` ou `OPENROUTER_API_KEY` | O agente **pula toda resposta** com `reason='ai_gateway_key_missing'`. Basta uma das três |
| `OPENAI_API_KEY` | RAG sem embedding (o bot responde sem contexto recuperado) **e** transcrição de áudio desligada (o agente pede ao lead para reenviar como texto) |
| `WAHA_HMAC_SECRET` + `WAHA_WEBHOOK_REQUIRE_SIGNATURE=true` | Webhooks entram **sem verificação de assinatura**. Ligue se roda WAHA Plus. O WAHA Core não assina — exigir com Core derruba a ingestão inteira |
| `LGPD_SIGNING_KEY`, `LGPD_DPO_EMAIL` | Export LGPD sem assinatura e sem contato de encarregado |
| `SENTRY_DSN` | Sem relatório de erro. `SENTRY_DSN=off` desliga explicitamente |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ADMIN_URL` | Caem para `http://localhost:3000` — **errado em produção**, quebra todo link absoluto (e-mail de convite, redirect de OAuth) |

---

## Bloco D — Ordem do dia do deploy

1. **Banco antes de tudo.** Aplique `supabase/baseline.sql` — é o que o kit self-host usa. A
   cadeia de `supabase/migrations/` **não sobe do zero** (quebra na `0010`; medido: 21 aplicam,
   80 falham). Isto está documentado em `supabase/migrations/MANIFEST.md`.
2. **Preencha as 13 do Bloco A** no painel (Vercel → Settings → Environment Variables, ou o
   `.env` da VPS). Marque como *Production*.
3. **Preencha as 9 do Bloco B** onde a API Hono for rodar, mais o `PORT`.
4. **Decida o Bloco C** item por item. Não deixe por omissão.
5. **Suba.** Numa VPS que já tem proxy reverso próprio (Hostinger, Coolify, Dokploy), todo
   `up -d` leva **os dois** arquivos de compose:

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
   ```

   Omitir o segundo recria o contêiner sem as labels de roteamento: o Traefik da hospedagem
   para de enxergá-lo e **o domínio inteiro responde `404`** — com o contêiner marcado
   `healthy`, porque o healthcheck é um probe TCP interno que não sabe nada de roteamento.
   Detalhes em `docs/runbooks/deploy.md`.

---

## Bloco E — Como saber que deu certo

Não confie em "o contêiner está healthy". Meça:

| Verificação | Esperado | Se falhar |
|---|---|---|
| `curl -I https://seudominio.com/` | **307** (redireciona para o login) | **404** = roteamento do proxy, não app (releia D.5) |
| `curl https://seudominio.com/login` | **200** | Erro de boot; leia o log — o Zod lista todas as vars faltantes de uma vez |
| `curl https://api.seudominio.com/health` | `{"status":"ok","service":"nexora-api"}` | API Hono não subiu — quase sempre uma das 9 do Bloco B |
| `node scripts/probe-db-auth.mjs` | `Credencial VÁLIDA` | Releia A.2 (IPv6 e percent-encoding) |
| Log do primeiro boot | Sem linhas `[env]` de aviso que você não tenha decidido no Bloco C | Cada aviso é uma funcionalidade desligada |

**Prova final, e a única que conta para um produto que se vende instalado:** abra o navegador,
crie a conta, conecte o canal, cadastre o primeiro lead. Um `curl` verde prova que o backend
responde; ele não prova que a pessoa consegue usar o sistema. Esta é a doutrina de QA Visual do
projeto — o caminho de primeira impressão é testado primeiro e com o maior rigor.
