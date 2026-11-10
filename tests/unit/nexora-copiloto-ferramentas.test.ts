// FORK NEXORA — O COPILOTO: a operação de criar funil e as ferramentas ────────
//
// O que este arquivo mede:
//  - `etapasDoPedido`: as regras de etapa que o schema impõe (uma de ganho, uma
//    de perda, slug único) saem certas, e o pedido que o banco recusaria é
//    recusado ANTES, com frase de gente;
//  - as ferramentas leem e escrevem SÓ na organização que a rota resolveu da
//    sessão — inclusive quando o modelo tenta mandar outra no argumento;
//  - o teto de criações por turno corta no servidor, sem depender do prompt.
//
// O dublê (`tests/helpers/stages-db-double.ts`) APLICA os filtros `eq`/`in`:
// apagar o `eq("organization_id", …)` de uma leitura faz o caso de isolamento
// ficar vermelho, em vez de medir uma linha fixa.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import type { EventoDoCopiloto } from "@/lib/copiloto/eventos";
import { CRIACOES_POR_TURNO, ferramentasDoCopiloto } from "@/lib/copiloto/ferramentas";
import { criarFunil, etapasDoPedido } from "@/lib/pipelines/criar-funil";
import { ETAPAS_INICIAIS } from "@/lib/pipelines/pipeline-editing";
import { ORG_ID, OUTRA_ORG, USER_ID, etapa, funilRow, makeDb } from "@/tests/helpers/stages-db-double";

const REQ = "req-1";

beforeEach(() => {
  vi.clearAllMocks();
});

function recusaDe(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("esperava ApiError, e nada foi lançado");
}

describe("etapasDoPedido — as regras do schema, antes do banco", () => {
  it("sem etapas pedidas: as etapas padrão do produto, como a tela de Funis sempre fez", () => {
    expect(etapasDoPedido({ nome: "X" }, REQ)).toEqual(ETAPAS_INICIAIS.map((e) => ({ ...e })));
  });

  it("etapas pedidas: abertas na ordem, depois UMA de ganho e UMA de perda", () => {
    const etapas = etapasDoPedido(
      { nome: "Clínica", etapasAbertas: ["Novo contato", "Qualificado", "Agendado"] },
      REQ,
    );
    expect(etapas.map((e) => e.name)).toEqual(["Novo contato", "Qualificado", "Agendado", "Ganho", "Perdido"]);
    expect(etapas.filter((e) => e.is_won)).toHaveLength(1);
    expect(etapas.filter((e) => e.is_lost)).toHaveLength(1);
    expect(etapas.at(-2)?.is_won).toBe(true);
    expect(etapas.at(-1)?.is_lost).toBe(true);
    // `crm_stages_slug_format` e `uniq_crm_stages_pipeline_slug`.
    for (const e of etapas) expect(e.slug).toMatch(/^[a-z0-9_-]{2,40}$/);
    expect(new Set(etapas.map((e) => e.slug)).size).toBe(etapas.length);
  });

  it("ganho e perda podem ser renomeados", () => {
    const etapas = etapasDoPedido(
      { nome: "Loja", etapasAbertas: ["Carrinho"], etapaDeGanho: "Pago", etapaDePerda: "Cancelado" },
      REQ,
    );
    expect(etapas.map((e) => e.name)).toEqual(["Carrinho", "Pago", "Cancelado"]);
  });

  it("nome repetido que a pessoa leria como o mesmo (acento, caixa) → 422 com a frase", () => {
    const err = recusaDe(() => etapasDoPedido({ nome: "X", etapasAbertas: ["Proposta", "proposta "] }, REQ));
    expect(err.status).toBe(422);
    expect(err.message).toBe("As etapas «Proposta» e «proposta» têm o mesmo nome. Escolha nomes diferentes.");
  });

  it("etapa aberta com o nome da coluna de ganho também colide", () => {
    const err = recusaDe(() => etapasDoPedido({ nome: "X", etapasAbertas: ["Ganho"] }, REQ));
    expect(err.status).toBe(422);
  });

  it("nenhuma etapa aberta, ou mais de 12 → 422", () => {
    expect(recusaDe(() => etapasDoPedido({ nome: "X", etapasAbertas: [] }, REQ)).status).toBe(422);
    const treze = Array.from({ length: 13 }, (_, i) => `Etapa ${i + 1}`);
    expect(recusaDe(() => etapasDoPedido({ nome: "X", etapasAbertas: treze }, REQ)).status).toBe(422);
  });
});

