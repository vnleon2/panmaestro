// mps_ventas.js — MPS · Entrega 2a: ventas reales por día, pan y canal
// Prefijo de función: mpv
//
// DISEÑO: igual que mps.js — módulo independiente. Lee pedidos, pedido_lineas
// y los panes de mps.js; escribe SOLO en mps_venta_real (ver sql_mps_ventas.sql).
// No toca G ni pmSave() ni pm_db.js.
//
// DE DÓNDE SALEN LAS VENTAS REALES
//   · Pedidos de la pestaña Pan       → canal doméstico
//   · Pedidos de la pestaña Comercial → canal comercial
//   · Feria                           → no tiene pedidos: se anota a mano
//   La tabla `ventas` solo guarda el total en colones (sin panes), por eso se
//   leen las líneas de los pedidos (producto × cantidad).
//
// QUÉ CUENTA COMO VENDIDO (regla acordada, opción B)
//   Todo pedido que no esté anulado, esté o no pagado/entregado, ubicado en su
//   día de ENTREGA (fecha_entrega; si no tiene, la fecha en que se tomó) y
//   solo hasta hoy. Los días futuros siguen siendo "comprometidos", no ventas.
//
// QUÉ NO SE PISA
//   Las filas con origen 'manual' (feria y correcciones de Victor) nunca las
//   toca el botón "Traer ventas de pedidos". Si se edita a mano una fila que
//   vino de pedidos, pasa a 'manual'.
//
// LÍMITE CONOCIDO: solo se leen los pedidos que ya están en Supabase. Un pedido
// que quedó solo en el navegador (sin sincronizar) no aparece.

let _mpvFilas = [];     // filas de mps_venta_real del mes abierto
let _mpvMes = '';       // mes al que corresponden _mpvFilas
let _mpvReq = 0;        // descarta respuestas viejas si se cambia de mes rápido
let _mpvPlan = null;    // vista previa pendiente de confirmar
let _mpvOcupado = false;

const MPV_DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MPV_CANALES = ['comercial', 'domestico', 'feria'];
const MPV_NOM = { comercial: 'Comercial', domestico: 'Doméstico', feria: 'Feria' };

// ═══════════════════════════════════════════════════════════
// FUNCIONES PURAS (se prueban sin pantalla)
// ═══════════════════════════════════════════════════════════

// Fecha en que el pedido "ocurre": entrega si la tiene, si no la de toma.
function mpvFechaEfectiva(p) {
  return String((p && (p.fecha_entrega || p.fecha)) || '').slice(0, 10);
}

function mpvCanalDe(p) {
  return p && p.tipo === 'comercial' ? 'comercial' : 'domestico';
}

// pedidos + líneas → { mapa: 'fecha|pid|canal' → unidades, resumen }
// panesIds: Set de ids de panes (las líneas de otros productos se ignoran).
function mpvAgrupar(pedidos, lineas, panesIds, mes, hoy) {
  const desde = mes + '-01';
  const fin = mes + '-' + String(new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate()).padStart(2, '0');
  const hasta = hoy < fin ? hoy : fin;
  const lin = {};
  (lineas || []).forEach(l => { (lin[l.pedido_id] = lin[l.pedido_id] || []).push(l); });
  const mapa = {};
  const res = { pedidos: 0, unidades: 0, porStatus: {}, sinLineas: 0, otrosProductos: 0 };
  (pedidos || []).forEach(p => {
    if (p.activo === false) return;
    const f = mpvFechaEfectiva(p);
    if (!f || f < desde || f > hasta) return;
    const canal = mpvCanalDe(p);
    const ls = lin[p.id] || [];
    if (!ls.length) { res.sinLineas++; return; }
    let aporto = false;
    ls.forEach(l => {
      const u = parseFloat(l.cantidad) || 0;
      if (!panesIds.has(l.producto_id)) { res.otrosProductos++; return; }
      if (u <= 0) return;
      const k = f + '|' + l.producto_id + '|' + canal;
      mapa[k] = (mapa[k] || 0) + u;
      res.unidades += u;
      aporto = true;
    });
    if (aporto) {
      res.pedidos++;
      const st = p.status || '—';
      res.porStatus[st] = (res.porStatus[st] || 0) + 1;
    }
  });
  return { mapa, resumen: res };
}

