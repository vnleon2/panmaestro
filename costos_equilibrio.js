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
//   · Equilibrio (piezas) = costos fijos ÷ contribución por pieza. Meta = (costos fijos + ganancia deseada) ÷ contribución.
//   · Equilibrio de UN producto a la vez (sin mezcla de productos); la tabla permite comparar todos.
//   · Capacidad = kg de ventas normales del período ÷ meses.

const CST_EQ_LS = 'cst_eq_prefs';
let _cstEqProd = '';              // producto de referencia (id)
let _cstEqMeta = 0;               // ganancia mensual que se quiere
let _cstEqPct = [50, 75, 100];    // % de la capacidad de cada escenario (conservador, esperado, alto)

const _CST_EQ_CEL = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
const _CST_EQ_MONO = ";text-align:right;font-family:'DM Mono',monospace;white-space:nowrap";
const _CST_EQ_HEAD = 'text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)';

function _cstEqCargarPrefs() {
  try {
    const o = JSON.parse(localStorage.getItem(CST_EQ_LS) || '{}');
    if (o.prod) _cstEqProd = o.prod;
    if (Number(o.meta) >= 0) _cstEqMeta = Number(o.meta) || 0;
    if (Array.isArray(o.pct) && o.pct.length === 3) _cstEqPct = o.pct.map(x => Number(x) > 0 ? Number(x) : 0);
  } catch (e) { /* ok */ }
}
function _cstEqGuardarPrefs() {
  try { localStorage.setItem(CST_EQ_LS, JSON.stringify({ prod: _cstEqProd, meta: _cstEqMeta, pct: _cstEqPct })); } catch (e) { /* ok */ }
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

  // Producto de referencia
  const utiles = filas.filter(f => f.baseOk && f.contribPz > 0);
  let ref = filas.find(f => f.p.id === _cstEqProd) || null;
  if (!ref) {
    ref = filas.find(f => /hogaza/i.test(f.p.nombre || '') && f.baseOk) || utiles.slice().sort((a, b) => b.contribKg - a.contribKg)[0] || filas[0] || null;
  }
  const orden = filas.slice().sort((a, b) => (b.contribKg === null ? -Infinity : b.contribKg) - (a.contribKg === null ? -Infinity : a.contribKg));

  const esc = [];
  if (ref && ref.baseOk && ref.contribPz > 0 && base.capKg > 0) {
    if (ref.eqKg > base.capKg) avisos.push({ nivel: 'rojo', t: `El equilibrio de ${ref.p.nombre} (${_cstNum(ref.eqKg, 0)} kg al mes) supera la capacidad (${_cstNum(base.capKg, 0)} kg). Hace falta subir el precio o la venta total.` });
    if (_cstEqMeta > 0 && ref.metaKg > base.capKg) avisos.push({ nivel: 'rojo', t: `Para ganar ${cstMoney(_cstEqMeta)} al mes con ${ref.p.nombre} se necesitan ${_cstNum(ref.metaKg, 0)} kg, más que la capacidad (${_cstNum(base.capKg, 0)} kg).` });
  }
  if (ref && !ref.baseOk) {
    const falta = [];
    if (ref.precio === null) falta.push('precio de lista');
    if (ref.mat === null) falta.push('costo de materiales (receta)');
    if (!(ref.kgPz > 0)) falta.push('masa por pieza');
    if (base.varKg === null) falta.push('kg de ventas normales');
    avisos.push({ nivel: 'amarillo', t: `No se puede calcular el equilibrio de ${ref.p.nombre}: falta ${falta.join(', ')}.` });
  }

  // Tres escenarios para el producto de referencia
  if (ref && ref.baseOk && base.capKg > 0) {
    _cstEqPct.forEach((pct, i) => {
      const kg = base.capKg * pct / 100;
      const un = kg / ref.kgPz;
      const ingresos = un * ref.neto;
      const cv = un * ref.cvPz;
      const contrib = ingresos - cv;
      esc.push({ nombre: ['Conservador', 'Esperado', 'Alto'][i], pct, kg, un, ingresos, cv, contrib, fijos: base.fijos, utilidad: contrib - base.fijos });
    });
  }
  return { per, base, filas, orden, ref, esc, avisos };
}

