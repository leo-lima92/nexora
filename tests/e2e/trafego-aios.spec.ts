import * as fs from "node:fs";
import * as path from "node:path";

import type { Page, Route } from "@playwright/test";

import { test, expect } from "./helpers/test";

/**
 * FORK NEXORA — TRÁFEGO AIOS PELA TELA.
 *
 * O que um gestor faz: acha "Tráfego Agêntico" no menu lateral, abre a tela, conta
 * ao Estrategista de Tráfego a campanha que quer e aperta Enter. Enquanto o
 * pedido é entregue a conversa diz "Enviando instruções para o motor de IA…";
 * quando o motor confirma, o pedido aparece na lista como "Na fila do motor".
 * Quando o motor termina e grava a resposta, ela aparece no pedido e na
 * conversa. Ao voltar outro dia, os pedidos e as respostas continuam lá.
 *
 * ─── Por que a rota é simulada ───────────────────────────────────────────────
 * `POST /api/v1/aios-dispatch` chama o motor AIOS, um serviço Python que não
 * existe no CI — e é ele quem grava a resposta no banco. O que esta spec prende
 * é o CONTRATO DA TELA com a rota: o que ela manda (`{ prompt, request_id }`, e
 * mais nada — organização e pessoa são da sessão), o que ela mostra enquanto
 * espera, o que ela faz com cada desfecho e como ela lê o retorno pelo GET.
 *
 * O que NÃO é simulado tem prova própria: a rota e o corpo que sai para o motor
 * (`tests/unit/nexora-aios-dispatch-rota.test.ts`, `nexora-aios-despacho.test.ts`)
 * e a tabela, com a RLS e o caminho do motor num Postgres de verdade
 * (`tests/invariants/aios-campaign-requests-rls.test.ts`).
 *
 * `page.route` basta aqui (diferente do Copiloto, que precisou trocar o `fetch`):
 * cada resposta é um JSON só, e segurá-la é o que mantém o "Enviando…" na tela.
 */
const RAIZ = path.resolve(__dirname, "../..");
const ROTA = "**/api/v1/aios-dispatch*";
const EVIDENCIA = "evidence/trafego-aios-retorno";

test.describe.configure({ timeout: 120_000 });

interface Creds {
  password: string;
  users: Record<string, { email: string } | undefined>;
}

