// costos_empaques.js — Módulo de Costos · Entrega 1: Maestro de Empaques
// Prefijo de función: cst (cstEmp = empaques, cstCla = clases, cstProd = asignación por producto)
//
// DISEÑO: independiente del núcleo de PanMaestro, mismo criterio que Mercadeo.
// - Lee productos_terminados (pmDB.productos.listar()) pero NUNCA escribe ahí
//   ni en recetas: el empaque es material directo del PRODUCTO (tipo de pan o
//   galleta), no de la receta.
// - Toda escritura propia va a 4 tablas cost_* (ver sql_costos_empaques.sql).
// - Usa solo los métodos GENÉRICOS de pmDB — no se tocó pm_db.js.
// - Estado propio (_cst*), nunca toca G ni pmSave(): son pantallas de
//   administración y esta data siempre vive en Supabase.
// - Todo se elige de un maestro (clase, empaque); códigos únicos validados al
//   crear y al editar; lo que tiene asignaciones se desactiva, no se borra.
// - Optimistic locking (updated_at + pmMostrarConflicto) al editar maestros.

let _cstClases = [];        // todas las clases (activas e inactivas)
let _cstEmpaques = [];      // todos los empaques (activos e inactivos)
let _cstPrecios = {};       // empaque_id -> [ {id, costo_estandar, vigente_desde} ] (más reciente primero)
let _cstProdEmp = {};       // producto_id -> [ {id, empaque_id, cantidad} ]
let _cstProductos = [];     // productos_terminados (pan + galleta)
let _cstProdCargado = false;
let _cstBase = {};          // 'tabla:id' -> updated_at al abrir la edición

// ── Utilidades ──────────────────────────────────────────────
// Moneda: hoy ₡ fijo. La entrega 2 (Configuración y moneda) lo hará configurable.
// Por defecto 2 decimales (totales). Los costos unitarios muy pequeños pasan
// max=4 para no perder precisión; así "70,01" nunca se confunde con 70.014.
function cstMoney(n, min, max) {
  const mn = min === undefined ? 2 : min;
  const mx = max === undefined ? mn : max;
  return '₡' + Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: mn, maximumFractionDigits: Math.max(mn, mx) });
}

function _cstVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function _cstPh(icono, texto) {
  return `<div class="ph"><span class="ph-icon">${icono}</span>${texto}</div>`;
}

function _cstErr(e) {
  const m = String((e && e.message) || e || '');
  if (/PGRST205|42P01|does not exist/i.test(m)) {
    return 'Faltan las tablas de empaques en Supabase — corré sql_costos_empaques.sql';
  }
  if (/duplicate key|23505/i.test(m)) return 'Ya existe un registro con ese código';
  return m;
}

function cstClaNombre(id) {
  const c = _cstClases.find(x => x.id === id);
  return c ? c.nombre : '—';
}

// Costo estándar vigente de un empaque: la fila más reciente con
// vigente_desde <= hoy (si todas son futuras, la más próxima).
function cstPrecioVigente(empId) {
  const lista = _cstPrecios[empId] || [];
  const hoy = pmHoy();
  const vig = lista.find(r => r.vigente_desde <= hoy) || lista[lista.length - 1];
  return vig ? Number(vig.costo_estandar) : 0;
}

// Chequeo de conflicto de edición (optimistic locking). Devuelve true si
// detectó conflicto y abrió el modal — el llamador debe parar de guardar.
async function _cstConflicto(tabla, id, etiqueta, onRecargar, onReintentar) {
  const base = _cstBase[tabla + ':' + id];
  if (!base) return false;
  try {
    const actual = await pmDB.getById(tabla, id);
    if (actual && actual.updated_at && actual.updated_at !== base) {
      pmMostrarConflicto(
        `${etiqueta} fue modificado en otro dispositivo o pestaña mientras lo editabas.`,
        onRecargar,
        () => { _cstBase[tabla + ':' + id] = actual.updated_at; onReintentar(); }
      );
      return true;
    }
  } catch (e) { console.warn('[cst conflicto]', e.message); }
  return false;
}

