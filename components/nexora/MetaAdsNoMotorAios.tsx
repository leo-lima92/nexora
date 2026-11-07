import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * FORK NEXORA — o que aparece onde antes havia configuração de Meta Ads.
 *
 * Quem chega aqui por link antigo, favorito ou URL digitada precisa saber POR
 * QUE a tela não tem mais o formulário, e onde a coisa acontece agora — uma
 * tela vazia ou um 404 faria a pessoa achar que algo quebrou. A regra está em
 * `lib/nexora/fronteira-meta-ads.ts`.
 *
 * `compacto` é a versão que vai DENTRO de Conversões, entre as seções que
 * continuam (Google Ads e captura de origem): sem título próprio.
 */
export function MetaAdsNoMotorAios({
  idioma,
  compacto = false,
}: {
  idioma: Idioma;
  compacto?: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <section
      data-testid="meta-ads-no-motor-aios"
      aria-label={t("Meta Ads é gerenciado pelo motor de tráfego")}
      className="max-w-3xl rounded-md border border-sky-500/40 bg-sky-500/10 p-4 text-sm"
    >
      {!compacto && <p className="font-medium">{t("Meta Ads é gerenciado pelo motor de tráfego")}</p>}
      <p className={compacto ? undefined : "mt-1"}>
        {t(
          "Campanhas e retorno de conversões da Meta são feitos pelo motor de tráfego (AIOS), fora deste CRM. Aqui nenhum evento é enviado à Meta: o CRM só recebe a origem de cada lead e a guarda no card.",
        )}
      </p>
      <p className="mt-2 text-muted-foreground">
        {t(
          "Para o card guardar a campanha, a integração envia utm_source, utm_medium, utm_campaign, campaign_id, adset_id e ad_id no corpo do webhook de entrada.",
        )}
      </p>
    </section>
  );
}
