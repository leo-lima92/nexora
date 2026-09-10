/**
 * A Central de Conexões não pode AFIRMAR saúde que ninguém confirmou.
 *
 * ─── O defeito ───────────────────────────────────────────────────────────────
 * O health check ao vivo engolia a falha de alcance: mantinha o status do banco
 * (certo), mas carimbava `last_health_check_at = agora` e devolvia sucesso
 * (errado). Com o transporte aceitando a conexão e nunca respondendo, a tela
 * mostrava — medido em 2026-09-07, com um servidor TCP que só aceita e cala —
 * selo VERDE "Conectado" e a linha "Verificado 20:01:02", para um canal que não
 * havia sido verificado coisa nenhuma.
 *
 * É a degradação silenciosa que a doutrina do repo nomeia: dado velho com cara
 * de saudável. O operador olha o verde, conclui que o WhatsApp está no ar, e vai
 * procurar o problema em qualquer outro lugar — que é o custo real do defeito,
 * maior que o da própria queda.
 *
 * ─── O que este teste fixa, e o que deliberadamente NÃO fixa ─────────────────
 * Fixa a INVARIANTE: sem confirmação, a tela precisa dizer que não confirmou, e
 * a cor que afirma saúde tem de sair. Não fixa a redação nem o formato do aviso
 * — exigir a minha frase reprovaria uma tela que avisa melhor de outro jeito.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type * as CanaisModule from "@/hooks/channels/useChannelSessions";
import type { ChannelSession } from "@/hooks/channels/useChannelSessions";

const getMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...a: unknown[]) => getMock(...a),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/channels/usePacingKnobs", () => ({
  usePacingKnobs: () => ({ data: { items: [] } }),
}));
vi.mock("@/components/connections/AntiBanSheet", () => ({ AntiBanSheet: () => null }));

const listagem: {
  data: ChannelSession[] | undefined;
  isLoading: boolean;
  isError: boolean;
  schemaOutdated: boolean;
} = { data: [], isLoading: false, isError: false, schemaOutdated: false };

vi.mock("@/hooks/channels/useChannelSessions", async (original) => {
  const real = await original<typeof CanaisModule>();
  return { ...real, useChannelSessions: () => listagem };
});

import { ConnectionsClient } from "@/components/connections/ConnectionsClient";

const VERIFICADO_EM = "2026-09-07T20:01:02.000Z";

function canal(over: Partial<ChannelSession> = {}): ChannelSession {
  return {
    id: "canal-1",
    waha_session_name: "org_1111_aaa",
    display_name: "Vendas",
    phone_number: "5511999999999",
    status: "WORKING",
    status_reason: null,
    last_health_check_at: VERIFICADO_EM,
    last_status_change_at: null,
    daily_message_limit: 250,
    is_warmup_complete: null,
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function wrap(ui: React.ReactNode): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  getMock.mockReset();
  listagem.data = [canal()];
  listagem.isLoading = false;
  listagem.isError = false;
  listagem.schemaOutdated = false;
});
afterEach(cleanup);

describe("transporte inalcançável no health check", () => {
  it("avisa que o serviço não está conectado em vez de exibir saúde confirmada", async () => {
    getMock.mockResolvedValue({
      data: {
        id: "canal-1",
        status: "WORKING",
        transport_reachable: false,
        transport_error: "O servidor do WhatsApp (WAHA) não respondeu a tempo.",
      },
    });

    render(wrap(<ConnectionsClient wahaConfigured />));

    // O aviso aparece, e carrega a causa classificada — não um "erro" genérico.
    await waitFor(() => {
      expect(screen.getByText(/último estado conhecido/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/não respondeu a tempo/i)).toBeInTheDocument();

    // A linha do card deixa de AFIRMAR verificação recente.
    expect(screen.getByText(/não verificado agora/i)).toBeInTheDocument();
  });

  it("tira a cor que afirma saúde do selo do canal não verificado", async () => {
    getMock.mockResolvedValue({
      data: { id: "canal-1", status: "WORKING", transport_reachable: false, transport_error: null },
    });

    render(wrap(<ConnectionsClient wahaConfigured />));

    await waitFor(() => {
      expect(screen.getByText(/último estado conhecido/i)).toBeInTheDocument();
    });

    // O rótulo continua (é a melhor informação disponível); o verde, não.
    const selo = screen.getByText("Conectado");
    expect(selo.className).not.toContain("success");
  });

  it("com o transporte respondendo, nada de aviso e a verificação vale", async () => {
    getMock.mockResolvedValue({
      data: {
        id: "canal-1",
        status: "WORKING",
        transport_reachable: true,
        transport_error: null,
      },
    });

    render(wrap(<ConnectionsClient wahaConfigured />));

    await waitFor(() => expect(getMock).toHaveBeenCalled());

    expect(screen.queryByText(/último estado conhecido/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/não verificado agora/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Verificado /)).toBeInTheDocument();
    expect(screen.getByText("Conectado").className).toContain("success");
  });
});
