const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./database');
const auth = require('./auth');

// ---------- Configuração ----------
const CONFIG_FILE = path.join(__dirname, 'config', 'config.json');
const DEFAULT_CONFIG = {
    porta: 3000,
    // Pasta extra para cópia do backup (ex.: "C:\\Users\\lucas\\OneDrive\\Backup DUKAFE"). Vazio = desligado.
    pastaBackupExtra: '',
    backupACadaHoras: 6,
    // Mostra os PINs das ATENDENTES no terminal ao iniciar (o da gerência nunca aparece)
    mostrarPinsAtendentes: true,
    // Dados que saem no cupom / conta impressa (não é documento fiscal)
    loja: {
        nome: 'DUKAFE',
        endereco: '',
        telefone: '',
        cnpj: '',
        rodape: 'Obrigado pela preferência! ☕',
    },
};
function loadConfig() {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        const merged = { ...DEFAULT_CONFIG, ...saved, loja: { ...DEFAULT_CONFIG.loja, ...(saved.loja || {}) } };
        // Acrescenta no arquivo as opções novas que ainda não existiam nele.
        if (JSON.stringify(merged) !== JSON.stringify(saved)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
        return merged;
    } catch (e) {
        console.warn('[config] config/config.json inválido, usando padrões:', e.message);
        return { ...DEFAULT_CONFIG };
    }
}
const config = loadConfig();
const PORT = process.env.PORT || config.porta || 3000;

const firstPins = auth.ensureTeam();
const sessions = auth.createSessionStore(db);
sessions.purge();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Utilidades ----------
class AppError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const wrap = (fn) => (req, res, next) => {
    try {
        Promise.resolve(fn(req, res, next)).catch(next);
    } catch (e) {
        next(e);
    }
};

// Dinheiro: todas as contas são feitas em CENTAVOS inteiros (sem erro de arredondamento
// de número quebrado) e o resultado é guardado em reais com 2 casas.
const cents = (v) => Math.round((Number(v) || 0) * 100);
const reais = (c) => c / 100;
const round2 = (v) => reais(cents(v));
const sumMoney = (list, pick = (x) => x) => reais(list.reduce((s, x) => s + cents(pick(x)), 0));
const nowISO = () => new Date().toISOString();
const PAYMENT_METHODS = ['dinheiro', 'pix', 'debito', 'credito'];

function toMoney(v, field, { min = 0, allowZero = true } = {}) {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    if (!Number.isFinite(n) || n < min || (!allowZero && n === 0)) throw new AppError(`Valor inválido em "${field}".`);
    if (n > 1000000) throw new AppError(`Valor muito alto em "${field}".`);
    return round2(n);
}

function toInt(v, field, { min = 0, max = 1000000 } = {}) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`Número inválido em "${field}".`);
    return n;
}

