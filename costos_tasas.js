// costos_tasas.js — Módulo de Costos · Entrega 7: Tarifas y aprobación del período
// Prefijo cst (cstTas = pantalla, datos y aprobación; cstTasVivas/cstTasCostoProducto = motor puro)
// Depende de costos_core.js, costos_maestros.js, costos_personal.js, costos_laboral.js,
// costos_gastos.js, costos_capacidad.js y costos_rutas.js.
//
// DISEÑO: independiente del núcleo de PanMaestro. Tablas propias cost_tarifas y cost_periodo_base
// (sql_costos_tarifas.sql), colgadas de cost_periodos.
// Costeo estándar por absorción:
//   Tarifa MOD            = MOD del departamento ÷ HH productivas de la nómina        (por hora-hombre)
//   Tarifa CIF fija       = CIF fijo del departamento ÷ capacidad normal              (por unidad de su base)
//   Tarifa CIF variable   = CIF variable del departamento ÷ nivel normal              (por unidad de su base)
//   Tasa de gasto (capa 2)= gasto de venta + mercadeo + administración ÷ kg de ventas normales
// El consumo de un producto sale de su ruta (entrega 6):
//   base HH → min-HH ÷ 60 · base horas (horno, máquina, cámara) → minutos de reloj ÷ 60
//   base kg de masa → masa de la pieza (una vez por departamento) · base piezas → 1 (una vez por departamento)
//   costo de conversión = Σ por departamento: MOD (tarifa MOD × HH) + CIF fija y variable (tarifa × consumo de su base)
// Aprobar el período congela las tarifas en cost_tarifas y la tasa de gasto en cost_periodo_base;
// reabrirlo las borra y vuelve a borrador. Cerrar el período llega con las órdenes de producción.
// No incluye materiales ni empaque: eso se suma en los reportes (entrega 8) y en la conexión (entrega 9).

let _cstTasFilas = [];   // cost_tarifas del período seleccionado
let _cstTasBase = null;  // cost_periodo_base del período seleccionado
let _cstTasVer = 'pz';   // el cuadro de productos se ve por 'pz' o por 'kg'

const CST_TAS_HORAS = ['HORAS_HORNO', 'HORAS_MAQ', 'HORAS_CAMARA'];
const _CST_TAS_EPS = 0.00005;

// ── Motor (puro) ────────────────────────────────────────────
function _cstTasKg() {
  const k = _cstTasBase ? Number(_cstTasBase.kg_ventas_normales) : 0;
  return k > 0 ? k : 0;
}

// Tarifas calculadas con los datos que hay hoy en pantalla (períodos en borrador)
function cstTasVivas() {
  const c = cstRepartoCalc();
  const rs = cstLabResumen();
  const tarifas = c.prod.map(p => {
    const drv = p.fila ? _cstDrv(p.fila.driver_id) : null;
    const hh = rs.porDepto[p.depto.id] ? rs.porDepto[p.depto.id].hh : 0;
    return {
      depto_id: p.depto.id, depto: p.depto,
      driver_id: drv ? drv.id : '', driver_codigo: drv ? drv.codigo : '', unidad: drv ? (drv.unidad || '') : '',
      cap: p.cap, niv: p.niv, hh, mod: p.mod, cifF: p.cifF, cifV: p.cifV,
      tasaMod: hh > 0 ? p.mod / hh : (p.mod > 0 ? null : 0),
      tasaF: p.tasaF, tasaV: p.tasaV,
    };
  });
  const suma = tipo => c.gasto.filter(x => x.depto.tipo === tipo).reduce((a, x) => a + x.total, 0);
  const gasto = { venta: suma('venta'), mercadeo: suma('mercadeo'), admin: suma('administracion') };
  gasto.total = gasto.venta + gasto.mercadeo + gasto.admin;
  const kg = _cstTasKg();
  return { tarifas, gasto, kg, tasaKg: kg > 0 ? gasto.total / kg : null, sinRepartir: c.sinRepartir.f + c.sinRepartir.v, avisos: c.avisos, origen: 'vivo' };
}

