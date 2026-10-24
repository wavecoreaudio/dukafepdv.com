const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

class AppError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const wrap = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const PAYMENT_METHODS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'];

const getActiveSession = () => {
    return db.prepare("SELECT * FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1").get();
};

// --------- Produtos ---------
app.get('/api/products', wrap((req, res) => {
    const search = req.query.search || '';
    let query = `
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        WHERE p.active = 1
    `;
    let params = [];
    if (search) {
        query += ` AND (p.name LIKE ? OR c.name LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
    }
    query += ` ORDER BY p.name ASC`;
    const products = db.prepare(query).all(...params);
    res.json(products);
}));

app.get('/api/products/top-sellers', wrap((req, res) => {
    const products = db.prepare(`
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        WHERE p.active = 1
        LIMIT 5
    `).all();
    res.json(products);
}));

app.post('/api/products', wrap((req, res) => {
    const { name, category_id, cost_price, sale_price, stock, min_stock } = req.body;
    if (!name || sale_price === undefined) {
        throw new AppError('Nome e preço de venda são obrigatórios.');
    }

    const stmt = db.prepare(`
        INSERT INTO products (name, category_id, cost_price, sale_price, stock, min_stock, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    const info = stmt.run(
        name, 
        category_id || null, 
        cost_price || 0, 
        sale_price, 
        stock || 0, 
        min_stock !== undefined ? min_stock : 5
    );

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(product);
}));

app.put('/api/products/:id', wrap((req, res) => {
    const { name, category_id, cost_price, sale_price, stock, min_stock } = req.body;
    const stmt = db.prepare(`
        UPDATE products 
        SET name = COALESCE(?, name),
            category_id = COALESCE(?, category_id),
            cost_price = COALESCE(?, cost_price),
            sale_price = COALESCE(?, sale_price),
            stock = COALESCE(?, stock),
            min_stock = COALESCE(?, min_stock)
        WHERE id = ? AND active = 1
    `);
    const info = stmt.run(name, category_id, cost_price, sale_price, stock, min_stock, req.params.id);
    if (!info.changes) throw new AppError('Produto não encontrado.', 404);
    
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(product);
}));

app.delete('/api/products/:id', wrap((req, res) => {
    const info = db.prepare('UPDATE products SET active = 0 WHERE id = ? AND active = 1').run(req.params.id);
    if (!info.changes) throw new AppError('Produto não encontrado.', 404);
    res.json({ success: true });
}));

app.post('/api/products/:id/restock', wrap((req, res) => {
    const qty = parseInt(req.body.quantity, 10);
    if (!(qty > 0)) throw new AppError('Informe uma quantidade maior que zero.');
    
    const info = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND active = 1').run(qty, req.params.id);
    if (!info.changes) throw new AppError('Produto não encontrado.', 404);
    
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(product);
}));

// --------- Categorias ---------
app.get('/api/categories', wrap((req, res) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    res.json(categories);
}));

app.post('/api/categories', wrap((req, res) => {
    const { name } = req.body;
    if (!name) throw new AppError('Nome da categoria é obrigatório.');
    try {
        const stmt = db.prepare('INSERT INTO categories (name) VALUES (?)');
        const info = stmt.run(name);
        res.status(201).json({ id: info.lastInsertRowid, name });
    } catch (e) {
        if (e.message.includes('UNIQUE')) {
            throw new AppError('Já existe uma categoria com este nome.');
        }
        throw e;
    }
}));

// --------- Caixa / Sessões ---------
app.get('/api/cash/status', wrap((req, res) => {
    const session = getActiveSession();
    res.json({ open: !!session, session: session || null });
}));

app.get('/api/cash/session', wrap((req, res) => {
    const session = getActiveSession();
    res.json(session || { status: 'closed' });
}));

app.get('/api/cash/summary', wrap((req, res) => {
    const session = getActiveSession();
    if (!session) {
        return res.json({ open: false, total_sales: 0, items_sold: 0 });
    }
    const summary = db.prepare(`
        SELECT COALESCE(SUM(final_amount), 0) as total_sales,
               COALESCE(SUM(si.quantity), 0) as items_sold
        FROM sales s
        LEFT JOIN sale_items si ON s.id = si.sale_id
        WHERE s.cash_session_id = ?
    `).get(session.id);

    res.json({
        open: true,
        session,
        total_sales: summary.total_sales,
        items_sold: summary.items_sold
    });
}));

app.post('/api/cash/open', wrap((req, res) => {
    const current = getActiveSession();
    if (current) throw new AppError('Já existe um caixa aberto.');

    const opening_balance = parseFloat(req.body.opening_balance) || 0;
    const opened_at = new Date().toISOString();

    const stmt = db.prepare('INSERT INTO cash_sessions (opening_balance, opened_at, status) VALUES (?, ?, ?)');
    const info = stmt.run(opening_balance, opened_at, 'open');

    const session = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(session);
}));

app.post('/api/cash/close', wrap((req, res) => {
    const session = getActiveSession();
    if (!session) throw new AppError('Nenhum caixa aberto no momento.');

    const closing_counted = parseFloat(req.body.closing_counted);
    if (isNaN(closing_counted)) throw new AppError('Informe o valor contado em caixa.');

    const salesSummary = db.prepare(`
        SELECT COALESCE(SUM(final_amount), 0) as total_sales 
        FROM sales 
        WHERE cash_session_id = ?
    `).get(session.id);

    const closing_expected = session.opening_balance + salesSummary.total_sales;
    const closed_at = new Date().toISOString();

    db.prepare(`
        UPDATE cash_sessions 
        SET closed_at = ?, closing_counted = ?, closing_expected = ?, status = 'closed'
        WHERE id = ?
    `).run(closed_at, closing_counted, closing_expected, session.id);

    const closedSession = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(session.id);
    res.json(closedSession);
}));

// --------- Vendas ---------
const createSaleTransaction = db.transaction((body) => {
    const session = getActiveSession();
    if (!session) throw new AppError('O caixa está fechado. Abra o caixa antes de realizar vendas.');

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new AppError('O carrinho está vazio.');
    
    const method = String(body.payment_method || '').toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) throw new AppError('Selecione uma forma de pagamento válida.');

    let total = 0;
    const resolvedItems = [];

    for (const item of items) {
        const prodId = parseInt(item.product_id, 10);
        const qty = parseInt(item.quantity, 10);
        if (!(qty > 0)) throw new AppError('Quantidade inválida para um dos itens.');

        const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(prodId);
        if (!product) throw new AppError(`Produto ID ${prodId} não encontrado.`);
        if (product.stock < qty) throw new AppError(`Estoque insuficiente para o produto: ${product.name}. Disponível: ${product.stock}`);

        const unit_price = product.sale_price;
        const total_price = unit_price * qty;
        total += total_price;

        resolvedItems.push({ product_id: product.id, quantity: qty, unit_price, total_price });
    }

    const discount = parseFloat(body.discount) || 0;
    const final_amount = Math.max(0, total - discount);
    const created_at = new Date().toISOString();

    const saleInfo = db.prepare(`
        INSERT INTO sales (total, discount, final_amount, payment_method, cash_session_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(total, discount, final_amount, method, session.id, created_at);

    const saleId = saleInfo.lastInsertRowid;
    const updateStockStmt = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    const insertItemStmt = db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const ri of resolvedItems) {
        insertItemStmt.run(saleId, ri.product_id, ri.quantity, ri.unit_price, ri.total_price);
        updateStockStmt.run(ri.quantity, ri.product_id);
    }

    return db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
});

app.post('/api/sales', wrap((req, res) => {
    const sale = createSaleTransaction(req.body);
    res.status(201).json(sale);
}));

app.get('/api/sales', wrap((req, res) => {
    const sales = db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 50').all();
    res.json(sales);
}));

// Tratamento global de erros
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message || 'Erro interno no servidor.' });
});

app.listen(PORT, () => {
    console.log(`DUKAFE PDV rodando em http://localhost:${PORT}`);
});