// ── Carga ───────────────────────────────────────────────────
async function cstEqInit() {
  _cstEqCargarPrefs();
  await cstRepInit();   // carga nómina, gastos, rutas, tarifas y capacidad; llena cstrp-*, que aquí no se usa
  cstPerLlenarSelectId('csteq-periodo');
  cstEqRender();
}

async function cstEqElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstEqRender();
}

function cstEqElegirProd(id) { _cstEqProd = id || ''; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqSetMeta(v) { const n = parseFloat(String(v).replace(',', '.')); _cstEqMeta = n > 0 ? n : 0; _cstEqGuardarPrefs(); cstEqRender(); }
function cstEqSetPct(i, v) { const n = parseFloat(String(v).replace(',', '.')); _cstEqPct[i] = n > 0 ? n : 0; _cstEqGuardarPrefs(); cstEqRender(); }
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
  const b = R.base, ref = R.ref;
  const guardado = per.estado !== 'borrador';
  estEl.innerHTML = `<span class="badge ${guardado ? 'b3' : 'b0'}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${b.meses === 1 ? 'El período es de 1 mes' : `El período tiene ${b.meses} meses: todo se muestra por mes`}</span>`;

  const opts = R.filas.map(f => `<option value="${pmEsc(f.p.id)}" ${ref && ref.p.id === f.p.id ? 'selected' : ''}>${pmEsc(f.p.nombre)}</option>`).join('');
  ctlEl.innerHTML = `<div class="row" style="margin-top:8px">
      <div class="col" style="flex:2"><label>Producto de referencia</label><select onchange="cstEqElegirProd(this.value)">${opts}</select></div>
      <div class="col"><label>Ganancia mensual que querés</label><input type="number" min="0" step="1000" value="${_cstEqMeta || ''}" placeholder="0" onchange="cstEqSetMeta(this.value)" style="text-align:right"></div>
    </div>`;

  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const ok = ref && ref.baseOk && ref.contribPz > 0;
  const unTxt = (pz, kg) => pz === null ? '—' : `${_cstNum(Math.ceil(pz), 0)} pz`;
  stats.innerHTML =
    stat('Costos fijos del mes', cstMoney(b.fijos), `nómina ${cstMoney(b.nomina)} + gastos fijos ${cstMoney(b.gastoFijo)}`) +
    stat('Capacidad del mes', b.capKg > 0 ? `${_cstNum(b.capKg, 0)} kg` : '—', 'ventas normales') +
    stat('Equilibrio', ok ? unTxt(ref.eqPz) : '—', ok ? `${_cstNum(ref.eqKg, 0)} kg de ${pmEsc(ref.p.nombre)}${b.capKg > 0 ? ' · ' + _cstFmtPct(ref.eqKg / b.capKg * 100) + ' de la capacidad' : ''}` : '') +
    stat('Meta', ok && _cstEqMeta > 0 ? unTxt(ref.metaPz) : '—', ok && _cstEqMeta > 0 ? `${_cstNum(ref.metaKg, 0)} kg para ganar ${cstMoney(_cstEqMeta)}` : 'escribí la ganancia que querés');

  const col = { rojo: 'var(--red)', amarillo: '#B45309' };
  avisosEl.innerHTML = R.avisos.length
    ? `<div class="card" style="border-color:${R.avisos.some(a => a.nivel === 'rojo') ? 'var(--red)' : '#B45309'}"><div class="ctitle" style="color:${R.avisos.some(a => a.nivel === 'rojo') ? 'var(--red)' : '#B45309'}">Revisar</div>${R.avisos.map(a => `<div style="font-size:12px;margin-bottom:3px;color:${col[a.nivel]}">⚠ ${pmEsc(a.t)}</div>`).join('')}</div>`
    : '<div class="card" style="border-color:var(--green,#22A06B)"><div style="font-size:12px">✓ Nada que corregir en los datos del equilibrio</div></div>';

  // Escenarios
  const th = (t, r) => `<th style="${_CST_EQ_CEL}${r ? ';text-align:right' : ''}">${t}</th>`;
  const m = x => `<td style="${_CST_EQ_CEL}${_CST_EQ_MONO}">${x}</td>`;
  escEl.innerHTML = R.esc.length ? `
    <div class="sec" style="margin-top:14px"><h2>Tres escenarios · ${pmEsc(ref.p.nombre)}</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:640px">
        <thead><tr style="${_CST_EQ_HEAD}">${th('Escenario')}${th('% de la capacidad', 1)}${th('Piezas', 1)}${th('Kg', 1)}${th('Ventas sin IVA', 1)}${th('Costo variable', 1)}${th('Contribución', 1)}${th('Costos fijos', 1)}${th('Utilidad', 1)}</tr></thead>
        <tbody>${R.esc.map((e, i) => `<tr>
          <td style="${_CST_EQ_CEL}">${e.nombre}</td>
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO}"><input type="number" min="1" step="5" value="${_cstEqPct[i]}" onchange="cstEqSetPct(${i}, this.value)" style="width:64px;text-align:right"> %</td>
          ${m(_cstNum(e.un, 0))}${m(_cstNum(e.kg, 0))}${m(cstMoney(e.ingresos))}${m(cstMoney(e.cv))}${m(cstMoney(e.contrib))}${m(cstMoney(e.fijos))}
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO};font-weight:600;color:${e.utilidad < 0 ? 'var(--red)' : 'var(--green,#22A06B)'}">${cstMoney(e.utilidad)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:6px"><button class="btn btn-out btn-sm" onclick="cstEqRestablecer()">↺ Volver a 50 / 75 / 100 %</button></div>` : '';

  // Tabla por producto
  const celda = (x, f) => `<td style="${_CST_EQ_CEL}${_CST_EQ_MONO}${f ? ';font-weight:600' : ''}">${x}</td>`;
  tabEl.innerHTML = `
    <div class="sec" style="margin-top:14px"><h2>Comparación por producto</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:900px">
        <thead><tr style="${_CST_EQ_HEAD}">${th('Producto')}${th('Masa pieza', 1)}${th('Precio sin IVA', 1)}${th('Costo variable', 1)}${th('Contribución por pieza', 1)}${th('Contribución por kg de masa', 1)}${th('Equilibrio (piezas)', 1)}${th('Equilibrio (kg)', 1)}${th('Meta (kg)', 1)}</tr></thead>
        <tbody>${R.orden.map(f => {
    const malo = f.baseOk && f.contribPz <= 0;
    return `<tr style="${ref && ref.p.id === f.p.id ? 'background:#EEF4FF' : ''}">
          <td style="${_CST_EQ_CEL}">${pmEsc(f.p.nombre)}${f.baseOk ? '' : '<span title="Faltan datos (precio, receta, masa o kg de ventas normales)" style="color:var(--red);margin-left:4px;cursor:help">⚠</span>'}</td>
          ${celda(f.kgPz > 0 ? _cstNum(f.kgPz * 1000, 0) + ' g' : '—')}${celda(f.neto === null ? '—' : cstMoneyU(f.neto))}${celda(f.cvPz === null ? '—' : cstMoneyU(f.cvPz))}
          <td style="${_CST_EQ_CEL}${_CST_EQ_MONO};color:${malo ? 'var(--red)' : 'inherit'}">${f.contribPz === null ? '—' : cstMoneyU(f.contribPz)}</td>
          ${celda(f.contribKg === null ? '—' : cstMoneyU(f.contribKg), 1)}
          ${celda(f.eqPz === null ? '—' : _cstNum(Math.ceil(f.eqPz), 0))}${celda(f.eqKg === null ? '—' : _cstNum(f.eqKg, 0))}${celda(f.metaKg === null || !_cstEqMeta ? '—' : _cstNum(f.metaKg, 0))}</tr>`;
  }).join('')}</tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">Todo por mes. <b>Costos fijos</b> = nómina completa + parte fija de los gastos. <b>Costo variable</b> = materiales + empaque + gasto variable por kg × masa de la pieza. <b>Contribución</b> = precio sin IVA − costo variable. Equilibrio = costos fijos ÷ contribución por pieza; se calcula para un producto a la vez, sin mezcla. La tabla va ordenada por lo que aporta cada kg de masa.</div>`;
}
