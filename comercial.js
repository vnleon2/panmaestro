// ── 🏪 COMERCIAL ──────────────────────────────────────────
// Punto 7 del plan de auditoría (julio 2026): antes este módulo era
// "Supabase-primario" — sin copia local, cada pantalla pedía todo a
// Supabase en el momento y pcAdd() rechazaba crear un pedido sin
// conexión. Reescrito para seguir el mismo patrón local-first +
// dual-write que ya usan pan.js y galletas.js: el pedido se crea al
// instante en G.pedidosCom (persistido en localStorage) y se sincroniza
// a Supabase en segundo plano. Efecto colateral bueno: dashboard.js y
// reportes.js ya leían G.pedidosCom esperando encontrar los pedidos
// comerciales ahí — nunca los encontraban porque este archivo nunca
// escribía ese array. Ahora sí, así que sus cifras de ventas comerciales
// empiezan a cuadrar sin tocarles nada.

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

// ── Crear pedido comercial (local-first) ──
function pcAdd() {
  const fecha  = document.getElementById('pc-fecha').value || pmHoy();
  const sel    = document.getElementById('pc-cli-sel');
  const cliId  = sel.value;
  const cliNom = sel.options[sel.selectedIndex]?.dataset?.nom || '';
  if (!cliId) { pmToast('Seleccioná un cliente', 'err'); return; }
  const newPed = {
    id: pmId(), date: fecha, cliId, cliNom,
    status: G.estados[0]||'Pedido', metodoPago: 'efectivo',
    numPed: null,      // se llena al sincronizar — mientras tanto se ve "pendiente"
    lineas: [], _sbId: null
  };
  G.pedidosCom.push(newPed);
  pmSave('comercial'); pcRender();
  sel.value = '';
  pmToast('Pedido iniciado ✓');
  if (pmDB.disponible()) {
    newPed._sbCreatePromise = _pcCrearEnSupabase(newPed);
  }
}

// Crea el pedido en Supabase (con su correlativo) en segundo plano.
// Separado de pcAdd() para poder reintentarlo también desde pcCargarSb()
// con pedidos que quedaron pendientes de una sesión offline anterior.
async function _pcCrearEnSupabase(ped) {
  try {
    const numPed    = await _corrSiguiente('pedido_comercial');
    const numPedFmt = _corrFmt(numPed, 'PED-');
    const rows = await pmDB.pedidos.crear({
      fecha: ped.date, cliente_nom: ped.cliNom, cliente_id: ped.cliId,
      tipo: 'comercial', status: ped.status, total: 0, numero_pedido: numPedFmt
    });
    if (rows?.[0]) {
      ped._sbId  = rows[0].id;
      ped.numPed = numPedFmt;
      pmSave('comercial'); pcRender();
    }
    return rows;
  } catch(e) {
    console.warn('[pmDB] pcAdd crear:', e.message);
    throw e;
  }
}

// ── Cargar pedidos comerciales desde Supabase (fuente de verdad cuando
// hay conexión) y fusionar con lo que haya local — mismo patrón que
// ppCargarSb() en pan.js. Antes de traer de Supabase, reintenta crear
// cualquier pedido que haya quedado pendiente (creado offline, todavía
// sin _sbId) — así el número de pedido "pendiente" se resuelve solo en
// cuanto vuelve la señal, sin que Victor tenga que hacer nada. ──
let _sbPedComLineasPendientes = [];

