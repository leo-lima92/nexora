import { describe, expect, it, beforeAll } from "vitest";

import { columnExists, indexExists, lastLine, sql, tableExists } from "./gov-helpers";

/**
 * 0144/0145 — a convergência AIOS ↔ chassi tem gate.
 *
 * As migrations 0144 e 0145 trouxeram CINCO tabelas tenant-aware (`companies`,
 * `deals`, `linkedin_threads`, `extraction_runs`) e fundiram o modelo de
 * `contacts` do módulo de tráfego AIOS dentro da `contacts` CANÔNICA do chassi.
 * Entraram na `main` com o check `invariants` VERDE — e verde apenas porque
 * ninguém perguntou: não havia uma linha de teste citando nenhuma delas.
 *
 * A doutrina é explícita ("teste de isolamento com 2 tenants é obrigatório no
 * CI antes de merge"), e o modo de falha aqui é o pior da casa: uma tabela
 * nova nasce com grant para `anon` por causa do `ALTER DEFAULT PRIVILEGES` do
 * baseline, e o vazamento é silencioso — nada quebra, o dado só fica legível
 * por quem tem a anon key, que vai para o browser.
 *
 * ⚠️ O invariante mais importante deste arquivo é o §6:
 * `contacts` NÃO PODE ganhar uma coluna `org_id`.
 *
 * A tentação é permanente e parece inofensiva: o módulo Hono inteiro fala
 * `org_id`, e adicionar a coluna ao lado de `organization_id` é a mudança de
 * menor atrito do repositório. Ela também é a mais perigosa. A RLS de
 * `contacts` filtra `organization_id`; um segundo campo para o MESMO fato pode
 * divergir num UPDATE, e a partir daí a linha é visível ao tenant errado — ou
 * invisível ao dono. Sobre a coluna que separa clientes, duplicação não é
 * *code smell*: é falha de isolamento. O writer converge (a RPC traduz), a
 * chave de tenant continua única. Quem ler isto daqui a seis meses e quiser
 * "consertar a divergência de nomes" estaria desfazendo a decisão inteira.
 */

// Namespace próprio (dddddddd-) — as suítes rodam em paralelo e os fixtures
// de rls-isolation (aaaa/bbbb) e gov-* (cccc) não podem colidir com estes.
const ORG_A = "dddddddd-0000-4000-8000-000000000001";
const ORG_B = "dddddddd-0000-4000-8000-000000000002";
const USER_A = "dddddddd-1111-4000-8000-000000000001";
const USER_B = "dddddddd-1111-4000-8000-000000000002";

