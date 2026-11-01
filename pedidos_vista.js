// ═══════════════════════════════════════════════════════════════════════════
// 📅 VISTA DE PEDIDOS — Pan y Galletas (1 nov 2026)
//
// Antes: Pedidos de Pan/Galletas solo se podían consultar por la fecha en que
// se TOMÓ el pedido. Ahora hay dos formas de mirar la misma lista:
//   · Ver por CREACIÓN → pedidos tomados ese día (como siempre)
//   · Ver por ENTREGA  → pedidos que hay que entregar ese día (fecha de
//     entrega; si el pedido no tiene, cuenta su fecha de toma)
// y un filtro de ESTADO:
//   · Todos | Pendientes (ni pagado ni entregado) | Cerrados (pagado o
//     entregado) | Por cobrar (no pagado, esté entregado o no)
// más botones rápidos (hoy por creación, hoy por entrega, mañana, esta
// semana, todos los pendientes, todo lo por cobrar).
//
// Todo el módulo sirve a las dos pantallas (kind = 'pan' | 'galleta').
// pan.js/galletas.js solo delegan aquí ppCargarSb/ppRender (y pgCargarSb/
// pgRender), así que el resto del código no cambia de forma de llamarlas.
//
// La regla de "pagado / entregado / cerrado" vive en pm_core.js
// (pmEstaPagado, pmEstaEntregado, pmEstaCerrado, pmDiasAtraso).
// ═══════════════════════════════════════════════════════════════════════════

const PV_CFG = {
  pan: {
    tipo: 'pan', icono: '🍞', lsKey: 'pm_pedvista_pan',
    arr: () => G.pedidosPan,
    setArr: v => { G.pedidosPan = v; },
    ids: { fecha: 'pp-fecha', lbl: 'pp-fecha-lbl', lista: 'pp-list', badge: 'pp-tot-badge', barra: 'pp-vista-bar', entrega: 'pp-entrega' },
    bodyPrefix: 'pb-',
    card: p => ppCard(p),
    total: p => pmTotalPan(p),
    pend: () => _sbPedidoLineasPendientes,
    limpiarPend: () => { _sbPedidoLineasPendientes = []; },
    lblCreacion: 'Fecha del pedido'
  },
  galleta: {
    tipo: 'galleta', icono: '🍪', lsKey: 'pm_pedvista_galleta',
    arr: () => G.pedidosGalletas,
    setArr: v => { G.pedidosGalletas = v; },
    ids: { fecha: 'pg-fecha', lbl: 'pg-fecha-lbl', lista: 'pg-list', badge: 'pg-tot-badge', barra: 'pg-vista-bar', entrega: 'pg-entrega' },
    bodyPrefix: 'pgb-',
    card: p => pgCard(p),
    total: p => pmTotalGall(p),
    pend: () => _sbLineasPendientesGalletas,
    limpiarPend: () => { _sbLineasPendientesGalletas = []; },
    lblCreacion: 'Fecha'
  }
};

// Estado de la vista de cada pantalla (en memoria; solo "Ver por" se recuerda).
//   modo   : 'creacion' | 'entrega'
//   estado : 'todos' | 'pendientes' | 'cerrados' | 'cobrar'
//   rango  : 'dia' (la fecha del selector) | 'manana' | 'semana' | 'todas'
const _pvEstado = {
  pan:     { modo: 'creacion', estado: 'todos', rango: 'dia' },
  galleta: { modo: 'creacion', estado: 'todos', rango: 'dia' }
};
const _pvReq = { pan: 0, galleta: 0 };        // descarta respuestas que llegan tarde
const _pvCargando = { pan: false, galleta: false };

// ── Rango de fechas de la vista (null = todas las fechas) ───────────────────
function pvRango(kind) {
  const st = _pvEstado[kind], cfg = PV_CFG[kind];
  const hoy = pmHoy();
  if (st.rango === 'manana') { const d = pmSumarDias(hoy, 1); return { desde: d, hasta: d }; }
  if (st.rango === 'semana') return { desde: hoy, hasta: pmSumarDias(hoy, 6) };
  if (st.rango === 'todas')  return null;
  const el = document.getElementById(cfg.ids.fecha);
  const f = (el && el.value) || hoy;
  return { desde: f, hasta: f };
}

