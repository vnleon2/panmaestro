// ═══════════════════════════════════════════════════════════════
// cotizador.js — "🧾 Cotizador" a comerciantes (prefijo cot*)
// Sub-pestaña del módulo Mercadeo y ventas.
//
// Por cada línea:
//   1. Se elige un producto del maestro (pan, galleta u otro): se trae código,
//      nombre, gramos y precio al público.
//   2. Si se cambian los gramos, el precio al público cambia proporcional:
//        PVP = PVP del maestro × gramos cotizados ÷ gramos del maestro
//   3. Precio al comerciante = PVP × (1 − descuento %)   (default 20 %, editable
//      en la cabecera y por línea).
//   4. Descuento adicional = monto por unidad que se resta del precio al
//      comerciante (NO es descuento por cantidad).
//   5. Precio neto cotizado = precio al comerciante − descuento adicional.
//   Todos los precios se redondean al múltiplo elegido (₡1, 5, 10, 50, 100).
//
// Con cantidad en alguna línea el documento es una COTIZACIÓN (con totales);
// sin cantidades en ninguna línea se imprime como LISTA DE PRECIOS.
//
// Una cotización guardada queda emitida (número COT-0001 y código de firma
// generados en el servidor) y ya no se edita: se puede imprimir, anular o usar
// como base de una nueva. Las líneas congelan precios y gramos, así un cambio
// posterior en el maestro no altera cotizaciones viejas.
//
// Tablas: cotizacion, cotizacion_det (sql_cotizador.sql).
// ═══════════════════════════════════════════════════════════════

let _cot = {
  clientes: [],
  productos: [],
  lista: [],        // cabeceras
  totales: {},      // cotizacion_id → { total, hayCantidad, lineas }
  cab: null,        // cotización abierta (null = lista)
  lineas: [],
  dirty: false,
  busca: '',
  filtro: 'vigentes',
  estiloOk: false
};

