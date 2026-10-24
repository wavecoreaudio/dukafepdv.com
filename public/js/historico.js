renderSidebar('historico');

const $ = (id) => document.getElementById(id);
let sales = [];
let cashSessions = [];
let currentTab = 'sales'; // 'sales' ou 'cash'
let cancelId = null;

async function load() {
  try {
    sales = await api(`/api/sales`);
    cashSessions = await api(`/api/cash/sessions`);
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function render() {
  // Renderizar cabeçalho e abas se necessário, ou alternar visualização
  const active = sales.filter((s) => s.status === 'active');
  const total = active.reduce((sum, s) => sum + s.total, 0);
  
  $('h-count').textContent = active.length;
  $('h-total').textContent = formatMoney(total);
  $('h-avg').textContent = formatMoney(active.length ? total / active.length : 0);
  $('h-cancel').textContent = sales.length - active.length;
  $('foot-total').textContent = formatMoney(total);

  if (currentTab === 'sales') {
    renderSalesTable();
  } else {
    renderCashTable();
  }
}

function renderSalesTable() {
  $('table-header').innerHTML = `
    <tr>
      <th>HORÁRIO</th>
      <th>Nº VENDA</th>
      <th>ITENS</th>
      <th>PAGAMENTO</th>
      <th>TOTAL</th>
      <th>STATUS</th>
      <th style="text-align:right">AÇÕES</th>
    </tr>
  `;

  $('tbody').innerHTML = sales.length ? sales.map((s) => {
    const cancelled = s.status === 'cancelled';
    const itemsCount = s.items_count || 1;
    return `<tr class="${cancelled ? 'cancelled' : ''}">
      <td>${formatDateTime(s.created_at)}</td>
      <td class="font-bold">#${s.id}</td>
      <td>${itemsCount} item(ns)</td>
      <td>${PAYMENT_ICONS[s.payment_method] || ''} ${PAYMENT_LABELS[s.payment_method] || s.payment_method}</td>
      <td class="font-bold">${formatMoney(s.final_amount || s.total)}</td>
      <td class="no-strike">${cancelled ? '<span class="badge badge-cancel">CANCELADA</span>' : '<span class="badge badge-ok">CONCLUÍDA</span>'}</td>
      <td class="no-strike" style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-details="${s.id}">VER DETALHES</button>
        ${cancelled ? '' : `<button class="btn btn-danger btn-sm" data-cancel="${s.id}">CANCELAR VENDA</button>`}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📭</div>Nenhuma venda registada.</div></td></tr>';
}

function renderCashTable() {
  $('table-header').innerHTML = `
    <tr>
      <th>ABERTURA</th>
      <th>FECHO</th>
      <th>FUNDO INICIAL</th>
      <th>TOTAL VENDAS</th>
      <th>VALOR CONTADO</th>
      <th>DIFERENÇA</th>
      <th style="text-align:right">STATUS</th>
    </tr>
  `;

  $('tbody').innerHTML = cashSessions.length ? cashSessions.map((cs) => {
    const isOpen = cs.status === 'open';
    const diff = cs.closing_counted !== null ? cs.closing_counted - cs.closing_expected : 0;
    const diffFormatted = cs.closing_counted !== null ? formatMoney(diff) : '-';
    
    return `<tr>
      <td>${formatDateTime(cs.opened_at)}</td>
      <td>${cs.closed_at ? formatDateTime(cs.closed_at) : 'Em aberto'}</td>
      <td>${formatMoney(cs.opening_balance)}</td>
      <td class="font-bold">${formatMoney(cs.total_sales)}</td>
      <td>${cs.closing_counted !== null ? formatMoney(cs.closing_counted) : 'Aguardando fecho'}</td>
      <td style="color: ${diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--accent)' : 'inherit'}">${diffFormatted}</td>
      <td style="text-align:right">
        ${isOpen ? '<span class="badge badge-ok">ABERTO</span>' : '<span class="badge badge-low">FECHADO</span>'}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">💰</div>Nenhum caixa registado.</div></td></tr>';
}

async function showDetails(id) {
  try {
    const s = await api(`/api/sales/${id}`);
    $('d-title').innerHTML = `Venda #${s.id} ${s.status === 'cancelled' ? '<span class="badge badge-cancel ml-2">CANCELADA</span>' : ''}`;
    $('d-meta').textContent = `${formatDateTime(s.created_at)} • ${PAYMENT_LABELS[s.payment_method] || s.payment_method}`;
    $('d-items').innerHTML = s.items.map((i) => `<tr>
      <td>${escapeHtml(i.product_name)}</td><td>${i.quantity}</td><td>${formatMoney(i.unit_price)}</td>
      <td style="text-align:right" class="font-bold">${formatMoney(i.unit_price * i.quantity)}</td></tr>`).join('');
    let totals = `<div class="text-2xl font-extrabold">Total: ${formatMoney(s.final_amount || s.total)}</div>`;
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
  $('c-total').textContent = formatMoney(s.final_amount || s.total);
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

// Adicionar botões de alternância de abas dinamicamente no topo da página se não existirem
function setupTabs() {
  const container = document.querySelector('.historico-container, h1').parentNode;
  if (!document.getElementById('history-tabs')) {
    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'history-tabs';
    tabsDiv.style.cssText = 'margin-bottom: 20px; display: flex; gap: 10px;';
    tabsDiv.innerHTML = `
      <button id="tab-sales" class="btn btn-primary" style="flex:1">🛒 Histórico de Vendas</button>
      <button id="tab-cash" class="btn btn-ghost" style="flex:1">💰 Histórico de Caixas</button>
    `;
    container.insertBefore(tabsDiv, container.querySelector('.metrics-grid, .table-container, table'));

    document.getElementById('tab-sales').addEventListener('click', () => {
      currentTab = 'sales';
      document.getElementById('tab-sales').className = 'btn btn-primary';
      document.getElementById('tab-cash').className = 'btn btn-ghost';
      render();
    });

    document.getElementById('tab-cash').addEventListener('click', () => {
      currentTab = 'cash';
      document.getElementById('tab-cash').className = 'btn btn-primary';
      document.getElementById('tab-sales').className = 'btn btn-ghost';
      render();
    });
  }

  // Garantir que a tabela tem um ID no <thead> para alternar os cabeçalhos
  const thead = document.querySelector('table thead');
  if (thead && !thead.id) {
    thead.id = 'table-header';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
});

setupTabs();
load();