// Fecha que cuenta para la vista actual: la de toma o la de entrega.
function pvFechaClave(p, st) {
  return String((st.modo === 'entrega' ? pmFechaProd(p) : p.date) || '');
}

function pvEnRango(p, st, r) {
  if (!r) return true;
  const f = pvFechaClave(p, st);
  return f >= r.desde && f <= r.hasta;
}

function pvPasaEstado(p, estado) {
  switch (estado) {
    case 'pendientes': return !pmEstaCerrado(p);
    case 'cerrados':   return pmEstaCerrado(p);
    case 'cobrar':     return !pmEstaPagado(p.status);
    default:           return true;
  }
}

function pvCoincide(p, st, r) {
  return pvEnRango(p, st, r) && pvPasaEstado(p, st.estado);
}

// Lista de pedidos que muestra la vista ahora mismo (desde la caché local).
function pvLista(kind) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  const r = pvRango(kind);
  const lista = cfg.arr().filter(p => pvCoincide(p, st, r));
  // Un solo día por creación: se deja el orden de siempre (el de captura).
  // Cualquier otra vista se ordena por fecha para poder agrupar por día.
  const simple = st.modo === 'creacion' && st.rango === 'dia';
  if (!simple) lista.sort((a, b) => pvFechaClave(a, st).localeCompare(pvFechaClave(b, st)));
  return lista;
}

// ── Textos ──────────────────────────────────────────────────────────────────
const _PV_ESTADOS = [
  ['todos', 'Todos'], ['pendientes', '🟡 Pendientes'], ['cerrados', '✅ Cerrados'], ['cobrar', '💰 Por cobrar']
];

function pvEtiquetaVista(kind) {
  const st = _pvEstado[kind];
  const r = pvRango(kind);
  const que = st.modo === 'entrega' ? 'entregas' : 'pedidos tomados';
  let donde;
  if (st.rango === 'manana')      donde = `de mañana (${pmFmtDate(r.desde)})`;
  else if (st.rango === 'semana') donde = `de esta semana (${pmFmtDateShort(r.desde)} al ${pmFmtDateShort(r.hasta)})`;
  else if (st.rango === 'todas')  donde = 'de todas las fechas';
  else donde = `del ${pmFmtDate(r.desde)}`;
  const est = { todos: '', pendientes: ' · pendientes', cerrados: ' · cerrados', cobrar: ' · por cobrar' }[st.estado] || '';
  return `${que} ${donde}${est}`;
}

function pvUnidades(lista) {
  return lista.reduce((s, p) => s + (p.lineas || []).reduce((a, l) => a + (l.cant || 0), 0), 0);
}

// ── Chips visibles en cada pedido (pago / estado / atraso / fechas) ─────────
function _pvChip(txt, color, rgb, title) {
  return `<span title="${title}" style="font-size:10px;color:${color};background:rgba(${rgb},.1);border:1px solid rgba(${rgb},.25);border-radius:8px;padding:1px 7px;white-space:nowrap">${txt}</span>`;
}

function pvChips(p) {
  const pagado = pmEstaPagado(p.status);
  const cerrado = pmEstaCerrado(p);
  let h = pagado
    ? _pvChip('💰 Pagado', 'var(--green)', '22,163,74', 'Ya está pagado')
    : _pvChip('🔴 Por cobrar', 'var(--red)', '220,38,38', 'Todavía falta cobrarlo');
  h += cerrado
    ? _pvChip('✅ Cerrado', 'var(--cream2)', '120,120,120', 'Pagado o entregado')
    : _pvChip('🟡 Abierto', 'var(--gold)', '200,146,42', 'Falta pagarlo y entregarlo');
  const dias = pmDiasAtraso(p);
  if (dias > 0) h += _pvChip(`⚠️ Atrasado ${dias} d`, 'var(--red)', '220,38,38', 'La fecha de entrega ya pasó y el pedido sigue abierto');
  return h;
}

