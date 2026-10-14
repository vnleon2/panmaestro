// costos_personal.js — Módulo de Costos · Entrega 4: Personal
// Prefijo cst (cstPers = pantalla, cstCar = cargos, cstNom = conceptos de nómina, cstCol = colaboradores)
// Depende de costos_core.js y costos_maestros.js (departamentos y cuentas en memoria).
//
// DISEÑO: independiente del núcleo de PanMaestro; tablas propias cost_cargos,
// cost_colaboradores, cost_colab_depto, cost_conceptos_nomina (sql_costos_personal.sql).
// - El departamento define si una persona es MOD (productivo), MOI (apoyo) o
//   gasto del período (venta, mercadeo, administración).
// - Costo cargado mensual = suma de los conceptos de nómina activos sobre el sueldo base
//   (porcentajes del sueldo + montos fijos).
// - HH productivas = horas pagadas × % de utilización del cargo × % de tiempo en el departamento.
// - Una persona puede repartir su tiempo entre departamentos (debe sumar 100 %).
// - Lo que tiene historial se desactiva, no se borra.

let _cstCargos = [];       // cargos
let _cstColabs = [];       // colaboradores
let _cstColabDep = {};     // colaborador_id -> [ {id, depto_id, pct} ]
let _cstConceptos = [];    // conceptos de nómina
let _cstColAbiertos = {};  // colaborador_id -> true si la tarjeta está desplegada
let _cstColRep = {};       // colaborador_id -> filas del editor de reparto [ {depto_id, pct} ]

const CST_TRATAMIENTOS = {
  MOD:   { nombre: 'MOD',   largo: 'Mano de obra directa' },
  MOI:   { nombre: 'MOI',   largo: 'Mano de obra indirecta' },
  GASTO: { nombre: 'Gasto del período', largo: 'Venta, mercadeo o administración' },
};

// ── Reglas de negocio (puras, las usa también Costo laboral) ──
// Tratamiento del costo de una persona según el tipo de su departamento
function cstTratamiento(tipoDep) {
  if (tipoDep === 'productivo') return 'MOD';
  if (tipoDep === 'apoyo') return 'MOI';
  return 'GASTO';
}

// Etiqueta corta para mostrar
function _cstTratLabel(t) { return t === 'GASTO' ? 'Gasto' : t; }

function cstConceptosActivos() {
  return _cstConceptos.filter(c => c.activo !== false).sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.codigo.localeCompare(b.codigo));
}

// Monto mensual de un concepto para un colaborador
function cstMontoConcepto(colab, c) {
  return c.tipo === 'pct' ? Number(colab.sueldo_base) * Number(c.valor) / 100 : Number(c.valor);
}

// Costo cargado mensual: { total, lineas:[{concepto, monto}] }
function cstCostoCargado(colab) {
  const lineas = cstConceptosActivos().map(c => ({ concepto: c, monto: cstMontoConcepto(colab, c) }));
  return { total: lineas.reduce((a, l) => a + l.monto, 0), lineas };
}

function cstRepartoDe(colabId) { return _cstColabDep[colabId] || []; }
function cstRepartoSuma(colabId) { return cstRepartoDe(colabId).reduce((a, r) => a + Number(r.pct), 0); }
function _cstRepartoOk(colabId) { return Math.abs(cstRepartoSuma(colabId) - 100) < 0.005; }

// Participación (%) de una persona en cada tratamiento: { MOD, MOI, GASTO }
function cstTratamientoDe(colabId) {
  const r = { MOD: 0, MOI: 0, GASTO: 0 };
  cstRepartoDe(colabId).forEach(x => {
    const d = _cstDeps.find(y => y.id === x.depto_id);
    r[cstTratamiento(d ? d.tipo : '')] += Number(x.pct);
  });
  return r;
}

// HH productivas por mes de un colaborador en un departamento (solo productivos)
function cstHHDepto(colab, fila) {
  const d = _cstDeps.find(y => y.id === fila.depto_id);
  if (!d || d.tipo !== 'productivo') return 0;
  const car = _cstCargos.find(c => c.id === colab.cargo_id);
  const util = car ? Number(car.pct_utilizacion) : 0;
  return Number(colab.horas_mes) * util / 100 * Number(fila.pct) / 100;
}

function _cstFmtPct(n) { return Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 }) + ' %'; }

