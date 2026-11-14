// costos_compras.js — Módulo de Costos · Compras de materiales y nómina estimada (desde el Budget de ventas)
// Prefijo cst (cstCom = compras; cstNom = nómina estimada)
// Depende de costos_budget.js (matriz de 12 meses, cstBudCalcular), costos_rutas.js (productos), costos_laboral.js
// (nómina) y del recetario (pmCostoReceta, _sbRecLista, _sbResolveIng).
//
// DISEÑO: SOLO LECTURA. No crea tablas ni escribe nada.
//   · Compras: explota la receta de cada producto (con sus subrecetas, rellenos y la merma de cada receta) hasta los
//     ingredientes. Cada pieza lleva la cantidad de ingredientes de su receta escalada a su peso (peso del producto ÷ masa de la receta),
//     igual que el costo de materiales de los reportes. Unidades del Budget × ingredientes por pieza = lo que hay que comprar cada mes.
//   · Nómina: mano de obra directa (HH del Budget × tasa de MOD por HH, que sale de los factores de asignación de la nómina)
//     + nómina fija (producción no absorbida, capacidad ociosa, apoyo, administración, mercadeo y venta). La nómina es la del período en Costo laboral.

let _cstComVer = 'kg';   // 'kg' | 'cr'

// ── Explosión de una receta hasta ingredientes (puro) ───────
function _cstComSumar(out, ing, g, factor, esAddon) {
  if (!(g > 0)) return;
  const i = esAddon ? pmAddonIng(ing) : _sbResolveIng(ing);
  const nombre = (i && i.nombre) || ing.productName || ing.manualName || ing.ingrediente || '(sin nombre)';
  const key = i ? (i.id || i.nombre) : nombre;
  const cpg = i && i.price && i.qty ? i.price / i.qty : 0;
  const e = out.get(key) || { nombre, g: 0, cpg };
  e.g += g * factor;
  if (!e.cpg && cpg) e.cpg = cpg;
  out.set(key, e);
}

// Gramos de cada ingrediente para hacer la receta r a su masa base; factor = multiplicador heredado (merma de las recetas padre)
function _cstComExplotar(r, targetMass, out, factor, visited) {
  visited = visited || new Set();
  if (r.code && visited.has(r.code)) return;
  if (r.code) visited = new Set([...visited, r.code]);
  const baseFlourPct = (r.flour || []).reduce((a, i) => a + (parseFloat(i.pct) || 0), 0);
  const otherPct = (r.other || []).reduce((a, i) => a + (parseFloat(i.pct) || 0), 0);
  const subsPct = (r.subrecs || []).reduce((a, s) => s.gFijos > 0 ? a : (parseFloat(s.pct) || 0) + a, 0);
  const totalPct = baseFlourPct + otherPct + subsPct;
  const refMass = targetMass || r.totalMass || 1000;
  const flourW = totalPct > 0 ? refMass * 100 / totalPct : refMass;
  const mf = 1 + (r.merma || 0) / 100;
  (r.flour || []).forEach(ing => _cstComSumar(out, ing, flourW * (parseFloat(ing.pct) || 0) / 100, factor * mf, false));
  (r.other || []).forEach(ing => _cstComSumar(out, ing, flourW * (parseFloat(ing.pct) || 0) / 100, factor * mf, false));
  (r.subrecs || []).forEach(sub => {
    const ref = (_sbRecLista() || []).find(x => x.code === sub.recId);
    if (!ref) return;
    const subMass = sub.gFijos > 0 ? sub.gFijos : (sub.pct > 0 ? flourW * sub.pct / 100 : 0);
    if (subMass > 0) _cstComExplotar(ref, subMass, out, factor * mf, visited);
  });
  (r.addons || []).forEach(addon => {
    if (addon.ingrediente) {
      if (addon.gPorUnidad) _cstComSumar(out, addon, addon.gPorUnidad * (r.units || 1), factor, true);
      return;
    }
    const ref = (_sbRecLista() || []).find(x => x.code === addon.recId);
    if (!ref || !addon.gPorUnidad) return;
    _cstComExplotar(ref, addon.gPorUnidad * (r.units || 1), out, factor, visited);
  });
}

