/* Utilitários compartilhados por todas as páginas do DUKAFE PDV */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoney = (v) => BRL.format(Number(v) || 0);

const PAYMENT_LABELS = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' };
const PAYMENT_ICONS = { dinheiro: '💵', pix: '📱', debito: '💳', credito: '💳' };

/** Converte qualquer formato de data em Date local válido */
function parseDate(str) {
  if (!str) return null;
  // Se vier no formato ISO do JS (ex: 2026-10-24T17:00:00.000Z)
  const dIso = new Date(str);
  if (!isNaN(dIso.getTime()) && str.includes('T')) {
    return dIso;
  }
  // Formato manual "YYYY-MM-DD HH:MM:SS"
  const [d, t = '00:00:00'] = str.split(' ');
  const partsD = d.split('-').map(Number);
  if (partsD.length !== 3) return null;
  const [y, m, day] = partsD;
  const [h, mi, s] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h || 0, mi || 0, s || 0);
}

const pad = (n) => String(n).padStart(2, '0');

function formatDateTime(str) {
  const d = parseDate(str);
  if (!d || isNaN(d.getTime())) return '-';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(str) {
  const d = parseDate(str);
  if (!d || isNaN(d.getTime())) return '-';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Aceita "12,50" ou "12.50" */
function parseMoney(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').trim().replace(/\s/g, '').replace('R$', '');
  if (!s) return NaN;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return Number(normalized);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Requisições à API com mensagens amigáveis */
async function api(url, options = {}) {
  const opts = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error('Não foi possível conectar ao sistema. Verifique se o servidor está em execução.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw new Error((data && data.error) || 'Não foi possível concluir a operação.');
  return data;
}

/** Notificações toast */
function toast(message, type = 'success', duration = 3200) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '⚠️', info: 'ℹ️', warning: '🔔' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 260);
  }, duration);
}

/** Estado de carregamento em botões */
async function withLoading(btn, fn) {
  if (!btn) return fn();
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

/** Modais */
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('open');
  const first = m.querySelector('[data-autofocus]') || m.querySelector('input:not([type=hidden]), select');
  if (first) setTimeout(() => first.focus(), 60);
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

function anyModalOpen() {
  return document.querySelector('.modal-backdrop.open');
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-backdrop') && !e.target.dataset.static) {
    e.target.classList.remove('open');
  }
  const closer = e.target.closest && e.target.closest('[data-close-modal]');
  if (closer) closer.closest('.modal-backdrop').classList.remove('open');
});

/** Barra lateral de navegação */
function renderSidebar(active) {
  const links = [
    { key: 'pdv', href: '/index.html', icon: '🛒', label: 'PDV' },
    { key: 'estoque', href: '/estoque.html', icon: '📦', label: 'Estoque' },
    { key: 'caixa', href: '/caixa.html', icon: '💰', label: 'Caixa' },
    { key: 'historico', href: '/historico.html', icon: '🧾', label: 'Histórico' },
  ];
  const aside = document.createElement('aside');
  aside.className = 'sidebar';
  aside.innerHTML = `
    <div class="sidebar-logo">☕</div>
    <div class="sidebar-brand">DUKAFE</div>
    ${links.map((l) => `
      <a href="${l.href}" class="nav-link ${l.key === active ? 'active' : ''}">
        <span class="nav-icon">${l.icon}</span><span>${l.label}</span>
      </a>`).join('')}
    <div class="sidebar-status" id="sidebar-status">
      <div><span class="status-dot closed"></span></div><div>...</div>
    </div>
    <div class="sidebar-status" style="margin-top:10px" id="sidebar-clock"></div>`;
  document.body.prepend(aside);
  updateSidebarStatus();
  const clock = () => {
    const d = new Date();
    document.getElementById('sidebar-clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  clock();
  setInterval(clock, 15000);
}

async function updateSidebarStatus() {
  const el = document.getElementById('sidebar-status');
  if (!el) return null;
  try {
    const data = await api('/api/cash/status');
    const isOpen = data && data.open;
    el.innerHTML = isOpen
      ? '<div><span class="status-dot open"></span></div><div>Caixa<br>aberto</div>'
      : '<div><span class="status-dot closed"></span></div><div>Caixa<br>fechado</div>';
    return isOpen ? data.session : null;
  } catch (e) {
    el.innerHTML = '<div><span class="status-dot closed"></span></div><div>Offline</div>';
    return null;
  }
}