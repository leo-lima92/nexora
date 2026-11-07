"use client";

/**
 * FORK NEXORA — o Copiloto (Ask AI): o painel lateral que ajuda a CONFIGURAR a
 * plataforma conversando — funis, automações e agentes SDR.
 *
 * ─── O que existe hoje: só a interface ──────────────────────────────────────
 *
 * Esta é a fundação visual. Não há chamada de API, modelo nem ferramenta: as
 * bolhas abertas são um exemplo fixo, e o que a pessoa envia aparece na conversa
 * mas não recebe resposta. A tela DIZ isso (selo "Prévia" e a linha embaixo do
 * campo) — anunciar um copiloto que não responde seria o "não anunciar o que não
 * existe" da doutrina de extensões ao contrário. Quando a conexão vier, o ponto
 * de troca é `enviar()`, e só ele.
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
 * fecha, que é o uso esperado (perguntar "como faço isto?" olhando a tela).
 *
 * ─── Por que o fundo é zinco fixo, e não token do tema ──────────────────────
 *
 * A área do copiloto é escura nos DOIS temas, de propósito: é a superfície que
 * se distingue do produto, como um console ao lado da tela. Os tokens de
 * `app/globals.css` acompanham claro/escuro e fariam o painel sumir no fundo da
 * página no tema escuro. O acento (o botão de enviar, a bolha da pessoa) segue
 * a marca (`bg-primary`), para a cor da empresa continuar valendo.
 */
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
import { PaperPlaneTilt, Sparkle, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

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
interface Mensagem {
  id: string;
  autor: Autor;
  texto: string;
}

/** O painel. Mora no AppShell, fora do `<header>` (ver o cabeçalho deste arquivo). */
export function AskAIPainel() {
  const t = useT();
  const ctx = useContext(AskAIContext);
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const conversaRef = useRef<HTMLDivElement | null>(null);
  const [rascunho, setRascunho] = useState("");
  // Só o que a pessoa escreveu nesta sessão. O exemplo fixo é desenhado à parte,
  // e nada disto sai do navegador.
  const [enviadas, setEnviadas] = useState<Mensagem[]>([]);

  const aberto = ctx?.aberto ?? false;
  const fechar = ctx?.fechar;
  const botaoRef = ctx?.botaoRef;

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
    if (enviadas.length > 0 && caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [enviadas.length]);

  if (!ctx) return null;

  const enviar = (texto: string) => {
    const limpo = texto.trim();
    if (!limpo) return;
    setEnviadas((atual) => [...atual, { id: `${Date.now()}-${atual.length}`, autor: "pessoa", texto: limpo }]);
    setRascunho("");
  };

  const aoEnviar = (e: FormEvent) => {
    e.preventDefault();
    enviar(rascunho);
  };

  // Enter envia; Shift+Enter quebra a linha — o mesmo contrato do composer do Inbox.
  const aoTeclarNoCampo = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar(rascunho);
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
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-zinc-50">{t("Copiloto")}</h2>
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
              {t("Prévia")}
            </span>
          </div>
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
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
      >
        {/* Exemplo fixo da conversa — a fundação visual, sem modelo por trás. */}
        <BolhaDoCopiloto>
          {t("Olá! Eu ajudo a configurar a plataforma. O que você quer montar hoje?")}
        </BolhaDoCopiloto>
        <BolhaDaPessoa>
          {t("Quero um funil para a minha clínica, com um agente SDR que qualifica os pacientes.")}
        </BolhaDaPessoa>
        <BolhaDoCopiloto>
          <p>{t("Ótimo. Eu proporia três passos:")}</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            <PassoSugerido numero={1}>
              {t("Criar o funil com as etapas Novo contato, Qualificado, Agendado e Compareceu.")}
            </PassoSugerido>
            <PassoSugerido numero={2}>
              {t("Montar uma automação que move o card quando o horário é marcado.")}
            </PassoSugerido>
            <PassoSugerido numero={3}>
              {t("Configurar o agente SDR com as perguntas de qualificação da clínica.")}
            </PassoSugerido>
          </ol>
          <p className="mt-2">{t("Quer que eu comece pelo funil?")}</p>
        </BolhaDoCopiloto>

        {enviadas.map((m) => (
          <BolhaDaPessoa key={m.id}>{m.texto}</BolhaDaPessoa>
        ))}
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
            aria-label={t("Mensagem para o copiloto")}
            placeholder={t("Escreva o que você quer configurar…")}
            data-testid="ask-ai-campo"
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden"
          />
          <button
            type="submit"
            disabled={!rascunho.trim()}
            aria-label={t("Enviar")}
            data-testid="ask-ai-enviar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-35"
          >
            <PaperPlaneTilt size={16} weight="fill" aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          {t("Esta é uma prévia da interface: o copiloto ainda não responde.")}
        </p>
      </div>
    </aside>
  );
}

function BolhaDoCopiloto({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700/60"
      >
        <Sparkle size={12} weight="fill" />
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-200">
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

function PassoSugerido({ numero, children }: { numero: number; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span
        aria-hidden
        className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-zinc-300"
      >
        {numero}
      </span>
      <span>{children}</span>
    </li>
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
