// costos_plan.js — Módulo de Costos · Plan de producción del período (por semanas)
// Prefijo cst (cstPln = pantalla y datos, cstPlnCalc = cálculo puro)
// Depende de costos_core.js, costos_maestros.js, costos_personal.js, costos_laboral.js,
// costos_gastos.js, costos_capacidad.js, costos_rutas.js y costos_tasas.js.
//
// DISEÑO: instrumento del módulo de Costos (más adelante será parte del MRP). Tabla propia
// cost_plan (sql_costos_plan.sql), colgada de cost_periodos. Lee productos, rutas y tarifas;
// NUNCA escribe en ellos.
// - El plan va semana por semana: las semanas de lunes a domingo que tocan el período
//   (octubre 2026: 28 sep–4 oct, 5–11, 12–18, 19–25 y 26 oct–1 nov). Los días que caen fuera
//   del período quedan bloqueados y no cuentan.
// - Por cada producto y día se asigna la cantidad de piezas que estará disponible como
//   producto terminado.
// - Cada pieza consume su ruta (entrega 6): horas-hombre por departamento, horas de reloj
//   (horno, máquina, cámara) y kg de masa. Se mide contra lo que el período tiene de capacidad:
//     · base de cada departamento productivo (kg de masa, horas-horno, HH...) ÷ su capacidad normal
//     · horas-hombre usadas ÷ horas-hombre productivas de la nómina del departamento
// - Simplificación: el consumo se cuenta el día en que el producto queda disponible; no se
//   adelanta al día en que realmente se amasa u hornea.

let _cstPlnRows = [];    // cost_plan del período seleccionado
let _cstPlnIds = [];     // productos que están en la hoja (con cantidades o recién agregados)
let _cstPlnSem = 1;      // semana que se está viendo (1 = la primera del período)

const CST_PLN_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const CST_PLN_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const CST_PLN_MAX_SEM = 6;
const CST_PLN_OK = 85;   // % de uso hasta el cual la capacidad se considera holgada
const _CST_PLN_COL = { ok: '#2f855a', medio: '#b7791f', alto: 'var(--red)' };

