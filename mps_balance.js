// mps_balance.js — MPS · Entrega 2b: balance diario de inventario por pan (prefijo mpb)
//
// DISEÑO: módulo de SOLO LECTURA. No crea tablas ni escribe nada: junta lo que
// ya existe y calcula.
//   · Estimado del mes y inventario inicial  → mps_estimado / mps_inventario (mps.js)
//   · Calendario de entregas y excepciones   → mps_calendario / mps_excepciones (mps.js)
//   · Ventas reales                          → mps_venta_real (mps_ventas.js)
//   · Pedidos comprometidos                  → pedidos + pedido_lineas (mps_ventas.js)
//   · Producción planeada                    → plan_produccion (la misma fuente que
//                                              Producción y Plan Libre)
//
// REGLAS (acordadas con Victor)
//   1. El estimado mensual de cada canal se reparte SOLO entre sus días de
//      entrega, en unidades enteras y parejo (resto repartido a lo largo del mes).
//   2. Día cerrado (anterior a hoy, o con venta real cargada) = venta real; si no
//      hay filas reales ese día, vendió 0 y NO se redistribuye.
//   3. Día abierto o futuro: por canal, el MAYOR entre el estimado del día y los
//      pedidos comprometidos (los pedidos son parte del estimado, no se suman).
//   4. Inventario final del día = inventario del día anterior + producción − venta.
//      El primer día parte del inventario inicial del mes. Negativo = en rojo.
//   5. Producción = suma de las filas 'pedido' y 'libre' de plan_produccion de ese
//      día y pan. (Supuesto: son listas distintas; si un mismo pan está en las dos
//      el mismo día, se suman.)
//
// Mover la producción de un día NO se hace aquí todavía: se sigue haciendo en
// Producción o Plan Libre, y este balance lo refleja al recargar. Editarla desde
// el balance es la entrega 2c (hay que cuidar que Plan Libre no la pise).

let _mpbReq = 0;
let _mpbDatos = null;       // { mes, real, comp, prod } del mes abierto
let _mpbPan = '';           // pan elegido en el selector

// ═══════════════════════════════════════════════════════════
// FUNCIONES PURAS
// ═══════════════════════════════════════════════════════════

// Reparte q unidades en n días, enteras y parejas. Suma siempre q.
function mpbRepartir(q, n) {
  const out = [];
  if (!n) return out;
  const Q = Math.round(Number(q) || 0);
  for (let i = 0; i < n; i++) out.push(Math.floor((i + 1) * Q / n) - Math.floor(i * Q / n));
  return out;
}

// d = { mes, hoy, productos, est, inv, cal, exc, real, comp, prod }
//   est:  pid -> {comercial, domestico, feria}
//   inv:  pid -> inventario inicial
//   real: 'fecha|pid|canal' -> unidades        (de mps_venta_real)
//   comp: 'fecha|pid|canal' -> unidades        (de pedidos, sin tope de fecha)
//   prod: 'fecha|pid'       -> unidades        (de plan_produccion)
// Devuelve { pid -> { dias:[...], resumen:{...} } }
function mpbCalcular(d) {
  const fechas = mpsFechasDelMes(d.mes).map(f => f.fecha);
  const entrega = {};
  MPS_CANALES.forEach(c => { entrega[c.id] = mpsFechasEntrega(d.mes, c.id, d.cal, d.exc); });
  const out = {};
  (d.productos || []).forEach(p => {
    const pid = p.id;
    const est = (d.est && d.est[pid]) || {};
    const estDia = {};
    MPS_CANALES.forEach(c => {
      const dias = entrega[c.id];
      const rep = mpbRepartir(est[c.id], dias.length);
      dias.forEach((f, i) => { (estDia[f] = estDia[f] || {})[c.id] = rep[i]; });
    });
    let inv = Number((d.inv && d.inv[pid]) || 0);
    const invIni = inv;
    let tProd = 0, tVenta = 0, tReal = 0, minInv = inv, primerNeg = null;
    const dias = fechas.map(f => {
      const e = estDia[f] || {};
      const re = {}, co = {};
      let hayReal = false, estT = 0, compT = 0, realT = 0;
      MPS_CANALES.forEach(c => {
        const kr = f + '|' + pid + '|' + c.id;
        if (kr in d.real) hayReal = true;
        re[c.id] = d.real[kr] || 0;
        co[c.id] = d.comp[kr] || 0;
        estT += e[c.id] || 0; compT += co[c.id]; realT += re[c.id];
      });
      const cerrado = f < d.hoy || hayReal;
      let venta = 0;
      if (cerrado) venta = realT;
      else MPS_CANALES.forEach(c => { venta += Math.max(e[c.id] || 0, co[c.id]); });
      const prod = d.prod[f + '|' + pid] || 0;
      inv = inv + prod - venta;
      tProd += prod; tVenta += venta; tReal += realT;
      if (inv < minInv) minInv = inv;
      if (inv < 0 && primerNeg === null) primerNeg = f;
      return { fecha: f, entrega: MPS_CANALES.filter(c => (e[c.id] !== undefined)).map(c => c.id),
               est: estT, comp: compT, real: realT, cerrado, venta, prod, inv };
    });
    out[pid] = { dias, resumen: { invIni, invFin: inv, prod: tProd, venta: tVenta, real: tReal, minInv, primerNeg } };
  });
  return out;
}

