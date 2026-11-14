// costos_gasbud.js — Módulo de Costos · Presupuesto de gasto fijo (12 meses) y activos depreciables
// Prefijo cst (cstGb = gasto presupuestado; cstAct = activos)
// Depende de costos_core.js, costos_maestros.js (cuentas y departamentos), costos_budget.js (meses de la matriz)
// y sql_costos_presupuesto.sql.
//
// DISEÑO: es el BUDGET de gasto. Los meses son los mismos 12 de la matriz del Budget de ventas.
//   · Gasto presupuestado: una línea por cuenta + departamento; el monto de cada mes se escribe a mano.
//   · Activos: costo, valor residual y vida útil. Depreciación mensual (línea recta) = (costo − residual) ÷ vida útil,
//     desde el mes de inicio y durante la vida útil. Aparece en la matriz como gasto fijo por departamento (solo lectura).
// El presupuesto no se modifica solo: lo que se ve aquí es lo que se escribió.

let _cstGbRows = [];     // cost_gasto_budget
let _cstActivos = [];    // cost_activos

// ── Meses (los mismos del Budget de ventas) ─────────────────
function _cstGbMeses() { return typeof _cstBudMeses === 'function' ? _cstBudMeses() : []; }
function _cstGbMesTxt(ym) { return typeof _cstBudMesTxt === 'function' ? _cstBudMesTxt(ym) : ym; }
function _cstGbKey(cuentaId, deptoId) { return cuentaId + '|' + (deptoId || ''); }
function _cstGbFila(cuentaId, deptoId, ym) {
  const k = _cstGbKey(cuentaId, deptoId);
  return _cstGbRows.find(r => _cstGbKey(r.cuenta_id, r.depto_id) === k && r.mes === ym) || null;
}
function _cstGbMonto(cuentaId, deptoId, ym) { const r = _cstGbFila(cuentaId, deptoId, ym); return r ? Number(r.monto) : 0; }

// ── Depreciación (puro) ─────────────────────────────────────
function _cstActMesIdx(ym) { return parseInt(ym.slice(0, 4), 10) * 12 + parseInt(ym.slice(5, 7), 10) - 1; }
// Depreciación del activo en un mes ('YYYY-MM'): 0 fuera de su vida útil
function cstActDepMes(a, ym) {
  if (!a || a.activo === false) return 0;
  const vida = Number(a.vida_util_meses);
  if (!(vida > 0)) return 0;
  const ini = _cstActMesIdx(String(a.inicio).slice(0, 7));
  const i = _cstActMesIdx(ym) - ini;
  if (i < 0 || i >= vida) return 0;
  return Math.max(0, Number(a.costo) - Number(a.valor_residual)) / vida;
}
// Depreciación por departamento en un mes: { deptoId|'' : monto }
function cstActDepPorDepto(ym) {
  const out = {};
  _cstActivos.forEach(a => {
    const d = cstActDepMes(a, ym);
    if (d > 0) { const k = a.depto_id || ''; out[k] = (out[k] || 0) + d; }
  });
  return out;
}
function cstActDepTotal(ym) { return Object.values(cstActDepPorDepto(ym)).reduce((x, y) => x + y, 0); }

// Total de gasto fijo presupuestado de un mes: líneas escritas + depreciación (la usan otras pantallas)
function cstGbTotalMes(ym) {
  return _cstGbRows.filter(r => r.mes === ym).reduce((a, r) => a + Number(r.monto), 0) + cstActDepTotal(ym);
}

// ── Carga ───────────────────────────────────────────────────
async function cstGbCargarDatos() {
  _cstGbRows = []; _cstActivos = [];
  try {
    const [g, a] = await Promise.all([pmDB.get('cost_gasto_budget'), pmDB.get('cost_activos')]);
    _cstGbRows = (g || []).map(x => Object.assign({}, x, { mes: String(x.mes).slice(0, 7), monto: Number(x.monto) }));
    _cstActivos = (a || []).map(x => Object.assign({}, x, { costo: Number(x.costo), valor_residual: Number(x.valor_residual), vida_util_meses: Number(x.vida_util_meses), inicio: String(x.inicio).slice(0, 10) }))
      .sort((p, q) => (p.nombre || '').localeCompare(q.nombre || '', 'es'));
  } catch (e) {
    console.warn('[cstGbCargarDatos]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
  }
}

async function _cstGbAsegurar() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return false; }
  await cstCfgCargar();
  try { await cstMaeDatos(); } catch (e) {
    console.warn('[cstGbAsegurar]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql'), 'err');
    return false;
  }
  try { _cstBudInicio = localStorage.getItem(CST_BUD_LS) || _cstBudInicio; } catch (e) { /* ok */ }
  if (!/^\d{4}-\d{2}$/.test(_cstBudInicio)) _cstBudInicio = _cstBudMesHoy();
  return true;
}

