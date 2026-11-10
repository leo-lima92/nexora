import * as fs from "node:fs";
import * as path from "node:path";

import type { Page } from "@playwright/test";

import { test, expect } from "./helpers/test";

/**
 * FORK NEXORA — TRÁFEGO AIOS PELA TELA.
 *
 * O que um gestor faz: acha "Tráfego AIOS" no menu lateral, abre a tela, conta
 * ao Estrategista de Tráfego a campanha que quer e aperta Enter. Enquanto o
 * pedido é entregue a conversa diz "Enviando instruções para o motor de IA…";
 * quando o motor confirma, o pedido aparece como entregue, com o protocolo.
 *
 * ─── Por que a rota é simulada ───────────────────────────────────────────────
 * `POST /api/v1/aios-dispatch` chama o motor AIOS, um serviço Python que não
 * existe no CI. O que esta spec prende é o CONTRATO DA TELA com a rota: o que
 * ela manda (`{ prompt }`, e mais nada — organização e pessoa são da sessão), o
 * que ela mostra enquanto espera e o que ela faz com cada desfecho. A rota e o
 * corpo que sai para o motor têm os próprios testes
 * (`tests/unit/nexora-aios-dispatch-rota.test.ts`, `nexora-aios-despacho.test.ts`).
 *
 * `page.route` basta aqui (diferente do Copiloto, que precisou trocar o `fetch`):
 * a resposta é um JSON só, e segurá-la é o que mantém o "Enviando…" na tela.
 */
const RAIZ = path.resolve(__dirname, "../..");
const ROTA = "**/api/v1/aios-dispatch";

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
  // `manager`: é o papel mínimo da tela e da rota, e o `admin` do seed tem
  // TOTP — a tela de 2FA não é o assunto aqui.
  const creds = lerCreds();
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/** Chega à tela pela PORTA — o item do menu lateral —, e não digitando a URL. */
async function abrirPeloMenu(page: Page) {
  const porta = page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Tráfego AIOS", exact: true });
  await expect(porta).toBeVisible({ timeout: 30_000 });
  await porta.click();
  await page.waitForURL(/\/app\/aios$/, { timeout: 30_000 });
  // A URL troca antes de a tela chegar (é página renderizada no servidor): o
  // prazo é o da navegação, não o padrão de 5s de um elemento já carregado.
  await expect(page.getByRole("heading", { level: 1, name: "Tráfego AIOS" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 2, name: "Estrategista de Tráfego" })).toBeVisible();
}

test("pelo menu: envia o pedido, mostra 'Enviando instruções…' e marca como entregue", async ({ page }) => {
  let corpoEnviado: unknown = null;
  let liberar!: () => void;
  const segurar = new Promise<void>((r) => (liberar = r));

  await page.route(ROTA, async (route) => {
    corpoEnviado = route.request().postDataJSON();
    await segurar; // a resposta só sai depois de a spec ver o "Enviando…"
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          status: "dispatched",
          action: "generate_campaign",
          job_id: "job-e2e-1",
          message: "Recebido. Vou montar a campanha da clínica.",
        },
      }),
    });
  });

  await entrar(page);
  await abrirPeloMenu(page);

  const campo = page.getByTestId("aios-campo");
  const enviar = page.getByTestId("aios-enviar");
  await expect(enviar).toBeDisabled();
  await expect(page.getByTestId("aios-pedidos")).toContainText("Nenhum pedido enviado ainda.");

  await campo.fill("Campanha de leads para clínica, R$ 50 por dia, por 15 dias");
  await campo.press("Enter");

  const enviando = page.getByTestId("aios-enviando");
  await expect(enviando).toBeVisible();
  await expect(enviando).toContainText("Enviando instruções para o motor de IA…");
  await expect(enviar).toBeDisabled();
  await expect(page.getByTestId("aios-pedido")).toHaveAttribute("data-estado", "enviando");
  await page.screenshot({ path: "evidence/trafego-aios/01-enviando.png" });

  liberar();

  await expect(enviando).toBeHidden();
  await expect(page.getByText("Recebido. Vou montar a campanha da clínica.")).toBeVisible();
  const pedido = page.getByTestId("aios-pedido");
  await expect(pedido).toHaveAttribute("data-estado", "entregue");
  await expect(pedido).toContainText("Entregue ao motor");
  await expect(pedido).toContainText("job-e2e-1");
  // A tela manda SÓ o texto: organização e pessoa quem decide é o servidor.
  expect(corpoEnviado).toEqual({ prompt: "Campanha de leads para clínica, R$ 50 por dia, por 15 dias" });
  await page.screenshot({ path: "evidence/trafego-aios/02-entregue.png" });
});

test("motor fora do ar: a conversa diz o que houve e devolve o texto ao campo", async ({ page }) => {
  await page.route(ROTA, (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "upstream_unavailable",
          message: "Não consegui falar com o motor de tráfego. Tente de novo em instantes; se continuar, avise quem instalou o sistema.",
        },
      }),
    }),
  );

  await entrar(page);
  await abrirPeloMenu(page);

  const campo = page.getByTestId("aios-campo");
  await campo.fill("Remarketing para quem já conversou com a gente");
  await page.getByTestId("aios-enviar").click();

  await expect(page.getByRole("log")).toContainText("Não consegui falar com o motor de tráfego.");
  const pedido = page.getByTestId("aios-pedido");
  await expect(pedido).toHaveAttribute("data-estado", "falhou");
  await expect(pedido).toContainText("Não enviado");
  await expect(campo).toHaveValue("Remarketing para quem já conversou com a gente");
  await expect(page.getByTestId("aios-enviando")).toBeHidden();
  await page.screenshot({ path: "evidence/trafego-aios/03-motor-fora-do-ar.png" });
});