function cleanText(v, max) {
    return String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

const getActiveSession = () =>
    db.prepare("SELECT * FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1").get();

const auditStmt = db.prepare('INSERT INTO audit_log (at, staff_name, action, details) VALUES (?, ?, ?, ?)');
function audit(user, action, details = null) {
    auditStmt.run(nowISO(), user ? user.name : null, action, details ? JSON.stringify(details) : null);
}

// ---------- Autenticação ----------
function getToken(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Exige login. Se roles for informado, exige também um desses papéis. */
const requireAuth = (...roles) => (req, res, next) => {
    const user = sessions.get(getToken(req));
    if (!user) return next(new AppError('Sessão expirada. Faça login novamente.', 401));
    if (roles.length && !roles.includes(user.role)) {
        return next(new AppError('Você não tem permissão para esta ação. Peça para a gerência.', 403));
    }
    req.user = user;
    next();
};
const anyStaff = requireAuth();
const adminOnly = requireAuth('admin');

app.post('/api/auth/login', wrap((req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
    const wait = auth.loginBlockedFor(ip);
    if (wait) throw new AppError(`Muitas tentativas erradas. Aguarde ${wait}s.`, 429);

    const pin = String((req.body && req.body.pin) || '');
    const member = auth.isValidPin(pin) ? auth.findMemberByPin(pin) : null;
    if (!member) {
        auth.registerFail(ip);
        throw new AppError('PIN inválido. Tente novamente.', 401);
    }
    auth.registerSuccess(ip);
    const s = sessions.create(member);
    audit(member, 'login', { ip });
    res.json({ token: s.token, expires_at: s.expires_at, staff: { name: member.name, role: member.role } });
}));

app.get('/api/auth/me', anyStaff, (req, res) => {
    res.json({ staff: { name: req.user.name, role: req.user.role } });
});

app.post('/api/auth/logout', (req, res) => {
    const t = getToken(req);
    if (t) sessions.destroy(t);
    res.json({ success: true });
});

// ---------- Produtos ----------
app.get('/api/products', anyStaff, wrap((req, res) => {
    const products = db.prepare(`
        SELECT p.*, c.name AS category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.active = 1
        ORDER BY p.name COLLATE NOCASE ASC
    `).all();
    res.json(products);
}));

app.get('/api/products/top-sellers', anyStaff, wrap((req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const products = db.prepare(`
        SELECT p.*, c.name AS category_name, SUM(si.quantity) AS total_sold
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.status = 'active' AND s.created_at >= ? AND p.active = 1
        GROUP BY p.id
        ORDER BY total_sold DESC
        LIMIT ?
    `).all(since, limit);
    res.json(products);
}));

function validateProduct(body, partial) {
    const out = {};
    if (!partial || body.name !== undefined) {
        out.name = cleanText(body.name, 80);
        if (!out.name) throw new AppError('Informe o nome do produto.');
    }
    if (!partial || body.category_id !== undefined) {
        if (body.category_id === null || body.category_id === '' || body.category_id === undefined) {
            out.category_id = null;
        } else {
            out.category_id = toInt(body.category_id, 'categoria', { min: 1 });
            if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(out.category_id)) throw new AppError('Categoria não encontrada.');
        }
    }
    if (!partial || body.sale_price !== undefined) out.sale_price = toMoney(body.sale_price, 'preço de venda', { allowZero: false });
    if (!partial || body.cost_price !== undefined) out.cost_price = toMoney(body.cost_price || 0, 'preço de custo');
    if (!partial || body.stock !== undefined) out.stock = toInt(body.stock || 0, 'estoque');
    if (!partial || body.min_stock !== undefined) out.min_stock = toInt(body.min_stock ?? 5, 'estoque mínimo');
    if (!partial || body.track_stock !== undefined) out.track_stock = body.track_stock === false || body.track_stock === 0 || body.track_stock === '0' ? 0 : 1;
    return out;
}

// ---------- Movimentos de estoque ----------
const insMovement = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, stock_after, unit_cost, reason, sale_id, staff_name, created_at)
    VALUES (?, ?, ?, (SELECT stock FROM products WHERE id = ?), (SELECT cost_price FROM products WHERE id = ?), ?, ?, ?, ?)
`);
/** Registra um movimento DEPOIS de alterar o estoque (stock_after = saldo atual). */
function logMovement(productId, type, quantity, { reason = null, saleId = null, user = null } = {}) {
    insMovement.run(productId, type, quantity, productId, productId, reason, saleId, user ? user.name : null, nowISO());
}

app.post('/api/products', adminOnly, wrap((req, res) => {
    const p = validateProduct(req.body || {}, false);
    if (!p.track_stock) p.stock = 0;
    const id = db.transaction(() => {
        const info = db.prepare(`
            INSERT INTO products (name, category_id, cost_price, sale_price, stock, min_stock, track_stock, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(p.name, p.category_id, p.cost_price, p.sale_price, p.stock, p.min_stock, p.track_stock);
        if (p.track_stock) logMovement(info.lastInsertRowid, 'entrada', p.stock, { reason: 'Cadastro do produto', user: req.user });
        return info.lastInsertRowid;
    })();
    audit(req.user, 'produto_criado', { id, ...p });
    io.emit('stock:changed');
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}));

