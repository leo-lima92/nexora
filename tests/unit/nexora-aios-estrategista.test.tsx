// FORK NEXORA — TRÁFEGO AIOS: a conversa com o Estrategista de Tráfego ───────
//
// O que este arquivo mede é a LIGAÇÃO da tela com `/api/v1/aios-dispatch`:
//
//  O ENVIO (POST)
//  - leva `{ prompt, request_id }` — organização e pessoa são da sessão, e o
//    `request_id` é o id que a tela gera para o pedido;
//  - enquanto a rota não responde, a conversa diz "Enviando instruções para o
//    motor de IA…" e o botão trava (um pedido sai uma vez só);
//  - o aceite vira bolha com a frase e o protocolo do motor;
//  - a falha aparece NA CONVERSA: a recusa devolve o texto ao campo, e o 504
//    (sem confirmação) NÃO devolve, porque reenviar pode duplicar a campanha.
//
//  O RETORNO (GET)
//  - ao abrir, a tela busca os pedidos da organização e mostra o status e a
//    resposta do motor de cada um;
//  - o botão Atualizar lê de novo; com pedido em aberto a tela lê sozinha, e
//    para quando não sobra nenhum;
//  - a resposta do pedido feito NESTA sessão entra também na conversa, uma vez.
//
// O `fetch` é dublê, separado por método: `despacho` é o POST e `lista` é o
// GET. As respostas são seguradas pelo teste quando o que se mede é o estado do
// meio — o que a pessoa vê enquanto espera.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ESPERA_MINIMA_MS,
  EstrategistaDeTrafego,
  ROTA_DO_DESPACHO,
} from "@/components/aios/EstrategistaDeTrafego";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

/** Uma resposta que só chega quando o teste manda. */
function respostaSegurada() {
  let liberar!: (r: Response) => void;
  const promessa = new Promise<Response>((r) => (liberar = r));
  return { promessa, liberar };
}

let serie = 0;
/** Uma linha de `aios_campaign_requests`, como o GET a devolve. */
function pedido(extra: Record<string, unknown> = {}) {
  serie += 1;
  const n = String(serie).padStart(12, "0");
  return {
    id: `aaaaaaaa-0000-4000-8000-${n}`,
    request_id: `pedido-${n}`,
    user_id: "11111111-1111-4111-8111-111111111111",
    prompt: "Campanha de leads para clínica",
    status: "queued",
    engine_job_id: null,
    response_summary: null,
    campaign_metadata: {},
    error_message: null,
    created_at: "2026-11-11T12:00:00.000000+00:00",
    updated_at: "2026-11-11T12:00:00.000000+00:00",
    ...extra,
  };
}

function pagina(pedidos: unknown[], cursor: string | null = null) {
  return json({ data: pedidos, meta: { cursor, has_more: cursor !== null } });
}

type Lista = ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

/**
 * Monta a tela com os dois dublês. Sem `pedidos`, a organização não tem
 * histórico. `preparar` mexe na `lista` ANTES de a tela abrir — é como um teste
 * decide o que a primeira leitura devolve.
 */
function montar(pedidos: unknown[] = [], preparar?: (lista: Lista) => void) {
  const despacho = vi.fn();
  const lista: Lista = vi.fn(async () => pagina(pedidos));
  preparar?.(lista);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => (init?.method === "POST" ? despacho(url, init) : lista(url))),
  );
  render(<EstrategistaDeTrafego />);
  return {
    despacho,
    lista,
    campo: screen.getByTestId("aios-campo") as HTMLTextAreaElement,
    enviar: screen.getByTestId("aios-enviar") as HTMLButtonElement,
  };
}

function escrever(campo: HTMLTextAreaElement, texto: string) {
  fireEvent.change(campo, { target: { value: texto } });
}

const conversa = () => screen.getByRole("log", { name: "Conversa com o Estrategista de Tráfego" });
const pedidosNaTela = () => screen.queryAllByTestId("aios-pedido");

