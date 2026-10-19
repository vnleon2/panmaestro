// costos_capacidad.js — Módulo de Costos · Entrega 5: Capacidad y reparto del período
// Prefijo cst (cstCap = pantalla y datos, cstRepartoCalc = cálculo del reparto)
// Depende de costos_core.js, costos_maestros.js, costos_personal.js, costos_laboral.js y costos_gastos.js.
//
// DISEÑO: independiente del núcleo de PanMaestro. Tablas propias cost_capacidad y
// cost_reparto (sql_costos_gastos.sql), colgadas de cost_periodos.
// - Capacidad: por departamento productivo, la base de absorción (HH, horas-horno, kg de masa...)
//   y su capacidad normal del período (denominador de la tarifa fija) y su nivel normal
//   (denominador de la tarifa variable; vacío = igual a la capacidad normal).
//   Por departamento de apoyo: solo la base con que se reparte su costo a producción.
// - Bases de reparto: cantidad de cada base por departamento (m², kWh, HH...). Se piden solo
//   las bases que hacen falta: las de los gastos compartidos y las de los departamentos de apoyo.
// - Reparto (método directo): 1) cada gasto compartido se reparte entre departamentos por su base;
//    2) el costo de cada departamento de apoyo (gastos propios + MOI) se reparte solo entre los
//    departamentos productivos por su base. Venta, mercadeo y administración no se reparten:
//    son gasto del período.
// - La parte fija y la variable de cada gasto viajan por separado hasta la tarifa.
// - Las tarifas que se muestran son una VISTA PREVIA de referencia; la tarifa oficial, el costo
//   estándar y la aprobación del período llegan en la entrega 7.

let _cstCapRows = [];   // cost_capacidad del período
let _cstRepRows = [];   // cost_reparto del período

const CST_DRV_SIN_REPARTO = ['DIRECTO', 'PCT_VENTA'];   // bases que no sirven para repartir

// ── Utilidades ──────────────────────────────────────────────
function _cstCapDeps(tipos) {
  return _cstDeps.filter(d => d.activo !== false && tipos.includes(d.tipo))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}
function _cstCapFila(deptoId) { return _cstCapRows.find(r => r.depto_id === deptoId) || null; }
function _cstDrv(id) { return _cstDrivers.find(d => d.id === id) || null; }
function _cstDrvPorCodigo(cod) { return _cstDrivers.find(d => d.codigo === cod && d.activo !== false) || null; }
function _cstCantidad(driverId, deptoId) {
  const r = _cstRepRows.find(x => x.driver_id === driverId && x.depto_id === deptoId);
  return r ? Number(r.cantidad) : 0;
}
function _cstNum(n, dec) { return Number(n).toLocaleString('es-CR', { maximumFractionDigits: dec === undefined ? 2 : dec }); }
function _cstDrvTxt(d) { return d ? d.nombre + (d.unidad ? ' (' + d.unidad + ')' : '') : '—'; }

// Opciones de bases utilizables (activas, sin las que no reparten)
function _cstCapDrvOpts(actualId) {
  return _cstDrivers.filter(d => (d.activo !== false || d.id === actualId) && !CST_DRV_SIN_REPARTO.includes(d.codigo))
    .map(d => `<option value="${d.id}" ${d.id === actualId ? 'selected' : ''}>${pmEsc(_cstDrvTxt(d))}</option>`).join('');
}

// ── Carga ───────────────────────────────────────────────────
async function cstCapInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  try {
    await cstPersonalDatos();
    await cstPerCargar();
  } catch (e) {
    console.warn('[cstCapInit]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql, sql_costos_personal.sql y sql_costos_gastos.sql'), 'err');
    return;
  }
  cstPerInicial();
  await cstCapCargar();
  cstPerLlenarSelectId('cstcap-periodo');
  cstCapLlenarForm();
  cstCapRender();
}

