// ═══════════════════════════════════════════════════════════════
// cartera.js — "💼 Cartera de clientes" (prefijo car*)
// Sub-pestaña del módulo Mercadeo y ventas.
//
// Convierte una cotización ya emitida en la CARTERA de un cliente comercial:
// qué productos se le venden y a qué precio. La cartera vive en la tabla
// que ya existía, public.precios_cliente (la misma que lee el pedido
// comercial en comercial.js), así que no hay una segunda fuente de precios.
//
// Por cada línea de la cotización se guarda:
//   precio_especial  = precio NETO cotizado (lo que se le vende)
//   descuento_pct    = 0  (comercial.js aplica descuento_pct ENCIMA de
//                          precio_especial; el descuento ya va dentro del neto)
//   precio_full      = precio "al público" cotizado a ese cliente (puede ser
//                      distinto al del maestro de panes)
//   fecha_desde/hasta= fecha de la cotización / su vencimiento (la cartera
//                      hereda la validez de la cotización)
//   cotizacion_id    = cotización de origen
//
// Flujo: elegir una cotización → vista previa línea por línea (maestro vs full
// cotizado vs neto, y qué cambia en la cartera) → marcar/desmarcar → cargar.
// Una carga nueva reemplaza línea por línea; lo que la cotización no trae
// queda como estaba. El precio del maestro de panes NUNCA se toca.
//
// Depende de cotizador.js (_cotN, _cotFmt, _cotFecha, _cotVence, _cotEstilo).
// Tablas: precios_cliente (+ columnas de sql_cartera_cotizacion.sql), cotizacion,
// cotizacion_det.
// ═══════════════════════════════════════════════════════════════

const CAR_ESCALA = 'comercial';

let _car = {
  clientes: [],
  productos: [],
  cots: [],          // cotizaciones (cabeceras)
  cotId: '',         // cotización elegida
  cliId: '',         // cliente al que se carga (el de la cotización, o el elegido)
  lineas: [],        // cotizacion_det de la cotización elegida
  existentes: [],    // precios_cliente del cliente (activos o no)
  plan: [],          // vista previa (ver _carPlan)
  verCliId: '',      // cliente cuya cartera se está viendo abajo
  cartera: [],       // precios_cliente activos del cliente visto
  estiloOk: false,
  cargando: false
};

function _carEstilo() {
  if (_car.estiloOk) return;
  _car.estiloOk = true;
  const st = document.createElement('style');
  st.textContent =
    '.car-t td.dif{color:#9B3030;font-weight:600}' +
    '.car-t tr.off td{opacity:.55}' +
    '.car-est{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;border:1px solid #C8D4C3;background:#fff;color:var(--cream2);white-space:nowrap}' +
    '.car-est.nuevo{background:#E8F1EA;color:#2E6B45;border-color:#BBD5C2}' +
    '.car-est.cambia{background:#FFF8E6;color:#8A5A00;border-color:#E8D6A4}' +
    '.car-est.sinprod{background:#F6E5E5;color:#9B3030;border-color:#E3BCBC}' +
    '.car-sub{font-size:12px;font-weight:700;margin:2px 0 8px}';
  document.head.appendChild(st);
}

// ── Lógica pura (se prueba sin pantalla) ───────────────────────

// Vista previa: por cada línea de la cotización, qué pasaría en la cartera.
// estado: 'nuevo' (no estaba o estaba inactiva) | 'cambia' | 'igual' | 'sinprod'
function _carPlan(lineas, existentes, cot) {
  const hasta = _cotVence(cot);
  return (lineas || []).map(l => {
    const neto = _cotN(l.precio_neto);
    const full = _cotN(l.pvp);
    const maestro = _cotN(l.pvp_base);
    let ex = null;
    if (l.producto_id) {
      ex = (existentes || [])
        .filter(r => r.producto_id === l.producto_id && (r.escala || CAR_ESCALA) === CAR_ESCALA)
        .sort((a, b) => (b.activo !== false) - (a.activo !== false))[0] || null;
    }
    const activo = !!ex && ex.activo !== false;
    let estado = 'nuevo';
    if (!l.producto_id) estado = 'sinprod';
    else if (activo) {
      const igual = _cotN(ex.precio_especial) === neto && _cotN(ex.precio_full) === full &&
        String(ex.fecha_hasta || '').slice(0, 10) === hasta;
      estado = igual ? 'igual' : 'cambia';
    }
    return { linea: l, ex, activo, neto, full, maestro, estado, sel: estado === 'nuevo' || estado === 'cambia' };
  });
}

