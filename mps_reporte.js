// mps_reporte.js — MPS · Reporte del mes: estimado, ventas, producción e inventarios (prefijo mpr)
//
// Solo lectura. Es UNA tabla con una fila por pan que junta lo que ya calcula el
// balance (mps_balance.js): no inventa números ni guarda nada.
//   Estimado (por canal y total) · Venta real a hoy · Venta prevista de lo que queda ·
//   Venta total · % del estimado · Producción planeada · Producción asumida (días
//   cerrados) · Inventario inicial y final · Lo que falta producir · Kilos netos · Aviso.
// Se puede imprimir y copiar a Excel (pegar en una hoja).

let _mprFilas = null;   // { filas, tot, mes } del último cálculo

// ═══════════════════════════════════════════════════════════
// FUNCIÓN PURA
// ═══════════════════════════════════════════════════════════
// calc = resultado de mpbCalcular; panes = productos; est = {pid:{canal:unid}}
function mprConstruir(calc, panes, est, hoy) {
  const falta = {};
  mpbFaltante(calc, panes, hoy).forEach(g => { falta[g.pid] = g.total; });
  const filas = [];
  const tot = { estC: 0, estD: 0, estF: 0, est: 0, real: 0, prev: 0, venta: 0, prod: 0, asum: 0, invIni: 0, invFin: 0, falta: 0, kg: 0, kgProd: 0 };
  panes.forEach(p => {
    const c = calc[p.id];
    if (!c) return;
    const r = c.resumen;
    const e = (est && est[p.id]) || {};
    const estC = Number(e.comercial) || 0, estD = Number(e.domestico) || 0, estF = Number(e.feria) || 0;
    const estT = estC + estD + estF;
    if (!(r.venta || r.prod || r.invIni || estT)) return;
    const prev = c.dias.filter(d => !d.cerrado).reduce((a, d) => a + d.venta, 0);
    const kg = mpsKilos(r.venta, p.peso_g);
    const f = falta[p.id] || 0;
    let aviso = '—';
    if (f > 0) aviso = 'Falta producir ' + f;
    else if (!estT && r.venta > 0) aviso = 'Sin estimado';
    const fila = { pid: p.id, nombre: p.nombre, pesoG: p.peso_g, estC, estD, estF, est: estT,
      real: r.real, prev, venta: r.venta, pct: estT > 0 ? r.venta / estT : null,
      prod: r.prod, asum: r.asumida, invIni: r.invIni, invFin: r.invFin, falta: f, kg,
      kgProd: mpsKilos(f, p.peso_g), aviso, sinPeso: !p.peso_g };
    filas.push(fila);
    ['estC', 'estD', 'estF', 'est', 'real', 'prev', 'venta', 'prod', 'asum', 'invIni', 'invFin', 'falta', 'kg', 'kgProd'].forEach(k => { tot[k] += fila[k]; });
  });
  return { filas, tot };
}

// ═══════════════════════════════════════════════════════════
// PANTALLA
// ═══════════════════════════════════════════════════════════
async function mprCargar() {
  const root = document.getElementById('mpr-root');
  if (!root) return;
  root.innerHTML = '<div class="ph"><span class="ph-icon">⏳</span>Armando el reporte...</div>';
  await mpbCargar();     // trae y calcula (el balance se dibuja en su pestaña, oculta)
  if (!_mpbCalc || !_mpbDatos || _mpbDatos.mes !== _mpsMes) {
    root.innerHTML = '<div class="ph"><span class="ph-icon">⚠️</span>No se pudo armar el reporte. Probá la pestaña Balance diario para ver el motivo.</div>';
    return;
  }
  const r = mprConstruir(_mpbCalc, _mpsProductos || [], _mpsEst, pmHoy());
  _mprFilas = { ...r, mes: _mpsMes };
  mprRender();
}

