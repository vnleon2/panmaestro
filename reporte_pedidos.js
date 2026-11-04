// ═══════════════════════════════════════════════════════════════════════════
// 📅 REPORTE «PEDIDOS POR FECHA» (4 nov 2026)
//
// Nueva pestaña dentro de Reportes. Lista los pedidos de Pan y Galletas que hay
// que ENTREGAR entre dos fechas (Desde / Hasta), agrupados por día, con:
//   · cliente
//   · producto y cantidad de cada línea
//   · monto de cada línea, total de cada pedido, total de cada día y total del rango
//
// Reglas:
//   · «Ver por» elige qué fecha cuenta:
//       - Entrega (por defecto): la fecha de entrega del pedido; si no tiene, la
//         fecha en que se tomó (misma regla de pmFechaProd y de «Ver por Entrega»).
//       - Fecha del pedido: el día en que se tomó el pedido.
//   · El monto de cada línea usa el precio guardado en el pedido (precio_applied);
//     si la línea no lo trae, se usa el precio actual del catálogo.
//   · Los datos se traen directo de Supabase (no solo de lo cacheado en el
//     navegador). Sin conexión se muestra lo que haya guardado localmente.
//   · Imprimible / PDF con su propia hoja (no depende del tema oscuro de la app).
//
// Se engancha en reportes.js con la pestaña 'pedfechas' (repTab / repRender).
// Usa de otros módulos: pvTraerLineas (pedidos_vista.js), _sbProdEnsureMap y
// _sbProdMapInv (maestros.js), pmNombrePan/Gall, pmPrecioPan/Gall, pmFechaProd,
// pmMoney, pmEsc, pmFmtDate, pmSumarDias, pmHoy (pm_core.js), repStatBox.
// ═══════════════════════════════════════════════════════════════════════════

const _rpf = { desde: '', hasta: '', pan: true, galleta: true, modo: 'entrega', cache: null };

function rpfModo(v) {
  _rpf.modo = v === 'toma' ? 'toma' : 'entrega';
  repRender();
}

function _rpfInit() {
  if (_rpf.desde && _rpf.hasta) return;
  const hoy = pmHoy();
  _rpf.desde = hoy;
  _rpf.hasta = pmSumarDias(hoy, 6);
}

// ── Acciones de los controles ───────────────────────────────────────────────
function rpfRapido(q) {
  const hoy = pmHoy();
  if (q === 'hoy') { _rpf.desde = hoy; _rpf.hasta = hoy; }
  else if (q === 'manana') { const d = pmSumarDias(hoy, 1); _rpf.desde = d; _rpf.hasta = d; }
  else if (q === 'semana') { _rpf.desde = hoy; _rpf.hasta = pmSumarDias(hoy, 6); }
  else if (q === 'proxima') {
    // De lunes a domingo de la semana que viene.
    const dow = new Date(hoy + 'T12:00:00').getDay();      // 0 = domingo
    const aLunes = ((1 - dow + 7) % 7) || 7;
    _rpf.desde = pmSumarDias(hoy, aLunes);
    _rpf.hasta = pmSumarDias(_rpf.desde, 6);
  }
  repRender();
}

function rpfCambio() {
  const d = document.getElementById('rpf-desde');
  const h = document.getElementById('rpf-hasta');
  if (d && d.value) _rpf.desde = d.value;
  if (h && h.value) _rpf.hasta = h.value;
  // Si "Hasta" quedó antes que "Desde", se iguala para no mostrar un rango vacío.
  if (_rpf.hasta < _rpf.desde) _rpf.hasta = _rpf.desde;
  repRender();
}

function rpfToggle(tipo, el) {
  _rpf[tipo] = !!el.checked;
  repRender();
}