// Tarifas congeladas al aprobar
function cstTasGuardadas() {
  const b = _cstTasBase;
  const tarifas = _cstTasFilas.map(f => ({
    depto_id: f.depto_id, depto: _cstDeps.find(d => d.id === f.depto_id) || { codigo: '?', nombre: '(departamento eliminado)', tipo: 'productivo' },
    driver_id: f.driver_id, driver_codigo: f.driver_codigo, unidad: f.unidad,
    cap: Number(f.capacidad_normal), niv: Number(f.nivel_normal), hh: Number(f.hh_productivas), mod: Number(f.mod_total),
    cifF: Number(f.cif_fijo), cifV: Number(f.cif_variable),
    tasaMod: Number(f.tasa_mod_hh), tasaF: Number(f.tasa_fija), tasaV: Number(f.tasa_var),
  })).sort((a, b) => a.depto.codigo.localeCompare(b.depto.codigo, 'es', { numeric: true }));
  const v = b ? Number(b.gasto_venta) || 0 : 0, m = b ? Number(b.gasto_mercadeo) || 0 : 0, a = b ? Number(b.gasto_admin) || 0 : 0;
  return {
    tarifas, gasto: { venta: v, mercadeo: m, admin: a, total: v + m + a },
    kg: b ? Number(b.kg_ventas_normales) || 0 : 0, tasaKg: b && b.tasa_gasto_kg !== null ? Number(b.tasa_gasto_kg) : null,
    sinRepartir: 0, avisos: [], origen: 'guardado',
  };
}

// Las tarifas que valen para el período elegido: las congeladas si está aprobado o cerrado
function cstTasActuales() {
  const per = _cstPerActual();
  return per && per.estado !== 'borrador' ? cstTasGuardadas() : cstTasVivas();
}

// Costo estándar de conversión de un producto (por pieza y por kg), con el desglose por departamento
function cstTasCostoProducto(prod, tas) {
  const ruta = _cstRutaDe(prod.id);
  const lineas = ruta ? _cstRutaLineas(ruta.id) : [];
  if (!ruta || !lineas.length) return { sinRuta: true, avisos: [], completo: false };
  const rc = cstRutaCalc(prod, ruta, lineas);
  const avisos = rc.avisos.slice();
  let completo = !rc.parcial;
  const cons = {};   // depto_id → consumo por pieza de cada base
  rc.filas.forEach(f => {
    const dId = f.etapa ? f.etapa.depto_id : '';
    const x = cons[dId] = cons[dId] || { hh: 0, h: 0, kg: rc.kgPz, pz: 1 };
    if (f.minPz !== null) { x.hh += f.hhPz / 60; x.h += f.minPz / 60; }
  });
  const porDepto = [];
  let mod = 0, fija = 0, vari = 0;
  Object.keys(cons).forEach(dId => {
    const x = cons[dId];
    const t = tas.tarifas.find(y => y.depto_id === dId);
    const dep = _cstDeps.find(d => d.id === dId);
    const nom = dep ? dep.nombre : 'departamento';
    if (!t) { avisos.push(`${nom}: tiene etapas en la ruta pero no tiene tarifa (no es un departamento productivo con capacidad)`); completo = false; return; }
    let q = null;
    if (t.driver_codigo === 'HH') q = x.hh;
    else if (CST_TAS_HORAS.includes(t.driver_codigo)) q = x.h;
    else if (t.driver_codigo === 'KG_MASA') q = x.kg;
    else if (t.driver_codigo === 'PIEZA') q = x.pz;
    const dm = x.hh * (t.tasaMod || 0);
    let df = 0, dv = 0;
    if (q === null) { avisos.push(`${nom}: la base ${t.driver_codigo || 'sin definir'} no se puede medir con la ruta`); completo = false; }
    else if (t.tasaF === null || t.tasaV === null) { avisos.push(`${nom}: la tarifa de CIF está incompleta (falta capacidad normal)`); completo = false; }
    else { df = t.tasaF * q; dv = t.tasaV * q; }
    if (t.tasaMod === null) { avisos.push(`${nom}: la tarifa de MOD está incompleta (hay MOD sin HH productivas)`); completo = false; }
    porDepto.push({ depto: dep || null, t, q, hh: x.hh, mod: dm, fija: df, vari: dv });
    mod += dm; fija += df; vari += dv;
  });
  const conv = mod + fija + vari;
  const capa2 = tas.tasaKg !== null && rc.kgPz > 0 ? tas.tasaKg * rc.kgPz : null;
  if (capa2 === null) completo = false;
  return { sinRuta: false, kgPz: rc.kgPz, porDepto, mod, fija, vari, conv, capa2, total: capa2 === null ? conv : conv + capa2, avisos, completo };
}

