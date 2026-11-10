// FORK NEXORA — TRÁFEGO AIOS: a conversa com o Estrategista de Tráfego ───────
//
// O que este arquivo mede é a LIGAÇÃO da tela com `POST /api/v1/aios-dispatch`:
//  - o envio leva só `{ prompt }` — organização e pessoa são da sessão;
//  - enquanto a rota não responde, a conversa diz "Enviando instruções para o
//    motor de IA…" e o botão trava (um pedido sai uma vez só);
//  - o aceite vira bolha com a frase e o protocolo do motor, e o pedido aparece
//    como "Entregue ao motor" na lista da sessão;
//  - a falha aparece NA CONVERSA: a recusa devolve o texto ao campo, e o 504
//    (sem confirmação) NÃO devolve, porque reenviar pode duplicar a campanha.
//
// O `fetch` é dublê com resposta segurada pelo teste, para medir o estado do
// meio — o que a pessoa vê enquanto espera.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstrategistaDeTrafego, ROTA_DO_DESPACHO } from "@/components/aios/EstrategistaDeTrafego";

afterEach(() => {
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

function montar() {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<EstrategistaDeTrafego />);
  return {
    fetch,
    campo: screen.getByTestId("aios-campo") as HTMLTextAreaElement,
    enviar: screen.getByTestId("aios-enviar") as HTMLButtonElement,
  };
}

function escrever(campo: HTMLTextAreaElement, texto: string) {
  fireEvent.change(campo, { target: { value: texto } });
}

describe("Estrategista de Tráfego — a tela parada", () => {
  it("nasce com a saudação, sem pedido nenhum e com o envio travado", () => {
    const { enviar, fetch } = montar();
    expect(screen.getByRole("log", { name: "Conversa com o Estrategista de Tráfego" })).toBeTruthy();
    expect(screen.getByText(/Conte o que você quer anunciar/)).toBeTruthy();
    expect(screen.getByText("Nenhum pedido enviado ainda.")).toBeTruthy();
    expect(enviar.disabled).toBe(true);
    expect(screen.queryByTestId("aios-enviando")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a sugestão preenche o campo, sem enviar", () => {
    const { campo, enviar, fetch } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Campanha de leads para o WhatsApp" }));
    expect(campo.value).toBe("Campanha de leads para o WhatsApp");
    expect(enviar.disabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("espaço em branco não é pedido", () => {
    const { campo, enviar, fetch } = montar();
    escrever(campo, "   ");
    expect(enviar.disabled).toBe(true);
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Estrategista de Tráfego — o envio", () => {
  it("manda só o prompt para a rota de despacho, e mostra 'Enviando instruções…' enquanto espera", async () => {
    const { fetch, campo, enviar } = montar();
    const espera = respostaSegurada();
    fetch.mockReturnValue(espera.promessa);

    escrever(campo, "  Campanha de leads para clínica, R$ 50 por dia  ");
    fireEvent.keyDown(campo, { key: "Enter" });

    const status = await screen.findByTestId("aios-enviando");
    expect(status.textContent).toContain("Enviando instruções para o motor de IA…");
    expect(screen.getByRole("log").getAttribute("aria-busy")).toBe("true");
    expect(campo.value).toBe("");
    expect(enviar.disabled).toBe(true);
    expect(screen.getByTestId("aios-pedido").dataset.estado).toBe("enviando");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ROTA_DO_DESPACHO);
    expect(ROTA_DO_DESPACHO).toBe("/api/v1/aios-dispatch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "Campanha de leads para clínica, R$ 50 por dia" });

    await act(async () => {
      espera.liberar(json({ data: { status: "dispatched", job_id: "job-42", message: "Recebido. Vou montar a campanha." } }));
    });

    await waitFor(() => expect(screen.queryByTestId("aios-enviando")).toBeNull());
    expect(screen.getByText("Recebido. Vou montar a campanha.")).toBeTruthy();
    const pedido = screen.getByTestId("aios-pedido");
    expect(pedido.dataset.estado).toBe("entregue");
    expect(pedido.textContent).toContain("Entregue ao motor");
    expect(pedido.textContent).toContain("job-42");
    expect(screen.getByRole("log").getAttribute("aria-busy")).toBe("false");
  });

  it("enquanto um pedido está em voo, um segundo Enter não envia outro", async () => {
    const { fetch, campo } = montar();
    const espera = respostaSegurada();
    fetch.mockReturnValue(espera.promessa);

    escrever(campo, "primeiro pedido");
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByTestId("aios-enviando");
    escrever(campo, "segundo pedido");
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      espera.liberar(json({ data: { status: "dispatched", job_id: null, message: null } }));
    });
    await waitFor(() => expect(screen.queryByTestId("aios-enviando")).toBeNull());
  });

  it("aceite sem frase do motor → a tela diz que as instruções foram entregues", async () => {
    const { fetch, campo } = montar();
    fetch.mockResolvedValue(json({ data: { status: "dispatched", job_id: null, message: null } }));
    escrever(campo, "remarketing");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(await screen.findByText("Instruções entregues ao motor de tráfego.")).toBeTruthy();
    expect(screen.queryByText(/Protocolo/)).toBeNull();
  });

  it("Shift+Enter quebra a linha em vez de enviar", () => {
    const { fetch, campo } = montar();
    escrever(campo, "linha um");
    fireEvent.keyDown(campo, { key: "Enter", shiftKey: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Estrategista de Tráfego — quando não dá certo", () => {
  it("recusa do servidor: a frase dele entra na conversa e o texto volta ao campo", async () => {
    const { fetch, campo } = montar();
    fetch.mockResolvedValue(
      json({ error: { code: "upstream_unavailable", message: "Não consegui falar com o motor de tráfego." } }, 502),
    );
    escrever(campo, "campanha de promoção");
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByText("Não consegui falar com o motor de tráfego.")).toBeTruthy();
    const pedido = screen.getByTestId("aios-pedido");
    expect(pedido.dataset.estado).toBe("falhou");
    expect(pedido.textContent).toContain("Não enviado");
    await waitFor(() => expect(campo.value).toBe("campanha de promoção"));
  });

  it("504: sem confirmação — avisa, e NÃO devolve o texto ao campo", async () => {
    const { fetch, campo } = montar();
    fetch.mockResolvedValue(
      json({ error: { code: "upstream_timeout", message: "O pedido pode ter chegado." } }, 504),
    );
    escrever(campo, "campanha de leads");
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(await screen.findByText("O pedido pode ter chegado.")).toBeTruthy();
    const pedido = screen.getByTestId("aios-pedido");
    expect(pedido.dataset.estado).toBe("sem_confirmacao");
    expect(pedido.textContent).toContain("Sem confirmação");
    expect(campo.value).toBe("");
  });

  it("rede caiu: a conversa não fica muda", async () => {
    const { fetch, campo } = montar();
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    escrever(campo, "campanha");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(await screen.findByText("Não consegui falar com o servidor. Confira a conexão e tente de novo.")).toBeTruthy();
    expect(screen.getByTestId("aios-pedido").dataset.estado).toBe("falhou");
  });

  it("erro sem JSON (proxy) → a frase genérica", async () => {
    const { fetch, campo } = montar();
    fetch.mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));
    escrever(campo, "campanha");
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(
      await screen.findByText("O pedido não foi enviado ao motor de tráfego. Tente de novo em instantes."),
    ).toBeTruthy();
  });
});