// Ingredientes de UNA pieza del producto: Map key → { nombre, g, cpg }  |  { motivo } si no se puede
function cstComIngredientesPieza(p, cache) {
  if (!p.receta_cod) return { motivo: 'no tiene receta ligada' };
  const r = (_sbRecLista() || []).find(x => x.code === p.receta_cod);
  if (!r) return { motivo: 'la receta ' + p.receta_cod + ' no existe' };
  const peso = Number(p.peso_g) > 0 ? Number(p.peso_g) : 0;
  if (!(peso > 0)) return { motivo: 'no tiene peso' };
  const c = pmCostoReceta(r, undefined, undefined, cache);
  if (!c || !(c.mass > 0)) return { motivo: 'la receta no tiene masa' };
  const out = new Map();
  _cstComExplotar(r, undefined, out, peso / c.mass);
  return { mapa: out };
}

// Cálculo de compras: ingredientes × meses
function cstComCalcular() {
  const meses = _cstBudMeses();
  const cache = new Map();
  const ings = new Map();   // key → { nombre, cpg, g: [12] }
  const sinReceta = [];
  _cstRutProd.forEach(p => {
    const tieneUn = meses.some(m => _cstBudUn(p.id, m) > 0);
    if (!tieneUn) return;
    const x = cstComIngredientesPieza(p, cache);
    if (!x.mapa) { sinReceta.push({ p, motivo: x.motivo }); return; }
    x.mapa.forEach((e, k) => {
      const fila = ings.get(k) || { nombre: e.nombre, cpg: e.cpg, g: meses.map(() => 0) };
      if (!fila.cpg && e.cpg) fila.cpg = e.cpg;
      meses.forEach((m, i) => { fila.g[i] += e.g * _cstBudUn(p.id, m); });
      ings.set(k, fila);
    });
  });
  const filas = Array.from(ings.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const costoMes = meses.map((m, i) => filas.reduce((a, f) => a + f.g[i] * f.cpg, 0));
  const sinPrecio = filas.filter(f => !(f.cpg > 0));
  return { meses, filas, costoMes, sinReceta, sinPrecio };
}

// ── Pantalla de compras ─────────────────────────────────────
async function cstComInit() {
  try { _cstBudInicio = localStorage.getItem(CST_BUD_LS) || _cstBudInicio; } catch (e) { /* ok */ }
  if (!/^\d{4}-\d{2}$/.test(_cstBudInicio)) _cstBudInicio = _cstBudMesHoy();
  if (!(await cstBudAsegurarCostos())) return;
  await cstBudCargarDatos();
  const ini = document.getElementById('cstcom-inicio');
  if (ini) ini.value = _cstBudInicio;
  cstComRender();
}

function cstComSetInicio(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  _cstBudInicio = v;
  try { localStorage.setItem(CST_BUD_LS, v); } catch (e) { /* ok */ }
  cstComRender();
}

function cstComVer(v) { _cstComVer = v === 'cr' ? 'cr' : 'kg'; cstComRender(); }

function cstComRender() {
  const tabla = document.getElementById('cstcom-tabla');
  if (!tabla) return;
  if (typeof _sbRecLista !== 'function' || typeof pmCostoReceta !== 'function') { tabla.innerHTML = _cstPh('🛒', 'Las recetas todavía no están cargadas'); return; }
  const r = cstComCalcular();
  const vkg = _cstComVer === 'kg';
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:4px 8px;text-align:right';
  const fmtV = (g, cpg) => vkg ? (g > 0 ? _cstNum(g / 1000, 2) : '—') : (g > 0 && cpg > 0 ? cstMoney(g * cpg, 0) : '—');
  const totalAnio = r.costoMes.reduce((a, x) => a + x, 0);
  const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
  const mayor = r.costoMes.reduce((b, x, i) => x > b.v ? { v: x, i } : b, { v: 0, i: 0 });
  const stats = document.getElementById('cstcom-stats');
  if (stats) stats.innerHTML = stat('Materiales del año', cstMoney(totalAnio, 0), 'al precio actual de cada ingrediente') +
    stat('Promedio mensual', cstMoney(totalAnio / 12, 0), '') +
    stat('Mes de más compra', mayor.v > 0 ? cstMoney(mayor.v, 0) : '—', mayor.v > 0 ? _cstBudMesTxt(r.meses[mayor.i]) : '') +
    stat('Ingredientes', String(r.filas.length), 'distintos en el año');
  const av = document.getElementById('cstcom-avisos');
  if (av) {
    const L = [];
    if (r.sinReceta.length) L.push(`⚠ ${r.sinReceta.length} producto${r.sinReceta.length === 1 ? '' : 's'} del Budget no entra${r.sinReceta.length === 1 ? '' : 'n'} en las compras: ${r.sinReceta.map(x => x.p.nombre + ' (' + x.motivo + ')').join(', ')}`);
    if (r.sinPrecio.length) L.push(`⚠ Sin precio en el maestro de ingredientes (su costo sale en cero): ${r.sinPrecio.map(f => f.nombre).join(', ')}`);
    av.innerHTML = L.length ? `<div class="card" style="border-color:var(--amber,#B45309)">${L.map(x => `<div style="font-size:12px;margin:3px 0">${pmEsc(x)}</div>`).join('')}</div>` : '';
  }
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="border-bottom:1px solid var(--bdr)"><th style="${th};text-align:left">Ingrediente</th>` +
    r.meses.map(m => `<th style="${th}">${pmEsc(_cstBudMesTxt(m))}</th>`).join('') + `<th style="${th}">Total año</th><th style="${th}">₡ / kg</th></tr></thead><tbody>`;
  if (!r.filas.length) html += `<tr><td colspan="${r.meses.length + 3}" style="padding:14px;color:var(--cream2)">El Budget de ventas todavía no tiene unidades con receta. Cargalas en 📈 Budget de ventas.</td></tr>`;
  r.filas.forEach(f => {
    const tot = f.g.reduce((a, x) => a + x, 0);
    html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="padding:4px 8px;text-align:left">${pmEsc(f.nombre)}</td>` +
      f.g.map(g => `<td style="${td}">${fmtV(g, f.cpg)}</td>`).join('') +
      `<td style="${td};font-weight:700">${fmtV(tot, f.cpg)}</td><td style="${td}">${f.cpg > 0 ? cstMoney(f.cpg * 1000, 0) : '—'}</td></tr>`;
  });
  html += `<tr style="font-weight:700"><td style="padding:6px 8px;text-align:left">Total materiales (₡)</td>` +
    r.costoMes.map(x => `<td style="${td}">${x > 0 ? cstMoney(x, 0) : '—'}</td>`).join('') + `<td style="${td}">${cstMoney(totalAnio, 0)}</td><td></td></tr></tbody></table></div>`;
  tabla.innerHTML = html;
  const b1 = document.getElementById('cstcom-v-kg'), b2 = document.getElementById('cstcom-v-cr');
  if (b1) b1.className = 'btn btn-sm ' + (vkg ? 'btn-gold' : 'btn-out');
  if (b2) b2.className = 'btn btn-sm ' + (vkg ? 'btn-out' : 'btn-gold');
}

