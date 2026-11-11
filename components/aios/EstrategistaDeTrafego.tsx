"use client";

/**
 * FORK NEXORA — o Estrategista de Tráfego: a conversa da tela `/app/aios`.
 *
 * ─── O que esta tela faz ────────────────────────────────────────────────────
 *
 * Cada mensagem é um PEDIDO entregue ao motor de tráfego (AIOS), que roda fora
 * do CRM: `enviar()` chama `POST /api/v1/aios-dispatch`, que registra o pedido
 * (`aios_campaign_requests`) e espera o motor confirmar que recebeu. A campanha
 * é montada do lado de lá, e a resposta NÃO volta por essa chamada: o motor a
 * grava na linha do pedido, e a tela a lê por `GET /api/v1/aios-dispatch`.
 *
 * Por isso a tela nunca finge uma resposta do estrategista. Na hora do envio
 * ela mostra o que o motor devolveu no aceite (a frase e o protocolo, quando
 * vierem); a resposta de verdade aparece quando o motor terminar — no cartão
 * Pedidos e, para o pedido feito nesta sessão, também como bolha na conversa.
 *
 * ─── Duas fontes para a lista de pedidos ────────────────────────────────────
 *
 * `historico` é o que o servidor devolve: os pedidos da organização, com o
 * `status` e a resposta. É o que sobrevive a recarregar a página.
 *
 * `locais` são os pedidos DESTA sessão vistos pela tela: existem para o
 * intervalo em que ainda não há linha para mostrar (o envio em voo) e para o
 * pedido que nunca virou linha (recusado antes de ser registrado, ou a rede
 * caiu). Assim que o `request_id` de um deles aparece no histórico, a linha do
 * servidor toma o lugar — a tela não mantém uma segunda versão do que o banco
 * já sabe.
 *
 * ─── Quando a tela consulta de novo ─────────────────────────────────────────
 *
 * Ao abrir, depois de cada envio, no botão Atualizar e — sozinha — enquanto
 * houver pedido em aberto (`queued`, `processing`, `unconfirmed`). A consulta
 * automática começa em 5s e espaça até 60s enquanto nada muda, só roda com a
 * aba visível e para quando não sobra pedido em aberto.
 *
 * ─── Por que `fetch`, e não o `apiClient` ───────────────────────────────────
 *
 * O `apiClient` repete sozinho um POST que voltou 429 ou 503, depois de esperar
 * o `Retry-After`. Aqui cada repetição seria um pedido a mais ao motor, e a
 * pessoa ficaria olhando "Enviando…" por um minuto sem saber por quê. Um
 * pedido de campanha sai uma vez; se falhou, quem decide reenviar é a pessoa.
 *
 * ─── Os três desfechos de uma falha ─────────────────────────────────────────
 *
 * `falhou` (o pedido não foi aceito) devolve o texto ao campo, para reenviar
 * com um Enter. `sem_confirmacao` (504: o motor não respondeu a tempo) NÃO
 * devolve — o pedido pode ter chegado, e facilitar o reenvio seria convidar a
 * gerar a mesma campanha duas vezes.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { PROMPT_MAX, pedidoEmAberto, type PedidoAios, type StatusDoPedidoAios } from "@/lib/aios/pedidos";
import { HEADER_ORG_DA_ABA, orgDaAba } from "@/lib/auth/org-da-aba";
import { randomId } from "@/lib/random-id";
import { ArrowsClockwise, Megaphone, PaperPlaneTilt } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/** A rota do despacho e da lista de pedidos. Exportada para o teste conferir o contrato. */
export const ROTA_DO_DESPACHO = "/api/v1/aios-dispatch";

/** A consulta automática: começa aqui… */
export const ESPERA_MINIMA_MS = 5_000;
/** …e espaça até aqui enquanto nada muda. */
export const ESPERA_MAXIMA_MS = 60_000;

/** O estado de um pedido desta sessão ANTES de haver linha do servidor para mostrar. */
type EstadoLocal = "enviando" | "entregue" | "sem_confirmacao" | "falhou";

interface PedidoLocal {
  /** O `request_id` do pedido — o mesmo que vai no corpo e vira a chave da linha. */
  requestId: string;
  texto: string;
  estado: EstadoLocal;
  protocolo: string | null;
}

interface Mensagem {
  id: string;
  autor: "pessoa" | "estrategista";
  texto: string;
  tom?: "erro" | "aviso";
  protocolo?: string | null;
}

