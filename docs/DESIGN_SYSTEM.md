# DESIGN_SYSTEM.md — Nexora

> **Lei de gosto do Nexora.** Este arquivo é a **autoridade final sobre decisão visual**: o que é permitido, o que é proibido e como resolver empate.
> Destilado da **Taste Skill** (`minimalist-skill` + `imagegen-frontend-web`, absorvidas em 2026-08-25) e reconciliado com o design system herdado do chassi DeskcommCRM.
>
> **Regra de ativação (não negociável):** sempre que o comando `/design` for usado, ou qualquer interface for criada/alterada (tela, componente, landing, e-mail, mock, imagem de referência), este arquivo **DEVE** ser lido antes da primeira linha de markup e aplicado **estritamente**.

---

## 0. Precedência — quem ganha quando dois documentos discordam

O Nexora tem duas fontes de verdade visual. Elas cobrem camadas diferentes e **não competem**:

| Camada | Fonte de verdade | Autoridade |
|---|---|---|
| **Tokens concretos** — paleta, escala tipográfica, spacing, radius, motion durations | `app/design/lib/tokens.ts` + `docs/design-system/01…09` | **Vence sempre.** Nenhum hex desta doutrina substitui um token existente. |
| **Gosto e composição** — hierarquia, whitespace macro, ritmo de seção, anti-slop, escolha de layout, direção de imagem | **este arquivo** | **Vence sempre.** Componente que passa nos tokens mas cheira a AI slop está reprovado. |

Empate real (raríssimo): prevalece a decisão mais **restritiva**. Menos cor, menos efeito, mais whitespace.

Os detalhes vivem em `docs/design-system/`:
`00-overview` · `01-foundation-tokens` · `02-palette-sage` · `03-typography` · `04-density-aerada` · `05-iconography-phosphor` · `06-components` · `07-motion-language` · `08-voice-and-tone` · `09-anti-patterns`.
Este arquivo é o portão; aqueles são a especificação.

---

## 1. Os cinco princípios canônicos

Tiebreaker quando duas soluções parecem igualmente boas:

1. **Clareza > decoração.** Elemento que não comunica, sai. Sombra decorativa, gradiente, ícone que repete o label — fora.
2. **Calma > vibração.** Saturação alta cansa. Contraste calibrado lê melhor que contraste máximo. Nenhum accent passa do stop 600 em área grande.
3. **Consistência > novidade.** Uma escolha boa repetida 100 vezes vale mais que 100 escolhas únicas. Variants são finitos e nomeados.
4. **Acessibilidade > estética.** WCAG AA é piso, não teto. Focus ring 2px sempre visível. Nada comunica só por cor.
5. **Densidade intencional.** Aerada é default; comprimir só quando o dado justifica (tabela). Whitespace não é desperdício — é respiração.

E o princípio zero, herdado da Taste Skill:
**Nunca aceite a primeira solução óbvia de layout.** O primeiro rascunho do modelo é quase sempre o padrão saturado. Rejeite-o conscientemente antes de escrever código.

---

## 2. Restrições negativas absolutas (BANIDO)

Isto não é preferência. É proibição. Código que viola qualquer item abaixo é reprovado em review.

### 2.1 Tipografia
- ❌ **Inter, Roboto, Open Sans, Geist Sans, Space Grotesk** ou qualquer default Vercel/Tailwind. Saturação de mercado = diluição de marca.
- ❌ Texto do corpo em preto absoluto `#000000`.
- ❌ Headline com gradiente ("gradient text") como atalho para "premium".
- ❌ `font-black`/extra-bold gritando em toda parte; caixa-alta preguiçosa em bloco de texto.
- ❌ Heading de 6 linhas com subcopy minúscula embaixo.
- ❌ Mais de dois "humores" tipográficos na mesma página.

### 2.2 Cor e efeito
- ❌ **Gradiente roxo→azul, rosa→laranja, mesh/rainbow, neon, glow halo.** É a assinatura visual do "AI SaaS 2024". Datado.
- ❌ Glassmorphism empilhado (exceto blur sutil de navbar/topbar).
- ❌ Fundo de cor primária em área grande (hero azul, seção verde chapada).
- ❌ Sombras pesadas do Tailwind — `shadow-md`, `shadow-lg`, `shadow-xl`. Sombra é ultra-difusa e com opacidade `< 0.05`, ou não existe.
- ❌ Cor como único portador de significado (falha de acessibilidade).

