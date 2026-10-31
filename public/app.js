// ZapGestão — interface (JavaScript puro, sem build)
const root = document.getElementById('root');
const S = { me: null, wa: { state: 'disconnected' }, tags: [], users: [], quickReplies: [] };

// ---------- Utilitários ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.me) { location.reload(); throw new Error('Sessão expirada'); }
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

function modal(html, onMount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => e.target === bg && close());
  $$('[data-close]', bg).forEach((b) => (b.onclick = close));
  document.body.append(bg);
  onMount?.(bg, close);
  $('input, textarea', bg)?.focus();
  return close;
}

const contactName = (c) => c.name || c.push_name || formatPhone(c.phone);
function formatPhone(p) {
  const m = String(p || '').match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || '';
}
const initials = (n) => String(n || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];
const colorFor = (s) => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const avatar = (name, key) => `<div class="avatar" style="background:${colorFor(key)}">${esc(initials(name))}</div>`;
const STATUS = { bot: 'No chatbot', pending: 'Na fila', open: 'Em atendimento', resolved: 'Encerrada', draft: 'Rascunho', running: 'Enviando', paused: 'Pausada', done: 'Concluída', sent: 'Enviada', failed: 'Falhou' };
const statusBadge = (s) => `<span class="status st-${s}">${STATUS[s] || s}</span>`;
const tagChip = (t) => `<span class="tag" style="background:${esc(t.color)}">${esc(t.name)}</span>`;

function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso), today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const isAdmin = () => S.me?.role === 'admin';

// ---------- Login / configuração inicial ----------
async function showAuth() {
  const { needed } = await api('GET', '/api/setup-needed');
  root.innerHTML = `
    <div class="auth"><form class="card" id="f">
      <div class="logo"><div class="mark">Z</div> ZapGestão</div>
      <p class="muted">${needed ? 'Primeiro acesso: crie a conta do administrador.' : 'Entre com sua conta.'}</p>
      ${needed ? '<label>Nome</label><input type="text" name="name" required>' : ''}
      <label>E-mail</label><input type="email" name="email" required autocomplete="username">
      <label>Senha</label><input type="password" name="password" required minlength="6" autocomplete="${needed ? 'new-password' : 'current-password'}">
      <button class="btn primary" style="width:100%;margin-top:16px">${needed ? 'Criar conta e entrar' : 'Entrar'}</button>
      <div class="error" id="err"></div>
    </form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', needed ? '/api/setup' : '/api/login', Object.fromEntries(new FormData(e.target)));
      boot();
    } catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- Estrutura ----------
const NAV = [
  ['painel', '📊', 'Painel'],
  ['atendimento', '💬', 'Atendimento'],
  ['contatos', '👥', 'Contatos'],
  ['campanhas', '📣', 'Campanhas', true],
  ['respostas', '⚡', 'Respostas rápidas'],
  ['chatbot', '🤖', 'Chatbot e horários', true],
  ['usuarios', '🧑‍💼', 'Usuários', true],
  ['conexao', '📱', 'Conexão']
];

function renderShell() {
  root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="logo"><div class="mark">Z</div> ZapGestão</div>
        <nav class="nav">${NAV.filter((n) => !n[3] || isAdmin()).map(([k, i, l]) =>
          `<a href="#/${k}" data-nav="${k}"><span>${i}</span> ${l}${k === 'atendimento' ? '<span class="badge hidden" id="queue-badge"></span>' : ''}</a>`).join('')}</nav>
        <div class="foot">
          <div id="wa-pill"></div>
          <div style="margin-top:10px"><b>${esc(S.me.name)}</b><div class="muted small">${S.me.role === 'admin' ? 'Administrador' : 'Atendente'}</div></div>
          <button class="btn sm" id="logout" style="margin-top:8px">Sair</button>
        </div>
      </aside>
      <main id="main"></main>
    </div>`;
  $('#logout').onclick = async () => { await api('POST', '/api/logout'); location.hash = ''; location.reload(); };
  renderWaPill();
}

function renderWaPill() {
  const el = $('#wa-pill');
  if (!el) return;
  const map = { connected: ['on', 'WhatsApp conectado'], qr: ['wait', 'Aguardando QR Code'], connecting: ['wait', 'Conectando...'], disconnected: ['off', 'WhatsApp desconectado'] };
  const [cls, label] = map[S.wa.state] || map.disconnected;
  el.innerHTML = `<a href="#/conexao" class="wa-pill" style="text-decoration:none;color:inherit"><span class="dot ${cls}"></span>${label}</a>`;
}

async function updateQueueBadge() {
  const list = await api('GET', '/api/conversations?status=pending').catch(() => []);
  const b = $('#queue-badge');
  if (!b) return;
  b.textContent = list.length;
  b.classList.toggle('hidden', !list.length);
  document.title = list.length ? `(${list.length}) ZapGestão` : 'ZapGestão';
}

let current = null; // página atual { name, onEvent }
function router() {
  const [, page = 'atendimento', arg] = location.hash.split('/');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
  const main = $('#main');
  const pages = { painel: pageDashboard, atendimento: pageInbox, contatos: pageContacts, campanhas: pageCampaigns, respostas: pageQuickReplies, chatbot: pageBot, usuarios: pageUsers, conexao: pageConnection };
  current = { name: page };
  run(pages[page] || pageInbox)(main, arg);
}