/** Roda SELECTs como `authenticated` com os claims do usuário (caminho real da RLS). */
function rowsAs(userId: string, query: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${query}
  `);
  const last = lastLine(out);
  if (!/^\d+$/.test(last)) throw new Error(`saída inesperada do psql: ${out}`);
  return Number(last);
}

/** Executa esperando FALHA; devolve o stderr do psql. Lança se o script passar. */
function expectSqlToFail(script: string): string {
  try {
    sql(script);
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? "";
  }
  throw new Error("o script SQL passou, mas o invariante esperava falha");
}

function seed(org: string, user: string, tag: string): string {
  // Sem PII real (LGPD): apenas sintéticos @invariant.test.
  return `
    insert into auth.users (id, email) values ('${user}', 'conv-${tag}@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'conv-inv-${tag}', 'Convergencia ${tag}', 'Conv ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role)
      values ('${user}', '${org}', 'admin')
      on conflict do nothing;
  `;
}

beforeAll(() => {
  sql(`${seed(ORG_A, USER_A, "a")} ${seed(ORG_B, USER_B, "b")}`);
});

describe("0145 §1 — as peças existem", () => {
  it("extraction_runs foi criada", () => {
    expect(tableExists("extraction_runs")).toBe(true);
  });

  it("contacts ganhou as 3 colunas com writer real", () => {
    // Cada uma tem escritor HOJE: company_id e apify_run_id no
    // google-maps-mapper.service.ts, preferred_channel idem. Coluna sem writer
    // numa tabela que carrega LGPD é peso morto — por isso são só três.
    expect(columnExists("contacts", "company_id")).toBe(true);
    expect(columnExists("contacts", "apify_run_id")).toBe(true);
    expect(columnExists("contacts", "preferred_channel")).toBe(true);
  });

  it("contacts.company_id é FK de verdade para companies (não string solta)", () => {
    const def = sql(`
      select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.contacts'::regclass
         and contype = 'f' and conname = 'contacts_company_id_fkey';
    `);
    expect(def).toContain("REFERENCES companies(id)");
  });

  it("os índices de busca das colunas novas existem", () => {
    expect(indexExists("contacts_company_id_idx")).toBe(true);
    expect(indexExists("contacts_org_apify_run_idx")).toBe(true);
    expect(indexExists("extraction_runs_active_by_source_idx")).toBe(true);
  });

  it("o índice de run ativa NÃO é único", () => {
    // Um UNIQUE aqui viraria garantia de banco para "máximo 1 run ativa", mas
    // proibiria duas extrações legítimas do mesmo source com queries diferentes
    // (google_maps de SP e do Rio ao mesmo tempo). A política é opt-in no
    // service por design; o índice só a torna barata.
    const isUnique = sql(`
      select indisunique from pg_index
       where indexrelid = 'public.extraction_runs_active_by_source_idx'::regclass;
    `);
    expect(isUnique).toBe("f");
  });

  it("rpc_upsert_lead mantém a assinatura de 11 parâmetros do contrato AIOS", () => {
    // O bloco `Functions` de src/types/database.ts compila contra ESTA
    // assinatura. A convergência aconteceu inteira dentro do corpo — mudar a
    // aridade aqui quebra o Hono sem o typecheck perceber.
    const args = sql(`
      select pg_get_function_identity_arguments(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'rpc_upsert_lead';
    `);
    expect(args.split(",")).toHaveLength(11);
    expect(args).toContain("p_org_id uuid");
  });

  it("rpc_upsert_lead é SECURITY INVOKER, não DEFINER", () => {
    // DEFINER transformaria um grant vazado em escrita cross-tenant: a RLS de
    // contacts/companies deixaria de ser a última linha de defesa.
    const isDefiner = sql(`
      select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'rpc_upsert_lead';
    `);
    expect(isDefiner).toBe("f");
  });
});

describe("0145 §2 — fn_e164_or_null nunca adivinha código de país", () => {
  // O bug que esta função existe para impedir: prefixar '+' num número sem
  // código de país produz E.164 de FORMATO VÁLIDO e DESTINO ERRADO. A
  // mensagem sai, entrega, e chega num estranho. Ausência de telefone é
  // recuperável; telefone errado não é.
  const casos: Array<[string, string | null, string]> = [
    ["+55 11 91234-5678", "+5511912345678", "internacional: normaliza"],
    ["+1 (415) 555-0100", "+14155550100", "internacional US: normaliza"],
    ["(11) 3000-0000", null, "NACIONAL: recusa em vez de inventar +55"],
    ["11912345678", null, "só dígitos, sem +: recusa"],
    ["", null, "vazio: null"],
    ["   ", null, "só espaço: null"],
    ["+123", null, "curto demais para E.164: null"],
    ["+9999999999999999999", null, "longo demais para E.164: null"],
  ];

  it.each(casos)("%s → %s (%s)", (entrada, esperado) => {
    const out = sql(
      `select coalesce(public.fn_e164_or_null($$${entrada}$$), '<NULL>');`,
    );
    expect(out).toBe(esperado ?? "<NULL>");
  });

  it("o que a função devolve SEMPRE satisfaz o CHECK E.164 de contacts", () => {
    // O contrato entre a função e a constraint, medido em vez de presumido.
    const violacoes = sql(`
      with amostra(v) as (values
        ('+55 11 91234-5678'), ('+1 (415) 555-0100'), ('(11) 3000-0000'),
        ('11912345678'), (''), ('+123'), ('+55  11  9 1234 5678')
      )
      select count(*) from amostra
       where public.fn_e164_or_null(v) is not null
         and public.fn_e164_or_null(v) !~ '^\\+\\d{8,15}$';
    `);
    expect(violacoes).toBe("0");
  });
});

describe("0145 §3 — rpc_upsert_lead escreve na contacts CANÔNICA", () => {
  /**
   * ⚠️ O resultado da RPC precisa ser MATERIALIZADO antes de ser cruzado com
   * `contacts`, e a tabela temporária aqui não é preguiça.
   *
   * A forma óbvia — `with r as (select * from rpc_upsert_lead(...)) select ...
   * from r join contacts c on c.id = r.contact_id` — devolve ZERO LINHAS. A
   * função insere durante o statement, mas o scan de `contacts` do outro lado
   * do join enxerga o snapshot do INÍCIO do statement, onde a linha ainda não
   * existia. Nada falha; o join simplesmente não casa.
   *
   * Foi assim que este arquivo nasceu, e o espelho contra um Postgres real
   * pegou os três casos. Vale registrar porque o modo de falha é traiçoeiro:
   * num teste escrito com `toBeGreaterThan(0)` em vez de igualdade exata, o
   * vazio passaria como sucesso.
   */
  function upsertEJoin(chamada: string, projecao: string): string {
    return lastLine(
      sql(`
        create temp table _lead as select * from public.rpc_upsert_lead(${chamada});
        select ${projecao} from _lead l join public.contacts c on c.id = l.contact_id;
      `),
    );
  }

  it("cria company + contact vinculados, com o nome convergido", () => {
    const out = upsertEJoin(
      `'${ORG_A}', 'Padaria Invariante', 'meta_ads', 'facebook',
       'camp_inv', 'adset_inv', 'ad_inv',
       'Jose', 'da Silva', '+55 11 98888-7777', 'jose@padaria.invariant.test'`,
      `c.name || '|' || coalesce(c.phone_number, '<NULL>') || '|' ||
       (c.company_id = l.company_id)::text || '|' ||
       (c.organization_id = '${ORG_A}')::text`,
    );
    // nome junto | telefone E.164 | elo B2B | tenant correto
    expect(out).toBe("Jose da Silva|+5511988887777|t|t");
  });

  it("telefone nacional vira NULL e sobrevive cru em source_metadata", () => {
    const out = upsertEJoin(
      `'${ORG_A}', 'Mercearia Invariante', 'organic', 'google',
       null, null, null, 'Maria', null, '(11) 3000-0000', null`,
      `coalesce(c.phone_number, '<NULL>') || '|' ||
       coalesce(c.source_metadata->>'phone_raw', '<SEM RAW>') || '|' || c.name`,
    );
    expect(out).toBe("<NULL>|(11) 3000-0000|Maria");
  });

  it("não grava phone_raw quando o telefone normalizou (nada redundante)", () => {
    const out = upsertEJoin(
      `'${ORG_A}', 'Bar Invariante', 'organic', 'google',
       null, null, null, 'Ana', null, '+5511977776666', null`,
      `(c.source_metadata ? 'phone_raw')::text`,
    );
    expect(out).toBe("f");
  });

  it("o lead ENTRA mesmo com telefone impossível de normalizar", () => {
    // Telefone incidental ruim não pode derrubar o lead inteiro: o contato
    // ainda vale por e-mail, por funil e por curadoria posterior.
    const out = sql(`
      select (company_id is not null and contact_id is not null)::text
        from public.rpc_upsert_lead(
          '${ORG_A}', 'Sem Telefone Ltda', 'organic', 'direct',
          null, null, null, 'Carlos', null, 'liga pro zap ai', null);
    `);
    expect(lastLine(out)).toBe("t");
  });

  it("ATOMICIDADE: falha no insert de contacts não deixa company órfã", () => {
    // E-mail inválido viola contacts_email_format: o 2º insert falha e o 1º
    // TEM que ser desfeito. Órfão aqui significaria empresa no CRM sem
    // ninguém para contatar — lixo que ninguém sabe de onde veio.
    const stderr = expectSqlToFail(`
      select * from public.rpc_upsert_lead(
        '${ORG_A}', 'Loja Fantasma', 'meta_ads', 'facebook',
        null, null, null, 'Fantasma', null, null, 'isto-nao-eh-email');
    `);
    expect(stderr).toContain("contacts_email_format");

    const orfas = sql(
      `select count(*) from public.companies where org_id = '${ORG_A}' and name = 'Loja Fantasma';`,
    );
    expect(orfas).toBe("0");
  });
});

describe("0145 §4 — isolamento entre 2 tenants (a razão de o CI existir)", () => {
  // O tenant B precisa ter linha em TODAS as tabelas que este bloco afirma
  // estarem isoladas. Sem isso, "A vê 0 linhas de B" passa porque não existe
  // linha nenhuma — asserção vazia, que é o modo de falha que este arquivo
  // inteiro existe para não repetir (ver o cabeçalho de
  // vocabulario-banco-x-typescript.test.ts sobre invariante presumido).
  const PIPE_B = "dddddddd-5555-4000-8000-000000000002";
  const STAGE_B = "dddddddd-5555-4000-8000-000000000003";

  beforeAll(() => {
    sql(`
      insert into public.extraction_runs (org_id, source, status, query)
        values ('${ORG_A}', 'google_maps', 'running', 'padarias sp');
      insert into public.extraction_runs (org_id, source, status, query)
        values ('${ORG_B}', 'linkedin', 'pending', 'rh rj');

      select * from public.rpc_upsert_lead(
        '${ORG_B}', 'Empresa do Tenant B', 'organic', 'direct',
        null, null, null, 'Bruno', null, null, null);

      insert into public.linkedin_threads (org_id, linkedin_thread_id, message_count)
        values ('${ORG_B}', 'thread-do-tenant-b', 3);

      insert into public.crm_pipelines (id, organization_id, name, slug)
        values ('${PIPE_B}', '${ORG_B}', 'Funil B', 'funil-b')
        on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values ('${STAGE_B}', '${ORG_B}', '${PIPE_B}', 'Novo', 'novo', 1)
        on conflict (id) do nothing;
      insert into public.deals (org_id, pipeline_id, stage_id, title, value)
        values ('${ORG_B}', '${PIPE_B}', '${STAGE_B}', 'Negocio do Tenant B', 1000);
    `);
  });

  it("o fixture do tenant B existe de fato (controle positivo)", () => {
    // Sem este controle, todo `toBe(0)` abaixo é indistinguível de tabela
    // vazia. Aqui a conexão é `postgres` (bypassa RLS), então enxerga tudo.
    for (const [tabela, coluna] of [
      ["extraction_runs", "org_id"],
      ["companies", "org_id"],
      ["contacts", "organization_id"],
      ["deals", "org_id"],
      ["linkedin_threads", "org_id"],
    ]) {
      const n = Number(sql(`select count(*) from public.${tabela} where ${coluna} = '${ORG_B}';`));
      expect(n).toBeGreaterThan(0);
    }
  });

  it("usuário do tenant A não vê NENHUMA extraction_run do tenant B", () => {
    expect(
      rowsAs(USER_A, `select count(*) from public.extraction_runs where org_id = '${ORG_B}';`),
    ).toBe(0);
    expect(
      rowsAs(USER_A, `select count(*) from public.extraction_runs where org_id = '${ORG_A}';`),
    ).toBeGreaterThan(0);
  });

  it("o isolamento é simétrico (B também não vê A)", () => {
    expect(
      rowsAs(USER_B, `select count(*) from public.extraction_runs where org_id = '${ORG_A}';`),
    ).toBe(0);
  });

  it("A não vê companies nem contacts do B", () => {
    expect(
      rowsAs(USER_A, `select count(*) from public.companies where org_id = '${ORG_B}';`),
    ).toBe(0);
    expect(
      rowsAs(USER_A, `select count(*) from public.contacts where organization_id = '${ORG_B}';`),
    ).toBe(0);
  });

  it("A não vê deals nem linkedin_threads do B", () => {
    expect(rowsAs(USER_A, `select count(*) from public.deals where org_id = '${ORG_B}';`)).toBe(0);
    expect(
      rowsAs(USER_A, `select count(*) from public.linkedin_threads where org_id = '${ORG_B}';`),
    ).toBe(0);
  });

  it("A não consegue ESCREVER uma extraction_run no tenant B", () => {
    // Leitura isolada não basta: o WITH CHECK da policy é o que impede um
    // tenant de plantar linha na casa do outro.
    const stderr = expectSqlToFail(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);
      insert into public.extraction_runs (org_id, source, status)
        values ('${ORG_B}', 'manual', 'pending');
    `);
    expect(stderr).toContain("row-level security");
  });
});

