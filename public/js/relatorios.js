const $ = (id) => document.getElementById(id);
let report = null;

const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const brDay = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%`.replace('.', ',') : '-');

function setRange(kind) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  let from = new Date(t), to = new Date(t);
  if (kind === 'yesterday') { from.setDate(t.getDate() - 1); to = new Date(from); }
  else if (kind === '7') from.setDate(t.getDate() - 6);
  else if (kind === '30') from.setDate(t.getDate() - 29);
  else if (kind === 'month') from = new Date(t.getFullYear(), t.getMonth(), 1);
  else if (kind === 'lastmonth') { from = new Date(t.getFullYear(), t.getMonth() - 1, 1); to = new Date(t.getFullYear(), t.getMonth(), 0); }
  $('from').value = isoDay(from);
  $('to').value = isoDay(to);
  document.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('active', b.dataset.range === kind));
  load();
}

async function load() {
  try {
    report = await api(`/api/reports?from=${$('from').value}&to=${$('to').value}`);
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- Tooltip ----------
const tip = $('tip');
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tip.classList.add('hidden'); return; }
  tip.innerHTML = el.dataset.tip;
  tip.classList.remove('hidden');
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY + 14}px`;
});

/** Barras verticais de uma série (hover mostra valores). */
function columnChart(points, labelEvery = 1) {
  const max = Math.max(...points.map((p) => p.value), 0);
  if (!max) return '<div class="empty-state">Sem vendas no período.</div>';
  return `
    <div class="bars">${points.map((p) => `
      <div class="bar-col" data-tip="<strong>${escapeHtml(p.tipTitle)}</strong><br>${formatMoney(p.value)} • ${p.count} venda(s)">
        <div class="bar" style="height:${(p.value / max) * 100}%"></div>
      </div>`).join('')}
    </div>
    <div class="bar-labels">${points.map((p, i) => `<span>${i % labelEvery === 0 ? escapeHtml(p.label) : ''}</span>`).join('')}</div>
    <div class="text-xs opacity-60 mt-2">Maior: ${formatMoney(max)}</div>`;
}

function render() {
  const r = report, t = r.totals;
  $('period-label').textContent = r.from === r.to ? `Vendas pagas em ${brDay(r.from)}.` : `Vendas pagas de ${brDay(r.from)} a ${brDay(r.to)}.`;

  $('k-revenue').textContent = formatMoney(t.revenue);
  $('k-revenue-sub').textContent = t.discounts ? `bruto ${formatMoney(t.gross)}` : `${t.count} venda(s)`;
  $('k-ticket').textContent = formatMoney(t.ticket);
  $('k-count').textContent = `${t.count} venda(s) paga(s)`;
  $('k-profit').textContent = formatMoney(t.profit);
  $('k-profit-sub').textContent = `margem ${pct(t.profit, t.revenue)}`;
  $('k-cost').textContent = formatMoney(t.cost);
  $('k-disc').textContent = formatMoney(t.discounts);
  $('k-cancel').textContent = t.cancelled_count;
  $('k-cancel-sub').textContent = formatMoney(t.cancelled_total);
  $('k-pending').textContent = formatMoney(t.pending_total);
  $('k-pending-sub').textContent = `${t.pending_count} comanda(s)`;
  $('k-loss').textContent = formatMoney(t.losses_value);
  $('k-loss-sub').textContent = `${t.losses_count} registro(s)`;

  // Por dia (preenche dias sem venda com zero)
  const days = [];
  const map = Object.fromEntries(r.by_day.map((d) => [d.day, d]));
  const [fy, fm, fd] = r.from.split('-').map(Number);
  const end = r.to;
  for (let d = new Date(fy, fm - 1, fd); isoDay(d) <= end; d.setDate(d.getDate() + 1)) {
    const k = isoDay(d); const v = map[k] || { revenue: 0, count: 0 };
    days.push({ label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, tipTitle: brDay(k), value: v.revenue, count: v.count });
  }
  $('chart-day-title').textContent = days.length === 1 ? 'Faturamento do dia' : 'Faturamento por dia';
  $('chart-day').innerHTML = days.length === 1
    ? `<div class="text-4xl font-extrabold mt-6">${formatMoney(days[0].value)}</div><div class="opacity-70 mt-1">${days[0].count} venda(s) — escolha um período maior para ver o gráfico por dia.</div>`
    : columnChart(days, Math.ceil(days.length / 10));

  // Por hora (só o intervalo com movimento, mínimo 7h–22h)
  const used = r.by_hour.filter((h) => h.count);
  const h0 = Math.min(7, ...used.map((h) => h.hour)), h1 = Math.max(22, ...used.map((h) => h.hour));
  $('chart-hour').innerHTML = columnChart(r.by_hour.slice(h0, h1 + 1).map((h) => ({
    label: `${h.hour}h`, tipTitle: `${h.hour}:00 – ${h.hour}:59`, value: h.revenue, count: h.count,
  })), 2);

  // Formas de pagamento (barras horizontais, rótulo + valor em texto)
  const maxM = Math.max(...r.by_method.map((m) => m.revenue), 0);
  $('methods').innerHTML = r.by_method.length ? r.by_method.map((m) => `
    <div class="hbar-row" data-tip="<strong>${escapeHtml(PAYMENT_LABELS[m.method] || m.method)}</strong><br>${m.count} venda(s)">
      <span>${PAYMENT_ICONS[m.method] || ''} ${escapeHtml(PAYMENT_LABELS[m.method] || m.method)}</span>
      <div class="hbar-track"><div class="hbar" style="width:${(m.revenue / maxM) * 100}%"></div></div>
      <span class="num font-bold">${formatMoney(m.revenue)} <span class="text-xs opacity-60">${pct(m.revenue, t.revenue)}</span></span>
    </div>`).join('') : '<div class="empty-state">Sem vendas no período.</div>';

  $('staff').innerHTML = r.by_staff.length ? r.by_staff.map((s) => `<tr>
      <td class="font-bold">${escapeHtml(s.name)}</td><td class="num">${s.mesa}</td><td class="num">${s.balcao}</td>
      <td class="num font-bold">${formatMoney(s.revenue)}</td></tr>`).join('')
    : '<tr><td colspan="4"><div class="empty-state">Sem vendas.</div></td></tr>';

  $('products').innerHTML = r.by_product.length ? r.by_product.map((p) => {
    const profit = Math.round((p.revenue - p.cost) * 100) / 100;
    return `<tr>
      <td class="font-bold">${escapeHtml(p.name)}</td><td class="opacity-80">${escapeHtml(p.category)}</td>
      <td class="num">${p.quantity}</td><td class="num font-bold">${formatMoney(p.revenue)}</td>
      <td class="num opacity-80">${formatMoney(p.cost)}</td><td class="num">${formatMoney(profit)}</td>
      <td class="num">${pct(profit, p.revenue)}</td></tr>`;
  }).join('') : '<tr><td colspan="7"><div class="empty-state">Nenhum produto vendido no período.</div></td></tr>';

  $('losses').innerHTML = r.losses.length ? r.losses.map((l) => `<tr>
      <td>${formatDateTime(l.created_at)}</td><td class="font-bold">${escapeHtml(l.product_name || '')}</td>
      <td class="num">${Math.abs(l.quantity)}</td><td class="num">${formatMoney(l.value)}</td>
      <td class="opacity-85">${escapeHtml(l.reason || '')}</td><td class="opacity-70">${escapeHtml(l.staff_name || '')}</td></tr>`).join('')
    : '<tr><td colspan="6"><div class="empty-state">Nenhuma perda registrada. 👍</div></td></tr>';
}