async function pcCargarSb() {
  const fecha = document.getElementById('pc-fecha').value || pmHoy();
  if (pmDB.disponible()) {
    try {
      if (_sbPedComLineasPendientes.length) {
        await Promise.allSettled(_sbPedComLineasPendientes);
        _sbPedComLineasPendientes = [];
      }
      // Reintentar pedidos que quedaron sin crear en Supabase (offline)
      const pendientes = G.pedidosCom.filter(p => p.date === fecha && !p._sbId && !p._sbCreatePromise);
      for (const p of pendientes) p._sbCreatePromise = _pcCrearEnSupabase(p).catch(()=>{});
      if (pendientes.length) await Promise.allSettled(pendientes.map(p => p._sbCreatePromise));

      await _sbProdEnsureMap();
      const rows = await pmDB.get('pedidos', { tipo: 'comercial', fecha }, '*');
      if (rows) {
        const sbPeds = [];
        for (const sb of rows) {
          let lineasSb = [];
          try { lineasSb = await pmDB.get('pedido_lineas', { pedido_id: sb.id }, '*'); } catch(e) {}
          const local = G.pedidosCom.find(p => p._sbId === sb.id);
          const lineas = (lineasSb||[]).map(l => {
            const localLin = local?.lineas?.find(x => x._sbId === l.id);
            return {
              lid: localLin?.lid || pmId(),
              sbId: l.producto_id,
              pid: _sbProdMapInv?.[l.producto_id] || '',
              cant: l.cantidad||1,
              precio: l.precio_applied||0,
              desc: l.descuento_pct||0,
              _sbId: l.id
            };
          });
          sbPeds.push({
            id: local?.id || pmId(),
            date: sb.fecha, cliId: sb.cliente_id, cliNom: sb.cliente_nom,
            status: sb.status, metodoPago: local?.metodoPago || 'efectivo',
            numPed: sb.numero_pedido, lineas, _sbId: sb.id
          });
        }
        // Mantener pedidos de otras fechas + los que sigan sin _sbId
        // (offline, todavía no se pudieron crear en Supabase)
        const otrosFechas = G.pedidosCom.filter(p => p.date !== fecha);
        const offline      = G.pedidosCom.filter(p => p.date === fecha && !p._sbId);
        G.pedidosCom = [...otrosFechas, ...sbPeds, ...offline];
        pmSave('comercial');
      }
    } catch(e) { console.warn('[pcCargarSb]', e.message); }
  }
  pcRender();
}

// Método de pago elegido por pedido — se guarda con el pedido local
// (antes vivía solo en memoria y se perdía al recargar, ver _pcMetodoPagoSel viejo)
function pcSetMetodoPago(id, v) {
  const p = G.pedidosCom.find(x => String(x.id) === String(id));
  if (p) { p.metodoPago = v; pmSave('comercial'); }
}

