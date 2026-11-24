// ═══════════════════════════════════════════════════════════════
// reversos.js — "↩️ Reversar venta" (prefijo rvs*)
//
// Busca cualquier venta (pan, galletas, comercial, promocional) y la reversa
// TOTAL o por PRODUCTO, sin borrar nada: se agrega una fila NEGATIVA en
// `ventas` ligada a la original (venta_origen_id) con motivo y detalle.
//   · Total por cliente / mes / método suma las filas negativas solas.
//   · Se puede reversar en varias veces: el saldo = venta − reversos previos.
//   · La regalía nunca fue venta, así que no aparece (solo lo cobrado).
//
// Columnas nuevas en ventas (sql_reversos_envio_promo.sql):
//   es_reverso, venta_origen_id, motivo, detalle (jsonb)
//
// Líneas de la venta, según su origen:
//   · notas 'PRM-<id>'  → pedido_promo_det (cantidad − regalía) + envío
//   · pedido_id         → pedido_lineas (cantidad × precio_applied) + envío
//   · diferencia contra el total de la venta → línea "Otros / ajuste"
// ═══════════════════════════════════════════════════════════════

let _rvs = {
  ventas: [],        // todas las ventas (incluye reversos)
  mes: '',           // 'YYYY-MM' ('' = todos)
  q: '',             // texto: cliente, referencia o monto
  tipo: '',
  abierta: null,     // venta abierta
  lineas: [],        // líneas reversables de la venta abierta
  reversos: [],      // reversos previos de la venta abierta
  saldo: 0,
  estiloOk: false,
  ocupado: false,
  ncFecha: '',       // nota de crédito: fecha de los reversos
  ncCli: '',         // nota de crédito: cliente
  refs: {}           // caché de referencia (factura/pedido) por venta original
};

function _rvsN(v) {
  const x = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  return isNaN(x) ? 0 : x;
}
function _rvsR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function _rvsEstilo() {
  if (_rvs.estiloOk) return;
  _rvs.estiloOk = true;
  const st = document.createElement('style');
  st.textContent =
    '.rvs-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}' +
    '.rvs-bar .sp{flex:1}' +
    '.rvs-t{width:100%;border-collapse:collapse;font-size:13px}' +
    '.rvs-t th{background:var(--bg3);color:var(--gold2);text-align:left;padding:6px 8px;font-size:11px;white-space:nowrap}' +
    '.rvs-t td{padding:6px 7px;border-top:1px solid #E1E8DD;vertical-align:middle}' +
    '.rvs-t td.n,.rvs-t th.n{text-align:right}' +
    '.rvs-t input{width:90px;padding:5px 6px;font-size:13px;text-align:right}' +
    '.rvs-lista tr.fila{cursor:pointer}' +
    '.rvs-lista tr.fila:hover td{background:rgba(46,107,69,.05)}' +
    '.rvs-scroll{overflow-x:auto}' +
    '.rvs-hint{font-size:11px;color:var(--cream2)}' +
    '.rvs-neg{color:#9B3030;font-weight:600}' +
    '.rvs-ok{color:#2E6B45;font-weight:600}' +
    '.rvs-tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;border:1px solid #C8D4C3;background:#fff;color:var(--cream2)}' +
    '.rvs-tag.rev{background:#F6E5E5;color:#9B3030;border-color:#E3BCBC}';
  document.head.appendChild(st);
}

