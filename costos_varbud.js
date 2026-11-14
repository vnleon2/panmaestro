// costos_varbud.js — Módulo de Costos · Real contra presupuesto (variaciones de gasto)
// Prefijo cst (cstVb)
// Depende de costos_gastos.js (gasto real del período y renglones del presupuesto), costos_gasbud.js (matriz de gasto fijo
// presupuestado y depreciación de activos), costos_maestros.js (cuentas y departamentos) y costos_laboral.js (períodos).
//
// DISEÑO: SOLO LECTURA. Compara, por cuenta y departamento, lo presupuestado en los meses del período (matriz «Gasto fijo
// presupuestado» + depreciación de los activos) con el gasto real cargado en «Gastos del período».
//   · Variación = real − presupuesto: positiva = se gastó de más (rojo); negativa = se gastó de menos (verde).
//   · Un renglón que solo existe en un lado (se gastó algo no presupuestado, o se presupuestó algo que no se gastó) también aparece.
//   · Agrupado por serie de cuenta: 5 fabril, 6 venta, 7 mercadeo, 8 administrativos.
// No cambia ningún dato.

const CST_VB_GRUPOS = [
  { serie: 5, nombre: 'Gastos de producción (fabriles)' },
  { serie: 6, nombre: 'Gastos de venta' },
  { serie: 7, nombre: 'Gastos de mercadeo' },
  { serie: 8, nombre: 'Gastos administrativos' },
];

// Cálculo (puro). Devuelve null si no hay período.
function cstVbCalcular() {
  const per = _cstPerActual();
  if (!per) return null;
  const meses = _cstGasMesesPer();
  const pres = cstGasFilasPresupuesto();
  const real = _cstGasRows || [];
  const mapa = {};
  const clave = (c, d) => c + '|' + (d || '');
  const get = (cuentaId, deptoId) => {
    const k = clave(cuentaId, deptoId);
    if (!mapa[k]) mapa[k] = { cuentaId, deptoId: deptoId || null, pres: 0, real: 0 };
    return mapa[k];
  };
  pres.forEach(r => { get(r.cuenta_id, r.depto_id).pres += Number(r.monto) || 0; });
  real.forEach(r => { get(r.cuenta_id, r.depto_id).real += Number(r.monto) || 0; });
  const filas = Object.values(mapa).filter(x => x.pres > 0.005 || x.real > 0.005).map(x => {
    const c = _cstCuentas.find(k => k.id === x.cuentaId) || null;
    const d = x.deptoId ? (_cstDeps.find(k => k.id === x.deptoId) || null) : null;
    return Object.assign(x, {
      cuenta: c, depto: d, serie: c ? Number(c.serie) : 0,
      txtCuenta: c ? c.codigo + ' · ' + c.nombre : '(cuenta eliminada)',
      txtDepto: d ? d.codigo + ' · ' + d.nombre : 'Compartido',
      varia: x.real - x.pres,
      pct: x.pres > 0.005 ? (x.real - x.pres) / x.pres * 100 : null,
    });
  }).sort((a, b) => (a.cuenta ? a.cuenta.codigo : '').localeCompare(b.cuenta ? b.cuenta.codigo : '', 'es', { numeric: true })
    || a.txtDepto.localeCompare(b.txtDepto, 'es', { numeric: true }));
  const grupos = CST_VB_GRUPOS.map(g => {
    const fs = filas.filter(f => f.serie === g.serie);
    const pr = fs.reduce((a, f) => a + f.pres, 0), re = fs.reduce((a, f) => a + f.real, 0);
    return { g, filas: fs, pres: pr, real: re, varia: re - pr };
  });
  const otras = filas.filter(f => !CST_VB_GRUPOS.some(g => g.serie === f.serie));
  if (otras.length) {
    const pr = otras.reduce((a, f) => a + f.pres, 0), re = otras.reduce((a, f) => a + f.real, 0);
    grupos.push({ g: { serie: 0, nombre: 'Otras cuentas' }, filas: otras, pres: pr, real: re, varia: re - pr });
  }
  const pres_ = filas.reduce((a, f) => a + f.pres, 0), real_ = filas.reduce((a, f) => a + f.real, 0);
  return { per, meses, filas, grupos, pres: pres_, real: real_, varia: real_ - pres_, nPres: pres.length, nReal: real.length };
}

