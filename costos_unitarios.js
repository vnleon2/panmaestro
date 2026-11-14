// costos_unitarios.js — Módulo de Costos · Costo unitario por producto y precio sugerido (sobre el volumen del Budget)
// Prefijo cst (cstUn)
// Depende de costos_reportes.js (cstRepCalcular: materiales, empaque y mano de obra por pieza), costos_resbud.js
// (cstRbCalcular: costos y gastos presupuestados), costos_budget.js (unidades del Budget y categorías) y costos_tasas.js.
//
// DISEÑO: SOLO LECTURA. Costo unitario = lo DIRECTO de cada pieza + la parte que le toca de lo INDIRECTO presupuestado.
//   · Directo = materiales (receta, con merma) + empaque + mano de obra directa (horas de su ruta × tasa de MOD por HH).
//   · Indirecto = costos de fábrica indirectos (mano de obra fija + gastos de producción variables y fijos, con depreciación)
//     y gastos de venta, mercadeo y administración, todos del cuadro de Resultados presupuestarios.
//     Se reparten por kg de masa sobre el volumen presupuestado: tasa por kg = indirecto ÷ kg previstos; a cada pieza le toca
//     tasa × los kg de masa de la pieza.
//   · Base: todo el año del Budget o un mes. Con otra base cambia el volumen y por eso cambia la tasa por kg.
//   · Precio sugerido = costo total ÷ (1 − margen). El margen es sobre el precio de venta (40 % → el costo es el 60 % del precio).
//     Es el precio SIN IVA; se muestra también con el IVA del producto.
// Solo entran los productos con unidades en la base elegida.

let _cstUnBase = 'anio';     // 'anio' o 'YYYY-MM'
let _cstUnMargen = 40;       // % de margen sobre el precio

function cstUnCalcular() {
  const rb = cstRbCalcular();
  if (!rb) return null;
  const meses = _cstBudMeses();
  const idx = _cstUnBase === 'anio' ? meses.map((_, i) => i) : [Math.max(0, meses.indexOf(_cstUnBase))];
  const cols = idx.map(i => rb.cols[i]).filter(Boolean);
  const kgBase = cols.reduce((a, c) => a + c.kg, 0);
  // Indirecto presupuestado de la base (₡)
  const indFab = cols.reduce((a, c) => a + c.moFija + c.g.fab.v + c.g.fab.f, 0);
  const indGas = cols.reduce((a, c) => a + c.gastos, 0);
  const modTot = cols.reduce((a, c) => a + c.mod, 0);
  const tasaFab = kgBase > 0 ? indFab / kgBase : null;
  const tasaGas = kgBase > 0 ? indGas / kgBase : null;
  const rep = cstRepCalcular();
  const unidades = p => idx.reduce((a, i) => a + _cstBudUn(p.id, meses[i]), 0);
  const margen = Math.min(95, Math.max(0, Number(_cstUnMargen) || 0));
  const filas = [];
  let cuadreInd = 0, cuadreMod = 0;
  rep.forEach(f => {
    const un = unidades(f.p);
    if (!(un > 0)) return;
    const avisos = [];
    const mat = f.mat, emp = f.emp;
    const mod = f.c && !f.c.sinRuta ? f.c.mod : null;
    if (mat === null) avisos.push(...f.avisos.filter(a => a.startsWith('Materiales')));
    if (mod === null) avisos.push('Mano de obra: no tiene ruta (se arma en Etapas y rutas)');
    if (!(f.kgPz > 0)) avisos.push('No tiene masa por pieza: no se le puede repartir lo indirecto');
    const directoOk = mat !== null && mod !== null;
    const indOk = f.kgPz > 0 && tasaFab !== null;
    const directo = directoOk ? mat + emp + mod : null;
    const indFabPz = indOk ? tasaFab * f.kgPz : null;
    const indGasPz = indOk ? tasaGas * f.kgPz : null;
    const indirecto = indOk ? indFabPz + indGasPz : null;
    const total = directo !== null && indirecto !== null ? directo + indirecto : null;
    const sugerido = total !== null ? total / (1 - margen / 100) : null;
    const iva = f.iva;
    if (mod !== null) cuadreMod += un * mod;
    if (indOk) cuadreInd += un * indirecto;
    filas.push({ p: f.p, un, kgPz: f.kgPz, mat, emp, mod, directo, indFabPz, indGasPz, indirecto, total, sugerido, sugeridoIva: sugerido !== null ? sugerido * (1 + iva / 100) : null, precio: f.precio, iva, avisos });
  });
  return { filas, kgBase, indFab, indGas, modTot, tasaFab, tasaGas, margen, cuadreInd, cuadreMod, indTot: indFab + indGas };
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
  cstUnLlenarBase();
  cstUnRender();
}

function cstUnLlenarBase() {
  const sel = document.getElementById('cstun-base');
  if (!sel) return;
  sel.innerHTML = '<option value="anio">Todo el año del Budget</option>' + _cstBudMeses().map(m => `<option value="${m}">${pmEsc(_cstBudMesTxt(m))}</option>`).join('');
  sel.value = _cstUnBase === 'anio' || _cstBudMeses().includes(_cstUnBase) ? _cstUnBase : 'anio';
  _cstUnBase = sel.value;
}