// Qué falta para aprobar (bloqueos) y qué conviene revisar (avisos)
function cstTasPendientes(v) {
  const bloqueos = [];
  if (!_cstLineas.length) bloqueos.push('El período no tiene nómina — generala en Costo laboral');
  if (!_cstGasRows.length) bloqueos.push('El período no tiene gastos — cargalos en Gastos del período');
  if (!v.tarifas.length) bloqueos.push('No hay departamentos productivos activos');
  v.tarifas.forEach(t => {
    const nom = t.depto.codigo + ' ' + t.depto.nombre;
    if (!t.driver_id) bloqueos.push(`${nom}: falta definir la base y la capacidad normal en Capacidad y reparto`);
    else if (t.tasaF === null || t.tasaV === null) bloqueos.push(`${nom}: la capacidad normal está vacía o en cero`);
    if (t.tasaMod === null) bloqueos.push(`${nom}: tiene MOD pero ninguna HH productiva — revisá el % de utilización y el reparto de tiempo`);
  });
  if (v.sinRepartir > _CST_TAS_EPS) bloqueos.push(`Quedan ${cstMoney(v.sinRepartir)} sin repartir — revisá Capacidad y reparto`);
  const rsN = cstLabResumen();
  const nomTotal = Object.values(rsN.porColab).reduce((a, x) => a + x, 0);
  const nomDist = rsN.tot.MOD + rsN.tot.MOI + rsN.tot.GASTO + rsN.tot.OCIOSA;
  if (Math.abs(nomTotal - nomDist) > 0.005) bloqueos.push(`${cstMoney(Math.abs(nomTotal - nomDist))} de la nómina ${nomDist < nomTotal ? 'no llega' : 'se cuenta de más'} a los departamentos — revisá el reparto de tiempo de cada colaborador en Personal`);
  if (!(v.kg > 0)) bloqueos.push('Falta indicar los kg de ventas normales del período (base de la tasa de gasto)');
  const avisos = v.avisos.filter(a => !/sin repartir|no tiene nómina|no tiene gastos|falta definir la base|capacidad normal está vacía|no se puede calcular la tarifa|base ni la capacidad|^Nómina:/i.test(a));
  return { bloqueos, avisos };
}

// ── Carga ───────────────────────────────────────────────────
async function cstTasInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  try {
    await cstPersonalDatos();
    await cstPerCargar();
    await cstRutDatos();
  } catch (e) {
    console.warn('[cstTasInit]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql, sql_costos_personal.sql, sql_costos_gastos.sql y sql_costos_rutas.sql'), 'err');
    return;
  }
  cstPerInicial();
  await cstTasCargar();
  cstPerLlenarSelectId('cstta-periodo');
  cstTasRender();
}

async function cstTasCargar() {
  await cstCapCargar();   // capacidad, reparto, gastos y nómina del período
  _cstTasFilas = []; _cstTasBase = null;
  if (!_cstPerSel) return;
  try {
    const [t, b] = await Promise.all([
      pmDB.get('cost_tarifas', { periodo_id: _cstPerSel }),
      pmDB.get('cost_periodo_base', { periodo_id: _cstPerSel }),
    ]);
    _cstTasFilas = t || [];
    _cstTasBase = b && b[0] ? b[0] : null;
  } catch (e) {
    console.warn('[cstTasCargar]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_tarifas.sql'), 'err');
  }
}

async function cstTasElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstTasRender();
}

