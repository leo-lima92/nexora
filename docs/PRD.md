# PRD — Nexora
**Versão:** 1.1
**Data:** 2026-03-30
**Status:** Draft
**Owner:** Product Team

---

## 1. Visão Geral

**Nexora** é um CRM Agêntico de próxima geração voltado para equipes de vendas B2B que buscam inteligência operacional, automação contextual e insights emocionais em tempo real. Diferente de CRMs tradicionais, o Nexora é orientado por agentes de IA que operam de forma autônoma e colaborativa para maximizar conversões, reduzir fricção no pipeline e personalizar cada interação com o cliente.

### Missão
> "Transformar cada interação de vendas em uma oportunidade inteligente — com precisão cirúrgica e empatia artificial."

### Público-alvo
- Equipes de vendas B2B (5–500 seats)
- SDRs, Account Executives, Sales Managers
- Empresas em estágios de crescimento (Série A–C)

---

## 2. Problema

| Dor | Impacto |
|-----|---------|
| CRMs passivos exigem input manual constante | Perda de 30–40% do tempo produtivo em admin |
| Follow-ups genéricos e mal-temporizados | Taxa de resposta abaixo de 10% |
| Ausência de contexto emocional nas negociações | Deals perdidos por abordagem inadequada |
| Leads desperdiçados por falta de priorização | Pipeline poluído, forecast impreciso |
| Nenhum agente autônomo executa ações por conta própria | Ciclo de vendas longo e reativo |

---

## 3. Solução — Os 3 Pilares do Nexora

### 3.1 CRM Agêntico

O núcleo do Nexora é um sistema de agentes de IA que operam 24/7 sobre o pipeline de vendas.

**Funcionalidades:**
- **Agent Hub:** Painel central de agentes ativos, tarefas em execução e resultados
- **Pipeline Inteligente:** Kanban com movimentação automática de deals por gatilhos de IA
- **Auto-Enriquecimento:** Agentes buscam dados de contatos (LinkedIn, domínio, redes) sem intervenção manual
- **Resumo de Contexto:** Antes de qualquer reunião ou ligação, o agente gera um briefing completo do deal
- **Ações Autônomas:** Agentes executam follow-ups, agendam calls, criam tarefas e atualizam stages com aprovação configurável (full-auto ou human-in-the-loop)
- **Multi-canal:** Email, WhatsApp, LinkedIn outreach coordenados por agentes

**Agentes disponíveis:**
| Agente | Função |
|--------|--------|
| `Scout` | Prospecção e qualificação de leads |
| `Chaser` | Follow-up automático multi-canal |
| `Briefer` | Geração de briefings pré-reunião |
| `Closer` | Sugestões táticas para fechamento |
| `Analyst` | Análise de pipeline e forecast |

---

### 3.2 Módulo Sniper

O Módulo Sniper é o sistema de **priorização e targeting cirúrgico** do Nexora — identifica os leads com maior probabilidade de fechar e o momento exato de atacar.

**Funcionalidades:**
- **Sniper Score:** Score proprietário (0–100) que combina fit de ICP, engajamento, sinais de compra e timing
- **Trigger Engine:** Motor de detecção de eventos de compra (job change, funding, product launch, tech stack change)
- **Hit List:** Lista diária gerada por IA com os top 10 contatos para trabalhar — ordenados por Sniper Score
- **Timing Intelligence:** Predição do melhor horário/dia para contato por perfil de contato
- **Signal Feed:** Feed de sinais em tempo real (visita ao site, abertura de email, clique em link, mudança de cargo)
- **ICP Builder:** Ferramenta visual para definir e refinar o Ideal Customer Profile com feedback de IA
- **Competitive Intel:** Agente monitora menções a concorrentes nos deals ativos

**Fluxo Sniper:**
```
Signal detectado → Trigger Engine → Sniper Score atualizado → Hit List → Ação sugerida → Execução (auto ou manual)
```

---

### 3.3 IA Sentimental

A **IA Sentimental** é a camada de inteligência emocional do Nexora — analisa o estado emocional e a receptividade do prospect em tempo real para guiar a abordagem correta.

