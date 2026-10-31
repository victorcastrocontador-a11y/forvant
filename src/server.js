import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { DATA_DIR, db, getSetting, setSetting, now } from './db.js';
import { addMessage, getContact, getConversation, getOrCreateConversation, listConversations, updateConversation } from './store.js';
import { sendToContact } from './messaging.js';
import { connect, getStatus, logout } from './whatsapp.js';
import { startBot } from './bot.js';
import { kickCampaigns, startCampaignRunner } from './campaigns.js';
import { bus, normalizePhone, renderTemplate } from './util.js';

const PORT = Number(process.env.PORT || 3000);
const secretFile = path.join(DATA_DIR, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
const JWT_SECRET = process.env.JWT_SECRET || fs.readFileSync(secretFile, 'utf8');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(express.static(path.resolve('public')));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Autenticação ----------
const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active };

function userFromToken(token) {
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id);
    return publicUser(u);
  } catch { return null; }
}

function auth(req, _res, next) {
  req.user = userFromToken(req.cookies.token);
  if (!req.user) throw new HttpError(401, 'Não autenticado');
  next();
}

function admin(req, _res, next) {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Apenas administradores');
  next();
}

function setLoginCookie(res, user) {
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400e3 });
}

app.get('/api/setup-needed', (_req, res) => {
  res.json({ needed: db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 });
});

app.post('/api/setup', (req, res) => {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) throw new HttpError(400, 'Configuração inicial já realizada');
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) throw new HttpError(400, 'Preencha nome, e-mail e senha (mín. 6 caracteres)');
  const info = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`)
    .run(name, email.toLowerCase().trim(), bcrypt.hashSync(password, 10));
  setLoginCookie(res, { id: info.lastInsertRowid });
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) throw new HttpError(401, 'E-mail ou senha inválidos');
  setLoginCookie(res, u);
  res.json(publicUser(u));
});

app.post('/api/logout', (_req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.use('/api', auth);
app.use('/media', auth, express.static(path.join(DATA_DIR, 'media')));

app.get('/api/me', (req, res) => res.json(req.user));

// ---------- Usuários ----------
app.get('/api/users', (_req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser));
});

app.post('/api/users', admin, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || password.length < 6) throw new HttpError(400, 'Preencha nome, e-mail e senha (mín. 6 caracteres)');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase().trim())) throw new HttpError(400, 'E-mail já cadastrado');
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'agent');
  res.json({ ok: true });
});

app.put('/api/users/:id', admin, (req, res) => {
  const { name, email, password, role, active } = req.body;
  const id = Number(req.params.id);
  if (id === req.user.id && (role !== 'admin' || active === false)) throw new HttpError(400, 'Você não pode remover seu próprio acesso de administrador');
  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
    .run(name, email.toLowerCase().trim(), role === 'admin' ? 'admin' : 'agent', active === false ? 0 : 1, id);
  if (password) {
    if (password.length < 6) throw new HttpError(400, 'Senha deve ter ao menos 6 caracteres');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  }
  res.json({ ok: true });
});

// ---------- WhatsApp ----------
app.get('/api/whatsapp/status', (_req, res) => res.json(getStatus()));
app.post('/api/whatsapp/connect', admin, async (_req, res) => { await connect(); res.json(getStatus()); });
app.post('/api/whatsapp/logout', admin, async (_req, res) => { await logout(); res.json(getStatus()); });

// ---------- Painel ----------
app.get('/api/stats', (_req, res) => {
  const byStatus = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) n FROM conversations WHERE last_message_at IS NOT NULL GROUP BY status`).all().map((r) => [r.status, r.n]));
  const today = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  res.json({
    byStatus,
    contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n,
    receivedToday: db.prepare('SELECT COUNT(*) n FROM messages WHERE from_me = 0 AND created_at >= ?').get(today).n,
    sentToday: db.prepare('SELECT COUNT(*) n FROM messages WHERE from_me = 1 AND created_at >= ?').get(today).n,
    byAgent: db.prepare(`SELECT u.name, COUNT(cv.id) n FROM users u LEFT JOIN conversations cv ON cv.assigned_to = u.id AND cv.status = 'open' WHERE u.active = 1 GROUP BY u.id ORDER BY n DESC`).all(),
    byQueue: db.prepare(`SELECT COALESCE(queue, 'Sem fila') queue, COUNT(*) n FROM conversations WHERE status IN ('pending','open') GROUP BY queue ORDER BY n DESC`).all()
  });
});