// ── Render lista de pedidos comerciales (puro, sin red — igual patrón
// que ppRender()) ──
function pcRender() {
  const fecha = document.getElementById('pc-fecha').value || pmHoy();
  const el = document.getElementById('pc-list');
  if (!el) return;
  const peds = G.pedidosCom.filter(p => p.date === fecha);
  if (!peds.length) {
    el.innerHTML = '<div class="ph"><span class="ph-icon">🏪</span>Sin pedidos comerciales para este día</div>';
    return;
  }
  const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
  const getProd = (pid) => prods.find(p => p.id === pid) || { nombre: pid || '(producto)', precio: 0 };

  el.innerHTML = [...peds].sort((a,b) => (b.numPed||'').localeCompare(a.numPed||'')).map(p => {
    const lineas = p.lineas || [];
    const tot    = pmTotalCom(p);
    const lineasHtml = lineas.map(l => {
      const prod = getProd(l.pid);
      const subt = (l.precio||0) * (l.cant||1);
      return `<div class="linea">
        <div class="linea-info">
          <div class="linea-prod">${pmEsc(prod.nombre)}</div>
          ${l.desc ? `<div class="linea-inst">−${l.desc}% desc.</div>` : ''}
        </div>
        <div class="linea-cant">${l.cant}</div>
        <div class="linea-tot">${pmMoney(subt)}</div>
        <button class="btn btn-red btn-xs" onclick="pcDelLinea('${p.id}','${l.lid}')">✕</button>
      </div>`;
    }).join('');
    const estOpts = G.estados.map(e => `<option value="${e}"${p.status===e?' selected':''}>${e}</option>`).join('');
    const numBadge = p.numPed
      ? `<span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--cream2);margin-left:8px">${pmEsc(p.numPed)}</span>`
      : `<span style="font-size:10px;color:var(--amber);margin-left:8px" title="Todavía sin conexión — el número aparece al sincronizar">⏳ pendiente</span>`;
    return `<div class="ped-card">
      <div class="ped-head" onclick="toggleBody('sb-${p.id}')">
        <div class="ped-cli">${pmEsc(p.cliNom)}
          ${numBadge}
          ${lineas.length ? `<span style="font-size:10px;color:var(--cream2);margin-left:6px">(${lineas.length} producto${lineas.length!==1?'s':''})</span>` : ''}
        </div>
        <div class="ped-meta">${pmFmtDateShort(p.date)}</div>
        ${pmBadge(p.status)}
        <div class="ped-total">${pmMoney(tot)}</div>
      </div>
      <div class="ped-body${lineas.length ? ' open' : ''}" id="pb-sb-${p.id}">
        ${lineasHtml}
        <div class="row" style="margin-top:10px;gap:6px">
          <select title="Método de pago" onchange="pcSetMetodoPago('${p.id}',this.value)" style="font-size:12px;flex:0 0 auto">${pmMetodoPagoOpts(p.metodoPago)}</select>
          <select onchange="pcChgSt('${p.id}',this.value)" style="flex:1;font-size:12px">${estOpts}</select>
          <button class="btn btn-out btn-sm" onclick="pcOpenLinea('${p.id}')">+ Producto</button>
          <button class="btn btn-red btn-sm" onclick="pcDel('${p.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Cambiar estado pedido (local-first) ──
async function pcChgSt(pedId, st) {
  const p = G.pedidosCom.find(x => String(x.id) === String(pedId));
  if (!p) return;
  const prevSt = p.status;
  p.status = st; pmSave('comercial'); pcRender();
  setTimeout(()=>{ const b=document.getElementById('pb-sb-'+pedId); if(b) b.classList.add('open'); },20);
  if (!pmDB.disponible()) return;

  const escritura = (async () => {
    if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
    if (p._sbId) await pmDB.pedidos.cambiarStatus(p._sbId, st).catch(e => console.warn('[pmDB] pcChgSt:', e.message));

    // Crear venta al marcar Pagado / En recepción pagado
    if ((st === 'Pagado' || st === 'En recepción pagado') && prevSt !== st) {
      const refId = 'COM-' + pedId;
      const exist = await pmDB.get('ventas', { notas: refId }).catch(()=>[]);
      if (!exist || !exist.length) {
        try {
          await pmDB.ventas.crear({
            pedido_id:   p._sbId || null,
            fecha_pago:  pmHoy(),
            total:       pmTotalCom(p),
            metodo_pago: p.metodoPago || 'efectivo',
            cliente_nom: p.cliNom,
            tipo:        'comercial',
            notas:       refId
          });
          pmToast('Venta registrada ✓', 'ok');
        } catch(e) {
          console.warn('[pmDB] pcVenta crear:', e.message);
          pmToast('⚠️ No se pudo registrar la venta: ' + e.message, 'err');
        }
      }
    }
    // Anular venta al desmarcar Pagado
    if ((prevSt === 'Pagado' || prevSt === 'En recepción pagado') && st !== prevSt) {
      const refId = 'COM-' + pedId;
      const exist = await pmDB.get('ventas', { notas: refId }).catch(()=>[]);
      if (exist && exist.length) {
        await pmDB.hardDelete('ventas', exist[0].id).catch(e => console.warn('[pmDB] pcVenta anular:', e.message));
        pmToast('Venta anulada', 'ok');
      }
    }
  })().catch(e => console.warn('[pmDB] pcChgSt error:', e.message));
  _sbPedComLineasPendientes.push(escritura);
  escritura.finally(() => { _sbPedComLineasPendientes = _sbPedComLineasPendientes.filter(x => x !== escritura); });
}

// ── Abrir modal producto — precios especiales desde la caché local
// (funciona offline, ver _precioClienteLocal en plan_libre.js) ──
async function pcOpenLinea(pedId) {
  const p = G.pedidosCom.find(x => String(x.id) === String(pedId));
  if (!p) return;
  document.getElementById('lc-id').value     = pedId;
  document.getElementById('lc-cli-id').value = p.cliId || '';
  document.getElementById('lc-cliente-nom').textContent = p.cliNom || '';
  document.getElementById('lc-cant').value   = 1;
  document.getElementById('lc-precio').value = '';
  document.getElementById('lc-desc').value   = 0;
  document.getElementById('lc-precio-info').textContent = '';
  const sel = document.getElementById('lc-prod');
  mOpen('m-lc');

  // Asegurar que tengamos mapa de productos y precios especiales — si hay
  // conexión SIEMPRE se refresca al abrir (no se confía en si la caché ya
  // se disparó antes en segundo plano, para no toparse con un selector
  // abierto justo antes de que esa carga terminara). Si no hay conexión,
  // usa lo que ya esté cacheado localmente.
  if (pmDB.disponible()) {
    await _sbProdEnsureMap().catch(()=>{});
    await _sbPreciosClienteCargar().catch(()=>{});
  }

  const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
  let opciones = prods.map(prod => {
    const sbId  = _sbProdMap?.[prod.id] || '';
    const espec = p.cliId ? _precioClienteLocal(p.cliId, sbId) : null;
    const precioBase = espec && espec.precio_especial != null ? espec.precio_especial : prod.precio;
    const descPct     = espec?.descuento_pct || 0;
    const precioEf    = Math.round(precioBase * (1 - descPct/100));
    return { id: prod.id, sbId, nombre: prod.nombre, precioFull: prod.precio, descPct, precioEfectivo: precioEf };
  });

  sel.innerHTML = '<option value="">— seleccionar producto —</option>' +
    opciones.map(o =>
      `<option value="${o.id}" data-sbid="${o.sbId}" data-precio="${o.precioEfectivo}" data-precio-full="${o.precioFull}" data-desc="${o.descPct}">
        ${pmEsc(o.nombre)} · ₡${o.precioEfectivo}${o.descPct ? ' (−'+o.descPct+'%)' : ''}
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

// ── Autorreparación de pedidos huérfanos ─────────────────────────────────
// Si Supabase rechaza una escritura porque el pedido_id ya no existe
// (23503 = violación de llave foránea) — por ejemplo, alguien borró la
// fila directo desde el panel de Supabase — el pedido local queda
// "colgado" apuntando a una fila muerta. En vez de fallar cada vez, se
// detecta este caso puntual y se recrea el pedido en Supabase (con un
// _sbId y numPed nuevos) antes de reintentar.
function _pcEsErrorPedidoInexistente(e) {
  const m = ((e && e.message) || '').toLowerCase();
  return m.includes('23503') && m.includes('pedidos');
}
async function _pcRecrearSiHuerfano(p, e) {
  if (!_pcEsErrorPedidoInexistente(e)) return false;
  console.warn('[pmDB] pedido huérfano (ya no existe en Supabase) — recreando:', p.id);
  p._sbId = null; p.numPed = null;
  p._sbCreatePromise = _pcCrearEnSupabase(p);
  await p._sbCreatePromise.catch(()=>{});
  return !!p._sbId;
}

// ── Guardar línea de pedido (local-first) ──
function lcSave() {
  const pedId = document.getElementById('lc-id').value;
  const p = G.pedidosCom.find(x => String(x.id) === String(pedId));
  if (!p) return;
  const sel    = document.getElementById('lc-prod');
  const pid    = sel.value;
  const sbId   = sel.options[sel.selectedIndex]?.dataset?.sbid || '';
  const cant   = parseInt(document.getElementById('lc-cant').value) || 1;
  const precio = parseFloat(document.getElementById('lc-precio').value) || 0;
  const desc   = parseFloat(document.getElementById('lc-desc').value) || 0;
  if (!pid)    { pmToast('Seleccioná un producto', 'err'); return; }
  if (!precio) { pmToast('Ingresá el precio', 'err'); return; }

  const lid = pmId();
  p.lineas.push({ lid, pid, sbId, cant, precio, desc, _sbId: null });
  pmSave('comercial');
  mClose('m-lc'); pcRender();
  setTimeout(()=>{ const b=document.getElementById('pb-sb-'+pedId); if(b) b.classList.add('open'); },20);
  pmToast('Producto agregado ✓');

  if (!pmDB.disponible()) return;
  const linea = p.lineas.find(x => x.lid === lid);
  const escritura = (async () => {
    if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
    if (!p._sbId) return; // el pedido nunca llegó a crearse en Supabase, nada que hacer aún
    let prodSbId = sbId || _sbProdMap?.[pid];
    if (!prodSbId) { await _sbProdEnsureMap(true).catch(()=>{}); prodSbId = _sbProdMap?.[pid]; }
    if (!prodSbId) throw new Error('producto no sincronizado con Supabase todavía');
    let rows;
    try {
      rows = await pmDB.pedidos.lineas.agregar({
        pedido_id: p._sbId, producto_id: prodSbId,
        cantidad: cant, precio_applied: precio, descuento_pct: desc
      });
    } catch(e) {
      if (await _pcRecrearSiHuerfano(p, e)) {
        rows = await pmDB.pedidos.lineas.agregar({
          pedido_id: p._sbId, producto_id: prodSbId,
          cantidad: cant, precio_applied: precio, descuento_pct: desc
        });
      } else {
        throw e;
      }
    }
    if (rows?.[0]) linea._sbId = rows[0].id;
    const totalActual = pmTotalCom(p);
    await pmDB.update('pedidos', p._sbId, { total: totalActual });
    pmSave('comercial');
  })().catch(e => {
    console.warn('[pmDB] lcSave error:', e.message);
    pmToast('⚠️ Producto guardado solo local — no se sincronizó: ' + e.message, 'err');
  });
  _sbPedComLineasPendientes.push(escritura);
  escritura.finally(() => { _sbPedComLineasPendientes = _sbPedComLineasPendientes.filter(x => x !== escritura); });
}

// ── Eliminar línea de pedido (local-first) ──
function pcDelLinea(pedId, lid) {
  const p = G.pedidosCom.find(x => String(x.id) === String(pedId));
  if (!p) return;
  const l = p.lineas.find(x => String(x.lid) === String(lid));
  p.lineas = p.lineas.filter(x => String(x.lid) !== String(lid));
  pmSave('comercial'); pcRender();
  setTimeout(()=>{ const b=document.getElementById('pb-sb-'+pedId); if(b) b.classList.add('open'); },20);

  if (!pmDB.disponible() || !l) return;
  const escritura = (async () => {
    if (!l._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
    if (!l._sbId) return; // nunca llegó a existir en Supabase
    await pmDB.hardDelete('pedido_lineas', l._sbId);
    if (p._sbId) await pmDB.update('pedidos', p._sbId, { total: pmTotalCom(p) });
  })().catch(e => {
    console.warn('[pmDB] pcDelLinea error:', e.message);
    pmToast('⚠️ Línea borrada solo local — no se borró en Supabase: ' + e.message, 'err');
  });
  _sbPedComLineasPendientes.push(escritura);
  escritura.finally(() => { _sbPedComLineasPendientes = _sbPedComLineasPendientes.filter(x => x !== escritura); });
}

// ── Eliminar pedido completo (local-first) ──
function pcDel(pedId) {
  if (!confirm('¿Eliminar este pedido?')) return;
  const p = G.pedidosCom.find(x => String(x.id) === String(pedId));
  G.pedidosCom = G.pedidosCom.filter(x => x.id !== pedId);
  pmSave('comercial'); pcRender();
  pmToast('Pedido eliminado');

  if (!pmDB.disponible() || !p) return;
  (async () => {
    if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
    if (!p._sbId) return; // nunca llegó a existir en Supabase
    for (const l of (p.lineas||[])) {
      if (l._sbId) await pmDB.hardDelete('pedido_lineas', l._sbId).catch(()=>{});
    }
    await pmDB.hardDelete('pedidos', p._sbId).catch(e => console.warn('[pmDB] pcDel error:', e.message));
  })();
}
