/**
 * FORK NEXORA — contrato HTTP de `/api/v1/aios-dispatch` (corpo do POST e query
 * do GET). A forma do pedido e o vocabulário de `status` estão em
 * `lib/aios/pedidos.ts`.
 *
 * Só o servidor importa este arquivo (o cursor usa `Buffer`).
 */
import { z } from "zod";

import { FORMA_DO_REQUEST_ID, PROMPT_MAX } from "@/lib/aios/pedidos";

/**
 * O corpo do POST. ESTRITO: `org_id`, `user_id`, `action` ou `status` vindos do
 * navegador são recusados com 422, em vez de ignorados — organização e pessoa
 * saem da sessão, e o erro de quem integra aparece na hora.
 *
 * `request_id` é opcional: a tela manda o id que gerou para o pedido; quem
 * chama sem ele recebe um gerado pela rota.
 */
export const corpoDoPedidoAios = z
  .object({
    prompt: z.string().trim().min(1).max(PROMPT_MAX),
    request_id: z.string().regex(FORMA_DO_REQUEST_ID).optional(),
  })
  .strict();

export const LIMITE_PADRAO_DE_PEDIDOS = 20;
export const LIMITE_MAXIMO_DE_PEDIDOS = 50;

export const listaDePedidosAiosQuery = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_DE_PEDIDOS).default(LIMITE_PADRAO_DE_PEDIDOS),
});

/**
 * Cursor keyset opaco sobre (created_at DESC, id DESC), no mesmo formato do
 * histórico de captação (`base64url("<data>|<id>")`). Os dois critérios são
 * obrigatórios: dois pedidos no mesmo instante pulariam ou repetiriam entre
 * páginas se a ordem fosse só a data.
 */
export interface CursorDePedidoAios {
  created_at: string;
  id: string;
}

// O cursor volta do navegador e entra num filtro `or` do PostgREST: só passa o
// que tem a forma exata de um carimbo de data e de um uuid.
const FORMA_DA_DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const FORMA_DO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codificarCursorDePedidoAios(c: CursorDePedidoAios): string {
  return Buffer.from(`${c.created_at}|${c.id}`, "utf8").toString("base64url");
}

export function decodificarCursorDePedidoAios(bruto: string): CursorDePedidoAios | null {
  try {
    const [created_at, id, ...resto] = Buffer.from(bruto, "base64url").toString("utf8").split("|");
    if (!created_at || !id || resto.length > 0) return null;
    if (!FORMA_DA_DATA.test(created_at) || !FORMA_DO_UUID.test(id)) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}
