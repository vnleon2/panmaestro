// costos_maestros.js — Módulo de Costos · Entrega 3: Departamentos y cuentas
// Prefijo cst (cstMae = pantalla, cstDep = departamentos, cstCue = cuentas, cstDrv = bases/drivers)
// Depende de costos_core.js (utilidades, formato, optimistic locking).
//
// DISEÑO: independiente del núcleo de PanMaestro. Tres tablas propias
// (cost_departamentos, cost_drivers, cost_cuentas — ver sql_costos_maestros.sql),
// solo métodos genéricos de pmDB. Todo se elige de un maestro; códigos únicos
// validados al crear y al editar; lo que tiene uso se desactiva, no se borra.
//
// Departamento = centro de costo. Su tipo define el tratamiento del personal:
//   productivo → MOD · apoyo → MOI (se reparte a los productivos) ·
//   venta / mercadeo / administración → gasto del período (capa 2).
// Cuenta: serie = primer dígito del código (4 laboral, 5 fabril, 6 venta,
//   7 mercadeo, 8 administrativos). % variable: fijo 0 · variable 100 · mixto 1–99.
// Driver: base con que se reparte una cuenta o se absorbe un costo (HH, m², kWh...).

const CST_TIPOS_DEP = [
  { id: 'productivo',     nombre: 'Productivo',     nota: 'Personal MOD · absorbe costo en las etapas' },
  { id: 'apoyo',          nombre: 'Apoyo',          nota: 'Personal MOI · se reparte a los productivos' },
  { id: 'venta',          nombre: 'Venta',          nota: 'Gasto del período (capa 2)' },
  { id: 'mercadeo',       nombre: 'Mercadeo',       nota: 'Gasto del período (capa 2)' },
  { id: 'administracion', nombre: 'Administración', nota: 'Gasto del período · no se reparte' },
];
const CST_SERIES = [
  { id: 4, nombre: 'Costo laboral' },
  { id: 5, nombre: 'Carga fabril' },
  { id: 6, nombre: 'Venta' },
  { id: 7, nombre: 'Mercadeo' },
  { id: 8, nombre: 'Administrativos y otros fijos' },
];
const CST_COMPORTAMIENTOS = [
  { id: 'fijo',     nombre: 'Fijo' },
  { id: 'variable', nombre: 'Variable' },
  { id: 'mixto',    nombre: 'Mixto' },
];

let _cstDeps = [];      // departamentos (activos e inactivos)
let _cstCuentas = [];   // cuentas
let _cstDrivers = [];   // drivers / bases

const _CST_ST_EDIT = 'padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px';

// ── Auxiliares ──────────────────────────────────────────────
function _cstNorm(codigo) { return String(codigo || '').trim().toUpperCase().replace(/\s+/g, '-'); }

function _cstTipoDep(id) { return CST_TIPOS_DEP.find(t => t.id === id) || { id, nombre: id || '—', nota: '' }; }
function _cstSerieNombre(s) { const x = CST_SERIES.find(r => r.id === Number(s)); return x ? x.nombre : 'Serie ' + s; }
function _cstCompNombre(id) { const x = CST_COMPORTAMIENTOS.find(r => r.id === id); return x ? x.nombre : id; }
function _cstDepNombre(id) { const d = _cstDeps.find(x => x.id === id); return d ? d.nombre : ''; }
function _cstDrvNombre(id) { const d = _cstDrivers.find(x => x.id === id); return d ? d.nombre : ''; }

// <option>s de un maestro: solo activos, más el valor actual aunque esté inactivo
function _cstOpts(lista, actualId, textoFn) {
  return lista
    .filter(x => x.activo !== false || x.id === actualId)
    .map(x => `<option value="${x.id}" ${x.id === actualId ? 'selected' : ''}>${pmEsc(textoFn(x))}</option>`)
    .join('');
}

