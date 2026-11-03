const state = {
  products: [],
  categories: [],
  topSellers: [],
  activeCategory: 'all',
  search: '',
  cart: [], // { product_id, name, unit_price, quantity, stock }
  paymentMethod: null,
  sessionOpen: false,
  finished: false,
  payTarget: null, // null = carrinho; { ids, total, label } = comandas de mesa
  openOrders: [],
};

const $ = (id) => document.getElementById(id);

async function loadData() {
  try {
    const [products, categories, topSellers, session, openOrders] = await Promise.all([
      api('/api/products'),
      api('/api/categories'),
      api('/api/products/top-sellers?limit=5'),
      updateSidebarStatus(),
      api('/api/orders/open'),
    ]);
    state.openOrders = openOrders;
    renderOrdersButton();
    state.products = products;
    state.categories = categories;
    state.topSellers = topSellers;
    state.sessionOpen = !!session;
    $('cash-warning').classList.toggle('hidden', state.sessionOpen);
    syncCartWithStock();
    renderCategories();
    renderProducts();
    renderCart();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function syncCartWithStock() {
  state.cart.forEach((item) => {
    const p = state.products.find((x) => x.id === item.product_id);
    if (p) { item.stock = p.track_stock ? p.stock : Infinity; item.unit_price = p.sale_price; }
  });
}

function renderCategories() {
  const cats = [{ id: 'all', name: 'Todos' }, ...state.categories];
  $('categories').innerHTML = cats.map((c) =>
    `<button class="pill ${String(state.activeCategory) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</button>`).join('');
}

function inCartQty(id) {
  const it = state.cart.find((i) => i.product_id === id);
  return it ? it.quantity : 0;
}

function productCard(p, isTop = false) {
  const tracked = !!p.track_stock;
  const available = tracked ? p.stock - inCartQty(p.id) : '∞';
  const out = tracked && p.stock <= 0;
  let tag = '';
  if (out) tag = '<span class="stock-tag badge-out">SEM ESTOQUE</span>';
  else if (tracked && p.stock <= p.min_stock) tag = `<span class="stock-tag badge-low">${p.stock} un.</span>`;
  const extra = isTop ? `<span class="text-xs opacity-70">${p.total_sold} vendidos</span>` : `<span class="text-xs opacity-60">${escapeHtml(p.category_name || '')}</span>`;
  return `
    <button class="product-card ${isTop ? 'top' : ''} ${out ? 'disabled' : ''}" data-id="${p.id}" ${out ? 'disabled' : ''} title="Disponível: ${available}">
      ${tag}
      <div>
        <div class="font-bold leading-tight pr-12" style="font-size:15px">${escapeHtml(p.name)}</div>
        ${extra}
      </div>
      <div class="text-xl font-extrabold mt-2" style="color:var(--accent)">${formatMoney(p.sale_price)}</div>
    </button>`;
}

function renderProducts() {
  const term = state.search.trim().toLowerCase();
  const filtered = state.products.filter((p) => {
    const catOk = state.activeCategory === 'all' || String(p.category_id) === String(state.activeCategory);
    const termOk = !term || p.name.toLowerCase().includes(term) || (p.category_name || '').toLowerCase().includes(term);
    return catOk && termOk;
  });

  const showTop = state.activeCategory === 'all' && !term && state.topSellers.length > 0;
  $('top-sellers-section').classList.toggle('hidden', !showTop);
  if (showTop) {
    const tops = state.topSellers.map((t) => ({ ...(state.products.find((p) => p.id === t.id) || t), total_sold: t.total_sold }));
    $('top-sellers').innerHTML = tops.map((p) => productCard(p, true)).join('');
  }

  const catName = state.activeCategory === 'all' ? 'Todos os produtos'
    : (state.categories.find((c) => String(c.id) === String(state.activeCategory)) || {}).name;
  $('grid-title').textContent = term ? `Resultados para "${state.search.trim()}"` : catName;

  $('products').innerHTML = filtered.length
    ? filtered.map((p) => productCard(p)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔎</div>Nenhum produto encontrado.</div>';
}

function addToCart(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const item = state.cart.find((i) => i.product_id === id);
  const current = item ? item.quantity : 0;
  if (p.track_stock && current + 1 > p.stock) {
    toast(`Estoque insuficiente de "${p.name}" (disponível: ${p.stock}).`, 'warning');
    return;
  }
  if (item) item.quantity += 1;
  else state.cart.push({ product_id: p.id, name: p.name, unit_price: p.sale_price, quantity: 1, stock: p.track_stock ? p.stock : Infinity });
  renderCart(true);
}

function changeQty(id, delta) {
  const item = state.cart.find((i) => i.product_id === id);
  if (!item) return;
  const next = item.quantity + delta;
  if (next > item.stock) {
    toast(`Estoque insuficiente de "${item.name}" (disponível: ${item.stock}).`, 'warning');
    return;
  }
  if (next <= 0) state.cart = state.cart.filter((i) => i.product_id !== id);
  else item.quantity = next;
  renderCart();
}

function removeItem(id) {
  state.cart = state.cart.filter((i) => i.product_id !== id);
  renderCart();
}

const cartTotal = () => Math.round(state.cart.reduce((s, i) => s + i.unit_price * i.quantity, 0) * 100) / 100;
const cartCount = () => state.cart.reduce((s, i) => s + i.quantity, 0);

function renderCart(bump = false) {
  const count = cartCount();
  const total = cartTotal();
  const badge = $('cart-badge');
  badge.textContent = count;
  if (bump) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }

  $('cart-items').innerHTML = state.cart.length ? state.cart.map((i) => `
    <div class="card p-3">
      <div class="flex justify-between items-start gap-2">
        <div class="font-bold leading-tight">${escapeHtml(i.name)}</div>
        <button class="opacity-60 hover:opacity-100 text-sm" data-remove="${i.product_id}" title="Remover">✕</button>
      </div>
      <div class="flex justify-between items-center mt-2">
        <div class="flex items-center gap-2">
          <button class="qty-btn" data-dec="${i.product_id}">−</button>
          <span class="font-extrabold w-6 text-center">${i.quantity}</span>
          <button class="qty-btn" data-inc="${i.product_id}">+</button>
          <span class="text-xs opacity-60 ml-1">× ${formatMoney(i.unit_price)}</span>
        </div>
        <div class="font-extrabold">${formatMoney(i.unit_price * i.quantity)}</div>
      </div>
    </div>`).join('')
    : '<div class="empty-state my-auto"><div class="empty-icon">☕</div>Carrinho vazio.<br><span class="text-sm">Toque em um produto para adicionar.</span></div>';

  $('cart-count').textContent = count;
  $('cart-subtotal').textContent = formatMoney(total);
  $('cart-total').textContent = formatMoney(total);
  $('btn-checkout').disabled = state.cart.length === 0;
  renderProducts();
}

function clearCart() {
  state.cart = [];
  renderCart();
}

// ---------- Pagamento ----------
const payTotal = () => (state.payTarget ? state.payTarget.total : cartTotal());

function openPayment(target = null) {
  state.payTarget = target;
  if (!target && !state.cart.length) return;
  if (!state.sessionOpen) {
    toast('O caixa está fechado. Abra o caixa antes de vender.', 'warning');
    return;
  }
  state.paymentMethod = null;
  state.finished = false;
  $('payment-form').classList.remove('hidden');
  $('payment-success').classList.add('hidden');
  $('pay-total').textContent = formatMoney(payTotal());
  $('pay-title').textContent = target ? `Cobrar ${target.label}` : 'Pagamento';
  $('amount-received').value = '';
  $('cash-fields').classList.add('hidden');
  document.querySelectorAll('.pay-btn').forEach((b) => b.classList.remove('active'));
  renderQuickCash();
  updatePaymentState();
  openModal('modal-payment');
  setTimeout(() => document.activeElement && document.activeElement.blur(), 70);
}

function renderQuickCash() {
  const total = payTotal();
  const values = new Set([total]);
  [5, 10, 20, 50, 100, 200].forEach((n) => { if (n >= total) values.add(n); });
  values.add(Math.ceil(total / 10) * 10);
  const list = [...values].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
  $('quick-cash').innerHTML = list.map((v) =>
    `<button class="btn btn-ghost btn-sm" data-quick="${v}">${v === total ? 'Valor exato' : formatMoney(v)}</button>`).join('');
}

function selectMethod(method) {
  state.paymentMethod = method;
  document.querySelectorAll('.pay-btn').forEach((b) => b.classList.toggle('active', b.dataset.method === method));
  const isCash = method === 'dinheiro';
  $('cash-fields').classList.toggle('hidden', !isCash);
  if (isCash) setTimeout(() => $('amount-received').focus(), 30);
  updatePaymentState();
}

function updatePaymentState() {
  const total = payTotal();
  let ok = !!state.paymentMethod;
  if (state.paymentMethod === 'dinheiro') {
    const received = parseMoney($('amount-received').value);
    const change = received - total;
    const valid = !Number.isNaN(received) && received >= total - 0.001;
    $('change-value').textContent = valid ? formatMoney(change) : (Number.isNaN(received) ? formatMoney(0) : `Faltam ${formatMoney(total - received)}`);
    $('change-value').style.color = valid ? 'var(--success)' : 'var(--warning)';
    ok = valid;
  }
  $('btn-confirm-payment').disabled = !ok;
}

async function confirmPayment() {
  const btn = $('btn-confirm-payment');
  if (btn.disabled || btn.classList.contains('loading')) return;
  const target = state.payTarget;
  const amount_paid = state.paymentMethod === 'dinheiro' ? parseMoney($('amount-received').value) : undefined;

  await withLoading(btn, async () => {
    try {
      let info;
      if (target) {
        const r = await api('/api/orders/pay', { method: 'POST', body: { ids: target.ids, payment_method: state.paymentMethod, amount_paid } });
        info = { title: `${target.label} paga`, label: `${target.ids.length} comanda(s)`, total: r.total, method: r.payment_method, change: r.change_given };
        const orders = state.openOrders.filter((o) => target.ids.includes(o.id));
        state.lastReceipt = {
          title: 'CUPOM - MESA', number: `Comanda(s) #${target.ids.join(', #')}`, table: target.label,
          staff: [...new Set(orders.map((o) => o.staff_name))].join(', '),
          items: orders.flatMap((o) => o.items.map((i) => ({ quantity: i.quantity, name: i.product_name, unit: i.unit_price, total: i.total_price, notes: i.notes }))),
          total: r.total, method: r.payment_method, paid: r.amount_paid, change: r.change_given,
        };
      } else {
        const payload = {
          items: state.cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
          payment_method: state.paymentMethod,
          amount_paid,
        };
        const sale = await api('/api/sales', { method: 'POST', body: payload });
        info = { title: 'Venda concluída!', label: `Venda #${sale.id}`, total: sale.final_amount, method: sale.payment_method, change: sale.change_given };
        state.lastReceipt = {
          title: 'CUPOM', number: `Venda #${sale.id}`, date: sale.created_at,
          items: sale.items.map((i) => ({ quantity: i.quantity, name: i.product_name, unit: i.unit_price, total: i.total_price, notes: i.notes })),
          subtotal: sale.total, discount: sale.discount, total: sale.final_amount,
          method: sale.payment_method, paid: sale.amount_paid, change: sale.change_given,
        };
        state.cart = [];
        renderCart();
      }
      state.finished = true;
      $('payment-form').classList.add('hidden');
      $('payment-success').classList.remove('hidden');
      $('success-title').textContent = info.title;
      $('success-info').textContent = `${info.label} • ${PAYMENT_LABELS[info.method] || info.method} • ${formatMoney(info.total)}`;
      $('success-change').textContent = info.method === 'dinheiro' ? `Troco: ${formatMoney(info.change)}` : '';
      toast(`${info.label} registrada com sucesso!`, 'success');
      state.payTarget = null;
      loadData();
    } catch (e) {
      toast(e.message, 'error');
      loadData();
    }
  });
}

// ---------- Comandas de mesa (pedidos das atendentes) ----------
const KITCHEN_LABELS = { novo: '🆕 Na fila', preparando: '🔥 Preparando', pronto: '🔔 Pronto', entregue: '✔ Entregue' };

function groupOrders() {
  const groups = new Map();
  for (const o of state.openOrders) {
    const key = (o.table_label || 'Sem mesa').trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { label: o.table_label || 'Sem mesa', orders: [], total: 0 });
    const g = groups.get(key);
    g.orders.push(o);
    g.total = Math.round((g.total + o.final_amount) * 100) / 100;
  }
  return [...groups.values()];
}

function renderOrdersButton() {
  const n = groupOrders().length;
  $('btn-orders-count').textContent = n;
  $('btn-orders').classList.toggle('btn-warning', n > 0);
  $('btn-orders').classList.toggle('btn-ghost', n === 0);
}

function renderOrdersModal() {
  const groups = groupOrders();
  $('orders-list').innerHTML = groups.length ? groups.map((g, gi) => `
    <div class="card p-4">
      <div class="flex justify-between items-start gap-3">
        <div>
          <div class="text-lg font-extrabold">📌 ${escapeHtml(g.label)}</div>
          <div class="text-xs opacity-70">${g.orders.length} pedido(s) • ${escapeHtml([...new Set(g.orders.map((o) => o.staff_name))].join(', '))}</div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-extrabold" style="color:var(--accent)">${formatMoney(g.total)}</div>
          <div class="flex gap-2 mt-1 justify-end">
            <button class="btn btn-ghost btn-sm" data-bill-group="${gi}" title="Imprimir conferência da mesa">🧾 Conta</button>
            <button class="btn btn-success btn-sm" data-pay-group="${gi}">COBRAR</button>
          </div>
        </div>
      </div>
      ${g.orders.map((o) => `
        <div class="mt-3 pt-3 text-sm" style="border-top:1px solid rgba(245,230,211,.08)">
          <div class="flex justify-between opacity-80">
            <span>#${o.id} • ${formatTime(o.created_at)}${o.people ? ` • ${o.people} pessoa(s)` : ''}</span>
            <span>${KITCHEN_LABELS[o.kitchen_status] || ''}</span>
          </div>
          ${o.items.map((i) => `<div>${i.quantity}× ${escapeHtml(i.product_name)}${i.notes ? ` <em class="opacity-70">(${escapeHtml(i.notes)})</em>` : ''}
            <span class="float-right">${formatMoney(i.total_price)}</span></div>`).join('')}
        </div>`).join('')}
    </div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">📋</div>Nenhuma comanda em aberto.</div>';
}

async function openOrders() {
  try { state.openOrders = await api('/api/orders/open'); } catch (e) { toast(e.message, 'error'); }
  renderOrdersButton();
  renderOrdersModal();
  openModal('modal-orders');
}

function newSale() {
  closeModal('modal-payment');
  state.finished = false;
  state.payTarget = null;
  $('search').focus();
}

// ---------- Eventos ----------
document.addEventListener('click', (e) => {
  const card = e.target.closest('.product-card');
  if (card && !card.disabled) return addToCart(Number(card.dataset.id));
  const pill = e.target.closest('[data-cat]');
  if (pill) {
    state.activeCategory = pill.dataset.cat === 'all' ? 'all' : Number(pill.dataset.cat);
    renderCategories();
    renderProducts();
    return;
  }
  const inc = e.target.closest('[data-inc]');
  if (inc) return changeQty(Number(inc.dataset.inc), 1);
  const dec = e.target.closest('[data-dec]');
  if (dec) return changeQty(Number(dec.dataset.dec), -1);
  const rem = e.target.closest('[data-remove]');
  if (rem) return removeItem(Number(rem.dataset.remove));
  const pay = e.target.closest('.pay-btn');
  if (pay) return selectMethod(pay.dataset.method);
  const billGroup = e.target.closest('[data-bill-group]');
  if (billGroup) {
    const g = groupOrders()[Number(billGroup.dataset.billGroup)];
    if (g) Print.bill(g);
    return;
  }
  if (e.target.closest('#btn-print-receipt')) {
    if (state.lastReceipt) Print.receipt(state.lastReceipt);
    return;
  }
  const payGroup = e.target.closest('[data-pay-group]');
  if (payGroup) {
    const g = groupOrders()[Number(payGroup.dataset.payGroup)];
    if (!g) return;
    closeModal('modal-orders');
    return openPayment({ ids: g.orders.map((o) => o.id), total: g.total, label: g.label });
  }
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    $('amount-received').value = Number(quick.dataset.quick).toFixed(2).replace('.', ',');
    updatePaymentState();
  }
});

$('search').addEventListener('input', (e) => { state.search = e.target.value; renderProducts(); });
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = document.querySelector('#products .product-card:not(.disabled)');
    if (first) { addToCart(Number(first.dataset.id)); e.target.select(); }
  }
});
$('amount-received').addEventListener('input', updatePaymentState);
$('btn-checkout').addEventListener('click', () => openPayment());
$('btn-orders').addEventListener('click', openOrders);
$('btn-confirm-payment').addEventListener('click', confirmPayment);
$('btn-new-sale').addEventListener('click', newSale);
$('btn-clear').addEventListener('click', () => {
  if (!state.cart.length) return;
  if (confirm('Deseja limpar todos os itens do carrinho?')) { clearCart(); toast('Carrinho limpo.', 'info'); }
});

document.addEventListener('keydown', (e) => {
  const paymentOpen = $('modal-payment').classList.contains('open');
  if (e.key === 'F2') {
    e.preventDefault();
    if (!paymentOpen) { $('search').focus(); $('search').select(); }
    return;
  }
  if (e.key === 'F9') {
    e.preventDefault();
    if (!paymentOpen) openPayment();
    return;
  }
  if (e.key === 'F4') {
    e.preventDefault();
    if (!paymentOpen) openOrders();
    return;
  }
  if (e.key === 'Escape') {
    if (paymentOpen) { closeModal('modal-payment'); state.payTarget = null; return; }
    if ($('modal-orders').classList.contains('open')) { closeModal('modal-orders'); return; }
    if (state.search) { $('search').value = ''; state.search = ''; renderProducts(); }
    $('search').blur();
    return;
  }
  if (paymentOpen) {
    if (state.finished && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      if (state.lastReceipt) Print.receipt(state.lastReceipt);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.finished) newSale();
      else confirmPayment();
      return;
    }
    if (!state.finished && document.activeElement !== $('amount-received')) {
      const map = { 1: 'dinheiro', 2: 'pix', 3: 'debito', 4: 'credito' };
      if (map[e.key]) { e.preventDefault(); selectMethod(map[e.key]); }
    }
  }
});

startAdminPage('pdv', async () => {
  await loadData();
  // Atualiza comandas e estoque em tempo real
  const socket = Session.socket();
  const refresh = () => loadData();
  ['order:new', 'order:update', 'orders:paid', 'stock:changed', 'cash:changed'].forEach((ev) => socket.on(ev, refresh));
  socket.on('order:new', (o) => toast(`Novo pedido: ${o.table_label}`, 'info'));
});