// ── Utilidades ─────────────────────────────────────────────────
function _cotN(v) {
  const x = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  return isNaN(x) ? 0 : x;
}
function _cotFmt(n, d) {
  return Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function _cotFecha(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}
function _cotVence(c) {
  const m = String(c.fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3] + (parseInt(c.validez_dias, 10) || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// 'anulada' | 'vencida' | 'vigente'
function _cotEstadoReal(c) {
  if (c.estado === 'anulada') return 'anulada';
  const v = _cotVence(c);
  return v && pmHoy() > v ? 'vencida' : 'vigente';
}
const COT_ESTADO_LBL = { vigente: 'Vigente', vencida: 'Vencida', anulada: 'Anulada' };

function _cotEstilo() {
  if (_cot.estiloOk) return;
  _cot.estiloOk = true;
  const st = document.createElement('style');
  st.textContent =
    '.cot-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}' +
    '.cot-bar .sp{flex:1}' +
    '.cot-badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;border:1px solid #C8D4C3;background:#fff;color:var(--cream2)}' +
    '.cot-badge.vigente{background:#E8F1EA;color:#2E6B45;border-color:#BBD5C2}' +
    '.cot-badge.vencida{background:#F4F1E4;color:#7A6A1C;border-color:#E0D7A8}' +
    '.cot-badge.anulada{background:#F6E5E5;color:#9B3030;border-color:#E3BCBC}' +
    '.cot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px}' +
    '.cot-grid label{display:block;font-size:11px;color:var(--cream2);margin-bottom:3px}' +
    '.cot-grid input,.cot-grid select,.cot-notas{width:100%;padding:6px 8px;font-size:13px;box-sizing:border-box}' +
    '.cot-t{width:100%;border-collapse:collapse;font-size:13px}' +
    '.cot-t th{background:var(--bg3);color:var(--gold2);text-align:left;padding:6px 8px;font-size:11px;white-space:nowrap}' +
    '.cot-t td{padding:5px 6px;border-top:1px solid #E1E8DD;vertical-align:middle}' +
    '.cot-t td.n,.cot-t th.n{text-align:right}' +
    '.cot-t input,.cot-t select{width:100%;min-width:0;padding:5px 6px;font-size:13px;box-sizing:border-box}' +
    '.cot-t input.num{text-align:right}' +
    '.cot-t tr.tot td{font-weight:700;background:rgba(46,107,69,.07)}' +
    '.cot-lista tr{cursor:pointer}' +
    '.cot-lista tr:hover td{background:rgba(46,107,69,.05)}' +
    '.cot-scroll{overflow-x:auto}' +
    '.cot-hint{font-size:11px;color:var(--cream2)}' +
    '.cot-warn{font-size:12px;color:#9B3030;margin-top:6px}';
  document.head.appendChild(st);
}

// ── Cálculo por línea (la fuente de verdad de los precios) ─────
// Devuelve { pvp, pcom, neto, total|null }
function _cotCalc(l, redondeo) {
  const r = Math.max(1, parseInt(redondeo, 10) || 1);
  const rd = x => Math.round(x / r) * r;
  const pb = _cotN(l.peso_base_g), vb = _cotN(l.pvp_base), g = _cotN(l.peso_g);
  const pvp = (pb > 0 && vb > 0) ? (g > 0 ? rd(vb * g / pb) : 0) : rd(_cotN(l.pvp));
  const pcom = rd(pvp * (1 - _cotN(l.descuento_pct) / 100));
  const neto = Math.max(0, rd(pcom - _cotN(l.descuento_monto)));
  const cant = _cotN(l.cantidad);
  return { pvp: pvp, pcom: pcom, neto: neto, total: cant > 0 ? cant * neto : null };
}
// Una cotización ya guardada se muestra con lo congelado, sin recalcular.
function _cotVals(l) {
  if (_cotBloqueada()) {
    const cant = _cotN(l.cantidad);
    const neto = _cotN(l.precio_neto);
    return { pvp: _cotN(l.pvp), pcom: _cotN(l.precio_comerciante), neto: neto, total: cant > 0 ? cant * neto : null };
  }
  return _cotCalc(l, _cot.cab.redondeo);
}
function _cotBloqueada() { return !!(_cot.cab && _cot.cab.id); }
function _cotHayCantidad() { return _cot.lineas.some(l => _cotN(l.cantidad) > 0); }

// ── Carga de datos ─────────────────────────────────────────────
async function _cotCargarBase() {
  const clientes = (typeof _sbCliCache !== 'undefined' && _sbCliCache) || await _sbCliCargar();
  _cot.clientes = clientes || [];
  try { _cot.productos = (await pmDB.productos.listar()) || []; }
  catch (e) { console.warn('[cotizador] productos', e.message); _cot.productos = []; }
}

async function _cotCargarLista() {
  const rows = await pmDB.get('cotizacion');
  _cot.lista = (rows || []).slice().sort((a, b) =>
    String(b.numero || '').localeCompare(String(a.numero || '')));
  _cot.totales = {};
  try {
    const dets = await pmDB.get('cotizacion_det');
    (dets || []).forEach(d => {
      const t = _cot.totales[d.cotizacion_id] || (_cot.totales[d.cotizacion_id] = { total: 0, hayCantidad: false, lineas: 0 });
      t.lineas++;
      if (d.total !== null && d.total !== undefined) { t.total += _cotN(d.total); t.hayCantidad = true; }
    });
  } catch (e) { console.warn('[cotizador] totales', e.message); }
}

async function cotInit() {
  _cotEstilo();
  const out = document.getElementById('cot-out');
  if (!out) return;
  out.innerHTML = '<div class="cot-hint">Cargando…</div>';
  try {
    await _cotCargarBase();
    await _cotCargarLista();
  } catch (e) {
    out.innerHTML = '<div class="card"><div class="cot-warn">No se pudo cargar: ' + pmEsc(e.message) +
      '<br>Revisá que hayas corrido sql_cotizador.sql en Supabase.</div></div>';
    return;
  }
  _cot.cab = null;
  cotRenderLista();
}

// ── Lista ──────────────────────────────────────────────────────
function cotFiltro(f) { _cot.filtro = f; cotRenderLista(); }
function cotBuscar(v) { _cot.busca = v; cotRenderLista(true); }

function cotRenderLista(soloTabla) {
  const out = document.getElementById('cot-out');
  if (!out) return;
  const q = _cot.busca.trim().toLowerCase();
  let lista = _cot.lista.filter(c => {
    const e = _cotEstadoReal(c);
    if (_cot.filtro === 'vigentes' && e !== 'vigente') return false;
    if (_cot.filtro !== 'todas' && _cot.filtro !== 'vigentes' && e !== _cot.filtro) return false;
    return !q || (String(c.numero).toLowerCase().includes(q) || String(c.cliente_nombre).toLowerCase().includes(q));
  });

  const filas = lista.map(c => {
    const t = _cot.totales[c.id] || {};
    const e = _cotEstadoReal(c);
    return '<tr onclick="cotAbrir(\'' + c.id + '\')">' +
      '<td><b>' + pmEsc(c.numero) + '</b></td>' +
      '<td>' + _cotFecha(c.fecha) + '</td>' +
      '<td>' + pmEsc(c.cliente_nombre) + '</td>' +
      '<td>' + (t.hayCantidad ? 'Cotización' : 'Lista de precios') + '</td>' +
      '<td>' + _cotFecha(_cotVence(c)) + '</td>' +
      '<td><span class="cot-badge ' + e + '">' + COT_ESTADO_LBL[e] + '</span></td>' +
      '<td class="n">' + (t.hayCantidad ? pmMoney(Math.round(t.total)) : '') + '</td>' +
      '</tr>';
  }).join('');

  const tabla =
    '<div class="cot-scroll"><table class="cot-t cot-lista">' +
    '<thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Válida hasta</th><th>Estado</th><th class="n">Total</th></tr></thead>' +
    '<tbody>' + (filas || '<tr><td colspan="7" class="cot-hint" style="padding:14px">No hay cotizaciones en esta vista.</td></tr>') + '</tbody></table></div>';

  if (soloTabla && document.getElementById('cot-tabla')) {
    document.getElementById('cot-tabla').innerHTML = tabla;
    return;
  }
  const filtros = [['vigentes', 'Vigentes'], ['vencida', 'Vencidas'], ['anulada', 'Anuladas'], ['todas', 'Todas']];
  const sel = filtros.map(f => '<option value="' + f[0] + '"' + (f[0] === _cot.filtro ? ' selected' : '') + '>' + f[1] + '</option>').join('');
  out.innerHTML =
    '<div class="cot-bar">' +
      '<select onchange="cotFiltro(this.value)" style="max-width:160px">' + sel + '</select>' +
      '<input type="text" placeholder="Buscar por número o cliente…" value="' + pmEsc(_cot.busca) + '" oninput="cotBuscar(this.value)" style="max-width:260px;padding:6px 8px;font-size:13px">' +
      '<span class="sp"></span>' +
      '<button class="btn btn-gold" onclick="cotNueva()">+ Nueva cotización</button>' +
    '</div>' +
    '<div class="card" id="cot-tabla">' + tabla + '</div>';
}

// ── Nueva / abrir / base ───────────────────────────────────────
function _cotCabNueva() {
  let firmante = '';
  try { firmante = localStorage.getItem('cot_firmante') || ''; } catch (e) {}
  return {
    id: null, numero: null, codigo_firma: null, base_id: null, estado: 'vigente',
    fecha: pmHoy(), validez_dias: 15, cliente_id: null, cliente_nombre: '',
    descuento_pct: 20, redondeo: 5, firmante: firmante, notas: ''
  };
}

function cotNueva() {
  _cot.cab = _cotCabNueva();
  _cot.lineas = [];
  _cot.dirty = true;
  cotAddLinea();
}

async function _cotCargarLineas(id) {
  const det = await pmDB.get('cotizacion_det', { cotizacion_id: id });
  return (det || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

async function cotAbrir(id) {
  const c = _cot.lista.find(x => x.id === id);
  if (!c) return;
  try {
    const det = await _cotCargarLineas(id);
    _cot.cab = Object.assign({}, c);
    _cot.lineas = det.map(d => Object.assign({}, d, { cantidad: d.cantidad === null ? '' : d.cantidad }));
    _cot.dirty = false;
    cotRenderEditor();
  } catch (e) { pmToast('No se pudo abrir: ' + e.message, 'err', 4500); }
}

// Copia una cotización a una nueva (número, fecha y código de firma nuevos)
async function cotUsarBase() {
  const o = _cot.cab;
  if (!o || !o.id) return;
  let firmante = o.firmante;
  try { firmante = localStorage.getItem('cot_firmante') || o.firmante; } catch (e) {}
  _cot.cab = Object.assign(_cotCabNueva(), {
    base_id: o.id, cliente_id: o.cliente_id, cliente_nombre: o.cliente_nombre,
    validez_dias: o.validez_dias, descuento_pct: o.descuento_pct, redondeo: o.redondeo,
    firmante: firmante, notas: o.notas || ''
  });
  _cot.lineas = _cot.lineas.map(l => ({
    id: null, producto_id: l.producto_id, producto_codigo: l.producto_codigo, producto_nombre: l.producto_nombre,
    peso_base_g: l.peso_base_g, pvp_base: l.pvp_base, peso_g: l.peso_g, pvp: l.pvp,
    descuento_pct: l.descuento_pct, descuento_monto: l.descuento_monto,
    cantidad: l.cantidad, comentario: l.comentario || ''
  }));
  _cot.dirty = true;
  cotRenderEditor();
  pmToast('Copia lista como borrador de una cotización nueva');
}

async function cotVolver() {
  if (_cot.dirty && !confirm('Hay cambios sin guardar. ¿Salir sin guardar?')) return;
  _cot.cab = null; _cot.dirty = false;
  try { await _cotCargarLista(); } catch (e) {}
  cotRenderLista();
}

// ── Editor ─────────────────────────────────────────────────────
function _cotOptsProd(sel) {
  return '<option value="">— producto —</option>' +
    pmOrdenar(_cot.productos, 'nombre').map(p =>
      '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' +
      pmEsc(p.nombre) + (p.codigo ? ' · ' + pmEsc(p.codigo) : '') + '</option>').join('');
}

function cotRenderEditor() {
  const out = document.getElementById('cot-out');
  if (!out || !_cot.cab) return;
  const c = _cot.cab;
  const lock = _cotBloqueada();
  const dis = lock ? ' disabled' : '';
  const est = lock ? _cotEstadoReal(c) : null;

  const datalist = '<datalist id="cot-clientes">' +
    pmOrdenar(_cot.clientes, 'nombre').map(x => '<option value="' + pmEsc(x.nombre) + '">').join('') + '</datalist>';

  const redOpts = [1, 5, 10, 50, 100].map(r =>
    '<option value="' + r + '"' + (r === Number(c.redondeo) ? ' selected' : '') + '>₡' + r + '</option>').join('');

  const filas = _cot.lineas.map((l, i) => {
    const v = _cotVals(l);
    const sinBase = !(_cotN(l.peso_base_g) > 0 && _cotN(l.pvp_base) > 0);
    const pvpCell = (!lock && sinBase)
      ? '<input class="num" type="number" min="0" step="any" value="' + (l.pvp ?? '') + '" oninput="cotInp(' + i + ',\'pvp\',this.value)">'
      : '<span id="cot-pvp-' + i + '">' + _cotFmt(v.pvp) + '</span>';
    return '<tr>' +
      '<td style="min-width:170px"><select' + dis + ' onchange="cotSetProducto(' + i + ',this.value)">' + _cotOptsProd(l.producto_id) + '</select></td>' +
      '<td>' + pmEsc(l.producto_codigo || '') + '</td>' +
      '<td style="width:74px"><input class="num"' + dis + ' type="number" min="0" step="any" value="' + (l.peso_g ?? '') + '" oninput="cotInp(' + i + ',\'peso_g\',this.value)"></td>' +
      '<td class="n" style="width:90px">' + pvpCell + '</td>' +
      '<td style="width:66px"><input class="num" id="cot-dp-' + i + '"' + dis + ' type="number" min="0" max="99.99" step="any" value="' + (l.descuento_pct ?? '') + '" oninput="cotInp(' + i + ',\'descuento_pct\',this.value)"></td>' +
      '<td class="n" style="width:92px"><span id="cot-pcom-' + i + '">' + _cotFmt(v.pcom) + '</span></td>' +
      '<td style="width:84px"><input class="num"' + dis + ' type="number" min="0" step="any" value="' + (_cotN(l.descuento_monto) || '') + '" oninput="cotInp(' + i + ',\'descuento_monto\',this.value)"></td>' +
      '<td class="n" style="width:92px"><b id="cot-neto-' + i + '">' + _cotFmt(v.neto) + '</b></td>' +
      '<td style="width:68px"><input class="num"' + dis + ' type="number" min="0" step="any" value="' + (l.cantidad ?? '') + '" oninput="cotInp(' + i + ',\'cantidad\',this.value)"></td>' +
      '<td class="n" style="width:92px"><span id="cot-tot-' + i + '">' + (v.total === null ? '' : _cotFmt(v.total)) + '</span></td>' +
      '<td style="min-width:130px"><input type="text"' + dis + ' value="' + pmEsc(l.comentario || '') + '" oninput="cotInp(' + i + ',\'comentario\',this.value)"></td>' +
      '<td style="width:30px">' + (lock ? '' : '<button class="btn btn-red btn-xs" onclick="cotDelLinea(' + i + ')">✕</button>') + '</td>' +
      '</tr>';
  }).join('');

  const barra = lock
    ? '<button class="btn btn-gold" onclick="cotImprimir()">🖨 Imprimir</button>' +
      '<button class="btn btn-out" onclick="cotUsarBase()">📋 Usar como base</button>' +
      (c.estado !== 'anulada' ? '<button class="btn btn-red" onclick="cotAnular()">Anular</button>' : '')
    : '<button class="btn btn-out btn-sm" onclick="cotActualizarPrecios()">↻ Actualizar precios del maestro</button>' +
      '<button class="btn btn-gold" onclick="cotGuardar()">💾 Guardar cotización</button>';

  out.innerHTML = datalist +
    '<div class="cot-bar">' +
      '<button class="btn btn-out btn-sm" onclick="cotVolver()">‹ Cotizaciones</button>' +
      '<b id="cot-tipo" style="font-size:15px"></b>' +
      (lock ? '<span class="cot-badge ' + est + '">' + COT_ESTADO_LBL[est] + '</span><span class="cot-hint">' + pmEsc(c.numero) + ' · firma ' + pmEsc(c.codigo_firma) + '</span>' : '') +
      '<span class="sp"></span>' + barra +
    '</div>' +
    '<div class="card">' +
      '<div class="cot-grid">' +
        '<div style="grid-column:span 2"><label>Cliente (escribilo o elegilo del maestro)</label>' +
          '<input type="text" list="cot-clientes"' + dis + ' value="' + pmEsc(c.cliente_nombre) + '" oninput="cotHead(\'cliente_nombre\',this.value)" placeholder="Nombre del comerciante"></div>' +
        '<div><label>Fecha</label><input type="date"' + dis + ' value="' + pmEsc(c.fecha) + '" oninput="cotHead(\'fecha\',this.value)"></div>' +
        '<div><label>Validez (días)</label><input type="number" min="1" step="1"' + dis + ' value="' + c.validez_dias + '" oninput="cotHead(\'validez_dias\',this.value)"></div>' +
        '<div><label>Descuento comerciante %</label><input type="number" min="0" max="99.99" step="any"' + dis + ' value="' + c.descuento_pct + '" oninput="cotHead(\'descuento_pct\',this.value)"></div>' +
        '<div><label>Redondear a</label><select' + dis + ' onchange="cotHead(\'redondeo\',this.value)">' + redOpts + '</select></div>' +
        '<div><label>Cotiza (firma)</label><input type="text"' + dis + ' value="' + pmEsc(c.firmante || '') + '" oninput="cotHead(\'firmante\',this.value)" placeholder="Nombre de quien cotiza"></div>' +
      '</div>' +
      '<div class="cot-scroll"><table class="cot-t">' +
        '<thead><tr><th>Producto</th><th>Código</th><th>Gramos</th><th class="n">Precio público</th><th>Desc. %</th>' +
        '<th class="n">Precio comerciante</th><th>Desc. adicional ₡</th><th class="n">Precio neto</th><th>Cant.</th><th class="n">Total</th><th>Comentario</th><th></th></tr></thead>' +
        '<tbody>' + filas + '<tr class="tot" id="cot-totrow"></tr></tbody>' +
      '</table></div>' +
      (lock ? '' : '<div style="margin-top:8px"><button class="btn btn-out btn-sm" onclick="cotAddLinea()">+ Producto</button></div>') +
      '<div style="margin-top:10px"><label class="cot-hint">Notas o condiciones (salen impresas)</label>' +
        '<textarea class="cot-notas" rows="2"' + dis + ' oninput="cotHead(\'notas\',this.value)">' + pmEsc(c.notas || '') + '</textarea></div>' +
      '<div class="cot-hint" style="margin-top:8px">' + (lock
        ? 'Esta cotización ya está emitida y no se edita. Para cambiarla usá “Usar como base”, que crea una nueva con otro número.'
        : 'Con cantidad en alguna línea sale como cotización con totales; sin cantidades sale como lista de precios. Al guardar se asigna el número y el código de firma, y la cotización queda emitida.') + '</div>' +
    '</div>';
  _cotRecalcTotales();
}

// ── Edición ────────────────────────────────────────────────────
function cotAddLinea() {
  _cot.lineas.push({
    id: null, producto_id: '', producto_codigo: '', producto_nombre: '',
    peso_base_g: null, pvp_base: null, peso_g: '', pvp: '',
    descuento_pct: _cot.cab.descuento_pct, descuento_monto: '', cantidad: '', comentario: ''
  });
  _cot.dirty = true;
  cotRenderEditor();
}

function cotDelLinea(i) {
  _cot.lineas.splice(i, 1);
  _cot.dirty = true;
  cotRenderEditor();
}

function cotSetProducto(i, prodId) {
  const l = _cot.lineas[i];
  const p = _cot.productos.find(x => x.id === prodId);
  l.producto_id = prodId || '';
  l.producto_codigo = p ? (p.codigo || '') : '';
  l.producto_nombre = p ? p.nombre : '';
  const peso = p ? _cotN(p.peso_g) : 0;
  const pvp = p ? (_cotN(p.precio_full) || _cotN(p.precio)) : 0;
  l.peso_base_g = peso || null;
  l.pvp_base = pvp || null;
  l.peso_g = peso || '';
  l.pvp = pvp || '';
  _cot.dirty = true;
  cotRenderEditor();
}

function cotHead(campo, valor) {
  const c = _cot.cab;
  if (_cotBloqueada()) return;
  if (campo === 'cliente_nombre') {
    c.cliente_nombre = valor;
    const m = _cot.clientes.find(x => String(x.nombre).trim().toLowerCase() === valor.trim().toLowerCase());
    c.cliente_id = m ? m.id : null;
  } else if (campo === 'validez_dias') {
    c.validez_dias = valor;
  } else if (campo === 'descuento_pct') {
    c.descuento_pct = valor;
    // El % de la cabecera es el de todas las líneas; cada una se puede ajustar después
    _cot.lineas.forEach((l, i) => {
      l.descuento_pct = valor;
      const el = document.getElementById('cot-dp-' + i);
      if (el) el.value = valor;
    });
    _cot.dirty = true;
    _cotRecalcTodo();
    return;
  } else if (campo === 'redondeo') {
    c.redondeo = parseInt(valor, 10) || 1;
  } else {
    c[campo] = valor;
  }
  _cot.dirty = true;
  if (campo === 'redondeo') _cotRecalcTodo();
}

function cotInp(i, campo, valor) {
  if (_cotBloqueada()) return;
  const l = _cot.lineas[i];
  l[campo] = valor;
  _cot.dirty = true;
  _cotRecalcFila(i);
  _cotRecalcTotales();
}

function _cotSet(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

function _cotRecalcFila(i) {
  const l = _cot.lineas[i];
  const v = _cotCalc(l, _cot.cab.redondeo);
  _cotSet('cot-pvp-' + i, _cotFmt(v.pvp));
  _cotSet('cot-pcom-' + i, _cotFmt(v.pcom));
  _cotSet('cot-neto-' + i, _cotFmt(v.neto));
  _cotSet('cot-tot-' + i, v.total === null ? '' : _cotFmt(v.total));
}

function _cotRecalcTodo() {
  _cot.lineas.forEach((l, i) => _cotRecalcFila(i));
  _cotRecalcTotales();
}

function _cotRecalcTotales() {
  const hay = _cotHayCantidad();
  let total = 0;
  _cot.lineas.forEach(l => { const v = _cotVals(l); if (v.total !== null) total += v.total; });
  const tipo = document.getElementById('cot-tipo');
  if (tipo) tipo.textContent = hay ? '🧾 Cotización' : '📋 Lista de precios';
  const row = document.getElementById('cot-totrow');
  if (row) row.innerHTML = '<td colspan="9" style="text-align:right">' + (hay ? 'Total cotizado' : '') + '</td>' +
    '<td class="n">' + (hay ? _cotFmt(total) : '') + '</td><td colspan="2"></td>';
}

// Trae de nuevo gramos y precio al público del maestro (solo en borradores)
function cotActualizarPrecios() {
  let n = 0;
  _cot.lineas.forEach(l => {
    const p = _cot.productos.find(x => x.id === l.producto_id);
    if (!p) return;
    const peso = _cotN(p.peso_g), pvp = _cotN(p.precio_full) || _cotN(p.precio);
    if (peso > 0 && pvp > 0) { l.peso_base_g = peso; l.pvp_base = pvp; n++; }
  });
  _cot.dirty = true;
  cotRenderEditor();
  pmToast(n ? 'Precios del maestro actualizados en ' + n + ' línea(s)' : 'Ninguna línea tiene producto del maestro', n ? 'ok' : 'err');
}

// ── Guardar ────────────────────────────────────────────────────
function _cotValidar() {
  const c = _cot.cab;
  if (!String(c.cliente_nombre || '').trim()) return 'Falta el nombre del cliente';
  if (!String(c.firmante || '').trim()) return 'Falta el nombre de quien cotiza';
  if (!(parseInt(c.validez_dias, 10) > 0)) return 'La validez debe ser de al menos 1 día';
  if (!c.fecha) return 'Falta la fecha';
  const d = _cotN(c.descuento_pct);
  if (d < 0 || d >= 100) return 'El descuento debe estar entre 0 y 99,99 %';
  if (!_cot.lineas.length) return 'Agregá al menos un producto';
  for (let i = 0; i < _cot.lineas.length; i++) {
    const l = _cot.lineas[i], n = i + 1;
    if (!String(l.producto_nombre || '').trim()) return 'Línea ' + n + ': falta el producto';
    const v = _cotCalc(l, c.redondeo);
    if (_cotN(l.peso_base_g) > 0 && !(_cotN(l.peso_g) > 0)) return 'Línea ' + n + ': faltan los gramos';
    if (!(v.pvp > 0)) return 'Línea ' + n + ': el precio al público es cero';
    const dl = _cotN(l.descuento_pct);
    if (dl < 0 || dl >= 100) return 'Línea ' + n + ': el descuento debe estar entre 0 y 99,99 %';
    if (_cotN(l.descuento_monto) < 0) return 'Línea ' + n + ': el descuento adicional no puede ser negativo';
    if (_cotN(l.descuento_monto) > v.pcom) return 'Línea ' + n + ': el descuento adicional supera el precio al comerciante';
  }
  return null;
}

async function cotGuardar() {
  if (_cotBloqueada()) return;
  const err = _cotValidar();
  if (err) { pmToast(err, 'err', 4000); return; }
  if (!confirm('Al guardar, la cotización queda emitida con su número y código de firma, y ya no se edita (para cambiarla se usa “Usar como base”). ¿Guardar?')) return;
  const c = _cot.cab;
  try { localStorage.setItem('cot_firmante', c.firmante.trim()); } catch (e) {}
  let creada = null;
  try {
    const rows = await pmDB.insert('cotizacion', {
      fecha: c.fecha, validez_dias: parseInt(c.validez_dias, 10), cliente_id: c.cliente_id || null,
      cliente_nombre: c.cliente_nombre.trim(), descuento_pct: _cotN(c.descuento_pct), redondeo: parseInt(c.redondeo, 10) || 1,
      firmante: c.firmante.trim(), notas: (c.notas || '').trim() || null, base_id: c.base_id || null
    });
    creada = rows && rows[0];
    if (!creada) throw new Error('No se recibió la cotización creada');
    const dets = _cot.lineas.map((l, i) => {
      const v = _cotCalc(l, c.redondeo);
      const cant = _cotN(l.cantidad);
      return {
        cotizacion_id: creada.id, orden: i,
        producto_id: l.producto_id || null, producto_codigo: l.producto_codigo || null, producto_nombre: l.producto_nombre,
        peso_base_g: _cotN(l.peso_base_g) || null, pvp_base: _cotN(l.pvp_base) || null,
        peso_g: _cotN(l.peso_g) || null, pvp: v.pvp,
        descuento_pct: _cotN(l.descuento_pct), precio_comerciante: v.pcom,
        descuento_monto: _cotN(l.descuento_monto), precio_neto: v.neto,
        cantidad: cant > 0 ? cant : null, comentario: (l.comentario || '').trim() || null
      };
    });
    await pmDB.insert('cotizacion_det', dets);
  } catch (e) {
    // Si falló en las líneas, no dejar una cabecera huérfana
    if (creada && creada.id) { try { await pmDB.hardDelete('cotizacion', creada.id); } catch (e2) {} }
    pmToast('No se pudo guardar: ' + e.message, 'err', 5000);
    return;
  }
  _cot.dirty = false;
  pmToast('Cotización ' + creada.numero + ' guardada ✓');
  try { await _cotCargarLista(); } catch (e) {}
  await cotAbrir(creada.id);
}

async function cotAnular() {
  const c = _cot.cab;
  if (!c || !c.id) return;
  if (!confirm('¿Anular la cotización ' + c.numero + '? No se puede deshacer.')) return;
  try {
    await pmDB.update('cotizacion', c.id, { estado: 'anulada' });
    pmToast('Cotización anulada');
    await _cotCargarLista();
    await cotAbrir(c.id);
  } catch (e) { pmToast('No se pudo anular: ' + e.message, 'err', 4500); }
}

// ── Hoja imprimible ────────────────────────────────────────────
function cotImprimir() {
  const c = _cot.cab;
  if (!c || !c.id) { pmToast('Guardá la cotización primero', 'err'); return; }
  const hay = _cotHayCantidad();
  const money = n => _cotFmt(n, 0);
  const hayDesc = _cot.lineas.some(l => _cotN(l.descuento_monto) > 0);
  const hayCom = _cot.lineas.some(l => String(l.comentario || '').trim());
  let total = 0;

  const filas = _cot.lineas.map(l => {
    const v = _cotVals(l);
    if (v.total !== null) total += v.total;
    return '<tr>' +
      '<td>' + pmEsc(l.producto_codigo || '') + '</td>' +
      '<td class="l">' + pmEsc(l.producto_nombre) + '</td>' +
      '<td>' + (l.peso_g ? _cotFmt(_cotN(l.peso_g), 0) : '') + '</td>' +
      '<td>' + money(v.pvp) + '</td>' +
      '<td>' + _cotFmt(_cotN(l.descuento_pct), 1) + '%</td>' +
      '<td>' + money(v.pcom) + '</td>' +
      (hayDesc ? '<td>' + (_cotN(l.descuento_monto) ? money(_cotN(l.descuento_monto)) : '') + '</td>' : '') +
      '<td><b>' + money(v.neto) + '</b></td>' +
      (hay ? '<td>' + (_cotN(l.cantidad) > 0 ? _cotFmt(_cotN(l.cantidad), 1) : '') + '</td><td>' + (v.total !== null ? money(v.total) : '') + '</td>' : '') +
      (hayCom ? '<td class="l">' + pmEsc(l.comentario || '') + '</td>' : '') +
      '</tr>';
  }).join('');

  const ncols = 5 + 1 + (hayDesc ? 1 : 0) + 1;   // hasta precio neto
  const titulo = (hay ? 'Cotización ' : 'Lista de precios ') + c.numero;
  const est = _cotEstadoReal(c);
  const html =
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + pmEsc(titulo) + '</title>' +
    '<style>' +
    '@page{size:A4 landscape;margin:12mm}' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#1d2b21;font-size:12px;margin:0}' +
    'h1{font-size:19px;margin:0 0 2px;color:#2E6B45}' +
    '.sub{color:#5F6F63;margin-bottom:10px}' +
    '.meta{display:flex;gap:28px;margin-bottom:10px;flex-wrap:wrap}' +
    '.meta div b{display:block;font-size:10px;text-transform:uppercase;color:#5F6F63;letter-spacing:.5px}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#2E6B45;color:#fff;padding:6px;font-size:11px;text-align:center}' +
    'td{border:1px solid #C8D4C3;padding:5px 6px;text-align:right}' +
    'td.l{text-align:left}' +
    'tr.tot td{font-weight:700;background:#EEF4EE}' +
    '.valid{margin-top:12px;padding:8px 12px;border:2px solid #2E6B45;border-radius:6px;font-size:13px}' +
    '.notas{margin-top:10px;color:#444}' +
    '.firma{margin-top:42px;display:flex;gap:40px;align-items:flex-end}' +
    '.firma .l1{width:300px;border-top:1px solid #444;padding-top:4px;text-align:center;font-size:12px}' +
    '.firma .cod{font-size:11px;color:#555}' +
    '.firma .cod b{font-family:"Courier New",monospace;font-size:14px;color:#1d2b21;letter-spacing:1px}' +
    '.anul{color:#9B3030;font-weight:700;margin-bottom:6px}' +
    '</style></head><body>' +
    '<h1>PanMaestro — ' + (hay ? 'Cotización' : 'Lista de precios') + '</h1>' +
    '<div class="sub">N.º ' + pmEsc(c.numero) + '</div>' +
    (est === 'anulada' ? '<div class="anul">COTIZACIÓN ANULADA</div>' : '') +
    '<div class="meta">' +
      '<div><b>Cliente</b>' + pmEsc(c.cliente_nombre) + '</div>' +
      '<div><b>Fecha</b>' + _cotFecha(c.fecha) + '</div>' +
      '<div><b>Válida hasta</b>' + _cotFecha(_cotVence(c)) + '</div>' +
    '</div>' +
    '<table><thead><tr>' +
      '<th>Código</th><th>Producto</th><th>Gramos</th><th>Precio público</th><th>Desc. %</th><th>Precio comerciante</th>' +
      (hayDesc ? '<th>Desc. adicional</th>' : '') + '<th>Precio neto</th>' +
      (hay ? '<th>Cant.</th><th>Total</th>' : '') + (hayCom ? '<th>Comentario</th>' : '') +
    '</tr></thead><tbody>' + filas +
    (hay ? '<tr class="tot"><td colspan="' + ncols + '" style="text-align:right">Total cotizado</td><td></td><td>' + money(total) + '</td>' + (hayCom ? '<td></td>' : '') + '</tr>' : '') +
    '</tbody></table>' +
    '<div class="valid">Precios en colones. ' + (hay ? 'Cotización' : 'Lista de precios') + ' válida por <b>' + parseInt(c.validez_dias, 10) +
      ' días</b>, hasta el <b>' + _cotFecha(_cotVence(c)) + '</b>.</div>' +
    (c.notas ? '<div class="notas"><b>Notas:</b> ' + pmEsc(c.notas) + '</div>' : '') +
    '<div class="firma"><div class="l1">' + pmEsc(c.firmante || '') + '<br><span style="color:#5F6F63">Cotiza</span></div>' +
      '<div class="cod">Código de firma<br><b>' + pmEsc(c.codigo_firma || '') + '</b></div></div>' +
    '</body></html>';

  const w = window.open('', '_blank');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err', 4000); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
}