function _cstGbDeptoNom(id) { const d = _cstDeps.find(x => x.id === id); return d ? d.nombre : 'Compartido'; }
function _cstGbCuentas() {
  return _cstCuentas.filter(c => c.activo !== false && CST_GAS_SERIES.includes(Number(c.serie)))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}
function _cstGbDeptoOpts(sel) {
  const ds = _cstDeps.filter(d => d.activo !== false).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  return '<option value="">Compartido (sin departamento)</option>' + ds.map(d => `<option value="${d.id}"${d.id === sel ? ' selected' : ''}>${pmEsc(d.codigo)} · ${pmEsc(d.nombre)}</option>`).join('');
}

// ═══ Gasto fijo presupuestado ═══════════════════════════════
async function cstGbInit() {
  if (!(await _cstGbAsegurar())) return;
  await cstGbCargarDatos();
  const ini = document.getElementById('cstgb-inicio');
  if (ini) ini.value = _cstBudInicio;
  const cs = document.getElementById('cstgb-n-cuenta');
  if (cs) cs.innerHTML = '<option value="">— Cuenta —</option>' + _cstGbCuentas().map(c => `<option value="${c.id}">${pmEsc(c.codigo)} · ${pmEsc(c.nombre)}</option>`).join('');
  const ds = document.getElementById('cstgb-n-depto');
  if (ds) ds.innerHTML = _cstGbDeptoOpts('');
  cstGbRender();
}

function cstGbSetInicio(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  _cstBudInicio = v;
  try { localStorage.setItem(CST_BUD_LS, v); } catch (e) { /* ok */ }
  cstGbRender();
}

function cstGbNuevaCuenta() {
  const c = _cstCuentas.find(x => x.id === _cstVal('cstgb-n-cuenta'));
  const ds = document.getElementById('cstgb-n-depto');
  if (c && ds) ds.innerHTML = _cstGbDeptoOpts(c.depto_defecto_id || '');
}

