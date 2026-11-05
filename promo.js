// ═══════════════════════════════════════════════════════════════
// promo.js — "🎁 Pedido comercial promocional" (prefijo prm*)
//
// Pedido a un comercio con condiciones propias: el precio pactado de cada
// línea manda (no la política genérica del cliente) y puede incluir regalía
// (unidades sin cobro, por cortesía o premio).
//
//   Estados: borrador → confirmado → producido → entregado → cobrado
//            (anulado en cualquier momento)
//   · Solo el borrador se edita. Confirmar congela el costo de receta.
//   · Desde "confirmado" el pedido cuenta para la planificación (MPS, canal
//     comercial) a través de las vistas SQL — la conexión al balance del
//     MPS es una entrega aparte.
//
// Fórmulas por línea (cantidad = entregada total, INCLUYE la regalía):
//   valor a precio pactado = cantidad × precio pactado
//   monto regalía          = regalía × precio pactado
//   neto a cobrar          = (cantidad − regalía) × precio pactado
//   descuento %            = 1 − precio pactado ÷ PVP   (informativo)
//   costo                  = cantidad × costo unitario de la receta
//
// Tablas: pedido_promo, pedido_promo_det, config_pago (sql: pedido_promo.sql
// + sql_pedido_promo_ajuste.sql). Costo unitario = pmCostoPorGramo(receta) ×
// peso del producto — el mismo costo que muestra Maestros/Costeo.
// ═══════════════════════════════════════════════════════════════

const PRM_ESTADOS = ['borrador', 'confirmado', 'producido', 'entregado', 'cobrado', 'anulado'];
const PRM_ESTADO_LBL = {
  borrador: 'Borrador', confirmado: 'Confirmado', producido: 'Producido',
  entregado: 'Entregado', cobrado: 'Cobrado', anulado: 'Anulado'
};

let _prm = {
  clientes: [],     // clientes activos
  productos: [],    // productos_terminados activos (todos los tipos)
  pedidos: [],      // cabeceras
  totales: {},      // pedido_id → fila de pedido_promo_totales
  ped: null,        // pedido abierto en el editor (null = lista)
  lineas: [],       // líneas del pedido abierto
  borradas: [],     // ids de líneas a borrar al guardar
  dirty: false,
  sinpe: '',
  filtro: 'abiertos',
  estiloOk: false
};

// ── Utilidades ─────────────────────────────────────────────────
function _prmN(v) {
  const x = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  return isNaN(x) ? 0 : x;
}
function _prmFmt(n, d) {
  return Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}
function _prmRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function _prmEstilo() {
  if (_prm.estiloOk) return;
  _prm.estiloOk = true;
  const st = document.createElement('style');
  st.textContent =
    '.prm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}' +
    '.prm-bar .sp{flex:1}' +
    '.prm-badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;border:1px solid #C8D4C3;background:#fff;color:var(--cream2)}' +
    '.prm-badge.borrador{background:#F4F1E4;color:#7A6A1C;border-color:#E0D7A8}' +
    '.prm-badge.confirmado{background:#E4EEF8;color:#2F5F8F;border-color:#B9D0E8}' +
    '.prm-badge.producido,.prm-badge.entregado{background:#E8F1EA;color:#2E6B45;border-color:#BBD5C2}' +
    '.prm-badge.cobrado{background:#2E6B45;color:#fff;border-color:#2E6B45}' +
    '.prm-badge.anulado{background:#F6E5E5;color:#9B3030;border-color:#E3BCBC}' +
    '.prm-t{width:100%;border-collapse:collapse;font-size:13px}' +
    '.prm-t th{background:var(--bg3);color:var(--gold2);text-align:left;padding:6px 8px;font-size:11px;white-space:nowrap}' +
    '.prm-t td{padding:5px 6px;border-top:1px solid #E1E8DD;vertical-align:middle}' +
    '.prm-t td.n,.prm-t th.n{text-align:right}' +
    '.prm-t input,.prm-t select{width:100%;min-width:0;padding:5px 6px;font-size:13px}' +
    '.prm-t input.num{text-align:right}' +
    '.prm-t tr.tot td{font-weight:700;background:rgba(46,107,69,.07)}' +
    '.prm-lista tr{cursor:pointer}' +
    '.prm-lista tr:hover td{background:rgba(46,107,69,.05)}' +
    '.prm-scroll{overflow-x:auto}' +
    '.prm-warn{font-size:12px;color:#9B3030;margin-top:6px}' +
    '.prm-hint{font-size:11px;color:var(--cream2)}' +
    '.prm-neg{color:#9B3030}';
  document.head.appendChild(st);
}

// ── Carga de datos ─────────────────────────────────────────────
async function _prmCargarBase() {
  const clientes = _sbCliCache || await _sbCliCargar();
  _prm.clientes = clientes || [];
  try { await _sbCosteoCargar(); } catch (e) { console.warn('[promo] costeo', e.message); }
  try {
    _prm.productos = (await pmDB.productos.listar()) || [];
  } catch (e) {
    console.warn('[promo] productos', e.message);
    _prm.productos = [];
  }
  try {
    const cfg = await pmDB.get('config_pago', { clave: 'sinpe_telefono' });
    _prm.sinpe = (cfg && cfg[0] && cfg[0].valor) || '';
  } catch (e) { _prm.sinpe = ''; }
}

