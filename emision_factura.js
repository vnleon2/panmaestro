// ═══════════════════════════════════════════════════════════════════════════
// 🧾 EMISIÓN DE FACTURA (11 nov 2026)
//
// Un solo reporte, igual para Comercial, Pan y Galleta (antes solo existía para
// Comerciales, en «Documentos» y en el reporte Comercial por día):
//   1. Se elige el RANGO de fechas de creación del pedido y el TIPO de pedido.
//   2. Salen los pedidos completos (cliente, productos, estado, monto).
//   3. Se escoge UN pedido: se ve completo con tres botones —
//      🧾 Factura · 📋 Nota de entrega · 📄 Ambas.
//   4. El documento se arma y se muestra en una ventana aparte; desde allí se
//      imprime (no se imprime solo).
//
// Reglas:
//   · Los pedidos se traen directo de Supabase (no solo de lo que haya en el
//     navegador) y se mezclan en la caché local igual que la pantalla de
//     Pedidos (pvConstruir). Sin conexión se muestra lo guardado en el navegador.
//   · La factura lleva número correlativo (FAC-…) que se asigna UNA sola vez por
//     pedido y se guarda en pedidos.numero_factura; reimprimir da el mismo número.
//   · El monto es el total a cobrar: productos + envío + IVA (pm_core.js).
//   · La nota de entrega no lleva precios.
//
// Se engancha en reportes.js con la pestaña 'emision' (repTab / repRender).
// Usa: PV_CFG, pvConstruir, pvTraerLineas (pedidos_vista.js), _sbProdEnsureMap,
// _corrSiguiente, _corrFmt (comercial.js), y los helpers de pm_core.js.
// ═══════════════════════════════════════════════════════════════════════════

const _em = { desde: '', hasta: '', kind: 'com', lista: [], sel: null, buscado: false, cargando: false, aviso: '' };

const _EM_TIPOS = [['com', '🏪 Comercial'], ['pan', '🍞 Pan'], ['galleta', '🍪 Galleta']];
const _EM_TIPO_TXT = { com: 'Comercial', pan: 'Pan', galleta: 'Galleta' };

function _emNombre(kind, pid) {
  if (kind === 'pan') return pmNombrePan(pid);
  if (kind === 'galleta') return pmNombreGall(pid);
  return (pmGetPan(pid) && pmGetPan(pid).nombre) || (pmGetGall(pid) && pmGetGall(pid).nombre) || pid || '(producto)';
}

// Precio unitario con el que se cobra la línea (mismo criterio que el total del pedido).
function _emPrecio(kind, l) {
  if (kind === 'pan') return pmPrecioPan(l.pid);
  if (kind === 'galleta') return pmPrecioGall(l.pid);
  if (l.precio != null) return l.precio;
  return pmPrecioPan(l.pid) * (1 - (l.desc || 0) / 100);
}

function _emSel() {
  if (_em.sel == null) return null;
  return PV_CFG[_em.kind].arr().find(p => String(p.id) === String(_em.sel)) || null;
}

// ── Carga de pedidos del rango ──────────────────────────────────────────────
async function _emCargar() {
  const cfg = PV_CFG[_em.kind];
  _em.cargando = true; _em.aviso = '';
  try {
    if (pmDB.disponible()) {
      try {
        await _sbProdEnsureMap();
        const rows = await pmDB.get('pedidos', {}, `*&tipo=eq.${cfg.tipo}&fecha=gte.${_em.desde}&fecha=lte.${_em.hasta}`);
        const sbRows = rows || [];
        const lineasPorPedido = await pvTraerLineas(sbRows.map(s => s.id));
        if (sbRows.some(s => s.cliente_id) && (typeof _sbCliCache === 'undefined' || !_sbCliCache)) {
          try { await _sbCliCargar(); } catch (e) { /* sin clientes: se muestra lo que haya */ }
        }
        const arr = cfg.arr().slice();
        for (const sb of sbRows) {
          const i = arr.findIndex(p => p._sbId === sb.id);
          const nuevo = pvConstruir(sb, lineasPorPedido[sb.id], i >= 0 ? arr[i] : null, cfg);
          if (i >= 0) arr[i] = nuevo; else arr.push(nuevo);
        }
        cfg.setArr(arr);
        pmSave(cfg.saveKey || 'pedidos');
      } catch (e) {
        console.warn('[emision] carga:', e.message);
        _em.aviso = 'No se pudo consultar Supabase (' + e.message + '). Se muestra lo guardado en este navegador.';
      }
    } else {
      _em.aviso = 'Sin conexión: se muestra lo guardado en este navegador.';
    }
    _em.lista = cfg.arr()
      .filter(p => p.date && p.date >= _em.desde && p.date <= _em.hasta)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.numPed || '').localeCompare(String(b.numPed || '')));
    if (_em.sel != null && !_em.lista.some(p => String(p.id) === String(_em.sel))) _em.sel = null;
    _em.buscado = true;
  } finally {
    _em.cargando = false;
  }
}