// ---------- Conversas ----------
app.get('/api/conversations', (req, res) => {
  const { status, mine, search } = req.query;
  res.json(listConversations({ status: status || null, assignedTo: mine ? req.user.id : null, search }));
});

app.post('/api/conversations/start', async (req, res) => {
  const contact = getContact(Number(req.body.contact_id));
  if (!contact) throw new HttpError(404, 'Contato não encontrado');
  const conv = getOrCreateConversation(contact.id);
  updateConversation(conv.id, { status: 'open', assigned_to: req.user.id, last_message_at: conv.last_message_at || now() });
  res.json(getConversation(conv.id));
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = getConversation(Number(req.params.id));
  if (!conv) throw new HttpError(404, 'Conversa não encontrada');
  res.json({ ...conv, contact: getContact(conv.contact_id) });
});

app.get('/api/conversations/:id/messages', (req, res) => {
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 60').all(Number(req.params.id), before);
  res.json(rows.reverse());
});

app.post('/api/conversations/:id/read', (req, res) => {
  updateConversation(Number(req.params.id), { unread: 0 });
  res.json({ ok: true });
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  const conv = getConversation(Number(req.params.id));
  if (!conv) throw new HttpError(404, 'Conversa não encontrada');
  const { text, file, mimetype, fileName, caption } = req.body;
  if (!text?.trim() && !file) throw new HttpError(400, 'Mensagem vazia');
  const contact = getContact(conv.contact_id);
  const content = file
    ? { file: Buffer.from(file, 'base64'), mimetype, fileName, caption: caption ? renderTemplate(caption, contact) : undefined }
    : { text: renderTemplate(text, contact) };
  const msg = await sendToContact(conv.contact_id, content, req.user.name);
  // Ao responder, o atendente assume a conversa
  if (conv.status !== 'open' || !conv.assigned_to) updateConversation(conv.id, { status: 'open', assigned_to: conv.assigned_to || req.user.id, unread: 0 });
  res.json(msg);
});

app.put('/api/conversations/:id', (req, res) => {
  const fields = {};
  if (req.body.status) fields.status = req.body.status;
  if ('assigned_to' in req.body) fields.assigned_to = req.body.assigned_to || null;
  if ('queue' in req.body) fields.queue = req.body.queue || null;
  if (fields.assigned_to && !fields.status) fields.status = 'open';
  res.json(updateConversation(Number(req.params.id), fields));
});

app.post('/api/conversations/:id/resolve', async (req, res) => {
  const conv = getConversation(Number(req.params.id));
  if (!conv) throw new HttpError(404, 'Conversa não encontrada');
  const closing = getSetting('bot').closing;
  if (req.body.sendClosing && closing) {
    await sendToContact(conv.contact_id, { text: renderTemplate(closing, getContact(conv.contact_id)) }, req.user.name).catch(() => {});
  }
  addMessage({ conversationId: conv.id, fromMe: true, sender: 'Sistema', type: 'system', body: `Atendimento encerrado por ${req.user.name}` });
  res.json(updateConversation(conv.id, { status: 'resolved', assigned_to: null, queue: null, unread: 0 }));
});

// ---------- Contatos e etiquetas ----------
app.get('/api/contacts', (req, res) => {
  const { search, tag } = req.query;
  const where = ['1 = 1'];
  const params = [];
  if (search) { where.push('(c.name LIKE ? OR c.push_name LIKE ? OR c.phone LIKE ? OR c.company LIKE ?)'); params.push(...Array(4).fill(`%${search}%`)); }
  if (tag) { where.push('c.id IN (SELECT contact_id FROM contact_tags WHERE tag_id = ?)'); params.push(Number(tag)); }
  const rows = db.prepare(`SELECT c.*, (SELECT GROUP_CONCAT(tag_id) FROM contact_tags WHERE contact_id = c.id) tag_ids
    FROM contacts c WHERE ${where.join(' AND ')} ORDER BY COALESCE(c.name, c.push_name, c.phone) LIMIT 1000`).all(...params);
  res.json(rows.map((r) => ({ ...r, tag_ids: r.tag_ids ? r.tag_ids.split(',').map(Number) : [] })));
});

app.get('/api/contacts/:id', (req, res) => res.json(getContact(Number(req.params.id))));

function saveContactTags(contactId, tagIds = []) {
  db.prepare('DELETE FROM contact_tags WHERE contact_id = ?').run(contactId);
  const ins = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)');
  for (const t of tagIds) ins.run(contactId, Number(t));
}