describe("Estrategista de Tráfego — a tela parada", () => {
  it("nasce com a saudação e o envio travado, e busca os pedidos da organização", async () => {
    const { enviar, despacho, lista } = montar();
    expect(conversa()).toBeTruthy();
    expect(screen.getByText(/Conte o que você quer anunciar/)).toBeTruthy();
    expect(enviar.disabled).toBe(true);
    expect(screen.queryByTestId("aios-enviando")).toBeNull();

    expect(await screen.findByText("Nenhum pedido enviado ainda.")).toBeTruthy();
    expect(lista).toHaveBeenCalledTimes(1);
    expect(lista.mock.calls[0]![0]).toBe(ROTA_DO_DESPACHO);
    expect(despacho).not.toHaveBeenCalled();
  });

  it("enquanto os pedidos não chegam, diz que está carregando — e não que não há nenhum", async () => {
    const espera = respostaSegurada();
    montar([], (lista) => lista.mockReturnValueOnce(espera.promessa));
    expect(screen.getByText("Carregando pedidos…")).toBeTruthy();
    expect(screen.queryByText("Nenhum pedido enviado ainda.")).toBeNull();

    await act(async () => espera.liberar(pagina([])));
    expect(await screen.findByText("Nenhum pedido enviado ainda.")).toBeTruthy();
    expect(screen.queryByText("Carregando pedidos…")).toBeNull();
  });

  it("a sugestão preenche o campo, sem enviar", () => {
    const { campo, enviar, despacho } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Campanha de leads para o WhatsApp" }));
    expect(campo.value).toBe("Campanha de leads para o WhatsApp");
    expect(enviar.disabled).toBe(false);
    expect(despacho).not.toHaveBeenCalled();
  });

  it("espaço em branco não é pedido", () => {
    const { campo, enviar, despacho } = montar();
    escrever(campo, "   ");
    expect(enviar.disabled).toBe(true);
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(despacho).not.toHaveBeenCalled();
  });
});