describe("criarFunil com etapas pedidas", () => {
  it("grava o funil e as etapas na organização da sessão, e audita a origem", async () => {
    const db = makeDb({ pipelines: [] });
    const criado = await criarFunil(
      { supabase: db.client as never, organizationId: ORG_ID, actorUserId: USER_ID, requestId: REQ, origem: "copiloto" },
      { nome: "Clínica", etapasAbertas: ["Novo contato", "Agendado"] },
    );

    const etapas = db.escritas.find((e) => e.table === "crm_stages")?.patch as Array<Record<string, unknown>>;
    expect(etapas.map((e) => e.name)).toEqual(["Novo contato", "Agendado", "Ganho", "Perdido"]);
    expect(etapas.every((e) => e.organization_id === ORG_ID && e.pipeline_id === criado.pipelineId)).toBe(true);
    expect(criado.isDefault, "o primeiro funil da organização nasce padrão").toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pipeline.created",
        organizationId: ORG_ID,
        metadata: expect.objectContaining({ origem: "copiloto", etapas: 4 }),
      }),
    );
  });

  it("pedido de etapas inválido não toca o banco", async () => {
    const db = makeDb({ pipelines: [] });
    await expect(
      criarFunil(
        { supabase: db.client as never, organizationId: ORG_ID, actorUserId: USER_ID, requestId: REQ },
        { nome: "Clínica", etapasAbertas: ["A1", "a1"] },
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(db.escritas).toEqual([]);
  });
});

function montar(db: ReturnType<typeof makeDb>) {
  const eventos: EventoDoCopiloto[] = [];
  const kit = ferramentasDoCopiloto({
    supabase: db.client as never,
    organizationId: ORG_ID,
    actorUserId: USER_ID,
    requestId: REQ,
    emitir: (e) => eventos.push(e),
  });
  const executar = (nome: "listar_funis" | "criar_funil", entrada: unknown) =>
    (kit.ferramentas[nome]!.execute as (i: unknown, o: unknown) => Promise<unknown>)(entrada, {
      toolCallId: "t1",
      messages: [],
    });
  return { ...kit, eventos, executar };
}

