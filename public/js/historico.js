const $ = (id) => document.getElementById(id);
let sales = [];
let cashSessions = [];
let currentTab = 'sales';
let cancelId = null;

const STATUS_BADGE = (s) => {
  if (s.status === 'cancelled') return '<span class="badge badge-cancel">CANCELADA</span>';
  if (s.payment_method === 'pendente') return '<span class="badge badge-low">A RECEBER</span>';
  return '<span class="badge badge-ok">PAGA</span>';
};

async function load() {
  try {
    if (!$('date').value) $('date').value = todayISO();
    [sales, cashSessions] = await Promise.all([
      api(`/api/sales?date=${encodeURIComponent($('date').value)}`),
      api('/api/cash/sessions'),
    ]);
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function render() {
  const paid = sales.filter((s) => s.status === 'active' && s.payment_method !== 'pendente');
  const total = paid.reduce((sum, s) => sum + s.final_amount, 0);
  $('h-count').textContent = paid.length;
  $('h-total').textContent = formatMoney(total);
  $('h-avg').textContent = formatMoney(paid.length ? total / paid.length : 0);
  $('h-cancel').textContent = sales.filter((s) => s.status === 'cancelled').length;
  $('foot-total').textContent = formatMoney(total);

  const isSales = currentTab === 'sales';
  $('sales-stats').classList.toggle('hidden', !isSales);
  $('table-foot').classList.toggle('hidden', !isSales);
  $('tab-sales').className = `btn ${isSales ? 'btn-primary' : 'btn-ghost'}`;
  $('tab-cash').className = `btn ${isSales ? 'btn-ghost' : 'btn-primary'}`;
  $('tab-sales').style.flex = $('tab-cash').style.flex = '1';
  if (isSales) renderSalesTable(); else renderCashTable();
}

function renderSalesTable() {
  $('table-header').innerHTML = `<tr>
      <th>Horário</th><th>Nº</th><th>Origem</th><th>Itens</th><th>Pagamento</th><th>Total</th><th>Status</th>
      <th style="text-align:right">Ações</th></tr>`;

  $('tbody').innerHTML = sales.length ? sales.map((s) => {
    const cancelled = s.status === 'cancelled';
    const origin = s.origin === 'mesa'
      ? `📌 ${escapeHtml(s.table_label || 'Mesa')} <span class="text-xs opacity-60">• ${escapeHtml(s.staff_name || '')}</span>`
      : '🛒 Balcão';
    const pay = s.payment_method === 'pendente' ? '—' : `${PAYMENT_ICONS[s.payment_method] || ''} ${escapeHtml(PAYMENT_LABELS[s.payment_method] || s.payment_method)}`;
    return `<tr class="${cancelled ? 'cancelled' : ''}">
      <td>${formatTime(s.created_at)}</td>
      <td class="font-bold">#${s.id}</td>
      <td>${origin}</td>
      <td>${s.items_count} item(ns)</td>
      <td>${pay}</td>
      <td class="font-bold">${formatMoney(s.final_amount)}</td>
      <td class="no-strike">${STATUS_BADGE(s)}</td>
      <td class="no-strike" style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-details="${s.id}">DETALHES</button>
        ${cancelled ? '' : `<button class="btn btn-danger btn-sm" data-cancel="${s.id}">CANCELAR</button>`}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📭</div>Nenhuma venda neste dia.</div></td></tr>';
}

function renderCashTable() {
  $('table-header').innerHTML = `<tr>
      <th>Abertura</th><th>Fechamento</th><th>Fundo inicial</th><th>Total recebido</th>
      <th>Esperado (dinheiro)</th><th>Contado</th><th>Diferença</th><th style="text-align:right">Status</th></tr>`;

  $('tbody').innerHTML = cashSessions.length ? cashSessions.map((cs) => {
    const isOpen = cs.status === 'open';
    const hasCount = cs.closing_counted !== null && cs.closing_counted !== undefined;
    const diff = hasCount ? Math.round((cs.closing_counted - cs.closing_expected) * 100) / 100 : 0;
    return `<tr>
      <td>${formatDateTime(cs.opened_at)}</td>
      <td>${cs.closed_at ? formatDateTime(cs.closed_at) : 'Em aberto'}</td>
      <td>${formatMoney(cs.opening_balance)}</td>
      <td class="font-bold">${formatMoney(cs.total_sales)} <span class="text-xs opacity-60">(${cs.sales_count})</span></td>
      <td>${hasCount ? formatMoney(cs.closing_expected) : '-'}</td>
      <td>${hasCount ? formatMoney(cs.closing_counted) : '-'}</td>
      <td style="color:${diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--accent)' : 'inherit'}">${hasCount ? formatMoney(diff) : '-'}</td>
      <td style="text-align:right">${isOpen ? '<span class="badge badge-ok">ABERTO</span>' : '<span class="badge badge-low">FECHADO</span>'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">💰</div>Nenhum caixa registrado.</div></td></tr>';
}

async function showDetails(id) {
  try {
    const s = await api(`/api/sales/${id}`);
    $('d-title').innerHTML = `Venda #${s.id} ${STATUS_BADGE(s)}`;
    const parts = [formatDateTime(s.created_at)];
    if (s.origin === 'mesa') parts.push(`${s.table_label}${s.people ? ` (${s.people} pessoa(s))` : ''}`, `Atendente: ${s.staff_name}`);
    if (s.payment_method !== 'pendente') parts.push(PAYMENT_LABELS[s.payment_method] || s.payment_method);
    if (s.paid_by) parts.push(`Recebido por: ${s.paid_by}`);
    if (s.cancelled_by) parts.push(`Cancelada por ${s.cancelled_by} às ${formatTime(s.cancelled_at)}`);
    $('d-meta').textContent = parts.join(' • ');
    $('d-items').innerHTML = s.items.map((i) => `<tr>
      <td>${escapeHtml(i.product_name)}${i.notes ? `<div class="text-xs opacity-70">📝 ${escapeHtml(i.notes)}</div>` : ''}</td>
      <td>${i.quantity}</td><td>${formatMoney(i.unit_price)}</td>
      <td style="text-align:right" class="font-bold">${formatMoney(i.total_price)}</td></tr>`).join('');
    let totals = '';
    if (s.discount) totals += `<div class="opacity-75">Subtotal ${formatMoney(s.total)} • Desconto −${formatMoney(s.discount)}</div>`;
    totals += `<div class="text-2xl font-extrabold">Total: ${formatMoney(s.final_amount)}</div>`;
    if (s.payment_method === 'dinheiro' && s.change_given) totals += `<div class="opacity-75">Recebido ${formatMoney(s.amount_paid)} • Troco ${formatMoney(s.change_given)}</div>`;
    $('d-totals').innerHTML = totals;
    openModal('modal-details');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function askCancel(id) {
  const s = sales.find((x) => x.id === id);
  if (!s) return;
  cancelId = id;
  $('c-id').textContent = `#${id}`;
  $('c-total').textContent = formatMoney(s.final_amount);
  openModal('modal-cancel');
}

$('btn-confirm-cancel').addEventListener('click', async () => {
  await withLoading($('btn-confirm-cancel'), async () => {
    try {
      await api(`/api/sales/${cancelId}/cancel`, { method: 'POST' });
      closeModal('modal-cancel');
      toast(`Venda #${cancelId} cancelada e estoque devolvido.`, 'success');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
});

document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-details]');
  if (d) return showDetails(Number(d.dataset.details));
  const c = e.target.closest('[data-cancel]');
  if (c) askCancel(Number(c.dataset.cancel));
});

$('tab-sales').addEventListener('click', () => { currentTab = 'sales'; render(); });
$('tab-cash').addEventListener('click', () => { currentTab = 'cash'; render(); });
$('date').addEventListener('change', load);
$('btn-today').addEventListener('click', () => { $('date').value = todayISO(); load(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
});

startAdminPage('historico', load);