// ── Traer pedidos ───────────────────────────────────────────────────────────
// Pedidos del tipo con fecha de entrega en el rango; los que no tienen fecha de
// entrega, por su fecha de toma. Si la columna fecha_entrega todavía no existe
// en Supabase, se cae a la fecha de toma.
async function _rpfQuery(tipo, desde, hasta, modo) {
  const base = `*&tipo=eq.${tipo}`;
  const porEntrega = `${base}&or=(and(fecha_entrega.gte.${desde},fecha_entrega.lte.${hasta}),and(fecha_entrega.is.null,fecha.gte.${desde},fecha.lte.${hasta}))`;
  const porToma = `${base}&fecha=gte.${desde}&fecha=lte.${hasta}`;
  if (modo === 'toma') return (await pmDB.get('pedidos', {}, porToma)) || [];
  try {
    return (await pmDB.get('pedidos', {}, porEntrega)) || [];
  } catch (e) {
    if (/fecha_entrega/.test(e.message)) return (await pmDB.get('pedidos', {}, porToma)) || [];
    throw e;
  }
}

async function _rpfPedidosDe(tipo, desde, hasta, modo) {
  const esGall = tipo === 'galleta';
  const nombreFn = esGall ? pmNombreGall : pmNombrePan;
  const precioFn = esGall ? pmPrecioGall : pmPrecioPan;
  const arrLocal = (esGall ? G.pedidosGalletas : G.pedidosPan) || [];
  const out = [];
  const vistos = new Set();
  let aviso = '';
  let sbOk = false;

  if (pmDB.disponible()) {
    try {
      const rows = await _rpfQuery(tipo, desde, hasta, modo);
      await _sbProdEnsureMap();
      const lineasPor = await pvTraerLineas(rows.map(r => r.id));
      for (const sb of rows) {
        vistos.add(sb.id);
        const lineas = (lineasPor[sb.id] || []).map(l => {
          const pid = (typeof _sbProdMapInv !== 'undefined' && _sbProdMapInv) ? (_sbProdMapInv[l.producto_id] || '') : '';
          const cant = l.cantidad || 1;
          const tienePrecio = l.precio_applied !== null && l.precio_applied !== undefined && l.precio_applied !== '';
          const unit = tienePrecio ? (parseFloat(l.precio_applied) || 0) : precioFn(pid);
          return { nombre: pid ? nombreFn(pid) : '(producto no encontrado)', cant, monto: unit * cant };
        });
        const dia = modo === 'toma' ? (sb.fecha || '') : (sb.fecha_entrega || sb.fecha || '');
        out.push({ tipo, dia, cli: sb.cliente_nom || '', lineas });
      }
      sbOk = true;
    } catch (e) {
      console.warn('[rpf]', tipo, e.message);
      aviso = 'No se pudo consultar Supabase (' + e.message + '): se muestra solo lo guardado en este navegador.';
    }
  } else {
    aviso = 'Sin conexión a Supabase: se muestra solo lo guardado en este navegador.';
  }

  // Pedidos locales: con Supabase al día, solo los que aún no se sincronizaron;
  // sin Supabase, todos los del rango.
  arrLocal.forEach(p => {
    const f = modo === 'toma' ? (p.date || '') : pmFechaProd(p);
    if (!f || f < desde || f > hasta) return;
    if (sbOk && (p._sbId || vistos.has(p._sbId))) return;
    const lineas = (p.lineas || []).map(l => ({
      nombre: nombreFn(l.pid), cant: l.cant || 1, monto: precioFn(l.pid) * (l.cant || 1)
    }));
    out.push({ tipo, dia: f, cli: p.cliNom || p.cli || '', lineas });
  });

  return { peds: out, aviso };
}

// ── Armar el cuerpo (el mismo para pantalla e impresión; cambia la paleta) ──
const _RPF_PANTALLA = { txt: 'var(--cream)', mut: 'var(--cream2)', oro: 'var(--gold)', lin: 'var(--border)', cab: 'var(--bg3)' };
const _RPF_IMPRESO  = { txt: '#1a1006',       mut: '#7a6040',        oro: '#8A5A12',     lin: '#e8dcc8',        cab: '#f5e8d0' };