describe("listar_funis — só a organização da sessão", () => {
  it("devolve os funis vivos da org com as etapas vivas, e NADA da outra org", async () => {
    const db = makeDb({
      pipelines: [
        funilRow({ id: "p1", name: "Vendas", is_default: true }),
        funilRow({ id: "p-arq", name: "Antigo", is_archived: true }),
        { ...funilRow({ id: "p-outra", name: "Da Outra" }), organization_id: OUTRA_ORG },
      ],
      stages: [
        etapa({ id: "s1", name: "Novo", position: 1000, pipeline_id: "p1" }),
        etapa({ id: "s2", name: "Ganho", position: 2000, is_won: true, pipeline_id: "p1" }),
        etapa({ id: "s3", name: "Velha", position: 1500, is_archived: true, pipeline_id: "p1" }),
        { ...etapa({ id: "s9", name: "Alheia", position: 1000, pipeline_id: "p1" }), organization_id: OUTRA_ORG },
      ],
    });
    const { executar, eventos } = montar(db);
    const r = (await executar("listar_funis", {})) as { ok: true; funis: Array<{ nome: string; etapas: unknown[] }> };

    expect(r.ok).toBe(true);
    expect(r.funis.map((f) => f.nome)).toEqual(["Vendas"]);
    expect(r.funis[0]!.etapas).toEqual([
      { nome: "Novo", tipo: "aberta" },
      { nome: "Ganho", tipo: "ganho" },
    ]);
    expect(eventos).toEqual([
      { tipo: "ferramenta", estado: "inicio", nome: "listar_funis" },
      { tipo: "ferramenta", estado: "fim", nome: "listar_funis", ok: true },
    ]);
  });

  it("falha de banco vira recusa com frase genérica — o texto do Postgres não vai ao modelo", async () => {
    const db = makeDb({ readError: () => ({ code: "XX000", message: "relation crm_pipelines segredo" }) });
    const { executar, eventos } = montar(db);
    const r = (await executar("listar_funis", {})) as { ok: false; erro: string };
    expect(r.ok).toBe(false);
    expect(r.erro).not.toContain("segredo");
    expect(eventos.at(-1)).toEqual({ tipo: "ferramenta", estado: "fim", nome: "listar_funis", ok: false });
  });
});

describe("criar_funil — a mesma operação da tela, escopada pela sessão", () => {
  it("cria na org da sessão MESMO que o modelo mande outra no argumento", async () => {
    const db = makeDb({ pipelines: [] });
    const { executar, eventos, funisCriados } = montar(db);
    const r = (await executar("criar_funil", {
      nome: "Imobiliária",
      etapas_abertas: ["Lead", "Visita"],
      // O que um modelo manipulado tentaria. O schema não tem o campo; a
      // organização foi fechada na montagem do ToolSet.
      organization_id: OUTRA_ORG,
    })) as { ok: true; funil: { id: string; etapas: string[] } };

    expect(r.ok).toBe(true);
    expect(r.funil.etapas).toEqual(["Lead", "Visita", "Ganho", "Perdido"]);
    const insertDoFunil = db.escritas.find((e) => e.table === "crm_pipelines" && e.tipo === "insert");
    expect((insertDoFunil?.patch as Record<string, unknown>).organization_id).toBe(ORG_ID);
    expect(funisCriados()).toEqual([r.funil.id]);
    expect(eventos).toContainEqual({
      tipo: "funil_criado",
      pipeline_id: r.funil.id,
      nome: "Imobiliária",
      etapas: ["Lead", "Visita", "Ganho", "Perdido"],
    });
  });

  it("recusa da regra (nome já usado) volta ao modelo com a frase, sem escrita", async () => {
    const db = makeDb({ pipelines: [funilRow({ id: "p1", name: "Vendas", is_default: true })] });
    const { executar, eventos } = montar(db);
    const r = (await executar("criar_funil", { nome: "vendas", etapas_abertas: ["A"] })) as {
      ok: false;
      erro: string;
    };
    expect(r).toEqual({ ok: false, erro: "Já existe um funil chamado «Vendas». Escolha outro nome." });
    expect(db.escritas).toEqual([]);
    expect(eventos.at(-1)).toEqual({ tipo: "ferramenta", estado: "fim", nome: "criar_funil", ok: false });
  });

  it(`no máximo ${CRIACOES_POR_TURNO} funis por turno — o terceiro é recusado sem escrever`, async () => {
    const db = makeDb({ pipelines: [] });
    const { executar } = montar(db);
    for (let i = 1; i <= CRIACOES_POR_TURNO; i++) {
      const r = (await executar("criar_funil", { nome: `Funil ${i}`, etapas_abertas: ["A"] })) as { ok: boolean };
      expect(r.ok).toBe(true);
    }
    const escritasAntes = db.escritas.length;
    const r = (await executar("criar_funil", { nome: "Funil 3", etapas_abertas: ["A"] })) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(db.escritas.length).toBe(escritasAntes);
  });
});
