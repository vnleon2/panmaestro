// ── 🔥 PRODUCCIÓN ──────────────────────────────────────────
function prodNav(d) {
  const dt = new Date(document.getElementById('prod-date').value + 'T12:00:00');
  dt.setDate(dt.getDate() + d);
  document.getElementById('prod-date').value = dt.toISOString().slice(0,10);
  prodRenderConSb();
}

async function prodCargarDesdeSb(fecha) {
  if (!pmDB.disponible()) return;
  try {
    const rows = await pmDB.get('plan_produccion', { fecha });
    if (!rows || !rows.length) return;
    await _sbProdEnsureMap();
    if (!G.planProduccion) G.planProduccion = {};
    // Limpiar formato viejo (número directo) antes de cargar desde Supabase
    G.planProduccion[fecha] = {};
    rows.forEach(row => {
      const cod = _sbProdMapInv?.[row.producto_id] || '';
      if (cod) {
        if (!G.planProduccion[fecha][cod]) G.planProduccion[fecha][cod] = {};
        if (row.tipo === 'pedido' || row.tipo === 'libre') {
          G.planProduccion[fecha][cod].prod = row.cantidad || 0;
          G.planProduccion[fecha][cod].nota = row.nota || '';
        }
      }
    });
    pmSave('sistema');
  } catch(e) {
    console.warn('[prodCargarDesdeSb]', e.message);
  }
}

function prodGetPlan(fecha) {
  if (!G.planProduccion) G.planProduccion = {};
  if (!G.planProduccion[fecha]) G.planProduccion[fecha] = {};
  return G.planProduccion[fecha];
}

async function prodRenderConSb() {
  const fecha = document.getElementById('prod-date').value || pmHoy();
  await prodCargarDesdeSb(fecha);
  // Cargar pedidos comerciales del día desde Supabase
  let pedsCom = [];
  if (pmDB.disponible()) {
    try {
      await _sbProdEnsureMap();
      const todos  = _sbPedComCache || await _sbPedComCargar();
      pedsCom = todos.filter(p => (p.fecha||p.date) === fecha && _docEstaAbierto(p));
    } catch(e) { console.warn('[prodRenderConSb] pedsCom:', e.message); }
  }
  prodRender(pedsCom);
}

