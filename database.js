/*
 * Banco de dados do DUKAFE PDV (SQLite via better-sqlite3).
 *
 * As alterações de estrutura são feitas por "migrações" numeradas (PRAGMA user_version).
 * Antes de qualquer migração é feita uma cópia completa do banco em data/backups/.
 * Isso permite atualizar o sistema sem perder os dados que já existem.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
const backupDir = path.join(dataDir, 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const db = new Database(path.join(dataDir, 'dukafe.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ---------- Utilidades ----------
function columnExists(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function addColumn(table, column, definition) {
    if (!columnExists(table, column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Copia o banco inteiro para um arquivo (consistente mesmo com o sistema em uso). */
function backupTo(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('VACUUM INTO ?').run(filePath);
    return filePath;
}

// ---------- Estrutura base (versão original) ----------
db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        cost_price REAL DEFAULT 0,
        sale_price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cash_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opening_balance REAL NOT NULL DEFAULT 0,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        closing_counted REAL,
        closing_expected REAL,
        status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total REAL NOT NULL,
        discount REAL DEFAULT 0,
        final_amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        cash_session_id INTEGER REFERENCES cash_sessions(id),
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL
    );
`);

const categoryCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (categoryCount === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
    ['Bebidas Quentes', 'Bebidas Geladas / Sucos', 'Salgados', 'Tapiocas', 'Pastéis', 'Sobremesas'].forEach((n) => ins.run(n));
}

// ---------- Migrações ----------
const migrations = [
    // 1: correções da Fase 1 (status de venda, comandas, cozinha, movimentos, sessões, auditoria)
    () => {
        addColumn('sales', 'status', "TEXT NOT NULL DEFAULT 'active'");     // active | cancelled
        addColumn('sales', 'origin', "TEXT NOT NULL DEFAULT 'pdv'");        // pdv | mesa
        addColumn('sales', 'table_label', 'TEXT');
        addColumn('sales', 'people', 'INTEGER');
        addColumn('sales', 'staff_name', 'TEXT');
        addColumn('sales', 'kitchen_status', 'TEXT');                       // novo | preparando | pronto | entregue | cancelado
        addColumn('sales', 'ready_at', 'TEXT');
        addColumn('sales', 'delivered_at', 'TEXT');
        addColumn('sales', 'paid_at', 'TEXT');
        addColumn('sales', 'paid_by', 'TEXT');
        addColumn('sales', 'amount_paid', 'REAL');
        addColumn('sales', 'change_given', 'REAL');
        addColumn('sales', 'cancelled_at', 'TEXT');
        addColumn('sales', 'cancelled_by', 'TEXT');
        addColumn('sale_items', 'notes', 'TEXT');

        db.exec(`
            CREATE TABLE IF NOT EXISTS cash_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cash_session_id INTEGER REFERENCES cash_sessions(id),
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY,
                staff_id TEXT NOT NULL,
                staff_name TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                staff_name TEXT,
                action TEXT NOT NULL,
                details TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sales_session ON sales(cash_session_id);
            CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
            CREATE INDEX IF NOT EXISTS idx_sales_kitchen ON sales(kitchen_status);
            CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
        `);
        addColumn('cash_movements', 'staff_name', 'TEXT');

        // Pedidos antigos das atendentes (gravados como "pendente") viram comandas já entregues.
        db.exec(`UPDATE sales SET origin = 'mesa', kitchen_status = 'entregue' WHERE payment_method = 'pendente'`);
    },

    // 2: Fase 2 (produto sem controle de estoque, custo na venda, movimentos de estoque)
    () => {
        addColumn('products', 'track_stock', 'INTEGER NOT NULL DEFAULT 1'); // 0 = feito na hora, não controla
        addColumn('sale_items', 'unit_cost', 'REAL');                       // custo do produto no momento da venda
        db.exec(`
            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL REFERENCES products(id),
                type TEXT NOT NULL,          -- entrada | venda | cancelamento | perda | ajuste
                quantity INTEGER NOT NULL,   -- positivo entra, negativo sai
                stock_after INTEGER,
                unit_cost REAL,
                reason TEXT,
                sale_id INTEGER,
                staff_name TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_stockmov_product ON stock_movements(product_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_stockmov_created ON stock_movements(created_at);
        `);
        // Saldo inicial: registra o estoque atual de cada produto como ponto de partida do histórico.
        db.exec(`
            INSERT INTO stock_movements (product_id, type, quantity, stock_after, unit_cost, reason, created_at)
            SELECT id, 'ajuste', 0, stock, cost_price, 'Saldo inicial (início do histórico)', '${new Date().toISOString()}'
            FROM products
        `);
    },
];

const currentVersion = db.pragma('user_version', { simple: true });
if (currentVersion < migrations.length) {
    const hasData = db.prepare('SELECT COUNT(*) AS n FROM sales').get().n > 0
        || db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0;
    if (hasData) {
        const file = backupTo(path.join(backupDir, `antes-da-atualizacao_v${currentVersion}_${timestamp()}.db`));
        console.log(`[banco] Backup antes da atualização salvo em: ${file}`);
    }
    for (let v = currentVersion; v < migrations.length; v++) {
        db.transaction(() => {
            migrations[v]();
            db.pragma(`user_version = ${v + 1}`);
        })();
        console.log(`[banco] Estrutura atualizada para a versão ${v + 1}.`);
    }
}

// ---------- Backup automático ----------
const KEEP_BACKUPS = 30;

function pruneBackups(dir) {
    const files = fs.readdirSync(dir)
        .filter((f) => /^auto_.*\.db$/.test(f))
        .sort();
    while (files.length > KEEP_BACKUPS) {
        fs.unlinkSync(path.join(dir, files.shift()));
    }
}

/**
 * Faz um backup automático em data/backups e, se configurado, em uma pasta extra
 * (ex.: uma pasta do OneDrive ou um pendrive). Mantém os 30 mais recentes.
 */
function runAutoBackup(extraDir) {
    const name = `auto_${timestamp()}.db`;
    const main = backupTo(path.join(backupDir, name));
    pruneBackups(backupDir);
    let extra = null;
    if (extraDir) {
        try {
            fs.mkdirSync(extraDir, { recursive: true });
            extra = path.join(extraDir, name);
            fs.copyFileSync(main, extra);
            pruneBackups(extraDir);
        } catch (e) {
            console.warn(`[backup] Não foi possível copiar para a pasta extra (${extraDir}): ${e.message}`);
            extra = null;
        }
    }
    return { main, extra };
}

module.exports = db;
module.exports.runAutoBackup = runAutoBackup;
module.exports.backupDir = backupDir;