async function cstCapCargar() {
  _cstCapRows = []; _cstRepRows = []; _cstGasRows = [];
  if (!_cstPerSel) { _cstLineas = []; return; }
  try {
    const [cap, rep, gas] = await Promise.all([
      pmDB.get('cost_capacidad', { periodo_id: _cstPerSel }),
      pmDB.get('cost_reparto', { periodo_id: _cstPerSel }),
      pmDB.get('cost_presupuesto', { periodo_id: _cstPerSel }),
    ]);
    _cstCapRows = (cap || []).map(r => Object.assign({}, r, {
      capacidad_normal: r.capacidad_normal === null ? null : Number(r.capacidad_normal),
      nivel_normal: r.nivel_normal === null ? null : Number(r.nivel_normal),
    }));
    _cstRepRows = (rep || []).map(r => Object.assign({}, r, { cantidad: Number(r.cantidad) }));
    _cstGasRows = (gas || []).map(r => Object.assign({}, r, { monto: Number(r.monto), pct_variable: Number(r.pct_variable) }));
  } catch (e) {
    console.warn('[cstCapCargar]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
  }
  await cstLabCargarLineas();   // nómina del período (MOD, MOI, gasto)
}

async function cstCapElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstCapCargar();
  cstCapLlenarForm();
  cstCapRender();
}

function cstCapLlenarForm() {
  const cop = document.getElementById('cstcap-copiar');
  if (cop) cop.innerHTML = cstPerOtrosOpts();
}

// ── Altas ───────────────────────────────────────────────────
// Crea la fila de cada departamento productivo y de apoyo que todavía no la tenga
async function cstCapPreparar() {
  const per = _cstPerActual();
  if (!per) { pmToast('Elegí o creá un período', 'err'); return; }
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  const hh = _cstDrvPorCodigo('HH');
  const maq = _cstDrvPorCodigo('HORAS_MAQ') || hh;
  const rs = cstLabResumen();
  const nuevas = [];
  _cstCapDeps(['productivo', 'apoyo']).forEach(d => {
    if (_cstCapFila(d.id)) return;
    const drv = d.tipo === 'productivo' ? hh : maq;
    if (!drv) return;
    const hhNom = rs.porDepto[d.id] ? rs.porDepto[d.id].hh : 0;
    nuevas.push({
      periodo_id: per.id, depto_id: d.id, driver_id: drv.id,
      capacidad_normal: d.tipo === 'productivo' && drv.codigo === 'HH' && hhNom > 0 ? cstRound(hhNom, 1, 'normal') : null,
      nivel_normal: null,
    });
  });
  if (!nuevas.length) { pmToast(hh ? 'Ya están todos los departamentos productivos y de apoyo' : 'Falta la base "Horas-hombre" en el maestro de bases', hh ? undefined : 'err'); return; }
  try {
    await pmDB.insert('cost_capacidad', nuevas, false);
    await cstCapCargar();
    cstCapRender();
    pmToast(`Se prepararon ${nuevas.length} departamento${nuevas.length === 1 ? '' : 's'} ✓ — revisá la base y la capacidad de cada uno`);
  } catch (e) {
    console.warn('[cstCapPreparar]', e.message);
    pmToast('⚠️ No se pudo preparar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstCapCargar();
    cstCapRender();
  }
}

async function cstCapCopiar() {
  const per = _cstPerActual();
  const origen = _cstVal('cstcap-copiar');
  if (!per) { pmToast('Elegí o creá un período', 'err'); return; }
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  if (!origen || origen === per.id) { pmToast('Elegí el período del que querés copiar', 'err'); return; }
  try {
    const [cap, rep] = await Promise.all([pmDB.get('cost_capacidad', { periodo_id: origen }), pmDB.get('cost_reparto', { periodo_id: origen })]);
    const yaCap = new Set(_cstCapRows.map(r => r.depto_id));
    const yaRep = new Set(_cstRepRows.map(r => r.driver_id + '|' + r.depto_id));
    const nCap = (cap || []).filter(r => !yaCap.has(r.depto_id)).map(r => ({
      periodo_id: per.id, depto_id: r.depto_id, driver_id: r.driver_id,
      capacidad_normal: r.capacidad_normal === null ? null : Number(r.capacidad_normal),
      nivel_normal: r.nivel_normal === null ? null : Number(r.nivel_normal),
    }));
    const nRep = (rep || []).filter(r => !yaRep.has(r.driver_id + '|' + r.depto_id)).map(r => ({
      periodo_id: per.id, driver_id: r.driver_id, depto_id: r.depto_id, cantidad: Number(r.cantidad),
    }));
    if (!nCap.length && !nRep.length) { pmToast((cap && cap.length) || (rep && rep.length) ? 'Todo lo de ese período ya está aquí' : 'Ese período no tiene capacidad ni bases cargadas'); return; }
    const op = _cstPeriodos.find(p => p.id === origen);
    const m1 = Number(op ? op.meses : 1), m2 = Number(per.meses);
    if (m1 !== m2 && !confirm(`El período de origen abarca ${m1} mes${m1 === 1 ? '' : 'es'} y este ${m2}. La capacidad se copia tal cual (no se ajusta por meses). ¿Continuar?`)) return;
    if (nCap.length) await pmDB.insert('cost_capacidad', nCap, false);
    if (nRep.length) await pmDB.insert('cost_reparto', nRep, false);
    await cstCapCargar();
    cstCapRender();
    pmToast(`Copiado ✓ (${nCap.length} departamento${nCap.length === 1 ? '' : 's'}, ${nRep.length} cantidad${nRep.length === 1 ? '' : 'es'}) — revisá los valores`);
  } catch (e) {
    console.warn('[cstCapCopiar]', e.message);
    pmToast('⚠️ No se pudo copiar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstCapCargar();
    cstCapRender();
  }
}

// ── Ediciones en línea ──────────────────────────────────────
async function _cstCapGuardar(id, cambios, completo) {
  try {
    await pmDB.update('cost_capacidad', id, cambios);
    const r = _cstCapRows.find(x => x.id === id);
    if (r) Object.assign(r, cambios);
    if (completo) cstCapRender(); else cstCapRenderResumen();
  } catch (e) {
    console.warn('[cstCapGuardar]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstCapCargar();
    cstCapRender();
  }
}

async function cstCapSetDriver(id, valor) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); cstCapRender(); return; }
  if (!valor) { cstCapRender(); return; }
  await _cstCapGuardar(id, { driver_id: valor }, true);
}

