/**
 * FORK NEXORA — a fronteira do contexto de Meta Ads.
 *
 * ─── A regra ────────────────────────────────────────────────────────────────
 *
 * O Nexora NUNCA fala com a Meta de anúncios diretamente: nem para devolver
 * conversão (Conversions API — o "Closed Loop"), nem para ler campanha. Esse
 * contexto é do motor AIOS (Python), que lê os cards pelas colunas geradas da
 * migration 9901 (`crm_leads.utm_*` e `crm_leads.meta_*_id`) e conversa com a
 * Meta do lado dele. O Nexora só RECEBE o rastreio (webhook de entrada) e o
 * guarda no card.
 *
 * Dois emissores falando com a mesma conta de anúncios mandariam a mesma venda
 * duas vezes — e a deduplicação da Meta só funciona se os dois lados usarem o
 * mesmo `event_id`, coisa que nenhum contrato entre os dois garante.
 *
 * ─── Onde a regra é aplicada (e por que só ali) ─────────────────────────────
 *
 * Cada corte é no ponto ÚNICO que o upstream já tem, para o diff do fork ficar
 * pequeno e o próximo sync do upstream não conflitar em arquivo grande:
 *
 *   1. EVENTOS — `lib/plataformas-de-anuncio/registry.ts`: `meta_ads` fica SEM
 *      transporte. Todo caminho de envio (compra, evento de etapa, LeadSubmitted
 *      por clique e por nascimento, e a venda pelo canal da conversa) pergunta
 *      ao registro antes de qualquer `fetch` e registra
 *      `plataforma_sem_transporte` no livro-razão — o desfecho já previsto pelo
 *      upstream (invariante 4 da restrição de canal), não um erro.
 *   2. LEITURA — `lib/plataformas-de-anuncio/credenciais-de-leitura.ts`: a
 *      credencial de leitura da Meta responde `sem_conexao`. As rotas de contas,
 *      campanhas e hierarquia do anúncio já tratam esse caso.
 *   3. TELA — o menu (`permitidos`), o catálogo de recursos opcionais e a tela
 *      de Conversões deixam de oferecer o que não funciona mais.
 *
 * O que NÃO é afetado: a API Oficial do WhatsApp (recurso `meta` do servidor —
 * é canal de conversa, não anúncio), o Google Ads, a captura de origem (UTM,
 * links rastreáveis, script do site) e a atribuição de entrada do
 * clique-para-WhatsApp. Tudo isso é dado que ENTRA, e é dele que o AIOS vive.
 *
 * Constante, e não variável de ambiente, de propósito: a decisão é de
 * arquitetura do fork, não de cada instalação. Uma chave no `.env` seria um
 * jeito de um operador religar, sem saber, um segundo emissor de conversões.
 */

/** `false` no Nexora. Só um teste que vigia o comportamento do upstream o troca. */
// `boolean`, e não o literal `false`: é uma decisão, não um tipo — sem a
// anotação o TypeScript estreita cada `if` e trata o lado ligado como morto.
export const NEXORA_FALA_COM_A_META_DE_ANUNCIOS: boolean = false;

/** As portas do menu que só servem ao contexto desligado. */
export const PORTAS_DA_META_ADS: ReadonlySet<string> = new Set([
  "/app/ads/meta",
  "/app/settings/meta-ads",
]);

/** As linhas do catálogo de recursos opcionais que só servem ao contexto desligado. */
export const RECURSOS_DA_META_ADS: ReadonlySet<string> = new Set([
  "conversoes_meta",
  "venda_pelo_canal",
]);

export function portaDesligadaNoNexora(href: string): boolean {
  return !NEXORA_FALA_COM_A_META_DE_ANUNCIOS && PORTAS_DA_META_ADS.has(href);
}

export function recursoDesligadoNoNexora(id: string): boolean {
  return !NEXORA_FALA_COM_A_META_DE_ANUNCIOS && RECURSOS_DA_META_ADS.has(id);
}