// ── Carga y pantalla ────────────────────────────────────────
// Carga todo lo de personal en memoria sin pintar (la usa también Costo laboral). Lanza error si falla.
async function cstPersonalDatos() {
  await cstMaeDatos();
  const [car, col, rep, con] = await Promise.all([
    pmDB.get('cost_cargos'),
    pmDB.get('cost_colaboradores'),
    pmDB.get('cost_colab_depto'),
    pmDB.get('cost_conceptos_nomina'),
  ]);
  _cstCargos = (car || []).map(c => Object.assign({}, c, { pct_utilizacion: Number(c.pct_utilizacion) }));
  _cstColabs = (col || []).map(c => Object.assign({}, c, { sueldo_base: Number(c.sueldo_base), horas_mes: Number(c.horas_mes) }));
  _cstConceptos = (con || []).map(c => Object.assign({}, c, { valor: Number(c.valor) }));
  _cstColabDep = {};
  (rep || []).forEach(r => {
    if (!_cstColabDep[r.colaborador_id]) _cstColabDep[r.colaborador_id] = [];
    _cstColabDep[r.colaborador_id].push({ id: r.id, depto_id: r.depto_id, pct: Number(r.pct_tiempo) });
  });
}

function cstPersTab(tab, btn) {
  ['col', 'car', 'nom'].forEach(t => {
    const el = document.getElementById('cstp-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#cstp-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
}

async function cstPersInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  await cstPersRecargar();
}

async function cstPersRecargar() {
  try {
    await cstPersonalDatos();
  } catch (e) {
    console.warn('[cstPersRecargar]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql y sql_costos_personal.sql'), 'err');
    return;
  }
  cstPersLlenarSelects();
  cstCarRender();
  cstNomRender();
  cstColRender();
  cstCarSugerirCodigo();
  cstNomSugerirCodigo();
  cstColSugerirCodigo();
}

function cstPersLlenarSelects() {
  const keep = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const fill = (id, html, prev) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = html;
    if (prev && Array.from(el.options).some(o => o.value === prev)) el.value = prev;
  };
  fill('cstcar-depto', '<option value="">— Elegí el departamento —</option>' + _cstOpts(_cstDeps, '', d => d.codigo + ' · ' + d.nombre), keep('cstcar-depto'));
  fill('cstcol-cargo', '<option value="">— Elegí el cargo —</option>' + _cstOpts(_cstCargos, '', c => c.codigo + ' · ' + c.nombre), keep('cstcol-cargo'));
  const cuentasLab = _cstCuentas.filter(c => Number(c.serie) === 4);
  fill('cstnom-cuenta', '<option value="">— Elegí la cuenta —</option>' + _cstOpts(cuentasLab, '', c => c.codigo + ' · ' + c.nombre), keep('cstnom-cuenta'));
  const tipo = document.getElementById('cstnom-tipo');
  if (tipo && !tipo.options.length) {
    tipo.innerHTML = '<option value="pct">% del sueldo base</option><option value="monto">Monto fijo por mes</option>';
  }
}

// ═══════════════════════════════════════════════════════════
// CARGOS
// ═══════════════════════════════════════════════════════════
function _cstColsDeCargo(id) { return _cstColabs.filter(c => c.cargo_id === id && c.activo !== false).length; }

function _cstSiguienteCodigo(prefijo, lista, ancho) {
  let max = 0;
  const re = new RegExp('^' + prefijo + '-(\\d+)$');
  lista.forEach(x => { const m = re.exec(x.codigo || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return prefijo + '-' + String(max + 1).padStart(ancho, '0');
}

function cstCarSugerirCodigo() {
  const el = document.getElementById('cstcar-codigo');
  if (el && !el.value) el.value = _cstSiguienteCodigo('CAR', _cstCargos, 2);
}

function cstCarRender() {
  const el = document.getElementById('cstcar-list');
  if (!el) return;
  const lista = [..._cstCargos].sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric: true }));
  document.getElementById('cstcar-count').textContent = `Cargos (${lista.filter(c => c.activo !== false).length})`;
  el.innerHTML = lista.map(c => {
    const inactivo = c.activo === false;
    const dep = _cstDeps.find(d => d.id === c.depto_id);
    const n = _cstColsDeCargo(c.id);
    return `
    <div class="item-row" id="cstcar-row-${c.id}" style="${inactivo ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:64px">${pmEsc(c.codigo)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-name">${pmEsc(c.nombre)}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactivo)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--cream2)">${dep ? pmEsc(dep.nombre) + ' · ' + _cstTratLabel(cstTratamiento(dep.tipo)) : '—'} · utilización ${_cstFmtPct(c.pct_utilizacion)} · ${n} persona${n === 1 ? '' : 's'}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstCarEdit('${c.id}')">✏️</button>
        <button class="btn ${inactivo ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstCarToggle('${c.id}')" title="${inactivo ? 'Reactivar' : 'Desactivar'}">${inactivo ? '↺' : '✕'}</button>
      </div>
    </div>`;
  }).join('') || _cstPh('🧑‍🍳', 'Sin cargos todavía — creá el primero arriba');
}

function _cstLeerCargo(leer, idActual) {
  const codigo = _cstNorm(leer('codigo'));
  const nombre = String(leer('nombre') || '').trim();
  const depto = leer('depto');
  const util = parseFloat(leer('util'));
  if (!codigo || !nombre) return { error: 'Completá código y nombre' };
  if (_cstCargos.some(c => c.codigo === codigo && c.id !== idActual)) return { error: `Ya existe un cargo con código ${codigo}` };
  if (!depto || !_cstDeps.some(d => d.id === depto)) return { error: 'Elegí el departamento del cargo' };
  if (!(util > 0 && util <= 100)) return { error: 'La utilización va entre 1 y 100 %' };
  return { datos: { codigo, nombre, depto_id: depto, pct_utilizacion: util } };
}