// ── Variaciones de la carga fabril fija (costo estándar) ────
// Tres cifras, por departamento productivo y en total:
//   · CIF fijo REAL      = el pool fijo repartido con los gastos reales cargados.
//   · CIF fijo ESTÁNDAR  = el pool fijo repartido con el presupuesto (lo que la capacidad normal debería costar).
//   · CIF fijo ABSORBIDO = tasa fija estándar × lo realmente producido (venta real; si el mes no ha pasado, el Budget).
// Variación de gasto (presupuesto) = real − estándar        (se gastó más o menos de lo previsto)
// Variación por volumen            = estándar − absorbido   (capacidad normal no usada; positiva = desfavorable)
// Subabsorción total               = real − absorbido       (= suma de las dos)
let _cstVbReal = {};   // 'AAAA-MM' → { producto_id: unidades reales }

function _cstVbUn(pid, ym) {
  const hoy = pmHoy().slice(0, 7);
  const re = ym <= hoy && _cstVbReal[ym] ? Number(_cstVbReal[ym][pid]) || 0 : 0;
  return re > 0 ? re : (typeof _cstBudUn === 'function' ? _cstBudUn(pid, ym) : 0);
}

function cstVbCarga(meses) {
  const fuente = _cstGasFuente;
  let pres = null, real = null;
  try {
    _cstGasFuente = 'presupuesto'; pres = cstTasVivas();
    _cstGasFuente = 'real'; real = cstTasVivas();
  } catch (e) { console.warn('[cstVbCarga]', e.message); return null; }
  finally { _cstGasFuente = fuente; }
  if (!pres || !pres.tarifas.length) return null;
  const ids = _cstRutProd.map(p => p.id);
  const sem = [{ n: 1, activos: [true, true, true, true, true, true, true] }];
  let rr;
  try { rr = cstPlnCalc(ids, (id, n, d) => (d === 1 ? meses.reduce((a, ym) => a + _cstVbUn(id, ym), 0) : 0), sem, pres.tarifas, 1); }
  catch (e) { console.warn('[cstVbCarga plan]', e.message); return null; }
  const filas = pres.tarifas.map(t => {
    const tr = real.tarifas.find(x => x.depto_id === t.depto_id);
    const d = rr.deptos.find(x => x.t && x.t.depto_id === t.depto_id);
    const std = Number(t.cifF) || 0, rea = tr ? Number(tr.cifF) || 0 : 0;
    const abs = d && isFinite(t.tasaF) && t.tasaF !== null ? t.tasaF * d.qMes : 0;
    return { depto: t.depto, unidad: t.unidad || '', cap: t.cap, q: d ? d.qMes : 0, tasaF: t.tasaF, std, real: rea, abs,
      vGasto: rea - std, vVol: std - abs, total: rea - abs, uso: std > 0 ? abs / std * 100 : null };
  }).filter(f => f.std > 0.5 || f.real > 0.5 || f.abs > 0.5);
  const sum = k => filas.reduce((a, f) => a + f[k], 0);
  const tot = { std: sum('std'), real: sum('real'), abs: sum('abs'), vGasto: sum('vGasto'), vVol: sum('vVol'), total: sum('total') };
  tot.uso = tot.std > 0 ? tot.abs / tot.std * 100 : null;
  return { filas, tot };
}

// ── Pantalla ────────────────────────────────────────────────
async function cstVbInit() {
  if (!(await _cstGbAsegurar())) return;
  if (!(await cstBudAsegurarCostos())) return;
  await cstGbCargarDatos();
  try { await cstGasCargar(); } catch (e) { console.warn('[cstVbInit]', e.message); }
  cstPerLlenarSelectId('cstvb-periodo', '— Sin períodos —');
  await _cstVbCargarReal();
  cstVbRender();
}

async function _cstVbCargarReal() {
  _cstVbReal = {};
  const ms = _cstGasMesesPer();
  if (!ms.length || typeof cstRealPorMes !== 'function') return;
  try { _cstVbReal = await cstRealPorMes(ms[0], _cstBudSumarMes(ms[ms.length - 1], 1)); } catch (e) { console.warn('[cstVbCargarReal]', e.message); }
}