### 2.3 Iconografia e ilustração
- ❌ **Lucide, Feather, Heroicons** — previsíveis, usados por ~80% do mercado.
- ❌ **Emoji** em código, markup, headings, labels, alt text, copy de UI. Substitua por ícone ou primitiva SVG limpa.
- ❌ Blobs flutuantes, orbes, esferas 3D, "partículas de IA", números gigantes em outline como enfeite.
- ❌ Ícone que só repete a palavra ao lado dele.

### 2.4 Forma
- ❌ `rounded-full` em container grande, card ou botão primário. Pílula é para tag/badge/avatar, e só.
- ❌ Border-radius acima de `12px` em card. Crispness importa.
- ❌ Borda que não seja hairline de 1px do token de border.

### 2.5 Conteúdo e copy ("AI slop textual")
- ❌ Clichês: *Elevate, Unleash, Seamless, Next-Gen, Revolutionize, Transformative, Game-changer, Powerful solution, Delve*. Em pt-BR valem os equivalentes: *"eleve", "potencialize", "sem esforço", "revolucione", "solução completa", "nova geração"*.
- ❌ Placeholder genérico: *John Doe, Acme, Lorem Ipsum, Nexus, NovaCore, Quantumly, FlowBit*. Use conteúdo realista e contextual do domínio (nomes brasileiros plausíveis, produtos reais do funil, valores em BRL).
- ❌ KPI inventado: três colunas idênticas de "99% de satisfação / +300% de ROI / escala infinita" quando ninguém pediu métrica.
- ❌ Faixa "confiado por" com seis logos borrados e ilegíveis.

### 2.6 Layout ("AI slop estrutural")
- ❌ **Hero text-left / image-right como reflexo.** É o padrão de IA mais saturado que existe. Permitido só quando for comprovadamente a melhor escolha — nunca como ponto de partida.
- ❌ Seções centralizadas infinitas, uma atrás da outra.
- ❌ A mesma fileira de 3 cards repetida bloco após bloco.
- ❌ Simetria perfeita e sem vida em toda a página.
- ❌ Densidade sufocante: espaçamento apertado entre seções majoritárias, tentativa de preencher todo espaço vazio.
- ❌ Complexidade falsa: muitos elementos, nenhuma hierarquia.

---

## 3. Tipografia — execução

Fonte canônica do Nexora: **Atkinson Hyperlegible** (display + body) e **IBM Plex Mono** (dados, código, timestamps, IDs).
Escolha justificada em `docs/design-system/03-typography.md` — a Atkinson desambigua `0/O`, `1/l/I`, `rn/m`, `B/8`, crítico num CRM onde se lê código de pedido e ID de campanha o dia inteiro.

Se um contexto **editorial/marketing** exigir serifa de display (landing page, deck, OG card), o par permitido é `Instrument Serif` / `Newsreader` / `Lyon Text` — nunca Playfair banalizada em peso pesado, e **nunca** dentro do produto operacional.

Regras de execução:

- **Contraste de escala é a hierarquia principal.** Peso e tamanho, não cor, não caixa.
- **Tracking negativo em display:** `-0.02em` a `-0.04em`. Line-height `1.1` em headline; `1.6` em corpo longo.
- **H1 lê como declaração:** 5–10 palavras fortes. Nunca parágrafo.
- Corpo nunca em `#000`; use o token `--ds-text` (`#1c1a16` no light).
- Texto secundário sempre no token muted, nunca opacidade arbitrária.
- Largura de leitura travada em `max-w-4xl`/`max-w-5xl` para conteúdo tipográfico corrido.
- Dado numérico (valor, contagem, ID, data) em mono tabular. Números que se alinham em coluna são requisito, não estética.
- Label/caption/eyebrow: `text-xs`, caixa-alta permitida **aqui**, com `letter-spacing: 0.05em`.

---

## 4. Cor — disciplina

**Cor é recurso escasso.** Ela existe para carregar significado semântico ou para um acento pontual. Nunca para decorar.

Paleta do produto: **Sage** (verde-erva dessaturado) sobre neutros **greige** warm — não slate, não zinc. Stops e usos prescritos em `docs/design-system/02-palette-sage.md`; valores vivos em `app/design/lib/tokens.ts`.

Formato canônico da paleta de qualquer superfície nova (landing, e-mail, deck):