async function cstCarAdd() {
  const r = _cstLeerCargo(k => _cstVal('cstcar-' + k), null);
  if (r.error) { pmToast(r.error, 'err'); return; }
  try {
    await pmDB.insert('cost_cargos', r.datos);
    ['cstcar-codigo', 'cstcar-nombre'].forEach(i => { document.getElementById(i).value = ''; });
    document.getElementById('cstcar-depto').value = '';
    pmToast('Cargo agregado ✓');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstCarAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

function cstCarEdit(id) {
  const c = _cstCargos.find(x => x.id === id);
  const row = document.getElementById('cstcar-row-' + id);
  if (!c || !row) return;
  _cstBase['cost_cargos:' + id] = c.updated_at;
  const opts = _cstOpts(_cstDeps, c.depto_id, d => d.codigo + ' · ' + d.nombre);
  row.style.opacity = '1';
  row.style.flexWrap = 'wrap';
  row.innerHTML = `
    <input type="text" id="cca-codigo-${id}" value="${pmEsc(c.codigo)}" style="width:90px;font-family:'DM Mono',monospace;text-transform:uppercase;${_CST_ST_EDIT}">
    <input type="text" id="cca-nombre-${id}" value="${pmEsc(c.nombre)}" style="flex:1;min-width:140px;${_CST_ST_EDIT}">
    <select id="cca-depto-${id}" style="width:190px;${_CST_ST_EDIT}">${opts}</select>
    <input type="number" id="cca-util-${id}" value="${c.pct_utilizacion}" min="1" max="100" step="any" style="width:72px;${_CST_ST_EDIT}" title="% de utilización">
    <button class="btn btn-gold btn-xs" onclick="cstCarEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstCarRender()">✕</button>`;
}

async function cstCarEditSave(id) {
  const c = _cstCargos.find(x => x.id === id);
  if (!c) return;
  const r = _cstLeerCargo(k => _cstVal('cca-' + k + '-' + id), id);
  if (r.error) { pmToast(r.error, 'err'); return; }
  const cambioDepto = r.datos.depto_id !== c.depto_id;
  // Quienes tienen este cargo y todo su tiempo en el departamento viejo se mueven al nuevo
  const aMover = cambioDepto
    ? _cstColabs.filter(x => x.cargo_id === id).filter(x => {
        const rep = cstRepartoDe(x.id);
        return rep.length === 1 && rep[0].depto_id === c.depto_id && Math.abs(rep[0].pct - 100) < 0.005;
      })
    : [];
  if (cambioDepto && aMover.length &&
      !confirm(`Cambiar el departamento del cargo "${c.nombre}" también mueve a ${aMover.length} persona${aMover.length === 1 ? '' : 's'} que tienen todo su tiempo en el departamento anterior. ¿Continuar?`)) return;
  if (await _cstConflicto('cost_cargos', id, `El cargo "${c.nombre}"`,
        () => cstPersRecargar(), () => cstCarEditSave(id))) return;
  try {
    await pmDB.update('cost_cargos', id, r.datos);
    for (const x of aMover) await pmDB.update('cost_colab_depto', cstRepartoDe(x.id)[0].id, { depto_id: r.datos.depto_id });
    pmToast('Cargo actualizado ✓');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstCarEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

async function cstCarToggle(id) {
  const c = _cstCargos.find(x => x.id === id);
  if (!c) return;
  const reactivar = c.activo === false;
  if (!reactivar) {
    const n = _cstColsDeCargo(id);
    const aviso = n ? ` Lo tienen ${n} persona${n === 1 ? '' : 's'} activa${n === 1 ? '' : 's'}: lo conservan, pero deja de ofrecerse para personas nuevas.` : ' Deja de ofrecerse para personas nuevas.';
    if (!confirm(`¿Desactivar el cargo "${c.nombre}"?${aviso}`)) return;
  }
  try {
    await pmDB.update('cost_cargos', id, { activo: reactivar });
    pmToast(reactivar ? 'Cargo reactivado ✓' : 'Cargo desactivado');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstCarToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// CONCEPTOS DE NÓMINA
// ═══════════════════════════════════════════════════════════
function cstNomSugerirCodigo() {
  const el = document.getElementById('cstnom-codigo');
  if (el && !el.value) el.value = _cstSiguienteCodigo('NOM', _cstConceptos, 2);
}

function _cstNomValorTxt(c) {
  return c.tipo === 'pct' ? `${_cstFmtPct(c.valor)} del sueldo` : `${cstMoney(c.valor)} por mes`;
}

function cstNomRender() {
  const el = document.getElementById('cstnom-list');
  if (!el) return;
  const lista = [..._cstConceptos].sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.codigo.localeCompare(b.codigo));
  document.getElementById('cstnom-count').textContent = `Conceptos de nómina (${lista.filter(c => c.activo !== false).length})`;
  el.innerHTML = lista.map(c => {
    const inactivo = c.activo === false;
    const cu = _cstCuentas.find(x => x.id === c.cuenta_id);
    return `
    <div class="item-row" id="cstnom-row-${c.id}" style="${inactivo ? 'opacity:.55' : ''}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:64px">${pmEsc(c.codigo)}</div>
      <div style="flex:1;min-width:0">
        <div class="item-name">${pmEsc(c.nombre)}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactivo)</span>' : ''}${c.es_sistema ? '' : ' <span style="font-size:10px;color:var(--gold2)">propio</span>'}</div>
        <div style="font-size:11px;color:var(--cream2)">${pmEsc(_cstNomValorTxt(c))} · cuenta ${cu ? pmEsc(cu.codigo) : '—'}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstNomEdit('${c.id}')">✏️</button>
        <button class="btn ${inactivo ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstNomToggle('${c.id}')" title="${inactivo ? 'Reactivar' : 'Desactivar'}">${inactivo ? '↺' : '✕'}</button>
      </div>
    </div>`;
  }).join('') || _cstPh('🧾', 'Sin conceptos de nómina');
}

function _cstLeerConcepto(leer, idActual) {
  const codigo = _cstNorm(leer('codigo'));
  const nombre = String(leer('nombre') || '').trim();
  const tipo = leer('tipo');
  const valorTxt = String(leer('valor') || '').trim();
  const valor = parseFloat(valorTxt);
  const cuenta = leer('cuenta');
  if (!codigo || !nombre) return { error: 'Completá código y nombre' };
  if (_cstConceptos.some(c => c.codigo === codigo && c.id !== idActual)) return { error: `Ya existe un concepto con código ${codigo}` };
  if (tipo !== 'pct' && tipo !== 'monto') return { error: 'Elegí si es un % del sueldo o un monto fijo' };
  if (valorTxt === '' || isNaN(valor) || valor < 0) return { error: 'Ingresá el valor (0 o más)' };
  if (tipo === 'pct' && valor > 1000) return { error: 'Un porcentaje mayor a 1000 % no parece correcto' };
  if (!cuenta || !_cstCuentas.some(c => c.id === cuenta && Number(c.serie) === 4)) return { error: 'Elegí una cuenta de costo laboral (serie 4)' };
  return { datos: { codigo, nombre, tipo, valor, cuenta_id: cuenta } };
}

async function cstNomAdd() {
  const r = _cstLeerConcepto(k => _cstVal('cstnom-' + k), null);
  if (r.error) { pmToast(r.error, 'err'); return; }
  r.datos.orden = _cstConceptos.reduce((m, c) => Math.max(m, c.orden || 0), 0) + 1;
  try {
    await pmDB.insert('cost_conceptos_nomina', r.datos);
    ['cstnom-codigo', 'cstnom-nombre', 'cstnom-valor'].forEach(i => { document.getElementById(i).value = ''; });
    document.getElementById('cstnom-cuenta').value = '';
    pmToast('Concepto agregado ✓');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstNomAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

function cstNomEdit(id) {
  const c = _cstConceptos.find(x => x.id === id);
  const row = document.getElementById('cstnom-row-' + id);
  if (!c || !row) return;
  _cstBase['cost_conceptos_nomina:' + id] = c.updated_at;
  const cuentasLab = _cstCuentas.filter(x => Number(x.serie) === 4);
  const optsCu = _cstOpts(cuentasLab, c.cuenta_id, x => x.codigo + ' · ' + x.nombre);
  row.style.opacity = '1';
  row.style.flexWrap = 'wrap';
  row.innerHTML = `
    <input type="text" id="cnm-codigo-${id}" value="${pmEsc(c.codigo)}" style="width:90px;font-family:'DM Mono',monospace;text-transform:uppercase;${_CST_ST_EDIT}">
    <input type="text" id="cnm-nombre-${id}" value="${pmEsc(c.nombre)}" style="flex:1;min-width:140px;${_CST_ST_EDIT}">
    <select id="cnm-tipo-${id}" style="width:150px;${_CST_ST_EDIT}">
      <option value="pct" ${c.tipo === 'pct' ? 'selected' : ''}>% del sueldo base</option>
      <option value="monto" ${c.tipo === 'monto' ? 'selected' : ''}>Monto fijo por mes</option>
    </select>
    <input type="number" id="cnm-valor-${id}" value="${c.valor}" min="0" step="any" style="width:90px;${_CST_ST_EDIT}">
    <select id="cnm-cuenta-${id}" style="width:190px;${_CST_ST_EDIT}">${optsCu}</select>
    <button class="btn btn-gold btn-xs" onclick="cstNomEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstNomRender()">✕</button>`;
}

async function cstNomEditSave(id) {
  const c = _cstConceptos.find(x => x.id === id);
  if (!c) return;
  const r = _cstLeerConcepto(k => _cstVal('cnm-' + k + '-' + id), id);
  if (r.error) { pmToast(r.error, 'err'); return; }
  if (await _cstConflicto('cost_conceptos_nomina', id, `El concepto "${c.nombre}"`,
        () => cstPersRecargar(), () => cstNomEditSave(id))) return;
  try {
    await pmDB.update('cost_conceptos_nomina', id, r.datos);
    pmToast('Concepto actualizado ✓ (los períodos ya generados no cambian)');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstNomEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

async function cstNomToggle(id) {
  const c = _cstConceptos.find(x => x.id === id);
  if (!c) return;
  const reactivar = c.activo === false;
  if (!reactivar && !confirm(`¿Desactivar el concepto "${c.nombre}"? Deja de sumar en el costo cargado y en los períodos nuevos; las nóminas ya generadas conservan sus montos.`)) return;
  try {
    await pmDB.update('cost_conceptos_nomina', id, { activo: reactivar });
    pmToast(reactivar ? 'Concepto reactivado ✓' : 'Concepto desactivado');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstNomToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// COLABORADORES
// ═══════════════════════════════════════════════════════════
function cstColSugerirCodigo() {
  const el = document.getElementById('cstcol-codigo');
  if (el && !el.value) el.value = _cstSiguienteCodigo('COL', _cstColabs, 3);
}

function _cstTratamientoHtml(colabId) {
  const t = cstTratamientoDe(colabId);
  const partes = ['MOD', 'MOI', 'GASTO'].filter(k => t[k] > 0).map(k => `${_cstTratLabel(k)} ${_cstFmtPct(t[k])}`);
  return partes.join(' · ');
}

function cstColRender() {
  const el = document.getElementById('cstcol-list');
  if (!el) return;
  const q = _cstVal('cstcol-search').toLowerCase().trim();
  let lista = [..._cstColabs];
  if (q) lista = lista.filter(c => (c.nombre || '').toLowerCase().includes(q) || (c.codigo || '').toLowerCase().includes(q));
  lista.sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric: true }));
  const activos = _cstColabs.filter(c => c.activo !== false);
  document.getElementById('cstcol-count').textContent = `Colaboradores (${lista.filter(c => c.activo !== false).length} activos)`;

  // Resumen mensual del personal activo
  const tot = { MOD: 0, MOI: 0, GASTO: 0 };
  activos.forEach(c => {
    const cc = cstCostoCargado(c).total;
    const t = cstTratamientoDe(c.id);
    ['MOD', 'MOI', 'GASTO'].forEach(k => { tot[k] += cc * t[k] / 100; });
  });
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const statsEl = document.getElementById('cstcol-stats');
  if (statsEl) {
    statsEl.innerHTML = activos.length
      ? stat('Personal activo', activos.length, '') +
        stat('MOD por mes', cstMoney(tot.MOD), 'costo cargado') +
        stat('MOI por mes', cstMoney(tot.MOI), 'costo cargado') +
        stat('Gasto del período', cstMoney(tot.GASTO), 'venta · mercadeo · admin.') +
        stat('Total por mes', cstMoney(tot.MOD + tot.MOI + tot.GASTO), 'costo cargado')
      : '';
  }
  el.innerHTML = lista.map(cstColCardHtml).join('') || _cstPh('👥', 'Sin colaboradores todavía — creá el primero arriba');
}

function cstColCardHtml(c) {
  const inactivo = c.activo === false;
  const car = _cstCargos.find(x => x.id === c.cargo_id);
  const cc = cstCostoCargado(c);
  const abierto = !!_cstColAbiertos[c.id];
  const rep = cstRepartoDe(c.id);
  let alerta = '';
  if (!rep.length) alerta = '<span style="color:var(--red);font-size:11px">⚠ sin reparto de tiempo</span>';
  else if (!_cstRepartoOk(c.id)) alerta = `<span style="color:var(--red);font-size:11px">⚠ el reparto suma ${_cstFmtPct(cstRepartoSuma(c.id))}</span>`;
  return `
  <div class="card" id="cstcol-card-${c.id}" style="padding:10px 12px;margin-bottom:8px;${inactivo ? 'opacity:.6' : ''}">
    <div id="cstcol-head-${c.id}" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:64px">${pmEsc(c.codigo)}</div>
      <div style="flex:1;min-width:150px">
        <div class="item-name">${pmEsc(c.nombre)}${inactivo ? ' <span style="font-size:10px;color:var(--red)">(inactivo)</span>' : ''}</div>
        <div style="font-size:11px;color:var(--cream2)">${car ? pmEsc(car.nombre) : '—'} · ${_cstTratamientoHtml(c.id) || 'sin departamento'} ${alerta}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--gold2);white-space:nowrap">${cstMoney(cc.total)}</div>
        <div style="font-size:10px;color:var(--cream2)">costo cargado/mes</div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="cstColToggleDetalle('${c.id}')" title="Ver detalle y reparto">${abierto ? '▲' : '▼'}</button>
        <button class="btn btn-out btn-xs" onclick="cstColEdit('${c.id}')">✏️</button>
        <button class="btn ${inactivo ? 'btn-out' : 'btn-red'} btn-xs" onclick="cstColToggle('${c.id}')" title="${inactivo ? 'Reactivar' : 'Desactivar'}">${inactivo ? '↺' : '✕'}</button>
      </div>
    </div>
    ${abierto ? cstColDetalleHtml(c, cc) : ''}
  </div>`;
}

function cstColDetalleHtml(c, cc) {
  const car = _cstCargos.find(x => x.id === c.cargo_id);
  const filaConcepto = l => `
    <div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #E2E8F0;font-size:12px">
      <span style="color:var(--cream2)">${pmEsc(l.concepto.nombre)} <span style="font-size:10px">(${pmEsc(_cstNomValorTxt(l.concepto))})</span></span>
      <b style="font-family:'DM Mono',monospace">${cstMoney(l.monto)}</b>
    </div>`;
  const hhTot = cstRepartoDe(c.id).reduce((a, r) => a + cstHHDepto(c, r), 0);
  return `
    <div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <div style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2);margin-bottom:4px">Costo cargado por mes</div>
        ${cc.lineas.map(filaConcepto).join('') || '<div style="font-size:12px;color:var(--cream2)">Sin conceptos activos</div>'}
        <div style="display:flex;justify-content:space-between;padding-top:5px;font-size:13px"><b>Total</b><b style="font-family:'DM Mono',monospace;color:var(--gold2)">${cstMoney(cc.total)}</b></div>
        <div style="font-size:11px;color:var(--cream2);margin-top:6px">Sueldo base ${cstMoney(c.sueldo_base)} · ${Number(c.horas_mes).toLocaleString('es-CR', { maximumFractionDigits: 2 })} h pagadas por mes${car ? ' · utilización ' + _cstFmtPct(car.pct_utilizacion) : ''}${hhTot ? ' · ' + hhTot.toLocaleString('es-CR', { maximumFractionDigits: 1 }) + ' HH productivas/mes' : ''}</div>
      </div>
      <div style="flex:1;min-width:260px">${cstColRepHtml(c)}</div>
    </div>`;
}

// Editor / vista del reparto de tiempo por departamento
function cstColRepHtml(c) {
  const id = c.id;
  const titulo = '<div style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2);margin-bottom:4px">Reparto del tiempo por departamento</div>';
  const editando = _cstColRep[id];
  if (!editando) {
    const rep = cstRepartoDe(id);
    const filas = rep.map(r => {
      const d = _cstDeps.find(x => x.id === r.depto_id);
      const t = d ? cstTratamiento(d.tipo) : '';
      const hh = cstHHDepto(c, r);
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #E2E8F0;font-size:12px">
        <span style="color:var(--cream2)">${d ? pmEsc(d.codigo + ' · ' + d.nombre) : '—'} <span style="font-size:10px">(${_cstTratLabel(t)})</span></span>
        <b style="font-family:'DM Mono',monospace">${_cstFmtPct(r.pct)}${hh ? ' · ' + hh.toLocaleString('es-CR', { maximumFractionDigits: 1 }) + ' HH' : ''}</b></div>`;
    }).join('');
    return `${titulo}${filas || '<div style="font-size:12px;color:var(--red)">Sin reparto: asignale al menos un departamento</div>'}
      <button class="btn btn-out btn-xs" style="margin-top:6px" onclick="cstColRepAbrir('${id}')">✏️ Cambiar reparto</button>`;
  }
  const st = 'padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px';
  const suma = editando.reduce((a, r) => a + (parseFloat(r.pct) || 0), 0);
  const okSuma = Math.abs(suma - 100) < 0.005;
  const filas = editando.map((r, i) => `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
      <select id="ccr-dep-${id}-${i}" onchange="cstColRepSet('${id}',${i},'depto_id',this.value)" style="flex:1;min-width:120px;${st}">
        <option value="">— Departamento —</option>${_cstOpts(_cstDeps, r.depto_id, d => d.codigo + ' · ' + d.nombre)}
      </select>
      <input type="number" id="ccr-pct-${id}-${i}" value="${r.pct}" min="0" max="100" step="any" onchange="cstColRepSet('${id}',${i},'pct',this.value)" style="width:70px;${st}">
      <span style="font-size:11px;color:var(--cream2)">%</span>
      <button class="btn btn-out btn-xs" onclick="cstColRepDel('${id}',${i})">✕</button>
    </div>`).join('');
  return `${titulo}${filas}
    <div style="font-size:12px;margin:4px 0 6px;color:${okSuma ? 'var(--green)' : 'var(--red)'}">Suma: <b>${_cstFmtPct(suma)}</b> ${okSuma ? '✓' : '— debe ser 100 %'}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-out btn-xs" onclick="cstColRepAdd('${id}')">+ Departamento</button>
      <button class="btn btn-gold btn-xs" onclick="cstColRepSave('${id}')">💾 Guardar reparto</button>
      <button class="btn btn-out btn-xs" onclick="cstColRepCancel('${id}')">Cancelar</button>
    </div>`;
}

function cstColToggleDetalle(id) {
  _cstColAbiertos[id] = !_cstColAbiertos[id];
  cstColRender();
}

function _cstColRefrescar() { cstColRender(); }

function cstColRepAbrir(id) {
  _cstColRep[id] = cstRepartoDe(id).map(r => ({ depto_id: r.depto_id, pct: r.pct }));
  if (!_cstColRep[id].length) _cstColRep[id].push({ depto_id: '', pct: 100 });
  _cstColRefrescar();
}
function cstColRepAdd(id) {
  const ed = _cstColRep[id]; if (!ed) return;
  const suma = ed.reduce((a, r) => a + (parseFloat(r.pct) || 0), 0);
  ed.push({ depto_id: '', pct: Math.max(0, Math.round((100 - suma) * 100) / 100) });
  _cstColRefrescar();
}
function cstColRepSet(id, i, campo, valor) {
  const ed = _cstColRep[id]; if (!ed || !ed[i]) return;
  ed[i][campo] = valor;
  _cstColRefrescar();
}
function cstColRepDel(id, i) {
  const ed = _cstColRep[id]; if (!ed) return;
  ed.splice(i, 1);
  _cstColRefrescar();
}
function cstColRepCancel(id) { delete _cstColRep[id]; _cstColRefrescar(); }

async function cstColRepSave(id) {
  const ed = _cstColRep[id];
  if (!ed) return;
  const filas = ed.map(r => ({ depto_id: r.depto_id, pct: parseFloat(r.pct) }));
  if (!filas.length) { pmToast('Agregá al menos un departamento', 'err'); return; }
  if (filas.some(r => !r.depto_id || !_cstDeps.some(d => d.id === r.depto_id))) { pmToast('Elegí el departamento en todas las filas', 'err'); return; }
  if (new Set(filas.map(r => r.depto_id)).size !== filas.length) { pmToast('Un departamento no puede repetirse', 'err'); return; }
  if (filas.some(r => !(r.pct > 0 && r.pct <= 100))) { pmToast('Cada porcentaje va entre 0 y 100', 'err'); return; }
  const suma = filas.reduce((a, r) => a + r.pct, 0);
  if (Math.abs(suma - 100) >= 0.005) { pmToast(`El reparto suma ${_cstFmtPct(suma)}; debe sumar 100 %`, 'err'); return; }
  const viejas = cstRepartoDe(id);
  try {
    // Primero actualizar o insertar, al final borrar las que sobran: si algo falla queda lo anterior
    for (const f of filas) {
      const ex = viejas.find(v => v.depto_id === f.depto_id);
      if (ex) { if (Number(ex.pct) !== f.pct) await pmDB.update('cost_colab_depto', ex.id, { pct_tiempo: f.pct }); }
      else await pmDB.insert('cost_colab_depto', { colaborador_id: id, depto_id: f.depto_id, pct_tiempo: f.pct });
    }
    for (const v of viejas) {
      if (!filas.some(f => f.depto_id === v.depto_id)) await pmDB.hardDelete('cost_colab_depto', v.id);
    }
    delete _cstColRep[id];
    pmToast('Reparto guardado ✓');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstColRepSave]', e.message);
    pmToast('⚠️ No se pudo guardar el reparto: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
    await cstPersRecargar();
  }
}

function _cstLeerColab(leer, idActual) {
  const codigo = _cstNorm(leer('codigo'));
  const nombre = String(leer('nombre') || '').trim();
  const cargo = leer('cargo');
  const sueldoTxt = String(leer('sueldo') || '').trim();
  const sueldo = parseFloat(sueldoTxt);
  const horas = parseFloat(leer('horas'));
  if (!codigo || !nombre) return { error: 'Completá código y nombre' };
  if (_cstColabs.some(c => c.codigo === codigo && c.id !== idActual)) return { error: `Ya existe un colaborador con código ${codigo}` };
  if (!cargo || !_cstCargos.some(c => c.id === cargo)) return { error: 'Elegí el cargo' };
  if (sueldoTxt === '' || isNaN(sueldo) || sueldo < 0) return { error: 'Ingresá el sueldo base mensual (0 o más)' };
  if (!(horas > 0 && horas <= 744)) return { error: 'Las horas pagadas por mes van entre 1 y 744' };
  return { datos: { codigo, nombre, cargo_id: cargo, sueldo_base: sueldo, horas_mes: horas } };
}

async function cstColAdd() {
  const r = _cstLeerColab(k => _cstVal('cstcol-' + k), null);
  if (r.error) { pmToast(r.error, 'err'); return; }
  const car = _cstCargos.find(c => c.id === r.datos.cargo_id);
  try {
    const rows = await pmDB.insert('cost_colaboradores', r.datos);
    const nuevo = rows && rows[0];
    if (nuevo && car) {
      try {
        await pmDB.insert('cost_colab_depto', { colaborador_id: nuevo.id, depto_id: car.depto_id, pct_tiempo: 100 });
      } catch (e2) {
        console.warn('[cstColAdd reparto]', e2.message);
        pmToast('⚠️ La persona se creó pero no su reparto de tiempo — asignalo desde el detalle', 'err');
      }
    }
    ['cstcol-codigo', 'cstcol-nombre', 'cstcol-sueldo'].forEach(i => { document.getElementById(i).value = ''; });
    document.getElementById('cstcol-cargo').value = '';
    document.getElementById('cstcol-horas').value = '208';
    pmToast('Colaborador agregado ✓ (100 % de su tiempo en el departamento del cargo)');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstColAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

function cstColEdit(id) {
  const c = _cstColabs.find(x => x.id === id);
  const head = document.getElementById('cstcol-head-' + id);
  if (!c || !head) return;
  _cstBase['cost_colaboradores:' + id] = c.updated_at;
  const opts = _cstOpts(_cstCargos, c.cargo_id, x => x.codigo + ' · ' + x.nombre);
  head.style.flexWrap = 'wrap';
  head.innerHTML = `
    <input type="text" id="cco-codigo-${id}" value="${pmEsc(c.codigo)}" style="width:90px;font-family:'DM Mono',monospace;text-transform:uppercase;${_CST_ST_EDIT}">
    <input type="text" id="cco-nombre-${id}" value="${pmEsc(c.nombre)}" style="flex:1;min-width:140px;${_CST_ST_EDIT}">
    <select id="cco-cargo-${id}" style="width:170px;${_CST_ST_EDIT}">${opts}</select>
    <input type="number" id="cco-sueldo-${id}" value="${c.sueldo_base}" min="0" step="any" style="width:110px;${_CST_ST_EDIT}" title="Sueldo base mensual">
    <input type="number" id="cco-horas-${id}" value="${c.horas_mes}" min="1" max="744" step="any" style="width:72px;${_CST_ST_EDIT}" title="Horas pagadas por mes">
    <button class="btn btn-gold btn-xs" onclick="cstColEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="cstColRender()">✕</button>`;
}

async function cstColEditSave(id) {
  const c = _cstColabs.find(x => x.id === id);
  if (!c) return;
  const r = _cstLeerColab(k => _cstVal('cco-' + k + '-' + id), id);
  if (r.error) { pmToast(r.error, 'err'); return; }
  // Si cambia de cargo y todo su tiempo estaba en el departamento del cargo anterior, se mueve al del nuevo
  let mover = null;
  if (r.datos.cargo_id !== c.cargo_id) {
    const viejo = _cstCargos.find(x => x.id === c.cargo_id);
    const nuevo = _cstCargos.find(x => x.id === r.datos.cargo_id);
    const rep = cstRepartoDe(id);
    if (viejo && nuevo && viejo.depto_id !== nuevo.depto_id && rep.length === 1 && rep[0].depto_id === viejo.depto_id && Math.abs(rep[0].pct - 100) < 0.005) {
      if (!confirm(`El cargo nuevo pertenece a otro departamento. ¿Mover también todo el tiempo de ${c.nombre} a ${_cstDepNombre(nuevo.depto_id)}?`)) return;
      mover = { filaId: rep[0].id, depto_id: nuevo.depto_id };
    }
  }
  if (await _cstConflicto('cost_colaboradores', id, `El colaborador "${c.nombre}"`,
        () => cstPersRecargar(), () => cstColEditSave(id))) return;
  try {
    await pmDB.update('cost_colaboradores', id, r.datos);
    if (mover) await pmDB.update('cost_colab_depto', mover.filaId, { depto_id: mover.depto_id });
    pmToast('Colaborador actualizado ✓ (los períodos ya generados no cambian)');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstColEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

async function cstColToggle(id) {
  const c = _cstColabs.find(x => x.id === id);
  if (!c) return;
  const reactivar = c.activo === false;
  if (!reactivar && !confirm(`¿Desactivar a "${c.nombre}"? Deja de incluirse al generar la nómina de períodos nuevos; el historial se conserva.`)) return;
  try {
    await pmDB.update('cost_colaboradores', id, { activo: reactivar });
    pmToast(reactivar ? 'Colaborador reactivado ✓' : 'Colaborador desactivado');
    await cstPersRecargar();
  } catch (e) {
    console.warn('[cstColToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}