async function cstVbElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  try { await cstGasCargar(); } catch (e) { console.warn('[cstVbElegirPer]', e.message); }
  await _cstVbCargarReal();
  cstVbRender();
}

function cstVbRender() {
  const tabla = document.getElementById('cstvb-tabla');
  if (!tabla) return;
  const stats = document.getElementById('cstvb-stats');
  const av = document.getElementById('cstvb-avisos');
  const r = cstVbCalcular();
  if (!r) {
    if (stats) stats.innerHTML = ''; if (av) av.innerHTML = '';
    tabla.innerHTML = _cstPh('📊', 'Elegí un período para comparar el gasto real con el presupuesto');
    return;
  }
  const M = x => (Math.abs(x) < 0.5 ? '—' : cstMoney(Math.round(x), 0));
  const col = v => (Math.abs(v) < 0.5 ? '' : v > 0 ? 'color:#b91c1c;' : 'color:#15803d;');   // gastar de más = rojo
  const PC = v => (v === null ? '—' : (v > 0 ? '+' : '') + _cstNum(v, 1) + ' %');
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:4px 8px;text-align:right';
  const stat = (t, v, s) => `<div class="stat"><div class="stat-lbl">${t}</div><div class="stat-val" style="font-size:17px">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
  if (stats) stats.innerHTML = stat('Presupuesto', M(r.pres) === '—' ? '₡0' : M(r.pres), r.meses.length + (r.meses.length === 1 ? ' mes' : ' meses') + ' del período') +
    stat('Gasto real', M(r.real) === '—' ? '₡0' : M(r.real), 'cargado en Gastos del período') +
    stat('Variación', (r.varia > 0.5 ? '+' : '') + (M(r.varia) === '—' ? '₡0' : M(r.varia)), r.varia > 0.5 ? 'se gastó de más' : r.varia < -0.5 ? 'se gastó de menos' : 'sin diferencia') +
    stat('Ejecución', r.pres > 0 ? _cstNum(r.real / r.pres * 100, 1) + ' %' : '—', 'real ÷ presupuesto');
  const L = [];
  if (!r.nPres) L.push('ℹ No hay gasto presupuestado en los meses del período: llená 🧾 Gasto fijo presupuestado y 📦 Activos depreciables.');
  if (!r.nReal) L.push('ℹ El período no tiene gasto real cargado en Gastos del período.');
  if (av) av.innerHTML = L.length ? `<div class="card">${L.map(x => `<div style="font-size:12px;margin:3px 0">${pmEsc(x)}</div>`).join('')}</div>` : '';
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="border-bottom:1px solid var(--bdr)">` +
    `<th style="${th};text-align:left">Cuenta</th><th style="${th};text-align:left">Departamento</th><th style="${th}">Presupuesto</th><th style="${th}">Real</th><th style="${th}">Variación</th><th style="${th}">%</th></tr></thead><tbody>`;
  if (!r.filas.length) html += `<tr><td colspan="6" style="padding:14px;color:var(--cream2)">No hay gasto presupuestado ni real en este período.</td></tr>`;
  r.grupos.filter(g => g.filas.length).forEach(g => {
    html += `<tr><td colspan="6" style="padding:9px 8px 3px;font-size:11px;font-weight:700;color:var(--gold,#b8860b);text-transform:uppercase">${pmEsc(g.g.nombre)}</td></tr>`;
    g.filas.forEach(f => {
      html += `<tr style="border-bottom:1px solid var(--bdr)"><td style="${td};text-align:left">${pmEsc(f.txtCuenta)}</td><td style="${td};text-align:left;color:var(--cream2)">${pmEsc(f.txtDepto)}</td>` +
        `<td style="${td}">${M(f.pres)}</td><td style="${td}">${M(f.real)}</td><td style="${td};${col(f.varia)}">${M(f.varia)}</td><td style="${td};${col(f.varia)}">${PC(f.pct)}</td></tr>`;
    });
    html += `<tr style="border-bottom:1px solid var(--bdr);font-weight:700;background:rgba(128,128,128,.10)"><td style="${td};text-align:left" colspan="2">Subtotal · ${pmEsc(g.g.nombre)}</td>` +
      `<td style="${td}">${M(g.pres)}</td><td style="${td}">${M(g.real)}</td><td style="${td};${col(g.varia)}">${M(g.varia)}</td><td style="${td};${col(g.varia)}">${g.pres > 0.005 ? PC(g.varia / g.pres * 100) : '—'}</td></tr>`;
  });
  html += `<tr style="font-weight:800;border-top:2px solid var(--bdr)"><td style="${td};text-align:left" colspan="2">TOTAL</td><td style="${td}">${M(r.pres)}</td><td style="${td}">${M(r.real)}</td>` +
    `<td style="${td};${col(r.varia)}">${M(r.varia)}</td><td style="${td};${col(r.varia)}">${r.pres > 0.005 ? PC(r.varia / r.pres * 100) : '—'}</td></tr>`;
  html += '</tbody></table></div><div style="font-size:11px;color:var(--cream2);margin:6px 2px 0">Variación = real − presupuesto. En rojo, lo que se gastó de más; en verde, de menos. El presupuesto es la matriz de gasto fijo presupuestado de los meses del período más la depreciación de los activos. La nómina no está en este cuadro.</div>';
  tabla.innerHTML = html + cstVbCargaHtml(r, M, col);
}

