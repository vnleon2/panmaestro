// costos_plan.js — Módulo de Costos · Plan de producción del período
// Prefijo cst (cstPln = pantalla y datos, cstPlnCalc = cálculo puro)
// Depende de costos_core.js, costos_maestros.js, costos_personal.js, costos_laboral.js,
// costos_gastos.js, costos_capacidad.js, costos_rutas.js y costos_tasas.js.
//
// DISEÑO: instrumento del módulo de Costos (más adelante será parte del MRP). Tabla propia
// cost_plan (sql_costos_plan.sql), colgada de cost_periodos. Lee productos, rutas y tarifas;
// NUNCA escribe en ellos.
// - El plan es una SEMANA TIPO: por cada producto, la cantidad de piezas que estará disponible
//   como producto terminado cada día (lunes a domingo). El mes sale de multiplicar por las
//   semanas del período (días del período ÷ 7).
// - Cada pieza consume su ruta (entrega 6): horas-hombre por departamento, horas de reloj
//   (horno, máquina, cámara) y kg de masa. Se mide contra lo que el período tiene de capacidad:
//     · base de cada departamento productivo (kg de masa, horas-horno, HH...) ÷ su capacidad normal
//     · horas-hombre usadas ÷ horas-hombre productivas de la nómina del departamento
// - Simplificación: el consumo se cuenta el día en que el producto queda disponible; no se
//   adelanta al día en que realmente se amasa u hornea.

let _cstPlnRows = [];    // cost_plan del período seleccionado
let _cstPlnIds = [];     // productos que están en la hoja (con cantidades o recién agregados)

const CST_PLN_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const CST_PLN_OK = 85;   // % de uso hasta el cual la capacidad se considera holgada
const _CST_PLN_COL = { ok: '#2f855a', medio: '#b7791f', alto: 'var(--red)' };

// ── Utilidades ──────────────────────────────────────────────
function _cstPlnProd(id) { return _cstRutProd.find(p => p.id === id) || null; }
function _cstPlnCant(prodId, dia) {
  const r = _cstPlnRows.find(x => x.producto_id === prodId && Number(x.dia) === dia);
  return r ? Number(r.cantidad) : 0;
}
function _cstPlnSemanas() {
  const per = _cstPerActual();
  if (!per || !per.inicio || !per.fin) return 0;
  const a = new Date(per.inicio + 'T00:00:00'), b = new Date(per.fin + 'T00:00:00');
  const dias = Math.round((b - a) / 86400000) + 1;
  return dias > 0 ? dias / 7 : 0;
}
function _cstPlnColor(pct) { return pct > 100 ? _CST_PLN_COL.alto : pct > CST_PLN_OK ? _CST_PLN_COL.medio : _CST_PLN_COL.ok; }
function _cstPlnFmt(n, dec) { return n === null || n === undefined || isNaN(n) ? '—' : _cstNum(n, dec === undefined ? 1 : dec); }

