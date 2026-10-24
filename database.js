const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'dukafe.db'));
db.pragma('journal_mode = WAL;');
db.pragma('foreign_keys = ON;');

db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );

    INSERT OR IGNORE INTO categories (name) VALUES ('Bebidas Quentes');
    INSERT OR IGNORE INTO categories (name) VALUES ('Bebidas Geladas / Sucos');
    INSERT OR IGNORE INTO categories (name) VALUES ('Salgados');
    INSERT OR IGNORE INTO categories (name) VALUES ('Tapiocas');
    INSERT OR IGNORE INTO categories (name) VALUES ('Pastéis');
    INSERT OR IGNORE INTO categories (name) VALUES ('Sobremesas');

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

module.exports = db;