// ── Kg de ventas normales ───────────────────────────────────
async function cstTasSetKg(valor) {
  const per = _cstPerActual();
  if (!per || per.estado !== 'borrador') { pmToast('El período no está en borrador', 'err'); return; }
  const txt = String(valor).trim();
  const n = txt === '' ? null : Number(txt);
  if (n !== null && (!isFinite(n) || n < 0)) { pmToast('Los kg de ventas normales deben ser un número mayor o igual a cero', 'err'); cstTasRender(); return; }
  try {
    if (_cstTasBase) {
      const r = await pmDB.update('cost_periodo_base', _cstTasBase.id, { kg_ventas_normales: n });
      Object.assign(_cstTasBase, { kg_ventas_normales: n }, r && r[0] ? { updated_at: r[0].updated_at } : {});
    } else {
      const r = await pmDB.insert('cost_periodo_base', { periodo_id: per.id, kg_ventas_normales: n });
      _cstTasBase = r && r[0] ? r[0] : { id: '', periodo_id: per.id, kg_ventas_normales: n };
    }
    cstTasRenderResumen();
  } catch (e) {
    console.warn('[cstTasSetKg]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_tarifas.sql'), 'err');
    await cstTasCargar();
    cstTasRender();
  }
}

function cstTasVer(modo) {
  _cstTasVer = modo === 'kg' ? 'kg' : 'pz';
  cstTasRenderResumen();
}

// ── Aprobación ──────────────────────────────────────────────
async function cstTasAprobar() {
  const per = _cstPerActual();
  if (!per) { pmToast('Elegí un período', 'err'); return; }
  if (per.estado !== 'borrador') { pmToast('El período ya no está en borrador', 'err'); return; }
  const v = cstTasVivas();
  const pend = cstTasPendientes(v);
  if (pend.bloqueos.length) { pmToast('Todavía no se puede aprobar: ' + pend.bloqueos[0] + (pend.bloqueos.length > 1 ? ` (y ${pend.bloqueos.length - 1} más)` : ''), 'err'); return; }
  const n = v.tarifas.length;
  const txt = `¿Aprobar el período ${per.codigo}? Se congelan ${n} tarifa${n === 1 ? '' : 's'} de departamento y la tasa de gasto de ${cstMoneyU(v.tasaKg)} por kg. ` +
    'Mientras esté aprobado no se pueden cambiar la nómina, los gastos ni la capacidad; para corregirlos hay que reabrirlo.' +
    (pend.avisos.length ? `\n\nOjo: quedan ${pend.avisos.length} aviso${pend.avisos.length === 1 ? '' : 's'} sin resolver (por ejemplo: ${pend.avisos[0]}).` : '');
  if (!confirm(txt)) return;
  let insertadas = [];
  try {
    const actual = await pmDB.getById('cost_periodos', per.id);
    if (!actual || actual.estado !== 'borrador' || (actual.updated_at && per.updated_at && actual.updated_at !== per.updated_at)) {
      pmToast('El período cambió en otro dispositivo o pestaña — se recargó, revisalo y probá de nuevo', 'err');
      await cstPerCargar(); await cstTasCargar(); cstPerLlenarSelectId('cstta-periodo'); cstTasRender();
      return;
    }
    for (const f of _cstTasFilas) await pmDB.hardDelete('cost_tarifas', f.id);   // restos de una aprobación anterior
    const filas = v.tarifas.map(t => ({
      periodo_id: per.id, depto_id: t.depto_id, driver_id: t.driver_id, driver_codigo: t.driver_codigo, unidad: t.unidad,
      capacidad_normal: cstRound(t.cap, 4, 'normal'), nivel_normal: cstRound(t.niv, 4, 'normal'),
      hh_productivas: cstRound(t.hh, 4, 'normal'), mod_total: cstRound(t.mod, 4, 'normal'),
      cif_fijo: cstRound(t.cifF, 4, 'normal'), cif_variable: cstRound(t.cifV, 4, 'normal'),
      tasa_mod_hh: cstRound(t.tasaMod, 8, 'normal'), tasa_fija: cstRound(t.tasaF, 8, 'normal'), tasa_var: cstRound(t.tasaV, 8, 'normal'),
    }));
    insertadas = await pmDB.insert('cost_tarifas', filas) || [];
    const base = { gasto_venta: cstRound(v.gasto.venta, 4, 'normal'), gasto_mercadeo: cstRound(v.gasto.mercadeo, 4, 'normal'), gasto_admin: cstRound(v.gasto.admin, 4, 'normal'), tasa_gasto_kg: cstRound(v.tasaKg, 8, 'normal') };
    if (_cstTasBase && _cstTasBase.id) await pmDB.update('cost_periodo_base', _cstTasBase.id, base);
    else await pmDB.insert('cost_periodo_base', Object.assign({ periodo_id: per.id, kg_ventas_normales: v.kg }, base));
    await pmDB.update('cost_periodos', per.id, { estado: 'aprobado', aprobado_en: new Date().toISOString() });
    pmToast(`Período ${per.codigo} aprobado ✓`);
  } catch (e) {
    console.warn('[cstTasAprobar]', e.message);
    pmToast('⚠️ No se pudo aprobar: ' + _cstErr(e, 'sql_costos_tarifas.sql'), 'err');
    for (const r of insertadas) { try { await pmDB.hardDelete('cost_tarifas', r.id); } catch (e2) { /* se limpia al reintentar */ } }
  }
  await cstPerCargar();
  await cstTasCargar();
  cstPerLlenarSelectId('cstta-periodo');
  cstTasRender();
}

