# Políticas de Cibersegurança — Nexora (RevOps + AIOS)

Estas políticas são **inegociáveis** para qualquer código mergeado no repositório `nexora`. Elas se aplicam ao backend Node.js/TypeScript, à camada de extração (Apify), à integração com Supabase e a qualquer ponte futura com o agente autônomo Python de Tráfego Pago (AIOS).

Violações detectadas em PR são bloqueantes e devem ser corrigidas antes do merge.

---

## 1. Proibição absoluta de hardcoded secrets

**Regra:** Nenhum segredo, credencial, token, chave de API, DSN, JWT ou string de conexão pode aparecer literalmente em código-fonte, testes, fixtures, snapshots, comentários, mensagens de commit ou logs.

**Inclui, sem limitação:**
- Chaves do Supabase (`anon`, `service_role`, `jwt_secret`, `db url`).
- Tokens da Apify (`APIFY_TOKEN`, actor IDs com escopo privado).
- Chaves de provedores de IA, e-mail, mensageria, observabilidade.
- Credenciais de qualquer integração de Tráfego Pago (Meta, Google Ads, TikTok, etc.).
- Cookies de sessão, refresh tokens, OAuth secrets.

**Como cumprir:**
- Todo segredo é lido **exclusivamente** via `process.env.<NOME>` (ver §3).
- Nenhum valor real entra em `.env.example` — apenas o nome da variável e um placeholder neutro.
- O arquivo `.env` está e permanece no `.gitignore`.
- Em caso de exposição acidental, o segredo é considerado **comprometido**: rotacionar imediatamente no provedor antes de qualquer outra ação (não basta remover do histórico).

**Detecção:** `eslint-plugin-security` + `npm audit` no script `security-check`. Detecções extras (gitleaks, secret scanning do GitHub) podem ser adicionadas pelo `@devops`.

---

## 2. Sanitização e segurança no acesso ao Supabase

**Regra:** Qualquer dado vindo de fonte externa (HTTP, fila, scraping/Apify, planilha, integração) é **não confiável** até ser explicitamente validado e sanitizado antes de chegar ao Supabase.

**Diretrizes:**
- **Validação de schema obrigatória** na borda. Use uma camada de validação (ex.: Zod) para todo payload externo antes de persistir. Sem validação, sem `insert`/`upsert`/`update`.
- **Nunca** construa filtros, ordenações ou queries por concatenação de strings vindas de input. Use sempre os métodos parametrizados do `@supabase/supabase-js` (`.eq`, `.in`, `.match`, `.filter`).
- **Nunca** repasse input cru para `.rpc(...)` sem validar tipos/limites de cada argumento.
- **RLS é obrigatório** em toda tabela com dados de tenant/usuário. Tabelas sem RLS exigem justificativa explícita registrada na story.
- **`service_role` é proibido no front-end** e em qualquer caminho exposto ao usuário final. Uso restrito a processos server-side controlados (workers, jobs, executions).
- **Logs e telemetria** não podem conter PII bruta nem campos sensíveis (telefones, e-mails, chaves) sem mascaramento.
- **Storage:** nomes de arquivo derivados de input externo devem ser normalizados (slug + UUID), nunca usados crus para evitar path traversal.

---

## 3. Uso estrito de variáveis de ambiente (`.env`)

**Regra:** Configuração sensível e específica de ambiente vive **exclusivamente** em variáveis de ambiente, carregadas a partir de `.env` em desenvolvimento e do gerenciador de segredos da plataforma em produção (CI/CD, runtime).

**Diretrizes:**
- Toda variável usada pelo código aparece em `.env.example` com nome, descrição curta e placeholder. Variável nova sem entrada em `.env.example` é violação.
- Acesso a `process.env` é **centralizado** em um módulo de config (ex.: `src/lib/env.ts`) que valida presença/tipo no boot. Falhar rápido na ausência de variável obrigatória é o comportamento desejado.
- Código de aplicação nunca lê `process.env.X` direto fora desse módulo central — sempre importa o objeto tipado de config.
- `NODE_ENV` é tratado com cuidado: valores diferentes de `development`, `test`, `production` são erro.
- Segredos rotacionados no provedor devem refletir em todos os ambientes (dev, staging, prod) na mesma janela; não tolerar drift.
- Em CI, segredos são injetados via secret store do provedor (GitHub Actions secrets, Vault, etc.). **Nunca** logar `process.env` por completo.

---

## 4. Pipeline de verificação

O comando `npm run security-check` executa, em ordem:

1. `npm audit` — detecta vulnerabilidades conhecidas em dependências (npm advisory database).
2. `eslint src` — aplica `eslint-plugin-security` sobre o código TypeScript da aplicação, sinalizando padrões inseguros (regex catastrófica, `eval`, `child_process` com input dinâmico, buffer non-literal, etc.).

**Política de execução:**
- Rodado localmente antes de cada commit que toque código de aplicação.
- Rodado em CI em todo PR contra `master`.
- Falhas no `security-check` são bloqueantes para merge.

---

## 5. Escopo e exclusões

- O lint de segurança cobre **apenas `src/`** (código de aplicação). Pastas de framework (`.aios-core/`), artefatos de IDE/agentes (`.cursor/`, `.codex/`, `.gemini/`, `.antigravity/`, `.agent/`, `.claude/`), `docs/`, `node_modules/`, `dist/` e `supabase/` (migrations + cli temp) ficam fora do scan de aplicação.
- `supabase/migrations/` segue revisão própria: revisão manual obrigatória pelo `@data-engineer` para qualquer mudança de RLS, grants ou funções com `SECURITY DEFINER`.

---

## 6. Resposta a incidentes (resumo)

Se um segredo vazar ou um padrão inseguro for detectado em produção:

1. **Conter:** rotacionar segredo no provedor, revogar tokens ativos.
2. **Avaliar:** identificar janela de exposição e dados potencialmente acessados.
3. **Corrigir:** PR isolado, fast-track, com `security-check` verde.
4. **Registrar:** post-mortem em `docs/` com causa-raiz e ação preventiva (regra de lint, validação adicional, etc.).

---

**Owners:** `@architect` (Aria) define padrões; `@devops` (Gage) opera CI/segredos; `@dev` (Dex) implementa; `@qa` (Quinn) valida no gate de qualidade.

**Última atualização:** 2026-05-05.