app.put('/api/products/:id', adminOnly, wrap((req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const before = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
    if (!before) throw new AppError('Produto não encontrado.', 404);
    const p = validateProduct(req.body || {}, true);
    const tracked = p.track_stock !== undefined ? p.track_stock : before.track_stock;
    if (!tracked) p.stock = 0;
    const fields = Object.keys(p);
    if (!fields.length) return res.json(before);
    db.transaction(() => {
        db.prepare(`UPDATE products SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
            .run(...fields.map((f) => p[f]), id);
        if (p.stock !== undefined && p.stock !== before.stock) {
            logMovement(id, 'ajuste', p.stock - before.stock, {
                reason: tracked ? 'Alterado na edição do produto' : 'Controle de estoque desligado', user: req.user,
            });
        }
    })();
    audit(req.user, 'produto_editado', { id, antes: before, depois: p });
    io.emit('stock:changed');
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}));

app.delete('/api/products/:id', adminOnly, wrap((req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const info = db.prepare('UPDATE products SET active = 0 WHERE id = ? AND active = 1').run(id);
    if (!info.changes) throw new AppError('Produto não encontrado.', 404);
    audit(req.user, 'produto_desativado', { id });
    io.emit('stock:changed');
    res.json({ success: true });
}));

function trackedProduct(id) {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
    if (!p) throw new AppError('Produto não encontrado.', 404);
    if (!p.track_stock) throw new AppError('Este produto não controla estoque.');
    return p;
}

// Entrada de mercadoria (reposição). Opcionalmente atualiza o preço de custo.
app.post('/api/products/:id/restock', adminOnly, wrap((req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const b = req.body || {};
    const qty = toInt(b.quantity, 'quantidade', { min: 1, max: 100000 });
    const reason = cleanText(b.reason, 120) || 'Reposição';
    const newCost = b.cost_price === undefined || b.cost_price === null || b.cost_price === '' ? null : toMoney(b.cost_price, 'custo');
    db.transaction(() => {
        trackedProduct(id);
        if (newCost !== null) db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(newCost, id);
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, id);
        logMovement(id, 'entrada', qty, { reason, user: req.user });
    })();
    audit(req.user, 'estoque_reposto', { id, qty, reason, newCost });
    io.emit('stock:changed');
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}));

// Perda (quebrou, venceu, consumo interno) ou contagem (acerta o estoque para o valor contado).
app.post('/api/products/:id/adjust', adminOnly, wrap((req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const b = req.body || {};
    const reason = cleanText(b.reason, 120);
    if (!reason) throw new AppError('Informe o motivo.');
    let delta = 0, type;
    db.transaction(() => {
        const p = trackedProduct(id);
        if (b.mode === 'perda') {
            const qty = toInt(b.quantity, 'quantidade', { min: 1, max: 100000 });
            if (qty > p.stock) throw new AppError(`A perda (${qty}) é maior que o estoque atual (${p.stock}).`);
            delta = -qty; type = 'perda';
        } else if (b.mode === 'contagem') {
            const counted = toInt(b.counted, 'quantidade contada', { min: 0, max: 100000 });
            delta = counted - p.stock; type = 'ajuste';
            if (delta === 0) throw new AppError('O estoque contado é igual ao do sistema. Nada a ajustar.');
        } else {
            throw new AppError('Tipo de ajuste inválido.');
        }
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, id);
        logMovement(id, type, delta, { reason, user: req.user });
    })();
    audit(req.user, `estoque_${type}`, { id, delta, reason });
    io.emit('stock:changed');
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}));

app.get('/api/products/:id/movements', adminOnly, wrap((req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    res.json(db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 300').all(id));
}));

// ---------- Categorias ----------
app.get('/api/categories', anyStaff, wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE ASC').all());
}));

app.post('/api/categories', adminOnly, wrap((req, res) => {
    const name = cleanText(req.body && req.body.name, 60);
    if (!name) throw new AppError('Nome da categoria é obrigatório.');
    try {
        const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
        res.status(201).json({ id: info.lastInsertRowid, name });
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw new AppError('Já existe uma categoria com este nome.');
        throw e;
    }
}));

// ---------- Caixa ----------
function sessionSummary(session) {
    const sales = db.prepare('SELECT * FROM sales WHERE cash_session_id = ?').all(session.id);
    const movements = db.prepare('SELECT * FROM cash_movements WHERE cash_session_id = ? ORDER BY created_at DESC').all(session.id);

    // tudo em centavos
    const byMethod = { dinheiro: 0, pix: 0, debito: 0, credito: 0 };
    const sales_count_by_method = { dinheiro: 0, pix: 0, debito: 0, credito: 0 };
    let total = 0, sales_count = 0, cancelled_count = 0, pending_count = 0, pending = 0, discounts = 0;

    for (const s of sales) {
        if (s.status === 'cancelled') { cancelled_count++; continue; }
        if (s.payment_method === 'pendente') { pending_count++; pending += cents(s.final_amount); continue; }
        if (byMethod[s.payment_method] !== undefined) {
            byMethod[s.payment_method] += cents(s.final_amount);
            sales_count_by_method[s.payment_method] += 1;
        }
        total += cents(s.final_amount);
        discounts += cents(s.discount);
        sales_count++;
    }
    let sangrias = 0, suprimentos = 0;
    for (const m of movements) {
        if (m.type === 'sangria') sangrias += cents(m.amount);
        if (m.type === 'suprimento') suprimentos += cents(m.amount);
    }
    const sales_by_method = {};
    Object.keys(byMethod).forEach((k) => { sales_by_method[k] = reais(byMethod[k]); });
    const expected_cash = reais(cents(session.opening_balance) + byMethod.dinheiro + suprimentos - sangrias);
    return {
        sales_by_method, sales_count_by_method,
        total_sales: reais(total), sales_count, cancelled_count,
        pending_count, pending_total: reais(pending), discounts: reais(discounts),
        sangrias: reais(sangrias), suprimentos: reais(suprimentos), expected_cash, movements,
    };
}

app.get('/api/cash/status', anyStaff, wrap((req, res) => {
    const session = getActiveSession();
    res.json({ open: !!session, session: session || null });
}));

app.get('/api/cash/summary', adminOnly, wrap((req, res) => {
    const session = getActiveSession();
    if (!session) return res.json({ open: false, session: null });
    res.json({ open: true, session, ...sessionSummary(session) });
}));

app.get('/api/cash/sessions', adminOnly, wrap((req, res) => {
    const sessionsList = db.prepare(`
        SELECT cs.*,
            (SELECT COALESCE(SUM(final_amount), 0) FROM sales
              WHERE cash_session_id = cs.id AND status = 'active' AND payment_method != 'pendente') AS total_sales,
            (SELECT COUNT(*) FROM sales
              WHERE cash_session_id = cs.id AND status = 'active' AND payment_method != 'pendente') AS sales_count
        FROM cash_sessions cs
        ORDER BY cs.opened_at DESC
        LIMIT 60
    `).all();
    res.json(sessionsList);
}));

app.post('/api/cash/open', adminOnly, wrap((req, res) => {
    if (getActiveSession()) throw new AppError('Já existe um caixa aberto.');
    const opening_balance = toMoney((req.body && req.body.opening_balance) || 0, 'fundo de caixa');
    const info = db.prepare("INSERT INTO cash_sessions (opening_balance, opened_at, status) VALUES (?, ?, 'open')")
        .run(opening_balance, nowISO());
    audit(req.user, 'caixa_aberto', { id: info.lastInsertRowid, opening_balance });
    io.emit('cash:changed');
    res.status(201).json(db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(info.lastInsertRowid));
}));

app.post('/api/cash/close', adminOnly, wrap((req, res) => {
    const session = getActiveSession();
    if (!session) throw new AppError('Nenhum caixa aberto no momento.');
    const raw = req.body && req.body.counted_amount;
    if (raw === null || raw === undefined || raw === '') throw new AppError('Informe o valor contado em dinheiro.');
    const counted = toMoney(raw, 'valor contado');

    const sum = sessionSummary(session);
    if (sum.pending_count > 0) {
        throw new AppError(`Ainda há ${sum.pending_count} comanda(s) sem pagamento (${sum.pending_total.toFixed(2).replace('.', ',')}). Cobre ou cancele antes de fechar o caixa.`, 409);
    }
    const difference = reais(cents(counted) - cents(sum.expected_cash));
    db.prepare(`UPDATE cash_sessions SET closed_at = ?, closing_counted = ?, closing_expected = ?, status = 'closed' WHERE id = ?`)
        .run(nowISO(), counted, sum.expected_cash, session.id);
    audit(req.user, 'caixa_fechado', { id: session.id, counted, expected: sum.expected_cash, difference });
    io.emit('cash:changed');
    const closed = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(session.id);
    res.json({ ...closed, total_sales: sum.total_sales, difference });
}));

app.post('/api/cash/movement', adminOnly, wrap((req, res) => {
    const session = getActiveSession();
    if (!session) throw new AppError('Nenhum caixa aberto.');
    const { type } = req.body || {};
    if (!['sangria', 'suprimento'].includes(type)) throw new AppError('Tipo de movimentação inválido.');
    const amount = toMoney(req.body.amount, 'valor', { allowZero: false });
    const description = cleanText(req.body.description, 120);
    if (type === 'sangria') {
        const { expected_cash } = sessionSummary(session);
        if (cents(amount) > cents(expected_cash)) throw new AppError(`A sangria (${amount.toFixed(2)}) é maior que o dinheiro esperado no caixa (${expected_cash.toFixed(2)}).`);
    }
    db.prepare(`INSERT INTO cash_movements (cash_session_id, type, amount, description, created_at, staff_name)
                VALUES (?, ?, ?, ?, ?, ?)`).run(session.id, type, amount, description, nowISO(), req.user.name);
    audit(req.user, `caixa_${type}`, { amount, description });
    res.status(201).json({ success: true });
}));

// ---------- Vendas e pedidos ----------
function loadSale(id) {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale) return null;
    sale.items = db.prepare(`
        SELECT si.*, p.name AS product_name, c.name AS category_name
        FROM sale_items si
        LEFT JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE si.sale_id = ?
        ORDER BY si.id
    `).all(id);
    return sale;
}

/**
 * Valida itens, confere estoque (somando itens repetidos do mesmo produto),
 * grava a venda e baixa o estoque. Tudo dentro de uma transação.
 */
const createSaleTransaction = db.transaction((input) => {
    const session = getActiveSession();
    if (!session) throw new AppError('O caixa está fechado. Peça para a gerência abrir o caixa.');

    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new AppError('O pedido está vazio.');
    if (items.length > 100) throw new AppError('Pedido com itens demais.');

    const needed = new Map(); // product_id -> quantidade total
    const resolved = [];
    for (const item of items) {
        const productId = toInt(item.product_id, 'produto', { min: 1 });
        const qty = toInt(item.quantity, 'quantidade', { min: 1, max: 999 });
        const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
        if (!product) throw new AppError(`Produto #${productId} não encontrado.`);
        needed.set(productId, (needed.get(productId) || 0) + qty);
        if (product.track_stock && product.stock < needed.get(productId)) {
            throw new AppError(`Estoque insuficiente de "${product.name}". Disponível: ${product.stock}.`);
        }
        resolved.push({
            product_id: product.id,
            product_name: product.name,
            quantity: qty,
            unit_price: product.sale_price,
            unit_cost: product.cost_price || 0,
            track_stock: product.track_stock,
            total_price: reais(cents(product.sale_price) * qty),
            notes: cleanText(item.notes, 140) || null,
        });
    }

    const total = sumMoney(resolved, (i) => i.total_price);
    const discount = input.discount ? toMoney(input.discount, 'desconto') : 0;
    if (cents(discount) > cents(total)) throw new AppError('O desconto não pode ser maior que o total.');
    const final_amount = reais(cents(total) - cents(discount));

    let amount_paid = null, change_given = null, paid_at = null;
    if (input.payment_method !== 'pendente') {
        if (!PAYMENT_METHODS.includes(input.payment_method)) throw new AppError('Forma de pagamento inválida.');
        paid_at = nowISO();
        if (input.payment_method === 'dinheiro') {
            amount_paid = input.amount_paid === undefined || input.amount_paid === null || input.amount_paid === ''
                ? final_amount : toMoney(input.amount_paid, 'valor recebido');
            if (cents(amount_paid) < cents(final_amount)) throw new AppError('O valor recebido é menor que o total.');
            change_given = reais(cents(amount_paid) - cents(final_amount));
        } else {
            amount_paid = final_amount;
            change_given = 0;
        }
    }

    const info = db.prepare(`
        INSERT INTO sales (total, discount, final_amount, payment_method, cash_session_id, created_at,
                           status, origin, table_label, people, staff_name, kitchen_status,
                           paid_at, paid_by, amount_paid, change_given)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(total, discount, final_amount, input.payment_method, session.id, nowISO(),
        input.origin, input.table_label || null, input.people || null, input.staff_name, input.kitchen_status || null,
        paid_at, paid_at ? input.staff_name : null, amount_paid, change_given);

    const saleId = info.lastInsertRowid;
    const insItem = db.prepare(`INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total_price, notes, unit_cost)
                                VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND track_stock = 1');
    for (const r of resolved) insItem.run(saleId, r.product_id, r.quantity, r.unit_price, r.total_price, r.notes, r.unit_cost);
    for (const [productId, qty] of needed) {
        const changed = decStock.run(qty, productId).changes;
        if (changed) logMovement(productId, 'venda', -qty, { saleId, user: { name: input.staff_name } });
    }

    return loadSale(saleId);
});

// Venda direta no PDV (balcão), já paga.
app.post('/api/sales', adminOnly, wrap((req, res) => {
    const b = req.body || {};
    const sale = createSaleTransaction({
        items: b.items,
        discount: b.discount,
        payment_method: String(b.payment_method || '').toLowerCase(),
        amount_paid: b.amount_paid,
        origin: 'pdv',
        staff_name: req.user.name,
    });
    audit(req.user, 'venda', { id: sale.id, total: sale.final_amount, metodo: sale.payment_method });
    io.emit('stock:changed');
    res.status(201).json(sale);
}));

// Pedido de mesa lançado pela atendente: vai para a cozinha e fica como comanda a receber.
app.post('/api/orders', anyStaff, wrap((req, res) => {
    const b = req.body || {};
    const table_label = cleanText(b.table_label, 40);
    if (!table_label) throw new AppError('Informe a mesa ou o nome do cliente.');
    const people = b.people ? toInt(b.people, 'pessoas', { min: 1, max: 99 }) : null;
    const order = createSaleTransaction({
        items: b.items,
        payment_method: 'pendente',
        origin: 'mesa',
        table_label,
        people,
        staff_name: req.user.name,
        kitchen_status: 'novo',
    });
    audit(req.user, 'pedido_mesa', { id: order.id, mesa: table_label, total: order.final_amount });
    io.emit('order:new', order);
    io.emit('stock:changed');
    res.status(201).json(order);
}));

// Pedidos que estão na cozinha ou prontos para entregar.
app.get('/api/kitchen/orders', anyStaff, wrap((req, res) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const ids = db.prepare(`
        SELECT id FROM sales
        WHERE status = 'active' AND kitchen_status IN ('novo', 'preparando', 'pronto') AND created_at >= ?
        ORDER BY created_at ASC
    `).all(since);
    res.json(ids.map((r) => loadSale(r.id)));
}));

const KITCHEN_FLOW = {
    novo: ['preparando', 'pronto'],
    preparando: ['pronto', 'novo'],
    pronto: ['entregue', 'preparando'],
};

app.post('/api/orders/:id/status', anyStaff, wrap((req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    const next = String((req.body && req.body.status) || '');
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale || !sale.kitchen_status) throw new AppError('Pedido não encontrado.', 404);
    if (sale.status === 'cancelled') throw new AppError('Este pedido foi cancelado.');
    if (sale.kitchen_status === next) return res.json(loadSale(id));
    if (!(KITCHEN_FLOW[sale.kitchen_status] || []).includes(next)) {
        throw new AppError(`Não é possível mudar de "${sale.kitchen_status}" para "${next}".`);
    }
    const now = nowISO();
    db.prepare(`UPDATE sales SET kitchen_status = ?,
                    ready_at = CASE WHEN ? = 'pronto' THEN ? ELSE ready_at END,
                    delivered_at = CASE WHEN ? = 'entregue' THEN ? ELSE delivered_at END
                WHERE id = ?`).run(next, next, now, next, now, id);
    const order = loadSale(id);
    io.emit('order:update', order);
    res.json(order);
}));

// Comandas abertas (pedidos de mesa ainda não pagos) do caixa atual.
app.get('/api/orders/open', adminOnly, wrap((req, res) => {
    const session = getActiveSession();
    if (!session) return res.json([]);
    const ids = db.prepare(`
        SELECT id FROM sales
        WHERE cash_session_id = ? AND status = 'active' AND payment_method = 'pendente'
        ORDER BY created_at ASC
    `).all(session.id);
    res.json(ids.map((r) => loadSale(r.id)));
}));

// Cobra uma ou mais comandas (ex.: todas as rodadas de uma mesa) com uma forma de pagamento.
app.post('/api/orders/pay', adminOnly, wrap((req, res) => {
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map((x) => toInt(x, 'comanda', { min: 1 })))] : [];
    if (!ids.length) throw new AppError('Nenhuma comanda selecionada.');
    const method = String(b.payment_method || '').toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) throw new AppError('Forma de pagamento inválida.');

    const result = db.transaction(() => {
        const session = getActiveSession();
        if (!session) throw new AppError('O caixa está fechado.');
        const orders = ids.map((id) => db.prepare('SELECT * FROM sales WHERE id = ?').get(id));
        for (const o of orders) {
            if (!o || o.status !== 'active' || o.payment_method !== 'pendente') {
                throw new AppError('Uma das comandas já foi paga ou cancelada. Atualize a tela.');
            }
            if (o.cash_session_id !== session.id) throw new AppError('Comanda de outro caixa.');
        }
        const total = sumMoney(orders, (o) => o.final_amount);
        let paid = total;
        if (method === 'dinheiro' && b.amount_paid !== undefined && b.amount_paid !== null && b.amount_paid !== '') {
            paid = toMoney(b.amount_paid, 'valor recebido');
            if (cents(paid) < cents(total)) throw new AppError('O valor recebido é menor que o total.');
        }
        const change = reais(cents(paid) - cents(total));
        const now = nowISO();
        const upd = db.prepare(`UPDATE sales SET payment_method = ?, paid_at = ?, paid_by = ?, amount_paid = ?, change_given = ?
                                WHERE id = ?`);
        // O troco fica registrado na primeira comanda; as demais recebem o valor exato.
        orders.forEach((o, i) => upd.run(method, now, req.user.name,
            i === 0 ? reais(cents(o.final_amount) + cents(change)) : o.final_amount, i === 0 ? change : 0, o.id));
        return { ids, total, payment_method: method, amount_paid: paid, change_given: change };
    })();

    audit(req.user, 'comanda_paga', result);
    io.emit('orders:paid', { ids: result.ids });
    res.json(result);
}));

