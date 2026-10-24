renderSidebar('pdv');

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
};

const $ = (id) => document.getElementById(id);

async function loadData() {
  try {
    const [products, categories, topSellers, session] = await Promise.all([
      api('/api/products'),
      api('/api/categories'),
      api('/api/products/top-sellers?limit=5'),
      updateSidebarStatus(),
    ]);
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
    if (p) { item.stock = p.stock; item.unit_price = p.sale_price; }
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
  const available = p.stock - inCartQty(p.id);
  const out = p.stock <= 0;
  let tag = '';
  if (out) tag = '<span class="stock-tag badge-out">SEM ESTOQUE</span>';
  else if (p.stock <= p.min_stock) tag = `<span class="stock-tag badge-low">${p.stock} un.</span>`;
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
  if (current + 1 > p.stock) {
    toast(`Estoque insuficiente de "${p.name}" (disponível: ${p.stock}).`, 'warning');
    return;
  }
  if (item) item.quantity += 1;
  else state.cart.push({ product_id: p.id, name: p.name, unit_price: p.sale_price, quantity: 1, stock: p.stock });
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
function openPayment() {
  if (!state.cart.length) return;
  if (!state.sessionOpen) {
    toast('O caixa está fechado. Abra o caixa antes de vender.', 'warning');
    return;
  }
  state.paymentMethod = null;
  state.finished = false;
  $('payment-form').classList.remove('hidden');
  $('payment-success').classList.add('hidden');
  $('pay-total').textContent = formatMoney(cartTotal());
  $('amount-received').value = '';
  $('cash-fields').classList.add('hidden');
  document.querySelectorAll('.pay-btn').forEach((b) => b.classList.remove('active'));
  renderQuickCash();
  updatePaymentState();
  openModal('modal-payment');
  setTimeout(() => document.activeElement && document.activeElement.blur(), 70);
}

function renderQuickCash() {
  const total = cartTotal();
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
  const total = cartTotal();
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
  const payload = {
    items: state.cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
    payment_method: state.paymentMethod,
  };
  if (state.paymentMethod === 'dinheiro') payload.amount_paid = parseMoney($('amount-received').value);

  await withLoading(btn, async () => {
    try {
      const sale = await api('/api/sales', { method: 'POST', body: payload });
      state.finished = true;
      $('payment-form').classList.add('hidden');
      $('payment-success').classList.remove('hidden');
      $('success-info').textContent = `Venda #${sale.id} • ${PAYMENT_LABELS[sale.payment_method]} • ${formatMoney(sale.total)}`;
      $('success-change').textContent = sale.payment_method === 'dinheiro' ? `Troco: ${formatMoney(sale.change_given)}` : '';
      state.cart = [];
      renderCart();
      toast(`Venda #${sale.id} registrada com sucesso!`, 'success');
      loadData();
    } catch (e) {
      toast(e.message, 'error');
      loadData();
    }
  });
}

function newSale() {
  closeModal('modal-payment');
  state.finished = false;
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
$('btn-checkout').addEventListener('click', openPayment);
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
  if (e.key === 'Escape') {
    if (paymentOpen) { closeModal('modal-payment'); return; }
    if (state.search) { $('search').value = ''; state.search = ''; renderProducts(); }
    $('search').blur();
    return;
  }
  if (paymentOpen) {
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

loadData();