// ── Cálculo (puro) ──────────────────────────────────────────
// ids: productos de la hoja · cant(prodId, dia): piezas · semanas · tarifas: tarifas por departamento
// Devuelve el consumo por producto, los totales por día y el uso de capacidad por departamento.
function cstPlnCalc(ids, cant, semanas, tarifas) {
  const filas = [];
  const dia0 = () => [0, 0, 0, 0, 0, 0, 0];
  const tot = { pz: dia0(), kg: dia0(), hh: dia0() };
  const horasDia = {};                     // depto_id → piezas·horas por día (solo bases de horas)
  const dem = {};                          // depto_id → { q, hh } por semana
  tarifas.forEach(t => { dem[t.depto_id] = { q: 0, hh: 0, h: 0 }; });
  const avisos = [];

  ids.forEach(id => {
    const prod = _cstPlnProd(id);
    if (!prod) return;
    const dias = [1, 2, 3, 4, 5, 6, 7].map(d => cant(id, d));
    const pzSem = dias.reduce((a, x) => a + x, 0);
    const ruta = _cstRutaDe(id);
    const lineas = ruta ? _cstRutaLineas(ruta.id) : [];
    const sinRuta = !ruta || !lineas.length;
    const rc = sinRuta ? null : cstRutaCalc(prod, ruta, lineas);
    const kgPz = rc ? rc.kgPz : cstMasaPiezaKg(prod, null);
    const f = { prod, dias, pzSem, kgPz, kgSem: pzSem * kgPz, hhPz: 0, hhSem: 0, sinRuta, avisos: [] };
    if (sinRuta) f.avisos.push('no tiene ruta: no consume horas, solo suma kg');
    else rc.avisos.forEach(a => f.avisos.push(a));
    if (!(kgPz > 0)) f.avisos.push('no tiene masa por pieza (peso del producto o de la ruta)');

    const cons = {};                       // depto_id → { hh, h } por pieza
    if (rc) {
      rc.filas.forEach(x => {
        const dId = x.etapa ? x.etapa.depto_id : '';
        const c = cons[dId] = cons[dId] || { hh: 0, h: 0 };
        if (x.minPz !== null) { c.hh += x.hhPz / 60; c.h += x.minPz / 60; }
      });
    }
    Object.keys(cons).forEach(dId => { f.hhPz += cons[dId].hh; });
    f.hhSem = f.hhPz * pzSem;

    // consumo semanal de cada departamento según su base
    tarifas.forEach(t => {
      const c = cons[t.depto_id] || { hh: 0, h: 0 };
      let q = null;
      if (t.driver_codigo === 'HH') q = c.hh;
      else if (CST_TAS_HORAS.includes(t.driver_codigo)) q = c.h;
      else if (t.driver_codigo === 'KG_MASA') q = cons[t.depto_id] ? kgPz : 0;
      else if (t.driver_codigo === 'PIEZA') q = cons[t.depto_id] ? 1 : 0;
      const d = dem[t.depto_id];
      if (q === null) { if (pzSem > 0 && !avisos.includes(t.depto.nombre)) avisos.push(t.depto.nombre); }
      else d.q += q * pzSem;
      d.hh += c.hh * pzSem;
      d.h += c.h * pzSem;
      if (CST_TAS_HORAS.includes(t.driver_codigo)) {
        const arr = horasDia[t.depto_id] = horasDia[t.depto_id] || dia0();
        dias.forEach((n, i) => { arr[i] += c.h * n; });
      }
    });
    dias.forEach((n, i) => { tot.pz[i] += n; tot.kg[i] += n * kgPz; tot.hh[i] += n * f.hhPz; });
    filas.push(f);
  });

  const deptos = tarifas.map(t => {
    const d = dem[t.depto_id];
    const qMes = d.q * semanas, hhMes = d.hh * semanas;
    const cap = t.cap > 0 ? t.cap : 0;
    const hhDisp = t.hh > 0 ? t.hh : 0;
    return {
      t, qSem: d.q, qMes, cap, pct: cap > 0 ? qMes / cap * 100 : null,
      hhSem: d.hh, hhMes, hhDisp, pctHH: hhDisp > 0 ? hhMes / hhDisp * 100 : null,
      horas: horasDia[t.depto_id] || null,
    };
  });
  const sum = a => a.reduce((x, y) => x + y, 0);
  return {
    filas, deptos, tot, avisosBase: avisos,
    pzSem: sum(tot.pz), kgSem: sum(tot.kg), hhSem: sum(tot.hh),
    pzMes: sum(tot.pz) * semanas, kgMes: sum(tot.kg) * semanas, hhMes: sum(tot.hh) * semanas,
  };
}

function _cstPlnCalcular() {
  const tas = cstTasActuales();
  return cstPlnCalc(_cstPlnIds, _cstPlnCant, _cstPlnSemanas(), tas.tarifas);
}

// ── Carga ───────────────────────────────────────────────────
async function cstPlnInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  try {
    await cstPersonalDatos();
    await cstPerCargar();
    await cstRutDatos();
  } catch (e) {
    console.warn('[cstPlnInit]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql, sql_costos_personal.sql, sql_costos_gastos.sql, sql_costos_rutas.sql y sql_costos_plan.sql'), 'err');
    return;
  }
  cstPerInicial();
  await cstPlnCargar();
  cstPerLlenarSelectId('cstpl-periodo');
  cstPlnRender();
}

