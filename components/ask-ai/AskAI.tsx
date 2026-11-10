"use client";

/**
 * FORK NEXORA — o Copiloto (Ask AI): o painel lateral que ajuda a CONFIGURAR a
 * plataforma conversando — funis, automações e agentes SDR.
 *
 * ─── Como ele responde ──────────────────────────────────────────────────────
 *
 * `enviar()` manda o histórico da conversa para `POST /api/v1/ask-ai` e lê a
 * resposta como stream NDJSON (`lib/copiloto/eventos.ts`). Enquanto o modelo
 * trabalha, o painel diz o que está acontecendo — "Pensando…", e depois o passo
 * de cada ferramenta ("Consultando seus funis…", "Criando o funil…"). Quando um
 * funil nasce, a resposta ganha o atalho para o quadro dele.
 *
 * O texto do assistente chega inteiro no fim, e não token a token: toda chamada
 * de modelo passa pelo seam que confere orçamento e plano antes de sair e grava
 * o custo depois (ver o cabeçalho de `lib/copiloto/eventos.ts`).
 *
 * A conversa vive SÓ neste painel (estado do React). Nada fica gravado no
 * servidor além da linha de custo e do audit sem texto; recarregar a página
 * começa uma conversa nova.
 *
 * ─── Por que três peças, e não um componente só ─────────────────────────────
 *
 * O botão mora na barra do topo (`components/shell/TopBar.tsx`), que é a
 * navegação presente em toda tela do `/app`. O painel NÃO pode morar ali: o
 * `<header>` tem `backdrop-blur`, e `backdrop-filter` vira o containing block de
 * todo descendente `position: fixed` — o painel ficaria preso aos 56px da barra.
 * Por isso o painel é irmão do conteúdo no `AppShell`, e os dois conversam pelo
 * contexto (`AskAIProvider`). O AppShell é do layout do `/app`, então o estado
 * sobrevive à navegação entre telas: abrir o copiloto e trocar de página não o
 * fecha — e uma resposta em andamento não se perde.
 *
 * ─── Por que o fundo é zinco fixo, e não token do tema ──────────────────────
 *
 * A área do copiloto é escura nos DOIS temas, de propósito: é a superfície que
 * se distingue do produto, como um console ao lado da tela. Os tokens de
 * `app/globals.css` acompanham claro/escuro e fariam o painel sumir no fundo da
 * página no tema escuro. O acento (o botão de enviar, a bolha da pessoa) segue
 * a marca (`bg-primary`), para a cor da empresa continuar valendo.
 */
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useT } from "@/hooks/i18n/useT";
import { HEADER_ORG_DA_ABA, orgDaAba } from "@/lib/auth/org-da-aba";
import { lerEventos, ROTULO_DA_FERRAMENTA, type NomeDaFerramenta } from "@/lib/copiloto/eventos";
import { randomId } from "@/lib/random-id";
import { PaperPlaneTilt, Sparkle, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/** A rota do Copiloto. Exportada para o teste conferir o contrato. */
export const ROTA_DO_COPILOTO = "/api/v1/ask-ai";

interface ContextoDoAskAI {
  aberto: boolean;
  abrir: () => void;
  fechar: () => void;
  alternar: () => void;
  /** O id do painel, para o `aria-controls` do botão. */
  painelId: string;
  /** O botão que abriu, para o foco voltar a ele quando o painel fecha. */
  botaoRef: RefObject<HTMLButtonElement | null>;
}

const AskAIContext = createContext<ContextoDoAskAI | null>(null);

export function AskAIProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const abrir = useCallback(() => setAberto(true), []);
  const fechar = useCallback(() => setAberto(false), []);
  const alternar = useCallback(() => setAberto((v) => !v), []);
  const valor = useMemo(
    () => ({ aberto, abrir, fechar, alternar, painelId, botaoRef }),
    [aberto, abrir, fechar, alternar, painelId],
  );
  return <AskAIContext.Provider value={valor}>{children}</AskAIContext.Provider>;
}