// ---------- Painel ----------
async function pageDashboard(main) {
  const s = await api('GET', '/api/stats');
  const bars = (rows, key) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return rows.length ? rows.map((r) => `<div class="bar"><span>${esc(r[key])}</span><div class="track"><div class="fill" style="width:${(r.n / max) * 100}%"></div></div><b>${r.n}</b></div>`).join('') : '<p class="muted">Nada por aqui ainda.</p>';
  };
  main.innerHTML = `
    <div class="page">
      <div class="page-head"><div><h1>Painel</h1><div class="sub">Visão geral do atendimento hoje</div></div></div>
      ${S.wa.state !== 'connected' ? `<div class="alert">O WhatsApp não está conectado. <a href="#/conexao">Conectar agora</a></div>` : ''}
      <div class="stats">
        <div class="card stat"><div class="n">${s.byStatus.pending || 0}</div><div class="l">Na fila aguardando</div></div>
        <div class="card stat"><div class="n">${s.byStatus.open || 0}</div><div class="l">Em atendimento</div></div>
        <div class="card stat"><div class="n">${s.byStatus.bot || 0}</div><div class="l">No chatbot</div></div>
        <div class="card stat"><div class="n">${s.receivedToday}</div><div class="l">Mensagens recebidas hoje</div></div>
        <div class="card stat"><div class="n">${s.sentToday}</div><div class="l">Mensagens enviadas hoje</div></div>
        <div class="card stat"><div class="n">${s.contacts}</div><div class="l">Contatos</div></div>
      </div>
      <div class="grid2">
        <div class="card section"><h3 style="margin-top:0">Atendimentos por atendente</h3><div class="bars">${bars(s.byAgent, 'name')}</div></div>
        <div class="card section"><h3 style="margin-top:0">Conversas ativas por setor</h3><div class="bars">${bars(s.byQueue, 'queue')}</div></div>
      </div>
    </div>`;
}

// ---------- Atendimento ----------
const INBOX_TABS = [['pending', 'Fila'], ['mine', 'Meus'], ['open', 'Em atendimento'], ['bot', 'Chatbot'], ['resolved', 'Encerradas']];
const inbox = { tab: 'pending', search: '', convs: new Map(), activeId: null, messages: [], showInfo: window.innerWidth > 1100, attach: null };

function convMatches(c) {
  if (inbox.search) {
    const q = inbox.search.toLowerCase();
    if (![c.name, c.push_name, c.phone].some((v) => String(v || '').toLowerCase().includes(q))) return false;
  }
  if (inbox.tab === 'mine') return c.status === 'open' && c.assigned_to === S.me.id;
  return c.status === inbox.tab;
}

