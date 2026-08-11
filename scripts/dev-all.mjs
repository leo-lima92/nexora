/**
 * Sobe o AMBIENTE LOCAL INTEIRO com um comando só: o app Next.js (a tela) e a
 * API Hono (a ponte AIOS/Meta), lado a lado, com log prefixado.
 *
 *   npm run dev:all
 *
 * Por que um script em vez de `concurrently`: o projeto não tem `concurrently`
 * instalado, e um comando de dev não vale uma dependência nova. Aqui é `spawn`
 * puro do Node — nada a instalar.
 *
 * Por que invoca os entrypoints .js direto, e não `node_modules/.bin/next`:
 * aqueles são shell scripts, que o `cmd.exe` do Windows não executa. Apontar
 * para o JS real e rodá-lo com o mesmo Node deste processo funciona igual nos
 * três sistemas, sem `shell: true`.
 *
 * Ctrl+C derruba os dois. Se um morrer sozinho, o outro é derrubado junto e o
 * código de saída é diferente de zero — meio ambiente de pé é pior do que
 * nenhum, porque parece que está funcionando.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Porta do Next. Explícita de propósito: não depende do default nem do .env. */
const NEXT_PORT = process.env.NEXT_PORT || "3000";

/** Porta do Hono: lida do .env (PORT), que é quem o `src/lib/env.ts` consulta. */
function honoPort() {
  const file = resolve(ROOT, ".env");
  if (!existsSync(file)) return "3000 (default — .env ausente)";
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*PORT\s*=\s*(.*)$/.exec(raw);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "3000 (default — PORT não está no .env)";
}

const NEXT_BIN = resolve(ROOT, "node_modules/next/dist/bin/next");
const TSX_CLI = resolve(ROOT, "node_modules/tsx/dist/cli.mjs");

for (const [label, path] of [["next", NEXT_BIN], ["tsx", TSX_CLI]]) {
  if (!existsSync(path)) {
    console.error(`\nFALTA ${label} em ${path}\nRode a instalação de dependências antes (pnpm install).\n`);
    process.exit(1);
  }
}

const services = [
  {
    name: "next",
    color: "\x1b[36m", // ciano
    args: [NEXT_BIN, "dev", "-p", NEXT_PORT],
  },
  {
    name: "hono",
    color: "\x1b[35m", // magenta
    args: [TSX_CLI, "watch", "--env-file=.env", "src/server.ts"],
  },
];

const RESET = "\x1b[0m";
const children = [];
let shuttingDown = false;

/** Prefixa cada linha com o nome do serviço, para os dois logs não se misturarem. */
function pipe(child, name, color) {
  const prefix = `${color}[${name}]${RESET} `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(prefix + line + "\n");
    });
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = code;
}

console.log(`
  Next.js  ->  http://localhost:${NEXT_PORT}
  API Hono ->  http://localhost:${honoPort()}/health

  Ctrl+C derruba os dois.
`);

for (const svc of services) {
  const child = spawn(process.execPath, svc.args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  pipe(child, svc.name, svc.color);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`\n${svc.color}[${svc.name}]${RESET} saiu (code=${code} signal=${signal}) — derrubando o outro.\n`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => shutdown(0));
}
