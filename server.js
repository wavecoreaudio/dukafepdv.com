const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

const getActiveSession = () => {
    return db.prepare("SELECT * FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1").get();
};

// --------- Autenticação por PIN ---------
const STAFF_MEMBERS = [
    { name: 'Funcionária 1', pin: '1080', role: 'garçonete' },
    { name: 'Funcionária 2', pin: '2080', role: 'garçonete' },
    { name: 'Funcionária 3 (Extra)', pin: '3080', role: 'garçonete' },
    { name: 'Gerência (Lucas)', pin: '1848', role: 'admin' }
];

app.post('/api/auth/login', wrap((req, res) => {
    const { pin } = req.body;
    const staff = STAFF_MEMBERS.find(s => s.pin === pin);
    if (!staff) {
        throw new AppError('PIN inválido. Tente novamente.', 401);
    }
    res.json({ success: true, staff: { name: staff.name, role: staff.role } });
}));

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
        return res.json({ open: false, session: null });
    }

    const sales = db.prepare(`
        SELECT * FROM sales 
        WHERE cash_session_id = ?
    `).all(session.id);

    let movements = [];
    try {
        movements = db.prepare(`
            SELECT * FROM cash_movements 
            WHERE cash_session_id = ? 
            ORDER BY created_at DESC
        `).all(session.id);
    } catch (e) {
        movements = [];
    }

    const sales_by_method = { dinheiro: 0, pix: 0, debito: 0, credito: 0 };
    const sales_count_by_method = { dinheiro: 0, pix: 0, debito: 0, credito: 0 };
    
    let total_sales = 0;
    let cancelled_count = 0;

    sales.forEach(s => {
        const method = (s.payment_method || '').toLowerCase();
        let key = method;
        if (method === 'cartao_credito') key = 'credito';
        if (method === 'cartao_debito') key = 'debito';

        if (sales_by_method.hasOwnProperty(key)) {
            sales_by_method[key] += s.final_amount;
            sales_count_by_method[key] += 1;
        }
        total_sales += s.final_amount;
    });

    let sangrias = 0;
    let suprimentos = 0;
    movements.forEach(m => {
        if (m.type === 'sangria') sangrias += m.amount;
        if (m.type === 'suprimento') suprimentos += m.amount;
    });

    const expected_cash = session.opening_balance + sales_by_method.dinheiro + suprimentos - sangrias;

    res.json({
        open: true,
        session,
        sales_by_method,
        sales_count_by_method,
        total_sales,
        sales_count: sales.length,
        cancelled_count,
        sangrias,
        suprimentos,
        expected_cash,
        movements
    });
}));

app.get('/api/cash/sessions', wrap((req, res) => {
    const sessions = db.prepare(`
        SELECT cs.*, 
               (SELECT COALESCE(SUM(final_amount), 0) FROM sales WHERE cash_session_id = cs.id) as total_sales,
               (SELECT COUNT(*) FROM sales WHERE cash_session_id = cs.id) as sales_count
        FROM cash_sessions cs
        ORDER BY cs.opened_at DESC
        LIMIT 50
    `).all();
    res.json(sessions);
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

    const counted_amount = parseFloat(req.body.counted_amount);
    if (isNaN(counted_amount)) throw new AppError('Informe o valor contado em caixa.');

    const salesSummary = db.prepare(`
        SELECT COALESCE(SUM(final_amount), 0) as total_sales 
        FROM sales 
        WHERE cash_session_id = ?
    `).get(session.id);

    let movements = [];
    try {
        movements = db.prepare('SELECT * FROM cash_movements WHERE cash_session_id = ?').all(session.id);
    } catch (e) {}

    let sangrias = 0;
    let suprimentos = 0;
    movements.forEach(m => {
        if (m.type === 'sangria') sangrias += m.amount;
        if (m.type === 'suprimento') suprimentos += m.amount;
    });

    const sales = db.prepare('SELECT * FROM sales WHERE cash_session_id = ?').all(session.id);
    let dinheiro = 0;
    sales.forEach(s => {
        if ((s.payment_method || '').toLowerCase() === 'dinheiro') dinheiro += s.final_amount;
    });

    const expected_cash = session.opening_balance + dinheiro + suprimentos - sangrias;
    const difference = Math.round((counted_amount - expected_cash) * 100) / 100;
    const closed_at = new Date().toISOString();

    db.prepare(`
        UPDATE cash_sessions 
        SET closed_at = ?, closing_counted = ?, closing_expected = ?, status = 'closed'
        WHERE id = ?
    `).run(closed_at, counted_amount, expected_cash, session.id);

    const closedSession = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(session.id);
    res.json({ ...closedSession, total_sales: salesSummary.total_sales, difference });
}));

