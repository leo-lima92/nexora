/**
 * G3-03 — badge de responsável do lead no kanban.
 * Cobre owner humano (nome + iniciais), owner AGENTE (0070: anel + mono +
 * versão no rótulo) e ausência de dono.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { OwnerBadge, ownerInitials } from "./OwnerBadge";

describe("OwnerBadge", () => {
  it("mostra nome e iniciais quando há responsável humano", () => {
    render(<OwnerBadge ownerKind="user" ownerName="Maria Silva" />);
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("MS")).toBeInTheDocument();
    expect(screen.getByLabelText("Responsável: Maria Silva")).toBeInTheDocument();
  });

  it("cai para rótulo genérico quando o nome do owner é desconhecido", () => {
    render(<OwnerBadge ownerKind="user" ownerName={null} />);
    expect(screen.getByText("Responsável")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("mostra 'Sem responsável' quando não há dono", () => {
    render(<OwnerBadge ownerKind={null} ownerName={null} />);
    expect(screen.getByLabelText("Sem responsável")).toBeInTheDocument();
    expect(screen.getByText("Sem responsável")).toBeInTheDocument();
  });

  it("agente: mesmo tamanho do humano, chapa escura e inicial em mono", () => {
    render(<OwnerBadge ownerKind="ai" ownerName="Agente Beta" agentVersion={3} />);
    const initials = screen.getByText("AB");
    // Par do humano: mesma caixa (h-6 w-6). A distinção é de VALOR, não de cor.
    expect(initials.className).toContain("h-6 w-6");
    expect(initials.className).toContain("font-mono");
    // O anel de antes virou chapa de Carbon no reskin Orderful. O que o teste
    // vigia continua sendo o mesmo: a marca do agente não pode depender da cor
    // de ação para existir.
    expect(initials.className).toContain("bg-carbon");
    expect(initials.className).not.toContain("bg-accent");
  });

  it("humano e agente se distinguem por VALOR, não por matiz", () => {
    // Este é o invariante que importa e que a versão anterior guardava por
    // acidente (checando `ring-1`): as duas marcas têm que ser diferentes uma
    // da outra SEM depender de percepção de cor — quem tem daltonismo, ou quem
    // imprime o board em cinza, precisa continuar vendo qual lead é do agente.
    const { unmount } = render(
      <OwnerBadge ownerKind="ai" ownerName="Agente Beta" agentVersion={3} />,
    );
    const agente = screen.getByText("AB").className;
    unmount();

    render(<OwnerBadge ownerKind="user" ownerName="Paula Rennó" />);
    const humano = screen.getByText("PR").className;

    // Agente: chapa escura. Humano: chapa clara com hairline.
    expect(agente).toContain("bg-carbon");
    expect(humano).toContain("bg-surface-elevated");
    expect(humano).toContain("border");
    expect(agente).not.toEqual(humano);
    // E nenhuma das duas gasta a vermillion: dono de lead é atribuição, não ação.
    expect(agente).not.toContain("accent");
    expect(humano).not.toContain("accent");
  });

  it("agente: rótulo acessível traz nome · versão publicada", () => {
    render(<OwnerBadge ownerKind="ai" ownerName="Agente Beta" agentVersion={3} />);
    expect(screen.getByLabelText("Responsável: Agente Beta · v3")).toBeInTheDocument();
    // O nome fica visível no card; a versão vive no tooltip/rótulo.
    expect(screen.getByText("Agente Beta")).toBeInTheDocument();
  });

  it("agente sem versão publicada não inventa 'v'", () => {
    render(<OwnerBadge ownerKind="ai" ownerName="Agente Beta" agentVersion={null} />);
    expect(screen.getByLabelText("Responsável: Agente Beta")).toBeInTheDocument();
  });

  it("nada de emoji ou badge 'AI' no dono agente", () => {
    const { container } = render(
      <OwnerBadge ownerKind="ai" ownerName="Agente Beta" agentVersion={1} />,
    );
    expect(container.textContent ?? "").not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(container.textContent).not.toContain("AI");
  });

  it("ownerInitials usa primeira e última palavra", () => {
    expect(ownerInitials("Ana")).toBe("AN");
    expect(ownerInitials("Ana Paula Souza")).toBe("AS");
    expect(ownerInitials("   ")).toBe("?");
  });
});
