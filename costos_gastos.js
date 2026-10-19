// costos_gastos.js — Módulo de Costos · Entrega 5: Gastos del período
// Prefijo cst (cstGas = gastos del período)
// Depende de costos_core.js, costos_maestros.js y costos_laboral.js (períodos).
//
// DISEÑO: independiente del núcleo de PanMaestro. Tabla propia cost_presupuesto
// (sql_costos_gastos.sql), colgada de cost_periodos.
// - Un renglón = un gasto del período en una cuenta de las series 5 a 8, asignado a un
//   departamento o "Compartida" (se reparte entre departamentos por la base de la cuenta,
//   en Capacidad y reparto). Los sueldos (serie 4) NO se cargan aquí: vienen de la nómina.
// - El monto es el total del período (si el período tiene 3 meses, se carga el gasto de los 3).
// - Cada renglón trae su % variable, que parte del valor de la cuenta y se puede ajustar.
//   fijo = monto × (1 − %var); variable = monto × %var.
// - "Preparar renglones" crea un renglón en cero por cada cuenta activa que aún no tenga
//   ninguno; "Copiar de otro período" trae los renglones y montos de un período anterior.

let _cstGasRows = [];   // renglones del período seleccionado

const CST_GAS_SERIES = [5, 6, 7, 8];
const CST_GAS_COMPARTIDA = '';   // valor del select cuando el gasto es compartido

// ── Utilidades comunes de períodos para las pantallas de la entrega 5 ──
// Deja elegido el período (el último usado, si sigue existiendo)
function cstPerInicial() {
  let guardado = '';
  try { guardado = localStorage.getItem(CST_PER_LS) || ''; } catch (e) { /* ok */ }
  const quedo = _cstPeriodos.some(p => p.id === _cstPerSel) ? _cstPerSel : guardado;
  _cstPerSel = _cstPeriodos.some(p => p.id === quedo) ? quedo : (_cstPeriodos[0] ? _cstPeriodos[0].id : '');
}

function cstPerLlenarSelectId(selId, vacioTxt) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = _cstPeriodos.length
    ? _cstPeriodos.map(p => `<option value="${p.id}">${pmEsc(_cstPerTxt(p))}</option>`).join('')
    : `<option value="">${pmEsc(vacioTxt || '— Sin períodos: creá el primero en Costo laboral —')}</option>`;
  if (_cstPerSel) sel.value = _cstPerSel;
}

// <option>s con los otros períodos (para "copiar de...")
function cstPerOtrosOpts() {
  const otros = _cstPeriodos.filter(p => p.id !== _cstPerSel);
  return otros.length
    ? otros.map(p => `<option value="${p.id}">${pmEsc(_cstPerTxt(p))}</option>`).join('')
    : '<option value="">— No hay otros períodos —</option>';
}

function _cstGasKey(cuentaId, deptoId) { return cuentaId + '|' + (deptoId || ''); }

function _cstGasCuentasActivas() {
  return _cstCuentas.filter(c => c.activo !== false && CST_GAS_SERIES.includes(Number(c.serie)))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}

// ── Carga ───────────────────────────────────────────────────
async function cstGasInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  try {
    await cstMaeDatos();
    await cstPerCargar();
  } catch (e) {
    console.warn('[cstGasInit]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql y sql_costos_personal.sql'), 'err');
    return;
  }
  cstPerInicial();
  await cstGasCargar();
  cstPerLlenarSelectId('cstgas-periodo');
  cstGasLlenarForm();
  cstGasRender();
}

async function cstGasCargar() {
  if (!_cstPerSel) { _cstGasRows = []; return; }
  try {
    const r = await pmDB.get('cost_presupuesto', { periodo_id: _cstPerSel });
    _cstGasRows = (r || []).map(x => Object.assign({}, x, { monto: Number(x.monto), pct_variable: Number(x.pct_variable) }));
  } catch (e) {
    console.warn('[cstGasCargar]', e.message);
    _cstGasRows = [];
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
  }
}

async function cstGasElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstGasCargar();
  cstGasLlenarForm();
  cstGasRender();
}

