# MIGRATION_V117_TRACKER — fusão do upstream DeskcommCRM v1.17.0 no Nexora

> Documento de acompanhamento da fusão. Fonte da verdade sobre **o que já foi feito,
> o que está pendente e por quê**. Atualize a cada passo concluído; o passo só conta
> como fechado quando a prova (comando + resultado) está registrada aqui.

| Campo | Valor |
|---|---|
| Branch | `feat/reskin-sobre-v1.17.0` (worktree `C:\dev\nexora-v117`) |
| Base | tag `v1.17.0` do remoto `deskcomm` (`db58c3fb`, 2026-09-08) |
| Origem do reskin | `feat/deskcomm-chassis-import` (hotfix `b6093a84` incluído) |
| Estratégia | **Opção C** — partir do upstream limpo e reaplicar o reskin Orderful por cima, em vez de merge (55 arquivos em conflito, Tailwind 3 → 4) ou de recriar o backend à mão (PR #613: 730 arquivos, 13 migrations) |
| Decisões do CTO (2026-09-09) | (1) recalibração dos testes de marca fica para o Passo 3; (2) a rampa vermillion é **desenhada à mão** — a catraca algorítmica `rampaDeSemente` fica desativada para o produto; (3) nenhuma prova via `next dev` enquanto o host estiver sem RAM |

---

## Passo 1 — tokens no Tailwind 4 ✅ (`bee98ce1`)

**O que foi feito**

- `app/globals.css` gerado por script (`scratchpad/gen-globals-v4.mjs`) mantendo o esqueleto v4 do
  upstream — `@import "tailwindcss" source(none)`, `@source`, `@custom-variant dark`, espelho
  `[data-theme="light"]`, `@theme inline`, `@layer base` — com os tokens Orderful: Vellum/Paper/Carbon,
  Slate, Frost/Cloud, rampa vermillion (600 = `#e42b0c`), raio único 8px, sombras neutras, Archivo,
  Sunset Flux com `--color-cta-fg` por tema. `tailwind.config.ts` **não existe** neste branch.
- Escuro segue o contrato da régua de marca do upstream (`lib/branding/contraste.ts`): mesma rampa nos
  dois temas, accent na parada 400 com texto tinta. `lib/branding/regua-do-produto.ts` regenerado.
- Foco, seleção e anel são **tinta**, não accent (doutrina Orderful) → a régua tem 3 papéis por tema
  (accent, hover, accent-fg), não 6. Guardas de vacuidade ajustados: 18/26 pares → 9/13.
- Fonte: `Atkinson_Hyperlegible` → `Archivo` (`app/layout.tsx`, `tests/unit/tailwind-tokens.test.ts`).
- `tests/unit/contraste-acao-wcag.test.ts` portado, agora resolvendo `var()` e lendo o bloco exato
  (no v4 a string `[data-theme="dark"]` aparece antes no `@custom-variant`).
- `.aios-core`, `.claude/rules`, `.claude/commands`, `.claude/CLAUDE.md` trazidos do branch de origem.

**Prova (sem servidor)**

```
@tailwindcss/postcss 4.3.3 → app/globals.css: 3,6 s · 134 KB · 0 warnings
utilitários resolvidos: bg-vermillion, text-cta-foreground, bg-carbon, text-text-on-carbon,
  bg-surface-sunken, tracking-eyebrow, shadow-subtle, z-modal, ring-ring (→ --color-text)
variantes emitidas: dark: (37), hover:, sm:/md:/lg: (51/22/36)
vitest: tailwind-tokens, branding-tema-claro-escopavel, branding-regua-do-produto,
  contraste-acao-wcag → 28/28
```

---

## Passo 2 — componentes: shell, casca pública, auth, primitivas `ui` ✅ (ver commit deste passo)

**Regra aplicada:** a versão upstream é a base (lógica, i18n, RBAC por `interface_settings`,
densidade medida pelo e2e); só cor, tipografia e forma mudam. Toda troca exigiu âncora presente
(`scratchpad/step2-reskin.mjs`).

| Área | Arquivos | O que mudou |
|---|---|---|
| Shell | `Sidebar.tsx`, `TopBar.tsx`, `NavHub.tsx`, `AppShell.tsx`, `BrandMark.tsx` (novo) | Paper/Frost na moldura, item ativo em `surface-elevated` + tinta com ícone vermillion, rótulos de grupo em eyebrow. **Densidade intacta** (`py-1` = 28px por linha, `space-y-2`): `navegacao.spec.ts` mede 1280×900 |
| RBAC / modo assistido | — | Vieram prontos do upstream: `sidebarGroups(isPlatformAdmin && !user.support, role, interface_settings)` em `lib/navigation/registry.ts`; nenhuma lógica foi tocada |
| Casca pública | `app/(public)/layout.tsx` + 6 páginas | Cartão de Paper com hairline sobre Vellum, marca (logo do revendedor via `marcaDaSaida` **ou** `BrandMark` + nome) acima do cartão, rodapé traduzido; títulos `font-medium tracking-title`, links com hover vermillion, avisos em `success`/`error` |
| Auth | `LoginForm`, `SignupForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `RecoveryForm`, `MfaForm`, `MfaEnrollModal`, `TOTPInput` | Erros em `error-fg`/`error-bg`; **só** Entrar e Criar conta levam `variant="cta"` (uma conversão por dobra) |
| Primitivas | `button`, `badge`, `input`, `textarea`, `dialog`, `dropdown-menu`, `select`, `switch`, `tooltip`; `card`, `avatar`, `skeleton`, `table` (cópia integral, upstream não os tocou) | Escada de vermillion no `button` (cta/primary/carbon/…), badge sem pílula e default outline, campo 44px com foco em tinta, tooltip em Carbon. Mantidos do upstream: `outline-hidden` (v4), alvos de toque `h-11 … lg:h-9` |
| i18n | `lib/i18n/dicionario.ts` | Duas chaves novas com espanhol ("Use o e-mail da sua conta", rodapé da fachada) — exigido por `i18n-espanhol-cobre-a-tela.test.ts` |

**Fora do Passo 2 (ficam para o Passo 3, item 4):** `components/inbox/*` (10 arquivos),
`components/kanban/*` (8), `components/connections/ConnectionsClient.tsx`. São trocas de classe do
mesmo tipo; o upstream mexeu muito neles (InboxLayout +300 linhas) e merecem passada própria com
o `git diff 48e51707..feat/deskcomm-chassis-import -- components/inbox components/kanban` ao lado.

---

## Passo 3 — backend próprio, pipeline e dívidas declaradas ✅ (2026-09-10)

Executado numa sessão só, com o host de volta à RAM cheia (restrição de `next dev` revogada pelo CTO).
O que cada item fechou e a prova, na ordem em que foi feito:

**Estado ao fim do passo (medido):**

| Frente | Resultado | Prova |
|---|---|---|
| 3.3 Migrations | `0144–0146` → `0232–0234` (timestamps `20260910120000/121000/122000`); apêndice no `baseline.sql` antes do bloco de varredura; 3 linhas + nota de renumeração no `MANIFEST.md`; `tests/invariants/convergencia-aios-contacts.test.ts` trazido. As 10 migrations AIOS sem número **não entram** (decisão registrada no MANIFEST: descrevem uma segunda `contacts` que a 0233 existe para encerrar; a 0232/0233 recriam tudo que o código consome) | `pnpm test:db` — ver linha abaixo |
| 3.2 Pipeline | `publish-image.yml` dispara em `master` (trigger, canal `latest`, trava de procedência `compare/master...`); `IMG_NS="ghcr.io/leo-lima92"` em `_common.sh`; defaults do `docker-compose.prod.yml` e `.env.hostgator.example`; testes `namespace-das-imagens` e `tag-so-nasce-da-main` recalibrados. Nomes de imagem mantidos (`deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler`) — o workflow publica `ghcr.io/<dono do repo>/<nome>`, então no fork nascem como `ghcr.io/leo-lima92/deskcommcrm` sem mexer na matriz | `vitest` nos 7 testes que leem o workflow: verde |
| 3.4 Reskin | 19 arquivos de `components/inbox` + `components/kanban` e `ConnectionsClient` mesclados por `git apply --3way` sobre o v1.17.0 (60 hunks em conflito resolvidos com a regra do Passo 2: upstream é a base, só classe muda). `lib/net/alcance.ts`, `lib/nuvemshop/*` e a spec `conexoes-transporte-inalcancavel` portados | `tsc` zerado, `eslint` 0 erros, spec verde |
| 3.1 Testes de marca | 18 falhas (não 20: `branding-rampa` já passava) recalibradas com número **medido** (script `medir-marca.ts`, 2026-09-10) e anotado ao lado | `branding-*.test.ts`: 92 passed, 1 skipped |
| 3.5 Tela | ver abaixo | capturas locais (ver abaixo) |

### 3.1 Recalibrar os 20 testes de marca (decisão 1 do CTO) ✅

Eram 18 na medição desta sessão (o `branding-rampa` já estava verde). Os números novos, todos medidos:
accent×bg 4,14 (era 5,51), accent-fg×accent 4,65 (o par mais apertado da paleta), 7 combos que
andam (eram 13 — sem o anel de foco na régua, quem só andava por ele para), 17 movimentos de
semântica (eram 23), separação do neutro 0,2354/0,1789 (era 0,0681/0,1994), alfa do soft 0,14. O
controle positivo da colisão saiu de "Sage×success com Δ=0°" para "vermillion×success e ×warning
sob dicromacia no claro (0,0395 e 0,0393 < 0,05)" — a paleta Orderful **nasce colidida no tema
claro**, dívida declarada. O ramo degradado ficou assimétrico e a matriz está fixada (4 de 6 combos
degradam; no escuro o soft translúcido dá contraste a qualquer chapada clara ou cinza).

Arquivos e o que cada um fixava na paleta Sage que saiu:

| Teste | Falhas | Natureza |
|---|---|---|
| `tests/unit/branding-contraste.test.ts` | 13 | `#506d48` na parada 6; razão 5,51:1 medida à mão; lista de 6 papéis (inclui `--ring`, `::selection`, `:focus-visible`, que no Orderful são tinta); alfa do soft 0,16 (nosso 0,14); 13 sementes que "andam"; controle positivo da colisão Sage×success; 23 semânticas reconciliadas; croma 0,0681 do acromático; ramo degradado ("L uniforme") que com 3 papéis passa a ter solução |
| `tests/unit/branding-pares-pintados.test.ts` | 4 | 13 sementes que andam; os "quatro números do anel de foco" (não existe mais papel de foco na régua); razões 3,79 e 10,77 da Sage |
| `tests/unit/branding-rampa.test.ts` | 1 (+1 skip) | "lê 11 stops" já aponta `#e42b0c`; a catraca `Δ ≤ 2` está `it.skip` por decisão 2 — **não reativar** |
| `tests/unit/branding-marca-css.test.ts` | 1 | "toda semântica deslocada vira motivo" espera >0 deslocamentos; na vermillion nenhuma semântica colide |

Regra para recalibrar: cada número novo tem de ser **medido** (rodar o teste, ler o valor, entender
por que mudou) e anotado ao lado, nunca copiado do "Received". Onde o teste vigiava um papel que
deixou de existir (foco/seleção), a asserção muda de forma, não de número.

Prova: `npx vitest run tests/unit/branding-*.test.ts --pool=forks --maxWorkers=1 --environment=node` verde.

### 3.2 Pipeline de imagem para o GHCR do CEO ✅ (parcial — a tag é do CEO)

O botão "Atualizar" da UI faz o host rodar `hostgator-setup-kit/update.sh`, que puxa
`${IMG_NS}/deskcommcrm:<tag>`. Antes `IMG_NS` era `ghcr.io/melgarafael` — instalava o frontend do
Rafael por cima do nosso.

- [x] `.github/workflows/publish-image.yml`: dispara em `master`; `latest` só de `master`; a trava
      `a-tag-veio-da-main` compara contra `master` (o `main` não existe no `origin`, e `compare/main...`
      daria 404 em todo push de tag).
- [x] `hostgator-setup-kit/_common.sh`: `IMG_NS="ghcr.io/leo-lima92"`. `update.sh` deriva de lá.
- [x] `docker-compose.prod.yml` (3 defaults) + `.env.hostgator.example` (3 pisos) — o `traefik.yml` não
      declara imagem nossa.
- [ ] **Publicar ao menos uma tag `v*` no `origin`** — hoje há ZERO (`git ls-remote --tags origin`). Sem
      tag, `agent.sh` reporta `has_known_release=false` e o botão nunca acende. O `release.yml` do
      upstream corta tag em push na `main` a partir de `.changes/`; no fork ele ainda diz `main`
      (`tests/unit/tag-so-nasce-da-main.test.ts:110` prende isso) — decisão do CEO: apontar o
      `release.yml` para `master` (mais o teste) ou cortar a primeira tag à mão.
- [ ] `REPO_URL` em `install.sh`/`comecar.sh`/`_common.sh` e o `org.opencontainers.image.source` dos
      Dockerfiles ainda apontam para `melgarafael/DeskcommCRM` (o teste `namespace-das-imagens`
      prende os dois). Só afeta instalação FRESCA pelo `comecar.sh`; o botão segue o `origin` do clone.

Prova pendente (precisa de push + CI): `gh api users/leo-lima92/packages?package_type=container`.

### 3.3 Renumerar as migrations 0144–0146 e trazer o schema AIOS ✅

O upstream já ocupava `0144`–`0146` (followup timing, dossiê, claim justo) e chegou a `0230`.

- [x] `20260813120000_0144_ponte_de_dados_aios.sql` → `20260910120000_0232_…`
- [x] `20260813180000_0145_convergencia_contacts_e_extracao.sql` → `20260910121000_0233_…`
- [x] `20260819120000_0146_execucao_converge_com_a_intencao.sql` → `20260910122000_0234_…`
      (conteúdo byte-a-byte, só as referências cruzadas `0144/0145/0146` renumeradas nos comentários)
- [x] As 10 migrations AIOS sem numeração **não entram** — nota no `MANIFEST.md` explica (colidem com o
      chassi; a 0232/0233 já recriam tudo que o código consome, `if not exists`).
- [x] Apêndice idempotente no `supabase/baseline.sql` (3 blocos, antes da varredura que tem de ser o
      último) + 3 linhas + nota de renumeração no `MANIFEST.md`.
- [x] `tests/invariants/convergencia-aios-contacts.test.ts` trazido (referências renumeradas). O
      `manifest-x-migrations.test.ts` do upstream já cobre; verde.
- [x] `EXECUTE` de `public, anon, authenticated` revogado nas duas funções (0233 + 0234). São
      `security invoker`, então ficam fora da varredura de definer.

Prova: `pnpm test:db` — install fresco com `ON_ERROR_STOP=1` e update no `pgvector/pgvector:pg15`
(o piso do CI) passaram na primeira rodada (log `scratchpad/test-db.log`, 12:50); invariantes: ver
linha de resultado abaixo. Install fresco ADICIONAL em **Postgres 17** (Supabase local
`supabase/postgres:17.6.1.084`, banco recém-criado, sem migrations): ver 3.5.

### 3.4 Reskin de inbox, kanban e conexões ✅

`components/inbox/*` (11 arquivos), `components/kanban/*` (8), `ConnectionsClient.tsx`,
`lib/net/alcance.ts` (contração "do/da"), `lib/nuvemshop/*` (prazo nos fetches) e a spec
`tests/unit/conexoes-transporte-inalcancavel.test.tsx`. **`lib/waha/client.ts` NÃO foi tocado**: o
upstream 1.17.0 já tem `fetchComTeto` (prazo configurável + erro que diz que foi o relógio), então o
nosso `fetchComPrazo` seria duplicação. Pelo mesmo motivo a rota `channel-sessions/[id]` ficou a do
upstream — ela agora **falha fechado** (502 `connection_status_failed`) quando o transporte não
responde, em vez de devolver o status do banco com `transport_reachable=false`. O `ConnectionsClient`
lê os dois sinais (rejeição 502 **ou** `transport_reachable === false`) e mostra o painel "último
estado conhecido" + selo sem cor.

O que o upstream trouxe e ficou (só a classe mudou): comando da conversa (`COR_DO_COMANDO` por
`quem`, não por status — os tons são do deck: aguardando=vermillion, ninguém=tinta, humano=ferro),
seleção em lote no kanban (checkbox no cabeçalho da etapa), ficha do contato em `Sheet` no celular,
filtros do inbox em uma linha, `t()` em todo texto. Duas correções de contraste que o `tailwind-tokens`
pegou: `text-text-on-carbon/60` na hora da bolha (no v4 o alfa PINTA) e um comentário que citava
`text-warning-fg/80`.

Prova: `tsc --noEmit` zerado; `eslint` 0 erros (16 avisos pré-existentes do upstream); `OwnerBadge.test`,
`conexoes-transporte-inalcancavel`, `i18n-espanhol-cobre-a-tela`, `tailwind-tokens` verdes.

**Resultado das provas de banco e de tela (2026-09-10, fim da sessão):**

- `baseline.sql` INSTALL fresco com `ON_ERROR_STOP=1` — **verde em pg15** (`pgvector/pgvector:pg15`,
  harness `scripts/test-db.sh`, 12:50) e **verde em pg17** (Supabase local `supabase/postgres:17.6.1.167`,
  banco recém-criado, 131 tabelas em `public`, `companies`/`deals`/`extraction_runs` presentes,
  grantees de `rpc_upsert_lead` e `fn_e164_or_null` = `{postgres, service_role}`). UPDATE
  (re-aplicação) verde em pg15 na mesma rodada.
- **Suíte de invariantes (`tests/invariants`) NÃO concluída.** Rodou 15 de ~50 arquivos e começou a
  reprovar por **timeout de 30 s** (casos levando 36–85 s), não por asserção: o host tinha 288–475 MB
  livres de 7,9 GB (medido com `Get-CimInstance Win32_OperatingSystem`), e o próprio harness do Claude
  matou `tsc`, `supabase start` e o `vitest` por falta de memória cinco vezes. Rodar `pnpm test:db`
  sozinho, com browsers fechados (≥3 GB livres) — é o único gate que falta e é obrigatório antes do PR.
- `tsc --noEmit` completo também não coube (OOM com heap de 1,5 GB; morto com 3 GB). Foi rodado um
  **recorte estrito** (tsconfig temporário incluindo todos os arquivos tocados + `types/**` +
  `tests/setup/vitest.setup.ts`, que puxa o grafo importado): **zero erros**. A primeira rodada
  completa desta sessão, antes das mortes por RAM, acusou só o erro de sintaxe do `StageColumn`, já
  corrigido.
- `tests/unit/lgpd-pdf-meet.test.ts` reprova 3 casos neste host por
  `Invalid factory url ... standard_fonts\ must include trailing slash` (caminho Windows do
  `pdfjs-dist`) — pré-existente e alheio à mudança (a edição foi acrescentar "Nexora" à lista de
  palavras que o PDF não pode conter).

### 3.5 Prova de tela ✅ (login → Inbox, Funis, Conexões e o board do funil)

Medido pelo Playwright em 1280×900, `next dev` na 3000, conta `ceo@nexora.local` criada pelo
`bootstrap-owner.ts` no banco fresco (onboarding pulado pelo atalho DEV):

| Tela | HTTP | Console/hidratação | Medidas (`getComputedStyle`) |
|---|---|---|---|
| `/login` | 200 | 0 erros | cartão Paper sobre Vellum, CTA vermillion (Sunset Flux) |
| `/app/inbox` | 200 | 0 erros | 3 painéis `border-radius 8px`, `bg #ffffff`, `column-gap 12px`; fonte `Archivo`; `--color-accent #e42b0c` |
| `/app/kanban` (Funis) | 200 | 0 erros | — |
| `/app/connections` | 200 | 0 erros | — |
| `/app/pipelines/<id>` (board) | 200 | 0 erros | 8 colunas; cabeçalho `uppercase / 0.3px / 12px / #4a5565` (eyebrow); coluna sem moldura (`bg transparent`); estado vazio `dashed 8px uppercase` |

Capturas `*.png` do Passo 3 guardadas só no disco do worktree, fora do versionamento (pasta de evidência local da sessão de 2026-09-10); para versioná-las, revise o conteúdo e mova para `evidence/passo-3-fusao-v117/`.
O shell mostra **"Nexora"** — o `DEFAULT_APP_NAME` do rebrand (`b6093a84`) não tinha vindo no Passo 2 e
foi portado aqui, com os 5 testes que prendem o nome recalibrados.

Receita usada: `supabase stop --no-backup` → `config.toml major_version = 17` (só local, revertido
antes do commit) → `supabase start` com `supabase/migrations` escondida → extensões → `baseline.sql`
com `ON_ERROR_STOP=1` → `docker restart supabase_realtime_deskcomm-crm` → `bootstrap-owner.ts` →
`next dev -p 3000`. Playwright: `/login`, `/app/inbox`, `/app/kanban`, `/app/connections`, console sem
erro/hidratação, medidas por `getComputedStyle`. Evidência nas capturas locais citadas acima. Backup do banco local anterior em
`scratchpad/nexora-local-antes-v117.dump` (5 usuários, 2 orgs, 0 contatos, 0 mensagens).

### ⚠️ Incidente desta sessão — bootstrap escreveu no Supabase de PRODUÇÃO

O `scripts/bootstrap-owner.ts` do upstream lê `.env` **antes** de `.env.local` (o inverso do Next).
Neste worktree o `.env` aponta para o projeto `mweesjdajcboegikxhwn.supabase.co` (produção) e o
`.env.local` para o Supabase local. A primeira rodada do bootstrap (2026-09-10, ~13:37) criou **na
nuvem**: usuário `ceo@nexora.local` (id `debf62cf-f64f-44f4-b9ca-d9a77d373c5e`), organização
"Nexora" (`26e6b905-818f-40a0-a671-0c0c4436caf2`), a associação como `admin` e a linha em
`platform_admins` — imprimindo "Bootstrap completo". É exatamente o modo de falha que o commit
`cb2f4144` da origem documenta; o fix (ordem `[".env.local", ".env"]`) foi portado neste passo.

**Pendente para o CEO (não executei — é produção):** apagar as quatro linhas acima na nuvem
(`auth.users`, `organizations`, `user_organizations`, `platform_admins`) ou, no mínimo, revogar o
super-admin. A senha desse usuário está registrada nesta sessão de trabalho.

### Próximos passos (fora do que esta sessão conseguiu fechar)

1. `pnpm test:db` completo num host com ≥3 GB livres (gate obrigatório do PR).
2. Limpeza das linhas criadas em produção (acima).
3. Decidir o corte de tag `v*` no fork (`release.yml` ainda olha `main`) e o `REPO_URL` do kit.
4. `pnpm test:unit` completo (566 arquivos) — só as suítes tocadas foram rodadas aqui, por memória.

### 3.6 Dívidas declaradas

- `--agenda-pessoa-1` (telha, ~8°) vizinha o matiz da vermillion — reavaliar as 8 trilhas da agenda.
- **A paleta Orderful nasce colidida no tema claro sob dicromacia:** `success` (#346538) e `warning`
  (#956400) medem 0,0395 e 0,0393 contra a vermillion 600 (piso 0,05). Efeito prático: qualquer marca
  de cliente acromática (que herda a rampa do produto) faz a reconciliação girar as duas. Fixado como
  controle positivo em `branding-contraste.test.ts`; quem redesenhar `success`/`warning` do claro
  precisa medir com `deltaESimulado`.
- `rampaDeSemente("#e42b0c")` não reproduz a rampa manual (400 derivado `#ff7a63` vs literal `#f2704e`):
  quem instalar com `APP_ACCENT_HEX=#e42b0c` recebe no escuro um accent mais claro que o do produto.
  Consequência da decisão 2 (rampa à mão); os dois pixels passam nos pisos.
- `app/api/v1/channel-sessions/[id]` falha fechado (502) sem transporte — o `transport_reachable` do
  nosso fix não existe mais na rota; a tela cobre os dois sinais, mas o teste da spec só exercita o
  campo. Cobrir o 502 na spec quando houver tempo.
- Classes shadcn legadas (`text-muted-foreground`, `bg-muted`, `text-primary`) seguem em arquivos que
  o reskin de origem nunca tocou (`ContactTagsEditor`, `ReassignDialog`, `RetentionNotice`, media/*);
  os aliases no `@theme` resolvem para tokens Orderful, então é dívida cosmética, não visual.
- `app/design/*` (vitrine) ainda fala em Sage/Atkinson; é interna e `noindex`, mas apodrece.
- `docs/design-system/02-palette-orderful.md` e `DESIGN_SYSTEM.md` precisam citar o v4 (`@theme`) no
  lugar do `tailwind.config.ts`.

---

## Como verificar o estado deste branch sem servidor

```bash
cd C:\dev\nexora-v117
npx tsc --noEmit | grep -v "^.next/"          # zero linhas = verde
npx eslint <arquivos tocados>
npx vitest run tests/unit/tailwind-tokens.test.ts tests/unit/branding-tema-claro-escopavel.test.ts \
  tests/unit/contraste-acao-wcag.test.ts tests/unit/branding-regua-do-produto.test.ts \
  tests/unit/i18n-espanhol-cobre-a-tela.test.ts --pool=forks --maxWorkers=1 --environment=node
```

`--pool=forks --maxWorkers=1` porque o host tem ~450 MB livres; sem isso o worker do vitest nem sobe.

---

## Sincronização com o upstream v1.80.0 (2026-10-14) — branch `feat/sync-deskcomm-v1.80.0`

Decisão do CEO: **Opção 1** (merge da TAG `v1.80.0` + escudo), com filtro de produto. Merge
`2dadc73b8` sobre `24b14292`. 7.707 commits, 63 releases, 269 migrations novas do upstream.

| Escudo | O que foi feito | Prova |
|---|---|---|
| Infra (`.env*`, `.claude/`) | 81 mudanças do upstream descartadas (47 adições, 28 remoções, 6 edições); linhas JEV do `.gitignore` reaplicadas fora do commit | `git diff 24b14292 HEAD -- .claude '.env*'` vazio |
| Visual | 33 conflitos: cor/tipo/forma do Nexora; comportamento do upstream por baixo (filtro multi-etiqueta, setas de abas, selo de canal, autoria da mensagem, logo escuro, Google login, cabeçalho de etapa preso, total por moeda, alvo 44px, fonte 16px no iPhone) | `tsc` recortado 0 erros (sabotagem pega) · eslint 0 erros |
| Identidade | `master` no `publish-image.yml`, `IMG_NS=ghcr.io/leo-lima92`, âncora em `tests/unit/_identidade-deste-repo.ts` | — |
| Produto | espanhol oculto em `IDIOMAS_OFERECIDOS_NESTA_DISTRIBUICAO` (`lib/i18n/registro.ts`); galeria de follow-up só-clínica oculta (`NICHOS_OFERECIDOS_NA_GALERIA`); módulos de nicho já nascem desligados | gates de idioma/follow-up 130/130 |

**Banco.** Os números 0232–0234 passaram a ser do upstream; as do fork viraram **9001–9003**
(mesmos timestamps; faixa 9xxx reservada ao fork). O upstream criou na 0448 uma `companies`
incompatível com a nossa (AIOS) — a **9004** (ts `20260928131500`, logo antes da 0448) converge a
nossa na dele; a 9001 ganhou guarda de forma. No `baseline.sql` os quatro blocos ficam
imediatamente antes do bloco da 0448. Prova em PGlite (Postgres WASM — sem Docker por RAM):

```
install fresco ............ 4900 comandos OK · reaplicação (update) OK
banco do fork antigo + 2 empresas AIOS → update → update: OK, dados preservados
  (Padaria Legada: trade_name, google_place_id gp-1, main_cnae_code 1091-1/02, tags {aios})
sabotagem (blocos do fork no fim, sem 9004): install MORRE em "column google_place_id does not exist"
```

**Pendências**

1. `pnpm test:db` oficial (Docker pg15) — não rodou: Docker Desktop parado e ~600 MB livres.
2. Hono do AIOS (`C:\dev\nexora\src`, 4 arquivos) escrever `organization_id`/`trade_name` em `companies`.
3. `REPO_URL` do kit ainda clona `melgarafael/DeskcommCRM` → `tests/unit/namespace-das-imagens.test.ts` vermelho (decidir qual repositório o instalador clona).
4. `deals`/`linkedin_threads`/`extraction_runs` (chave `org_id`) ficam fora das travas `support_write_*` do modo suporte do upstream.
5. Prova pela tela (Playwright) das telas resolvidas — MCP do Playwright não conectou e o host não comporta `next build` + Supabase.
6. Fontes: o upstream vendorizou as fontes (build não depende do Google); o Nexora mantém Archivo via `next/font/google`.

⚠️ A receita "tsc + `grep -v ^.next/`" acima é um falso verde quando `.next/dev/types/routes.d.ts`
está velho: erro de sintaxe ali desliga a checagem semântica. Use um tsconfig sem `next-env.d.ts`.

### ⏸️ Sessão pausada pelo CEO (2026-10-14)

Pausada pelo CEO enquanto a suíte unitária completa (`vitest run`, 1 worker) rodava; a suíte foi
**abortada** (processos encerrados) antes do resumo final — não há número total medido.

- O merge está salvo em commit local: `2dadc73b8` (merge v1.80.0) + `272fea5c7` (gates do baseline).
  Nada foi enviado (`git push` não rodou).
- O commit WIP seguinte guarda o que estava em curso: o desenho da marca do upstream (símbolo/
  logotipo **DeskcommCRM**, que aparecia na barra lateral, no admin, no onboarding, no favicon e no
  ícone do app quando a marca é a padrão "Nexora") foi trocado pelo símbolo do Nexora
  (`lib/branding/desenho.ts`, `components/branding/MarcaDoProduto.tsx`, `app/icon.tsx`,
  `lib/branding/icone-do-app.tsx`); o chip `dark:bg-white` do logo voltou à tela de entrada; o
  fragmento `.changes` ganhou o bloco `## Requer atenção`. `marca-do-produto.test.tsx` ainda não
  foi revalidado (a última rodada deu timeout por contenção com a suíte).

**Retomar por aqui:**
1. Rodar `npx vitest run --pool=forks --maxWorkers=1 tests/unit/marca-do-produto.test.tsx tests/unit/logo-nao-some-no-tema-escuro.test.ts` e a régua `min-w-0` (`tests/unit/inbox-texto-longo-nao-empurra-a-coluna.test.ts` pede `h-full min-h-0 min-w-0 flex-col md:flex` em sequência — reordenar as classes do `InboxLayout`).
2. Trocar o corte do espanhol para "só interface": a lista oferecida alimenta seletores e
   `parseAcceptLanguage`, e `IDIOMAS_VISIVEIS` volta ao do upstream — elimina 8 falhas de testes
   do upstream que dependem de `es` servido a quem o gravou. Reajustar os 3 testes de idioma já
   adaptados e o texto do fragmento.
3. Falhas já classificadas como AMBIENTE (Windows/RAM/sem Docker/rede): timeouts de 15 s, barra
   invertida em caminhos, scripts git/bash, Postgres, Redis, LP. Como ESCUDO (decisão do CEO):
   skills/`settings.json` de `.claude/`, documentação do `.env.example`, workflows em `master`.
4. Pendências anteriores desta seção seguem valendo (test:db oficial, Hono do AIOS, `REPO_URL`).

### ▶️ Fase 2 retomada e fechada (2026-10-19)

Docker Desktop no ar (VM de 3,7 GB) e ~1,2–1,4 GB livres no host. Um processo pesado por vez.

| Pendência | O que foi feito | Prova |
|---|---|---|
| Testes de marca e régua `min-w-0` | `marca-do-produto` e `logo-nao-some-no-tema-escuro` já verdes; classes da coluna da conversa do `InboxLayout` reordenadas (`h-full min-h-0 min-w-0 flex-col md:flex …`) | 21/21 |
| Espanhol "só interface" | O corte saiu de `IDIOMAS_VISIVEIS` (voltou ao upstream) e mora em `IDIOMAS_OFERECIDOS` (`lib/i18n/registro.ts`): seletores e `Accept-Language` leem a oferta; quem já gravou `es` continua servido em `es`, e o seletor mostra as duas opções para a pessoa poder voltar (`idiomasParaEscolher`) | 20 arquivos de idioma, 164/164; sabotagem do `idiomasParaEscolher` pega |
| `REPO_URL` do kit | Instalador clona `github.com/leo-lima92/nexora` (público, branch `master`): `install.sh`, `comecar.sh`, `_common.sh`, `diagnostico.sh`, README/CLAUDE do kit, `ubuntu-local-installer.sh` e os labels `image.source` das 4 imagens. Nome do repositório entra na âncora como `NOME_DESTE_REPO`; o dono continua derivado do `IMG_NS` | `namespace-das-imagens*` 17/17 |
| Hono do AIOS | Worktree próprio `C:\dev\nexora-hono-9004`, branch `feat/hono-companies-canonica` (a partir de `feat/deskcomm-chassis-import`), commit `ba6958291`: mapper do Google Maps, consulta de conversões e os 2 smokes escrevem `organization_id`/`trade_name`; tipos de `companies` na forma convergida. Parâmetro HTTP `org_id`, `rpc_upsert_lead` e `extraction_runs` não mudam | `tsc -p tsconfig.hono.json` 0 erros (antes: 15 erros, todos em `companies`) |
| `pnpm test:db` oficial | Rodou pela primeira vez (pg15). A 1ª rodada achou **9 casos vermelhos em 4 arquivos, todos do fork**; consertados (abaixo) | ver "Rodada final" |

**O que o `test:db` achou e como fechou**

1. `platform-admin-full-so-escreve` (CONTA GLOBAL) e `rbac-config-ia-canais` (policy ALL só-tenancy): as `tenant_isolation_<t>_all` de `deals`, `linkedin_threads` e `extraction_runs` aceitavam `fn_is_platform_admin()` puro e qualquer membro. **Migration 9005** + apêndice: o par `_read` (pura, SELECT) / `_write` (`_full` ou membro `agent`+), desenho da 0533 do upstream. Era a pendência nº 4 desta seção.
   - Em SQL **estático**: na primeira versão (`execute format`) a conferência do `update.sh` não via o drop da `_all` e **parava a atualização com o CRM fora do ar** nas três versões do script.
   - O baseline deixou de criar a `_all` nos blocos 9001/9002 (cerca `baseline-nao-constroi-o-que-derruba`); as migrations da cadeia ficaram intocadas.
2. `lgpd-redact-unificado-alcanca-pelo-catalogo`: `linkedin_threads` (FK para `contacts`) sem decisão → `manter` (ids, contagem, sentimento; sem texto da pessoa — mesmo precedente do `gclid`).
3. `convergencia-aios-contacts` (o invariante do próprio fork, escrito contra o PGlite): `bool::text` é `true`/`false` no Postgres, e o caso do `trade_name` caía na armadilha de snapshot que o próprio arquivo documenta. Corrigido, mais 4 casos da 9005 (viewer lê e não escreve; admin escreve) — sabotagem da exigência de papel pega.

**Como rodar o `test:db` neste fork:** o script consulta a "última release publicada" pelo `origin`, e o fork ainda não tem release — sem isso ele reprova antes da suíte. Até haver release própria:

```bash
CONFERENCIA_KIT_RELEASE=v1.80.0 PATH="$PWD/node_modules/.bin:$PATH" bash scripts/test-db.sh
```

(`pnpm` não está instalado neste host; o `PATH` acima é exatamente o que o `pnpm test:db` faz.)

**Falhas unitárias preexistentes, provadas no `HEAD` limpo** (worktree de controle, mesmas 6, idênticas): `atualizacao-confere-regras-de-isolamento` (2 timeouts de 15 s), `executor-proprio-so-roda-o-que-e-nosso` (1), `instalador-consentimento-telemetria` (2 — `.env.hostgator.example` sob o escudo do `.env*`), `react-pdf-resolve-sob-tsx` (1). Não são desta sessão.

**Rodada final do `test:db` (estado commitado, `66088ec2f`)**

| Passada | Resultado |
|---|---|
| baseline install (`ON_ERROR_STOP=1`) + update (reaplicação, `ON_ERROR_STOP=1`) | ✓ |
| conferência de isolamento do `update.sh` (checkout, v1.80.0, v1.63.0) | ✓ 172/172 regras nas três |
| invariantes (438 arquivos, ordem sorteada) | 437/438 · 3.476 casos ✓ · 3 `Test timed out in 30000ms` em `webhooks-inbound.test.ts` com o host a ~770 MB livres; **o arquivo isolado: 38/38 ✓**. Na rodada completa anterior (mesmo schema final, antes da limpeza das `_all` no baseline) foram 438/438 e 3.479 casos ✓ |
| `test:db:update` (atualização sobre banco com dados) | ✓ |

Unitários dos arquivos tocados: tipos do recorte 0 erros (sabotagem pega); eslint 0 erros; migration/baseline 23 arquivos ✓; kit 54/58 — os 4 vermelhos são as 6 falhas preexistentes acima; idioma, marca, Inbox, namespace e fragmento ✓. Os testes da guarda de release (`guarda-da-release-*`) reprovam aqui por montarem repositórios git via bash no Windows; não leem nada que esta sessão mudou, mas **não** foram medidos no `HEAD` limpo.

**Para a Fase 3**

1. Corte de release/tag própria do fork (`release.yml` olha `main`; o `update.sh` e o `test:db` procuram a "última release" no `origin`, que não tem nenhuma).
2. Deploy coordenado: a atualização do banco que aplica a 9004/9005 e o Hono de `feat/hono-companies-canonica` vão juntos — o Hono antigo grava `org_id`/`name`, que deixam de existir em `companies`.
3. Prova pela tela (Playwright) do seletor de idioma e das telas resolvidas — o MCP do Playwright não conectou nesta sessão.
4. Suíte unitária completa (`vitest run` inteiro) nunca terminou nesta máquina; e as 6 falhas preexistentes.
5. Limpeza das linhas criadas por engano no Supabase de produção (incidente do Passo 3) — decisão do CEO.
6. O instalador ainda oferece `es` como idioma da CLI (`_i18n.sh`) — fora do corte "só interface".

---

## Sincronização com o upstream v1.94.0 (2026-10-28) — mesma branch

Merge da TAG `v1.94.0` (`ba24d4d36`, 27/10) sobre `0193d377c`: 3.335 commits, 14 releases
(1.81–1.94), 94 migrations novas, 3.118 arquivos. Mesma receita da v1.80.0. 38 conflitos.

| Regra | O que foi feito |
|---|---|
| Escudo `.claude/` e `.env*` | 15 adições e 10 edições do upstream em `.claude/skills/` descartadas (as 10 eram arquivos que o Nexora já tinha apagado); `.env.example`/`.env.hostgator.example` do HEAD. Variáveis novas do upstream NÃO documentadas aqui: `IP_DO_CLIENTE_HEADER`, `PROSPECTING_LOCAL_HTTP_URL` (`.env.example`); `CLOUDFLARE_TUNNEL_TOKEN`, `SHUTDOWN_GRACE_MS`, `WORKER_STOP_GRACE_PERIOD` (`.env.hostgator.example`); `CODEX_CLIENT_VERSION` saiu. Linhas JEV do `.gitignore` reaplicadas fora do commit |
| Visual (25 arquivos) | Cor/tipo/forma do Nexora; comportamento do upstream por baixo: alvos de toque 44px (`pointer-coarse:min-h-11`, `size="icon"`), fonte 16px no iPhone (Composer, busca, nota do CRM), faixas do topo (`--faixas-de-cima`) em AppShell/TopBar/Sidebar/Inbox, seleção em lote na lista de conversas (wrapper + botão), painel do contato recolhível (#3004), selo "Fornecedor", tarefas no card do Kanban, mensagem apagada em neutro, convite que atravessa login/cadastro, aviso "sem resposta" no login. O botão Recolher da Sidebar mudou de lugar (alto) e foi pintado no Nexora. `StageColumn`: cabeçalho do Nexora (sem cartão), a correção de borda #3030 não se aplica |
| Banco | `baseline.sql`: bloco 9005 do fork + 17 blocos novos do upstream, só acréscimo (vs. v1.94.0: +979, −0). **O upstream passou a usar a faixa 9xxx** (9016, 9017, 9020, 9021 na tag; 9024, 9025 na `main`): sem colisão hoje (fork = 9001–9005), mas a faixa deixou de ser exclusiva |
| Identidade | `IMG_NS=ghcr.io/leo-lima92`, `REPO_URL` do kit e `master` no `publish-image.yml` intactos. `melgarafael` novo só em docs/evidence/CHANGELOG. `VOICE_AGENT_IMAGE` segue `ghcr.io/melgarafael/…` (já era assim no HEAD) |
| SaaS/cobrança | Absorvido integralmente (Asaas/Stripe, plano padrão, troca proporcional, link de pagamento). Módulo `cobranca` nasce desligado |
| Curso visual / PWA | `curso/` (165 arquivos, ferramenta de captura e montagem; o site publicado é do upstream) e `app/manifest.ts` + `public/notify-sw.js` absorvidos. O manifest usa `marcaDaSaida` e `REGUA_DO_PRODUTO` → nome, ícone e cor do Nexora. A skill `deskcomm-curso` entrou só em `.agents/` (escudo) |
| Webhook de entrada | `app/api/v1/webhooks/in/[token]` absorvido (+572). **Contrato:** `stage` virou campo reservado (move o card de etapa, sai do mapeamento). Reaproveitar/atualizar card são opções da fonte, desligadas por padrão. Ponte AIOS (`rpc_upsert_lead`, 9001–9005): nenhuma migration nova toca `companies`/`deals`/`linkedin_threads`/`extraction_runs`; em `contacts` só colunas novas com default |
| ChatGPT por sessão | Nada a reverter: o `login_codex` nasce desligado, falha fechada, só o admin do servidor liga; o upstream trocou o backend do Codex pela API oficial `api.openai.com` (Sign in with ChatGPT) e não o torna padrão em lugar nenhum |

**Validação (host com 0,9–1,1 GB livres; um processo pesado por vez)**

| Verificação | Resultado |
|---|---|
| `tsc` do repo inteiro | **OOM** no heap de 4 GB após 13 min (não é erro de tipo). Rodado em 6 fatias (app · components/hooks/workers/curso/resto · lib · tests/unit a–k · l–z · demais testes), cada uma com um erro proposital: **0 erros reais**, sabotagem pega nas 6. Os 9 avisos de "tipos do Node" em `tests/setup` eram artefato da fatia (shim fora do repo); com o shim dentro do repo, 0 |
| `eslint .` | **Não terminou**: o Claude Code o encerrou por memória crítica do sistema. Nos 31 arquivos tocados: 0 erros, 8 avisos (todos em código vindo do upstream) |
| `next build` | **Não rodou** (não cabe na RAM livre ao lado do resto) |
| Gates de migration/baseline/identidade (10 arquivos) | 85/85 (o `namespace-das-imagens` precisou de `--testTimeout=180000`: varredura do repo leva 23 s no Windows) |
| Marca, idioma, tokens, Inbox (44 arquivos) + componentes resolvidos (121 arquivos) | 7 testes NOVOS do upstream contradiziam decisões do fork e foram adaptados no padrão `ES_SERVIDO`/`COM_GALERIA` da Fase 2: `branding-app-manifest`, `i18n-turco-em-construcao`, `fachada-segue-o-idioma-do-visitante` (+1 caso: perfil `es` gravado), `telas-de-acesso-sem-texto-cru` (espanhol fora da oferta); `textos-fora-da-traducao-nas-sequencias` (galeria não oferecida); `selecionada-legivel-no-escuro` (seleção do Nexora em `surface-elevated` + borda em tinta, com contraste medido nos dois temas — sabotagem `bg-accent-50` pega). Os testes de idioma passam também com `es` reoferecido (os dois ramos medidos) |
| Falha preexistente | `login-usa-marca-da-instalacao`: o login do Nexora já dizia "Use o e-mail da sua conta {marca}." no HEAD; o teste espera a marca sozinha no `<p>` |
| `release:conferir` | 4 fragmentos válidos → 1.95.0 |

**Para a Fase 3 (somam às de cima):** `eslint .` e `next build` completos (CI ou máquina com RAM);
suíte unitária inteira; decidir uma faixa nova para as migrations do fork (o upstream entrou na
9xxx); documentar no `.env*` as 5 variáveis novas do upstream (decisão do escudo); `VOICE_AGENT_IMAGE`
ainda aponta para o GHCR do upstream; avisar o time do AIOS Python sobre o `stage` reservado.
