// @vitest-environment node
//
// FORK NEXORA — O CONTRATO DE ENTRADA DO AIOS NO WEBHOOK (migration 9901) ────
//
// O motor AIOS (Python) manda o rastreio de campanha como CHAVES DE TOPO do
// corpo de `/api/v1/webhooks/in/<token>`: `utm_source`, `utm_medium`,
// `utm_campaign`, `campaign_id`, `adset_id` e `ad_id`. As colunas geradas da
// 9901 (`crm_leads.utm_*` e `meta_*_id`) tiram o valor de `source_metadata` —
// então o que importa provar é que as seis chegam a `source_metadata` do card
// e NENHUMA vira campo personalizado.
//
// A rota de verdade chama o handler de verdade; só o Supabase é de mentira (o
// mesmo arranjo de `captacao-na-etapa-exigente-cria-o-lead.test.ts`). O que se
// mede é a linha que o handler manda INSERIR em `crm_leads`.
//
// Sabotagem: tirar `campaign_id` de `CHAVES_DE_ANUNCIO` (lib/webhooks/inbound.ts)
// deixa o primeiro caso vermelho — o id cai em `custom_fields` e a coluna
// `meta_campaign_id` ficaria vazia.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUNIL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ETAPA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const h = vi.hoisted(() => ({ leadsInseridos: [] as Record<string, unknown>[] }));

const FONTE = {
  id: "fonte-aios",
  name: "Motor AIOS",
  organization_id: ORG,
  secret_encrypted: null,
  default_pipeline_id: FUNIL,
  default_stage_id: ETAPA,
  field_map: {},
  redirect_to: null,
  is_active: true,
};

/** Cadeia do PostgREST da ROTA: só a fonte é lida de verdade; o resto resolve vazio. */
function cadeia(tabela: string): unknown {
  const resultado = { data: tabela === "webhook_sources" ? FONTE : null, error: null };
  const proxy: unknown = new Proxy(() => undefined, {
    get(_alvo, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok(resultado);
      return () => proxy;
    },
  });
  return proxy;
}

/** Supabase do HANDLER: etapa e funil sem exigência nenhuma, e o insert do lead. */
function supabaseDoHandler(): unknown {
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    const mesmo = () => q;
    for (const nome of ["select", "eq", "neq", "is", "order", "limit"]) q[nome] = mesmo;
    q.insert = (linha: Record<string, unknown>) => {
      if (tabela === "crm_leads") h.leadsInseridos.push(linha);
      return q;
    };
    q.maybeSingle = async () => {
      if (tabela === "crm_stages") return { data: { id: ETAPA, pipeline_id: FUNIL, organization_id: ORG }, error: null };
      if (tabela === "crm_pipelines") return { data: { settings: {} }, error: null };
      if (tabela === "organizations") return { data: { currency: "BRL" }, error: null };
      return { data: null, error: null };
    };
    q.single = async () => ({ data: { ...h.leadsInseridos.at(-1), id: "lead-novo" }, error: null });
    q.then = (ok: (v: unknown) => void) => ok({ data: null, error: null });
    return q;
  };
  return { from };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => cadeia(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/atendimento/origem", () => ({ observeServiceOrigin: async () => "humano" }));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ kickLocalPipeline: async () => undefined }));
vi.mock("@/lib/webhooks/captacao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarCaptacao: vi.fn(async () => undefined),
}));
vi.mock("@/app/api/v1/leads/_handler", async (original) => {
  const real = await original<{ createLeadHandler: (...a: unknown[]) => unknown }>();
  return {
    ...real,
    createLeadHandler: (_sb: unknown, ...resto: unknown[]) => real.createLeadHandler(supabaseDoHandler(), ...resto),
  };
});

import { POST } from "@/app/api/v1/webhooks/in/[token]/route";

const TOKEN = "token-do-aios-0001";

async function enviar(corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const req = new NextRequest(`http://localhost/api/v1/webhooks/in/${TOKEN}`, {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req, { params: Promise.resolve({ token: TOKEN }) });
  expect(res.status, "a captação foi recusada").toBe(200);
  expect(h.leadsInseridos, "o card não nasceu").toHaveLength(1);
  return h.leadsInseridos[0]!;
}

/** O que o AIOS manda: as seis chaves de rastreio no TOPO do corpo. */
const RASTREIO = {
  utm_source: "facebook",
  utm_medium: "cpc",
  utm_campaign: "black-friday-clinicas",
  campaign_id: "120210000000001",
  adset_id: "120210000000002",
  ad_id: "120210000000003",
} as const;

beforeEach(() => {
  h.leadsInseridos.length = 0;
});

describe("contrato do AIOS no webhook de entrada (9901)", () => {
  it("as seis chaves de topo chegam a source_metadata e nenhuma vira campo do card", async () => {
    const card = await enviar({ nome: "Dora", email: "dora@example.com", ...RASTREIO });

    expect(card.source_metadata).toMatchObject(RASTREIO);
    const campos = (card.custom_fields ?? {}) as Record<string, unknown>;
    for (const chave of Object.keys(RASTREIO)) {
      expect(campos, `${chave} vazou para custom_fields`).not.toHaveProperty(chave);
    }
  });

  it("a caixa da chave não importa: UTM_Source e Campaign_ID entram minúsculas", async () => {
    // Python/planilha às vezes mandam a chave capitalizada. As colunas geradas
    // leem `source_metadata->>'utm_source'`, então a gravação PRECISA sair
    // minúscula — senão o card fica sem campanha sem erro nenhum.
    const card = await enviar({ email: "eva@example.com", UTM_Source: "facebook", Campaign_ID: "999" });

    expect(card.source_metadata).toMatchObject({ utm_source: "facebook", campaign_id: "999" });
  });

  it("com external_id, `stage` é reservado: sai do corpo e não chega a lugar nenhum do card", async () => {
    const card = await enviar({
      email: "fabio@example.com",
      external_id: "aios-lead-42",
      stage: "Qualificado",
      ...RASTREIO,
    });

    expect(card.source_metadata).toMatchObject(RASTREIO);
    expect(card.source_metadata).not.toHaveProperty("stage");
    expect((card.custom_fields ?? {}) as object).not.toHaveProperty("stage");
    expect(card.external_id).toBe("aios-lead-42");
  });

  it("SEM external_id, `stage` vira campo do card — e o rastreio segue inteiro em source_metadata", async () => {
    // O comportamento do upstream (#2316): `stage` só é reservado quando há um
    // card para onde apontar, e é o `external_id` que aponta. Fica escrito aqui
    // porque é a armadilha do contrato: o AIOS que mandar a campanha DENTRO de
    // `stage` perde o rastreio nos dois caminhos.
    const card = await enviar({ email: "gil@example.com", stage: "Qualificado", ...RASTREIO });

    expect(card.source_metadata).toMatchObject(RASTREIO);
    expect(card.custom_fields).toMatchObject({ stage: "Qualificado" });
  });

  it("`meta_campaign_id` no corpo NÃO alimenta a coluna: o nome da chave é `campaign_id`", async () => {
    // O aviso do cabeçalho da 9901, medido: a chave com o nome da COLUNA não é
    // reservada, cai em custom_fields, e `source_metadata.campaign_id` fica
    // ausente — a coluna gerada `meta_campaign_id` sairia NULL.
    const card = await enviar({ email: "hana@example.com", meta_campaign_id: "120210000000001" });

    expect(card.custom_fields).toMatchObject({ meta_campaign_id: "120210000000001" });
    expect(card.source_metadata).not.toHaveProperty("campaign_id");
  });
});