async function cstPlnCargar() {
  await cstTasCargar();   // capacidad, reparto, nómina, gastos y tarifas del período
  _cstPlnRows = []; _cstPlnIds = [];
  if (!_cstPerSel) return;
  try {
    const r = await pmDB.get('cost_plan', { periodo_id: _cstPerSel });
    _cstPlnRows = (r || []).map(x => Object.assign({}, x, { dia: Number(x.dia), cantidad: Number(x.cantidad) }));
  } catch (e) {
    console.warn('[cstPlnCargar]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_plan.sql'), 'err');
  }
  const vistos = {};
  _cstPlnRows.forEach(r => { if (!vistos[r.producto_id] && _cstPlnProd(r.producto_id)) { vistos[r.producto_id] = true; _cstPlnIds.push(r.producto_id); } });
  _cstPlnIds.sort((a, b) => _cstPlnProd(a).nombre.localeCompare(_cstPlnProd(b).nombre, 'es'));
}

async function cstPlnElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstPlnCargar();
  cstPlnRender();
}

// ── Edición ─────────────────────────────────────────────────
function cstPlnAgregar() {
  const sel = document.getElementById('cstpl-agregar');
  const id = sel ? sel.value : '';
  if (!id) { pmToast('Elegí un producto de la lista', 'err'); return; }
  if (!_cstPlnIds.includes(id)) _cstPlnIds.push(id);
  cstPlnRender();
}

async function cstPlnQuitar(prodId) {
  const filas = _cstPlnRows.filter(r => r.producto_id === prodId);
  const p = _cstPlnProd(prodId);
  if (filas.length && !confirm(`¿Quitar "${p ? p.nombre : 'el producto'}" del plan? Se borran sus cantidades de la semana.`)) return;
  try {
    for (const r of filas) await pmDB.hardDelete('cost_plan', r.id);
    _cstPlnRows = _cstPlnRows.filter(r => r.producto_id !== prodId);
    _cstPlnIds = _cstPlnIds.filter(x => x !== prodId);
  } catch (e) {
    console.warn('[cstPlnQuitar]', e.message);
    pmToast('⚠️ No se pudo quitar: ' + _cstErr(e, 'sql_costos_plan.sql'), 'err');
    await cstPlnCargar();
  }
  cstPlnRender();
}

async function cstPlnSetCant(prodId, dia, valor) {
  const txt = String(valor).trim();
  const n = txt === '' ? 0 : parseFloat(txt.replace(',', '.'));
  if (isNaN(n) || n < 0) { pmToast('Ingresá una cantidad de 0 o más', 'err'); cstPlnRender(); return; }
  const ex = _cstPlnRows.find(x => x.producto_id === prodId && x.dia === dia);
  try {
    if (n === 0) {
      if (ex) { await pmDB.hardDelete('cost_plan', ex.id); _cstPlnRows = _cstPlnRows.filter(x => x.id !== ex.id); }
    } else if (ex) {
      await pmDB.update('cost_plan', ex.id, { cantidad: n });
      ex.cantidad = n;
    } else {
      const rows = await pmDB.insert('cost_plan', { periodo_id: _cstPerSel, producto_id: prodId, dia, cantidad: n });
      const nueva = (rows && rows[0]) || { id: 'tmp-' + Math.random(), periodo_id: _cstPerSel, producto_id: prodId, dia };
      nueva.dia = dia; nueva.cantidad = n;
      _cstPlnRows.push(nueva);
    }
  } catch (e) {
    console.warn('[cstPlnSetCant]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_plan.sql'), 'err');
    await cstPlnCargar();
    cstPlnRender();
    return;
  }
  cstPlnActualizar();
}

