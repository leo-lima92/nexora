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
nenhum seletor, não é aceito na gravação e não é servido a visitante. A galeria de modelos de
follow-up (hoje só de clínica) não aparece; "Novo fluxo" segue como antes. Os módulos de nicho
do upstream (honorários, financeiro, cobrança, CRM B2B, propostas e outros) chegam desligados.

**Requer ação de quem integra o Módulo de Tráfego AIOS.** A tabela de empresas passa a ser uma
só, a do chassi: na `companies`, `org_id` vira `organization_id`, `name` vira `trade_name` e
`cnae_code`/`cnae_description` viram `main_cnae_code`/`main_cnae_description`. A atualização
converte as linhas existentes sozinha, sem perder dado. Quem escreve direto em `companies` (o
backend Hono do AIOS) precisa usar os nomes novos ANTES de atualizar; a função
`rpc_upsert_lead` não muda de assinatura e continua funcionando. `deals`, `linkedin_threads` e
`extraction_runs` não mudam.

Se você conectou a assinatura do ChatGPT nos agentes, conecte de novo em IA › Credenciais. Se o
seu WAHA roda em OUTRO servidor entregando na rota global do webhook, aponte-o para a rota por
canal (`/api/v1/webhooks/waha/<token-do-canal>`). Quem usa o WAHA da própria stack não faz nada.