/** O botão da barra do topo. Fora do provider não desenha nada — não quebra quem reusa a barra. */
export function AskAIBotao() {
  const t = useT();
  const ctx = useContext(AskAIContext);
  if (!ctx) return null;
  const { aberto, alternar, painelId, botaoRef } = ctx;
  return (
    <button
      ref={botaoRef}
      type="button"
      onClick={alternar}
      aria-expanded={aberto}
      aria-controls={painelId}
      aria-label={aberto ? t("Fechar o copiloto") : t("Abrir o copiloto")}
      data-testid="ask-ai-botao"
      className={cn(
        "inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors lg:h-9",
        aberto
          ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-800"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Sparkle size={18} weight={aberto ? "fill" : "regular"} aria-hidden />
      {/* O rótulo some no celular: ali a barra já divide espaço com a busca. */}
      <span className="hidden md:inline">{t("Copiloto")}</span>
    </button>
  );
}

type Autor = "copiloto" | "pessoa";
interface FunilCriadoNaConversa {
  id: string;
  nome: string;
}
interface Mensagem {
  id: string;
  autor: Autor;
  texto: string;
  /** Aviso de falha: aparece na conversa, mas NÃO volta ao modelo como histórico. */
  erro?: boolean;
  funis?: FunilCriadoNaConversa[];
}

/** O que está acontecendo enquanto a resposta não chega. `null` = parado. */
type Andamento = { fase: "pensando" } | { fase: "ferramenta"; nome: NomeDaFerramenta } | null;

/** O painel. Mora no AppShell, fora do `<header>` (ver o cabeçalho deste arquivo). */
export function AskAIPainel() {
  const t = useT();
  const ctx = useContext(AskAIContext);
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const conversaRef = useRef<HTMLDivElement | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [andamento, setAndamento] = useState<Andamento>(null);
  // A requisição em voo: cancelada só quando o painel sai da tela de vez
  // (logout, troca de layout), nunca ao fechar — fechar não pode jogar fora a
  // resposta que já está sendo paga.
  const emVoo = useRef<AbortController | null>(null);
  useEffect(() => () => emVoo.current?.abort(), []);

  const aberto = ctx?.aberto ?? false;
  const fechar = ctx?.fechar;
  const botaoRef = ctx?.botaoRef;
  const ocupado = andamento !== null;

  // Abrir leva o foco ao campo; fechar o devolve ao botão que abriu — sem isto,
  // quem navega por teclado cai no topo da página a cada fechamento.
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (aberto) {
      jaAbriu.current = true;
      campoRef.current?.focus();
    } else if (jaAbriu.current) {
      botaoRef?.current?.focus();
    }
  }, [aberto, botaoRef]);

  useEffect(() => {
    if (!aberto || !fechar) return;
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      // `defaultPrevented`: um diálogo aberto por cima (a busca, um modal) já
      // tratou este Esc — fechar o copiloto junto seria fechar duas coisas.
      if (e.key === "Escape" && !e.defaultPrevented) fechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, fechar]);

  // Rola SÓ a caixa da conversa. `scrollIntoView` rolaria todo ancestral
  // rolável — e na montagem o painel está fechado, fora da tela.
  useEffect(() => {
    const caixa = conversaRef.current;
    if ((mensagens.length > 0 || andamento) && caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [mensagens.length, andamento]);

  if (!ctx) return null;

  const acrescentar = (m: Omit<Mensagem, "id">) =>
    setMensagens((atual) => [...atual, { ...m, id: `${Date.now()}-${atual.length}` }]);

  const enviar = async (texto: string) => {
    const limpo = texto.trim();
    if (!limpo || ocupado) return;

    const pergunta: Mensagem = { id: `${Date.now()}-p`, autor: "pessoa", texto: limpo };
    // O histórico que vai ao modelo: a conversa real, sem os avisos de falha.
    const historico = [...mensagens, pergunta]
      .filter((m) => !m.erro)
      .map((m) => ({ papel: m.autor, texto: m.texto }));
    setMensagens((atual) => [...atual, pergunta]);
    setRascunho("");
    setAndamento({ fase: "pensando" });

    const controle = new AbortController();
    emVoo.current = controle;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-Id": randomId(),
    };
    // A organização desta aba, como o `apiClient` faz em toda escrita: o
    // Copiloto cria funil, e a recusa `org_divergente` precisa valer aqui também.
    const aba = orgDaAba();
    if (aba?.orgId) headers[HEADER_ORG_DA_ABA] = aba.orgId;

    const falhar = (mensagem: string) => acrescentar({ autor: "copiloto", texto: mensagem, erro: true });

    try {
      const res = await fetch(ROTA_DO_COPILOTO, {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ mensagens: historico }),
        signal: controle.signal,
      });

      // Recusa antes de abrir o stream (sessão, papel, ritmo, corpo) vem no
      // envelope de erro de sempre — a frase do servidor já vem no idioma.
      if (!res.ok || !res.body) {
        let mensagem = t("O Copiloto não conseguiu responder agora. Tente de novo em instantes.");
        try {
          const corpo = (await res.json()) as { error?: { message?: string } };
          if (corpo.error?.message) mensagem = corpo.error.message;
        } catch {
          // Corpo sem JSON (proxy, queda): fica a frase genérica.
        }
        falhar(mensagem);
        return;
      }

      const funis: FunilCriadoNaConversa[] = [];
      let respondeu = false;
      for await (const evento of lerEventos(res.body)) {
        if (evento.tipo === "ferramenta" && evento.estado === "inicio") {
          setAndamento({ fase: "ferramenta", nome: evento.nome });
        } else if (evento.tipo === "ferramenta" && evento.estado === "fim") {
          setAndamento({ fase: "pensando" });
        } else if (evento.tipo === "funil_criado") {
          funis.push({ id: evento.pipeline_id, nome: evento.nome });
        } else if (evento.tipo === "resposta") {
          respondeu = true;
          acrescentar({ autor: "copiloto", texto: evento.texto, funis: funis.length ? [...funis] : undefined });
        } else if (evento.tipo === "erro") {
          respondeu = true;
          falhar(evento.mensagem);
        }
      }
      // O stream fechou sem resposta nem erro: a conexão caiu no meio.
      if (!respondeu) {
        falhar(t("A conexão com o Copiloto caiu antes da resposta. Tente de novo."));
      }
    } catch (erro) {
      if ((erro as { name?: string }).name !== "AbortError") {
        falhar(t("O Copiloto não conseguiu responder agora. Tente de novo em instantes."));
      }
    } finally {
      if (emVoo.current === controle) emVoo.current = null;
      setAndamento(null);
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
    <aside
      id={ctx.painelId}
      aria-label={t("Copiloto")}
      aria-hidden={!aberto}
      // `inert` fechado: o painel continua no DOM para a transição, mas o Tab
      // não entra nele e o leitor de tela não o lê.
      inert={!aberto}
      data-testid="ask-ai-painel"
      data-aberto={aberto ? "true" : "false"}
      className={cn(
        "fixed top-[var(--faixas-de-cima,0px)] right-0 bottom-0 z-[46] flex w-full flex-col",
        "border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/40 sm:w-[420px]",
        "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        aberto ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      <header className="flex items-start gap-3 border-b border-zinc-800/80 px-5 py-4">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary/90 to-primary/50 text-primary-foreground ring-1 ring-white/10"
        >
          <Sparkle size={18} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-50">{t("Copiloto")}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
            {t("Ajuda para configurar a plataforma: funis, automações e agentes SDR.")}
          </p>
        </div>
        <button
          type="button"
          onClick={ctx.fechar}
          aria-label={t("Fechar o copiloto")}
          data-testid="ask-ai-fechar"
          className="-mt-1 -mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      <div
        ref={conversaRef}
        role="log"
        aria-label={t("Conversa com o copiloto")}
        aria-live="polite"
        aria-busy={ocupado}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
      >
        {/* A saudação é da tela, não do modelo: não entra no histórico enviado. */}
        <BolhaDoCopiloto>
          {t("Olá! Eu ajudo a configurar a plataforma. O que você quer montar hoje?")}
        </BolhaDoCopiloto>

        {mensagens.map((m) =>
          m.autor === "pessoa" ? (
            <BolhaDaPessoa key={m.id}>{m.texto}</BolhaDaPessoa>
          ) : (
            <BolhaDoCopiloto key={m.id} erro={m.erro}>
              <p className="break-words whitespace-pre-wrap">{m.texto}</p>
              {m.funis?.map((f) => (
                <Link
                  key={f.id}
                  href={`/app/pipelines/${f.id}`}
                  data-testid="ask-ai-funil-criado"
                  className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
                >
                  <span className="min-w-0 truncate font-medium">{f.nome}</span>
                  <span className="shrink-0 text-zinc-400">{t("Abrir o quadro")} →</span>
                </Link>
              ))}
            </BolhaDoCopiloto>
          ),
        )}

        {andamento && (
          <div data-testid="ask-ai-pensando" role="status">
            <BolhaDoCopiloto>
              <span className="inline-flex items-center gap-2 text-zinc-400">
                <PontosAnimados />
                {andamento.fase === "ferramenta"
                  ? t(ROTULO_DA_FERRAMENTA[andamento.nome])
                  : t("Pensando…")}
              </span>
            </BolhaDoCopiloto>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800/80 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{t("Sugestões")}</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Sugestao onEscolher={setRascunho} campoRef={campoRef}>
            {t("Criar um funil")}
          </Sugestao>
          <Sugestao onEscolher={setRascunho} campoRef={campoRef}>
            {t("Montar uma automação")}
          </Sugestao>
          <Sugestao onEscolher={setRascunho} campoRef={campoRef}>
            {t("Configurar um agente SDR")}
          </Sugestao>
        </div>

        <form
          onSubmit={aoEnviar}
          className="flex items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 transition-colors focus-within:border-zinc-600"
        >
          <textarea
            ref={campoRef}
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={aoTeclarNoCampo}
            rows={2}
            maxLength={4000}
            aria-label={t("Mensagem para o copiloto")}
            placeholder={t("Escreva o que você quer configurar…")}
            data-testid="ask-ai-campo"
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden"
          />
          <button
            type="submit"
            disabled={!rascunho.trim() || ocupado}
            aria-label={t("Enviar")}
            data-testid="ask-ai-enviar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-35"
          >
            <PaperPlaneTilt size={16} weight="fill" aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          {t("O Copiloto pode criar funis na sua organização, sempre depois de você confirmar. O uso conta no consumo de IA da empresa.")}
        </p>
      </div>
    </aside>
  );
}

function BolhaDoCopiloto({ children, erro = false }: { children: ReactNode; erro?: boolean }) {
  return (
    <div className="flex items-start gap-2.5" data-erro={erro ? "true" : undefined}>
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700/60"
      >
        <Sparkle size={12} weight="fill" />
      </span>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-tl-sm border px-3.5 py-2.5 text-sm leading-relaxed",
          erro ? "border-amber-500/40 bg-amber-950/40 text-amber-100" : "border-zinc-800 bg-zinc-900 text-zinc-200",
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

/** Os três pontos do "pensando". Parados com movimento reduzido. */
function PontosAnimados() {
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 150, 300].map((atraso) => (
        <span
          key={atraso}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 motion-reduce:animate-none"
          style={{ animationDelay: `${atraso}ms` }}
        />
      ))}
    </span>
  );
}

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
      className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
    >
      {children}
    </button>
  );
}