async function pageInbox(main, arg) {
  inbox.activeId = arg ? Number(arg) : null;
  main.innerHTML = `
    <div class="inbox" id="inbox">
      <section class="conv-list">
        <div class="top">
          <input type="search" id="conv-search" placeholder="Buscar por nome ou telefone" value="${esc(inbox.search)}">
          <div class="tabs">${INBOX_TABS.map(([k, l]) => `<button data-tab="${k}" class="${inbox.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="convs" id="convs"></div>
      </section>
      <section class="chat" id="chat"></section>
      <aside class="info hidden" id="info"></aside>
    </div>`;
  $$('[data-tab]').forEach((b) => (b.onclick = () => { inbox.tab = b.dataset.tab; pageInbox(main, inbox.activeId); }));
  let t;
  $('#conv-search').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { inbox.search = e.target.value; loadConvs(); }, 250); };

  [S.users, S.quickReplies] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/quick-replies')]);
  await loadConvs();
  await openChat(inbox.activeId);

  current.onEvent = (evt, data) => {
    if (evt === 'conversation') {
      if (convMatches(data)) inbox.convs.set(data.id, data); else inbox.convs.delete(data.id);
      renderConvs();
      if (data.id === inbox.activeId) { inbox.conv = { ...inbox.conv, ...data }; renderChatHead(); }
    }
    if (evt === 'message' && data.conversation_id === inbox.activeId) {
      inbox.messages.push(data);
      appendMessages([data]);
      if (!data.from_me && document.hasFocus()) api('POST', `/api/conversations/${inbox.activeId}/read`).catch(() => {});
    }
    if (evt === 'message:status') {
      const m = inbox.messages.find((x) => x.wa_id === data.wa_id);
      if (m) { m.status = data.status; const el = $(`[data-wa="${CSS.escape(data.wa_id)}"] .tick`); if (el) el.innerHTML = tick(data.status); }
    }
  };
}

async function loadConvs() {
  const params = new URLSearchParams();
  if (inbox.tab === 'mine') { params.set('status', 'open'); params.set('mine', '1'); } else params.set('status', inbox.tab);
  if (inbox.search) params.set('search', inbox.search);
  const list = await api('GET', `/api/conversations?${params}`);
  inbox.convs = new Map(list.map((c) => [c.id, c]));
  renderConvs();
}

function renderConvs() {
  const el = $('#convs');
  if (!el) return;
  const list = [...inbox.convs.values()].sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)));
  el.innerHTML = list.length ? list.map((c) => `
    <div class="conv ${c.id === inbox.activeId ? 'active' : ''}" data-id="${c.id}">
      ${avatar(contactName(c), c.phone)}
      <div class="mid">
        <div class="name">${esc(contactName(c))}</div>
        <div class="last">${esc(c.last_message || '')}</div>
        <div class="small muted">${c.queue ? '🏷 ' + esc(c.queue) : ''}${c.assigned_name ? ' · 👤 ' + esc(c.assigned_name) : ''}</div>
      </div>
      <div class="meta"><span>${timeLabel(c.last_message_at)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</div>
    </div>`).join('') : '<div class="empty">Nenhuma conversa aqui.</div>';
  $$('.conv', el).forEach((d) => (d.onclick = () => (location.hash = `#/atendimento/${d.dataset.id}`)));
}

async function openChat(id) {
  const chat = $('#chat');
  $('#inbox').classList.toggle('has-chat', !!id);
  if (!id) {
    chat.innerHTML = `<div class="empty"><div><div style="font-size:42px">💬</div>Selecione uma conversa para começar o atendimento.</div></div>`;
    $('#info').classList.add('hidden');
    $('#inbox').classList.add('no-info');
    return;
  }
  inbox.attach = null;
  if (window.innerWidth <= 1100) inbox.showInfo = false;
  [inbox.conv, inbox.messages] = await Promise.all([api('GET', `/api/conversations/${id}`), api('GET', `/api/conversations/${id}/messages`)]);
  chat.innerHTML = `
    <div class="chat-head" id="chat-head"></div>
    <div class="messages" id="messages"></div>
    <div class="composer">
      <div class="qr-pop hidden" id="qr-pop"></div>
      <div class="attach-preview hidden" id="attach-preview"></div>
      <div class="row">
        <button class="btn" id="attach-btn" title="Anexar arquivo">📎</button>
        <input type="file" id="file" class="hidden">
        <textarea id="text" class="grow" rows="1" placeholder="Digite uma mensagem — use / para respostas rápidas"></textarea>
        <button class="btn primary" id="send">Enviar</button>
      </div>
    </div>`;
  renderChatHead();
  renderInfo();
  $('#messages').innerHTML = '';
  appendMessages(inbox.messages, true);
  setupComposer();
  if (inbox.conv.unread) api('POST', `/api/conversations/${id}/read`).catch(() => {});
  renderConvs();
}

function renderChatHead() {
  const c = inbox.conv;
  const el = $('#chat-head');
  if (!el || !c) return;
  const mine = c.assigned_to === S.me.id;
  el.innerHTML = `
    <a href="#/atendimento" class="btn sm mobile-only">←</a>
    ${avatar(contactName(c), c.phone)}
    <div class="who"><b>${esc(contactName(c))}</b><div class="small muted">${esc(formatPhone(c.phone))} · ${statusBadge(c.status)} ${c.queue ? '· ' + esc(c.queue) : ''} ${c.assigned_name ? '· 👤 ' + esc(c.assigned_name) : ''}</div></div>
    ${c.status !== 'open' || !mine ? '<button class="btn sm primary" id="take">Assumir</button>' : ''}
    <select id="transfer" style="width:auto" title="Transferir">
      <option value="">Transferir para...</option>
      ${S.users.filter((u) => u.active && u.id !== c.assigned_to).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
      <option value="queue">↩ Devolver para a fila</option>
    </select>
    ${c.status !== 'resolved' ? '<button class="btn sm" id="resolve">✔ Encerrar</button>' : ''}
    <button class="btn sm" id="toggle-info" title="Dados do contato">ℹ</button>`;
  const id = c.id;
  $('#take', el) && ($('#take', el).onclick = run(async () => { await api('PUT', `/api/conversations/${id}`, { status: 'open', assigned_to: S.me.id }); }));
  $('#transfer', el).onchange = run(async (e) => {
    const v = e.target.value;
    if (!v) return;
    await api('PUT', `/api/conversations/${id}`, v === 'queue' ? { status: 'pending', assigned_to: null } : { assigned_to: Number(v), status: 'open' });
    toast('Conversa transferida');
  });
  $('#resolve', el) && ($('#resolve', el).onclick = () => modal(`
    <h2>Encerrar atendimento</h2>
    <p>Encerrar a conversa com <b>${esc(contactName(c))}</b>?</p>
    <div class="checks"><label><input type="checkbox" id="closing" checked> Enviar mensagem de encerramento ao cliente</label></div>
    <div class="foot"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Encerrar</button></div>`,
  (m, close) => { $('#ok', m).onclick = run(async () => { await api('POST', `/api/conversations/${id}/resolve`, { sendClosing: $('#closing', m).checked }); close(); toast('Atendimento encerrado'); }); }));
  $('#toggle-info', el).onclick = () => { inbox.showInfo = !inbox.showInfo; renderInfo(); };
}

function renderInfo() {
  const el = $('#info');
  const c = inbox.conv?.contact;
  if (!el) return;
  el.classList.toggle('hidden', !inbox.showInfo || !c);
  $('#inbox').classList.toggle('no-info', !inbox.showInfo || !c);
  if (!c) return;
  el.innerHTML = `
    <div class="row"><b class="grow">Dados do contato</b><button class="btn sm" id="close-info">✕</button></div>
    <div style="text-align:center;margin:14px 0">${avatar(contactName(c), c.phone).replace('class="avatar"', 'class="avatar" style="width:64px;height:64px;margin:0 auto;font-size:22px;background:' + colorFor(c.phone) + '"')}
      <h3>${esc(contactName(c))}</h3><div class="muted">${esc(formatPhone(c.phone))}</div>${c.push_name ? `<div class="small muted">Nome no WhatsApp: ${esc(c.push_name)}</div>` : ''}</div>
    <form id="cf">
      <label>Nome</label><input type="text" name="name" value="${esc(c.name || '')}" placeholder="${esc(c.push_name || '')}">
      <label>E-mail</label><input type="email" name="email" value="${esc(c.email || '')}">
      <label>Empresa</label><input type="text" name="company" value="${esc(c.company || '')}">
      <label>Etiquetas</label><div class="checks">${S.tags.map((t) => `<label><input type="checkbox" name="tag" value="${t.id}" ${c.tags.some((x) => x.id === t.id) ? 'checked' : ''}> ${tagChip(t)}</label>`).join('') || '<span class="muted small">Crie etiquetas na página Contatos.</span>'}</div>
      <label>Observações</label><textarea name="notes">${esc(c.notes || '')}</textarea>
      <div class="checks" style="margin-top:8px"><label><input type="checkbox" name="opt_out" ${c.opt_out ? 'checked' : ''}> Não recebe campanhas</label></div>
      <button class="btn primary" style="margin-top:12px;width:100%">Salvar</button>
    </form>`;
  $('#close-info').onclick = () => { inbox.showInfo = false; renderInfo(); };
  $('#cf').onsubmit = run(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    inbox.conv.contact = await api('PUT', `/api/contacts/${c.id}`, {
      name: f.get('name'), email: f.get('email'), company: f.get('company'), notes: f.get('notes'),
      opt_out: f.has('opt_out'), tag_ids: f.getAll('tag').map(Number)
    });
    toast('Contato salvo');
  });
}

const tick = (s) => (s === 'read' ? '<span style="color:#53bdeb">✓✓</span>' : s === 'delivered' ? '✓✓' : s === 'sent' ? '✓' : '🕓');

function mediaHtml(m) {
  if (!m.media_path) return m.type !== 'text' && m.type !== 'system' ? '<i class="muted">[mídia indisponível]</i>' : '';
  const src = `/media/${encodeURIComponent(m.media_path)}`;
  switch (m.type) {
    case 'image': case 'sticker': return `<a href="${src}" target="_blank"><img src="${src}" loading="lazy" alt=""></a>`;
    case 'video': return `<video src="${src}" controls preload="metadata"></video>`;
    case 'audio': return `<audio src="${src}" controls preload="metadata"></audio>`;
    default: return `<a href="${src}" target="_blank" download="${esc(m.media_name || m.media_path)}">📄 ${esc(m.media_name || 'Documento')}</a>`;
  }
}

