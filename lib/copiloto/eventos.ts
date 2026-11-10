/**
 * FORK NEXORA — o contrato do STREAM do Copiloto (`POST /api/v1/ask-ai`).
 *
 * A resposta é NDJSON (`application/x-ndjson`): uma linha JSON por evento, na
 * ordem em que acontecem no servidor. Este arquivo é importado pelos DOIS lados
 * (rota e `components/ask-ai/AskAI.tsx`), por isso não importa nada de servidor.
 *
 * ─── O que é transmitido em tempo real, e o que NÃO é ───────────────────────
 *
 * O texto do modelo chega INTEIRO, num evento `resposta` no fim. Não há token a
 * token, e é deliberado: toda chamada de modelo do produto passa por
 * `runModelCall` (o seam único), que confere o orçamento da organização e o
 * teto do plano ANTES de sair byte para o provedor e grava o custo em
 * `llm_calls` DEPOIS. Abrir um caminho de stream de tokens por fora do seam
 * seria abrir um caminho por fora da cobrança. O que vai em tempo real é o que
 * o Copiloto FAZ: cada ferramenta, quando começa e quando termina — "consultando
 * seus funis…", "criando o funil «Clínica»…". É o que a pessoa precisa ver
 * enquanto espera, porque é ali que algo muda no banco dela.
 */

/** Uma ferramenta que o Copiloto sabe usar. */
export type NomeDaFerramenta = "listar_funis" | "criar_funil";

/**
 * O que a tela mostra enquanto a ferramenta roda. Mora AQUI, e não no evento,
 * por dois motivos: a tela passa por `t(ROTULO_DA_FERRAMENTA[nome])`, que o
 * guarda de i18n consegue resolver (texto vindo do servidor ele não resolve);
 * e este módulo é o único do Copiloto que a tela pode importar sem arrastar
 * código de servidor.
 */
export const ROTULO_DA_FERRAMENTA: Record<NomeDaFerramenta, string> = {
  listar_funis: "Consultando seus funis…",
  criar_funil: "Criando o funil…",
};

export type EventoDoCopiloto =
  /** A primeira linha: o servidor aceitou o pedido e o modelo foi chamado. */
  | { tipo: "inicio"; request_id: string }
  /** Uma ferramenta começou a rodar. A frase da tela é `ROTULO_DA_FERRAMENTA[nome]`. */
  | { tipo: "ferramenta"; estado: "inicio"; nome: NomeDaFerramenta }
  /** Uma ferramenta terminou. `ok: false` = recusou (a frase vai ao modelo, que explica). */
  | { tipo: "ferramenta"; estado: "fim"; nome: NomeDaFerramenta; ok: boolean }
  /** Um funil nasceu no banco — a tela oferece o atalho para o quadro. */
  | { tipo: "funil_criado"; pipeline_id: string; nome: string; etapas: string[] }
  /** O texto final do assistente. */
  | { tipo: "resposta"; texto: string }
  /** Falhou depois de o stream abrir. A `mensagem` é para gente, nunca stack. */
  | { tipo: "erro"; codigo: string; mensagem: string }
  /** A última linha, sempre — com ou sem erro. */
  | { tipo: "fim" };

export const TIPO_DO_STREAM = "application/x-ndjson; charset=utf-8";

export function linhaDoEvento(evento: EventoDoCopiloto): string {
  return `${JSON.stringify(evento)}\n`;
}

/**
 * Lê os eventos de um corpo NDJSON à medida que as linhas chegam. Linha que não
 * é JSON é ignorada em vez de derrubar a leitura: um proxy que injete um
 * comentário não pode calar o Copiloto.
 */
export async function* lerEventos(
  corpo: ReadableStream<Uint8Array>,
): AsyncGenerator<EventoDoCopiloto> {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (value) resto += decodificador.decode(value, { stream: !done });
    let quebra = resto.indexOf("\n");
    while (quebra >= 0) {
      const linha = resto.slice(0, quebra).trim();
      resto = resto.slice(quebra + 1);
      if (linha) {
        try {
          yield JSON.parse(linha) as EventoDoCopiloto;
        } catch {
          // Linha que não é evento: ignorada (ver o cabeçalho da função).
        }
      }
      quebra = resto.indexOf("\n");
    }
    if (done) break;
  }
  const ultima = resto.trim();
  if (ultima) {
    try {
      yield JSON.parse(ultima) as EventoDoCopiloto;
    } catch {
      // idem
    }
  }
}
