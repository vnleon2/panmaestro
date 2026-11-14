// costos_budget.js — Módulo de Costos · Presupuesto: Budget de ventas (matriz de 12 meses)
// Prefijo cst (cstBud = pantalla y datos; cstBudCalcular = cálculo puro)
// Depende de costos_core.js, costos_laboral.js, costos_rutas.js, costos_tasas.js y costos_plan.js
// (cstPlnCalc, para medir cuánta capacidad consume cada mes) y de las categorías de mercadeo.
//
// DISEÑO: el BUDGET de ventas del año. Tabla propia cost_budget_venta (sql_costos_budget.sql).
//   · Una fila de la matriz = un producto activo del maestro (pan, galleta u otro); una columna = un mes.
//     El input son UNIDADES por mes. Los productos se agrupan con la categoría de mercadeo.
//   · Venta = producción (sin inventario). El MPS es el rolling forecast; esto es el budget.
//   · Cada mes se mide contra la capacidad de un período de referencia (el que se elige arriba):
//     la capacidad normal de cada departamento productivo y sus horas-hombre, por mes (÷ meses del período).
//     Se muestra el departamento más exigido y un semáforo. Si el mes se pasa de la capacidad hay que
//     corregir el presupuesto ahí mismo.
//   · Solo escribe en cost_budget_venta. No cambia períodos, tarifas ni nada existente.
// Más adelante: de aquí salen los kg de ventas normales del estándar, el presupuesto de materiales
// (explosión de recetas) y la estimación de nómina.

let _cstBudRows = [];        // cost_budget_venta
let _cstBudCats = [];        // categorías de mercadeo
let _cstBudProdCat = {};     // producto_id → categoria_id
let _cstBudInicio = '';      // 'AAAA-MM' del primer mes de la matriz
const CST_BUD_LS = 'cst_bud_inicio';
const CST_BUD_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const _CST_BU_CEL = 'padding:4px 6px;border-bottom:1px solid #E2E8F0;font-size:12px';
const _CST_BU_MONO = ";text-align:right;font-family:'DM Mono',monospace;white-space:nowrap";
const _CST_BU_HEAD = 'font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)';

// ── Meses ───────────────────────────────────────────────────
function _cstBudMesHoy() { return pmHoy().slice(0, 7); }
function _cstBudSumarMes(ym, n) {
  const y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return yy + '-' + String(mm + 1).padStart(2, '0');
}
function _cstBudMeses() {
  const ini = /^\d{4}-\d{2}$/.test(_cstBudInicio) ? _cstBudInicio : _cstBudMesHoy();
  return Array.from({ length: 12 }, (_, i) => _cstBudSumarMes(ini, i));
}
function _cstBudMesTxt(ym) { return CST_BUD_MESES[parseInt(ym.slice(5, 7), 10) - 1] + ' ' + ym.slice(2, 4); }
function _cstBudFilaDe(prodId, ym) { return _cstBudRows.find(r => r.producto_id === prodId && r.mes === ym) || null; }
function _cstBudUn(prodId, ym) { const r = _cstBudFilaDe(prodId, ym); return r ? Number(r.unidades) : 0; }