function cstUnSetInicio(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  _cstBudInicio = v;
  try { localStorage.setItem(CST_BUD_LS, v); } catch (e) { /* ok */ }
  cstUnLlenarBase();
  cstUnRender();
}
function cstUnSetBase(v) { _cstUnBase = v || 'anio'; cstUnRender(); }
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
  const r = cstUnCalcular();
  if (!r) {
    if (stats) stats.innerHTML = ''; if (av) av.innerHTML = '';
    tabla.innerHTML = _cstPh('🏷️', 'Elegí un período con nómina y tarifas para calcular los costos unitarios');
    return;
  }
  const U = x => (x === null || x === undefined ? '—' : cstMoney(x, 2));   // unitarios: 2 decimales
  const P = x => (x === null || x === undefined ? '—' : cstMoney(Math.round(x), 0));   // precios: colones enteros
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:5px 8px;text-align:right';
  const bg = 'background:rgba(128,128,128,.10);';
  const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
  if (stats) stats.innerHTML = stat('Volumen de la base', _cstNum(r.kgBase, 1) + ' kg', _cstUnBase === 'anio' ? 'kg de masa del año' : 'kg de masa del mes') +
    stat('Indirecto por kg', r.tasaFab === null ? '—' : cstMoney(r.tasaFab + r.tasaGas, 2), r.tasaFab === null ? '' : `fábrica ${cstMoney(r.tasaFab, 2)} + gastos ${cstMoney(r.tasaGas, 2)}`) +
    stat('Margen sobre el precio', _cstNum(r.margen, 1) + ' %', 'precio = costo ÷ ' + _cstNum(1 - r.margen / 100, 2)) +
    stat('Productos', String(r.filas.length), 'con unidades en la base');
  const conAviso = r.filas.filter(f => f.avisos.length);
  const L = [];
  if (conAviso.length) L.push(`⚠ ${conAviso.length} producto${conAviso.length === 1 ? '' : 's'} sin costo completo: ${conAviso.map(f => f.p.nombre + ' (' + f.avisos.join('; ') + ')').join(' · ')}`);
  if (r.kgBase > 0 && r.indTot > 0) {
    const dif = Math.abs(r.cuadreInd - r.indTot) / r.indTot * 100;
    L.push((dif < 1 ? '✓ ' : '⚠ ') + `Cuadre: lo indirecto repartido a los productos suma ${cstMoney(Math.round(r.cuadreInd), 0)} de ${cstMoney(Math.round(r.indTot), 0)} presupuestados` + (dif < 1 ? '.' : ' — revisá los productos sin masa por pieza o sin ruta.'));
  }
  if (av) av.innerHTML = L.length ? `<div class="card">${L.map(x => `<div style="font-size:12px;margin:3px 0">${pmEsc(x)}</div>`).join('')}</div>` : '';
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead>` +
    `<tr style="border-bottom:1px solid var(--bdr)"><th style="${th};text-align:left" rowspan="2">Producto</th><th style="${th}" rowspan="2">Unidades</th>` +
    `<th style="${th};text-align:center;border-left:1px solid var(--bdr)" colspan="4">DIRECTO por unidad</th>` +
    `<th style="${th};text-align:center;border-left:1px solid var(--bdr)" colspan="3">INDIRECTO por unidad</th>` +
    `<th style="${th};border-left:1px solid var(--bdr)" rowspan="2">COSTO TOTAL</th><th style="${th}" rowspan="2">Precio sugerido (sin IVA)</th><th style="${th}" rowspan="2">Precio sugerido (con IVA)</th><th style="${th}" rowspan="2">Precio actual (con IVA)</th></tr>` +
    `<tr style="border-bottom:1px solid var(--bdr)"><th style="${th};border-left:1px solid var(--bdr)">Materiales</th><th style="${th}">Empaque</th><th style="${th}">Mano de obra</th><th style="${th}">Subtotal directo</th>` +
    `<th style="${th};border-left:1px solid var(--bdr)">Fábrica</th><th style="${th}">Gastos (venta, mercadeo, admin.)</th><th style="${th}">Subtotal indirecto</th></tr></thead><tbody>`;
  if (!r.filas.length) html += `<tr><td colspan="12" style="padding:14px;color:var(--cream2)">No hay productos con unidades en esa base. Cargalas en 📈 Budget de ventas.</td></tr>`;
  const grupos = _cstBudGrupos(r.filas.map(f => f.p));
  grupos.forEach(g => {
    html += `<tr><td colspan="12" style="padding:9px 8px 3px;font-size:11px;font-weight:700;color:var(--gold,#b8860b);text-transform:uppercase">${pmEsc(g.nombre)}</td></tr>`;
    g.prods.forEach(p => {
      const f = r.filas.find(x => x.p.id === p.id);
      html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="${td};text-align:left">${pmEsc(p.nombre)}</td><td style="${td}">${_cstNum(f.un, 0)}</td>` +
        `<td style="${td};border-left:1px solid var(--bdr)">${U(f.mat)}</td><td style="${td}">${U(f.emp)}</td><td style="${td}">${U(f.mod)}</td><td style="${td};font-weight:700;${bg}">${U(f.directo)}</td>` +
        `<td style="${td};border-left:1px solid var(--bdr)">${U(f.indFabPz)}</td><td style="${td}">${U(f.indGasPz)}</td><td style="${td};font-weight:700;${bg}">${U(f.indirecto)}</td>` +
        `<td style="${td};font-weight:800;border-left:1px solid var(--bdr)">${U(f.total)}</td><td style="${td};font-weight:700">${P(f.sugerido)}</td><td style="${td};font-weight:700">${P(f.sugeridoIva)}</td><td style="${td};color:var(--cream2)">${f.precio === null ? '—' : P(f.precio)}</td></tr>`;
    });
  });
  html += '</tbody></table></div>';
  tabla.innerHTML = html;
}
