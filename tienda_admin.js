// tienda_admin.js — Administración de la tienda web pública (tienda.html)
// Prefijo de función: tnd
//
// DISEÑO: módulo independiente, igual criterio que mercadeo.js.
// - Lee productos_terminados vía pmDB.productos.listar() pero NUNCA escribe ahí.
// - Escribe solo en sus tablas: tienda_productos (qué se publica) y pedidos_web
//   (bandeja de pedidos que llegan del sitio). Ver sql_tienda.sql.
// - "Enviar a PanMaestro" crea pedidos + pedido_lineas con los mismos campos
//   que usan Pan/Galletas (fecha, cliente_nom, tipo, status 'Pedido', total 0),
//   con rollback si algo falla a medias.
// - Estado propio (_tnd*), nunca toca el objeto global G ni pmSave().

const TND_ESTADOS = ['Nuevo', 'Confirmado', 'Enviado a PanMaestro', 'Cancelado'];

let _tndPed = [];          // pedidos_web, más recientes primero
let _tndFiltro = 'Nuevo';  // 'Nuevo' | 'Confirmado' | 'Enviado a PanMaestro' | 'Cancelado' | 'todos'
let _tndProds = [];        // productos_terminados activos (pan + galleta)
let _tndPub = {};          // producto_id -> fila de tienda_productos
let _tndProdListos = false;