async function cstCapSetNum(id, campo, valor) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); cstCapRender(); return; }
  let n = null;
  if (valor !== '') {
    n = parseFloat(valor);
    if (isNaN(n) || n < 0) { pmToast('Ingresá un valor de 0 o más', 'err'); cstCapRender(); return; }
    n = cstRound(n, 4, 'normal');
  }
  if (n === null && campo === 'capacidad_normal') { /* queda sin definir: la validación lo avisa */ }
  await _cstCapGuardar(id, { [campo]: n }, false);
}

// Usa las HH productivas de la nómina como capacidad normal
async function cstCapUsarHH(id) {
  const r = _cstCapRows.find(x => x.id === id);
  if (!r) return;
  const rs = cstLabResumen();
  const hh = rs.porDepto[r.depto_id] ? rs.porDepto[r.depto_id].hh : 0;
  if (!(hh > 0)) { pmToast('Ese departamento no tiene HH productivas en la nómina del período', 'err'); return; }
  await _cstCapGuardar(id, { capacidad_normal: cstRound(hh, 1, 'normal') }, true);
}

// Guarda la cantidad de una base en un departamento (vacío = quita el dato)
async function _cstRepGuardar(driverId, deptoId, valor) {
  const ex = _cstRepRows.find(x => x.driver_id === driverId && x.depto_id === deptoId);
  if (valor === '' || valor === null) {
    if (ex) { await pmDB.hardDelete('cost_reparto', ex.id); _cstRepRows = _cstRepRows.filter(x => x.id !== ex.id); }
    return;
  }
  const n = cstRound(parseFloat(valor), 4, 'normal');
  if (ex) {
    await pmDB.update('cost_reparto', ex.id, { cantidad: n });
    ex.cantidad = n;
  } else {
    const rows = await pmDB.insert('cost_reparto', { periodo_id: _cstPerSel, driver_id: driverId, depto_id: deptoId, cantidad: n });
    const nueva = (rows && rows[0]) || { id: 'tmp-' + Math.random(), periodo_id: _cstPerSel, driver_id: driverId, depto_id: deptoId };
    nueva.cantidad = n;
    _cstRepRows.push(nueva);
  }
}

async function cstCapSetCant(driverId, deptoId, valor) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); cstCapRender(); return; }
  if (valor !== '') {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0) { pmToast('Ingresá una cantidad de 0 o más', 'err'); cstCapRender(); return; }
  }
  try {
    await _cstRepGuardar(driverId, deptoId, valor);
    cstCapRenderResumen();
  } catch (e) {
    console.warn('[cstCapSetCant]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstCapCargar();
    cstCapRender();
  }
}

