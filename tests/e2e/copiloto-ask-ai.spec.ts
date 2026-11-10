import * as fs from "node:fs";
import * as path from "node:path";

import type { Page } from "@playwright/test";

import { test, expect } from "./helpers/test";

/**
 * FORK NEXORA — O COPILOTO (Ask AI) PELA TELA.
 *
 * O que um gestor faz: clica em "Copiloto" na barra do topo, o painel lateral
 * entra, escreve o pedido, aperta Enter — e enquanto o modelo trabalha a gaveta
 * diz o que está acontecendo ("Pensando…", depois o passo da ferramenta), até a
 * resposta chegar com o atalho para o funil criado.
 *
 * ─── Por que a API é simulada ────────────────────────────────────────────────
 * `POST /api/v1/ask-ai` chama o modelo de verdade (custo real, resposta não
 * determinística). O que esta spec prende é o CONTRATO DA TELA com o stream
 * NDJSON de `lib/copiloto/eventos.ts`; a rota tem os próprios testes
 * (`tests/unit/nexora-copiloto-rota.test.ts`, `-turno`, `-ferramentas`).
 *
 * Duas simulações, porque elas medem coisas diferentes:
 *  1. `page.route` — a requisição sai pela rede de verdade e a spec confere o
 *     corpo (o histórico que vai ao modelo). Só que `route.fulfill` entrega o
 *     corpo de uma vez: os passos intermediários duram um quadro. Ela prova o
 *     "Pensando…" (segurando a resposta) e a resposta final.
 *  2. `fetch` trocado no navegador por um stream que a SPEC controla — linha a
 *     linha, como o servidor manda. Só assim o rótulo da ferramenta fica na tela
 *     tempo bastante para ser medido, que é o que a pessoa vê enquanto espera.
 */
const RAIZ = path.resolve(__dirname, "../..");
const ROTA = "**/api/v1/ask-ai";

test.describe.configure({ timeout: 120_000 });

interface Creds {
  password: string;
  users: Record<string, { email: string } | undefined>;
}

function lerCreds(): Creds {
  const p = path.join(RAIZ, ".e2e-creds.json");
  if (!fs.existsSync(p)) throw new Error("`.e2e-creds.json` ausente — rode `scripts/seed-e2e-credentials.ts`");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
}

async function entrar(page: Page) {
  // `manager`: é o papel mínimo que a rota do Copiloto aceita, e o `admin` do
  // seed tem TOTP — a tela de 2FA não é o assunto aqui.
  const creds = lerCreds();
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/** Abre o painel pelo botão da barra e mede que ele entrou na tela. */
async function abrirOCopiloto(page: Page) {
  const botao = page.getByTestId("ask-ai-botao");
  const painel = page.getByTestId("ask-ai-painel");
  await expect(botao).toBeVisible({ timeout: 30_000 });
  await expect(botao).toHaveAttribute("aria-expanded", "false");
  await expect(painel).toHaveAttribute("data-aberto", "false");

  await botao.click();

  await expect(botao).toHaveAttribute("aria-expanded", "true");
  await expect(painel).toHaveAttribute("data-aberto", "true");
  // Medido, não suposto: depois da transição a borda direita do painel encosta
  // na da janela e a esquerda está DENTRO dela (fechado, ele fica à direita, fora).
  await expect
    .poll(async () => {
      const r = await painel.evaluate((el) => el.getBoundingClientRect());
      const largura = await page.evaluate(() => window.innerWidth);
      return Math.abs(r.right - largura) < 1 && r.left >= 0 && r.left < largura;
    })
    .toBe(true);
  await expect(page.getByTestId("ask-ai-campo")).toBeFocused();
}

function ndjson(eventos: object[]): string {
  return eventos.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

test("abre pela barra do topo, mostra 'Pensando…' e entrega a resposta", async ({ page }) => {
  let corpoEnviado: unknown = null;
  let liberar!: () => void;
  const segurar = new Promise<void>((r) => (liberar = r));

  await page.route(ROTA, async (route) => {
    corpoEnviado = route.request().postDataJSON();
    await segurar; // a resposta só sai depois de a spec ver o "Pensando…"
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: ndjson([
        { tipo: "inicio", request_id: "e2e" },
        { tipo: "resposta", texto: "Você ainda não tem funis. Quer que eu crie um de vendas?" },
        { tipo: "fim" },
      ]),
    });
  });

  await entrar(page);
  await abrirOCopiloto(page);

  const campo = page.getByTestId("ask-ai-campo");
  await campo.fill("Quais funis eu tenho?");
  await campo.press("Enter");

  const pensando = page.getByTestId("ask-ai-pensando");
  await expect(pensando).toBeVisible();
  await expect(pensando).toContainText("Pensando…");
  await expect(page.getByTestId("ask-ai-enviar")).toBeDisabled();
  await expect(page.getByRole("log", { name: "Conversa com o copiloto" })).toContainText("Quais funis eu tenho?");
  await page.screenshot({ path: "evidence/copiloto-ask-ai/01-pensando.png" });

  liberar();

  await expect(pensando).toBeHidden();
  await expect(page.getByText("Você ainda não tem funis. Quer que eu crie um de vendas?")).toBeVisible();
  expect(corpoEnviado).toEqual({ mensagens: [{ papel: "pessoa", texto: "Quais funis eu tenho?" }] });
  await page.screenshot({ path: "evidence/copiloto-ask-ai/02-resposta.png" });
});

