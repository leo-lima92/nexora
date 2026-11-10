// FORK NEXORA — O COPILOTO (Ask AI): a interface ───────────────────────────
//
// O que este arquivo mede é o CONTRATO da casca: o botão da barra abre e fecha o
// painel, o painel fechado não recebe foco nem é lido (inert), o foco vai ao
// campo ao abrir e volta ao botão ao fechar, o Esc fecha (mas não quando outro
// diálogo já o tratou).
//
// E a CONEXÃO: o envio vai para `POST /api/v1/ask-ai` com o histórico, o painel
// diz "Pensando…" e o passo da ferramenta enquanto o stream não termina, a
// resposta entra na conversa com o atalho do funil criado, e toda falha aparece
// NA CONVERSA — nunca um painel mudo. O stream dos testes é um ReadableStream de
// verdade, alimentado à mão, para medir o estado intermediário.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AskAIBotao, AskAIPainel, AskAIProvider, ROTA_DO_COPILOTO } from "@/components/ask-ai/AskAI";
import { linhaDoEvento, type EventoDoCopiloto } from "@/lib/copiloto/eventos";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

/** Um corpo NDJSON que o teste alimenta evento a evento. */
function streamManual() {
  let controle!: ReadableStreamDefaultController<Uint8Array>;
  const corpo = new ReadableStream<Uint8Array>({
    start(c) {
      controle = c;
    },
  });
  const enc = new TextEncoder();
  return {
    resposta: new Response(corpo, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }),
    emitir: (e: EventoDoCopiloto) => controle.enqueue(enc.encode(linhaDoEvento(e))),
    fechar: () => controle.close(),
  };
}

