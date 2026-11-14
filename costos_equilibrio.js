// costos_equilibrio.js — Módulo de Costos · Resultados: Punto de equilibrio
// Prefijo cst (cstEq = pantalla; cstEqCalcular = cálculo puro)
// Depende de costos_core.js, costos_laboral.js, costos_gastos.js, costos_tasas.js, costos_reportes.js
// (cstRepCalcular) y de lo que carga cstRepInit (nómina, gastos, rutas, tarifas y capacidad del período).
//
// DISEÑO: SOLO LECTURA. No crea tablas ni escribe nada en Supabase. Todo se muestra por MES
// (el período puede tener varios meses: los montos del período se dividen entre sus meses).
//   · Costos fijos del mes = nómina completa (incluida la capacidad ociosa: se paga haya o no ventas)
//                            + la parte fija de cada renglón de gastos del período.
//   · Costo variable por pieza = materiales + empaque + gasto variable por kg × masa de la pieza.
//       El gasto variable sale del % variable de cada renglón de gastos, repartido por kg de ventas normales.
//   · Contribución por pieza = precio sin IVA − costo variable por pieza.
//   · EQUILIBRIO TOTAL EMPRESA (en kg) = costos fijos ÷ contribución promedio por kg de la mezcla de ventas.
//     Meta = (costos fijos + ganancia deseada) ÷ contribución promedio por kg.
//   · La mezcla (% de los kg vendidos por producto) sale, en este orden, de: lo que escribas a mano, el Presupuesto
//     de producción del período, o el producto de referencia al 100 % si no hay nada de lo anterior.
//   · La tabla por producto muestra el equilibrio si se vendiera SOLO ese producto (para comparar).
//   · Capacidad = kg de ventas normales del período ÷ meses.

const CST_EQ_LS = 'cst_eq_prefs';
let _cstEqProd = '';              // producto de referencia (id), solo se usa si no hay mezcla
let _cstEqVenta = 0;              // kg que se venden hoy al mes (a mano; sirve para medir cuánto hay que crecer)
let _cstEqMeta = 0;               // ganancia mensual que se quiere
let _cstEqMezcla = {};            // % de los kg por producto escrito a mano (id → %)
let _cstEqPlan = {};              // piezas del Presupuesto de producción por producto (id → piezas)
let _cstEqPct = [50, 75, 100];    // % de la capacidad de cada escenario (conservador, esperado, alto)

const _CST_EQ_CEL = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
const _CST_EQ_MONO = ";text-align:right;font-family:'DM Mono',monospace;white-space:nowrap";
const _CST_EQ_HEAD = 'text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)';

function _cstEqCargarPrefs() {
  try {
    const o = JSON.parse(localStorage.getItem(CST_EQ_LS) || '{}');
    if (o.prod) _cstEqProd = o.prod;
    if (o.mezcla && typeof o.mezcla === 'object') _cstEqMezcla = o.mezcla;
    if (Number(o.meta) >= 0) _cstEqMeta = Number(o.meta) || 0;
    if (Number(o.venta) >= 0) _cstEqVenta = Number(o.venta) || 0;
    if (Array.isArray(o.pct) && o.pct.length === 3) _cstEqPct = o.pct.map(x => Number(x) > 0 ? Number(x) : 0);
  } catch (e) { /* ok */ }
}
function _cstEqGuardarPrefs() {
  try { localStorage.setItem(CST_EQ_LS, JSON.stringify({ prod: _cstEqProd, meta: _cstEqMeta, venta: _cstEqVenta, pct: _cstEqPct, mezcla: _cstEqMezcla })); } catch (e) { /* ok */ }
}