// ── Cálculo (puro) ──────────────────────────────────────────
function cstBudCalcular(unFn, mesesIn) {
  const un_ = unFn || _cstBudUn;            // de dónde salen las unidades (por defecto, el budget)
  const meses = mesesIn || _cstBudMeses();
  const per = _cstPerActual();
  const mesesPer = per && Number(per.meses) > 0 ? Number(per.meses) : 1;
  const tas = per ? cstTasActuales() : null;
  const tarifas = tas ? tas.tarifas : [];
  const prods = _cstRutProd.slice();

  // kg por pieza de cada producto
  const kgPz = {};
  prods.forEach(p => { kgPz[p.id] = cstMasaPiezaKg(p, _cstRutaDe(p.id)); });
  const sinMasa = prods.filter(p => meses.some(m => un_(p.id, m) > 0) && !(kgPz[p.id] > 0));
  const sinRuta = prods.filter(p => meses.some(m => un_(p.id, m) > 0) && kgPz[p.id] > 0 && !_cstPlnTieneRuta(p));

  // HH del período que la nómina deja en capacidad ociosa (disponibles para producir más)
  // (cstHHDepto devuelve 0 fuera de los departamentos productivos, así que se calcula aquí con la misma fórmula)
  let hhOciosaPeriodo = 0;
  try {
    _cstColabs.filter(c => c.activo !== false).forEach(c => {
      cstRepartoDe(c.id).forEach(r => {
        const d = _cstDeps.find(y => y.id === r.depto_id);
        if (!d || d.tipo !== 'ociosa') return;
        const car = _cstCargos.find(x => x.id === c.cargo_id);
        const util = car ? Number(car.pct_utilizacion) : 0;
        hhOciosaPeriodo += Number(c.horas_mes) * util / 100 * Number(r.pct) / 100 * mesesPer;
      });
    });
  } catch (e) { hhOciosaPeriodo = 0; }

  const semana = [{ n: 1, activos: [true, true, true, true, true, true, true] }];
  const porMes = meses.map(ym => {
    let un = 0, kg = 0;
    prods.forEach(p => { const u = un_(p.id, ym); un += u; kg += u * (kgPz[p.id] || 0); });
    let uso = null, donde = '', usoKg = null, hhNec = 0;
    if (tarifas.length && un > 0) {
      const r = cstPlnCalc(prods.map(p => p.id), (id, n, d) => (d === 1 ? un_(id, ym) : 0), semana, tarifas, 1);
      // Capacidad medida en horas-hombre: producción + capacidad ociosa (tiempo ya pagado que aún no se usa).
      // Los departamentos con driver HH se juzgan en conjunto; los demás drivers (kg de masa, piezas, horas de equipo) siguen por su capacidad normal.
      let hhDem = 0, hhProd = 0;
      r.deptos.forEach(d => {
        const nom = d.t.depto ? d.t.depto.nombre : 'departamento';
        hhDem += d.hhMes || 0; hhProd += d.hhDisp || 0;
        if (d.t.driver_codigo === 'HH' || d.pct === null || d.pct === undefined) return;
        const mensual = d.pct * mesesPer;
        if (uso === null || mensual > uso) { uso = mensual; donde = nom; }
      });
      const hhDisp = hhProd + hhOciosaPeriodo;
      hhNec = hhDem;
      if (hhDem > 0 && hhDisp > 0) {
        const mensual = hhDem / hhDisp * 100 * mesesPer;
        if (uso === null || mensual > uso) { uso = mensual; donde = 'horas-hombre (producción + ociosa)'; }
      }
    } else if (tarifas.length) { uso = 0; }
    return { ym, un, kg, uso, donde, hh: hhNec };
  });
  return { meses, porMes, kgPz, sinMasa, sinRuta, prods, hayTarifas: tarifas.length > 0, per, mesesPer, hhProd: tarifas.reduce((a, t) => a + (t.hh > 0 ? t.hh : 0), 0), hhOciosa: hhOciosaPeriodo };
}

function _cstBudNivel(uso) {
  if (uso === null || uso === undefined) return null;
  return uso > 100 ? 'alto' : uso > CST_PLN_OK ? 'medio' : 'ok';
}

// ── Carga ───────────────────────────────────────────────────
async function cstBudCargarDatos() {
  _cstBudRows = [];
  try {
    const r = await pmDB.get('cost_budget_venta');
    _cstBudRows = (r || []).map(x => Object.assign({}, x, { mes: String(x.mes).slice(0, 7), unidades: Number(x.unidades) }));
  } catch (e) {
    console.warn('[cstBudCargarDatos]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_budget.sql'), 'err');
  }
  try {
    const [cats, rel] = await Promise.all([pmDB.get('categorias', { activo: true }), pmDB.get('producto_categoria')]);
    _cstBudCats = (cats || []).sort((a, b) => (a.orden || 0) - (b.orden || 0) || (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    _cstBudProdCat = {};
    (rel || []).forEach(x => { _cstBudProdCat[x.producto_id] = x.categoria_id; });
  } catch (e) { console.warn('[cstBudCats]', e.message); _cstBudCats = []; _cstBudProdCat = {}; }
}

// Deja cargado lo que hace falta de Costos (productos, rutas, períodos, tarifas). Devuelve false si falla.
async function cstBudAsegurarCostos() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return false; }
  await cstCfgCargar();
  try {
    await cstPersonalDatos();
    await cstPerCargar();
    await cstRutDatos();
  } catch (e) {
    console.warn('[cstBudAsegurarCostos]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql, sql_costos_personal.sql y sql_costos_rutas.sql'), 'err');
    return false;
  }
  cstPerInicial();
  await cstTasCargar();
  return true;
}