- 1 **primário** (âncora de marca) — Sage `accent-500`
- 1 **secundário** (tom de apoio)
- 1 **accent** usado com parcimônia, para CTA/destaque
- 1 **escala neutra** — background, surface, text, hairline

Regras:

- **Nunca puro `#fff` nem puro `#000` como fundo de página.** Offwhite warm no light, very-dark warm no dark.
- Borda estrutural é hairline de **1px** no token de border — sem exceção, sem borda de 2px "para destacar".
- Superfícies novas herdam o mesmo par de temas; light e dark são **desenhados independentemente**, nunca um é a inversão do outro.
- Mudança de humor entre seções reusa a mesma paleta. Nada de trocar de tema por seção.
- Estado semântico (sucesso/atenção/erro) usa pastel dessaturado com texto escuro do mesmo matiz, no padrão da tabela abaixo — e **sempre** acompanhado de texto ou ícone, nunca só cor.

| Estado | Fundo | Texto |
|---|---|---|
| Erro / crítico | `#FDEBEC` | `#9F2F2D` |
| Informação | `#E1F3FE` | `#1F6C9F` |
| Sucesso | `#EDF3EC` | `#346538` |
| Atenção | `#FBF3DB` | `#956400` |

> Estes pastéis são o **contrato de estado semântico**. Onde `tokens.ts` já define equivalentes, os tokens vencem (§0).

### Gradiente — permitido, mas com coleira

Gradiente **não** é banido por natureza; o gradiente *preguiçoso* é. Aceito quando profissional e sutil:

- Tonal de baixa croma casado com a paleta (tinta→grafite, creme→areia)
- Grade atmosférica de matiz único atrás de fotografia
- Vinheta suave / profundidade radial que dirige o olho
- Gradiente com micro-ruído para profundidade tátil

Proibido: tudo listado em §2.2.

Dentro do **produto operacional** (inbox, kanban, tabelas, formulários) a resposta padrão continua sendo: **sem gradiente.** Profundidade vem de borda + sombra neutra.

---

## 5. Iconografia e imagem

- **Ícones:** `@phosphor-icons/react`, peso `duotone` como default e `regular` em contexto denso (sidebar). Stroke width padronizado em todo o set. Nunca misturar famílias.
- **Ilustração:** monocromática, traço contínuo tipo tinta, sobre fundo claro, com **uma** forma geométrica deslocada preenchida em pastel dessaturado. Nada de ilustração corporativa 3D.
- **Fotografia:** dessaturada, tom warm, casada tonalmente com a paleta. Overlay sutil (grão warm, `opacity ≈ 0.04`) para integrar ao monocromático. Nunca stock supersaturado, nunca "equipe sorrindo em escritório branco".
- Sobre imagem full-bleed, **overlay obrigatório** até o texto ficar plenamente legível — o accent de marca não muda por causa da foto.
- **Placeholder permitido enquanto não há asset real:** `https://picsum.photos/seed/{contexto}/1200/800`.
- Imagem tem papel estrutural ou não entra. Thumbnail decorativo minúsculo: fora.
- Seção não precisa ser um retângulo branco vazio: profundidade pode vir de imagem de fundo em opacidade baixíssima, spot radial warm em `opacity ≈ 0.03`, ou padrão geométrico mínimo — nunca de efeito colorido.

---

## 6. Componentes — especificação prescritiva

### Card / bento
- Grid **assimétrico**, não fileira de N iguais.
- `border: 1px solid` no token de border. `border-radius: 8px`–`12px`. **Sem** box-shadow no estado de repouso.
- Padding interno generoso: `24px` a `40px`.
- Bento sem gaps acidentais: bloco visual grande + painéis densos menores, matematicamente alinhados.

### Botão primário
- Fundo sólido do accent (ou `#111111` em contexto editorial monocromático), texto no contraste alto.
- `border-radius: 4px`–`6px`. **Sem** sombra.
- Hover: deslocamento tonal sutil (um stop mais escuro). Active: `transform: scale(0.98)`.
- **Uma** ação primária inequívoca por dobra. A secundária parece secundária — ghost, outline ou link com seta —, nunca um clone do primário.

### Tag / badge de status
- Pílula (`border-radius: 9999px`), `text-xs`, caixa-alta, `letter-spacing: 0.05em`.
- Fundo em pastel dessaturado da tabela de §4.

