"use client";
import { useT } from "@/hooks/i18n/useT";
import { Badge } from "@/components/ui/badge";
import type { OwnerKind } from "@/lib/types/leads";

/** Iniciais a partir do nome (primeira + última palavra). */
export function ownerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Exibe o responsável (owner) de um lead — humano ou agente de IA (0070).
 * Presentacional e sem dnd, testável em isolamento.
 *
 * O agente é PAR do humano, não um enfeite: mesmo diâmetro, mesmo peso, mesma
 * posição. A única diferença é a forma — humano = disco preenchido; agente =
 * círculo vazado com anel e inicial em mono. Nada de emoji, badge "AI"
 * colorido ou gradiente: a distinção é geométrica, não decorativa, e por isso
 * sobrevive ao daltonismo e ao teste do metro.
 */
export function OwnerBadge({
  ownerKind,
  ownerName,
  agentVersion,
  compacto = false,
}: {
  ownerKind: OwnerKind;
  ownerName: string | null;
  /** Versão publicada do agente no momento da exibição (nunca congelada no lead). */
  agentVersion?: number | null;
  /**
   * Variante de 16px, para a linha do inbox — onde os selos vizinhos têm 16px e
   * um disco de 24px empurraria a altura da linha inteira.
   *
   * É uma PROP e não um componente novo de propósito: a geometria (disco cheio =
   * pessoa, anel vazado = automático) é a mesma afirmação, e duplicá-la num
   * segundo arquivo é como duas telas passam a dizer a mesma coisa de dois jeitos.
   */
  compacto?: boolean;
}) {
  const t = useT();
  if (!ownerKind) {
    // Mesma geometria dos outros dois estados (disco de 24px + rótulo), para o
    // rodapé do card não mudar de altura conforme o lead tem dono ou não.
    return (
      <div className="flex items-center gap-1.5" aria-label={t("Sem responsável")}>
        <span
          className={`${compacto ? "h-4 w-4" : "h-6 w-6"} shrink-0 rounded-md border border-dashed border-border-strong`}
          aria-hidden
        />
        <span className={`truncate text-text-muted ${compacto ? "text-[10px]" : "text-xs"}`}>
          {t("Sem responsável")}
        </span>
      </div>
    );
  }

  const isAgent = ownerKind === "ai";
  const label = ownerName ?? t(isAgent ? "Agente" : "Responsável");
  const versionSuffix = isAgent && agentVersion != null ? ` · v${agentVersion}` : "";
  const fullLabel = `${label}${versionSuffix}`;

  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`${t("Responsável")}: ${fullLabel}`}
      title={fullLabel}
    >
      <span
        className={
          isAgent
            ? // AGENTE = chapa de Carbon. Marca escura, sólida, inconfundível.
              `flex ${compacto ? "h-4 w-4 text-[8px]" : "h-6 w-6 text-[10px]"} shrink-0 items-center justify-center rounded-md bg-carbon font-mono font-medium tracking-eyebrow text-text-on-carbon`
            : // HUMANO = chapa de Vellum com hairline. Marca clara.
              //
              // A intenção original continua de pé — "a um metro, um é mancha
              // escura e o outro é marca clara", e é isso que faz distinguir
              // dono humano de dono agente sem ler a inicial. O que mudou é
              // QUAL dos dois é escuro, e a cor: os dois discos eram
              // vermillion, e num board de trinta cards isso punha trinta
              // manchas da cor de ação em algo que não é ação nenhuma — é
              // atribuição. Agora a distinção é de VALOR (escuro vs. claro),
              // que sobrevive ao daltonismo e à impressão em cinza.
              `flex ${compacto ? "h-4 w-4 text-[8px]" : "h-6 w-6 text-[10px]"} shrink-0 items-center justify-center rounded-md border border-border bg-surface-elevated font-mono font-medium tracking-eyebrow text-text-muted`
        }
        aria-hidden
      >
        {ownerName ? ownerInitials(ownerName) : "?"}
      </span>
      <span
        className={`truncate text-text-muted ${compacto ? "max-w-[7rem] text-[10px]" : "max-w-[9rem] text-xs"}`}
      >
        {label}
      </span>
    </div>
  );
}