// Compara lo que dicen los pedidos con lo ya guardado.
// filasExist: filas de mps_venta_real del mes. Devuelve qué escribir y qué borrar.
function mpvPlanificar(mapa, filasExist, mes, hoy) {
  const exist = {};
  (filasExist || []).forEach(r => { exist[r.fecha + '|' + r.producto_id + '|' + r.canal] = r; });
  const escribir = [], respetadas = [];
  let iguales = 0;
  Object.keys(mapa).forEach(k => {
    const [fecha, producto_id, canal] = k.split('|');
    const e = exist[k];
    if (e && e.origen === 'manual') { respetadas.push({ fecha, producto_id, canal, cantidad: mapa[k], manual: Number(e.cantidad) }); return; }
    if (e && Number(e.cantidad) === mapa[k]) { iguales++; return; }
    escribir.push({ fecha, producto_id, canal, cantidad: mapa[k], origen: 'pedidos' });
  });
  // Filas que vinieron de pedidos y ya no están (pedido anulado/borrado/movido).
  const borrar = (filasExist || [])
    .filter(r => r.origen === 'pedidos' && r.fecha <= hoy && !(r.fecha + '|' + r.producto_id + '|' + r.canal in mapa))
    .map(r => r.id);
  return { escribir, borrar, respetadas, iguales };
}

// ═══════════════════════════════════════════════════════════
// CARGA
// ═══════════════════════════════════════════════════════════
async function mpvCargar() {
  const req = ++_mpvReq;
  const mes = (typeof _mpsMes !== 'undefined' && _mpsMes) || mpsMesActual();
  const root = document.getElementById('mpv-root');
  if (!root) return;
  try {
    const sig = mpsMesDesplazar(mes, 1);
    const rows = await pmDB.get('mps_venta_real', {}, `*&fecha=gte.${mes}-01&fecha=lt.${sig}-01&order=fecha.asc`);
    if (req !== _mpvReq) return;
    _mpvFilas = rows || [];
    _mpvMes = mes;
    _mpvPlan = null;
  } catch (e) {
    if (req !== _mpvReq) return;
    const falta = /PGRST205|Could not find the table|404/.test(e.message);
    root.innerHTML = `<div class="ph" style="flex-direction:column;gap:6px"><span class="ph-icon">⚠️</span>
      ${falta ? 'Falta la tabla de ventas reales. Corré <b>sql_mps_ventas.sql</b> en el editor SQL y recargá la pantalla.'
              : 'No se pudieron cargar las ventas reales: ' + pmEsc(e.message)}</div>`;
    return;
  }
  mpvRender();
}

// Trae pedidos pan+comercial del mes (por fecha de toma o de entrega) y sus líneas.
async function mpvLeerPedidos(mes) {
  const sig = mpsMesDesplazar(mes, 1);
  const base = `*&tipo=in.(pan,comercial)`;
  const porFecha = await pmDB.get('pedidos', {}, `${base}&fecha=gte.${mes}-01&fecha=lt.${sig}-01`) || [];
  let porEntrega = [];
  try {
    porEntrega = await pmDB.get('pedidos', {}, `${base}&fecha_entrega=gte.${mes}-01&fecha_entrega=lt.${sig}-01`) || [];
  } catch (e) { /* la columna fecha_entrega aún no existe: solo cuenta la fecha de toma */ }
  const porId = {};
  [...porFecha, ...porEntrega].forEach(p => { porId[p.id] = p; });
  const pedidos = Object.values(porId);
  const ids = pedidos.map(p => p.id);
  const lineas = [];
  for (let i = 0; i < ids.length; i += 40) {
    const trozo = ids.slice(i, i + 40);
    const rows = await pmDB.get('pedido_lineas', {}, `*&pedido_id=in.(${trozo.join(',')})`);
    if (rows) lineas.push(...rows);
  }
  return { pedidos, lineas };
}

