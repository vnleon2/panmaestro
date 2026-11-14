// costos_unitarios.js — Módulo de Costos · Costo unitario estándar por producto y precio sugerido
// Prefijo cst (cstUn)
// Depende de costos_reportes.js (cstRepCalcular: costo estándar por pieza), costos_budget.js (productos del Budget y categorías)
// y costos_tasas.js (tarifas del período).
//
// DISEÑO: SOLO LECTURA. Es el COSTO ESTÁNDAR: no depende del volumen del Budget.
//   · Directo = materiales (receta, con merma) + empaque + mano de obra directa (horas de la ruta × tasa de MOD por HH).
//   · Indirecto = CIF fijo y variable de fábrica (tarifas por departamento a capacidad normal, según la ruta del producto)
//     + gastos del período de venta, mercadeo y administración (tasa por kg sobre los «kg de ventas normales» × masa de la pieza).
//     La capacidad ociosa no se carga a las piezas.
//   · Precio sugerido = costo total ÷ (1 − margen). El margen es sobre el precio de venta (40 % → el costo es el 60 % del precio).
//     Es el precio SIN IVA; se muestra también con el IVA de cada producto.
// Funciona sin Budget: lista todos los productos. El Budget es opcional (filtro de productos y, con el botón de Tarifas, fuente de los
// kg de ventas normales, que también se pueden escribir a mano). No toca el costo actual de Costeo / Precio de venta.

let _cstUnMargen = 40;       // % de margen sobre el precio
let _cstUnSoloBudget = false; // listar solo los productos con unidades en el Budget (por defecto, todos)

function cstUnCalcular() {
  if (!_cstPerActual()) return null;
  const tas = cstTasActuales();
  const meses = _cstBudMeses();
  const udsAnio = p => meses.reduce((a, m) => a + _cstBudUn(p.id, m), 0);
  const margen = Math.min(95, Math.max(0, Number(_cstUnMargen) || 0));
  const filas = [];
  cstRepCalcular().forEach(f => {
    const un = udsAnio(f.p);
    if (_cstUnSoloBudget && !(un > 0)) return;
    const avisos = [];
    if (f.mat === null) avisos.push(...f.avisos.filter(a => a.startsWith('Materiales')));
    const c = f.c;
    if (c && c.sinRuta) avisos.push('Conversión: no tiene ruta (se arma en Etapas y rutas)');
    else if (c && c.avisos.length) avisos.push(...c.avisos.map(a => 'Conversión: ' + a));
    // Conversión utilizable aunque falten los kg de ventas normales (esos solo afectan los gastos del período)
    const convOk = !!c && !c.sinRuta && c.avisos.length === 0 && c.completo !== undefined;
    const mod = convOk ? c.mod : null;
    const fija = convOk ? c.fija : null, vari = convOk ? c.vari : null;
    const gastos = convOk && c.capa2 !== null && c.capa2 !== undefined ? c.capa2 : null;
    if (convOk && gastos === null) avisos.push('Gastos del período: faltan los kg de ventas normales o la masa de la pieza');
    const directo = f.mat !== null && mod !== null ? f.mat + f.emp + mod : null;
    // Forma canónica (NIC 2): costo de fábrica = materiales + empaque + MOD + CIF fijo (a capacidad normal) + CIF variable.
    // Los gastos de venta, mercadeo y administración no son costo de fábrica: se suman aparte para el precio.
    const indirecto = fija !== null && vari !== null ? fija + vari : null;
    const fabrica = directo !== null && indirecto !== null ? directo + indirecto : null;
    const total = fabrica !== null && gastos !== null ? fabrica + gastos : null;
    const sugerido = total !== null ? total / (1 - margen / 100) : null;
    filas.push({ p: f.p, un, mat: f.mat, emp: f.mat !== null ? f.emp : null, mod, directo, fija, vari, gastos,
      indirecto, fabrica, total, sugerido, sugeridoIva: sugerido !== null ? sugerido * (1 + f.iva / 100) : null, precio: f.precio, iva: f.iva, avisos,
      sinEmp: !((typeof _cstProdEmp !== 'undefined' && _cstProdEmp[f.p.id]) || []).length });
  });
  // Referencia: promedio mensual del Budget frente a los kg de ventas normales del estándar
  let kgBud = 0, mesesBud = 0;
  try { cstBudCalcular().porMes.forEach(x => { if (x.un > 0) { kgBud += x.kg; mesesBud++; } }); } catch (e) { /* ok */ }
  return { filas, margen, kgNormales: tas.kg, tasaKg: tas.tasaKg, gastoTotal: tas.gasto ? tas.gasto.total : 0, kgBudMes: mesesBud ? kgBud / mesesBud : null, origen: tas.origen };
}

