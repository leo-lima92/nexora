/**
 * O CATÁLOGO DE MODELOS — a face do módulo.
 *
 * Quem consome (a tela, a rota de instalação, o teste) importa daqui e nunca do
 * arquivo do nicho: acrescentar um nicho novo é acrescentar uma lista a
 * `MODELOS_DE_FOLLOWUP`, sem tocar em nenhum consumidor.
 */
import { MODELOS_DE_CLINICA } from "./clinica";
import type { ModeloDeFollowup, NichoDeModelo } from "./tipos";

export type { ModeloDeFollowup, NichoDeModelo, EntradaDoModelo } from "./tipos";
export { toquesDoModelo, horizonteDoModeloMs, NICHOS_DE_MODELO } from "./tipos";

export const MODELOS_DE_FOLLOWUP: readonly ModeloDeFollowup[] = [...MODELOS_DE_CLINICA];

/** `undefined` — e não um erro — para a rota devolver 404 com a sua própria mensagem. */
/**
 * FORK NEXORA — os nichos cujos modelos a galeria "Começar de um modelo" OFERECE
 * nesta distribuição. Decisão do CEO na sincronização v1.80.0 (2026-10-14): o
 * Nexora é um CRM generalista B2B, e funcionalidade de nicho entra no código
 * (para o merge com o upstream seguir barato) mas fica fora da interface
 * principal. Hoje o catálogo inteiro é de clínica, então a lista vazia esconde a
 * galeria e o botão. Os modelos continuam aqui e a rota de instalação continua
 * aceitando-os: oferecer um nicho de novo é acrescentá-lo a esta lista.
 */
export const NICHOS_OFERECIDOS_NA_GALERIA: readonly NichoDeModelo[] = [];

/** O que a galeria mostra: o catálogo filtrado pelos nichos oferecidos. */
export const MODELOS_OFERECIDOS_NA_GALERIA: readonly ModeloDeFollowup[] = MODELOS_DE_FOLLOWUP.filter(
  (m) => NICHOS_OFERECIDOS_NA_GALERIA.includes(m.nicho),
);

export function modeloPorId(id: string): ModeloDeFollowup | undefined {
  return MODELOS_DE_FOLLOWUP.find((m) => m.id === id);
}

export function modelosDoNicho(nicho: NichoDeModelo): ModeloDeFollowup[] {
  return MODELOS_DE_FOLLOWUP.filter((m) => m.nicho === nicho);
}