// ── Pantalla: pills, carga ──────────────────────────────────
function cstMaeTab(tab, btn) {
  ['dep', 'cue', 'drv'].forEach(t => {
    const el = document.getElementById('cstm-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#cstm-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
}

async function cstMaeInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstMaeCargar();
}

async function cstMaeCargar() {
  try {
    const [dep, cue, drv] = await Promise.all([
      pmDB.get('cost_departamentos'),
      pmDB.get('cost_cuentas'),
      pmDB.get('cost_drivers'),
    ]);
    _cstDeps = dep || [];
    _cstCuentas = (cue || []).map(c => Object.assign({}, c, { pct_variable: Number(c.pct_variable) }));
    _cstDrivers = drv || [];
  } catch (e) {
    console.warn('[cstMaeCargar]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
    return;
  }
  cstDepRender();
  cstDrvRender();
  cstCueLlenarSelects();
  cstCueRender();
  cstDepSugerirCodigo();
  cstCueSugerirCodigo();
}

// ═══════════════════════════════════════════════════════════
// DEPARTAMENTOS
// ═══════════════════════════════════════════════════════════
function _cstUsosDepto(id) { return _cstCuentas.filter(c => c.depto_defecto_id === id && c.activo !== false).length; }

function _cstSiguienteCodigoDep() {
  let max = 0;
  _cstDeps.forEach(d => { const m = /^DEP-(\d+)$/.exec(d.codigo || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return 'DEP-' + (max + 10);
}

function cstDepSugerirCodigo() {
  const el = document.getElementById('cstdep-codigo');
  if (el && !el.value) el.value = _cstSiguienteCodigoDep();
}

function cstDepRender() {
  const el = document.getElementById('cstdep-list');
  if (!el) return;
  const sel = document.getElementById('cstdep-tipo');
  if (sel && !sel.options.length) sel.innerHTML = CST_TIPOS_DEP.map(t => `<option value="${t.id}">${pmEsc(t.nombre)}</option>`).join('');
  const lista = [..._cstDeps].sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric: true }));
  document.getElementById('cstdep-count').textContent = `Departamentos (${lista.filter(d => d.activo !== false).length})`;
  el.innerHTML = lista.map(d => {
    const inactivo = d.activo === false;
    const t = _cstTipoDep(d.tipo);
    const usos = _cstUsosDepto(d.id);
    return `
    <div class="item-row" id="cstdep-row-${d.id}" style="${inactivo ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:64px">${pmEsc(d.codigo)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-name">${pmEsc(d.nombre)}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactivo)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--cream2)">${pmEsc(t.nombre)} · ${pmEsc(t.nota)} · ${usos} cuenta${usos === 1 ? '' : 's'} por defecto</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstDepEdit('${d.id}')">✏️</button>
        <button class="btn ${inactivo ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstDepToggle('${d.id}')" title="${inactivo ? 'Reactivar' : 'Desactivar'}">${inactivo ? '↺' : '✕'}</button>
      </div>
    </div>`;
  }).join('') || _cstPh('🏭', 'Sin departamentos');
}

async function cstDepAdd() {
  const codigo = _cstNorm(_cstVal('cstdep-codigo'));
  const nombre = _cstVal('cstdep-nombre').trim();
  const tipo = _cstVal('cstdep-tipo');
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (!CST_TIPOS_DEP.some(t => t.id === tipo)) { pmToast('Elegí el tipo de departamento', 'err'); return; }
  if (_cstDeps.some(d => d.codigo === codigo)) { pmToast(`Ya existe un departamento con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.insert('cost_departamentos', { codigo, nombre, tipo });
    document.getElementById('cstdep-codigo').value = '';
    document.getElementById('cstdep-nombre').value = '';
    pmToast('Departamento agregado ✓');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstDepAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

function cstDepEdit(id) {
  const d = _cstDeps.find(x => x.id === id);
  const row = document.getElementById('cstdep-row-' + id);
  if (!d || !row) return;
  _cstBase['cost_departamentos:' + id] = d.updated_at;
  const opts = CST_TIPOS_DEP.map(t => `<option value="${t.id}" ${t.id === d.tipo ? 'selected' : ''}>${pmEsc(t.nombre)}</option>`).join('');
  row.style.opacity = '1';
  row.style.flexWrap = 'wrap';
  row.innerHTML = `
    <input type="text" id="cde-cod-${id}" value="${pmEsc(d.codigo)}" style="width:90px;font-family:'DM Mono',monospace;text-transform:uppercase;${_CST_ST_EDIT}">
    <input type="text" id="cde-nom-${id}" value="${pmEsc(d.nombre)}" style="flex:1;min-width:140px;${_CST_ST_EDIT}">
    <select id="cde-tipo-${id}" style="width:140px;${_CST_ST_EDIT}">${opts}</select>
    <button class="btn btn-gold btn-xs" onclick="cstDepEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstDepRender()">✕</button>`;
}

async function cstDepEditSave(id) {
  const d = _cstDeps.find(x => x.id === id);
  if (!d) return;
  const codigo = _cstNorm(_cstVal('cde-cod-' + id));
  const nombre = _cstVal('cde-nom-' + id).trim();
  const tipo = _cstVal('cde-tipo-' + id);
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (!CST_TIPOS_DEP.some(t => t.id === tipo)) { pmToast('Elegí el tipo de departamento', 'err'); return; }
  if (_cstDeps.some(x => x.codigo === codigo && x.id !== id)) { pmToast(`Ya existe otro departamento con código ${codigo}`, 'err'); return; }
  if (tipo !== d.tipo && !confirm(`Cambiar el tipo de "${d.nombre}" de ${_cstTipoDep(d.tipo).nombre} a ${_cstTipoDep(tipo).nombre} cambia el tratamiento de su personal (MOD, MOI o gasto del período). ¿Continuar?`)) return;
  if (await _cstConflicto('cost_departamentos', id, `El departamento "${d.nombre}"`,
        () => cstMaeCargar(), () => cstDepEditSave(id))) return;
  try {
    await pmDB.update('cost_departamentos', id, { codigo, nombre, tipo });
    pmToast('Departamento actualizado ✓');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstDepEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

async function cstDepToggle(id) {
  const d = _cstDeps.find(x => x.id === id);
  if (!d) return;
  const reactivar = d.activo === false;
  if (!reactivar) {
    const usos = _cstUsosDepto(id);
    const aviso = usos ? ` Es el departamento por defecto de ${usos} cuenta${usos === 1 ? '' : 's'}: la conservan, pero deja de ofrecerse al elegir.` : ' Deja de ofrecerse al elegir departamento.';
    if (!confirm(`¿Desactivar el departamento "${d.nombre}"?${aviso}`)) return;
  }
  try {
    await pmDB.update('cost_departamentos', id, { activo: reactivar });
    pmToast(reactivar ? 'Departamento reactivado ✓' : 'Departamento desactivado');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstDepToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// DRIVERS (bases de reparto y absorción)
// ═══════════════════════════════════════════════════════════
function _cstUsosDriver(id) { return _cstCuentas.filter(c => c.base_reparto_id === id && c.activo !== false).length; }

function cstDrvRender() {
  const el = document.getElementById('cstdrv-list');
  if (!el) return;
  const lista = [..._cstDrivers].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  document.getElementById('cstdrv-count').textContent = `Bases de reparto (${lista.filter(d => d.activo !== false).length})`;
  el.innerHTML = lista.map(d => {
    const inactivo = d.activo === false;
    const usos = _cstUsosDriver(d.id);
    return `
    <div class="item-row" id="cstdrv-row-${d.id}" style="${inactivo ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:96px">${pmEsc(d.codigo)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-name">${pmEsc(d.nombre)}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactiva)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--cream2)">${d.unidad ? 'Unidad: ' + pmEsc(d.unidad) + ' · ' : ''}${usos} cuenta${usos === 1 ? '' : 's'}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstDrvEdit('${d.id}')">✏️</button>
        <button class="btn ${inactivo ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstDrvToggle('${d.id}')" title="${inactivo ? 'Reactivar' : 'Desactivar'}">${inactivo ? '↺' : '✕'}</button>
      </div>
    </div>`;
  }).join('') || _cstPh('📐', 'Sin bases de reparto');
}

async function cstDrvAdd() {
  const codigo = _cstNorm(_cstVal('cstdrv-codigo')).replace(/-/g, '_');
  const nombre = _cstVal('cstdrv-nombre').trim();
  const unidad = _cstVal('cstdrv-unidad').trim();
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (_cstDrivers.some(d => d.codigo === codigo)) { pmToast(`Ya existe una base con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.insert('cost_drivers', { codigo, nombre, unidad });
    ['cstdrv-codigo', 'cstdrv-nombre', 'cstdrv-unidad'].forEach(i => { document.getElementById(i).value = ''; });
    pmToast('Base agregada ✓');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstDrvAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

function cstDrvEdit(id) {
  const d = _cstDrivers.find(x => x.id === id);
  const row = document.getElementById('cstdrv-row-' + id);
  if (!d || !row) return;
  _cstBase['cost_drivers:' + id] = d.updated_at;
  row.style.opacity = '1';
  row.style.flexWrap = 'wrap';
  row.innerHTML = `
    <input type="text" id="cdv-cod-${id}" value="${pmEsc(d.codigo)}" style="width:120px;font-family:'DM Mono',monospace;text-transform:uppercase;${_CST_ST_EDIT}">
    <input type="text" id="cdv-nom-${id}" value="${pmEsc(d.nombre)}" style="flex:1;min-width:140px;${_CST_ST_EDIT}">
    <input type="text" id="cdv-uni-${id}" value="${pmEsc(d.unidad || '')}" placeholder="unidad" style="width:70px;${_CST_ST_EDIT}">
    <button class="btn btn-gold btn-xs" onclick="cstDrvEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstDrvRender()">✕</button>`;
}

async function cstDrvEditSave(id) {
  const d = _cstDrivers.find(x => x.id === id);
  if (!d) return;
  const codigo = _cstNorm(_cstVal('cdv-cod-' + id)).replace(/-/g, '_');
  const nombre = _cstVal('cdv-nom-' + id).trim();
  const unidad = _cstVal('cdv-uni-' + id).trim();
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (_cstDrivers.some(x => x.codigo === codigo && x.id !== id)) { pmToast(`Ya existe otra base con código ${codigo}`, 'err'); return; }
  if (await _cstConflicto('cost_drivers', id, `La base "${d.nombre}"`,
        () => cstMaeCargar(), () => cstDrvEditSave(id))) return;
  try {
    await pmDB.update('cost_drivers', id, { codigo, nombre, unidad });
    pmToast('Base actualizada ✓');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstDrvEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

async function cstDrvToggle(id) {
  const d = _cstDrivers.find(x => x.id === id);
  if (!d) return;
  const reactivar = d.activo === false;
  if (!reactivar) {
    const usos = _cstUsosDriver(id);
    const aviso = usos ? ` La usan ${usos} cuenta${usos === 1 ? '' : 's'}: la conservan, pero deja de ofrecerse al elegir.` : ' Deja de ofrecerse al elegir.';
    if (!confirm(`¿Desactivar la base "${d.nombre}"?${aviso}`)) return;
  }
  try {
    await pmDB.update('cost_drivers', id, { activo: reactivar });
    pmToast(reactivar ? 'Base reactivada ✓' : 'Base desactivada');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstDrvToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// CUENTAS
// ═══════════════════════════════════════════════════════════
// Gancho para las entregas 4 y 5: cuando haya nómina y gastos cargados contra
// una cuenta, aquí se cuentan sus movimientos para avisar antes de desactivar.
function _cstMovimientosCuenta(/* cuentaId */) { return 0; }

// Siguiente código libre de la serie: x101, x102... (cuenta también las inactivas)
function _cstSiguienteCodigoCuenta(serie) {
  const s = Number(serie);
  if (!(s >= 4 && s <= 8)) return '';
  let max = s * 1000 + 100;
  _cstCuentas.forEach(c => {
    if (Number(c.serie) === s) { const n = parseInt(c.codigo, 10); if (n > max) max = n; }
  });
  return max + 1 <= s * 1000 + 999 ? String(max + 1) : '';
}

function cstCueSugerirCodigo() {
  const el = document.getElementById('cstcue-codigo');
  if (el && !el.value) el.value = _cstSiguienteCodigoCuenta(_cstVal('cstcue-serie'));
}

// Al cambiar la serie en el alta, se propone el siguiente código de esa serie
function cstCueSerieChange() {
  const el = document.getElementById('cstcue-codigo');
  if (el) el.value = _cstSiguienteCodigoCuenta(_cstVal('cstcue-serie'));
}

// % variable según el comportamiento: fijo 0, variable 100, mixto editable (1–99)
function cstCuePctSync(compId, pctId) {
  const comp = _cstVal(compId);
  const pct = document.getElementById(pctId);
  if (!pct) return;
  if (comp === 'fijo') { pct.value = '0'; pct.disabled = true; }
  else if (comp === 'variable') { pct.value = '100'; pct.disabled = true; }
  else {
    pct.disabled = false;
    const v = parseFloat(pct.value);
    if (!(v > 0 && v < 100)) pct.value = '50';
  }
}

function cstCueLlenarSelects() {
  const selSerie = document.getElementById('cstcue-serie');
  if (selSerie) {
    const actual = selSerie.value;
    selSerie.innerHTML = CST_SERIES.map(s => `<option value="${s.id}">${s.id} · ${pmEsc(s.nombre)}</option>`).join('');
    selSerie.value = actual || '5';
  }
  const selComp = document.getElementById('cstcue-comp');
  if (selComp && !selComp.options.length) {
    selComp.innerHTML = CST_COMPORTAMIENTOS.map(c => `<option value="${c.id}">${pmEsc(c.nombre)}</option>`).join('');
    selComp.value = 'fijo';
    cstCuePctSync('cstcue-comp', 'cstcue-pct');
  }
  const selBase = document.getElementById('cstcue-base');
  if (selBase) {
    const actual = selBase.value;
    selBase.innerHTML = '<option value="">— Elegí la base —</option>' + _cstOpts(_cstDrivers, actual, d => d.nombre);
    if (actual && _cstDrivers.some(d => d.id === actual && d.activo !== false)) selBase.value = actual;
  }
  const selDep = document.getElementById('cstcue-depto');
  if (selDep) {
    const actual = selDep.value;
    selDep.innerHTML = '<option value="">— Compartida —</option>' + _cstOpts(_cstDeps, actual, d => d.codigo + ' · ' + d.nombre);
    if (actual && _cstDeps.some(d => d.id === actual && d.activo !== false)) selDep.value = actual;
  }
  const selF = document.getElementById('cstcue-filtro-serie');
  if (selF) {
    const actual = selF.value;
    selF.innerHTML = '<option value="">Todas las series</option>' + CST_SERIES.map(s => `<option value="${s.id}">${s.id} · ${pmEsc(s.nombre)}</option>`).join('');
    if (actual) selF.value = actual;
  }
}

function cstCueRender() {
  const el = document.getElementById('cstcue-list');
  if (!el) return;
  const q = _cstVal('cstcue-search').toLowerCase().trim();
  const fs = _cstVal('cstcue-filtro-serie');
  let lista = [..._cstCuentas];
  if (q) lista = lista.filter(c => (c.nombre || '').toLowerCase().includes(q) || (c.codigo || '').includes(q));
  if (fs) lista = lista.filter(c => String(c.serie) === fs);
  lista.sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  document.getElementById('cstcue-count').textContent = `Cuentas (${lista.filter(c => c.activo !== false).length} activas de ${lista.length})`;
  let html = '';
  let serieActual = null;
  lista.forEach(c => {
    if (Number(c.serie) !== serieActual) {
      serieActual = Number(c.serie);
      html += `<div style="margin:14px 0 4px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)">Serie ${serieActual} · ${pmEsc(_cstSerieNombre(serieActual))}</div>`;
    }
    const inactiva = c.activo === false;
    const comp = c.comportamiento === 'mixto' ? `Mixto ${c.pct_variable}% var.` : _cstCompNombre(c.comportamiento);
    const base = _cstDrvNombre(c.base_reparto_id);
    const dep = _cstDepNombre(c.depto_defecto_id);
    html += `
    <div class="item-row" id="cstcue-row-${c.id}" style="${inactiva ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--gold3);min-width:44px">${pmEsc(c.codigo)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-name">${pmEsc(c.nombre)}${inactiva ? ' <span style="font-size:10px;color:var(--red)">(inactiva)</span>' : ''}${c.es_sistema ? '' : ' <span style="font-size:10px;color:var(--gold2)">propia</span>'}</div>
        <div style="font-size:11px;color:var(--cream2)">${pmEsc(comp)} · ${base ? 'Base: ' + pmEsc(base) : 'sin base'} · ${dep ? pmEsc(dep) : 'compartida'}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstCueEdit('${c.id}')">✏️</button>
        <button class="btn ${inactiva ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstCueToggle('${c.id}')" title="${inactiva ? 'Reactivar' : 'Desactivar'}">${inactiva ? '↺' : '✕'}</button>
      </div>
    </div>`;
  });
  el.innerHTML = html || _cstPh('📒', 'Sin cuentas');
}

// Valida y arma los datos de una cuenta. `leer(k)` devuelve el valor del campo k
// (codigo, nombre, comp, pct, base, depto) del formulario de alta o de la fila en edición.
// Devuelve { datos } o { error }.
function _cstCueLeer(leer, idActual, serieSel) {
  const codigo = String(leer('codigo') || '').trim();
  const nombre = String(leer('nombre') || '').trim();
  const comp = leer('comp');
  const base = leer('base');
  const depto = leer('depto');
  if (!/^[4-8]\d{3}$/.test(codigo)) return { error: 'El código de cuenta tiene 4 dígitos y empieza con su serie (4 a 8)' };
  if (serieSel && String(serieSel) !== codigo[0]) return { error: `Una cuenta de la serie ${serieSel} debe tener un código que empiece con ${serieSel}` };
  if (!nombre) return { error: 'Escribí el nombre de la cuenta' };
  if (_cstCuentas.some(c => c.codigo === codigo && c.id !== idActual)) return { error: `Ya existe la cuenta ${codigo}` };
  if (!CST_COMPORTAMIENTOS.some(c => c.id === comp)) return { error: 'Elegí el comportamiento (fijo, variable o mixto)' };
  let pct;
  if (comp === 'fijo') pct = 0;
  else if (comp === 'variable') pct = 100;
  else {
    pct = parseFloat(leer('pct'));
    if (!(pct > 0 && pct < 100)) return { error: 'Una cuenta mixta lleva un % variable entre 1 y 99' };
  }
  if (!base || !_cstDrivers.some(d => d.id === base)) return { error: 'Elegí la base de reparto (usá "Directo" si no se reparte)' };
  if (depto && !_cstDeps.some(d => d.id === depto)) return { error: 'Departamento no válido' };
  return { datos: {
    codigo, nombre, serie: Number(codigo[0]), comportamiento: comp, pct_variable: pct,
    base_reparto_id: base, depto_defecto_id: depto || null,
  } };
}

async function cstCueAdd() {
  const r = _cstCueLeer(k => _cstVal('cstcue-' + k), null, _cstVal('cstcue-serie'));
  if (r.error) { pmToast(r.error, 'err'); return; }
  try {
    await pmDB.insert('cost_cuentas', r.datos);
    // Se limpia todo el formulario para que nada se herede por accidente a la cuenta siguiente
    ['cstcue-codigo', 'cstcue-nombre', 'cstcue-base', 'cstcue-depto'].forEach(i => { document.getElementById(i).value = ''; });
    document.getElementById('cstcue-comp').value = 'fijo';
    cstCuePctSync('cstcue-comp', 'cstcue-pct');
    pmToast('Cuenta agregada ✓');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstCueAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

function cstCueEdit(id) {
  const c = _cstCuentas.find(x => x.id === id);
  const row = document.getElementById('cstcue-row-' + id);
  if (!c || !row) return;
  _cstBase['cost_cuentas:' + id] = c.updated_at;
  const optsComp = CST_COMPORTAMIENTOS.map(x => `<option value="${x.id}" ${x.id === c.comportamiento ? 'selected' : ''}>${pmEsc(x.nombre)}</option>`).join('');
  const optsBase = '<option value="">— Base —</option>' + _cstOpts(_cstDrivers, c.base_reparto_id, d => d.nombre);
  const optsDep = '<option value="">Compartida</option>' + _cstOpts(_cstDeps, c.depto_defecto_id, d => d.codigo + ' · ' + d.nombre);
  const pre = 'cce-';
  const pid = k => pre + k + '-' + id;
  row.style.opacity = '1';
  row.style.flexWrap = 'wrap';
  row.innerHTML = `
    <input type="text" id="${pid('codigo')}" value="${pmEsc(c.codigo)}" maxlength="4" style="width:64px;font-family:'DM Mono',monospace;${_CST_ST_EDIT}">
    <input type="text" id="${pid('nombre')}" value="${pmEsc(c.nombre)}" style="flex:1;min-width:160px;${_CST_ST_EDIT}">
    <select id="${pid('comp')}" onchange="cstCuePctSync('${pid('comp')}','${pid('pct')}')" style="width:100px;${_CST_ST_EDIT}">${optsComp}</select>
    <input type="number" id="${pid('pct')}" value="${c.pct_variable}" min="1" max="99" step="any" style="width:64px;${_CST_ST_EDIT}" title="% variable" ${c.comportamiento === 'mixto' ? '' : 'disabled'}>
    <select id="${pid('base')}" style="width:150px;${_CST_ST_EDIT}">${optsBase}</select>
    <select id="${pid('depto')}" style="width:170px;${_CST_ST_EDIT}">${optsDep}</select>
    <button class="btn btn-gold btn-xs" onclick="cstCueEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstCueRender()">✕</button>`;
}

async function cstCueEditSave(id) {
  const c = _cstCuentas.find(x => x.id === id);
  if (!c) return;
  const r = _cstCueLeer(k => _cstVal('cce-' + k + '-' + id), id, null);
  if (r.error) { pmToast(r.error, 'err'); return; }
  if (await _cstConflicto('cost_cuentas', id, `La cuenta ${c.codigo}`,
        () => cstMaeCargar(), () => cstCueEditSave(id))) return;
  try {
    await pmDB.update('cost_cuentas', id, r.datos);
    pmToast('Cuenta actualizada ✓');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstCueEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}

async function cstCueToggle(id) {
  const c = _cstCuentas.find(x => x.id === id);
  if (!c) return;
  const reactivar = c.activo === false;
  if (!reactivar) {
    const mov = _cstMovimientosCuenta(id);
    const aviso = mov
      ? ` Tiene ${mov} movimiento${mov === 1 ? '' : 's'} cargado${mov === 1 ? '' : 's'}: se conservan en el historial, pero la cuenta deja de ofrecerse para cargas nuevas.`
      : ' Deja de ofrecerse al cargar gastos; el historial no se toca.';
    if (!confirm(`¿Desactivar la cuenta ${c.codigo} "${c.nombre}"?${aviso}`)) return;
  }
  try {
    await pmDB.update('cost_cuentas', id, { activo: reactivar });
    pmToast(reactivar ? 'Cuenta reactivada ✓' : 'Cuenta desactivada');
    await cstMaeCargar();
  } catch (e) {
    console.warn('[cstCueToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
  }
}