// ── Entrada ────────────────────────────────────────────────────
// filtro opcional: texto a buscar (p. ej. 'PRM-<id>' desde el pedido promocional)
async function rvsInit(filtro) {
  _rvsEstilo();
  const out = document.getElementById('rvs-out');
  if (!out) return;
  if (!filtro && window._rvsPend) { filtro = window._rvsPend; window._rvsPend = null; }
  if (typeof filtro === 'string' && filtro) { _rvs.q = filtro; _rvs.mes = ''; _rvs.tipo = ''; }
  else { _rvs.q = ''; }
  _rvs.abierta = null;
  out.innerHTML = '<div class="rvs-hint">Cargando ventas…</div>';
  if (!pmDB.disponible()) {
    out.innerHTML = '<div class="card"><div class="rvs-neg">Sin conexión a Supabase — las ventas solo viven en la nube.</div></div>';
    return;
  }
  if (!_rvs.mes && !_rvs.q) _rvs.mes = pmHoy().slice(0, 7);
  try {
    _rvs.ventas = (await pmDB.ventas.listar()) || [];
  } catch (e) {
    out.innerHTML = '<div class="card"><div class="rvs-neg">No se pudieron cargar las ventas: ' + pmEsc(e.message) + '</div></div>';
    return;
  }
  rvsRenderLista();
  // Si vino un filtro exacto y hay una sola venta original, se abre directo
  if (typeof filtro === 'string' && filtro) {
    const c = _rvsFiltradas();
    if (c.length === 1) await rvsAbrir(c[0].id);
  }
}

function _rvsReversosDe(id) {
  return _rvs.ventas.filter(v => v.es_reverso && String(v.venta_origen_id) === String(id));
}
function _rvsSaldo(v) {
  const rev = _rvsReversosDe(v.id).reduce((s, r) => s + Math.abs(_rvsN(r.total)), 0);
  return _rvsR2(_rvsN(v.total) - rev);
}