// ═══ Nómina estimada ════════════════════════════════════════
// Nómina presupuestada = lo que se aplica a la producción (mano de obra directa) + lo fijo.
//   · Directa: las HH que pide el Budget × la tasa de MOD por HH de cada departamento (los factores de asignación de la nómina).
//   · Fija de producción: la nómina asignada a producción que el Budget no absorbe (equipo pagado de más), más la capacidad ociosa.
//   · Apoyo (MOI) y administración / mercadeo / venta: nómina fija del período.
// Si el Budget pide más de lo que la nómina de producción cubre, lo que sobra se valora a la misma tasa (horas a sumar).
// Devuelve null si faltan tarifas / período
function cstNomCalcular() {
  const c = cstBudCalcular();
  if (!c.hayTarifas || !c.per) return null;
  const n = c.mesesPer || 1;
  const hhProdMes = c.hhProd / n, hhOciMes = c.hhOciosa / n;
  const hhEquipo = hhProdMes + hhOciMes;
  const rs = cstLabResumen();
  const poolMod = c.modPool / n;                 // nómina asignada a departamentos productivos, por mes
  const ociosa = rs.tot.OCIOSA / n;
  const apoyo = rs.tot.MOI / n;
  const admin = rs.tot.GASTO / n;
  const tasaHH = hhProdMes > 0 ? poolMod / hhProdMes : 0;
  const filas = c.porMes.map(x => {
    const directa = Math.min(x.modAp, poolMod);
    const sobra = Math.max(0, x.modAp - poolMod);       // directa que la nómina actual no cubre
    const fijaProd = Math.max(0, poolMod - x.modAp);    // nómina de producción no absorbida
    const ocup = hhEquipo > 0 ? x.hh / hhEquipo * 100 : null;
    const extra = Math.max(0, x.hh - hhEquipo);
    return { ym: x.ym, un: x.un, kg: x.kg, hh: x.hh, ocup, extra, directa: directa + sobra, fijaProd, ociosa, apoyo, admin, sobra, nomina: directa + sobra + fijaProd + ociosa + apoyo + admin };
  });
  return { per: c.per, filas, hhEquipo, hhProdMes, hhOciMes, poolMod, ociosa, apoyo, admin, tasaHH, nominaMes: poolMod + ociosa + apoyo + admin };
}

