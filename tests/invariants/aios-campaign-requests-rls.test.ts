import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql, writeCountAs } from "./gov-helpers";

/**
 * FORK NEXORA — `aios_campaign_requests` (migration 9902): OS PEDIDOS DE
 * CAMPANHA NÃO VAZAM ENTRE ORGANIZAÇÕES, NÃO VAZAM PARA BAIXO DE `manager`, E
 * A RESPOSTA DO MOTOR SÓ ENTRA PELA SERVICE KEY.
 *
 * ─── Por que um arquivo próprio, e não uma linha em rls-isolation.test.ts ────
 *
 * Pelo mesmo motivo de `historico-de-captacao-rls.test.ts`: aquele molde semeia
 * um usuário `agent` por organização, e a policy desta tabela exige `manager`.
 * O controle positivo falharia por ACERTO, e a "correção" natural seria
 * afrouxar a policy para caber no teste. Está declarado em `PROVA_PROPRIA`
 * (`rls-completude-varredura.test.ts`).
 *
 * ─── O que cada bloco prova ─────────────────────────────────────────────────
 *
 *   LEITURA   manager lê os da própria organização e zero do vizinho; agent,
 *             viewer e anon não leem. A rota não é a única porta — o PostgREST
 *             é alcançável do navegador com o JWT da pessoa.
 *   INSERT    manager insere o pedido como ele NASCE: `queued`, em nome de quem
 *             está logado, sem protocolo, resposta nem erro. Qualquer outra
 *             forma é recusada — sem isso um gestor gravaria pelo PostgREST uma
 *             linha `completed` com a "resposta do motor" escrita por ele.
 *   UPDATE /  `authenticated` não tem o privilégio (nem policy): resposta de
 *   DELETE    campanha só entra pela service key. `permission denied`, e não
 *             zero linhas — o GRANT foi revogado, não só a policy omitida.
 *   MOTOR     a service role faz o caminho do contrato (`processing` →
 *             `completed` com `response_summary`), e o banco carimba
 *             `updated_at` sozinho. É o que `docs/AIOS_PYTHON_CONTRACT.md`
 *             promete ao lado Python.
 *   FORMA     `request_id` único por organização (e livre entre organizações),
 *             `status` fora do vocabulário recusado, tetos de tamanho.
 *   APAGAR    a organização leva os pedidos; o login de quem pediu não sai
 *             enquanto houver pedido dele (RESTRICT, e não cascade fantasma).
 *
 * Conectar como `postgres` mediria NADA (rolbypassrls = t). Aqui é `set role` +
 * `request.jwt.claims`, o mesmo caminho que a produção usa.
 */

const ORG_A = "a1050000-0000-4000-8000-00000000000a";
const ORG_B = "a1050000-0000-4000-8000-00000000000b";
const ORG_DESCARTAVEL = "a1050000-0000-4000-8000-00000000000d";
const MANAGER_A = "a1050000-1111-4000-8000-00000000000a";
const AGENT_A = "a1050000-1111-4000-8000-0000000000a2";
const VIEWER_A = "a1050000-1111-4000-8000-0000000000a1";
const MANAGER_B = "a1050000-1111-4000-8000-00000000000b";
const MANAGER_DESCARTAVEL = "a1050000-1111-4000-8000-00000000000d";

const T = "public.aios_campaign_requests";

/** Roda como um papel do PostgREST. Devolve a saída, ou a mensagem do erro. */
function comoPapel(
  papel: "anon" | "authenticated" | "service_role",
  userId: string | null,
  script: string,
): { ok: true; saida: string } | { ok: false; erro: string } {
  try {
    const claims = userId ? `select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);` : "";
    return { ok: true, saida: sql(`set role ${papel}; ${claims} ${script}`) };
  } catch (err) {
    return { ok: false, erro: String((err as { stderr?: string }).stderr ?? err) };
  }
}