// ═══════════════════════════════════════════════════════════
// CARGA
// ═══════════════════════════════════════════════════════════
async function mpbCargar() {
  const req = ++_mpbReq;
  const mes = _mpsMes || mpsMesActual();
  const root = document.getElementById('mpb-root');
  if (!root) return;
  root.innerHTML = '<div class="ph"><span class="ph-icon">⏳</span>Calculando balance...</div>';
  try {
    const sig = mpsMesDesplazar(mes, 1);
    const [realRows, plan, ped] = await Promise.all([
      pmDB.get('mps_venta_real', {}, `*&fecha=gte.${mes}-01&fecha=lt.${sig}-01`),
      pmDB.get('plan_produccion', {}, `*&fecha=gte.${mes}-01&fecha=lt.${sig}-01`),
      mpvLeerPedidos(mes)
    ]);
    if (req !== _mpbReq) return;
    const real = {};
    (realRows || []).forEach(r => { real[r.fecha + '|' + r.producto_id + '|' + r.canal] = (real[r.fecha + '|' + r.producto_id + '|' + r.canal] || 0) + (Number(r.cantidad) || 0); });
    const prod = {};
    (plan || []).forEach(r => {
      if (r.tipo !== 'pedido' && r.tipo !== 'libre') return;
      const k = String(r.fecha).slice(0, 10) + '|' + r.producto_id;
      prod[k] = (prod[k] || 0) + (Number(r.cantidad) || 0);
    });
    const panes = new Set((_mpsProductos || []).map(p => p.id));
    // '9999-12-31' = sin tope de fecha: interesan también los pedidos de días futuros.
    const comp = mpvAgrupar(ped.pedidos, ped.lineas, panes, mes, '9999-12-31').mapa;
    const compK = {};
    Object.keys(comp).forEach(k => { compK[k] = comp[k]; });
    _mpbDatos = { mes, real, comp: compK, prod };
  } catch (e) {
    if (req !== _mpbReq) return;
    console.warn('[mpbCargar]', e.message);
    const falta = /PGRST205|Could not find the table|404/.test(e.message);
    root.innerHTML = `<div class="ph" style="flex-direction:column;gap:6px"><span class="ph-icon">⚠️</span>
      ${falta ? 'Falta la tabla de ventas reales. Corré <b>sql_mps_ventas.sql</b> y recargá.' : 'No se pudo calcular el balance: ' + pmEsc(e.message)}</div>`;
    return;
  }
  mpbRender();
}

// ═══════════════════════════════════════════════════════════
// PANTALLA
// ═══════════════════════════════════════════════════════════
function mpbElegir(pid) { _mpbPan = pid; mpbRender(); }