function linkify(s) {
  return esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function appendMessages(list, initial = false) {
  const box = $('#messages');
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  let lastDay = box.dataset.lastDay || '';
  let html = '';
  for (const m of list) {
    const day = new Date(m.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (day !== lastDay) { html += `<div class="day">${day}</div>`; lastDay = day; }
    if (m.type === 'system') { html += `<div class="msg system">${esc(m.body)}</div>`; continue; }
    html += `<div class="msg ${m.from_me ? 'out' : ''}" ${m.wa_id ? `data-wa="${esc(m.wa_id)}"` : ''}>
      ${m.from_me && m.sender ? `<div class="by">${esc(m.sender)}</div>` : ''}
      ${mediaHtml(m)}${m.body ? `<div class="text">${linkify(m.body)}</div>` : ''}
      <div class="time">${new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ${m.from_me ? `<span class="tick">${tick(m.status)}</span>` : ''}</div>
    </div>`;
  }
  box.dataset.lastDay = lastDay;
  box.insertAdjacentHTML('beforeend', html);
  if (initial || nearBottom) box.scrollTop = box.scrollHeight;
}

function setupComposer() {
  const text = $('#text'), pop = $('#qr-pop');
  let sel = 0, matches = [];
  const autosize = () => { text.style.height = 'auto'; text.style.height = Math.min(160, text.scrollHeight) + 'px'; };

  const showPop = () => {
    const m = text.value.match(/^\/(\S*)$/);
    matches = m ? S.quickReplies.filter((q) => q.shortcut.toLowerCase().startsWith(m[1].toLowerCase())) : [];
    pop.classList.toggle('hidden', !matches.length);
    sel = Math.min(sel, Math.max(0, matches.length - 1));
    pop.innerHTML = matches.map((q, i) => `<div data-i="${i}" class="${i === sel ? 'sel' : ''}"><b>/${esc(q.shortcut)}</b> <span class="muted">${esc(q.body.slice(0, 90))}</span></div>`).join('');
    $$('div', pop).forEach((d) => (d.onclick = () => pick(Number(d.dataset.i))));
  };
  const pick = (i) => { text.value = matches[i].body; pop.classList.add('hidden'); autosize(); text.focus(); };

  const send = run(async () => {
    const body = text.value.trim();
    if (!body && !inbox.attach) return;
    const id = inbox.activeId;
    $('#send').disabled = true;
    try {
      if (inbox.attach) {
        await api('POST', `/api/conversations/${id}/messages`, { ...inbox.attach, caption: body || undefined });
        inbox.attach = null;
        $('#attach-preview').classList.add('hidden');
      } else {
        await api('POST', `/api/conversations/${id}/messages`, { text: body });
      }
      text.value = '';
      autosize();
    } finally { $('#send') && ($('#send').disabled = false); }
  });

  text.oninput = () => { autosize(); showPop(); };
  text.onkeydown = (e) => {
    if (!pop.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') { sel = (sel + 1) % matches.length; showPop(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { sel = (sel - 1 + matches.length) % matches.length; showPop(); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { pick(sel); e.preventDefault(); return; }
      if (e.key === 'Escape') { pop.classList.add('hidden'); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  $('#send').onclick = send;
  $('#attach-btn').onclick = () => $('#file').click();
  $('#file').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 16 * 1024 * 1024) return toast('Arquivo muito grande (máx. 16 MB)', true);
    const r = new FileReader();
    r.onload = () => {
      inbox.attach = { file: String(r.result).split(',')[1], mimetype: f.type || 'application/octet-stream', fileName: f.name };
      const p = $('#attach-preview');
      p.classList.remove('hidden');
      p.innerHTML = `📎 <b>${esc(f.name)}</b> <span class="muted">(${(f.size / 1024).toFixed(0)} KB) — o texto digitado vira legenda</span> <button class="btn sm" id="rm-attach">Remover</button>`;
      $('#rm-attach').onclick = () => { inbox.attach = null; p.classList.add('hidden'); };
    };
    r.readAsDataURL(f);
  };
  text.focus();
}

// ---------- Contatos ----------
const contactsState = { search: '', tag: '' };

async function pageContacts(main) {
  S.tags = await api('GET', '/api/tags');
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="grow"><h1>Contatos</h1><div class="sub">Clientes, etiquetas e histórico</div></div>
        <button class="btn" id="tags-btn">🏷 Etiquetas</button>
        <button class="btn" id="import-btn">⬆ Importar CSV</button>
        <button class="btn primary" id="new-btn">+ Novo contato</button>
      </div>
      <div class="row" style="margin-bottom:12px;flex-wrap:wrap">
        <input type="search" id="q" class="grow" placeholder="Buscar por nome, telefone ou empresa" value="${esc(contactsState.search)}" style="min-width:200px">
        <select id="tagf" style="width:auto"><option value="">Todas as etiquetas</option>${S.tags.map((t) => `<option value="${t.id}" ${String(t.id) === contactsState.tag ? 'selected' : ''}>${esc(t.name)} (${t.n})</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone</th><th>Empresa</th><th>Etiquetas</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      <p class="muted small" id="count"></p>
    </div>`;

  const load = run(async () => {
    const params = new URLSearchParams({ search: contactsState.search, tag: contactsState.tag });
    const list = await api('GET', `/api/contacts?${params}`);
    const tagById = Object.fromEntries(S.tags.map((t) => [t.id, t]));
    $('#rows').innerHTML = list.map((c) => `
      <tr>
        <td><b>${esc(contactName(c))}</b>${c.opt_out ? ' <span class="small muted" title="Não recebe campanhas">🚫</span>' : ''}${c.email ? `<div class="small muted">${esc(c.email)}</div>` : ''}</td>
        <td>${esc(formatPhone(c.phone))}</td>
        <td>${esc(c.company || '')}</td>
        <td>${c.tag_ids.map((id) => tagById[id] && tagChip(tagById[id])).join('')}</td>
        <td><div class="actions">
          <button class="btn sm" data-chat="${c.id}">💬 Conversar</button>
          <button class="btn sm" data-edit="${c.id}">Editar</button>
          ${isAdmin() ? `<button class="btn sm danger" data-del="${c.id}">Excluir</button>` : ''}
        </div></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum contato encontrado.</td></tr>';
    $('#count').textContent = `${list.length} contato(s)`;
    $$('[data-chat]').forEach((b) => (b.onclick = run(async () => {
      const conv = await api('POST', '/api/conversations/start', { contact_id: Number(b.dataset.chat) });
      inbox.tab = 'mine';
      location.hash = `#/atendimento/${conv.id}`;
    })));
    $$('[data-edit]').forEach((b) => (b.onclick = run(async () => contactModal(await api('GET', `/api/contacts/${b.dataset.edit}`), load))));
    $$('[data-del]').forEach((b) => (b.onclick = run(async () => {
      if (!confirm('Excluir este contato e todo o histórico de conversas?')) return;
      await api('DELETE', `/api/contacts/${b.dataset.del}`);
      load();
    })));
  });

  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { contactsState.search = e.target.value; load(); }, 250); };
  $('#tagf').onchange = (e) => { contactsState.tag = e.target.value; load(); };
  $('#new-btn').onclick = () => contactModal(null, load);
  $('#import-btn').onclick = () => importModal(() => pageContacts(main));
  $('#tags-btn').onclick = () => tagsModal(() => pageContacts(main));
  load();
}