// Botón Buscar / cambio de rango o tipo.
async function emBuscar() {
  const d = document.getElementById('em-desde'), h = document.getElementById('em-hasta'), t = document.getElementById('em-tipo');
  if (d && d.value) _em.desde = d.value;
  if (h && h.value) _em.hasta = h.value;
  if (t && t.value && t.value !== _em.kind) { _em.kind = t.value; _em.sel = null; }
  if (_em.desde > _em.hasta) { const x = _em.desde; _em.desde = _em.hasta; _em.hasta = x; }
  await _emCargar();
  repRender();
}

function emSeleccionar(id) {
  _em.sel = (String(_em.sel) === String(id)) ? null : id;
  repRender();
  if (_em.sel != null) setTimeout(() => { const el = document.getElementById('em-detalle'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
}

// ── Pantalla ────────────────────────────────────────────────────────────────
function _emDetalleHtml(p) {
  const kind = _em.kind, cfg = PV_CFG[kind];
  const sub = cfg.subtotal(p), envio = pmEnvioCom(p), iva = pmIvaDesde(sub, envio), tot = cfg.total(p);
  const lineas = (p.lineas || []).map(l => {
    const pr = _emPrecio(kind, l), cant = l.cant || 1;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px">${pmEsc(_emNombre(kind, l.pid))}${l.inst ? ` <span style="font-size:11px;color:var(--blue)">📌 ${pmEsc(l.inst)}</span>` : ''}</td>
      <td style="padding:6px 8px;text-align:center;font-family:'DM Mono',monospace;font-weight:700">${cant}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace">${pmMoney(pr)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;font-weight:700">${pmMoney(pr * cant)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" style="padding:12px 8px;color:var(--cream2)">El pedido no tiene productos</td></tr>`;
  const fila = (t, v, fuerte) => `<tr><td colspan="3" style="padding:5px 8px;text-align:right;${fuerte ? 'font-weight:700' : 'color:var(--cream2)'}">${t}</td><td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;${fuerte ? 'font-weight:900;color:var(--gold);font-size:15px' : ''}">${pmMoney(v)}</td></tr>`;
  const dato = (t, v) => v ? `<div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--cream2)">${t}</div><div style="font-size:13px;font-weight:600">${v}</div></div>` : '';
  const sinLineas = !(p.lineas || []).length;
  const btn = (modo, cls, txt) => `<button class="btn ${cls}" onclick="emDoc('${modo}')"${sinLineas ? ' disabled title="El pedido no tiene productos"' : ''} style="padding:10px 16px">${txt}</button>`;
  return `<div id="em-detalle" class="card" style="border:2px solid var(--gold);margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:var(--cream)">${pmEsc(p.cliNom || p.cli || '(sin cliente)')}</div>
        <div style="font-size:11px;color:var(--cream2);margin-top:2px">${_EM_TIPO_TXT[kind]} · ${p.numPed ? pmEsc(p.numPed) : 'sin número'}${p.numFac ? ' · 🧾 ' + pmEsc(p.numFac) : ''}</div>
      </div>
      <button class="btn btn-out btn-sm" onclick="emSeleccionar('${p.id}')">✕ Cerrar</button>
    </div>
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px">
      ${dato('Creado', pmFmtDate(p.date))}${dato('Entrega', p.fechaEntrega ? pmFmtDate(p.fechaEntrega) : '')}${dato('Estado', pmBadge(p.status))}${dato('Pago', p.metodoPago ? pmEsc(p.metodoPago) : '')}${dato('Envío', p.envioNota ? pmEsc(p.envioNota) : '')}
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase">Producto</th>
        <th style="padding:6px 8px;text-align:center;font-size:10px;text-transform:uppercase">Cant.</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase">Precio unit.</th>
        <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase">Subtotal</th>
      </tr></thead>
      <tbody>${lineas}
        ${(envio || iva) ? fila('Productos', sub) : ''}${envio ? fila('Envío', envio) : ''}${iva ? fila('IVA ' + pmIvaPct() + '%', iva) : ''}
        ${fila('Total a cobrar', tot, true)}
      </tbody></table></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center">
      ${btn('factura', 'btn-gold', '🧾 Factura')}
      ${btn('nota', 'btn-out', '📋 Nota de entrega')}
      ${btn('ambas', 'btn-out', '📄 Ambas')}
      <span style="font-size:11px;color:var(--cream2)">Se muestra el documento en otra ventana y desde allí lo imprimís.</span>
    </div>
  </div>`;
}

async function emisionRender() {
  const hoy = pmHoy();
  if (!_em.desde) { _em.desde = hoy; _em.hasta = hoy; }
  if (!_em.buscado && !_em.cargando) await _emCargar();
  const kind = _em.kind, cfg = PV_CFG[kind];
  const lista = _em.lista;
  const total = lista.reduce((s, p) => s + cfg.total(p), 0);
  const inp = 'padding:7px 10px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px';
  const lbl = t => `<label style="font-size:11px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;color:var(--cream2);display:block;margin-bottom:4px">${t}</label>`;
  const tipos = _EM_TIPOS.map(([v, t]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${t}</option>`).join('');

  const filas = lista.map(p => {
    const prods = (p.lineas || []).map(l => `${pmEsc(_emNombre(kind, l.pid))} ×${l.cant || 1}`).join(' · ') || '<span style="color:var(--cream2)">sin productos</span>';
    const activo = String(_em.sel) === String(p.id);
    return `<div onclick="emSeleccionar('${p.id}')" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;${activo ? 'background:rgba(200,146,42,.12)' : ''}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-weight:700;font-size:14px">${pmEsc(p.cliNom || p.cli || '(sin cliente)')}</span>
          ${pmBadge(p.status)}
          ${p.numFac ? `<span style="font-size:10px;color:var(--green);border:1px solid rgba(22,163,74,.3);border-radius:8px;padding:1px 7px">🧾 ${pmEsc(p.numFac)}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--cream2);margin-top:3px">${pmFmtDate(p.date)}${p.fechaEntrega ? ' → 📅 ' + pmFmtDate(p.fechaEntrega) : ''} · ${p.numPed ? pmEsc(p.numPed) : 'sin número'}</div>
        <div style="font-size:12px;margin-top:3px;line-height:1.4">${prods}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:'DM Mono',monospace;font-weight:900;color:var(--gold)">${pmMoney(cfg.total(p))}</div>
        <div style="font-size:11px;color:${activo ? 'var(--gold)' : 'var(--cream2)'};margin-top:3px">${activo ? '▼ Seleccionado' : 'Seleccionar ›'}</div>
      </div>
    </div>`;
  }).join('');

  const sel = _emSel();
  return `<div class="card" style="margin-bottom:16px">
      <div class="ctitle" style="margin-bottom:2px">🧾 Emisión de factura</div>
      <div style="font-size:11px;color:var(--cream2);margin-bottom:12px">Elegí el rango de fechas de creación y el tipo de pedido; después escogé el pedido para emitir factura, nota de entrega o ambas.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div>${lbl('Desde')}<input type="date" id="em-desde" value="${_em.desde}" onchange="emBuscar()" style="${inp}"></div>
        <div>${lbl('Hasta')}<input type="date" id="em-hasta" value="${_em.hasta}" onchange="emBuscar()" style="${inp}"></div>
        <div>${lbl('Tipo de pedido')}<select id="em-tipo" onchange="emBuscar()" style="${inp}">${tipos}</select></div>
        <button class="btn btn-gold btn-sm" onclick="emBuscar()" style="padding:9px 16px">🔍 Buscar</button>
      </div>
      ${_em.aviso ? `<div style="margin-top:10px;font-size:12px;color:var(--amber)">⚠️ ${pmEsc(_em.aviso)}</div>` : ''}
    </div>
    ${sel ? _emDetalleHtml(sel) : ''}
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:12px;color:var(--cream2)">${_EM_TIPO_TXT[kind]} · creados del <strong style="color:var(--cream)">${pmFmtDate(_em.desde)}</strong> al <strong style="color:var(--cream)">${pmFmtDate(_em.hasta)}</strong></div>
        <div style="display:flex;gap:8px">${repStatBox('Pedidos', lista.length)}${repStatBox('Total', pmMoney(total))}</div>
      </div>
      ${lista.length ? filas : `<div class="ph" style="padding:24px"><span class="ph-icon">🧾</span>Sin pedidos ${_EM_TIPO_TXT[kind].toLowerCase()} en ese rango</div>`}
    </div>`;
}

// ── Documentos ──────────────────────────────────────────────────────────────
// Asigna el número de factura (una sola vez por pedido) y lo guarda.
async function _emAsegurarFactura(p) {
  if (p.numFac) return true;
  const n = await _corrSiguiente('factura');
  if (!n) { pmToast('Sin conexión: no se puede asignar el número de factura. Probá de nuevo con internet.', 'err'); return false; }
  p.numFac = _corrFmt(n, 'FAC-');
  pmSave(PV_CFG[_em.kind].saveKey || 'pedidos');
  pmSave('sistema');
  if (p._sbId && pmDB.disponible()) {
    try { await pmDB.update('pedidos', p._sbId, { numero_factura: p.numFac }); }
    catch (e) { console.warn('[emision] no se pudo guardar numero_factura en Supabase:', e.message); pmToast('⚠️ La factura quedó numerada solo en este navegador: ' + e.message, 'err'); }
  }
  return true;
}

function _emPagina(p, kind, tipo) {
  const cfg = PV_CFG[kind];
  const esFactura = tipo === 'factura';
  const docNum = esFactura ? (p.numFac || 'FAC-???????') : (p.numPed || ('NE-' + String(p.id).slice(-6).padStart(6, '0')));
  const num = v => '₡' + Number(v || 0).toLocaleString('es-CR');
  const filas = (p.lineas || []).map(l => {
    const cant = l.cant || 1, pr = _emPrecio(kind, l);
    return esFactura
      ? `<tr><td>${pmEsc(_emNombre(kind, l.pid))}</td><td class="r">${cant}</td><td class="r">${num(pr)}</td><td class="r">${num(pr * cant)}</td></tr>`
      : `<tr><td>${pmEsc(_emNombre(kind, l.pid))}${l.inst ? ` <span style="color:#666;font-size:11px">— ${pmEsc(l.inst)}</span>` : ''}</td><td class="r">${cant}</td></tr>`;
  }).join('');
  let pie = '';
  if (esFactura) {
    const sub = cfg.subtotal(p), envio = pmEnvioCom(p), iva = pmIvaDesde(sub, envio);
    const fila = (t, v) => `<tr><td colspan="3">${t}</td><td class="r">${num(v)}</td></tr>`;
    pie = ((envio || iva) ? fila('Subtotal productos', sub) : '')
      + (envio ? fila('Envío' + (p.envioNota ? ' (' + pmEsc(p.envioNota) + ')' : ''), envio) : '')
      + (iva ? fila('IVA ' + pmIvaPct() + '%', iva) : '')
      + `<tr class="total-row"><td colspan="3">Total</td><td class="r">${num(cfg.total(p))}</td></tr>`;
  }
  const meta = (t, v) => v ? `<div class="meta-item"><label>${t}</label><div class="val">${v}</div></div>` : '';
  return `<div class="page">
    <div class="header">
      <div><div class="brand">PanMaestro</div><div class="brand-sub">Panadería artesanal</div></div>
      <div><div class="doc-label">${esFactura ? 'Factura' : 'Nota de entrega'}</div><div class="doc-num">#${pmEsc(docNum)}</div></div>
    </div>
    <div class="meta">
      ${meta('Cliente', pmEsc(p.cliNom || p.cli || ''))}${meta('Fecha', pmFmtDate(p.date))}${meta('Entrega', p.fechaEntrega ? pmFmtDate(p.fechaEntrega) : '')}${meta('Estado', pmEsc(p.status || ''))}${meta('N° Pedido', esFactura && p.numPed ? pmEsc(p.numPed) : '')}
    </div>
    <table>
      <thead><tr><th>Producto</th><th class="r">Cantidad</th>${esFactura ? '<th class="r">Precio unit.</th><th class="r">Subtotal</th>' : ''}</tr></thead>
      <tbody>${filas}${pie}</tbody>
    </table>
    ${esFactura ? '' : '<div class="firma"><div>Recibido por: ______________________________</div><div>Fecha: ____ / ____ / ________</div></div>'}
    <div class="footer">PanMaestro · ${esFactura ? 'Factura' : 'Nota de entrega'} #${pmEsc(docNum)}</div>
  </div>`;
}

const _EM_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#fff}
  .bar{position:sticky;top:0;background:#1a1a1a;padding:10px 16px;display:flex;gap:10px;justify-content:center}
  .bar button{padding:8px 18px;font-size:14px;font-weight:600;border:none;border-radius:6px;cursor:pointer}
  .bar .p{background:#c8922a;color:#fff}.bar .c{background:#eee;color:#222}
  .page{width:100%;max-width:720px;margin:0 auto;padding:32px 36px;page-break-after:always}
  .page:last-of-type{page-break-after:auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #1a1a1a;margin-bottom:24px}
  .brand{font-size:22px;font-weight:900;letter-spacing:-.5px}
  .brand-sub{font-size:10px;color:#777;margin-top:4px;text-transform:uppercase;letter-spacing:1.2px}
  .doc-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#777;text-align:right}
  .doc-num{font-size:20px;font-weight:900;text-align:right;margin-top:4px}
  .meta{display:flex;gap:28px;margin-bottom:24px;flex-wrap:wrap}
  .meta-item label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#888;display:block;margin-bottom:3px}
  .meta-item .val{font-size:14px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  thead tr{border-bottom:2px solid #1a1a1a}
  th{padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#444;font-weight:700}
  th.r,td.r{text-align:right}
  td{padding:9px 10px;border-bottom:1px solid #e8e8e8;vertical-align:middle}
  td.r{font-weight:600}
  .total-row td{padding-top:12px;font-weight:700;font-size:15px;border-bottom:none;border-top:2px solid #1a1a1a}
  .firma{display:flex;justify-content:space-between;gap:24px;margin-top:48px;font-size:12px;color:#444}
  .footer{margin-top:28px;padding-top:14px;border-top:1px solid #ddd;font-size:10px;color:#aaa;text-align:center}
  @media print{.bar{display:none}.page{padding:28px 32px}}
`;

// modo: 'factura' | 'nota' | 'ambas'
async function emDoc(modo) {
  const p = _emSel();
  if (!p) { pmToast('Seleccioná un pedido', 'err'); return; }
  if (!(p.lineas || []).length) { pmToast('El pedido no tiene productos', 'err'); return; }
  // La ventana se abre YA (dentro del clic) para que el navegador no la bloquee;
  // el número de factura puede tardar un momento en llegar.
  const win = window.open('', '_blank');
  if (!win) { pmToast('El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio', 'err'); return; }
  win.document.write('<p style="font-family:sans-serif;padding:24px">Generando documento…</p>');
  try {
    if (modo !== 'nota') {
      const ok = await _emAsegurarFactura(p);
      if (!ok) { win.close(); return; }
    }
    const tipos = modo === 'ambas' ? ['factura', 'nota'] : [modo];
    const paginas = tipos.map(t => _emPagina(p, _em.kind, t)).join('');
    const titulo = modo === 'factura' ? 'Factura' : modo === 'nota' ? 'Nota de entrega' : 'Factura y nota de entrega';
    win.document.open();
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titulo} — ${pmEsc(p.cliNom || p.cli || '')}</title><style>${_EM_CSS}</style></head><body>
      <div class="bar"><button class="p" onclick="window.print()">🖨 Imprimir</button><button class="c" onclick="window.close()">Cerrar</button></div>
      ${paginas}</body></html>`);
    win.document.close();
    repRender();           // para que se vea el número de factura recién asignado
  } catch (e) {
    console.warn('[emision] doc:', e.message);
    try { win.close(); } catch (x) { /* ya cerrada */ }
    pmToast('No se pudo armar el documento: ' + e.message, 'err');
  }
}