/** Como superusuário: o estado de verdade da linha, sem RLS no caminho. */
function valor(consulta: string): string {
  const linhas = sql(consulta).split("\n");
  return linhas[linhas.length - 1] ?? "";
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${MANAGER_A}', 'aios-mgr-a@invariant.test'),
      ('${AGENT_A}',   'aios-agent-a@invariant.test'),
      ('${VIEWER_A}',  'aios-viewer-a@invariant.test'),
      ('${MANAGER_B}', 'aios-mgr-b@invariant.test'),
      ('${MANAGER_DESCARTAVEL}', 'aios-mgr-d@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'aios-inv-a', 'Aios Invariant A', 'Aios A'),
      ('${ORG_B}', 'aios-inv-b', 'Aios Invariant B', 'Aios B'),
      ('${ORG_DESCARTAVEL}', 'aios-inv-d', 'Aios Invariant D', 'Aios D')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENT_A}',   '${ORG_A}', 'agent',   now()),
      ('${VIEWER_A}',  '${ORG_A}', 'viewer',  now()),
      ('${MANAGER_B}', '${ORG_B}', 'manager', now()),
      ('${MANAGER_DESCARTAVEL}', '${ORG_DESCARTAVEL}', 'manager', now())
      on conflict do nothing;

    -- Um pedido por organização, gravado como o servidor o gravaria.
    insert into ${T} (organization_id, user_id, request_id, prompt) values
      ('${ORG_A}', '${MANAGER_A}', 'semente-a-0001', 'Campanha sintética da org A'),
      ('${ORG_B}', '${MANAGER_B}', 'semente-b-0001', 'Campanha sintética da org B'),
      ('${ORG_DESCARTAVEL}', '${MANAGER_DESCARTAVEL}', 'semente-d-0001', 'Campanha sintética da org D')
      on conflict (organization_id, request_id) do nothing;
  `);
});

describe("aios_campaign_requests — leitura: isolamento e gate de papel", () => {
  it("o manager da org A lê os pedidos da PRÓPRIA org (controle positivo)", () => {
    expect(
      countAs(MANAGER_A, `select count(*) from ${T} where organization_id = '${ORG_A}';`),
    ).toBeGreaterThan(0);
  });

  it("o manager da org A lê ZERO pedidos da org B", () => {
    expect(countAs(MANAGER_A, `select count(*) from ${T} where organization_id = '${ORG_B}';`)).toBe(0);
  });

  it("a tabela inteira, sem filtro, é exatamente a própria organização", () => {
    const total = countAs(MANAGER_A, `select count(*) from ${T};`);
    const proprias = countAs(MANAGER_A, `select count(*) from ${T} where organization_id = '${ORG_A}';`);
    expect(total).toBe(proprias);
  });

  it("o manager da org B lê os dele e zero da org A (o outro sentido)", () => {
    expect(countAs(MANAGER_B, `select count(*) from ${T} where organization_id = '${ORG_B}';`)).toBeGreaterThan(0);
    expect(countAs(MANAGER_B, `select count(*) from ${T} where organization_id = '${ORG_A}';`)).toBe(0);
  });

  it.each([
    ["agent", AGENT_A],
    ["viewer", VIEWER_A],
  ])("o %s da própria org não lê pedido nenhum — a régua é manager", (_papel, userId) => {
    expect(countAs(userId, `select count(*) from ${T};`)).toBe(0);
  });

  it("anon não tem privilégio de leitura (o default ACL do Supabase foi revogado)", () => {
    const r = comoPapel("anon", null, `select count(*) from ${T};`);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erro).toContain("permission denied");
  });
});

describe("aios_campaign_requests — INSERT: só o pedido como ele nasce", () => {
  it("o manager insere um pedido queued, em nome dele, na própria org (controle positivo)", () => {
    expect(
      writeCountAs(
        MANAGER_A,
        `insert into ${T} (organization_id, user_id, request_id, prompt)
         values ('${ORG_A}', '${MANAGER_A}', 'inserido-pelo-manager', 'Campanha de leads')`,
      ),
    ).toBe(1);
    expect(valor(`select status from ${T} where request_id = 'inserido-pelo-manager';`)).toBe("queued");
  });

  it("não insere na organização do vizinho", () => {
    expect(
      writeCountAs(
        MANAGER_A,
        `insert into ${T} (organization_id, user_id, request_id, prompt)
         values ('${ORG_B}', '${MANAGER_A}', 'invasao-org-b', 'x')`,
      ),
    ).toBe(0);
    expect(valor(`select count(*) from ${T} where request_id = 'invasao-org-b';`)).toBe("0");
  });

  it("não insere em nome de outra pessoa", () => {
    expect(
      writeCountAs(
        MANAGER_A,
        `insert into ${T} (organization_id, user_id, request_id, prompt)
         values ('${ORG_A}', '${AGENT_A}', 'em-nome-de-outro', 'x')`,
      ),
    ).toBe(0);
  });

  it.each([
    ["status completed", `status`, `'completed'`],
    ["status processing", `status`, `'processing'`],
    ["resposta do motor", `response_summary`, `'Campanha criada: confie em mim.'`],
    ["protocolo do motor", `engine_job_id`, `'job-forjado'`],
    ["mensagem de erro", `error_message`, `'erro forjado'`],
    ["metadados da campanha", `campaign_metadata`, `'{"budget_cents": 1}'::jsonb`],
  ])("o manager NÃO forja %s pelo PostgREST", (_caso, coluna, literal) => {
    expect(
      writeCountAs(
        MANAGER_A,
        `insert into ${T} (organization_id, user_id, request_id, prompt, ${coluna})
         values ('${ORG_A}', '${MANAGER_A}', 'forjado-${coluna}', 'x', ${literal})`,
      ),
    ).toBe(0);
    expect(valor(`select count(*) from ${T} where request_id = 'forjado-${coluna}';`)).toBe("0");
  });

  it.each([
    ["agent", AGENT_A],
    ["viewer", VIEWER_A],
  ])("o %s não insere pedido", (_papel, userId) => {
    expect(
      writeCountAs(
        userId,
        `insert into ${T} (organization_id, user_id, request_id, prompt)
         values ('${ORG_A}', '${userId}', 'pedido-de-${_papel}', 'x')`,
      ),
    ).toBe(0);
  });

  it("anon não insere", () => {
    const r = comoPapel(
      "anon",
      null,
      `insert into ${T} (organization_id, user_id, request_id, prompt)
       values ('${ORG_A}', '${MANAGER_A}', 'pedido-de-anon', 'x');`,
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erro).toContain("permission denied");
  });
});

describe("aios_campaign_requests — UPDATE e DELETE não são de authenticated", () => {
  it("o manager não altera o próprio pedido: a resposta só entra pela service key", () => {
    const r = comoPapel(
      "authenticated",
      MANAGER_A,
      `update ${T} set status = 'completed', response_summary = 'forjada' where request_id = 'semente-a-0001';`,
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erro).toContain("permission denied");
    expect(valor(`select status from ${T} where request_id = 'semente-a-0001' and organization_id = '${ORG_A}';`)).toBe(
      "queued",
    );
  });

  it("o manager não apaga pedido", () => {
    const r = comoPapel("authenticated", MANAGER_A, `delete from ${T} where request_id = 'semente-a-0001';`);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erro).toContain("permission denied");
    expect(valor(`select count(*) from ${T} where request_id = 'semente-a-0001';`)).toBe("1");
  });
});

describe("aios_campaign_requests — o caminho do motor (service role)", () => {
  it("o motor acha a linha por (organization_id, request_id), anda o status e grava a resposta", () => {
    sql(`
      insert into ${T} (organization_id, user_id, request_id, prompt, created_at, updated_at)
      values ('${ORG_A}', '${MANAGER_A}', 'caminho-do-motor', 'Campanha de leads',
              now() - interval '1 hour', now() - interval '1 hour')
      on conflict (organization_id, request_id) do nothing;
    `);

    const andando = comoPapel(
      "service_role",
      null,
      `update ${T} set status = 'processing', engine_job_id = 'job-900'
        where organization_id = '${ORG_A}' and request_id = 'caminho-do-motor';`,
    );
    expect(andando.ok, andando.ok ? "" : andando.erro).toBe(true);

    const concluido = comoPapel(
      "service_role",
      null,
      `update ${T}
          set status = 'completed',
              response_summary = 'Campanha criada: 3 conjuntos de anúncios.',
              campaign_metadata = '{"meta_campaign_id": "120210000000000", "daily_budget_cents": 5000}'::jsonb
        where organization_id = '${ORG_A}' and request_id = 'caminho-do-motor';`,
    );
    expect(concluido.ok, concluido.ok ? "" : concluido.erro).toBe(true);

    expect(
      valor(
        `select status || '|' || engine_job_id || '|' || response_summary || '|' || (campaign_metadata->>'daily_budget_cents')
           from ${T} where request_id = 'caminho-do-motor';`,
      ),
    ).toBe("completed|job-900|Campanha criada: 3 conjuntos de anúncios.|5000");
    // `updated_at` é do banco: o motor não o escreveu, e ele andou.
    expect(valor(`select (updated_at > created_at + interval '30 minutes')::text from ${T} where request_id = 'caminho-do-motor';`)).toBe(
      "true",
    );
    // E o manager lê a resposta — é o que a tela mostra.
    expect(
      countAs(MANAGER_A, `select count(*) from ${T} where request_id = 'caminho-do-motor' and status = 'completed';`),
    ).toBe(1);
  });

  it("status fora do vocabulário é recusado até para o motor", () => {
    const r = comoPapel(
      "service_role",
      null,
      `update ${T} set status = 'done' where organization_id = '${ORG_A}' and request_id = 'semente-a-0001';`,
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erro).toContain("aios_campaign_requests_status_check");
  });

  it.each([
    ["response_summary acima de 20.000 caracteres", `response_summary = repeat('a', 20001)`, "response_summary_tamanho"],
    ["error_message acima de 2.000 caracteres", `error_message = repeat('a', 2001)`, "error_message_tamanho"],
    ["engine_job_id acima de 200 caracteres", `engine_job_id = repeat('a', 201)`, "engine_job_id_tamanho"],
    ["campaign_metadata que não é objeto", `campaign_metadata = '[1,2,3]'::jsonb`, "campaign_metadata_objeto"],
  ])("teto: %s é recusado", (_caso, atribuicao, constraint) => {
    const r = comoPapel(
      "service_role",
      null,
      `update ${T} set ${atribuicao} where organization_id = '${ORG_A}' and request_id = 'semente-a-0001';`,
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erro).toContain(constraint);
  });

  it("no limite do teto, a resposta entra", () => {
    const r = comoPapel(
      "service_role",
      null,
      `update ${T} set response_summary = repeat('a', 20000)
        where organization_id = '${ORG_A}' and request_id = 'semente-a-0001';
       update ${T} set response_summary = null
        where organization_id = '${ORG_A}' and request_id = 'semente-a-0001';`,
    );
    expect(r.ok, r.ok ? "" : r.erro).toBe(true);
  });
});

describe("aios_campaign_requests — request_id é único por organização", () => {
  it("o mesmo request_id de novo na mesma org bate em 23505", () => {
    const r = comoPapel(
      "service_role",
      null,
      `insert into ${T} (organization_id, user_id, request_id, prompt)
       values ('${ORG_A}', '${MANAGER_A}', 'semente-a-0001', 'de novo');`,
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erro).toContain("aios_campaign_requests_org_request_id_key");
  });

  it("o mesmo request_id em OUTRA org é outro pedido", () => {
    const r = comoPapel(
      "service_role",
      null,
      `insert into ${T} (organization_id, user_id, request_id, prompt)
       values ('${ORG_B}', '${MANAGER_B}', 'semente-a-0001', 'mesmo id, outra empresa');`,
    );
    expect(r.ok, r.ok ? "" : r.erro).toBe(true);
    // E continua invisível para a org A.
    expect(countAs(MANAGER_A, `select count(*) from ${T} where prompt = 'mesmo id, outra empresa';`)).toBe(0);
  });
});

describe("aios_campaign_requests — apagar", () => {
  it("o login de quem pediu não sai enquanto houver pedido dele", () => {
    let erro = "";
    try {
      sql(`delete from auth.users where id = '${MANAGER_DESCARTAVEL}';`);
    } catch (err) {
      erro = String((err as { stderr?: string }).stderr ?? err);
    }
    expect(erro).toContain("aios_campaign_requests_user_id_fkey");
    expect(valor(`select count(*) from ${T} where organization_id = '${ORG_DESCARTAVEL}';`)).toBe("1");
  });

  it("apagar a organização leva os pedidos — e aí o login sai", () => {
    sql(`delete from public.organizations where id = '${ORG_DESCARTAVEL}';`);
    expect(valor(`select count(*) from ${T} where organization_id = '${ORG_DESCARTAVEL}';`)).toBe("0");
    sql(`delete from auth.users where id = '${MANAGER_DESCARTAVEL}';`);
    expect(valor(`select count(*) from auth.users where id = '${MANAGER_DESCARTAVEL}';`)).toBe("0");
  });
});
