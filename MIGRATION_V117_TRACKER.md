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

## Passo 3 — backend próprio, pipeline e dívidas declaradas ⏳

Ordem sugerida. Cada item tem a prova que fecha.

### 3.1 Recalibrar os 20 testes de marca (decisão 1 do CTO)

Arquivos e o que cada um fixa na paleta Sage que saiu:

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

### 3.2 Pipeline de imagem para o GHCR do CEO

Hoje o botão "Atualizar" da UI faz o host rodar `hostgator-setup-kit/update.sh`, que puxa
`ghcr.io/melgarafael/deskcommcrm:<tag>` (hardcoded, linha `IMG_NS="ghcr.io/melgarafael"` em
`_common.sh`) — ou seja, instala o frontend do Rafael por cima do nosso.

- [ ] `.github/workflows/publish-image.yml`: disparar em `master` (nosso branch padrão) além de `main`/`v*`.
- [ ] `hostgator-setup-kit/_common.sh` e `update.sh`: `IMG_NS` → `ghcr.io/leo-lima92` (imagens `nexora`, worker, scheduler).
- [ ] Publicar ao menos uma tag `v*` no `origin` — sem tag, `agent.sh` reporta `has_known_release=false` e o botão nunca acende.
- [ ] `docker-compose.prod.yml` + `docker-compose.traefik.yml`: conferir nomes de imagem.

Prova: `gh api users/leo-lima92/packages?package_type=container` lista as imagens; `update.sh --to vX` num
container descartável puxa a nossa.

### 3.3 Renumerar as migrations 0144–0146 e trazer o schema AIOS

O upstream já ocupa `0144`–`0146` (followup timing, dossiê, claim justo) e vai até `0231`.

- [ ] `20260813120000_0144_ponte_de_dados_aios.sql` → `0232`
- [ ] `20260813180000_0145_convergencia_contacts_e_extracao.sql` → `0233`
- [ ] `20260819120000_0146_execucao_converge_com_a_intencao.sql` → `0234`
- [ ] As 10 migrations AIOS sem numeração (`initial_schema`, `linkedin_schema`, `fix_rls_security`,
      `extraction_runs`, `tracking_columns`, `tenancy_shim_platform_base`, `closed_loop_tracking`,
      `rpc_upsert_lead` ×2, `ai_studio_schema`): decidir se entram numeradas (0235+) ou como apêndice único.
- [ ] Apêndice idempotente no `supabase/baseline.sql` + linhas no `MANIFEST.md` (tripla obrigatória).
- [ ] `tests/invariants/convergencia-aios-contacts.test.ts`, `tests/unit/manifest-x-migrations.test.ts`
      trazidos junto. Revogar `EXECUTE` de `public, anon` em toda função nova (issue #128).

Prova: `pnpm test:db` (install fresh com `ON_ERROR_STOP=1` + update) verde.

### 3.4 Reskin de inbox, kanban e conexões

`components/inbox/*`, `components/kanban/*`, `components/connections/ConnectionsClient.tsx` + o fix de
timeout do WAHA (`lib/waha/client.ts`, `lib/net/alcance.ts`) e `lib/nuvemshop/*`. Mesma regra do Passo 2.
Prova: `tsc`, `eslint`, e a spec `tests/unit/conexoes-transporte-inalcancavel.test.tsx` portada.

### 3.5 Prova de tela (quando houver RAM)

`next build && next start`, Playwright em `/login` (light/dark), `/app` logado, `/app/connections`.
Evidência em `.superpowers/evidence/`. Checklist §12 do `docs/DESIGN_SYSTEM.md` respondido.

### 3.6 Dívidas declaradas

- `--agenda-pessoa-1` (telha, ~8°) vizinha o matiz da vermillion — reavaliar as 8 trilhas da agenda.
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
