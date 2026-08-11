/**
 * Diagnóstico de conexão do SUPABASE_DB_URL — NUNCA imprime o segredo.
 *
 * Distingue os dois modos de falha comuns quando a senha tem caractere
 * especial (@, ], /, #): parsing errado da URL vs senha realmente inválida.
 *
 *   node scripts/probe-db-auth.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

const env = { ...loadEnvFile(resolve(ROOT, ".env")), ...loadEnvFile(resolve(ROOT, ".env.local")) };
const url = env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL ausente.");
  process.exit(1);
}

// Split manual: user entre "//" e o primeiro ":", senha até o ÚLTIMO "@",
// resto é host[:porta]/database. Robusto a senha com "@" não-encodada.
const m = /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@/]+?)(?::(\d+))?\/(.+?)(?:\?.*)?$/.exec(url);
if (!m) {
  console.error("Não consegui parsear SUPABASE_DB_URL.");
  process.exit(1);
}
const [, user, password, host, port, database] = m;

console.log(`user     : ${user}`);
console.log(`host     : ${host}`);
console.log(`port     : ${port || 5432}`);
console.log(`database : ${database}`);
console.log(`senha    : ${password.length} chars; especiais: ${[...new Set(password.match(/[^A-Za-z0-9]/g) || [])].join(" ") || "(nenhum)"}`);
console.log(`percent-encoded na URL? ${/%[0-9A-Fa-f]{2}/.test(password) ? "sim" : "não"}`);

async function tryConnect(label, config) {
  const c = new pg.Client({ ...config, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    const { rows } = await c.query("select current_user, current_database()");
    console.log(`  OK    ${label} -> ${rows[0].current_user}@${rows[0].current_database}`);
    await c.end();
    return true;
  } catch (e) {
    console.log(`  FALHA ${label} -> ${e.message}`);
    try { await c.end(); } catch { /* já fechado */ }
    return false;
  }
}

console.log("\nTentativas:");
// A: string crua, como o pg interpreta hoje.
const a = await tryConnect("connectionString cru", { connectionString: url });
// B: campos discretos — imune a problema de encoding na URL.
const b = await tryConnect("campos discretos", {
  user, password, host, port: Number(port || 5432), database,
});
// C: senha percent-decodada, caso já esteja encodada no .env.
let c = false;
if (/%[0-9A-Fa-f]{2}/.test(password)) {
  c = await tryConnect("senha percent-decodada", {
    user, password: decodeURIComponent(password), host, port: Number(port || 5432), database,
  });
}

console.log("\nVEREDITO:");
if (a || b || c) {
  console.log("  Credencial VÁLIDA. " + (a ? "A URL crua funciona." : "A URL precisa de percent-encoding na senha — os campos discretos conectam."));
} else {
  console.log("  Credencial REJEITADA em todas as formas de parsing.");
  console.log("  => a senha do banco está errada ou foi rotacionada.");
  console.log("  => pegue a atual em: Supabase Dashboard -> Settings -> Database -> Reset database password");
}
