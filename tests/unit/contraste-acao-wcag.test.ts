/**
 * Contraste WCAG das superfícies de AÇÃO — medido, não afirmado.
 *
 * ─── O defeito que este teste existe para matar ──────────────────────────────
 * O comentário do token dizia "5.3:1 sobre #e42b0c — passa AA". O valor real é
 * 4.52:1. Ninguém mentiu: alguém mediu errado uma vez, escreveu o número ao lado
 * da cor, e a partir daí o número passou a ser lido como prova. Um comentário
 * não recalcula quando a cor muda — e foi assim que o gradiente `cta` chegou a
 * 2.65:1 com texto branco por cima (rótulo ilegível na borda esquerda de TODO
 * botão de conversão) sem que nenhum gate reclamasse.
 *
 * A lição não é "corrija o comentário": é que contraste anotado à mão apodrece
 * em silêncio. Este arquivo lê os TOKENS VIVOS de `app/globals.css` e recalcula.
 * Se alguém clarear a vermillion, trocar o gradiente ou mexer no foreground, o
 * CI reprova com o número medido em mãos, e não com uma opinião sobre a cor.
 *
 * ─── Por que o gradiente é amostrado, e não só nas paradas ───────────────────
 * As paradas do Sunset Flux caem em -33.85% e -1.54% — FORA da caixa. O que o
 * olho vê na borda do botão é interpolação, não parada. Conferir só os stops
 * declarados aprovaria um gradiente cuja região visível reprova. Por isso a
 * varredura anda pela rampa inteira e cobra o PIOR ponto.
 *
 * ─── Por que o escopo é o BLOCO, e não a primeira ocorrência do seletor ──────
 * No Tailwind 4 a string `[data-theme="dark"]` aparece primeiro dentro do
 * `@custom-variant dark (...)`, na linha 25 — muito antes do bloco de tokens.
 * Um `indexOf` ingênuo cairia ali e leria os tokens do `:root` achando que eram
 * do escuro: o teste do dark mediria o light e passaria por acidente. Verde que
 * não mede é o defeito que este arquivo existe para matar, então o escopo é a
 * linha `<seletor> {` exata, e o token é procurado só até o `}` que a fecha.
 *
 * ─── Por que `var()` é resolvido ─────────────────────────────────────────────
 * `--color-accent` é `var(--color-accent-400)` no escuro (é o contrato da régua
 * de marca, lib/branding/contraste.ts: o accent é um GRAU da rampa, nunca um hex
 * solto). Medir a string `var(...)` seria impossível; medir só literais deixaria
 * o botão primário do escuro sem gate. A referência é seguida dentro do próprio
 * escopo e, se não estiver lá, no `:root` — que é a cascata real.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

/** Piso do WCAG 2.1 AA para corpo de texto (<18.66px). Botão usa 13px. */
const PISO_AA_TEXTO = 4.5;

type RGB = [number, number, number];

function canalLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminancia([r, g, b]: RGB): number {
  return (
    0.2126 * canalLinear(r / 255) +
    0.7152 * canalLinear(g / 255) +
    0.0722 * canalLinear(b / 255)
  );
}

function contraste(a: RGB, b: RGB): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const alto = Math.max(la, lb);
  const baixo = Math.min(la, lb);
  return (alto + 0.05) / (baixo + 0.05);
}

function corDeTexto(valor: string): RGB {
  const hex = /^#([0-9a-f]{6})$/i.exec(valor.trim());
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(valor.trim());
  if (rgb?.[1] && rgb[2] && rgb[3]) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`cor não reconhecida: ${valor}`);
}

/** O texto de UM bloco de tokens: da linha `<seletor> {` até o `}` que a fecha. */
function bloco(seletor: string): string {
  const linhas = CSS.split("\n");
  const inicio = linhas.findIndex((l) => l.trim() === `${seletor} {`);
  if (inicio < 0) throw new Error(`escopo não encontrado: ${seletor}`);
  const fim = linhas.findIndex((l, i) => i > inicio && l.trim() === "}");
  if (fim < 0) throw new Error(`escopo não fecha: ${seletor}`);
  return linhas.slice(inicio + 1, fim).join("\n");
}

function tokenCru(escopo: string, nome: string): string {
  const m = new RegExp(`^\\s*${nome}\\s*:\\s*([^;]+);`, "m").exec(bloco(escopo));
  if (!m?.[1]) throw new Error(`token ${nome} não encontrado em ${escopo}`);
  return m[1].trim();
}

/**
 * Lê um token no escopo e segue `var(--x)` até chegar num valor literal —
 * primeiro dentro do próprio escopo, depois no `:root`, que é a cascata real.
 */
