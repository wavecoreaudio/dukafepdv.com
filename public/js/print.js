/*
 * Impressão de cupom, conferência de mesa e ticket da cozinha.
 * Formato para impressora térmica de 80 mm (funciona também em impressora comum).
 * NÃO é documento fiscal.
 *
 *   Print.receipt(dados)  -> cupom de venda paga
 *   Print.bill(dados)     -> conferência da mesa (antes de pagar)
 *   Print.kitchen(pedido) -> ticket da cozinha (sem preços, letra grande)
 */
(function () {
  let store = null;
  async function getStore() {
    if (store) return store;
    try {
      const res = await Session.fetch('/api/store');
      store = res.ok ? await res.json() : {};
    } catch (e) { store = {}; }
    return store;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
  const pad = (n) => String(n).padStart(2, '0');
  const dt = (iso) => { const d = iso ? new Date(iso) : new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const METHODS = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Cartão de débito', credito: 'Cartão de crédito' };

  const CSS = `
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { margin: 0; width: 72mm; font-family: "Courier New", ui-monospace, monospace; font-size: 12px; color: #000; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
    .big { font-size: 16px; } .huge { font-size: 22px; font-weight: bold; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; padding: 1px 0; }
    .note { font-size: 11px; padding-left: 10px; }
    .k li { font-size: 18px; margin: 6px 0; }
    .k .note { font-size: 16px; font-weight: bold; padding-left: 0; }
    ul { padding-left: 0; list-style: none; margin: 0; }`;

  function header(s) {
    return `
      <div class="c big b">${esc(s.nome || 'DUKAFE')}</div>
      ${s.endereco ? `<div class="c">${esc(s.endereco)}</div>` : ''}
      ${s.telefone ? `<div class="c">${esc(s.telefone)}</div>` : ''}
      ${s.cnpj ? `<div class="c">CNPJ ${esc(s.cnpj)}</div>` : ''}
      <hr>`;
  }

  function itemsTable(items) {
    return `<table>${items.map((i) => `
      <tr><td colspan="2">${i.quantity}× ${esc(i.name)}</td></tr>
      ${i.notes ? `<tr><td colspan="2" class="note">obs: ${esc(i.notes)}</td></tr>` : ''}
      <tr><td class="note">${i.quantity} × ${money(i.unit)}</td><td class="r">${money(i.total)}</td></tr>`).join('')}
    </table>`;
  }

  function printHTML(body) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>DUKAFE</title><style>${CSS}</style></head><body>${body}</body></html>`);
    doc.close();
    setTimeout(() => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* ok */ }
      setTimeout(() => frame.remove(), 1500);
    }, 150);
  }

  /** d = { title, number, date, table, staff, items:[{quantity,name,unit,total,notes}], subtotal, discount, total, method, paid, change } */
  async function receipt(d) {
    const s = await getStore();
    printHTML(`
      ${header(s)}
      <div class="c b">${esc(d.title || 'CUPOM')}</div>
      <div>${esc(d.number || '')}</div>
      <div>${dt(d.date)}</div>
      ${d.table ? `<div>Mesa/cliente: ${esc(d.table)}</div>` : ''}
      ${d.staff ? `<div>Atendimento: ${esc(d.staff)}</div>` : ''}
      <hr>
      ${itemsTable(d.items)}
      <hr>
      <table>
        ${d.discount ? `<tr><td>Subtotal</td><td class="r">${money(d.subtotal)}</td></tr><tr><td>Desconto</td><td class="r">-${money(d.discount)}</td></tr>` : ''}
        <tr><td class="big b">TOTAL</td><td class="r big b">${money(d.total)}</td></tr>
        ${d.method ? `<tr><td>${esc(METHODS[d.method] || d.method)}</td><td class="r">${money(d.paid ?? d.total)}</td></tr>` : ''}
        ${d.method === 'dinheiro' && d.change ? `<tr><td>Troco</td><td class="r">${money(d.change)}</td></tr>` : ''}
      </table>
      <hr>
      <div class="c">${esc(s.rodape || '')}</div>
      <div class="c" style="font-size:10px;margin-top:4px">*** NÃO É DOCUMENTO FISCAL ***</div>`);
  }

  /** Conferência da mesa: { table, orders:[venda com items], total } */
  async function bill(g) {
    const s = await getStore();
    const items = [];
    g.orders.forEach((o) => o.items.forEach((i) => items.push({
      quantity: i.quantity, name: i.product_name, unit: i.unit_price, total: i.total_price, notes: i.notes,
    })));
    const people = Math.max(...g.orders.map((o) => o.people || 0));
    printHTML(`
      ${header(s)}
      <div class="c b big">CONFERÊNCIA DE MESA</div>
      <div class="c huge">${esc(g.label)}</div>
      <div>${dt()} • ${g.orders.length} pedido(s)</div>
      <hr>
      ${itemsTable(items)}
      <hr>
      <table><tr><td class="big b">TOTAL</td><td class="r big b">${money(g.total)}</td></tr>
      ${people > 1 ? `<tr><td>Por pessoa (${people})</td><td class="r">${money(Math.round((g.total * 100) / people) / 100)}</td></tr>` : ''}</table>
      <hr>
      <div class="c" style="font-size:10px">*** NÃO É DOCUMENTO FISCAL ***</div>`);
  }

  /** Ticket da cozinha: venda/pedido com items */
  function kitchen(o) {
    printHTML(`
      <div class="c huge">${esc(o.table_label || 'Balcão')}</div>
      <div class="c">Pedido #${o.id} • ${dt(o.created_at)}</div>
      <div class="c">${esc(o.staff_name || '')}${o.people ? ` • ${o.people} pessoa(s)` : ''}</div>
      <hr>
      <ul class="k">${o.items.map((i) => `<li><b>${i.quantity}×</b> ${esc(i.product_name)}${i.notes ? `<div class="note">&gt;&gt; ${esc(i.notes)}</div>` : ''}</li>`).join('')}</ul>
      <hr>`);
  }

  window.Print = { receipt, bill, kitchen };
})();
