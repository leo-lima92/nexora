---
impacto: capacidade_nova
secao: adicionado
titulo: O card guarda a campanha de onde o lead veio, pronta para o retorno de conversões
---

Os cards que chegam pelo webhook de entrada passam a ter a origem de campanha em colunas próprias:
`utm_source`, `utm_medium`, `utm_campaign` e os ids da campanha, do conjunto e do anúncio da Meta
(`meta_campaign_id`, `meta_adset_id`, `meta_ad_id`). É o que uma integração precisa para devolver
à Meta qual campanha gerou cada venda. As colunas são calculadas a partir do que o envio já
trazia, então os cards antigos também ganham os valores, sem nenhuma configuração.

Para preencher, mande as chaves `utm_source`, `utm_medium`, `utm_campaign`, `campaign_id`,
`adset_id` e `ad_id` no corpo do envio, no mesmo nível do nome e do telefone. O campo `stage` não
serve para isso: ele move o card de etapa. Quando o envio traz o clique do Google (`gclid`) e
nenhum clique da Meta, os ids não são gravados como da Meta.

A atualização reescreve a tabela de cards uma vez, na primeira aplicação; numa base grande, ela
pode levar alguns segundos a mais.