async function cstGbAgregar() {
  const cuentaId = _cstVal('cstgb-n-cuenta');
  const deptoId = _cstVal('cstgb-n-depto') || null;
  const monto = parseFloat(String(_cstVal('cstgb-n-monto')).replace(',', '.'));
  if (!_cstCuentas.find(c => c.id === cuentaId)) { pmToast('Elegí la cuenta', 'err'); return; }
  if (isNaN(monto) || monto < 0) { pmToast('Escribí un monto mensual de 0 o más', 'err'); return; }
  const key = _cstGbKey(cuentaId, deptoId);
  if (_cstGbRows.some(r => _cstGbKey(r.cuenta_id, r.depto_id) === key)) { pmToast('Ya existe esa línea (cuenta y departamento): editá sus meses', 'err'); return; }
  try {
    const meses = _cstGbMeses();
    const m = cstRound(monto, 4, 'normal');
    for (const ym of meses) await _cstGbGuardar(cuentaId, deptoId, ym, m);
    const el = document.getElementById('cstgb-n-monto'); if (el) el.value = '';
    pmToast('Línea agregada con el mismo monto en los 12 meses ✓');
    cstGbRender();
  } catch (e) {
    console.warn('[cstGbAgregar]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
    await cstGbCargarDatos(); cstGbRender();
  }
}

async function _cstGbGuardar(cuentaId, deptoId, ym, n) {
  const ex = _cstGbFila(cuentaId, deptoId, ym);
  if (n === 0) {
    // 0 también es un valor (la línea sigue existiendo): se guarda como renglón en 0
    if (ex) { await pmDB.update('cost_gasto_budget', ex.id, { monto: 0 }); ex.monto = 0; return; }
  }
  if (ex) {
    await pmDB.update('cost_gasto_budget', ex.id, { monto: n });
    ex.monto = n;
  } else {
    const rows = await pmDB.insert('cost_gasto_budget', { mes: ym + '-01', cuenta_id: cuentaId, depto_id: deptoId, monto: n });
    const nueva = (rows && rows[0]) || { id: 'tmp-' + Math.random() };
    nueva.mes = ym; nueva.cuenta_id = cuentaId; nueva.depto_id = deptoId; nueva.monto = n;
    _cstGbRows.push(nueva);
  }
}

async function cstGbSet(cuentaId, deptoId, ym, valor) {
  const txt = String(valor).trim();
  const n = txt === '' ? 0 : parseFloat(txt.replace(',', '.'));
  if (isNaN(n) || n < 0) { pmToast('Ingresá un monto de 0 o más', 'err'); cstGbRender(); return; }
  try {
    await _cstGbGuardar(cuentaId, deptoId || null, ym, cstRound(n, 4, 'normal'));
  } catch (e) {
    console.warn('[cstGbSet]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
    await cstGbCargarDatos(); cstGbRender(); return;
  }
  cstGbTotales();
}

// Copia el monto del primer mes a los meses 2–12 de una línea
async function cstGbCopiar(cuentaId, deptoId) {
  const meses = _cstGbMeses();
  const base = _cstGbMonto(cuentaId, deptoId || null, meses[0]);
  try {
    for (let i = 1; i < meses.length; i++) await _cstGbGuardar(cuentaId, deptoId || null, meses[i], base);
    pmToast('Mes 1 copiado a los demás ✓');
    cstGbRender();
  } catch (e) {
    console.warn('[cstGbCopiar]', e.message);
    pmToast('⚠️ No se pudo guardar todo: ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
    await cstGbCargarDatos(); cstGbRender();
  }
}

async function cstGbQuitar(cuentaId, deptoId) {
  const k = _cstGbKey(cuentaId, deptoId || null);
  const ids = _cstGbRows.filter(r => _cstGbKey(r.cuenta_id, r.depto_id) === k).map(r => r.id);
  if (!confirm('¿Quitar esta línea del presupuesto (los 12 meses)?')) return;
  try {
    await pmDB.hardDeleteMany('cost_gasto_budget', ids);
    _cstGbRows = _cstGbRows.filter(r => _cstGbKey(r.cuenta_id, r.depto_id) !== k);
    cstGbRender();
  } catch (e) {
    console.warn('[cstGbQuitar]', e.message);
    pmToast('⚠️ No se pudo quitar: ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
  }
}

function _cstGbLineas() {
  const m = new Map();
  _cstGbRows.forEach(r => { const k = _cstGbKey(r.cuenta_id, r.depto_id); if (!m.has(k)) m.set(k, { cuentaId: r.cuenta_id, deptoId: r.depto_id || null }); });
  return Array.from(m.values()).sort((a, b) => {
    const ca = _cstCuentas.find(c => c.id === a.cuentaId), cb = _cstCuentas.find(c => c.id === b.cuentaId);
    return (ca ? ca.codigo : '').localeCompare(cb ? cb.codigo : '', 'es', { numeric: true }) || _cstGbDeptoNom(a.deptoId).localeCompare(_cstGbDeptoNom(b.deptoId), 'es');
  });
}

function cstGbRender() {
  const tabla = document.getElementById('cstgb-tabla');
  if (!tabla) return;
  const meses = _cstGbMeses();
  const lineas = _cstGbLineas();
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:3px 4px;text-align:right';
  const inp = 'width:92px;text-align:right;padding:4px 6px;font-size:12px';
  let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="border-bottom:1px solid var(--bdr)">' +
    '<th style="' + th + ';text-align:left">Cuenta · departamento</th>' + meses.map(m => `<th style="${th}">${pmEsc(_cstGbMesTxt(m))}</th>`).join('') +
    `<th style="${th}">Total año</th><th></th></tr></thead><tbody>`;
  if (!lineas.length) html += `<tr><td colspan="${meses.length + 3}" style="padding:14px;color:var(--cream2)">Todavía no hay líneas. Agregá la primera arriba (cuenta, departamento y monto mensual).</td></tr>`;
  lineas.forEach(l => {
    const c = _cstCuentas.find(x => x.id === l.cuentaId);
    const nom = (c ? c.codigo + ' · ' + c.nombre : '(cuenta eliminada)') + ' · ' + _cstGbDeptoNom(l.deptoId);
    const tot = meses.reduce((a, m) => a + _cstGbMonto(l.cuentaId, l.deptoId, m), 0);
    html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:3px 8px;text-align:left">${pmEsc(nom)}</td>` +
      meses.map(m => `<td style="${td}"><input type="number" min="0" step="any" style="${inp}" value="${_cstGbMonto(l.cuentaId, l.deptoId, m) || ''}" placeholder="—" onchange="cstGbSet('${l.cuentaId}','${l.deptoId || ''}','${m}',this.value)"></td>`).join('') +
      `<td style="${td};padding-right:8px" id="cstgb-t-${l.cuentaId}-${l.deptoId || 'x'}">${cstMoney(tot)}</td>` +
      `<td style="white-space:nowrap"><button class="btn btn-out btn-sm" title="Copia el primer mes a los meses 2 a 12" onclick="cstGbCopiar('${l.cuentaId}','${l.deptoId || ''}')">⇢ Copiar mes 1</button> <button class="btn btn-out btn-sm" onclick="cstGbQuitar('${l.cuentaId}','${l.deptoId || ''}')">🗑</button></td></tr>`;
  });
  // Depreciación (solo lectura): una fila por departamento con activos
  const deptosDep = Array.from(new Set(_cstActivos.filter(a => a.activo !== false).map(a => a.depto_id || '')));
  deptosDep.forEach(d => {
    const tot = meses.reduce((a, m) => a + (cstActDepPorDepto(m)[d] || 0), 0);
    html += `<tr style="border-bottom:1px solid var(--bdr);color:var(--cream2)"><td style="padding:3px 8px;text-align:left">📦 Depreciación de activos · ${pmEsc(_cstGbDeptoNom(d || null))}</td>` +
      meses.map(m => `<td style="${td};padding-right:8px">${cstMoney(cstActDepPorDepto(m)[d] || 0)}</td>`).join('') +
      `<td style="${td};padding-right:8px">${cstMoney(tot)}</td><td></td></tr>`;
  });
  html += `<tr style="font-weight:700"><td style="padding:6px 8px;text-align:left">Total gasto fijo presupuestado</td>` +
    meses.map((m, i) => `<td style="${td};padding-right:8px" id="cstgb-tm-${i}">${cstMoney(cstGbTotalMes(m))}</td>`).join('') +
    `<td style="${td};padding-right:8px" id="cstgb-tt">${cstMoney(meses.reduce((a, m) => a + cstGbTotalMes(m), 0))}</td><td></td></tr>`;
  html += '</tbody></table></div>';
  tabla.innerHTML = html;
  cstGbTotales();
}

// Solo totales y estadísticas (no rehace los campos, para no perder el foco al escribir)
function cstGbTotales() {
  const meses = _cstGbMeses();
  meses.forEach((m, i) => { const el = document.getElementById('cstgb-tm-' + i); if (el) el.textContent = cstMoney(cstGbTotalMes(m)); });
  _cstGbLineas().forEach(l => {
    const el = document.getElementById(`cstgb-t-${l.cuentaId}-${l.deptoId || 'x'}`);
    if (el) el.textContent = cstMoney(meses.reduce((a, m) => a + _cstGbMonto(l.cuentaId, l.deptoId, m), 0));
  });
  const total = meses.reduce((a, m) => a + cstGbTotalMes(m), 0);
  const tt = document.getElementById('cstgb-tt'); if (tt) tt.textContent = cstMoney(total);
  const dep = meses.reduce((a, m) => a + cstActDepTotal(m), 0);
  const st = document.getElementById('cstgb-stats');
  if (st) {
    const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
    st.innerHTML = stat('Gasto fijo del año', cstMoney(total), 'incluye la depreciación') +
      stat('Promedio mensual', cstMoney(total / 12), 'lo que habría que cubrir cada mes') +
      stat('Depreciación del año', cstMoney(dep), _cstActivos.length ? _cstActivos.filter(a => a.activo !== false).length + ' activos' : 'sin activos cargados');
  }
}

// ═══ Activos depreciables ═══════════════════════════════════
async function cstActInit() {
  if (!(await _cstGbAsegurar())) return;
  await cstGbCargarDatos();
  const ds = document.getElementById('cstact-n-depto');
  if (ds) ds.innerHTML = _cstGbDeptoOpts('');
  const ini = document.getElementById('cstact-n-inicio');
  if (ini && !ini.value) ini.value = _cstBudMesHoy();
  cstActRender();
}

async function cstActAgregar() {
  const nombre = String(_cstVal('cstact-n-nombre')).trim();
  const costo = parseFloat(String(_cstVal('cstact-n-costo')).replace(',', '.'));
  const res = parseFloat(String(_cstVal('cstact-n-res')).replace(',', '.')) || 0;
  const vida = parseInt(_cstVal('cstact-n-vida'), 10);
  const inicio = _cstVal('cstact-n-inicio');
  const deptoId = _cstVal('cstact-n-depto') || null;
  if (!nombre) { pmToast('Escribí el nombre del activo', 'err'); return; }
  if (isNaN(costo) || costo <= 0) { pmToast('Escribí el costo del activo', 'err'); return; }
  if (res < 0 || res > costo) { pmToast('El valor residual debe estar entre 0 y el costo', 'err'); return; }
  if (isNaN(vida) || vida <= 0) { pmToast('Escribí la vida útil en meses', 'err'); return; }
  if (!/^\d{4}-\d{2}$/.test(inicio || '')) { pmToast('Elegí el mes en que empieza a depreciarse', 'err'); return; }
  try {
    await pmDB.insert('cost_activos', { nombre, depto_id: deptoId, costo: cstRound(costo, 4, 'normal'), valor_residual: cstRound(res, 4, 'normal'), vida_util_meses: vida, inicio: inicio + '-01' });
    ['cstact-n-nombre', 'cstact-n-costo', 'cstact-n-res', 'cstact-n-vida'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    await cstGbCargarDatos();
    cstActRender();
    pmToast('Activo agregado ✓');
  } catch (e) {
    console.warn('[cstActAgregar]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
  }
}

async function cstActToggle(id) {
  const a = _cstActivos.find(x => x.id === id);
  if (!a) return;
  try {
    await pmDB.update('cost_activos', id, { activo: a.activo === false });
    a.activo = a.activo === false;
    cstActRender();
  } catch (e) {
    console.warn('[cstActToggle]', e.message);
    pmToast('⚠️ No se pudo cambiar: ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
  }
}

async function cstActQuitar(id) {
  const a = _cstActivos.find(x => x.id === id);
  if (!a || !confirm(`¿Eliminar el activo «${a.nombre}»? Su depreciación sale del presupuesto.`)) return;
  try {
    await pmDB.hardDelete('cost_activos', id);
    _cstActivos = _cstActivos.filter(x => x.id !== id);
    cstActRender();
  } catch (e) {
    console.warn('[cstActQuitar]', e.message);
    pmToast('⚠️ No se pudo eliminar: ' + _cstErr(e, 'sql_costos_presupuesto.sql'), 'err');
  }
}

function cstActRender() {
  const el = document.getElementById('cstact-tabla');
  if (!el) return;
  const hoy = _cstBudMesHoy();
  const th = 'padding:6px 8px;font-size:11px;text-align:right;white-space:nowrap';
  const td = 'padding:5px 8px;text-align:right';
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="border-bottom:1px solid var(--bdr)"><th style="${th};text-align:left">Activo</th><th style="${th};text-align:left">Departamento</th><th style="${th}">Costo</th><th style="${th}">Residual</th><th style="${th}">Vida (meses)</th><th style="${th}">Desde</th><th style="${th}">Depreciación mensual</th><th style="${th}">Este mes</th><th></th></tr></thead><tbody>`;
  if (!_cstActivos.length) html += '<tr><td colspan="9" style="padding:14px;color:var(--cream2)">Todavía no hay activos. Agregá el primero arriba (horno, batidora, mesa de trabajo...).</td></tr>';
  _cstActivos.forEach(a => {
    const mensual = Math.max(0, a.costo - a.valor_residual) / a.vida_util_meses;
    const vigente = cstActDepMes(a, hoy) > 0;
    html += `<tr style="border-bottom:1px solid var(--bdr)${a.activo === false ? ';opacity:.5' : ''}"><td style="${td};text-align:left">${pmEsc(a.nombre)}</td><td style="${td};text-align:left">${pmEsc(_cstGbDeptoNom(a.depto_id))}</td>` +
      `<td style="${td}">${cstMoney(a.costo)}</td><td style="${td}">${cstMoney(a.valor_residual)}</td><td style="${td}">${a.vida_util_meses}</td><td style="${td}">${pmEsc(_cstGbMesTxt(a.inicio.slice(0, 7)))}</td>` +
      `<td style="${td}">${cstMoney(mensual)}</td><td style="${td}">${vigente ? '✓ se deprecia' : '—'}</td>` +
      `<td style="white-space:nowrap"><button class="btn btn-out btn-sm" onclick="cstActToggle('${a.id}')">${a.activo === false ? 'Reactivar' : 'Pausar'}</button> <button class="btn btn-out btn-sm" onclick="cstActQuitar('${a.id}')">🗑</button></td></tr>`;
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
  const vig = _cstActivos.filter(a => a.activo !== false);
  const mensualHoy = cstActDepTotal(hoy);
  const st = document.getElementById('cstact-stats');
  if (st) {
    const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
    st.innerHTML = stat('Activos', String(vig.length), vig.length === _cstActivos.length ? 'todos en uso' : (_cstActivos.length - vig.length) + ' en pausa') +
      stat('Costo de los activos', cstMoney(vig.reduce((a, x) => a + x.costo, 0)), 'sin residual') +
      stat('Depreciación de este mes', cstMoney(mensualHoy), 'va al presupuesto de gasto fijo');
  }
}
