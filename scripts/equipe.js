#!/usr/bin/env node
/*
 * Gerencia a equipe e os PINs do DUKAFE PDV.
 * Uso: abra o terminal na pasta do sistema e rode   npm run equipe
 * (não precisa parar o servidor; as mudanças valem no próximo login)
 */
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const auth = require('../auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

function pinInUse(team, pin, exceptId) {
    return team.some((m) => m.id !== exceptId && auth.hashPin(pin, m.salt).hash === m.hash);
}

function list(team) {
    console.log('\nEquipe atual:');
    team.forEach((m, i) => console.log(`  ${i + 1}. ${m.name}  [${m.role}]`));
    console.log('');
}

async function askPin(team, exceptId) {
    for (;;) {
        const pin = await ask('Novo PIN (4 a 6 números): ');
        if (!auth.isValidPin(pin)) { console.log('  PIN precisa ter de 4 a 6 números.'); continue; }
        if (/^(\d)\1+$/.test(pin) || ['1234', '4321', '0123', '123456'].includes(pin)) {
            console.log('  PIN fácil demais. Escolha outro.'); continue;
        }
        if (pinInUse(team, pin, exceptId)) { console.log('  Esse PIN já é de outra pessoa.'); continue; }
        return pin;
    }
}

async function askRole() {
    const r = await ask('Papel (1 = gerência/admin, 2 = atendente): ');
    return r === '1' ? 'admin' : 'atendente';
}

async function pick(team) {
    const n = parseInt(await ask('Número da pessoa: '), 10);
    return team[n - 1] || null;
}

async function main() {
    auth.ensureTeam();
    for (;;) {
        const team = auth.readTeam();
        list(team);
        console.log('1) Trocar PIN   2) Renomear   3) Adicionar pessoa   4) Remover pessoa   5) Mudar papel   0) Sair');
        const op = await ask('Escolha: ');
        if (op === '0' || op === '') break;
        if (op === '3') {
            const name = await ask('Nome: ');
            if (!name) continue;
            const role = await askRole();
            const pin = await askPin(team);
            const id = `m${Date.now()}`;
            team.push({ id, name: name.slice(0, 40), role, ...auth.hashPin(pin), ...(role === 'atendente' ? { lembrete: pin } : {}) });
            auth.writeTeam(team);
            console.log(`  ✔ ${name} adicionada(o).`);
            continue;
        }
        const m = await pick(team);
        if (!m) { console.log('  Número inválido.'); continue; }
        if (op === '1') {
            const pin = await askPin(team, m.id);
            Object.assign(m, auth.hashPin(pin));
            if (m.role === 'atendente') m.lembrete = pin; else delete m.lembrete;
            console.log(`  ✔ PIN de ${m.name} trocado.`);
        } else if (op === '2') {
            const name = await ask('Novo nome: ');
            if (name) m.name = name.slice(0, 40);
        } else if (op === '4') {
            if (m.role === 'admin' && team.filter((x) => x.role === 'admin').length === 1) {
                console.log('  Não dá para remover o único administrador.'); continue;
            }
            if ((await ask(`Remover ${m.name}? (s/n): `)).toLowerCase() !== 's') continue;
            team.splice(team.indexOf(m), 1);
        } else if (op === '5') {
            const role = await askRole();
            if (m.role === 'admin' && role !== 'admin' && team.filter((x) => x.role === 'admin').length === 1) {
                console.log('  Precisa existir pelo menos um administrador.'); continue;
            }
            m.role = role;
            if (role !== 'atendente') delete m.lembrete;
            else console.log('  Obs.: troque o PIN dela (opção 1) para ele aparecer no terminal do sistema.');
        }
        auth.writeTeam(team);
    }
    const first = auth.FIRST_PINS_FILE;
    if (fs.existsSync(first)) {
        const del = await ask(`\nApagar o arquivo ${path.basename(first)} com os PINs iniciais? (s/n): `);
        if (del.toLowerCase() === 's') fs.unlinkSync(first);
    }
    rl.close();
}

main().catch((e) => { console.error(e); rl.close(); process.exit(1); });