// ── Cálculo (puro) ──────────────────────────────────────────
function cstEqCalcular() {
  const per = _cstPerActual();
  const meses = per && Number(per.meses) > 0 ? Number(per.meses) : 1;
  const avisos = [];

  const nominaPer = (_cstLineas || []).reduce((a, l) => a + (Number(l.monto) || 0), 0);
  const gas = cstGasResumen();
  const tas = cstTasActuales();
  const kgPer = tas && tas.kg > 0 ? tas.kg : 0;

  const base = {
    meses,
    nomina: nominaPer / meses,
    gastoFijo: gas.tot.f / meses,
    gastoVar: gas.tot.v / meses,
    capKg: kgPer / meses,
    varKg: kgPer > 0 ? gas.tot.v / kgPer : null,   // ₡ de gasto variable por kg de masa
  };
  base.fijos = base.nomina + base.gastoFijo;

  if (!(_cstLineas || []).length) avisos.push({ nivel: 'amarillo', t: 'El período no tiene nómina: los costos fijos quedan incompletos — generala en Costo laboral.' });
  if (!(_cstGasRows || []).length) avisos.push({ nivel: 'amarillo', t: 'El período no tiene gastos cargados: faltan la parte fija y la variable — cargalos en Gastos del período.' });
  if (!(kgPer > 0)) avisos.push({ nivel: 'amarillo', t: 'Falta el total de kg de ventas normales del período (se escribe en Tarifas y aprobación): sin eso no hay capacidad ni gasto variable por kg.' });

  const filas = cstRepCalcular().map(f => {
    const kgPz = f.kgPz > 0 ? f.kgPz : 0;
    const neto = f.precio !== null ? f.precio / (1 + f.iva / 100) : null;
    const baseOk = f.mat !== null && kgPz > 0 && base.varKg !== null && neto !== null;
    const gvPz = base.varKg !== null ? base.varKg * kgPz : null;
    const cvPz = baseOk ? f.mat + (f.emp || 0) + gvPz : null;
    const contribPz = baseOk ? neto - cvPz : null;
    const contribKg = contribPz !== null ? contribPz / kgPz : null;
    const eqPz = contribPz > 0 ? base.fijos / contribPz : null;
    const metaPz = contribPz > 0 ? (base.fijos + _cstEqMeta) / contribPz : null;
    return {
      p: f.p, kgPz, neto, precio: f.precio, mat: f.mat, emp: f.emp || 0, gvPz, cvPz, contribPz, contribKg,
      eqPz, eqKg: eqPz !== null ? eqPz * kgPz : null,
      metaPz, metaKg: metaPz !== null ? metaPz * kgPz : null,
      baseOk,
    };
  });

  // Productos con precio que no cubre el costo variable
  const malos = filas.filter(f => f.baseOk && f.contribPz <= 0);
  if (malos.length) avisos.push({ nivel: 'rojo', t: `El precio no cubre el costo variable en ${malos.length} producto${malos.length === 1 ? '' : 's'}: ${malos.slice(0, 4).map(f => f.p.nombre).join(', ')}${malos.length > 4 ? ` y ${malos.length - 4} más` : ''}. Cada pieza vendida pierde plata antes de pagar los fijos.` });

  // Producto de referencia (solo para el caso sin mezcla)
  const utiles = filas.filter(f => f.baseOk && f.contribPz > 0);
  let ref = filas.find(f => f.p.id === _cstEqProd) || null;
  if (!ref) ref = filas.find(f => /hogaza/i.test(f.p.nombre || '') && f.baseOk) || utiles.slice().sort((a, b) => b.contribKg - a.contribKg)[0] || filas[0] || null;
  const orden = filas.slice().sort((a, b) => (b.contribKg === null ? -Infinity : b.contribKg) - (a.contribKg === null ? -Infinity : a.contribKg));

  // Mezcla de ventas (% de los kg): manual → presupuesto de producción → referencia al 100 %
  const elegibles = filas.filter(f => f.baseOk);
  const peso = {};
  let origen = '';
  if (elegibles.some(f => Number(_cstEqMezcla[f.p.id]) > 0)) {
    origen = 'manual';
    elegibles.forEach(f => { peso[f.p.id] = Number(_cstEqMezcla[f.p.id]) || 0; });
  } else if (elegibles.some(f => Number(_cstEqPlan[f.p.id]) > 0)) {
    origen = 'plan';
    elegibles.forEach(f => { peso[f.p.id] = (Number(_cstEqPlan[f.p.id]) || 0) * f.kgPz; });
  } else if (ref && ref.baseOk) {
    origen = 'ref';
    peso[ref.p.id] = 1;
  }
  const totPeso = Object.values(peso).reduce((a, x) => a + x, 0);
  filas.forEach(f => { f.share = totPeso > 0 && peso[f.p.id] > 0 ? peso[f.p.id] / totPeso : 0; });

  const mix = { origen, ok: false };
  if (totPeso > 0) {
    const en = filas.filter(f => f.share > 0);
    mix.precioKg = en.reduce((a, f) => a + f.share * f.neto / f.kgPz, 0);
    mix.cvKg = en.reduce((a, f) => a + f.share * f.cvPz / f.kgPz, 0);
    mix.contribKg = mix.precioKg - mix.cvKg;
    mix.ok = true;
    if (mix.contribKg > 0) {
      mix.eqKg = base.fijos / mix.contribKg;
      mix.metaKg = (base.fijos + _cstEqMeta) / mix.contribKg;
    } else {
      avisos.push({ nivel: 'rojo', t: 'Con esta mezcla cada kg vendido deja contribución negativa o cero: no hay equilibrio posible. Hay que subir precios o bajar costos variables.' });
    }
    if (mix.eqKg && base.capKg > 0 && mix.eqKg > base.capKg) avisos.push({ nivel: 'rojo', t: `El equilibrio de la empresa (${_cstNum(mix.eqKg, 0)} kg al mes) supera la capacidad (${_cstNum(base.capKg, 0)} kg). Hace falta subir el precio o la venta total.` });
    if (mix.metaKg && _cstEqMeta > 0 && base.capKg > 0 && mix.metaKg > base.capKg) avisos.push({ nivel: 'rojo', t: `Para ganar ${cstMoney(_cstEqMeta)} al mes se necesitan ${_cstNum(mix.metaKg, 0)} kg, más que la capacidad (${_cstNum(base.capKg, 0)} kg).` });
    if (origen === 'ref') avisos.push({ nivel: 'amarillo', t: `No hay mezcla de ventas ni presupuesto de producción cargado: se calcula como si todo fuera ${ref.p.nombre} (100 %). Escribí abajo qué porcentaje de los kg es cada producto.` });
    const sin = filas.filter(f => !f.baseOk && (origen === 'plan' ? Number(_cstEqPlan[f.p.id]) > 0 : false));
    if (sin.length) avisos.push({ nivel: 'amarillo', t: `${sin.length} producto${sin.length === 1 ? '' : 's'} del presupuesto no entra${sin.length === 1 ? '' : 'n'} en la mezcla por falta de datos: ${sin.slice(0, 4).map(f => f.p.nombre).join(', ')}.` });
  } else {
    avisos.push({ nivel: 'amarillo', t: 'No se puede calcular el equilibrio: ningún producto tiene precio de lista, receta, masa por pieza y kg de ventas normales al mismo tiempo.' });
  }

  // Tres escenarios para toda la empresa (sobre la capacidad, con la misma mezcla)
  const esc = [];
  if (mix.ok && base.capKg > 0) {
    _cstEqPct.forEach((pct, i) => {
      const kg = base.capKg * pct / 100;
      const ingresos = kg * mix.precioKg, cv = kg * mix.cvKg, contrib = ingresos - cv;
      esc.push({ nombre: ['Conservador', 'Esperado', 'Alto'][i], pct, kg, ingresos, cv, contrib, fijos: base.fijos, utilidad: contrib - base.fijos });
    });
  }
  return { per, base, filas, orden, ref, mix, esc, avisos };
}