**Funcionalidades:**
- **Sentiment Analysis em tempo real:** Análise de emails, mensagens e transcrições de calls
- **Emotion Map:** Mapa visual do histórico emocional do prospect ao longo do deal
- **Tone Advisor:** Sugere o tom ideal para a próxima mensagem (assertivo, empático, informativo, urgente)
- **Red Flag Detector:** Identifica sinais de esfriamento, objeções ocultas e risco de churn antes do fechamento
- **Persona Insight:** Perfil psicológico do comprador (DISC, motivadores, estilo de decisão)
- **Call Intelligence:** Transcrição + análise de sentimento de calls com highlights automáticos
- **Win/Loss Sentiment Report:** Análise comparativa de deals ganhos e perdidos por padrão emocional

**Estados emocionais mapeados:**
- `enthusiastic` — Alta receptividade, momento ideal para avançar
- `curious` — Interesse presente, nutrir com conteúdo e prova social
- `hesitant` — Objeção iminente, acionar Tone Advisor
- `cold` — Risco de perda, reengajamento necessário
- `resistant` — Objeção ativa, acionar Closer agent
- `ready` — Sinal de compra, acionar fechamento imediato

---

## 3.4 Módulo de Extração

O **Módulo de Extração** é o braço de prospecção ativa do Nexora — coleta leads diretamente de fontes públicas e semipúblicas antes que o prospect entre no radar da concorrência.

### Fontes de Extração

| Fonte | Actor / Ferramenta | Dados extraídos |
|-------|-------------------|----------------|
| **Google Maps** | `apify/google-maps-scraper` | Empresa, telefone, endereço, categoria, avaliações, site, horários |
| **Instagram** | `apify/instagram-scraper` | Perfil, bio, contatos, hashtags, seguidores, engajamento |
| **LinkedIn** | `apify/linkedin-profile-scraper` + `phantombuster/linkedin-search-export` | Nome, cargo, empresa, URL de perfil, email (quando público), conexões em comum, histórico de emprego, skills |
| **CNAEs públicos** | Script próprio (Receita Federal API) | CNPJ, razão social, CNAE, porte, endereço, situação cadastral |

### Estratégia LinkedIn (não-negociável para B2B)

SDRs B2B operam primariamente no LinkedIn. O Módulo de Extração trata LinkedIn como **canal de primeira classe**, com duas ferramentas complementares:

| Ferramenta | Uso | Limitação |
|-----------|-----|-----------|
| **Apify `linkedin-profile-scraper`** | Scraping de perfis públicos em escala | Requer LinkedIn session cookie |
| **PhantomBuster `LinkedIn Search Export`** | Exportação de buscas com filtros avançados (cargo, empresa, localização, conexões) | Limite de quota por conta |

**Dados capturados por contato:**
- Nome completo, cargo, empresa atual, URL do perfil
- Headline e summary do perfil
- Skills declaradas
- Grau de conexão (1º, 2º, 3º) com o rep
- Email (quando disponível no perfil público)
- Histórico de empregos recentes (detecção de job change)

**LinkedIn Message Intelligence:**
- Threads de mensagens LinkedIn sincronizadas via Apify/PhantomBuster
- Análise de sentimento de cada mensagem inbound
- Tone Advisor integrado ao composer de InMail/DM
- Signal detectado quando prospect responde → Sniper Score sobe automaticamente

### Fluxo de Extração

```
ICP Builder → Definir filtros (cargo, empresa, cidade, CNAE, hashtag, conexões)
    → Escolher fonte: Google Maps | Instagram | LinkedIn | CNAEs
    → Apify Actor / PhantomBuster executa
    → Resultados parseados e deduplicados (por CNPJ, domínio, LinkedIn URL)
    → Companies + Contacts criados com source=apify_* | phantombuster_linkedin
    → Sniper Score inicial calculado
    → Leads entram no Signal Feed
    → Agente Scout prioriza e envia para Hit List
```

### Funcionalidades

- **Extraction Hub:** Painel de runs com status, progresso e resultados
- **Deduplicação inteligente:** Cruza CNPJ, domínio e telefone para evitar duplicatas
- **Enriquecimento cascata:** Após extração do Google Maps, busca Instagram e CNAE automaticamente
- **Filtros por CNAE:** Seleciona segmentos específicos da base pública da Receita Federal
- **Rate limiting:** Respeita limites do Apify para não estourar quota
- **Agendamento:** Extrações recorrentes configuráveis (semanal, mensal)

### Requisitos técnicos

- Integração via Apify API (Actor calls assíncronos com polling)
- Tabela `extraction_runs` para auditoria de cada run
- Tabela `cnae_codes` com base completa da classificação brasileira
- Campos `source`, `apify_run_id`, `cnae_code`, `cnpj` em `companies` e `contacts`
- Edge Function `enrichment-worker` orquestra o pipeline de extração