// ── Altas ───────────────────────────────────────────────────
async function cstGasPreparar() {
  const per = _cstPerActual();
  if (!per) { pmToast('Elegí o creá un período', 'err'); return; }
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  const usadas = new Set(_cstGasRows.map(r => r.cuenta_id));
  const nuevas = _cstGasCuentasActivas().filter(c => !usadas.has(c.id)).map(c => ({
    periodo_id: per.id, cuenta_id: c.id, depto_id: c.depto_defecto_id || null, monto: 0, pct_variable: c.pct_variable,
  }));
  if (!nuevas.length) { pmToast('Ya hay renglones para todas las cuentas activas'); return; }
  try {
    await pmDB.insert('cost_presupuesto', nuevas, false);
    await cstGasCargar();
    cstGasRender();
    pmToast(`Se prepararon ${nuevas.length} renglón${nuevas.length === 1 ? '' : 'es'} ✓ — ahora escribí los montos`);
  } catch (e) {
    console.warn('[cstGasPreparar]', e.message);
    pmToast('⚠️ No se pudo preparar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstGasCargar();
    cstGasRender();
  }
}

function cstGasLlenarForm() {
  const sel = document.getElementById('cstgas-n-cuenta');
  if (sel) {
    sel.innerHTML = '<option value="">— Elegí la cuenta —</option>' + _cstGasCuentasActivas()
      .map(c => `<option value="${c.id}">${pmEsc(c.codigo + ' · ' + c.nombre)}</option>`).join('');
  }
  const dsel = document.getElementById('cstgas-n-depto');
  if (dsel) dsel.innerHTML = _cstGasDeptoOpts('');
  const cop = document.getElementById('cstgas-copiar');
  if (cop) cop.innerHTML = cstPerOtrosOpts();
}

function _cstGasDeptoOpts(actualId) {
  return `<option value="${CST_GAS_COMPARTIDA}" ${!actualId ? 'selected' : ''}>— Compartida —</option>` +
    _cstOpts(_cstDeps, actualId, d => d.codigo + ' · ' + d.nombre);
}

// Al elegir cuenta en el formulario, propone su departamento
function cstGasNuevoCuenta() {
  const c = _cstCuentas.find(x => x.id === _cstVal('cstgas-n-cuenta'));
  const dsel = document.getElementById('cstgas-n-depto');
  if (c && dsel) dsel.innerHTML = _cstGasDeptoOpts(c.depto_defecto_id || '');
}

async function cstGasAgregar() {
  const per = _cstPerActual();
  if (!per) { pmToast('Elegí o creá un período', 'err'); return; }
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  const cuentaId = _cstVal('cstgas-n-cuenta');
  const deptoId = _cstVal('cstgas-n-depto') || null;
  const monto = parseFloat(_cstVal('cstgas-n-monto'));
  const cuenta = _cstCuentas.find(c => c.id === cuentaId);
  if (!cuenta) { pmToast('Elegí la cuenta', 'err'); return; }
  if (isNaN(monto) || monto < 0) { pmToast('Escribí un monto de 0 o más', 'err'); return; }
  if (_cstGasRows.some(r => _cstGasKey(r.cuenta_id, r.depto_id) === _cstGasKey(cuentaId, deptoId))) {
    pmToast('Ya existe un renglón para esa cuenta y ese departamento — editá el monto', 'err'); return;
  }
  try {
    await pmDB.insert('cost_presupuesto', { periodo_id: per.id, cuenta_id: cuentaId, depto_id: deptoId, monto: cstRound(monto, 4, 'normal'), pct_variable: cuenta.pct_variable });
    const m = document.getElementById('cstgas-n-monto'); if (m) m.value = '';
    const c = document.getElementById('cstgas-n-cuenta'); if (c) c.value = '';
    await cstGasCargar();
    cstGasLlenarForm();
    cstGasRender();
    pmToast('Renglón agregado ✓');
  } catch (e) {
    console.warn('[cstGasAgregar]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
  }
}

async function cstGasCopiar() {
  const per = _cstPerActual();
  const origen = _cstVal('cstgas-copiar');
  if (!per) { pmToast('Elegí o creá un período', 'err'); return; }
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  if (!origen || origen === per.id) { pmToast('Elegí el período del que querés copiar', 'err'); return; }
  try {
    const src = await pmDB.get('cost_presupuesto', { periodo_id: origen });
    const ya = new Set(_cstGasRows.map(r => _cstGasKey(r.cuenta_id, r.depto_id)));
    const nuevas = (src || []).filter(r => !ya.has(_cstGasKey(r.cuenta_id, r.depto_id))).map(r => ({
      periodo_id: per.id, cuenta_id: r.cuenta_id, depto_id: r.depto_id || null, monto: Number(r.monto), pct_variable: Number(r.pct_variable),
    }));
    if (!nuevas.length) { pmToast(src && src.length ? 'Todos los renglones de ese período ya están aquí' : 'Ese período no tiene gastos cargados'); return; }
    const op = _cstPeriodos.find(p => p.id === origen);
    const m1 = Number(op ? op.meses : 1), m2 = Number(per.meses);
    if (m1 !== m2 && !confirm(`El período de origen abarca ${m1} mes${m1 === 1 ? '' : 'es'} y este ${m2}. Los montos se copian tal cual (no se ajustan por meses). ¿Continuar?`)) return;
    await pmDB.insert('cost_presupuesto', nuevas, false);
    await cstGasCargar();
    cstGasRender();
    pmToast(`Se copiaron ${nuevas.length} renglón${nuevas.length === 1 ? '' : 'es'} ✓ — revisá los montos`);
  } catch (e) {
    console.warn('[cstGasCopiar]', e.message);
    pmToast('⚠️ No se pudo copiar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstGasCargar();
    cstGasRender();
  }
}

// ── Ediciones en línea ──────────────────────────────────────
async function _cstGasGuardar(id, cambios, completo) {
  try {
    await pmDB.update('cost_presupuesto', id, cambios);
    const r = _cstGasRows.find(x => x.id === id);
    if (r) Object.assign(r, cambios);
    if (completo) cstGasRender(); else cstGasRenderResumen();
  } catch (e) {
    console.warn('[cstGasGuardar]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstGasCargar();
    cstGasRender();
  }
}

async function cstGasSetMonto(id, valor) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); cstGasRender(); return; }
  const m = parseFloat(valor);
  if (valor === '' || isNaN(m) || m < 0) { pmToast('Ingresá un monto de 0 o más', 'err'); cstGasRender(); return; }
  await _cstGasGuardar(id, { monto: cstRound(m, 4, 'normal') }, false);
}

async function cstGasSetPct(id, valor) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); cstGasRender(); return; }
  const p = parseFloat(valor);
  if (valor === '' || isNaN(p) || p < 0 || p > 100) { pmToast('El % variable va entre 0 y 100', 'err'); cstGasRender(); return; }
  await _cstGasGuardar(id, { pct_variable: cstRound(p, 2, 'normal') }, false);
}

