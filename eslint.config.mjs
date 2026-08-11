// Flat config (ESLint 9 / eslint-config-next 16 — `next lint` foi removido no
// Next 16; o script `lint` chama o eslint CLI direto). Migração 1:1 do antigo
// .eslintrc.json.
import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
// NEXORA: gate de ciberseguranca do backend Hono (SECURITY_POLICIES.md).
// Migrado do antigo eslint.config.js na adocao do toolchain do chassi.
import securityPlugin from "eslint-plugin-security";

export default defineConfig([
  // `.claude/worktrees/` são checkouts locais de outros agentes (com `.next/` e
  // `node_modules/` próprios) — nunca fonte deste repo; lintá-los explode o eslint
  // com dezenas de milhares de falsos positivos em JS gerado. (Na CI, checkout
  // limpo, o diretório nem existe.)
  globalIgnores([
    ".next/", "node_modules/", "dist/", "supabase/", "next-env.d.ts",
    // `.claude/` inteiro: worktrees de outros agentes (motivo original do chassi)
    // + hooks .cjs do harness AIOS. Config de ferramenta, nao codigo de produto.
    ".claude/",
    // NEXORA: maquinaria do framework AIOS e configs de outras IDEs. Nao e
    // codigo de produto — `.aios-core/` e camada L1/L2 (imutavel por contrato,
    // ver .claude/rules/agent-authority.md) e usa CommonJS, o que gera ~1800
    // erros de no-require-imports sem nenhum valor. Ignores herdados do antigo
    // eslint.config.js, removido na adocao do toolchain do chassi.
    ".aios-core/", ".agent/", ".antigravity/", ".codex/", ".cursor/", ".gemini/",
    "docs/", ".github/",
  ]),
  nextPlugin.configs["core-web-vitals"],
  reactHooks.configs.flat.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      // react-hooks 7 introduziu esta regra como error; o padrão setState-em-
      // effect é pré-existente em 14 componentes — warn até o mutirão de refactor.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // Script CLI do gov-loop (roda via tsx, fora do bundle) — require() ok.
    files: ["loop/**/*.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // NEXORA: backend Hono do Closed Loop. Roda o eslint-plugin-security aqui —
    // e so aqui: sao rotas que recebem payload externo do AIOS Python.
    // Alimenta `pnpm security-check` (npm audit && eslint src).
    files: ["src/**/*.ts"],
    plugins: { security: securityPlugin },
    rules: { ...securityPlugin.configs.recommended.rules },
  },
]);