// Ventas reales (mps_venta_real) sumadas por mes y producto, de 'desde' (incluido) a 'hasta' (excluido), 'AAAA-MM'.
// Devuelve { 'AAAA-MM': { producto_id: unidades } }. Lee de 1000 en 1000 para no quedarse corto.
async function cstRealPorMes(desde, hasta) {
  const out = {};
  for (let off = 0; ; off += 1000) {
    const rows = await pmDB.get('mps_venta_real', {}, `*&fecha=gte.${desde}-01&fecha=lt.${hasta}-01&order=fecha.asc&limit=1000&offset=${off}`);
    (rows || []).forEach(r => {
      const ym = String(r.fecha).slice(0, 7);
      const m = out[ym] = out[ym] || {};
      m[r.producto_id] = (m[r.producto_id] || 0) + (Number(r.cantidad) || 0);
    });
    if (!rows || rows.length < 1000) break;
  }
  return out;
}

// Promedio mensual real por producto: los últimos 3 meses cerrados que tengan ventas (referencia, no cambia el budget)
let _cstBudReal = {};   // producto_id → unidades por mes
let _cstBudRealN = 0;   // cuántos meses entraron al promedio
async function cstBudCargarReal() {
  _cstBudReal = {}; _cstBudRealN = 0;
  try {
    const hoy = _cstBudMesHoy();
    const por = await cstRealPorMes(_cstBudSumarMes(hoy, -3), hoy);
    const meses = Object.keys(por).filter(ym => Object.values(por[ym]).some(x => x > 0));
    _cstBudRealN = meses.length;
    meses.forEach(ym => Object.keys(por[ym]).forEach(pid => { _cstBudReal[pid] = (_cstBudReal[pid] || 0) + por[ym][pid] / meses.length; }));
  } catch (e) { console.warn('[cstBudCargarReal]', e.message); }
}

async function cstBudInit() {
  try { _cstBudInicio = localStorage.getItem(CST_BUD_LS) || _cstBudInicio; } catch (e) { /* ok */ }
  if (!/^\d{4}-\d{2}$/.test(_cstBudInicio)) _cstBudInicio = _cstBudMesHoy();
  if (!(await cstBudAsegurarCostos())) return;
  await cstBudCargarDatos();
  await cstBudCargarReal();
  cstPerLlenarSelectId('cstbud-periodo', '— Sin períodos: no se puede medir la capacidad —');
  const ini = document.getElementById('cstbud-inicio');
  if (ini) ini.value = _cstBudInicio;
  cstBudRender();
}

async function cstBudElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstBudRender();
}

function cstBudSetInicio(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  _cstBudInicio = v;
  try { localStorage.setItem(CST_BUD_LS, v); } catch (e) { /* ok */ }
  cstBudRender();
}

// ── Guardar ─────────────────────────────────────────────────
async function _cstBudGuardar(prodId, ym, n) {
  const ex = _cstBudFilaDe(prodId, ym);
  if (n === 0) {
    if (ex) { await pmDB.hardDelete('cost_budget_venta', ex.id); _cstBudRows = _cstBudRows.filter(x => x.id !== ex.id); }
  } else if (ex) {
    await pmDB.update('cost_budget_venta', ex.id, { unidades: n });
    ex.unidades = n;
  } else {
    const rows = await pmDB.insert('cost_budget_venta', { mes: ym + '-01', producto_id: prodId, unidades: n });
    const nueva = (rows && rows[0]) || { id: 'tmp-' + Math.random() };
    nueva.mes = ym; nueva.producto_id = prodId; nueva.unidades = n;
    _cstBudRows.push(nueva);
  }
}

async function cstBudSet(prodId, ym, valor) {
  const txt = String(valor).trim();
  const n = txt === '' ? 0 : parseFloat(txt.replace(',', '.'));
  if (isNaN(n) || n < 0) { pmToast('Ingresá una cantidad de 0 o más', 'err'); cstBudRender(); return; }
  try {
    await _cstBudGuardar(prodId, ym, n);
  } catch (e) {
    console.warn('[cstBudSet]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_budget.sql'), 'err');
    await cstBudCargarDatos();
    cstBudRender();
    return;
  }
  cstBudTotales();   // solo totales y semáforos: no se rehace la tabla para no perder el foco
}