// ── Calendario (puro) ───────────────────────────────────────
function _cstPlnMs(iso) { const p = String(iso).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function _cstPlnIso(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function _cstPlnCorto(iso) { const p = String(iso).split('-'); return parseInt(p[2], 10) + ' ' + CST_PLN_MESES[parseInt(p[1], 10) - 1]; }

// Semanas de lunes a domingo que tocan el período. Cada una: n (1...), fechas[7], activos[7]
// (el día cae dentro del período) y las puntas con su rótulo.
function cstPlnSemanasLista(inicio, fin) {
  if (!inicio || !fin) return { lista: [], recortado: false };
  const a = _cstPlnMs(inicio), b = _cstPlnMs(fin);
  if (isNaN(a) || isNaN(b) || b < a) return { lista: [], recortado: false };
  const dow = new Date(a).getUTCDay();            // 0 = domingo
  let lunes = a - ((dow + 6) % 7) * 86400000;
  const lista = [];
  let recortado = false;
  while (lunes <= b) {
    if (lista.length >= CST_PLN_MAX_SEM) { recortado = true; break; }
    const fechas = [0, 1, 2, 3, 4, 5, 6].map(i => _cstPlnIso(lunes + i * 86400000));
    const activos = [0, 1, 2, 3, 4, 5, 6].map(i => { const m = lunes + i * 86400000; return m >= a && m <= b; });
    lista.push({ n: lista.length + 1, fechas, activos, diasAct: activos.filter(Boolean).length, ini: fechas[0], fin: fechas[6] });
    lunes += 7 * 86400000;
  }
  return { lista, recortado };
}

// ── Utilidades ──────────────────────────────────────────────
function _cstPlnProd(id) { return _cstRutProd.find(p => p.id === id) || null; }

// ── Selector de productos ───────────────────────────────────
// Muestra TODOS los productos activos que aún no están en el plan: primero los que tienen ruta
// (entran al cálculo de capacidad) y luego los que no; dentro de cada bloque por familia y por código.
const CST_PLN_FAMILIAS = [
  { id: 'pan_mm', nombre: 'Pan de masa madre' }, { id: 'pan', nombre: 'Pan' },
  { id: 'boll', nombre: 'Pan dulce y bollería' }, { id: 'galleta', nombre: 'Galletas' }, { id: 'otro', nombre: 'Otros' },
];
function _cstPlnFamilia(p) {
  const r = typeof cstRecetaProd === 'function' ? cstRecetaProd(p) : null;
  if (typeof _pvClase === 'function') return _pvClase(r, { nombre: p.nombre, tipo: p.tipo });
  return p.tipo === 'galleta' ? 'galleta' : p.tipo === 'pan' ? 'pan' : 'otro';
}
function _cstPlnTieneRuta(p) { const r = _cstRutaDe(p.id); return !!(r && _cstRutaLineas(r.id).length); }
function _cstPlnOpcionesHtml() {
  const libres = _cstRutProd.filter(p => !_cstPlnIds.includes(p.id));
  const cod = p => String(p.codigo || '');
  const orden = (a, b) => cod(a).localeCompare(cod(b), 'es', { numeric: true }) || (a.nombre || '').localeCompare(b.nombre || '', 'es');
  let html = '';
  [[true, 'Con ruta'], [false, 'Sin ruta (no suma carga)']].forEach(([con, rotulo]) => {
    CST_PLN_FAMILIAS.forEach(f => {
      const grupo = libres.filter(p => _cstPlnTieneRuta(p) === con && _cstPlnFamilia(p) === f.id).sort(orden);
      if (!grupo.length) return;
      html += `<optgroup label="${pmEsc(rotulo + ' · ' + f.nombre)}">${grupo.map(p => `<option value="${p.id}">${pmEsc((p.codigo ? p.codigo + ' · ' : '') + p.nombre)}</option>`).join('')}</optgroup>`;
    });
  });
  return html;
}
function _cstPlnCant(prodId, semana, dia) {
  const r = _cstPlnRows.find(x => x.producto_id === prodId && x.semana === semana && x.dia === dia);
  return r ? Number(r.cantidad) : 0;
}
function _cstPlnSemList() {
  const per = _cstPerActual();
  return per ? cstPlnSemanasLista(per.inicio, per.fin) : { lista: [], recortado: false };
}
function _cstPlnColor(pct) { return pct > 100 ? _CST_PLN_COL.alto : pct > CST_PLN_OK ? _CST_PLN_COL.medio : _CST_PLN_COL.ok; }
function _cstPlnFmt(n, dec) { return n === null || n === undefined || isNaN(n) ? '—' : _cstNum(n, dec === undefined ? 1 : dec); }
function _cstPlnRangoTxt(s) { return _cstPlnCorto(s.ini) + ' – ' + _cstPlnCorto(s.fin); }

// ── Cálculo (puro) ──────────────────────────────────────────
// ids: productos de la hoja · cant(prodId, semana, dia): piezas · semanas: lista de semanas del
// período · tarifas: tarifas por departamento · sel: número de la semana que se está viendo.
// Devuelve el consumo por producto, los totales por día de la semana elegida, el resumen por
// semana y el uso de capacidad por departamento en todo el período.
function cstPlnCalc(ids, cant, semanas, tarifas, sel) {
  const z7 = () => [0, 0, 0, 0, 0, 0, 0];
  const suma = a => a.reduce((x, y) => x + y, 0);
  const tot = { pz: z7(), kg: z7(), hh: z7() };          // días de la semana elegida
  const horasDia = {};                                    // depto_id → horas por día (semana elegida)
  const dem = {};                                         // depto_id → consumo de su base
  tarifas.forEach(t => { dem[t.depto_id] = { q: 0, hh: 0, qSel: 0, hhSel: 0 }; });
  const porSemana = semanas.map(s => ({ s, pz: 0, kg: 0, hh: 0, horas: 0 }));
  const filas = [];
  const sinMedir = [];

  ids.forEach(id => {
    const prod = _cstPlnProd(id);
    if (!prod) return;
    const ruta = _cstRutaDe(id);
    const lineas = ruta ? _cstRutaLineas(ruta.id) : [];
    const sinRuta = !ruta || !lineas.length;
    const rc = sinRuta ? null : cstRutaCalc(prod, ruta, lineas);
    const kgPz = rc ? rc.kgPz : cstMasaPiezaKg(prod, null);
    const f = { prod, dias: z7(), pzSel: 0, kgSel: 0, hhSel: 0, pzTot: 0, kgTot: 0, hhTot: 0, kgPz, hhPz: 0, sinRuta, avisos: [] };
    if (sinRuta) f.avisos.push('no tiene ruta: no consume horas, solo suma kg');
    else rc.avisos.forEach(a => f.avisos.push(a));
    if (!(kgPz > 0)) f.avisos.push('no tiene masa por pieza (peso del producto o de la ruta)');

    const cons = {};                                      // depto_id → { hh, h } por pieza
    if (rc) {
      rc.filas.forEach(x => {
        const dId = x.etapa ? x.etapa.depto_id : '';
        const c = cons[dId] = cons[dId] || { hh: 0, h: 0 };
        if (x.minPz !== null) { c.hh += x.hhPz / 60; c.h += x.minPz / 60; }
      });
    }
    Object.keys(cons).forEach(dId => { f.hhPz += cons[dId].hh; });

    semanas.forEach((s, i) => {
      const dias = [1, 2, 3, 4, 5, 6, 7].map(d => (s.activos[d - 1] ? cant(id, s.n, d) : 0));
      const pz = suma(dias);
      const esSel = s.n === sel;
      f.pzTot += pz;
      porSemana[i].pz += pz; porSemana[i].kg += pz * kgPz; porSemana[i].hh += pz * f.hhPz;
      tarifas.forEach(t => {
        const c = cons[t.depto_id] || { hh: 0, h: 0 };
        let q = null;
        if (t.driver_codigo === 'HH') q = c.hh;
        else if (CST_TAS_HORAS.includes(t.driver_codigo)) q = c.h;
        else if (t.driver_codigo === 'KG_MASA') q = cons[t.depto_id] ? kgPz : 0;
        else if (t.driver_codigo === 'PIEZA') q = cons[t.depto_id] ? 1 : 0;
        const d = dem[t.depto_id];
        if (q === null) { if (pz > 0 && !sinMedir.includes(t.depto.nombre)) sinMedir.push(t.depto.nombre); }
        else { d.q += q * pz; if (esSel) d.qSel += q * pz; }
        d.hh += c.hh * pz;
        if (esSel) d.hhSel += c.hh * pz;
        if (CST_TAS_HORAS.includes(t.driver_codigo)) {
          porSemana[i].horas += c.h * pz;
          if (esSel) { const arr = horasDia[t.depto_id] = horasDia[t.depto_id] || z7(); dias.forEach((n, k) => { arr[k] += c.h * n; }); }
        }
      });
      if (esSel) {
        f.dias = dias; f.pzSel = pz; f.kgSel = pz * kgPz; f.hhSel = pz * f.hhPz;
        dias.forEach((n, k) => { tot.pz[k] += n; tot.kg[k] += n * kgPz; tot.hh[k] += n * f.hhPz; });
      }
    });
    f.kgTot = f.pzTot * kgPz; f.hhTot = f.pzTot * f.hhPz;
    filas.push(f);
  });

  const deptos = tarifas.map(t => {
    const d = dem[t.depto_id];
    const cap = t.cap > 0 ? t.cap : 0;
    const hhDisp = t.hh > 0 ? t.hh : 0;
    return {
      t, qSel: d.qSel, qMes: d.q, cap, pct: cap > 0 ? d.q / cap * 100 : null,
      hhSel: d.hhSel, hhMes: d.hh, hhDisp, pctHH: hhDisp > 0 ? d.hh / hhDisp * 100 : null,
      horas: horasDia[t.depto_id] || null,
    };
  });
  return {
    filas, deptos, tot, porSemana, sinMedir,
    pzSel: suma(tot.pz), kgSel: suma(tot.kg), hhSel: suma(tot.hh),
    pzMes: suma(porSemana.map(x => x.pz)), kgMes: suma(porSemana.map(x => x.kg)), hhMes: suma(porSemana.map(x => x.hh)),
  };
}

function _cstPlnCalcular() {
  const tas = cstTasActuales();
  return cstPlnCalc(_cstPlnIds, _cstPlnCant, _cstPlnSemList().lista, tas.tarifas, _cstPlnSem);
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

// Solo las filas del plan (sin recalcular tarifas); mantiene los productos ya agregados a la hoja
async function _cstPlnCargarFilas() {
  _cstPlnRows = [];
  if (!_cstPerSel) return;
  try {
    const r = await pmDB.get('cost_plan', { periodo_id: _cstPerSel });
    _cstPlnRows = (r || []).map(x => Object.assign({}, x, { semana: Number(x.semana), dia: Number(x.dia), cantidad: Number(x.cantidad) }));
  } catch (e) {
    console.warn('[cstPlnCargarFilas]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_plan.sql'), 'err');
  }
  _cstPlnRows.forEach(r => { if (!_cstPlnIds.includes(r.producto_id) && _cstPlnProd(r.producto_id)) _cstPlnIds.push(r.producto_id); });
  _cstPlnIds.sort((a, b) => _cstPlnProd(a).nombre.localeCompare(_cstPlnProd(b).nombre, 'es'));
}

async function cstPlnCargar() {
  await cstTasCargar();   // capacidad, reparto, nómina, gastos y tarifas del período
  _cstPlnIds = [];
  await _cstPlnCargarFilas();
  // semana inicial: la que contiene hoy, o la primera
  const lista = _cstPlnSemList().lista;
  const hoy = pmHoy();
  const act = lista.find(s => hoy >= s.ini && hoy <= s.fin);
  _cstPlnSem = act ? act.n : 1;
}

async function cstPlnElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstPlnCargar();
  cstPlnRender();
}

function cstPlnSemana(n) {
  _cstPlnSem = n;
  cstPlnRender();
}

// ── Edición ─────────────────────────────────────────────────
function cstPlnAgregar() {
  const sel = document.getElementById('cstpl-agregar');
  const id = sel ? sel.value : '';
  if (!id) { pmToast('Elegí un producto de la lista', 'err'); return; }
  if (!_cstPlnIds.includes(id)) _cstPlnIds.push(id);
  _cstPlnIds.sort((a, b) => _cstPlnProd(a).nombre.localeCompare(_cstPlnProd(b).nombre, 'es'));
  cstPlnRender();
}

async function cstPlnQuitar(prodId) {
  const filas = _cstPlnRows.filter(r => r.producto_id === prodId);
  const p = _cstPlnProd(prodId);
  if (filas.length && !confirm(`¿Quitar "${p ? p.nombre : 'el producto'}" del plan? Se borran sus cantidades de todas las semanas.`)) return;
  try {
    await pmDB.hardDeleteMany('cost_plan', filas.map(r => r.id));
    _cstPlnRows = _cstPlnRows.filter(r => r.producto_id !== prodId);
    _cstPlnIds = _cstPlnIds.filter(x => x !== prodId);
  } catch (e) {
    console.warn('[cstPlnQuitar]', e.message);
    pmToast('⚠️ No se pudo quitar: ' + _cstErr(e, 'sql_costos_plan.sql'), 'err');
    await _cstPlnCargarFilas();
  }
  cstPlnRender();
}

async function cstPlnSetCant(prodId, semana, dia, valor) {
  const txt = String(valor).trim();
  const n = txt === '' ? 0 : parseFloat(txt.replace(',', '.'));
  if (isNaN(n) || n < 0) { pmToast('Ingresá una cantidad de 0 o más', 'err'); cstPlnRender(); return; }
  const ex = _cstPlnRows.find(x => x.producto_id === prodId && x.semana === semana && x.dia === dia);
  try {
    if (n === 0) {
      if (ex) { await pmDB.hardDelete('cost_plan', ex.id); _cstPlnRows = _cstPlnRows.filter(x => x.id !== ex.id); }
    } else if (ex) {
      await pmDB.update('cost_plan', ex.id, { cantidad: n });
      ex.cantidad = n;
    } else {
      const rows = await pmDB.insert('cost_plan', { periodo_id: _cstPerSel, producto_id: prodId, semana, dia, cantidad: n });
      const nueva = (rows && rows[0]) || { id: 'tmp-' + Math.random(), periodo_id: _cstPerSel, producto_id: prodId };
      nueva.semana = semana; nueva.dia = dia; nueva.cantidad = n;
      _cstPlnRows.push(nueva);
    }
  } catch (e) {
    console.warn('[cstPlnSetCant]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_plan.sql'), 'err');
    await _cstPlnCargarFilas();
    cstPlnRender();
    return;
  }
  cstPlnActualizar();
}