function pvChipFechas(p) {
  let h = '';
  if (p.date) h += `<span title="Fecha en que se tomó el pedido" style="font-size:11px;color:var(--cream2);background:rgba(120,120,120,.08);border:1px solid rgba(120,120,120,.2);border-radius:8px;padding:1px 7px;white-space:nowrap">📝 Tomado ${pmFmtDate(p.date)}</span>`;
  if (p.fechaEntrega) h += `<span title="Fecha de entrega" style="font-size:11px;color:var(--blue);background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.2);border-radius:8px;padding:1px 7px;white-space:nowrap">📅 Entrega ${pmFmtDate(p.fechaEntrega)}</span>`;
  return h;
}

// ── Barra de consulta + resumen ─────────────────────────────────────────────
function pvRenderBarra(kind, lista) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  const el = document.getElementById(cfg.ids.barra);
  if (!el) return;
  const hoy = pmHoy();
  const fechaEl = document.getElementById(cfg.ids.fecha);
  const f = (fechaEl && fechaEl.value) || hoy;
  const btn = (activo, onclick, txt, title) =>
    `<button class="btn btn-sm ${activo ? 'btn-gold' : 'btn-out'}" ${title ? `title="${title}"` : ''} onclick="${onclick}">${txt}</button>`;
  const lbl = t => `<span style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">${t}</span>`;

  const modos = btn(st.modo === 'creacion', `pvSetModo('${kind}','creacion')`, '📝 Creación', 'Pedidos según el día en que se tomaron')
              + btn(st.modo === 'entrega',  `pvSetModo('${kind}','entrega')`,  '🚚 Entrega',  'Pedidos según el día en que hay que entregarlos');
  const estados = _PV_ESTADOS.map(([v, t]) => btn(st.estado === v, `pvSetEstado('${kind}','${v}')`, t)).join('');
  const rapidos =
      btn(st.modo === 'creacion' && st.rango === 'dia' && f === hoy, `pvQuick('${kind}','hoy_cre')`, 'Hoy · creación')
    + btn(st.modo === 'entrega'  && st.rango === 'dia' && f === hoy, `pvQuick('${kind}','hoy_ent')`, 'Hoy · entrega')
    + btn(st.rango === 'manana', `pvQuick('${kind}','manana')`, 'Mañana')
    + btn(st.rango === 'semana', `pvQuick('${kind}','semana')`, 'Esta semana')
    + btn(st.rango === 'todas' && st.estado === 'pendientes', `pvQuick('${kind}','pend')`, '🟡 Todos los pendientes', 'Todo lo que falta pagar y entregar, de cualquier fecha')
    + btn(st.rango === 'todas' && st.estado === 'cobrar', `pvQuick('${kind}','cobrar')`, '💰 Por cobrar', 'Todo lo que falta cobrar, esté entregado o no, de cualquier fecha');

  const n = lista.length;
  const unid = pvUnidades(lista);
  const total = lista.reduce((s, p) => s + cfg.total(p), 0);
  const porCobrar = lista.filter(p => !pmEstaPagado(p.status));
  const montoCobrar = porCobrar.reduce((s, p) => s + cfg.total(p), 0);
  const atrasados = lista.filter(p => pmDiasAtraso(p) > 0).length;

  const resumen = `<div style="font-size:12px;color:var(--cream2);margin-top:10px;line-height:1.7">
      Mostrando <strong style="color:var(--cream)">${pvEtiquetaVista(kind)}</strong>
      ${_pvCargando[kind] ? '<span style="color:var(--gold)"> · ⏳ actualizando…</span>' : ''}<br>
      <strong style="color:var(--cream)">${n}</strong> pedido(s) · <strong style="color:var(--gold)">${unid}</strong> unidad(es) · total <strong style="color:var(--cream)">${pmMoney(total)}</strong>
      ${porCobrar.length ? ` · <span style="color:var(--red)">💰 por cobrar ${pmMoney(montoCobrar)} (${porCobrar.length})</span>` : ''}
      ${atrasados ? ` · <span style="color:var(--red)">⚠️ ${atrasados} atrasado(s)</span>` : ''}
    </div>`;

  el.innerHTML = `<div class="card" style="padding:12px 16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${lbl('Ver por')}${modos}<span style="width:10px"></span>${lbl('Estado')}${estados}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${lbl('Rápido')}${rapidos}</div>
      ${resumen}
    </div>`;
}

