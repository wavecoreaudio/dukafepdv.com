/*
 * Equipe, PINs e sessões de login.
 *
 * Os PINs ficam em config/equipe.json (fora do Git), guardados como hash (scrypt),
 * nunca em texto puro. Para trocar PINs use:  npm run equipe
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(__dirname, 'config');
const TEAM_FILE = path.join(CONFIG_DIR, 'equipe.json');
const FIRST_PINS_FILE = path.join(CONFIG_DIR, 'PINS_INICIAIS.txt');

const ROLES = {
    admin: 'Gerência (PDV, caixa, estoque, histórico)',
    atendente: 'Atendimento e cozinha',
};

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
    return { salt, hash };
}

function checkPin(pin, member) {
    const { hash } = hashPin(pin, member.salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(member.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isValidPin(pin) {
    return /^\d{4,6}$/.test(String(pin));
}

function readTeam() {
    if (!fs.existsSync(TEAM_FILE)) return [];
    return JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
}

function writeTeam(team) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(TEAM_FILE, JSON.stringify(team, null, 2));
}

function randomPin(used) {
    let pin;
    do { pin = String(crypto.randomInt(0, 10000)).padStart(4, '0'); } while (used.has(pin));
    used.add(pin);
    return pin;
}

/**
 * Na primeira execução cria a equipe padrão com PINs NOVOS e aleatórios
 * (os PINs antigos estavam escritos no código e foram para o GitHub).
 */
function ensureTeam() {
    if (fs.existsSync(TEAM_FILE)) return null;
    const used = new Set();
    const defaults = [
        { name: 'Gerência', role: 'admin' },
        { name: 'Funcionária 1', role: 'atendente' },
        { name: 'Funcionária 2', role: 'atendente' },
        { name: 'Funcionária 3 (Extra)', role: 'atendente' },
    ];
    const lines = [];
    const team = defaults.map((m, i) => {
        const pin = randomPin(used);
        lines.push(`${m.name.padEnd(24)} PIN: ${pin}   (${m.role})`);
        const member = { id: `m${i + 1}`, name: m.name, role: m.role, ...hashPin(pin) };
        if (m.role === 'atendente') member.lembrete = pin;
        return member;
    });
    writeTeam(team);
    const text = [
        'DUKAFE PDV - PINs iniciais gerados automaticamente',
        '',
        ...lines,
        '',
        'Anote e entregue a cada pessoa, depois APAGUE este arquivo.',
        'Para trocar nomes/PINs: abra o terminal na pasta do sistema e rode:  npm run equipe',
    ].join('\n');
    fs.writeFileSync(FIRST_PINS_FILE, text);
    return text;
}

// ---------- Sessões ----------
const SESSION_HOURS = 16;

function createSessionStore(db) {
    const insert = db.prepare(`INSERT INTO auth_sessions (token, staff_id, staff_name, role, created_at, expires_at)
                               VALUES (?, ?, ?, ?, ?, ?)`);
    const find = db.prepare('SELECT * FROM auth_sessions WHERE token = ?');
    const remove = db.prepare('DELETE FROM auth_sessions WHERE token = ?');
    const purge = db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?');
    const removeByStaff = db.prepare('DELETE FROM auth_sessions WHERE staff_id = ?');

    return {
        create(member) {
            const token = crypto.randomBytes(32).toString('hex');
            const now = new Date();
            const exp = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
            insert.run(token, member.id, member.name, member.role, now.toISOString(), exp.toISOString());
            return { token, expires_at: exp.toISOString() };
        },
        get(token) {
            if (!token || typeof token !== 'string') return null;
            const s = find.get(token);
            if (!s) return null;
            if (s.expires_at < new Date().toISOString()) { remove.run(token); return null; }
            // Membro removido ou com papel alterado: invalida a sessão.
            const member = readTeam().find((m) => m.id === s.staff_id);
            if (!member || member.role !== s.role) { remove.run(token); return null; }
            return { token, id: member.id, name: member.name, role: member.role };
        },
        destroy(token) { remove.run(token); },
        destroyByStaff(id) { removeByStaff.run(id); },
        purge() { purge.run(new Date().toISOString()); },
    };
}

// ---------- Limite de tentativas de PIN (por IP) ----------
const attempts = new Map(); // ip -> { fails, until }

function loginBlockedFor(ip) {
    const a = attempts.get(ip);
    if (!a || !a.until) return 0;
    const ms = a.until - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

function registerFail(ip) {
    const a = attempts.get(ip) || { fails: 0, until: 0 };
    a.fails += 1;
    if (a.fails >= 5) {
        // 5 erros: bloqueia 30s, e dobra a cada novo erro (máx. 15 min)
        const seconds = Math.min(30 * 2 ** (a.fails - 5), 900);
        a.until = Date.now() + seconds * 1000;
    }
    attempts.set(ip, a);
}

function registerSuccess(ip) {
    attempts.delete(ip);
}

/**
 * PINs das atendentes para mostrar no terminal (o da gerência nunca é mostrado).
 * Se uma atendente ainda não tem o lembrete salvo, tenta recuperar do PINS_INICIAIS.txt,
 * conferindo com o hash para garantir que é o PIN atual.
 */
function attendantReminders() {
    const team = readTeam();
    let changed = false;
    const missing = team.filter((m) => m.role === 'atendente' && !m.lembrete);
    if (missing.length && fs.existsSync(FIRST_PINS_FILE)) {
        const pins = [...fs.readFileSync(FIRST_PINS_FILE, 'utf8').matchAll(/PIN:\s*(\d{4,6})/g)].map((x) => x[1]);
        for (const m of missing) {
            const pin = pins.find((p) => checkPin(p, m));
            if (pin) { m.lembrete = pin; changed = true; }
        }
    }
    for (const m of team) {
        if (m.role !== 'atendente' && m.lembrete) { delete m.lembrete; changed = true; }
    }
    if (changed) writeTeam(team);
    return team.filter((m) => m.role === 'atendente').map((m) => ({ name: m.name, pin: m.lembrete || null }));
}

function findMemberByPin(pin) {
    return readTeam().find((m) => checkPin(pin, m)) || null;
}

module.exports = {
    ROLES, TEAM_FILE, FIRST_PINS_FILE,
    hashPin, isValidPin, readTeam, writeTeam, ensureTeam, findMemberByPin, attendantReminders,
    createSessionStore, loginBlockedFor, registerFail, registerSuccess,
};
