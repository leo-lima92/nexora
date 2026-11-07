---
impacto: exige_acao
secao: alterado
titulo: Meta Ads sai do CRM e passa a ser do motor de tráfego (AIOS)
---

O CRM deixa de falar com a Meta de anúncios. Nenhuma venda, evento de etapa ou LeadSubmitted é
enviado à Conversions API daqui — nem pela conexão direta, nem pelo canal da conversa —, e a
leitura de campanhas também para. Cada conversão que antes sairia fica registrada no Histórico de
envios com o motivo "plataforma sem transporte". As telas Análise › Meta Ads e Configurações ›
Meta Ads saem do menu e mostram um aviso; em Configurações › Conversões ficam o Google Ads e a
captura de origem (UTM, links rastreáveis e script do site). "Reportar vendas à Meta" e "Enviar
vendas pelo canal da conversa" saem de Recursos opcionais.

## Requer atenção

**Quem reportava vendas ou eventos de etapa à Meta pelo CRM:** o retorno de conversões e a gestão
de campanhas da Meta passam a ser feitos pelo motor de tráfego (AIOS). Ele lê a campanha de cada card pelas colunas `utm_source`, `utm_medium`,
`utm_campaign`, `meta_campaign_id`, `meta_adset_id` e `meta_ad_id`, preenchidas quando a
integração manda `utm_source`, `utm_medium`, `utm_campaign`, `campaign_id`, `adset_id` e `ad_id`
no corpo do webhook de entrada. Tokens da Meta guardados antes desta versão não são apagados, mas
deixam de ser usados. A API Oficial do WhatsApp não muda.