app.get('/api/sales', adminOnly, wrap((req, res) => {
    // Filtra pelo dia no horário local do computador (ex.: Manaus).
    let start, end;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.query.date || ''));
    if (m) {
        start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
        const d = new Date();
        start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const sales = db.prepare(`
        SELECT s.*,
               (SELECT COALESCE(SUM(quantity), 0) FROM sale_items WHERE sale_id = s.id) AS items_count
        FROM sales s
        WHERE s.created_at >= ? AND s.created_at < ?
        ORDER BY s.created_at DESC
        LIMIT 1000
    `).all(start.toISOString(), end.toISOString());
    res.json(sales);
}));

app.get('/api/sales/:id', adminOnly, wrap((req, res) => {
    const sale = loadSale(toInt(req.params.id, 'id', { min: 1 }));
    if (!sale) throw new AppError('Venda não encontrada.', 404);
    res.json(sale);
}));

app.post('/api/sales/:id/cancel', adminOnly, wrap((req, res) => {
    const id = toInt(req.params.id, 'id', { min: 1 });
    db.transaction(() => {
        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
        if (!sale) throw new AppError('Venda não encontrada.', 404);
        if (sale.status === 'cancelled') throw new AppError('Esta venda já está cancelada.');
        const session = getActiveSession();
        if (!session || sale.cash_session_id !== session.id) {
            throw new AppError('Só é possível cancelar vendas do caixa que está aberto agora.');
        }
        db.prepare(`UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?,
                        kitchen_status = CASE WHEN kitchen_status IS NULL THEN NULL ELSE 'cancelado' END
                    WHERE id = ?`).run(nowISO(), req.user.name, id);
        const restock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND track_stock = 1');
        const back = new Map();
        for (const item of db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id)) {
            back.set(item.product_id, (back.get(item.product_id) || 0) + item.quantity);
        }
        for (const [productId, qty] of back) {
            if (restock.run(qty, productId).changes) {
                logMovement(productId, 'cancelamento', qty, { saleId: id, reason: `Venda #${id} cancelada`, user: req.user });
            }
        }
    })();
    const sale = loadSale(id);
    audit(req.user, 'venda_cancelada', { id, total: sale.final_amount, metodo: sale.payment_method });
    if (sale.kitchen_status) io.emit('order:update', sale);
    io.emit('stock:changed');
    res.json({ success: true });
}));