interface RespostaDoDespacho {
  data?: { job_id?: string | null; message?: string | null; request?: PedidoAios | null };
  error?: { message?: string };
}

type Variante = "neutral" | "info" | "success" | "warning" | "error";

const ROTULO_DO_ESTADO: Record<EstadoLocal, string> = {
  enviando: "Enviando",
  entregue: "Entregue ao motor",
  sem_confirmacao: "Sem confirmação",
  falhou: "Não enviado",
};

const VARIANTE_DO_ESTADO: Record<EstadoLocal, Variante> = {
  enviando: "info",
  entregue: "success",
  sem_confirmacao: "warning",
  falhou: "error",
};

const ROTULO_DO_STATUS: Record<StatusDoPedidoAios, string> = {
  queued: "Na fila do motor",
  processing: "Em andamento",
  completed: "Concluído",
  failed: "Falhou",
  unconfirmed: "Sem confirmação",
};

const VARIANTE_DO_STATUS: Record<StatusDoPedidoAios, Variante> = {
  queued: "info",
  processing: "info",
  completed: "success",
  failed: "error",
  unconfirmed: "warning",
};

/** Lê uma página de pedidos. `null` = não deu (rede, sessão, resposta fora do formato). */
async function lerPedidos(cursor: string | null): Promise<{ pedidos: PedidoAios[]; cursor: string | null } | null> {
  try {
    const url = cursor ? `${ROTA_DO_DESPACHO}?cursor=${encodeURIComponent(cursor)}` : ROTA_DO_DESPACHO;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const corpo = (await res.json()) as { data?: unknown; meta?: { cursor?: string | null } };
    if (!Array.isArray(corpo.data)) return null;
    return { pedidos: corpo.data as PedidoAios[], cursor: corpo.meta?.cursor ?? null };
  } catch {
    return null;
  }
}

/**
 * Junta a primeira página, recém-lida, com o que a pessoa já tinha carregado de
 * mais antigo ("Ver pedidos mais antigos"): a página nova manda no que cobre, e
 * o resto continua embaixo.
 */
function fundir(pagina: PedidoAios[], atual: PedidoAios[]): PedidoAios[] {
  const ultimo = pagina[pagina.length - 1];
  if (!ultimo) return atual;
  const naPagina = new Set(pagina.map((p) => p.id));
  return [...pagina, ...atual.filter((p) => !naPagina.has(p.id) && p.created_at <= ultimo.created_at)];
}