// Llena la base HH con las HH productivas de la nómina de cada departamento
async function cstCapLlenarHH(driverId) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  const rs = cstLabResumen();
  const conHH = Object.values(rs.porDepto).filter(x => x.hh > 0);
  if (!conHH.length) { pmToast('La nómina del período no tiene HH productivas — generá la nómina en Costo laboral', 'err'); return; }
  try {
    for (const x of conHH) await _cstRepGuardar(driverId, x.depto.id, String(cstRound(x.hh, 1, 'normal')));
    cstCapRender();
    pmToast('Se llenó con las HH productivas de la nómina ✓');
  } catch (e) {
    console.warn('[cstCapLlenarHH]', e.message);
    pmToast('⚠️ No se pudo llenar: ' + _cstErr(e, 'sql_costos_gastos.sql'), 'err');
    await cstCapCargar();
    cstCapRender();
  }
}

// ── Qué bases hacen falta ───────────────────────────────────
// [{ driver, motivos:[texto], alcance:'todos'|'produccion' }]
function cstCapBasesNecesarias() {
  const mapa = {};
  const add = (driverId, motivo, alcance) => {
    const d = _cstDrv(driverId);
    if (!d || CST_DRV_SIN_REPARTO.includes(d.codigo)) return;
    if (!mapa[d.id]) mapa[d.id] = { driver: d, motivos: [], alcance: 'produccion' };
    if (!mapa[d.id].motivos.includes(motivo)) mapa[d.id].motivos.push(motivo);
    if (alcance === 'todos') mapa[d.id].alcance = 'todos';
  };
  _cstGasRows.forEach(r => {
    if (r.depto_id || !(r.monto > 0)) return;
    const c = _cstCuentas.find(x => x.id === r.cuenta_id);
    if (c) add(c.base_reparto_id, `reparte ${c.codigo} ${c.nombre}`, 'todos');
  });
  _cstCapDeps(['apoyo']).forEach(d => {
    const f = _cstCapFila(d.id);
    if (f) add(f.driver_id, `reparte el costo de ${d.nombre} a producción`, 'produccion');
  });
  return Object.values(mapa).sort((a, b) => a.driver.codigo.localeCompare(b.driver.codigo));
}