test("mostra o passo da ferramenta durante o stream e o atalho do funil criado", async ({ page }) => {
  // Troca o `fetch` SÓ para a rota do Copiloto por um stream que a spec alimenta
  // com `window.__copiloto.mandar(evento)` e fecha com `window.__copiloto.fechar()`.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let controlador: ReadableStreamDefaultController<Uint8Array> | null = null;
    const enc = new TextEncoder();
    (window as unknown as Record<string, unknown>).__copiloto = {
      pedidos: 0,
      mandar(e: object) {
        controlador?.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      },
      fechar() {
        controlador?.close();
      },
    };
    window.fetch = (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (!url.includes("/api/v1/ask-ai")) return original(entrada, init);
      const estado = (window as unknown as { __copiloto: { pedidos: number } }).__copiloto;
      estado.pedidos += 1;
      const corpo = new ReadableStream<Uint8Array>({
        start(c) {
          controlador = c;
        },
      });
      return Promise.resolve(
        new Response(corpo, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } }),
      );
    };
  });

  const mandar = (e: object) =>
    page.evaluate((ev) => (window as unknown as { __copiloto: { mandar(e: object): void } }).__copiloto.mandar(ev), e);

  await entrar(page);
  await abrirOCopiloto(page);

  const campo = page.getByTestId("ask-ai-campo");
  await campo.fill("Crie um funil de vendas para clínica");
  await page.getByTestId("ask-ai-enviar").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiloto: { pedidos: number } }).__copiloto.pedidos)).toBe(1);

  const pensando = page.getByTestId("ask-ai-pensando");
  await mandar({ tipo: "inicio", request_id: "e2e" });
  await expect(pensando).toContainText("Pensando…");

  await mandar({ tipo: "ferramenta", estado: "inicio", nome: "criar_funil" });
  await expect(pensando).toContainText("Criando o funil…");
  await page.screenshot({ path: "evidence/copiloto-ask-ai/03-ferramenta.png" });

  const id = "00000000-0000-4000-8000-0000000000c1";
  await mandar({ tipo: "ferramenta", estado: "fim", nome: "criar_funil", ok: true });
  await expect(pensando).toContainText("Pensando…");
  await mandar({ tipo: "funil_criado", pipeline_id: id, nome: "Clínica — Vendas", etapas: ["Novo", "Agendado"] });
  await mandar({ tipo: "resposta", texto: "Pronto: criei o funil «Clínica — Vendas»." });
  await mandar({ tipo: "fim" });
  await page.evaluate(() => (window as unknown as { __copiloto: { fechar(): void } }).__copiloto.fechar());

  await expect(pensando).toBeHidden();
  await expect(page.getByText("Pronto: criei o funil «Clínica — Vendas».")).toBeVisible();
  const atalho = page.getByTestId("ask-ai-funil-criado");
  await expect(atalho).toContainText("Clínica — Vendas");
  await expect(atalho).toHaveAttribute("href", `/app/pipelines/${id}`);
  await page.screenshot({ path: "evidence/copiloto-ask-ai/04-funil-criado.png" });

  // Esc fecha e devolve o foco ao botão que abriu.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ask-ai-painel")).toHaveAttribute("data-aberto", "false");
  await expect(page.getByTestId("ask-ai-botao")).toBeFocused();
});
