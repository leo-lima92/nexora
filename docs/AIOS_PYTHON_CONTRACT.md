# Contrato CRM ↔ motor AIOS (Python) — pedidos de campanha

> **Para quem é:** quem mantém o backend FastAPI do motor de tráfego (AIOS).
> **O que cobre:** o que o CRM manda ao motor, a tabela `public.aios_campaign_requests`
> e exatamente o que o motor precisa escrever nela, com a service key, para a resposta
> aparecer na tela **Tráfego Agêntico** (`/app/aios`).
>
> Fonte da verdade do schema: `supabase/migrations/20261111120000_9902_aios_campaign_requests.sql`
> (e o apêndice de mesmo nome no `supabase/baseline.sql`). Se este documento e a migration
> discordarem, vale a migration — e o documento está errado.

---

## 1. O fluxo, em uma página

```
 pessoa (manager+)            CRM (Next.js)                      Supabase                      motor AIOS (FastAPI)
 ─────────────────            ─────────────                      ────────                      ────────────────────
 escreve o pedido  ──POST──▶  /api/v1/aios-dispatch
                              1. INSERT (status = queued) ─────▶ aios_campaign_requests
                              2. POST {org_id, user_id, ─────────────────────────────────────▶ POST /api/campaign
                                       request_id, prompt,                                     responde 2xx em ≤ 30 s
                                       action}                                                 (só o ACEITE, não a campanha)
                              3. acerta o desfecho do ─────────▶ engine_job_id | unconfirmed | failed
                                 despacho
                                                                                               monta a campanha…
                                                                 aios_campaign_requests ◀───── UPDATE status = processing
                                                                                        ◀───── UPDATE status = completed,
                                                                                                      response_summary, …
 vê a resposta     ◀──GET───  /api/v1/aios-dispatch  ◀─────────  (a tela consulta de 5 s a 60 s enquanto há pedido em aberto)
```

Três consequências que o lado Python precisa ter em mente:

1. **A linha sempre existe antes de o motor ser chamado.** O CRM insere e só depois
   despacha. O motor **nunca insere** nesta tabela — só atualiza. Um `UPDATE` que não
   alcança linha nenhuma significa `org_id`/`request_id` errado, não "falta criar".
2. **A resposta do HTTP é só o aceite.** A campanha não precisa (nem deve) ficar pronta
   dentro dos 30 s. Responda 2xx assim que o pedido estiver enfileirado do seu lado.
3. **O resultado volta pelo banco**, na mesma linha, achada por
   `(organization_id, request_id)`.

---

## 2. O despacho: o que o CRM manda

Implementação: `lib/aios/despacho.ts`. Endereço: variável `AIOS_PYTHON_URL` do CRM
(vazia = `http://localhost:8000/api/campaign`).

### Requisição

```http
POST /api/campaign
Content-Type: application/json
Accept: application/json
X-Request-Id: 0b6f0c5e-8a55-4c1e-9d0f-6c2b1f3f7a10
Authorization: Bearer <AIOS_PYTHON_TOKEN>        ← só quando a variável está preenchida no CRM
```

```json
{
  "org_id": "22222222-2222-4222-8222-222222222222",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "request_id": "5f0c1a7e-0d5b-4c58-9a51-0c6a3c2f9d10",
  "prompt": "Campanha de leads para clínica, R$ 50 por dia, por 15 dias",
  "action": "generate_campaign"
}
```

| Campo        | Tipo   | O que é                                                                                                   |
|--------------|--------|-----------------------------------------------------------------------------------------------------------|
| `org_id`     | uuid   | A organização. **É o valor de `aios_campaign_requests.organization_id`.** Vem da sessão, nunca do navegador. |
| `user_id`    | uuid   | Quem pediu (`auth.users.id`). Vem da sessão.                                                              |
| `request_id` | texto  | **A chave do pedido.** `[A-Za-z0-9_-]`, 8 a 100 caracteres (hoje a tela gera um UUID). Único por organização. |
| `prompt`     | texto  | O que a pessoa escreveu, já aparado. 1 a 4000 caracteres.                                                 |
| `action`     | texto  | Sempre `"generate_campaign"` nesta fase.                                                                  |

São exatamente esses cinco campos. O corpo não traz mais nada.

**Dois ids, duas coisas diferentes — não troque um pelo outro:**

- `request_id` (corpo) é o id do **pedido**: identifica a linha no banco. É com ele que o
  motor grava a resposta.
