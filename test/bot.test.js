import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-'));

// WhatsApp simulado: registra o que seria enviado
const sent = [];
mock.module('../src/whatsapp.js', {
  namedExports: {
    send: async (jid, content) => { sent.push({ jid, text: content.text }); return { waId: 'id' + Math.random(), type: 'text', body: content.text }; },
    resolveJid: async (phone) => `${phone}@s.whatsapp.net`,
    isConnected: () => true
  }
});

const { db, setSetting, getSetting } = await import('../src/db.js');
const { bus } = await import('../src/util.js');
const store = await import('../src/store.js');
const { startBot } = await import('../src/bot.js');
startBot();

// Sempre "dentro do horário" para o teste
setSetting('hours', { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', timezone: 'America/Sao_Paulo' });

async function incoming(jid, body) {
  const contact = store.upsertContact(jid, 'Carlos Pereira');
  const conv = store.getOrCreateConversation(contact.id);
  const message = store.addMessage({ conversationId: conv.id, waId: 'in' + Math.random(), fromMe: false, body });
  bus.emit('incoming', { conversationId: conv.id, contact, message });
  await new Promise((r) => setTimeout(r, 50));
  return store.getConversation(conv.id);
}

test('fluxo do chatbot: boas-vindas, opção inválida, escolha de setor', async () => {
  const jid = '5511999990000@s.whatsapp.net';
  let conv = await incoming(jid, 'Oi, bom dia');
  assert.equal(conv.status, 'bot');
  assert.match(sent.at(-1).text, /Olá, Carlos!/);
  assert.match(sent.at(-1).text, /\*1\* - Financeiro/);

  conv = await incoming(jid, 'quero falar sobre imposto');
  assert.equal(conv.status, 'bot');
  assert.match(sent.at(-1).text, /Não entendi/);

  conv = await incoming(jid, '2');
  assert.equal(conv.status, 'pending');
  assert.equal(conv.queue, 'Fiscal');

  const before = sent.length;
  conv = await incoming(jid, 'olá?'); // já está na fila: bot não responde
  assert.equal(sent.length, before);
});

test('excede tentativas e vai para a fila geral', async () => {
  const jid = '5511999990001@s.whatsapp.net';
  await incoming(jid, 'oi');
  await incoming(jid, 'xyz');
  const conv = await incoming(jid, 'abc');
  assert.equal(conv.status, 'pending');
  assert.equal(conv.queue, 'Geral');
});

test('fora do horário envia aviso uma única vez', async () => {
  setSetting('hours', { days: [], start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' });
  const jid = '5511999990002@s.whatsapp.net';
  const n = sent.length;
  let conv = await incoming(jid, 'oi');
  await incoming(jid, 'alguém?');
  assert.equal(sent.length, n + 1);
  assert.match(sent.at(-1).text, /horário de atendimento/);
  conv = store.getConversation(conv.id);
  assert.equal(conv.status, 'pending');
  setSetting('hours', { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' });
});

test('SAIR descadastra de campanhas', async () => {
  const jid = '5511999990003@s.whatsapp.net';
  await incoming(jid, 'SAIR');
  const c = db.prepare('SELECT opt_out FROM contacts WHERE jid = ?').get(jid);
  assert.equal(c.opt_out, 1);
});

test('template e spintax', async () => {
  const { renderTemplate, normalizePhone, isWithinHours } = await import('../src/util.js');
  assert.equal(renderTemplate('{Oi|Oi}, {{primeiro_nome}}!', { name: 'Ana Lima' }), 'Oi, Ana!');
  assert.equal(normalizePhone('(11) 98765-4321'), '5511987654321');
  assert.equal(isWithinHours({ days: [3], start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' }, new Date('2026-11-04T13:00:00Z')), true);
  assert.equal(isWithinHours({ days: [3], start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' }, new Date('2026-11-04T22:00:00Z')), false);
});
