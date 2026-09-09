import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badge — Sage design system.
 * Variants: default (accent soft), neutral, success, warning, error, info.
 * Compat aliases: secondary -> neutral, destructive -> error, outline -> neutral.
 */
const badgeVariants = cva(
  [
    // RAIO 8px, NUNCA PÍLULA: a etiqueta é onde o reflexo de arredondar até virar
    // cápsula aparece, e `rounded-full` reintroduziria uma segunda linguagem de
    // forma por causa de um elemento de 20px. O default é OUTLINE: no deck
    // acromático a etiqueta é classificação, não alarme — quem preenche é o
    // estado semântico.
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
    "text-xs font-medium uppercase leading-4 tracking-eyebrow",
    "transition-colors duration-fast ease-out",
    "focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-border-strong bg-transparent text-text-muted",
        neutral: "border-border bg-surface-elevated text-text-muted",
        // Contador (não-lidas, fila): chapa de tinta, número em mono. Único lugar
        // em que o badge inverte — e sem tocar na vermillion, que é da ação.
        counter:
          "border-transparent bg-text px-1.5 font-mono text-[11px] tabular-nums text-surface",
        success:
          "border-transparent bg-success-bg text-success-fg",
        warning:
          "border-transparent bg-warning-bg text-warning-fg",
        error:
          "border-transparent bg-error-bg text-error-fg",
        info:
          "border-transparent bg-info-bg text-info-fg",
        // shadcn aliases
        secondary:
          "border-border bg-surface-elevated text-text-muted",
        destructive:
          "border-transparent bg-error-bg text-error-fg",
        outline:
          "border-border-strong bg-transparent text-text-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
