// @vitest-environment node
//
// FORK NEXORA — A FRONTEIRA DO CONTEXTO DE META ADS ──────────────────────────
//
// O Nexora não fala com a Meta de anúncios: a Conversions API e a leitura de
// campanha são do motor AIOS (`lib/nexora/fronteira-meta-ads.ts`). Este arquivo
// é a cerca que pega o sync do upstream que reescrever um dos três cortes:
//
//   1. o registro de transportes devolve `null` para `meta_ads`;
//   2. a credencial de leitura da Meta responde `sem_conexao` sem ir ao banco;
//   3. menu e catálogo de recursos opcionais não oferecem as portas da Meta.
//
// E o corte de verdade — nenhum `fetch` sai — é medido no handler de compra,
// com um lead GANHO, atribuído à Meta e com valor: o caso em que o upstream
// faria o POST para a Graph.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  registros: [] as Record<string, unknown>[],
  fetch: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      for (const nome of ["select", "eq", "is", "order", "limit"]) q[nome] = () => q;
      q.maybeSingle = async () =>
        tabela === "crm_leads"
          ? {
              data: {
                id: "lead-1",
                status: "won",
                value_cents: 150000,
                currency: "BRL",
                closed_at: "2026-11-01T12:00:00Z",
                contact_id: "contato-1",
              },
              error: null,
            }
          : { data: null, error: null };
      return q;
    },
  }),
}));
vi.mock("@/lib/conversoes/registro-de-envio", () => ({
  lerRegistro: async () => null,
  registraEnvio: async (_admin: unknown, linha: Record<string, unknown>) => {
    h.registros.push(linha);
  },
}));
vi.mock("@/lib/conversoes/leitura-da-atribuicao", () => ({
  lerAtribuicao: async () => ({
    temAtribuicao: true,
    atribuicao: { plataforma: "meta_ads", cliqueDeOrigem: "CTWA_CLID_123", telefone: "+5511998765432" },
  }),
}));

import { processarConversao } from "@/lib/conversoes/envio.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { permitidos } from "@/lib/navigation/interface";
import {
  NEXORA_FALA_COM_A_META_DE_ANUNCIOS,
  PORTAS_DA_META_ADS,
  RECURSOS_DA_META_ADS,
} from "@/lib/nexora/fronteira-meta-ads";
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { transporteDe } from "@/lib/plataformas-de-anuncio/registry";
import { RECURSOS_OPCIONAIS } from "@/lib/recursos-opcionais/catalogo";

beforeEach(() => {
  h.registros.length = 0;
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
});

describe("fronteira do contexto de Meta Ads (fork Nexora)", () => {
  it("a decisão está desligada — religar é mudança de arquitetura, não de configuração", () => {
    expect(NEXORA_FALA_COM_A_META_DE_ANUNCIOS).toBe(false);
  });

  it("a Meta de anúncios não tem transporte; o Google Ads continua com o seu", () => {
    expect(transporteDe("meta_ads")).toBeNull();
    expect(transporteDe("google_ads")).not.toBeNull();
  });

  it("a venda ganha, atribuída à Meta e com valor, NÃO sai — e a pendência fica no livro-razão", async () => {
    const row = {
      id: "evento-1",
      organization_id: "org-1",
      entity_id: "lead-1",
      event_type: "lead.stage_changed",
      payload: {},
      created_at: "2026-11-01T12:00:00Z",
    } as unknown as EventRow;

    const resultado = await processarConversao(row);

    expect(h.fetch, "um fetch saiu para a Meta").not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ status: "skipped", detail: "plataforma_sem_transporte" });
    expect(h.registros).toHaveLength(1);
    expect(h.registros[0]).toMatchObject({
      plataforma: "meta_ads",
      status: "skipped",
      motivo: "plataforma_sem_transporte",
    });
  });

  it("a credencial de leitura da Meta responde sem_conexao sem tocar no banco", async () => {
    const admin = {
      from: () => {
        throw new Error("a leitura da Meta não devia consultar ad_insights_connections");
      },
    };
    await expect(lerCredencialDeLeitura(admin as never, "org-1", "meta_ads")).resolves.toEqual({
      ok: false,
      motivo: "sem_conexao",
    });
  });

  it("as portas da Meta somem do menu de qualquer papel, mas seguem no catálogo", () => {
    const hrefsDoCatalogo = NAV_CATALOG.map((d) => d.href as string);
    for (const porta of PORTAS_DA_META_ADS) {
      // No catálogo, para `destinos` já salvos com elas continuarem válidos.
      expect(hrefsDoCatalogo, `${porta} saiu do catálogo`).toContain(porta);
    }
    for (const visao of [permitidos(true, null), permitidos(false, "admin")]) {
      const hrefs = visao.map((d) => d.href);
      for (const porta of PORTAS_DA_META_ADS) expect(hrefs).not.toContain(porta);
      // O resto do assunto continua: Conversões tem Google Ads e a captura de origem.
      expect(hrefs).toContain("/app/settings/conversoes");
    }
  });

  it("o catálogo de recursos opcionais não oferece a chave da Meta, e mantém o que entra", () => {
    const ids = RECURSOS_OPCIONAIS.map((r) => r.id);
    for (const id of RECURSOS_DA_META_ADS) expect(ids).not.toContain(id);
    // `meta` é a API Oficial do WHATSAPP (canal de conversa), não anúncio.
    expect(ids).toEqual(expect.arrayContaining(["meta", "conversoes_google", "captura_de_origem"]));
  });
});