// Rellena los meses 2 a 12 a partir del mes 1 con un crecimiento mensual (0 = repetir igual)
async function cstBudRellenar() {
  const g = parseFloat(String(_cstVal('cstbud-crec')).replace(',', '.'));
  const crec = isNaN(g) ? 0 : g;
  const meses = _cstBudMeses();
  const prods = _cstRutProd.filter(p => _cstBudUn(p.id, meses[0]) > 0);
  if (!prods.length) { pmToast('Primero escribí las unidades del primer mes', 'err'); return; }
  if (!confirm(`Se van a reemplazar los meses 2 a 12 de ${prods.length} producto${prods.length === 1 ? '' : 's'} a partir del primer mes (${_cstBudMesTxt(meses[0])}), con ${crec} % de cambio por mes. ¿Seguir?`)) return;
  try {
    for (const p of prods) {
      const base = _cstBudUn(p.id, meses[0]);
      for (let i = 1; i < 12; i++) await _cstBudGuardar(p.id, meses[i], Math.max(0, Math.round(base * Math.pow(1 + crec / 100, i))));
    }
    pmToast('Meses completados');
  } catch (e) {
    console.warn('[cstBudRellenar]', e.message);
    pmToast('⚠️ No se pudo guardar todo: ' + _cstErr(e, 'sql_costos_budget.sql'), 'err');
    await cstBudCargarDatos();
  }
  cstBudRender();
}

// ── Pintado ─────────────────────────────────────────────────
function _cstBudGrupos(prods) {
  const grupos = [];
  const usadas = new Set();
  _cstBudCats.forEach(c => {
    const lst = prods.filter(p => _cstBudProdCat[p.id] === c.id);
    if (lst.length) { grupos.push({ key: c.id, nombre: c.nombre, prods: lst }); lst.forEach(p => usadas.add(p.id)); }
  });
  const resto = prods.filter(p => !usadas.has(p.id));
  if (resto.length) grupos.push({ key: 'sin', nombre: 'Sin categoría de mercadeo', prods: resto });
  return grupos;
}

