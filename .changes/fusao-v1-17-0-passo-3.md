---
impacto: capacidade_nova
secao: alterado
titulo: Inbox, Kanban e Conexões no visual Orderful sobre a base v1.17.0, com a ponte de dados AIOS
---

A Central de Conversas, o funil e a Central de Conexões passam ao visual Orderful (Vellum,
Paper e Carbon com a vermillion só na ação) mantendo toda a lógica da v1.17.0 — comando da
conversa, seleção em lote, ficha no celular, i18n. A Central de Conexões deixa de exibir selo
verde para um canal cujo serviço de WhatsApp não respondeu ao health check: o selo perde a
cor e a linha diz "não verificado agora — último contato <hora>".

No banco, as três migrations da ponte de dados AIOS (`companies`, `deals`, `linkedin_threads`,
`extraction_runs`, `rpc_upsert_lead` e a convergência de `contacts`) entram renumeradas como
0232–0234 — a numeração anterior colidia com a do upstream. O apêndice do `baseline.sql` é
idempotente: quem já as aplicou com a numeração antiga não recebe efeito duplo.

O botão "Atualizar" e o kit de instalação passam a puxar as imagens de `ghcr.io/leo-lima92`,
e o workflow de publicação reage a `master`, o ramo padrão deste fork.