// ── Cálculo del reparto (método directo) ────────────────────
function cstRepartoCalc() {
  const R = {};
  const get = id => {
    if (!R[id]) R[id] = { dep: _cstDeps.find(d => d.id === id) || null, dirF: 0, dirV: 0, comF: 0, comV: 0, nomF: 0, mod: 0, apoF: 0, apoV: 0, trasF: 0, trasV: 0 };
    return R[id];
  };
  _cstDeps.filter(d => d.activo !== false).forEach(d => get(d.id));
  const sinRepartir = { f: 0, v: 0, detalle: [] };
  const avisos = [];

  // 1. Gastos: directos y compartidos
  _cstGasRows.forEach(r => {
    if (!(r.monto > 0)) return;
    const { f, v } = cstGasFV(r);
    if (r.depto_id) { const x = get(r.depto_id); x.dirF += f; x.dirV += v; return; }
    const c = _cstCuentas.find(k => k.id === r.cuenta_id);
    const nom = c ? c.codigo + ' ' + c.nombre : 'cuenta';
    if (!c || _cstBaseNoReparte(c.base_reparto_id)) {
      sinRepartir.f += f; sinRepartir.v += v; sinRepartir.detalle.push(nom + ' (la base no sirve para repartir)'); return;
    }
    const qs = _cstDeps.map(d => ({ id: d.id, q: _cstCantidad(c.base_reparto_id, d.id) })).filter(x => x.q > 0);
    const tq = qs.reduce((a, x) => a + x.q, 0);
    if (!(tq > 0)) { sinRepartir.f += f; sinRepartir.v += v; sinRepartir.detalle.push(nom + ' (la base ' + _cstDrvNombre(c.base_reparto_id) + ' suma cero)'); return; }
    qs.forEach(x => { const d = get(x.id); d.comF += f * x.q / tq; d.comV += v * x.q / tq; });
  });

  // 2. Nómina: MOD aparte; MOI y gasto de personal son costo fijo del departamento
  const rs = cstLabResumen();
  Object.values(rs.porDepto).forEach(x => {
    const d = get(x.depto.id);
    if (cstTratamiento(x.depto.tipo) === 'MOD') d.mod += x.costo; else d.nomF += x.costo;
  });

  // 3. Departamentos de apoyo → producción (directo)
  const productivos = _cstCapDeps(['productivo']);
  _cstCapDeps(['apoyo']).forEach(a => {
    const x = get(a.id);
    const F = x.dirF + x.comF + x.nomF, V = x.dirV + x.comV;
    if (!(F + V > 0)) return;
    const fila = _cstCapFila(a.id);
    const qs = fila ? productivos.map(p => ({ id: p.id, q: _cstCantidad(fila.driver_id, p.id) })).filter(y => y.q > 0) : [];
    const tq = qs.reduce((s, y) => s + y.q, 0);
    if (!(tq > 0)) {
      sinRepartir.f += F; sinRepartir.v += V;
      sinRepartir.detalle.push(a.nombre + (fila ? ' (la base ' + _cstDrvNombre(fila.driver_id) + ' suma cero en producción)' : ' (sin base de reparto)'));
      return;
    }
    qs.forEach(y => { const p = get(y.id); p.apoF += F * y.q / tq; p.apoV += V * y.q / tq; });
    x.trasF = F; x.trasV = V;
  });

  // 4. Resultado por tipo de departamento
  const prod = productivos.map(d => {
    const x = get(d.id);
    const fila = _cstCapFila(d.id);
    const cifF = x.dirF + x.comF + x.nomF + x.apoF, cifV = x.dirV + x.comV + x.apoV;
    const cap = fila && fila.capacidad_normal > 0 ? fila.capacidad_normal : 0;
    const niv = fila ? (fila.nivel_normal > 0 ? fila.nivel_normal : cap) : 0;
    return Object.assign({}, x, { depto: d, fila, cifF, cifV, cap, niv,
      tasaF: cap > 0 ? cifF / cap : null, tasaV: niv > 0 ? cifV / niv : null });
  });
  const apoyo = _cstCapDeps(['apoyo']).map(d => {
    const x = get(d.id);
    return Object.assign({}, x, { depto: d, fila: _cstCapFila(d.id), propio: x.dirF + x.dirV + x.comF + x.comV + x.nomF });
  });
  const gasto = _cstCapDeps(['venta', 'mercadeo', 'administracion']).map(d => {
    const x = get(d.id);
    return Object.assign({}, x, { depto: d, total: x.dirF + x.dirV + x.comF + x.comV + x.nomF });
  });
  const total = {
    cifF: prod.reduce((a, x) => a + x.cifF, 0), cifV: prod.reduce((a, x) => a + x.cifV, 0),
    gasto: gasto.reduce((a, x) => a + x.total, 0), mod: prod.reduce((a, x) => a + x.mod, 0),
  };

  // Validaciones
  prod.forEach(p => {
    if (!p.fila) avisos.push(`${p.depto.nombre}: falta definir la base y la capacidad normal (usá "Preparar departamentos")`);
    else if (!(p.cap > 0)) avisos.push(`${p.depto.nombre}: la capacidad normal está vacía o en cero — no se puede calcular la tarifa`);
    else if (p.fila.nivel_normal !== null && p.fila.nivel_normal > p.cap) avisos.push(`${p.depto.nombre}: el nivel normal supera la capacidad normal`);
  });
  apoyo.forEach(a => {
    if (!a.fila && a.propio > 0) avisos.push(`${a.depto.nombre}: tiene costo pero no se le definió la base para repartirlo a producción`);
  });
  cstCapBasesNecesarias().forEach(b => {
    const dest = b.alcance === 'todos' ? _cstCapDeps(['productivo', 'apoyo', 'venta', 'mercadeo', 'administracion']) : productivos;
    const tq = dest.reduce((s, d) => s + _cstCantidad(b.driver.id, d.id), 0);
    if (!(tq > 0)) avisos.push(`La base ${b.driver.nombre} suma cero: cargá las cantidades por departamento (${b.motivos.join('; ')})`);
  });
  if (sinRepartir.f + sinRepartir.v > 0) avisos.push(`Quedan ${cstMoney(sinRepartir.f + sinRepartir.v)} sin repartir: ${sinRepartir.detalle.join('; ')}`);
  if (!_cstLineas.length) avisos.push('El período no tiene nómina: MOD y MOI no están incluidos — generala en Costo laboral');
  if (!_cstGasRows.length) avisos.push('El período no tiene gastos cargados — cargalos en Gastos del período');
  return { R, prod, apoyo, gasto, total, sinRepartir, avisos };
}