function _rpfTitDia(dia) {
  if (!dia) return 'Sin fecha';
  const d = new Date(dia + 'T12:00:00');
  return `${DIAS_L[d.getDay()]} ${d.getDate()} de ${MESES_L[d.getMonth()]}`;
}

function _rpfTotales(peds) {
  let unid = 0, monto = 0;
  peds.forEach(p => p.lineas.forEach(l => { unid += l.cant; monto += l.monto; }));
  return { pedidos: peds.length, unid, monto };
}

function _rpfCuerpo(peds, c) {
  if (!peds.length) return `<div style="padding:22px;text-align:center;color:${c.mut}">No hay pedidos para entregar en estas fechas</div>`;
  const dias = {};
  peds.forEach(p => { (dias[p.dia] = dias[p.dia] || []).push(p); });
  const th = (t, r) => `<th style="padding:6px 10px;text-align:${r ? 'right' : 'left'};font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:${c.mut};background:${c.cab}">${t}</th>`;
  return Object.keys(dias).sort().map(dia => {
    const lista = dias[dia].slice().sort((a, b) => String(a.cli).localeCompare(String(b.cli), 'es'));
    const t = _rpfTotales(lista);
    const filas = lista.map(p => {
      const tp = _rpfTotales([p]);
      const cab = `<tr>
        <td colspan="2" style="padding:12px 10px 4px;font-weight:700;color:${c.txt}">${pmEsc(p.cli || 'Sin nombre')} <span style="font-weight:400;font-size:11px;color:${c.mut}">· ${p.tipo === 'galleta' ? 'Galletas' : 'Pan'}</span></td>
        <td style="padding:12px 10px 4px;text-align:right;font-weight:700;color:${c.oro}">${pmMoney(tp.monto)}</td>
      </tr>`;
      const lins = p.lineas.length ? p.lineas.map(l => `<tr>
        <td style="padding:4px 10px 4px 22px;border-bottom:1px solid ${c.lin};color:${c.txt}">${pmEsc(l.nombre)}</td>
        <td style="padding:4px 10px;border-bottom:1px solid ${c.lin};text-align:right;color:${c.txt}">${l.cant}</td>
        <td style="padding:4px 10px;border-bottom:1px solid ${c.lin};text-align:right;color:${c.txt}">${pmMoney(l.monto)}</td>
      </tr>`).join('') : `<tr><td colspan="3" style="padding:4px 10px 4px 22px;color:${c.mut}">Sin productos agregados</td></tr>`;
      return cab + lins;
    }).join('');
    return `<div style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;padding:6px 0 4px;border-bottom:2px solid ${c.oro};margin-bottom:4px">
        <span style="font-family:'Playfair Display',serif;font-size:16px;font-weight:700;color:${c.txt}">${_rpfTitDia(dia)}</span>
        <span style="font-size:12px;color:${c.mut}">${t.pedidos} pedido${t.pedidos !== 1 ? 's' : ''} · ${t.unid} unidad${t.unid !== 1 ? 'es' : ''} · <strong style="color:${c.oro}">${pmMoney(t.monto)}</strong></span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>${th('Producto')}${th('Cant.', true)}${th('Monto', true)}</tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  }).join('');
}

function _rpfRangoTxt() {
  return _rpf.desde === _rpf.hasta ? pmFmtDate(_rpf.desde) : `${pmFmtDate(_rpf.desde)} al ${pmFmtDate(_rpf.hasta)}`;
}

function _rpfTitulo() {
  return _rpf.modo === 'toma' ? 'Pedidos por fecha del pedido' : 'Pedidos por fecha de entrega';
}

function _rpfTiposTxt() {
  return [_rpf.pan ? 'Pan' : '', _rpf.galleta ? 'Galletas' : ''].filter(Boolean).join(' y ') || 'ningún tipo';
}

// ── Pestaña «Pedidos por fecha» en Reportes ─────────────────────────────────
async function repPedidosFecha() {
  _rpfInit();
  const tipos = [];
  if (_rpf.pan) tipos.push('pan');
  if (_rpf.galleta) tipos.push('galleta');

  const res = await Promise.all(tipos.map(t => _rpfPedidosDe(t, _rpf.desde, _rpf.hasta, _rpf.modo)));
  const peds = [];
  const avisos = [];
  res.forEach(r => { peds.push(...r.peds); if (r.aviso && !avisos.includes(r.aviso)) avisos.push(r.aviso); });
  const tot = _rpfTotales(peds);
  _rpf.cache = { peds, avisos, tot };

  const rapido = (q, txt) => `<button class="btn btn-out btn-sm" onclick="rpfRapido('${q}')">${txt}</button>`;
  const chk = (k, txt) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" style="width:auto" ${_rpf[k] ? 'checked' : ''} onchange="rpfToggle('${k}',this)"> ${txt}</label>`;

  return `<div class="card" id="rep-pedfechas-inner">
    <div class="no-print">
      <div class="row" style="align-items:flex-end;gap:10px;margin-bottom:10px">
        <div class="col sm"><label>Ver por</label><select onchange="rpfModo(this.value)"><option value="entrega"${_rpf.modo === 'entrega' ? ' selected' : ''}>Fecha de entrega</option><option value="toma"${_rpf.modo === 'toma' ? ' selected' : ''}>Fecha del pedido</option></select></div>
        <div class="col sm"><label>Desde</label><input type="date" id="rpf-desde" value="${_rpf.desde}" onchange="rpfCambio()"></div>
        <div class="col sm"><label>Hasta</label><input type="date" id="rpf-hasta" value="${_rpf.hasta}" onchange="rpfCambio()"></div>
        <div class="col xs"><label>&nbsp;</label><button class="btn btn-out" onclick="rpfImprimir()">🖨 Imprimir / PDF</button></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        ${rapido('hoy', 'Hoy')}${rapido('manana', 'Mañana')}${rapido('semana', 'Próximos 7 días')}${rapido('proxima', 'Próxima semana')}
        <span style="width:10px"></span>${chk('pan', '🍞 Pan')}${chk('galleta', '🍪 Galletas')}
      </div>
      ${avisos.map(a => `<div style="font-size:12px;color:var(--red);margin-bottom:10px">⚠️ ${pmEsc(a)}</div>`).join('')}
    </div>
    <div class="rep-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:var(--cream)">📅 ${_rpfTitulo()}</div>
        <div style="font-size:12px;color:var(--cream2);margin-top:2px">${_rpfRangoTxt()} · ${_rpfTiposTxt()}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${repStatBox('Pedidos', tot.pedidos)}
        ${repStatBox('Unidades', tot.unid)}
        ${repStatBox('Monto total', pmMoney(tot.monto))}
      </div>
    </div>
    ${_rpfCuerpo(peds, _RPF_PANTALLA)}
  </div>`;
}

// ── Imprimir / guardar PDF (hoja propia, colores para papel) ────────────────
function rpfImprimir() {
  const cache = _rpf.cache;
  if (!cache) { pmToast('Primero abrí el reporte', 'err'); return; }
  const c = _RPF_IMPRESO;
  const stat = (lbl, val) => `<div style="text-align:center;border:1px solid #e0c88a;border-radius:8px;padding:8px 16px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#7a6040">${lbl}</div><div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:900;color:#8A5A12;line-height:1.1">${val}</div></div>`;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>PanMaestro — Pedidos por fecha</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;font-size:13px;color:#1a1006;padding:32px;background:#fff}
      tr{page-break-inside:avoid}
      @media print{body{padding:16px}}
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:3px solid #1a1006;margin-bottom:18px">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8A5A12">PanMaestro</div>
        <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:900">${_rpfTitulo()}</div>
        <div style="font-size:12px;color:#7a6040;margin-top:2px">${_rpfRangoTxt()} · ${_rpfTiposTxt()}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${stat('Pedidos', cache.tot.pedidos)}${stat('Unidades', cache.tot.unid)}${stat('Monto total', pmMoney(cache.tot.monto))}
      </div>
    </div>
    ${_rpfCuerpo(cache.peds, c)}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 700);
}