function respostaDeEventos(eventos: EventoDoCopiloto[]) {
  const s = streamManual();
  for (const e of eventos) s.emitir(e);
  s.fechar();
  return s.resposta;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function montar() {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(
    <AskAIProvider>
      <AskAIBotao />
      <AskAIPainel />
    </AskAIProvider>,
  );
  return {
    fetch,
    botao: screen.getByTestId("ask-ai-botao"),
    painel: screen.getByTestId("ask-ai-painel"),
    campo: screen.getByTestId("ask-ai-campo") as HTMLTextAreaElement,
    enviar: screen.getByTestId("ask-ai-enviar") as HTMLButtonElement,
  };
}

describe("Copiloto (Ask AI) — casca da interface", () => {
  it("nasce fechado: o painel não recebe foco nem é lido", () => {
    const { botao, painel } = montar();
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.getAttribute("aria-controls")).toBe(painel.id);
    expect(painel.dataset.aberto).toBe("false");
    expect(painel.hasAttribute("inert")).toBe(true);
    expect(painel.getAttribute("aria-hidden")).toBe("true");
  });

  it("o botão abre, o foco vai ao campo, e o botão fecha de novo", () => {
    const { botao, painel, campo } = montar();
    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(painel.dataset.aberto).toBe("true");
    expect(painel.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(campo);

    fireEvent.click(botao);
    expect(painel.dataset.aberto).toBe("false");
  });

  it("Esc fecha e devolve o foco ao botão — mas não quando outro diálogo já tratou o Esc", () => {
    const { botao, painel } = montar();
    fireEvent.click(botao);

    const tratado = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    tratado.preventDefault();
    act(() => {
      window.dispatchEvent(tratado);
    });
    expect(painel.dataset.aberto, "fechou junto com o diálogo de cima").toBe("true");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(painel.dataset.aberto).toBe("false");
    expect(document.activeElement).toBe(botao);
  });

  it("o X do cabeçalho fecha", () => {
    const { botao, painel } = montar();
    fireEvent.click(botao);
    fireEvent.click(screen.getByTestId("ask-ai-fechar"));
    expect(painel.dataset.aberto).toBe("false");
  });

  it("enviar: vazio não envia; Enter manda o histórico à rota, mostra Pensando… e depois a resposta", async () => {
    const { botao, campo, enviar, fetch } = montar();
    const s = streamManual();
    fetch.mockResolvedValue(s.resposta);
    fireEvent.click(botao);
    expect(enviar.disabled).toBe(true);

    fireEvent.change(campo, { target: { value: "  Criar um funil de imobiliária  " } });
    expect(enviar.disabled).toBe(false);
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(screen.getByText("Criar um funil de imobiliária")).toBeTruthy();
    expect(campo.value).toBe("");
    expect(screen.getByTestId("ask-ai-pensando").textContent).toContain("Pensando…");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(ROTA_DO_COPILOTO);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      mensagens: [{ papel: "pessoa", texto: "Criar um funil de imobiliária" }],
    });

    // Ocupado: um segundo envio não sai enquanto o primeiro não terminou.
    fireEvent.change(campo, { target: { value: "outra" } });
    expect(enviar.disabled).toBe(true);

    await act(async () => {
      s.emitir({ tipo: "inicio", request_id: "r1" });
      s.emitir({ tipo: "ferramenta", estado: "inicio", nome: "listar_funis" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("ask-ai-pensando").textContent).toContain("Consultando seus funis…"),
    );

    await act(async () => {
      s.emitir({ tipo: "ferramenta", estado: "fim", nome: "listar_funis", ok: true });
      s.emitir({ tipo: "resposta", texto: "Proponho as etapas Lead, Visita e Proposta. Posso criar?" });
      s.emitir({ tipo: "fim" });
      s.fechar();
    });
    await waitFor(() => expect(screen.queryByTestId("ask-ai-pensando")).toBeNull());
    expect(screen.getByText("Proponho as etapas Lead, Visita e Proposta. Posso criar?")).toBeTruthy();
  });

  it("o histórico do segundo turno leva a resposta anterior; o funil criado ganha o atalho do quadro", async () => {
    const { botao, campo, fetch } = montar();
    fetch
      .mockResolvedValueOnce(respostaDeEventos([{ tipo: "resposta", texto: "Posso criar o funil Imóveis?" }, { tipo: "fim" }]))
      .mockResolvedValueOnce(
        respostaDeEventos([
          { tipo: "funil_criado", pipeline_id: "p-123", nome: "Imóveis", etapas: ["Lead", "Ganho", "Perdido"] },
          { tipo: "resposta", texto: "Criei o funil Imóveis." },
          { tipo: "fim" },
        ]),
      );
    fireEvent.click(botao);

    fireEvent.change(campo, { target: { value: "Quero um funil de imóveis" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText("Posso criar o funil Imóveis?");

    fireEvent.change(campo, { target: { value: "Pode criar" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText("Criei o funil Imóveis.");

    expect(JSON.parse((fetch.mock.calls[1]![1] as RequestInit).body as string)).toEqual({
      mensagens: [
        { papel: "pessoa", texto: "Quero um funil de imóveis" },
        { papel: "copiloto", texto: "Posso criar o funil Imóveis?" },
        { papel: "pessoa", texto: "Pode criar" },
      ],
    });
    const atalho = screen.getByTestId("ask-ai-funil-criado");
    expect(atalho.getAttribute("href")).toBe("/app/pipelines/p-123");
    expect(atalho.textContent).toContain("Imóveis");
  });

  it("recusa antes do stream (envelope de erro) aparece na conversa com a frase do servidor", async () => {
    const { botao, campo, fetch } = montar();
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "rate_limited", message: "Muitas perguntas seguidas. Tente em um minuto." } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fireEvent.click(botao);
    fireEvent.change(campo, { target: { value: "oi" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText("Muitas perguntas seguidas. Tente em um minuto.");
    expect(screen.queryByTestId("ask-ai-pensando")).toBeNull();
  });

  it("evento de erro aparece na conversa e NÃO volta ao modelo no turno seguinte", async () => {
    const { botao, campo, fetch } = montar();
    fetch
      .mockResolvedValueOnce(
        respostaDeEventos([
          { tipo: "erro", codigo: "llm_not_configured", mensagem: "Nenhum provedor de IA está configurado." },
          { tipo: "fim" },
        ]),
      )
      .mockResolvedValueOnce(respostaDeEventos([{ tipo: "resposta", texto: "Agora sim." }, { tipo: "fim" }]));
    fireEvent.click(botao);
    fireEvent.change(campo, { target: { value: "primeira" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText("Nenhum provedor de IA está configurado.");

    fireEvent.change(campo, { target: { value: "segunda" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText("Agora sim.");
    expect(JSON.parse((fetch.mock.calls[1]![1] as RequestInit).body as string).mensagens).toEqual([
      { papel: "pessoa", texto: "primeira" },
      { papel: "pessoa", texto: "segunda" },
    ]);
  });

  it("stream que fecha sem resposta nem erro: a tela avisa em vez de ficar muda", async () => {
    const { botao, campo, fetch } = montar();
    fetch.mockResolvedValue(respostaDeEventos([{ tipo: "inicio", request_id: "r" }]));
    fireEvent.click(botao);
    fireEvent.change(campo, { target: { value: "oi" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByText("A conexão com o Copiloto caiu antes da resposta. Tente de novo.");
  });

  it("Shift+Enter quebra a linha em vez de enviar", () => {
    const { botao, campo } = montar();
    fireEvent.click(botao);
    fireEvent.change(campo, { target: { value: "linha 1" } });
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(campo.value).toBe("linha 1");
  });

  it("a sugestão preenche o campo", () => {
    const { botao, campo } = montar();
    fireEvent.click(botao);
    fireEvent.click(screen.getByRole("button", { name: "Configurar um agente SDR" }));
    expect(campo.value).toBe("Configurar um agente SDR");
  });

  it("fora do provider o botão não desenha nada (a barra pode ser reusada sem o copiloto)", () => {
    const { container } = render(<AskAIBotao />);
    expect(container.innerHTML).toBe("");
  });

  it("segue o idioma da pessoa", () => {
    render(
      <IdiomaProvider locale="es">
        <AskAIProvider>
          <AskAIBotao />
          <AskAIPainel />
        </AskAIProvider>
      </IdiomaProvider>,
    );
    expect(screen.getByTestId("ask-ai-botao").getAttribute("aria-label")).toBe("Abrir el copiloto");
    expect(screen.getByPlaceholderText("Escribe lo que quieres configurar…")).toBeTruthy();
  });

  it("não se anuncia mais como prévia, e diz que cria funil só com confirmação e que consome IA", () => {
    montar();
    expect(screen.queryByText("Prévia")).toBeNull();
    expect(screen.queryByText(/ainda não responde/)).toBeNull();
    expect(
      screen.getByText(
        "O Copiloto pode criar funis na sua organização, sempre depois de você confirmar. O uso conta no consumo de IA da empresa.",
      ),
    ).toBeTruthy();
  });
});