async function cstGasSetDepto(id, valor) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); cstGasRender(); return; }
  const r = _cstGasRows.find(x => x.id === id);
  if (!r) return;
  const depto = valor || null;
  if (_cstGasRows.some(x => x.id !== id && _cstGasKey(x.cuenta_id, x.depto_id) === _cstGasKey(r.cuenta_id, depto))) {
    pmToast('Ya existe un renglón de esa cuenta en ese departamento — sumá los montos en uno solo', 'err');
    cstGasRender(); return;
  }
  await _cstGasGuardar(id, { depto_id: depto }, true);
}

async function cstGasEliminar(id) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  const r = _cstGasRows.find(x => x.id === id);
  if (!r) return;
  const c = _cstCuentas.find(x => x.id === r.cuenta_id);
  if (!confirm(`¿Quitar el renglón ${c ? c.codigo + ' · ' + c.nombre : ''} (${cstMoney(r.monto)})?`)) return;
  try {
    await pmDB.hardDelete('cost_presupuesto', id);
    await cstGasCargar();
    cstGasRender();
  } catch (e) {
    console.warn('[cstGasEliminar]', e.message);
    pmToast('⚠️ No se pudo quitar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
  }
}

// ── Cálculo (puro) ──────────────────────────────────────────
// Parte fija y variable de un renglón
function cstGasFV(r) {
  const v = r.monto * r.pct_variable / 100;
  return { f: r.monto - v, v };
}

// Bases que no sirven para repartir un gasto compartido
function _cstBaseNoReparte(driverId) {
  const d = _cstDrivers.find(x => x.id === driverId);
  return !d || d.codigo === 'DIRECTO' || d.codigo === 'PCT_VENTA';
}

function cstGasResumen() {
  const tot = { f: 0, v: 0 };
  const porDepto = {};        // clave: depto_id o '' (compartida)
  const avisos = [];
  const conMonto = new Set();
  _cstGasRows.forEach(r => {
    const { f, v } = cstGasFV(r);
    tot.f += f; tot.v += v;
    const k = r.depto_id || '';
    if (!porDepto[k]) porDepto[k] = { f: 0, v: 0 };
    porDepto[k].f += f; porDepto[k].v += v;
    if (r.monto > 0) conMonto.add(r.cuenta_id);
    if (!r.depto_id) {
      const c = _cstCuentas.find(x => x.id === r.cuenta_id);
      if (c && r.monto > 0 && _cstBaseNoReparte(c.base_reparto_id)) {
        avisos.push(`${c.codigo} · ${c.nombre} está como Compartida pero su base (${_cstDrvNombre(c.base_reparto_id) || 'sin base'}) no sirve para repartir — asignale un departamento`);
      }
    }
  });
  const sinMonto = _cstGasCuentasActivas().filter(c => !conMonto.has(c.id));
  return { tot, porDepto, avisos, sinMonto };
}