describe("0145 §5 — nada novo nasceu exposto ao anon", () => {
  // O `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon` do baseline
  // vale para toda tabela criada DEPOIS dele — isto é, para todo apêndice
  // novo. Sem o `revoke`, a tabela nasce legível pela anon key, que vai para
  // o browser. Foi o achado da issue #128 em outra camada; aqui é o mesmo
  // mecanismo, uma tabela por vez.
  const novas = ["companies", "deals", "linkedin_threads", "extraction_runs"];

  it.each(novas)("anon não tem NENHUM privilégio em %s", (tabela) => {
    const n = sql(`
      select count(*) from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public' and table_name = '${tabela}';
    `);
    expect(n).toBe("0");
  });

  it.each(novas)("%s tem RLS habilitada e policy de tenant", (tabela) => {
    expect(sql(`select relrowsecurity from pg_class where oid = 'public.${tabela}'::regclass;`)).toBe("t");
    expect(
      sql(`select count(*) from pg_policies
            where schemaname = 'public' and tablename = '${tabela}'
              and policyname = 'tenant_isolation_${tabela}_all';`),
    ).toBe("1");
  });

  // ⚠️ Esta asserção afirma o CONJUNTO EXATO de grantees, e não "anon não está
  // na lista". A diferença não é estilística — é o defeito que a 0146 conserta.
  //
  // A doutrina do CLAUDE.md §9 nomeia DUAS origens de EXECUTE (o grant direto
  // a `anon` do ALTER DEFAULT PRIVILEGES e o grant a PUBLIC que o Postgres dá
  // na criação). Existem TRÊS: o baseline tem QUATRO linhas irmãs de
  // `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS` — postgres, anon,
  // **authenticated**, service_role. A 0145 revogou `public, anon`, declarou
  // "caller esperado: service_role", e o ACL real do banco era
  // `postgres=X authenticated=X service_role=X`.
  //
  // Uma checagem por lista negra ('anon', 'PUBLIC') passava VERDE nesse estado.
  // Só a lista branca vê a terceira origem — e verá a quarta, se um dia
  // aparecer. Medido por sabotagem: com o grant a `authenticated` de volta, a
  // versão por lista negra passa e esta falha.
  it.each(["fn_e164_or_null", "rpc_upsert_lead"])(
    "%s é executável APENAS por postgres e service_role",
    (fn) => {
      const grantees = sql(`
        select coalesce(string_agg(distinct grantee, ',' order by grantee), '<nenhum>')
          from information_schema.routine_privileges
         where specific_schema = 'public' and routine_name = '${fn}';
      `);
      expect(grantees).toBe("postgres,service_role");
    },
  );
});