function _rvsFiltradas() {
  const q = _rvs.q.trim().toLowerCase();
  return _rvs.ventas.filter(v => {
    if (v.es_reverso) return false;
    if (_rvs.mes && !String(v.fecha_pago || '').startsWith(_rvs.mes)) return false;
    if (_rvs.tipo && v.tipo !== _rvs.tipo) return false;
    if (q) {
      const txt = ((v.cliente_nom || '') + ' ' + (v.notas || '') + ' ' + (v.total || '')).toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => String(b.fecha_pago || '').localeCompare(String(a.fecha_pago || '')) ||
                    String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function rvsFiltro(campo, valor) { _rvs[campo] = valor; rvsRenderLista(); }

// ── Lista ──────────────────────────────────────────────────────
function rvsRenderLista() {
  const out = document.getElementById('rvs-out');
  if (!out) return;
  _rvs.abierta = null;
  const lista = _rvsFiltradas();
  const filas = lista.map(v => {
    const saldo = _rvsSaldo(v), rev = _rvsR2(_rvsN(v.total) - saldo);
    return '<tr class="fila" onclick="rvsAbrir(\'' + v.id + '\')">' +
      '<td>' + pmEsc(v.fecha_pago || '') + '</td>' +
      '<td>' + pmEsc(v.cliente_nom || '(sin cliente)') + '</td>' +
      '<td><span class="rvs-tag">' + pmEsc(v.tipo || '') + '</span></td>' +
      '<td class="rvs-hint">' + pmEsc(v.notas || '') + '</td>' +
      '<td class="n">' + pmMoney(Math.round(_rvsN(v.total))) + '</td>' +
      '<td class="n ' + (rev > 0 ? 'rvs-neg' : '') + '">' + (rev > 0 ? '−' + pmMoney(Math.round(rev)) : '') + '</td>' +
      '<td class="n"><b>' + pmMoney(Math.round(saldo)) + '</b></td>' +
      '</tr>';
  }).join('');
  const tot = lista.reduce((s, v) => s + _rvsSaldo(v), 0);

  out.innerHTML =
    '<div id="rvs-nc"></div>' +
    '<div class="rvs-bar">' +
      '<input type="month" value="' + pmEsc(_rvs.mes) + '" onchange="rvsFiltro(\'mes\',this.value)" style="max-width:160px">' +
      '<select onchange="rvsFiltro(\'tipo\',this.value)" style="max-width:150px">' +
        ['', 'pan', 'galletas', 'comercial'].map(t => '<option value="' + t + '"' + (t === _rvs.tipo ? ' selected' : '') + '>' + (t || 'Todos los tipos') + '</option>').join('') +
      '</select>' +
      '<input type="text" value="' + pmEsc(_rvs.q) + '" placeholder="Cliente, referencia o monto" oninput="_rvs.q=this.value" onchange="rvsRenderLista()" style="max-width:240px">' +
      '<button class="btn btn-out btn-sm" onclick="rvsRenderLista()">Buscar</button>' +
      '<span class="sp"></span>' +
      '<span class="rvs-hint">' + lista.length + ' ventas · saldo ' + pmMoney(Math.round(tot)) + '</span>' +
    '</div>' +
    '<div class="card"><div class="rvs-scroll"><table class="rvs-t rvs-lista">' +
      '<thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Referencia</th><th class="n">Venta</th><th class="n">Reversado</th><th class="n">Saldo</th></tr></thead>' +
      '<tbody>' + (filas || '<tr><td colspan="7" class="rvs-hint" style="padding:14px">No hay ventas con ese filtro.</td></tr>') + '</tbody>' +
    '</table></div></div>';
  rvsNcRender();
}

// ── Detalle de una venta ───────────────────────────────────────
async function _rvsCargarLineas(v) {
  const notas = String(v.notas || '');
  let lineas = [], envio = 0, envioNota = '';
  try {
    if (notas.startsWith('PRM-')) {
      const pid = notas.slice(4);
      const det = (await pmDB.get('pedido_promo_det', { pedido_id: pid })) || [];
      const cab = ((await pmDB.get('pedido_promo', { id: pid })) || [])[0] || {};
      det.forEach(d => {
        const cant = _rvsR2(_rvsN(d.cantidad) - _rvsN(d.regalia_cant));   // la regalía no es venta
        if (cant > 0) lineas.push({ k: 'D' + d.id, nombre: d.producto_nombre || 'Producto', cant, unit: _rvsN(d.precio_pactado) });
      });
      envio = _rvsN(cab.envio_monto); envioNota = cab.envio_nota || '';
    } else if (v.pedido_id) {
      const [lin, prods, ped] = await Promise.all([
        pmDB.pedidos.lineas.listar(v.pedido_id).catch(() => []),
        pmDB.productos.listar().catch(() => []),
        pmDB.get('pedidos', { id: v.pedido_id }).catch(() => [])
      ]);
      const nom = {}; (prods || []).forEach(p => { nom[p.id] = p.nombre; });
      (lin || []).forEach(l => {
        const cant = _rvsN(l.cantidad);
        if (cant > 0) lineas.push({ k: 'L' + l.id, nombre: l.producto_nombre || nom[l.producto_id] || 'Producto', cant, unit: _rvsN(l.precio_applied) });
      });
      if (ped && ped[0]) { envio = _rvsN(ped[0].envio_monto); envioNota = ped[0].envio_nota || ''; }
    }
  } catch (e) { console.warn('[reversos] líneas', e.message); }

  if (envio > 0) lineas.push({ k: 'envio', nombre: 'Envío' + (envioNota ? ' (' + envioNota + ')' : ''), cant: 1, unit: envio });
  const suma = lineas.reduce((s, l) => s + l.cant * l.unit, 0);
  const dif = _rvsR2(_rvsN(v.total) - suma);
  if (Math.abs(dif) >= 1 || !lineas.length) {
    lineas.push({ k: 'otros', nombre: lineas.length ? 'Otros / ajuste (IVA, diferencias)' : 'Venta completa (sin detalle de productos)', cant: 1, unit: lineas.length ? dif : _rvsN(v.total) });
  }
  return lineas;
}

async function rvsAbrir(id) {
  const v = _rvs.ventas.find(x => String(x.id) === String(id));
  if (!v) return;
  const out = document.getElementById('rvs-out');
  if (out) out.innerHTML = '<div class="rvs-hint">Cargando detalle…</div>';
  _rvs.abierta = v;
  _rvs.reversos = _rvsReversosDe(v.id).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  _rvs.saldo = _rvsSaldo(v);
  _rvs.lineas = await _rvsCargarLineas(v);
  // Lo ya reversado por línea (de los detalles de reversos previos)
  const yaCant = {};
  _rvs.reversos.forEach(r => {
    (Array.isArray(r.detalle) ? r.detalle : []).forEach(d => { yaCant[d.k] = (yaCant[d.k] || 0) + _rvsN(d.cant); });
  });
  _rvs.lineas.forEach(l => {
    l.ya = _rvsR2(yaCant[l.k] || 0);
    l.disp = _rvs.saldo <= 0.5 || yaCant.total ? 0 : Math.max(0, _rvsR2(l.cant - l.ya));
  });
  rvsRenderDetalle();
}

function rvsRenderDetalle() {
  const out = document.getElementById('rvs-out');
  const v = _rvs.abierta;
  if (!out || !v) return;
  const filas = _rvs.lineas.map((l, i) => {
    const imp = l.cant * l.unit;
    return '<tr>' +
      '<td>' + pmEsc(l.nombre) + '</td>' +
      '<td class="n">' + _rvsFmt(l.cant) + '</td>' +
      '<td class="n">' + pmMoney(Math.round(l.unit)) + '</td>' +
      '<td class="n">' + pmMoney(Math.round(imp)) + '</td>' +
      '<td class="n ' + (l.ya > 0 ? 'rvs-neg' : '') + '">' + (l.ya > 0 ? _rvsFmt(l.ya) : '') + '</td>' +
      '<td class="n">' + (l.disp > 0
        ? '<input type="number" min="0" max="' + l.disp + '" step="any" id="rvs-c-' + i + '" placeholder="0" oninput="_rvsCalc()"> <span class="rvs-hint">de ' + _rvsFmt(l.disp) + '</span>'
        : '<span class="rvs-hint">—</span>') + '</td>' +
      '<td class="n" id="rvs-m-' + i + '"></td>' +
      '</tr>';
  }).join('');

  const hist = _rvs.reversos.map(r =>
    '<tr><td>' + pmEsc(r.fecha_pago || '') + '</td><td class="n rvs-neg">' + pmMoney(Math.round(_rvsN(r.total))) + '</td><td>' + pmEsc(r.motivo || '') + '</td></tr>').join('');

  const bloqueado = _rvs.saldo <= 0.5;
  out.innerHTML =
    '<div class="rvs-bar"><button class="btn btn-out btn-sm" onclick="rvsRenderLista()">‹ Ventas</button><span class="sp"></span></div>' +
    '<div class="card"><div class="ctitle">Venta a reversar</div>' +
      '<div class="rvs-bar" style="margin-bottom:0">' +
        '<div><b>' + pmEsc(v.cliente_nom || '(sin cliente)') + '</b><div class="rvs-hint">' + pmEsc(v.fecha_pago || '') + ' · ' + pmEsc(v.tipo || '') + ' · ' + pmEsc(v.metodo_pago || '') + ' · ' + pmEsc(v.notas || '') + '</div></div>' +
        '<span class="sp"></span>' +
        '<div style="text-align:right"><div class="rvs-hint">Venta ' + pmMoney(Math.round(_rvsN(v.total))) + '</div><div style="font-size:18px"><b>Saldo ' + pmMoney(Math.round(_rvs.saldo)) + '</b></div></div>' +
      '</div>' +
    '</div>' +
    '<div class="card"><div class="ctitle">Qué se reversa</div>' +
      '<div class="rvs-scroll"><table class="rvs-t"><thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th><th class="n">Ya reversado</th><th class="n">Reversar</th><th class="n">Monto</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
      '<div class="rvs-hint" style="margin-top:6px">La regalía no se lista: nunca fue venta (es gasto de mercadeo).</div>' +
      '<div class="rvs-bar" style="margin-top:12px"><input type="text" id="rvs-motivo" placeholder="Motivo (obligatorio): ej. devolución, error de captura, pedido ficticio" style="flex:1;min-width:220px"' + (bloqueado ? ' disabled' : '') + '></div>' +
      '<div class="rvs-bar">' +
        '<span id="rvs-tot" style="font-size:15px"><b>Reverso: ₡0</b></span><span class="sp"></span>' +
        '<button class="btn btn-gold" onclick="rvsReversarSeleccion()"' + (bloqueado ? ' disabled' : '') + '>↩️ Reversar lo seleccionado</button>' +
        '<button class="btn btn-out" onclick="rvsReversarTotal()"' + (bloqueado ? ' disabled' : '') + '>↩️ Reversar todo el saldo (' + pmMoney(Math.round(_rvs.saldo)) + ')</button>' +
      '</div>' +
    '</div>' +
    (hist ? '<div class="card"><div class="ctitle">Reversos anteriores</div><table class="rvs-t"><thead><tr><th>Fecha</th><th class="n">Monto</th><th>Motivo</th></tr></thead><tbody>' + hist + '</tbody></table></div>' : '');
}

function _rvsFmt(n) { return Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 }); }

// Calcula la selección actual (cantidades escritas por línea)
function _rvsSeleccion() {
  const sel = [];
  _rvs.lineas.forEach((l, i) => {
    const el = document.getElementById('rvs-c-' + i);
    if (!el) return;
    let c = _rvsN(el.value);
    if (c <= 0) return;
    if (c > l.disp) c = l.disp;
    sel.push({ k: l.k, nombre: l.nombre, cant: _rvsR2(c), monto: _rvsR2(c * l.unit), _i: i });
  });
  return sel;
}

function _rvsCalc() {
  _rvs.lineas.forEach((l, i) => { const m = document.getElementById('rvs-m-' + i); if (m) m.textContent = ''; });
  const sel = _rvsSeleccion();
  sel.forEach(s => { const m = document.getElementById('rvs-m-' + s._i); if (m) m.textContent = pmMoney(Math.round(s.monto)); });
  const tot = sel.reduce((a, s) => a + s.monto, 0);
  const el = document.getElementById('rvs-tot');
  if (el) el.innerHTML = '<b>Reverso: ' + pmMoney(Math.round(tot)) + '</b>' + (tot > _rvs.saldo + 0.5 ? ' <span class="rvs-neg">supera el saldo</span>' : '');
}

function _rvsMotivo() {
  const m = ((document.getElementById('rvs-motivo') || {}).value || '').trim();
  if (m.length < 3) { pmToast('Escribí el motivo del reverso', 'err', 3500); return null; }
  return m;
}

async function rvsReversarSeleccion() {
  const sel = _rvsSeleccion();
  if (!sel.length) { pmToast('Indicá la cantidad a reversar en al menos una línea', 'err', 3500); return; }
  const monto = _rvsR2(sel.reduce((a, s) => a + s.monto, 0));
  if (monto > _rvs.saldo + 0.5) { pmToast('El reverso supera el saldo de la venta', 'err', 4000); return; }
  const motivo = _rvsMotivo(); if (!motivo) return;
  await _rvsGuardar(monto, motivo, sel.map(s => ({ k: s.k, nombre: s.nombre, cant: s.cant, monto: s.monto })));
}

async function rvsReversarTotal() {
  const monto = _rvs.saldo;
  if (!(monto > 0.5)) { pmToast('La venta ya está reversada por completo', 'err', 3500); return; }
  const motivo = _rvsMotivo(); if (!motivo) return;
  await _rvsGuardar(monto, motivo, [{ k: 'total', nombre: 'Reverso total del saldo', cant: 1, monto }]);
}

async function _rvsGuardar(monto, motivo, detalle) {
  const v = _rvs.abierta;
  if (!v || _rvs.ocupado) return;
  if (!confirm('Reversar ' + pmMoney(Math.round(monto)) + ' de la venta a ' + (v.cliente_nom || 'cliente') + '?\n\nSe agrega un movimiento negativo; la venta original no se borra.')) return;
  _rvs.ocupado = true;
  try {
    // FIX (23 nov 2026): el reverso NO lleva pedido_id. La tabla ventas tiene
    // UNIQUE(pedido_id) (una venta por pedido), así que copiar el pedido de la
    // venta original chocaba con ella y Supabase respondía "duplicado". El
    // vínculo con la venta original ya lo da venta_origen_id; además, dejarlo
    // sin pedido evita que los reportes "corrijan" el monto negativo con el
    // total del pedido.
    const creada = await pmDB.ventas.crear({
      fecha_pago: pmHoy(),
      total: -monto,
      metodo_pago: v.metodo_pago || 'sinpe',
      cliente_nom: v.cliente_nom,
      tipo: v.tipo,
      notas: 'REV-' + String(v.id).slice(0, 8) + '-' + Date.now(),
      pedido_id: null,
      es_reverso: true,
      venta_origen_id: String(v.id),
      motivo,
      detalle
    });
    // El trigger fill_venta_cliente vacía cliente_nom cuando no hay pedido_id
    // (se corrige en sql_reversos_pedido_unico.sql). Mientras ese SQL no se
    // haya corrido, se restituye el nombre aquí para que el reverso reste en
    // el total del cliente.
    try {
      const fila = Array.isArray(creada) ? creada[0] : creada;
      if (fila && fila.id && v.cliente_nom && !fila.cliente_nom) {
        await pmDB.ventas.editar(fila.id, { cliente_nom: v.cliente_nom });
      }
    } catch (e2) { console.warn('[reversos] no se pudo restituir cliente_nom', e2.message); }
    pmToast('Reverso de ' + pmMoney(Math.round(monto)) + ' registrado ✓');
    _rvs.ventas = (await pmDB.ventas.listar()) || [];
    await rvsAbrir(v.id);
  } catch (e) {
    const falta = /es_reverso|venta_origen_id|motivo|detalle/i.test(e.message);
    pmToast('No se pudo reversar: ' + e.message + (falta ? ' — corré sql_reversos_envio_promo.sql en Supabase' : ''), 'err', 7000);
  } finally { _rvs.ocupado = false; }
}

// ═══════════════════════════════════════════════════════════════
// 🧾 NOTA DE CRÉDITO — se emite por fecha + cliente
// Reúne los reversos de ese cliente en esa fecha (fecha del reverso),
// muestra la referencia de la venta original (factura / pedido), el detalle
// y el monto, y los imprime con un número NC-0000001 propio y permanente
// (columna ventas.numero_nc, ver sql_nota_credito.sql).
// ═══════════════════════════════════════════════════════════════
function _rvsNcFilas() {
  if (!_rvs.ncFecha) _rvs.ncFecha = pmHoy();
  return _rvs.ventas.filter(v => v.es_reverso && String(v.fecha_pago || '').slice(0, 10) === _rvs.ncFecha);
}
function _rvsFechaLarga(f) {
  const m = String(f || '').slice(0, 10).split('-');
  return m.length === 3 ? m[2] + '/' + m[1] + '/' + m[0] : String(f || '');
}

async function _rvsRefOrigen(r) {
  const o = _rvs.ventas.find(x => String(x.id) === String(r.venta_origen_id));
  if (!o) return { ref: '—', fecha: '' };
  const key = String(o.id);
  if (_rvs.refs[key]) return _rvs.refs[key];
  const partes = [];
  const notas = String(o.notas || '');
  try {
    if (notas.startsWith('PRM-')) {
      const cab = ((await pmDB.get('pedido_promo', { id: notas.slice(4) })) || [])[0];
      partes.push(cab && cab.titulo ? cab.titulo : notas);
    } else if (o.pedido_id) {
      const p = ((await pmDB.get('pedidos', { id: o.pedido_id })) || [])[0];
      if (p) {
        if (p.numero_factura) partes.push(p.numero_factura);
        if (p.numero_pedido) partes.push('Pedido ' + p.numero_pedido);
      }
    }
  } catch (e) { console.warn('[reversos] referencia', e.message); }
  if (!partes.length) partes.push(notas || ('Venta ' + key.slice(0, 8)));
  return (_rvs.refs[key] = { ref: partes.join(' · '), fecha: o.fecha_pago || '' });
}

function _rvsDetalleTxt(r) {
  const det = Array.isArray(r.detalle) ? r.detalle : [];
  if (!det.length) return '';
  return det.map(d => d.k === 'total' ? 'Reverso total de la venta' : (_rvsFmt(d.cant) + ' × ' + d.nombre)).join('; ');
}

function rvsNcFecha(f) { _rvs.ncFecha = f || pmHoy(); _rvs.ncCli = ''; rvsNcRender(); }
function rvsNcCliente(c) { _rvs.ncCli = c; rvsNcRender(); }

async function rvsNcRender() {
  const box = document.getElementById('rvs-nc');
  if (!box) return;
  const del = _rvsNcFilas();
  const clientes = [...new Set(del.map(r => r.cliente_nom || '(sin cliente)'))].sort();
  if (!clientes.includes(_rvs.ncCli)) _rvs.ncCli = clientes[0] || '';
  const filas = del.filter(r => (r.cliente_nom || '(sin cliente)') === _rvs.ncCli);

  let cuerpo;
  if (!clientes.length) {
    cuerpo = '<div class="rvs-hint">No hay reversos registrados en esa fecha.</div>';
  } else {
    const refs = await Promise.all(filas.map(r => _rvsRefOrigen(r)));
    const tot = filas.reduce((s, r) => s + Math.abs(_rvsN(r.total)), 0);
    const nro = (filas.find(r => r.numero_nc) || {}).numero_nc;
    cuerpo =
      '<div class="rvs-bar"><select onchange="rvsNcCliente(this.value)" style="max-width:260px">' +
        clientes.map(c => '<option value="' + pmEsc(c) + '"' + (c === _rvs.ncCli ? ' selected' : '') + '>' + pmEsc(c) + '</option>').join('') +
      '</select>' + (nro ? '<span class="rvs-tag">' + pmEsc(nro) + '</span>' : '<span class="rvs-hint">Sin número aún — se asigna al imprimir</span>') + '</div>' +
      '<div class="rvs-scroll"><table class="rvs-t"><thead><tr><th>Referencia</th><th>Detalle</th><th>Motivo</th><th class="n">Monto</th></tr></thead><tbody>' +
      filas.map((r, i) =>
        '<tr><td>' + pmEsc(refs[i].ref) + (refs[i].fecha ? '<div class="rvs-hint">Venta del ' + pmEsc(_rvsFechaLarga(refs[i].fecha)) + '</div>' : '') + '</td>' +
        '<td>' + pmEsc(_rvsDetalleTxt(r)) + '</td><td>' + pmEsc(r.motivo || '') + '</td>' +
        '<td class="n">' + pmMoney(Math.round(Math.abs(_rvsN(r.total)))) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="rvs-bar" style="margin-top:10px"><span style="font-size:15px"><b>Total a acreditar: ' + pmMoney(Math.round(tot)) + '</b></span><span class="sp"></span>' +
        '<button class="btn btn-gold" onclick="rvsNcImprimir()">🖨️ Imprimir nota de crédito</button></div>';
  }
  box.innerHTML = '<div class="card"><div class="ctitle">🧾 Nota de crédito</div>' +
    '<div class="rvs-bar"><label class="rvs-hint">Fecha del reverso</label><input type="date" value="' + pmEsc(_rvs.ncFecha) + '" onchange="rvsNcFecha(this.value)" style="max-width:160px"></div>' +
    cuerpo + '</div>';
}

async function rvsNcImprimir() {
  if (_rvs.ocupado) return;
  const filas = _rvsNcFilas().filter(r => (r.cliente_nom || '(sin cliente)') === _rvs.ncCli);
  if (!filas.length) { pmToast('No hay reversos para esa fecha y cliente', 'err', 3500); return; }
  if (!('numero_nc' in filas[0])) { pmToast('Falta la columna numero_nc — corré sql_nota_credito.sql en Supabase', 'err', 7000); return; }
  const win = window.open('', '_blank');   // se abre ya, antes de los awaits (bloqueadores de ventanas)
  if (!win) { pmToast('El navegador bloqueó la ventana de impresión', 'err', 5000); return; }
  _rvs.ocupado = true;
  try {
    let num = (filas.find(r => r.numero_nc) || {}).numero_nc;
    if (!num) {
      const n = await _corrSiguiente('nota_credito');
      if (!n) throw new Error('no se pudo obtener el correlativo');
      num = _corrFmt(n, 'NC-');
    }
    for (const r of filas) {
      if (!r.numero_nc) { await pmDB.ventas.editar(r.id, { numero_nc: num }); r.numero_nc = num; }
    }
    const refs = await Promise.all(filas.map(r => _rvsRefOrigen(r)));
    const tot = filas.reduce((s, r) => s + Math.abs(_rvsN(r.total)), 0);
    const mon = n => '₡' + Math.round(n).toLocaleString('es-CR');
    const CSS = `*{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#fff}
      .page{width:100%;max-width:720px;margin:0 auto;padding:32px 36px}
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
      td{padding:9px 10px;border-bottom:1px solid #e8e8e8;vertical-align:top}
      .sub{font-size:11px;color:#888}
      .total-row td{padding-top:12px;font-weight:700;font-size:14px;border-bottom:none;border-top:2px solid #1a1a1a}
      .footer{margin-top:28px;padding-top:14px;border-top:1px solid #ddd;font-size:10px;color:#aaa;text-align:center}`;
    const cuerpo = filas.map((r, i) =>
      '<tr><td>' + pmEsc(refs[i].ref) + (refs[i].fecha ? '<div class="sub">Venta del ' + pmEsc(_rvsFechaLarga(refs[i].fecha)) + '</div>' : '') + '</td>' +
      '<td>' + pmEsc(_rvsDetalleTxt(r)) + '</td><td>' + pmEsc(r.motivo || '') + '</td>' +
      '<td class="r">' + mon(Math.abs(_rvsN(r.total))) + '</td></tr>').join('');
    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Nota de crédito ' + pmEsc(num) + '</title><style>' + CSS + '</style></head><body><div class="page">' +
      '<div class="header"><div><div class="brand">Victor\'s Bakery &amp; Sweets</div><div class="brand-sub">Panadería artesanal</div></div>' +
      '<div><div class="doc-label">Nota de crédito</div><div class="doc-num">#' + pmEsc(num) + '</div></div></div>' +
      '<div class="meta"><div class="meta-item"><label>Cliente</label><div class="val">' + pmEsc(_rvs.ncCli) + '</div></div>' +
      '<div class="meta-item"><label>Fecha</label><div class="val">' + pmEsc(_rvsFechaLarga(_rvs.ncFecha)) + '</div></div></div>' +
      '<table><thead><tr><th>Referencia</th><th>Detalle</th><th>Motivo</th><th class="r">Monto</th></tr></thead><tbody>' + cuerpo +
      '<tr class="total-row"><td colspan="3">Total acreditado</td><td class="r">' + mon(tot) + '</td></tr></tbody></table>' +
      '<div class="footer">Victor\'s Bakery &amp; Sweets · Nota de crédito #' + pmEsc(num) + '</div></div>' +
      '<script>window.onload=function(){window.print();}<\/script></body></html>');
    win.document.close();
    rvsNcRender();
  } catch (e) {
    try { win.close(); } catch (e2) {}
    pmToast('No se pudo emitir la nota de crédito: ' + e.message, 'err', 6000);
  } finally { _rvs.ocupado = false; }
}
