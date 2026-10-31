# ZapGestão

Plataforma de gestão de WhatsApp para escritórios: atendimento com vários atendentes, chatbot de triagem, contatos/CRM e campanhas.
O número é conectado por QR Code, como no WhatsApp Web, usando a biblioteca [Baileys](https://github.com/WhiskeySockets/Baileys).

## Funcionalidades

- **Atendimento multiusuário**: caixa de entrada compartilhada e em tempo real, com filas por setor, atribuição, transferência entre atendentes, encerramento, anexos (imagem, áudio, vídeo, documento) e confirmação de leitura.
- **Chatbot de triagem**: boas-vindas com menu numerado, envio para a fila do setor escolhido, mensagem fora do horário e mensagem de encerramento.
- **Contatos / CRM**: etiquetas, observações, empresa, e-mail, importação de CSV e início de conversas a partir do cadastro.
- **Campanhas**: envio para contatos por etiqueta, com variáveis (`{{primeiro_nome}}`, `{{empresa}}`...), variações aleatórias (`{Olá|Oi}`), intervalo aleatório entre envios, limite diário, pausa e retomada, e descadastro automático quando o contato responde **SAIR**.
- **Respostas rápidas**: digite `/atalho` na conversa.
- **Painel** com indicadores, **usuários** com perfis administrador/atendente e **login**.

## Como instalar

Pré-requisito: [Node.js 20 ou superior](https://nodejs.org).

```bash
npm install
npm start
```

Abra http://localhost:3000. No primeiro acesso você cria a conta de administrador. Depois, vá em **Conexão › Gerar QR Code** e leia o código com o WhatsApp do escritório (*Dispositivos conectados › Conectar um dispositivo*).

Variáveis de ambiente opcionais:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Banco SQLite, sessão do WhatsApp e mídias |
| `JWT_SECRET` | gerado em `data/secret` | Chave de assinatura do login |

**Faça backup da pasta `data/`.** Ela guarda todo o histórico e a sessão conectada.

### Deixar online para a equipe

Para os atendentes acessarem de outros computadores, rode a plataforma num servidor ou num computador que fique ligado. Na rede do escritório, use `http://IP-DA-MÁQUINA:3000`. Para acesso pela internet, use uma VPS com HTTPS (por exemplo, Nginx ou Caddy como proxy reverso) e o [PM2](https://pm2.keymetrics.io/) para manter o processo rodando:

```bash
npm install -g pm2
pm2 start src/server.js --name zapgestao
pm2 save
```

## ⚠ Riscos da conexão não oficial

A conexão por QR Code não é a API oficial e viola os termos do WhatsApp. O número pode ser **banido**, principalmente por disparos em massa. Para reduzir o risco:

- use um número de WhatsApp Business já ativo há algum tempo, não um chip novo;
- envie campanhas apenas para clientes que já conversam com o escritório;
- comece com um limite baixo (30–50 envios por dia) e intervalos longos;
- personalize as mensagens e use variações `{Olá|Oi|Bom dia}`.

Se o volume crescer, migre para a [API oficial do WhatsApp Business (Cloud API)](https://developers.facebook.com/docs/whatsapp/cloud-api).

## Estrutura

```
src/server.js     API REST, login e Socket.IO
src/whatsapp.js   conexão Baileys, recebimento e envio
src/bot.js        chatbot, horário de atendimento e descadastro
src/campaigns.js  fila de disparos com intervalos e limite diário
src/store.js      contatos, conversas e mensagens
src/db.js         esquema SQLite e configurações padrão
public/           interface web (JavaScript puro)
test/             testes do chatbot (npm test)
```