// ═══════════════════════════════════════════════════════════
// TRAER VENTAS DE PEDIDOS (vista previa → confirmar)
// ═══════════════════════════════════════════════════════════
async function mpvTraer() {
  if (_mpvOcupado) return;
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase', 'err'); return; }
  const mes = _mpvMes || _mpsMes;
  _mpvOcupado = true;
  const prev = document.getElementById('mpv-prev');
  if (prev) prev.innerHTML = '<div class="ph"><span class="ph-icon">⏳</span>Leyendo pedidos...</div>';
  try {
    const sig = mpsMesDesplazar(mes, 1);
    const frescas = await pmDB.get('mps_venta_real', {}, `*&fecha=gte.${mes}-01&fecha=lt.${sig}-01`) || [];
    const { pedidos, lineas } = await mpvLeerPedidos(mes);
    const panes = new Set((_mpsProductos || []).map(p => p.id));
    const { mapa, resumen } = mpvAgrupar(pedidos, lineas, panes, mes, pmHoy());
    const plan = mpvPlanificar(mapa, frescas, mes, pmHoy());
    _mpvPlan = { mes, ...plan, resumen };
  } catch (e) {
    console.warn('[mpvTraer]', e.message);
    _mpvPlan = null;
    pmToast('No se pudieron leer los pedidos: ' + e.message, 'err', 5000);
  } finally {
    _mpvOcupado = false;
  }
  mpvRenderPrev();
}

function mpvCancelarPrev() { _mpvPlan = null; mpvRenderPrev(); }

async function mpvConfirmar() {
  const pl = _mpvPlan;
  if (!pl || _mpvOcupado) return;
  _mpvOcupado = true;
  mpvRenderPrev();
  try {
    for (let i = 0; i < pl.escribir.length; i += 200) {
      await pmDB.upsert('mps_venta_real?on_conflict=fecha,producto_id,canal', pl.escribir.slice(i, i + 200));
    }
    if (pl.borrar.length) await pmDB.hardDeleteMany('mps_venta_real', pl.borrar);
    pmToast(`Ventas cargadas: ${pl.escribir.length} fila${pl.escribir.length === 1 ? '' : 's'}${pl.borrar.length ? ' · ' + pl.borrar.length + ' retirada' + (pl.borrar.length === 1 ? '' : 's') : ''} ✓`, 'ok');
  } catch (e) {
    console.warn('[mpvConfirmar]', e.message);
    pmToast('No se guardó: ' + e.message, 'err', 5000);
  }
  _mpvOcupado = false;
  _mpvPlan = null;
  await mpvCargar();
}

// ═══════════════════════════════════════════════════════════
// EDICIÓN MANUAL
// ═══════════════════════════════════════════════════════════
async function mpvAgregar() {
  const mes = _mpvMes || _mpsMes;
  const v = id => (document.getElementById(id) || {}).value;
  const fecha = v('mpv-f'), canal = v('mpv-c'), pid = v('mpv-p');
  const cant = mpsNum(v('mpv-q'));
  if (!fecha || fecha.slice(0, 7) !== mes) { pmToast('La fecha debe estar dentro de ' + mpsMesTxt(mes), 'err'); return; }
  if (fecha > pmHoy()) { pmToast('Esa fecha todavía no ocurre: las ventas reales son de días ya pasados', 'err'); return; }
  if (!pid) { pmToast('Elegí el pan', 'err'); return; }
  if (cant === null || v('mpv-q') === '') { pmToast('Escribí la cantidad (0 si ese día no se vendió)', 'err'); return; }
  try {
    await pmDB.upsert('mps_venta_real?on_conflict=fecha,producto_id,canal',
      [{ fecha, producto_id: pid, canal, cantidad: cant, origen: 'manual' }]);
    pmToast('Venta anotada ✓', 'ok');
    await mpvCargar();
  } catch (e) { pmToast('No se guardó: ' + e.message, 'err', 5000); }
}

async function mpvEditar(id, inp) {
  const fila = _mpvFilas.find(r => r.id === id);
  if (!fila) return;
  const n = mpsNum(inp.value);
  if (n === null) { inp.value = fila.cantidad; return; }
  try {
    await pmDB.update('mps_venta_real', id, { cantidad: n, origen: 'manual' });
    fila.cantidad = n; fila.origen = 'manual';
    mpvRender();
  } catch (e) { inp.value = fila.cantidad; pmToast('No se guardó: ' + e.message, 'err', 5000); }
}