app.post('/api/contacts', (req, res) => {
  const { name, phone, email, company, notes, tag_ids } = req.body;
  const p = normalizePhone(phone);
  if (!p) throw new HttpError(400, 'Telefone inválido');
  if (db.prepare('SELECT 1 FROM contacts WHERE phone = ?').get(p)) throw new HttpError(400, 'Já existe um contato com esse telefone');
  const info = db.prepare('INSERT INTO contacts (name, phone, email, company, notes) VALUES (?, ?, ?, ?, ?)').run(name || null, p, email || null, company || null, notes || null);
  saveContactTags(info.lastInsertRowid, tag_ids);
  res.json(getContact(info.lastInsertRowid));
});

app.put('/api/contacts/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, email, company, notes, opt_out, tag_ids } = req.body;
  db.prepare('UPDATE contacts SET name = ?, email = ?, company = ?, notes = ?, opt_out = ? WHERE id = ?')
    .run(name || null, email || null, company || null, notes || null, opt_out ? 1 : 0, id);
  if (tag_ids) saveContactTags(id, tag_ids);
  const contact = getContact(id);
  const conv = db.prepare('SELECT id FROM conversations WHERE contact_id = ?').get(id);
  if (conv) bus.emit('conversation', getConversation(conv.id));
  res.json(contact);
});

