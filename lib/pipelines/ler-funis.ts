/**
 * Os funis da organização, na ordem da lista, ARQUIVADOS INCLUSIVE.
 *
 * Morava em `app/api/v1/pipelines/_funis.ts` (que continua reexportando daqui).
 * Veio para `lib/` quando a criação de funil virou operação compartilhada
 * (`lib/pipelines/criar-funil.ts`): `lib/` não importa de `app/`.
 *
 * Arquivados entram de propósito: nenhum dos índices únicos de funil é parcial
 * em `is_archived` (`uniq_crm_pipelines_org_slug`, `_org_default`, `_org_client`),
 * e as regras de `lib/pipelines/pipeline-editing.ts` dependem disso.
 *
 * O filtro explícito de `organization_id` é a convenção do repo e a rede que
 * sobra se a policy mudar — a RLS já vale porque o client é o do usuário.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FunilEditavel } from "@/lib/pipelines/pipeline-editing";

/** `position` entra: a reordenação calcula em cima dela. */
const COLUNAS =
  "id, name, slug, description, position, is_default, is_client_pipeline, is_archived";

export async function lerFunis(
  supabase: Pick<SupabaseClient, "from">,
  orgId: string,
): Promise<FunilEditavel[]> {
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FunilEditavel[];
}