function tokenNoEscopo(escopo: string, nome: string, profundidade = 0): string {
  if (profundidade > 8) throw new Error(`referência circular a partir de ${nome}`);
  let valor: string;
  try {
    valor = tokenCru(escopo, nome);
  } catch (e) {
    if (escopo === ":root") throw e;
    valor = tokenCru(":root", nome);
  }
  const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(valor);
  return ref?.[1] ? tokenNoEscopo(escopo, ref[1], profundidade + 1) : valor;
}

function interpolar(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Pior razão de contraste do `texto` sobre toda a interpolação do gradiente. */
function piorPontoDoGradiente(decl: string, texto: RGB): { pior: number; onde: RGB } {
  const paradas = [...decl.matchAll(/rgba?\([^)]+\)/gi)].map((m) => corDeTexto(m[0]));
  expect(paradas.length, "gradiente deve declarar suas paradas").toBeGreaterThanOrEqual(2);
  let pior = Number.POSITIVE_INFINITY;
  let onde: RGB = texto;
  for (let i = 0; i < paradas.length - 1; i++) {
    const de = paradas[i];
    const para = paradas[i + 1];
    if (!de || !para) continue;
    for (let t = 0; t <= 1; t += 0.02) {
      const cor = interpolar(de, para, t);
      const r = contraste(texto, cor);
      if (r < pior) {
        pior = r;
        onde = cor;
      }
    }
  }
  return { pior, onde };
}

describe("contraste WCAG AA das superfícies de ação", () => {
  it("botão primário (light): accent-fg sobre accent passa AA", () => {
    const fundo = corDeTexto(tokenNoEscopo(":root", "--color-accent"));
    const texto = corDeTexto(tokenNoEscopo(":root", "--color-accent-fg"));
    const r = contraste(texto, fundo);
    expect(r, `medido ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(PISO_AA_TEXTO);
  });

  it("botão primário (dark): accent-fg sobre accent passa AA", () => {
    const fundo = corDeTexto(tokenNoEscopo('[data-theme="dark"]', "--color-accent"));
    const texto = corDeTexto(tokenNoEscopo('[data-theme="dark"]', "--color-accent-fg"));
    const r = contraste(texto, fundo);
    expect(r, `medido ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(PISO_AA_TEXTO);
  });

  it("o escopo do dark é o bloco de tokens, não o @custom-variant", () => {
    // Se o `indexOf` ingênuo voltasse, `--color-bg` do "dark" seria o do :root.
    expect(tokenNoEscopo('[data-theme="dark"]', "--color-bg")).not.toBe(
      tokenNoEscopo(":root", "--color-bg"),
    );
  });

  it("CTA (light): cta-fg passa AA em TODO ponto do gradiente Sunset Flux", () => {
    const texto = corDeTexto(tokenNoEscopo(":root", "--color-cta-fg"));
    const { pior, onde } = piorPontoDoGradiente(tokenNoEscopo(":root", "--gradient-vermillion"), texto);
    expect(
      pior,
      `pior ponto ${pior.toFixed(2)}:1 em rgb(${onde.join(", ")}) — o rótulo do CTA some ali`,
    ).toBeGreaterThanOrEqual(PISO_AA_TEXTO);
  });

  it("CTA (dark): cta-fg passa AA em TODO ponto do gradiente Sunset Flux do dark", () => {
    const texto = corDeTexto(tokenNoEscopo('[data-theme="dark"]', "--color-cta-fg"));
    const { pior, onde } = piorPontoDoGradiente(
      tokenNoEscopo('[data-theme="dark"]', "--gradient-vermillion"),
      texto,
    );
    expect(
      pior,
      `pior ponto ${pior.toFixed(2)}:1 em rgb(${onde.join(", ")}) — o rótulo do CTA some ali`,
    ).toBeGreaterThanOrEqual(PISO_AA_TEXTO);
  });

  it("CTA (light): o texto é branco de verdade — o token não pode escurecer para 'passar'", () => {
    expect(tokenNoEscopo(":root", "--color-cta-fg").toLowerCase()).toBe("#ffffff");
  });

  it("nenhuma parada do gradiente claro é mais clara que o stop 600 (DESIGN_SYSTEM §Princípio 2)", () => {
    const stop600 = luminancia(corDeTexto(tokenNoEscopo(":root", "--color-accent-600")));
    const decl = tokenNoEscopo(":root", "--gradient-vermillion");
    for (const m of decl.matchAll(/rgba?\([^)]+\)/gi)) {
      const cor = corDeTexto(m[0]);
      expect(
        luminancia(cor),
        `rgb(${cor.join(", ")}) é mais claro que o stop 600 em área grande`,
      ).toBeLessThanOrEqual(stop600 + 1e-9);
    }
  });
});
