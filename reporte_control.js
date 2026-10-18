// ═══════════════════════════════════════════════════════════════
// reporte_control.js — Reporte "🧮 Control de ventas" (prefijo rc*)
//
// Reporte de control, solo lectura (no escribe en Supabase). Una fila por
// venta registrada en el rango de fechas, con su pedido, cliente, valor de
// la venta y los 3 costos de lo vendido (material, mano de obra, gastos).
// La última columna dice cuánto hay que guardar en el banco:
//     costo de materiales + 50% del costo de gastos
// (el 50% es editable en pantalla por si algún día cambia la regla).
//
// De dónde sale cada número:
//   · Venta: tabla `ventas` (misma fuente que el Reporte Contable; la venta
//     se ubica en la fecha en que se pagó — fecha_pago — y, si no la
//     tiene, en la fecha en que se registró).
//   · Pedido y cliente: tabla `pedidos`, por ventas.pedido_id.
//   · Productos del pedido: `pedido_lineas` (producto × cantidad).
//   · Costos por producto: MISMO cálculo que el reporte "💲 Precio de
//     venta" (_pvSupuestos + _pvCalcular de precio_venta.js): material
//     desde la receta con su merma; mano de obra y gastos como % del
//     material (el de la receta, o el de referencia si la receta no trae).
//     Cuando el módulo nuevo de costos (costos_*.js) se conecte a las
//     recetas, solo hay que cambiar _rcCostoProducto() — el resto del
//     reporte no se toca.
//
// OJO: los costos se calculan con la receta/precios de HOY, no quedan
// "congelados" al momento de la venta. Para un mes ya cerrado, el costo
// puede diferir si desde entonces cambió un precio de ingrediente.
// ═══════════════════════════════════════════════════════════════

let _rcEstado = null;   // { desde, hasta, mes, pct } — se conserva al cambiar de pestaña

function _rcUltimoDiaMes(mes) {          // 'YYYY-MM' → 'YYYY-MM-DD'
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m, 0).getDate();
  return mes + '-' + String(d).padStart(2, '0');
}

function _rcDiaSiguiente(iso) {          // 'YYYY-MM-DD' → día siguiente (sin pasar por UTC)
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d + 1);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

function _rcFechaVenta(v) {              // fecha local de la venta, 'YYYY-MM-DD'
  if (v.fecha_pago) return String(v.fecha_pago).slice(0, 10);
  if (v.created_at) return new Date(v.created_at).toLocaleDateString('sv-SE'); // hora local, no UTC
  return '';
}

function _rcFmtFecha(iso) {              // 'YYYY-MM-DD' → 'dd/mm/aaaa'
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d + '/' + m + '/' + y;
}