// ---------- Dados da loja (para impressão) ----------
app.get('/api/store', anyStaff, (req, res) => res.json(config.loja));

// ---------- Relatórios ----------
function parseLocalDate(str, fallback) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : fallback;
}
const localDay = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

app.get('/api/reports', adminOnly, wrap((req, res) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from = parseLocalDate(req.query.from, today);
    const toDay = parseLocalDate(req.query.to, from);
    if (toDay < from) throw new AppError('A data final é anterior à inicial.');
    const to = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1);
    if ((to - from) / 86400000 > 400) throw new AppError('Período máximo: 400 dias.');
    const range = [from.toISOString(), to.toISOString()];

    const sales = db.prepare('SELECT * FROM sales WHERE created_at >= ? AND created_at < ?').all(...range);
    const paid = sales.filter((s) => s.status === 'active' && s.payment_method !== 'pendente');
    const paidIds = new Set(paid.map((s) => s.id));

    // Totais (centavos)
    let revenue = 0, gross = 0, discounts = 0;
    const byMethod = {};
    const byStaff = {};
    const byDay = {};
    const byHour = Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 }));
    for (const s of paid) {
        const v = cents(s.final_amount);
        revenue += v; gross += cents(s.total); discounts += cents(s.discount);
        const m = byMethod[s.payment_method] || (byMethod[s.payment_method] = { count: 0, revenue: 0 });
        m.count++; m.revenue += v;
        const who = s.staff_name || '—';
        const st = byStaff[who] || (byStaff[who] = { name: who, orders: 0, revenue: 0, mesa: 0, balcao: 0 });
        st.orders++; st.revenue += v; s.origin === 'mesa' ? st.mesa++ : st.balcao++;
        const day = localDay(s.created_at);
        const d = byDay[day] || (byDay[day] = { day, count: 0, revenue: 0 });
        d.count++; d.revenue += v;
        const h = byHour[new Date(s.created_at).getHours()];
        h.count++; h.revenue += v;
    }

    // Produtos (custo gravado na venda; vendas antigas usam o custo atual)
    const items = db.prepare(`
        SELECT si.*, p.name AS product_name, p.cost_price AS current_cost, c.name AS category_name
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.created_at >= ? AND s.created_at < ?
    `).all(...range).filter((i) => paidIds.has(i.sale_id));
    const byProduct = {};
    let cost = 0;
    for (const i of items) {
        const p = byProduct[i.product_id] || (byProduct[i.product_id] = {
            product_id: i.product_id, name: i.product_name || `#${i.product_id}`, category: i.category_name || '', quantity: 0, revenue: 0, cost: 0,
        });
        const c = cents(i.unit_cost ?? i.current_cost ?? 0) * i.quantity;
        p.quantity += i.quantity; p.revenue += cents(i.total_price); p.cost += c;
        cost += c;
    }

    // Perdas de estoque no período (valor de custo)
    const losses = db.prepare(`
        SELECT m.*, p.name AS product_name FROM stock_movements m
        LEFT JOIN products p ON p.id = m.product_id
        WHERE m.type = 'perda' AND m.created_at >= ? AND m.created_at < ?
        ORDER BY m.created_at DESC
    `).all(...range);
    const lossValue = losses.reduce((sum, l) => sum + cents(l.unit_cost) * Math.abs(l.quantity), 0);

    const cancelled = sales.filter((s) => s.status === 'cancelled');
    const pending = sales.filter((s) => s.status === 'active' && s.payment_method === 'pendente');
    const R = (o) => ({ ...o, revenue: reais(o.revenue), ...(o.cost !== undefined ? { cost: reais(o.cost) } : {}) });

    res.json({
        from: localDay(from.toISOString()), to: localDay(toDay.toISOString()),
        totals: {
            revenue: reais(revenue), gross: reais(gross), discounts: reais(discounts),
            count: paid.length, ticket: paid.length ? reais(Math.round(revenue / paid.length)) : 0,
            cost: reais(cost), profit: reais(revenue - cost),
            cancelled_count: cancelled.length, cancelled_total: sumMoney(cancelled, (s) => s.final_amount),
            pending_count: pending.length, pending_total: sumMoney(pending, (s) => s.final_amount),
            losses_count: losses.length, losses_value: reais(lossValue),
        },
        by_method: Object.entries(byMethod).map(([method, v]) => ({ method, ...R(v) })).sort((a, b) => b.revenue - a.revenue),
        by_product: Object.values(byProduct).map(R).sort((a, b) => b.revenue - a.revenue),
        by_staff: Object.values(byStaff).map(R).sort((a, b) => b.revenue - a.revenue),
        by_day: Object.values(byDay).map(R).sort((a, b) => a.day.localeCompare(b.day)),
        by_hour: byHour.map((h, hour) => ({ hour, count: h.count, revenue: reais(h.revenue) })),
        losses: losses.map((l) => ({ ...l, value: reais(cents(l.unit_cost) * Math.abs(l.quantity)) })),
    });
}));