function cstVbCargaHtml(r, M, col) {
  const c = cstVbCarga(r.meses);
  if (!c) return '<div class="card" style="margin-top:12px;font-size:12px;color:var(--cream2)">Variación por volumen: faltan tarifas del período (capacidad, reparto y gastos) para calcularla.</div>';
  const th = 'padding:6px 8px;text-align:right;font-size:11px;white-space:nowrap';
  const td = 'padding:4px 8px;text-align:right';
  const fav = v => (Math.abs(v) < 0.5 ? 'sin variación' : v > 0 ? 'desfavorable' : 'favorable');
  let h = `<div class="sec" style="margin-top:16px"><h2>Variaciones de la carga fabril fija</h2></div><div class="card"><div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr style="border-bottom:1px solid var(--bdr)">` +
    `<th style="${th};text-align:left">Departamento</th><th style="${th}">CIF fijo estándar<br>(capacidad normal)</th><th style="${th}">CIF fijo real</th><th style="${th}">CIF fijo absorbido<br>(producción real)</th><th style="${th}">Uso de la capacidad</th><th style="${th}">Variación de gasto</th><th style="${th}">Variación por volumen</th><th style="${th}">Subabsorción total</th></tr></thead><tbody>`;
  const fila = (f, tot) => `<tr style="border-bottom:1px solid var(--bdr)${tot ? ';font-weight:800;border-top:2px solid var(--bdr)' : ''}"><td style="${td};text-align:left">${tot ? 'TOTAL' : pmEsc(f.depto.codigo + ' · ' + f.depto.nombre)}</td>` +
    `<td style="${td}">${M(f.std)}</td><td style="${td}">${M(f.real)}</td><td style="${td}">${M(f.abs)}</td><td style="${td}">${f.uso === null ? '—' : _cstNum(f.uso, 1) + ' %'}</td>` +
    `<td style="${td};${col(f.vGasto)}">${M(f.vGasto)}</td><td style="${td};${col(f.vVol)}">${M(f.vVol)}</td><td style="${td};${col(f.total)}">${M(f.total)}</td></tr>`;
  c.filas.forEach(f => { h += fila(f, false); });
  h += fila(c.tot, true) + '</tbody></table></div>';
  h += `<div style="font-size:12px;margin-top:8px"><b>Variación por volumen: ${M(c.tot.vVol) === '—' ? '₡0' : M(c.tot.vVol)}</b> (${fav(c.tot.vVol)}). Se produjo el ${c.tot.uso === null ? '—' : _cstNum(c.tot.uso, 1) + ' %'} de la capacidad normal: la parte no usada del CIF fijo no se carga a las piezas, va al gasto del período.</div>`;
  h += `<div style="font-size:11px;color:var(--cream2);margin-top:6px">Variación de gasto = CIF fijo real − estándar (se gastó más o menos de lo previsto). Variación por volumen = estándar − absorbido = (capacidad normal − producción real) × tasa fija. Subabsorción total = real − absorbido. Estándar = el presupuesto repartido; real = los gastos cargados en Gastos del período; la producción es la venta real del mes y, si el mes no ha pasado, el Budget. Positivo (rojo) es desfavorable.</div></div>`;
  return h;
}