### Accordion / FAQ
- Sem caixa em volta. Itens separados só por `border-bottom` hairline.
- Toggle com `+` / `−` nítido — não chevron genérico girando.

### Atalho de teclado
- `<kbd>` renderizado como tecla física: hairline, `radius 4px`, fundo warm sutil, fonte mono.

### Chrome de janela fake
- Ao mockar software: container minimalista, barra superior clara, três círculos cinza-claro. Sem skeuomorfismo além disso.

### Tabela de dados
- É a **única** área onde a densidade comprime. Alt-row no neutral-100, divisor no neutral-300, números em mono tabular, cabeçalho sticky.

---

## 7. Espaço e ritmo

- **Estabeleça o macro-whitespace primeiro**, antes de qualquer conteúdo. `py-24` / `py-32` entre seções majoritárias.
- Cadência de espaçamento **uniforme** entre seções — sem uma seção sufocada seguida de outra vazia.
- Varie a **ambição** das seções, não o espaçamento: algumas ricas e art-directed, outras mini e quase só espaço negativo, outras editoriais medianas.
- Seção densa é sempre separada por uma seção calma.
- Nenhuma âncora de composição se repete por mais de **2 seções seguidas**.
- Nenhum modo de fundo se repete por mais de **3 seções seguidas**.
- Whitespace é ferramenta deliberada. Se o espaço é aleatório, o layout não foi desenhado.

---

## 8. Movimento

Movimento é invisível: presente, nunca protagonista. Sofisticação silenciosa, não espetáculo.

- **Entrada por scroll:** `translateY(12px)` + `opacity: 0` → resolvendo em `600ms` com `cubic-bezier(0.16, 1, 0.3, 1)`. Sempre via `IntersectionObserver`; **nunca** `window.addEventListener('scroll')`.
- **Hover de card:** sombra de `0 0 0` para `0 2px 8px rgba(0,0,0,0.04)` em `200ms`. Nada além disso.
- **Reveal escalonado:** `animation-delay: calc(var(--index) * 80ms)`. Nunca montar tudo de uma vez.
- **Ambiente:** no máximo um blob radial lentíssimo (`20s+`, `opacity 0.02–0.04`) em camada `position: fixed; pointer-events: none`, atrás do hero. Jamais em container que rola.
- **Performance:** animar **exclusivamente** `transform` e `opacity`. Nada que dispare layout (`top`, `left`, `width`, `height`). `will-change` só no elemento que está animando agora.
- **`prefers-reduced-motion: reduce` é obrigatório** — degrade para corte seco, sem exceção.

---

## 9. Composição — quebrando o reflexo da IA

Antes de desenhar qualquer hero ou seção, escolha **conscientemente** uma âncora. A lista existe para impedir o default:

- Declaração centralizada sobre imagem full-bleed (texto nos 40% inferiores)
- Texto no canto inferior esquerdo sobre imagem de fundo
- Texto no canto inferior direito
- Lead no topo-esquerda, apoio no rodapé-direita
- Empilhado central (label / headline / sub / CTA, ultra-minimalista)
- Imagem-como-canvas com texto em área segura
- Legenda no terço direito + visual nos dois terços esquerdos (clássico invertido)
- Deslocamento editorial off-grid (tensão assimétrica)
- Legenda no terço esquerdo + visual à direita — **o clássico saturado; use com parcimônia e nunca duas vezes seguidas**

**Checagem obrigatória antes de renderizar o hero:** *"estou desenhando text-left/image-right por hábito?"* Se sim, troque a âncora.

**Escala de hero** (escolha uma por página, decisivamente, sem meio-termo):

| Escala | Quando |
|---|---|
| **Giant Statement** | Marca, campanha, manifesto. Tipo massivo, primeira dobra dominante. |
| **Mid Editorial** | Produto, SaaS, fintech, dashboard. Equilíbrio tipo/imagem, orientado a confiança. |
| **Mini Minimalist** | Logo pequeno + frase curta + CTA fino, quase só espaço negativo. Mini não é fraco — é contenção confiante. |

**Modos de fundo** (varie ao longo da página): superfície sólida com asset inline · textura/papel/grid sutil · imagem full-bleed com overlay tonal · imagem lateral editorial (50/50, 60/40, 40/60, invertível) · bloco de cor chapado + crop de detalhe · gradiente tonal cinematográfico · foto graduada em tom único · duotone travado na paleta · vinheta radial + crop · gradiente com micro-ruído · díptico de cor chapada.