// ── Pintado ─────────────────────────────────────────────────
function cstCapRender() {
  const per = _cstPerActual();
  const estEl = document.getElementById('cstcap-estado');
  const capEl = document.getElementById('cstcap-cap');
  const basesEl = document.getElementById('cstcap-bases');
  if (!capEl || !basesEl) return;
  ['cstcap-btn-prep', 'cstcap-btn-copiar'].forEach(i => { const b = document.getElementById(i); if (b) b.disabled = !per || per.estado !== 'borrador'; });
  if (!per) {
    if (estEl) estEl.textContent = '';
    capEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral');
    basesEl.innerHTML = '';
    cstCapRenderResumen();
    return;
  }
  if (estEl) {
    const col = per.estado === 'borrador' ? 'b0' : 'b3';
    estEl.innerHTML = `<span class="badge ${col}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${pmEsc(per.inicio)} → ${pmEsc(per.fin)} · las cantidades son del período completo (${Number(per.meses)} ${Number(per.meses) === 1 ? 'mes' : 'meses'})</span>`;
  }
  const editable = per.estado === 'borrador';
  const stIn = 'padding:4px 8px;background:var(--sf);border:1px solid #CBD5E1;border-radius:6px;font-size:12px;text-align:right;font-family:\'DM Mono\',monospace;width:100%';
  const stSel = 'padding:4px 6px;background:var(--sf);border:1px solid #CBD5E1;border-radius:6px;font-size:12px;width:100%';
  const lbl = 'font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2);display:block;margin-bottom:2px';

  // A. Capacidad
  const deps = _cstCapDeps(['productivo', 'apoyo']);
  const rs = cstLabResumen();
  capEl.innerHTML = deps.length ? deps.map(d => {
    const f = _cstCapFila(d.id);
    const prod = d.tipo === 'productivo';
    const drv = f ? _cstDrv(f.driver_id) : null;
    const hhNom = rs.porDepto[d.id] ? rs.porDepto[d.id].hh : 0;
    const badge = `<span class="badge ${prod ? 'b0' : 'b3'}" style="margin-left:6px">${prod ? 'productivo' : 'apoyo'}</span>`;
    if (!f) return `<div class="card" style="padding:8px 10px;margin-bottom:6px"><b style="font-size:13px">${pmEsc(d.codigo + ' · ' + d.nombre)}</b>${badge}
        <div style="font-size:11px;color:var(--red);margin-top:4px">Sin definir — pulsá "Preparar departamentos"</div></div>`;
    return `<div class="card" style="padding:8px 10px;margin-bottom:6px">
      <div><span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3)">${pmEsc(d.codigo)}</span>
        <b style="margin-left:6px;font-size:13px">${pmEsc(d.nombre)}</b>${badge}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:flex-end">
        <div style="flex:2 1 160px;min-width:140px"><span style="${lbl}">${prod ? 'Base de absorción' : 'Base para repartir su costo a producción'}</span>
          ${editable ? `<select style="${stSel}" onchange="cstCapSetDriver('${f.id}', this.value)">${_cstCapDrvOpts(f.driver_id)}</select>` : `<b style="font-size:12px">${pmEsc(_cstDrvTxt(drv))}</b>`}</div>
        ${prod ? `
        <div style="flex:1 1 110px"><span style="${lbl}">Capacidad normal${drv && drv.unidad ? ' (' + pmEsc(drv.unidad) + ')' : ''}</span>
          ${editable ? `<input type="number" min="0" step="any" value="${f.capacidad_normal === null ? '' : f.capacidad_normal}" onchange="cstCapSetNum('${f.id}','capacidad_normal',this.value)" style="${stIn}">` : `<b style="font-family:'DM Mono',monospace">${f.capacidad_normal === null ? '—' : _cstNum(f.capacidad_normal)}</b>`}</div>
        <div style="flex:1 1 110px"><span style="${lbl}">Nivel normal (vacío = capacidad)</span>
          ${editable ? `<input type="number" min="0" step="any" value="${f.nivel_normal === null ? '' : f.nivel_normal}" placeholder="${f.capacidad_normal === null ? '' : f.capacidad_normal}" onchange="cstCapSetNum('${f.id}','nivel_normal',this.value)" style="${stIn}">` : `<b style="font-family:'DM Mono',monospace">${f.nivel_normal === null ? '—' : _cstNum(f.nivel_normal)}</b>`}</div>` : ''}
      </div>
      ${prod && drv && drv.codigo === 'HH' && hhNom > 0 ? `<div style="font-size:11px;color:var(--cream2);margin-top:5px">HH productivas en la nómina: <b>${_cstNum(hhNom, 1)}</b>${editable ? ` · <a href="#" onclick="cstCapUsarHH('${f.id}');return false" style="color:var(--gold2)">usar como capacidad</a>` : ''}</div>` : ''}
    </div>`;
  }).join('') : _cstPh('🏭', 'No hay departamentos productivos ni de apoyo activos');

  // B. Bases de reparto
  const bases = cstCapBasesNecesarias();
  const todos = _cstCapDeps(['productivo', 'apoyo', 'venta', 'mercadeo', 'administracion']);
  const prodDeps = _cstCapDeps(['productivo']);
  basesEl.innerHTML = bases.length ? bases.map(b => {
    const dest = b.alcance === 'todos' ? todos : prodDeps;
    return `<div class="card" style="padding:8px 10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="font-size:13px">${pmEsc(_cstDrvTxt(b.driver))}</b>
        <span id="cstcap-sum-${b.driver.id}" style="font-size:12px"></span>
      </div>
      <div style="font-size:11px;color:var(--cream2);margin:2px 0 6px">${pmEsc(b.motivos.join(' · '))}${b.alcance === 'produccion' ? ' — solo cuentan los departamentos productivos' : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px">
        ${dest.map(d => {
          const ex = _cstRepRows.find(x => x.driver_id === b.driver.id && x.depto_id === d.id);
          return `<div><span style="${lbl}">${pmEsc(d.codigo + ' · ' + d.nombre)}</span>
            ${editable ? `<input type="number" min="0" step="any" value="${ex ? ex.cantidad : ''}" onchange="cstCapSetCant('${b.driver.id}','${d.id}',this.value)" style="${stIn}">` : `<b style="font-family:'DM Mono',monospace;font-size:12px">${ex ? _cstNum(ex.cantidad) : '—'}</b>`}</div>`;
        }).join('')}
      </div>
      ${editable && b.driver.codigo === 'HH' ? `<div style="margin-top:6px"><button class="btn btn-out btn-sm" onclick="cstCapLlenarHH('${b.driver.id}')">↻ Llenar con las HH de la nómina</button></div>` : ''}
    </div>`;
  }).join('') : _cstPh('📐', 'No hay bases por cargar todavía: aparecen cuando hay gastos compartidos o departamentos de apoyo con base');
  cstCapRenderResumen();
}