async function cstTasReabrir() {
  const per = _cstPerActual();
  if (!per) return;
  if (per.estado !== 'aprobado') { pmToast(per.estado === 'cerrado' ? 'Un período cerrado no se puede reabrir' : 'El período ya está en borrador', 'err'); return; }
  if (!confirm(`¿Reabrir el período ${per.codigo}? Se borran las tarifas congeladas y vuelve a borrador para poder corregir nómina, gastos o capacidad. Tendrás que aprobarlo de nuevo.`)) return;
  try {
    await pmDB.update('cost_periodos', per.id, { estado: 'borrador', aprobado_en: null });
    for (const f of _cstTasFilas) await pmDB.hardDelete('cost_tarifas', f.id);
    if (_cstTasBase && _cstTasBase.id) await pmDB.update('cost_periodo_base', _cstTasBase.id, { gasto_venta: null, gasto_mercadeo: null, gasto_admin: null, tasa_gasto_kg: null });
    pmToast(`Período ${per.codigo} reabierto: vuelve a borrador`);
  } catch (e) {
    console.warn('[cstTasReabrir]', e.message);
    pmToast('⚠️ No se pudo reabrir: ' + _cstErr(e, 'sql_costos_tarifas.sql'), 'err');
  }
  await cstPerCargar();
  await cstTasCargar();
  cstPerLlenarSelectId('cstta-periodo');
  cstTasRender();
}

// ── Pintado ─────────────────────────────────────────────────
function _cstTasFecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function cstTasRender() {
  const per = _cstPerActual();
  const estEl = document.getElementById('cstta-estado');
  const kgEl = document.getElementById('cstta-kg');
  const btnEl = document.getElementById('cstta-btns');
  if (!estEl || !btnEl) return;
  if (!per) {
    estEl.textContent = '';
    btnEl.innerHTML = '';
    if (kgEl) { kgEl.value = ''; kgEl.disabled = true; }
    cstTasRenderResumen();
    return;
  }
  const col = per.estado === 'borrador' ? 'b0' : 'b3';
  estEl.innerHTML = `<span class="badge ${col}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${pmEsc(per.inicio)} → ${pmEsc(per.fin)} · ${Number(per.meses)} ${Number(per.meses) === 1 ? 'mes' : 'meses'}${per.estado !== 'borrador' && per.aprobado_en ? ' · aprobado el ' + pmEsc(_cstTasFecha(per.aprobado_en)) : ''}</span>`;
  if (kgEl) {
    kgEl.disabled = per.estado !== 'borrador';
    const k = _cstTasBase ? _cstTasBase.kg_ventas_normales : null;
    kgEl.value = k === null || k === undefined ? '' : Number(k);
  }
  btnEl.innerHTML = per.estado === 'borrador'
    ? '<button class="btn btn-gold btn-sm" onclick="cstTasAprobar()">✅ Aprobar período</button>'
    : per.estado === 'aprobado'
      ? '<button class="btn btn-out btn-sm" onclick="cstTasReabrir()">↩ Reabrir (volver a borrador)</button>'
      : '<span style="font-size:11px;color:var(--cream2)">Período cerrado: no admite cambios</span>';
  cstTasRenderResumen();
}