function _rcLotes(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Trae filas de una tabla por lista de ids, en lotes (para no pasarse del
// largo de la URL ni del tope de filas de Supabase).
async function _rcTraerPorIds(tabla, columna, ids) {
  const out = [];
  for (const lote of _rcLotes([...new Set(ids)], 40)) {
    const rows = await pmDB.get(tabla, {}, `*&${columna}=in.(${lote.join(',')})`);
    if (rows) out.push(...rows);
  }
  return out;
}

// ── Costo unitario de un producto: { mat, mo, gg } por pieza ────
// ÚNICO punto que conoce de dónde salen los costos. Devuelve null si el
// producto no tiene receta ligada o la receta no se puede costear.
function _rcCostoProducto(prod) {
  if (!prod || !prod.receta_cod) return null;
  const r = (_sbRecLista() || []).find(x => x.code === prod.receta_cod);
  if (!r) return null;
  const item = {
    key: 'RC:' + prod.id,
    tipo: prod.tipo === 'galleta' ? 'galleta' : (prod.tipo === 'pan' ? 'pan' : 'otro'),
    nombre: prod.nombre,
    peso: prod.peso_g || null,
    precio: prod.precio_full || null,
    recCode: prod.receta_cod
  };
  const s = _pvSupuestos(r, item);
  const d = _pvCalcular(r, item, s);
  return d ? { mat: d.matR, mo: d.modR, gg: d.ggR } : null;
}

// ── Cálculo: rango de fechas → filas ────────────────────────────
async function _rcCalcular(desde, hasta) {
  if (pmDB.disponible() && !_sbRecCache) { await _sbCosteoCargar(); }

  // 1) Ventas del rango (por fecha de pago; las que no tienen, por fecha de registro)
  const sig = _rcDiaSiguiente(hasta);
  const conFecha = await pmDB.get('ventas', {}, `*&fecha_pago=gte.${desde}&fecha_pago=lt.${sig}`) || [];
  const sinFecha = await pmDB.get('ventas', {}, `*&fecha_pago=is.null`) || [];
  const ventas = [...conFecha, ...sinFecha].filter(v => {
    const f = _rcFechaVenta(v);
    return f >= desde && f <= hasta;
  });

  // 2) Pedidos, líneas y productos
  const pedIds = ventas.map(v => v.pedido_id).filter(Boolean);
  const pedidos = pedIds.length ? await _rcTraerPorIds('pedidos', 'id', pedIds) : [];
  const lineas  = pedIds.length ? await _rcTraerPorIds('pedido_lineas', 'pedido_id', pedIds) : [];
  const prods   = await pmDB.get('productos_terminados', {}) || [];

  const pedPorId   = Object.fromEntries(pedidos.map(p => [p.id, p]));
  const prodPorId  = Object.fromEntries(prods.map(p => [p.id, p]));
  const lineasPed  = {};
  lineas.forEach(l => { (lineasPed[l.pedido_id] = lineasPed[l.pedido_id] || []).push(l); });

  const cache = {};
  const costoDe = (uuid) => {
    if (!(uuid in cache)) cache[uuid] = _rcCostoProducto(prodPorId[uuid]);
    return cache[uuid];
  };

  // 3) Una fila por venta
  const filas = ventas.map(v => {
    const ped = v.pedido_id ? pedPorId[v.pedido_id] : null;
    let mat = 0, mo = 0, gg = 0, sinCosto = [];
    (lineasPed[v.pedido_id] || []).forEach(l => {
      const cant = parseFloat(l.cantidad) || 0;
      const c = costoDe(l.producto_id);
      if (!c) { sinCosto.push(prodPorId[l.producto_id]?.nombre || 'producto desconocido'); return; }
      mat += c.mat * cant; mo += c.mo * cant; gg += c.gg * cant;
    });
    return {
      fecha:    _rcFechaVenta(v),
      pedido:   (ped && ped.numero_pedido) || v.notas || '—',
      cliente:  (ped && ped.cliente_nom) || v.cliente_nom || '—',
      tipo:     v.tipo === 'comercial' ? 'Comercial' : v.tipo === 'pan' ? 'Pan' : v.tipo === 'galleta' ? 'Galleta' : (v.tipo || '—'),
      venta:    parseFloat(v.total) || 0,
      sinPedido: !ped,
      sinLineas: !(lineasPed[v.pedido_id] || []).length,
      mat, mo, gg, sinCosto
    };
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.pedido).localeCompare(String(b.pedido)));

  return filas;
}

// ── Pintar resultado ────────────────────────────────────────────
function _rcTablaHTML(filas, desde, hasta, pct) {
  const banco = f => f.mat + f.gg * pct / 100;
  const tot = filas.reduce((a, f) => ({
    venta: a.venta + f.venta, mat: a.mat + f.mat, mo: a.mo + f.mo, gg: a.gg + f.gg, banco: a.banco + banco(f)
  }), { venta: 0, mat: 0, mo: 0, gg: 0, banco: 0 });

  const th = (t, right) => `<th style="padding:8px 10px;text-align:${right ? 'right' : 'left'};font-size:10px;text-transform:uppercase;letter-spacing:.6px">${t}</th>`;
  const mono = 'font-family:\'DM Mono\',monospace';

  const rows = filas.map(f => {
    const avisos = [];
    if (f.sinPedido)  avisos.push('venta sin pedido de origen — costos en 0');
    else if (f.sinLineas) avisos.push('el pedido no tiene productos — costos en 0');
    if (f.sinCosto.length) avisos.push('sin costo (falta receta ligada): ' + [...new Set(f.sinCosto)].join(', '));
    const aviso = avisos.length
      ? ` <span title="${pmEsc(avisos.join(' · '))}" style="color:var(--amber);cursor:help">⚠️</span>` : '';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-size:11px;color:var(--cream2);white-space:nowrap">${_rcFmtFecha(f.fecha)}</td>
      <td style="padding:8px 10px;font-size:11px;${mono}">${pmEsc(f.pedido)}</td>
      <td style="padding:8px 10px;font-weight:600">${pmEsc(f.cliente)}${aviso}</td>
      <td style="padding:8px 10px;font-size:11px">${pmEsc(f.tipo)}</td>
      <td style="padding:8px 10px;text-align:right;${mono};font-weight:700">${pmMoney(Math.round(f.venta))}</td>
      <td style="padding:8px 10px;text-align:right;${mono}">${pmMoney(Math.round(f.mat))}</td>
      <td style="padding:8px 10px;text-align:right;${mono}">${pmMoney(Math.round(f.mo))}</td>
      <td style="padding:8px 10px;text-align:right;${mono}">${pmMoney(Math.round(f.gg))}</td>
      <td style="padding:8px 10px;text-align:right;${mono};font-weight:700;color:var(--gold)">${pmMoney(Math.round(banco(f)))}</td>
    </tr>`;
  }).join('');

  const nAvisos = filas.filter(f => f.sinPedido || f.sinLineas || f.sinCosto.length).length;
  const alerta = nAvisos ? `
    <div style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--amber)">
      ⚠️ ${nAvisos} venta(s) con costos incompletos (marcadas con ⚠️ — pasa el mouse para ver el motivo). Sus totales de costo pueden estar subestimados.
    </div>` : '';

  const periodo = desde === hasta ? _rcFmtFecha(desde) : `${_rcFmtFecha(desde)} al ${_rcFmtFecha(hasta)}`;

  return `<div class="card" id="rc-inner">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:var(--cream)">🧮 Control de ventas</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${periodo} · ${filas.length} venta(s) · guardar en banco = materiales + ${pct}% de gastos</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${repStatBox('Ventas', pmMoney(Math.round(tot.venta)))}
        ${repStatBox('Guardar en banco', pmMoney(Math.round(tot.banco)), 'var(--green)')}
        <button class="btn btn-gold btn-sm no-print" onclick="repPrintSection('rc-inner')">🖨 Imprimir</button>
      </div>
    </div>
    ${alerta}
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid var(--border);background:rgba(200,146,42,.06)">
          ${th('Fecha registro')}${th('Pedido N°')}${th('Cliente')}${th('Tipo')}${th('Venta total', 1)}${th('Costo material', 1)}${th('Mano de obra', 1)}${th('Gastos', 1)}${th('Guardar en banco', 1)}
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border);background:rgba(200,146,42,.08)">
          <td colspan="4" style="padding:10px;font-weight:700">TOTAL</td>
          <td style="padding:10px;text-align:right;${mono};font-weight:900;color:var(--gold)">${pmMoney(Math.round(tot.venta))}</td>
          <td style="padding:10px;text-align:right;${mono};font-weight:900;color:var(--gold)">${pmMoney(Math.round(tot.mat))}</td>
          <td style="padding:10px;text-align:right;${mono};font-weight:900;color:var(--gold)">${pmMoney(Math.round(tot.mo))}</td>
          <td style="padding:10px;text-align:right;${mono};font-weight:900;color:var(--gold)">${pmMoney(Math.round(tot.gg))}</td>
          <td style="padding:10px;text-align:right;${mono};font-weight:900;color:var(--green)">${pmMoney(Math.round(tot.banco))}</td>
        </tr></tfoot>
      </table>
    </div>
    <div style="font-size:10px;color:var(--cream2);margin-top:10px">Los costos se calculan con las recetas y precios actuales, no con los de la fecha de la venta.</div>
  </div>`;
}

// ── Pantalla: filtros + resultado ───────────────────────────────
async function rcReporteHTML() {
  if (!_rcEstado) {
    const mesEl = document.getElementById('r-mes');
    const mes = (mesEl && mesEl.value) || pmHoy().slice(0, 7);
    _rcEstado = { mes, desde: mes + '-01', hasta: _rcUltimoDiaMes(mes), pct: 50 };
  }
  const e = _rcEstado;
  setTimeout(rcActualizar, 0);
  return `
  <div class="card no-print" style="margin-bottom:12px">
    <div class="row" style="align-items:flex-end;gap:10px">
      <div class="col sm"><label>Desde</label><input type="date" id="rc-desde" value="${e.desde}" onchange="rcCambioFechas()"></div>
      <div class="col sm"><label>Hasta</label><input type="date" id="rc-hasta" value="${e.hasta}" onchange="rcCambioFechas()"></div>
      <div class="col sm"><label>o un mes completo</label><input type="month" id="rc-mes" value="${e.mes || ''}" onchange="rcCambioMes()"></div>
      <div class="col xs"><label>% gastos a banco</label><input type="number" id="rc-pct" value="${e.pct}" min="0" max="100" step="1" onchange="rcActualizar()"></div>
      <div class="col xs"><label>&nbsp;</label><button class="btn btn-gold" onclick="rcActualizar()">Ver</button></div>
    </div>
  </div>
  <div id="rc-res"><div class="ph"><span class="ph-icon">⏳</span>Calculando…</div></div>`;
}

function rcCambioMes() {
  const mes = document.getElementById('rc-mes').value;
  if (!mes) return;
  document.getElementById('rc-desde').value = mes + '-01';
  document.getElementById('rc-hasta').value = _rcUltimoDiaMes(mes);
  rcActualizar();
}

function rcCambioFechas() {
  document.getElementById('rc-mes').value = '';   // el rango manual manda sobre el mes
  rcActualizar();
}

let _rcSeq = 0;
async function rcActualizar() {
  const out = document.getElementById('rc-res');
  if (!out) return;
  const desde = document.getElementById('rc-desde').value;
  const hasta = document.getElementById('rc-hasta').value;
  let pct = parseFloat(document.getElementById('rc-pct').value);
  if (isNaN(pct) || pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  _rcEstado = { desde, hasta, mes: document.getElementById('rc-mes').value, pct };

  if (!desde || !hasta) { out.innerHTML = '<div class="ph"><span class="ph-icon">📅</span>Elige las fechas</div>'; return; }
  if (desde > hasta)    { out.innerHTML = '<div class="ph"><span class="ph-icon">⚠️</span>La fecha "Desde" no puede ser mayor que "Hasta"</div>'; return; }
  if (!pmDB.disponible()) { out.innerHTML = '<div class="ph"><span class="ph-icon">⚠️</span>Sin conexión a Supabase</div>'; return; }

  const mi = ++_rcSeq;   // si el usuario cambia filtros mientras carga, gana la última consulta
  out.innerHTML = '<div class="ph"><span class="ph-icon">⏳</span>Calculando…</div>';
  try {
    const filas = await _rcCalcular(desde, hasta);
    if (mi !== _rcSeq) return;
    if (!filas.length) {
      out.innerHTML = '<div class="card"><div class="ph"><span class="ph-icon">📊</span>Sin ventas registradas en ese período</div></div>';
      return;
    }
    out.innerHTML = _rcTablaHTML(filas, desde, hasta, pct);
  } catch (e) {
    if (mi !== _rcSeq) return;
    out.innerHTML = `<div class="ph"><span class="ph-icon">⚠️</span>Error al calcular el reporte: ${pmEsc(e.message)}</div>`;
    console.error('[reporte_control]', e);
  }
}
