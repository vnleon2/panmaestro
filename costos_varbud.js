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

// ── Pantalla ────────────────────────────────────────────────
async function cstVbInit() {
  if (!(await _cstGbAsegurar())) return;
  if (!(await cstBudAsegurarCostos())) return;
  await cstGbCargarDatos();
  try { await cstGasCargar(); } catch (e) { console.warn('[cstVbInit]', e.message); }
  cstPerLlenarSelectId('cstvb-periodo', '— Sin períodos —');
  cstVbRender();
}

async function cstVbElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  try { await cstGasCargar(); } catch (e) { console.warn('[cstVbElegirPer]', e.message); }
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
  tabla.innerHTML = html;
}