async function _prmCargarPedidos() {
  const rows = await pmDB.get('pedido_promo');
  _prm.pedidos = (rows || []).slice().sort((a, b) =>
    String(b.fecha_entrega || '').localeCompare(String(a.fecha_entrega || '')) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')));
  _prm.totales = {};
  try {
    const t = await pmDB.get('pedido_promo_totales');
    (t || []).forEach(x => { _prm.totales[x.pedido_id] = x; });
  } catch (e) { console.warn('[promo] totales', e.message); }
}

function _prmProd(id) { return _prm.productos.find(p => p.id === id) || null; }
function _prmCli(id) { return _prm.clientes.find(c => c.id === id) || null; }
function _prmCliNombre(id) { const c = _prmCli(id); return c ? c.nombre : '(cliente)'; }

// Costo unitario de receta de un producto = ₡/g de la receta × peso (igual que
// la pantalla de tipos de pan). null si el producto no tiene receta o peso.
function _prmCostoReceta(prod) {
  if (!prod) return null;
  const cod = prod.receta_cod || '';
  const peso = _prmN(prod.peso_g);
  if (!cod || !peso) return null;
  const rec = (_sbRecLista() || []).find(r => r.code === cod);
  if (!rec) return null;
  const pg = pmCostoPorGramo(rec);
  if (!pg) return null;
  return _prmRound2(pg.cpg * peso);
}

// ── Cálculo de una línea y del pedido ──────────────────────────
function _prmCalcLinea(l) {
  const cant = _prmN(l.cantidad), pvp = _prmN(l.pvp), pp = _prmN(l.precio_pactado);
  const reg = Math.min(_prmN(l.regalia_cant), cant);
  const prod = _prmProd(l.producto_id);
  // Costo congelado (pedido confirmado en adelante); en borrador se estima
  // en vivo con la receta de hoy.
  const congelado = l.costo_unit_estandar !== null && l.costo_unit_estandar !== undefined && l.costo_unit_estandar !== '';
  const costoU = congelado
    ? _prmN(l.costo_unit_estandar)
    : (_prmEditable() ? (_prmCostoReceta(prod) || 0) : 0);
  return {
    valorPvp: cant * pvp,
    valorPact: cant * pp,
    montoReg: reg * pp,
    neto: (cant - reg) * pp,
    descPct: pvp > 0 ? (1 - pp / pvp) * 100 : 0,
    costoU,
    costoTot: cant * costoU,
    costoReg: reg * costoU,
    sinCosto: !(costoU > 0)
  };
}

function _prmTotales() {
  const t = { valorPvp: 0, valorPact: 0, montoReg: 0, neto: 0, costoTot: 0, costoReg: 0, unidades: 0, regalias: 0, sinCosto: 0 };
  _prm.lineas.forEach(l => {
    const c = _prmCalcLinea(l);
    t.valorPvp += c.valorPvp; t.valorPact += c.valorPact; t.montoReg += c.montoReg;
    t.neto += c.neto; t.costoTot += c.costoTot; t.costoReg += c.costoReg;
    t.unidades += _prmN(l.cantidad); t.regalias += _prmN(l.regalia_cant);
    if (c.sinCosto && _prmN(l.cantidad) > 0) t.sinCosto++;
  });
  t.margen = t.neto - t.costoTot;
  t.margenPct = t.neto > 0 ? t.margen / t.neto * 100 : 0;
  return t;
}

// ── Entrada ────────────────────────────────────────────────────
async function prmInit() {
  _prmEstilo();
  const out = document.getElementById('prm-out');
  if (!out) return;
  out.innerHTML = '<div class="prm-hint">Cargando…</div>';
  try {
    await _prmCargarBase();
    await _prmCargarPedidos();
  } catch (e) {
    out.innerHTML = '<div class="card"><div class="prm-warn">No se pudo cargar: ' + pmEsc(e.message) +
      '<br>Revisá que hayas corrido pedido_promo.sql y sql_pedido_promo_ajuste.sql en Supabase.</div></div>';
    return;
  }
  _prm.ped = null;
  prmRenderLista();
}

// ── Lista de pedidos ───────────────────────────────────────────
function prmFiltro(f) { _prm.filtro = f; prmRenderLista(); }

function prmRenderLista() {
  const out = document.getElementById('prm-out');
  if (!out) return;
  const cerrados = ['cobrado', 'anulado'];
  let lista = _prm.pedidos.slice();
  if (_prm.filtro === 'abiertos') lista = lista.filter(p => !cerrados.includes(p.estado));
  else if (_prm.filtro !== 'todos') lista = lista.filter(p => p.estado === _prm.filtro);

  const filtros = [['abiertos', 'Abiertos'], ['borrador', 'Borrador'], ['confirmado', 'Confirmados'],
    ['entregado', 'Entregados'], ['cobrado', 'Cobrados'], ['anulado', 'Anulados'], ['todos', 'Todos']];
  const sel = filtros.map(f => '<option value="' + f[0] + '"' + (f[0] === _prm.filtro ? ' selected' : '') + '>' + f[1] + '</option>').join('');

  const filas = lista.map(p => {
    const t = _prm.totales[p.id] || {};
    return '<tr onclick="prmAbrir(\'' + p.id + '\')">' +
      '<td>' + pmEsc(p.fecha_entrega || '') + '</td>' +
      '<td>' + pmEsc(_prmCliNombre(p.cliente_id)) + '</td>' +
      '<td>' + pmEsc(p.titulo || '') + '</td>' +
      '<td><span class="prm-badge ' + p.estado + '">' + PRM_ESTADO_LBL[p.estado] + '</span></td>' +
      '<td class="n">' + pmMoney(Math.round(t.total_neto_cobrar || 0)) + '</td>' +
      '<td class="n">' + pmMoney(Math.round(t.margen_bruto || 0)) + '</td>' +
      '</tr>';
  }).join('');

  out.innerHTML =
    '<div class="prm-bar">' +
      '<select onchange="prmFiltro(this.value)" style="max-width:190px">' + sel + '</select>' +
      '<span class="sp"></span>' +
      '<button class="btn btn-out btn-sm" onclick="prmConfigSinpe()">📱 Teléfono SINPE: ' + pmEsc(_prm.sinpe || '(sin definir)') + '</button>' +
      '<button class="btn btn-gold" onclick="prmNuevo()">+ Nuevo pedido promocional</button>' +
    '</div>' +
    '<div class="card"><div class="prm-scroll"><table class="prm-t prm-lista">' +
      '<thead><tr><th>Entrega</th><th>Cliente</th><th>Pedido</th><th>Estado</th><th class="n">Neto a cobrar</th><th class="n">Margen (costo receta)</th></tr></thead>' +
      '<tbody>' + (filas || '<tr><td colspan="6" class="prm-hint" style="padding:14px">No hay pedidos en esta vista.</td></tr>') + '</tbody>' +
    '</table></div></div>';
}

// ── Teléfono SINPE (config_pago) ───────────────────────────────
async function prmConfigSinpe() {
  const v = prompt('Teléfono SINPE Móvil para los pedidos NUEVOS (los pedidos ya creados conservan el suyo):', _prm.sinpe || '');
  if (v === null) return;
  const tel = v.trim();
  if (!tel) { pmToast('El teléfono no puede quedar vacío', 'err'); return; }
  try {
    await pmDB.upsert('config_pago', { clave: 'sinpe_telefono', valor: tel });
    _prm.sinpe = tel;
    pmToast('Teléfono SINPE actualizado ✓');
    prmRenderLista();
  } catch (e) { pmToast('No se pudo guardar: ' + e.message, 'err', 4500); }
}

// ── Abrir / nuevo ──────────────────────────────────────────────
function prmNuevo() {
  _prm.ped = { id: null, cliente_id: '', titulo: '', fecha_entrega: pmHoy(), estado: 'borrador', condiciones: '', telefono_pago: null };
  _prm.lineas = [];
  _prm.borradas = [];
  _prm.dirty = true;
  prmRenderEditor();
}

async function prmAbrir(id) {
  const p = _prm.pedidos.find(x => x.id === id);
  if (!p) return;
  try {
    const det = await pmDB.get('pedido_promo_det', { pedido_id: id });
    _prm.ped = Object.assign({}, p);
    _prm.lineas = (det || []).slice().sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)))
      .map(d => ({
        id: d.id, producto_id: d.producto_id, producto_nombre: d.producto_nombre,
        peso_g: d.peso_g, cantidad: d.cantidad, pvp: d.pvp, precio_pactado: d.precio_pactado,
        regalia_cant: d.regalia_cant, regalia_motivo: d.regalia_motivo,
        costo_unit_estandar: d.costo_unit_estandar, costo_origen: d.costo_origen, _mod: false
      }));
    _prm.borradas = [];
    _prm.dirty = false;
    prmRenderEditor();
  } catch (e) { pmToast('No se pudo abrir: ' + e.message, 'err', 4500); }
}