describe("0145 §6 — a chave de tenant de contacts continua ÚNICA", () => {
  it("contacts NÃO tem coluna org_id", () => {
    // Ver o cabeçalho deste arquivo. Este é o invariante que protege a decisão
    // central da convergência, e a única forma de falha aqui é alguém
    // "consertando" a divergência de nomes entre AIOS e chassi adicionando a
    // coluna. A tradução é trabalho do writer (rpc_upsert_lead), não do schema.
    expect(columnExists("contacts", "org_id")).toBe(false);
  });

  it("a policy de contacts filtra por organization_id", () => {
    const def = sql(`
      select coalesce(qual, '') from pg_policies
       where schemaname = 'public' and tablename = 'contacts'
         and policyname = 'tenant_isolation_contacts_all';
    `);
    expect(def).toContain("organization_id");
  });

  it("companies/deals/extraction_runs usam org_id e a MESMA fn_user_org_ids", () => {
    // O desvio de nome é consciente (o módulo Hono inteiro fala `org_id`), mas
    // o mecanismo de isolamento tem que ser o mesmo helper — senão são duas
    // definições de "meus tenants" que podem divergir.
    for (const tabela of ["companies", "deals", "linkedin_threads", "extraction_runs"]) {
      const qual = sql(`
        select coalesce(qual, '') from pg_policies
         where schemaname = 'public' and tablename = '${tabela}'
           and policyname = 'tenant_isolation_${tabela}_all';
      `);
      expect(qual).toContain("fn_user_org_ids");
      expect(qual).toContain("org_id");
    }
  });
});