describe("Estrategista de Tráfego — o histórico e a resposta do motor", () => {
  it("mostra cada pedido com o status dele, a resposta do motor e o erro, quando houver", async () => {
    montar([
      pedido({
        prompt: "Campanha de promoção",
        status: "completed",
        engine_job_id: "job-900",
        response_summary: "Campanha criada: 3 conjuntos, R$ 50 por dia.",
      }),
      pedido({ prompt: "Remarketing", status: "processing" }),
      pedido({ prompt: "Leads para o WhatsApp", status: "queued" }),
      pedido({ prompt: "Campanha de inverno", status: "failed", error_message: "A conta de anúncios está sem saldo." }),
      pedido({ prompt: "Campanha de verão", status: "unconfirmed" }),
    ]);

    await waitFor(() => expect(pedidosNaTela()).toHaveLength(5));
    const [concluido, andamento, fila, falhou, semConfirmacao] = pedidosNaTela();

    expect(concluido!.dataset.estado).toBe("completed");
    expect(concluido!.textContent).toContain("Concluído");
    expect(concluido!.textContent).toContain("Campanha de promoção");
    expect(within(concluido!).getByTestId("aios-resposta").textContent).toContain(
      "Campanha criada: 3 conjuntos, R$ 50 por dia.",
    );
    expect(concluido!.textContent).toContain("job-900");

    expect(andamento!.dataset.estado).toBe("processing");
    expect(andamento!.textContent).toContain("Em andamento");
    expect(within(andamento!).queryByTestId("aios-resposta")).toBeNull();

    expect(fila!.dataset.estado).toBe("queued");
    expect(fila!.textContent).toContain("Na fila do motor");

    expect(falhou!.dataset.estado).toBe("failed");
    expect(falhou!.textContent).toContain("Falhou");
    expect(within(falhou!).getByTestId("aios-pedido-erro").textContent).toBe("A conta de anúncios está sem saldo.");

    expect(semConfirmacao!.dataset.estado).toBe("unconfirmed");
    expect(semConfirmacao!.textContent).toContain("Sem confirmação");
    expect(semConfirmacao!.textContent).toContain("O motor não confirmou o recebimento.");
  });

  it("resposta com conteúdo aparece mesmo antes de o pedido ser concluído", async () => {
    montar([pedido({ status: "processing", response_summary: "Público definido. Montando os anúncios." })]);
    expect((await screen.findByTestId("aios-resposta")).textContent).toContain("Público definido.");
  });

  it("a resposta longa entra recolhida e abre inteira pelo botão", async () => {
    const longa = Array.from({ length: 12 }, (_, i) => `Linha ${i + 1} do plano de campanha.`).join("\n");
    montar([pedido({ status: "completed", response_summary: longa })]);

    const abrir = await screen.findByRole("button", { name: "Ver resposta completa" });
    expect(abrir.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(abrir);
    expect(screen.getByRole("button", { name: "Recolher" }).getAttribute("aria-expanded")).toBe("true");
    // Recolhida ou aberta, o texto inteiro está na página: recolher é só corte visual.
    expect(screen.getByTestId("aios-resposta").textContent).toContain("Linha 12 do plano de campanha.");
  });

  it("resposta curta não ganha botão de abrir", async () => {
    montar([pedido({ status: "completed", response_summary: "Campanha criada." })]);
    await screen.findByTestId("aios-resposta");
    expect(screen.queryByRole("button", { name: "Ver resposta completa" })).toBeNull();
  });

  it("o pedido concluído em OUTRA sessão fica no histórico, e não vira bolha na conversa", async () => {
    montar([pedido({ status: "completed", response_summary: "Campanha criada ontem." })]);
    await screen.findByTestId("aios-resposta");
    expect(within(conversa()).queryByText("Campanha criada ontem.")).toBeNull();
  });

  it("Atualizar lê de novo e troca o status na tela", async () => {
    const linha = pedido({ status: "queued" });
    const { lista } = montar([linha]);
    await waitFor(() => expect(pedidosNaTela()[0]?.dataset.estado).toBe("queued"));

    lista.mockResolvedValueOnce(pagina([{ ...linha, status: "completed", response_summary: "Campanha no ar." }]));
    fireEvent.click(screen.getByTestId("aios-atualizar"));

    await waitFor(() => expect(pedidosNaTela()[0]?.dataset.estado).toBe("completed"));
    expect(screen.getByTestId("aios-resposta").textContent).toContain("Campanha no ar.");
    expect(lista).toHaveBeenCalledTimes(2);
  });

  it("a leitura falhou: a tela avisa, e Atualizar tenta de novo", async () => {
    const { lista } = montar([], (l) =>
      l.mockResolvedValueOnce(json({ error: { code: "internal_error", message: "x" } }, 500)),
    );

    const aviso = await screen.findByTestId("aios-pedidos-erro");
    expect(aviso.textContent).toContain("Não consegui carregar os pedidos.");
    // Falha de leitura não é "nenhum pedido": a tela não afirma o que não sabe.
    expect(screen.queryByText("Nenhum pedido enviado ainda.")).toBeNull();

    lista.mockResolvedValue(pagina([pedido({ status: "completed", response_summary: "Campanha no ar." })]));
    fireEvent.click(screen.getByTestId("aios-atualizar"));

    await waitFor(() => expect(screen.queryByTestId("aios-pedidos-erro")).toBeNull());
    expect(screen.getByTestId("aios-resposta").textContent).toContain("Campanha no ar.");
  });

  it("'Ver pedidos mais antigos' pede a página seguinte pelo cursor e a põe embaixo", async () => {
    const novo = pedido({ prompt: "Pedido novo" });
    const antigo = pedido({ prompt: "Pedido antigo", created_at: "2026-11-01T09:00:00.000000+00:00" });
    const { lista } = montar([], (l) => l.mockResolvedValueOnce(pagina([novo], "cursor+da/pagina=2")));

    const mais = await screen.findByTestId("aios-mais-antigos");
    lista.mockResolvedValueOnce(pagina([antigo]));
    fireEvent.click(mais);

    await waitFor(() => expect(screen.getByText("Pedido antigo")).toBeTruthy());
    expect(lista.mock.calls[1]![0]).toBe(`${ROTA_DO_DESPACHO}?cursor=${encodeURIComponent("cursor+da/pagina=2")}`);
    expect(pedidosNaTela().map((li) => li.textContent)).toEqual([
      expect.stringContaining("Pedido novo"),
      expect.stringContaining("Pedido antigo"),
    ]);
    // Acabou a lista: o botão some.
    expect(screen.queryByTestId("aios-mais-antigos")).toBeNull();
  });
});

describe("Estrategista de Tráfego — a consulta automática", () => {
  /** Deixa as promessas pendentes resolverem e o relógio andar `ms`. */
  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("com pedido em aberto a tela lê de novo sozinha, espaça quando nada muda e para quando ele conclui", async () => {
    vi.useFakeTimers();
    const linha = pedido({ status: "queued" });
    const { lista } = montar([linha]);
    await passar(0);
    expect(lista).toHaveBeenCalledTimes(1);

    // A primeira releitura vem na espera mínima — nem antes…
    await passar(ESPERA_MINIMA_MS - 1);
    expect(lista).toHaveBeenCalledTimes(1);
    await passar(1);
    expect(lista).toHaveBeenCalledTimes(2);

    // …e, como nada mudou, a seguinte demora mais que a mínima.
    await passar(ESPERA_MINIMA_MS);
    expect(lista).toHaveBeenCalledTimes(2);
    lista.mockResolvedValueOnce(pagina([{ ...linha, status: "completed", response_summary: "Campanha no ar." }]));
    await passar(ESPERA_MINIMA_MS);
    expect(lista).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("aios-resposta").textContent).toContain("Campanha no ar.");

    // Sem pedido em aberto, ninguém mais consulta.
    lista.mockResolvedValue(pagina([{ ...linha, status: "completed", response_summary: "Campanha no ar." }]));
    await passar(10 * 60_000);
    expect(lista).toHaveBeenCalledTimes(3);
  });

  it("sem pedido em aberto, a tela não consulta sozinha", async () => {
    vi.useFakeTimers();
    const { lista } = montar([pedido({ status: "completed", response_summary: "Campanha criada." })]);
    await passar(0);
    await passar(10 * 60_000);
    expect(lista).toHaveBeenCalledTimes(1);
  });

  it("com a aba escondida a consulta espera", async () => {
    vi.useFakeTimers();
    const { lista } = montar([pedido({ status: "processing" })]);
    await passar(0);
    const visibilidade = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await passar(5 * 60_000);
      expect(lista).toHaveBeenCalledTimes(1);

      // Voltou para a aba: lê na hora, sem esperar a próxima rodada.
      visibilidade.mockReturnValue("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(lista).toHaveBeenCalledTimes(2);
    } finally {
      visibilidade.mockRestore();
    }
  });
});

