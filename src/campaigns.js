import { db, getSetting, now } from './db.js';
import { sendToContact } from './messaging.js';
import { getContact } from './store.js';
import { bus, renderTemplate, sleep } from './util.js';
import { isConnected } from './whatsapp.js';

let running = false;

function emit(id) {
  bus.emit('campaign', db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
}

function sentToday() {
  return db.prepare(`SELECT COUNT(*) n FROM campaign_recipients WHERE status = 'sent' AND sent_at >= ?`)
    .get(new Date(new Date().setHours(0, 0, 0, 0)).toISOString()).n;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const camp = db.prepare(`SELECT * FROM campaigns WHERE status = 'running' ORDER BY started_at LIMIT 1`).get();
      if (!camp || !isConnected()) return;

      const cfg = getSetting('campaign');
      if (sentToday() >= cfg.dailyLimit) return; // retoma automaticamente no dia seguinte

      const rec = db.prepare(`SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT 1`).get(camp.id);
      if (!rec) {
        db.prepare(`UPDATE campaigns SET status = 'done', finished_at = ? WHERE id = ?`).run(now(), camp.id);
        emit(camp.id);
        continue;
      }

      const contact = getContact(rec.contact_id);
      try {
        if (!contact || contact.opt_out) throw new Error('Contato descadastrado');
        await sendToContact(contact.id, { text: renderTemplate(camp.message, contact) }, 'Campanha');
        db.prepare(`UPDATE campaign_recipients SET status = 'sent', sent_at = ? WHERE id = ?`).run(now(), rec.id);
        db.prepare('UPDATE campaigns SET sent = sent + 1 WHERE id = ?').run(camp.id);
      } catch (e) {
        if (!isConnected()) return; // desconectou no meio: mantém pendente e tenta depois
        db.prepare(`UPDATE campaign_recipients SET status = 'failed', error = ? WHERE id = ?`).run(e.message, rec.id);
        db.prepare('UPDATE campaigns SET failed = failed + 1 WHERE id = ?').run(camp.id);
      }
      emit(camp.id);

      // Intervalo aleatório entre envios para reduzir o risco de bloqueio
      const min = Math.max(5, cfg.minDelay);
      const max = Math.max(min, cfg.maxDelay);
      await sleep((min + Math.random() * (max - min)) * 1000);
    }
  } finally {
    running = false;
  }
}

export function startCampaignRunner() {
  setInterval(() => tick().catch((e) => console.error('[campanhas]', e)), 15000);
  bus.on('wa:status', (s) => s.state === 'connected' && tick().catch(() => {}));
}

export const kickCampaigns = () => tick().catch((e) => console.error('[campanhas]', e));
