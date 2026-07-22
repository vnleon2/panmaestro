// ── 🏪 COMERCIAL ──────────────────────────────────────────
// ── Correlativos únicos y permanentes (tabla: correlativos) ──
async function _corrSiguiente(tipo) {
  if (!pmDB.disponible()) return null;
  try {
    const rows = await pmDB.get('correlativos', { tipo });
    if (rows && rows.length) {
      const siguiente = (rows[0].ultimo || 0) + 1;
      await pmDB.update('correlativos', rows[0].id, { ultimo: siguiente });
      return siguiente;
    } else {
      await pmDB.insert('correlativos', { tipo, ultimo: 1 }, false);
      return 1;
    }
  } catch(e) {
    console.warn('[correlativo] error:', e.message);
    return null;
  }
}
function _corrFmt(num, prefijo) {
  if (!num) return null;
  return prefijo + String(num).padStart(7, '0');
}

// ── PEDIDOS COMERCIALES — Fuente primaria: Supabase ──────────────────────────
let _sbPedComCache = null;

async function _sbPedComCargar() {
  if (!pmDB.disponible()) return [];
  try {
    const rows = await pmDB.get('pedidos', { tipo: 'comercial' }, '*');
    // Para cada pedido cargar sus líneas
    const pedidos = rows || [];
    for (const p of pedidos) {
      try {
        const lineas = await pmDB.get('pedido_lineas', { pedido_id: p.id }, '*');
        p._lineasSb = lineas || [];
      } catch(e) {
        p._lineasSb = [];
      }
    }
    _sbPedComCache = pedidos;
    return pedidos;
  } catch(e) {
    console.warn('[pmDB] pedComCargar:', e.message);
    return [];
  }
}

// ── Cargar clientes en el selector ──
async function pcCargarClientes() {
  const sel = document.getElementById('pc-cli-sel');
  if (!sel) return;
  const clientes = _sbCliCache || await _sbCliCargar();
  sel.innerHTML = '<option value="">— seleccionar cliente —</option>' +
    clientes
      .sort((a,b) => (a.codigo||'').localeCompare(b.codigo||''))
      .map(c => `<option value="${c.id}" data-nom="${pmEsc(c.nombre)}">${c.codigo ? pmEsc(c.codigo)+' · ' : ''}${pmEsc(c.nombre)}</option>`)
      .join('');
}

// ── Crear pedido comercial ──
async function pcAdd() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  const fecha  = document.getElementById('pc-fecha').value || pmHoy();
  const sel    = document.getElementById('pc-cli-sel');
  const cliId  = sel.value;
  const cliNom = sel.options[sel.selectedIndex]?.dataset?.nom || '';
  if (!cliId) { pmToast('Seleccioná un cliente', 'err'); return; }
  const numPed    = await _corrSiguiente('pedido_comercial');
  const numPedFmt = _corrFmt(numPed, 'PED-');
  try {
    const rows = await pmDB.pedidos.crear({
      fecha, cliente_nom: cliNom, cliente_id: cliId,
      tipo: 'comercial', status: G.estados[0]||'Pedido',
      total: 0, numero_pedido: numPedFmt
    });
    _sbPedComCache = null;
    await pcRender();
    sel.value = '';
    pmToast(`Pedido ${numPedFmt||''} creado ✓`);
  } catch(e) {
    pmToast('Error al crear pedido: ' + e.message, 'err');
    console.error('[pmDB] pcAdd:', e);
  }
}