/** Uma linha de `aios_campaign_requests`, como a rota a devolve. */
interface Pedido {
  id: string;
  request_id: string;
  user_id: string;
  prompt: string;
  status: "queued" | "processing" | "completed" | "failed" | "unconfirmed";
  engine_job_id: string | null;
  response_summary: string | null;
  campaign_metadata: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function lerCreds(): Creds {
  const p = path.join(RAIZ, ".e2e-creds.json");
  if (!fs.existsSync(p)) throw new Error("`.e2e-creds.json` ausente — rode `scripts/seed-e2e-credentials.ts`");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Creds;
}

let serie = 0;
function pedido(extra: Partial<Pedido>): Pedido {
  serie += 1;
  const agora = new Date(Date.now() - serie * 60_000).toISOString();
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(serie).padStart(12, "0")}`,
    request_id: `pedido-e2e-${String(serie).padStart(4, "0")}`,
    user_id: "11111111-1111-4111-8111-111111111111",
    prompt: "Campanha de leads",
    status: "queued",
    engine_job_id: null,
    response_summary: null,
    campaign_metadata: {},
    error_message: null,
    created_at: agora,
    updated_at: agora,
    ...extra,
  };
}

function responderLista(route: Route, pedidos: Pedido[]) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: pedidos, meta: { cursor: null, has_more: false } }),
  });
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
    .getByRole("link", { name: "Tráfego Agêntico", exact: true });
  await expect(porta).toBeVisible({ timeout: 30_000 });
  await porta.click();
  await page.waitForURL(/\/app\/aios$/, { timeout: 30_000 });
  // A URL troca antes de a tela chegar (é página renderizada no servidor): o
  // prazo é o da navegação, não o padrão de 5s de um elemento já carregado.
  await expect(page.getByRole("heading", { level: 1, name: "Tráfego Agêntico" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 2, name: "Estrategista de Tráfego" })).toBeVisible();
}

test("pelo menu: envia o pedido, vê 'Enviando…', a fila do motor e depois a resposta", async ({ page }) => {
  // O "banco" desta spec: o que o GET devolve. O POST acrescenta a linha, e a
  // spec faz o papel do motor quando troca o status dela.
  const banco: Pedido[] = [];
  let corpoEnviado: { prompt?: string; request_id?: string } | null = null;
  let liberar!: () => void;
  const segurar = new Promise<void>((r) => (liberar = r));

  await page.route(ROTA, async (route) => {
    if (route.request().method() === "GET") return responderLista(route, banco);

    corpoEnviado = route.request().postDataJSON() as { prompt: string; request_id: string };
    await segurar; // a resposta só sai depois de a spec ver o "Enviando…"
    const linha = pedido({
      request_id: corpoEnviado.request_id!,
      prompt: corpoEnviado.prompt!,
      engine_job_id: "job-e2e-1",
      created_at: new Date().toISOString(),
    });
    banco.unshift(linha);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          status: "dispatched",
          action: "generate_campaign",
          job_id: "job-e2e-1",
          message: "Recebido. Vou montar a campanha da clínica.",
          request: linha,
        },
      }),
    });
  });

  await entrar(page);
  await abrirPeloMenu(page);

  const campo = page.getByTestId("aios-campo");
  const enviar = page.getByTestId("aios-enviar");
  const conversa = page.getByRole("log");
  await expect(enviar).toBeDisabled();
  await expect(page.getByTestId("aios-pedidos")).toContainText("Nenhum pedido enviado ainda.");

  await campo.fill("Campanha de leads para clínica, R$ 50 por dia, por 15 dias");
  await campo.press("Enter");

  const enviando = page.getByTestId("aios-enviando");
  await expect(enviando).toBeVisible();
  await expect(enviando).toContainText("Enviando instruções para o motor de IA…");
  await expect(enviar).toBeDisabled();
  await expect(page.getByTestId("aios-pedido")).toHaveAttribute("data-estado", "enviando");
  await page.screenshot({ path: `${EVIDENCIA}/01-enviando.png` });

  liberar();

  await expect(enviando).toBeHidden();
  await expect(conversa).toContainText("Recebido. Vou montar a campanha da clínica.");
  const item = page.getByTestId("aios-pedido");
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute("data-estado", "queued");
  await expect(item).toContainText("Na fila do motor");
  await expect(item).toContainText("job-e2e-1");
  // A tela manda SÓ o texto e o id do pedido: organização e pessoa quem decide é o servidor.
  expect(Object.keys(corpoEnviado ?? {}).sort()).toEqual(["prompt", "request_id"]);
  expect(corpoEnviado!.prompt).toBe("Campanha de leads para clínica, R$ 50 por dia, por 15 dias");
  expect(corpoEnviado!.request_id).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
  await page.screenshot({ path: `${EVIDENCIA}/02-na-fila-do-motor.png` });

  // O motor terminou: gravou a resposta na linha. A tela a busca sozinha — a
  // spec não clica em nada, só espera a consulta automática.
  const RESPOSTA = "Campanha criada: 1 campanha de leads, 3 conjuntos de anúncios, R$ 50,00 por dia, por 15 dias.";
  banco[0] = { ...banco[0]!, status: "completed", response_summary: RESPOSTA, updated_at: new Date().toISOString() };

  await expect(item).toHaveAttribute("data-estado", "completed", { timeout: 20_000 });
  await expect(item).toContainText("Concluído");
  await expect(item.getByTestId("aios-resposta")).toContainText(RESPOSTA);
  // E a resposta do pedido desta sessão entra na conversa, que é para onde a pessoa olha.
  await expect(conversa).toContainText(RESPOSTA);
  await page.screenshot({ path: `${EVIDENCIA}/03-resposta-do-motor.png` });
});

test("ao abrir a tela: o histórico da organização, com o status e a resposta de cada pedido", async ({ page }) => {
  const banco = [
    pedido({ prompt: "Remarketing para quem já conversou", status: "processing", engine_job_id: "job-e2e-9" }),
    pedido({
      prompt: "Campanha de promoção de inverno",
      status: "completed",
      response_summary: "Campanha no ar desde ontem: 2 conjuntos, R$ 80,00 por dia.",
    }),
    pedido({
      prompt: "Campanha para divulgar o novo endereço",
      status: "failed",
      error_message: "A conta de anúncios está sem forma de pagamento.",
    }),
  ];
  let leituras = 0;
  await page.route(ROTA, (route) => {
    leituras += 1;
    return responderLista(route, banco);
  });

  await entrar(page);
  await abrirPeloMenu(page);

  const itens = page.getByTestId("aios-pedido");
  await expect(itens).toHaveCount(3);
  await expect(itens.nth(0)).toHaveAttribute("data-estado", "processing");
  await expect(itens.nth(0)).toContainText("Em andamento");
  await expect(itens.nth(1)).toHaveAttribute("data-estado", "completed");
  await expect(itens.nth(1).getByTestId("aios-resposta")).toContainText("Campanha no ar desde ontem");
  await expect(itens.nth(2)).toHaveAttribute("data-estado", "failed");
  await expect(itens.nth(2).getByTestId("aios-pedido-erro")).toHaveText(
    "A conta de anúncios está sem forma de pagamento.",
  );
  // Pedido de outra sessão não vira mensagem do estrategista na conversa.
  await expect(page.getByRole("log")).not.toContainText("Campanha no ar desde ontem");
  await page.screenshot({ path: `${EVIDENCIA}/04-historico.png` });

  // Atualizar lê de novo, e o que mudou no banco aparece.
  banco[0] = { ...banco[0]!, status: "completed", response_summary: "Remarketing criado: público de 30 dias." };
  const antes = leituras;
  await page.getByTestId("aios-atualizar").click();
  await expect(itens.nth(0)).toHaveAttribute("data-estado", "completed");
  await expect(itens.nth(0).getByTestId("aios-resposta")).toContainText("Remarketing criado");
  expect(leituras).toBeGreaterThan(antes);
});

test("motor fora do ar: a conversa diz o que houve, devolve o texto ao campo e o pedido fica como falhou", async ({
  page,
}) => {
  const FRASE =
    "Não consegui falar com o motor de tráfego. Tente de novo em instantes; se continuar, avise quem instalou o sistema.";
  const banco: Pedido[] = [];
  await page.route(ROTA, async (route) => {
    if (route.request().method() === "GET") return responderLista(route, banco);
    const corpo = route.request().postDataJSON() as { prompt: string; request_id: string };
    // A rota registra o pedido antes de chamar o motor: recusado, ele fica `failed`.
    banco.unshift(
      pedido({
        request_id: corpo.request_id,
        prompt: corpo.prompt,
        status: "failed",
        error_message: FRASE,
        created_at: new Date().toISOString(),
      }),
    );
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "upstream_unavailable", message: FRASE } }),
    });
  });

  await entrar(page);
  await abrirPeloMenu(page);

  const campo = page.getByTestId("aios-campo");
  await campo.fill("Remarketing para quem já conversou com a gente");
  await page.getByTestId("aios-enviar").click();

  await expect(page.getByRole("log")).toContainText("Não consegui falar com o motor de tráfego.");
  const item = page.getByTestId("aios-pedido");
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute("data-estado", "failed");
  await expect(item).toContainText("Falhou");
  await expect(item.getByTestId("aios-pedido-erro")).toHaveText(FRASE);
  await expect(campo).toHaveValue("Remarketing para quem já conversou com a gente");
  await expect(page.getByTestId("aios-enviando")).toBeHidden();
  await page.screenshot({ path: `${EVIDENCIA}/05-motor-fora-do-ar.png` });
});
