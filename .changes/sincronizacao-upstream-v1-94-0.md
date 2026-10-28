---
impacto: exige_acao
secao: alterado
titulo: O Nexora sincroniza com o upstream DeskcommCRM v1.94.0
---

O chassi sobe da v1.80.0 para a v1.94.0 do DeskcommCRM (14 versões). Chegam, entre outras coisas:
a cobrança dos seus clientes pela Stripe ou pelo Asaas com planos, teste grátis, troca de plano
com cobrança proporcional e link de pagamento gerado pelo painel; o app instalável no celular
(PWA) com o nome, o ícone e as cores do Nexora; o painel do contato que recolhe no Inbox; a
importação do histórico de conversas do WhatsApp sem a IA responder; o botão "Voltar para a
versão anterior" na tela de Atualização; e, na captação por webhook, as opções de reaproveitar o
card aberto do contato e de atualizar o card quando a integração reenvia o mesmo cadastro. A
identidade visual do Nexora continua valendo nas telas que mudaram.

A cobrança continua desligada até quem administra o servidor ligá-la. O login pela assinatura do
ChatGPT também continua desligado: o Nexora atende com chave de API oficial (Anthropic ou
OpenAI), e nada nesta versão muda isso.

## Requer atenção

**Quem integra pela captação de webhook (`/api/v1/webhooks/in/<token>`), inclusive o AIOS:** o
campo `stage` no corpo do envio passou a ser reservado. Ele move o card para a etapa indicada (id
ou nome) e deixou de ir para o mapeamento de campos. Se a sua integração manda um campo chamado
`stage` com outro sentido, renomeie-o antes de atualizar. `external_id` continua reservado como
antes.

**Com a cobrança ligada e planos oferecidos:** marque um plano padrão em Painel › Cobrança ›
Planos (**Usar no cadastro**). Sem ele, o cadastro sem plano é recusado e o "Entrar com Google"
some do cadastro.

Antes de atualizar, confira também: as regras de automação com gatilho "Negócio criado" que
enviam mensagem (passam a disparar para o negócio aberto pela Prospecção); o filtro de palavras
de cada agente (passa a valer, e o agente fica calado sem a palavra); as condições "não é" de
automações sobre campo que pode estar vazio; e, depois de atualizar, os campos personalizados do
funil padrão (marque quais são do contato) e o canal do lembrete em Configurações › Tipos de
agendamento, se a organização tem mais de um número.
