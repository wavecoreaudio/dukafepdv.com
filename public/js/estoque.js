renderSidebar('estoque');

const $ = (id) => document.getElementById(id);
let products = [];
let categories = [];

function stockStatus(p) {
  if (p.stock <= 0) return 'out';
  if (p.stock <= p.min_stock) return 'low';
  return 'ok';
}

async function load() {
  try {
    [products, categories] = await Promise.all([api('/api/products'), api('/api/categories')]);
    fillCategorySelects();
    render();
  } catch (e) {
    toast(e.message, 'error');
    $('tbody').innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⚠️</div>${escapeHtml(e.message)}</div></td></tr>`;
  }
}

function fillCategorySelects() {
  const current = $('filter-category').value || 'all';
  $('filter-category').innerHTML = '<option value="all">Todas as categorias</option>' +
    categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('filter-category').value = current;
  $('p-category').innerHTML = '<option value="">Selecione...</option>' +
    categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function render() {
  const term = $('search').value.trim().toLowerCase();
  const cat = $('filter-category').value;
  const status = $('filter-status').value;

  const list = products.filter((p) => {
    const termOk = !term || p.name.toLowerCase().includes(term) || (p.category_name || '').toLowerCase().includes(term);
    const catOk = cat === 'all' || String(p.category_id) === cat;
    const st = stockStatus(p);
    const statusOk = status === 'all' || st === status || (status === 'low' && st === 'out' && false);
    return termOk && catOk && statusOk;
  });

  $('st-total').textContent = products.length;
  $('st-low').textContent = products.filter((p) => stockStatus(p) === 'low').length;
  $('st-out').textContent = products.filter((p) => stockStatus(p) === 'out').length;
  $('st-value').textContent = formatMoney(products.reduce((s, p) => s + (p.cost_price || 0) * Math.max(p.stock, 0), 0));

  if (!list.length) {
    $('tbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📭</div>Nenhum produto encontrado.</div></td></tr>';
    return;
  }

  $('tbody').innerHTML = list.map((p) => {
    const st = stockStatus(p);
    const margin = p.sale_price > 0 && p.cost_price > 0 ? ((p.sale_price - p.cost_price) / p.sale_price) * 100 : null;
    const stockCell = st === 'out'
      ? `<span class="stock-out"><span class="stock-indicator" style="background:var(--danger)"></span>${p.stock}</span>`
      : st === 'low'
        ? `<span class="stock-low"><span class="stock-indicator" style="background:var(--warning)"></span>${p.stock}</span>`
        : `<span><span class="stock-indicator" style="background:var(--success)"></span>${p.stock}</span>`;
    const badge = st === 'out' ? '<span class="badge badge-out">SEM ESTOQUE</span>'
      : st === 'low' ? '<span class="badge badge-low">ESTOQUE BAIXO</span>'
        : '<span class="badge badge-ok">OK</span>';
    return `
      <tr>
        <td class="font-bold">${escapeHtml(p.name)}</td>
        <td class="opacity-80">${escapeHtml(p.category_name || '-')}</td>
        <td>${formatMoney(p.cost_price)}</td>
        <td class="font-bold">${formatMoney(p.sale_price)}</td>
        <td class="opacity-80">${margin === null ? '-' : margin.toFixed(0) + '%'}</td>
        <td>${stockCell} <span class="text-xs opacity-50">/ mín. ${p.min_stock}</span></td>
        <td>${badge}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-edit="${p.id}">✏️ Editar</button>
          <button class="btn btn-success btn-sm" data-restock="${p.id}">+ Repor</button>
        </td>
      </tr>`;
  }).join('');
}

// ---------- Modal produto ----------
function showFormError(msg) {
  const el = $('form-error');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function openProductModal(product = null) {
  showFormError('');
  $('p-id').value = product ? product.id : '';
  $('product-modal-title').textContent = product ? 'Editar produto' : 'Novo produto';
  $('p-name').value = product ? product.name : '';
  $('p-category').value = product ? product.category_id : '';
  $('p-cost').value = product ? Number(product.cost_price || 0).toFixed(2).replace('.', ',') : '';
  $('p-price').value = product ? Number(product.sale_price).toFixed(2).replace('.', ',') : '';
  $('p-stock').value = product ? product.stock : 0;
  $('p-min').value = product ? product.min_stock : 5;
  $('p-stock-label').textContent = product ? 'Estoque atual' : 'Estoque inicial';
  $('btn-delete').classList.toggle('hidden', !product);
  openModal('modal-product');
}

$('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('p-id').value;
  const data = {
    name: $('p-name').value.trim(),
    category_id: Number($('p-category').value),
    cost_price: $('p-cost').value.trim() ? parseMoney($('p-cost').value) : 0,
    sale_price: parseMoney($('p-price').value),
    stock: parseInt($('p-stock').value || '0', 10),
    min_stock: parseInt($('p-min').value || '0', 10),
  };
  if (!data.name) return showFormError('Informe o nome do produto.');
  if (!data.category_id) return showFormError('Selecione uma categoria.');
  if (Number.isNaN(data.sale_price) || data.sale_price <= 0) return showFormError('Informe um preço de venda válido (maior que zero).');
  if (Number.isNaN(data.cost_price) || data.cost_price < 0) return showFormError('Informe um preço de custo válido.');
  if (Number.isNaN(data.stock) || data.stock < 0) return showFormError('O estoque não pode ser negativo.');
  if (Number.isNaN(data.min_stock) || data.min_stock < 0) return showFormError('O estoque mínimo não pode ser negativo.');
  showFormError('');

  await withLoading($('btn-save'), async () => {
    try {
      if (id) await api(`/api/products/${id}`, { method: 'PUT', body: data });
      else await api('/api/products', { method: 'POST', body: data });
      closeModal('modal-product');
      toast(id ? 'Produto atualizado!' : 'Produto cadastrado!', 'success');
      await load();
    } catch (err) {
      showFormError(err.message);
    }
  });
});

$('btn-delete').addEventListener('click', async () => {
  const id = $('p-id').value;
  const p = products.find((x) => String(x.id) === id);
  if (!p || !confirm(`Desativar o produto "${p.name}"? Ele deixará de aparecer no PDV.`)) return;
  await withLoading($('btn-delete'), async () => {
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      closeModal('modal-product');
      toast('Produto desativado.', 'info');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
});

// ---------- Modal reposição ----------
function updateRestockPreview() {
  const p = products.find((x) => String(x.id) === $('r-id').value);
  const qty = parseInt($('r-qty').value || '0', 10);
  if (p) $('r-new').textContent = p.stock + (qty > 0 ? qty : 0);
}

function openRestockModal(p) {
  $('r-id').value = p.id;
  $('r-name').textContent = p.name;
  $('r-current').textContent = `${p.stock} un.`;
  $('r-qty').value = '';
  updateRestockPreview();
  openModal('modal-restock');
}

$('r-qty').addEventListener('input', updateRestockPreview);

$('restock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const qty = parseInt($('r-qty').value, 10);
  if (!(qty > 0)) return toast('Informe uma quantidade maior que zero.', 'warning');
  await withLoading($('btn-restock'), async () => {
    try {
      const p = await api(`/api/products/${$('r-id').value}/restock`, { method: 'POST', body: { quantity: qty } });
      closeModal('modal-restock');
      toast(`Estoque de "${p.name}" atualizado para ${p.stock} un.`, 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
});

// ---------- Eventos ----------
document.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) return openProductModal(products.find((p) => p.id === Number(edit.dataset.edit)));
  const restock = e.target.closest('[data-restock]');
  if (restock) return openRestockModal(products.find((p) => p.id === Number(restock.dataset.restock)));
  const add = e.target.closest('[data-add]');
  if (add) {
    $('r-qty').value = (parseInt($('r-qty').value || '0', 10) || 0) + Number(add.dataset.add);
    updateRestockPreview();
  }
});
$('btn-new').addEventListener('click', () => openProductModal());
$('search').addEventListener('input', render);
$('filter-category').addEventListener('change', render);
$('filter-status').addEventListener('change', render);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach((m) => m.classList.remove('open'));
  if (e.key === 'F2') { e.preventDefault(); $('search').focus(); }
});

load();