function cstCapRenderResumen() {
  const stats = document.getElementById('cstcap-stats');
  const avisosEl = document.getElementById('cstcap-avisos');
  const prevEl = document.getElementById('cstcap-prev');
  if (!stats || !avisosEl || !prevEl) return;
  // Sumas de las tarjetas de bases
  cstCapBasesNecesarias().forEach(b => {
    const el = document.getElementById('cstcap-sum-' + b.driver.id);
    if (!el) return;
    const dest = b.alcance === 'todos' ? _cstCapDeps(['productivo', 'apoyo', 'venta', 'mercadeo', 'administracion']) : _cstCapDeps(['productivo']);
    const t = dest.reduce((s, d) => s + _cstCantidad(b.driver.id, d.id), 0);
    el.innerHTML = t > 0 ? `Total: <b style="font-family:'DM Mono',monospace">${_cstNum(t)}</b>` : '<b style="color:var(--red)">Suma cero</b>';
  });
  if (!_cstPerActual()) { stats.innerHTML = ''; avisosEl.innerHTML = ''; prevEl.innerHTML = ''; return; }

  const c = cstRepartoCalc();
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const cif = c.total.cifF + c.total.cifV;
  stats.innerHTML = stat('CIF de producción', cstMoney(cif), 'después del reparto') +
    stat('Fijo', cstMoney(c.total.cifF), cif ? _cstFmtPct(c.total.cifF / cif * 100) : '') +
    stat('Variable', cstMoney(c.total.cifV), cif ? _cstFmtPct(c.total.cifV / cif * 100) : '') +
    stat('MOD', cstMoney(c.total.mod), 'de la nómina') +
    stat('Gasto del período', cstMoney(c.total.gasto), 'venta · mercadeo · admin.') +
    stat('Sin repartir', cstMoney(c.sinRepartir.f + c.sinRepartir.v), c.sinRepartir.f + c.sinRepartir.v > 0 ? 'revisar' : 'todo repartido');
  avisosEl.innerHTML = c.avisos.length
    ? `<div class="card" style="border-color:var(--red)"><div class="ctitle" style="color:var(--red)">Revisar</div>${c.avisos.map(a => `<div style="font-size:12px;margin-bottom:3px">⚠ ${pmEsc(a)}</div>`).join('')}</div>`
    : '<div class="card" style="border-color:var(--green,#22A06B)"><div style="font-size:12px">✓ Capacidad y bases completas: sin observaciones</div></div>';

  const celda = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
  const mono = ";text-align:right;font-family:'DM Mono',monospace";
  const th = (t, r) => `<th style="${celda}${r ? ';text-align:right' : ''}">${t}</th>`;
  const head = 'text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)';
  const un = p => { const d = p.fila ? _cstDrv(p.fila.driver_id) : null; return d && d.unidad ? d.unidad : 'u'; };
  const tprod = c.prod.length ? `
    <div class="sec"><h2>Vista previa · departamentos de producción</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:760px">
        <thead><tr style="${head}">${th('Departamento')}${th('Gastos propios', 1)}${th('Compartidos', 1)}${th('De apoyo', 1)}${th('CIF fijo', 1)}${th('CIF variable', 1)}${th('Capacidad', 1)}${th('Tarifa fija', 1)}${th('Tarifa variable', 1)}</tr></thead>
        <tbody>${c.prod.map(p => `<tr>
          <td style="${celda}">${pmEsc(p.depto.codigo + ' · ' + p.depto.nombre)}</td>
          <td style="${celda}${mono}">${cstMoney(p.dirF + p.dirV)}</td>
          <td style="${celda}${mono}">${cstMoney(p.comF + p.comV)}</td>
          <td style="${celda}${mono}">${cstMoney(p.apoF + p.apoV)}</td>
          <td style="${celda}${mono}">${cstMoney(p.cifF)}</td>
          <td style="${celda}${mono}">${cstMoney(p.cifV)}</td>
          <td style="${celda}${mono}">${p.cap > 0 ? _cstNum(p.cap) + ' ' + pmEsc(un(p)) : '—'}</td>
          <td style="${celda}${mono}">${p.tasaF === null ? '—' : cstMoneyU(p.tasaF) + '/' + pmEsc(un(p))}</td>
          <td style="${celda}${mono}">${p.tasaV === null ? '—' : cstMoneyU(p.tasaV) + '/' + pmEsc(un(p))}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">Tarifa fija = CIF fijo ÷ capacidad normal · Tarifa variable = CIF variable ÷ nivel normal. Referencia: la tarifa oficial se fija en la entrega 7.</div>` : '';
  const otros = c.apoyo.concat(c.gasto);
  const totros = otros.length ? `
    <div class="sec" style="margin-top:14px"><h2>Vista previa · apoyo y gasto del período</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:520px">
        <thead><tr style="${head}">${th('Departamento')}${th('Tratamiento')}${th('Costo del departamento', 1)}${th('Destino')}</tr></thead>
        <tbody>${otros.map(x => {
          const esApoyo = x.depto.tipo === 'apoyo';
          const total = esApoyo ? x.propio : x.total;
          const dest = esApoyo ? (x.trasF + x.trasV > 0 ? 'Se reparte a producción por ' + pmEsc(_cstDrvNombre(x.fila ? x.fila.driver_id : '')) : (total > 0 ? '<span style="color:var(--red)">Sin repartir</span>' : '—')) : 'Gasto del período';
          return `<tr><td style="${celda}">${pmEsc(x.depto.codigo + ' · ' + x.depto.nombre)}</td><td style="${celda}">${pmEsc(_cstTipoDep(x.depto.tipo).nombre)}</td>
            <td style="${celda}${mono}">${cstMoney(total)}</td><td style="${celda}">${dest}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '';
  prevEl.innerHTML = tprod + totros;
}
