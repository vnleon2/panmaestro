// costos_rutas.js — Módulo de Costos · Entrega 6: Etapas y rutas
// Prefijo cst (cstEta = maestro de etapas, cstRut = rutas por producto, cstRuta = cálculo)
// Depende de costos_core.js y costos_maestros.js (departamentos en memoria).
//
// DISEÑO: independiente del núcleo de PanMaestro. Tablas propias cost_etapas, cost_rutas y
// cost_ruta_etapas (sql_costos_rutas.sql). Lee productos_terminados pero NUNCA escribe ahí.
// - Etapa = una actividad de un departamento productivo (pesado, amasado, formado, horneado...).
// - Ruta = las etapas por las que pasa un producto (tipo de pan o galleta), con sus tiempos estándar.
// - Consumo por unidad de la etapa (minutos de reloj) = t_tanda ÷ q_tanda + t_unidad.
//   La unidad de cada etapa es kg de masa o pieza; se convierte con la masa por pieza
//   (la del producto, o la que se indique en la ruta porque la masa cruda pesa más que el pan).
// - Minutos-hombre = minutos de reloj × personas de la etapa (base de la tarifa MOD).
// - Aquí solo se capturan y suman tiempos. Los importes salen en la entrega 7, cuando el
//   motor multiplica estos consumos por las tarifas de cada departamento.

let _cstEtapas = [];        // maestro de etapas
let _cstRutas = [];         // rutas (una por producto)
let _cstRutaLin = {};       // ruta_id -> líneas ordenadas
let _cstRutProd = [];       // productos_terminados (pan + galleta)
let _cstRutAbiertas = {};   // producto_id -> true si la tarjeta está desplegada

const CST_UNIDADES_ETAPA = [
  { id: 'kg', nombre: 'Por kg de masa', corto: 'kg', plural: 'kg' },
  { id: 'pz', nombre: 'Por pieza', corto: 'pz', plural: 'piezas' },
];

// ── Utilidades ──────────────────────────────────────────────
function _cstUniNombre(u) { const x = CST_UNIDADES_ETAPA.find(r => r.id === u); return x ? x.nombre : u; }
function _cstMinTxt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 });
}
function _cstEtaNombre(id) { const e = _cstEtapas.find(x => x.id === id); return e ? e.nombre : ''; }
function _cstRutaDe(prodId) { return _cstRutas.find(r => r.producto_id === prodId) || null; }
function _cstRutaLineas(rutaId) { return _cstRutaLin[rutaId] || []; }
function _cstUsosEtapa(id) {
  let n = 0;
  Object.values(_cstRutaLin).forEach(ls => ls.forEach(l => { if (l.etapa_id === id) n++; }));
  return n;
}
function _cstDeptosProd(actualId) {
  return _cstDeps.filter(d => d.tipo === 'productivo' && (d.activo !== false || d.id === actualId))
    .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric: true }));
}

// ── Cálculo (puro) ──────────────────────────────────────────
// Masa por pieza en kg: la de la ruta, o el peso del producto
function cstMasaPiezaKg(prod, ruta) {
  const g = ruta && ruta.masa_pieza_g ? Number(ruta.masa_pieza_g) : Number(prod && prod.peso_g);
  return g > 0 ? g / 1000 : 0;
}

// Consumo estándar de una ruta. Devuelve por etapa y por departamento los minutos de reloj y
// los minutos-hombre por pieza y por kg de masa.
function cstRutaCalc(prod, ruta, lineas) {
  const kgPz = cstMasaPiezaKg(prod, ruta);
  const avisos = [];
  const filas = [];
  const porDepto = {};
  let parcial = false;
  lineas.forEach(l => {
    const et = _cstEtapas.find(x => x.id === l.etapa_id);
    const q = Number(l.q_tanda), tt = Number(l.t_tanda_min), tu = Number(l.t_unidad_min), pers = Number(l.personas);
    const minU = q > 0 ? tt / q + tu : 0;                  // por unidad de la etapa (kg o pieza)
    let minPz = null, minKg = null;
    if (l.unidad === 'pz') { minPz = minU; minKg = kgPz > 0 ? minU / kgPz : null; }
    else { minKg = minU; minPz = kgPz > 0 ? minU * kgPz : null; }
    if (minPz === null || minKg === null) parcial = true;
    const f = { lin: l, etapa: et || null, minU, minPz, minKg, hhPz: minPz === null ? null : minPz * pers, hhKg: minKg === null ? null : minKg * pers };
    filas.push(f);
    if (!(tt > 0) && !(tu > 0)) avisos.push(`${et ? et.nombre : 'Etapa'}: no tiene tiempos`);
    if (et && et.activo === false) avisos.push(`${et.nombre}: la etapa está inactiva`);
    const dId = et ? et.depto_id : '';
    if (!porDepto[dId]) porDepto[dId] = { minPz: 0, hhPz: 0, minKg: 0, hhKg: 0 };
    ['minPz', 'hhPz', 'minKg', 'hhKg'].forEach(k => { if (f[k] !== null) porDepto[dId][k] += f[k]; });
  });
  if (parcial) avisos.push('Falta la masa por pieza (el producto no tiene peso): no se pueden convertir kg a piezas ni al revés');
  const total = { minPz: 0, hhPz: 0, minKg: 0, hhKg: 0 };
  Object.values(porDepto).forEach(d => ['minPz', 'hhPz', 'minKg', 'hhKg'].forEach(k => { total[k] += d[k]; }));
  return { kgPz, filas, porDepto, total, avisos, parcial };
}