// ── Render lista de pedidos comerciales ──
async function pcRender() {
  const el = document.getElementById('pc-list');
  if (!el) return;
  el.innerHTML = '<div class="ph" style="padding:14px"><span class="ph-icon" style="font-size:20px">⏳</span>Cargando pedidos...</div>';
  const pedidos = await _sbPedComCargar();
  if (!pedidos.length) {
    el.innerHTML = '<div class="ph"><span class="ph-icon">🏪</span>Sin pedidos comerciales</div>';
    return;
  }
  // Resolver nombres de productos para las líneas
  await _sbProdEnsureMap();
  const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
  const getProd = (prodUuid) => {
    const cod = _sbProdMapInv?.[prodUuid] || '';
    return prods.find(p => p.id === cod) || { nombre: prodUuid, precio: 0 };
  };

  el.innerHTML = [...pedidos].sort((a,b) => (b.numero_pedido||'').localeCompare(a.numero_pedido||'')).map(p => {
    const lineas  = p._lineasSb || [];
    const tot     = lineas.reduce((s,l) => s + (l.precio_applied||0) * (l.cantidad||1), 0);
    const lineasHtml = lineas.map(l => {
      const prod = getProd(l.producto_id);
      const subt = (l.precio_applied||0) * (l.cantidad||1);
      return `<div class="linea">
        <div class="linea-info">
          <div class="linea-prod">${prod.nombre}</div>
          ${l.descuento_pct ? `<div class="linea-inst">−${l.descuento_pct}% desc.</div>` : ''}
        </div>
        <div class="linea-cant">${l.cantidad}</div>
        <div class="linea-tot">${pmMoney(subt)}</div>
        <button class="btn btn-red btn-xs" onclick="pcDelLinea('${p.id}','${l.id}')">✕</button>
      </div>`;
    }).join('');
    const estOpts = G.estados.map(e => `<option value="${e}"${p.status===e?' selected':''}>${e}</option>`).join('');
    return `<div class="ped-card">
      <div class="ped-head" onclick="toggleBody('sb-${p.id}')">
        <div class="ped-cli">${pmEsc(p.cliente_nom)}
          ${p.numero_pedido ? `<span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--cream2);margin-left:8px">${pmEsc(p.numero_pedido)}</span>` : ''}
          ${lineas.length ? `<span style="font-size:10px;color:var(--cream2);margin-left:6px">(${lineas.length} producto${lineas.length!==1?'s':''})</span>` : ''}
        </div>
        <div class="ped-meta">${pmFmtDateShort(p.fecha||p.date)}</div>
        ${pmBadge(p.status)}
        <div class="ped-total">${pmMoney(tot)}</div>
      </div>
      <div class="ped-body${lineas.length ? ' open' : ''}" id="pb-sb-${p.id}">
        ${lineasHtml}
        <div class="row" style="margin-top:10px;gap:6px">
          <select title="Método de pago" onchange="pcSetMetodoPago('${p.id}',this.value)" style="font-size:12px;flex:0 0 auto">${pmMetodoPagoOpts(_pcMetodoPagoSel[p.id])}</select>
          <select onchange="pcChgSt('${p.id}',this.value,'${pmEsc((p.cliente_nom||'').replace(/'/g,"\\'"))}')" style="flex:1;font-size:12px">${estOpts}</select>
          <button class="btn btn-out btn-sm" onclick="pcOpenLinea('${p.id}','${p.cliente_id||''}','${pmEsc((p.cliente_nom||'').replace(/'/g,"\\'"))}')">+ Producto</button>
          <button class="btn btn-red btn-sm" onclick="pcDel('${p.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// FIX D3: Comercial trabaja directo contra Supabase (no hay copia local
// persistente del pedido), así que el método de pago elegido se guarda
// en memoria por id de pedido hasta el momento de crear la venta.
let _pcMetodoPagoSel = {};
function pcSetMetodoPago(id, v) {
  _pcMetodoPagoSel[id] = v;
}

// ── Cambiar estado pedido ──
let _pcChgStRunning = false;
async function pcChgSt(sbId, st, cliNom) {
  if (_pcChgStRunning) return;
  _pcChgStRunning = true;
  try {
    await pmDB.update('pedidos', sbId, { status: st, updated_at: new Date().toISOString() });
    if (st === 'Pagado' || st === 'En recepción pagado') {
      const lineas = await pmDB.get('pedido_lineas', { pedido_id: sbId });
      const total  = (lineas||[]).reduce((s,l) => s + (l.precio_applied||0)*(l.cantidad||1), 0);
      // Obtener nombre del cliente — primero del cache, luego de Supabase
      const pedCache = (_sbPedComCache||[]).find(p => p.id === sbId);
      let nombreCliente = pedCache?.cliente_nom || '';
      if (!nombreCliente) {
        const ped = await pmDB.pedidos.obtener(sbId);
        nombreCliente = ped?.cliente_nom || cliNom || '';
      }
      // Verificar si ya existe venta para este pedido
      let ventaExist = [];
      try { ventaExist = await pmDB.get('ventas', { pedido_id: sbId }) || []; } catch(e) { ventaExist = []; }
      console.log('[venta] ventaExist:', ventaExist, 'length:', ventaExist.length);
      if (!ventaExist.length) {
        const res = await pmDB.ventas.crear({
          pedido_id:   sbId,
          fecha_pago:  pmHoy(), // FIX SESIÓN 1 (E1): usaba new Date().toISOString() directo (bug UTC), instancia no listada en el informe pero mismo root cause
          total,
          metodo_pago: _pcMetodoPagoSel[sbId] || 'efectivo',
          cliente_nom: nombreCliente,
          tipo:        'comercial'
        });
        console.log('[venta] creada:', nombreCliente, res);
        pmToast('Venta registrada ✓', 'ok');
      } else {
        console.log('[venta] ya existe para este pedido');
      }
    }
    _sbPedComCache = null;
    await pcRender();
  } catch(e) {
    console.error('[pcChgSt] error:', e);
    pmToast('Error al actualizar estado', 'err');
  } finally {
    _pcChgStRunning = false;
  }
}