- `X-Request-Id` (cabeçalho) é o id da **chamada HTTP**: o mesmo que o CRM grava em
  `api_audit_log.request_id`. Serve para casar o log do motor com o do CRM numa
  investigação. Não existe em `aios_campaign_requests`.

### Resposta esperada do motor

| O motor responde            | O CRM entende                                   | A linha fica                                  |
|-----------------------------|-------------------------------------------------|-----------------------------------------------|
| qualquer **2xx**            | aceito                                          | `queued` (+ `engine_job_id`, se vier `job_id`) |
| fora de 2xx                 | recusado                                        | `failed` + `error_message` (frase do CRM)     |
| conexão recusada / DNS      | motor fora do ar                                | `failed` + `error_message` (frase do CRM)     |
| nada em **30 s**            | sem confirmação — **o pedido pode ter chegado** | `unconfirmed`                                 |
| redirecionamento (3xx)      | tratado como falha de conexão (não é seguido)   | `failed`                                      |

O corpo do 2xx é opcional. Se for JSON, o CRM lê só dois campos, ambos opcionais:

```json
{ "job_id": "job-7", "message": "Recebido. Vou montar a campanha." }
```

- `job_id` (texto, até 200 caracteres) → gravado em `engine_job_id` e mostrado como protocolo.
- `message` (texto, até 4000 caracteres) → mostrado na conversa na hora do aceite. **Não é
  gravado.** A resposta da campanha vai em `response_summary`, pelo banco.

O corpo de uma recusa (4xx/5xx) **não** é mostrado à pessoa nem gravado.

### Idempotência — leia antes de implementar a fila

- O CRM **não reenvia** um pedido sozinho. Cada `request_id` é despachado uma vez.
- No caso `unconfirmed` (o CRM desistiu de esperar aos 30 s) **o motor pode ter recebido o
  pedido**. Se recebeu, siga normalmente: processe e grave a resposta na linha — a tela
  mostra. `unconfirmed` é um estado de onde o motor pode sair (ver §4).
- Trate `(org_id, request_id)` como chave idempotente do seu lado: se o mesmo par chegar
  duas vezes (retry de proxy, por exemplo), não monte duas campanhas.

---

## 3. A tabela `public.aios_campaign_requests`

| Coluna              | Tipo          | Nulo | Padrão               | Quem escreve                         | Observação |
|---------------------|---------------|------|----------------------|--------------------------------------|------------|
| `id`                | `uuid`        | não  | `uuid_generate_v4()` | banco                                | PK. O motor não precisa dela. |
| `organization_id`   | `uuid`        | não  | —                    | CRM (INSERT)                         | FK `organizations(id)`, `ON DELETE CASCADE`. É o `org_id` do despacho. |
| `user_id`           | `uuid`        | não  | —                    | CRM (INSERT)                         | FK `auth.users(id)`, `ON DELETE RESTRICT`. |
| `request_id`        | `text`        | não  | —                    | CRM (INSERT)                         | 8–100 caracteres. `UNIQUE (organization_id, request_id)`. |
| `prompt`            | `text`        | não  | —                    | CRM (INSERT)                         | O texto do pedido. |
| `status`            | `text`        | não  | `'queued'`           | CRM (despacho) e **motor**           | `CHECK`: `queued`, `processing`, `completed`, `failed`, `unconfirmed`. |
| `engine_job_id`     | `text`        | sim  | —                    | CRM (do aceite) e **motor**          | Até 200 caracteres. |
| `response_summary`  | `text`        | sim  | —                    | **motor**                            | Até 20.000 caracteres. Texto puro. |
| `campaign_metadata` | `jsonb`       | não  | `'{}'`               | **motor**                            | Tem de ser **objeto** JSON; até 64 KB serializado. |
| `error_message`     | `text`        | sim  | —                    | CRM (despacho recusado) e **motor**  | Até 2.000 caracteres. |
| `created_at`        | `timestamptz` | não  | `now()`              | banco                                | |
| `updated_at`        | `timestamptz` | não  | `now()`              | banco (trigger em todo `UPDATE`)     | **Não envie.** O que for enviado é sobrescrito. |

**O motor escreve só em:** `status`, `engine_job_id`, `response_summary`,
`campaign_metadata`, `error_message`.

**O motor nunca altera:** `id`, `organization_id`, `user_id`, `request_id`, `prompt`,
`created_at`. O banco não impede a service key de fazê-lo — a disciplina é do contrato.

### Acesso