function contactModal(c, onSave) {
  modal(`
    <h2>${c ? 'Editar contato' : 'Novo contato'}</h2>
    <form id="f">
      <div class="grid2">
        <div><label>Nome</label><input type="text" name="name" value="${esc(c?.name || '')}"></div>
        <div><label>Telefone (com DDD)</label><input type="text" name="phone" value="${esc(c ? formatPhone(c.phone) : '')}" ${c ? 'disabled' : 'required'} placeholder="(11) 98765-4321"></div>
        <div><label>E-mail</label><input type="email" name="email" value="${esc(c?.email || '')}"></div>
        <div><label>Empresa</label><input type="text" name="company" value="${esc(c?.company || '')}"></div>
      </div>
      <label>Etiquetas</label>
      <div class="checks">${S.tags.map((t) => `<label><input type="checkbox" name="tag" value="${t.id}" ${c?.tags?.some((x) => x.id === t.id) ? 'checked' : ''}> ${tagChip(t)}</label>`).join('') || '<span class="muted small">Nenhuma etiqueta criada.</span>'}</div>
      <label>Observações</label><textarea name="notes">${esc(c?.notes || '')}</textarea>
      <div class="checks" style="margin-top:8px"><label><input type="checkbox" name="opt_out" ${c?.opt_out ? 'checked' : ''}> Não recebe campanhas</label></div>
      <div class="foot"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`, (m, close) => {
    $('#f', m).onsubmit = run(async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = { name: f.get('name'), phone: f.get('phone'), email: f.get('email'), company: f.get('company'), notes: f.get('notes'), opt_out: f.has('opt_out'), tag_ids: f.getAll('tag').map(Number) };
      await api(c ? 'PUT' : 'POST', c ? `/api/contacts/${c.id}` : '/api/contacts', body);
      close();
      toast('Contato salvo');
      onSave();
    });
  });
}

function importModal(onDone) {
  modal(`
    <h2>Importar contatos (CSV)</h2>
    <p class="muted">Planilha salva como CSV (separada por <code>;</code> ou <code>,</code>) com cabeçalho. Colunas aceitas:
      <b>nome</b>, <b>telefone</b> (obrigatória), <b>email</b>, <b>empresa</b>, <b>etiquetas</b> (várias separadas por <code>|</code>).</p>
    <pre class="card small" style="padding:10px;overflow:auto">nome;telefone;empresa;etiquetas
Maria Silva;(11) 98765-4321;Padaria Pão Bom;Cliente|Simples Nacional
João Souza;21912345678;;Lead</pre>
    <input type="file" id="csv" accept=".csv,text/csv,text/plain">
    <div class="foot"><button class="btn" data-close>Fechar</button><button class="btn primary" id="go">Importar</button></div>`,
  (m, close) => {
    $('#go', m).onclick = run(async () => {
      const f = $('#csv', m).files[0];
      if (!f) return toast('Escolha um arquivo', true);
      const buf = await f.arrayBuffer();
      let csv = new TextDecoder('utf-8').decode(buf);
      if (csv.includes('�')) csv = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel em português
      const r = await api('POST', '/api/contacts/import', { csv });
      toast(`${r.created} criados, ${r.updated} atualizados, ${r.skipped} ignorados`);
      close();
      onDone();
    });
  });
}

function tagsModal(onDone) {
  const render = (m) => {
    $('#tag-list', m).innerHTML = S.tags.map((t) => `<div class="row" style="margin:6px 0">${tagChip(t)}<span class="muted small grow">${t.n} contato(s)</span>${isAdmin() ? `<button class="btn sm danger" data-del="${t.id}">Excluir</button>` : ''}</div>`).join('') || '<p class="muted">Nenhuma etiqueta.</p>';
    $$('[data-del]', m).forEach((b) => (b.onclick = run(async () => {
      await api('DELETE', `/api/tags/${b.dataset.del}`);
      S.tags = await api('GET', '/api/tags');
      render(m);
    })));
  };
  modal(`
    <h2>Etiquetas</h2>
    <div id="tag-list"></div>
    <form class="row" id="f" style="margin-top:12px"><input type="text" name="name" placeholder="Nova etiqueta" class="grow" required><input type="color" name="color" value="#3b82f6" style="width:44px;height:36px;padding:2px"><button class="btn primary">Adicionar</button></form>
    <div class="foot"><button class="btn" data-close>Fechar</button></div>`,
  (m) => {
    render(m);
    $('#f', m).onsubmit = run(async (e) => {
      e.preventDefault();
      await api('POST', '/api/tags', Object.fromEntries(new FormData(e.target)));
      e.target.reset();
      S.tags = await api('GET', '/api/tags');
      render(m);
    });
    m.addEventListener('mousedown', (e) => e.target === m && onDone());
    $('[data-close]', m).addEventListener('click', onDone);
  });
}

