renderSidebar('caixa');

const $ = (id) => document.getElementById(id);
let summary = null;

const TYPE_LABELS = {
  abertura: ['🔓 Abertura', 'badge-ok'],
  venda: ['🛒 Venda', 'badge-ok'],
  sangria: ['➖ Sangria', 'badge-low'],
  suprimento: ['➕ Suprimento', 'badge-ok'],
  estorno: ['↩️ Estorno', 'badge-cancel'],
  fechamento: ['🔒 Fechamento', 'badge-low'],
};

async function load() {
  try {
    summary = await api('/api/cash/summary');
    updateSidebarStatus();
    const open = !!summary.session;
    $('closed-view').classList.toggle('hidden', open);
    $('open-view').classList.toggle('hidden', !open);
    if (open) render();
    else setTimeout(() => $('opening').focus(), 50);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function render() {
  const s = summary;
  $('opened-at').textContent = formatDateTime(s.session.opened_at);
  $('opening-balance').textContent = formatMoney(s.session.opening_balance);
  ['dinheiro', 'pix', 'debito', 'credito'].forEach((m) => {
    $(`s-${m}`).textContent = formatMoney(s.sales_by_method[m]);
    $(`c-${m}`).textContent = `${s.sales_count_by_method[m]} venda(s)`;
  });
  $('s-total').textContent = formatMoney(s.total_sales);
  $('c-total').textContent = `${s.sales_count} venda(s)` + (s.cancelled_count ? ` • ${s.cancelled_count} cancelada(s)` : '');
  $('s-sangrias').textContent = formatMoney(s.sangrias);
  $('s-suprimentos').textContent = formatMoney(s.suprimentos);
  $('s-expected').textContent = formatMoney(s.expected_cash);

  $('movements').innerHTML = s.movements.length ? s.movements.map((m) => {
    const [label, cls] = TYPE_LABELS[m.type] || [m.type, 'badge-ok'];
    const sign = m.type === 'sangria' || m.type === 'estorno' ? '− ' : '';
    return `<tr>
      <td>${formatTime(m.created_at)}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td class="opacity-85">${escapeHtml(m.description || '')}</td>
      <td style="text-align:right" class="font-bold">${sign}${formatMoney(m.amount)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4"><div class="empty-state">Nenhuma movimentação.</div></td></tr>';
}

$('btn-open').addEventListener('click', async () => {
  const raw = $('opening').value.trim();
  const value = raw ? parseMoney(raw) : 0;
  if (Number.isNaN(value) || value < 0) return toast('Informe um valor de fundo de caixa válido.', 'warning');
  await withLoading($('btn-open'), async () => {
    try {
      await api('/api/cash/open', { method: 'POST', body: { opening_balance: value } });
      toast('Caixa aberto! Boas vendas ☕', 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
  });
});
$('opening').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-open').click(); });

function openMovement(type) {
  $('m-type').value = type;
  $('movement-title').textContent = type === 'sangria' ? '➖ Sangria (retirada)' : '➕ Suprimento (entrada)';
  $('m-amount').value = '';
  $('m-desc').value = '';
  openModal('modal-movement');
}
$('btn-sangria').addEventListener('click', () => openMovement('sangria'));
$('btn-suprimento').addEventListener('click', () => openMovement('suprimento'));

$('movement-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseMoney($('m-amount').value);
  if (!(amount > 0)) return toast('Informe um valor maior que zero.', 'warning');
  const type = $('m-type').value;
  await withLoading($('btn-movement'), async () => {
    try {
      await api('/api/cash/movement', { method: 'POST', body: { type, amount, description: $('m-desc').value } });
      closeModal('modal-movement');
      toast(type === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.', 'success');
      await load();
    } catch (err) { toast(err.message, 'error'); }
  });
});

function updateDiff() {
  const raw = $('f-counted').value.trim();
  const counted = parseMoney(raw);
  const el = $('f-diff');
  if (!raw || Number.isNaN(counted)) { el.textContent = '-'; el.style.color = ''; return; }
  const diff = Math.round((counted - summary.expected_cash) * 100) / 100;
  el.textContent = (diff > 0 ? '+' : '') + formatMoney(diff) + (diff === 0 ? ' ✔' : diff > 0 ? ' (sobra)' : ' (falta)');
  el.style.color = diff === 0 ? 'var(--success)' : diff > 0 ? 'var(--accent)' : 'var(--danger)';
}

$('btn-close').addEventListener('click', async () => {
  await load();
  if (!summary || !summary.session) return;
  const s = summary;
  $('f-opening').textContent = formatMoney(s.session.opening_balance);
  $('f-cash').textContent = formatMoney(s.sales_by_method.dinheiro);
  $('f-sup').textContent = formatMoney(s.suprimentos);
  $('f-san').textContent = formatMoney(s.sangrias);
  $('f-expected').textContent = formatMoney(s.expected_cash);
  $('f-pix').textContent = formatMoney(s.sales_by_method.pix);
  $('f-deb').textContent = formatMoney(s.sales_by_method.debito);
  $('f-cre').textContent = formatMoney(s.sales_by_method.credito);
  $('f-total').textContent = formatMoney(s.total_sales);
  $('f-counted').value = '';
  updateDiff();
  openModal('modal-close');
});
$('f-counted').addEventListener('input', updateDiff);

$('close-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = $('f-counted').value.trim();
  const counted = raw ? parseMoney(raw) : null;
  if (counted !== null && (Number.isNaN(counted) || counted < 0)) return toast('Valor contado inválido.', 'warning');
  if (!confirm('Confirmar o fechamento do caixa? Esta ação não pode ser desfeita.')) return;
  await withLoading($('btn-confirm-close'), async () => {
    try {
      const r = await api('/api/cash/close', { method: 'POST', body: { counted_amount: counted } });
      closeModal('modal-close');
      const diffMsg = r.difference === null ? '' : ` Diferença: ${formatMoney(r.difference)}.`;
      toast(`Caixa fechado. Total vendido: ${formatMoney(r.total_sales)}.${diffMsg}`, 'success', 6000);
      $('opening').value = '';
      await load();
    } catch (err) { toast(err.message, 'error'); }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
});

load();
