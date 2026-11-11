/**
 * FORK NEXORA — o despacho para o motor de tráfego (AIOS, Python, fora do CRM).
 *
 * ─── A fronteira ────────────────────────────────────────────────────────────
 *
 * O Nexora é só o DISPARADOR: recebe o pedido da pessoa na tela `/app/aios`,
 * confere quem ela é, registra o pedido e o manda ao AIOS por HTTP. Quem monta a
 * campanha é o motor. O resultado NÃO volta por esta chamada — o motor grava na
 * linha do pedido (`public.aios_campaign_requests`, migration 9902) e o CRM o
 * lê de lá. O contrato com o lado Python: `docs/AIOS_PYTHON_CONTRACT.md`.
 *
 * É o mesmo corte de `lib/nexora/fronteira-meta-ads.ts`, visto pelo outro lado:
 * lá o CRM deixa de falar com a Meta; aqui ele ganha a porta para falar com
 * quem fala.
 *
 * ─── O que sai daqui ────────────────────────────────────────────────────────
 *
 * Um POST com exatamente cinco campos (`CorpoDoDespacho`). `org_id` e
 * `user_id` vêm de quem chama esta função — a rota os tira da SESSÃO, nunca do
 * corpo que o navegador mandou. `request_id` é a chave da linha do pedido: é
 * com `(organization_id = org_id, request_id)` que o motor acha onde gravar a
 * resposta.
 *
 * Dois cabeçalhos acompanham: `X-Request-Id` (o id da CHAMADA HTTP, o mesmo que
 * vai para o `api_audit_log`, para o motor conseguir casar o log dele com o
 * nosso — não confundir com o `request_id` do corpo, que é o id do PEDIDO) e, só
 * quando `AIOS_PYTHON_TOKEN` está preenchida, `Authorization: Bearer`. Sem o
 * token o motor não tem como distinguir o CRM de qualquer outro processo que
 * alcance a porta dele — por isso ele existe desde já, opcional enquanto os
 * dois rodam na mesma máquina.
 *
 * ─── O que volta ────────────────────────────────────────────────────────────
 *
 * O contrato de resposta do motor ainda não está fechado, então a leitura é
 * TOLERANTE: qualquer 2xx é "aceito". Se o corpo for JSON e trouxer `job_id`
 * e/ou `message` em texto, eles sobem para a tela; se não trouxer, não faz
 * falta. Nada do corpo é confiado além desses dois textos, com teto de tamanho.
 *
 * Esta função NUNCA lança: toda falha vira um `motivo`, porque quem decide o
 * status HTTP e a frase é a rota.
 */

/** Provisória: o endereço do motor rodando na mesma máquina, em desenvolvimento. */
export const URL_PROVISORIA_DO_AIOS = "http://localhost:8000/api/campaign";

/** A única ação que esta fase despacha. */
export const ACAO_GERAR_CAMPANHA = "generate_campaign";

/**
 * Quanto se espera o motor CONFIRMAR o recebimento. Ele não gera a campanha
 * dentro desta chamada (o resultado vem pelo banco), então 30s é folga para um
 * processo frio acordar — e é o mesmo prazo que a tela dá a uma escrita.
 */
export const PRAZO_DO_DESPACHO_MS = 30_000;

const JOB_ID_MAX = 200;
const MENSAGEM_MAX = 4000;

export interface CorpoDoDespacho {
  org_id: string;
  user_id: string;
  /** `aios_campaign_requests.request_id` — a chave que o motor usa para gravar a resposta. */
  request_id: string;
  prompt: string;
  action: typeof ACAO_GERAR_CAMPANHA;
}

export interface PedidoDeDespacho {
  orgId: string;
  userId: string;
  prompt: string;
  /** O id do PEDIDO (`aios_campaign_requests.request_id`). Vai no corpo. */
  pedidoId: string;
  /** O id da CHAMADA HTTP (audit). Vai no cabeçalho `X-Request-Id`. */
  requestId: string;
}

export type MotivoDaFalha =
  /** `AIOS_PYTHON_URL` preenchida com algo que não é um endereço http(s). */
  | "configuracao"
  /** Não deu para falar com o motor: recusou a conexão, DNS, rede. */
  | "inalcancavel"
  /** Passou do prazo. O pedido PODE ter chegado — a tela precisa dizer isso. */
  | "prazo"
  /** O motor respondeu, e respondeu que não (status fora de 2xx). */
  | "recusado";

export type ResultadoDoDespacho =
  | { ok: true; status: number; jobId: string | null; mensagem: string | null }
  | { ok: false; motivo: MotivoDaFalha; status: number | null };

/**
 * O endereço do motor: `AIOS_PYTHON_URL`, ou o provisório quando vazia.
 * `null` = está preenchida, mas não é um endereço http(s) — errar aqui em
 * silêncio mandaria o pedido para o endereço provisório sem ninguém saber.
 */
export function urlDoAios(): string | null {
  const bruto = (process.env.AIOS_PYTHON_URL ?? "").trim();
  if (!bruto) return URL_PROVISORIA_DO_AIOS;
  try {
    const url = new URL(bruto);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function texto(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(0, max) : null;
}

/** Lê o que der do corpo de um 2xx. Corpo vazio, HTML ou JSON de outro formato = nada. */
async function lerAceite(res: Response): Promise<{ jobId: string | null; mensagem: string | null }> {
  try {
    const corpo: unknown = await res.json();
    if (corpo && typeof corpo === "object" && !Array.isArray(corpo)) {
      const c = corpo as Record<string, unknown>;
      return { jobId: texto(c.job_id, JOB_ID_MAX), mensagem: texto(c.message, MENSAGEM_MAX) };
    }
  } catch {
    // Sem JSON: o aceite é o status.
  }
  return { jobId: null, mensagem: null };
}

export async function despacharParaOAios(pedido: PedidoDeDespacho): Promise<ResultadoDoDespacho> {
  const url = urlDoAios();
  if (!url) return { ok: false, motivo: "configuracao", status: null };

  const corpo: CorpoDoDespacho = {
    org_id: pedido.orgId,
    user_id: pedido.userId,
    request_id: pedido.pedidoId,
    prompt: pedido.prompt,
    action: ACAO_GERAR_CAMPANHA,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Request-Id": pedido.requestId,
  };
  const token = (process.env.AIOS_PYTHON_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(PRAZO_DO_DESPACHO_MS),
      // O endereço é de quem instalou. Seguir um redirect reenviaria o pedido
      // (e o token) para onde o motor apontar.
      redirect: "error",
      cache: "no-store",
    });
  } catch (erro) {
    const nome = (erro as { name?: string }).name;
    const prazo = nome === "TimeoutError" || nome === "AbortError";
    return { ok: false, motivo: prazo ? "prazo" : "inalcancavel", status: null };
  }

  if (!res.ok) return { ok: false, motivo: "recusado", status: res.status };
  return { ok: true, status: res.status, ...(await lerAceite(res)) };
}