async function prmCerrar() {
  if (_prm.dirty && !confirm('Hay cambios sin guardar. ¿Salir sin guardar?')) return;
  _prm.ped = null; _prm.dirty = false;
  try { await _prmCargarPedidos(); } catch (e) {}
  prmRenderLista();
}

// ── Editor ─────────────────────────────────────────────────────
function _prmEditable() { return _prm.ped && _prm.ped.estado === 'borrador'; }

function _prmOptsProd(sel) {
  const lista = pmOrdenar(_prm.productos, 'nombre');
  return '<option value="">— producto —</option>' +
    lista.map(p => '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + pmEsc(p.nombre) + '</option>').join('');
}

function prmRenderEditor() {
  const out = document.getElementById('prm-out');
  if (!out || !_prm.ped) return;
  const p = _prm.ped;
  const ed = _prmEditable();
  const dis = ed ? '' : ' disabled';
  const esNuevo = !p.id;

  const cliOpts = '<option value="">— seleccionar cliente —</option>' +
    pmOrdenar(_prm.clientes, 'nombre').map(c =>
      '<option value="' + c.id + '"' + (c.id === p.cliente_id ? ' selected' : '') + '>' + pmEsc(c.nombre) + (c.codigo ? ' · ' + pmEsc(c.codigo) : '') + '</option>').join('');

  const filas = _prm.lineas.map((l, i) => {
    const motivo = '<select' + dis + ' onchange="prmInp(' + i + ',\'regalia_motivo\',this.value)">' +
      '<option value="cortesia"' + (l.regalia_motivo !== 'premio' ? ' selected' : '') + '>Cortesía</option>' +
      '<option value="premio"' + (l.regalia_motivo === 'premio' ? ' selected' : '') + '>Premio</option></select>';
    return '<tr>' +
      '<td style="min-width:170px"><select' + dis + ' onchange="prmSetProducto(' + i + ',this.value)">' + _prmOptsProd(l.producto_id) + '</select></td>' +
      '<td style="width:62px"><input class="num"' + dis + ' type="number" min="0" step="any" value="' + (l.peso_g ?? '') + '" oninput="prmInp(' + i + ',\'peso_g\',this.value)"></td>' +
      '<td style="width:70px"><input class="num"' + dis + ' type="number" min="0" step="any" value="' + (l.cantidad ?? '') + '" oninput="prmInp(' + i + ',\'cantidad\',this.value)"></td>' +
      '<td style="width:80px"><input class="num"' + dis + ' type="number" min="0" step="any" value="' + (l.pvp ?? '') + '" oninput="prmInp(' + i + ',\'pvp\',this.value)"></td>' +
      '<td style="width:88px"><input class="num"' + dis + ' type="number" min="0" step="any" id="prm-pp-' + i + '" value="' + (l.precio_pactado ?? '') + '" oninput="prmInp(' + i + ',\'precio_pactado\',this.value)"></td>' +
      '<td style="width:64px"><input class="num"' + dis + ' type="number" step="any" id="prm-dc-' + i + '" value="" oninput="prmSetDesc(' + i + ',this.value)"></td>' +
      '<td style="width:66px"><input class="num"' + dis + ' type="number" min="0" step="any" value="' + (l.regalia_cant ?? 0) + '" oninput="prmInp(' + i + ',\'regalia_cant\',this.value)"></td>' +
      '<td style="width:96px">' + motivo + '</td>' +
      '<td class="n" id="prm-vp-' + i + '"></td>' +
      '<td class="n" id="prm-nt-' + i + '"></td>' +
      '<td class="n" id="prm-cs-' + i + '"></td>' +
      '<td style="width:34px">' + (ed ? '<button class="btn btn-out btn-sm" title="Quitar línea" onclick="prmDelLinea(' + i + ')">✕</button>' : '') + '</td>' +
      '</tr>';
  }).join('');

  // Botones de estado según el estado actual
  let acciones = '';
  if (ed) {
    acciones += '<button class="btn btn-gold" onclick="prmGuardar()">💾 Guardar</button>';
    if (!esNuevo) acciones += '<button class="btn btn-out" onclick="prmCambiarEstado(\'confirmado\')">✅ Confirmar pedido</button>';
  } else if (p.estado === 'confirmado') {
    acciones += '<button class="btn btn-gold" onclick="prmCambiarEstado(\'producido\')">🔥 Marcar producido</button>';
  } else if (p.estado === 'producido') {
    acciones += '<button class="btn btn-gold" onclick="prmCambiarEstado(\'entregado\')">🚚 Marcar entregado</button>';
  } else if (p.estado === 'entregado') {
    acciones += '<button class="btn btn-gold" onclick="prmCobrar()">💰 Registrar cobro</button>';
  }
  if (!esNuevo) {
    acciones += '<button class="btn btn-out" onclick="prmImprimir()">🖨 Imprimir hoja</button>';
    if (p.estado === 'confirmado') acciones += '<button class="btn btn-out" onclick="prmCambiarEstado(\'borrador\')">✏️ Reabrir a borrador</button>';
    if (p.estado !== 'anulado' && p.estado !== 'cobrado') acciones += '<button class="btn btn-out" onclick="prmCambiarEstado(\'anulado\')">🚫 Anular</button>';
  }

  out.innerHTML =
    '<div class="prm-bar">' +
      '<button class="btn btn-out btn-sm" onclick="prmCerrar()">‹ Pedidos</button>' +
      '<span class="prm-badge ' + p.estado + '">' + PRM_ESTADO_LBL[p.estado] + '</span>' +
      (p.telefono_pago ? '<span class="prm-hint">SINPE: ' + pmEsc(p.telefono_pago) + '</span>' : '') +
      '<span class="sp"></span>' + acciones +
    '</div>' +
    '<div class="card"><div class="ctitle">Condiciones del pedido</div>' +
      '<div class="row">' +
        '<div class="col"><label>Cliente</label><select id="prm-cli"' + (esNuevo && ed ? '' : ' disabled') + ' onchange="prmHead(\'cliente_id\',this.value)">' + cliOpts + '</select></div>' +
        '<div class="col"><label>Nombre del pedido</label><input type="text" id="prm-tit"' + dis + ' value="' + pmEsc(p.titulo || '') + '" placeholder="Ej: Arepa Station — noviembre" oninput="prmHead(\'titulo\',this.value)"></div>' +
        '<div class="col sm"><label>Fecha de entrega</label><input type="date" id="prm-fe"' + dis + ' value="' + pmEsc(p.fecha_entrega || '') + '" onchange="prmHead(\'fecha_entrega\',this.value)"></div>' +
      '</div>' +
      '<div class="row"><div class="col"><label>Condiciones particulares (se imprimen en la hoja)</label>' +
        '<input type="text" id="prm-con"' + dis + ' value="' + pmEsc(p.condiciones || '') + '" placeholder="Ej: pago por SINPE contra entrega" oninput="prmHead(\'condiciones\',this.value)"></div></div>' +
    '</div>' +
    '<div class="card"><div class="ctitle">Productos</div>' +
      '<div class="prm-scroll"><table class="prm-t"><thead><tr>' +
        '<th>Producto</th><th class="n">Peso g</th><th class="n">Cant. entregada</th><th class="n">PVP</th>' +
        '<th class="n">Precio pactado</th><th class="n">Desc. %</th><th class="n">Regalía</th><th>Motivo</th>' +
        '<th class="n">Valor pactado</th><th class="n">Neto a cobrar</th><th class="n">Costo receta</th><th></th>' +
      '</tr></thead><tbody>' + (filas || '<tr><td colspan="12" class="prm-hint" style="padding:12px">Aún no hay productos.</td></tr>') + '</tbody></table></div>' +
      (ed ? '<div style="margin-top:10px"><button class="btn btn-out" onclick="prmAddLinea()">+ Agregar producto</button></div>' : '') +
      '<div class="prm-hint" style="margin-top:8px">La cantidad entregada incluye las unidades de regalía. El descuento y el precio pactado se calculan uno del otro: escribí el que prefieras.</div>' +
    '</div>' +
    '<div class="stats" id="prm-stats"></div>' +
    '<div id="prm-aviso"></div>';

  _prmRecalc(true);
}

// Actualiza celdas calculadas y totales sin redibujar (no pierde el foco).
// refrescarDesc = true también rellena los campos Desc. % desde el precio.
function _prmRecalc(refrescarDesc) {
  _prm.lineas.forEach((l, i) => {
    const c = _prmCalcLinea(l);
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('prm-vp-' + i, pmMoney(Math.round(c.valorPact)));
    set('prm-nt-' + i, pmMoney(Math.round(c.neto)));
    const cs = document.getElementById('prm-cs-' + i);
    if (cs) {
      cs.textContent = c.sinCosto ? 'sin costo' : pmMoney(Math.round(c.costoTot));
      cs.className = 'n' + (c.sinCosto ? ' prm-neg' : '');
    }
    if (refrescarDesc) {
      const dc = document.getElementById('prm-dc-' + i);
      if (dc) dc.value = _prmN(l.pvp) > 0 ? _prmRound2(c.descPct) : '';
    }
  });
  const t = _prmTotales();
  const st = document.getElementById('prm-stats');
  if (st) {
    const card = (lbl, val, sub) => '<div class="stat"><div class="stat-lbl">' + lbl + '</div><div class="stat-val">' + val + '</div>' + (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
    st.innerHTML =
      card('Valor a PVP', pmMoney(Math.round(t.valorPvp)), _prmFmt(t.unidades, 0) + ' unidades') +
      card('Con precio pactado', pmMoney(Math.round(t.valorPact))) +
      card('Regalía', pmMoney(Math.round(t.montoReg)), _prmFmt(t.regalias, 1) + ' unidades') +
      card('Neto a cobrar', pmMoney(Math.round(t.neto))) +
      card('Costo de receta', pmMoney(Math.round(t.costoTot)), 'regalía: ' + pmMoney(Math.round(t.costoReg))) +
      card('Margen', pmMoney(Math.round(t.margen)), _prmFmt(t.margenPct, 1) + '% del neto');
  }
  const av = document.getElementById('prm-aviso');
  if (av) {
    av.innerHTML = t.sinCosto > 0
      ? '<div class="prm-warn">' + t.sinCosto + ' línea(s) sin costo de receta (el producto no tiene receta ligada o peso). El margen no las incluye.</div>'
      : '';
  }
}

// ── Edición de cabecera y líneas ───────────────────────────────
function prmHead(campo, valor) {
  if (!_prmEditable()) return;
  _prm.ped[campo] = valor;
  _prm.dirty = true;
}

function prmAddLinea() {
  if (!_prmEditable()) return;
  _prm.lineas.push({
    id: null, producto_id: '', producto_nombre: '', peso_g: '', cantidad: 1, pvp: '', precio_pactado: '',
    regalia_cant: 0, regalia_motivo: 'cortesia', costo_unit_estandar: null, costo_origen: 'receta', _mod: true
  });
  _prm.dirty = true;
  prmRenderEditor();
}

function prmDelLinea(i) {
  if (!_prmEditable()) return;
  const l = _prm.lineas[i];
  if (!l) return;
  if (l.id) _prm.borradas.push(l.id);
  _prm.lineas.splice(i, 1);
  _prm.dirty = true;
  prmRenderEditor();
}

function prmSetProducto(i, prodId) {
  if (!_prmEditable()) return;
  const l = _prm.lineas[i];
  const prod = _prmProd(prodId);
  if (!l) return;
  l.producto_id = prodId || '';
  l.producto_nombre = prod ? prod.nombre : '';
  l.peso_g = prod ? _prmN(prod.peso_g) || '' : '';
  const pvp = prod ? (_prmN(prod.precio_full) || _prmN(prod.precio)) : 0;
  l.pvp = pvp || '';
  l.precio_pactado = pvp || '';
  l.costo_unit_estandar = null;
  l._mod = true;
  _prm.dirty = true;
  prmRenderEditor();
}

function prmInp(i, campo, valor) {
  if (!_prmEditable()) return;
  const l = _prm.lineas[i];
  if (!l) return;
  if (campo === 'regalia_motivo') l[campo] = valor;
  else l[campo] = valor === '' ? '' : _prmN(valor);
  l._mod = true;
  _prm.dirty = true;
  // Si cambia el precio pactado o el PVP, el % de descuento se actualiza.
  if (campo === 'precio_pactado' || campo === 'pvp') {
    const dc = document.getElementById('prm-dc-' + i);
    if (dc) dc.value = _prmN(l.pvp) > 0 ? _prmRound2((1 - _prmN(l.precio_pactado) / _prmN(l.pvp)) * 100) : '';
  }
  _prmRecalc(false);
}

// Escribir el descuento % recalcula el precio pactado = PVP × (1 − d)
function prmSetDesc(i, valor) {
  if (!_prmEditable()) return;
  const l = _prm.lineas[i];
  if (!l) return;
  const pvp = _prmN(l.pvp);
  if (!(pvp > 0)) return;
  const pp = _prmRound2(pvp * (1 - _prmN(valor) / 100));
  l.precio_pactado = pp;
  l._mod = true;
  _prm.dirty = true;
  const ppEl = document.getElementById('prm-pp-' + i);
  if (ppEl) ppEl.value = pp;
  _prmRecalc(false);
}

// ── Guardar ────────────────────────────────────────────────────
function _prmValidar() {
  const p = _prm.ped;
  if (!p.cliente_id) return 'Seleccioná un cliente';
  if (!p.fecha_entrega) return 'Falta la fecha de entrega';
  for (let i = 0; i < _prm.lineas.length; i++) {
    const l = _prm.lineas[i], n = i + 1;
    if (!l.producto_id) return 'Línea ' + n + ': elegí el producto';
    if (!(_prmN(l.cantidad) > 0)) return 'Línea ' + n + ': la cantidad debe ser mayor que 0';
    if (_prmN(l.precio_pactado) < 0 || l.precio_pactado === '') return 'Línea ' + n + ': falta el precio pactado';
    if (_prmN(l.pvp) <= 0) return 'Línea ' + n + ': falta el PVP de referencia';
    if (_prmN(l.regalia_cant) > _prmN(l.cantidad)) return 'Línea ' + n + ': la regalía no puede superar la cantidad entregada';
  }
  return null;
}

function _prmFilaDet(pedId, l) {
  const reg = _prmN(l.regalia_cant);
  return {
    pedido_id: pedId,
    producto_id: l.producto_id,
    producto_nombre: l.producto_nombre,
    peso_g: l.peso_g === '' ? null : _prmN(l.peso_g),
    cantidad: _prmN(l.cantidad),
    pvp: _prmN(l.pvp),
    precio_pactado: _prmN(l.precio_pactado),
    regalia_cant: reg,
    regalia_motivo: reg > 0 ? (l.regalia_motivo === 'premio' ? 'premio' : 'cortesia') : null,
    costo_unit_estandar: (l.costo_unit_estandar === null || l.costo_unit_estandar === undefined || l.costo_unit_estandar === '') ? null : _prmN(l.costo_unit_estandar),
    costo_origen: l.costo_origen || 'receta'
  };
}

async function prmGuardar() {
  if (!_prmEditable()) return true;
  const err = _prmValidar();
  if (err) { pmToast(err, 'err', 4000); return false; }
  const p = _prm.ped;
  try {
    const cab = {
      cliente_id: p.cliente_id, titulo: p.titulo || null,
      fecha_entrega: p.fecha_entrega, condiciones: p.condiciones || null
    };
    if (!p.id) {
      const rows = await pmDB.insert('pedido_promo', cab);
      const nuevo = rows && rows[0];
      if (!nuevo) throw new Error('No se recibió el pedido creado');
      _prm.ped = Object.assign({}, p, nuevo);
    } else {
      await pmDB.update('pedido_promo', p.id, cab);
    }
    const pedId = _prm.ped.id;

    if (_prm.borradas.length) {
      await pmDB.hardDeleteMany('pedido_promo_det', _prm.borradas);
      _prm.borradas = [];
    }
    // Líneas modificadas (existentes): una por una
    for (const l of _prm.lineas.filter(x => x.id && x._mod)) {
      const f = _prmFilaDet(pedId, l);
      delete f.pedido_id;
      await pmDB.update('pedido_promo_det', l.id, f);
      l._mod = false;
    }
    // Líneas nuevas: en lote
    const nuevas = _prm.lineas.filter(x => !x.id);
    if (nuevas.length) {
      const ins = await pmDB.insert('pedido_promo_det', nuevas.map(l => _prmFilaDet(pedId, l)));
      (ins || []).forEach((r, k) => { if (nuevas[k]) { nuevas[k].id = r.id; nuevas[k]._mod = false; } });
    }
    _prm.dirty = false;
    pmToast('Pedido guardado ✓');
    await _prmCargarPedidos();
    prmRenderEditor();
    return true;
  } catch (e) {
    pmToast('No se pudo guardar: ' + e.message, 'err', 5000);
    return false;
  }
}

// ── Cambios de estado ──────────────────────────────────────────
async function _prmSetEstado(nuevo, extra) {
  const datos = Object.assign({ estado: nuevo }, extra || {});
  await pmDB.update('pedido_promo', _prm.ped.id, datos);
  Object.assign(_prm.ped, datos);
  await _prmCargarPedidos();
  prmRenderEditor();
}

async function prmCambiarEstado(nuevo) {
  const p = _prm.ped;
  if (!p || !p.id) { pmToast('Guardá el pedido primero', 'err'); return; }
  try {
    if (nuevo === 'confirmado') {
      if (_prmEditable() && _prm.dirty) { if (!(await prmGuardar())) return; }
      if (!_prm.lineas.length) { pmToast('Agregá al menos un producto', 'err'); return; }
      const t = _prmTotales();
      let msg = 'Confirmar este pedido?\n\n• Entra a la planificación (comercial).\n• Se congela el costo de receta de cada línea.\n• Ya no se podrá editar (podés reabrirlo a borrador).';
      if (t.sinCosto > 0) msg += '\n\n⚠ ' + t.sinCosto + ' línea(s) quedarán sin costo de receta.';
      if (!confirm(msg)) return;
      // Congelar costo unitario por línea (precio de hoy)
      for (const l of _prm.lineas) {
        const costo = _prmCostoReceta(_prmProd(l.producto_id));
        l.costo_unit_estandar = costo;
        l.costo_origen = 'receta';
        await pmDB.update('pedido_promo_det', l.id, { costo_unit_estandar: costo, costo_origen: 'receta' });
      }
      await _prmSetEstado('confirmado');
      pmToast('Pedido confirmado ✓');
      return;
    }
    if (nuevo === 'borrador') {
      if (!confirm('Reabrir a borrador? Sale de la planificación hasta que lo confirmes otra vez, y el costo se recalculará al confirmar.')) return;
      _prm.lineas.forEach(l => { l.costo_unit_estandar = null; });
      await pmDB.updateWhere('pedido_promo_det', { pedido_id: p.id }, { costo_unit_estandar: null });
      await _prmSetEstado('borrador');
      return;
    }
    if (nuevo === 'anulado') {
      if (!confirm('Anular este pedido? Sale de la planificación y del cobro.')) return;
      await _prmSetEstado('anulado');
      return;
    }
    await _prmSetEstado(nuevo);   // producido / entregado
  } catch (e) {
    pmToast('No se pudo cambiar el estado: ' + e.message, 'err', 5000);
  }
}

async function prmCobrar() {
  const p = _prm.ped;
  if (!p || !p.id) return;
  const t = _prmTotales();
  const sugerido = Math.round(t.neto);
  const m = prompt('Monto cobrado (₡). Neto del pedido: ' + pmMoney(sugerido), String(sugerido));
  if (m === null) return;
  const monto = _prmN(m);
  if (!(monto >= 0) || m.trim() === '') { pmToast('Monto no válido', 'err'); return; }
  const ref = prompt('Referencia del pago (comprobante SINPE, opcional):', '') || '';
  try {
    await _prmSetEstado('cobrado', { monto_cobrado: monto, fecha_cobro: pmHoy(), referencia_pago: ref.trim() || null });
    const dif = monto - sugerido;
    pmToast(dif === 0 ? 'Cobro registrado ✓' : 'Cobro registrado — diferencia de ' + pmMoney(Math.round(dif)), dif === 0 ? 'ok' : 'err', 4500);
  } catch (e) { pmToast('No se pudo registrar el cobro: ' + e.message, 'err', 5000); }
}

// ── Hoja imprimible (formato del pedido a comercios) ───────────
function prmImprimir() {
  const p = _prm.ped;
  if (!p || !p.id) { pmToast('Guardá el pedido primero', 'err'); return; }
  if (_prmEditable() && _prm.dirty) { pmToast('Guardá los cambios antes de imprimir', 'err'); return; }
  const money = n => _prmFmt(Math.round(n), 0);
  let totPvp = 0, totPact = 0, totReg = 0, totNeto = 0;

  const filas = _prm.lineas.map(l => {
    const c = _prmCalcLinea(l);
    totPvp += c.valorPvp; totPact += c.valorPact; totReg += c.montoReg; totNeto += c.neto;
    return '<tr>' +
      '<td class="l">' + pmEsc(l.producto_nombre) + '</td>' +
      '<td>' + (l.peso_g ? _prmFmt(_prmN(l.peso_g), 0) : '') + '</td>' +
      '<td>' + _prmFmt(_prmN(l.cantidad), 1) + '</td>' +
      '<td>' + money(_prmN(l.pvp)) + '</td>' +
      '<td>' + money(c.valorPvp) + '</td>' +
      '<td>' + _prmFmt(c.descPct, 1) + '%</td>' +
      '<td>' + money(c.valorPact) + '</td>' +
      '<td>' + (_prmN(l.regalia_cant) ? _prmFmt(_prmN(l.regalia_cant), 1) : '') + '</td>' +
      '<td>' + (c.montoReg ? money(c.montoReg) : '') + '</td>' +
      '<td><b>' + money(c.neto) + '</b></td>' +
      '</tr>';
  }).join('');

  const tel = p.telefono_pago || _prm.sinpe || '';
  const html =
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pedido ' + pmEsc(p.titulo || '') + '</title>' +
    '<style>' +
    '@page{size:A4 landscape;margin:12mm}' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#1d2b21;font-size:12px;margin:0}' +
    'h1{font-size:18px;margin:0 0 2px;color:#2E6B45}' +
    '.sub{color:#5F6F63;margin-bottom:10px}' +
    '.meta{display:flex;gap:28px;margin-bottom:10px;flex-wrap:wrap}' +
    '.meta div b{display:block;font-size:10px;text-transform:uppercase;color:#5F6F63;letter-spacing:.5px}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#2E6B45;color:#fff;padding:6px 6px;font-size:11px;text-align:center}' +
    'td{border:1px solid #C8D4C3;padding:5px 6px;text-align:right}' +
    'td.l{text-align:left}' +
    'tr.tot td{font-weight:700;background:#EEF4EE}' +
    '.pago{margin-top:14px;padding:10px 12px;border:2px solid #2E6B45;border-radius:6px;font-size:14px}' +
    '.cond{margin-top:10px;color:#444}' +
    '.firmas{display:flex;gap:60px;margin-top:40px}' +
    '.firmas div{flex:1;border-top:1px solid #444;padding-top:4px;text-align:center;font-size:11px;color:#555}' +
    '</style></head><body>' +
    '<h1>PanMaestro — Pedido comercial</h1>' +
    '<div class="sub">' + pmEsc(p.titulo || 'Pedido promocional') + '</div>' +
    '<div class="meta">' +
      '<div><b>Cliente</b>' + pmEsc(_prmCliNombre(p.cliente_id)) + '</div>' +
      '<div><b>Fecha de entrega</b>' + pmEsc(p.fecha_entrega || '') + '</div>' +
      '<div><b>Estado</b>' + pmEsc(PRM_ESTADO_LBL[p.estado]) + '</div>' +
    '</div>' +
    '<table><thead><tr>' +
      '<th>Producto</th><th>Peso g</th><th>Cant. entregada</th><th>PVP unidad</th><th>Valor venta</th>' +
      '<th>Descuento</th><th>Cobrar con descuento</th><th>Regalía cant.</th><th>Monto regalía</th><th>Neto a pagar</th>' +
    '</tr></thead><tbody>' + filas +
    '<tr class="tot"><td class="l">Totales</td><td></td><td></td><td></td><td>' + money(totPvp) + '</td><td></td><td>' + money(totPact) + '</td><td></td><td>' + money(totReg) + '</td><td>' + money(totNeto) + '</td></tr>' +
    '</tbody></table>' +
    '<div class="pago"><b>Neto a pagar: ₡' + money(totNeto) + '</b>' +
      (tel ? '<br>Pago por SINPE Móvil al <b>' + pmEsc(tel) + '</b>' : '') + '</div>' +
    (p.condiciones ? '<div class="cond"><b>Condiciones:</b> ' + pmEsc(p.condiciones) + '</div>' : '') +
    '<div class="firmas"><div>Entregado por</div><div>Recibido por</div></div>' +
    '</body></html>';

  const w = window.open('', '_blank');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err', 4000); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
}