app.delete('/api/contacts/:id', admin, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// CSV com cabeçalho: nome;telefone;email;empresa;etiquetas (etiquetas separadas por "|")
app.post('/api/contacts/import', (req, res) => {
  const lines = String(req.body.csv || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new HttpError(400, 'Arquivo vazio ou sem cabeçalho');
  const sep = lines[0].includes(';') ? ';' : ',';
  const split = (l) => l.split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const iName = col('nome', 'name'), iPhone = col('telefone', 'celular', 'whatsapp', 'phone', 'numero'),
    iEmail = col('email', 'e-mail'), iCompany = col('empresa', 'company'), iTags = col('etiquetas', 'tags', 'etiqueta');
  if (iPhone < 0) throw new HttpError(400, 'Coluna "telefone" não encontrada no cabeçalho');

  let created = 0, updated = 0, skipped = 0;
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const addTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
  db.transaction(() => {
    for (const line of lines.slice(1)) {
      const cols = split(line);
      const phone = normalizePhone(cols[iPhone]);
      if (phone.length < 12) { skipped++; continue; }
      const data = { name: cols[iName] || null, email: cols[iEmail] || null, company: cols[iCompany] || null };
      let c = db.prepare('SELECT id FROM contacts WHERE phone = ?').get(phone);
      if (c) {
        db.prepare('UPDATE contacts SET name = COALESCE(?, name), email = COALESCE(?, email), company = COALESCE(?, company) WHERE id = ?').run(data.name, data.email, data.company, c.id);
        updated++;
      } else {
        c = { id: db.prepare('INSERT INTO contacts (name, phone, email, company) VALUES (?, ?, ?, ?)').run(data.name, phone, data.email, data.company).lastInsertRowid };
        created++;
      }
      for (const t of (iTags >= 0 ? cols[iTags] || '' : '').split('|').map((s) => s.trim()).filter(Boolean)) {
        const tagId = findTag.get(t)?.id ?? addTag.run(t).lastInsertRowid;
        db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(c.id, tagId);
      }
    }
  })();
  res.json({ created, updated, skipped });
});

app.get('/api/tags', (_req, res) => {
  res.json(db.prepare('SELECT t.*, (SELECT COUNT(*) FROM contact_tags WHERE tag_id = t.id) n FROM tags t ORDER BY name').all());
});
app.post('/api/tags', (req, res) => {
  if (!req.body.name?.trim()) throw new HttpError(400, 'Informe o nome da etiqueta');
  const info = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(req.body.name.trim(), req.body.color || '#3b82f6');
  res.json(db.prepare('SELECT * FROM tags WHERE id = ?').get(info.lastInsertRowid));
});
app.delete('/api/tags/:id', admin, (req, res) => {
  db.prepare('DELETE FROM tags WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Respostas rápidas ----------
app.get('/api/quick-replies', (_req, res) => res.json(db.prepare('SELECT * FROM quick_replies ORDER BY shortcut').all()));
app.post('/api/quick-replies', (req, res) => {
  const { shortcut, body } = req.body;
  if (!shortcut?.trim() || !body?.trim()) throw new HttpError(400, 'Preencha atalho e mensagem');
  db.prepare('INSERT INTO quick_replies (shortcut, body) VALUES (?, ?)').run(shortcut.trim().replace(/^\//, ''), body);
  res.json({ ok: true });
});
app.put('/api/quick-replies/:id', (req, res) => {
  db.prepare('UPDATE quick_replies SET shortcut = ?, body = ? WHERE id = ?').run(req.body.shortcut.trim().replace(/^\//, ''), req.body.body, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/quick-replies/:id', (req, res) => {
  db.prepare('DELETE FROM quick_replies WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Configurações (chatbot, horário, campanhas) ----------
const SETTING_KEYS = ['bot', 'hours', 'campaign'];
app.get('/api/settings', (_req, res) => res.json(Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)]))));
app.put('/api/settings/:key', admin, (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) throw new HttpError(404, 'Configuração desconhecida');
  setSetting(req.params.key, req.body);
  res.json(getSetting(req.params.key));
});

// ---------- Campanhas ----------
app.get('/api/campaigns', (_req, res) => res.json(db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all()));

app.post('/api/campaigns', admin, (req, res) => {
  const { name, message, tag_ids = [], contact_ids = [] } = req.body;
  if (!name?.trim() || !message?.trim()) throw new HttpError(400, 'Preencha nome e mensagem');
  const ids = new Set(contact_ids.map(Number));
  for (const t of tag_ids) for (const r of db.prepare('SELECT contact_id FROM contact_tags WHERE tag_id = ?').all(Number(t))) ids.add(r.contact_id);
  const valid = [...ids].filter((id) => db.prepare('SELECT 1 FROM contacts WHERE id = ? AND opt_out = 0').get(id));
  if (!valid.length) throw new HttpError(400, 'Nenhum contato selecionado (contatos descadastrados são ignorados)');
  const id = db.transaction(() => {
    const cid = db.prepare('INSERT INTO campaigns (name, message, total, created_by) VALUES (?, ?, ?, ?)').run(name.trim(), message, valid.length, req.user.id).lastInsertRowid;
    const ins = db.prepare('INSERT INTO campaign_recipients (campaign_id, contact_id) VALUES (?, ?)');
    for (const c of valid) ins.run(cid, c);
    return cid;
  })();
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
});

app.post('/api/campaigns/preview', (req, res) => {
  const sample = db.prepare('SELECT * FROM contacts WHERE name IS NOT NULL OR push_name IS NOT NULL LIMIT 1').get() || { name: 'Maria Silva', phone: '5511987654321' };
  res.json({ text: renderTemplate(req.body.message || '', sample), contact: sample.name || sample.push_name });
});

app.get('/api/campaigns/:id/recipients', (req, res) => {
  res.json(db.prepare(`SELECT r.*, c.name, c.push_name, c.phone FROM campaign_recipients r JOIN contacts c ON c.id = r.contact_id
    WHERE r.campaign_id = ? ORDER BY r.id`).all(Number(req.params.id)));
});

app.post('/api/campaigns/:id/start', admin, (req, res) => {
  db.prepare(`UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ? AND status IN ('draft','paused')`).run(now(), Number(req.params.id));
  kickCampaigns();
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(req.params.id)));
});

app.post('/api/campaigns/:id/pause', admin, (req, res) => {
  db.prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ? AND status = 'running'`).run(Number(req.params.id));
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(req.params.id)));
});

app.delete('/api/campaigns/:id', admin, (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Erros ----------
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Erro interno' });
});

// ---------- Tempo real ----------
io.use((socket, next) => {
  const token = (socket.handshake.headers.cookie || '').split(';').map((s) => s.trim().split('=')).find(([k]) => k === 'token')?.[1];
  socket.user = userFromToken(decodeURIComponent(token || ''));
  next(socket.user ? undefined : new Error('Não autenticado'));
});
io.on('connection', (socket) => socket.emit('wa:status', getStatus()));

for (const evt of ['message', 'message:status', 'conversation', 'campaign', 'wa:status']) {
  bus.on(evt, (data) => io.emit(evt, data));
}

startBot();
startCampaignRunner();
// Reconecta automaticamente se já houver uma sessão salva
if (fs.existsSync(path.join(DATA_DIR, 'auth', 'creds.json'))) connect().catch((e) => console.error('[whatsapp]', e));

server.listen(PORT, () => console.log(`ZapGestão rodando em http://localhost:${PORT}`));