async function mpvBorrar(id) {
  try {
    await pmDB.hardDelete('mps_venta_real', id);
    _mpvFilas = _mpvFilas.filter(r => r.id !== id);
    mpvRender();
  } catch (e) { pmToast('No se pudo borrar: ' + e.message, 'err', 5000); }
}

// ═══════════════════════════════════════════════════════════
// PANTALLA
// ═══════════════════════════════════════════════════════════
function mpvNombre(pid) {
  const p = (_mpsProductos || []).find(x => x.id === pid);
  return p ? p.nombre : '(pan no encontrado)';
}

function mpvDiaTxt(f) {
  const [y, m, d] = f.split('-').map(Number);
  return MPV_DIAS[new Date(y, m - 1, d).getDay()] + ' ' + String(d).padStart(2, '0');
}

function mpvRenderPrev() {
  const el = document.getElementById('mpv-prev');
  if (!el) return;
  const pl = _mpvPlan;
  if (!pl) { el.innerHTML = ''; return; }
  const r = pl.resumen;
  const st = Object.keys(r.porStatus).sort().map(s => `${pmEsc(s)}: ${r.porStatus[s]}`).join(' · ') || '—';
  const nada = !pl.escribir.length && !pl.borrar.length;
  el.innerHTML = `<div class="card" style="border-color:var(--gold)">
    <div class="ctitle">Vista previa — ventas de pedidos hasta hoy</div>
    <div style="font-size:13px;line-height:1.7">
      Pedidos leídos que cuentan: <b>${r.pedidos}</b> · Unidades: <b>${mpsFmt(r.unidades, 1)}</b><br>
      Por estado: ${st}<br>
      Filas nuevas o cambiadas: <b>${pl.escribir.length}</b> · Ya iguales: ${pl.iguales}
      ${pl.borrar.length ? `· A retirar (el pedido ya no está): <b>${pl.borrar.length}</b>` : ''}
      ${pl.respetadas.length ? `<br>Filas que tenés corregidas a mano y NO se tocan: <b>${pl.respetadas.length}</b>` : ''}
      ${r.sinLineas ? `<br><span style="color:var(--cream2)">Pedidos sin líneas de producto (ignorados): ${r.sinLineas}</span>` : ''}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-gold btn-sm" onclick="mpvConfirmar()" ${nada || _mpvOcupado ? 'disabled' : ''}>${nada ? 'Nada que cambiar' : (_mpvOcupado ? 'Guardando...' : '✔ Cargar estas ventas')}</button>
      <button class="btn btn-out btn-sm" onclick="mpvCancelarPrev()" ${_mpvOcupado ? 'disabled' : ''}>Cerrar</button>
    </div></div>`;
}