// Fila de precios_cliente que se escribe para una línea
function _carFila(p, cot, clienteId) {
  const l = p.linea;
  return {
    cliente_id: clienteId,
    producto_id: l.producto_id,
    escala: CAR_ESCALA,
    precio_especial: p.neto,
    descuento_pct: 0,
    precio_full: p.full,
    descuento_cotizado_pct: _cotN(l.descuento_pct),
    fecha_desde: cot.fecha,
    fecha_hasta: _cotVence(cot),
    cotizacion_id: cot.id,
    activo: true
  };
}

function _carCot() { return _car.cots.find(c => c.id === _car.cotId) || null; }
function _carCli(id) { return _car.clientes.find(c => c.id === id) || null; }

// ── Carga ──────────────────────────────────────────────────────
async function carInit() {
  _cotEstilo();
  _carEstilo();
  const out = document.getElementById('car-out');
  if (!out) return;
  out.innerHTML = '<div class="cot-hint">Cargando…</div>';
  try {
    _car.clientes = ((typeof _sbCliCache !== 'undefined' && _sbCliCache) || await _sbCliCargar()) || [];
    _car.productos = (await pmDB.productos.listar()) || [];
    const rows = (await pmDB.get('cotizacion')) || [];
    _car.cots = rows.filter(c => c.estado !== 'anulada')
      .sort((a, b) => String(b.numero || '').localeCompare(String(a.numero || '')));
  } catch (e) {
    out.innerHTML = '<div class="card"><div class="cot-warn">No se pudo cargar: ' + pmEsc(e.message) + '</div></div>';
    return;
  }
  carRender();
}

// Entrada desde el botón de una cotización emitida (cotizador.js)
async function carDesdeCotizacion(cotId) {
  await carInit();
  await carElegirCot(cotId);
}

async function carElegirCot(id) {
  _car.cotId = id || '';
  _car.lineas = []; _car.plan = []; _car.existentes = [];
  const c = _carCot();
  if (!c) { _car.cliId = ''; carRender(); return; }
  _car.cliId = c.cliente_id || '';
  try {
    _car.lineas = ((await pmDB.get('cotizacion_det', { cotizacion_id: id })) || [])
      .slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  } catch (e) { pmToast('No se pudieron leer las líneas: ' + e.message, 'err', 4500); }
  await _carRecalcular();
  if (_car.cliId) await carVerCliente(_car.cliId, true);
  carRender();
}

async function carSetCliente(id) {
  _car.cliId = id || '';
  await _carRecalcular();
  if (_car.cliId) await carVerCliente(_car.cliId, true);
  carRender();
}

async function _carRecalcular() {
  const c = _carCot();
  _car.existentes = [];
  if (_car.cliId) {
    try { _car.existentes = (await pmDB.get('precios_cliente', { cliente_id: _car.cliId })) || []; }
    catch (e) { pmToast('No se pudo leer la cartera actual: ' + e.message, 'err', 4500); }
  }
  _car.plan = c ? _carPlan(_car.lineas, _car.existentes, c) : [];
}

function carToggle(i) { _car.plan[i].sel = !_car.plan[i].sel; carRender(); }
function carToggleTodas(v) { _car.plan.forEach(p => { if (p.estado !== 'sinprod') p.sel = !!v; }); carRender(); }