const _tndFalta = e => /PGRST205|schema cache|does not exist|pedidos_web|tienda_productos/i.test((e && e.message) || '');
const _tndFecha = iso => {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' });
};
const _tndHora = ts => {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleString('es-CR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// ── Sub-navegación ──────────────────────────────────────────
function tndTab(tab, btn) {
  ['ped', 'prod'].forEach(t => {
    const el = document.getElementById('tndt-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#tnd-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  if (tab === 'prod' && !_tndProdListos) tndProdCargar();
}

async function tndInit() {
  await tndPedCargar();
}

// ── PEDIDOS WEB ─────────────────────────────────────────────
async function tndPedCargar() {
  const cont = document.getElementById('tnd-lista');
  if (!cont) return;
  cont.innerHTML = '<div style="color:var(--cream2);font-size:12px;padding:16px">Cargando…</div>';
  try {
    const rows = (await pmDB.get('pedidos_web', {}, '*')) || [];
    _tndPed = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    tndPedRender();
  } catch (e) {
    cont.innerHTML = _tndFalta(e)
      ? '<div class="card" style="font-size:13px">Falta crear las tablas de la tienda. Corre <b>sql_tienda.sql</b> en Supabase (SQL Editor) y vuelve a abrir esta pestaña.</div>'
      : '<div style="color:var(--red);font-size:12px">Error: ' + pmEsc(e.message) + '</div>';
  }
}

function tndFiltrar(f) { _tndFiltro = f; tndPedRender(); }

function tndPedRender() {
  const cont = document.getElementById('tnd-lista');
  const fil = document.getElementById('tnd-filtros');
  if (!cont) return;
  const cuenta = e => _tndPed.filter(p => p.estado === e).length;
  if (fil) {
    fil.innerHTML = [...TND_ESTADOS, 'todos'].map(e =>
      '<button class="pill' + (_tndFiltro === e ? ' on' : '') + '" onclick="tndFiltrar(\'' + e + '\')">' +
      (e === 'todos' ? 'Todos' : pmEsc(e)) + ' (' + (e === 'todos' ? _tndPed.length : cuenta(e)) + ')</button>').join('');
  }
  const lista = _tndPed.filter(p => _tndFiltro === 'todos' || p.estado === _tndFiltro);
  if (!lista.length) {
    cont.innerHTML = '<div class="card" style="font-size:13px;color:var(--cream2)">No hay pedidos en esta vista.</div>';
    return;
  }
  cont.innerHTML = lista.map(p => {
    const lin = (p.lineas || []).map(l =>
      '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span>' + pmEsc(l.cantidad) + ' × ' + pmEsc(l.nombre) + '</span><span>' + pmMoney(l.cantidad * l.precio) + '</span></div>').join('');
    const enviado = (p.pedido_pm_ids || []).length > 0 || p.estado === 'Enviado a PanMaestro';
    const cerrado = enviado || p.estado === 'Cancelado';
    return '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">' +
        '<div><span style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--gold3)">' + pmEsc(p.codigo) + '</span> ' +
        '<b style="font-size:14px">' + pmEsc(p.nombre) + '</b></div>' +
        '<div style="font-size:11px;color:var(--cream2)">' + _tndHora(p.created_at) + ' · <span class="badge">' + pmEsc(p.estado) + '</span></div>' +
      '</div>' +
      '<div style="font-size:12px;margin:6px 0;color:var(--cream2)">📞 ' + pmEsc(p.telefono) +
        (p.fecha_entrega ? ' · 📅 entrega preferida: <b>' + pmEsc(_tndFecha(p.fecha_entrega)) + '</b>' : ' · 📅 sin fecha preferida') + '</div>' +
      (p.direccion ? '<div style="font-size:12px;margin-bottom:4px">📍 ' + pmEsc(p.direccion) + '</div>' : '') +
      (p.notas ? '<div style="font-size:12px;margin-bottom:4px">📝 ' + pmEsc(p.notas) + '</div>' : '') +
      '<div style="border-top:1px solid #E1E8DD;margin-top:6px;padding-top:6px">' + lin +
        '<div style="display:flex;justify-content:space-between;font-weight:600;font-size:13px;padding-top:4px"><span>Subtotal (sin envío)</span><span>' + pmMoney(p.total) + '</span></div></div>' +
      '<div style="margin-top:8px"><input type="text" placeholder="Notas internas (envío cotizado, pago…)" value="' + pmEsc(p.notas_internas || '') + '" onchange="tndNotasInternas(\'' + p.id + '\',this.value)" style="width:100%;font-size:12px"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
        '<button class="btn btn-out btn-sm" onclick="tndWhatsApp(\'' + p.id + '\')">💬 WhatsApp al cliente</button>' +
        (p.estado === 'Nuevo' ? '<button class="btn btn-out btn-sm" onclick="tndEstado(\'' + p.id + '\',\'Confirmado\')">✔ Marcar confirmado</button>' : '') +
        (!cerrado ? '<button class="btn btn-gold btn-sm" onclick="tndEnviarPM(\'' + p.id + '\')">📤 Enviar a PanMaestro</button>' : '') +
        (!cerrado ? '<button class="btn btn-red btn-sm" onclick="tndEstado(\'' + p.id + '\',\'Cancelado\')">✕ Cancelar</button>' : '') +
        (p.estado === 'Cancelado' ? '<button class="btn btn-out btn-sm" onclick="tndEstado(\'' + p.id + '\',\'Nuevo\')">↩ Reabrir</button>' : '') +
      '</div></div>';
  }).join('');
}

async function tndEstado(id, estado) {
  try {
    await pmDB.update('pedidos_web', id, { estado, updated_at: new Date().toISOString() });
    const p = _tndPed.find(x => x.id === id); if (p) p.estado = estado;
    tndPedRender();
    pmToast('Pedido ' + estado.toLowerCase() + ' ✓');
  } catch (e) { pmToast('No se pudo actualizar: ' + e.message, 'err'); }
}

async function tndNotasInternas(id, valor) {
  try {
    await pmDB.update('pedidos_web', id, { notas_internas: valor.trim() || null, updated_at: new Date().toISOString() });
    const p = _tndPed.find(x => x.id === id); if (p) p.notas_internas = valor.trim() || null;
  } catch (e) { pmToast('No se pudo guardar la nota: ' + e.message, 'err'); }
}

function tndWhatsApp(id) {
  const p = _tndPed.find(x => x.id === id); if (!p) return;
  let tel = String(p.telefono || '').replace(/\D/g, '');
  if (tel.length === 8) tel = '506' + tel;
  const lin = (p.lineas || []).map(l => l.cantidad + ' × ' + l.nombre).join('\n');
  const msg = 'Hola ' + p.nombre + ', te escribimos de PanMaestro. Recibimos tu pedido ' + p.codigo + ':\n' + lin +
    '\nSubtotal: ' + pmMoney(p.total) +
    '\nEnvío' + (p.direccion ? ' a ' + p.direccion : '') + ': ₡[costo de envío]' +
    '\nEntrega: ' + (p.fecha_entrega ? _tndFecha(p.fecha_entrega) : '[fecha]') +
    '\nPago por SINPE Móvil al [número]. ¿Te parece bien?';
  window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}

// Crea el pedido real (pedidos + pedido_lineas) con rollback si algo falla a medias.
async function tndEnviarPM(id) {
  const p = _tndPed.find(x => x.id === id); if (!p) return;
  if ((p.pedido_pm_ids || []).length || p.estado === 'Enviado a PanMaestro') { pmToast('Este pedido ya fue enviado', 'err'); return; }
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase', 'err'); return; }
  if (!confirm('¿Enviar el pedido ' + p.codigo + ' de ' + p.nombre + ' a PanMaestro?\n\nSe creará como pedido de ' +
      (p.fecha_entrega ? 'entrega el ' + _tndFecha(p.fecha_entrega) : 'hoy (sin fecha de entrega)') + '.')) return;

  const grupos = {};
  (p.lineas || []).forEach(l => { const t = l.tipo === 'galleta' ? 'galleta' : 'pan'; (grupos[t] = grupos[t] || []).push(l); });
  const pedCreados = [], linCreadas = [];
  try {
    let primera = true;
    for (const t of Object.keys(grupos)) {
      const datos = { fecha: pmHoy(), cliente_nom: p.nombre, tipo: t, status: 'Pedido', total: 0 };
      if (p.fecha_entrega) datos.fecha_entrega = p.fecha_entrega;
      const rows = await pmDB.pedidos.crear(datos);
      const ped = rows && rows[0];
      if (!ped) throw new Error('no se creó el pedido');
      pedCreados.push(ped.id);
      for (const l of grupos[t]) {
        const r = await pmDB.pedidos.lineas.agregar({
          pedido_id: ped.id, producto_id: l.producto_id, cantidad: l.cantidad, precio_applied: l.precio,
          instruccion: (primera && p.notas) ? ('Nota web: ' + p.notas).slice(0, 200) : null
        });
        primera = false;
        if (r && r[0]) linCreadas.push(r[0].id);
      }
    }
    await pmDB.update('pedidos_web', id, { estado: 'Enviado a PanMaestro', pedido_pm_ids: pedCreados, updated_at: new Date().toISOString() });
    p.estado = 'Enviado a PanMaestro'; p.pedido_pm_ids = pedCreados;
    tndPedRender();
    pmToast('📤 Pedido de ' + p.nombre + ' enviado a PanMaestro ✓');
  } catch (e) {
    try { await pmDB.hardDeleteMany('pedido_lineas', linCreadas); await pmDB.hardDeleteMany('pedidos', pedCreados); } catch (x) { /* mejor esfuerzo */ }
    pmToast('No se pudo enviar (no quedó nada a medias): ' + e.message, 'err', 5000);
  }
}

// ── PRODUCTOS PUBLICADOS ────────────────────────────────────
async function tndProdCargar() {
  const cont = document.getElementById('tnd-prods');
  if (!cont) return;
  cont.innerHTML = '<div style="color:var(--cream2);font-size:12px;padding:16px">Cargando…</div>';
  try {
    const [prods, pub] = await Promise.all([pmDB.productos.listar(), pmDB.get('tienda_productos', {}, '*')]);
    _tndProds = pmOrdenar((prods || []).filter(p => p.tipo === 'pan' || p.tipo === 'galleta'), 'nombre');
    _tndPub = {}; (pub || []).forEach(r => { _tndPub[r.producto_id] = r; });
    _tndProdListos = true;
    tndProdRender();
  } catch (e) {
    cont.innerHTML = _tndFalta(e)
      ? '<div class="card" style="font-size:13px">Falta crear las tablas de la tienda. Corre <b>sql_tienda.sql</b> en Supabase (SQL Editor).</div>'
      : '<div style="color:var(--red);font-size:12px">Error: ' + pmEsc(e.message) + '</div>';
  }
}

function tndProdRender() {
  const cont = document.getElementById('tnd-prods');
  if (!cont) return;
  const n = Object.values(_tndPub).filter(r => r.publicar).length;
  const cnt = document.getElementById('tnd-prod-count');
  if (cnt) cnt.textContent = n + ' de ' + _tndProds.length + ' productos publicados';
  cont.innerHTML = _tndProds.map(p => {
    const r = _tndPub[p.id] || {};
    return '<div class="card" style="padding:10px 12px">' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">' +
        '<div style="min-width:180px"><b style="font-size:13px">' + pmEsc(p.nombre) + '</b> ' +
          '<span style="font-size:11px;color:var(--cream2)">' + pmEsc(p.codigo) + ' · ' + (p.peso_g ? pmEsc(p.peso_g) + ' g · ' : '') + pmMoney(p.precio_full) + '</span></div>' +
        '<div style="display:flex;gap:14px;align-items:center;font-size:12px">' +
          '<label style="display:flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" ' + (r.publicar ? 'checked' : '') + ' onchange="tndProdGuardar(\'' + p.id + '\',\'publicar\',this.checked)"> Publicar</label>' +
          '<label style="display:flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" ' + (r.proximamente ? 'checked' : '') + ' onchange="tndProdGuardar(\'' + p.id + '\',\'proximamente\',this.checked)"> Próximamente</label>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:6px">' +
        '<input type="text" placeholder="Descripción corta para el sitio (opcional)" maxlength="140" value="' + pmEsc(r.descripcion || '') + '" onchange="tndProdGuardar(\'' + p.id + '\',\'descripcion\',this.value)" style="flex:1;font-size:12px">' +
        '<input type="number" placeholder="Orden" value="' + (r.orden != null ? pmEsc(r.orden) : '') + '" onchange="tndProdGuardar(\'' + p.id + '\',\'orden\',this.value)" style="width:70px;font-size:12px" title="Orden en el sitio (menor = primero)">' +
      '</div></div>';
  }).join('') || '<div class="card" style="font-size:13px;color:var(--cream2)">No hay productos activos.</div>';
}

async function tndProdGuardar(id, campo, valor) {
  const ant = _tndPub[id] || { producto_id: id, publicar: false, proximamente: false, descripcion: null, orden: 100 };
  const fila = Object.assign({}, ant, { producto_id: id, updated_at: new Date().toISOString() });
  if (campo === 'orden') fila.orden = valor === '' ? 100 : Math.round(Number(valor)) || 100;
  else if (campo === 'descripcion') fila.descripcion = String(valor).trim() || null;
  else fila[campo] = !!valor;
  try {
    await pmDB.upsert('tienda_productos', fila);
    _tndPub[id] = fila;
    const cnt = document.getElementById('tnd-prod-count');
    if (cnt) cnt.textContent = Object.values(_tndPub).filter(r => r.publicar).length + ' de ' + _tndProds.length + ' productos publicados';
    pmToast('Guardado ✓', 'ok', 1200);
  } catch (e) {
    pmToast('No se pudo guardar: ' + e.message, 'err');
    tndProdRender();
  }
}
