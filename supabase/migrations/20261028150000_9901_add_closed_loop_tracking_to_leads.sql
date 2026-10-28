-- manifest: **Closed Loop CAPI no card: `crm_leads` ganha `utm_source`, `utm_medium`, `utm_campaign`, `meta_campaign_id`, `meta_adset_id` e `meta_ad_id` como colunas GERADAS a partir de `source_metadata`, não escritas por ninguém.** O webhook de entrada (`/api/v1/webhooks/in/<token>`) já reserva `utm_*` e `campaign_id`/`adset_id`/`ad_id` (issue #2317 do upstream) e os grava em `source_metadata`; as colunas só tornam esse dado consultável e indexável para o AIOS Python ler o fechamento por campanha. Gerada, e não escrita, pelo mesmo motivo de `contacts.wa_identity`: derivado que alguém precisa lembrar de atualizar é derivado que diverge, e o lead que já existe ganha o valor na hora, sem backfill. Primeira migration da faixa 99xx do fork Nexora — o upstream passou a numerar em 9016+ e a 9006 em diante deixou de ser território livre.

-- 9901 — rastreio de ciclo fechado (Closed Loop CAPI) no card
--
-- ─── Por que `crm_leads`, e não `contacts` nem `companies` ──────────────────
-- A conversão que volta para a Meta é a VENDA, e a venda é o card: uma mesma
-- pessoa pode ter um negócio que veio da campanha A e outro, meses depois, da
-- campanha B. `contacts` guarda a atribuição de primeiro toque da PESSOA
-- (`estamparAtribuicaoDoContato`); `companies` já tem `meta_*_id` desde a 9001,
-- mas é a conta B2B da prospecção do AIOS, não o negócio. O card é o único
-- lugar onde "este negócio veio desta campanha" tem um dono só.
--
-- ─── Por que GERADA ─────────────────────────────────────────────────────────
-- A fonte da verdade é `crm_leads.source_metadata`, que o webhook de entrada já
-- preenche: `lib/webhooks/inbound.ts` manda toda chave `utm_*` e as chaves de
-- anúncio reservadas (`CHAVES_DE_ANUNCIO`: `fbclid`, `fbc`, `fbp`, `gclid`,
-- `ad_id`, `adset_id`, `campaign_id`) para `source_metadata`, e nunca para
-- `custom_fields`. Uma coluna comum ao lado seria a segunda cópia do mesmo dado
-- (anti-pattern 2 do CLAUDE.md) e pediria um escritor que lembrasse dela. Como
-- coluna GERADA:
--   · ninguém escreve nela — o Postgres recusa (428C9), e o gate
--     `tests/invariants/colunas-geradas-nao-sao-escritas.test.ts` varre o
--     código de produção à procura de quem tente;
--   · o card que já existe ganha o valor no `alter table`, sem backfill;
--   · a anonimização LGPD que limpa `source_metadata` limpa as colunas junto.
--
-- ─── O CONTRATO DE ENTRADA para o AIOS Python ──────────────────────────────
-- O AIOS manda os dados de rastreio como CHAVES DE TOPO do corpo do POST em
-- `/api/v1/webhooks/in/<token>`, com estes nomes exatos:
--
--     utm_source, utm_medium, utm_campaign          → as três colunas utm_*
--     campaign_id, adset_id, ad_id                  → meta_campaign_id,
--                                                      meta_adset_id, meta_ad_id
--     fbclid (ou fbc) e fbp, quando houver          → identidade do clique
--
-- NUNCA no campo `stage`. Desde a v1.94.0 (#2316 do upstream) `stage` é campo
-- RESERVADO: é o pedido de mover de etapa o card que o `external_id` aponta, sai
-- do corpo antes do mapeamento e não chega a `source_metadata` nem a
-- `custom_fields`. Um `stage` com a campanha dentro seria lido como nome de
-- etapa e o dado de rastreio se perderia. Também não use `meta_campaign_id`
-- como nome de chave no corpo: ela não é reservada, então cairia em
-- `custom_fields` (apareceria no card como campo preenchido) e a coluna
-- ficaria vazia.
--
-- ─── `meta_*`: o id é da Meta só quando o clique não é do Google ────────────
-- `campaign_id`/`adset_id`/`ad_id` são chaves sem dono: uma landing page que
-- recebe as duas redes manda `campaign_id` do Google junto com o `gclid`. A
-- regra é a mesma precedência de `extrairAtribuicaoDoInbound` (Meta antes de
-- Google): o id NÃO vira `meta_*` quando o envio traz `gclid` e nenhum clique
-- da Meta (`fbclid`/`fbc`). Sem clique nenhum — o caso do AIOS, que conhece a
-- campanha do lado do servidor —, o id é tratado como da Meta.
--
-- O clique-pro-WhatsApp (CTWA) não passa por aqui: a atribuição dele mora no
-- contato e na prova `meta_capi_lead_birth_v1`, escrita só pela RPC de
-- nascimento do lead. Estas colunas descrevem o card que veio pelo webhook.
--
-- ─── Custo ─────────────────────────────────────────────────────────────────
-- Coluna gerada STORED reescreve a tabela. As seis vão num `alter table` só,
-- então a reescrita é uma, e só na primeira aplicação: na reaplicação do
-- `update.sh` o `if not exists` torna o comando um no-op.
--
-- O índice cobre o único caminho de leitura descrito: o AIOS pergunta "os cards
-- desta organização que vieram desta campanha" para devolver o fechamento à
-- Conversions API. Parcial, porque a maioria dos cards não tem campanha.
--
-- Sem RLS nova: as colunas herdam as policies de `crm_leads`, e o `GRANT ALL ON
-- TABLE` do dump é por tabela, não por coluna.
--
-- Idempotente: `add column if not exists`, `create index if not exists`, e
-- `comment on` reescreve o mesmo texto.

alter table public.crm_leads
  add column if not exists utm_source text
    generated always as (nullif(btrim(source_metadata->>'utm_source'), '')) stored,
  add column if not exists utm_medium text
    generated always as (nullif(btrim(source_metadata->>'utm_medium'), '')) stored,
  add column if not exists utm_campaign text
    generated always as (nullif(btrim(source_metadata->>'utm_campaign'), '')) stored,
  add column if not exists meta_campaign_id text
    generated always as (
      case
        when source_metadata ? 'gclid' and not (source_metadata ?| array['fbclid', 'fbc']) then null
        else nullif(btrim(source_metadata->>'campaign_id'), '')
      end
    ) stored,
  add column if not exists meta_adset_id text
    generated always as (
      case
        when source_metadata ? 'gclid' and not (source_metadata ?| array['fbclid', 'fbc']) then null
        else nullif(btrim(source_metadata->>'adset_id'), '')
      end
    ) stored,
  add column if not exists meta_ad_id text
    generated always as (
      case
        when source_metadata ? 'gclid' and not (source_metadata ?| array['fbclid', 'fbc']) then null
        else nullif(btrim(source_metadata->>'ad_id'), '')
      end
    ) stored;

create index if not exists crm_leads_org_meta_campaign_idx
  on public.crm_leads (organization_id, meta_campaign_id)
  where meta_campaign_id is not null;

comment on column public.crm_leads.utm_source is
  'GERADA de source_metadata.utm_source (migration 9901). Não escreva: mande utm_source como chave de topo no webhook de entrada.';
comment on column public.crm_leads.utm_medium is
  'GERADA de source_metadata.utm_medium (migration 9901). Não escreva: mande utm_medium como chave de topo no webhook de entrada.';
comment on column public.crm_leads.utm_campaign is
  'GERADA de source_metadata.utm_campaign (migration 9901). Não escreva: mande utm_campaign como chave de topo no webhook de entrada.';
comment on column public.crm_leads.meta_campaign_id is
  'GERADA de source_metadata.campaign_id (migration 9901), nula quando o clique é do Google (gclid sem fbclid/fbc). Entrada: campaign_id no corpo, nunca em stage.';
comment on column public.crm_leads.meta_adset_id is
  'GERADA de source_metadata.adset_id (migration 9901), nula quando o clique é do Google (gclid sem fbclid/fbc). Entrada: adset_id no corpo, nunca em stage.';
comment on column public.crm_leads.meta_ad_id is
  'GERADA de source_metadata.ad_id (migration 9901), nula quando o clique é do Google (gclid sem fbclid/fbc). Entrada: ad_id no corpo, nunca em stage.';