// ---------- Campanhas ----------
async function pageCampaigns(main) {
  const [list, settings] = await Promise.all([api('GET', '/api/campaigns'), api('GET', '/api/settings')]);
  S.tags = await api('GET', '/api/tags');
  const cfg = settings.campaign;
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="grow"><h1>Campanhas</h1><div class="sub">Envio de mensagens para listas de contatos</div></div>
        <button class="btn primary" id="new-btn">+ Nova campanha</button>
      </div>
      <div class="alert">⚠ <b>Atenção:</b> a conexão por QR Code não é oficial. Envios em massa para quem não salvou seu número ou não pediu para receber
        são a principal causa de <b>banimento</b>. Envie só para clientes que já conversam com você, personalize o texto e mantenha intervalos longos.
        Configuração atual: intervalo de ${cfg.minDelay}–${cfg.maxDelay}s e limite de ${cfg.dailyLimit} envios por dia${isAdmin() ? ' (<a href="#/chatbot">alterar</a>)' : ''}.
        Quem responder <b>SAIR</b> é descadastrado automaticamente.</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Campanha</th><th>Status</th><th>Progresso</th><th>Enviadas</th><th>Falhas</th><th></th></tr></thead>
        <tbody id="rows">${list.map(campRow).join('') || '<tr><td colspan="6" class="muted">Nenhuma campanha criada.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  $('#new-btn').onclick = () => campaignModal(() => pageCampaigns(main));
  bindCampRows(main);
  current.onEvent = (evt, c) => {
    if (evt !== 'campaign' || !c) return;
    const tr = $(`tr[data-camp="${c.id}"]`);
    if (tr) { tr.outerHTML = campRow(c); bindCampRows(main); }
  };
}

function campRow(c) {
  const done = c.sent + c.failed;
  return `<tr data-camp="${c.id}">
    <td><b>${esc(c.name)}</b><div class="small muted">${new Date(c.created_at.replace(' ', 'T') + (c.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('pt-BR')}</div></td>
    <td>${statusBadge(c.status)}</td>
    <td><div class="progress"><div style="width:${c.total ? (done / c.total) * 100 : 0}%"></div></div><div class="small muted">${done} de ${c.total}</div></td>
    <td>${c.sent}</td><td>${c.failed}</td>
    <td><div class="actions">
      ${['draft', 'paused'].includes(c.status) && isAdmin() ? `<button class="btn sm primary" data-start="${c.id}">▶ ${c.status === 'draft' ? 'Iniciar' : 'Retomar'}</button>` : ''}
      ${c.status === 'running' && isAdmin() ? `<button class="btn sm" data-pause="${c.id}">⏸ Pausar</button>` : ''}
      <button class="btn sm" data-recs="${c.id}">Detalhes</button>
      ${c.status !== 'running' && isAdmin() ? `<button class="btn sm danger" data-del="${c.id}">Excluir</button>` : ''}
    </div></td></tr>`;
}

function bindCampRows(main) {
  $$('[data-start]', main).forEach((b) => (b.onclick = run(async () => {
    if (S.wa.state !== 'connected') return toast('Conecte o WhatsApp antes de iniciar', true);
    await api('POST', `/api/campaigns/${b.dataset.start}/start`);
    pageCampaigns(main);
  })));
  $$('[data-pause]', main).forEach((b) => (b.onclick = run(async () => { await api('POST', `/api/campaigns/${b.dataset.pause}/pause`); pageCampaigns(main); })));
  $$('[data-del]', main).forEach((b) => (b.onclick = run(async () => {
    if (!confirm('Excluir esta campanha?')) return;
    await api('DELETE', `/api/campaigns/${b.dataset.del}`);
    pageCampaigns(main);
  })));
  $$('[data-recs]', main).forEach((b) => (b.onclick = run(async () => {
    const recs = await api('GET', `/api/campaigns/${b.dataset.recs}/recipients`);
    modal(`<h2>Destinatários</h2><div class="table-wrap"><table><thead><tr><th>Contato</th><th>Status</th><th>Detalhe</th></tr></thead><tbody>
      ${recs.map((r) => `<tr><td>${esc(contactName(r))}<div class="small muted">${esc(formatPhone(r.phone))}</div></td><td>${r.status === 'pending' ? '<span class="status st-draft">Pendente</span>' : statusBadge(r.status)}</td><td class="small">${esc(r.error || (r.sent_at ? new Date(r.sent_at).toLocaleString('pt-BR') : ''))}</td></tr>`).join('')}
      </tbody></table></div><div class="foot"><button class="btn" data-close>Fechar</button></div>`);
  })));
}

function campaignModal(onSave) {
  modal(`
    <h2>Nova campanha</h2>
    <form id="f">
      <label>Nome da campanha</label><input type="text" name="name" required placeholder="Ex.: Lembrete DAS - novembro">
      <label>Mensagem</label>
      <textarea name="message" rows="6" required placeholder="{Olá|Oi}, {{primeiro_nome}}! Passando para lembrar que..."></textarea>
      <div class="small muted">Variáveis: <code>{{nome}}</code> <code>{{primeiro_nome}}</code> <code>{{empresa}}</code> <code>{{telefone}}</code> ·
        Variações aleatórias: <code>{Olá|Oi|Bom dia}</code> (deixa cada envio diferente e reduz o risco de bloqueio).</div>
      <label>Enviar para contatos com as etiquetas</label>
      <div class="checks">${S.tags.map((t) => `<label><input type="checkbox" name="tag" value="${t.id}"> ${tagChip(t)} <span class="small muted">${t.n}</span></label>`).join('') || '<span class="muted small">Crie etiquetas e marque os contatos na página Contatos.</span>'}</div>
      <div id="preview" class="card small hidden" style="margin-top:12px;white-space:pre-wrap"></div>
      <div class="foot">
        <button type="button" class="btn" id="prev">Pré-visualizar</button>
        <button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">Criar campanha</button>
      </div>
    </form>`, (m, close) => {
    $('#prev', m).onclick = run(async () => {
      const r = await api('POST', '/api/campaigns/preview', { message: $('[name=message]', m).value });
      const p = $('#preview', m);
      p.classList.remove('hidden');
      p.innerHTML = `<div class="muted" style="margin-bottom:6px">Exemplo para ${esc(r.contact || 'um contato')}:</div>${linkify(r.text)}`;
    });
    $('#f', m).onsubmit = run(async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const c = await api('POST', '/api/campaigns', { name: f.get('name'), message: f.get('message'), tag_ids: f.getAll('tag').map(Number) });
      close();
      toast(`Campanha criada com ${c.total} destinatário(s). Clique em Iniciar para começar.`);
      onSave();
    });
  });
}