function cstBudRender() {
  const estEl = document.getElementById('cstbud-estado');
  const tabEl = document.getElementById('cstbud-tabla');
  if (!estEl || !tabEl) return;
  const per = _cstPerActual();
  estEl.innerHTML = per
    ? `<span class="badge ${per.estado === 'borrador' ? 'b0' : 'b3'}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">La capacidad de cada mes se mide contra la de este período${Number(per.meses) !== 1 ? ` (${Number(per.meses)} meses: se divide entre ${Number(per.meses)})` : ''}</span>`
    : '<span style="font-size:11px;color:var(--red)">No hay períodos: sin uno no se puede medir la capacidad (se crea en Costo laboral)</span>';
  if (!_cstRutProd.length) { tabEl.innerHTML = _cstPh('🍞', 'No hay productos activos en Maestros'); cstBudTotales(); return; }

  const C = cstBudCalcular();
  const grupos = _cstBudGrupos(C.prods);
  const th = (t, r) => `<th style="${_CST_BU_CEL}${r ? ';text-align:right' : ';text-align:left'};${_CST_BU_HEAD}">${t}</th>`;
  const celdaIn = (p, ym) => {
    const v = _cstBudUn(p.id, ym);
    return `<td style="${_CST_BU_CEL}"><input type="number" min="0" step="1" value="${v || ''}" placeholder="—" onchange="cstBudSet('${p.id}','${ym}',this.value)" onfocus="this.select()" style="width:62px;text-align:right"></td>`;
  };
  const filasHtml = grupos.map(g => `
    <tr style="background:#F1F5F9"><td style="${_CST_BU_CEL};font-weight:600">${pmEsc(g.nombre)} <span style="font-weight:400;color:var(--cream2)">· kg</span></td>
      ${C.meses.map((ym, i) => `<td style="${_CST_BU_CEL}${_CST_BU_MONO};color:var(--cream2)" id="cstbud-sub-${g.key}-${i}">—</td>`).join('')}
      <td style="${_CST_BU_CEL}${_CST_BU_MONO};color:var(--cream2)" id="cstbud-sub-${g.key}-t">—</td><td style="${_CST_BU_CEL}"></td></tr>
    ${g.prods.map(p => `<tr>
      <td style="${_CST_BU_CEL};white-space:nowrap">${pmEsc(p.nombre)}${C.kgPz[p.id] > 0 ? '' : '<span title="No tiene masa por pieza (peso del producto en Maestros): no suma kg" style="color:var(--red);margin-left:4px;cursor:help">⚠</span>'}</td>
      ${C.meses.map(ym => celdaIn(p, ym)).join('')}
      <td style="${_CST_BU_CEL}${_CST_BU_MONO}" id="cstbud-tot-${p.id}">—</td>
      <td style="${_CST_BU_CEL}${_CST_BU_MONO};color:var(--cream2)">${_cstBudReal[p.id] > 0 ? _cstNum(_cstBudReal[p.id], 0) : '—'}</td></tr>`).join('')}`).join('');

  tabEl.innerHTML = `
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="border-collapse:collapse;min-width:1080px;width:100%">
        <thead><tr>${th('Unidades por mes')}${C.meses.map(ym => th(_cstBudMesTxt(ym), 1)).join('')}${th('Total año', 1)}${th('Real (prom.)', 1).replace('<th ', '<th title="Promedio mensual de lo realmente vendido en los últimos meses cerrados: solo referencia, no cambia el budget" ')}</tr></thead>
        <tbody>${filasHtml}</tbody>
        <tfoot>
          <tr style="background:#F8FAFC"><td style="${_CST_BU_CEL};font-weight:600">Total unidades</td>${C.meses.map((ym, i) => `<td style="${_CST_BU_CEL}${_CST_BU_MONO};font-weight:600" id="cstbud-un-${i}">—</td>`).join('')}<td style="${_CST_BU_CEL}${_CST_BU_MONO};font-weight:600" id="cstbud-un-t">—</td><td style="${_CST_BU_CEL}"></td></tr>
          <tr style="background:#F8FAFC"><td style="${_CST_BU_CEL};font-weight:600">Total kg de masa</td>${C.meses.map((ym, i) => `<td style="${_CST_BU_CEL}${_CST_BU_MONO};font-weight:600" id="cstbud-kg-${i}">—</td>`).join('')}<td style="${_CST_BU_CEL}${_CST_BU_MONO};font-weight:600" id="cstbud-kg-t">—</td><td style="${_CST_BU_CEL}"></td></tr>
          <tr style="background:#F8FAFC"><td style="${_CST_BU_CEL};font-weight:600">Capacidad usada</td>${C.meses.map((ym, i) => `<td style="${_CST_BU_CEL}${_CST_BU_MONO};font-weight:600" id="cstbud-cap-${i}">—</td>`).join('')}<td style="${_CST_BU_CEL}"></td><td style="${_CST_BU_CEL}"></td></tr>
        </tfoot>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">Escribí las unidades que pensás vender (= producir) cada mes. Los productos salen del maestro y se agrupan con su categoría de mercadeo. <b>Real (prom.)</b> es solo una referencia: el promedio mensual de lo vendido en los últimos meses cerrados${_cstBudRealN ? ` (${_cstBudRealN} mes${_cstBudRealN === 1 ? '' : 'es'} con ventas)` : ''}; el budget no se toca solo. <b>Capacidad usada</b> = el departamento más exigido del mes (por su base y por horas-hombre) contra su capacidad normal mensual; verde hasta ${CST_PLN_OK} %, ámbar hasta 100 %, rojo si se pasa — en ese mes hay que corregir el presupuesto. Con el cursor sobre el porcentaje ves cuál departamento limita.</div>`;
  cstBudTotales();
}

