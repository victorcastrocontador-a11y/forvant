import { db, getSetting, now } from './db.js';
import { sendToContact } from './messaging.js';
import { getConversation, updateConversation } from './store.js';
import { bus, isWithinHours, renderTemplate } from './util.js';

const AWAY_INTERVAL_MS = 6 * 60 * 60 * 1000; // não repete a mensagem de ausência em menos de 6h

function menuText(bot, contact) {
  const opts = bot.options.map((o) => `*${o.key}* - ${o.label}`).join('\n');
  return `${renderTemplate(bot.welcome, contact)}\n\n${opts}`;
}

async function reply(contact, text) {
  await sendToContact(contact.id, { text }, 'Bot');
}

async function handleIncoming({ conversationId, contact, message }) {
  const bot = getSetting('bot');
  const hours = getSetting('hours');
  const conv = getConversation(conversationId);

  // Descadastro de campanhas
  if (/^(sair|parar|stop|descadastrar)$/i.test((message.body || '').trim())) {
    db.prepare('UPDATE contacts SET opt_out = 1 WHERE id = ?').run(contact.id);
    await reply(contact, 'Pronto! Você não receberá mais nossas mensagens em massa. Para atendimento, é só escrever aqui. 👍');
    return;
  }

  // Fora do horário: avisa (no máximo a cada 6h) e deixa na fila para o próximo expediente
  if (!isWithinHours(hours)) {
    const last = conv.away_sent_at ? Date.parse(conv.away_sent_at) : 0;
    if (bot.away && Date.now() - last > AWAY_INTERVAL_MS) {
      await reply(contact, renderTemplate(bot.away, contact));
      updateConversation(conv.id, { away_sent_at: now() });
    }
    if (conv.status === 'resolved') updateConversation(conv.id, { status: 'pending', queue: null, assigned_to: null });
    return;
  }

  if (!bot.enabled || !bot.options.length) {
    if (conv.status === 'resolved' || conv.status === 'bot') updateConversation(conv.id, { status: 'pending', assigned_to: null });
    return;
  }

  if (conv.status === 'resolved') {
    await reply(contact, menuText(bot, contact));
    updateConversation(conv.id, { status: 'bot', queue: null, assigned_to: null, bot_attempts: 0 });
    return;
  }

  if (conv.status !== 'bot') return; // já está com um atendente ou na fila

  const answer = (message.body || '').trim().toLowerCase();
  const option = bot.options.find((o) => o.key.toLowerCase() === answer || o.label.toLowerCase() === answer);
  if (option) {
    if (option.reply) await reply(contact, renderTemplate(option.reply, contact));
    updateConversation(conv.id, { status: 'pending', queue: option.queue || option.label, bot_attempts: 0 });
    return;
  }

  if (conv.bot_attempts + 1 >= bot.maxAttempts) {
    await reply(contact, 'Vou te transferir para um de nossos atendentes. Aguarde um momento. 🙂');
    updateConversation(conv.id, { status: 'pending', queue: 'Geral', bot_attempts: 0 });
  } else {
    await reply(contact, `${bot.invalid}\n\n${bot.options.map((o) => `*${o.key}* - ${o.label}`).join('\n')}`);
    updateConversation(conv.id, { bot_attempts: conv.bot_attempts + 1 });
  }
}

// Processa uma mensagem por vez para evitar respostas duplicadas em rajadas
let chain = Promise.resolve();
export function startBot() {
  bus.on('incoming', (evt) => {
    chain = chain.then(() => handleIncoming(evt)).catch((e) => console.error('[bot]', e.message));
  });
}