describe("Estrategista de Tráfego — o envio", () => {
  it("manda o prompt e o request_id, mostra 'Enviando instruções…' e depois a linha que o servidor gravou", async () => {
    const { despacho, lista, campo, enviar } = montar();
    await screen.findByText("Nenhum pedido enviado ainda.");
    const espera = respostaSegurada();
    despacho.mockReturnValue(espera.promessa);

    escrever(campo, "  Campanha de leads para clínica, R$ 50 por dia  ");
    fireEvent.keyDown(campo, { key: "Enter" });

    const status = await screen.findByTestId("aios-enviando");
    expect(status.textContent).toContain("Enviando instruções para o motor de IA…");
    expect(conversa().getAttribute("aria-busy")).toBe("true");
    expect(campo.value).toBe("");
    expect(enviar.disabled).toBe(true);
    expect(screen.getByTestId("aios-pedido").dataset.estado).toBe("enviando");

    expect(despacho).toHaveBeenCalledTimes(1);
    const [url, init] = despacho.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ROTA_DO_DESPACHO);
    expect(ROTA_DO_DESPACHO).toBe("/api/v1/aios-dispatch");
    expect(init.method).toBe("POST");
    const corpo = JSON.parse(init.body as string) as { prompt: string; request_id: string };
    expect(Object.keys(corpo).sort()).toEqual(["prompt", "request_id"]);
    expect(corpo.prompt).toBe("Campanha de leads para clínica, R$ 50 por dia");
    // O id do pedido nasce na tela, na forma que a rota e o banco aceitam.
    expect(corpo.request_id).toMatch(/^[A-Za-z0-9_-]{8,100}$/);

    const gravada = pedido({
      request_id: corpo.request_id,
      prompt: corpo.prompt,
      status: "queued",
      engine_job_id: "job-42",
    });
    lista.mockResolvedValue(pagina([gravada]));
    await act(async () => {
      espera.liberar(
        json({
          data: { status: "dispatched", job_id: "job-42", message: "Recebido. Vou montar a campanha.", request: gravada },
        }),
      );
    });

    await waitFor(() => expect(screen.queryByTestId("aios-enviando")).toBeNull());
    expect(within(conversa()).getByText("Recebido. Vou montar a campanha.")).toBeTruthy();
    // Uma linha só: a do servidor tomou o lugar da que a tela mostrava no envio.
    await waitFor(() => expect(pedidosNaTela()).toHaveLength(1));
    const item = screen.getByTestId("aios-pedido");
    expect(item.dataset.origem).toBe("historico");
    expect(item.dataset.estado).toBe("queued");
    expect(item.textContent).toContain("Na fila do motor");
    expect(item.textContent).toContain("job-42");
    expect(conversa().getAttribute("aria-busy")).toBe("false");
    // Depois do envio a tela lê de novo: o que vale é o que o servidor registrou.
    await waitFor(() => expect(lista.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("a resposta do motor chega depois: vira bolha na conversa, uma vez, e aparece no pedido", async () => {
    const { despacho, lista, campo } = montar();
    await screen.findByText("Nenhum pedido enviado ainda.");

    let gravada!: ReturnType<typeof pedido>;
    despacho.mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(init.body as string) as { prompt: string; request_id: string };
      gravada = pedido({ request_id: corpo.request_id, prompt: corpo.prompt });
      lista.mockResolvedValue(pagina([gravada]));
      return json({ data: { status: "dispatched", job_id: null, message: null, request: gravada } });
    });
    escrever(campo, "campanha de leads");
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(pedidosNaTela()[0]?.dataset.estado).toBe("queued"));
    expect(within(conversa()).queryByText("Campanha no ar, com 3 anúncios.")).toBeNull();

    // O motor terminou e gravou a resposta na linha.
    const concluida = { ...gravada, status: "completed", engine_job_id: "job-77", response_summary: "Campanha no ar, com 3 anúncios." };
    lista.mockResolvedValue(pagina([concluida]));
    fireEvent.click(screen.getByTestId("aios-atualizar"));

    await waitFor(() => expect(within(conversa()).getByText("Campanha no ar, com 3 anúncios.")).toBeTruthy());
    expect(screen.getByTestId("aios-resposta").textContent).toContain("Campanha no ar, com 3 anúncios.");

    // Ler de novo não repete a bolha.
    fireEvent.click(screen.getByTestId("aios-atualizar"));
    await waitFor(() => expect(lista.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(within(conversa()).getAllByText("Campanha no ar, com 3 anúncios.")).toHaveLength(1);
  });

  it("o motor falhou depois de aceitar: a conversa diz por quê", async () => {
    const { despacho, lista, campo } = montar();
    await screen.findByText("Nenhum pedido enviado ainda.");
    despacho.mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(init.body as string) as { prompt: string; request_id: string };
      const gravada = pedido({ request_id: corpo.request_id, prompt: corpo.prompt });
      lista.mockResolvedValue(
        pagina([{ ...gravada, status: "failed", error_message: "A conta de anúncios está sem saldo." }]),
      );
      return json({ data: { status: "dispatched", job_id: null, message: null, request: gravada } });
    });
    escrever(campo, "campanha de leads");
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() =>
      expect(within(conversa()).getByText("A conta de anúncios está sem saldo.")).toBeTruthy(),
    );
    expect(pedidosNaTela()[0]?.dataset.estado).toBe("failed");
  });

  it("enquanto um pedido está em voo, um segundo Enter não envia outro", async () => {
    const { despacho, campo } = montar();
    const espera = respostaSegurada();
    despacho.mockReturnValue(espera.promessa);

    escrever(campo, "primeiro pedido");
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByTestId("aios-enviando");
    escrever(campo, "segundo pedido");
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(despacho).toHaveBeenCalledTimes(1);
    await act(async () => {
      espera.liberar(json({ data: { status: "dispatched", job_id: null, message: null } }));
    });
    await waitFor(() => expect(screen.queryByTestId("aios-enviando")).toBeNull());
  });

  it("aceite sem frase do motor e sem a linha → a tela diz que entregou, e o pedido fica como 'Entregue ao motor'", async () => {
    const { despacho, campo } = montar();
    despacho.mockResolvedValue(json({ data: { status: "dispatched", job_id: null, message: null } }));
    escrever(campo, "remarketing");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(await screen.findByText("Instruções entregues ao motor de tráfego.")).toBeTruthy();
    expect(screen.queryByText(/Protocolo/)).toBeNull();
    // A leitura não trouxe a linha: a tela mostra o que ELA sabe do pedido.
    const item = screen.getByTestId("aios-pedido");
    expect(item.dataset.origem).toBe("sessao");
    expect(item.dataset.estado).toBe("entregue");
    expect(item.textContent).toContain("Entregue ao motor");
  });

  it("Shift+Enter quebra a linha em vez de enviar", () => {
    const { despacho, campo } = montar();
    escrever(campo, "linha um");
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(despacho).not.toHaveBeenCalled();
  });
});