// ── Pintado ─────────────────────────────────────────────────
function cstGasRender() {
  const per = _cstPerActual();
  const estEl = document.getElementById('cstgas-estado');
  const listEl = document.getElementById('cstgas-lista');
  if (!listEl) return;
  ['cstgas-btn-prep', 'cstgas-btn-copiar', 'cstgas-btn-add'].forEach(i => {
    const b = document.getElementById(i);
    if (b) b.disabled = !per || per.estado !== 'borrador';
  });
  if (!per) {
    if (estEl) estEl.textContent = '';
    listEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral');
    cstGasRenderResumen();
    return;
  }
  if (estEl) {
    const col = per.estado === 'borrador' ? 'b0' : 'b3';
    estEl.innerHTML = `<span class="badge ${col}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${pmEsc(per.inicio)} → ${pmEsc(per.fin)} · los montos son el total de ${Number(per.meses)} ${Number(per.meses) === 1 ? 'mes' : 'meses'}</span>`;
  }
  const editable = per.estado === 'borrador';
  const stIn = 'padding:4px 8px;background:var(--sf);border:1px solid #CBD5E1;border-radius:6px;font-size:12px;text-align:right;font-family:\'DM Mono\',monospace';
  const stSel = 'padding:4px 6px;background:var(--sf);border:1px solid #CBD5E1;border-radius:6px;font-size:12px;width:100%';
  const lbl = 'font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2);display:block;margin-bottom:2px';
  if (!_cstGasRows.length) {
    listEl.innerHTML = _cstPh('💰', 'Todavía no hay gastos en este período — pulsá "Preparar renglones" o copiá de otro período');
    cstGasRenderResumen();
    return;
  }
  const filasPorSerie = {};
  _cstGasRows.forEach(r => {
    const c = _cstCuentas.find(x => x.id === r.cuenta_id);
    const s = c ? Number(c.serie) : 0;
    (filasPorSerie[s] = filasPorSerie[s] || []).push({ r, c });
  });
  listEl.innerHTML = Object.keys(filasPorSerie).map(Number).sort().map(s => {
    const filas = filasPorSerie[s].sort((a, b) =>
      ((a.c && a.c.codigo) || '').localeCompare((b.c && b.c.codigo) || '', 'es', { numeric: true }) ||
      _cstDepNombre(a.r.depto_id).localeCompare(_cstDepNombre(b.r.depto_id), 'es'));
    return `<div class="sec" style="margin-top:14px"><h2>${pmEsc(_cstSerieNombre(s))}</h2></div>` + filas.map(({ r, c }) => `
      <div class="card" style="padding:8px 10px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="min-width:0"><span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3)">${pmEsc(c ? c.codigo : '')}</span>
            <b style="margin-left:6px;font-size:13px">${pmEsc(c ? c.nombre : '(cuenta eliminada)')}</b>
            ${c && c.activo === false ? '<span class="badge b3" style="margin-left:6px">inactiva</span>' : ''}</div>
          ${editable ? `<button class="btn btn-red btn-sm" title="Quitar renglón" onclick="cstGasEliminar('${r.id}')" style="padding:2px 8px">✕</button>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:flex-end">
          <div style="flex:2 1 150px;min-width:130px"><span style="${lbl}">Departamento</span>
            ${editable ? `<select style="${stSel}" onchange="cstGasSetDepto('${r.id}', this.value)">${_cstGasDeptoOpts(r.depto_id || '')}</select>`
                       : `<b style="font-size:12px">${r.depto_id ? pmEsc(_cstDepNombre(r.depto_id)) : 'Compartida'}</b>`}</div>
          <div style="flex:1 1 110px"><span style="${lbl}">Monto del período</span>
            ${editable ? `<input type="number" min="0" step="any" value="${r.monto}" onchange="cstGasSetMonto('${r.id}', this.value)" style="${stIn};width:100%">`
                       : `<b style="font-family:'DM Mono',monospace">${cstMoney(r.monto)}</b>`}</div>
          <div style="flex:0 1 80px"><span style="${lbl}">% variable</span>
            ${editable ? `<input type="number" min="0" max="100" step="any" value="${r.pct_variable}" onchange="cstGasSetPct('${r.id}', this.value)" style="${stIn};width:100%">`
                       : `<b style="font-family:'DM Mono',monospace">${_cstFmtPct(r.pct_variable)}</b>`}</div>
        </div>
      </div>`).join('');
  }).join('');
  cstGasRenderResumen();
}

function cstGasRenderResumen() {
  const stats = document.getElementById('cstgas-stats');
  const avisosEl = document.getElementById('cstgas-avisos');
  const deptosEl = document.getElementById('cstgas-deptos');
  if (!stats || !avisosEl || !deptosEl) return;
  if (!_cstPerActual() || !_cstGasRows.length) { stats.innerHTML = ''; deptosEl.innerHTML = ''; }
  const rs = cstGasResumen();
  const total = rs.tot.f + rs.tot.v;
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  if (_cstPerActual() && _cstGasRows.length) {
    stats.innerHTML = stat('Gastos del período', cstMoney(total), `${_cstGasRows.length} renglón${_cstGasRows.length === 1 ? '' : 'es'}`) +
      stat('Fijo', cstMoney(rs.tot.f), total ? _cstFmtPct(rs.tot.f / total * 100) : '') +
      stat('Variable', cstMoney(rs.tot.v), total ? _cstFmtPct(rs.tot.v / total * 100) : '') +
      stat('Cuentas sin monto', String(rs.sinMonto.length), 'activas, series 5 a 8');
  }
  const av = rs.avisos.slice();
  if (_cstPerActual() && rs.sinMonto.length) {
    const nombres = rs.sinMonto.slice(0, 8).map(c => c.codigo + ' ' + c.nombre).join(' · ');
    av.unshift(`Sin monto: ${rs.sinMonto.length} cuenta${rs.sinMonto.length === 1 ? '' : 's'} (${nombres}${rs.sinMonto.length > 8 ? ' y ' + (rs.sinMonto.length - 8) + ' más' : ''}). Si no aplican este período, déjalas en cero.`);
  }
  avisosEl.innerHTML = av.length
    ? `<div class="card" style="border-color:var(--red)"><div class="ctitle" style="color:var(--red)">Revisar</div>${av.map(a => `<div style="font-size:12px;margin-bottom:3px">⚠ ${pmEsc(a)}</div>`).join('')}</div>`
    : '';
  // Totales por departamento
  const claves = Object.keys(rs.porDepto).filter(k => rs.porDepto[k].f + rs.porDepto[k].v > 0);
  if (!claves.length) { deptosEl.innerHTML = ''; return; }
  const orden = k => k === '' ? 'zzz' : ((_cstDeps.find(d => d.id === k) || {}).codigo || 'zz');
  claves.sort((a, b) => orden(a).localeCompare(orden(b), 'es', { numeric: true }));
  const celda = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
  const mono = ";text-align:right;font-family:'DM Mono',monospace";
  deptosEl.innerHTML = `
    <div class="sec"><h2>Gastos por departamento</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:420px">
        <thead><tr style="text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)">
          <th style="${celda}">Departamento</th><th style="${celda};text-align:right">Fijo</th><th style="${celda};text-align:right">Variable</th><th style="${celda};text-align:right">Total</th>
        </tr></thead>
        <tbody>${claves.map(k => {
          const d = _cstDeps.find(x => x.id === k);
          const x = rs.porDepto[k];
          return `<tr><td style="${celda}">${k === '' ? '<i>Compartida (se reparte por su base)</i>' : pmEsc(d ? d.codigo + ' · ' + d.nombre : '(departamento eliminado)')}</td>
            <td style="${celda}${mono}">${cstMoney(x.f)}</td><td style="${celda}${mono}">${cstMoney(x.v)}</td><td style="${celda}${mono}"><b>${cstMoney(x.f + x.v)}</b></td></tr>`;
        }).join('')}
        <tr><td style="${celda}"><b>Total</b></td><td style="${celda}${mono}"><b>${cstMoney(rs.tot.f)}</b></td><td style="${celda}${mono}"><b>${cstMoney(rs.tot.v)}</b></td><td style="${celda}${mono}"><b>${cstMoney(rs.tot.f + rs.tot.v)}</b></td></tr>
        </tbody>
      </table>
    </div>`;
}