function cstTasRenderResumen() {
  const stats = document.getElementById('cstta-stats');
  const avisosEl = document.getElementById('cstta-avisos');
  const tarEl = document.getElementById('cstta-tarifas');
  const prodEl = document.getElementById('cstta-prod');
  if (!stats || !avisosEl || !tarEl || !prodEl) return;
  const per = _cstPerActual();
  if (!per) {
    stats.innerHTML = ''; avisosEl.innerHTML = ''; prodEl.innerHTML = '';
    tarEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral');
    return;
  }
  const guardado = per.estado !== 'borrador';
  const v = guardado ? cstTasGuardadas() : cstTasVivas();
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const sum = k => v.tarifas.reduce((a, t) => a + t[k], 0);
  let ocioso = 0;
  try { ocioso = cstRepartoCalc().ocioso || 0; } catch (e) { console.warn('[cstTasRender ocioso]', e.message); }
  stats.innerHTML = stat('MOD del período', cstMoney(sum('mod')), 'departamentos productivos') +
    stat('CIF fijo', cstMoney(sum('cifF')), 'después del reparto') +
    stat('CIF variable', cstMoney(sum('cifV')), 'después del reparto') +
    stat('Gasto del período', cstMoney(v.gasto.total), 'venta · mercadeo · admin.') +
    stat('Gasto por kg vendido', v.tasaKg === null ? '—' : cstMoneyU(v.tasaKg), v.kg > 0 ? 'sobre ' + _cstNum(v.kg) + ' kg' : 'faltan los kg normales') +
    (ocioso > 0 ? stat('Capacidad ociosa', cstMoney(ocioso), 'horas sin trabajo · no va a las piezas') : '');

  // Avisos y estado de la aprobación
  if (guardado) {
    avisosEl.innerHTML = `<div class="card" style="border-color:var(--green,#22A06B)"><div style="font-size:12px">✓ ${per.estado === 'cerrado' ? 'Período cerrado' : 'Período aprobado'}: las tarifas de abajo están congeladas${per.aprobado_en ? ' desde el ' + pmEsc(_cstTasFecha(per.aprobado_en)) : ''}. ${per.estado === 'aprobado' ? 'Para corregir algo hay que reabrirlo.' : ''}</div></div>`;
  } else {
    const p = cstTasPendientes(v);
    avisosEl.innerHTML = p.bloqueos.length || p.avisos.length
      ? `<div class="card" style="border-color:var(--red)">${p.bloqueos.length ? `<div class="ctitle" style="color:var(--red)">Falta para poder aprobar</div>${p.bloqueos.map(a => `<div style="font-size:12px;margin-bottom:3px">⛔ ${pmEsc(a)}</div>`).join('')}` : ''}
        ${p.avisos.length ? `<div class="ctitle" style="margin-top:${p.bloqueos.length ? 8 : 0}px">A revisar</div>${p.avisos.map(a => `<div style="font-size:12px;margin-bottom:3px">⚠ ${pmEsc(a)}</div>`).join('')}` : ''}</div>`
      : '<div class="card" style="border-color:var(--green,#22A06B)"><div style="font-size:12px">✓ Todo listo: el período se puede aprobar</div></div>';
  }

  // Tarifas por departamento
  const celda = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
  const mono = ";text-align:right;font-family:'DM Mono',monospace";
  const th = (t, r) => `<th style="${celda}${r ? ';text-align:right' : ''}">${t}</th>`;
  const head = 'text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)';
  const rate = (x, u) => x === null ? '<span style="color:var(--red)">—</span>' : cstMoneyU(x) + '/' + pmEsc(u || 'u');
  tarEl.innerHTML = v.tarifas.length ? `
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:720px">
        <thead><tr style="${head}">${th('Departamento')}${th('Base')}${th('Capacidad normal', 1)}${th('MOD por HH', 1)}${th('CIF fija', 1)}${th('CIF variable', 1)}</tr></thead>
        <tbody>${v.tarifas.map(t => `<tr>
          <td style="${celda}">${pmEsc(t.depto.codigo + ' · ' + t.depto.nombre)}</td>
          <td style="${celda}">${t.driver_id ? pmEsc(_cstDrvNombre(t.driver_id)) : '<span style="color:var(--red)">sin definir</span>'}</td>
          <td style="${celda}${mono}">${t.cap > 0 ? _cstNum(t.cap) + ' ' + pmEsc(t.unidad || 'u') : '—'}${t.niv > 0 && t.niv !== t.cap ? `<div style="font-size:10px;color:var(--cream2)">nivel ${_cstNum(t.niv)}</div>` : ''}</td>
          <td style="${celda}${mono}">${rate(t.tasaMod, 'HH')}</td>
          <td style="${celda}${mono}">${rate(t.tasaF, t.unidad)}</td>
          <td style="${celda}${mono}">${rate(t.tasaV, t.unidad)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">MOD por HH = MOD del departamento ÷ HH productivas · CIF fija = CIF fijo ÷ capacidad normal · CIF variable = CIF variable ÷ nivel normal${guardado ? ' · valores congelados al aprobar' : ' · cálculo en vivo, se congela al aprobar'}.</div>`
    : _cstPh('🏭', 'No hay departamentos productivos con tarifa en este período');

  // Costo de conversión por producto
  const x = _cstTasVer === 'kg' ? 'kg' : 'pz';
  const prods = _cstRutProd.map(p => ({ p, c: cstTasCostoProducto(p, v) }));
  const con = prods.filter(y => !y.c.sinRuta);
  const sin = prods.length - con.length;
  const f = y => x === 'kg' ? (y.c.kgPz > 0 ? 1 / y.c.kgPz : null) : 1;
  const val = (y, k) => { const m = f(y); return m === null || y.c[k] === null ? null : y.c[k] * m; };
  const cel = (y, k, neg) => { const n = !y.c.completo && y.c.conv === 0 ? null : val(y, k); return `<td style="${celda}${mono}${neg ? ';font-weight:600' : ''}">${n === null ? '—' : cstMoneyU(n)}</td>`; };
  prodEl.innerHTML = `
    <div class="sec" style="margin-top:14px"><h2>Costo de conversión por producto</h2></div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--cream2)">Ver por:</span>
      <button class="btn btn-sm ${x === 'pz' ? 'btn-gold' : 'btn-out'}" onclick="cstTasVer('pz')">pieza</button>
      <button class="btn btn-sm ${x === 'kg' ? 'btn-gold' : 'btn-out'}" onclick="cstTasVer('kg')">kg</button>
    </div>` + (con.length ? `
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:700px">
        <thead><tr style="${head}">${th('Producto')}${th('MOD', 1)}${th('CIF fija', 1)}${th('CIF variable', 1)}${th('Conversión', 1)}${th('Gasto del período', 1)}${th('Total sin materiales', 1)}</tr></thead>
        <tbody>${con.map(y => `<tr>
          <td style="${celda}">${pmEsc(y.p.nombre)}${y.c.avisos.length || !y.c.completo ? `<span title="${pmEsc(y.c.avisos.join(' · ') || 'Cálculo incompleto')}" style="color:var(--red);margin-left:4px;cursor:help">⚠</span>` : ''}</td>
          ${cel(y, 'mod')}${cel(y, 'fija')}${cel(y, 'vari')}${cel(y, 'conv', 1)}${cel(y, 'capa2')}${cel(y, 'total', 1)}</tr>`).join('')}
        </tbody>
      </table>
    </div>` : _cstPh('🧭', 'Ningún producto tiene ruta todavía — armalas en Etapas y rutas')) +
    `<div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">${sin ? `${sin} producto${sin === 1 ? '' : 's'} sin ruta no aparece${sin === 1 ? '' : 'n'}. ` : ''}No incluye materiales ni empaque: esos se suman en los reportes. El gasto del período es la tasa por kg × la masa de la pieza.</div>`;
}
