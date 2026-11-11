---
impacto: capacidade_nova
secao: adicionado
titulo: Tráfego Agêntico, a tela para pedir campanhas ao motor de tráfego
---

O menu ganha Tráfego Agêntico, em Canais. Nela, gestores e administradores conversam com o Estrategista
de Tráfego: cada mensagem é um pedido de campanha entregue ao motor de tráfego (AIOS), que roda fora
do CRM. Enquanto o pedido é entregue a tela mostra "Enviando instruções para o motor de IA…"; quando
o motor confirma, o pedido aparece como entregue, com a frase e o protocolo que ele devolver. Se o
motor recusar ou estiver fora do ar, a conversa diz isso e devolve o texto ao campo; se ele não
confirmar a tempo, a tela avisa que o pedido pode ter chegado e que reenviar pode gerar a campanha
duas vezes. Nesta versão a tela só entrega o pedido: o resultado da campanha ainda não aparece nela.

O endereço do motor vem da variável `AIOS_PYTHON_URL`. Vazia, o CRM usa
`http://localhost:8000/api/campaign`, que só funciona com o motor na mesma máquina e fora de
contêiner; numa instalação em Docker, preencha com o endereço do motor. `AIOS_PYTHON_TOKEN`, opcional,
é enviado ao motor em `Authorization: Bearer`. Sem as duas, a instalação segue funcionando e a tela
avisa que não conseguiu falar com o motor.
