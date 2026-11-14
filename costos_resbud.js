// costos_resbud.js — Módulo de Costos · Resultados presupuestarios (costos y gastos mes a mes)
// Prefijo cst (cstRb)
// Depende de costos_budget.js (kg del Budget), costos_compras.js (cstNomCalcular: nómina directa y fija),
// costos_gasbud.js (gasto presupuestado y depreciación de activos), costos_laboral.js (nómina por departamento)
// y costos_maestros.js (cuentas y departamentos).
//
// DISEÑO: SOLO LECTURA. Junta lo ya presupuestado en un cuadro de 12 meses:
//   · Volumen de producción previsto (kg de masa del Budget de ventas).
//   · Costos de producción: mano de obra directa (HH del Budget × tasa de MOD), mano de obra fija (producción no absorbida,
//     capacidad ociosa y apoyo), gastos fabriles variables y fijos (cuentas de la serie 5 + depreciación de los departamentos de producción).
//   · Gastos de venta, de mercadeo y administrativos (series 6, 7 y 8). Cada cuenta se divide en variable y fijo con su % variable;
//     la nómina y la depreciación de esos departamentos van a sus gastos fijos.
// Los montos de gasto salen de la matriz «Gasto fijo presupuestado» (lo que se escribió, mes a mes).

const CST_RB_GRUPOS = [
  { serie: 5, id: 'fab' }, { serie: 6, id: 'ven' }, { serie: 7, id: 'mer' }, { serie: 8, id: 'adm' },
];

function _cstRbGrupoDeTipo(tipo) {
  if (tipo === 'venta') return 'ven';
  if (tipo === 'mercadeo') return 'mer';
  if (tipo === 'administracion') return 'adm';
  return 'fab';   // productivo, apoyo, ociosa o sin departamento
}

// Cálculo (puro). Devuelve null si faltan período o tarifas (la nómina directa necesita las tarifas).
function cstRbCalcular() {
  const nom = cstNomCalcular();
  if (!nom) return null;
  const meses = _cstBudMeses();
  const n = Number(nom.per.meses) > 0 ? Number(nom.per.meses) : 1;
  // Nómina fija de venta, mercadeo y administración (por mes), según el tipo del departamento
  const nominaGrupo = { fab: 0, ven: 0, mer: 0, adm: 0 };
  Object.values(cstLabResumen().porDepto).forEach(x => {
    const t = x.depto.tipo;
    if (t === 'venta' || t === 'mercadeo' || t === 'administracion') nominaGrupo[_cstRbGrupoDeTipo(t)] += x.costo / n;
  });
  // Absorción del CIF fijo del estándar (NIC 2): lo que la producción prevista absorbe con las tarifas del período
  // y lo que queda sin absorber (capacidad no usada → gasto del período, no costo de la pieza)
  let tarifas = [];
  try { tarifas = cstTasActuales().tarifas || []; } catch (e) { tarifas = []; }
  const ids = _cstRutProd.map(p => p.id);
  const sem = [{ n: 1, activos: [true, true, true, true, true, true, true] }];
  const cifFMes = tarifas.reduce((a, t) => a + (isFinite(t.cifF) ? t.cifF : 0), 0) / n;
  const cols = meses.map((ym, i) => {
    const f = nom.filas[i] || { kg: 0, directa: 0, fijaProd: 0, ociosa: 0, apoyo: 0 };
    let cifFAbs = null;
    if (tarifas.length && cifFMes > 0) {
      try {
        const rr = cstPlnCalc(ids, (id, nn, d) => (d === 1 ? _cstBudUn(id, ym) : 0), sem, tarifas, 1);
        cifFAbs = rr.deptos.reduce((a, d) => a + (d.t && d.t.tasaF !== null && isFinite(d.t.tasaF) ? d.t.tasaF * d.qMes : 0), 0);
      } catch (e) { cifFAbs = null; }
    }
    const g = { fab: { v: 0, f: 0 }, ven: { v: 0, f: 0 }, mer: { v: 0, f: 0 }, adm: { v: 0, f: 0 } };
    _cstGbRows.filter(r => r.mes === ym && !_cstGbEsDeprec(_cstGbCuentaDeId(r.cuenta_id))).forEach(r => {
      const c = _cstGbCuentaDeId(r.cuenta_id);
      const grp = c ? (CST_RB_GRUPOS.find(x => x.serie === Number(c.serie)) || {}).id : null;
      if (!grp) return;
      const pv = c.pct_variable >= 0 ? Number(c.pct_variable) : 0;
      g[grp].v += Number(r.monto) * pv / 100;
      g[grp].f += Number(r.monto) * (100 - pv) / 100;
    });
    // Depreciación de activos, al grupo del departamento
    const dep = cstActDepPorDepto(ym);
    Object.keys(dep).forEach(did => {
      const d = _cstDeps.find(x => x.id === did);
      g[_cstRbGrupoDeTipo(d ? d.tipo : null)].f += dep[did];
    });
    ['ven', 'mer', 'adm'].forEach(k => { g[k].f += nominaGrupo[k]; });
    const moFija = f.fijaProd + f.ociosa + f.apoyo;
    const costoProd = f.directa + moFija + g.fab.v + g.fab.f;
    const sub = k => g[k].v + g[k].f;
    const gastos = sub('ven') + sub('mer') + sub('adm');
    return { ym, kg: f.kg, mod: f.directa, moFija, g, costoProd, subVen: sub('ven'), subMer: sub('mer'), subAdm: sub('adm'), gastos, total: costoProd + gastos,
      cifFEst: cifFAbs === null ? null : cifFMes, cifFAbs, cifFNoAbs: cifFAbs === null ? null : cifFMes - cifFAbs };
  });
  return { meses, cols, per: nom.per };
}

