import { db, now } from './db.js';
import { bus, phoneFromJid } from './util.js';

export function upsertContact(jid, pushName) {
  let c = db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid);
  if (!c) {
    const phone = phoneFromJid(jid);
    // Pode existir um contato importado sem jid ainda vinculado
    c = db.prepare('SELECT * FROM contacts WHERE jid IS NULL AND phone = ?').get(phone);
    if (c) {
      db.prepare('UPDATE contacts SET jid = ? WHERE id = ?').run(jid, c.id);
    } else {
      const info = db.prepare('INSERT INTO contacts (jid, phone, push_name) VALUES (?, ?, ?)').run(jid, phone, pushName || null);
      return getContact(info.lastInsertRowid);
    }
  }
  if (pushName && pushName !== c.push_name) db.prepare('UPDATE contacts SET push_name = ? WHERE id = ?').run(pushName, c.id);
  return getContact(c.id);
}

export function getContact(id) {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (c) c.tags = db.prepare('SELECT t.* FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = ? ORDER BY t.name').all(id);
  return c;
}

export function getOrCreateConversation(contactId) {
  db.prepare('INSERT OR IGNORE INTO conversations (contact_id) VALUES (?)').run(contactId);
  return db.prepare('SELECT * FROM conversations WHERE contact_id = ?').get(contactId);
}

const CONV_SELECT = `
  SELECT cv.*, c.name, c.push_name, c.phone, c.jid, u.name AS assigned_name
  FROM conversations cv
  JOIN contacts c ON c.id = cv.contact_id
  LEFT JOIN users u ON u.id = cv.assigned_to`;

export function getConversation(id) {
  return db.prepare(`${CONV_SELECT} WHERE cv.id = ?`).get(id);
}

export function listConversations({ status, assignedTo, search }) {
  const where = ['cv.last_message_at IS NOT NULL'];
  const params = [];
  if (status) { where.push('cv.status = ?'); params.push(status); }
  if (assignedTo) { where.push('cv.assigned_to = ?'); params.push(assignedTo); }
  if (search) {
    where.push('(c.name LIKE ? OR c.push_name LIKE ? OR c.phone LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  return db.prepare(`${CONV_SELECT} WHERE ${where.join(' AND ')} ORDER BY cv.last_message_at DESC LIMIT 300`).all(...params);
}

export function updateConversation(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getConversation(id);
  db.prepare(`UPDATE conversations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  const conv = getConversation(id);
  bus.emit('conversation', conv);
  return conv;
}

const PREVIEW = { image: '📷 Imagem', video: '🎥 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: '💟 Figurinha' };

export function addMessage({ conversationId, waId = null, fromMe, sender = null, type = 'text', body = '', mediaPath = null, mediaName = null, status = null }) {
  if (waId && db.prepare('SELECT 1 FROM messages WHERE wa_id = ?').get(waId)) return null;
  const info = db.prepare(`INSERT INTO messages (conversation_id, wa_id, from_me, sender, type, body, media_path, media_name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(conversationId, waId, fromMe ? 1 : 0, sender, type, body, mediaPath, mediaName, status, now());
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  const preview = body || PREVIEW[type] || '';
  db.prepare(`UPDATE conversations SET last_message = ?, last_message_at = ?, unread = CASE WHEN ? THEN unread ELSE unread + 1 END WHERE id = ?`)
    .run(preview.slice(0, 200), msg.created_at, fromMe ? 1 : 0, conversationId);
  bus.emit('message', msg);
  bus.emit('conversation', getConversation(conversationId));
  return msg;
}

export function setMessageStatus(waId, status) {
  const r = db.prepare('UPDATE messages SET status = ? WHERE wa_id = ?').run(status, waId);
  if (r.changes) bus.emit('message:status', { wa_id: waId, status });
}