async function carCargar() {
  if (_car.cargando) return;
  const c = _carCot();
  if (!c) return;
  if (!_car.cliId) { pmToast('Elegí el cliente al que va la cartera', 'err'); return; }
  const sel = _car.plan.filter(p => p.sel && p.estado !== 'sinprod');
  if (!sel.length) { pmToast('No hay líneas marcadas para cargar', 'err'); return; }
  const cli = _carCli(_car.cliId);
  const hasta = _cotVence(c);
  if (hasta && pmHoy() > hasta &&
      !confirm('La cotización ' + c.numero + ' venció el ' + _cotFecha(hasta) + '. La cartera nacería vencida y el pedido comercial no la usaría. ¿Cargarla igual?')) return;
  if (!confirm('Cargar ' + sel.length + ' producto(s) de ' + c.numero + ' a la cartera de ' + (cli ? cli.nombre : 'el cliente') +
      '?\nVigencia: ' + _cotFecha(c.fecha) + ' al ' + _cotFecha(hasta) + '.')) return;

  _car.cargando = true;
  try {
    const nuevas = [], cambios = [];
    sel.forEach(p => {
      const fila = _carFila(p, c, _car.cliId);
      if (p.ex) cambios.push({ id: p.ex.id, fila }); else nuevas.push(fila);
    });
    if (nuevas.length) await pmDB.insert('precios_cliente', nuevas, false);
    for (const x of cambios) await pmDB.update('precios_cliente', x.id, x.fila);
    if (typeof _sbPreciosClienteCargar === 'function') { try { await _sbPreciosClienteCargar(); } catch (e) { /* caché: se refresca sola al abrir un pedido */ } }
    pmToast('Cartera cargada ✓ (' + nuevas.length + ' nuevos, ' + cambios.length + ' actualizados)');
  } catch (e) {
    const falta = /precio_full|descuento_cotizado|cotizacion_id/.test(e.message);
    pmToast('No se pudo cargar la cartera: ' + e.message + (falta ? ' — corré sql_cartera_cotizacion.sql' : ''), 'err', 7000);
    _car.cargando = false;
    return;
  }
  _car.cargando = false;
  await _carRecalcular();
  await carVerCliente(_car.cliId, true);
  carRender();
}

// ── Cartera del cliente (vista inferior) ───────────────────────
async function carVerCliente(id, silencioso) {
  _car.verCliId = id || '';
  _car.cartera = [];
  if (_car.verCliId) {
    try {
      _car.cartera = ((await pmDB.get('precios_cliente', { cliente_id: _car.verCliId, activo: true })) || [])
        .filter(r => (r.escala || CAR_ESCALA) === CAR_ESCALA);
    } catch (e) { pmToast('No se pudo leer la cartera: ' + e.message, 'err', 4500); }
  }
  if (!silencioso) carRender();
}

async function carQuitar(precioId) {
  if (!confirm('¿Quitar este producto de la cartera del cliente?')) return;
  try {
    await pmDB.softDelete('precios_cliente', precioId);
    if (typeof _sbPreciosClienteCargar === 'function') { try { await _sbPreciosClienteCargar(); } catch (e) { /* idem */ } }
    pmToast('Producto quitado de la cartera');
  } catch (e) { pmToast('No se pudo quitar: ' + e.message, 'err', 4500); return; }
  await _carRecalcular();
  await carVerCliente(_car.verCliId, true);
  carRender();
}

// ── Pantalla ───────────────────────────────────────────────────
function _carEstadoTxt(p) {
  if (p.estado === 'nuevo') return '<span class="car-est nuevo">Nuevo</span>';
  if (p.estado === 'sinprod') return '<span class="car-est sinprod" title="La línea se escribió a mano, sin producto del maestro">Sin producto del maestro</span>';
  if (p.estado === 'igual') return '<span class="car-est">Sin cambios</span>';
  const antes = _cotN(p.ex.precio_especial);
  return '<span class="car-est cambia">' + (antes !== p.neto ? 'Cambia ₡' + _cotFmt(antes) + ' → ₡' + _cotFmt(p.neto) : 'Actualiza vigencia / full') + '</span>';
}