// API desconhecida
app.use('/api', (req, res, next) => next(new AppError('Rota não encontrada.', 404)));

// Tratamento global de erros
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (statusCode >= 500) console.error('[erro]', err);
    res.status(statusCode).json({
        error: statusCode >= 500 ? 'Erro interno no servidor. Veja o terminal para detalhes.' : err.message,
    });
});

// ---------- Tempo real (Socket.io) ----------
// Só aparelhos com login válido recebem os eventos.
io.use((socket, next) => {
    const user = sessions.get(socket.handshake.auth && socket.handshake.auth.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
});

// ---------- Backup automático ----------
function doBackup() {
    try {
        const r = db.runAutoBackup(config.pastaBackupExtra);
        console.log(`[backup] ${r.main}${r.extra ? ` (+ cópia em ${r.extra})` : ''}`);
    } catch (e) {
        console.error('[backup] Falhou:', e.message);
    }
}
doBackup();
setInterval(doBackup, Math.max(1, Number(config.backupACadaHoras) || 6) * 3600 * 1000);
setInterval(() => sessions.purge(), 3600 * 1000);

// ---------- Início ----------
// Placas de rede virtuais (VirtualBox, VMware, Hyper-V, WSL, Docker...) não servem para os celulares.
const VIRTUAL_NIC = /virtualbox|vmware|vethernet|hyper-v|wsl|docker|vbox|loopback|bluetooth|tailscale|zerotier|hamachi/i;
function localIPs() {
    const all = Object.entries(os.networkInterfaces())
        .flatMap(([name, list]) => (list || []).map((i) => ({ ...i, nic: name })))
        .filter((i) => i.family === 'IPv4' && !i.internal);
    const real = all.filter((i) => !VIRTUAL_NIC.test(i.nic) && !i.address.startsWith('169.254.') && !i.address.startsWith('192.168.56.'));
    return (real.length ? real : all).map((i) => i.address);
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n[ERRO] A porta ${PORT} já está em uso: o DUKAFE PDV provavelmente já está aberto em outra janela.`);
        console.error(`Acesse http://localhost:${PORT} ou feche a outra janela antes de abrir de novo.\n`);
        process.exit(2);
    }
    throw err;
});

server.listen(PORT, () => {
    console.log(`\nDUKAFE PDV rodando em http://localhost:${PORT}`);
    for (const ip of localIPs()) {
        console.log(`  Celulares (atendimento): http://${ip}:${PORT}/atendimento.html`);
        console.log(`  Cozinha:                 http://${ip}:${PORT}/cozinha.html`);
    }
    if (config.mostrarPinsAtendentes) {
        const list = auth.attendantReminders();
        if (list.length) {
            console.log('\n  PINs das atendentes:');
            for (const m of list) console.log(`    ${m.name.padEnd(24)} ${m.pin || '(troque com npm run equipe para aparecer aqui)'}`);
        }
    }
    if (firstPins) {
        console.log('\n================ PRIMEIRO USO ================');
        console.log(firstPins);
        console.log(`(Também salvo em ${auth.FIRST_PINS_FILE})`);
        console.log('==============================================\n');
    }
});