// ── Carga ───────────────────────────────────────────────────
async function cstRutInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  await cstRutCargar();
}

async function cstRutDatos() {
  await cstMaeDatos();
  const [eta, rut, lin, prods] = await Promise.all([
    pmDB.get('cost_etapas'),
    pmDB.get('cost_rutas'),
    pmDB.get('cost_ruta_etapas'),
    pmDB.productos.listar(),
  ]);
  _cstEtapas = (eta || []).sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  _cstRutas = (rut || []).map(r => Object.assign({}, r, { masa_pieza_g: r.masa_pieza_g === null ? null : Number(r.masa_pieza_g) }));
  _cstRutaLin = {};
  (lin || []).forEach(l => {
    const x = Object.assign({}, l, { orden: Number(l.orden), q_tanda: Number(l.q_tanda), t_tanda_min: Number(l.t_tanda_min), t_unidad_min: Number(l.t_unidad_min), personas: Number(l.personas) });
    (_cstRutaLin[x.ruta_id] = _cstRutaLin[x.ruta_id] || []).push(x);
  });
  Object.values(_cstRutaLin).forEach(ls => ls.sort((a, b) => a.orden - b.orden));
  _cstRutProd = (prods || []).sort((a, b) => (a.tipo || '').localeCompare(b.tipo || '') || (a.nombre || '').localeCompare(b.nombre || '', 'es'));
}

async function cstRutCargar() {
  try {
    await cstRutDatos();
  } catch (e) {
    console.warn('[cstRutCargar]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql y sql_costos_rutas.sql'), 'err');
    const el = document.getElementById('cstr-lista');
    if (el) el.innerHTML = _cstPh('⚠️', 'No se pudieron cargar las rutas — revisá la conexión y que el SQL esté corrido');
    return;
  }
  cstEtaRender();
  cstRutLlenarFiltros();
  cstRutRender();
  cstEtaSugerirCodigo();
}

