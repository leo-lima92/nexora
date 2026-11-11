---
impacto: capacidade_nova
secao: adicionado
titulo: Tráfego Agêntico guarda os pedidos e mostra a resposta do motor de tráfego
---

Os pedidos de campanha feitos em Tráfego Agêntico deixam de sumir quando a página é recarregada. A
tela ganha o cartão Pedidos, com o histórico da empresa: cada pedido mostra em que pé está (na fila
do motor, em andamento, concluído, falhou ou sem confirmação) e, quando o motor de tráfego termina,
a resposta dele. A lista se atualiza sozinha enquanto houver pedido em aberto, e há um botão
Atualizar. A resposta do pedido feito na hora também aparece na conversa. Só gestores e
administradores veem os pedidos.

A atualização cria a tabela `aios_campaign_requests` no banco, sem nenhuma ação de quem opera a VPS.
É nela que o motor de tráfego (AIOS) grava a resposta de cada pedido, com a service key do Supabase;
enquanto o motor não fizer isso, os pedidos ficam como "Na fila do motor". O que o motor recebe e o
que ele precisa gravar está em `docs/AIOS_PYTHON_CONTRACT.md`. Uma mudança para quem já integrou o
motor: o pedido entregue a ele passa a levar também o campo `request_id`, que identifica a linha
onde a resposta deve ser gravada.