app.post('/api/cash/movement', wrap((req, res) => {
    const session = getActiveSession();
    if (!session) throw new AppError('Nenhum caixa aberto.');

    const { type, amount, description } = req.body;
    if (!['sangria', 'suprimento'].includes(type)) throw new AppError('Tipo de movimentação inválido.');
    const val = parseFloat(amount);
    if (!(val > 0)) throw new AppError('Valor inválido.');

    try {
        db.prepare(`
            INSERT INTO cash_movements (cash_session_id, type, amount, description, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(session.id, type, val, description || '', new Date().toISOString());
    } catch (e) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS cash_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cash_session_id INTEGER,
                type TEXT,
                amount REAL,
                description TEXT,
                created_at TEXT
            )
        `);
        db.prepare(`
            INSERT INTO cash_movements (cash_session_id, type, amount, description, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(session.id, type, val, description || '', new Date().toISOString());
    }

    res.status(201).json({ success: true });
}));

// --------- Vendas / Pedidos para Cozinha ---------
const createSaleTransaction = db.transaction((body) => {
    const session = getActiveSession();
    if (!session) throw new AppError('O caixa está fechado. Abra o caixa antes de realizar vendas.');

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new AppError('O carrinho está vazio.');
    
    const method = String(body.payment_method || 'pendente').toLowerCase();

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

        resolvedItems.push({ product_id: product.id, quantity: qty, unit_price, total_price, product_name: product.name });
    }

    const discount = parseFloat(body.discount) || 0;
    const final_amount = Math.max(0, total - discount);
    const created_at = new Date().toISOString();
    const table_number = body.table_number || 'Balcão';

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

    return {
        id: saleId,
        table_number,
        items: resolvedItems,
        created_at,
        status: 'active'
    };
});

app.post('/api/orders', wrap((req, res) => {
    const order = createSaleTransaction(req.body);
    io.emit('new-order', order);
    res.status(201).json(order);
}));

app.post('/api/sales', wrap((req, res) => {
    const sale = createSaleTransaction(req.body);
    res.status(201).json(sale);
}));

app.get('/api/sales', wrap((req, res) => {
    const sales = db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 50').all();
    res.json(sales);
}));

app.get('/api/sales/:id', wrap((req, res) => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!sale) throw new AppError('Venda não encontrada.', 404);

    const items = db.prepare(`
        SELECT si.*, p.name as product_name 
        FROM sale_items si 
        LEFT JOIN products p ON si.product_id = p.id 
        WHERE si.sale_id = ?
    `).all(sale.id);

    res.json({ ...sale, items });
}));

app.post('/api/sales/:id/cancel', wrap((req, res) => {
    const saleId = req.params.id;
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) throw new AppError('Venda não encontrada.', 404);
    if (sale.status === 'cancelled') throw new AppError('Esta venda já está cancelada.');

    const cancelTransaction = db.transaction(() => {
        db.prepare("UPDATE sales SET status = 'cancelled' WHERE id = ?").run(saleId);
        const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
        const restockStmt = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const item of items) {
            restockStmt.run(item.quantity, item.product_id);
        }
    });

    cancelTransaction();
    res.json({ success: true });
}));

// --------- Socket.io Comunicação em Tempo Real ---------
io.on('connection', (socket) => {
    // Quando a cozinha clica em pronto, retransmite o aviso para os telemóveis das garçonetes
    socket.on('order-ready', (order) => {
        io.emit('order-ready', order);
    });
});

// Tratamento global de erros
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message || 'Erro interno no servidor.' });
});

server.listen(PORT, () => {
    console.log(`DUKAFE PDV rodando em http://localhost:${PORT}`);
});