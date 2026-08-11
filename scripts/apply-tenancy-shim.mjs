/**
 * Aplicação PONTUAL do shim de tenancy contra o banco.
 *
 * Aplica UM arquivo — `supabase/migrations/20260428000000_tenancy_shim_platform_base.sql` —
 * sem tocar nas outras 140 migrations do chassi (que NÃO estão aplicadas em produção
 * e cujo `db push` cego é proibido, ver NEXORA_MANIFEST v1.3).
 *
 * Roda em DRY-RUN por padrão: abre transação, aplica, mede, e dá ROLLBACK.
 * Só grava de verdade com `--commit`.
 *
 *   node scripts/apply-tenancy-shim.mjs            # dry-run (ROLLBACK)
 *   node scripts/apply-tenancy-shim.mjs --commit   # grava (COMMIT)
 *
 * Lê SUPABASE_DB_URL de .env / .env.local.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20260428000000_tenancy_shim_platform_base.sql",
);
const COMMIT = process.argv.includes("--commit");

/** Lê KEY=VALUE de um .env sem depender de dotenv. */
function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = {
  ...loadEnvFile(resolve(ROOT, ".env")),
  ...loadEnvFile(resolve(ROOT, ".env.local")),
  ...process.env,
};

const dbUrl = env.SUPABASE_DB_URL || env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    "\nFALTA SUPABASE_DB_URL.\n" +
      "Pegue em Supabase Dashboard -> Settings -> Database -> Connection string (modo Session)\n" +
      "e adicione ao .env:\n\n" +
      "  SUPABASE_DB_URL=postgresql://postgres.<ref>:<SENHA>@<host>:5432/postgres\n",
  );
  process.exit(1);
}

/** Esconde a senha ao ecoar a URL. */
const safeUrl = dbUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@");

/** Objetos que o shim cria — medidos ANTES e DEPOIS. */
const PROBE = `
select
  to_regclass('public.user_organizations')          is not null as tbl_user_organizations,
  to_regproc('public.fn_user_org_ids')              is not null as fn_user_org_ids,
  to_regproc('public.fn_is_org_admin')              is not null as fn_is_org_admin,
  to_regproc('public.fn_user_organizations_touch')  is not null as fn_touch,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'user_organizations')::int as policies,
  (select count(*) from public.profiles)::int       as profiles,
  (select count(*) from public.organizations)::int  as organizations,
  (select count(*) from public.user_organizations)::int as memberships
`;

/** Sonda tolerante: usada ANTES, quando a tabela pode ainda não existir. */
const PROBE_PRE = PROBE.replace(
  "(select count(*) from public.user_organizations)::int as memberships",
  "case when to_regclass('public.user_organizations') is null then -1 else " +
    "(select count(*) from public.user_organizations) end::int as memberships",
);

function show(label, row) {
  console.log(`\n--- ${label} ---`);
  for (const [k, v] of Object.entries(row)) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }
}

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
});

let failed = false;

try {
  console.log(`\nAlvo : ${safeUrl}`);
  console.log(`Modo : ${COMMIT ? "COMMIT (grava de verdade)" : "DRY-RUN (rollback ao final)"}`);
  console.log(`SQL  : ${MIGRATION}`);

  await client.connect();

  // --- Pré-condições: o shim referencia organizations e profiles. -----------
  const { rows: pre } = await client.query(PROBE_PRE);
  show("ANTES", pre[0]);

  if (pre[0].organizations === null) {
    throw new Error("public.organizations não existe — o shim depende dela.");
  }

  const sql = readFileSync(MIGRATION, "utf8");

  await client.query("begin");
  await client.query(sql);

  const { rows: post } = await client.query(PROBE);
  show("DEPOIS (dentro da transação)", post[0]);

  // --- Invariantes ---------------------------------------------------------
  const checks = [
    ["tabela user_organizations existe", post[0].tbl_user_organizations === true],
    ["fn_user_org_ids() existe", post[0].fn_user_org_ids === true],
    ["fn_is_org_admin() existe", post[0].fn_is_org_admin === true],
    ["4 policies RLS criadas", post[0].policies === 4],
    ["profiles NÃO mudou de contagem", post[0].profiles === pre[0].profiles],
    ["organizations NÃO mudou de contagem", post[0].organizations === pre[0].organizations],
    ["toda membership tem profile correspondente", post[0].memberships <= post[0].profiles],
  ];

  // fn_user_org_ids e fn_is_org_admin não podem ficar alcançáveis pela anon key.
  const { rows: grants } = await client.query(`
    select p.proname,
           has_function_privilege('anon',   p.oid, 'execute') as anon,
           has_function_privilege('public', p.oid, 'execute') as pub
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_user_org_ids','fn_is_org_admin')
  `);
  console.log("\n--- EXPOSIÇÃO (deve ser false/false) ---");
  for (const g of grants) {
    console.log(`  ${g.proname.padEnd(20)} anon=${g.anon}  public=${g.pub}`);
    checks.push([`${g.proname} não exposta a anon`, g.anon === false]);
    checks.push([`${g.proname} não exposta a PUBLIC`, g.pub === false]);
  }

  console.log("\n--- INVARIANTES ---");
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "OK  " : "FALHA"}  ${name}`);
    if (!ok) failed = true;
  }

  if (failed) {
    await client.query("rollback");
    console.log("\nROLLBACK — invariante falhou. Nada foi gravado.");
    process.exitCode = 1;
  } else if (COMMIT) {
    await client.query("commit");
    console.log("\nCOMMIT — shim aplicado.");
  } else {
    await client.query("rollback");
    console.log("\nROLLBACK — dry-run OK. Rode com --commit para gravar.");
  }
} catch (err) {
  try {
    await client.query("rollback");
  } catch {
    /* transação já abortada */
  }
  console.error(`\nERRO: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}