// Copia la semana que se está viendo a la siguiente ('sig') o a todas las que le siguen ('todas').
// Reemplaza lo que hubiera en las semanas de destino (solo de los productos de la hoja).
async function cstPlnCopiar(modo) {
  const lista = _cstPlnSemList().lista;
  const origen = lista.find(s => s.n === _cstPlnSem);
  const destinos = lista.filter(s => (modo === 'sig' ? s.n === _cstPlnSem + 1 : s.n > _cstPlnSem));
  if (!origen || !destinos.length) { pmToast('No hay semanas siguientes a donde copiar', 'err'); return; }
  const txt = destinos.length === 1 ? `la semana ${destinos[0].n}` : `las semanas ${destinos[0].n} a ${destinos[destinos.length - 1].n}`;
  if (!confirm(`Se copia la semana ${origen.n} (${_cstPlnRangoTxt(origen)}) a ${txt}. Lo que ya hubiera en ${destinos.length === 1 ? 'esa semana' : 'esas semanas'} se reemplaza. ¿Seguir?`)) return;
  const nums = destinos.map(s => s.n);
  const borrar = _cstPlnRows.filter(r => nums.includes(r.semana) && _cstPlnIds.includes(r.producto_id)).map(r => r.id);
  const nuevas = [];
  destinos.forEach(d => {
    _cstPlnIds.forEach(pid => {
      for (let dia = 1; dia <= 7; dia++) {
        if (!d.activos[dia - 1] || !origen.activos[dia - 1]) continue;
        const v = _cstPlnCant(pid, origen.n, dia);
        if (v > 0) nuevas.push({ periodo_id: _cstPerSel, producto_id: pid, semana: d.n, dia, cantidad: v });
      }
    });
  });
  try {
    await pmDB.hardDeleteMany('cost_plan', borrar);
    if (nuevas.length) await pmDB.insert('cost_plan', nuevas, false);
    pmToast(`✅ Semana ${origen.n} copiada a ${txt}`, 'ok');
  } catch (e) {
    console.warn('[cstPlnCopiar]', e.message);
    pmToast('⚠️ No se pudo copiar: ' + _cstErr(e, 'sql_costos_plan.sql'), 'err');
  }
  await _cstPlnCargarFilas();
  cstPlnRender();
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
    ['cstpl-stats', 'cstpl-avisos', 'cstpl-cap', 'cstpl-sems', 'cstpl-pills'].forEach(i => { const e = document.getElementById(i); if (e) e.innerHTML = ''; });
    tabEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral y cargá sus datos');
    return;
  }
  const { lista } = _cstPlnSemList();
  if (!lista.length) {
    estEl.textContent = '';
    tabEl.innerHTML = _cstPh('📅', 'El período no tiene fechas válidas: revisalas en Costo laboral');
    return;
  }
  if (!lista.some(s => s.n === _cstPlnSem)) _cstPlnSem = 1;
  const semAct = lista.find(s => s.n === _cstPlnSem);
  estEl.innerHTML = `<span class="badge ${per.estado === 'borrador' ? 'b0' : 'b3'}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${pmEsc(per.inicio)} → ${pmEsc(per.fin)} · ${lista.length} semanas (de lunes a domingo; los días fuera del período no cuentan)</span>`;

  // pestañas de semana
  const pills = document.getElementById('cstpl-pills');
  if (pills) pills.innerHTML = lista.map(s => `<button class="pill ${s.n === _cstPlnSem ? 'on' : ''}" onclick="cstPlnSemana(${s.n})">Sem ${s.n} · ${pmEsc(_cstPlnRangoTxt(s))}</button>`).join('');

  // selector de productos que faltan por agregar
  const opts = _cstPlnOpcionesHtml();
  const hayMas = lista.some(s => s.n > _cstPlnSem);
  const barra = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div style="flex:2 1 240px"><label>Agregar producto al plan</label><select id="cstpl-agregar"><option value="">— Elegí un producto (${_cstRutProd.filter(p => !_cstPlnIds.includes(p.id)).length} disponibles) —</option>${opts}</select></div>
      <button class="btn btn-gold btn-sm" onclick="cstPlnAgregar()">+ Agregar</button>
      ${hayMas && _cstPlnIds.length ? `<button class="btn btn-out btn-sm" onclick="cstPlnCopiar('sig')">Copiar a la semana siguiente</button><button class="btn btn-out btn-sm" onclick="cstPlnCopiar('todas')">Copiar a todas las siguientes</button>` : ''}</div>`;

  if (!_cstPlnIds.length) {
    tabEl.innerHTML = barra + _cstPh('🗓️', 'El plan está vacío — agregá el primer producto y asigná cuántas piezas tendrás disponibles cada día');
    cstPlnActualizar();
    return;
  }
  const fila = id => {
    const p = _cstPlnProd(id);
    const celdas = [1, 2, 3, 4, 5, 6, 7].map(d => {
      if (!semAct.activos[d - 1]) return `<td style="${_CST_PLN_TD};padding:3px 4px;background:#F8FAFC;color:#CBD5E0;text-align:center" title="Fuera del período">·</td>`;
      const v = _cstPlnCant(id, semAct.n, d);
      return `<td style="${_CST_PLN_TD};padding:3px 4px"><input type="number" min="0" step="any" value="${v || ''}" placeholder="0" onchange="cstPlnSetCant('${id}',${semAct.n},${d},this.value)" style="${_CST_PLN_IN}"></td>`;
    }).join('');
    return `<tr>
      <td style="${_CST_PLN_TD};text-align:left;font-family:inherit;min-width:190px;white-space:normal">${pmEsc(p.nombre)}<div id="cstpl-av-${id}" style="font-size:10px;color:var(--red)"></div></td>
      <td style="${_CST_PLN_TD}" id="cstpl-kgpz-${id}"></td>${celdas}
      <td style="${_CST_PLN_TD}" id="cstpl-pz-${id}"></td>
      <td style="${_CST_PLN_TD}" id="cstpl-kg-${id}"></td>
      <td style="${_CST_PLN_TD}" id="cstpl-hh-${id}"></td>
      <td style="${_CST_PLN_TD}" id="cstpl-pt-${id}"></td>
      <td style="${_CST_PLN_TD}"><button class="btn btn-out btn-sm" title="Quitar del plan" onclick="cstPlnQuitar('${id}')">✕</button></td></tr>`;
  };
  tabEl.innerHTML = barra + `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr><th style="${_CST_PLN_TH};text-align:left">Producto</th><th style="${_CST_PLN_TH}">kg/pz</th>
      ${CST_PLN_DIAS.map((d, i) => `<th style="${_CST_PLN_TH};${semAct.activos[i] ? '' : 'opacity:.4'}">${d}<div style="font-size:10px;letter-spacing:0;text-transform:none">${pmEsc(_cstPlnCorto(semAct.fechas[i]))}</div></th>`).join('')}
      <th style="${_CST_PLN_TH}">Pz/sem</th><th style="${_CST_PLN_TH}">Kg/sem</th><th style="${_CST_PLN_TH}">HH/sem</th><th style="${_CST_PLN_TH}">Pz período</th><th style="${_CST_PLN_TH}"></th></tr></thead>
    <tbody>${_cstPlnIds.map(fila).join('')}</tbody>
    <tfoot id="cstpl-pie"></tfoot></table></div>
    <div style="font-size:11px;color:var(--cream2);margin-top:6px">Cantidad = piezas que estarán disponibles como producto terminado ese día. Cada cambio se guarda al salir de la celda. Estás viendo la semana ${semAct.n}; las demás se llenan con las pestañas de arriba.</div>`;
  cstPlnActualizar();
}

// Recalcula totales y capacidad sin tocar las celdas editables (no pierde el foco)
function cstPlnActualizar() {
  const per = _cstPerActual();
  if (!per) return;
  const { lista, recortado } = _cstPlnSemList();
  if (!lista.length) return;
  const r = _cstPlnCalcular();
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  r.filas.forEach(f => {
    set('cstpl-kgpz-' + f.prod.id, f.kgPz > 0 ? _cstNum(f.kgPz, 3) : '—');
    set('cstpl-pz-' + f.prod.id, _cstPlnFmt(f.pzSel, 1));
    set('cstpl-kg-' + f.prod.id, _cstPlnFmt(f.kgSel, 2));
    set('cstpl-hh-' + f.prod.id, f.sinRuta ? '—' : _cstPlnFmt(f.hhSel, 2));
    set('cstpl-pt-' + f.prod.id, _cstPlnFmt(f.pzTot, 1));
    const av = document.getElementById('cstpl-av-' + f.prod.id);
    if (av) av.textContent = f.avisos.length ? '⚠ ' + f.avisos[0] : '';
  });

  // pie de la tabla: totales por día de la semana que se ve
  const pie = document.getElementById('cstpl-pie');
  if (pie) {
    const fila = (rot, arr, tot, dec) => `<tr style="font-weight:600"><td style="${_CST_PLN_TD};text-align:left;font-family:inherit">${rot}</td><td style="${_CST_PLN_TD}"></td>
      ${arr.map(v => `<td style="${_CST_PLN_TD}">${v > 0 ? _cstNum(v, dec) : '·'}</td>`).join('')}
      <td style="${_CST_PLN_TD}">${_cstPlnFmt(tot, dec)}</td><td style="${_CST_PLN_TD}"></td><td style="${_CST_PLN_TD}"></td><td style="${_CST_PLN_TD}"></td><td style="${_CST_PLN_TD}"></td></tr>`;
    let h = fila('Piezas del día', r.tot.pz, r.pzSel, 1) + fila('Kg de masa del día', r.tot.kg, r.kgSel, 2) + fila('Horas-hombre del día', r.tot.hh, r.hhSel, 2);
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
    stat('Piezas en el período', _cstPlnFmt(r.pzMes, 0), `semana ${_cstPlnSem}: ${_cstPlnFmt(r.pzSel, 0)}`) +
    stat('Kg de masa en el período', _cstPlnFmt(r.kgMes, 1), `semana ${_cstPlnSem}: ${_cstPlnFmt(r.kgSel, 1)} kg`) +
    stat('Horas-hombre en el período', _cstPlnFmt(r.hhMes, 1), `semana ${_cstPlnSem}: ${_cstPlnFmt(r.hhSel, 1)} h`) +
    stat('Plan vs kg normales', kgNorm > 0 ? _cstPlnFmt(r.kgMes / kgNorm * 100, 0) + ' %' : '—', kgNorm > 0 ? `kg normales de ventas: ${_cstNum(kgNorm, 0)}` : 'definí los kg normales en Tarifas') +
    stat('Cuello de botella', tope ? _cstPlnFmt(tope.pct, 0) + ' %' : '—', tope ? pmEsc(tope.t.depto.nombre) : 'sin capacidad definida');

  // resumen por semana
  const sems = document.getElementById('cstpl-sems');
  if (sems) {
    const hayHoras = r.deptos.some(d => d.horas !== null || CST_TAS_HORAS.includes(d.t.driver_codigo));
    sems.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="${_CST_PLN_TH};text-align:left">Semana</th><th style="${_CST_PLN_TH};text-align:left">Fechas</th><th style="${_CST_PLN_TH}">Piezas</th><th style="${_CST_PLN_TH}">Kg de masa</th><th style="${_CST_PLN_TH}">Horas-hombre</th>${hayHoras ? `<th style="${_CST_PLN_TH}">Horas de horno</th>` : ''}</tr></thead>
      <tbody>${r.porSemana.map(x => `<tr style="cursor:pointer;${x.s.n === _cstPlnSem ? 'background:#FFF8E6' : ''}" onclick="cstPlnSemana(${x.s.n})">
        <td style="${_CST_PLN_TD};text-align:left;font-family:inherit">Semana ${x.s.n}${x.s.diasAct < 7 ? ` <span style="font-size:10px;color:var(--cream2)">(${x.s.diasAct} días)</span>` : ''}</td>
        <td style="${_CST_PLN_TD};text-align:left;font-family:inherit">${pmEsc(_cstPlnRangoTxt(x.s))}</td>
        <td style="${_CST_PLN_TD}">${_cstPlnFmt(x.pz, 1)}</td><td style="${_CST_PLN_TD}">${_cstPlnFmt(x.kg, 2)}</td><td style="${_CST_PLN_TD}">${_cstPlnFmt(x.hh, 2)}</td>${hayHoras ? `<td style="${_CST_PLN_TD}">${_cstPlnFmt(x.horas, 2)}</td>` : ''}</tr>`).join('')}
        <tr style="font-weight:600"><td style="${_CST_PLN_TD};text-align:left;font-family:inherit" colspan="2">Total del período</td>
        <td style="${_CST_PLN_TD}">${_cstPlnFmt(r.pzMes, 1)}</td><td style="${_CST_PLN_TD}">${_cstPlnFmt(r.kgMes, 2)}</td><td style="${_CST_PLN_TD}">${_cstPlnFmt(r.hhMes, 2)}</td>${hayHoras ? `<td style="${_CST_PLN_TD}">${_cstPlnFmt(r.porSemana.reduce((a, x) => a + x.horas, 0), 2)}</td>` : ''}</tr></tbody></table></div>`;
  }

  // avisos
  const avisos = [];
  if (recortado) avisos.push(`El período tiene más de ${CST_PLN_MAX_SEM} semanas: el plan solo cubre las primeras ${CST_PLN_MAX_SEM}`);
  r.filas.filter(f => f.avisos.length).forEach(f => avisos.push(`${f.prod.nombre}: ${f.avisos.join(' · ')}`));
  r.sinMedir.forEach(n => avisos.push(`${n}: la base de capacidad no se puede medir con las rutas`));
  r.deptos.forEach(d => { if (!(d.cap > 0)) avisos.push(`${d.t.depto.nombre}: no tiene capacidad normal — definila en Capacidad y reparto`); });
  const av = document.getElementById('cstpl-avisos');
  if (av) av.innerHTML = avisos.length
    ? `<div class="card" style="border-color:var(--red)"><div class="ctitle" style="color:var(--red)">Revisar</div>${avisos.map(a => `<div style="font-size:12px;margin-bottom:3px">⚠ ${pmEsc(a)}</div>`).join('')}</div>` : '';

  // capacidad usada (todo el período)
  const capEl = document.getElementById('cstpl-cap');
  if (capEl) {
    const barra = pct => pct === null ? '' : `<div style="height:6px;background:#E2E8F0;border-radius:3px;margin-top:3px;min-width:90px"><div style="height:6px;border-radius:3px;width:${Math.min(100, pct)}%;background:${_cstPlnColor(pct)}"></div></div>`;
    const celda = pct => pct === null ? '—' : `<b style="color:${_cstPlnColor(pct)}">${_cstNum(pct, 0)} %</b>${barra(pct)}`;
    capEl.innerHTML = r.deptos.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="${_CST_PLN_TH};text-align:left">Departamento</th><th style="${_CST_PLN_TH};text-align:left">Base</th>
        <th style="${_CST_PLN_TH}">Plan de la semana ${_cstPlnSem}</th><th style="${_CST_PLN_TH}">Plan del período</th><th style="${_CST_PLN_TH}">Capacidad normal</th><th style="${_CST_PLN_TH}">Capacidad usada</th>
        <th style="${_CST_PLN_TH}">HH del plan</th><th style="${_CST_PLN_TH}">HH productivas</th><th style="${_CST_PLN_TH}">HH usadas</th></tr></thead>
      <tbody>${r.deptos.map(d => `<tr><td style="${_CST_PLN_TD};text-align:left;font-family:inherit">${pmEsc(d.t.depto.codigo + ' · ' + d.t.depto.nombre)}</td>
        <td style="${_CST_PLN_TD};text-align:left;font-family:inherit">${pmEsc(d.t.driver_id ? _cstDrvNombre(d.t.driver_id) : 'sin definir')}</td>
        <td style="${_CST_PLN_TD}">${_cstPlnFmt(d.qSel, 2)}</td><td style="${_CST_PLN_TD}">${_cstPlnFmt(d.qMes, 1)}</td>
        <td style="${_CST_PLN_TD}">${d.cap > 0 ? _cstNum(d.cap, 1) : '—'}</td><td style="${_CST_PLN_TD};min-width:110px">${celda(d.pct)}</td>
        <td style="${_CST_PLN_TD}">${_cstPlnFmt(d.hhMes, 1)}</td><td style="${_CST_PLN_TD}">${d.hhDisp > 0 ? _cstNum(d.hhDisp, 1) : '—'}</td>
        <td style="${_CST_PLN_TD};min-width:110px">${celda(d.pctHH)}</td></tr>`).join('')}</tbody></table></div>
      <div style="font-size:11px;color:var(--cream2);margin-top:6px">Capacidad usada = consumo de todo el período en la base del departamento ÷ su capacidad normal. HH usadas = horas-hombre que pide la ruta ÷ horas-hombre productivas de la nómina. Verde hasta ${CST_PLN_OK} %, ámbar hasta 100 %, rojo si se pasa.</div>`
      : _cstPh('📐', 'No hay departamentos productivos con capacidad: definilos en Capacidad y reparto');
  }
}