export function EstrategistaDeTrafego() {
  const t = useT();
  const tagDeIdioma = useTagDeIdioma();
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const conversaRef = useRef<HTMLDivElement | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [locais, setLocais] = useState<PedidoLocal[]>([]);
  const [enviando, setEnviando] = useState(false);

  const [historico, setHistorico] = useState<PedidoAios[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [leituraFalhou, setLeituraFalhou] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);

  /** `request_id` dos pedidos feitos nesta sessão: só a resposta DELES vira bolha na conversa. */
  const daSessao = useRef(new Set<string>());
  /** `request_id` cujo desfecho já foi dito na conversa — para não dizer duas vezes. */
  const anunciados = useRef(new Set<string>());
  const espera = useRef(ESPERA_MINIMA_MS);
  const assinatura = useRef("");
  /** A leitura da primeira página que está em voo, se houver. */
  const emVoo = useRef<Promise<void> | null>(null);
  const releitura = useRef(false);
  const carregouMais = useRef(false);

  const formatarData = useMemo(() => {
    const formato = new Intl.DateTimeFormat(tagDeIdioma, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (iso: string) => {
      const data = new Date(iso);
      return Number.isNaN(data.getTime()) ? "" : formato.format(data);
    };
  }, [tagDeIdioma]);

  // Rola SÓ a caixa da conversa — `scrollIntoView` rolaria a página inteira.
  useEffect(() => {
    const caixa = conversaRef.current;
    if (caixa && (mensagens.length > 0 || enviando)) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens.length, enviando]);

  /**
   * O que fazer com a primeira página que acabou de chegar (`null` = a leitura
   * falhou). A leitura que falha deixa o aviso e a lista que já estava na tela;
   * a próxima que der certo tira o aviso.
   */
  const aplicar = useCallback(
    (pagina: { pedidos: PedidoAios[]; cursor: string | null } | null) => {
      setCarregado(true);
      if (!pagina) {
        setLeituraFalhou(true);
        return;
      }
      setLeituraFalhou(false);

      // Nada mudou desde a última leitura → a próxima espera mais.
      const agora = pagina.pedidos.map((p) => `${p.id}:${p.status}:${p.updated_at}`).join("|");
      espera.current =
        agora === assinatura.current ? Math.min(ESPERA_MAXIMA_MS, Math.round(espera.current * 1.5)) : ESPERA_MINIMA_MS;
      assinatura.current = agora;

      if (carregouMais.current) {
        setHistorico((atual) => fundir(pagina.pedidos, atual));
      } else {
        setHistorico(pagina.pedidos);
        setCursor(pagina.cursor);
      }

      // O pedido desta sessão que chegou ao fim: a resposta entra na conversa,
      // que é para onde a pessoa está olhando.
      const novas: Mensagem[] = [];
      for (const p of pagina.pedidos) {
        if (!daSessao.current.has(p.request_id) || anunciados.current.has(p.request_id)) continue;
        if (p.status === "completed") {
          anunciados.current.add(p.request_id);
          novas.push({
            id: `${p.request_id}-fim`,
            autor: "estrategista",
            texto: p.response_summary || t("O motor de tráfego concluiu o pedido, sem enviar um resumo."),
            protocolo: p.engine_job_id,
          });
        } else if (p.status === "failed") {
          anunciados.current.add(p.request_id);
          novas.push({
            id: `${p.request_id}-fim`,
            autor: "estrategista",
            texto: p.error_message || t("O motor de tráfego não conseguiu concluir este pedido."),
            tom: "erro",
            protocolo: p.engine_job_id,
          });
        }
      }
      if (novas.length > 0) setMensagens((atual) => [...atual, ...novas]);
    },
    [t],
  );

  /**
   * Lê a primeira página e a aplica. Uma leitura por vez: quem pede outra no
   * meio (o fim de um envio, por exemplo) recebe a que está em voo — e ela se
   * repete antes de terminar, porque pode ter saído ANTES de a linha nova
   * existir.
   */
  const atualizar = useCallback((): Promise<void> => {
    if (emVoo.current) {
      releitura.current = true;
      return emVoo.current;
    }
    const leitura = (async () => {
      let pagina = await lerPedidos(null);
      while (releitura.current) {
        releitura.current = false;
        pagina = await lerPedidos(null);
      }
      emVoo.current = null;
      aplicar(pagina);
    })();
    emVoo.current = leitura;
    return leitura;
  }, [aplicar]);

  // Ao abrir a tela: os pedidos que a organização já tem.
  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  /** O botão Atualizar: a mesma leitura, mostrando que está lendo. */
  const aoAtualizar = async () => {
    setAtualizando(true);
    await atualizar();
    setAtualizando(false);
  };

  // Enquanto houver pedido em aberto, a tela consulta de novo sozinha.
  const haEmAberto = historico.some((p) => pedidoEmAberto(p.status));
  useEffect(() => {
    if (!haEmAberto) return;
    let viva = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => {
      relogio = setTimeout(async () => {
        if (document.visibilityState === "visible") await atualizar();
        if (viva) agendar();
      }, espera.current);
    };
    agendar();
    // Quem voltou para a aba não espera a próxima rodada.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      viva = false;
      clearTimeout(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [haEmAberto, atualizar]);

  const verMaisAntigos = async () => {
    if (!cursor || carregandoMais) return;
    setCarregandoMais(true);
    const pagina = await lerPedidos(cursor);
    setCarregandoMais(false);
    if (!pagina) {
      setLeituraFalhou(true);
      return;
    }
    carregouMais.current = true;
    setHistorico((atual) => {
      const jaTem = new Set(atual.map((p) => p.id));
      return [...atual, ...pagina.pedidos.filter((p) => !jaTem.has(p.id))];
    });
    setCursor(pagina.cursor);
  };

  const enviar = async (texto: string) => {
    const limpo = texto.trim();
    if (!limpo || enviando) return;

    // O id do PEDIDO nasce aqui: vai no corpo, vira `request_id` na linha e é
    // a chave que o motor usa para devolver a resposta.
    const id = randomId();
    daSessao.current.add(id);
    espera.current = ESPERA_MINIMA_MS;
    setMensagens((atual) => [...atual, { id: `${id}-p`, autor: "pessoa", texto: limpo }]);
    setLocais((atual) => [{ requestId: id, texto: limpo, estado: "enviando", protocolo: null }, ...atual]);
    setRascunho("");
    setEnviando(true);

    const concluir = (estado: EstadoLocal, resposta: Omit<Mensagem, "id" | "autor">) => {
      setLocais((atual) =>
        atual.map((p) => (p.requestId === id ? { ...p, estado, protocolo: resposta.protocolo ?? null } : p)),
      );
      setMensagens((atual) => [...atual, { ...resposta, id: `${id}-r`, autor: "estrategista" }]);
      // Só a falha limpa devolve o texto (ver o cabeçalho), e só com o campo vazio.
      if (estado === "falhou") setRascunho((atual) => atual || limpo);
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Request-Id": randomId(),
    };
    // A organização desta aba, como o `apiClient` manda em toda escrita: é o que
    // faz o servidor recusar (`org_divergente`) um pedido saído de uma aba que
    // ficou numa empresa enquanto a sessão trocou para outra.
    const aba = orgDaAba();
    if (aba?.orgId) headers[HEADER_ORG_DA_ABA] = aba.orgId;

    try {
      const res = await fetch(ROTA_DO_DESPACHO, {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ prompt: limpo, request_id: id }),
      });
      let corpo: RespostaDoDespacho = {};
      try {
        corpo = (await res.json()) as RespostaDoDespacho;
      } catch {
        // Corpo sem JSON (proxy, queda): valem o status e a frase genérica.
      }

      if (res.ok) {
        concluir("entregue", {
          texto: corpo.data?.message || t("Instruções entregues ao motor de tráfego."),
          protocolo: corpo.data?.job_id ?? null,
        });
        // A linha que a rota acabou de gravar entra na lista sem esperar a leitura.
        const linha = corpo.data?.request;
        if (linha && typeof linha.id === "string" && typeof linha.request_id === "string") {
          setHistorico((atual) => (atual.some((p) => p.id === linha.id) ? atual : [linha, ...atual]));
        }
      } else {
        // A frase do servidor já vem no idioma da pessoa e diz o que fazer.
        const semConfirmacao = res.status === 504;
        // Recusa: a linha (se nasceu) fica `failed` com esta mesma frase — a
        // conversa já a disse. No 504 o desfecho ainda está por vir.
        if (!semConfirmacao) anunciados.current.add(id);
        concluir(semConfirmacao ? "sem_confirmacao" : "falhou", {
          texto:
            corpo.error?.message ||
            t("O pedido não foi enviado ao motor de tráfego. Tente de novo em instantes."),
          tom: semConfirmacao ? "aviso" : "erro",
        });
      }
    } catch {
      concluir("falhou", {
        texto: t("Não consegui falar com o servidor. Confira a conexão e tente de novo."),
        tom: "erro",
      });
    } finally {
      setEnviando(false);
      // O que o servidor registrou é o que vale — inclusive quando a resposta
      // se perdeu no caminho e o pedido chegou.
      void atualizar();
    }
  };

  const aoEnviar = (e: FormEvent) => {
    e.preventDefault();
    void enviar(rascunho);
  };

  // Enter envia; Shift+Enter quebra a linha — o mesmo contrato do composer do Inbox.
  const aoTeclarNoCampo = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void enviar(rascunho);
    }
  };

  // O pedido desta sessão sai da lista local quando a linha dele chega do servidor.
  const noHistorico = new Set(historico.map((p) => p.request_id));
  const locaisVisiveis = locais.filter((p) => !noHistorico.has(p.requestId));
  const semPedidos = locaisVisiveis.length === 0 && historico.length === 0;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span
            aria-hidden
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <Megaphone size={20} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-text">
              {t("Estrategista de Tráfego")}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
              {t("Descreva a campanha. Cada mensagem é um pedido entregue ao motor de tráfego.")}
            </p>
          </div>
        </header>

        <div
          ref={conversaRef}
          role="log"
          aria-label={t("Conversa com o Estrategista de Tráfego")}
          aria-live="polite"
          aria-busy={enviando}
          data-testid="aios-conversa"
          className="flex h-[clamp(18rem,calc(100dvh-27rem),38rem)] flex-col gap-4 overflow-y-auto bg-surface-elevated/40 px-5 py-5"
        >
          {/* A saudação é da tela, não do motor: não é pedido e não é enviada. */}
          <BolhaDoEstrategista>
            {t(
              "Olá! Conte o que você quer anunciar: o objetivo, para quem, quanto pretende investir e por quanto tempo.",
            )}
          </BolhaDoEstrategista>

          {mensagens.map((m) =>
            m.autor === "pessoa" ? (
              <BolhaDaPessoa key={m.id}>{m.texto}</BolhaDaPessoa>
            ) : (
              <BolhaDoEstrategista key={m.id} tom={m.tom}>
                <p className="break-words whitespace-pre-wrap">{m.texto}</p>
                {m.protocolo && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    {t("Protocolo")}: <span className="font-mono break-all">{m.protocolo}</span>
                  </p>
                )}
              </BolhaDoEstrategista>
            ),
          )}

          {enviando && (
            <div data-testid="aios-enviando" role="status">
              <BolhaDoEstrategista>
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <PontosAnimados />
                  {t("Enviando instruções para o motor de IA…")}
                </span>
              </BolhaDoEstrategista>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 pt-3 pb-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {/* Literais, e não um laço sobre uma lista: `t()` só traduz texto que a
                varredura de chaves consegue ler no código. */}
            <Sugestao onEscolher={setRascunho} campoRef={campoRef}>
              {t("Campanha de leads para o WhatsApp")}
            </Sugestao>
            <Sugestao onEscolher={setRascunho} campoRef={campoRef}>
              {t("Remarketing para quem já conversou com a gente")}
            </Sugestao>
            <Sugestao onEscolher={setRascunho} campoRef={campoRef}>
              {t("Campanha para divulgar uma promoção")}
            </Sugestao>
          </div>

          <form onSubmit={aoEnviar} className="flex items-end gap-2">
            <Textarea
              ref={campoRef}
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={aoTeclarNoCampo}
              rows={2}
              maxLength={PROMPT_MAX}
              aria-label={t("Pedido para o Estrategista de Tráfego")}
              placeholder={t("Ex.: campanha de leads para clínica, R$ 50 por dia, por 15 dias…")}
              data-testid="aios-campo"
              className="max-h-40 min-h-[3.25rem] flex-1 resize-none"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!rascunho.trim() || enviando}
              aria-label={t("Enviar")}
              data-testid="aios-enviar"
              className="shrink-0"
            >
              <PaperPlaneTilt size={16} weight="fill" aria-hidden />
            </Button>
          </form>
          <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
            {t("Enter envia, Shift+Enter quebra a linha. O pedido sai uma vez só: se falhar, é você quem decide reenviar.")}
          </p>
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t("Como funciona")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 text-sm leading-relaxed text-text-muted">
              <Passo n={1}>{t("Você descreve a campanha: objetivo, público, verba e período.")}</Passo>
              <Passo n={2}>
                {t("O CRM entrega o pedido ao motor de tráfego (AIOS), que roda fora daqui.")}
              </Passo>
              <Passo n={3}>
                {t("O motor monta a campanha do lado dele. Quando termina, a resposta aparece em Pedidos e nesta conversa.")}
              </Passo>
            </ol>
          </CardContent>
        </Card>

        <Card data-testid="aios-pedidos" aria-busy={!carregado || atualizando}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{t("Pedidos")}</CardTitle>
                <CardDescription className="mt-1">
                  {t("Os pedidos da sua empresa e a resposta do motor de tráfego. A lista se atualiza sozinha enquanto houver pedido em aberto.")}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void aoAtualizar()}
                disabled={atualizando}
                data-testid="aios-atualizar"
                className="shrink-0 gap-1.5"
              >
                <ArrowsClockwise
                  size={14}
                  aria-hidden
                  className={cn(atualizando && "animate-spin motion-reduce:animate-none")}
                />
                {atualizando ? t("Atualizando…") : t("Atualizar")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {leituraFalhou && (
              <p role="alert" data-testid="aios-pedidos-erro" className="mb-3 text-sm text-error-fg">
                {t("Não consegui carregar os pedidos. Toque em Atualizar para tentar de novo.")}
              </p>
            )}

            {!carregado ? (
              <p className="text-sm text-text-subtle">{t("Carregando pedidos…")}</p>
            ) : semPedidos ? (
              !leituraFalhou && <p className="text-sm text-text-subtle">{t("Nenhum pedido enviado ainda.")}</p>
            ) : (
              <ul className="flex max-h-[40rem] flex-col gap-3 overflow-y-auto">
                {locaisVisiveis.map((p) => (
                  <li
                    key={p.requestId}
                    data-testid="aios-pedido"
                    data-origem="sessao"
                    data-estado={p.estado}
                    className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-subtle">{t("Agora")}</span>
                      <Badge variant={VARIANTE_DO_ESTADO[p.estado]}>{t(ROTULO_DO_ESTADO[p.estado])}</Badge>
                    </div>
                    <p className="line-clamp-2 text-sm break-words text-text">{p.texto}</p>
                    {p.protocolo && (
                      <p className="font-mono text-[11px] break-all text-text-subtle">{p.protocolo}</p>
                    )}
                  </li>
                ))}

                {historico.map((p) => (
                  <li
                    key={p.id}
                    data-testid="aios-pedido"
                    data-origem="historico"
                    data-estado={p.status}
                    className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <time dateTime={p.created_at} className="font-mono text-xs text-text-subtle tabular-nums">
                        {formatarData(p.created_at)}
                      </time>
                      <Badge variant={VARIANTE_DO_STATUS[p.status] ?? "neutral"}>
                        {ROTULO_DO_STATUS[p.status] ? t(ROTULO_DO_STATUS[p.status]) : p.status}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-sm break-words text-text">{p.prompt}</p>

                    {p.status === "unconfirmed" && (
                      <p className="text-xs leading-relaxed text-text-muted">
                        {t("O motor não confirmou o recebimento. Se ele recebeu o pedido, a resposta aparece aqui.")}
                      </p>
                    )}
                    {p.response_summary && <RespostaDoMotor texto={p.response_summary} />}
                    {p.error_message && (
                      <p data-testid="aios-pedido-erro" className="text-xs leading-relaxed break-words text-error-fg">
                        {p.error_message}
                      </p>
                    )}
                    {p.engine_job_id && (
                      <p className="font-mono text-[11px] break-all text-text-subtle">{p.engine_job_id}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {cursor && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void verMaisAntigos()}
                disabled={carregandoMais}
                data-testid="aios-mais-antigos"
                className="mt-3 w-full"
              >
                {carregandoMais ? t("Carregando pedidos…") : t("Ver pedidos mais antigos")}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** A partir daqui a resposta entra recolhida, com o botão de abrir. */
const RESPOSTA_LONGA_CHARS = 320;
const RESPOSTA_LONGA_LINHAS = 6;

/**
 * A resposta do motor num pedido da lista: texto puro, como ele escreveu. A
 * resposta de uma campanha costuma ser longa para a coluna — entra recolhida
 * em seis linhas e abre inteira por um botão.
 */
function RespostaDoMotor({ texto }: { texto: string }) {
  const t = useT();
  const [aberta, setAberta] = useState(false);
  const longa = texto.length > RESPOSTA_LONGA_CHARS || texto.split("\n").length > RESPOSTA_LONGA_LINHAS;
  return (
    <div data-testid="aios-resposta" className="mt-1 rounded-md bg-surface-elevated px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">{t("Resposta do motor")}</p>
      <p
        className={cn(
          "mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-text",
          longa && !aberta && "line-clamp-6",
        )}
      >
        {texto}
      </p>
      {longa && (
        <button
          type="button"
          aria-expanded={aberta}
          onClick={() => setAberta((atual) => !atual)}
          className="mt-1.5 text-xs font-medium text-text-muted underline underline-offset-2 hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          {aberta ? t("Recolher") : t("Ver resposta completa")}
        </button>
      )}
    </div>
  );
}

function BolhaDoEstrategista({ children, tom }: { children: ReactNode; tom?: "erro" | "aviso" }) {
  return (
    <div className="flex items-start gap-2.5" data-tom={tom}>
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted"
      >
        <Megaphone size={14} weight="fill" />
      </span>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed",
          tom === "erro" && "bg-error-bg text-error-fg",
          tom === "aviso" && "bg-warning-bg text-warning-fg",
          !tom && "border border-border bg-surface text-text",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function BolhaDaPessoa({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-primary-foreground">
        {children}
      </div>
    </div>
  );
}

/** Um atalho de pedido: preenche o campo, sem enviar — a pessoa completa a verba e o período. */
function Sugestao({
  children,
  onEscolher,
  campoRef,
}: {
  children: string;
  onEscolher: (texto: string) => void;
  campoRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onEscolher(children);
        campoRef.current?.focus();
      }}
      className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
    >
      {children}
    </button>
  );
}

function Passo({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[11px] text-text-muted tabular-nums"
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Os três pontos da espera. Parados com movimento reduzido. */
function PontosAnimados() {
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 150, 300].map((atraso) => (
        <span
          key={atraso}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-subtle motion-reduce:animate-none"
          style={{ animationDelay: `${atraso}ms` }}
        />
      ))}
    </span>
  );
}
