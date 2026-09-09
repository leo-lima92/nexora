/**
 * A régua do design system, congelada em módulo — a fonte da derivação em RUNTIME.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e não um `readFileSync("app/globals.css")`:
 *
 * A imagem de produção é `output: "standalone"` (next.config.ts) e o Dockerfile
 * copia para o runner apenas `.next/standalone`, `.next/static` e `public/`. O
 * `app/globals.css` NÃO existe no contêiner que o self-hoster roda. Um
 * `readFileSync` no caminho de render do `app/layout.tsx` daria ENOENT — 500 em
 * todas as telas, na VPS de quem a feature existe para servir, e verde em dev,
 * em teste e na Vercel. É o mesmo modo de falha que `lib/branding.ts` documenta
 * para o `NEXT_PUBLIC_*`.
 *
 * A separação também é a certa conceitualmente: a RÉGUA é do produto e nasce
 * congelada no build; a COR é da instalação e só existe em runtime. Só a segunda
 * precisa ser lida do ambiente.
 *
 * ESTE ARQUIVO É GERADO. Não edite à mão: ele é o `extrairRegua()` aplicado ao
 * `app/globals.css`. `tests/unit/branding-regua-do-produto.test.ts` compara os
 * dois a cada run e imprime o literal novo na mensagem de falha — mexeu na
 * paleta, o teste reprova e entrega o texto para colar aqui.
 */

import type { Regua } from "./contraste";

export const REGUA_DO_PRODUTO: Regua = {
  "rampaDoProduto": [
    "#fef4f1",
    "#fde3db",
    "#fbc4b4",
    "#f89d84",
    "#f2704e",
    "#ea4b26",
    "#e42b0c",
    "#bd2109",
    "#951a07",
    "#6e1305",
    "#3d0a03"
  ],
  "claro": {
    "nome": "claro",
    "base": [
      {
        "chave": "--color-bg",
        "hex": "#f5f5f5"
      },
      {
        "chave": "--color-surface",
        "hex": "#ffffff"
      },
      {
        "chave": "--color-surface-elevated",
        "hex": "#f5f5f5"
      }
    ],
    "tingidas": [
      {
        "chave": "--color-accent-soft",
        "fonte": {
          "tipo": "grau",
          "indice": 0,
          "alfa": 1
        }
      }
    ],
    "papeis": [
      {
        "token": "--color-accent",
        "tipo": "componente",
        "fonte": {
          "tipo": "grau",
          "indice": 6,
          "alfa": 1
        },
        "contra": null
      },
      {
        "token": "--color-accent-fg",
        "tipo": "texto",
        "fonte": {
          "tipo": "frenteCalculada",
          "sobre": {
            "tipo": "grau",
            "indice": 6,
            "alfa": 1
          }
        },
        "contra": [
          {
            "tipo": "grau",
            "indice": 6,
            "alfa": 1
          }
        ]
      },
      {
        "token": "--color-accent-hover",
        "tipo": "componente",
        "fonte": {
          "tipo": "grau",
          "indice": 7,
          "alfa": 1
        },
        "contra": null
      }
    ],
    "semanticas": [
      {
        "nome": "success",
        "hex": "#346538"
      },
      {
        "nome": "warning",
        "hex": "#956400"
      },
      {
        "nome": "error",
        "hex": "#9f2f2d"
      },
      {
        "nome": "info",
        "hex": "#1f6c9f"
      }
    ],
    "neutros": [
      "#fafafa",
      "#f5f5f5",
      "#e5e7eb",
      "#d4d4d4",
      "#99a1af",
      "#8a8a8a",
      "#676767",
      "#4a5565",
      "#364153",
      "#101828",
      "#000000"
    ],
    "indices": {
      "accent": 6,
      "hover": 7,
      "soft": 0
    },
    "alfaDoSoft": 1
  },
  "escuro": {
    "nome": "escuro",
    "base": [
      {
        "chave": "--color-bg",
        "hex": "#141414"
      },
      {
        "chave": "--color-surface",
        "hex": "#1c1c1c"
      },
      {
        "chave": "--color-surface-elevated",
        "hex": "#242424"
      }
    ],
    "tingidas": [
      {
        "chave": "--color-accent-soft",
        "fonte": {
          "tipo": "literal",
          "hex": "#f2704e",
          "alfa": 0.14
        }
      }
    ],
    "papeis": [
      {
        "token": "--color-accent",
        "tipo": "componente",
        "fonte": {
          "tipo": "grau",
          "indice": 4,
          "alfa": 1
        },
        "contra": null
      },
      {
        "token": "--color-accent-fg",
        "tipo": "texto",
        "fonte": {
          "tipo": "frenteCalculada",
          "sobre": {
            "tipo": "grau",
            "indice": 4,
            "alfa": 1
          }
        },
        "contra": [
          {
            "tipo": "grau",
            "indice": 4,
            "alfa": 1
          }
        ]
      },
      {
        "token": "--color-accent-hover",
        "tipo": "componente",
        "fonte": {
          "tipo": "grau",
          "indice": 3,
          "alfa": 1
        },
        "contra": null
      }
    ],
    "semanticas": [
      {
        "nome": "success",
        "hex": "#86c08c"
      },
      {
        "nome": "warning",
        "hex": "#d8a648"
      },
      {
        "nome": "error",
        "hex": "#e07b78"
      },
      {
        "nome": "info",
        "hex": "#7fb4d8"
      }
    ],
    "neutros": [
      "#f5f5f5",
      "#e5e5e5",
      "#c4c4c4",
      "#a8a8a8",
      "#8a8a8a",
      "#6b6b6b",
      "#4f4f4f",
      "#3f3f3f",
      "#2b2b2b",
      "#1c1c1c",
      "#0a0a0a"
    ],
    "indices": {
      "accent": 4,
      "hover": 3,
      "soft": null
    },
    "alfaDoSoft": 0.14
  }
};
