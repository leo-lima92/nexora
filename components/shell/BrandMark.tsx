import { cn } from "@/lib/utils";

/**
 * A marca do Nexora — três barras que estreitam, a última em vermillion.
 *
 * O desenho vem do canvas `/design` aprovado e não é decoração: as barras
 * descendo de 16 para 11 para 6 unidades SÃO o funil, e a única colorida é a
 * ponta — o ponto em que a conversa vira venda. É o mesmo argumento que rege a
 * cor no resto do sistema (vermillion = o que converte), só que em forma de
 * logotipo, e por isso a marca não precisa de explicação ao lado.
 *
 * As duas barras superiores usam `currentColor` de propósito: assim a marca
 * herda a tinta de onde é colocada e funciona igual sobre Paper, sobre Carbon e
 * na sidebar recolhida, sem uma segunda variante.
 */
export function BrandMark({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect x="1" y="2.5" width="16" height="2.4" rx="1" fill="currentColor" />
      <rect x="1" y="7.8" width="11" height="2.4" rx="1" fill="currentColor" />
      <rect
        x="1"
        y="13.1"
        width="6"
        height="2.4"
        rx="1"
        fill="var(--color-accent)"
      />
    </svg>
  );
}
