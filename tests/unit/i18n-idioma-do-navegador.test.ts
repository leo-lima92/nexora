import { describe, expect, it } from "vitest";

import { IDIOMA_PADRAO, idiomaDelNavegador } from "@/lib/i18n/idiomas";
import { IDIOMAS_OFERECIDOS_NESTA_DISTRIBUICAO } from "@/lib/i18n/registro";

// FORK NEXORA: o espanhol está no código mas não é OFERECIDO nesta distribuição
// (`IDIOMAS_OFERECIDOS_NESTA_DISTRIBUICAO`, lib/i18n/registro.ts). Os casos que
// afirmavam "es é servido" passam a afirmar o contrato do fork — e voltam ao do
// upstream sozinhos se o espanhol for reoferecido.
const ES_SERVIDO = IDIOMAS_OFERECIDOS_NESTA_DISTRIBUICAO.includes("es");

describe("idiomaDelNavegador", () => {
  it("variantes regionais do espanhol viram es (ou o padrão, se o espanhol não é oferecido)", () => {
    const esperado = ES_SERVIDO ? "es" : IDIOMA_PADRAO;
    expect(idiomaDelNavegador(["es-MX", "es", "en"])).toBe(esperado);
    expect(idiomaDelNavegador(["es-419"])).toBe(esperado);
  });

  it("mantém português do Brasil", () => {
    expect(idiomaDelNavegador(["pt-BR", "pt", "en"])).toBe("pt-BR");
  });

  it("usa o primeiro idioma servido na ordem do navegador", () => {
    expect(idiomaDelNavegador(["en-US", "es-AR"])).toBe(ES_SERVIDO ? "es" : IDIOMA_PADRAO);
    expect(idiomaDelNavegador(["en-US", "pt-PT"])).toBe("pt-BR");
  });

  it("cai no padrão sem idioma servido ou com lista vazia", () => {
    expect(idiomaDelNavegador(["fr-FR", "de"])).toBe(IDIOMA_PADRAO);
    expect(idiomaDelNavegador([])).toBe(IDIOMA_PADRAO);
  });
});