function cstRutTab(tab, btn) {
  ['rut', 'eta'].forEach(t => {
    const el = document.getElementById('cstr-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#cstr-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
}

// ═══════════════════════════════════════════════════════════
// ETAPAS (maestro)
// ═══════════════════════════════════════════════════════════
function _cstSiguienteCodigoEta() {
  let max = 0;
  _cstEtapas.forEach(e => { const m = /^ETA-(\d+)$/.exec(e.codigo || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return 'ETA-' + (max + 10);
}

function cstEtaSugerirCodigo() {
  const el = document.getElementById('cstEta-codigo');
  if (el && !el.value) el.value = _cstSiguienteCodigoEta();
}

function cstEtaLlenarForm() {
  const d = document.getElementById('cstEta-depto');
  if (d) {
    const antes = d.value;
    d.innerHTML = '<option value="">— Departamento —</option>' + _cstOpts(_cstDeptosProd(''), antes, x => x.codigo + ' · ' + x.nombre);
  }
  const u = document.getElementById('cstEta-unidad');
  if (u && !u.options.length) u.innerHTML = CST_UNIDADES_ETAPA.map(x => `<option value="${x.id}">${pmEsc(x.nombre)}</option>`).join('');
}

function cstEtaRender() {
  const el = document.getElementById('cstEta-list');
  if (!el) return;
  cstEtaLlenarForm();
  const act = _cstEtapas.filter(e => e.activo !== false).length;
  const cnt = document.getElementById('cstEta-count');
  if (cnt) cnt.textContent = `Etapas (${act})`;
  el.innerHTML = _cstEtapas.map(e => {
    const inactivo = e.activo === false;
    const d = _cstDeps.find(x => x.id === e.depto_id);
    const usos = _cstUsosEtapa(e.id);
    return `
    <div class="item-row" id="cstEta-row-${e.id}" style="${inactivo ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:64px">${pmEsc(e.codigo)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-name">${pmEsc(e.nombre)}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactiva)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--cream2)">${d ? pmEsc(d.codigo + ' · ' + d.nombre) : '—'} · ${pmEsc(_cstUniNombre(e.unidad_defecto).toLowerCase())} · ${usos} ruta${usos === 1 ? '' : 's'}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstEtaEdit('${e.id}')">✏️</button>
        <button class="btn ${inactivo ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstEtaToggle('${e.id}')" title="${inactivo ? 'Reactivar' : 'Desactivar'}">${inactivo ? '↺' : '✕'}</button>
      </div>
    </div>`;
  }).join('') || _cstPh('🧭', 'Sin etapas');
}

async function cstEtaAdd() {
  const codigo = _cstNorm(_cstVal('cstEta-codigo'));
  const nombre = _cstVal('cstEta-nombre').trim();
  const depto = _cstVal('cstEta-depto');
  const unidad = _cstVal('cstEta-unidad') || 'pz';
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (!depto) { pmToast('Elegí el departamento donde se hace la etapa', 'err'); return; }
  if (_cstEtapas.some(e => e.codigo === codigo)) { pmToast(`Ya existe una etapa con código ${codigo}`, 'err'); return; }
  const orden = _cstEtapas.reduce((m, e) => Math.max(m, e.orden || 0), 0) + 10;
  try {
    await pmDB.insert('cost_etapas', { codigo, nombre, depto_id: depto, unidad_defecto: unidad, orden });
    document.getElementById('cstEta-codigo').value = '';
    document.getElementById('cstEta-nombre').value = '';
    pmToast('Etapa agregada ✓');
    await cstRutCargar();
  } catch (e) {
    console.warn('[cstEtaAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
  }
}

function cstEtaEdit(id) {
  const e = _cstEtapas.find(x => x.id === id);
  const row = document.getElementById('cstEta-row-' + id);
  if (!e || !row) return;
  _cstBase['cost_etapas:' + id] = e.updated_at;
  const dOpts = _cstOpts(_cstDeptosProd(e.depto_id), e.depto_id, d => d.codigo + ' · ' + d.nombre);
  const uOpts = CST_UNIDADES_ETAPA.map(u => `<option value="${u.id}" ${u.id === e.unidad_defecto ? 'selected' : ''}>${pmEsc(u.nombre)}</option>`).join('');
  row.style.opacity = '1';
  row.style.flexWrap = 'wrap';
  row.innerHTML = `
    <input type="text" id="ceta-cod-${id}" value="${pmEsc(e.codigo)}" style="width:90px;font-family:'DM Mono',monospace;text-transform:uppercase;${_CST_ST_EDIT}">
    <input type="text" id="ceta-nom-${id}" value="${pmEsc(e.nombre)}" style="flex:1;min-width:140px;${_CST_ST_EDIT}">
    <select id="ceta-dep-${id}" style="width:170px;${_CST_ST_EDIT}">${dOpts}</select>
    <select id="ceta-uni-${id}" style="width:130px;${_CST_ST_EDIT}">${uOpts}</select>
    <button class="btn btn-gold btn-xs" onclick="cstEtaEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstEtaRender()">✕</button>`;
}

async function cstEtaEditSave(id) {
  const e = _cstEtapas.find(x => x.id === id);
  if (!e) return;
  const codigo = _cstNorm(_cstVal('ceta-cod-' + id));
  const nombre = _cstVal('ceta-nom-' + id).trim();
  const depto = _cstVal('ceta-dep-' + id);
  const unidad = _cstVal('ceta-uni-' + id);
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (!depto) { pmToast('Elegí el departamento', 'err'); return; }
  if (_cstEtapas.some(x => x.codigo === codigo && x.id !== id)) { pmToast(`Ya existe otra etapa con código ${codigo}`, 'err'); return; }
  const usos = _cstUsosEtapa(id);
  if (depto !== e.depto_id && usos && !confirm(`"${e.nombre}" está en ${usos} ruta${usos === 1 ? '' : 's'}. Cambiarla de departamento mueve su consumo (y su costo) al nuevo departamento en todas ellas. ¿Continuar?`)) return;
  if (await _cstConflicto('cost_etapas', id, `La etapa "${e.nombre}"`, () => cstRutCargar(), () => cstEtaEditSave(id))) return;
  try {
    await pmDB.update('cost_etapas', id, { codigo, nombre, depto_id: depto, unidad_defecto: unidad });
    pmToast('Etapa actualizada ✓');
    await cstRutCargar();
  } catch (err) {
    console.warn('[cstEtaEditSave]', err.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(err, 'sql_costos_rutas.sql'), 'err');
  }
}

async function cstEtaToggle(id) {
  const e = _cstEtapas.find(x => x.id === id);
  if (!e) return;
  const reactivar = e.activo === false;
  if (!reactivar) {
    const usos = _cstUsosEtapa(id);
    const aviso = usos ? ` Está en ${usos} ruta${usos === 1 ? '' : 's'}: la conservan, pero deja de ofrecerse para rutas nuevas.` : ' Deja de ofrecerse al armar rutas.';
    if (!confirm(`¿Desactivar la etapa "${e.nombre}"?${aviso}`)) return;
  }
  try {
    await pmDB.update('cost_etapas', id, { activo: reactivar });
    pmToast(reactivar ? 'Etapa reactivada ✓' : 'Etapa desactivada');
    await cstRutCargar();
  } catch (err) {
    console.warn('[cstEtaToggle]', err.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(err, 'sql_costos_rutas.sql'), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// RUTAS POR PRODUCTO
// ═══════════════════════════════════════════════════════════
function cstRutLlenarFiltros() {
  const t = document.getElementById('cstr-tipo');
  if (t && !t.options.length) t.innerHTML = '<option value="">Todos</option><option value="pan">Panes</option><option value="galleta">Galletas</option>';
}

// Resumen de una ruta para el encabezado de la tarjeta
function _cstRutResumenTxt(p) {
  const ruta = _cstRutaDe(p.id);
  if (!ruta) return { txt: 'sin ruta', ok: false };
  const ls = _cstRutaLineas(ruta.id);
  if (!ls.length) return { txt: 'ruta vacía', ok: false };
  const c = cstRutaCalc(p, ruta, ls);
  return { txt: `${ls.length} etapa${ls.length === 1 ? '' : 's'} · ${_cstMinTxt(c.total.minPz)} min/pz`, ok: !c.avisos.length, avisos: c.avisos.length };
}

function cstRutRender() {
  const el = document.getElementById('cstr-lista');
  if (!el) return;
  const q = _cstVal('cstr-search').toLowerCase().trim();
  const tipo = _cstVal('cstr-tipo');
  const solo = document.getElementById('cstr-solo');
  let lista = _cstRutProd;
  if (tipo) lista = lista.filter(p => p.tipo === tipo);
  if (q) lista = lista.filter(p => (p.nombre || '').toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q));
  if (solo && solo.checked) lista = lista.filter(p => !(_cstRutaDe(p.id) && _cstRutaLineas(_cstRutaDe(p.id).id).length));
  // Estadísticas (sobre todos los productos)
  const conRuta = _cstRutProd.filter(p => { const r = _cstRutaDe(p.id); return r && _cstRutaLineas(r.id).length; });
  const conAviso = conRuta.filter(p => cstRutaCalc(p, _cstRutaDe(p.id), _cstRutaLineas(_cstRutaDe(p.id).id)).avisos.length);
  const stats = document.getElementById('cstr-stats');
  if (stats) {
    const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
    stats.innerHTML = stat('Productos', String(_cstRutProd.length), 'activos') +
      stat('Con ruta', String(conRuta.length), 'al menos una etapa') +
      stat('Sin ruta', String(_cstRutProd.length - conRuta.length), 'falta definirla') +
      stat('Con avisos', String(conAviso.length), conAviso.length ? 'revisar tiempos' : 'todo en orden');
  }
  el.innerHTML = lista.map(p => cstRutCardHtml(p)).join('') ||
    _cstPh('🧭', _cstRutProd.length ? 'Ningún producto coincide con el filtro' : 'No hay productos activos');
}

function cstRutCardHtml(p) {
  const abierta = !!_cstRutAbiertas[p.id];
  const r = _cstRutResumenTxt(p);
  const col = r.ok ? 'var(--gold2)' : 'var(--red)';
  return `
  <div class="card" id="cstr-card-${p.id}" style="margin-bottom:8px;padding:10px 12px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer" onclick="cstRutToggle('${p.id}')">
      <div style="min-width:0">
        <span style="font-weight:600;color:var(--cream)">${pmEsc(p.nombre)}</span>
        <span style="font-size:10px;color:var(--cream2);margin-left:6px;text-transform:uppercase">${pmEsc(p.tipo || '')}</span>
        <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);margin-left:6px">${pmEsc(p.codigo || '')}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span id="cstr-res-${p.id}" style="font-size:12px;font-family:'DM Mono',monospace;color:${col}">${pmEsc(r.txt)}${r.avisos ? ' ⚠' : ''}</span>
        <span style="color:var(--cream2);font-size:12px">${abierta ? '▾' : '▸'}</span>
      </div>
    </div>
    ${abierta ? `<div id="cstr-body-${p.id}" style="margin-top:10px">${cstRutCuerpoHtml(p)}</div>` : ''}
  </div>`;
}

function cstRutToggle(prodId) {
  _cstRutAbiertas[prodId] = !_cstRutAbiertas[prodId];
  cstRutRefrescarCard(prodId);
}

function cstRutRefrescarCard(prodId) {
  const p = _cstRutProd.find(x => x.id === prodId);
  const card = document.getElementById('cstr-card-' + prodId);
  if (!p || !card) return;
  card.outerHTML = cstRutCardHtml(p);
}

const _CST_ST_IN = 'padding:4px 8px;background:var(--sf);border:1px solid #CBD5E1;border-radius:6px;font-size:12px;text-align:right;font-family:\'DM Mono\',monospace;width:100%';
const _CST_ST_SEL = 'padding:4px 6px;background:var(--sf);border:1px solid #CBD5E1;border-radius:6px;font-size:12px;width:100%';
const _CST_ST_LBL = 'font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2);display:block;margin-bottom:2px';

function cstRutCuerpoHtml(p) {
  const ruta = _cstRutaDe(p.id);
  if (!ruta) {
    return `<div style="font-size:12px;color:var(--cream2);margin-bottom:8px">Este producto todavía no tiene ruta de elaboración.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <button class="btn btn-gold btn-sm" onclick="cstRutCrear('${p.id}')">+ Crear ruta</button>
        ${cstRutCopiarHtml(p, false)}
      </div>`;
  }
  const ls = _cstRutaLineas(ruta.id);
  const usadas = new Set(ls.map(l => l.etapa_id));
  const opciones = _cstEtapas.filter(e => e.activo !== false && !usadas.has(e.id))
    .map(e => `<option value="${e.id}">${pmEsc(e.codigo + ' · ' + e.nombre)}</option>`).join('');
  const peso = Number(p.peso_g) > 0 ? Number(p.peso_g) : 0;
  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div style="flex:0 1 190px"><span style="${_CST_ST_LBL}">Masa por pieza (g)</span>
        <input type="number" min="0" step="any" id="cstr-masa-${p.id}" value="${ruta.masa_pieza_g === null ? '' : ruta.masa_pieza_g}" placeholder="${peso || ''}" onchange="cstRutSetMasa('${p.id}', this.value)" style="${_CST_ST_IN}"></div>
      <div style="font-size:11px;color:var(--cream2);flex:1 1 200px">${peso ? `Vacío = peso del producto (${_cstMinTxt(peso)} g)` : '<span style="color:var(--red)">El producto no tiene peso: escribí aquí la masa por pieza</span>'}. La masa cruda pesa más que el pan horneado.</div>
    </div>
    <div id="cstr-lineas-${p.id}">${ls.map((l, i) => cstRutLineaHtml(p, ruta, l, i, ls.length)).join('') || '<div style="font-size:12px;color:var(--cream2);margin-bottom:6px">Ruta sin etapas: agregá la primera.</div>'}</div>
    <div class="row" style="margin-top:6px">
      <div class="col" style="flex:3"><select id="cstr-add-${p.id}"><option value="">— Agregar etapa —</option>${opciones}</select></div>
      <div class="col xs"><button class="btn btn-gold btn-xs" onclick="cstRutLinAdd('${p.id}')">+ Agregar</button></div>
    </div>
    <div id="cstr-sum-${p.id}">${cstRutResumenHtml(p)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid #E2E8F0">
      ${cstRutCopiarHtml(p, true)}
      <button class="btn btn-red btn-sm" onclick="cstRutEliminar('${p.id}')">🗑 Eliminar ruta</button>
    </div>`;
}

function cstRutCopiarHtml(p, tiene) {
  const otras = _cstRutProd.filter(x => x.id !== p.id && _cstRutaDe(x.id) && _cstRutaLineas(_cstRutaDe(x.id).id).length);
  if (!otras.length) return '';
  return `<div style="flex:1 1 240px;min-width:200px"><span style="${_CST_ST_LBL}">Copiar la ruta de otro producto</span>
      <div style="display:flex;gap:6px"><select id="cstr-cop-${p.id}" style="${_CST_ST_SEL}"><option value="">— Elegí el producto —</option>${otras.map(x => `<option value="${x.id}">${pmEsc(x.nombre)}</option>`).join('')}</select>
      <button class="btn btn-out btn-xs" onclick="cstRutCopiar('${p.id}')">Copiar</button></div></div>`;
}

// Línea (etapa) de una ruta
function cstRutLineaHtml(p, ruta, l, i, n) {
  const et = _cstEtapas.find(x => x.id === l.etapa_id);
  const d = et ? _cstDeps.find(x => x.id === et.depto_id) : null;
  const otras = new Set(_cstRutaLineas(ruta.id).filter(x => x.id !== l.id).map(x => x.etapa_id));
  const opts = _cstEtapas.filter(e => (e.activo !== false || e.id === l.etapa_id) && !otras.has(e.id))
    .map(e => `<option value="${e.id}" ${e.id === l.etapa_id ? 'selected' : ''}>${pmEsc(e.codigo + ' · ' + e.nombre)}</option>`).join('');
  const u = CST_UNIDADES_ETAPA.find(x => x.id === l.unidad) || CST_UNIDADES_ETAPA[1];
  const uOpts = CST_UNIDADES_ETAPA.map(x => `<option value="${x.id}" ${x.id === l.unidad ? 'selected' : ''}>${pmEsc(x.nombre)}</option>`).join('');
  const num = (campo, val, min) => `<input type="number" min="${min}" step="any" value="${val}" onchange="cstRutLinSet('${l.id}','${p.id}','${campo}',this.value)" style="${_CST_ST_IN}">`;
  return `
  <div class="card" id="cstr-lin-${l.id}" style="padding:8px 10px;margin-bottom:6px;background:var(--sf)">
    <div style="display:flex;gap:6px;align-items:center">
      <div style="display:flex;flex-direction:column;gap:2px">
        <button class="btn btn-out btn-xs" style="padding:0 6px;line-height:1.2" ${i === 0 ? 'disabled' : ''} onclick="cstRutLinMover('${l.id}','${p.id}',-1)">▲</button>
        <button class="btn btn-out btn-xs" style="padding:0 6px;line-height:1.2" ${i === n - 1 ? 'disabled' : ''} onclick="cstRutLinMover('${l.id}','${p.id}',1)">▼</button>
      </div>
      <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--cream2);min-width:18px">${i + 1}</span>
      <select style="${_CST_ST_SEL};flex:1" onchange="cstRutLinSet('${l.id}','${p.id}','etapa_id',this.value)">${opts}</select>
      <button class="btn btn-red btn-xs" onclick="cstRutLinDel('${l.id}','${p.id}')">✕</button>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:2px 0 6px 52px">${d ? pmEsc(d.codigo + ' · ' + d.nombre) : '—'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div style="flex:1 1 130px"><span style="${_CST_ST_LBL}">Se mide</span><select style="${_CST_ST_SEL}" onchange="cstRutLinSet('${l.id}','${p.id}','unidad',this.value)">${uOpts}</select></div>
      <div style="flex:1 1 90px"><span style="${_CST_ST_LBL}">Tanda (${u.corto})</span>${num('q_tanda', l.q_tanda, 0.0001)}</div>
      <div style="flex:1 1 90px"><span style="${_CST_ST_LBL}">T. tanda (min)</span>${num('t_tanda_min', l.t_tanda_min, 0)}</div>
      <div style="flex:1 1 90px"><span style="${_CST_ST_LBL}">T. por ${u.corto} (min)</span>${num('t_unidad_min', l.t_unidad_min, 0)}</div>
      <div style="flex:1 1 70px"><span style="${_CST_ST_LBL}">Personas</span>${num('personas', l.personas, 0.01)}</div>
    </div>
    <div id="cstr-lr-${l.id}" style="font-size:11px;font-family:'DM Mono',monospace;color:var(--gold2);margin-top:6px">${cstRutLineaResTxt(p, ruta, l)}</div>
  </div>`;
}

function cstRutLineaResTxt(p, ruta, l) {
  const c = cstRutaCalc(p, ruta, [l]).filas[0];
  return `→ ${_cstMinTxt(c.minPz)} min/pz · ${_cstMinTxt(c.hhPz)} min-HH/pz · ${_cstMinTxt(c.minKg)} min/kg`;
}

// Totales por departamento de una ruta
function cstRutResumenHtml(p) {
  const ruta = _cstRutaDe(p.id);
  if (!ruta) return '';
  const ls = _cstRutaLineas(ruta.id);
  if (!ls.length) return '';
  const c = cstRutaCalc(p, ruta, ls);
  const celda = 'padding:5px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
  const mono = ";text-align:right;font-family:'DM Mono',monospace";
  const filas = Object.keys(c.porDepto).map(id => ({ d: _cstDeps.find(x => x.id === id), v: c.porDepto[id] }))
    .sort((a, b) => ((a.d && a.d.codigo) || '').localeCompare((b.d && b.d.codigo) || '', 'es', { numeric: true }));
  return `
    <div style="margin-top:10px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--cream2)">Consumo estándar por departamento · masa por pieza ${c.kgPz ? _cstMinTxt(c.kgPz * 1000) + ' g' : '—'}</div>
    <div class="card" style="padding:0;overflow-x:auto;margin-top:4px">
      <table style="width:100%;border-collapse:collapse;min-width:420px">
        <thead><tr style="text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)">
          <th style="${celda}">Departamento</th><th style="${celda};text-align:right">Min/pieza</th><th style="${celda};text-align:right">Min-HH/pieza</th><th style="${celda};text-align:right">Min/kg</th>
        </tr></thead>
        <tbody>${filas.map(f => `<tr><td style="${celda}">${f.d ? pmEsc(f.d.codigo + ' · ' + f.d.nombre) : '—'}</td>
          <td style="${celda}${mono}">${_cstMinTxt(f.v.minPz)}</td><td style="${celda}${mono}">${_cstMinTxt(f.v.hhPz)}</td><td style="${celda}${mono}">${_cstMinTxt(f.v.minKg)}</td></tr>`).join('')}
          <tr><td style="${celda}"><b>Total</b></td><td style="${celda}${mono}"><b>${_cstMinTxt(c.total.minPz)}</b></td><td style="${celda}${mono}"><b>${_cstMinTxt(c.total.hhPz)}</b></td><td style="${celda}${mono}"><b>${_cstMinTxt(c.total.minKg)}</b></td></tr>
        </tbody>
      </table>
    </div>
    ${c.avisos.length ? `<div style="margin-top:6px">${c.avisos.map(a => `<div style="font-size:11px;color:var(--red)">⚠ ${pmEsc(a)}</div>`).join('')}</div>` : ''}`;
}

// Actualiza resultados sin repintar los campos que se están editando
function cstRutActualizar(prodId) {
  const p = _cstRutProd.find(x => x.id === prodId);
  const ruta = _cstRutaDe(prodId);
  if (!p || !ruta) return;
  _cstRutaLineas(ruta.id).forEach(l => {
    const el = document.getElementById('cstr-lr-' + l.id);
    if (el) el.innerHTML = cstRutLineaResTxt(p, ruta, l);
  });
  const sum = document.getElementById('cstr-sum-' + prodId);
  if (sum) sum.innerHTML = cstRutResumenHtml(p);
  const r = _cstRutResumenTxt(p);
  const h = document.getElementById('cstr-res-' + prodId);
  if (h) { h.textContent = r.txt + (r.avisos ? ' ⚠' : ''); h.style.color = r.ok ? 'var(--gold2)' : 'var(--red)'; }
  cstRutStatsActualizar();
}

function cstRutStatsActualizar() {
  const el = document.getElementById('cstr-stats');
  if (!el) return;
  const conRuta = _cstRutProd.filter(p => { const r = _cstRutaDe(p.id); return r && _cstRutaLineas(r.id).length; });
  const conAviso = conRuta.filter(p => cstRutaCalc(p, _cstRutaDe(p.id), _cstRutaLineas(_cstRutaDe(p.id).id)).avisos.length);
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  el.innerHTML = stat('Productos', String(_cstRutProd.length), 'activos') +
    stat('Con ruta', String(conRuta.length), 'al menos una etapa') +
    stat('Sin ruta', String(_cstRutProd.length - conRuta.length), 'falta definirla') +
    stat('Con avisos', String(conAviso.length), conAviso.length ? 'revisar tiempos' : 'todo en orden');
}

// ── Altas y ediciones ───────────────────────────────────────
async function cstRutCrear(prodId) {
  if (_cstRutaDe(prodId)) { cstRutRefrescarCard(prodId); return; }
  try {
    const rows = await pmDB.insert('cost_rutas', { producto_id: prodId });
    const nueva = (rows && rows[0]) || null;
    if (nueva) _cstRutas.push(Object.assign({ masa_pieza_g: null }, nueva));
    else await cstRutDatos();
    cstRutRefrescarCard(prodId);
    cstRutStatsActualizar();
  } catch (e) {
    console.warn('[cstRutCrear]', e.message);
    pmToast('⚠️ No se pudo crear la ruta: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
  }
}

async function cstRutSetMasa(prodId, valor) {
  const ruta = _cstRutaDe(prodId);
  if (!ruta) return;
  let g = null;
  if (valor !== '') {
    g = parseFloat(valor);
    if (isNaN(g) || g <= 0) { pmToast('La masa por pieza debe ser mayor que 0 (o dejala vacía)', 'err'); cstRutRefrescarCard(prodId); return; }
    g = cstRound(g, 2, 'normal');
  }
  try {
    await pmDB.update('cost_rutas', ruta.id, { masa_pieza_g: g });
    ruta.masa_pieza_g = g;
    cstRutActualizar(prodId);
  } catch (e) {
    console.warn('[cstRutSetMasa]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
    await cstRutCargar();
  }
}

async function cstRutLinAdd(prodId) {
  const ruta = _cstRutaDe(prodId);
  const etapaId = _cstVal('cstr-add-' + prodId);
  const et = _cstEtapas.find(e => e.id === etapaId);
  if (!ruta || !et) { pmToast('Elegí la etapa', 'err'); return; }
  const ls = _cstRutaLineas(ruta.id);
  if (ls.some(l => l.etapa_id === etapaId)) { pmToast('Esa etapa ya está en la ruta', 'err'); return; }
  const orden = ls.reduce((m, l) => Math.max(m, l.orden), 0) + 1;
  try {
    const rows = await pmDB.insert('cost_ruta_etapas', { ruta_id: ruta.id, etapa_id: etapaId, orden, unidad: et.unidad_defecto, q_tanda: 1, t_tanda_min: 0, t_unidad_min: 0, personas: 1 });
    const x = Object.assign({ orden, unidad: et.unidad_defecto, q_tanda: 1, t_tanda_min: 0, t_unidad_min: 0, personas: 1 }, (rows && rows[0]) || {});
    ['orden', 'q_tanda', 't_tanda_min', 't_unidad_min', 'personas'].forEach(k => { x[k] = Number(x[k]); });
    (_cstRutaLin[ruta.id] = _cstRutaLin[ruta.id] || []).push(x);
    cstRutRefrescarCard(prodId);
    cstRutStatsActualizar();
    cstEtaRender();
  } catch (e) {
    console.warn('[cstRutLinAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
  }
}

async function cstRutLinSet(linId, prodId, campo, valor) {
  const ruta = _cstRutaDe(prodId);
  const l = ruta ? _cstRutaLineas(ruta.id).find(x => x.id === linId) : null;
  if (!l) return;
  const cambios = {};
  if (campo === 'etapa_id') {
    if (!valor) { cstRutRefrescarCard(prodId); return; }
    if (_cstRutaLineas(ruta.id).some(x => x.id !== linId && x.etapa_id === valor)) { pmToast('Esa etapa ya está en la ruta', 'err'); cstRutRefrescarCard(prodId); return; }
    cambios.etapa_id = valor;
  } else if (campo === 'unidad') {
    if (!CST_UNIDADES_ETAPA.some(u => u.id === valor)) return;
    cambios.unidad = valor;
  } else {
    const n = parseFloat(valor);
    const min = (campo === 'q_tanda' || campo === 'personas') ? 0 : -1;
    if (valor === '' || isNaN(n) || n < 0 || (min === 0 && n <= 0)) {
      pmToast(min === 0 ? 'Ese valor debe ser mayor que 0' : 'Ingresá un tiempo de 0 o más', 'err');
      cstRutRefrescarCard(prodId); return;
    }
    cambios[campo] = cstRound(n, 4, 'normal');
  }
  try {
    await pmDB.update('cost_ruta_etapas', linId, cambios);
    Object.assign(l, cambios);
    if (campo === 'etapa_id' || campo === 'unidad') cstRutRefrescarCard(prodId); else cstRutActualizar(prodId);
    if (campo === 'etapa_id') cstEtaRender();
  } catch (e) {
    console.warn('[cstRutLinSet]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
    await cstRutCargar();
  }
}

async function cstRutLinMover(linId, prodId, dir) {
  const ruta = _cstRutaDe(prodId);
  if (!ruta) return;
  const ls = _cstRutaLineas(ruta.id);
  const i = ls.findIndex(x => x.id === linId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ls.length) return;
  const a = ls[i], b = ls[j];
  try {
    const oa = a.orden, ob = b.orden;
    await pmDB.update('cost_ruta_etapas', a.id, { orden: ob });
    await pmDB.update('cost_ruta_etapas', b.id, { orden: oa });
    a.orden = ob; b.orden = oa;
    ls.sort((x, y) => x.orden - y.orden);
    cstRutRefrescarCard(prodId);
  } catch (e) {
    console.warn('[cstRutLinMover]', e.message);
    pmToast('⚠️ No se pudo mover: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
    await cstRutCargar();
  }
}

async function cstRutLinDel(linId, prodId) {
  const ruta = _cstRutaDe(prodId);
  const l = ruta ? _cstRutaLineas(ruta.id).find(x => x.id === linId) : null;
  if (!l) return;
  if (!confirm(`¿Quitar la etapa "${_cstEtaNombre(l.etapa_id)}" de esta ruta?`)) return;
  try {
    await pmDB.hardDelete('cost_ruta_etapas', linId);
    _cstRutaLin[ruta.id] = _cstRutaLineas(ruta.id).filter(x => x.id !== linId);
    cstRutRefrescarCard(prodId);
    cstRutStatsActualizar();
    cstEtaRender();
  } catch (e) {
    console.warn('[cstRutLinDel]', e.message);
    pmToast('⚠️ No se pudo quitar: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
  }
}

// Copia masa por pieza y etapas de otro producto a este
async function cstRutCopiar(prodId) {
  const origenId = _cstVal('cstr-cop-' + prodId);
  const origen = _cstRutaDe(origenId);
  if (!origen) { pmToast('Elegí el producto del que querés copiar la ruta', 'err'); return; }
  const lineasOrigen = _cstRutaLineas(origen.id);
  if (!lineasOrigen.length) { pmToast('Ese producto no tiene etapas', 'err'); return; }
  const prod = _cstRutProd.find(x => x.id === prodId);
  const actual = _cstRutaDe(prodId);
  const nLin = actual ? _cstRutaLineas(actual.id).length : 0;
  if (nLin && !confirm(`"${prod ? prod.nombre : ''}" ya tiene ${nLin} etapa${nLin === 1 ? '' : 's'}. Se reemplazan por las ${lineasOrigen.length} de la ruta copiada. ¿Continuar?`)) return;
  try {
    let ruta = actual;
    if (!ruta) {
      await pmDB.insert('cost_rutas', { producto_id: prodId, masa_pieza_g: null });
      await cstRutDatos();
      ruta = _cstRutaDe(prodId);
    }
    if (!ruta) throw new Error('No se pudo crear la ruta');
    for (const l of _cstRutaLineas(ruta.id)) await pmDB.hardDelete('cost_ruta_etapas', l.id);
    await pmDB.insert('cost_ruta_etapas', lineasOrigen.map(l => ({
      ruta_id: ruta.id, etapa_id: l.etapa_id, orden: l.orden, unidad: l.unidad, q_tanda: l.q_tanda,
      t_tanda_min: l.t_tanda_min, t_unidad_min: l.t_unidad_min, personas: l.personas,
    })), false);
    await pmDB.update('cost_rutas', ruta.id, { masa_pieza_g: null });
    await cstRutDatos();
    _cstRutAbiertas[prodId] = true;
    cstEtaRender();
    cstRutRender();
    pmToast('Ruta copiada ✓ — revisá los tiempos y la masa por pieza');
  } catch (e) {
    console.warn('[cstRutCopiar]', e.message);
    pmToast('⚠️ No se pudo copiar: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
    await cstRutCargar();
  }
}

async function cstRutEliminar(prodId) {
  const ruta = _cstRutaDe(prodId);
  const p = _cstRutProd.find(x => x.id === prodId);
  if (!ruta) return;
  const n = _cstRutaLineas(ruta.id).length;
  if (!confirm(`¿Eliminar la ruta de "${p ? p.nombre : ''}"${n ? ` y sus ${n} etapa${n === 1 ? '' : 's'}` : ''}? No se puede deshacer.`)) return;
  try {
    await pmDB.hardDelete('cost_rutas', ruta.id);
    _cstRutas = _cstRutas.filter(r => r.id !== ruta.id);
    delete _cstRutaLin[ruta.id];
    cstRutRefrescarCard(prodId);
    cstRutStatsActualizar();
    cstEtaRender();
    pmToast('Ruta eliminada');
  } catch (e) {
    console.warn('[cstRutEliminar]', e.message);
    pmToast('⚠️ No se pudo eliminar: ' + _cstErr(e, 'sql_costos_rutas.sql'), 'err');
  }
}