// ── Sub-navegación (pills) ──────────────────────────────────
function cstEmpTab(tab, btn) {
  ['emp', 'cla', 'prod'].forEach(t => {
    const el = document.getElementById('cstt-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#cst-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  if (tab === 'prod') cstProdCargar();
}

async function cstEmpInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstEmpCargarMaestros();
}

async function cstEmpCargarMaestros() {
  try {
    const [cla, emp, pre, rel] = await Promise.all([
      pmDB.get('cost_empaque_clases'),
      pmDB.get('cost_empaques'),
      pmDB.get('cost_empaque_precio'),
      pmDB.get('cost_producto_empaque'),
    ]);
    _cstClases = cla || [];
    _cstEmpaques = emp || [];
    _cstPrecios = {};
    (pre || []).forEach(r => {
      if (!_cstPrecios[r.empaque_id]) _cstPrecios[r.empaque_id] = [];
      _cstPrecios[r.empaque_id].push({ id: r.id, costo_estandar: r.costo_estandar, vigente_desde: r.vigente_desde });
    });
    Object.values(_cstPrecios).forEach(l => l.sort((a, b) => (b.vigente_desde || '').localeCompare(a.vigente_desde || '')));
    _cstProdEmp = {};
    (rel || []).forEach(r => {
      if (!_cstProdEmp[r.producto_id]) _cstProdEmp[r.producto_id] = [];
      _cstProdEmp[r.producto_id].push({ id: r.id, empaque_id: r.empaque_id, cantidad: Number(r.cantidad_por_unidad) });
    });
  } catch (e) {
    console.warn('[cstEmpCargarMaestros]', e.message);
    pmToast('⚠️ ' + _cstErr(e), 'err');
    return;
  }
  cstClaRender();
  cstClaLlenarSelects();
  cstEmpRender();
  cstEmpSugerirCodigo();
  if (_cstProdCargado) cstProdRender();
}

// Cuántos productos usan cada empaque (para avisos y conteos)
function _cstUsosEmpaque(empId) {
  let n = 0;
  Object.values(_cstProdEmp).forEach(lineas => { if (lineas.some(l => l.empaque_id === empId)) n++; });
  return n;
}

// ═══════════════════════════════════════════════════════════
// CLASES DE EMPAQUE
// ═══════════════════════════════════════════════════════════
function cstClaRender() {
  const el = document.getElementById('cstcla-list');
  if (!el) return;
  const lista = [..._cstClases].sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.codigo.localeCompare(b.codigo));
  document.getElementById('cstcla-count').textContent = `Clases de empaque (${lista.filter(c => c.activo !== false).length})`;
  el.innerHTML = lista.map(c => {
    const inactiva = c.activo === false;
    const usos = _cstEmpaques.filter(e => e.clase_id === c.id).length;
    return `
    <div class="item-row" id="cstcla-row-${c.id}" style="${inactiva ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:80px">${pmEsc(c.codigo)}</div>
      <div class="item-name">${pmEsc(c.nombre)}${inactiva ? ' <span style="font-size:10px;color:var(--red)">(inactiva)</span>' : ''}</div>
      <div class="item-meta">${usos} empaque${usos === 1 ? '' : 's'}</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstClaEdit('${c.id}')">✏️</button>
        <button class="btn ${inactiva ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstClaToggle('${c.id}')" title="${inactiva ? 'Reactivar' : 'Desactivar'}">${inactiva ? '↺' : '✕'}</button>
      </div>
    </div>`;
  }).join('') || _cstPh('🗂', 'Sin clases');
}

// Llena los <select> de clase (formulario de alta y filtro del listado)
function cstClaLlenarSelects() {
  const activas = _cstClases.filter(c => c.activo !== false).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const opts = activas.map(c => `<option value="${c.id}">${pmEsc(c.nombre)}</option>`).join('');
  const selAlta = document.getElementById('cstemp-clase');
  if (selAlta) {
    const actual = selAlta.value;
    selAlta.innerHTML = '<option value="">— Elegí una clase —</option>' + opts;
    if (actual && activas.some(c => c.id === actual)) selAlta.value = actual;
  }
  const selFiltro = document.getElementById('cstemp-filtro-clase');
  if (selFiltro) {
    const actual = selFiltro.value;
    selFiltro.innerHTML = '<option value="">Todas las clases</option>' +
      _cstClases.sort((a, b) => (a.orden || 0) - (b.orden || 0)).map(c => `<option value="${c.id}">${pmEsc(c.nombre)}</option>`).join('');
    if (actual) selFiltro.value = actual;
  }
}

async function cstClaAdd() {
  const codigo = _cstVal('cstcla-codigo').trim().toUpperCase().replace(/\s+/g, '_');
  const nombre = _cstVal('cstcla-nombre').trim();
  const orden  = parseInt(_cstVal('cstcla-orden')) || (_cstClases.length + 1);
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (_cstClases.some(c => c.codigo === codigo)) { pmToast(`Ya existe una clase con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.insert('cost_empaque_clases', { codigo, nombre, orden });
    ['cstcla-codigo', 'cstcla-nombre', 'cstcla-orden'].forEach(i => { document.getElementById(i).value = ''; });
    pmToast('Clase agregada ✓');
    await cstEmpCargarMaestros();
  } catch (e) {
    console.warn('[cstClaAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e), 'err');
  }
}

function cstClaEdit(id) {
  const c = _cstClases.find(x => x.id === id);
  const row = document.getElementById('cstcla-row-' + id);
  if (!c || !row) return;
  _cstBase['cost_empaque_clases:' + id] = c.updated_at;
  row.innerHTML = `
    <input type="text" id="cce-cod-${id}" value="${pmEsc(c.codigo)}" style="width:100px;font-family:'DM Mono',monospace;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px;text-transform:uppercase">
    <input type="text" id="cce-nom-${id}" value="${pmEsc(c.nombre)}" style="flex:1;min-width:120px;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px">
    <input type="number" id="cce-ord-${id}" value="${c.orden || 0}" style="width:60px;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px">
    <button class="btn btn-gold btn-xs" onclick="cstClaEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstClaRender()">✕</button>`;
}

async function cstClaEditSave(id) {
  const c = _cstClases.find(x => x.id === id);
  if (!c) return;
  const codigo = _cstVal('cce-cod-' + id).trim().toUpperCase().replace(/\s+/g, '_');
  const nombre = _cstVal('cce-nom-' + id).trim();
  const orden  = parseInt(_cstVal('cce-ord-' + id)) || 0;
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (_cstClases.some(x => x.codigo === codigo && x.id !== id)) { pmToast(`Ya existe otra clase con código ${codigo}`, 'err'); return; }
  if (await _cstConflicto('cost_empaque_clases', id, `La clase "${c.nombre}"`,
        () => cstEmpCargarMaestros(), () => cstClaEditSave(id))) return;
  try {
    await pmDB.update('cost_empaque_clases', id, { codigo, nombre, orden });
    pmToast('Clase actualizada ✓');
    await cstEmpCargarMaestros();
  } catch (e) {
    console.warn('[cstClaEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e), 'err');
  }
}

async function cstClaToggle(id) {
  const c = _cstClases.find(x => x.id === id);
  if (!c) return;
  const reactivar = c.activo === false;
  if (!reactivar && !confirm(`¿Desactivar la clase "${c.nombre}"? Los empaques que la tengan la conservan, pero deja de ofrecerse al crear empaques nuevos.`)) return;
  try {
    await pmDB.update('cost_empaque_clases', id, { activo: reactivar });
    pmToast(reactivar ? 'Clase reactivada ✓' : 'Clase desactivada');
    await cstEmpCargarMaestros();
  } catch (e) {
    console.warn('[cstClaToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// EMPAQUES
// ═══════════════════════════════════════════════════════════
// Propone el siguiente código libre de la serie EMP-001, EMP-002...
function _cstSiguienteCodigoEmp() {
  let max = 0;
  _cstEmpaques.forEach(e => {
    const m = /^EMP-(\d+)$/.exec(e.codigo || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'EMP-' + String(max + 1).padStart(3, '0');
}

function cstEmpSugerirCodigo() {
  const el = document.getElementById('cstemp-codigo');
  if (el && !el.value) el.value = _cstSiguienteCodigoEmp();
}

function cstEmpRender() {
  const el = document.getElementById('cstemp-list');
  if (!el) return;
  const q = _cstVal('cstemp-search').toLowerCase().trim();
  const fcl = _cstVal('cstemp-filtro-clase');
  let lista = [..._cstEmpaques];
  if (q) lista = lista.filter(e => (e.nombre || '').toLowerCase().includes(q) || (e.codigo || '').toLowerCase().includes(q));
  if (fcl) lista = lista.filter(e => e.clase_id === fcl);
  lista.sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  document.getElementById('cstemp-count').textContent = `Empaques (${lista.length})`;
  el.innerHTML = lista.map(e => {
    const inactivo = e.activo === false;
    const usos = _cstUsosEmpaque(e.id);
    return `
    <div class="item-row" id="cstemp-row-${e.id}" style="${inactivo ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:64px">${pmEsc(e.codigo)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-name">${pmEsc(e.nombre)}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactivo)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--cream2)">${pmEsc(cstClaNombre(e.clase_id))} · ${usos} producto${usos === 1 ? '' : 's'}</div>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--gold2);white-space:nowrap">${cstMoney(cstPrecioVigente(e.id), 2, 4)}</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstEmpEdit('${e.id}')">✏️</button>
        <button class="btn ${inactivo ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstEmpToggle('${e.id}')" title="${inactivo ? 'Reactivar' : 'Desactivar'}">${inactivo ? '↺' : '✕'}</button>
      </div>
    </div>`;
  }).join('') || _cstPh('📦', 'Sin empaques');
}

async function cstEmpAdd() {
  const codigo   = _cstVal('cstemp-codigo').trim().toUpperCase().replace(/\s+/g, '-');
  const nombre   = _cstVal('cstemp-nombre').trim();
  const clase_id = _cstVal('cstemp-clase');
  const costoTxt = _cstVal('cstemp-costo').trim();
  const costo    = parseFloat(costoTxt);
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (!clase_id) { pmToast('Elegí una clase', 'err'); return; }
  if (costoTxt === '' || isNaN(costo) || costo < 0) { pmToast('Ingresá el costo por unidad (0 o más)', 'err'); return; }
  if (_cstEmpaques.some(e => e.codigo === codigo)) { pmToast(`Ya existe un empaque con código ${codigo}`, 'err'); return; }
  try {
    const rows = await pmDB.insert('cost_empaques', { codigo, nombre, clase_id });
    const nuevo = rows && rows[0];
    if (nuevo) {
      try {
        await pmDB.insert('cost_empaque_precio', { empaque_id: nuevo.id, costo_estandar: costo, vigente_desde: pmHoy() });
      } catch (e2) {
        console.warn('[cstEmpAdd precio]', e2.message);
        pmToast('⚠️ El empaque se creó pero no se guardó su costo — editalo y guardalo de nuevo', 'err');
      }
    }
    ['cstemp-codigo', 'cstemp-nombre', 'cstemp-costo'].forEach(i => { document.getElementById(i).value = ''; });
    pmToast('Empaque agregado ✓');
    await cstEmpCargarMaestros();
  } catch (e) {
    console.warn('[cstEmpAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e), 'err');
  }
}

function cstEmpEdit(id) {
  const e = _cstEmpaques.find(x => x.id === id);
  const row = document.getElementById('cstemp-row-' + id);
  if (!e || !row) return;
  _cstBase['cost_empaques:' + id] = e.updated_at;
  const clases = _cstClases
    .filter(c => c.activo !== false || c.id === e.clase_id)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const opts = clases.map(c => `<option value="${c.id}" ${c.id === e.clase_id ? 'selected' : ''}>${pmEsc(c.nombre)}</option>`).join('');
  const st = 'padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px';
  row.style.opacity = '1';
  row.style.flexWrap = 'wrap';
  row.innerHTML = `
    <input type="text" id="cee-cod-${id}" value="${pmEsc(e.codigo)}" style="width:90px;font-family:'DM Mono',monospace;text-transform:uppercase;${st}">
    <input type="text" id="cee-nom-${id}" value="${pmEsc(e.nombre)}" style="flex:1;min-width:140px;${st}">
    <select id="cee-cla-${id}" style="width:130px;${st}">${opts}</select>
    <input type="number" id="cee-costo-${id}" value="${cstPrecioVigente(id)}" min="0" step="any" style="width:90px;${st}" title="Costo estándar por unidad">
    <button class="btn btn-gold btn-xs" onclick="cstEmpEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstEmpRender()">✕</button>`;
}

async function cstEmpEditSave(id) {
  const e = _cstEmpaques.find(x => x.id === id);
  if (!e) return;
  const codigo   = _cstVal('cee-cod-' + id).trim().toUpperCase().replace(/\s+/g, '-');
  const nombre   = _cstVal('cee-nom-' + id).trim();
  const clase_id = _cstVal('cee-cla-' + id);
  const costoTxt = _cstVal('cee-costo-' + id).trim();
  const costo    = parseFloat(costoTxt);
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (!clase_id) { pmToast('Elegí una clase', 'err'); return; }
  if (costoTxt === '' || isNaN(costo) || costo < 0) { pmToast('Ingresá el costo por unidad (0 o más)', 'err'); return; }
  if (_cstEmpaques.some(x => x.codigo === codigo && x.id !== id)) { pmToast(`Ya existe otro empaque con código ${codigo}`, 'err'); return; }
  if (await _cstConflicto('cost_empaques', id, `El empaque "${e.nombre}"`,
        () => cstEmpCargarMaestros(), () => cstEmpEditSave(id))) return;
  try {
    await pmDB.update('cost_empaques', id, { codigo, nombre, clase_id });
    // Costo estándar: si cambió, se registra con vigencia de hoy. Si ya había
    // una fila de hoy se corrige esa (unique empaque+fecha); si no, se agrega.
    if (costo !== cstPrecioVigente(id)) {
      const hoy = pmHoy();
      const filaHoy = (_cstPrecios[id] || []).find(r => r.vigente_desde === hoy);
      if (filaHoy) await pmDB.update('cost_empaque_precio', filaHoy.id, { costo_estandar: costo });
      else await pmDB.insert('cost_empaque_precio', { empaque_id: id, costo_estandar: costo, vigente_desde: hoy });
    }
    pmToast('Empaque actualizado ✓');
    await cstEmpCargarMaestros();
  } catch (err) {
    console.warn('[cstEmpEditSave]', err.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(err), 'err');
  }
}

async function cstEmpToggle(id) {
  const e = _cstEmpaques.find(x => x.id === id);
  if (!e) return;
  const reactivar = e.activo === false;
  if (!reactivar) {
    const usos = _cstUsosEmpaque(id);
    const aviso = usos
      ? `Lo usan ${usos} producto${usos === 1 ? '' : 's'}: seguirán mostrándolo, pero ya no se ofrecerá para asignarlo a otros.`
      : 'Deja de ofrecerse al asignar empaques.';
    if (!confirm(`¿Desactivar el empaque "${e.nombre}"? ${aviso}`)) return;
  }
  try {
    await pmDB.update('cost_empaques', id, { activo: reactivar });
    pmToast(reactivar ? 'Empaque reactivado ✓' : 'Empaque desactivado');
    await cstEmpCargarMaestros();
  } catch (err) {
    console.warn('[cstEmpToggle]', err.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(err), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// EMPAQUE POR PRODUCTO (tipo de pan o galleta)
// ═══════════════════════════════════════════════════════════
async function cstProdCargar() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  const el = document.getElementById('cstprod-list');
  if (!_cstProdCargado && el) el.innerHTML = _cstPh('⏳', 'Cargando...');
  try {
    const productos = await pmDB.productos.listar();
    _cstProductos = (productos || []).sort((a, b) =>
      (a.tipo || '').localeCompare(b.tipo || '') || (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    _cstProdCargado = true;
  } catch (e) {
    console.warn('[cstProdCargar]', e.message);
    if (el) el.innerHTML = _cstPh('⚠️', 'Error cargando productos — revisá la conexión');
    return;
  }
  cstProdRender();
}

function cstProdTotal(prodId) {
  return (_cstProdEmp[prodId] || []).reduce((s, l) => s + l.cantidad * cstPrecioVigente(l.empaque_id), 0);
}

function cstProdCardHtml(p) {
  const lineas = _cstProdEmp[p.id] || [];
  const usados = new Set(lineas.map(l => l.empaque_id));
  const opciones = _cstEmpaques
    .filter(e => e.activo !== false && !usados.has(e.id))
    .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''))
    .map(e => `<option value="${e.id}">${pmEsc(e.codigo)} · ${pmEsc(e.nombre)} (${pmEsc(cstClaNombre(e.clase_id))}) — ${cstMoney(cstPrecioVigente(e.id), 2, 4)}</option>`)
    .join('');
  const filas = lineas.map(l => {
    const e = _cstEmpaques.find(x => x.id === l.empaque_id);
    const nombre = e ? `${pmEsc(e.codigo)} · ${pmEsc(e.nombre)}` : '(empaque no encontrado)';
    const inactivo = e && e.activo === false;
    return `
      <div class="item-row" style="margin-bottom:3px">
        <div style="flex:1;min-width:0">
          <div class="item-name">${nombre}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactivo)</span>' : ''}</div>
          <div style="font-size:11px;color:var(--cream2)">${e ? pmEsc(cstClaNombre(e.clase_id)) + ' · ' + cstMoney(cstPrecioVigente(e.id), 2, 4) + ' c/u' : ''}</div>
        </div>
        <input type="number" value="${l.cantidad}" min="0.0001" step="any" style="width:70px;text-align:right"
          title="Cantidad por unidad vendida" onchange="cstProdSetCant('${l.id}','${p.id}',this.value)">
        <div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--gold2);min-width:70px;text-align:right">${cstMoney(l.cantidad * cstPrecioVigente(l.empaque_id))}</div>
        <button class="btn btn-red btn-xs" onclick="cstProdDel('${l.id}','${p.id}')">✕</button>
      </div>`;
  }).join('');
  const total = cstProdTotal(p.id);
  return `
  <div class="card" id="cstpe-card-${p.id}" style="margin-bottom:8px;padding:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
      <div>
        <span style="font-weight:600;color:var(--cream)">${pmEsc(p.nombre)}</span>
        <span style="font-size:10px;color:var(--cream2);margin-left:6px;text-transform:uppercase">${pmEsc(p.tipo || '')}</span>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3)">${pmEsc(p.codigo || '')}</span>
        <span style="font-size:12px;color:var(--cream2)">Empaque/ud: <b style="font-family:'DM Mono',monospace;color:${lineas.length ? 'var(--gold2)' : 'var(--red)'}">${lineas.length ? cstMoney(total) : 'sin empaque'}</b></span>
      </div>
    </div>
    ${filas}
    <div class="row" style="margin-top:6px">
      <div class="col" style="flex:3"><select id="cstpe-sel-${p.id}">
        <option value="">— Agregar empaque —</option>${opciones}
      </select></div>
      <div class="col xs"><input type="number" id="cstpe-qty-${p.id}" value="1" min="0.0001" step="any" title="Cantidad por unidad vendida"></div>
      <div class="col xs"><button class="btn btn-gold btn-xs" onclick="cstProdAdd('${p.id}')">+ Agregar</button></div>
    </div>
  </div>`;
}

function cstProdRender() {
  const el = document.getElementById('cstprod-list');
  if (!el) return;
  const q = _cstVal('cstprod-search').toLowerCase().trim();
  const solo = document.getElementById('cstprod-solo');
  let lista = _cstProductos;
  if (q) lista = lista.filter(p => (p.nombre || '').toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q));
  if (solo && solo.checked) lista = lista.filter(p => !(_cstProdEmp[p.id] || []).length);
  const sinEmp = _cstProductos.filter(p => !(_cstProdEmp[p.id] || []).length).length;
  document.getElementById('cstprod-count').textContent =
    `Productos (${lista.length}) · ${sinEmp} sin empaque`;
  el.innerHTML = lista.map(cstProdCardHtml).join('') || _cstPh('📦', 'Sin productos');
}

// Redibuja solo la tarjeta de un producto (no pierde el scroll ni los filtros)
function _cstProdRefrescarCard(prodId) {
  const p = _cstProductos.find(x => x.id === prodId);
  const card = document.getElementById('cstpe-card-' + prodId);
  if (p && card) card.outerHTML = cstProdCardHtml(p);
  const sinEmp = _cstProductos.filter(x => !(_cstProdEmp[x.id] || []).length).length;
  const cnt = document.getElementById('cstprod-count');
  if (cnt) cnt.textContent = cnt.textContent.replace(/\d+ sin empaque/, sinEmp + ' sin empaque');
}

async function cstProdAdd(prodId) {
  const empId = _cstVal('cstpe-sel-' + prodId);
  const cant = parseFloat(_cstVal('cstpe-qty-' + prodId));
  if (!empId) { pmToast('Elegí un empaque', 'err'); return; }
  if (isNaN(cant) || cant <= 0) { pmToast('La cantidad debe ser mayor que 0', 'err'); return; }
  if ((_cstProdEmp[prodId] || []).some(l => l.empaque_id === empId)) { pmToast('Ese empaque ya está en este producto', 'err'); return; }
  try {
    const rows = await pmDB.insert('cost_producto_empaque', { producto_id: prodId, empaque_id: empId, cantidad_por_unidad: cant });
    if (rows && rows[0]) {
      if (!_cstProdEmp[prodId]) _cstProdEmp[prodId] = [];
      _cstProdEmp[prodId].push({ id: rows[0].id, empaque_id: empId, cantidad: cant });
    }
    pmToast('Empaque agregado ✓');
    _cstProdRefrescarCard(prodId);
    cstEmpRender();
  } catch (e) {
    console.warn('[cstProdAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e), 'err');
  }
}

async function cstProdSetCant(lineaId, prodId, valor) {
  const cant = parseFloat(valor);
  const linea = (_cstProdEmp[prodId] || []).find(l => l.id === lineaId);
  if (!linea) return;
  if (isNaN(cant) || cant <= 0) {
    pmToast('La cantidad debe ser mayor que 0', 'err');
    _cstProdRefrescarCard(prodId);
    return;
  }
  try {
    await pmDB.update('cost_producto_empaque', lineaId, { cantidad_por_unidad: cant });
    linea.cantidad = cant;
    _cstProdRefrescarCard(prodId);
  } catch (e) {
    console.warn('[cstProdSetCant]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e), 'err');
    _cstProdRefrescarCard(prodId);
  }
}

async function cstProdDel(lineaId, prodId) {
  const lineas = _cstProdEmp[prodId] || [];
  const idx = lineas.findIndex(l => l.id === lineaId);
  if (idx < 0) return;
  try {
    await pmDB.hardDelete('cost_producto_empaque', lineaId);
    lineas.splice(idx, 1);
    pmToast('Empaque quitado');
    _cstProdRefrescarCard(prodId);
    cstEmpRender();
  } catch (e) {
    console.warn('[cstProdDel]', e.message);
    pmToast('⚠️ No se pudo quitar: ' + _cstErr(e), 'err');
  }
}
