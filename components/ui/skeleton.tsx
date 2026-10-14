import { cn } from "@/lib/utils";

/**
 * Esqueleto de carregamento — visual do escudo Nexora (pulso em
 * `surface-elevated`). `data-esqueleto` é o contrato de teste vindo do upstream
 * v1.80.0: os testes procuram o atributo, não a classe da implementação.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-esqueleto
      className={cn("animate-pulse rounded-md bg-surface-elevated", className)}
      {...props}
    />
  )
}

export { Skeleton };
