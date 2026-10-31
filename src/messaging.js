import { db } from './db.js';
import { addMessage, getContact, getOrCreateConversation } from './store.js';
import { resolveJid, send } from './whatsapp.js';

// Garante que o contato tenha um JID válido no WhatsApp (contatos importados só têm telefone)
export async function ensureJid(contact) {
  if (contact.jid) return contact.jid;
  const jid = await resolveJid(contact.phone);
  if (!jid) throw new Error('Número não possui WhatsApp');
  const existing = db.prepare('SELECT id FROM contacts WHERE jid = ?').get(jid);
  if (existing && existing.id !== contact.id) return jid;
  db.prepare('UPDATE contacts SET jid = ? WHERE id = ?').run(jid, contact.id);
  return jid;
}

// Envia para um contato e registra na conversa. sender = nome exibido no histórico (atendente, "Bot", "Campanha")
export async function sendToContact(contactId, content, sender) {
  const contact = getContact(contactId);
  if (!contact) throw new Error('Contato não encontrado');
  const jid = await ensureJid(contact);
  const sent = await send(jid, content);
  const conv = getOrCreateConversation(contact.id);
  return addMessage({ conversationId: conv.id, fromMe: true, sender, status: 'sent', ...sent });
}