async function cstNomInit() {
  try { _cstBudInicio = localStorage.getItem(CST_BUD_LS) || _cstBudInicio; } catch (e) { /* ok */ }
  if (!/^\d{4}-\d{2}$/.test(_cstBudInicio)) _cstBudInicio = _cstBudMesHoy();
  if (!(await cstBudAsegurarCostos())) return;
  await cstBudCargarDatos();
  cstPerLlenarSelectId('cstnom-periodo', '— Sin períodos —');
  const ini = document.getElementById('cstnom-inicio');
  if (ini) ini.value = _cstBudInicio;
  cstNomRender();
}

function cstNomSetInicio(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  _cstBudInicio = v;
  try { localStorage.setItem(CST_BUD_LS, v); } catch (e) { /* ok */ }
  cstNomRender();
}

async function cstNomElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstNomRender();
}

function cstNomRender() {
  const tabla = document.getElementById('cstnom-tabla');
  if (!tabla) return;
  const stats = document.getElementById('cstnom-stats');
  const r = cstNomCalcular();
  if (!r) {
    if (stats) stats.innerHTML = '';
    tabla.innerHTML = _cstPh('👷', 'Elegí un período con nómina y tarifas para medir las horas del equipo');
    return;
  }
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:5px 8px;text-align:right';
  const colorOcup = o => o === null ? '' : o > 100 ? 'var(--red)' : o > CST_PLN_OK ? '#B45309' : 'var(--green,#2e7d32)';
  const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
  const conExtra = r.filas.filter(f => f.sobra > 0.5);
  if (stats) stats.innerHTML = stat('Nómina mensual cargada', cstMoney(r.nominaMes, 0), 'período ' + pmEsc(r.per.inicio)) +
    stat('Nómina fija (apoyo + admin, mercadeo y venta)', cstMoney(r.apoyo + r.admin, 0), 'no cambia con la producción') +
    stat('Nómina de producción', cstMoney(r.poolMod + r.ociosa, 0), `${_cstNum(r.hhProdMes, 1)} HH productivas + ${_cstNum(r.hhOciMes, 1)} HH ociosas · ₡${_cstNum(r.tasaHH, 0)} por HH directa`) +
    stat('Meses que piden más de lo cargado', String(conExtra.length), conExtra.length ? 'el Budget exige más horas directas que las de la nómina' : 'la nómina actual alcanza');
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="border-bottom:1px solid var(--bdr)"><th style="${th};text-align:left">Mes</th><th style="${th}">Kg de masa</th><th style="${th}">HH del Budget</th><th style="${th}">Ocupación</th><th style="${th}" title="HH del Budget × tasa de mano de obra por HH">Directa aplicada</th><th style="${th}" title="Nómina de producción que el Budget no absorbe">Fija de producción</th><th style="${th}" title="Departamento de capacidad ociosa">Ociosa</th><th style="${th}">Apoyo</th><th style="${th}">Admin · mercadeo · venta</th><th style="${th}">Nómina estimada</th></tr></thead><tbody>`;
  r.filas.forEach(f => {
    html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="${td};text-align:left">${pmEsc(_cstBudMesTxt(f.ym))}</td><td style="${td}">${_cstNum(f.kg, 1)}</td><td style="${td}">${_cstNum(f.hh, 1)}</td>` +
      `<td style="${td};color:${colorOcup(f.ocup)};font-weight:700">${f.ocup === null ? '—' : _cstNum(f.ocup, 1) + ' %'}</td><td style="${td}">${cstMoney(f.directa, 0)}</td><td style="${td}">${f.fijaProd > 0.5 ? cstMoney(f.fijaProd, 0) : '—'}</td><td style="${td}">${f.ociosa > 0.5 ? cstMoney(f.ociosa, 0) : '—'}</td><td style="${td}">${f.apoyo > 0.5 ? cstMoney(f.apoyo, 0) : '—'}</td><td style="${td}">${f.admin > 0.5 ? cstMoney(f.admin, 0) : '—'}</td><td style="${td};font-weight:700">${cstMoney(f.nomina, 0)}</td></tr>`;
  });
  html += '</tbody></table></div>';
  tabla.innerHTML = html;
}
