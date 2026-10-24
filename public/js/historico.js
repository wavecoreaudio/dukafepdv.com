renderSidebar('historico');

const $ = (id) => document.getElementById(id);
let sales = [];
let cancelId = null;

async function load() {
  try {
    sales = await api(`/api/sales?date=${$('date').value}`);
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function render() {
  const active = sales.filter((s) => s.status === 'active');
  const total = active.reduce((sum, s) => sum + s.total, 0);
  $('h-count').textContent = active.length;
  $('h-total').textContent = formatMoney(total);
  $('h-avg').textContent = formatMoney(active.length ? total / active.length : 0);
  $('h-cancel').textContent = sales.length - active.length;
  $('foot-total').textContent = formatMoney(total);

  $('tbody').innerHTML = sales.length ? sales.map((s) => {
    const cancelled = s.status === 'cancelled';
    return `<tr class="${cancelled ? 'cancelled' : ''}">
      <td>${formatTime(s.created_at)}</td>
      <td class="font-bold">#${s.id}</td>
      <td>${s.items_count}</td>
      <td>${PAYMENT_ICONS[s.payment_method] || ''} ${PAYMENT_LABELS[s.payment_method] || s.payment_method}</td>
      <td class="font-bold">${formatMoney(s.total)}</td>
      <td class="no-strike">${cancelled ? '<span class="badge badge-cancel">CANCELADA</span>' : '<span class="badge badge-ok">CONCLUÍDA</span>'}</td>
      <td class="no-strike" style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-details="${s.id}">VER DETALHES</button>
        ${cancelled ? '' : `<button class="btn btn-danger btn-sm" data-cancel="${s.id}">CANCELAR VENDA</button>`}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📭</div>Nenhuma venda nesta data.</div></td></tr>';
}

async function showDetails(id) {
  try {
    const s = await api(`/api/sales/${id}`);
    $('d-title').innerHTML = `Venda #${s.id} ${s.status === 'cancelled' ? '<span class="badge badge-cancel ml-2">CANCELADA</span>' : ''}`;
    $('d-meta').textContent = `${formatDateTime(s.created_at)} • ${PAYMENT_LABELS[s.payment_method] || s.payment_method}`;
    $('d-items').innerHTML = s.items.map((i) => `<tr>
      <td>${escapeHtml(i.product_name)}</td><td>${i.quantity}</td><td>${formatMoney(i.unit_price)}</td>
      <td style="text-align:right" class="font-bold">${formatMoney(i.unit_price * i.quantity)}</td></tr>`).join('');
    let totals = `<div class="text-2xl font-extrabold">Total: ${formatMoney(s.total)}</div>`;
    if (s.payment_method === 'dinheiro') {
      totals += `<div class="text-sm opacity-80 mt-1">Recebido: ${formatMoney(s.amount_paid)} • Troco: ${formatMoney(s.change_given)}</div>`;
    }
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
  $('c-total').textContent = formatMoney(s.total);
  openModal('modal-cancel');
}

$('btn-confirm-cancel').addEventListener('click', async () => {
  await withLoading($('btn-confirm-cancel'), async () => {
    try {
      await api(`/api/sales/${cancelId}/cancel`, { method: 'POST' });
      closeModal('modal-cancel');
      toast(`Venda #${cancelId} cancelada e estoque estornado.`, 'success');
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
$('date').addEventListener('change', load);
$('btn-today').addEventListener('click', () => { $('date').value = todayISO(); load(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
});

$('date').value = todayISO();
load();