// ---------- Respostas rápidas ----------
async function pageQuickReplies(main) {
  const list = await api('GET', '/api/quick-replies');
  S.quickReplies = list;
  main.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="grow"><h1>Respostas rápidas</h1><div class="sub">No atendimento, digite <b>/</b> + atalho para inserir. Aceita <code>{{primeiro_nome}}</code>.</div></div>
        <button class="btn primary" id="new-btn">+ Nova resposta</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Atalho</th><th>Mensagem</th><th></th></tr></thead><tbody>
        ${list.map((q) => `<tr><td><b>/${esc(q.shortcut)}</b></td><td style="white-space:pre-wrap">${esc(q.body)}</td><td><div class="actions"><button class="btn sm" data-edit="${q.id}">Editar</button><button class="btn sm danger" data-del="${q.id}">Excluir</button></div></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nenhuma resposta cadastrada.</td></tr>'}
      </tbody></table></div>
    </div>`;
  const edit = (q) => modal(`
    <h2>${q ? 'Editar' : 'Nova'} resposta rápida</h2>
    <form id="f"><label>Atalho</label><input type="text" name="shortcut" required value="${esc(q?.shortcut || '')}" placeholder="docs">
    <label>Mensagem</label><textarea name="body" rows="5" required placeholder="Olá, {{primeiro_nome}}! Para darmos andamento, precisamos dos seguintes documentos...">${esc(q?.body || '')}</textarea>
    <div class="foot"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div></form>`,
  (m, close) => {
    $('#f', m).onsubmit = run(async (e) => {
      e.preventDefault();
      await api(q ? 'PUT' : 'POST', q ? `/api/quick-replies/${q.id}` : '/api/quick-replies', Object.fromEntries(new FormData(e.target)));
      close();
      pageQuickReplies(main);
    });
  });
  $('#new-btn').onclick = () => edit(null);
  $$('[data-edit]').forEach((b) => (b.onclick = () => edit(list.find((q) => q.id === Number(b.dataset.edit)))));
  $$('[data-del]').forEach((b) => (b.onclick = run(async () => { await api('DELETE', `/api/quick-replies/${b.dataset.del}`); pageQuickReplies(main); })));
}

// ---------- Chatbot e horários ----------
async function pageBot(main) {
  const s = await api('GET', '/api/settings');
  const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const optRow = (o = {}) => `<div class="option-row">
    <input type="text" data-k="key" value="${esc(o.key || '')}" placeholder="Nº">
    <input type="text" data-k="label" value="${esc(o.label || '')}" placeholder="Texto da opção">
    <input type="text" data-k="queue" class="q" value="${esc(o.queue || '')}" placeholder="Setor / fila">
    <button type="button" class="btn sm danger" data-rm>✕</button>
    <textarea data-k="reply" placeholder="Resposta ao escolher esta opção">${esc(o.reply || '')}</textarea>
  </div>`;
  main.innerHTML = `
    <div class="page" style="max-width:860px">
      <div class="page-head"><div><h1>Chatbot e horários</h1><div class="sub">Respostas automáticas, menu de setores e horário de atendimento</div></div></div>

      <form class="card section" id="bot">
        <div class="row"><h3 class="grow" style="margin:0">🤖 Chatbot de triagem</h3><div class="checks"><label><input type="checkbox" name="enabled" ${s.bot.enabled ? 'checked' : ''}> Ativado</label></div></div>
        <p class="muted small">Quando um cliente inicia um novo atendimento, o bot envia a mensagem de boas-vindas com o menu. Ao escolher uma opção, a conversa vai para a <b>fila</b> do setor correspondente.</p>
        <label>Mensagem de boas-vindas</label><textarea name="welcome" rows="3">${esc(s.bot.welcome)}</textarea>
        <label>Opções do menu</label>
        <div id="opts">${s.bot.options.map(optRow).join('')}</div>
        <button type="button" class="btn sm" id="add-opt">+ Adicionar opção</button>
        <div class="grid2">
          <div><label>Resposta para opção inválida</label><textarea name="invalid" rows="2">${esc(s.bot.invalid)}</textarea></div>
          <div><label>Tentativas antes de transferir para atendente</label><input type="number" name="maxAttempts" min="1" max="10" value="${s.bot.maxAttempts}"></div>
        </div>
        <label>Mensagem de encerramento do atendimento</label><textarea name="closing" rows="2">${esc(s.bot.closing)}</textarea>
        <label>Mensagem fora do horário</label><textarea name="away" rows="2">${esc(s.bot.away)}</textarea>
        <p class="small muted">Variáveis disponíveis: <code>{{nome}}</code> <code>{{primeiro_nome}}</code> <code>{{empresa}}</code></p>
        <button class="btn primary" style="margin-top:10px">Salvar chatbot</button>
      </form>

      <form class="card section" id="hours">
        <h3 style="margin-top:0">🕘 Horário de atendimento</h3>
        <div class="checks">${DAYS.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${s.hours.days.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
        <div class="grid2"><div><label>Início</label><input type="time" name="start" value="${s.hours.start}"></div><div><label>Fim</label><input type="time" name="end" value="${s.hours.end}"></div></div>
        <button class="btn primary" style="margin-top:12px">Salvar horário</button>
      </form>

      <form class="card section" id="campaign">
        <h3 style="margin-top:0">📣 Segurança dos disparos</h3>
        <div class="grid2">
          <div><label>Intervalo mínimo entre envios (segundos)</label><input type="number" name="minDelay" min="5" value="${s.campaign.minDelay}"></div>
          <div><label>Intervalo máximo (segundos)</label><input type="number" name="maxDelay" min="5" value="${s.campaign.maxDelay}"></div>
        </div>
        <label>Limite de envios por dia</label><input type="number" name="dailyLimit" min="1" value="${s.campaign.dailyLimit}">
        <p class="small muted">Números novos devem começar com limites baixos (30–50/dia) e aumentar aos poucos.</p>
        <button class="btn primary">Salvar</button>
      </form>
    </div>`;

  const bindRm = () => $$('[data-rm]').forEach((b) => (b.onclick = () => b.closest('.option-row').remove()));
  bindRm();
  $('#add-opt').onclick = () => { $('#opts').insertAdjacentHTML('beforeend', optRow({ key: String($$('.option-row').length + 1) })); bindRm(); };

  $('#bot').onsubmit = run(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const options = $$('.option-row').map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.value.trim()]))).filter((o) => o.key && o.label);
    await api('PUT', '/api/settings/bot', {
      enabled: f.has('enabled'), welcome: f.get('welcome'), options, invalid: f.get('invalid'),
      maxAttempts: Number(f.get('maxAttempts')) || 2, closing: f.get('closing'), away: f.get('away')
    });
    toast('Chatbot salvo');
  });
  $('#hours').onsubmit = run(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api('PUT', '/api/settings/hours', { days: f.getAll('day').map(Number), start: f.get('start'), end: f.get('end'), timezone: s.hours.timezone });
    toast('Horário salvo');
  });
  $('#campaign').onsubmit = run(async (e) => {
    e.preventDefault();
    const f = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, Number(v)]));
    if (f.maxDelay < f.minDelay) return toast('O intervalo máximo deve ser maior que o mínimo', true);
    await api('PUT', '/api/settings/campaign', f);
    toast('Configurações de disparo salvas');
  });
}