- **Service key** (`service_role`): `SELECT`, `INSERT`, `UPDATE`, `DELETE`. Ignora RLS — por
  isso **todo** comando do motor leva `organization_id` no filtro (§6).
- Usuário logado (`authenticated`), pela RLS: `manager` ou acima lê e insere os pedidos da
  própria organização; o INSERT só aceita a linha `queued` e vazia. Não há `UPDATE` nem
  `DELETE` para usuário logado: resposta de campanha só entra pela service key.
- `anon`: nenhum privilégio.

---

## 4. Os estados

```
            (CRM insere)
                 │
                 ▼
             ┌────────┐   CRM: o motor não confirmou em 30 s   ┌─────────────┐
             │ queued │ ─────────────────────────────────────▶ │ unconfirmed │
             └────────┘                                        └─────────────┘
               │    │ CRM: o motor recusou / fora do ar              │
               │    └──────────────────────────┐                     │
               │ motor                         ▼                     │ motor
               ▼                           ┌────────┐                │
          ┌────────────┐      motor        │ failed │ ◀──────────────┤
          │ processing │ ────────────────▶ └────────┘                │
          └────────────┘                                             │
               │ motor                                               │
               ▼                                                     ▼
          ┌───────────┐                                         (processing → …)
          │ completed │
          └───────────┘
```

| `status`      | Quem põe | Significa                                                        | A tela mostra            |
|---------------|----------|------------------------------------------------------------------|--------------------------|
| `queued`      | CRM      | Registrado; o motor aceitou (ou está para aceitar).              | "Na fila do motor"       |
| `unconfirmed` | CRM      | O motor não confirmou em 30 s. Pode ter recebido.                | "Sem confirmação"        |
| `processing`  | motor    | O motor está montando a campanha.                                | "Em andamento"           |
| `completed`   | motor    | Terminou. A resposta está em `response_summary`.                 | "Concluído" + a resposta |
| `failed`      | CRM ou motor | Não deu. O porquê está em `error_message`.                   | "Falhou" + o erro        |

Regras para o motor:

- **Transições do motor:** `queued` ou `unconfirmed` → `processing` → `completed` ou
  `failed`. Também vale ir direto de `queued`/`unconfirmed` para `completed`/`failed`.
- **Não volte** uma linha para `queued` nem para `unconfirmed`: esses dois são do CRM.
- **Não reabra** `completed` nem `failed`. Um pedido novo é uma linha nova.
- `processing` é opcional, mas recomendado: é o que diz à pessoa que alguém pegou o pedido.
- **Todo pedido aceito precisa terminar em `completed` ou `failed`.** O CRM não tem cron
  que vença pedido parado: uma linha que o motor abandona em `queued`/`processing` fica
  assim para sempre na tela, e a tela continua consultando por ela (uma vez por minuto,
  com a aba aberta). Se o motor cair no meio, ao voltar ele precisa marcar `failed` o que
  não vai concluir.

O CRM, depois do despacho, só toca a linha **enquanto ela está `queued`**. Se o motor já
tiver andado para `processing` antes de o CRM voltar da chamada HTTP, o CRM não passa por
cima.

---

## 5. O que o motor grava — os payloads exatos

O filtro é sempre o mesmo par: `organization_id = <org_id do despacho>` **e**
`request_id = <request_id do despacho>`.

### 5.1 Pegou o pedido

```json
{ "status": "processing", "engine_job_id": "job-7" }
```

`engine_job_id` é opcional. Recomenda-se condicionar a `status in (queued, unconfirmed)`:
zero linhas de volta = outro worker já pegou (ou o pedido não é seu).

### 5.2 Concluiu

```json
{
  "status": "completed",
  "response_summary": "Campanha criada na conta 1234: 1 campanha de leads, 3 conjuntos de anúncios, R$ 50,00 por dia, de 12/11 a 26/11. Aguardando a revisão da Meta.",
  "campaign_metadata": {
    "meta_campaign_id": "120210000000000",
    "daily_budget_cents": 5000,
    "currency": "BRL"
  },
  "engine_job_id": "job-7"
}
```

- `response_summary` — **é o que a pessoa lê.** Texto puro, em português (ou no idioma em
  que o motor responder), com quebras de linha (`\n`) à vontade. A tela **não** interpreta
  Markdown nem HTML: `**negrito**` aparece com os asteriscos. Até 20.000 caracteres; acima
  de ~320 caracteres ou 6 linhas ela entra recolhida, com "Ver resposta completa".