// ── Pantalla ────────────────────────────────────────────────
const _CST_PLN_TH = 'padding:6px 8px;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--cream2);text-align:right;white-space:nowrap;border-bottom:1px solid #E2E8F0';
const _CST_PLN_TD = 'padding:5px 8px;text-align:right;font-family:\'DM Mono\',monospace;font-size:12px;white-space:nowrap;border-bottom:1px solid #F1F5F9';
const _CST_PLN_IN = 'width:58px;text-align:right;font-family:\'DM Mono\',monospace;font-size:12px;padding:4px 5px';

function cstPlnRender() {
  const per = _cstPerActual();
  const estEl = document.getElementById('cstpl-estado');
  const tabEl = document.getElementById('cstpl-tabla');
  if (!estEl || !tabEl) return;
  if (!per) {
    estEl.textContent = '';
    ['cstpl-stats', 'cstpl-avisos', 'cstpl-cap'].forEach(i => { const e = document.getElementById(i); if (e) e.innerHTML = ''; });
    tabEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral y cargá sus datos');
    return;
  }
  const sem = _cstPlnSemanas();
  estEl.innerHTML = `<span class="badge ${per.estado === 'borrador' ? 'b0' : 'b3'}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${pmEsc(per.inicio)} → ${pmEsc(per.fin)} · ${_cstNum(sem, 2)} semanas · el plan es una semana tipo × las semanas del período</span>`;

  // selector de productos que faltan por agregar
  const libres = _cstRutProd.filter(p => !_cstPlnIds.includes(p.id));
  const grupos = {};
  libres.forEach(p => { (grupos[p.tipo || 'otro'] = grupos[p.tipo || 'otro'] || []).push(p); });
  const rotulo = { pan: 'Panes', galleta: 'Galletas', otro: 'Otros' };
  const opts = Object.keys(grupos).map(g => `<optgroup label="${pmEsc(rotulo[g] || g)}">${grupos[g].map(p => `<option value="${p.id}">${pmEsc(p.nombre)}${_cstRutaDe(p.id) ? '' : ' (sin ruta)'}</option>`).join('')}</optgroup>`).join('');
  const agregar = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div style="flex:2 1 240px"><label>Agregar producto al plan</label><select id="cstpl-agregar"><option value="">— Elegí un pan o galleta —</option>${opts}</select></div>
      <button class="btn btn-gold btn-sm" onclick="cstPlnAgregar()">+ Agregar</button></div>`;

  if (!_cstPlnIds.length) {
    tabEl.innerHTML = agregar + _cstPh('🗓️', 'El plan está vacío — agregá el primer producto y asigná cuántas piezas tendrás disponibles cada día');
    cstPlnActualizar();
    return;
  }
  const fila = id => {
    const p = _cstPlnProd(id);
    const celdas = [1, 2, 3, 4, 5, 6, 7].map(d => {
      const v = _cstPlnCant(id, d);
      return `<td style="${_CST_PLN_TD};padding:3px 4px"><input type="number" min="0" step="any" value="${v || ''}" placeholder="0" onchange="cstPlnSetCant('${id}',${d},this.value)" style="${_CST_PLN_IN}"></td>`;
    }).join('');
    return `<tr id="cstpl-fila-${id}">
      <td style="${_CST_PLN_TD};text-align:left;font-family:inherit;min-width:190px;white-space:normal">${pmEsc(p.nombre)}<div id="cstpl-av-${id}" style="font-size:10px;color:var(--red)"></div></td>
      <td style="${_CST_PLN_TD}" id="cstpl-kgpz-${id}"></td>${celdas}
      <td style="${_CST_PLN_TD}" id="cstpl-pz-${id}"></td>
      <td style="${_CST_PLN_TD}" id="cstpl-kg-${id}"></td>
      <td style="${_CST_PLN_TD}" id="cstpl-hh-${id}"></td>
      <td style="${_CST_PLN_TD}"><button class="btn btn-out btn-sm" title="Quitar del plan" onclick="cstPlnQuitar('${id}')">✕</button></td></tr>`;
  }
  tabEl.innerHTML = agregar + `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr><th style="${_CST_PLN_TH};text-align:left">Producto</th><th style="${_CST_PLN_TH}">kg/pz</th>
      ${CST_PLN_DIAS.map(d => `<th style="${_CST_PLN_TH}">${d}</th>`).join('')}
      <th style="${_CST_PLN_TH}">Pz/sem</th><th style="${_CST_PLN_TH}">Kg/sem</th><th style="${_CST_PLN_TH}">HH/sem</th><th style="${_CST_PLN_TH}"></th></tr></thead>
    <tbody>${_cstPlnIds.map(fila).join('')}</tbody>
    <tfoot id="cstpl-pie"></tfoot></table></div>
    <div style="font-size:11px;color:var(--cream2);margin-top:6px">Cantidad = piezas que estarán disponibles como producto terminado ese día. Cada cambio se guarda al salir de la celda.</div>`;
  cstPlnActualizar();
}

// Recalcula totales y capacidad sin tocar las celdas editables (no pierde el foco)
function cstPlnActualizar() {
  const per = _cstPerActual();
  if (!per) return;
  const r = _cstPlnCalcular();
  const sem = _cstPlnSemanas();
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  r.filas.forEach(f => {
    set('cstpl-kgpz-' + f.prod.id, f.kgPz > 0 ? _cstNum(f.kgPz, 3) : '—');
    set('cstpl-pz-' + f.prod.id, _cstPlnFmt(f.pzSem, 1));
    set('cstpl-kg-' + f.prod.id, _cstPlnFmt(f.kgSem, 2));
    set('cstpl-hh-' + f.prod.id, f.sinRuta ? '—' : _cstPlnFmt(f.hhSem, 2));
    const av = document.getElementById('cstpl-av-' + f.prod.id);
    if (av) av.textContent = f.avisos.length ? '⚠ ' + f.avisos[0] : '';
  });

  // pie de la tabla: totales por día
  const pie = document.getElementById('cstpl-pie');
  if (pie) {
    const fila = (rot, arr, tot, dec, extra) => `<tr style="font-weight:600"><td style="${_CST_PLN_TD};text-align:left;font-family:inherit">${rot}</td><td style="${_CST_PLN_TD}"></td>
      ${arr.map(v => `<td style="${_CST_PLN_TD}">${v > 0 ? _cstNum(v, dec) : '·'}</td>`).join('')}
      <td style="${_CST_PLN_TD}">${extra ? '' : _cstPlnFmt(tot, dec)}</td><td style="${_CST_PLN_TD}"></td><td style="${_CST_PLN_TD}"></td><td style="${_CST_PLN_TD}"></td></tr>`;
    let h = fila('Piezas del día', r.tot.pz, r.pzSem, 1) + fila('Kg de masa del día', r.tot.kg, r.kgSem, 2) + fila('Horas-hombre del día', r.tot.hh, r.hhSem, 2);
    r.deptos.forEach(d => {
      if (d.horas) h += fila('Horas de ' + pmEsc(d.t.depto.nombre.toLowerCase()) + ' del día', d.horas, d.horas.reduce((a, x) => a + x, 0), 2);
    });
    pie.innerHTML = h;
  }

  // resumen
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const conPct = r.deptos.filter(d => d.pct !== null);
  const tope = conPct.length ? conPct.reduce((a, d) => (d.pct > a.pct ? d : a)) : null;
  const kgNorm = _cstTasKg();
  const stats = document.getElementById('cstpl-stats');
  if (stats) stats.innerHTML =
    stat('Piezas por semana', _cstPlnFmt(r.pzSem, 0), `${_cstPlnFmt(r.pzMes, 0)} en el período`) +
    stat('Kg de masa por semana', _cstPlnFmt(r.kgSem, 1), `${_cstPlnFmt(r.kgMes, 1)} kg en el período`) +
    stat('Horas-hombre por semana', _cstPlnFmt(r.hhSem, 1), `${_cstPlnFmt(r.hhMes, 1)} h en el período`) +
    stat('Uso del plan vs kg normales', kgNorm > 0 ? _cstPlnFmt(r.kgMes / kgNorm * 100, 0) + ' %' : '—', kgNorm > 0 ? `kg normales de ventas: ${_cstNum(kgNorm, 0)}` : 'definí los kg normales en Tarifas') +
    stat('Cuello de botella', tope ? _cstPlnFmt(tope.pct, 0) + ' %' : '—', tope ? pmEsc(tope.t.depto.nombre) : 'sin capacidad definida');

  // avisos
  const avisos = [];
  if (!sem) avisos.push('El período no tiene fechas válidas: no se pueden calcular las semanas');
  r.filas.filter(f => f.avisos.length).forEach(f => avisos.push(`${f.prod.nombre}: ${f.avisos.join(' · ')}`));
  r.avisosBase.forEach(n => avisos.push(`${n}: la base de capacidad no se puede medir con las rutas`));
  r.deptos.forEach(d => { if (!(d.cap > 0)) avisos.push(`${d.t.depto.nombre}: no tiene capacidad normal — definila en Capacidad y reparto`); });
  const av = document.getElementById('cstpl-avisos');
  if (av) av.innerHTML = avisos.length
    ? `<div class="card" style="border-color:var(--red)"><div class="ctitle" style="color:var(--red)">Revisar</div>${avisos.map(a => `<div style="font-size:12px;margin-bottom:3px">⚠ ${pmEsc(a)}</div>`).join('')}</div>` : '';

  // capacidad usada
  const capEl = document.getElementById('cstpl-cap');
  if (capEl) {
    const barra = pct => pct === null ? '' : `<div style="height:6px;background:#E2E8F0;border-radius:3px;margin-top:3px;min-width:90px"><div style="height:6px;border-radius:3px;width:${Math.min(100, pct)}%;background:${_cstPlnColor(pct)}"></div></div>`;
    const celda = pct => pct === null ? '—' : `<b style="color:${_cstPlnColor(pct)}">${_cstNum(pct, 0)} %</b>${barra(pct)}`;
    capEl.innerHTML = r.deptos.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="${_CST_PLN_TH};text-align:left">Departamento</th><th style="${_CST_PLN_TH};text-align:left">Base</th>
        <th style="${_CST_PLN_TH}">Plan por semana</th><th style="${_CST_PLN_TH}">Plan del período</th><th style="${_CST_PLN_TH}">Capacidad normal</th><th style="${_CST_PLN_TH}">Capacidad usada</th>
        <th style="${_CST_PLN_TH}">HH del plan</th><th style="${_CST_PLN_TH}">HH productivas</th><th style="${_CST_PLN_TH}">HH usadas</th></tr></thead>
      <tbody>${r.deptos.map(d => `<tr><td style="${_CST_PLN_TD};text-align:left;font-family:inherit">${pmEsc(d.t.depto.codigo + ' · ' + d.t.depto.nombre)}</td>
        <td style="${_CST_PLN_TD};text-align:left;font-family:inherit">${pmEsc(d.t.driver_id ? _cstDrvNombre(d.t.driver_id) : 'sin definir')}</td>
        <td style="${_CST_PLN_TD}">${_cstPlnFmt(d.qSem, 2)}</td><td style="${_CST_PLN_TD}">${_cstPlnFmt(d.qMes, 1)}</td>
        <td style="${_CST_PLN_TD}">${d.cap > 0 ? _cstNum(d.cap, 1) : '—'}</td><td style="${_CST_PLN_TD};min-width:110px">${celda(d.pct)}</td>
        <td style="${_CST_PLN_TD}">${_cstPlnFmt(d.hhMes, 1)}</td><td style="${_CST_PLN_TD}">${d.hhDisp > 0 ? _cstNum(d.hhDisp, 1) : '—'}</td>
        <td style="${_CST_PLN_TD};min-width:110px">${celda(d.pctHH)}</td></tr>`).join('')}</tbody></table></div>
      <div style="font-size:11px;color:var(--cream2);margin-top:6px">Capacidad usada = consumo del plan en la base del departamento ÷ su capacidad normal. HH usadas = horas-hombre que pide la ruta ÷ horas-hombre productivas de la nómina. Verde hasta ${CST_PLN_OK} %, ámbar hasta 100 %, rojo si se pasa.</div>`
      : _cstPh('📐', 'No hay departamentos productivos con capacidad: definilos en Capacidad y reparto');
  }
}