const MPR_COLS = [
  ['Estimado comercial', f => f.estC], ['Estimado doméstico', f => f.estD], ['Estimado feria', f => f.estF], ['Estimado total', f => f.est],
  ['Venta real a hoy', f => f.real], ['Venta prevista (lo que queda)', f => f.prev], ['Venta total', f => f.venta],
  ['% del estimado', f => f.pct],
  ['Producción planeada', f => f.prod], ['Producción asumida', f => f.asum],
  ['Inventario inicial', f => f.invIni], ['Inventario final', f => f.invFin],
  ['Falta producir', f => f.falta], ['Kg netos de venta', f => f.kg]
];

function mprFmtCelda(nombre, v, dec) {
  if (nombre === '% del estimado') return v === null || v === undefined ? '—' : Math.round(v * 100) + '%';
  return v === 0 ? '0' : mpsFmt(v, dec === undefined ? 1 : dec);
}

function mprRender() {
  const root = document.getElementById('mpr-root');
  const D = _mprFilas;
  if (!root || !D) return;
  if (!D.filas.length) {
    root.innerHTML = '<div class="ph"><span class="ph-icon">📑</span>Todavía no hay estimado, ventas ni producción este mes.</div>';
    return;
  }
  const t = D.tot;
  const resumen = `
    <div class="stats">
      <div class="stat"><div class="stat-lbl">Estimado del mes</div><div class="stat-val">${mpsFmt(t.est, 0)}</div><div class="stat-sub">unidades</div></div>
      <div class="stat"><div class="stat-lbl">Venta total</div><div class="stat-val">${mpsFmt(t.venta, 0)}</div><div class="stat-sub">${mpsFmt(t.kg, 1)} kg netos</div></div>
      <div class="stat"><div class="stat-lbl">Producción planeada</div><div class="stat-val">${mpsFmt(t.prod, 0)}</div><div class="stat-sub">+ ${mpsFmt(t.asum, 0)} asumida</div></div>
      <div class="stat"><div class="stat-lbl">Falta producir</div><div class="stat-val" style="${t.falta ? 'color:#b3261e' : ''}">${mpsFmt(t.falta, 0)}</div><div class="stat-sub">${mpsFmt(t.kgProd, 1)} kg netos</div></div>
    </div>`;
  const cab = MPR_COLS.map(c => `<th>${c[0].replace(' (lo que queda)', '<br>(lo que queda)')}</th>`).join('');
  const filas = D.filas.map(f => {
    const rojo = f.invFin < 0;
    const celdas = MPR_COLS.map(([n, fn]) => {
      const v = fn(f);
      let est = '';
      if (n === 'Inventario final' && rojo) est = ' style="color:#b3261e;font-weight:700"';
      if (n === 'Falta producir' && v > 0) est = ' style="color:#b3261e;font-weight:700"';
      if (n === 'Estimado total' || n === 'Venta total') est = ' style="font-weight:700"';
      return `<td class="mps-n"${est}>${mprFmtCelda(n, v, n === 'Kg netos de venta' ? 1 : 1)}</td>`;
    }).join('');
    return `<tr><td>${pmEsc(f.nombre)}${f.sinPeso ? ' <span title="Sin peso: no se calculan kilos" style="color:var(--cream2)">⚠</span>' : ''}</td>${celdas}<td style="text-align:left;color:${f.aviso === '—' ? 'var(--cream2)' : '#b3261e'}">${pmEsc(f.aviso)}</td></tr>`;
  }).join('');
  const pie = MPR_COLS.map(([n]) => {
    const k = { 'Estimado comercial': 'estC', 'Estimado doméstico': 'estD', 'Estimado feria': 'estF', 'Estimado total': 'est', 'Venta real a hoy': 'real', 'Venta prevista (lo que queda)': 'prev', 'Venta total': 'venta', 'Producción planeada': 'prod', 'Producción asumida': 'asum', 'Inventario inicial': 'invIni', 'Inventario final': 'invFin', 'Falta producir': 'falta', 'Kg netos de venta': 'kg' }[n];
    if (!k) return `<td class="mps-n">${t.est > 0 ? Math.round(t.venta / t.est * 100) + '%' : '—'}</td>`;
    return `<td class="mps-n">${mprFmtCelda(n, t[k], 1)}</td>`;
  }).join('');
  root.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="ctitle" style="margin:0">Reporte del mes — ${pmEsc(mpsMesTxt(D.mes))}</div>
        <span style="flex:1"></span>
        <button class="btn btn-out btn-sm" onclick="mprCopiar()">📋 Copiar para Excel</button>
        <button class="btn btn-out btn-sm" onclick="mprImprimir()">🖨️ Imprimir</button>
      </div>
    </div>
    ${resumen}
    <div class="card">
      <div class="mps-wrap"><table class="mps-tbl">
        <thead><tr><th>Pan</th>${cab}<th style="text-align:left">Aviso</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td>Total</td>${pie}<td></td></tr></tfoot>
      </table></div>
      <div style="font-size:11px;color:var(--cream2);margin-top:8px;line-height:1.6">
        Venta total = real de los días cerrados + lo previsto de los días que quedan (el mayor entre el estimado repartido o la previsión del día y los pedidos, por canal).
        Producción asumida = días cerrados en que el plan no cubría lo vendido. Inventario final = inicial + producción − venta. Falta producir = lo que hay que sumar al plan desde hoy para que no baje de cero.
        ⚠ = pan sin peso (no entra en los kilos).
      </div>
    </div>`;
}

// ── Salidas ──
function mprMatriz() {
  const D = _mprFilas;
  const cab = ['Pan', ...MPR_COLS.map(c => c[0]), 'Aviso'];
  const cuerpo = D.filas.map(f => [f.nombre, ...MPR_COLS.map(([n, fn]) => {
    const v = fn(f);
    return n === '% del estimado' ? (v === null ? '' : Math.round(v * 100) + '%') : Math.round(v * 100) / 100;
  }), f.aviso]);
  return { cab, cuerpo };
}

async function mprCopiar() {
  if (!_mprFilas) return;
  const { cab, cuerpo } = mprMatriz();
  const tsv = [cab, ...cuerpo].map(r => r.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    pmToast('Reporte copiado: pegalo en Excel ✓', 'ok');
  } catch (e) {
    pmToast('No se pudo copiar: ' + e.message, 'err');
  }
}

function mprImprimir() {
  if (!_mprFilas) return;
  const { cab, cuerpo } = mprMatriz();
  const D = _mprFilas, t = D.tot;
  const fila = r => `<tr>${r.map((c, i) => `<td class="${i === 0 || i === r.length - 1 ? '' : 'n'}">${pmEsc(c)}</td>`).join('')}</tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>MPS ${pmEsc(D.mes)}</title>
<style>@page{size:landscape;margin:8mm}body{font-family:Arial,sans-serif;font-size:10px;color:#111}h1{font-size:16px;margin:0 0 2px}.s{color:#555;margin-bottom:8px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:3px 5px;text-align:left}th{font-size:8px;text-transform:uppercase;color:#555}
.n{text-align:right;font-family:monospace}.f{margin-top:8px;color:#555;font-size:9px}</style></head><body>
<h1>MPS — ${pmEsc(mpsMesTxt(D.mes))}</h1>
<div class="s">Estimado, ventas, producción e inventarios por pan · ${pmEsc(pmHoy())} · Estimado ${mpsFmt(t.est, 0)} u · Venta ${mpsFmt(t.venta, 0)} u (${mpsFmt(t.kg, 1)} kg) · Producción ${mpsFmt(t.prod, 0)} u · Falta producir ${mpsFmt(t.falta, 0)} u (${mpsFmt(t.kgProd, 1)} kg)</div>
<table><thead><tr>${cab.map(c => `<th>${pmEsc(c)}</th>`).join('')}</tr></thead><tbody>${cuerpo.map(fila).join('')}</tbody></table>
<div class="f">Venta total = real de días cerrados + previsto de los días que quedan. Inventario final = inicial + producción − venta. Producción asumida = días cerrados sin producción cargada que cubriera lo vendido.</div>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { pmToast('El navegador bloqueó la ventana — permití ventanas emergentes para imprimir', 'err'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* se puede imprimir a mano */ } }, 300);
}