**Um único "segundo olhar" por página** — um motivo não-óbvio mas legível, colocado deliberadamente uma vez: sangria assimétrica que respeita a hierarquia, uma pontuação ou numeral superdimensionado que estrutura, uma troca de material, uma nota lateral em trilho vertical, um macro-crop que carrega a cor da marca. O motivo tem que **ajudar a ordem de leitura** — gimmick por gimmick, não.

---

## 10. Direção de imagem gerada (referências visuais)

Quando o pedido for **gerar imagens de referência de frontend** (comps, mocks, moodboard de tela):

- **Uma imagem horizontal por seção. Sempre.** 8 seções → 8 imagens. Nunca colapsar a página inteira em uma imagem alta, nunca entregar "a melhor" e pular o resto.
- Formato horizontal: `16:9`, `16:10` ou `21:9` conforme a densidade.
- Defaults quando o número não é dito: *hero* → 1 · *landing page* → 6 · *site completo / marketing site* → 8 · *página de produto / portfólio* → 6.
- Anuncie a contagem antes de gerar, e rotule cada frame: *"Seção X de N: nome"*.
- **Continuidade de marca entre todos os frames:** mesma paleta, mesma família e escala tipográfica, mesma família de CTA, mesma linguagem de radius, mesmo tratamento de imagem, mesmo tom de voz na copy. Varia: âncora de composição, modo de fundo, densidade, tamanho da seção.
- Cada seção tem um **trabalho** no funil: fisgar → provar → educar → converter. Nem a peça mais artística escapa disso.

---

## 11. Voz da interface

- Português brasileiro, direto, específico. Sem jargão de marketing.
- Rótulo diz o que faz, não o que vende: *"Enviar mensagem"*, não *"Iniciar jornada"*.
- Erro descreve o que aconteceu **e** qual é a próxima ação. Nunca "algo deu errado".
- Estado vazio ensina: o que é isto, por que está vazio, o que fazer agora. Nunca uma ilustração fofa e ponto.
- Sem celebração, sem confete, sem "IA mágica". Confiança vem de consistência.
- Termos técnicos e identificadores de código permanecem em inglês.

---

## 12. Checklist de aceite visual

Nenhuma tela/superfície é "pronta" sem responder **sim** a todos:

1. A hierarquia é óbvia em três segundos?
2. O hero (ou o topo da tela) respira — não está entulhado de pills, badges e stats falsos?
3. Existe **uma** ação primária inequívoca por dobra, e a secundária parece secundária?
4. Nenhum item de §2 (Banidos) aparece? Rode a varredura literal: emoji, Inter/Lucide, `shadow-lg`, gradiente roxo-azul, `rounded-full` em card, "Acme"/"John Doe", clichê de copy.
5. A paleta é a do Nexora, com cor usada só semanticamente ou como acento pontual?
6. Toda borda é hairline 1px do token, e todo radius está entre 4px e 12px conforme o elemento?
7. O espaçamento entre seções é uniforme e generoso; nenhuma seção espremida ao lado de uma vazia?
8. Nenhuma âncora de composição se repete por mais de 2 seções seguidas?
9. A tipografia carrega a hierarquia por escala e peso — sem depender de cor ou caixa-alta?
10. As animações usam só `transform`/`opacity` e respeitam `prefers-reduced-motion`?
11. O contraste passa em WCAG AA, e nenhuma informação depende só de cor?
12. Existe exatamente **um** "segundo olhar", e ele ajuda a leitura?
13. A copy é realista, específica e em pt-BR correto — com acentuação íntegra?
14. Um desenvolvedor consegue implementar a partir disto sem perguntar nada?
15. Isto parece **desenhado** — ou parece gerado?

Se a resposta a 15 for "gerado", volte ao §9 e escolha outra âncora.

---

## 13. Procedência

Absorvido de `github.com/leonxlnx/taste-skill` em 2026-08-25 — `skills/minimalist-skill/SKILL.md` (protocolo de minimalismo utilitário premium / editorial) e `skills/imagegen-frontend-web/SKILL.md` (direção de arte de referência frontend, motor de variação combinatória, regras anti-AI-slop). O clone foi lido, transcrito e destruído; este arquivo é a forma que a doutrina toma dentro do Nexora.
