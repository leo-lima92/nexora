---
impacto: exige_acao
secao: alterado
titulo: O Nexora sincroniza com o upstream DeskcommCRM v1.80.0, com a empresa (companies) unificada
---

O chassi sobe da v1.17.0 para a v1.80.0 do DeskcommCRM: 63 versões de correções de estabilidade,
segurança e MCP (teto de chamadas e de tokens por organização, bloqueio de token inválido
insistente, servidor MCP externo, ritmo do número respeitado em envios por API/MCP), mais o que
o upstream construiu no período. A identidade visual do Nexora (cores, tipografia, logotipo e
nome) continua valendo em toda tela que já tinha; telas novas herdam as cores e a tipografia do
Nexora pelos tokens.

O Nexora opera em português: o espanhol do upstream fica no código, mas não é oferecido em
nenhum seletor e o navegador de quem visita não o escolhe. Quem já tinha gravado espanhol no
perfil ou na organização continua vendo a tela em espanhol, e o seletor mostra as duas opções
para que possa voltar ao português. A galeria de modelos de
follow-up (hoje só de clínica) não aparece; "Novo fluxo" segue como antes. Os módulos de nicho
do upstream (honorários, financeiro, cobrança, CRM B2B, propostas e outros) chegam desligados.

## Requer atenção

**Quem integra o Módulo de Tráfego AIOS:** a tabela de empresas passa a ser uma
só, a do chassi: na `companies`, `org_id` vira `organization_id`, `name` vira `trade_name` e
`cnae_code`/`cnae_description` viram `main_cnae_code`/`main_cnae_description`. A atualização
converte as linhas existentes sozinha, sem perder dado. Quem escreve direto em `companies` (o
backend Hono do AIOS) precisa usar os nomes novos ANTES de atualizar; a função
`rpc_upsert_lead` não muda de assinatura e continua funcionando. `deals`, `linkedin_threads` e
`extraction_runs` não mudam de colunas, mas passam a recusar escrita de quem só pode ler: pela
API do banco, um usuário `viewer` e o suporte da plataforma em modo só-leitura continuam lendo
essas tabelas e deixam de gravar nelas. O backend do AIOS grava com a chave de serviço e não é
afetado.

O instalador passa a baixar o código do próprio repositório do Nexora
(`github.com/leo-lima92/nexora`) em vez do repositório do DeskcommCRM.

Se você conectou a assinatura do ChatGPT nos agentes, conecte de novo em IA › Credenciais. Se o
seu WAHA roda em OUTRO servidor entregando na rota global do webhook, aponte-o para a rota por
canal (`/api/v1/webhooks/waha/<token-do-canal>`). Quem usa o WAHA da própria stack não faz nada.
