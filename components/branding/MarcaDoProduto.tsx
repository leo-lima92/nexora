import { SIMBOLO } from "@/lib/branding/desenho";
import { cn } from "@/lib/utils";

/**
 * A marca do PRODUTO desenhada em SVG inline — o que a tela mostra quando
 * ninguém configurou marca própria (`marcaEhADoProduto`, em `lib/branding.ts`).
 *
 * Inline, e não `<img src="/algo.svg">`, por três motivos:
 *  - as cores seguem o TEMA: tinta clara no escuro e a ponta vermillion subindo
 *    para a parada 400, como a régua do Nexora define — um arquivo estático
 *    teria uma cor só;
 *  - nada em `public/`: um `.svg` fixo ali seria servido na instalação de um
 *    revendedor que configurou a marca dele (ver `lib/branding/desenho.ts`);
 *  - a barra lateral já usa `<img>` para o logo CONFIGURADO, e o e2e
 *    `marca-logo.spec.ts` mede "barra sem `<img>`" como "sem logo do
 *    revendedor". Um `<img>` do produto ali faria a spec medir a coisa errada.
 *
 * O texto alternativo é o `nome` que a tela já resolveu — nunca uma string
 * fixa, para que a catraca de marca (`tests/unit/branding.test.ts`) continue
 * contando ZERO ocorrências fora de `lib/branding.ts`.
 */

type Props = {
  readonly nome: string;
  readonly className?: string;
  /** `true` quando o texto ao lado já nomeia a marca — evita ler duas vezes. */
  readonly decorativo?: boolean;
};

const SIMBOLO_CLARO_ESCURO = "fill-[#101828] dark:fill-[#f5f5f5]";
const MODULO_CLARO_ESCURO = "fill-[#e42b0c] dark:fill-[#f2704e]";
// O nome é texto (não caminho): quem o pinta é o token `text-text`, que vale
// exatamente estes hexes nos dois temas; o par `fill-*` é o contrato da régua da
// paleta (`marca-do-produto.test.tsx`), que lê uma convenção só.
const NOME_CLARO_ESCURO = "fill-[#101828] dark:fill-[#f5f5f5]";

// As classes acima repetem os hexes de `CORES_DA_MARCA` porque o Tailwind só
// gera utilitário para valor LITERAL no fonte. Quem impede os dois de divergirem
// é `tests/unit/marca-do-produto.test.tsx`, que compara as classes à paleta —
// e não uma asserção em runtime: um throw aqui derrubaria a casca inteira.
export const CLASSES_DE_COR = {
  simbolo: SIMBOLO_CLARO_ESCURO,
  modulo: MODULO_CLARO_ESCURO,
  nome: NOME_CLARO_ESCURO,
} as const;

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

/** O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. */
export function SimboloDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    <svg
      viewBox={SIMBOLO.viewBox}
      className={className}
      {...acessibilidade(nome, decorativo)}
    >
      <g transform={SIMBOLO.transform}>
        <path d={SIMBOLO.d} className={SIMBOLO_CLARO_ESCURO} />
        <rect {...SIMBOLO.modulo} className={MODULO_CLARO_ESCURO} />
      </g>
    </svg>
  );
}

/**
 * Fork Nexora: o logotipo é o símbolo ao lado do NOME em texto (Archivo), como a
 * barra lateral sempre o desenhou — não há glifos do nome em caminhos. O nome
 * visível é `aria-hidden` e quem nomeia a marca para o leitor de tela é o
 * contêiner (`role="img"`), para não ler duas vezes.
 */
export function LogotipoDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <SimboloDoProduto nome={nome} decorativo className="h-[18px] w-[18px] shrink-0" />
      <span aria-hidden className={`text-[17px] font-semibold tracking-title text-text ${NOME_CLARO_ESCURO}`}>
        {nome}
      </span>
    </span>
  );
}
