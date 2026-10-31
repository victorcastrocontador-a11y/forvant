import { EventEmitter } from 'node:events';

// Eventos internos repassados ao navegador via Socket.IO (ver server.js)
export const bus = new EventEmitter();

// Converte "(11) 98765-4321" em "5511987654321" (assume Brasil quando não há DDI)
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

export const phoneFromJid = (jid) => String(jid || '').split('@')[0].split(':')[0];

export function formatPhone(phone) {
  const m = String(phone).match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

// {Olá|Oi|Bom dia} -> escolhe uma variação aleatória (deixa disparos menos repetitivos)
export function spin(text) {
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, opts) => {
    const parts = opts.split('|');
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

export function renderTemplate(text, contact = {}) {
  const nome = contact.name || contact.push_name || '';
  const vars = {
    nome,
    primeiro_nome: nome.split(' ')[0] || '',
    telefone: formatPhone(contact.phone || ''),
    empresa: contact.company || ''
  };
  return spin(String(text || '')).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/ {2,}/g, ' ');
}

export function isWithinHours(hours, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: hours.timezone || 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((p) => [p.type, p.value])
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hm = `${parts.hour}:${parts.minute}`;
  return (hours.days || []).includes(day) && hm >= hours.start && hm < hours.end;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
