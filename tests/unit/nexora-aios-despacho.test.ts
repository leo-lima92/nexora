// @vitest-environment node
//
// FORK NEXORA — O DESPACHO PARA O MOTOR AIOS (`lib/aios/despacho.ts`) ─────────
//
// O que este arquivo mede é o que SAI do CRM e como a resposta é lida:
//  - o corpo tem exatamente os quatro campos do contrato, e mais nenhum;
//  - o endereço vem de `AIOS_PYTHON_URL`, cai no provisório quando vazia, e um
//    valor que não é endereço NÃO cai no provisório em silêncio;
//  - o token só vai quando existe, e o redirect não é seguido;
//  - 2xx é aceite com ou sem JSON; fora de 2xx é recusa; prazo estourado é
//    "prazo" (o pedido pode ter chegado) e não "inalcançável".
//
// O `fetch` é dublê: nenhuma chamada sai da máquina.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACAO_GERAR_CAMPANHA,
  PRAZO_DO_DESPACHO_MS,
  URL_PROVISORIA_DO_AIOS,
  despacharParaOAios,
  urlDoAios,
} from "@/lib/aios/despacho";

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const pedido = { orgId: ORG, userId: USER, prompt: "Campanha de leads para clínica", requestId: "req-1" };

const fetchDuble = vi.fn();

beforeEach(() => {
  fetchDuble.mockReset();
  vi.stubGlobal("fetch", fetchDuble);
  vi.stubEnv("AIOS_PYTHON_URL", "");
  vi.stubEnv("AIOS_PYTHON_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

describe("urlDoAios", () => {
  it("vazia → o endereço provisório", () => {
    expect(urlDoAios()).toBe(URL_PROVISORIA_DO_AIOS);
    expect(URL_PROVISORIA_DO_AIOS).toBe("http://localhost:8000/api/campaign");
  });

  it("preenchida → a da instalação", () => {
    vi.stubEnv("AIOS_PYTHON_URL", "  https://aios.exemplo.com/api/campaign  ");
    expect(urlDoAios()).toBe("https://aios.exemplo.com/api/campaign");
  });

  it.each(["aios.exemplo.com/api", "ftp://aios.exemplo.com", "javascript:alert(1)"])(
    "%s não é endereço http(s) → null, e não o provisório",
    (valor) => {
      vi.stubEnv("AIOS_PYTHON_URL", valor);
      expect(urlDoAios()).toBeNull();
    },
  );
});

describe("despacharParaOAios — o que sai", () => {
  it("POST com exatamente org_id, user_id, prompt e action", async () => {
    fetchDuble.mockResolvedValue(json({}));
    await despacharParaOAios(pedido);

    expect(fetchDuble).toHaveBeenCalledTimes(1);
    const [url, init] = fetchDuble.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_PROVISORIA_DO_AIOS);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      org_id: ORG,
      user_id: USER,
      prompt: "Campanha de leads para clínica",
      action: "generate_campaign",
    });
    expect(ACAO_GERAR_CAMPANHA).toBe("generate_campaign");
  });

  it("leva o X-Request-Id, não segue redirect e tem prazo", async () => {
    fetchDuble.mockResolvedValue(json({}));
    await despacharParaOAios(pedido);
    const init = fetchDuble.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Request-Id"]).toBe("req-1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(PRAZO_DO_DESPACHO_MS).toBeGreaterThan(0);
  });

  it("sem token não manda Authorization; com token manda Bearer", async () => {
    fetchDuble.mockResolvedValue(json({}));
    await despacharParaOAios(pedido);
    expect((fetchDuble.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty("Authorization");

    vi.stubEnv("AIOS_PYTHON_TOKEN", "segredo-do-motor");
    await despacharParaOAios(pedido);
    const headers = (fetchDuble.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer segredo-do-motor");
  });

  it("endereço inválido → 'configuracao', sem chamar ninguém", async () => {
    vi.stubEnv("AIOS_PYTHON_URL", "nao-e-url");
    expect(await despacharParaOAios(pedido)).toEqual({ ok: false, motivo: "configuracao", status: null });
    expect(fetchDuble).not.toHaveBeenCalled();
  });
});

describe("despacharParaOAios — o que volta", () => {
  it("2xx com job_id e message → sobem para quem chamou", async () => {
    fetchDuble.mockResolvedValue(json({ job_id: " job-42 ", message: "Recebido.", segredo: "não sobe" }, 202));
    expect(await despacharParaOAios(pedido)).toEqual({
      ok: true,
      status: 202,
      jobId: "job-42",
      mensagem: "Recebido.",
    });
  });

  it("2xx sem JSON (ou com JSON de outro formato) ainda é aceite", async () => {
    fetchDuble.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    expect(await despacharParaOAios(pedido)).toEqual({ ok: true, status: 200, jobId: null, mensagem: null });

    fetchDuble.mockResolvedValueOnce(json({ job_id: 42, message: { html: "<b>x</b>" } }));
    expect(await despacharParaOAios(pedido)).toEqual({ ok: true, status: 200, jobId: null, mensagem: null });

    fetchDuble.mockResolvedValueOnce(json(["lista"]));
    expect(await despacharParaOAios(pedido)).toEqual({ ok: true, status: 200, jobId: null, mensagem: null });
  });

  it("a mensagem do motor tem teto de tamanho", async () => {
    fetchDuble.mockResolvedValue(json({ message: "x".repeat(10_000) }));
    const r = await despacharParaOAios(pedido);
    expect(r.ok && r.mensagem?.length).toBe(4000);
  });

  it("fora de 2xx → 'recusado' com o status do motor", async () => {
    fetchDuble.mockResolvedValue(json({ detail: "org desconhecida" }, 422));
    expect(await despacharParaOAios(pedido)).toEqual({ ok: false, motivo: "recusado", status: 422 });
  });

  it("conexão recusada → 'inalcancavel'", async () => {
    fetchDuble.mockRejectedValue(new TypeError("fetch failed"));
    expect(await despacharParaOAios(pedido)).toEqual({ ok: false, motivo: "inalcancavel", status: null });
  });

  it("prazo estourado → 'prazo', que NÃO é a mesma coisa que inalcançável", async () => {
    fetchDuble.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await despacharParaOAios(pedido)).toEqual({ ok: false, motivo: "prazo", status: null });
  });
});