// ── Pantalla ────────────────────────────────────────────────
async function cstRbInit() {
  if (!(await _cstGbAsegurar())) return;
  if (!(await cstBudAsegurarCostos())) return;
  await cstBudCargarDatos();
  await cstGbCargarDatos();
  cstPerLlenarSelectId('cstrb-periodo', '— Sin períodos —');
  const ini = document.getElementById('cstrb-inicio');
  if (ini) ini.value = _cstBudInicio;
  cstRbRender();
}

function cstRbSetInicio(v) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  _cstBudInicio = v;
  try { localStorage.setItem(CST_BUD_LS, v); } catch (e) { /* ok */ }
  cstRbRender();
}

async function cstRbElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstRbRender();
}

function cstRbRender() {
  const tabla = document.getElementById('cstrb-tabla');
  if (!tabla) return;
  const stats = document.getElementById('cstrb-stats');
  const r = cstRbCalcular();
  if (!r) {
    if (stats) stats.innerHTML = '';
    tabla.innerHTML = _cstPh('📊', 'Elegí un período con nómina y tarifas para armar el cuadro');
    return;
  }
  const M = x => (Math.abs(x) < 0.5 ? '—' : cstMoney(Math.round(x), 0));
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:4px 8px;text-align:right';
  const sum = fn => r.cols.reduce((a, c) => a + fn(c), 0);
  const kgAnio = sum(c => c.kg);
  const fila = (nombre, fn, o) => {
    o = o || {};
    const st = (o.sub ? 'font-weight:700;background:rgba(128,128,128,.10);' : '') + (o.total ? 'font-weight:800;border-top:2px solid var(--bdr);' : '');
    const pad = o.sub || o.total ? '' : 'padding-left:22px;';
    return `<tr style="border-bottom:1px solid var(--bdr);${st}"><td style="${td};text-align:left;${pad}">${pmEsc(nombre)}</td>` +
      r.cols.map(c => `<td style="${td}">${M(fn(c))}</td>`).join('') + `<td style="${td};font-weight:700">${M(sum(fn))}</td></tr>`;
  };
  const cab = t => `<tr><td colspan="${r.cols.length + 2}" style="padding:10px 8px 3px;font-size:11px;font-weight:700;color:var(--gold,#b8860b);text-transform:uppercase">${pmEsc(t)}</td></tr>`;
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="border-bottom:1px solid var(--bdr)"><th style="${th};text-align:left"></th>` +
    r.meses.map(m => `<th style="${th}">${pmEsc(_cstBudMesTxt(m))}</th>`).join('') + `<th style="${th}">Total año</th></tr></thead><tbody>`;
  html += `<tr style="border-bottom:1px solid var(--bdr);font-weight:700"><td style="${td};text-align:left">Volumen de producción previsto (kg de masa)</td>` +
    r.cols.map(c => `<td style="${td}">${c.kg > 0 ? _cstNum(c.kg, 1) : '—'}</td>`).join('') + `<td style="${td}">${_cstNum(kgAnio, 1)}</td></tr>`;
  html += cab('Costos de producción (₡)');
  html += fila('Costo de mano de obra directa', c => c.mod);
  html += fila('Costo de mano de obra fija', c => c.moFija);
  html += fila('Gastos variables', c => c.g.fab.v);
  html += fila('Gastos fijos (incluye depreciación)', c => c.g.fab.f);
  html += fila('Subtotal costos de producción', c => c.costoProd, { sub: true });
  html += cab('Gastos de venta');
  html += fila('Gastos de venta variables', c => c.g.ven.v);
  html += fila('Gastos de venta fijos', c => c.g.ven.f);
  html += fila('Subtotal gastos de venta', c => c.subVen, { sub: true });
  html += cab('Gastos de mercadeo');
  html += fila('Gastos de mercadeo variables', c => c.g.mer.v);
  html += fila('Gastos de mercadeo fijos', c => c.g.mer.f);
  html += fila('Subtotal gastos de mercadeo', c => c.subMer, { sub: true });
  html += cab('Gastos administrativos');
  html += fila('Gastos administrativos', c => c.subAdm, { sub: true });
  html += cab('Totales');
  html += fila('Total gastos (venta, mercadeo y administración)', c => c.gastos, { sub: true });
  html += fila('TOTAL GASTOS Y COSTOS', c => c.total, { total: true });
  if (r.cols.some(c => c.cifFAbs !== null)) {
    html += cab('Memo · absorción del CIF fijo del estándar (NIC 2, tarifas del período, no suma al total)');
    html += fila('CIF fijo del estándar (por mes)', c => c.cifFEst || 0);
    html += fila('CIF fijo absorbido por la producción prevista', c => c.cifFAbs || 0);
    html += fila('CIF fijo no absorbido (capacidad no usada: gasto del período)', c => c.cifFNoAbs || 0, { sub: true });
  }
  const pk = (v, kg) => kg > 0 ? cstMoney(v / kg, 2) : '—';
  html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="${td};text-align:left;padding-left:22px">Costo de producción por kg</td>` +
    r.cols.map(c => `<td style="${td}">${pk(c.costoProd, c.kg)}</td>`).join('') + `<td style="${td}">${pk(sum(c => c.costoProd), kgAnio)}</td></tr>`;
  html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="${td};text-align:left;padding-left:22px">Costos y gastos totales por kg</td>` +
    r.cols.map(c => `<td style="${td}">${pk(c.total, c.kg)}</td>`).join('') + `<td style="${td}">${pk(sum(c => c.total), kgAnio)}</td></tr>`;
  html += '</tbody></table></div>';
  tabla.innerHTML = html;
  const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
  const totAnio = sum(c => c.total), prodAnio = sum(c => c.costoProd);
  if (stats) stats.innerHTML = stat('Costos y gastos del año', cstMoney(Math.round(totAnio), 0), 'producción + venta + mercadeo + administración') +
    stat('Costos de producción', cstMoney(Math.round(prodAnio), 0), totAnio > 0 ? _cstNum(prodAnio / totAnio * 100, 0) + ' % del total' : '') +
    stat('Producción prevista', _cstNum(kgAnio, 0) + ' kg', 'kg de masa del año') +
    stat('Costo total por kg', kgAnio > 0 ? cstMoney(totAnio / kgAnio, 2) : '—', 'costos y gastos ÷ kg');
}
