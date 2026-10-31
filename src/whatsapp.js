import makeWASocket, {
  Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion,
  generateMessageIDV2, getContentType, normalizeMessageContent, useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';
import { addMessage, getOrCreateConversation, setMessageStatus, upsertContact } from './store.js';
import { bus } from './util.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });

let sock = null;
let state = { state: 'disconnected', qr: null, me: null };
const ownIds = new Set(); // ids das mensagens enviadas pela plataforma (evita duplicar no upsert)

function setState(patch) {
  state = { ...state, ...patch };
  bus.emit('wa:status', state);
}

export const getStatus = () => state;
export const isConnected = () => state.state === 'connected';

export async function connect() {
  if (sock) return;
  setState({ state: 'connecting', qr: null });
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    auth,
    version,
    logger,
    browser: Browsers.ubuntu('ZapGestão'),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) setState({ state: 'qr', qr: await QRCode.toDataURL(qr, { margin: 1, width: 300 }) });
    if (connection === 'open') {
      setState({ state: 'connected', qr: null, me: { id: sock.user?.id, name: sock.user?.name } });
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      sock = null;
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setState({ state: 'disconnected', qr: null, me: null });
      } else {
        setState({ state: 'connecting', qr: null });
        setTimeout(() => connect().catch((e) => logger.error(e)), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      try { await handleMessage(m, type); } catch (e) { logger.error(e, 'erro ao processar mensagem'); }
    }
  });

  sock.ev.on('messages.update', (updates) => {
    const map = { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };
    for (const { key, update } of updates) {
      if (key.fromMe && map[update.status]) setMessageStatus(key.id, map[update.status]);
    }
  });
}

export async function logout() {
  if (sock) await sock.logout().catch(() => {});
  sock = null;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  setState({ state: 'disconnected', qr: null, me: null });
}

const IGNORED = /@(g\.us|broadcast|newsletter)$/;

// Com o novo modelo de LIDs, prefere o JID do número de telefone quando disponível
function chatJid(key) {
  if (key.remoteJidAlt?.endsWith('@s.whatsapp.net')) return key.remoteJidAlt;
  return key.remoteJid;
}

function extract(message) {
  const content = normalizeMessageContent(message);
  const type = getContentType(content);
  if (!type) return null;
  const c = content[type];
  switch (type) {
    case 'conversation': return { type: 'text', body: c };
    case 'extendedTextMessage': return { type: 'text', body: c.text };
    case 'imageMessage': return { type: 'image', body: c.caption || '', media: c };
    case 'videoMessage': return { type: 'video', body: c.caption || '', media: c };
    case 'audioMessage': return { type: 'audio', body: '', media: c };
    case 'stickerMessage': return { type: 'sticker', body: '', media: c };
    case 'documentMessage': return { type: 'document', body: c.caption || '', media: c, fileName: c.fileName };
    case 'buttonsResponseMessage': return { type: 'text', body: c.selectedDisplayText || c.selectedButtonId };
    case 'listResponseMessage': return { type: 'text', body: c.title || c.singleSelectReply?.selectedRowId };
    case 'contactMessage': return { type: 'text', body: `👤 Contato: ${c.displayName}` };
    case 'locationMessage': return { type: 'text', body: `📍 Localização: https://maps.google.com/?q=${c.degreesLatitude},${c.degreesLongitude}` };
    case 'reactionMessage': case 'protocolMessage': case 'senderKeyDistributionMessage': return null;
    default: return { type: 'text', body: `[mensagem não suportada: ${type}]` };
  }
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'application/pdf': 'pdf' };

async function saveMedia(m, info) {
  try {
    const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
    const mime = (info.media.mimetype || '').split(';')[0];
    const ext = info.fileName?.includes('.') ? info.fileName.split('.').pop() : EXT[mime] || mime.split('/')[1] || 'bin';
    const file = `${m.key.id}.${ext.replace(/[^\w]/g, '')}`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), buffer);
    return file;
  } catch (e) {
    logger.warn(e, 'falha ao baixar mídia');
    return null;
  }
}

async function handleMessage(m, type) {
  const jid = chatJid(m.key);
  if (!jid || IGNORED.test(jid) || !m.message) return;
  if (m.key.fromMe && ownIds.has(m.key.id)) return;
  const info = extract(m.message);
  if (!info) return;

  const contact = upsertContact(jid, m.key.fromMe ? null : m.pushName);
  const conv = getOrCreateConversation(contact.id);
  const mediaPath = info.media ? await saveMedia(m, info) : null;
  const msg = addMessage({
    conversationId: conv.id,
    waId: m.key.id,
    fromMe: m.key.fromMe,
    sender: m.key.fromMe ? 'Celular' : null,
    type: info.type,
    body: info.body,
    mediaPath,
    mediaName: info.fileName,
    status: m.key.fromMe ? 'sent' : null
  });
  // Só aciona o chatbot para mensagens novas recebidas do cliente
  if (msg && !m.key.fromMe && type === 'notify') bus.emit('incoming', { conversationId: conv.id, contact, message: msg });
}

function requireSock() {
  if (!sock || !isConnected()) throw Object.assign(new Error('WhatsApp não está conectado'), { status: 503 });
  return sock;
}

export async function resolveJid(phone) {
  const [r] = (await requireSock().onWhatsApp(phone)) || [];
  return r?.exists ? r.jid : null;
}

// content: { text } ou { file: Buffer, mimetype, fileName, caption }
export async function send(jid, content) {
  const s = requireSock();
  const messageId = generateMessageIDV2(s.user?.id);
  ownIds.add(messageId);
  setTimeout(() => ownIds.delete(messageId), 10 * 60 * 1000);

  let payload;
  let type = 'text';
  if (content.file) {
    const mime = content.mimetype || 'application/octet-stream';
    if (mime.startsWith('image/')) { type = 'image'; payload = { image: content.file, caption: content.caption }; }
    else if (mime.startsWith('video/')) { type = 'video'; payload = { video: content.file, caption: content.caption }; }
    else if (mime.startsWith('audio/')) { type = 'audio'; payload = { audio: content.file, mimetype: mime }; }
    else { type = 'document'; payload = { document: content.file, mimetype: mime, fileName: content.fileName || 'arquivo', caption: content.caption }; }
  } else {
    payload = { text: content.text };
  }

  // Simula "digitando..." brevemente, como um humano faria
  if (type === 'text') {
    await s.sendPresenceUpdate('composing', jid).catch(() => {});
    await new Promise((r) => setTimeout(r, Math.min(3000, 600 + content.text.length * 25)));
    await s.sendPresenceUpdate('paused', jid).catch(() => {});
  }

  await s.sendMessage(jid, payload, { messageId });

  let mediaPath = null;
  if (content.file) {
    const ext = (content.fileName || '').includes('.') ? content.fileName.split('.').pop() : (EXT[content.mimetype] || 'bin');
    mediaPath = `${messageId}.${ext.replace(/[^\w]/g, '')}`;
    fs.writeFileSync(path.join(MEDIA_DIR, mediaPath), content.file);
  }
  return { waId: messageId, type, body: content.text ?? content.caption ?? '', mediaPath, mediaName: content.fileName };
}
