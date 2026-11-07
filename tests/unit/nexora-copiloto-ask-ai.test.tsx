// FORK NEXORA — O COPILOTO (Ask AI): a fundação da interface ────────────────
//
// O que este arquivo mede é o CONTRATO da casca, que a conexão com o modelo vai
// herdar sem mudar: o botão da barra abre e fecha o painel, o painel fechado não
// recebe foco nem é lido (inert), o foco vai ao campo ao abrir e volta ao botão
// ao fechar, o Esc fecha (mas não quando outro diálogo já o tratou), e o envio
// põe a mensagem na conversa sem sair do navegador.
//
// E o que ele mede de HONESTIDADE: a tela diz que é uma prévia. Tirar esse
// aviso deixa o último caso vermelho — um copiloto que não responde não pode
// parecer um que responde.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AskAIBotao, AskAIPainel, AskAIProvider } from "@/components/ask-ai/AskAI";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

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

  it("enviar: vazio não envia; Enter põe a mensagem na conversa e limpa o campo, sem rede", () => {
    const { botao, campo, enviar, fetch } = montar();
    fireEvent.click(botao);
    expect(enviar.disabled).toBe(true);

    fireEvent.change(campo, { target: { value: "  Criar um funil de imobiliária  " } });
    expect(enviar.disabled).toBe(false);
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(screen.getByText("Criar um funil de imobiliária")).toBeTruthy();
    expect(campo.value).toBe("");
    expect(fetch, "a prévia não pode chamar API nenhuma").not.toHaveBeenCalled();
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

  it("a tela diz que é uma prévia e que ainda não responde", () => {
    montar();
    expect(screen.getByText("Prévia")).toBeTruthy();
    expect(screen.getByText("Esta é uma prévia da interface: o copiloto ainda não responde.")).toBeTruthy();
  });
});