// ── Abrir modal producto — filtra por portafolio ──
async function pcOpenLinea(sbId, cliId, cliNom) {
  document.getElementById('lc-id').value     = sbId;
  document.getElementById('lc-cli-id').value = cliId;
  document.getElementById('lc-cliente-nom').textContent = cliNom;
  document.getElementById('lc-cant').value   = 1;
  document.getElementById('lc-precio').value = '';
  document.getElementById('lc-desc').value   = 0;
  document.getElementById('lc-precio-info').textContent = '';
  const sel = document.getElementById('lc-prod');
  sel.innerHTML = '<option value="">⏳ Cargando...</option>';
  mOpen('m-lc');
  let opciones = [];
  if (cliId && pmDB.disponible()) {
    try {
      await _sbProdEnsureMap();
      const precios = await pmDB.get('precios_cliente', { cliente_id: cliId, activo: true });
      const prods   = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
      if (precios && precios.length) {
        opciones = precios.map(r => {
          const cod  = _sbProdMapInv?.[r.producto_id] || '';
          const prod = prods.find(x => x.id === cod);
          if (!prod) return null;
          const precioBase = (r.precio_especial != null) ? r.precio_especial : prod.precio;
          const precioEf   = Math.round(precioBase * (1 - (r.descuento_pct||0) / 100));
          return { id: prod.id, sbId: r.producto_id, nombre: prod.nombre,
            precioFull: prod.precio, descPct: r.descuento_pct||0, precioEfectivo: precioEf };
        }).filter(Boolean);
      }
    } catch(e) { console.warn('[pcOpenLinea]', e.message); }
  }
  if (!opciones.length) {
    const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
    opciones = prods.map(p => ({
      id: p.id, sbId: _sbProdMap?.[p.id]||'', nombre: p.nombre,
      precioFull: p.precio, descPct: 0, precioEfectivo: p.precio
    }));
  }
  sel.innerHTML = '<option value="">— seleccionar producto —</option>' +
    opciones.map(o =>
      `<option value="${o.sbId}" data-precio="${o.precioEfectivo}" data-precio-full="${o.precioFull}" data-desc="${o.descPct}">
        ${o.nombre} · ₡${o.precioEfectivo}${o.descPct ? ' (−'+o.descPct+'%)' : ''}
      </option>`).join('');
  sel.onchange = () => {
    const opt = sel.options[sel.selectedIndex];
    if (!opt.value) { document.getElementById('lc-precio-info').textContent=''; return; }
    const ef   = parseFloat(opt.dataset.precio)||0;
    const full = parseFloat(opt.dataset.precioFull)||0;
    const desc = parseFloat(opt.dataset.desc)||0;
    document.getElementById('lc-precio').value = ef;
    document.getElementById('lc-desc').value   = desc;
    document.getElementById('lc-precio-info').textContent =
      full !== ef ? `Precio normal ₡${full} → precio cliente ₡${ef}${desc?' (−'+desc+'%)':''}` : `Precio normal ₡${full}`;
  };
}

// ── Guardar línea de pedido ──
async function lcSave() {
  const pedSbId   = document.getElementById('lc-id').value;
  const prodSbId  = document.getElementById('lc-prod').value;
  const cant      = parseInt(document.getElementById('lc-cant').value) || 1;
  const precio    = parseFloat(document.getElementById('lc-precio').value) || 0;
  const desc      = parseFloat(document.getElementById('lc-desc').value) || 0;
  if (!prodSbId) { pmToast('Seleccioná un producto', 'err'); return; }
  if (!precio)   { pmToast('Ingresá el precio', 'err'); return; }
  try {
    await pmDB.pedidos.lineas.agregar({
      pedido_id: pedSbId, producto_id: prodSbId,
      cantidad: cant, precio_applied: precio, descuento_pct: desc
    });
    // Actualizar total en pedido
    const lineas = await pmDB.get('pedido_lineas', { pedido_id: pedSbId });
    const tot = (lineas||[]).reduce((s,l) => s + (l.precio_applied||0)*(l.cantidad||1), 0);
    await pmDB.update('pedidos', pedSbId, { total: tot });
    _sbPedComCache = null;
    mClose('m-lc');
    await pcRender();
    // Reabrir el body del pedido
    const body = document.getElementById('pb-sb-' + pedSbId);
    if (body) body.classList.add('open');
    pmToast('Producto agregado ✓');
  } catch(e) {
    pmToast('Error al agregar producto: ' + e.message, 'err');
    console.error('[pmDB] lcSave:', e);
  }
}

// ── Eliminar línea de pedido ──
async function pcDelLinea(pedId, lineaId) {
  try {
    await pmDB.hardDelete('pedido_lineas', lineaId);
    const lineas = await pmDB.get('pedido_lineas', { pedido_id: pedId });
    const tot = (lineas||[]).reduce((s,l) => s + (l.precio_applied||0)*(l.cantidad||1), 0);
    await pmDB.update('pedidos', pedId, { total: tot });
    _sbPedComCache = null;
    await pcRender();
  } catch(e) {
    pmToast('Error al eliminar línea', 'err');
  }
}

// ── Eliminar pedido completo ──
async function pcDel(sbId) {
  if (!confirm('¿Eliminar este pedido?')) return;
  try {
    // Eliminar líneas primero
    const lineas = await pmDB.get('pedido_lineas', { pedido_id: sbId });
    for (const l of (lineas||[])) await pmDB.hardDelete('pedido_lineas', l.id);
    await pmDB.hardDelete('pedidos', sbId);
    _sbPedComCache = null;
    await pcRender();
    pmToast('Pedido eliminado');
  } catch(e) {
    pmToast('Error al eliminar pedido', 'err');
  }
}

