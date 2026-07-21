// ── 🖨 REPORTES ──────────────────────────────────────────
// ─── DOCUMENTOS — NOTA DE ENTREGA Y FACTURA ──────────────────────────────────
// Estados que se consideran "cerrados" (no aparecen en la lista)
const _DOC_ESTADOS_CERRADOS = ['pagado','entregado','colocado en recepción','en recepción pagado'];

function _docEstaAbierto(p) {
  const st = (p.status || '').toLowerCase();
  return !_DOC_ESTADOS_CERRADOS.some(c => st.includes(c));
}

async function repDocumentosRender() {
  const pedidos = (_sbPedComCache || await _sbPedComCargar())
    .filter(_docEstaAbierto)
    .sort((a,b) => (b.numero_pedido||'').localeCompare(a.numero_pedido||''));

  if (!pedidos.length) {
    return '<div class="ph" style="padding:24px"><span class="ph-icon">📄</span>No hay pedidos comerciales abiertos</div>';
  }

  const filas = pedidos.map(p => {
    const lineas = p._lineasSb || [];
    const tot    = lineas.reduce((s,l) => s + (l.precio_applied||0)*(l.cantidad||1), 0);
    const items  = lineas.length;
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border)">
      <input type="checkbox" class="doc-check" value="${p.id}"
        style="width:18px;height:18px;accent-color:var(--gold);cursor:pointer;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px">${p.cliente_nom}</div>
        <div style="font-size:11px;color:var(--cream2);margin-top:2px">
          ${pmFmtDateShort(p.fecha)} · ${p.numero_pedido||''} · ${items} producto${items!==1?'s':''} · ₡${pmMoney(tot)}
        </div>
      </div>
      <span style="font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;border:1px solid var(--border);color:var(--cream2)">${p.status}</span>
    </div>`;
  }).join('');

  return `<div class="card" style="padding:0;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)">
      <div>
        <div class="ctitle" style="margin-bottom:2px">📄 Documentos</div>
        <div style="font-size:11px;color:var(--cream2)">Pedidos abiertos — seleccioná uno o varios para imprimir</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-out btn-sm" onclick="docSelTodos()">☑ Todos</button>
        <button class="btn btn-out btn-sm" onclick="docImprimirNota()">📋 Nota entrega</button>
        <button class="btn btn-gold btn-sm" onclick="docImprimirFactura()">🧾 Factura</button>
      </div>
    </div>
    <div id="doc-lista">${filas}</div>
  </div>`;
}

function docSelTodos() {
  const checks = document.querySelectorAll('.doc-check');
  const todosOn = [...checks].every(c => c.checked);
  checks.forEach(c => c.checked = !todosOn);
}

function _docGetSeleccionados() {
  const ids = [...document.querySelectorAll('.doc-check:checked')].map(c => c.value);
  if (!ids.length) { pmToast('Seleccioná al menos un pedido', 'err'); return null; }
  return ids.map(id => (_sbPedComCache||[]).find(p => p.id === id)).filter(Boolean);
}

function docImprimirNota() {
  const peds = _docGetSeleccionados();
  if (!peds) return;
  _docAbrir(peds, 'nota');
}

function docImprimirFactura() {
  const peds = _docGetSeleccionados();
  if (!peds) return;
  _docAbrir(peds, 'factura');
}

function _docAbrir(peds, tipo) {
  const WIN_CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;padding:0}
    .page{width:100%;max-width:720px;margin:0 auto;padding:32px 36px;page-break-after:always}
    .page:last-child{page-break-after:auto}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #1a1a1a}
    .brand{font-size:22px;font-weight:900;letter-spacing:-.5px;color:#1a1a1a}
    .brand-sub{font-size:11px;color:#666;margin-top:3px;text-transform:uppercase;letter-spacing:1px}
    .doc-tipo{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#666;text-align:right}
    .doc-num{font-size:20px;font-weight:900;color:#1a1a1a;text-align:right;margin-top:4px}
    .meta{display:flex;gap:32px;margin-bottom:24px}
    .meta-block label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#888;display:block;margin-bottom:3px}
    .meta-block .val{font-size:14px;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    thead tr{border-bottom:2px solid #1a1a1a}
    th{padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#444;font-weight:700}
    th.r{text-align:right}
    td{padding:9px 10px;border-bottom:1px solid #e8e8e8;font-size:13px}
    td.r{text-align:right;font-weight:600}
    .total-row{border-top:2px solid #1a1a1a;border-bottom:none}
    .total-row td{padding-top:12px;font-weight:700;font-size:15px}
    .footer{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:10px;color:#999;text-align:center}
    .sin-precio td.r{color:#fff}
    @media print{body{padding:0}.page{padding:28px 32px}}
  `;

  const esFactura = tipo === 'factura';

  const paginas = peds.map((p, idx) => {
    const fecha  = pmFmtDateShort ? pmFmtDateShort(p.date) : p.date;
    const docNum = String(p.id).slice(-6).padStart(6,'0');
    const lineas = (p.lineas || []).map(l => {
      const nombre = pmNombrePan(l.pid);
      const precio = l.precioAplicado || pmPrecioPan(l.pid) * (1-(l.desc||0)/100);
      const subtot = precio * (l.cant||1);
      const precioCol = esFactura
        ? `<td class="r">₡${precio.toLocaleString('es-CR')}</td><td class="r">₡${subtot.toLocaleString('es-CR')}</td>`
        : '';
      return `<tr>
        <td>${nombre}</td>
        <td class="r">${l.cant}</td>
        ${precioCol}
      </tr>`;
    }).join('');

    const totalRow = esFactura ? (() => {
      const tot = pmTotalCom(p);
      return `<tr class="total-row">
        <td colspan="2">Total</td>
        <td class="r"></td>
        <td class="r">₡${tot.toLocaleString('es-CR')}</td>
      </tr>`;
    })() : '';

    const colHeaders = esFactura
      ? '<th class="r">Precio unit.</th><th class="r">Subtotal</th>'
      : '';

    return `<div class="page">
      <div class="header">
        <div>
          <div class="brand">Victor's Bakery &amp; Sweets</div>
          <div class="brand-sub">Panadería artesanal</div>
        </div>
        <div>
          <div class="doc-tipo">${esFactura ? 'Factura' : 'Nota de entrega'}</div>
          <div class="doc-num">#${docNum}</div>
        </div>
      </div>
      <div class="meta">
        <div class="meta-block"><label>Cliente</label><div class="val">${p.cli}</div></div>
        <div class="meta-block"><label>Fecha</label><div class="val">${fecha}</div></div>
        <div class="meta-block"><label>Estado</label><div class="val">${p.status}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Producto</th>
          <th class="r">Cant.</th>
          ${colHeaders}
        </tr></thead>
        <tbody>
          ${lineas}
          ${totalRow}
        </tbody>
      </table>
      <div class="footer">Victor's Bakery &amp; Sweets — ${esFactura ? 'Factura' : 'Nota de entrega'} #${docNum}</div>
    </div>`;
  }).join('');

  const titulo = esFactura ? 'Facturas' : 'Notas de entrega';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${titulo} — Victor's Bakery & Sweets</title>
    <style>${WIN_CSS}</style>
  </head><body>${paginas}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}

// ─── REPORTE CONTABLE — CONCILIACIÓN PEDIDOS vs VENTAS ───────────────────────
async function repContable(mes) {
  if (!pmDB.disponible()) return '<div class="ph"><span class="ph-icon">⚠️</span>Sin conexión a Supabase</div>';

  const [anio, mesN] = mes.split('-');

  // Cargar ventas del mes desde Supabase
  let ventas = [];
  try {
    const todas = await pmDB.get('ventas', {});
    ventas = (todas||[]).filter(v => {
      const f = v.fecha_pago || v.created_at?.slice(0,10) || '';
      return f.startsWith(mes);
    });
  } catch(e) {
    return `<div class="ph"><span class="ph-icon">⚠️</span>Error al cargar ventas: ${e.message}</div>`;
  }

  // Mapa de ventas por pedido_id para cruce
  const ventaPorPedido = {};
  const ventasPorNotas = {};
  ventas.forEach(v => {
    if (v.pedido_id) ventaPorPedido[v.pedido_id] = v;
    if (v.notas) ventasPorNotas[v.notas] = v;
  });

  // ── Pedidos comerciales pagados del mes (desde Supabase) ──
  let pedsCom = [];
  try {
    const todos = await pmDB.get('pedidos', { tipo: 'comercial' });
    pedsCom = (todos||[]).filter(p => {
      const f = p.fecha || p.date || '';
      const st = (p.status||'').toLowerCase();
      return f.startsWith(mes) && (st.includes('pagado') || st.includes('recepción'));
    });
  } catch(e) { pedsCom = []; }

  // ── Pedidos de pan pagados del mes (desde localStorage) ──
  const pedsPan = G.pedidosPan.filter(p => {
    const st = (p.status||'').toLowerCase();
    return (p.date||'').startsWith(mes) && (st.includes('pagado') || st.includes('recepción'));
  });

  // ── Pedidos de galleta pagados del mes (desde localStorage) ──
  const pedsGall = G.pedidosGalletas.filter(p => {
    const st = (p.status||'').toLowerCase();
    return (p.date||'').startsWith(mes) && (st.includes('pagado') || st.includes('recepción'));
  });

  // ── Construir filas de conciliación ──
  const filas = [];

  // Comerciales
  pedsCom.forEach(p => {
    const venta   = ventaPorPedido[p.id];
    const montoPed = parseFloat(p.total) || 0;
    const montoVen = parseFloat(venta?.total) || 0;
    const diff     = montoPed - montoVen;
    filas.push({
      tipo:     '🏪 Comercial',
      ref:      p.numero_pedido || '—',
      cliente:  p.cliente_nom || '—',
      fecha:    pmFmtDateShort(p.fecha||p.date),
      montoPed,
      montoVen,
      venta,
      diff
    });
  });

  // Pan
  pedsPan.forEach(p => {
    const refId  = 'PAN-' + p.id;
    const venta  = ventasPorNotas[refId];
    const montoPed = pmTotalPan(p);
    const montoVen = parseFloat(venta?.total) || 0;
    filas.push({
      tipo:     '🍞 Pan',
      ref:      refId,
      cliente:  p.cli,
      fecha:    pmFmtDateShort(p.date),
      montoPed,
      montoVen,
      venta,
      diff: montoPed - montoVen
    });
  });

  // Galleta
  pedsGall.forEach(p => {
    const refId  = 'GALL-' + p.id;
    const venta  = ventasPorNotas[refId];
    const montoPed = pmTotalGall(p);
    const montoVen = parseFloat(venta?.total) || 0;
    filas.push({
      tipo:     '🍪 Galleta',
      ref:      refId,
      cliente:  p.cli,
      fecha:    pmFmtDateShort(p.date),
      montoPed,
      montoVen,
      venta,
      diff: montoPed - montoVen
    });
  });

  // Ordenar por fecha
  filas.sort((a,b) => a.fecha.localeCompare(b.fecha));

  // Totales
  const totalPeds  = filas.reduce((s,f) => s + f.montoPed, 0);
  const totalVents = filas.reduce((s,f) => s + f.montoVen, 0);
  const totalDiff  = totalPeds - totalVents;
  const sinVenta   = filas.filter(f => !f.venta).length;
  const conDiff    = filas.filter(f => f.venta && Math.abs(f.diff) > 1).length;

  if (!filas.length) {
    return `<div class="card">
      <div class="ctitle">📊 Conciliación Contable</div>
      <div class="ph"><span class="ph-icon">📊</span>Sin pedidos pagados en ${mes}</div>
    </div>`;
  }

  const rows = filas.map(f => {
    const tieneDiff = f.venta && Math.abs(f.diff) > 1;
    const estado = !f.venta
      ? `<span style="color:var(--red);font-weight:700">❌ Sin venta</span>`
      : tieneDiff
        ? `<span style="color:var(--amber);font-weight:700">⚠️ Dif. ₡${pmMoney(Math.abs(f.diff))}</span>`
        : `<span style="color:var(--green);font-weight:700">✓</span>`;
    const ventaCell = f.venta
      ? `<span id="vc-val-${f.venta.id}" style="font-family:'DM Mono',monospace">₡${pmMoney(f.montoVen)}</span>`
      : '—';
    const editBtn = tieneDiff
      ? `<button class="btn btn-out btn-xs no-print" style="margin-left:6px;font-size:10px" onclick="contableEditVenta('${f.venta.id}',${f.montoVen})">✏️</button>`
      : '';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-size:11px;color:var(--cream2)">${f.fecha}</td>
      <td style="padding:8px 10px;font-size:11px">${f.tipo}</td>
      <td style="padding:8px 10px;font-weight:600">${f.cliente}</td>
      <td style="padding:8px 10px;font-size:10px;color:var(--cream2);font-family:'DM Mono',monospace">${f.ref}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700">₡${pmMoney(f.montoPed)}</td>
      <td style="padding:8px 10px;text-align:right" id="vc-cell-${f.venta?.id||''}">
        ${ventaCell}${editBtn}
      </td>
      <td style="padding:8px 10px;text-align:center" id="vc-estado-${f.venta?.id||''}">${estado}</td>
    </tr>`;
  }).join('');

  const alertas = sinVenta > 0 || conDiff > 0 ? `
    <div style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap">
      ${sinVenta > 0 ? `<span style="color:var(--red);font-size:13px">❌ ${sinVenta} pedido(s) sin venta registrada</span>` : ''}
      ${conDiff > 0 ? `<span style="color:var(--amber);font-size:13px">⚠️ ${conDiff} venta(s) con diferencia de monto</span>` : ''}
    </div>` : `
    <div style="background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.2);border-radius:10px;padding:12px 16px;margin-bottom:16px">
      <span style="color:var(--green);font-size:13px">✓ Conciliación completa — todos los pedidos tienen venta registrada</span>
    </div>`;

  return `<div class="card" id="rep-contable-inner">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:var(--cream)">📊 Conciliación Contable</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${mes} · ${filas.length} pedido(s) pagado(s)</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${repStatBox('Pedidos', '₡'+pmMoney(totalPeds))}
        ${repStatBox('Ventas', '₡'+pmMoney(totalVents))}
        ${repStatBox('Diferencia', '₡'+pmMoney(Math.abs(totalDiff)))}
        <button class="btn btn-gold btn-sm no-print" onclick="repPrintSection('rep-contable-inner')">🖨 Imprimir</button>
      </div>
    </div>
    ${alertas}
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid var(--border);background:rgba(200,146,42,.06)">
          <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Fecha</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Tipo</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Cliente</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Referencia</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Pedido</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Venta</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Estado</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border);background:rgba(200,146,42,.08)">
          <td colspan="4" style="padding:10px;font-weight:700">TOTAL</td>
          <td style="padding:10px;text-align:right;font-family:'DM Mono',monospace;font-weight:900;color:var(--gold)">₡${pmMoney(totalPeds)}</td>
          <td style="padding:10px;text-align:right;font-family:'DM Mono',monospace;font-weight:900;color:var(--gold)">₡${pmMoney(totalVents)}</td>
          <td style="padding:10px;text-align:center;font-weight:700;color:${Math.abs(totalDiff)<1?'var(--green)':'var(--red)'}">
            ${Math.abs(totalDiff)<1?'✓ Cuadrado':'⚠️ Dif. ₡'+pmMoney(Math.abs(totalDiff))}
          </td>
        </tr></tfoot>
      </table>
    </div>
  </div>`;
}

// ── Edición directa de venta en conciliación contable ──
function contableEditVenta(ventaId, montoActual) {
  const cell = document.getElementById('vc-cell-' + ventaId);
  if (!cell) return;
  cell.innerHTML = `
    <input type="number" id="vc-input-${ventaId}" value="${montoActual}" min="0" step="1"
      style="width:110px;padding:4px 7px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px;font-family:'DM Mono',monospace;text-align:right">
    <button class="btn btn-gold btn-xs no-print" style="margin-left:4px;font-size:10px" onclick="contableGuardarVenta('${ventaId}')">💾</button>
    <button class="btn btn-out btn-xs no-print" style="margin-left:2px;font-size:10px" onclick="repRender()">✕</button>`;
  document.getElementById('vc-input-' + ventaId)?.focus();
}

async function contableGuardarVenta(ventaId) {
  const input = document.getElementById('vc-input-' + ventaId);
  if (!input) return;
  const nuevoTotal = parseFloat(input.value);
  if (isNaN(nuevoTotal) || nuevoTotal < 0) { pmToast('Monto inválido', 'err'); return; }
  try {
    await pmDB.update('ventas', ventaId, { total: nuevoTotal });
    pmToast('Venta actualizada ✓');
    repRender();
  } catch(e) {
    pmToast('Error al guardar: ' + e.message, 'err');
  }
}

let repCurrentTab = 'pan';
function repTab(tab, btn) {
  repCurrentTab = tab;
  document.querySelectorAll('#rep-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  repRender();
}

async function repRender() {
  const fechaEl = document.getElementById('r-fecha');
  const mesEl   = document.getElementById('r-mes');
  if (!fechaEl) { setTimeout(repRender, 100); return; }
  if (!fechaEl.value) fechaEl.value = pmHoy();
  if (mesEl && !mesEl.value) mesEl.value = pmHoy().slice(0,7);
  const fecha = fechaEl.value;
  const mes   = mesEl ? mesEl.value : pmHoy().slice(0,7);
  const out   = document.getElementById('rep-out');
  if (!out) { console.error('rep-out NOT FOUND'); return; }
  try {
    let html = '';
    if (repCurrentTab === 'pan')              html = repPan(fecha);
    else if (repCurrentTab === 'galletas')    html = repGall(fecha);
    else if (repCurrentTab === 'comercial')   html = await repCom(fecha);
    else if (repCurrentTab === 'produccion')  html = repProduccion(fecha);
    else if (repCurrentTab === 'gastos')      html = await repGastos(mes);
    else if (repCurrentTab === 'ventas')      html = await repVentas(mes);
    else if (repCurrentTab === 'mensual')     html = await repMensual(mes);
    else if (repCurrentTab === 'documentos')  html = await repDocumentosRender();
    else if (repCurrentTab === 'contable')    html = await repContable(mes);
    else html = '<div style="padding:20px;color:var(--cream)">Tab: ' + repCurrentTab + ' — no reconocido</div>';
    out.innerHTML = html;
  } catch(e) {
    out.innerHTML = '<div style="padding:20px;background:#c04040;color:#fff;border-radius:8px"><strong>Error en reporte:</strong><br>' + e.message + '<br><small>' + e.stack + '</small></div>';
    console.error('repRender error:', e);
  }
}

function repStatBox(label, val, color='var(--gold2)') {
  return `<div style="text-align:center;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 14px">
    <div style="font-size:10px;color:var(--cream2);text-transform:uppercase;letter-spacing:.8px">${label}</div>
    <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:900;color:${color};line-height:1.1">${val}</div>
  </div>`;
}

function repPrintSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const w = window.open('','_blank','width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>PanMaestro — Reporte</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600&family=DM+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;font-size:13px;color:#1a1006;padding:32px;background:#fff}
      h1{font-family:'Playfair Display',serif;font-size:22px;font-weight:900;margin-bottom:4px}
      h2{font-family:'Playfair Display',serif;font-size:15px;font-weight:700;padding:6px 0 4px;border-bottom:2px solid #C8922A;margin:16px 0 8px;display:flex;justify-content:space-between}
      .rep-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px}
      .stats{display:flex;gap:12px;flex-wrap:wrap}
      .stat{text-align:center;border:1px solid #e0c88a;border-radius:8px;padding:8px 16px}
      .stat-label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#7a6040}
      .stat-val{font-family:'Playfair Display',serif;font-size:22px;font-weight:900;color:#C8922A;line-height:1.1}
      table{width:100%;border-collapse:collapse;margin-bottom:6px}
      th{background:#f5e8d0;padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px}
      td{padding:6px 10px;border-bottom:1px solid #e8dcc8}
      tfoot td{font-weight:700;background:#fdf5e6;border-top:2px solid #C8922A}
      .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#e8dcc8;color:#5a3a10}
      .inst{font-size:10px;color:#4060a0}
      .mono{font-family:'DM Mono',monospace}
      .no-data{color:#999;padding:16px;text-align:center}
      @media print{body{padding:16px}}
    </style>
  </head><body>`);
  w.document.write(el.innerHTML);
  w.document.write('</body></html>');
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
}

function repPan(fecha) {
  const peds = G.pedidosPan.filter(p => p.date === fecha);
  if (!peds.length) {
    const total = G.pedidosPan.length;
    const fechas = [...new Set(G.pedidosPan.map(p=>p.date))].sort().reverse().slice(0,5);
    const sugerencias = fechas.length ? `<div style="margin-top:14px;font-size:12px;color:var(--cream2)">
      Fechas con pedidos: ${fechas.map(f=>`<button class="btn btn-out btn-sm" style="margin:2px" onclick="document.getElementById('r-fecha').value='${f}';repRender()">${pmFmtDateShort(f)}</button>`).join(' ')}
    </div>` : '<div style="margin-top:10px;font-size:12px;color:var(--cream2)">No hay pedidos de pan en el sistema aún.</div>';
    return `<div class="ph" style="flex-direction:column;align-items:flex-start;padding:24px">
      <span style="font-size:32px">📋</span>
      <div style="font-size:15px;font-weight:600;color:var(--cream);margin:8px 0 4px">Sin pedidos de pan para ${pmFmtDate(fecha)}</div>
      <div style="font-size:12px;color:var(--cream2)">Total en sistema: <strong>${total}</strong> pedido(s)</div>
      ${sugerencias}
    </div>`;
  }
  let totalU=0, totalRev=0;
  const byProd = {};
  peds.forEach(p => {
    p.lineas.forEach(l => {
      totalU += l.cant||1;
      totalRev += pmPrecioPan(l.pid)*(l.cant||1);
      if (!byProd[l.pid]) byProd[l.pid] = [];
      byProd[l.pid].push({cli:p.cli, cant:l.cant||1, inst:l.inst||'', status:p.status, pr:pmPrecioPan(l.pid)});
    });
  });

  let inner = `
    <div class="rep-header">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:var(--cream)">🍞 Reporte Pan del Día</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${pmFmtDate(fecha)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${repStatBox('Clientes', peds.length)}
        ${repStatBox('Unidades', totalU)}
        ${repStatBox('Total', pmMoney(totalRev))}
        <button class="btn btn-gold btn-sm no-print" onclick="repPrintSection('rep-pan-inner')" style="align-self:flex-end">🖨 Imprimir</button>
      </div>
    </div>`;

  G.tiposPan.forEach(pan => {
    const rows = byProd[pan.id];
    if (!rows) return;
    const tot = rows.reduce((s,r)=>s+r.cant, 0);
    const rev = rows.reduce((s,r)=>s+r.pr*r.cant, 0);
    inner += `
      <div style="margin-bottom:18px">
        <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:700;
          padding:8px 12px;border-left:4px solid var(--gold);background:rgba(200,146,42,.08);
          margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;border-radius:0 8px 8px 0">
          <span>${pan.nombre}</span>
          <span style="font-size:13px;color:var(--cream2)">${tot} ud · ${pmMoney(rev)}</span>
        </div>
        <table class="rep-tbl">
          <thead><tr>
            <th>Cliente</th><th>Cant.</th><th>Instrucción</th><th>Estado</th>
            <th style="text-align:right">Subtotal</th>
          </tr></thead>
          <tbody>
            ${rows.map(r=>`<tr>
              <td style="font-weight:600">${r.cli}</td>
              <td style="font-family:'DM Mono',monospace;font-weight:700">${r.cant}</td>
              <td style="font-size:11px;color:var(--blue)">${r.inst||'—'}</td>
              <td>${pmBadge(r.status)}</td>
              <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(r.pr*r.cant)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  });

  // Resumen por cliente al final
  const byCli = {};
  peds.forEach(p => {
    const t = (p.lineas||[]).reduce((s,l)=>s+l.cant,0);
    const m = pmTotalPan(p);
    if (t) byCli[p.cli] = { unid:t, total:m, status:p.status };
  });
  inner += `
    <div style="margin-top:10px">
      <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:700;
        padding:8px 12px;border-left:4px solid var(--blue);background:rgba(74,128,192,.08);
        margin-bottom:8px;border-radius:0 8px 8px 0">Resumen por cliente</div>
      <table class="rep-tbl">
        <thead><tr><th>Cliente</th><th>Unidades</th><th>Estado</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>
          ${Object.entries(byCli).map(([cli,d])=>`<tr>
            <td style="font-weight:600">${cli}</td>
            <td style="font-family:'DM Mono',monospace;font-weight:700">${d.unid}</td>
            <td>${pmBadge(d.status)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(d.total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td><strong>TOTAL</strong></td>
          <td><strong>${totalU}</strong></td>
          <td></td>
          <td style="text-align:right;font-family:'DM Mono',monospace"><strong>${pmMoney(totalRev)}</strong></td>
        </tr></tfoot>
      </table>
    </div>`;

  return `<div class="card" id="rep-pan-inner">${inner}</div>`;
}

function repGall(fecha) {
  const peds = G.pedidosGalletas.filter(p => p.date===fecha);
  if (!peds.length) {
    const total = G.pedidosGalletas.length;
    const fechas = [...new Set(G.pedidosGalletas.map(p=>p.date))].sort().reverse().slice(0,5);
    const sugerencias = fechas.length ? `<div style="margin-top:14px;font-size:12px;color:var(--cream2)">
      Fechas con pedidos: ${fechas.map(f=>`<button class="btn btn-out btn-sm" style="margin:2px" onclick="document.getElementById('r-fecha').value='${f}';repRender()">${pmFmtDateShort(f)}</button>`).join(' ')}
    </div>` : '<div style="margin-top:10px;font-size:12px;color:var(--cream2)">No hay pedidos de galletas en el sistema aún.</div>';
    return `<div class="ph" style="flex-direction:column;align-items:flex-start;padding:24px">
      <span style="font-size:32px">🍪</span>
      <div style="font-size:15px;font-weight:600;color:var(--cream);margin:8px 0 4px">Sin pedidos de galletas para ${pmFmtDate(fecha)}</div>
      <div style="font-size:12px;color:var(--cream2)">Total en sistema: <strong>${total}</strong> pedido(s)</div>
      ${sugerencias}
    </div>`;
  }
  let totalU=0, totalRev=0;
  const byProd = {};
  peds.forEach(p => {
    p.lineas.forEach(l => {
      totalU += l.cant||1;
      totalRev += pmPrecioGall(l.pid)*(l.cant||1);
      if (!byProd[l.pid]) byProd[l.pid] = [];
      byProd[l.pid].push({cli:p.cli, cant:l.cant||1, inst:l.inst||'', status:p.status, pr:pmPrecioGall(l.pid)});
    });
  });

  let inner = `
    <div class="rep-header">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:var(--cream)">🍪 Reporte Galletas del Día</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${pmFmtDate(fecha)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${repStatBox('Clientes', peds.length)}
        ${repStatBox('Unidades', totalU)}
        ${repStatBox('Total', pmMoney(totalRev))}
        <button class="btn btn-gold btn-sm no-print" onclick="repPrintSection('rep-gall-inner')" style="align-self:flex-end">🖨 Imprimir</button>
      </div>
    </div>`;

  G.tiposGalleta.forEach(gal => {
    const rows = byProd[gal.id];
    if (!rows) return;
    const tot = rows.reduce((s,r)=>s+r.cant, 0);
    const rev = rows.reduce((s,r)=>s+r.pr*r.cant, 0);
    inner += `
      <div style="margin-bottom:18px">
        <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:700;
          padding:8px 12px;border-left:4px solid var(--gold);background:rgba(200,146,42,.08);
          margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;border-radius:0 8px 8px 0">
          <span>${gal.nombre}</span>
          <span style="font-size:13px;color:var(--cream2)">${tot} ud · ${pmMoney(rev)}</span>
        </div>
        <table class="rep-tbl">
          <thead><tr>
            <th>Cliente</th><th>Cant.</th><th>Instrucción</th><th>Estado</th>
            <th style="text-align:right">Subtotal</th>
          </tr></thead>
          <tbody>
            ${rows.map(r=>`<tr>
              <td style="font-weight:600">${r.cli}</td>
              <td style="font-family:'DM Mono',monospace;font-weight:700">${r.cant}</td>
              <td style="font-size:11px;color:var(--blue)">${r.inst||'—'}</td>
              <td>${pmBadge(r.status)}</td>
              <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(r.pr*r.cant)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  });

  const byCli = {};
  peds.forEach(p => {
    const t = (p.lineas||[]).reduce((s,l)=>s+l.cant,0);
    const m = pmTotalGall(p);
    if (t) byCli[p.cli] = { unid:t, total:m, status:p.status };
  });
  inner += `
    <div style="margin-top:10px">
      <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:700;
        padding:8px 12px;border-left:4px solid var(--blue);background:rgba(74,128,192,.08);
        margin-bottom:8px;border-radius:0 8px 8px 0">Resumen por cliente</div>
      <table class="rep-tbl">
        <thead><tr><th>Cliente</th><th>Unidades</th><th>Estado</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>
          ${Object.entries(byCli).map(([cli,d])=>`<tr>
            <td style="font-weight:600">${cli}</td>
            <td style="font-family:'DM Mono',monospace;font-weight:700">${d.unid}</td>
            <td>${pmBadge(d.status)}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(d.total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td><strong>TOTAL</strong></td>
          <td><strong>${totalU}</strong></td>
          <td></td>
          <td style="text-align:right;font-family:'DM Mono',monospace"><strong>${pmMoney(totalRev)}</strong></td>
        </tr></tfoot>
      </table>
    </div>`;

  return `<div class="card" id="rep-gall-inner">${inner}</div>`;
}

async function repCom(fecha) {
  const todos = _sbPedComCache || await _sbPedComCargar();
  const peds  = todos.filter(p => (p.fecha||p.date) === fecha);
  if (!peds.length) return `<div class="ph"><span class="ph-icon">🏪</span>Sin pedidos comerciales para ${pmFmtDate(fecha)}</div>`;

  await _sbProdEnsureMap();
  const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
  const getProd = uuid => {
    const cod = _sbProdMapInv?.[uuid] || '';
    return prods.find(p => p.id === cod) || { nombre: uuid, precio: 0 };
  };

  const todosOpt = `<option value="">— Todos los clientes —</option>`;
  const cliOpts  = peds.map(p => `<option value="${p.id}">${p.cliente_nom}${p.numero_pedido?' ('+p.numero_pedido+')':''}</option>`).join('');

  const filtroEl    = document.getElementById('rep-com-filtro');
  const filtroPedId = filtroEl ? filtroEl.value || '' : '';
  const pedsFiltro  = filtroPedId ? peds.filter(p => p.id === filtroPedId) : peds;

  let totalGlobal = 0;
  const bloques = pedsFiltro.map(p => {
    const lineas = p._lineasSb || [];
    const tot    = lineas.reduce((s,l) => s + (l.precio_applied||0)*(l.cantidad||1), 0);
    totalGlobal += tot;

    const rows = lineas.map(l => {
      const prod   = getProd(l.producto_id);
      const pr     = l.precio_applied || 0;
      const subtot = pr * (l.cantidad||1);
      return `<tr>
        <td>${prod.nombre}</td>
        <td style="text-align:center;font-family:'DM Mono',monospace;font-weight:700">${l.cantidad}</td>
        <td style="text-align:right;color:var(--cream2);font-family:'DM Mono',monospace">${l.descuento_pct||0}%</td>
        <td style="text-align:right;font-family:'DM Mono',monospace">₡${pmMoney(pr)}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">₡${pmMoney(subtot)}</td>
      </tr>`;
    }).join('');

    return `<div style="background:var(--sf);border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:15px">${p.cliente_nom}</div>
          <div style="font-size:11px;color:var(--cream2);margin-top:2px">
            ${pmFmtDate(fecha)} · ${p.numero_pedido||''} · ${pmBadge(p.status)}
          </div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:900;color:var(--gold)">₡${pmMoney(tot)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Producto</th>
          <th style="padding:6px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Cant.</th>
          <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Desc.</th>
          <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Precio unit.</th>
          <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Subtotal</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border)">
          <td colspan="4" style="padding:8px;font-weight:700">Total ${p.cliente_nom}</td>
          <td style="padding:8px;text-align:right;font-family:'DM Mono',monospace;font-weight:900;color:var(--gold)">₡${pmMoney(tot)}</td>
        </tr></tfoot>
      </table>
    </div>`;
  }).join('');

  const resumen = pedsFiltro.length > 1
    ? `<div style="text-align:right;padding:12px 4px;font-family:'DM Mono',monospace;font-size:16px;font-weight:900;color:var(--gold);border-top:2px solid var(--border);margin-top:4px">
        Total general: ₡${pmMoney(totalGlobal)}
       </div>`
    : '';

  window._repComPeds = pedsFiltro;

  return `<div class="card" id="rep-com-inner">
    <div class="rep-header" style="margin-bottom:16px">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:var(--cream)">🏪 Reporte Comercial</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${pmFmtDate(fecha)}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${repStatBox('Pedidos', pedsFiltro.length)}
        ${repStatBox('Total', '₡'+pmMoney(totalGlobal))}
        <button class="btn btn-out btn-sm no-print" onclick="repComImprimir(window._repComPeds,'nota')">📋 Nota entrega</button>
        <button class="btn btn-gold btn-sm no-print" onclick="repComImprimir(window._repComPeds,'factura')">🧾 Factura</button>
      </div>
    </div>
    <div class="no-print" style="margin-bottom:16px">
      <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;color:var(--cream2);display:block;margin-bottom:6px">Filtrar cliente</label>
      <select id="rep-com-filtro" onchange="repRender()"
        style="padding:8px 12px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px;width:100%;max-width:320px">
        ${todosOpt}${cliOpts}
      </select>
    </div>
    ${bloques}
    ${resumen}
  </div>`;
}

async function repComImprimir(peds, tipo) {
  // peds puede ser array de objetos o IDs — normalizar
  const lista = Array.isArray(peds) ? peds : [];
  if (!lista.length) { pmToast('No hay pedidos para imprimir', 'err'); return; }

  const esFactura = tipo === 'factura';

  // Si es factura, asignar correlativo único por pedido (solo una vez)
  if (esFactura) {
    for (const p of lista) {
      if (!p.numFac) {
        const n   = await _corrSiguiente('factura');
        p.numFac  = _corrFmt(n, 'FAC-');
        pmSave('sistema');
      }
    }
  }

  const CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#fff}
    .page{width:100%;max-width:720px;margin:0 auto;padding:32px 36px;page-break-after:always}
    .page:last-child{page-break-after:auto}
    .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #1a1a1a;margin-bottom:24px}
    .brand{font-size:22px;font-weight:900;letter-spacing:-.5px}
    .brand-sub{font-size:10px;color:#777;margin-top:4px;text-transform:uppercase;letter-spacing:1.2px}
    .doc-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#777;text-align:right}
    .doc-num{font-size:20px;font-weight:900;text-align:right;margin-top:4px}
    .meta{display:flex;gap:32px;margin-bottom:24px}
    .meta-item label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#888;display:block;margin-bottom:3px}
    .meta-item .val{font-size:14px;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    thead tr{border-bottom:2px solid #1a1a1a}
    th{padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#444;font-weight:700}
    th.r,td.r{text-align:right}
    td{padding:9px 10px;border-bottom:1px solid #e8e8e8;vertical-align:middle}
    .total-row td{padding-top:12px;font-weight:700;font-size:14px;border-bottom:none;border-top:2px solid #1a1a1a}
    .footer{margin-top:28px;padding-top:14px;border-top:1px solid #ddd;font-size:10px;color:#aaa;text-align:center}
    @media print{.page{padding:28px 32px}}
  `;

  const paginas = lista.map(p => {
    const docNum  = esFactura ? (p.numFac || 'FAC-???????') : (p.numero_pedido || 'PED-???????');
    const fecha   = pmFmtDateShort ? pmFmtDateShort(p.fecha||p.date) : (p.fecha||p.date);
    const lineas  = p._lineasSb || [];

    const filas = lineas.map(l => {
      const prod   = (() => { const cod = _sbProdMapInv?.[l.producto_id]||''; return [...(G.tiposPan||[]),...(G.tiposGalleta||[])].find(x=>x.id===cod)||{nombre:l.producto_id,precio:0}; })();
      const nombre = prod.nombre;
      const cant   = l.cantidad || 1;
      if (esFactura) {
        const precio = l.precio_applied || 0;
        const subtot = precio * cant;
        return `<tr>
          <td>${nombre}</td>
          <td class="r">${cant}</td>
          <td class="r">₡${precio.toLocaleString('es-CR',{minimumFractionDigits:0})}</td>
          <td class="r">₡${subtot.toLocaleString('es-CR',{minimumFractionDigits:0})}</td>
        </tr>`;
      } else {
        return `<tr>
          <td>${nombre}</td>
          <td class="r">${cant}</td>
        </tr>`;
      }
    }).join('');

    const totalRow = esFactura ? (() => {
      const tot = lineas.reduce((s,l) => s + (l.precio_applied||0) * (l.cantidad||1), 0);
      return `<tr class="total-row">
        <td colspan="2">Total</td>
        <td class="r"></td>
        <td class="r">₡${tot.toLocaleString('es-CR',{minimumFractionDigits:0})}</td>
      </tr>`;
    })() : '';

    const colHeaders = esFactura
      ? '<th class="r">Precio unit.</th><th class="r">Subtotal</th>'
      : '';

    return `<div class="page">
      <div class="header">
        <div>
          <div class="brand">Victor's Bakery &amp; Sweets</div>
          <div class="brand-sub">Panadería artesanal</div>
        </div>
        <div>
          <div class="doc-label">${esFactura ? 'Factura' : 'Nota de entrega'}</div>
          <div class="doc-num">#${docNum}</div>
        </div>
      </div>
      <div class="meta">
        <div class="meta-item"><label>Cliente</label><div class="val">${p.cliente_nom}</div></div>
        <div class="meta-item"><label>Fecha</label><div class="val">${fecha}</div></div>
        <div class="meta-item"><label>Estado</label><div class="val">${p.status}</div></div>
        ${esFactura && p.numero_pedido ? `<div class="meta-item"><label>N° Pedido</label><div class="val">${p.numero_pedido}</div></div>` : ''}
      </div>
      <table>
        <thead><tr>
          <th>Producto</th>
          <th class="r">Cantidad</th>
          ${colHeaders}
        </tr></thead>
        <tbody>${filas}${totalRow}</tbody>
      </table>
      <div class="footer">Victor's Bakery &amp; Sweets · ${esFactura ? 'Factura' : 'Nota de entrega'} #${docNum}</div>
    </div>`;
  }).join('');

  const titulo = esFactura ? 'Facturas' : 'Notas de entrega';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${titulo} — Victor's Bakery &amp; Sweets</title>
    <style>${CSS}</style>
  </head><body>${paginas}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}

function repProduccion(fecha) {
  const peds = G.pedidosPan.filter(p => p.date === fecha);
  const plan = (G.planProduccion && G.planProduccion[fecha]) ? G.planProduccion[fecha] : {};

  // Aggregate pedidos de pan regulares
  const byProd = {};
  peds.forEach(p => {
    p.lineas.forEach(l => {
      if (!byProd[l.pid]) byProd[l.pid] = { pedido:0, clientes:[] };
      byProd[l.pid].pedido += (l.cant||1);
      byProd[l.pid].clientes.push({ cli:p.cli, cant:l.cant||1, inst:l.inst||'', status:p.status });
    });
  });

  // Sumar pedidos comerciales del día desde cache
  if (_sbPedComCache) {
    const comHoy = _sbPedComCache.filter(p => (p.fecha||p.date) === fecha && _docEstaAbierto(p));
    comHoy.forEach(p => {
      (p._lineasSb||[]).forEach(l => {
        const cod = _sbProdMapInv?.[l.producto_id] || '';
        if (!cod) return;
        if (!byProd[cod]) byProd[cod] = { pedido:0, clientes:[] };
        byProd[cod].pedido += (l.cantidad||1);
        byProd[cod].clientes.push({ cli: p.cliente_nom + ' 🏪', cant: l.cantidad||1, inst: '', status: p.status });
      });
    });
  }

  // All pids: from orders + from plan
  const allPids = new Set([...Object.keys(byProd), ...Object.keys(plan)]);

  if (!allPids.size) {
    return `<div class="ph" style="flex-direction:column;align-items:flex-start;padding:24px">
      <span style="font-size:32px">🔥</span>
      <div style="font-size:15px;font-weight:600;color:var(--cream);margin:8px 0 4px">Sin datos de producción para ${pmFmtDate(fecha)}</div>
      <div style="font-size:12px;color:var(--cream2)">Cargá pedidos y guardá el plan en el módulo Producción.</div>
    </div>`;
  }

  let totalPedido=0, totalPlan=0;
  const ordered = [
    ...G.tiposPan.filter(p => allPids.has(p.id)),
    ...[...allPids].filter(pid => !G.tiposPan.find(p=>p.id===pid)).map(pid=>({id:pid,nombre:pid}))
  ];

  const rows = ordered.map(pan => {
    const pedido = byProd[pan.id]?.pedido || 0;
    const prod   = plan[pan.id]?.prod ?? pedido;
    const nota   = plan[pan.id]?.nota || '';
    const diff   = prod - pedido;
    totalPedido += pedido;
    totalPlan   += prod;

    let estado, estadoColor, estadoIcon;
    if (prod === 0 && pedido === 0) {
      estado='Sin datos'; estadoColor='var(--cream2)'; estadoIcon='—';
    } else if (prod === 0) {
      estado='Sin plan'; estadoColor='var(--red)'; estadoIcon='❌';
    } else if (diff < 0) {
      estado=`Falta ${Math.abs(diff)}`; estadoColor='var(--red)'; estadoIcon='❌';
    } else if (diff === 0) {
      estado='Exacto'; estadoColor='var(--amber)'; estadoIcon='⚠️';
    } else {
      estado=`Sobran ${diff}`; estadoColor='var(--green)'; estadoIcon='✅';
    }

    const clientesHtml = (byProd[pan.id]?.clientes||[]).map(c =>
      `<div style="font-size:11px;color:var(--cream2)">
        ${c.cli} <span style="color:var(--gold2);font-family:'DM Mono',monospace">${c.cant}</span>
        ${c.inst?`<span style="color:var(--blue)"> · ${c.inst}</span>`:''}
        ${pmBadge(c.status)}
      </div>`
    ).join('');

    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;vertical-align:top">
        <div style="font-weight:700;font-size:13px">${pan.nombre}</div>
        <div style="margin-top:3px">${clientesHtml||'<span style="font-size:11px;color:var(--cream2);font-style:italic">Sin pedidos</span>'}</div>
        ${nota?`<div style="font-size:11px;color:var(--blue);margin-top:2px">📝 ${nota}</div>`:''}
      </td>
      <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:var(--cream2)">
        ${pedido||'—'}
      </td>
      <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:var(--gold)">
        ${prod||'—'}
      </td>
      <td style="padding:8px 10px;text-align:center">
        <span style="font-size:20px">${estadoIcon}</span>
        <div style="font-size:11px;font-weight:600;color:${estadoColor};margin-top:2px">${estado}</div>
      </td>
    </tr>`;
  }).join('');

  const statsPedido = totalPedido;
  const statsPlan   = totalPlan;
  const statsDiff   = totalPlan - totalPedido;
  const diffColor   = statsDiff < 0 ? 'var(--red)' : statsDiff === 0 ? 'var(--amber)' : 'var(--green)';
  const diffLabel   = statsDiff < 0 ? `${statsDiff} faltan` : statsDiff === 0 ? 'Exacto' : `+${statsDiff} extra`;

  const inner = `
    <div class="rep-header">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:var(--cream)">🔥 Pedidos vs Plan de Producción</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${pmFmtDate(fecha)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${repStatBox('Pedido', statsPedido + ' ud', 'var(--cream2)')}
        ${repStatBox('Plan', statsPlan + ' ud', 'var(--gold)')}
        ${repStatBox('Balance', diffLabel, diffColor)}
        <button class="btn btn-gold btn-sm no-print" onclick="repPrintSection('rep-prod-inner')" style="align-self:flex-end">🖨 Imprimir</button>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:rgba(200,146,42,.1)">
          <th style="padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Pan</th>
          <th style="padding:7px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px;width:80px">Pedido</th>
          <th style="padding:7px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--gold);width:80px">Plan</th>
          <th style="padding:7px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px;width:100px">Estado</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:rgba(200,146,42,.08);font-weight:700">
          <td style="padding:8px 10px">TOTAL</td>
          <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace">${totalPedido}</td>
          <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;color:var(--gold)">${totalPlan}</td>
          <td style="padding:8px 10px;text-align:center;font-weight:700;color:${diffColor}">${diffLabel}</td>
        </tr>
      </tfoot>
    </table>`;

  return `<div class="card" id="rep-prod-inner">${inner}</div>`;
}

// ── Sesión 8: repGastos lee de Supabase con fallback a G.gastos ──
async function repGastos(mes) {
  let list;
  let fuenteSb = false;
  if (pmDB.disponible()) {
    try {
      const [anio, mesN] = mes.split('-');
      const inicio = `${mes}-01`;
      const fin    = `${mes}-31`;
      const rows = await pmDB.get('gastos', {}, '*');
      // Filtrar por mes en cliente (la tabla no tiene filtro de rango en pmDB.get básico)
      const sbRows = (rows || []).filter(r => r.fecha && r.fecha >= inicio && r.fecha <= fin);
      if (sbRows.length) {
        list = sbRows.map(r => ({
          fecha: r.fecha,
          prov: r.proveedor_nom || '—',
          det: r.detalle || '',
          monto: parseFloat(r.monto) || 0
        }));
        fuenteSb = true;
      }
    } catch(e) { console.warn('[pmDB] repGastos:', e.message); }
  }
  // Fallback a localStorage
  if (!list) {
    list = G.gastos.filter(g => g.fecha.startsWith(mes)).map(g => ({
      fecha: g.fecha, prov: g.prov, det: g.det || '', monto: g.monto
    }));
  }
  list.sort((a,b) => a.fecha.localeCompare(b.fecha));
  const total = list.reduce((s,g) => s + g.monto, 0);
  const byProv = {};
  list.forEach(g => { if (!byProv[g.prov]) byProv[g.prov] = 0; byProv[g.prov] += g.monto; });
  const fuenteLabel = fuenteSb
    ? '<span style="font-size:10px;color:var(--green);margin-left:8px">● Supabase</span>'
    : '<span style="font-size:10px;color:var(--cream2);margin-left:8px">● localStorage</span>';
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <div><div class="rep-ph">💰 Gastos ${mes}${fuenteLabel}</div></div>
      <div style="display:flex;gap:8px">${repStatBox('Total',pmMoney(total),'var(--red)')}${repStatBox('Registros',list.length)}</div>
    </div>
    <div style="margin-bottom:12px">
      <div class="ctitle">Por proveedor</div>
      <table class="rep-tbl">
        <thead><tr><th>Proveedor</th><th style="text-align:right">Total</th><th style="text-align:right">%</th></tr></thead>
        <tbody>
          ${Object.entries(byProv).sort((a,b)=>b[1]-a[1]).map(([p,m])=>`<tr>
            <td style="font-weight:500">${p}</td>
            <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(m)}</td>
            <td style="text-align:right;color:var(--cream2)">${total?((m/total)*100).toFixed(1)+'%':'—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="ctitle">Detalle completo</div>
    <table class="rep-tbl">
      <thead><tr><th>Fecha</th><th>Proveedor</th><th>Detalle</th><th style="text-align:right">Monto</th></tr></thead>
      <tbody>
        ${list.map(g=>`<tr>
          <td style="font-size:11px;color:var(--cream2)">${pmFmtDateShort(g.fecha)}</td>
          <td style="font-weight:500">${g.prov}</td>
          <td style="font-size:11px;color:var(--cream2)">${g.det||'—'}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(g.monto)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="3">TOTAL</td><td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(total)}</td></tr></tfoot>
    </table>
  </div>`;
}

// ── Sesión 8: repVentas — lee tabla ventas desde Supabase ──
async function repVentas(mes) {
  const out = document.getElementById('rep-out');
  if (out) out.innerHTML = '<div class="ph"><span class="ph-icon" style="font-size:28px">⏳</span>Cargando ventas desde Supabase...</div>';

  if (!pmDB.disponible()) {
    return `<div class="ph"><span class="ph-icon">⚠️</span>Sin conexión a Supabase — las ventas solo viven en la nube</div>`;
  }

  let ventas = [], pedidosSb = [];
  try {
    const inicio = `${mes}-01`;
    const fin    = `${mes}-31`;
    // Leer ventas del mes (filtro en cliente)
    const allVentas = await pmDB.ventas.listar();
    ventas = (allVentas || []).filter(v => v.fecha_pago >= inicio && v.fecha_pago <= fin);
    // Leer pedidos cerrados del mes para el comparativo
    const allPeds = await pmDB.pedidos.listar();
    pedidosSb = (allPeds || []).filter(p =>
      p.fecha >= inicio && p.fecha <= fin &&
      (p.status === 'Pagado' || p.status === 'En recepción pagado')
    );
  } catch(e) {
    return `<div class="ph"><span class="ph-icon">⚠️</span>Error al cargar ventas: ${e.message}</div>`;
  }

  if (!ventas.length) {
    return `<div class="ph" style="flex-direction:column;align-items:flex-start;padding:24px">
      <span style="font-size:32px">💳</span>
      <div style="font-size:15px;font-weight:600;color:var(--cream);margin:8px 0 4px">Sin ventas registradas para ${mes}</div>
      <div style="font-size:12px;color:var(--cream2)">Las ventas se crean automáticamente cuando un pedido pasa a estado Pagado.</div>
    </div>`;
  }

  // Agrupar por día
  const byDia = {};
  ventas.forEach(v => {
    const d = v.fecha_pago;
    if (!byDia[d]) byDia[d] = { total: 0, count: 0, metodos: {} };
    byDia[d].total += parseFloat(v.total) || 0;
    byDia[d].count++;
    const mp = v.metodo_pago || 'efectivo';
    byDia[d].metodos[mp] = (byDia[d].metodos[mp] || 0) + (parseFloat(v.total) || 0);
  });

  // Agrupar por método de pago
  const byMetodo = {};
  ventas.forEach(v => {
    const mp = v.metodo_pago || 'efectivo';
    if (!byMetodo[mp]) byMetodo[mp] = { total: 0, count: 0 };
    byMetodo[mp].total += parseFloat(v.total) || 0;
    byMetodo[mp].count++;
  });

  // Agrupar por cliente (para ventas comerciales)
  // FIX: antes se descartaban en silencio las ventas sin cliente_nom
  // (con .filter(v => v.cliente_nom)) — el dinero seguía sumando en el
  // total general de arriba, pero desaparecía de esta tabla sin ningún
  // aviso, lo que hacía parecer que "faltaba" plata. Ahora esas ventas
  // se agrupan bajo un rótulo visible en vez de excluirse.
  const byCliente = {};
  ventas.forEach(v => {
    const cli = v.cliente_nom || '(sin nombre de cliente)';
    if (!byCliente[cli]) byCliente[cli] = { total: 0, count: 0 };
    byCliente[cli].total += parseFloat(v.total) || 0;
    byCliente[cli].count++;
  });

  const rowsCliente = Object.entries(byCliente).sort((a,b) => b[1].total - a[1].total).map(([cli, v]) =>
    `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-weight:600">${cli}</td>
      <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;color:var(--cream2)">${v.count}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${pmMoney(v.total)}</td>
    </tr>`
  ).join('');

  const secClientes = Object.keys(byCliente).length ? `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;color:var(--cream2);margin:16px 0 8px">Por cliente</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Cliente</th>
        <th style="padding:7px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Ventas</th>
        <th style="padding:7px 10px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Total</th>
      </tr></thead>
      <tbody>${rowsCliente}</tbody>
    </table>` : '';

  const totalVentas  = ventas.reduce((s,v) => s + (parseFloat(v.total)||0), 0);
  const totalPedidos = pedidosSb.reduce((s,p) => s + (parseFloat(p.total)||0), 0);
  const diff         = totalVentas - totalPedidos;
  const metodoLabels = { efectivo:'Efectivo', sinpe:'SINPE', transferencia:'Transferencia', otro:'Otro' };
  const metodoIcons  = { efectivo:'💵', sinpe:'📱', transferencia:'🏦', otro:'💱' };

  const rowsDia = Object.entries(byDia).sort(([a],[b])=>a.localeCompare(b)).map(([d, v]) => {
    const metodosStr = Object.entries(v.metodos)
      .map(([mp,m]) => `<span style="font-size:10px;background:rgba(200,146,42,.12);border:1px solid rgba(200,146,42,.3);border-radius:10px;padding:1px 7px;margin-right:4px;color:var(--gold2)">${metodoIcons[mp]||'💱'} ${metodoLabels[mp]||mp}: ${pmMoney(m)}</span>`)
      .join('');
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-weight:600">${pmFmtDate(d)}</td>
      <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;color:var(--cream2)">${v.count}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:15px;font-weight:700;color:var(--gold)">${pmMoney(v.total)}</td>
      <td style="padding:8px 10px">${metodosStr}</td>
    </tr>`;
  });

  const rowsMetodo = Object.entries(byMetodo).sort((a,b)=>b[1].total-a[1].total).map(([mp,v]) => {
    return `<tr>
      <td style="padding:7px 10px;font-weight:600">${metodoIcons[mp]||'💱'} ${metodoLabels[mp]||mp}</td>
      <td style="padding:7px 10px;text-align:center;font-family:'DM Mono',monospace;color:var(--cream2)">${v.count}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold)">${pmMoney(v.total)}</td>
      <td style="padding:7px 10px;text-align:right;color:var(--cream2)">${totalVentas?((v.total/totalVentas)*100).toFixed(1)+'%':'—'}</td>
    </tr>`;
  });

  const diffColor = Math.abs(diff) < 1 ? 'var(--green)' : diff > 0 ? 'var(--amber)' : 'var(--red)';
  const diffLabel = Math.abs(diff) < 1 ? 'Coinciden ✓' : diff > 0 ? `+${pmMoney(diff)} ventas > pedidos` : `${pmMoney(diff)} ventas < pedidos`;

  return `<div class="card" id="rep-ventas-inner">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:var(--cream)">💳 Registro de Ventas</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${mes} · desde Supabase</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${repStatBox('Total cobrado', pmMoney(totalVentas))}
        ${repStatBox('Transacciones', ventas.length, 'var(--cream2)')}
        <button class="btn btn-gold btn-sm no-print" onclick="repPrintSection('rep-ventas-inner')">🖨 Imprimir</button>
      </div>
    </div>

    <!-- Comparativo vs pedidos cerrados -->
    <div style="background:rgba(200,146,42,.07);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="flex:1">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;color:var(--cream2);margin-bottom:6px">Comparativo vs pedidos pagados</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div><div style="font-size:10px;color:var(--cream2)">Ventas registradas</div><div style="font-family:'DM Mono',monospace;font-size:16px;font-weight:700;color:var(--gold)">${pmMoney(totalVentas)}</div></div>
          <div><div style="font-size:10px;color:var(--cream2)">Total pedidos cerrados</div><div style="font-family:'DM Mono',monospace;font-size:16px;font-weight:700;color:var(--cream2)">${pmMoney(totalPedidos)}</div><div style="font-size:10px;color:var(--cream2)">${pedidosSb.length} pedidos</div></div>
          <div><div style="font-size:10px;color:var(--cream2)">Diferencia</div><div style="font-family:'DM Mono',monospace;font-size:16px;font-weight:700;color:${diffColor}">${diffLabel}</div></div>
        </div>
      </div>
    </div>

    <!-- Por cliente -->
    ${secClientes}

    <!-- Por método de pago -->
    <div class="ctitle">Por método de pago</div>
    <table class="rep-tbl" style="margin-bottom:16px">
      <thead><tr><th>Método</th><th style="text-align:center">Transacc.</th><th style="text-align:right">Total</th><th style="text-align:right">%</th></tr></thead>
      <tbody>${rowsMetodo.join('')}</tbody>
    </table>

    <!-- Por día -->
    <div class="ctitle">Detalle por día</div>
    <table class="rep-tbl">
      <thead><tr>
        <th>Fecha</th>
        <th style="text-align:center">Ventas</th>
        <th style="text-align:right">Total ₡</th>
        <th>Métodos</th>
      </tr></thead>
      <tbody>${rowsDia.join('')}</tbody>
      <tfoot><tr>
        <td>TOTAL</td>
        <td style="text-align:center;font-family:'DM Mono',monospace">${ventas.length}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${pmMoney(totalVentas)}</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>`;
}

// ── Sesión 8: repMensual con ventas de Supabase ──
async function repMensual(mes) {
  // Obtener ventas de Supabase para el mes (más preciso que calcular desde pedidos)
  let ventasSbPorDia = null; // { fecha_pago → total } si Supabase disponible
  let gastosSbPorDia = null;
  if (pmDB.disponible()) {
    try {
      const inicio = `${mes}-01`;
      const fin    = `${mes}-31`;
      const allV = await pmDB.ventas.listar();
      const allG = await pmDB.get('gastos', {}, '*');
      ventasSbPorDia = {};
      (allV||[]).filter(v=>v.fecha_pago>=inicio&&v.fecha_pago<=fin).forEach(v=>{
        ventasSbPorDia[v.fecha_pago] = (ventasSbPorDia[v.fecha_pago]||0) + (parseFloat(v.total)||0);
      });
      gastosSbPorDia = {};
      (allG||[]).filter(g=>g.fecha>=inicio&&g.fecha<=fin).forEach(g=>{
        gastosSbPorDia[g.fecha] = (gastosSbPorDia[g.fecha]||0) + (parseFloat(g.monto)||0);
      });
    } catch(e) { console.warn('[pmDB] repMensual:', e.message); }
  }

  // Fallback: fechas desde localStorage
  const dates = new Set([
    ...G.pedidosPan.filter(p=>p.date.startsWith(mes)).map(p=>p.date),
    ...G.pedidosGalletas.filter(p=>p.date.startsWith(mes)).map(p=>p.date),
    ...G.pedidosCom.filter(p=>p.date.startsWith(mes)).map(p=>p.date),
    ...(ventasSbPorDia ? Object.keys(ventasSbPorDia) : []),
    ...(gastosSbPorDia ? Object.keys(gastosSbPorDia) : []),
  ]);
  const sorted = [...dates].sort();
  if (!sorted.length) return `<div class="ph"><span class="ph-icon">📅</span>Sin datos para ${mes}</div>`;

  let totRev=0, totGast=0;
  const fuenteVentas = ventasSbPorDia ? '● Supabase' : '● localStorage';
  const fuenteColor  = ventasSbPorDia ? 'var(--green)' : 'var(--cream2)';

  const rows = sorted.map(d => {
    let rev;
    if (ventasSbPorDia) {
      rev = ventasSbPorDia[d] || 0;
    } else {
      rev = 0;
      G.pedidosPan.filter(p=>p.date===d).forEach(p=>rev+=pmTotalPan(p));
      G.pedidosGalletas.filter(p=>p.date===d).forEach(p=>rev+=pmTotalGall(p));
      G.pedidosCom.filter(p=>p.date===d).forEach(p=>rev+=pmTotalCom(p));
    }
    const gast = gastosSbPorDia
      ? (gastosSbPorDia[d] || 0)
      : G.gastos.filter(g=>g.fecha===d).reduce((s,g)=>s+g.monto,0);
    totRev+=rev; totGast+=gast;
    const margen=rev-gast;
    return `<tr>
      <td>${pmFmtDate(d)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">${pmMoney(rev)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--red)">${gast?pmMoney(gast):'—'}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;color:${margen>=0?'var(--green)':'var(--red)'}">${pmMoney(margen)}</td>
    </tr>`;
  });

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <div>
        <div class="rep-ph">📅 Resumen Mensual ${mes}</div>
        <div style="font-size:10px;color:${fuenteColor};margin-top:3px">${fuenteVentas}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${repStatBox('Ventas',pmMoney(totRev))}
        ${repStatBox('Gastos',pmMoney(totGast),'var(--red)')}
        ${repStatBox('Margen',pmMoney(totRev-totGast),'var(--green)')}
      </div>
    </div>
    <table class="rep-tbl">
      <thead><tr><th>Fecha</th><th style="text-align:right">Ventas</th><th style="text-align:right">Gastos</th><th style="text-align:right">Margen</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
      <tfoot><tr>
        <td>TOTAL</td>
        <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(totRev)}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(totGast)}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace">${pmMoney(totRev-totGast)}</td>
      </tr></tfoot>
    </table>
  </div>`;
}
