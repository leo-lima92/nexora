import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { lastLine, sql } from "./gov-helpers";

/**
 * FORK NEXORA — migration 9901: o rastreio de campanha do card é DERIVADO.
 *
 * `crm_leads.utm_*` e `crm_leads.meta_*_id` são colunas geradas de
 * `source_metadata`, que o webhook de entrada preenche com as chaves de topo
 * do envio (`lib/webhooks/inbound.ts`, `CHAVES_DE_ANUNCIO`). Este arquivo mede,
 * contra o baseline aplicado, as quatro promessas do cabeçalho da 9901:
 *
 *  1. o valor sai de `source_metadata` e acompanha toda mudança dele;
 *  2. `campaign_id`/`adset_id`/`ad_id` só viram `meta_*` quando o clique não é
 *     do Google (mesma precedência de `extrairAtribuicaoDoInbound`);
 *  3. ninguém escreve nas colunas — o Postgres recusa a instrução inteira;
 *  4. o índice da leitura por campanha existe.
 */
const org = randomUUID();
const pipeline = randomUUID();
const stage = randomUUID();

const COLUNAS = "utm_source, utm_medium, utm_campaign, meta_campaign_id, meta_adset_id, meta_ad_id";

function lead(meta: Record<string, string>): string {
  const id = randomUUID();
  const json = JSON.stringify(meta).replace(/'/g, "''");
  sql(`insert into crm_leads (id, organization_id, pipeline_id, stage_id, title, source_metadata)
       values ('${id}', '${org}', '${pipeline}', '${stage}', 'Negócio', '${json}'::jsonb);`);
  return id;
}

function colunas(id: string): string[] {
  return lastLine(
    sql(`select concat_ws('|', ${COLUNAS.split(", ")
      .map((c) => `coalesce(${c}, 'NULO')`)
      .join(", ")})
                         from crm_leads where id = '${id}';`),
  ).split("|");
}

beforeAll(() => {
  sql(`insert into organizations (id, slug, legal_name, display_name) values ('${org}', '${org}', 'Closed Loop', 'Closed Loop');
       insert into crm_pipelines (id, organization_id, name, slug) values ('${pipeline}', '${org}', 'Funil', '${pipeline}');
       insert into crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${stage}', '${org}', '${pipeline}', 'Entrada', 'entrada', 1);`);
});

describe("migration 9901 — rastreio de campanha no card", () => {
  it("as seis colunas existem e são GERADAS (nenhuma é escrita à mão)", () => {
    const out = sql(`select column_name || ':' || is_generated from information_schema.columns
                      where table_schema = 'public' and table_name = 'crm_leads'
                        and column_name in ('utm_source','utm_medium','utm_campaign','meta_campaign_id','meta_adset_id','meta_ad_id')
                      order by column_name;`);
    expect(out.split("\n")).toEqual([
      "meta_ad_id:ALWAYS",
      "meta_adset_id:ALWAYS",
      "meta_campaign_id:ALWAYS",
      "utm_campaign:ALWAYS",
      "utm_medium:ALWAYS",
      "utm_source:ALWAYS",
    ]);
  });

  it("o envio do AIOS sem clique: utm_* e os ids da peça chegam às colunas", () => {
    const id = lead({
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "black-friday",
      campaign_id: "120001",
      adset_id: "120002",
      ad_id: "120003",
    });
    expect(colunas(id)).toEqual(["facebook", "cpc", "black-friday", "120001", "120002", "120003"]);
  });

  it("clique do Google (gclid sem fbclid/fbc): os ids NÃO viram meta_*, o utm continua", () => {
    const id = lead({
      utm_source: "google",
      gclid: "Cj0KCQ",
      campaign_id: "g-9",
      adset_id: "g-8",
      ad_id: "g-7",
    });
    expect(colunas(id)).toEqual(["google", "NULO", "NULO", "NULO", "NULO", "NULO"]);
  });

  it("os dois cliques: a Meta vence, como em extrairAtribuicaoDoInbound", () => {
    const id = lead({ gclid: "Cj0KCQ", fbclid: "IwAR0", campaign_id: "120001" });
    expect(colunas(id)[3]).toBe("120001");
  });

  it("valor em branco vira NULL, não string vazia", () => {
    const id = lead({ utm_source: "   ", campaign_id: "" });
    expect(colunas(id)).toEqual(["NULO", "NULO", "NULO", "NULO", "NULO", "NULO"]);
  });

  it("acompanha o source_metadata: mudou a origem, mudou a coluna; limpou, zerou", () => {
    const id = lead({ utm_campaign: "antes" });
    sql(
      `update crm_leads set source_metadata = source_metadata || '{"utm_campaign":"depois","campaign_id":"77"}'::jsonb where id = '${id}';`,
    );
    expect(colunas(id)[2]).toBe("depois");
    expect(colunas(id)[3]).toBe("77");
    sql(`update crm_leads set source_metadata = '{}'::jsonb where id = '${id}';`);
    expect(colunas(id)).toEqual(["NULO", "NULO", "NULO", "NULO", "NULO", "NULO"]);
  });

  it("escrever na coluna é recusado — o rastreio só entra por source_metadata", () => {
    const id = lead({});
    expect(() => sql(`update crm_leads set meta_campaign_id = '1' where id = '${id}';`)).toThrow(
      /can only be updated to DEFAULT|generated column/i,
    );
    expect(() =>
      sql(`insert into crm_leads (organization_id, pipeline_id, stage_id, title, utm_source)
           values ('${org}', '${pipeline}', '${stage}', 'Negócio', 'x');`),
    ).toThrow(/cannot insert a non-DEFAULT value|generated column/i);
  });

  it("o índice da leitura por campanha existe e é parcial", () => {
    const def = lastLine(
      sql(
        `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'crm_leads_org_meta_campaign_idx';`,
      ),
    );
    expect(def).toMatch(/\(organization_id, meta_campaign_id\)/);
    expect(def).toMatch(/WHERE \(meta_campaign_id IS NOT NULL\)/);
  });
});