describe("Estrategista de Tráfego — quando não dá certo", () => {
  it("recusa do servidor: a frase dele entra na conversa e o texto volta ao campo", async () => {
    const { despacho, campo } = montar();
    despacho.mockResolvedValue(
      json({ error: { code: "upstream_unavailable", message: "Não consegui falar com o motor de tráfego." } }, 502),
    );
    escrever(campo, "campanha de promoção");
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByText("Não consegui falar com o motor de tráfego.")).toBeTruthy();
    const item = screen.getByTestId("aios-pedido");
    expect(item.dataset.estado).toBe("falhou");
    expect(item.textContent).toContain("Não enviado");
    await waitFor(() => expect(campo.value).toBe("campanha de promoção"));
  });

  it("recusa com a linha gravada como failed: o histórico mostra a frase, e a conversa não a repete", async () => {
    const { despacho, lista, campo } = montar();
    await screen.findByText("Nenhum pedido enviado ainda.");
    const frase = "O motor de tráfego recusou o pedido. Tente de novo; se continuar, avise quem instalou o sistema.";
    despacho.mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(init.body as string) as { prompt: string; request_id: string };
      lista.mockResolvedValue(
        pagina([pedido({ request_id: corpo.request_id, prompt: corpo.prompt, status: "failed", error_message: frase })]),
      );
      return json({ error: { code: "upstream_unavailable", message: frase } }, 502);
    });
    escrever(campo, "campanha de promoção");
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(pedidosNaTela()[0]?.dataset.estado).toBe("failed"));
    expect(pedidosNaTela()).toHaveLength(1);
    expect(screen.getByTestId("aios-pedido-erro").textContent).toBe(frase);
    expect(within(conversa()).getAllByText(frase)).toHaveLength(1);
  });

  it("504: sem confirmação — avisa, e NÃO devolve o texto ao campo", async () => {
    const { despacho, campo } = montar();
    despacho.mockResolvedValue(
      json({ error: { code: "upstream_timeout", message: "O pedido pode ter chegado." } }, 504),
    );
    escrever(campo, "campanha de leads");
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByText("O pedido pode ter chegado.")).toBeTruthy();
    const item = screen.getByTestId("aios-pedido");
    expect(item.dataset.estado).toBe("sem_confirmacao");
    expect(item.textContent).toContain("Sem confirmação");
    expect(campo.value).toBe("");
  });

  it("rede caiu: a conversa não fica muda", async () => {
    const { despacho, campo } = montar();
    despacho.mockRejectedValue(new TypeError("Failed to fetch"));
    escrever(campo, "campanha");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(await screen.findByText("Não consegui falar com o servidor. Confira a conexão e tente de novo.")).toBeTruthy();
    expect(screen.getByTestId("aios-pedido").dataset.estado).toBe("falhou");
  });

  it("erro sem JSON (proxy) → a frase genérica", async () => {
    const { despacho, campo } = montar();
    despacho.mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));
    escrever(campo, "campanha");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(
      await screen.findByText("O pedido não foi enviado ao motor de tráfego. Tente de novo em instantes."),
    ).toBeTruthy();
  });
});