// ---------- Exportar CSV (abre no Excel) ----------
function exportCSV() {
  if (!report) return;
  const r = report;
  const n = (v) => String(v).replace('.', ',');
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [
    `Relatório DUKAFE;${brDay(r.from)} a ${brDay(r.to)}`, '',
    'Resumo', `Faturamento;${n(r.totals.revenue)}`, `Vendas;${r.totals.count}`, `Ticket médio;${n(r.totals.ticket)}`,
    `Custo (CMV);${n(r.totals.cost)}`, `Lucro bruto;${n(r.totals.profit)}`, `Descontos;${n(r.totals.discounts)}`,
    `Canceladas;${r.totals.cancelled_count};${n(r.totals.cancelled_total)}`, `Perdas;${r.totals.losses_count};${n(r.totals.losses_value)}`, '',
    'Por dia', 'Data;Vendas;Faturamento', ...r.by_day.map((d) => `${brDay(d.day)};${d.count};${n(d.revenue)}`), '',
    'Por forma de pagamento', 'Forma;Vendas;Faturamento', ...r.by_method.map((m) => `${PAYMENT_LABELS[m.method] || m.method};${m.count};${n(m.revenue)}`), '',
    'Produtos', 'Produto;Categoria;Quantidade;Faturamento;Custo;Lucro',
    ...r.by_product.map((p) => `${q(p.name)};${q(p.category)};${p.quantity};${n(p.revenue)};${n(p.cost)};${n(Math.round((p.revenue - p.cost) * 100) / 100)}`), '',
    'Perdas', 'Data;Produto;Quantidade;Valor;Motivo',
    ...r.losses.map((l) => `${formatDateTime(l.created_at)};${q(l.product_name)};${Math.abs(l.quantity)};${n(l.value)};${q(l.reason)}`),
  ];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `relatorio-dukafe_${r.from}_a_${r.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-range]');
  if (b) setRange(b.dataset.range);
});
['from', 'to'].forEach((id) => $(id).addEventListener('change', () => {
  document.querySelectorAll('[data-range]').forEach((b) => b.classList.remove('active'));
  load();
}));
$('btn-csv').addEventListener('click', exportCSV);
$('btn-print').addEventListener('click', () => window.print());

startAdminPage('relatorios', () => setRange('today'));