function pvActualizarEtiquetaFecha(kind) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  const lbl = document.getElementById(cfg.ids.lbl);
  if (!lbl) return;
  lbl.textContent = st.modo === 'entrega' ? 'Entregas del día' : cfg.lblCreacion;
  const inp = document.getElementById(cfg.ids.fecha);
  if (inp) inp.title = st.modo === 'entrega'
    ? 'Se muestran los pedidos que hay que entregar este día. Un pedido nuevo se crea con la fecha de hoy.'
    : 'Día en que se toma el pedido (y día que se está viendo).';
}

// Al ver entregas de un día, el campo "Entrega (opcional)" del pedido nuevo
// se rellena solo con ese día (y se vacía al salir de esa vista), salvo que
// Victor ya haya escrito otra fecha a mano.
function pvPrefillEntrega(kind) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  const el = document.getElementById(cfg.ids.entrega);
  if (!el) return;
  let auto = '';
  if (st.modo === 'entrega') {
    if (st.rango === 'dia') auto = (document.getElementById(cfg.ids.fecha).value || pmHoy());
    else if (st.rango === 'manana') auto = pmSumarDias(pmHoy(), 1);
  }
  if (auto) {
    if (!el.value || el.dataset.auto === '1') { el.value = auto; el.dataset.auto = '1'; }
  } else if (el.dataset.auto === '1') {
    el.value = ''; el.dataset.auto = '0';
  }
}

// ── Pintar la lista ─────────────────────────────────────────────────────────
function pvActualizarBadge(kind) {
  const cfg = PV_CFG[kind];
  const badge = document.getElementById(cfg.ids.badge);
  if (!badge) return;
  const u = pvUnidades(pvLista(kind));
  badge.textContent = u ? `${u} unidad(es)` : '';
}

