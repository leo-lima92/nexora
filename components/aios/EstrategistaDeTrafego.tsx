"use client";

/**
 * FORK NEXORA — o Estrategista de Tráfego: a conversa da tela `/app/aios`.
 *
 * ─── O que esta tela faz, e o que ela NÃO faz ───────────────────────────────
 *
 * Cada mensagem é um PEDIDO entregue ao motor de tráfego (AIOS), que roda fora
 * do CRM: `enviar()` chama `POST /api/v1/aios-dispatch` e espera o motor
 * confirmar que recebeu. A campanha em si é montada do lado de lá, e o
 * resultado não volta por esta chamada — por isso a tela nunca finge uma
 * resposta do estrategista: ela mostra o que o motor devolveu no aceite (a
 * frase e o protocolo, quando vierem) e diz que o resultado não aparece aqui.
 *
 * A conversa e a lista de pedidos vivem só no estado do React: recarregar a
 * página começa do zero. O registro durável de cada pedido é a linha
 * `aios.campaign_dispatched` do audit log.
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
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { HEADER_ORG_DA_ABA, orgDaAba } from "@/lib/auth/org-da-aba";
import { randomId } from "@/lib/random-id";
import { Megaphone, PaperPlaneTilt } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/** A rota do despacho. Exportada para o teste conferir o contrato. */
export const ROTA_DO_DESPACHO = "/api/v1/aios-dispatch";

/** O mesmo teto que a rota aplica ao `prompt`. */
const PROMPT_MAX = 4000;

type EstadoDoPedido = "enviando" | "entregue" | "sem_confirmacao" | "falhou";

interface Pedido {
  id: string;
  /** A ordem na sessão, que é como a pessoa se refere a ele ("o segundo pedido"). */
  numero: number;
  texto: string;
  estado: EstadoDoPedido;
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
  data?: { job_id?: string | null; message?: string | null };
  error?: { message?: string };
}

const ROTULO_DO_ESTADO: Record<EstadoDoPedido, string> = {
  enviando: "Enviando",
  entregue: "Entregue ao motor",
  sem_confirmacao: "Sem confirmação",
  falhou: "Não enviado",
};

const VARIANTE_DO_ESTADO: Record<EstadoDoPedido, "info" | "success" | "warning" | "error"> = {
  enviando: "info",
  entregue: "success",
  sem_confirmacao: "warning",
  falhou: "error",
};

export function EstrategistaDeTrafego() {
  const t = useT();
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const conversaRef = useRef<HTMLDivElement | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [enviando, setEnviando] = useState(false);

  // Rola SÓ a caixa da conversa — `scrollIntoView` rolaria a página inteira.
  useEffect(() => {
    const caixa = conversaRef.current;
    if (caixa && (mensagens.length > 0 || enviando)) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens.length, enviando]);

  const enviar = async (texto: string) => {
    const limpo = texto.trim();
    if (!limpo || enviando) return;

    const id = randomId();
    setMensagens((atual) => [...atual, { id: `${id}-p`, autor: "pessoa", texto: limpo }]);
    setPedidos((atual) => [
      ...atual,
      { id, numero: atual.length + 1, texto: limpo, estado: "enviando", protocolo: null },
    ]);
    setRascunho("");
    setEnviando(true);

    const concluir = (estado: EstadoDoPedido, resposta: Omit<Mensagem, "id" | "autor">) => {
      setPedidos((atual) =>
        atual.map((p) => (p.id === id ? { ...p, estado, protocolo: resposta.protocolo ?? null } : p)),
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
        body: JSON.stringify({ prompt: limpo }),
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
      } else {
        // A frase do servidor já vem no idioma da pessoa e diz o que fazer.
        const semConfirmacao = res.status === 504;
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

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
                {t("O motor monta a campanha do lado dele. O resultado ainda não aparece nesta tela.")}
              </Passo>
            </ol>
          </CardContent>
        </Card>

        <Card data-testid="aios-pedidos">
          <CardHeader className="pb-3">
            <CardTitle>{t("Pedidos desta sessão")}</CardTitle>
            <CardDescription>{t("A lista recomeça quando a página é recarregada.")}</CardDescription>
          </CardHeader>
          <CardContent>
            {pedidos.length === 0 ? (
              <p className="text-sm text-text-subtle">{t("Nenhum pedido enviado ainda.")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {pedidos.map((p) => (
                  <li
                    key={p.id}
                    data-testid="aios-pedido"
                    data-estado={p.estado}
                    className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-text-subtle tabular-nums">#{p.numero}</span>
                      <Badge variant={VARIANTE_DO_ESTADO[p.estado]}>{t(ROTULO_DO_ESTADO[p.estado])}</Badge>
                    </div>
                    <p className="line-clamp-2 text-sm break-words text-text">{p.texto}</p>
                    {p.protocolo && (
                      <p className="font-mono text-[11px] break-all text-text-subtle">{p.protocolo}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
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
