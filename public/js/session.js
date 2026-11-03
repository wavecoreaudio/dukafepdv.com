/*
 * Login por PIN e sessão — usado por TODAS as telas (PDV, caixa, estoque, histórico,
 * atendimento e cozinha).
 *
 *   await Session.ensure(['admin'])   -> mostra o teclado de PIN se precisar e devolve o usuário
 *   Session.fetch(url, opts)          -> fetch com o token; se a sessão expirar, pede o PIN de novo
 *   Session.logout()
 */
(function () {
  const KEY = 'dukafe_session';
  let current = null;
  let pendingLogin = null;

  function load() {
    try { current = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { current = null; }
    return current;
  }
  function save(s) {
    current = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) { /* sem storage */ }
  }

  const css = `
  #pin-overlay{position:fixed;inset:0;z-index:9999;background:rgba(26,18,13,.97);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#F5E6D3;padding:16px}
  #pin-overlay .box{width:100%;max-width:340px;text-align:center}
  #pin-overlay h2{margin:0 0 4px;font-size:24px;color:#d4a373}
  #pin-overlay .sub{opacity:.75;font-size:14px;margin-bottom:22px;min-height:20px}
  #pin-overlay .dots{display:flex;justify-content:center;gap:14px;margin-bottom:10px}
  #pin-overlay .dot{width:18px;height:18px;border-radius:50%;border:2px solid #d4a373}
  #pin-overlay .dot.on{background:#d4a373}
  #pin-overlay .err{color:#ff9c8f;font-weight:600;min-height:22px;margin-bottom:12px;font-size:14px}
  #pin-overlay .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  #pin-overlay .pad button{height:68px;font-size:26px;font-weight:700;border-radius:14px;border:1px solid #5e4034;background:#392620;color:#F5E6D3;cursor:pointer;touch-action:manipulation}
  #pin-overlay .pad button:active{background:#4d3328}
  #pin-overlay .pad .act{font-size:16px;background:transparent}
  #pin-overlay .shake{animation:pinshake .35s}
  @keyframes pinshake{20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`;

  function showPinPad(message) {
    if (pendingLogin) return pendingLogin;
    pendingLogin = new Promise((resolve) => {
      if (!document.getElementById('pin-style')) {
        const st = document.createElement('style');
        st.id = 'pin-style';
        st.textContent = css;
        document.head.appendChild(st);
      }
      const ov = document.createElement('div');
      ov.id = 'pin-overlay';
      ov.innerHTML = `
        <div class="box">
          <h2>☕ DUKAFE</h2>
          <div class="sub"></div>
          <div class="dots">${'<span class="dot"></span>'.repeat(4)}</div>
          <div class="err"></div>
          <div class="pad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-n="${n}">${n}</button>`).join('')}
            <button class="act" data-a="clear">Limpar</button><button data-n="0">0</button><button class="act" data-a="back">⌫</button>
          </div>
        </div>`;
      ov.querySelector('.sub').textContent = message || 'Digite seu PIN';
      document.body.appendChild(ov);

      let pin = '';
      let busy = false;
      const dots = ov.querySelectorAll('.dot');
      const err = ov.querySelector('.err');
      const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));

      async function submit() {
        busy = true;
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Não foi possível entrar.');
          save({ token: data.token, staff: data.staff, expires_at: data.expires_at });
          ov.remove();
          document.removeEventListener('keydown', onKey, true);
          pendingLogin = null;
          resolve(data.staff);
        } catch (e) {
          err.textContent = e.message.includes('fetch') ? 'Sem conexão com o servidor.' : e.message;
          const box = ov.querySelector('.box');
          box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
          pin = ''; paint();
        } finally {
          busy = false;
        }
      }
      function press(n) {
        if (busy || pin.length >= 4) return;
        pin += n; err.textContent = ''; paint();
        if (pin.length === 4) submit();
      }
      function onKey(e) {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
        else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); }
        e.stopPropagation();
      }
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.n !== undefined) press(b.dataset.n);
        else if (b.dataset.a === 'back') { pin = pin.slice(0, -1); paint(); }
        else if (b.dataset.a === 'clear') { pin = ''; paint(); }
      });
      document.addEventListener('keydown', onKey, true);
    });
    return pendingLogin;
  }

  async function ensure(roles) {
    load();
    while (true) {
      if (current && current.token) {
        try {
          const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${current.token}` } });
          if (res.ok) {
            const { staff } = await res.json();
            current.staff = staff;
            save(current);
            if (!roles || !roles.length || roles.includes(staff.role)) return staff;
            save(null);
            await showPinPad(`Esta tela é da gerência. ${staff.name}, use o PIN da gerência.`);
            continue;
          }
          if (res.status === 401) save(null);
        } catch (e) {
          // servidor fora do ar: mantém a sessão e deixa a tela mostrar o erro
          return current.staff;
        }
      }
      await showPinPad(roles && roles.includes('admin') && roles.length === 1 ? 'PIN da gerência' : 'Digite seu PIN');
    }
  }

  async function authFetch(url, options = {}) {
    load();
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    if (current && current.token) opts.headers.Authorization = `Bearer ${current.token}`;
    let res = await fetch(url, opts);
    if (res.status === 401 && !url.includes('/api/auth/')) {
      save(null);
      await showPinPad('Sessão expirada. Digite seu PIN.');
      opts.headers.Authorization = `Bearer ${current.token}`;
      res = await fetch(url, opts);
    }
    return res;
  }

  async function logout() {
    load();
    if (current && current.token) {
      try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${current.token}` } }); } catch (e) { /* ok */ }
    }
    save(null);
    location.reload();
  }

  /** Conecta ao Socket.io com o token. Se a sessão cair, pede PIN e reconecta. */
  function socket() {
    load();
    const s = io({ auth: (cb) => cb({ token: current && current.token }) });
    s.on('connect_error', async (err) => {
      if (err && err.message === 'unauthorized') {
        save(null);
        await showPinPad('Sessão expirada. Digite seu PIN.');
        s.connect();
      }
    });
    return s;
  }

  window.Session = {
    ensure,
    fetch: authFetch,
    logout,
    socket,
    get staff() { load(); return current && current.staff; },
  };
})();