// ---------- Usuários ----------
async function pageUsers(main) {
  const list = await api('GET', '/api/users');
  main.innerHTML = `
    <div class="page">
      <div class="page-head"><div class="grow"><h1>Usuários</h1><div class="sub">Atendentes e administradores da plataforma</div></div><button class="btn primary" id="new-btn">+ Novo usuário</button></div>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? 'Administrador' : 'Atendente'}</td><td>${u.active ? 'Ativo' : '<span class="muted">Inativo</span>'}</td><td><div class="actions"><button class="btn sm" data-edit="${u.id}">Editar</button></div></td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  const edit = (u) => modal(`
    <h2>${u ? 'Editar' : 'Novo'} usuário</h2>
    <form id="f">
      <label>Nome</label><input type="text" name="name" required value="${esc(u?.name || '')}">
      <label>E-mail</label><input type="email" name="email" required value="${esc(u?.email || '')}">
      <label>${u ? 'Nova senha (deixe em branco para manter)' : 'Senha'}</label><input type="password" name="password" ${u ? '' : 'required'} minlength="6" autocomplete="new-password">
      <label>Perfil</label><select name="role"><option value="agent">Atendente</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador</option></select>
      ${u ? `<div class="checks" style="margin-top:10px"><label><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Ativo</label></div>` : ''}
      <div class="foot"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`, (m, close) => {
    $('#f', m).onsubmit = run(async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (u) f.active = 'active' in f;
      await api(u ? 'PUT' : 'POST', u ? `/api/users/${u.id}` : '/api/users', f);
      close();
      pageUsers(main);
    });
  });
  $('#new-btn').onclick = () => edit(null);
  $$('[data-edit]').forEach((b) => (b.onclick = () => edit(list.find((u) => u.id === Number(b.dataset.edit)))));
}

// ---------- Conexão ----------
function pageConnection(main) {
  const w = S.wa;
  main.innerHTML = `
    <div class="page" style="max-width:720px">
      <div class="page-head"><div><h1>Conexão com o WhatsApp</h1><div class="sub">Vincule o número do escritório lendo o QR Code</div></div></div>
      <div class="card">
        ${w.state === 'connected' ? `
          <div class="row"><span class="dot on"></span><b class="grow">Conectado</b></div>
          <p>Número: <b>${esc(formatPhone((w.me?.id || '').split(/[:@]/)[0]))}</b> ${w.me?.name ? '· ' + esc(w.me.name) : ''}</p>
          ${isAdmin() ? '<button class="btn danger" id="logout-wa">Desconectar número</button>' : ''}`
        : w.state === 'qr' ? `
          <div class="qrbox"><img src="${w.qr}" alt="QR Code"></div>
          <ol><li>Abra o WhatsApp (ou WhatsApp Business) no celular do escritório</li><li>Toque em <b>⋮ Mais opções</b> ou <b>Configurações</b> › <b>Dispositivos conectados</b></li><li>Toque em <b>Conectar um dispositivo</b> e aponte para este código</li></ol>`
        : w.state === 'connecting' ? '<p><span class="dot wait" style="display:inline-block"></span> Conectando... aguarde.</p>'
        : `<p>Nenhum número conectado.</p>${isAdmin() ? '<button class="btn primary" id="connect">Gerar QR Code</button>' : '<p class="muted">Peça a um administrador para conectar.</p>'}`}
      </div>
      <div class="alert" style="margin-top:16px">Esta conexão funciona como o WhatsApp Web e <b>não é a API oficial</b>. Mantenha o celular com internet,
        prefira um número de <b>WhatsApp Business</b> já usado há algum tempo e evite disparos em massa para quem não conhece seu número.</div>
    </div>`;
  $('#connect') && ($('#connect').onclick = run(async () => { S.wa = await api('POST', '/api/whatsapp/connect'); pageConnection(main); }));
  $('#logout-wa') && ($('#logout-wa').onclick = run(async () => {
    if (!confirm('Desconectar o WhatsApp desta plataforma?')) return;
    S.wa = await api('POST', '/api/whatsapp/logout');
    pageConnection(main);
  }));
  current.onEvent = (evt) => evt === 'wa:status' && pageConnection(main);
}

// ---------- Inicialização ----------
async function boot() {
  try { S.me = await api('GET', '/api/me'); } catch { return showAuth(); }
  [S.tags, S.wa] = await Promise.all([api('GET', '/api/tags'), api('GET', '/api/whatsapp/status')]);
  renderShell();
  window.onhashchange = router;
  router();
  updateQueueBadge();

  const socket = io();
  const relay = (evt) => socket.on(evt, (data) => {
    if (evt === 'wa:status') { S.wa = data; renderWaPill(); }
    if (evt === 'conversation') updateQueueBadge();
    if (evt === 'message' && !data.from_me && !(current?.name === 'atendimento' && inbox.activeId === data.conversation_id && document.hasFocus())) notify();
    current?.onEvent?.(evt, data);
  });
  ['message', 'message:status', 'conversation', 'campaign', 'wa:status'].forEach(relay);
}

// Bipe curto ao chegar mensagem de cliente
let audioCtx;
function notify() {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.12);
  } catch {}
}

boot();