function pvRender(kind) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  const el = document.getElementById(cfg.ids.lista);
  if (!el) return;
  const lista = pvLista(kind);
  pvActualizarBadge(kind);
  pvRenderBarra(kind, lista);
  if (!lista.length) {
    el.innerHTML = `<div class="ph"><span class="ph-icon">${cfg.icono}</span>Sin ${pvEtiquetaVista(kind)}${st.rango === 'dia' && st.estado === 'todos' && st.modo === 'creacion' ? ' — agregá uno arriba' : ''}</div>`;
    return;
  }
  const multi = st.rango !== 'dia';
  if (!multi) { el.innerHTML = lista.map(p => cfg.card(p)).join(''); return; }
  // Varios días: se agrupa con un encabezado por fecha.
  const grupos = {};
  lista.forEach(p => { (grupos[pvFechaClave(p, st)] = grupos[pvFechaClave(p, st)] || []).push(p); });
  const hoy = pmHoy();
  let html = '';
  Object.keys(grupos).sort().forEach(f => {
    const g = grupos[f];
    const pasada = st.modo === 'entrega' && f < hoy;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 2px 8px;padding-bottom:5px;border-bottom:2px solid var(--border);font-size:13px;font-weight:700;color:${pasada ? 'var(--red)' : 'var(--cream)'}">
        <span>${st.modo === 'entrega' ? '🚚' : '📝'} ${f ? pmFmtDate(f) : 'Sin fecha'}${f === hoy ? ' · hoy' : ''}${pasada ? ' · fecha pasada' : ''}</span>
        <span style="font-size:11px;font-weight:600;color:var(--cream2)">${g.length} pedido(s) · ${pvUnidades(g)} unid.</span>
      </div>`;
    html += g.map(p => cfg.card(p)).join('');
  });
  el.innerHTML = html;
}

// ── Cargar desde Supabase ───────────────────────────────────────────────────
function pvQuery(cfg, st, r) {
  let q = `*&tipo=eq.${cfg.tipo}`;
  if (r) {
    if (st.modo === 'entrega') {
      // Fecha de entrega en el rango; los que no tienen, por su fecha de toma.
      q += `&or=(and(fecha_entrega.gte.${r.desde},fecha_entrega.lte.${r.hasta}),and(fecha_entrega.is.null,fecha.gte.${r.desde},fecha.lte.${r.hasta}))`;
    } else {
      q += `&fecha=gte.${r.desde}&fecha=lte.${r.hasta}`;
    }
  } else {
    // "Todas las fechas": se filtra el estado en el servidor para no traer
    // todo el historial. Con un rango de fechas NO se filtra por estado, así
    // la caché local de ese día queda completa (la usan otros reportes).
    if (st.estado === 'cobrar') q += '&status=not.ilike.*pagado*';
    else if (st.estado === 'pendientes') q += '&status=not.ilike.*pagado*&status=not.ilike.*entregado*';
  }
  return q;
}

async function pvTraerPorId(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const rows = await pmDB.get('pedidos', {}, `*&id=in.(${ids.slice(i, i + 40).join(',')})`);
    if (rows) out.push(...rows);
  }
  return out;
}

async function pvTraerLineas(ids) {
  const porPedido = {};
  for (let i = 0; i < ids.length; i += 40) {
    try {
      const rows = await pmDB.get('pedido_lineas', {}, `*&pedido_id=in.(${ids.slice(i, i + 40).join(',')})`);
      (rows || []).forEach(l => { (porPedido[l.pedido_id] = porPedido[l.pedido_id] || []).push(l); });
    } catch (e) { console.warn('[pvTraerLineas]', e.message); }
  }
  return porPedido;
}

function pvConstruir(sb, lineasSb, local) {
  const lineas = (lineasSb || []).map(l => {
    const pid = (typeof _sbProdMapInv !== 'undefined' && _sbProdMapInv) ? (_sbProdMapInv[l.producto_id] || '') : '';
    return { lid: l.id, _sbId: l.id, pid, cant: l.cantidad || 1, inst: l.instruccion || '' };
  }).filter(l => l.pid);
  // Vínculo con el cliente: Supabase manda si lo tiene; si no, se conserva lo local.
  const cliId = sb.cliente_id || (local && local.cliId) || null;
  let cliCod = (local && local.cliCod) || null;
  let cliNom = (local && local.cliNom) || null;
  if (sb.cliente_id && (!local || sb.cliente_id !== local.cliId)) {
    const c = (typeof _sbCliCache !== 'undefined' && _sbCliCache || []).find(x => x.id === sb.cliente_id);
    if (c) { cliCod = c.codigo || cliCod; cliNom = c.nombre || cliNom; }
  }
  // Fecha de entrega: Supabase manda si la columna existe; si no, lo local.
  const fechaEntrega = ('fecha_entrega' in sb) ? (sb.fecha_entrega || '') : ((local && local.fechaEntrega) || '');
  // Se parte de lo local para no perder campos que solo viven aquí (método de pago…).
  const obj = Object.assign({}, local || {}, {
    id: (local && local.id) || pmId(),
    date: sb.fecha, cli: sb.cliente_nom, status: sb.status,
    lineas, _sbId: sb.id, cliId, cliCod, cliNom
  });
  if (fechaEntrega) obj.fechaEntrega = fechaEntrega; else delete obj.fechaEntrega;
  return obj;
}

async function pvCargar(kind) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  const req = ++_pvReq[kind];
  pvRender(kind);                       // al instante, desde lo que ya hay en el navegador
  if (!pmDB.disponible()) return;
  _pvCargando[kind] = true;
  pvRenderBarra(kind, pvLista(kind));
  try {
    // Esperar escrituras de líneas en vuelo para no pisar una línea recién agregada.
    if (cfg.pend().length) {
      await Promise.allSettled(cfg.pend());
      cfg.limpiarPend();
    }
    await _sbProdEnsureMap();
    const r = pvRango(kind);
    let rows;
    try {
      rows = await pmDB.get('pedidos', {}, pvQuery(cfg, st, r));
    } catch (e) {
      // La columna fecha_entrega todavía no existe (falta correr el SQL): se
      // trae por fecha de toma y el filtro de entrega se aplica en pantalla.
      if (st.modo === 'entrega' && /fecha_entrega/.test(e.message)) {
        rows = await pmDB.get('pedidos', {}, pvQuery(cfg, Object.assign({}, st, { modo: 'creacion' }), r));
      } else throw e;
    }
    if (req !== _pvReq[kind]) return;   // el usuario ya cambió de vista
    const sbRows = rows || [];
    const traidos = new Set(sbRows.map(s => s.id));

    // Pedidos de la caché que deberían salir en esta vista pero Supabase no
    // devolvió: o ya cambiaron (se pagaron desde otro aparato) o se borraron.
    // Se vuelven a pedir por id para dejar la caché al día.
    const sospechosos = cfg.arr().filter(p => p._sbId && !traidos.has(p._sbId) && pvCoincide(p, st, r));
    let extra = [];
    if (sospechosos.length) extra = await pvTraerPorId(sospechosos.map(p => p._sbId));
    if (req !== _pvReq[kind]) return;

    const todos = sbRows.concat(extra);
    const vivos = new Set(todos.map(s => s.id));
    const lineasPorPedido = await pvTraerLineas(todos.map(s => s.id));
    if (req !== _pvReq[kind]) return;
    if (todos.some(s => s.cliente_id) && (typeof _sbCliCache === 'undefined' || !_sbCliCache)) {
      try { await _sbCliCargar(); } catch (e) { /* sin clientes: se muestra lo que haya */ }
    }

    let arr = cfg.arr().slice();
    const borrados = new Set(sospechosos.filter(p => !vivos.has(p._sbId)));
    if (borrados.size) arr = arr.filter(p => !borrados.has(p));
    for (const sb of todos) {
      const i = arr.findIndex(p => p._sbId === sb.id);
      const nuevo = pvConstruir(sb, lineasPorPedido[sb.id], i >= 0 ? arr[i] : null);
      if (i >= 0) arr[i] = nuevo; else arr.push(nuevo);
    }
    cfg.setArr(arr);
    pmSave('pedidos');
  } catch (e) {
    console.warn('[pvCargar]', kind, e.message);
  } finally {
    if (req === _pvReq[kind]) { _pvCargando[kind] = false; pvRender(kind); }
  }
}

// ── Acciones de la barra ────────────────────────────────────────────────────
function pvSetModo(kind, modo) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  st.modo = modo;
  try { localStorage.setItem(cfg.lsKey, modo); } catch (e) { /* sin almacenamiento: no se recuerda */ }
  pvPrefillEntrega(kind);
  pvActualizarEtiquetaFecha(kind);
  pvCargar(kind);
}

function pvSetEstado(kind, estado) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  st.estado = estado;
  // "Todas las fechas" solo tiene sentido para pendientes o por cobrar.
  if (st.rango === 'todas' && estado !== 'pendientes' && estado !== 'cobrar') {
    st.rango = 'dia';
    const el = document.getElementById(cfg.ids.fecha);
    if (el && !el.value) el.value = pmHoy();
  }
  pvPrefillEntrega(kind);
  pvCargar(kind);
}

function pvQuick(kind, q) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  const fechaEl = document.getElementById(cfg.ids.fecha);
  switch (q) {
    case 'hoy_cre': st.modo = 'creacion'; st.rango = 'dia'; fechaEl.value = pmHoy(); break;
    case 'hoy_ent': st.modo = 'entrega';  st.rango = 'dia'; fechaEl.value = pmHoy(); break;
    case 'manana':  st.modo = 'entrega';  st.rango = 'manana'; break;
    case 'semana':  st.modo = 'entrega';  st.rango = 'semana'; break;
    case 'pend':    st.modo = 'entrega';  st.rango = 'todas'; st.estado = 'pendientes'; break;
    case 'cobrar':  st.modo = 'creacion'; st.rango = 'todas'; st.estado = 'cobrar'; break;
  }
  if (!fechaEl.value) fechaEl.value = pmHoy();
  pvPrefillEntrega(kind);
  pvActualizarEtiquetaFecha(kind);
  pvCargar(kind);
}

// Cambió el selector de fecha: vuelve a "un solo día".
function pvFechaCambio(kind) {
  _pvEstado[kind].rango = 'dia';
  pvPrefillEntrega(kind);
  pvCargar(kind);
}

// Al abrir la pestaña: hoy, todos los estados y el último "Ver por" usado.
function pvInit(kind) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  let modo = 'creacion';
  try { if (localStorage.getItem(cfg.lsKey) === 'entrega') modo = 'entrega'; } catch (e) { /* sin almacenamiento */ }
  st.modo = modo; st.estado = 'todos'; st.rango = 'dia';
  document.getElementById(cfg.ids.fecha).value = pmHoy();
  pvPrefillEntrega(kind);
  pvActualizarEtiquetaFecha(kind);
  pvCargar(kind);
}

// ── Pedido nuevo ────────────────────────────────────────────────────────────
// Fecha de CREACIÓN de un pedido nuevo: la del selector cuando se ve por
// creación (como siempre); si se está viendo por entrega, ese selector es el
// día de entrega, así que el pedido nuevo se crea con la fecha de hoy.
function pvFechaNuevo(kind) {
  const cfg = PV_CFG[kind], st = _pvEstado[kind];
  if (st.modo === 'entrega') return pmHoy();
  const el = document.getElementById(cfg.ids.fecha);
  return (el && el.value) || pmHoy();
}

// Si el pedido recién creado no cae dentro de la vista (por ejemplo, se está
// viendo "Cerrados"), se avisa para que no parezca que se perdió.
function pvAvisarSiOculto(kind, ped) {
  const st = _pvEstado[kind];
  if (!pvCoincide(ped, st, pvRango(kind))) {
    pmToast('ℹ️ El pedido se creó, pero queda fuera de la vista actual (cambiá "Ver por" o el estado para verlo)');
  }
}

// ── Fecha de entrega de un pedido ya creado (Galletas; Pan tiene ppSetEntrega) ─
function pvSetEntrega(kind, id, v) {
  const cfg = PV_CFG[kind];
  const p = cfg.arr().find(x => x.id === id);
  if (!p) return;
  if (v) p.fechaEntrega = v; else delete p.fechaEntrega;
  pmSave('pedidos');
  pvRender(kind);
  setTimeout(() => { const b = document.getElementById(cfg.bodyPrefix + id); if (b) b.style.display = 'block'; }, 20);
  pmToast(v ? `Entrega: ${pmFmtDate(v)} ✓` : 'Fecha de entrega quitada ✓');
  if (pmDB.disponible() && (p._sbId || p._sbCreatePromise)) {
    (async () => {
      try {
        if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(() => {});
        if (!p._sbId) throw new Error('el pedido todavía no se creó en Supabase');
        await pmDB.pedidos.editar(p._sbId, { fecha_entrega: v || null });
      } catch (e) {
        console.warn('[pmDB] pvSetEntrega error:', e.message);
        pmToast('⚠️ Fecha de entrega guardada solo local — no se sincronizó a Supabase: ' + e.message, 'err');
      }
    })();
  }
}
