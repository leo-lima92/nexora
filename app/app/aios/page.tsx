/**
 * FORK NEXORA — Tráfego AIOS: a porta do CRM para o motor de tráfego.
 *
 * O contexto de anúncios não mora no CRM (`lib/nexora/fronteira-meta-ads.ts`):
 * quem fala com a Meta e monta campanha é o motor AIOS, fora daqui. Esta tela é
 * onde a pessoa PEDE a campanha, conversando com o Estrategista de Tráfego, e
 * onde ela LÊ a resposta: o motor a grava na linha do pedido
 * (`aios_campaign_requests`) e a tela a busca de lá. A conversa, o envio e o
 * histórico estão em `components/aios/EstrategistaDeTrafego.tsx`.
 *
 * ─── Por que `manager` ──────────────────────────────────────────────────────
 *
 * A mesma régua da rota (`POST /api/v1/aios-dispatch`) e a que a tela de Meta
 * Ads tinha: um pedido aqui vira campanha paga com a verba da empresa inteira,
 * sem recorte por pessoa. Quem não chega a `manager` é mandado ao /403 em vez
 * de ver um campo que o servidor recusaria.
 */
import { redirect } from "next/navigation";

import { EstrategistaDeTrafego } from "@/components/aios/EstrategistaDeTrafego";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Tráfego Agêntico" };
export const dynamic = "force-dynamic";

export default async function TrafegoAiosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const t = (texto: string) => traduzir(texto, user.idioma);
  return (
    <div className="flex flex-col gap-6" data-testid="tela-aios">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Tráfego Agêntico")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(
            "Peça campanhas de tráfego pago conversando. O pedido vai para o motor de tráfego, que cuida dos anúncios fora do CRM.",
          )}
        </p>
      </div>
      <EstrategistaDeTrafego />
    </div>
  );
}
