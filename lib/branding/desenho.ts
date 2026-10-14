/**
 * O DESENHO da marca do produto — símbolo e logotipo — como geometria pura.
 *
 * Mora aqui, e não num `.svg` em `public/`, por duas razões que a doutrina de
 * marca própria já paga:
 *
 *  1. `public/` é servido a todo mundo, sempre. Um arquivo fixo ali seria a
 *     marca do PRODUTO na instalação de um revendedor que configurou a dele —
 *     é exatamente o vazamento que `tests/unit/branding.test.ts` vigia. Como
 *     geometria, o desenho só aparece onde um componente decide que a marca em
 *     vigor é a padrão (`marcaEhADoProduto`, em `lib/branding.ts`).
 *  2. O favicon (`app/icon.tsx`) é gerado em runtime pelo `ImageResponse`, que
 *     aceita SVG inline mas não lê arquivo do disco. Um único desenho alimenta
 *     a tela e o ícone — dois arquivos divergiriam na primeira revisão da marca.
 *
 * As cores NÃO estão aqui de propósito: quem desenha escolhe (a tela lê os
 * tokens do tema; o favicon lê a régua do produto). A fonte deste arquivo são
 * os SVGs em `docs/brand/`; ao trocar a arte, regenere os dois lados a partir
 * deles.
 */

/**
 * FORK NEXORA (sincronização v1.80.0, 2026-10-14): o desenho do upstream era o
 * "D aberto" e o logotipo "DeskcommCRM" em caminhos — a marca DELE. Aqui mora a
 * do Nexora, a mesma de `components/shell/BrandMark.tsx`: três barras que
 * estreitam (16 → 11 → 6 de 18 unidades) e são o funil; a de baixo, a ponta em
 * que a conversa vira venda, é o `modulo` — o único traço na cor de conversão.
 * Escalada ×12 para o quadrado de 216 que o favicon e o ícone do app esperam.
 *
 * Não há mais LOGOTIPO em caminhos: o logotipo do Nexora é o símbolo ao lado do
 * NOME em texto (Archivo), que é como a barra lateral sempre o desenhou.
 */
const BARRA = (y: number, largura: number) =>
  `M24 ${y}h${largura - 24}a12 12 0 0 1 12 12v4.8a12 12 0 0 1-12 12H24a12 12 0 0 1-12-12V${y + 12}a12 12 0 0 1 12-12Z`;

/** O símbolo: as duas barras de cima (`d`) e a barra-ponta destacada (`modulo`). Quadrado de 216. */
export const SIMBOLO = {
  viewBox: "0 0 216 216",
  transform: "translate(0 0)",
  d: `${BARRA(30, 192)}${BARRA(93.6, 132)}`,
  modulo: { x: 12, y: 157.2, width: 72, height: 28.8, rx: 12 },
} as const;

/**
 * As cores da marca do produto, por tema — as do Nexora: tinta nas barras e no
 * nome (`--color-text` de cada tema), vermillion na ponta (`--color-accent`:
 * 600 no claro, 400 no escuro, a mesma subida de parada da régua).
 */
export const CORES_DA_MARCA = {
  claro: { simbolo: "#101828", modulo: "#e42b0c", nome: "#101828" },
  escuro: { simbolo: "#f5f5f5", modulo: "#f2704e", nome: "#f5f5f5" },
} as const;
