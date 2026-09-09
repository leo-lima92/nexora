import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button — Sage design system.
 * Variants:
 *   - primary (default): accent fill, branded CTA
 *   - secondary: surface-elevated com border, ação neutra
 *   - ghost: transparent, hover suave (toolbar/inline)
 *   - destructive: error fill (delete/cancel destrutivo)
 *   - outline: alias de secondary com background transparente (compat shadcn)
 *   - link: text-only com underline
 *   - default: alias de primary (compat shadcn)
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform,filter]",
    "duration-fast ease-out",
    // Anel de foco na cor do TEXTO, não do accent: foco não é ação (Orderful).
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      /*
       * O ORÇAMENTO DE VERMILLION (docs/DESIGN_SYSTEM.md §4). Num deck acromático
       * a cor é o único sinal de que algo é acionável, então ela se gasta se for
       * usada duas vezes na mesma dobra. Do mais caro ao mais barato:
       *   cta         gradiente Sunset Flux — a ação que CONVERTE. Uma por dobra.
       *   primary     vermillion sólida — a ação principal da tela.
       *   carbon      chapa #1f1f1f — o "próximo passo" que não converte.
       *   secondary   Paper + hairline Cloud — ação neutra ao lado da principal.
       *   outline     igual à secondary, sem preenchimento (compat shadcn).
       *   ghost       só texto — barra de ferramentas, ação inline.
       *   destructive erro dessaturado, nunca vermillion: apagar não é converter.
       *   link        texto com sublinhado.
       * Texto do CTA vem de `--color-cta-fg` (branco no light, tinta no dark),
       * nunca de `text-white` fixo; hover ESCURECE, clarear derrubaria o AA.
       */
      variant: {
        cta: [
          "bg-vermillion text-cta-foreground shadow-subtle",
          "uppercase tracking-eyebrow font-semibold",
          "hover:brightness-[0.94] hover:shadow-md active:brightness-90 active:shadow-subtle",
        ].join(" "),
        primary: [
          "bg-accent text-accent-foreground",
          "uppercase tracking-eyebrow",
          "hover:bg-accent-hover",
        ].join(" "),
        default: [
          "bg-accent text-accent-foreground",
          "uppercase tracking-eyebrow",
          "hover:bg-accent-hover",
        ].join(" "),
        carbon: [
          "bg-carbon text-text-on-carbon",
          "uppercase tracking-eyebrow",
          "hover:brightness-125",
        ].join(" "),
        secondary:
          "bg-surface text-text border border-border-strong hover:bg-surface-elevated",
        outline:
          "bg-transparent text-text border border-border-strong hover:bg-surface-elevated",
        ghost: "bg-transparent text-text-muted hover:bg-surface-elevated hover:text-text",
        destructive: "bg-error text-white hover:brightness-110",
        link: "bg-transparent text-text underline underline-offset-4 decoration-1 hover:text-accent h-auto p-0",
      },
      // Alturas de toque: abaixo de `lg` (mesmo corte que o resto da casca
      // usa pra decidir "é celular/tablet, é mouse") toda variante bate os
      // 44px recomendados pra alvo de toque; de `lg:` pra cima, onde quem
      // aciona é cursor, volta pro tamanho compacto original — mudar isso
      // globalmente pro app inteiro em telas grandes infla a densidade sem
      // necessidade nenhuma. `lg` já nascia com 44px e não precisou mudar.
      size: {
        sm: "h-11 px-3 text-xs lg:h-8",
        default: "h-11 px-4 text-[13px] lg:h-9",
        md: "h-11 px-4 text-[13px] lg:h-9",
        lg: "h-11 px-5 text-sm",
        icon: "h-11 w-11 lg:h-9 lg:w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