function mpbRender() {
  const root = document.getElementById('mpb-root');
  if (!root || !_mpbDatos) return;
  const D = _mpbDatos;
  const mes = D.mes;
  const hoy = pmHoy();
  const panes = _mpsProductos || [];
  const calc = mpbCalcular({ mes, hoy, productos: panes, est: _mpsEst, inv: _mpsInv,
                             cal: _mpsCal, exc: _mpsExc, real: D.real, comp: D.comp, prod: D.prod });
  // Panes con algo que balancear
  const activos = panes.filter(p => {
    const r = calc[p.id].resumen;
    const e = _mpsEst[p.id] || {};
    return r.venta || r.prod || r.invIni || MPS_CANALES.some(c => e[c.id]);
  });
  if (!activos.length) {
    root.innerHTML = '<div class="ph"><span class="ph-icon">⚖️</span>Todavía no hay estimado, ventas ni producción este mes.</div>';
    return;
  }
  if (!activos.some(p => p.id === _mpbPan)) _mpbPan = activos[0].id;

  // Alertas: panes que se quedan sin inventario
  const neg = activos.filter(p => calc[p.id].resumen.primerNeg)
    .sort((a, b) => calc[a.id].resumen.primerNeg.localeCompare(calc[b.id].resumen.primerNeg));
  const alertas = neg.length
    ? `<div class="card" style="border-color:#b3261e"><div class="ctitle" style="color:#b3261e">⚠ Inventario negativo — falta producir</div>
        ${neg.map(p => { const r = calc[p.id].resumen; return `<div style="font-size:13px;padding:2px 0"><a href="#" onclick="mpbElegir('${p.id}');return false;">${pmEsc(p.nombre)}</a>: se acaba el <b>${mpvDiaTxt(r.primerNeg)}</b>, llega a <b>${mpsFmt(r.minInv, 1)}</b> unidades</div>`; }).join('')}
       </div>`
    : `<div class="card"><div style="font-size:13px">✔ Ningún pan baja de cero este mes con la producción planeada.</div></div>`;

  const sel = `<select onchange="mpbElegir(this.value)" style="width:auto;max-width:100%">${activos.map(p =>
    `<option value="${p.id}"${p.id === _mpbPan ? ' selected' : ''}>${pmEsc(p.nombre)}${calc[p.id].resumen.primerNeg ? ' ⚠' : ''}</option>`).join('')}</select>`;

  const pan = panes.find(p => p.id === _mpbPan);
  const c = calc[_mpbPan];
  const r = c.resumen;
  const letra = { comercial: 'C', domestico: 'D', feria: 'F' };
  const filas = c.dias.map(x => {
    const esHoy = x.fecha === hoy;
    const rojo = x.inv < 0;
    const bg = esHoy ? 'background:#FFF8E1' : (x.cerrado ? 'background:#F7F9F6' : '');
    return `<tr style="${bg}">
      <td>${mpvDiaTxt(x.fecha)}${esHoy ? ' <b>·hoy</b>' : ''}</td>
      <td>${x.entrega.map(k => letra[k]).join(' ') || '·'}</td>
      <td class="mps-n">${x.est ? mpsFmt(x.est, 0) : ''}</td>
      <td class="mps-n">${x.comp ? mpsFmt(x.comp, 0) : ''}</td>
      <td class="mps-n">${x.cerrado ? mpsFmt(x.real, 0) : ''}</td>
      <td class="mps-n"><b>${x.venta ? mpsFmt(x.venta, 0) : '0'}</b></td>
      <td class="mps-n">${x.prod ? mpsFmt(x.prod, 0) : ''}</td>
      <td class="mps-n" style="font-weight:700;${rojo ? 'color:#b3261e;background:#FDECEA' : ''}">${mpsFmt(x.inv, 1)}</td></tr>`;
  }).join('');

  root.innerHTML = `${alertas}
    <div class="card">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div class="ctitle" style="margin:0">Balance diario</div>${sel}
        <span style="font-size:11px;color:var(--cream2)">${pan && pan.peso_g ? 'Peso neto ' + mpsFmt(pan.peso_g, 0) + ' g' : ''}</span>
      </div>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><div class="stat-lbl">Inventario inicial</div><div class="stat-val">${mpsFmt(r.invIni, 1)}</div></div>
        <div class="stat"><div class="stat-lbl">Producción</div><div class="stat-val">${mpsFmt(r.prod, 0)}</div></div>
        <div class="stat"><div class="stat-lbl">Venta (real + prevista)</div><div class="stat-val">${mpsFmt(r.venta, 0)}</div></div>
        <div class="stat"><div class="stat-lbl">Inventario final</div><div class="stat-val" style="${r.invFin < 0 ? 'color:#b3261e' : ''}">${mpsFmt(r.invFin, 1)}</div></div>
      </div>
    </div>
    <div class="card">
      <div class="mps-wrap"><table class="mps-tbl">
        <thead><tr><th>Día</th><th>Entrega</th><th>Estimado</th><th>Pedidos</th><th>Real</th><th>Venta usada</th><th>Producción</th><th>Inv. final</th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>
      <div style="font-size:11px;color:var(--cream2);margin-top:8px;line-height:1.6">
        Entrega: C comercial · D doméstico · F feria. Días cerrados (gris) usan la venta real; los abiertos usan el mayor entre el estimado del día y los pedidos de cada canal.
        La producción sale del plan de producción (Producción y Plan Libre): para moverla, cambiala allí y recargá esta pestaña.
      </div>
    </div>`;
}