- `campaign_metadata` — objeto livre do motor. **A tela não lê nenhum caminho daqui** (as
  chaves do exemplo são ilustrativas, não um schema). Quando o CRM precisar de um campo
  estruturado, ele vira coluna ou schema versionado, combinado antes. Dinheiro, por
  convenção do CRM: inteiro em centavos (`_cents`) + `currency` ISO-4217.
- Um `completed` sem `response_summary` aparece como "O motor de tráfego concluiu o
  pedido, sem enviar um resumo." — funciona, mas não diz nada. Mande o resumo.

### 5.3 Falhou

```json
{
  "status": "failed",
  "error_message": "A conta de anúncios está sem forma de pagamento. Cadastre um cartão na Meta e peça de novo."
}
```

`error_message` é mostrado **como está**, para o gestor: escreva para quem lê (o que
houve e o que fazer), sem stack trace, sem token, sem dado interno. Até 2.000 caracteres.
Sem `error_message`, a tela diz "O motor de tráfego não conseguiu concluir este pedido."

### 5.4 Progresso parcial (opcional)

`response_summary` com conteúdo aparece na tela em qualquer estado. Dá para ir
informando durante o `processing`:

```json
{ "response_summary": "Público definido. Montando os anúncios…" }
```

O `completed` substitui o texto pelo resumo final.

---

## 6. Como gravar

### 6.1 `supabase-py`

```python
import os
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
TABELA = "aios_campaign_requests"


def pegar_pedido(org_id: str, request_id: str, job_id: str | None = None) -> bool:
    """queued/unconfirmed -> processing. False = ninguém para pegar (já pego, ou não existe)."""
    campos = {"status": "processing"}
    if job_id:
        campos["engine_job_id"] = job_id
    res = (
        supabase.table(TABELA)
        .update(campos)
        .eq("organization_id", org_id)      # SEMPRE: a service key ignora RLS
        .eq("request_id", request_id)
        .in_("status", ["queued", "unconfirmed"])
        .execute()
    )
    return len(res.data) == 1


def concluir_pedido(org_id: str, request_id: str, resumo: str, metadata: dict | None = None) -> bool:
    res = (
        supabase.table(TABELA)
        .update({
            "status": "completed",
            "response_summary": resumo[:20000],
            "campaign_metadata": metadata or {},
        })
        .eq("organization_id", org_id)
        .eq("request_id", request_id)
        .in_("status", ["queued", "unconfirmed", "processing"])
        .execute()
    )
    return len(res.data) == 1


def falhar_pedido(org_id: str, request_id: str, motivo: str) -> bool:
    res = (
        supabase.table(TABELA)
        .update({"status": "failed", "error_message": motivo[:2000]})
        .eq("organization_id", org_id)
        .eq("request_id", request_id)
        .in_("status", ["queued", "unconfirmed", "processing"])
        .execute()
    )
    return len(res.data) == 1
```

### 6.2 REST puro (PostgREST), para quem não usa o SDK

```http
PATCH {SUPABASE_URL}/rest/v1/aios_campaign_requests?organization_id=eq.{org_id}&request_id=eq.{request_id}&status=in.(queued,unconfirmed,processing)
apikey: {SUPABASE_SERVICE_ROLE_KEY}
Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}
Content-Type: application/json
Prefer: return=representation

{"status": "completed", "response_summary": "…", "campaign_metadata": {"meta_campaign_id": "…"}}
```

`Prefer: return=representation` devolve as linhas alteradas: lista vazia = nada foi
alcançado. Sem esse cabeçalho o PostgREST responde `204` com ou sem linha alterada, e o
motor não fica sabendo que errou o filtro.

### 6.3 Regras de segurança

1. **`organization_id` em todo filtro.** A service key ignora RLS: um `UPDATE` só por
   `request_id` pode alcançar o pedido de outra empresa (o `request_id` é único *por
   organização*, não globalmente). O `org_id` é o do despacho — nunca um valor vindo de
   outro lugar.
2. **A service key não sai do servidor do motor**: nem em log, nem em resposta HTTP, nem
   em `campaign_metadata`.
3. **`prompt` é texto de cliente** e pode conter dado pessoal. Não o copie para lugares
   de onde ele não sai (logs permanentes, por exemplo).
4. **Não insira nem apague linhas** desta tabela.

---

## 7. O que o banco recusa