function prodRender(pedsCom = []) {
  const fecha = document.getElementById('prod-date').value || pmHoy();
  const peds  = G.pedidosPan.filter(p => p.date === fecha);
  const plan  = prodGetPlan(fecha);

  // Aggregate pedidos de pan por producto
  const byProd = {};
  peds.forEach(p => {
    p.lineas.forEach(l => {
      if (!byProd[l.pid]) byProd[l.pid] = { pedido:0, clientes:[] };
      byProd[l.pid].pedido += (l.cant||1);
      byProd[l.pid].clientes.push({ cli:p.cli, cant:l.cant||1, inst:l.inst||'' });
    });
  });

  // Sumar pedidos comerciales del día
  pedsCom.forEach(p => {
    (p._lineasSb || []).forEach(l => {
      const cod = _sbProdMapInv?.[l.producto_id] || '';
      if (!cod) return;
      if (!byProd[cod]) byProd[cod] = { pedido:0, clientes:[] };
      byProd[cod].pedido += (l.cantidad||1);
      byProd[cod].clientes.push({ cli: p.cliente_nom + ' 🏪', cant: l.cantidad||1, inst: '' });
    });
  });

  // Merge plan extras (products added manually without orders)
  const allPids = new Set([...Object.keys(byProd), ...Object.keys(plan)]);

  const totalPedido = [...allPids].reduce((s,pid) => s + (byProd[pid]?.pedido||0), 0);
  const totalProd   = [...allPids].reduce((s,pid) => s + (plan[pid]?.prod||0), 0);

  // Stats
  document.getElementById('prod-stats').innerHTML = `
    <div class="stat"><div class="stat-lbl">Clientes</div><div class="stat-val">${peds.length}</div></div>
    <div class="stat"><div class="stat-lbl">Pedido</div><div class="stat-val">${totalPedido} ud</div></div>
    <div class="stat"><div class="stat-lbl">A producir</div><div class="stat-val" style="color:var(--gold)">${totalProd} ud</div></div>
    <div class="stat"><div class="stat-lbl">Tipos</div><div class="stat-val">${allPids.size}</div></div>
  `;

  // Fill pan selector for adding extras
  const selAdd = document.getElementById('prod-add-pan');
  if (selAdd) {
    selAdd.innerHTML = G.tiposPan.map(p =>
      `<option value="${p.id}">${p.nombre}</option>`
    ).join('');
  }

  // Build plan table
  if (!allPids.size) {
    document.getElementById('prod-plan-table').innerHTML =
      '<div class="ph" style="padding:16px 0"><span class="ph-icon">🔥</span>Sin pedidos para este día — podés agregar productos manualmente abajo</div>';
    return;
  }

  // Order: first by G.tiposPan order, then any extras not in tiposPan
  const ordered = [
    ...G.tiposPan.filter(p => allPids.has(p.id)),
    ...[...allPids].filter(pid => !G.tiposPan.find(p => p.id === pid)).map(pid => ({ id:pid, nombre: pid }))
  ];

  let rows = ordered.map(pan => {
    const d = byProd[pan.id] || { pedido:0, clientes:[] };
    const prodVal = plan[pan.id]?.prod ?? d.pedido;
    const nota    = plan[pan.id]?.nota ?? '';
    const isExtra = !byProd[pan.id]; // added manually, no orders

    const clientesHtml = d.clientes.length
      ? d.clientes.map(c =>
          `<div style="font-size:11px;color:var(--cream2);padding:1px 0">
            ${c.cli} <span style="color:var(--gold2);font-family:'DM Mono',monospace">${c.cant}</span>
            ${c.inst ? `<span style="color:var(--blue)"> · ${c.inst}</span>` : ''}
          </div>`).join('')
      : `<div style="font-size:11px;color:var(--cream2);font-style:italic">Sin pedidos</div>`;

    return `<tr id="prodrow-${pan.id}" style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;vertical-align:top">
        <div style="font-weight:700;font-size:13px">${pan.nombre}</div>
        <div style="margin-top:4px">${clientesHtml}</div>
      </td>
      <td style="padding:8px 10px;text-align:center;vertical-align:middle;font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:var(--cream2)">
        ${d.pedido || '—'}
      </td>
      <td style="padding:8px 10px;text-align:center;vertical-align:middle">
        <input type="number" min="0" value="${prodVal}"
          id="prod-val-${pan.id}"
          onchange="prodActualizar('${pan.id}')"
          style="width:72px;padding:6px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:8px;color:var(--gold);font-family:'DM Mono',monospace;font-size:16px;font-weight:700;text-align:center">
      </td>
      <td style="padding:8px 10px;vertical-align:middle">
        <input type="text" value="${nota}" placeholder="Nota..."
          id="prod-nota-${pan.id}"
          onchange="prodActualizar('${pan.id}')"
          style="width:100%;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:12px">
      </td>
      <td style="padding:8px 6px;vertical-align:middle" class="no-print">
        <button class="btn btn-red btn-sm" onclick="prodQuitarExtra('${pan.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('prod-plan-table').innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:rgba(200,146,42,.1)">
          <th style="padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Pan</th>
          <th style="padding:7px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px;width:70px">Pedido</th>
          <th style="padding:7px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px;width:90px;color:var(--gold)">Producir</th>
          <th style="padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Nota</th>
          <th style="width:36px" class="no-print"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:rgba(200,146,42,.08);font-weight:700">
          <td style="padding:8px 10px">TOTAL</td>
          <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace">${totalPedido}</td>
          <td id="prod-tfoot-total" style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;color:var(--gold)">${totalProd}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>`;
}

function prodActualizar(pid) {
  const fecha = document.getElementById('prod-date').value || pmHoy();
  const plan  = prodGetPlan(fecha);
  const valEl = document.getElementById('prod-val-'  + pid);
  const notaEl= document.getElementById('prod-nota-' + pid);
  if (!plan[pid]) plan[pid] = {};
  if (valEl)  plan[pid].prod = parseInt(valEl.value)||0;
  if (notaEl) plan[pid].nota = notaEl.value;
  // Update total stat
  const allPids = new Set([
    ...Object.keys(G.pedidosPan.filter(p=>p.date===fecha).reduce((acc,p)=>{p.lineas.forEach(l=>{acc[l.pid]=1});return acc},{})),
    ...Object.keys(plan)
  ]);
  const totalProd = [...allPids].reduce((s,p2) => s + (plan[p2]?.prod||0), 0);
  const statEl = document.getElementById('prod-stats');
  if (statEl) {
    const cells = statEl.querySelectorAll('.stat');
    if (cells[2]) cells[2].querySelector('.stat-val').textContent = totalProd + ' ud';
  }
  // FIX: el TOTAL del pie de la tabla (tfoot) se calculaba solo en
  // prodRender() y no se refrescaba al cambiar una cantidad — quedaba
  // desactualizado hasta guardar (o navegar y volver). Ahora se actualiza
  // en vivo junto con el total de la tarjeta de arriba.
  const tfootTotal = document.getElementById('prod-tfoot-total');
  if (tfootTotal) tfootTotal.textContent = totalProd;
}

async function prodGuardar() {
  // Save all current input values to plan before persisting
  const fecha = document.getElementById('prod-date').value || pmHoy();
  const plan  = prodGetPlan(fecha);
  document.querySelectorAll('[id^="prod-val-"]').forEach(el => {
    const pid = el.id.replace('prod-val-','');
    if (plan[pid] !== undefined) {  // solo actualizar si NO fue borrado
      plan[pid].prod = parseInt(el.value)||0;
    }
  });
  document.querySelectorAll('[id^="prod-nota-"]').forEach(el => {
    const pid = el.id.replace('prod-nota-','');
    if (plan[pid] !== undefined) {  // solo actualizar si NO fue borrado
      plan[pid].nota = el.value;
    }
  });
  pmSave('produccion');
  pmToast('Plan guardado ✓');
  // Guardar en Supabase y refrescar
  await _sbProdEnsureMap();
  const rows = Object.entries(plan).map(([pid, v]) => {
    const sbId = _sbProdMap?.[pid];
    if (!sbId) return null;
    if ((v.prod || 0) === 0 && !v.nota) return null; // no insertar filas vacías
    return { fecha, producto_id: sbId, cantidad: v.prod || 0, tipo: 'pedido', nota: v.nota || null };
  }).filter(Boolean);
  const mapaProdOk = _sbProdMap && Object.keys(_sbProdMap).length > 0;
  if (rows.length) {
    try {
      await pmDB.planProduccion.guardar(rows, fecha, 'pedido');
      pmToast(`Plan guardado en Supabase ✓ (${rows.length} productos)`);
    } catch(e) {
      pmToast('Error al guardar en Supabase: ' + e.message, 'err');
      console.warn('[pmDB] plan_produccion upsert:', e.message);
    }
  } else if (mapaProdOk) {
    // SESIÓN 11 fix: el mapa de productos sí cargó bien, así que una lista
    // vacía es un vaciado INTENCIONAL (todo en 0 / todo borrado) — hay que
    // avisarle a Supabase para que limpie lo que había antes, si no, el
    // plan viejo queda "pegado" para siempre.
    try {
      await pmDB.planProduccion.guardar([], fecha, 'pedido');
      pmToast('Plan vaciado en Supabase ✓');
    } catch(e) {
      pmToast('Error al vaciar en Supabase: ' + e.message, 'err');
      console.warn('[pmDB] plan_produccion clear:', e.message);
    }
  } else {
    // El mapa de productos no cargó — no tocamos Supabase para no borrar
    // por error un plan válido a causa de un fallo temporal de conexión.
    pmToast('⚠️ Sin productos para guardar en Supabase — mapa de productos vacío', 'err');
  }
  await prodRenderConSb();
  const semCard = document.getElementById('prod-semana-card');
  if (semCard && semCard.style.display !== 'none') {
    await new Promise(r => setTimeout(r, 500));
    await prodSemanaVer();
  }
}

async function prodAgregarExtra() {
  const pid  = document.getElementById('prod-add-pan').value;
  const cant = parseInt(document.getElementById('prod-add-cant').value)||1;
  if (!pid) return;
  const fecha = document.getElementById('prod-date').value || pmHoy();
  const plan  = prodGetPlan(fecha);
  if (!plan[pid]) plan[pid] = {};
  plan[pid].prod = (plan[pid].prod||0) + cant;
  document.getElementById('prod-add-cant').value = 1;
  await prodGuardar();
}

async function prodQuitarExtra(pid) {
  const fecha = document.getElementById('prod-date').value || pmHoy();
  const plan  = prodGetPlan(fecha);
  delete plan[pid];
  pmSave('produccion');
  await _sbProdEnsureMap();
  // Borrar todos los registros del día y reinsertar sin el producto eliminado
  const token = await (async () => {
    try { const c = window._sbAuthClient; if (c) { const {data} = await c.auth.getSession(); if (data?.session?.access_token) return data.session.access_token; } } catch(e) {}
    return 'sb_publishable_pmKVIGa_lNxtzRos-iY_0Q_LXEcj77v';
  })();
  const SB_URL = 'https://xmhokxmuxfkfypttvkjz.supabase.co';
  const hdrs = { 'Content-Type':'application/json', 'apikey': token, 'Authorization': `Bearer ${token}`, 'Prefer': 'return=minimal' };
  try {
    await fetch(`${SB_URL}/rest/v1/plan_produccion?fecha=eq.${fecha}&tipo=eq.pedido`, { method:'DELETE', headers: hdrs });
    const rows = Object.entries(plan).map(([p, v]) => {
      const sbId = _sbProdMap?.[p];
      if (!sbId || (v.prod||0) === 0) return null;
      return { fecha, producto_id: sbId, cantidad: v.prod||0, tipo:'pedido', nota: v.nota||null };
    }).filter(Boolean);
    if (rows.length) {
      await fetch(`${SB_URL}/rest/v1/plan_produccion`, { method:'POST', headers: {...hdrs, 'Prefer':'return=minimal'}, body: JSON.stringify(rows) });
    }
    pmToast('Producto eliminado del plan ✓');
  } catch(e) {
    pmToast('Error al eliminar: ' + e.message, 'err');
  }
  await prodRenderConSb();
}

function prodPrint() {
  prodGuardar();
  const fecha = document.getElementById('prod-date').value || pmHoy();
  const card  = document.getElementById('prod-plan-card');
  if (!card) return;
  const w = window.open('','_blank','width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Plan Producción ${fecha}</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600&family=DM+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;font-size:13px;color:#1a1006;padding:28px;background:#fff}
      h1{font-family:'Playfair Display',serif;font-size:22px;margin-bottom:4px}
      table{width:100%;border-collapse:collapse}
      th{background:#f5e8d0;padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px}
      td{padding:8px 10px;border-bottom:1px solid #e8dcc8;vertical-align:top}
      tfoot td{font-weight:700;background:#fdf5e6;border-top:2px solid #C8922A}
      .no-print{display:none}
      .prod-num{font-family:'DM Mono',monospace;font-size:18px;font-weight:700;text-align:center}
      .prod-gold{color:#C8922A}
      @media print{body{padding:16px}}
    </style>
  </head><body>
    <h1>🔥 Plan de Producción</h1>
    <p style="margin-bottom:16px;font-size:12px;color:#7a6040">${pmFmtDate(fecha)}</p>
  `);
  w.document.write(card.innerHTML);
  w.document.write('</body></html>');
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
}

// ─── SESIÓN 7 — PRODUCCIÓN: LOTES + VISTA SEMANAL ───────────────────────────
// _sbLoteActual : objeto lote en memoria mientras el modal está abierto
//   { sbId, fecha, hora_inicio, hora_fin, responsable, observaciones, items:[] }
// _sbLoteItems  : array de items editados en el modal (antes de guardar)

let _sbLoteActual = null;
let _sbLoteItems  = [];

// ── Cargar lotes del día desde Supabase ──
async function _sbLotesCargar() {
  if (!pmDB.disponible()) return;
  const fecha = document.getElementById('prod-date').value || pmHoy();
  try {
    const lotes = await pmDB.lotes.listarHoy();
    _sbLotesRender(lotes || []);
  } catch(e) {
    console.warn('[pmDB] lotes cargar:', e.message);
  }
}

function _sbLotesRender(lotes) {
  const el = document.getElementById('prod-lotes-list');
  if (!el) return;
  if (!lotes.length) {
    el.innerHTML = '<div class="ph" style="padding:12px 0"><span class="ph-icon">🏭</span>Sin lotes para este día</div>';
    return;
  }
  el.innerHTML = lotes.map(l => {
    const statusColor = l.status === 'cerrado' ? 'var(--green)' : 'var(--gold)';
    const statusLabel = l.status === 'cerrado' ? '✅ Cerrado' : '🔴 Abierto';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--sf);border-radius:10px;margin-bottom:8px;border:1px solid var(--border)">
      <div>
        <div style="font-weight:700;font-size:13px">Lote ${pmFmtDate ? pmFmtDate(l.fecha) : l.fecha}
          ${l.hora_inicio ? `<span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--cream2);margin-left:6px">${l.hora_inicio}${l.hora_fin ? ' – '+l.hora_fin : ''}</span>` : ''}
        </div>
        ${l.responsable ? `<div style="font-size:11px;color:var(--cream2);margin-top:2px">👤 ${l.responsable}</div>` : ''}
        ${l.observaciones ? `<div style="font-size:11px;color:var(--cream2);margin-top:2px">${l.observaciones}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px;color:${statusColor};font-weight:600">${statusLabel}</span>
        ${l.status === 'abierto'
          ? `<button class="btn btn-out btn-sm" onclick="loteEditar('${l.id}')">✎ Editar</button>
             <button class="btn btn-gold btn-sm" onclick="loteCerrar('${l.id}')">Cerrar lote</button>`
          : `<button class="btn btn-out btn-sm" onclick="loteVerItems('${l.id}')">Ver items</button>`
        }
      </div>
    </div>`;
  }).join('');
}

// ── Nuevo lote ──
async function loteNuevo() {
  await _sbProdEnsureMap();
  _sbLoteActual = null;
  _sbLoteItems  = [];
  document.getElementById('lote-edit-id').value = '';
  document.getElementById('lote-modal-title').textContent = 'Nuevo Lote';
  document.getElementById('lote-hora-ini').value = '';
  document.getElementById('lote-hora-fin').value = '';
  document.getElementById('lote-resp').value = '';
  document.getElementById('lote-obs').value = '';
  // Fill pan selector
  const sel = document.getElementById('lote-item-pan');
  if (sel) sel.innerHTML = G.tiposPan.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
  _loteItemsRender();
  document.getElementById('lote-modal').style.display = 'block';
}

function loteEditar(id) {
  // Carga lote desde Supabase y abre modal
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase', 'err'); return; }
  pmDB.lotes.listar({ id }).then(async arr => {
    const l = arr?.[0];
    if (!l) return;
    _sbLoteActual = { sbId: l.id };
    document.getElementById('lote-edit-id').value = l.id;
    document.getElementById('lote-modal-title').textContent = 'Editar Lote';
    document.getElementById('lote-hora-ini').value = l.hora_inicio || '';
    document.getElementById('lote-hora-fin').value = l.hora_fin || '';
    document.getElementById('lote-resp').value = l.responsable || '';
    document.getElementById('lote-obs').value = l.observaciones || '';
    // Cargar items del lote
    const items = await pmDB.lotes.items.listar(l.id);
    _sbLoteItems = (items || []).map(it => ({
      sbId: it.id,
      pid: it.producto_id,        // uuid Supabase
      pidLocal: _sbProdMapInv?.[it.producto_id] || '', // código local ej P001
      nombre: _sbProdNombre(it.producto_id),
      planificado: it.cant_planificada || 0,
      real: it.cant_real || 0,
      notas: it.notas || ''
    }));
    const sel = document.getElementById('lote-item-pan');
    if (sel) sel.innerHTML = G.tiposPan.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
    _loteItemsRender();
    document.getElementById('lote-modal').style.display = 'block';
  }).catch(e => pmToast('Error al cargar lote', 'err'));
}

function _sbProdNombre(productoId) {
  // Lookup O(1) usando _sbProdMapInv { uuid → codigo }
  if (!_sbProdMapInv) return productoId;
  const codigo = _sbProdMapInv[productoId];
  if (!codigo) return productoId;
  const tp = G.tiposPan.find(p => p.id === codigo) || G.tiposGalleta?.find(p => p.id === codigo);
  return tp?.nombre || codigo;
}

function _loteItemsRender() {
  const el = document.getElementById('lote-items-list');
  if (!el) return;
  if (!_sbLoteItems.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--cream2);padding:6px 0">Sin items — agregá productos abajo</div>';
    return;
  }
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:rgba(200,146,42,.1)">
      <th style="padding:5px 8px;text-align:left">Pan</th>
      <th style="padding:5px 8px;text-align:center;width:80px">Planif.</th>
      <th style="padding:5px 8px;text-align:center;width:80px">Real</th>
      <th style="padding:5px 8px;width:30px"></th>
    </tr></thead>
    <tbody>
      ${_sbLoteItems.map((it,i) => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 8px;font-weight:600">${it.nombre}</td>
        <td style="padding:5px 8px;text-align:center">
          <input type="number" min="0" value="${it.planificado}" style="width:64px;padding:4px 6px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--cream);text-align:center;font-family:'DM Mono',monospace"
            onchange="_sbLoteItems[${i}].planificado=parseInt(this.value)||0">
        </td>
        <td style="padding:5px 8px;text-align:center">
          <input type="number" min="0" value="${it.real}" style="width:64px;padding:4px 6px;background:var(--bg2);border:1px solid var(--gold);border-radius:6px;color:var(--gold);text-align:center;font-family:'DM Mono',monospace;font-weight:700"
            onchange="_sbLoteItems[${i}].real=parseInt(this.value)||0">
        </td>
        <td style="padding:5px 8px;text-align:center">
          <button class="btn btn-red btn-xs" onclick="_sbLoteItems.splice(${i},1);_loteItemsRender()">✕</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function loteAgregarItem() {
  const pid  = document.getElementById('lote-item-pan').value;
  const plan = parseInt(document.getElementById('lote-item-plan').value) || 0;
  const real = parseInt(document.getElementById('lote-item-real').value) || 0;
  if (!pid) return;
  const tp = G.tiposPan.find(p => p.id === pid);
  if (!tp) return;
  const sbId = _sbProdMap?.[pid] || null;
  _sbLoteItems.push({ sbId: null, pid, nombre: tp.nombre, productoSbId: sbId, planificado: plan, real });
  document.getElementById('lote-item-plan').value = 0;
  document.getElementById('lote-item-real').value = 0;
  _loteItemsRender();
}

async function loteGuardar() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await _sbProdEnsureMap();
  const fecha   = document.getElementById('prod-date').value || pmHoy();
  const horaIni = document.getElementById('lote-hora-ini').value || null;
  const horaFin = document.getElementById('lote-hora-fin').value || null;
  const resp    = document.getElementById('lote-resp').value.trim() || null;
  const obs     = document.getElementById('lote-obs').value.trim() || null;
  const editId  = document.getElementById('lote-edit-id').value;

  try {
    let loteId;
    if (editId) {
      await pmDB.update('lotes_produccion', editId, {
        hora_inicio: horaIni, hora_fin: horaFin, responsable: resp, observaciones: obs
      });
      loteId = editId;
      // Eliminar items viejos y re-insertar (estrategia simple)
      const viejos = await pmDB.lotes.items.listar(loteId);
      for (const v of (viejos || [])) await pmDB.hardDelete('lote_items', v.id);
    } else {
      const res = await pmDB.lotes.crear({
        fecha, hora_inicio: horaIni, hora_fin: horaFin, responsable: resp, observaciones: obs
      });
      loteId = res?.[0]?.id;
    }
    // Insertar items
    const items = _sbLoteItems.filter(it => it.productoSbId || it.sbId).map(it => ({
      lote_id: loteId,
      producto_id: it.productoSbId || _sbProdMap?.[it.pid],
      cant_planificada: it.planificado,
      cant_real: it.real,
      notas: it.notas || null
    })).filter(it => it.producto_id);
    if (items.length) await pmDB.lotes.items.agregar(items);
    pmToast('Lote guardado ✓', 'ok');
    loteCerrarModal();
    _sbLotesCargar();
  } catch(e) {
    console.error('[pmDB] loteGuardar:', e);
    pmToast('Error al guardar lote', 'err');
  }
}

async function loteCerrar(id) {
  if (!confirm('¿Cerrar este lote? No podrá editarse después.')) return;
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  try {
    await pmDB.lotes.cerrar(id);
    pmToast('Lote cerrado ✓', 'ok');
    _sbLotesCargar();
  } catch(e) {
    pmToast('Error al cerrar lote', 'err');
  }
}

function loteVerItems(id) {
  // Re-usar modal en modo solo-lectura
  loteEditar(id); // por ahora abre en modo edición; lotes cerrados los controla el HTML
}

function loteCerrarModal() {
  document.getElementById('lote-modal').style.display = 'none';
  _sbLoteActual = null;
  _sbLoteItems  = [];
}

// ── Vista semanal ──
async function prodSemanaVer() {
  const card = document.getElementById('prod-semana-card');
  const tbl  = document.getElementById('prod-semana-table');
  card.style.display = 'block';
  tbl.innerHTML = '<div class="ph" style="padding:10px 0"><span class="ph-icon" style="font-size:20px">⏳</span>Cargando semana...</div>';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const fecha = document.getElementById('prod-date').value || pmHoy();
  const d = new Date(fecha + 'T12:00:00');
  const dia = d.getDay();
  const difLunes = (dia === 0) ? -6 : 1 - dia;
  d.setDate(d.getDate() + difLunes);
  const fechaInicio = d.toISOString().slice(0,10);
  try {
    await _sbProdEnsureMap();
    const rows = await pmDB.planProduccion.listarSemana(fechaInicio);
    if (!rows || !rows.length) {
      tbl.innerHTML = '<div class="ph" style="padding:12px 0"><span class="ph-icon">📅</span>Sin plan registrado en Supabase para esta semana — guardá el plan del día primero</div>';
      return;
    }
    _prodSemanaRender(rows, fechaInicio);
  } catch(e) {
    tbl.innerHTML = `<div class="ph"><span class="ph-icon">⚠️</span>Error al cargar semana: ${e.message}</div>`;
    console.error('[prodSemanaVer]', e);
  }
}

function _prodSemanaRender(rows, fechaInicio) {
  // Generar 7 fechas (lun-dom)
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(fechaInicio + 'T12:00:00');
    d.setDate(d.getDate() + i);
    dias.push(d.toISOString().slice(0,10));
  }
  const diasLabel = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  if (!rows.length) {
    document.getElementById('prod-semana-table').innerHTML =
      '<div class="ph" style="padding:12px 0"><span class="ph-icon">📅</span>Sin datos en Supabase para esta semana</div>';
    return;
  }

  // Agrupar por producto_id × fecha
  const byProd = {};
  rows.forEach(r => {
    const nom = _sbProdNombre(r.producto_id);
    if (!byProd[nom]) byProd[nom] = {};
    if (!byProd[nom][r.fecha]) byProd[nom][r.fecha] = { pedido: 0, libre: 0 };
    if (r.tipo === 'pedido') byProd[nom][r.fecha].pedido += r.cantidad;
    else byProd[nom][r.fecha].libre += r.cantidad;
  });

  const prods = Object.keys(byProd).sort();

  const headerCols = dias.map((f, i) => {
    const label = diasLabel[i];
    const d = new Date(f + 'T12:00:00');
    const numDia = d.getDate();
    return `<th style="padding:6px 8px;text-align:center;font-size:11px;text-transform:uppercase;width:70px">
      ${label}<br><span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--cream2)">${numDia}</span>
    </th>`;
  }).join('');

  const bodyRows = prods.map(nom => {
    const cols = dias.map(f => {
      const v = byProd[nom][f] || { pedido: 0, libre: 0 };
      const total = v.pedido + v.libre;
      if (!total) return `<td style="padding:6px 8px;text-align:center;color:var(--cream2);opacity:.3">—</td>`;
      return `<td style="padding:6px 8px;text-align:center">
        <div style="font-family:'DM Mono',monospace;font-size:14px;font-weight:700;color:var(--gold)">${total}</div>
        ${v.pedido ? `<div style="font-size:9px;color:var(--cream2)">P:${v.pedido}</div>` : ''}
        ${v.libre  ? `<div style="font-size:9px;color:var(--blue)">L:${v.libre}</div>`   : ''}
      </td>`;
    }).join('');
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 10px;font-weight:600;font-size:12px">${nom}</td>
      ${cols}
    </tr>`;
  }).join('');

  document.getElementById('prod-semana-table').innerHTML = `
    <div style="font-size:10px;color:var(--cream2);margin-bottom:8px">P = pedidos · L = plan libre · Solo datos en Supabase</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:rgba(200,146,42,.1)">
          <th style="padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase">Pan</th>
          ${headerCols}
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

function prodSemanaCerrar() {
  document.getElementById('prod-semana-card').style.display = 'none';
}