// ── Carga ───────────────────────────────────────────────────
// Piezas por producto del Presupuesto de producción del período (sirven para armar la mezcla)
async function cstEqCargarPlan() {
  _cstEqPlan = {};
  if (!_cstPerSel) return;
  try {
    const r = await pmDB.get('cost_plan', { periodo_id: _cstPerSel });
    (r || []).forEach(x => { _cstEqPlan[x.producto_id] = (_cstEqPlan[x.producto_id] || 0) + (Number(x.cantidad) || 0); });
  } catch (e) { console.warn('[cstEqCargarPlan]', e.message); }   // sin presupuesto: la mezcla se escribe a mano
}

async function cstEqInit() {
  _cstEqCargarPrefs();
  await cstRepInit();   // carga nómina, gastos, rutas, tarifas y capacidad; llena cstrp-*, que aquí no se usa
  await cstEqCargarPlan();
  cstPerLlenarSelectId('csteq-periodo');
  cstEqRender();
}

async function cstEqElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  await cstEqCargarPlan();
  cstEqRender();
}

function cstEqElegirProd(id) { _cstEqProd = id || ''; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqSetMeta(v) { const n = parseFloat(String(v).replace(',', '.')); _cstEqMeta = n > 0 ? n : 0; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqSetVenta(v) { const n = parseFloat(String(v).replace(',', '.')); _cstEqVenta = n > 0 ? n : 0; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqSetPct(i, v) { const n = parseFloat(String(v).replace(',', '.')); _cstEqPct[i] = n > 0 ? n : 0; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqSetMezcla(id, v) { const n = parseFloat(String(v).replace(',', '.')); if (n > 0) _cstEqMezcla[id] = n; else delete _cstEqMezcla[id]; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqMezclaAuto() { _cstEqMezcla = {}; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqRestablecer() { _cstEqPct = [50, 75, 100]; _cstEqGuardarPrefs(); cstEqRender(); }

// ── Pintado ─────────────────────────────────────────────────
function cstEqRender() {
  const estEl = document.getElementById('csteq-estado');
  const ctlEl = document.getElementById('csteq-controles');
  const stats = document.getElementById('csteq-stats');
  const avisosEl = document.getElementById('csteq-avisos');
  const escEl = document.getElementById('csteq-escenarios');
  const tabEl = document.getElementById('csteq-tabla');
  if (!estEl || !ctlEl || !stats || !avisosEl || !escEl || !tabEl) return;
  const per = _cstPerActual();
  if (!per) {
    estEl.textContent = ''; ctlEl.innerHTML = ''; stats.innerHTML = ''; avisosEl.innerHTML = ''; escEl.innerHTML = '';
    tabEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral y cargá sus datos');
    return;
  }
  const R = cstEqCalcular();
  const b = R.base, mix = R.mix;
  const guardado = per.estado !== 'borrador';
  estEl.innerHTML = `<span class="badge ${guardado ? 'b3' : 'b0'}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${b.meses === 1 ? 'El período es de 1 mes' : `El período tiene ${b.meses} meses: todo se muestra por mes`}</span>`;

  ctlEl.innerHTML = `<div class="row" style="margin-top:8px">
      <div class="col"><label>Ganancia mensual que querés</label><input type="number" min="0" step="1000" value="${_cstEqMeta || ''}" placeholder="0" onchange="cstEqSetMeta(this.value)" style="text-align:right"></div>
      <div class="col"><label>Kg que vendés hoy al mes</label><input type="number" min="0" step="1" value="${_cstEqVenta || ''}" placeholder="0" onchange="cstEqSetVenta(this.value)" style="text-align:right"></div>
    </div>`;

  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const hayEq = mix.ok && mix.contribKg > 0;
  stats.innerHTML =
    stat('Costos fijos del mes', cstMoney(b.fijos), `nómina ${cstMoney(b.nomina)} + gastos fijos ${cstMoney(b.gastoFijo)}`) +
    stat('Capacidad del mes', b.capKg > 0 ? `${_cstNum(b.capKg, 0)} kg` : '—', 'ventas normales') +
    stat('Contribución por kg', hayEq ? cstMoney(mix.contribKg) : '—', hayEq ? `precio ${cstMoney(mix.precioKg)} − variable ${cstMoney(mix.cvKg)}` : 'con la mezcla de abajo') +
    stat('Equilibrio de la empresa', hayEq ? `${_cstNum(mix.eqKg, 0)} kg` : '—', hayEq && b.capKg > 0 ? `${_cstFmtPct(mix.eqKg / b.capKg * 100)} de la capacidad` : 'kg que hay que vender al mes') +
    stat('Meta', hayEq && _cstEqMeta > 0 ? `${_cstNum(mix.metaKg, 0)} kg` : '—', hayEq && _cstEqMeta > 0 ? `para ganar ${cstMoney(_cstEqMeta)} al mes` : 'escribí la ganancia que querés');

  const col = { rojo: 'var(--red)', amarillo: '#B45309' };
  const hayRojo = R.avisos.some(a => a.nivel === 'rojo');
  avisosEl.innerHTML = R.avisos.length
    ? `<div class="card" style="border-color:${hayRojo ? 'var(--red)' : '#B45309'}"><div class="ctitle" style="color:${hayRojo ? 'var(--red)' : '#B45309'}">Revisar</div>${R.avisos.map(a => `<div style="font-size:12px;margin-bottom:3px;color:${col[a.nivel]}">⚠ ${pmEsc(a.t)}</div>`).join('')}</div>`
    : '<div class="card" style="border-color:var(--green,#22A06B)"><div style="font-size:12px">✓ Nada que corregir en los datos del equilibrio</div></div>';

  const th = (t, r) => `<th style="${_CST_EQ_CEL}${r ? ';text-align:right' : ''}">${t}</th>`;
  const m = x => `<td style="${_CST_EQ_CEL}${_CST_EQ_MONO}">${x}</td>`;

  // Mezcla de ventas
  const origenTxt = { manual: 'escrita a mano', plan: 'tomada del Presupuesto de producción del período', ref: 'sin mezcla: 100 % del producto de referencia' }[mix.origen] || 'sin datos';
  const filasMezcla = R.filas.filter(f => f.baseOk);
  // ¿Cuánto hay que crecer? Objetivo (kg al mes) frente a lo que se vende hoy
  const objs = [];
  if (hayEq) {
    objs.push({ n: 'Equilibrio: cubrir los costos fijos', kg: mix.eqKg });
    if (_cstEqMeta > 0) objs.push({ n: `Meta: ganar ${cstMoney(_cstEqMeta)} al mes`, kg: mix.metaKg });
  }
  const venta = _cstEqVenta;
  const crecerHtml = objs.length ? `
    <div class="sec" style="margin-top:14px"><h2>¿Cuánto hay que crecer?</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:520px">
        <thead><tr style="${_CST_EQ_HEAD}">${th('Objetivo')}${th('Kg al mes', 1)}${th('Hoy vendés (kg)', 1)}${th('Faltan (kg)', 1)}${th('Hay que crecer', 1)}${th('% de la capacidad', 1)}</tr></thead>
        <tbody>${objs.map(o => {
    const falta = venta > 0 ? o.kg - venta : null;
    const pct = venta > 0 ? (o.kg / venta - 1) * 100 : null;
    const ok = falta !== null && falta <= 0;
    return `<tr><td style="${_CST_EQ_CEL}">${pmEsc(o.n)}</td>${m(_cstNum(o.kg, 0))}${m(venta > 0 ? _cstNum(venta, 0) : '—')}
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO};font-weight:600;color:${falta === null ? 'inherit' : ok ? 'var(--green,#22A06B)' : 'var(--red)'}">${falta === null ? '—' : ok ? 'ya lo superás en ' + _cstNum(-falta, 0) : _cstNum(falta, 0)}</td>
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO};font-weight:600">${pct === null ? '—' : ok ? '—' : _cstNum(pct, 0) + ' %'}</td>
          ${m(b.capKg > 0 ? _cstFmtPct(o.kg / b.capKg * 100) : '—')}</tr>`;
  }).join('')}</tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">${venta > 0 ? 'Con la mezcla de ventas de abajo.' : 'Escribí arriba cuántos kg vendés hoy al mes para ver cuánto hay que crecer.'} Como los sueldos son fijos, el equilibrio cuenta toda la nómina como costo fijo.</div>` : '';
  escEl.innerHTML = crecerHtml + `
    <div class="sec" style="margin-top:14px"><h2>Mezcla de ventas</h2></div>
    <div style="font-size:11px;color:var(--cream2);margin-bottom:6px">Qué porcentaje de los kg vendidos es cada producto. Mezcla actual: <b>${origenTxt}</b>. Si escribís porcentajes, se ajustan solos para sumar 100 %.</div>
    ${filasMezcla.length ? `<div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:520px">
        <thead><tr style="${_CST_EQ_HEAD}">${th('Producto')}${th('% de los kg (escribir)', 1)}${th('% usado', 1)}${th('Kg al equilibrio', 1)}${th('Contribución por kg', 1)}</tr></thead>
        <tbody>${filasMezcla.map(f => `<tr>
          <td style="${_CST_EQ_CEL}">${pmEsc(f.p.nombre)}</td>
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO}"><input type="number" min="0" step="1" value="${_cstEqMezcla[f.p.id] || ''}" placeholder="—" onchange="cstEqSetMezcla('${f.p.id}', this.value)" style="width:72px;text-align:right"> %</td>
          ${m(f.share > 0 ? _cstFmtPct(f.share * 100) : '—')}${m(hayEq && f.share > 0 ? _cstNum(mix.eqKg * f.share, 0) : '—')}${m(cstMoneyU(f.contribKg))}</tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:6px"><button class="btn btn-out btn-sm" onclick="cstEqMezclaAuto()">↺ Quitar lo escrito (usar el presupuesto)</button></div>` : _cstPh('📊', 'Ningún producto tiene todos los datos para entrar en la mezcla')}`;

  // Escenarios + tabla por producto
  const celda = (x, f) => `<td style="${_CST_EQ_CEL}${_CST_EQ_MONO}${f ? ';font-weight:600' : ''}">${x}</td>`;
  const escHtml = R.esc.length ? `
    <div class="sec" style="margin-top:14px"><h2>Tres escenarios · toda la empresa</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:640px">
        <thead><tr style="${_CST_EQ_HEAD}">${th('Escenario')}${th('% de la capacidad', 1)}${th('Kg', 1)}${th('Ventas sin IVA', 1)}${th('Costo variable', 1)}${th('Contribución', 1)}${th('Costos fijos', 1)}${th('Utilidad', 1)}</tr></thead>
        <tbody>${R.esc.map((e, i) => `<tr>
          <td style="${_CST_EQ_CEL}">${e.nombre}</td>
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO}"><input type="number" min="1" step="5" value="${_cstEqPct[i]}" onchange="cstEqSetPct(${i}, this.value)" style="width:64px;text-align:right"> %</td>
          ${m(_cstNum(e.kg, 0))}${m(cstMoney(e.ingresos))}${m(cstMoney(e.cv))}${m(cstMoney(e.contrib))}${m(cstMoney(e.fijos))}
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO};font-weight:600;color:${e.utilidad < 0 ? 'var(--red)' : 'var(--green,#22A06B)'}">${cstMoney(e.utilidad)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:6px"><button class="btn btn-out btn-sm" onclick="cstEqRestablecer()">↺ Volver a 50 / 75 / 100 %</button></div>` : '';

  tabEl.innerHTML = escHtml + `
    <div class="sec" style="margin-top:14px"><h2>Comparación por producto (si se vendiera solo ese)</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:900px">
        <thead><tr style="${_CST_EQ_HEAD}">${th('Producto')}${th('Masa pieza', 1)}${th('Precio sin IVA', 1)}${th('Costo variable', 1)}${th('Contribución por pieza', 1)}${th('Contribución por kg de masa', 1)}${th('Equilibrio (piezas)', 1)}${th('Equilibrio (kg)', 1)}${th('Meta (kg)', 1)}</tr></thead>
        <tbody>${R.orden.map(f => {
    const malo = f.baseOk && f.contribPz <= 0;
    return `<tr>
          <td style="${_CST_EQ_CEL}">${pmEsc(f.p.nombre)}${f.baseOk ? '' : '<span title="Faltan datos (precio, receta, masa o kg de ventas normales)" style="color:var(--red);margin-left:4px;cursor:help">⚠</span>'}</td>
          ${celda(f.kgPz > 0 ? _cstNum(f.kgPz * 1000, 0) + ' g' : '—')}${celda(f.neto === null ? '—' : cstMoneyU(f.neto))}${celda(f.cvPz === null ? '—' : cstMoneyU(f.cvPz))}
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO};color:${malo ? 'var(--red)' : 'inherit'}">${f.contribPz === null ? '—' : cstMoneyU(f.contribPz)}</td>
          ${celda(f.contribKg === null ? '—' : cstMoneyU(f.contribKg), 1)}
          ${celda(f.eqPz === null ? '—' : _cstNum(Math.ceil(f.eqPz), 0))}${celda(f.eqKg === null ? '—' : _cstNum(f.eqKg, 0))}${celda(f.metaKg === null || !_cstEqMeta ? '—' : _cstNum(f.metaKg, 0))}</tr>`;
  }).join('')}</tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">Todo por mes. <b>Costos fijos</b> = nómina completa + parte fija de los gastos. <b>Costo variable</b> = materiales + empaque + gasto variable por kg × masa de la pieza. <b>Contribución</b> = precio sin IVA − costo variable. <b>Equilibrio de la empresa</b> = costos fijos ÷ contribución promedio por kg de la mezcla de ventas. La tabla va ordenada por lo que aporta cada kg de masa.</div>`;
}