---

## 3.5 Posicionamento & Kill Shot

> **"Nexora: O CRM que caça leads enquanto o HubSpot apenas os guarda."**

### Por que esse posicionamento funciona no B2B

O comprador B2B SMB sente exatamente essa dor: tem um CRM cheio de dados estáticos, mas a equipe ainda prospecta manualmente no Google. O kill shot nomeia o inimigo (HubSpot/Salesforce = passivos) e posiciona Nexora como **ativo e autônomo** — um time de vendas que trabalha 24/7.

### Messaging por persona

| Persona | Mensagem |
|---------|---------|
| **VP de Vendas** | "Aumente 30% a produtividade do seu time de SDRs no primeiro mês — sem contratar mais headcount." |
| **SDR** | "Pare de perder tempo no Google. A Hit List do Nexora te diz exatamente quem ligar hoje e por quê." |
| **CEO/Founder** | "Seu CRM atual guarda contatos. O Nexora gera receita." |

### Diferenciais vs. concorrência

| Critério | Nexora | HubSpot | Salesforce |
|----------|--------|---------|------------|
| Prospecção ativa (Apify) | ✅ Nativo | ❌ | ❌ |
| Sniper Score em tempo real | ✅ | ❌ | ❌ Partial |
| IA Sentimental | ✅ | ❌ | ❌ |
| Agentes autônomos | ✅ | ❌ | ❌ Einstein limitado |
| Extração por CNAE | ✅ | ❌ | ❌ |
| Curva de adoção | < 24h | 2–6 semanas | 3–6 meses |
| Preço (entrada) | $29/seat | $45/seat | $75/seat |

---

## 3.6 ROI Projetado

### Premissas (time de 5 SDRs)

| Métrica | Antes do Nexora | Com Nexora (Mês 1) | Variação |
|---------|----------------|---------------------|---------|
| Tempo em admin/prospecção manual | 40% do dia | 25% do dia | -37% |
| Contatos prospectados/dia/SDR | 30 | 50 | +67% |
| Taxa de resposta | 8% | 12% | +50% |
| Deals gerados/mês | 15 | 22 | +47% |
| **Produtividade geral de SDRs** | baseline | **+30%** | **+30%** |

### Como o Nexora entrega os 30%

1. **Hit List diária (-15min/dia/rep):** Elimina a decisão de "por quem começo" — SDR começa o dia com lista pronta e ação sugerida
2. **Extração Apify (+20 novos leads/dia):** Prospectando Google Maps e Instagram enquanto o rep dorme
3. **Tone Advisor (-20% emails reescritos):** Primeira versão do email já no tom certo — menos revisões, mais envios
4. **Sniper Score (-35% deals frios no pipeline):** SDR foca nos leads quentes, não distribui energia igualmente

### ROI financeiro estimado (5 SDRs, plano Growth $79/seat)

```
Custo Nexora:    5 × $79 = $395/mês
Ganho estimado:  +7 deals/mês × ticket médio $500 = $3.500 MRR adicional
ROI Mês 1:       $3.500 / $395 = 8.9x
Payback:         < 4 dias
```

> *Projeções conservadoras baseadas em benchmarks de mercado (Gartner Sales Technology, 2024). Resultados individuais variam conforme ICP, mercado e execução.*

---

## 4. Requisitos Funcionais

### FR-001 — Autenticação e Multi-tenant
- Login com email/senha e OAuth (Google, Microsoft)
- Multi-tenant com isolamento completo por organização
- Roles: Admin, Manager, Rep, Viewer

### FR-002 — Pipeline Management
- Stages customizáveis por pipeline
- Múltiplos pipelines por organização
- Probabilidade de fechamento por stage
- Rotting deals (alertas por inatividade)

### FR-003 — Contact & Company Management
- Contatos enriquecidos automaticamente
- Histórico completo de interações
- Relacionamento contato ↔ empresa ↔ deal
- Tags e segmentação avançada

### FR-004 — Agent Hub
- Configuração de agentes por organização
- Aprovação de ações (full-auto / human-in-the-loop)
- Log de todas as ações executadas por agentes
- Pause/resume por agente

### FR-005 — Módulo Sniper
- Sniper Score calculado e atualizado em tempo real
- Hit List gerada diariamente por usuário
- Signal Feed com filtros por tipo de sinal
- ICP Builder com sugestões de IA

