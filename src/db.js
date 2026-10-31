import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(path.join(DATA_DIR, 'media'), { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'zapgestao.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  jid TEXT UNIQUE,
  phone TEXT,
  name TEXT,
  push_name TEXT,
  email TEXT,
  company TEXT,
  notes TEXT,
  opt_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3b82f6'
);
CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'resolved',
  queue TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  bot_attempts INTEGER NOT NULL DEFAULT 0,
  away_sent_at TEXT,
  last_message TEXT,
  last_message_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  wa_id TEXT,
  from_me INTEGER NOT NULL DEFAULT 0,
  sender TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  media_path TEXT,
  media_name TEXT,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa ON messages(wa_id) WHERE wa_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS quick_replies (
  id INTEGER PRIMARY KEY,
  shortcut TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  sent_at TEXT,
  UNIQUE (campaign_id, contact_id)
);
`);

const DEFAULT_SETTINGS = {
  bot: {
    enabled: true,
    welcome: 'Olá, {{primeiro_nome}}! 👋 Bem-vindo(a) ao nosso atendimento.\nDigite o número da opção desejada:',
    options: [
      { key: '1', label: 'Financeiro', reply: 'Certo! Vou te encaminhar para o setor Financeiro. Aguarde um momento.', queue: 'Financeiro' },
      { key: '2', label: 'Fiscal / Impostos', reply: 'Certo! Vou te encaminhar para o setor Fiscal. Aguarde um momento.', queue: 'Fiscal' },
      { key: '3', label: 'Departamento Pessoal', reply: 'Certo! Vou te encaminhar para o Departamento Pessoal. Aguarde um momento.', queue: 'DP' },
      { key: '4', label: 'Falar com um atendente', reply: 'Um atendente vai falar com você em instantes.', queue: 'Geral' }
    ],
    invalid: 'Não entendi 😅. Por favor, responda apenas com o número de uma das opções.',
    maxAttempts: 2,
    away: 'Olá! Nosso horário de atendimento é de segunda a sexta, das 08:00 às 18:00. Recebemos sua mensagem e retornaremos assim que possível.',
    closing: 'Atendimento encerrado. Obrigado pelo contato! Se precisar, é só mandar uma nova mensagem. 😊'
  },
  hours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
  campaign: { minDelay: 20, maxDelay: 60, dailyLimit: 200 }
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? { ...DEFAULT_SETTINGS[key], ...JSON.parse(row.value) } : structuredClone(DEFAULT_SETTINGS[key]);
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export const now = () => new Date().toISOString();