| Tentativa                                                    | Erro                                                            |
|--------------------------------------------------------------|-----------------------------------------------------------------|
| `status` fora dos cinco valores                              | `23514` — `aios_campaign_requests_status_check`                 |
| `response_summary` com mais de 20.000 caracteres             | `23514` — `aios_campaign_requests_response_summary_tamanho`     |
| `error_message` com mais de 2.000 caracteres                 | `23514` — `aios_campaign_requests_error_message_tamanho`        |
| `engine_job_id` com mais de 200 caracteres                   | `23514` — `aios_campaign_requests_engine_job_id_tamanho`        |
| `campaign_metadata` que não é objeto (lista, texto, número) ou passa de 64 KB | `23514` — `aios_campaign_requests_campaign_metadata_objeto` |
| `campaign_metadata: null`                                    | `23502` — a coluna é `NOT NULL` (mande `{}`)                    |

Um `UPDATE` recusado não altera nada: a linha continua no estado anterior e a tela segue
mostrando "Em andamento". **Trate o erro** — corte o texto no teto e tente de novo, ou
marque `failed`.

---

## 8. O que a pessoa vê, e quando

- A tela lista os pedidos da organização (os 20 mais recentes, com "Ver pedidos mais
  antigos"), cada um com o selo do `status`, o texto do pedido, a resposta
  (`response_summary`), o erro (`error_message`) e o protocolo (`engine_job_id`).
- Enquanto houver pedido em `queued`, `processing` ou `unconfirmed`, a tela consulta de
  novo sozinha: começa em 5 s e espaça até 60 s quando nada muda. Com a aba em segundo
  plano ela espera; ao voltar, consulta na hora. Há também o botão **Atualizar**.
  Na prática: a resposta aparece em até ~1 minuto depois de gravada, sem ninguém clicar.
- A resposta do pedido feito na sessão aberta entra também na conversa, como mensagem do
  Estrategista de Tráfego.
- Não há Realtime nesta fase: a tela não é avisada do `UPDATE`, ela pergunta.

---

## 9. Como testar sem o CRM

Com o banco local do CRM de pé, um pedido pode ser simulado e respondido direto no SQL
(como `postgres`/service role):

```sql
-- o que o CRM faria
insert into public.aios_campaign_requests (organization_id, user_id, request_id, prompt)
values ('<org>', '<user>', 'teste-manual-0001', 'Campanha de leads para clínica');

-- o que o motor faz
update public.aios_campaign_requests
   set status = 'processing', engine_job_id = 'job-teste'
 where organization_id = '<org>' and request_id = 'teste-manual-0001';

update public.aios_campaign_requests
   set status = 'completed',
       response_summary = 'Campanha criada: 3 conjuntos de anúncios, R$ 50,00 por dia.',
       campaign_metadata = '{"meta_campaign_id": "120210000000000"}'::jsonb
 where organization_id = '<org>' and request_id = 'teste-manual-0001';
```

O caminho inteiro do motor (achar a linha, andar o status, gravar a resposta, o teto, o
vocabulário) é exercitado contra um Postgres real em
`tests/invariants/aios-campaign-requests-rls.test.ts`.

---

## 10. Checklist do lado Python

- [ ] `POST /api/campaign` aceita os cinco campos e responde 2xx em bem menos de 30 s,
      sem esperar a campanha ficar pronta.
- [ ] `(org_id, request_id)` é chave idempotente: o mesmo par duas vezes não monta duas campanhas.
- [ ] Todo `UPDATE` filtra `organization_id` **e** `request_id`.
- [ ] O motor confere quantas linhas alterou (zero = filtro errado ou pedido já tomado).
- [ ] Todo pedido aceito termina em `completed` (com `response_summary`) ou `failed`
      (com `error_message`) — inclusive quando o worker cai e volta.
- [ ] `response_summary` é texto puro, cortado em 20.000; `error_message`, em 2.000.
- [ ] `campaign_metadata` é sempre um objeto (`{}` quando não há nada).
- [ ] `updated_at`, `organization_id`, `user_id`, `request_id`, `prompt` e `created_at`
      nunca aparecem num `UPDATE` do motor.
- [ ] Se `AIOS_PYTHON_TOKEN` estiver configurado no CRM, o motor confere o `Bearer`.

---

## 11. Fora deste contrato (ainda)

- **Cancelar** um pedido em andamento.
- **Reenvio automático** pelo CRM e **vencimento** de pedido parado.
- **Realtime** (aviso do `UPDATE` em vez de consulta).
- **Schema de `campaign_metadata`** e qualquer leitura dele pela tela.
- **Retenção** dos pedidos (hoje eles saem só com a organização).
- Outras ações além de `generate_campaign`.