function carRender() {
  const out = document.getElementById('car-out');
  if (!out) return;
  const c = _carCot();

  const cotOpts = '<option value="">— elegir cotización —</option>' + _car.cots.map(x =>
    '<option value="' + x.id + '"' + (x.id === _car.cotId ? ' selected' : '') + '>' +
    pmEsc(x.numero || '') + ' · ' + pmEsc(x.cliente_nombre) + ' · ' + _cotFecha(x.fecha) + '</option>').join('');

  let paso1 = '';
  if (c) {
    const hasta = _cotVence(c);
    const vencida = hasta && pmHoy() > hasta;
    const cliOpts = '<option value="">— elegir cliente del maestro —</option>' +
      pmOrdenar(_car.clientes, 'nombre').map(x =>
        '<option value="' + x.id + '"' + (x.id === _car.cliId ? ' selected' : '') + '>' + pmEsc(x.nombre) + (x.codigo ? ' · ' + pmEsc(x.codigo) : '') + '</option>').join('');
    const nSel = _car.plan.filter(p => p.sel && p.estado !== 'sinprod').length;

    const filas = _car.plan.map((p, i) => {
      const l = p.linea;
      const difM = p.maestro > 0 && p.full !== p.maestro;
      return '<tr class="' + (p.sel ? '' : 'off') + '">' +
        '<td style="width:28px"><input type="checkbox"' + (p.sel ? ' checked' : '') + (p.estado === 'sinprod' ? ' disabled' : '') + ' onchange="carToggle(' + i + ')"></td>' +
        '<td>' + pmEsc(l.producto_codigo || '') + '</td>' +
        '<td>' + pmEsc(l.producto_nombre) + '</td>' +
        '<td class="n">' + (p.maestro > 0 ? _cotFmt(p.maestro) : '—') + '</td>' +
        '<td class="n' + (difM ? ' dif' : '') + '" title="' + (difM ? 'Distinto al precio del maestro al cotizar' : '') + '">' + _cotFmt(p.full) + '</td>' +
        '<td class="n">' + _cotFmt(_cotN(l.descuento_pct), 1) + '%</td>' +
        '<td class="n">' + (_cotN(l.descuento_monto) ? _cotFmt(_cotN(l.descuento_monto)) : '') + '</td>' +
        '<td class="n"><b>' + _cotFmt(p.neto) + '</b></td>' +
        '<td class="n">' + (p.activo ? _cotFmt(_cotN(p.ex.precio_especial)) : '—') + '</td>' +
        '<td>' + _carEstadoTxt(p) + '</td></tr>';
    }).join('');

    paso1 =
      '<div class="cot-grid" style="margin-top:10px">' +
        '<div style="grid-column:span 2"><label>Cliente de la cartera' + (c.cliente_id ? '' : ' — “' + pmEsc(c.cliente_nombre) + '” no está en el maestro, elegí uno') + '</label>' +
          '<select onchange="carSetCliente(this.value)">' + cliOpts + '</select></div>' +
        '<div><label>Vigencia (hereda la de la cotización)</label>' +
          '<div style="padding:6px 0;font-size:13px">' + _cotFecha(c.fecha) + ' → <b>' + _cotFecha(hasta) + '</b> ' +
          '<span class="cot-badge ' + (vencida ? 'vencida' : 'vigente') + '">' + (vencida ? 'Vencida' : 'Vigente') + '</span></div></div>' +
      '</div>' +
      '<div class="cot-scroll"><table class="cot-t car-t">' +
        '<thead><tr><th></th><th>Código</th><th>Producto</th><th class="n">Maestro (al cotizar)</th><th class="n">Precio full cotizado</th>' +
        '<th class="n">Desc. %</th><th class="n">Desc. adic. ₡</th><th class="n">Precio neto (se carga)</th><th class="n">Hoy en cartera</th><th>Qué pasa</th></tr></thead>' +
        '<tbody>' + filas + '</tbody></table></div>' +
      '<div class="cot-bar" style="margin-top:10px">' +
        '<button class="btn btn-out btn-sm" onclick="carToggleTodas(true)">Marcar todas</button>' +
        '<button class="btn btn-out btn-sm" onclick="carToggleTodas(false)">Desmarcar todas</button>' +
        '<span class="sp"></span>' +
        '<button class="btn btn-gold"' + (nSel && _car.cliId ? '' : ' disabled') + ' onclick="carCargar()">💼 Cargar ' + nSel + ' a la cartera</button>' +
      '</div>' +
      '<div class="cot-hint">El precio neto pasa a ser el precio de venta del cliente en los pedidos comerciales. El precio full se guarda solo como referencia (no toca el maestro de panes). ' +
        'Lo que la cotización no trae queda como estaba en la cartera.</div>';
  }

  // Cartera del cliente
  const verOpts = '<option value="">— elegir cliente —</option>' +
    pmOrdenar(_car.clientes.filter(x => x.tipo === 'comercial' || x.id === _car.verCliId || x.id === _car.cliId), 'nombre').map(x =>
      '<option value="' + x.id + '"' + (x.id === _car.verCliId ? ' selected' : '') + '>' + pmEsc(x.nombre) + (x.codigo ? ' · ' + pmEsc(x.codigo) : '') + '</option>').join('');
  const hoy = pmHoy();
  const prodDe = id => _car.productos.find(p => p.id === id);
  const filasC = pmOrdenar(_car.cartera.map(r => {
    const p = prodDe(r.producto_id);
    return Object.assign({}, r, { nombre: p ? p.nombre : r.producto_id, codigo: p ? (p.codigo || '') : '' });
  }), 'nombre').map(r => {
    const hasta = r.fecha_hasta ? String(r.fecha_hasta).slice(0, 10) : '';
    const venc = hasta && hoy > hasta;
    const cot = _car.cots.find(x => x.id === r.cotizacion_id);
    return '<tr>' +
      '<td>' + pmEsc(r.codigo) + '</td><td>' + pmEsc(r.nombre) + '</td>' +
      '<td class="n">' + (r.precio_full != null ? _cotFmt(_cotN(r.precio_full)) : '—') + '</td>' +
      '<td class="n"><b>' + (r.precio_especial != null ? _cotFmt(_cotN(r.precio_especial)) : '—') + '</b>' +
        (_cotN(r.descuento_pct) ? ' <span class="cot-hint">(−' + _cotN(r.descuento_pct) + '% extra)</span>' : '') + '</td>' +
      '<td>' + (hasta ? _cotFecha(hasta) + ' <span class="cot-badge ' + (venc ? 'vencida' : 'vigente') + '">' + (venc ? 'Vencida' : 'Vigente') + '</span>' : '<span class="cot-hint">sin vencimiento</span>') + '</td>' +
      '<td>' + (cot ? pmEsc(cot.numero) : '<span class="cot-hint">manual</span>') + '</td>' +
      '<td style="width:30px"><button class="btn btn-red btn-xs" onclick="carQuitar(\'' + r.id + '\')">✕</button></td></tr>';
  }).join('');

  const nVenc = _car.cartera.filter(r => r.fecha_hasta && hoy > String(r.fecha_hasta).slice(0, 10)).length;
  const paso2 =
    '<div class="cot-grid"><div style="grid-column:span 2"><label>Ver la cartera de</label>' +
      '<select onchange="carVerCliente(this.value)">' + verOpts + '</select></div></div>' +
    (_car.verCliId
      ? (_car.cartera.length
        ? (nVenc ? '<div class="cot-warn" style="margin:0 0 8px">⚠️ ' + nVenc + ' producto(s) con la cartera vencida: el pedido comercial ya no usa esos precios hasta cargar una cotización nueva.</div>' : '') +
          '<div class="cot-scroll"><table class="cot-t"><thead><tr><th>Código</th><th>Producto</th><th class="n">Precio full</th><th class="n">Precio de venta</th><th>Vence</th><th>Cotización</th><th></th></tr></thead><tbody>' + filasC + '</tbody></table></div>'
        : '<div class="cot-hint">Este cliente no tiene productos en la cartera.</div>')
      : '<div class="cot-hint">Elegí un cliente para ver su cartera.</div>');

  out.innerHTML =
    '<div class="card">' +
      '<div class="car-sub">1 · Cargar desde una cotización</div>' +
      '<div class="cot-grid"><div style="grid-column:span 2"><label>Cotización</label>' +
        '<select onchange="carElegirCot(this.value)">' + cotOpts + '</select></div></div>' +
      (c ? paso1 : '<div class="cot-hint">Elegí una cotización emitida para ver qué entraría a la cartera de su cliente.</div>') +
    '</div>' +
    '<div class="card"><div class="car-sub">2 · Cartera del cliente</div>' + paso2 + '</div>';
}