// ── Pantalla ────────────────────────────────────────────────
async function cstUnInit() {
  if (!(await _cstGbAsegurar())) return;
  if (!(await cstBudAsegurarCostos())) return;
  await cstBudCargarDatos();
  await cstGbCargarDatos();
  await cstEmpCargarMaestros();
  cstPerLlenarSelectId('cstun-periodo', '— Sin períodos —');
  const ini = document.getElementById('cstun-inicio');
  if (ini) ini.value = _cstBudInicio;
  const mg = document.getElementById('cstun-margen'); if (mg) mg.value = _cstUnMargen;
  cstUnRender();
}

function cstUnSetInicio(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  _cstBudInicio = v;
  try { localStorage.setItem(CST_BUD_LS, v); } catch (e) { /* ok */ }
  cstUnRender();
}
function cstUnSoloBud(v) { _cstUnSoloBudget = !!v; cstUnRender(); }
function cstUnSetMargen(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  _cstUnMargen = isNaN(n) ? 40 : Math.min(95, Math.max(0, n));
  cstUnRender();
}
async function cstUnElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstUnRender();
}

function cstUnRender() {
  const tabla = document.getElementById('cstun-tabla');
  if (!tabla) return;
  const stats = document.getElementById('cstun-stats');
  const av = document.getElementById('cstun-avisos');
  const chk = document.getElementById('cstun-solobud'); if (chk) chk.checked = _cstUnSoloBudget;
  const r = cstUnCalcular();
  if (!r) {
    if (stats) stats.innerHTML = ''; if (av) av.innerHTML = '';
    tabla.innerHTML = _cstPh('🏷️', 'Elegí un período para calcular el costo estándar');
    return;
  }
  const U = x => (x === null || x === undefined ? '—' : cstMoney(x, 2));   // unitarios: 2 decimales
  const P = x => (x === null || x === undefined ? '—' : cstMoney(Math.round(x), 0));   // precios: colones enteros
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:5px 8px;text-align:right';
  const bg = 'background:rgba(128,128,128,.10);';
  const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
  if (stats) stats.innerHTML = stat('Kg de ventas normales', r.kgNormales > 0 ? _cstNum(r.kgNormales, 1) + ' kg' : 'sin definir', 'base de la tasa de gasto del estándar') +
    stat('Gasto del período por kg', r.tasaKg === null || r.tasaKg === undefined ? '—' : cstMoney(r.tasaKg, 2), 'venta + mercadeo + administración') +
    stat('Margen sobre el precio', _cstNum(r.margen, 1) + ' %', 'precio = costo ÷ ' + _cstNum(1 - r.margen / 100, 2)) +
    stat('Productos', String(r.filas.length), r.origen === 'guardado' ? 'tarifas del período aprobado' : 'tarifas calculadas en vivo (borrador)');
  const L = [];
  if (!(r.kgNormales > 0)) L.push('⚠ Faltan los kg de ventas normales del período: sin ellos no hay tasa de gasto y los costos salen incompletos (escribilos a mano en Tarifas, o usá el botón «Tomar del Budget»).');
  else if (r.kgBudMes) {
    const dif = (r.kgBudMes - r.kgNormales / (Number(_cstPerActual().meses) || 1)) / (r.kgNormales / (Number(_cstPerActual().meses) || 1)) * 100;
    if (Math.abs(dif) > 15) L.push(`ℹ El Budget promedia ${_cstNum(r.kgBudMes, 1)} kg al mes y los kg de ventas normales del estándar son ${_cstNum(r.kgNormales / (Number(_cstPerActual().meses) || 1), 1)} al mes (${_cstNum(dif, 0)} %). El estándar no se mueve con el Budget; esa diferencia aparecerá como variación de volumen.`);
  }
  const conAviso = r.filas.filter(f => f.avisos.length);
  if (conAviso.length) L.push(`⚠ ${conAviso.length} producto${conAviso.length === 1 ? '' : 's'} sin costo completo: ${conAviso.map(f => f.p.nombre + ' (' + f.avisos.join('; ') + ')').join(' · ')}`);
  L.push('ℹ Costo de fábrica = materiales + empaque + mano de obra + CIF fijo (sobre capacidad normal) + CIF variable. Los gastos de venta, mercadeo y administración se suman aparte para el precio. La capacidad que no se usa no se carga a la pieza: queda como CIF fijo no absorbido (ver Resultados presupuestarios).');
  const sinEmp = r.filas.filter(f => f.sinEmp);
  if (sinEmp.length) L.push(`📦 ${sinEmp.length} de ${r.filas.length} productos no tienen empaque asignado (su costo total no lo incluye): ${sinEmp.map(f => f.p.nombre).join(' · ')}. Se asigna en Empaques › Por producto.`);
  if (av) av.innerHTML = L.length ? `<div class="card">${L.map(x => `<div style="font-size:12px;margin:3px 0">${pmEsc(x)}</div>`).join('')}</div>` : '';
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead>` +
    `<tr style="border-bottom:1px solid var(--bdr)"><th style="${th};text-align:left" rowspan="2">Producto</th><th style="${th}" rowspan="2" title="Unidades del año en el Budget (solo referencia)">Budget (un./año)</th>` +
    `<th style="${th};text-align:center;border-left:1px solid var(--bdr)" colspan="4">DIRECTO por unidad</th>` +
    `<th style="${th};text-align:center;border-left:1px solid var(--bdr)" colspan="3">INDIRECTO de fábrica por unidad</th>` +
    `<th style="${th};border-left:1px solid var(--bdr)" rowspan="2" title="Materiales + empaque + mano de obra + CIF fijo + CIF variable (NIC 2)">COSTO DE FÁBRICA</th><th style="${th}" rowspan="2" title="Venta, mercadeo y administración: no son costo de fábrica, pero el precio debe cubrirlos">Gastos del período</th><th style="${th};border-left:1px solid var(--bdr)" rowspan="2">COSTO TOTAL (para precio)</th><th style="${th}" rowspan="2">Precio sugerido (sin IVA)</th><th style="${th}" rowspan="2">Precio sugerido (con IVA)</th><th style="${th}" rowspan="2">Precio actual (con IVA)</th></tr>` +
    `<tr style="border-bottom:1px solid var(--bdr)"><th style="${th};border-left:1px solid var(--bdr)">Materiales</th><th style="${th}">Empaque</th><th style="${th}">Mano de obra</th><th style="${th}">Subtotal directo</th>` +
    `<th style="${th};border-left:1px solid var(--bdr)">CIF fijo</th><th style="${th}">CIF variable</th><th style="${th}">Subtotal indirecto</th></tr></thead><tbody>`;
  if (!r.filas.length) html += `<tr><td colspan="15" style="padding:14px;color:var(--cream2)">No hay productos para mostrar. Cargalos en 📈 Budget de ventas o quitá el tick «Solo productos del Budget».</td></tr>`;
  _cstBudGrupos(r.filas.map(f => f.p)).forEach(g => {
    html += `<tr><td colspan="15" style="padding:9px 8px 3px;font-size:11px;font-weight:700;color:var(--gold,#b8860b);text-transform:uppercase">${pmEsc(g.nombre)}</td></tr>`;
    g.prods.forEach(p => {
      const f = r.filas.find(x => x.p.id === p.id);
      html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="${td};text-align:left">${pmEsc(p.nombre)}</td><td style="${td};color:var(--cream2)">${f.un > 0 ? _cstNum(f.un, 0) : '—'}</td>` +
        `<td style="${td};border-left:1px solid var(--bdr)">${U(f.mat)}</td><td style="${td}">${f.sinEmp && f.mat !== null ? '<span style="color:#b45309;font-size:11px" title="No tiene empaque asignado (Empaques › Por producto)">sin asignar</span>' : U(f.emp)}</td><td style="${td}">${U(f.mod)}</td><td style="${td};font-weight:700;${bg}">${U(f.directo)}</td>` +
        `<td style="${td};border-left:1px solid var(--bdr)">${U(f.fija)}</td><td style="${td}">${U(f.vari)}</td><td style="${td};font-weight:700;${bg}">${U(f.indirecto)}</td>` +
        `<td style="${td};font-weight:800;border-left:1px solid var(--bdr)">${U(f.fabrica)}</td><td style="${td}">${U(f.gastos)}</td><td style="${td};font-weight:800;border-left:1px solid var(--bdr)">${U(f.total)}</td><td style="${td};font-weight:700">${P(f.sugerido)}</td><td style="${td};font-weight:700">${P(f.sugeridoIva)}</td><td style="${td};color:var(--cream2)">${f.precio === null ? '—' : P(f.precio)}</td></tr>`;
    });
  });
  html += '</tbody></table></div>';
  tabla.innerHTML = html;
}