// Totales, semáforos, tarjetas y avisos (no toca los inputs)
function cstBudTotales() {
  const C = cstBudCalcular();
  const set = (id, html, color) => { const el = document.getElementById(id); if (el) { el.innerHTML = html; el.style.color = color || ''; } };
  const fmt = (n, d) => n === null || n === undefined ? '—' : _cstNum(n, d === undefined ? 0 : d);
  const grupos = _cstBudGrupos(C.prods);
  // subtotales por categoría y totales por producto
  grupos.forEach(g => {
    let tot = 0;
    C.meses.forEach((ym, i) => {
      const kg = g.prods.reduce((a, p) => a + _cstBudUn(p.id, ym) * (C.kgPz[p.id] || 0), 0);
      tot += kg;
      set(`cstbud-sub-${g.key}-${i}`, kg > 0 ? fmt(kg, 1) : '—');
    });
    set(`cstbud-sub-${g.key}-t`, tot > 0 ? fmt(tot, 0) : '—');
  });
  C.prods.forEach(p => { const t = C.meses.reduce((a, ym) => a + _cstBudUn(p.id, ym), 0); set('cstbud-tot-' + p.id, t > 0 ? fmt(t) : '—'); });
  // pie
  const col = { ok: 'var(--green,#22A06B)', medio: '#B45309', alto: 'var(--red)' };
  C.porMes.forEach((m, i) => {
    set(`cstbud-un-${i}`, m.un > 0 ? fmt(m.un) : '—');
    set(`cstbud-kg-${i}`, m.kg > 0 ? fmt(m.kg, 1) : '—');
    const nv = _cstBudNivel(m.uso);
    const el = document.getElementById(`cstbud-cap-${i}`);
    if (el) {
      el.innerHTML = m.un > 0 && m.uso !== null ? _cstFmtPct(m.uso) : '—';
      el.style.color = nv && m.un > 0 ? col[nv] : '';
      el.title = m.un > 0 && m.donde ? 'Limita: ' + m.donde : '';
    }
  });
  set('cstbud-un-t', fmt(C.porMes.reduce((a, m) => a + m.un, 0)));
  set('cstbud-kg-t', fmt(C.porMes.reduce((a, m) => a + m.kg, 0), 0));

  // tarjetas
  const totKg = C.porMes.reduce((a, m) => a + m.kg, 0);
  const activos = C.porMes.filter(m => m.kg > 0);
  const pico = activos.length ? activos.reduce((a, m) => (m.kg > a.kg ? m : a)) : null;
  const excede = C.porMes.filter(m => m.un > 0 && m.uso !== null && m.uso > 100);
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const statsEl = document.getElementById('cstbud-stats');
  if (statsEl) {
    statsEl.innerHTML =
      stat('Unidades del año', fmt(C.porMes.reduce((a, m) => a + m.un, 0)), `${activos.length} mes${activos.length === 1 ? '' : 'es'} con ventas`) +
      stat('Kg de masa del año', totKg > 0 ? fmt(totKg, 0) + ' kg' : '—', activos.length ? `promedio ${fmt(totKg / activos.length, 0)} kg por mes con ventas` : '') +
      stat('Mes más grande', pico ? fmt(pico.kg, 0) + ' kg' : '—', pico ? _cstBudMesTxt(pico.ym) : '') +
      stat('Meses que exceden la capacidad', C.hayTarifas ? String(excede.length) : '—', C.hayTarifas ? (excede.length ? excede.map(m => _cstBudMesTxt(m.ym)).join(', ') : 'ninguno') : 'falta un período con capacidad');
  }

  // avisos
  const av = [];
  if (!C.per) av.push({ r: 0, t: 'No hay período de referencia: no se puede medir la capacidad. Creá uno en Costo laboral.' });
  else if (!C.hayTarifas) av.push({ r: 0, t: 'El período elegido no tiene departamentos productivos con capacidad: definilos en Capacidad y reparto.' });
  excede.forEach(m => av.push({ r: 1, t: `${_cstBudMesTxt(m.ym)}: usa ${_cstFmtPct(m.uso)} de la capacidad (${m.donde}). Hay que bajar unidades o ampliar la capacidad.` }));
  if (C.sinMasa.length) av.push({ r: 0, t: `Sin masa por pieza (no suman kg ni capacidad): ${C.sinMasa.slice(0, 5).map(p => p.nombre).join(', ')}${C.sinMasa.length > 5 ? ` y ${C.sinMasa.length - 5} más` : ''}.` });
  if (C.sinRuta.length) av.push({ r: 0, t: `Sin ruta de elaboración (suman kg pero no horas): ${C.sinRuta.slice(0, 5).map(p => p.nombre).join(', ')}${C.sinRuta.length > 5 ? ` y ${C.sinRuta.length - 5} más` : ''}.` });
  const avEl = document.getElementById('cstbud-avisos');
  if (avEl) {
    const rojo = av.some(a => a.r);
    avEl.innerHTML = av.length
      ? `<div class="card" style="border-color:${rojo ? 'var(--red)' : '#B45309'}"><div class="ctitle" style="color:${rojo ? 'var(--red)' : '#B45309'}">Revisar</div>${av.map(a => `<div style="font-size:12px;margin-bottom:3px;color:${a.r ? 'var(--red)' : '#B45309'}">⚠ ${pmEsc(a.t)}</div>`).join('')}</div>`
      : (activos.length ? '<div class="card" style="border-color:var(--green,#22A06B)"><div style="font-size:12px">✓ Ningún mes excede la capacidad</div></div>' : '');
  }
}