### FR-006 — IA Sentimental
- Análise de sentimento em emails e mensagens
- Transcrição automática de calls (integração nativa)
- Emotion Map por deal
- Tone Advisor integrado ao composer de emails

### FR-007 — Integrações
- Email: Gmail, Outlook
- Calendar: Google Calendar, Outlook Calendar
- Communication: WhatsApp Business API, LinkedIn
- Telephony: Twilio (calls + transcrição)
- Enrichment: Apollo, Hunter.io, Clearbit
- Webhooks outbound configuráveis

### FR-008 — Analytics & Reporting
- Dashboard de pipeline em tempo real
- Win/Loss analysis com IA
- Forecast com ML
- Activity reports por rep
- Sentiment reports por deal e por rep

---

## 5. Requisitos Não-Funcionais

| NFR | Requisito |
|-----|-----------|
| NFR-001 Desempenho | P95 < 300ms para queries de pipeline |
| NFR-002 Disponibilidade | 99.9% uptime (SLA) |
| NFR-003 Escalabilidade | Suportar 10k organizations, 100k usuários |
| NFR-004 Segurança | SOC2-ready, LGPD/GDPR compliant |
| NFR-005 IA Latência | Sentiment analysis < 2s, Sniper Score update < 5s |
| NFR-006 Multi-tenant | Isolamento completo de dados por org (RLS Supabase) |
| NFR-007 Observabilidade | Logs estruturados, traces distribuídos, alertas |

---

## 6. Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes + Supabase Edge Functions |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (JWT + OAuth) |
| IA/LLM | Claude claude-sonnet-4-6 (análise, agentes, sentiment) |
| Agentes | Anthropic Agent SDK |
| Realtime | Supabase Realtime (websockets) |
| Queue | Supabase + pg_cron para jobs agendados |
| Storage | Supabase Storage (transcrições, attachments) |
| Email | Resend |
| Pagamentos | Stripe |
| Deploy | Vercel (frontend) + Supabase Cloud |
| Monitoramento | Sentry + Vercel Analytics |

---

## 7. Épicos de Desenvolvimento

| Epic | Título | Prioridade |
|------|--------|------------|
| E-01 | Foundation: Auth, Multi-tenant, DB Schema | P0 |
| E-02 | Pipeline Core: Deals, Contacts, Companies | P0 |
| E-03 | Agent Hub: Infraestrutura de Agentes IA | P1 |
| E-04 | Módulo Sniper: Score Engine + Hit List | P1 |
| E-05 | IA Sentimental: Análise + Emotion Map | P1 |
| E-06 | Integrações: Email, Calendar, WhatsApp | P2 |
| E-07 | Analytics: Dashboard + Reports + Forecast | P2 |
| E-08 | Billing: Stripe + Planos | P2 |
| E-09 | Mobile: PWA / App nativo | P3 |

---

## 8. Modelo de Negócio

### Planos

| Plano | Preço/seat/mês | Limites |
|-------|---------------|---------|
| **Starter** | $29 | 2 pipelines, 1.000 contacts, agentes básicos |
| **Growth** | $79 | Pipelines ilimitados, 10k contacts, todos agentes |
| **Pro** | $149 | Ilimitado, Módulo Sniper completo, IA Sentimental |
| **Enterprise** | Custom | SLA, SSO, dedicated support, custom agents |

### Métricas de Sucesso (Ano 1)
- MRR: $500k
- Clientes ativos: 200 organizations
- NPS: > 50
- Churn mensal: < 2%
- Tempo médio de ativação: < 24h

---

## 9. Fora de Escopo (v1.0)

- App mobile nativo (iOS/Android) — pós v1.0
- Marketplaces de agentes third-party
- Construtor de workflows no-code visual
- Suporte a idiomas além de PT-BR e EN-US

---

## 10. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|-------|-------------|---------|-----------|
| Latência de IA em tempo real | Alta | Alto | Cache agressivo, processamento assíncrono |
| Custo de LLM escalável | Média | Alto | Roteamento inteligente de modelos, caching |
| Compliance LGPD/GDPR | Média | Alto | RLS, anonimização, audit logs desde o início |
| Adoção lenta de agentes autônomos | Média | Médio | Modo human-in-the-loop como padrão |
| Competição (Salesforce, HubSpot) | Alta | Médio | Foco em nicho B2B SMB + diferencial IA agêntica |