function mpvRender() {
  const root = document.getElementById('mpv-root');
  if (!root) return;
  const mes = _mpvMes || _mpsMes;
  const hoy = pmHoy();
  const panes = _mpsProductos || [];
  const ultimo = mpsFechasDelMes(mes).slice(-1)[0].fecha;

  // Resumen: real vs estimado por pan y canal
  const real = {};
  _mpvFilas.forEach(r => {
    const o = real[r.producto_id] = real[r.producto_id] || { comercial: 0, domestico: 0, feria: 0 };
    o[r.canal] += Number(r.cantidad) || 0;
  });
  const tot = { comercial: [0, 0], domestico: [0, 0], feria: [0, 0] };
  let kgReal = 0;
  const filasRes = panes.map(p => {
    const re = real[p.id] || { comercial: 0, domestico: 0, feria: 0 };
    const es = (typeof _mpsEst !== 'undefined' && _mpsEst[p.id]) || {};
    const hay = MPV_CANALES.some(c => re[c] || es[c]);
    if (!hay) return '';
    let uReal = 0;
    const celdas = MPV_CANALES.map(c => {
      const e = Number(es[c]) || 0;
      tot[c][0] += re[c]; tot[c][1] += e; uReal += re[c];
      return `<td class="mps-n">${mpsFmt(re[c], 1)} <span style="color:var(--cream2)">/ ${mpsFmt(e, 1)}</span></td>`;
    }).join('');
    const kg = mpsKilos(uReal, p.peso_g); kgReal += kg;
    return `<tr><td>${pmEsc(p.nombre)}</td>${celdas}<td class="mps-n">${p.peso_g ? mpsFmt(kg, 1) : '—'}</td></tr>`;
  }).join('');

  const opcPan = '<option value="">Pan...</option>' + panes.map(p => `<option value="${p.id}">${pmEsc(p.nombre)}</option>`).join('');
  const opcCan = MPV_CANALES.map(c => `<option value="${c}">${MPV_NOM[c]}</option>`).join('');

  const detalle = _mpvFilas.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || mpvNombre(a.producto_id).localeCompare(mpvNombre(b.producto_id), 'es'))
    .map(r => `<tr>
      <td>${mpvDiaTxt(r.fecha)}</td><td>${MPV_NOM[r.canal]}</td><td style="text-align:left">${pmEsc(mpvNombre(r.producto_id))}</td>
      <td><input class="mps-in" style="width:70px" value="${r.cantidad}" onchange="mpvEditar('${r.id}',this)"></td>
      <td>${r.origen === 'pedidos' ? '<span class="badge">pedidos</span>' : '<span class="badge" style="background:var(--gold);color:#fff">manual</span>'}</td>
      <td><button class="btn btn-out btn-xs" onclick="mpvBorrar('${r.id}')" title="Quitar">✕</button></td></tr>`).join('');

  root.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="mpvTraer()" ${_mpvOcupado ? 'disabled' : ''}>⬇ Traer ventas de pedidos</button>
        <span style="font-size:11px;color:var(--cream2)">Pedidos de Pan = doméstico · Comercial = comercial · cuenta todo pedido no anulado, por su día de entrega, hasta hoy (${hoy}). La feria se anota abajo.</span>
      </div>
    </div>
    <div id="mpv-prev">${''}</div>
    <div class="card">
      <div class="ctitle">Real vs estimado — ${pmEsc(mpsMesTxt(mes))}</div>
      <div class="mps-wrap"><table class="mps-tbl">
        <thead><tr><th>Pan</th>${MPV_CANALES.map(c => `<th>${MPV_NOM[c]}<br>real / est.</th>`).join('')}<th>Kg reales</th></tr></thead>
        <tbody>${filasRes || '<tr><td colspan="5" style="text-align:center;color:var(--cream2)">Todavía no hay ventas cargadas ni estimado.</td></tr>'}</tbody>
        <tfoot><tr><td>Total unidades</td>${MPV_CANALES.map(c => `<td class="mps-n">${mpsFmt(tot[c][0], 1)} <span style="color:var(--cream2)">/ ${mpsFmt(tot[c][1], 1)}</span></td>`).join('')}<td class="mps-n">${mpsFmt(kgReal, 1)}</td></tr></tfoot>
      </table></div>
    </div>
    <div class="card">
      <div class="ctitle">Anotar o corregir una venta (feria, o lo que no esté en pedidos)</div>
      <div class="row">
        <div class="col sm"><label>Día</label><input type="date" id="mpv-f" min="${mes}-01" max="${hoy < ultimo ? hoy : ultimo}"></div>
        <div class="col sm"><label>Canal</label><select id="mpv-c">${opcCan}</select></div>
        <div class="col"><label>Pan</label><select id="mpv-p">${opcPan}</select></div>
        <div class="col sm"><label>Unidades</label><input id="mpv-q" inputmode="decimal" placeholder="0"></div>
        <div class="col sm" style="align-self:flex-end"><button class="btn btn-gold btn-sm" onclick="mpvAgregar()">+ Anotar</button></div>
      </div>
      <div style="font-size:11px;color:var(--cream2);margin-top:6px">Un día sin ventas se anota con 0 — ese día cuenta como vendido en cero y no se redistribuye.</div>
    </div>
    <div class="card">
      <div class="ctitle">Detalle por día</div>
      <div class="mps-wrap"><table class="mps-tbl">
        <thead><tr><th>Día</th><th>Canal</th><th style="text-align:left">Pan</th><th>Unid.</th><th>Origen</th><th></th></tr></thead>
        <tbody>${detalle || '<tr><td colspan="6" style="text-align:center;color:var(--cream2)">Sin ventas cargadas este mes.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  mpvRenderPrev();
}
