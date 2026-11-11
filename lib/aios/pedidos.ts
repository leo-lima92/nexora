/**
 * FORK NEXORA — o pedido de campanha do Tráfego Agêntico: vocabulário e forma.
 *
 * A linha mora em `public.aios_campaign_requests` (migration 9902). O CRM a
 * cria quando a pessoa pede a campanha na tela `/app/aios`; o motor de tráfego
 * (AIOS, Python) a completa com a resposta. O contrato com o lado Python está
 * em `docs/AIOS_PYTHON_CONTRACT.md`.
 *
 * Módulo PURO: é importado pelo servidor (rota) e pelo navegador (tela). Nada
 * aqui toca banco, `Buffer` ou `process.env`.
 *
 * ─── O vocabulário de `status` ──────────────────────────────────────────────
 *
 * `status` tem CHECK no banco. Esta tupla é a única lista do lado TypeScript e
 * é comparada com o CHECK por `tests/invariants/vocabulario-banco-x-typescript`:
 * um estado novo que nasça só num dos lados reprova lá, em vez de aparecer em
 * produção como 23514 (o banco recusa) ou como selo vazio (a tela não conhece).
 *
 *   queued       registrado, à espera do motor
 *   unconfirmed  o motor não confirmou o recebimento no prazo — PODE ter chegado
 *   processing   o motor está montando a campanha
 *   completed    terminou; a resposta está em `response_summary`
 *   failed       não deu; o porquê está em `error_message`
 */
export const STATUS_DO_PEDIDO_AIOS = ["queued", "processing", "completed", "failed", "unconfirmed"] as const;
export type StatusDoPedidoAios = (typeof STATUS_DO_PEDIDO_AIOS)[number];

/** Estados em que ainda se espera o motor — é enquanto houver um que a tela consulta de novo. */
const STATUS_EM_ABERTO: readonly string[] = ["queued", "processing", "unconfirmed"] satisfies StatusDoPedidoAios[];

export function pedidoEmAberto(status: string): boolean {
  return STATUS_EM_ABERTO.includes(status);
}

/** O teto do texto do pedido: o do campo da tela e o da rota. */
export const PROMPT_MAX = 4000;

/**
 * A forma de um `request_id`: o que a tela gera é um UUID, mas quem chama a
 * rota sem a tela pode trazer o próprio identificador. Letras, números, `_` e
 * `-`, de 8 a 100 — o mesmo intervalo do CHECK da coluna.
 */
export const FORMA_DO_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;

/** As colunas que a API devolve. `organization_id` fica de fora: é a organização ativa. */
export const COLUNAS_DO_PEDIDO =
  "id, request_id, user_id, prompt, status, engine_job_id, response_summary, campaign_metadata, error_message, created_at, updated_at";

/** Um pedido como a API o devolve (`GET` e `POST /api/v1/aios-dispatch`). */
export interface PedidoAios {
  id: string;
  /** O id que a tela gerou — a chave que o motor usa para achar a linha. */
  request_id: string;
  user_id: string;
  prompt: string;
  status: StatusDoPedidoAios;
  engine_job_id: string | null;
  /** A resposta do motor, em texto. Só o motor escreve. */
  response_summary: string | null;
  /** Objeto livre do motor. A tela NÃO lê caminho nenhum daqui. */
  campaign_metadata: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
