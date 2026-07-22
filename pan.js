// ── 📋 PAN ──────────────────────────────────────────
function ppInstOpts(selected='') {
  return '<option value="">— ninguna —</option>' +
    G.instrucciones.map(i=>`<option value="${i}"${i===selected?' selected':''}>${i}</option>`).join('');
}

// ── Resumen del día — totales por tipo de pan ──
function ppVerResumen() {
  const fecha  = document.getElementById('pp-fecha').value || pmHoy();
  const peds   = G.pedidosPan.filter(p => p.date === fecha);
  const vistaEl = document.getElementById('pp-vista-extra');

  if (!peds.length) {
    vistaEl.style.display = 'block';
    vistaEl.innerHTML = `<div class="card">
      <button class="btn btn-out btn-sm" onclick="ppCerrarVista()" style="margin-bottom:12px">← Volver a Pedidos</button>
      <div class="ph"><span class="ph-icon">📋</span>Sin pedidos para este día</div>
    </div>`;
    return;
  }

  // Agrupar por tipo de pan
  const totPorPan = {};
  peds.forEach(p => {
    (p.lineas||[]).forEach(l => {
      if (!totPorPan[l.pid]) totPorPan[l.pid] = { nombre: pmNombrePan(l.pid), cant: 0, clientes: [] };
      totPorPan[l.pid].cant += l.cant;
      totPorPan[l.pid].clientes.push(p.cli);
    });
  });

  const totalUnid = Object.values(totPorPan).reduce((s,v) => s + v.cant, 0);

  const rows = Object.entries(totPorPan)
    .sort((a,b) => b[1].cant - a[1].cant)
    .map(([pid, v]) => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:9px 10px;font-weight:600">${v.nombre}</td>
        <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700;font-size:16px;color:var(--gold)">${v.cant}</td>
        <td style="padding:9px 10px;font-size:11px;color:var(--cream2)">${[...new Set(v.clientes)].join(', ')}</td>
      </tr>`).join('');

  vistaEl.style.display = 'block';
  vistaEl.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <button class="btn btn-out btn-sm" onclick="ppCerrarVista()">← Volver a Pedidos</button>
      </div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:var(--cream)">📋 Resumen del día</div>
      <div style="font-size:12px;color:var(--cream2)">${pmFmtDate(fecha)} · ${peds.length} cliente(s) · ${totalUnid} unidades</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Tipo de pan</th>
        <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Total unidades</th>
        <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Clientes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:2px solid var(--border)">
        <td style="padding:9px 10px;font-weight:700">TOTAL</td>
        <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:900;font-size:18px;color:var(--gold)">${totalUnid}</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>`;
  vistaEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── Sincronizar pedidos locales sin _sbId a Supabase ──
async function pedSincronizarToSb() {
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase','err'); return; }
  await _sbProdEnsureMap();
  const todos = [
    ...G.pedidosPan.filter(p => !p._sbId).map(p => ({...p, tipo:'pan'})),
    ...G.pedidosGalletas.filter(p => !p._sbId).map(p => ({...p, tipo:'galleta'}))
  ];
  if (!todos.length) { pmToast('Todos los pedidos ya están en Supabase ✓'); return; }
  pmToast(`Sincronizando ${todos.length} pedido(s)...`);
  let ok = 0, err = 0;
  for (const ped of todos) {
    try {
      const rows = await pmDB.pedidos.crear({ fecha:ped.date, cliente_nom:ped.cli, tipo:ped.tipo, status:ped.status, total:0 });
      if (rows?.[0]) {
        const sbId = rows[0].id;
        // Buscar y actualizar el objeto local
        const local = ped.tipo === 'pan'
          ? G.pedidosPan.find(p => p.id === ped.id)
          : G.pedidosGalletas.find(p => p.id === ped.id);
        if (local) local._sbId = sbId;
        // Sync líneas
        for (const l of ped.lineas||[]) {
          const prodUuid = _sbProdMap?.[l.pid];
          const precio = (ped.tipo==='pan' ? G.tiposPan : G.tiposGalleta).find(x=>x.id===l.pid)?.precio || 0;
          if (prodUuid) {
            await pmDB.pedidos.lineas.agregar({ pedido_id:sbId, producto_id:prodUuid, cantidad:l.cant, precio_applied:precio, instruccion:l.inst||null });
          }
        }
        ok++;
      }
    } catch(e) { console.warn('[pedSincronizarToSb]', e.message); err++; }
  }
  pmSave('pedidos');
  pmToast(`Sincronizados: ${ok} ✓${err ? ' · Errores: '+err : ''}`);
}

// ── Plan vs Pedidos del día ──
async function ppVerPlanVsPedidos() {
  const fecha   = document.getElementById('pp-fecha').value || pmHoy();
  const plan    = prodGetPlan(fecha);
  const peds    = G.pedidosPan.filter(p => p.date === fecha);
  const vistaEl = document.getElementById('pp-vista-extra');

  // Pedidos de pan regulares
  const pedPorPan = {};
  peds.forEach(p => (p.lineas||[]).forEach(l => {
    pedPorPan[l.pid] = (pedPorPan[l.pid] || 0) + l.cant;
  }));

  // Sumar pedidos comerciales del día — ahora viven local en G.pedidosCom
  // (punto 7 del plan de auditoría: comercial.js pasó a local-first),
  // así que ya no hace falta pedirlos a Supabase acá.
  const comHoy = G.pedidosCom.filter(p => p.date === fecha && _docEstaAbierto(p));
  comHoy.forEach(p => {
    (p.lineas||[]).forEach(l => {
      if (l.pid) pedPorPan[l.pid] = (pedPorPan[l.pid]||0) + (l.cant||1);
    });
  });

  const allPids = [...new Set([...Object.keys(plan), ...Object.keys(pedPorPan)])];

  if (!allPids.length) {
    vistaEl.style.display = 'block';
    vistaEl.innerHTML = `<div class="card">
      <button class="btn btn-out btn-sm" onclick="ppCerrarVista()" style="margin-bottom:12px">← Volver a Pedidos</button>
      <div class="ph"><span class="ph-icon">🔥</span>Sin plan ni pedidos para este día</div>
    </div>`;
    return;
  }

  const rows = allPids.map(pid => {
    // plan[pid] puede ser {prod:5, nota:''} o número directo (formato viejo)
    const planObj  = plan[pid];
    const planCant = typeof planObj === 'object' ? (planObj?.prod || 0) : (planObj || 0);
    const pedCant  = pedPorPan[pid] || 0;
    const diff     = planCant - pedCant;
    const nombre   = pmNombrePan(pid);
    const diffColor = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--cream2)';
    const diffText  = diff > 0 ? `+${diff} disponible` : diff < 0 ? `${diff} FALTANTE` : '✓ Exacto';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:9px 10px;font-weight:600">${nombre}</td>
      <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700">${planCant}</td>
      <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${pedCant}</td>
      <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700;color:${diffColor}">${diffText}</td>
    </tr>`;
  }).join('');

  vistaEl.style.display = 'block';
  vistaEl.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <button class="btn btn-out btn-sm" onclick="ppCerrarVista()">← Volver a Pedidos</button>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:var(--cream)">🔥 Plan vs Pedidos</div>
      <div style="font-size:12px;color:var(--cream2)">${pmFmtDate(fecha)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Pan</th>
        <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">🔥 Plan</th>
        <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">📋 Pedidos</th>
        <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Diferencia</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:11px;color:var(--cream2);margin-top:12px">
      🟢 Verde = disponible · 🔴 Rojo = faltante · ✓ = exacto · 🏪 incluye pedidos comerciales
    </div>
  </div>`;
  vistaEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── Cerrar vista extra y volver a pedidos ──
function ppCerrarVista() {
  const v = document.getElementById('pp-vista-extra');
  v.style.display = 'none';
  v.innerHTML = '';
  document.getElementById('pp-list').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function ppAdd() {
  const fecha = document.getElementById('pp-fecha').value || pmHoy();
  const cli = document.getElementById('pp-cli').value.trim();
  if (!cli) { pmToast('Ingresá el nombre del cliente','err'); return; }
  const newPed = { id:pmId(), date:fecha, cli, status:G.estados[0]||'Pedido', lineas:[] };
  G.pedidosPan.push(newPed);
  document.getElementById('pp-cli').value='';
  document.getElementById('pp-cli').focus();
  pmSave('pedidos'); ppRender();
  pmToast(`Pedido iniciado para ${cli} ✓`);
  setTimeout(() => {
    const sf = document.getElementById('sf-' + newPed.id);
    if (sf) sf.classList.add('open');
    const cantEl = document.getElementById('lp-cant-' + newPed.id);
    if (cantEl) cantEl.focus();
  }, 50);
  // Supabase — dual write
  if (pmDB.disponible()) {
    // FIX: se guarda la promesa de creación (no solo el resultado) para
    // que ppAddLinea() pueda esperarla si el usuario agrega un producto
    // antes de que el pedido termine de crearse en Supabase — ver fix
    // más abajo, en ppAddLinea().
    newPed._sbCreatePromise = pmDB.pedidos.crear({ fecha, cliente_nom:cli, tipo:'pan', status:newPed.status, total:0 })
      .then(rows => { if (rows?.[0]) newPed._sbId = rows[0].id; return rows; })
      .catch(e => { console.warn('[pmDB] ppAdd error:', e.message); throw e; });
  }
}

// ── Carga pedidos de pan desde Supabase (fuente primaria) ──
// FIX: condición de carrera al agregar línea de pedido de pan.
// ppAddLinea() escribe local al instante y sincroniza a Supabase en
// segundo plano (fire-and-forget). Si el usuario navega a otra pestaña
// y regresa a Pedidos ANTES de que esa escritura termine, ppCargarSb()
// recarga desde Supabase como "fuente primaria" y — si la escritura
// todavía estaba en vuelo o falló en silencio — la línea recién
// agregada desaparece, aunque el pedido (header) sí quedó guardado.
// Este arreglo registra cada escritura pendiente y hace que
// ppCargarSb() espere a que terminen antes de confiar en Supabase.
let _sbPedidoLineasPendientes = [];

async function ppCargarSb() {
  if (pmDB.disponible()) {
    try {
      if (_sbPedidoLineasPendientes.length) {
        await Promise.allSettled(_sbPedidoLineasPendientes);
        _sbPedidoLineasPendientes = [];
      }
      const fecha = document.getElementById('pp-fecha').value || pmHoy();
      await _sbProdEnsureMap();
      const rows = await pmDB.get('pedidos', { tipo: 'pan', fecha }, '*');
      if (rows) {
        // Construir lista desde SB — fuente primaria
        const sbPeds = [];
        for (const sb of rows) {
          let lineas = [];
          try {
            const lins = await pmDB.get('pedido_lineas', { pedido_id: sb.id }, '*');
            lineas = (lins||[]).map(l => {
              const pid = _sbProdMapInv?.[l.producto_id] || '';
              return { lid: l.id, _sbId: l.id, pid, cant: l.cantidad||1, inst: l.instruccion||'' };
            }).filter(l => l.pid);
          } catch(e) { console.warn('[ppCargarSb] lineas:', e.message); }
          // Preservar id local si ya existía
          const local = G.pedidosPan.find(p => p._sbId === sb.id);
          // FIX: antes el vínculo con cliente (cliId/cliCod/cliNom) se
          // descartaba por completo acá, aunque `local` ya lo tuviera —
          // por eso "se perdía" el vínculo cada vez que se recargaba
          // desde Supabase (por ejemplo, al salir y volver a la pestaña).
          // Ahora se usa sb.cliente_id si Supabase ya lo tiene (por
          // ejemplo, sincronizado desde otro dispositivo), y si no, se
          // preserva lo que ya había local.
          let cliId  = sb.cliente_id || local?.cliId  || null;
          let cliCod = local?.cliCod || null;
          let cliNom = local?.cliNom || null;
          if (sb.cliente_id && sb.cliente_id !== local?.cliId) {
            if (!_sbCliCache) { try { await _sbCliCargar(); } catch(e) {} }
            const c = (_sbCliCache || []).find(x => x.id === sb.cliente_id);
            if (c) { cliCod = c.codigo || cliCod; cliNom = c.nombre || cliNom; }
          }
          sbPeds.push({
            id: local?.id || pmId(),
            date: sb.fecha, cli: sb.cliente_nom,
            status: sb.status, lineas, _sbId: sb.id,
            cliId, cliCod, cliNom
          });
        }
        // Mantener pedidos locales sin _sbId (creados offline) + pedidos de otras fechas
        const otrosFechas = G.pedidosPan.filter(p => p.date !== fecha);
        const offline     = G.pedidosPan.filter(p => p.date === fecha && !p._sbId);
        G.pedidosPan = [...otrosFechas, ...sbPeds, ...offline];
        pmSave('pedidos');
      }
    } catch(e) { console.warn('[ppCargarSb]', e.message); }
  }
  ppRender();
}

function ppRender() {
  const fecha = document.getElementById('pp-fecha').value || pmHoy();
  const peds = G.pedidosPan.filter(p => p.date === fecha);
  const totalUnid = peds.reduce((s,p) => s + (p.lineas||[]).reduce((a,l) => a+l.cant, 0), 0);
  const badge = document.getElementById('pp-tot-badge');
  if (badge) badge.textContent = totalUnid ? `${totalUnid} unidad(es)` : '';
  const el = document.getElementById('pp-list');
  if (!peds.length) {
    el.innerHTML = '<div class="ph"><span class="ph-icon">📋</span>Sin pedidos para este día — agregá uno arriba</div>';
    return;
  }
  el.innerHTML = peds.map(p => ppCard(p)).join('');
}

function ppCard(p) {
  const locked = p.status === (G.estados[G.estados.length-1] || 'Pagado');
  const totCli = (p.lineas||[]).reduce((s,l) => s+l.cant, 0);
  const panOpts = G.tiposPan.map(x=>`<option value="${x.id}">${x.nombre} · ${pmMoney(x.precio||0)}</option>`).join('');
  const estOpts = G.estados.map(e=>`<option value="${e}"${e===p.status?' selected':''}>${e}</option>`).join('');

  let lineasHtml = '';
  if ((p.lineas||[]).length) {
    lineasHtml = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:rgba(200,146,42,.1)">
        <th style="padding:6px 10px;text-align:left">Pan</th>
        <th style="padding:6px 10px;text-align:left">Cant.</th>
        <th style="padding:6px 10px;text-align:left">Instrucción</th>
        <th style="padding:6px 10px" colspan="2">${locked?'Estado':'Acciones'}</th>
      </tr></thead>
      <tbody id="ltbody-${p.id}">`;
    p.lineas.forEach(l => {
      const nom = pmNombrePan(l.pid);
      lineasHtml += `<tr id="lr-${l.lid}" style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 10px;font-weight:600">${nom}</td>
        <td style="padding:6px 10px"><strong>${l.cant}</strong></td>
        <td style="padding:6px 10px">${l.inst?`<span style="font-size:11px;color:var(--blue)">📌 ${pmEsc(l.inst)}</span>`:''}</td>
        ${locked
          ? `<td colspan="2" style="padding:6px 10px;font-size:11px;color:var(--cream2)">🔒 Bloqueado</td>`
          : `<td style="padding:6px 4px"><button class="btn btn-out btn-sm" onclick="ppEditLinea(${p.id},'${l.lid}')">✏</button></td>
             <td style="padding:6px 4px"><button class="btn btn-red btn-sm" onclick="ppDelLinea(${p.id},'${l.lid}')">✕</button></td>`
        }
      </tr>`;
    });
    lineasHtml += `<tr style="background:rgba(200,146,42,.08);font-weight:700" id="ltot-${p.id}">
      <td style="padding:6px 10px">TOTAL</td><td style="padding:6px 10px">${totCli}</td>
      <td colspan="3" style="padding:6px 10px;text-align:right">${pmMoney(pmTotalPan(p))}</td>
    </tr></tbody></table></div>`;
  } else {
    lineasHtml = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:rgba(200,146,42,.1)">
        <th style="padding:6px 10px;text-align:left">Pan</th><th>Cant.</th><th>Instrucción</th><th colspan="2">Acciones</th>
      </tr></thead>
      <tbody id="ltbody-${p.id}">
        <tr id="lempty-${p.id}"><td colspan="5" style="padding:14px 10px;color:var(--cream2);font-size:12px">Sin líneas — usá el formulario de abajo para agregar productos.</td></tr>
      </tbody></table></div>`;
  }

  const subform = locked ? '' : `
    <div class="pp-subform" id="sf-${p.id}">
      <div style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2);margin-bottom:10px">Agregar producto</div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:140px">
          <label style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">Pan</label>
          <select id="lp-pan-${p.id}" style="padding:8px 10px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px">${panOpts}</select>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;width:80px">
          <label style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">Cant.</label>
          <input type="number" id="lp-cant-${p.id}" min="1" value="1" onkeydown="if(event.key==='Enter')ppAddLinea(${p.id})" style="padding:8px 10px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px;width:100%">
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:140px">
          <label style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">Instrucción</label>
          <select id="lp-inst-${p.id}" style="padding:8px 10px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px">${ppInstOpts()}</select>
        </div>
        <div>
          <button class="btn btn-gold btn-sm" onclick="ppAddLinea(${p.id})" style="padding:9px 14px">+ Agregar</button>
        </div>
      </div>
    </div>`;

  return `<div class="ped-card" id="card-${p.id}" style="margin-bottom:14px;border-radius:12px;overflow:hidden;border:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;align-items:center;background:var(--sf);padding:11px 16px;gap:10px;flex-wrap:wrap;cursor:pointer" onclick="ppToggle(${p.id})">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-family:'Playfair Display',serif;font-size:15px;color:var(--cream);font-weight:700">👤 ${pmEsc(p.cli)}</span>
        ${p.cliId ? (() => {
          const nomCli = p.cliNom || (_sbCliCache||[]).find(c=>c.id===p.cliId)?.nombre || '';
          return `<span style="font-size:10px;color:var(--green);background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.2);border-radius:8px;padding:1px 7px">✓ ${pmEsc(p.cliCod||'')} ${pmEsc(nomCli)}</span>`;
        })() : ''}
        <span style="font-size:12px;font-weight:600;color:var(--gold)" id="ct-${p.id}">${totCli} unidad(es)</span>
        ${pmBadge(p.status)}
      </div>
      <div style="display:flex;gap:6px;align-items:center" onclick="event.stopPropagation()">
        ${locked?'':`<select title="Método de pago" style="font-size:11px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--cream)" onchange="ppSetMetodoPago(${p.id},this.value)">${pmMetodoPagoOpts(p.metodoPago)}</select>`}
        ${locked?`<button class="btn btn-out btn-sm" onclick="ppDesbloquear(${p.id})">🔓</button>`:`<select style="font-size:11px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--cream)" onchange="ppChgStatus(${p.id},this.value)">${estOpts}</select>`}
        ${locked?'':`<button class="btn btn-out btn-sm" onclick="ppToggleForm(${p.id})">＋ Producto</button>`}
        ${locked?'':`<button class="btn btn-gold btn-sm" onclick="ppListo(${p.id})">✓ Listo</button>`}
        <button class="btn btn-red btn-sm" onclick="ppDel(${p.id})">✕</button>
      </div>
    </div>
    <div style="padding:4px 16px 8px;background:var(--sf);border-top:1px solid var(--border)">
      <button class="btn btn-out btn-sm" onclick="ppVincularCliente(${p.id})" style="font-size:11px">🔗 Vincular cliente</button>
    </div>
    <div id="pb-${p.id}" style="display:none">
      ${subform}
      ${lineasHtml}
    </div>
  </div>`;
}

// ── Vincular pedido de pan con cliente del maestro ──
async function ppVincularCliente(pedId) {
  const p = G.pedidosPan.find(x => x.id === pedId);
  if (!p) return;
  document.getElementById('vincular-ped-id').value = pedId;
  document.getElementById('vincular-ped-nom').textContent = `Pedido de: ${p.cli}`;
  const res = document.getElementById('vincular-resultados');
  res.innerHTML = '<div style="color:var(--cream2);font-size:12px">⏳ Buscando...</div>';
  window._vincularTipo = 'pan';
  mOpen('m-vincular-cli');
  // Buscar clientes con nombre similar
  let clientes = [];
  try {
    clientes = _sbCliCache || await _sbCliCargar();
  } catch(e) {
    res.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px 0">Error al cargar clientes: ${e.message}</div>`;
    return;
  }
  if (!clientes || !clientes.length) {
    res.innerHTML = `<div style="color:var(--cream2);font-size:12px;padding:8px 0">No hay clientes en el maestro aún.<br>Usá <b>+ Crear cliente nuevo</b> para agregar a <b>${pmEsc(p.cli)}</b>.</div>`;
    return;
  }
  const q = p.cli.toLowerCase();
  let coincidencias = clientes.filter(c =>
    c.nombre.toLowerCase().includes(q) || q.includes(c.nombre.toLowerCase())
  ).slice(0, 8);
  // Si no hay coincidencias exactas, mostrar todos los clientes
  if (!coincidencias.length) coincidencias = clientes.slice(0, 8);
  res.innerHTML = `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--cream2);margin-bottom:8px">
      Coincidencias encontradas:
    </div>
    ${coincidencias.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--sf);border-radius:8px;margin-bottom:6px;border:1px solid var(--border)">
        <div>
          <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--cream2)">${pmEsc(c.codigo)}</span>
          <span style="font-weight:600;margin-left:8px">${pmEsc(c.nombre)}</span>
          <span style="font-size:10px;color:var(--cream2);margin-left:6px">${pmEsc(c.tipo||'regular')}</span>
        </div>
        <button class="btn btn-gold btn-sm" onclick="ppConfirmarVinculo(${pedId},'${c.id}','${pmEsc(c.codigo)}','${pmEsc(c.nombre.replace(/'/g,"\\'"))}')">
          Vincular
        </button>
      </div>`).join('')}`;
}

function ppConfirmarVinculo(pedId, cliId, cliCod, cliNom) {
  const p = G.pedidosPan.find(x => x.id === pedId);
  if (!p) return;
  p.cliId  = cliId;
  p.cliCod = cliCod;
  p.cliNom = cliNom;
  pmSave('pedidos');
  mClose('m-vincular-cli');
  ppRender();
  pmToast(`Vinculado con ${cliNom} ✓`, 'ok');
  // FIX: antes esto NUNCA se sincronizaba a Supabase — el vínculo vivía
  // solo en localStorage. Cualquier recarga desde Supabase (ppCargarSb,
  // al salir y volver a la pestaña) reconstruye el pedido desde cero sin
  // este dato, así que el vínculo "se perdía" aunque nunca hubiera
  // fallado nada — simplemente nunca se había guardado de verdad.
  if (pmDB.disponible() && (p._sbId || p._sbCreatePromise)) {
    (async () => {
      try {
        if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
        if (!p._sbId) throw new Error('el pedido todavía no se creó en Supabase');
        await pmDB.pedidos.editar(p._sbId, { cliente_id: cliId });
      } catch(e) {
        console.warn('[pmDB] ppConfirmarVinculo error:', e.message);
        pmToast('⚠️ Vínculo guardado solo local — no se sincronizó a Supabase: ' + e.message, 'err');
      }
    })();
  }
}

async function ppCrearYVincular() {
  const pedId = parseInt(document.getElementById('vincular-ped-id').value);
  const p     = G.pedidosPan.find(x => x.id === pedId);
  if (!p) return;
  mClose('m-vincular-cli');
  window._ppVincularPedId = pedId;
  // Ir a Maestros → Clientes
  showTab('app-inner');
  setTimeout(async () => {
    const cliPill = [...document.querySelectorAll('#m-pills .pill')].find(b => b.textContent.includes('Clientes'));
    mTab('clientes', cliPill);
    // Esperar que cliRender termine
    await new Promise(r => setTimeout(r, 600));
    // Abrir formulario nuevo cliente pre-llenado usando cliNuevo()
    await cliNuevo();
    // Sobreescribir el nombre con el del pedido
    document.getElementById('cli-nom').value = p.cli;
    document.getElementById('cli-form-title').textContent = `Nuevo cliente — ${p.cli}`;
    pmToast('Completá los datos y guardá el cliente ✓', 'ok');
  }, 200);
}

function ppToggle(id) {
  const body = document.getElementById('pb-' + id);
  if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
}

function ppToggleForm(id) {
  const sf = document.getElementById('sf-' + id);
  if (sf) sf.classList.toggle('open');
  const body = document.getElementById('pb-' + id);
  if (body) body.style.display = 'block';
}

function ppListo(id) {
  const body = document.getElementById('pb-' + id);
  if (body) body.style.display = 'none';
  document.getElementById('pg-pedidos').scrollTo({ top:0, behavior:'smooth' });
  document.getElementById('pp-cli').focus();
}

// FIX D3: guardar el método de pago elegido para este pedido (se usa
// al crear la venta cuando se marca como Pagado).
function ppSetMetodoPago(id, v) {
  const p = G.pedidosPan.find(x=>x.id===id);
  if (!p) return;
  p.metodoPago = v;
  pmSave('pedidos');
}

async function ppChgStatus(id, st) {
  const p = G.pedidosPan.find(x=>x.id===id);
  if (!p) return;
  const prevSt = p.status;
  p.status = st; pmSave('pedidos'); ppRender();
  setTimeout(()=>{ const b=document.getElementById('pb-'+id); if(b) b.style.display='block'; },20);
  if (pmDB.disponible()) {
    // Actualizar status en Supabase si tiene _sbId
    if (p._sbId) pmDB.pedidos.cambiarStatus(p._sbId, st).catch(e => console.warn('[pmDB] ppChgStatus:', e.message));
    // Crear venta al pagar
    if ((st === 'Pagado' || st === 'en recepción pagado') && prevSt !== st) {
      const refId = 'PAN-' + id;
      const exist = await pmDB.get('ventas', { notas: refId }).catch(()=>[]);
      if (!exist || !exist.length) {
        const total = pmTotalPan(p);
        try {
          await pmDB.ventas.crear({
            fecha_pago:  pmHoy(),
            total,
            metodo_pago: p.metodoPago || 'efectivo',
            cliente_nom: p.cliNom || p.cli,
            tipo:        'pan',
            notas:       refId,
            pedido_id:   p._sbId || null
          });
          pmToast('Venta registrada ✓', 'ok');
        } catch(e) {
          // FIX: antes el toast de éxito se mostraba SIEMPRE, incluso si
          // esto fallaba — el .catch() de la versión anterior "absorbía"
          // el error antes de llegar al toast, así que una venta que
          // fallaba en silencio se veía igual que una exitosa. Ahora si
          // falla, se avisa de verdad.
          console.warn('[pmDB] ppVenta crear:', e.message);
          pmToast('⚠️ No se pudo registrar la venta: ' + e.message, 'err');
        }
      }
    }
    // Anular venta al desmarcar Pagado
    if (prevSt === 'Pagado' || prevSt === 'en recepción pagado') {
      if (st !== 'Pagado' && st !== 'en recepción pagado') {
        const refId = 'PAN-' + id;
        const exist = await pmDB.get('ventas', { notas: refId }).catch(()=>[]);
        if (exist && exist.length) {
          await pmDB.hardDelete('ventas', exist[0].id).catch(e => console.warn('[pmDB] ppVenta anular:', e.message));
          pmToast('Venta anulada', 'ok');
        }
      }
    }
  }
}

function ppDesbloquear(id) {
  const p = G.pedidosPan.find(x=>x.id===id);
  if (!p) return;
  const estados = G.estados||[];
  const prevSt = estados.length > 1 ? estados[estados.length-2] : estados[0];
  if (prevSt) {
    p.status = prevSt; pmSave('pedidos'); ppRender();
    setTimeout(()=>{ const b=document.getElementById('pb-'+id); if(b) b.style.display='block'; },20);
    pmToast('Pedido desbloqueado ✓');
    if (pmDB.disponible() && p._sbId) {
      pmDB.pedidos.cambiarStatus(p._sbId, prevSt)
        .catch(e => console.warn('[pmDB] ppDesbloquear error:', e.message));
    }
  }
}

// FIX A1: espejo exacto de ppDesbloquear() para pedidos de galletas —
// antes no existía y un pedido de galletas marcado "Pagado" (o el
// último estado) por error quedaba bloqueado para siempre sin forma de
// revertirlo desde la interfaz.
function pgDesbloquear(id) {
  const p = G.pedidosGalletas.find(x=>x.id===id);
  if (!p) return;
  const estados = G.estados||[];
  const prevSt = estados.length > 1 ? estados[estados.length-2] : estados[0];
  if (prevSt) {
    p.status = prevSt; pmSave('pedidos'); pgRender();
    setTimeout(()=>{ const b=document.getElementById('pgb-'+id); if(b) b.style.display='block'; },20);
    pmToast('Pedido desbloqueado ✓');
    if (pmDB.disponible() && p._sbId) {
      pmDB.pedidos.cambiarStatus(p._sbId, prevSt)
        .catch(e => console.warn('[pmDB] pgDesbloquear error:', e.message));
    }
  }
}

function ppAddLinea(pedId) {
  const ped = G.pedidosPan.find(p=>p.id===pedId);
  if (!ped) return;
  const selEl  = document.getElementById('lp-pan-'  + pedId);
  const cantEl = document.getElementById('lp-cant-' + pedId);
  const instEl = document.getElementById('lp-inst-' + pedId);
  const pid  = selEl.value;
  const cant = parseInt(cantEl.value)||1;
  const inst = instEl ? instEl.value : '';
  if (!pid) { pmToast('Seleccioná un pan','err'); return; }
  const lid = pmId();
  ped.lineas.push({ lid, pid, cant, inst });
  pmSave('pedidos');

  // Update DOM directly (no full re-render)
  const totCli = ped.lineas.reduce((s,l)=>s+l.cant, 0);
  let tbody = document.getElementById('ltbody-' + pedId);
  if (!tbody) {
    ppRender();
    setTimeout(()=>{ const b=document.getElementById('pb-'+pedId); if(b) b.style.display='block'; },20);
  } else {
    const empty = document.getElementById('lempty-' + pedId);
    if (empty) empty.remove();
    const totRow = document.getElementById('ltot-' + pedId);
    if (totRow) totRow.remove();
    const tr = document.createElement('tr');
    tr.id = 'lr-' + lid;
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:6px 10px;font-weight:600">${pmNombrePan(pid)}</td>
      <td style="padding:6px 10px"><strong>${cant}</strong></td>
      <td style="padding:6px 10px">${inst?`<span style="font-size:11px;color:var(--blue)">📌 ${inst}</span>`:''}</td>
      <td style="padding:6px 4px"><button class="btn btn-out btn-sm" onclick="ppEditLinea(${pedId},'${lid}')">✏</button></td>
      <td style="padding:6px 4px"><button class="btn btn-red btn-sm" onclick="ppDelLinea(${pedId},'${lid}')">✕</button></td>`;
    tbody.appendChild(tr);
    const totTr = document.createElement('tr');
    totTr.id = 'ltot-' + pedId;
    totTr.style.cssText = 'background:rgba(200,146,42,.08);font-weight:700';
    totTr.innerHTML = `<td style="padding:6px 10px">TOTAL</td><td style="padding:6px 10px">${totCli}</td><td colspan="3" style="padding:6px 10px;text-align:right">${pmMoney(pmTotalPan(ped))}</td>`;
    tbody.appendChild(totTr);
    const ctEl = document.getElementById('ct-' + pedId);
    if (ctEl) ctEl.textContent = totCli + ' unidad(es)';
    const badge = document.getElementById('pp-tot-badge');
    if (badge) {
      const fecha = document.getElementById('pp-fecha').value || pmHoy();
      const all = G.pedidosPan.filter(p=>p.date===fecha).reduce((s,p)=>s+(p.lineas||[]).reduce((a,l)=>a+l.cant,0),0);
      badge.textContent = all ? `${all} unidad(es)` : '';
    }
  }
  cantEl.value = 1;
  cantEl.focus();
  pmToast('Línea agregada ✓');
  // Supabase — agregar línea
  // FIX: antes la condición era `pmDB.disponible() && ped._sbId` — si el
  // pedido todavía no tenía _sbId (su creación en Supabase seguía en
  // camino, algo muy probable porque la UI enfoca el campo de cantidad
  // para seguir escribiendo rápido), este bloque completo se saltaba EN
  // SILENCIO: ni error, ni toast, nada. La línea quedaba solo local y
  // desaparecía en el siguiente reload desde Supabase. Ahora, si no hay
  // _sbId todavía pero existe la promesa de creación, se espera esa
  // promesa antes de decidir que no se puede sincronizar.
  if (pmDB.disponible() && (ped._sbId || ped._sbCreatePromise)) {
    const escritura = (async () => {
      if (!ped._sbId && ped._sbCreatePromise) {
        await ped._sbCreatePromise.catch(() => {});
      }
      if (!ped._sbId) {
        throw new Error('el pedido todavía no se creó en Supabase');
      }
      await _sbProdEnsureMap();
      let prodUuid = _sbProdMap?.[pid];
      const precio = G.tiposPan.find(x=>x.id===pid)?.precio || 0;
      if (!prodUuid) {
        // FIX: antes se daba por vencido de una — si el mapa cacheado
        // estaba desactualizado (producto sincronizado después de la
        // primera carga), esto fallaba en silencio o con este error
        // aunque el producto SÍ existiera ya en Supabase. Se fuerza un
        // refresco del mapa una vez antes de reportar el error real.
        await _sbProdEnsureMap(true);
        prodUuid = _sbProdMap?.[pid];
      }
      if (!prodUuid) {
        throw new Error('producto no encontrado en Supabase (mapa desactualizado)');
      }
      const rows = await pmDB.pedidos.lineas.agregar({
        pedido_id: ped._sbId,
        producto_id: prodUuid,
        cantidad: cant,
        precio_applied: precio,
        instruccion: inst || null
      });
      if (rows?.[0]) {
        const lineaLocal = ped.lineas.find(x => x.lid === lid);
        if (lineaLocal) lineaLocal._sbId = rows[0].id;
      }
      return rows;
    })().catch(e => {
      console.warn('[pmDB] ppAddLinea error:', e.message);
      pmToast('⚠️ Línea guardada solo local — no se sincronizó a Supabase: ' + e.message, 'err');
    });
    // Registrar como pendiente para que ppCargarSb() espere antes de
    // recargar y pisar esta línea con datos viejos de Supabase.
    _sbPedidoLineasPendientes.push(escritura);
    // FIX: también se guarda la referencia en la propia línea — si el
    // usuario la borra MUY rápido, antes de que esto termine, ppDelLinea
    // puede esperar esta misma promesa antes de decidir si hay que
    // borrarla en Supabase también.
    const lineaRef = ped.lineas.find(x => x.lid === lid);
    if (lineaRef) lineaRef._sbPendingPromise = escritura;
    escritura.finally(() => {
      _sbPedidoLineasPendientes = _sbPedidoLineasPendientes.filter(p => p !== escritura);
    });
  }
}

function ppEditLinea(pedId, lid) {
  const ped = G.pedidosPan.find(p=>p.id===pedId);
  if (!ped) return;
  const l = ped.lineas.find(x=>String(x.lid)===String(lid));
  if (!l) return;
  const tr = document.getElementById('lr-' + lid);
  if (!tr) return;
  const panOpts = G.tiposPan.map(x=>`<option value="${x.id}"${x.id===l.pid?' selected':''}>${x.nombre}</option>`).join('');
  tr.innerHTML = `
    <td style="padding:4px 6px">
      <select id="ep-pan-${lid}" style="font-size:12px;padding:4px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)">${panOpts}</select>
    </td>
    <td style="padding:4px 6px">
      <input type="number" id="ep-cant-${lid}" value="${l.cant}" min="1" style="width:56px;font-size:12px;padding:4px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)">
    </td>
    <td style="padding:4px 6px">
      <select id="ep-inst-${lid}" style="font-size:12px;padding:4px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)">${ppInstOpts(l.inst)}</select>
    </td>
    <td style="padding:4px 4px"><button class="btn btn-gold btn-sm" onclick="ppSaveLinea(${pedId},'${lid}')">💾</button></td>
    <td style="padding:4px 4px"><button class="btn btn-out btn-sm" onclick="ppRender()">✕</button></td>`;
}

function ppSaveLinea(pedId, lid) {
  const ped = G.pedidosPan.find(p=>p.id===pedId);
  if (!ped) return;
  const l = ped.lineas.find(x=>String(x.lid)===String(lid));
  if (!l) return;
  l.pid  = document.getElementById('ep-pan-'  + lid).value;
  l.cant = parseInt(document.getElementById('ep-cant-' + lid).value)||1;
  l.inst = document.getElementById('ep-inst-' + lid).value;
  pmSave('pedidos'); ppRender();
  setTimeout(()=>{ const b=document.getElementById('pb-'+pedId); if(b) b.style.display='block'; },20);
  pmToast('Línea actualizada ✓');

  // FIX: antes editar una línea nunca se sincronizaba a Supabase — el
  // cambio quedaba solo local. Mismo patrón que ppAddLinea: espera la
  // creación del pedido si hace falta, refresca el mapa de productos si
  // no encuentra el producto, y si la línea nunca se había sincronizado
  // (_sbId ausente), la inserta ahora en vez de intentar un update.
  if (pmDB.disponible() && (ped._sbId || ped._sbCreatePromise)) {
    const escritura = (async () => {
      if (!ped._sbId && ped._sbCreatePromise) {
        await ped._sbCreatePromise.catch(() => {});
      }
      if (!ped._sbId) throw new Error('el pedido todavía no se creó en Supabase');
      await _sbProdEnsureMap();
      let prodUuid = _sbProdMap?.[l.pid];
      const precio = G.tiposPan.find(x=>x.id===l.pid)?.precio || 0;
      if (!prodUuid) {
        await _sbProdEnsureMap(true);
        prodUuid = _sbProdMap?.[l.pid];
      }
      if (!prodUuid) throw new Error('producto no encontrado en Supabase (mapa desactualizado)');
      if (l._sbId) {
        return pmDB.pedidos.lineas.editar(l._sbId, {
          producto_id: prodUuid, cantidad: l.cant, precio_applied: precio, instruccion: l.inst || null
        });
      } else {
        const rows = await pmDB.pedidos.lineas.agregar({
          pedido_id: ped._sbId, producto_id: prodUuid, cantidad: l.cant,
          precio_applied: precio, instruccion: l.inst || null
        });
        if (rows?.[0]) l._sbId = rows[0].id;
        return rows;
      }
    })().catch(e => {
      console.warn('[pmDB] ppSaveLinea error:', e.message);
      pmToast('⚠️ Edición guardada solo local — no se sincronizó a Supabase: ' + e.message, 'err');
    });
    _sbPedidoLineasPendientes.push(escritura);
    escritura.finally(() => {
      _sbPedidoLineasPendientes = _sbPedidoLineasPendientes.filter(p => p !== escritura);
    });
  }
}

function ppDelLinea(pedId, lid) {
  const p = G.pedidosPan.find(x=>x.id===pedId);
  if (!p) return;
  const l = p.lineas.find(x=>String(x.lid)===String(lid));
  p.lineas = p.lineas.filter(x=>String(x.lid)!==String(lid));
  pmSave('pedidos'); ppRender();
  setTimeout(()=>{ const b=document.getElementById('pb-'+pedId); if(b) b.style.display='block'; },20);
  // FIX: antes borrar una línea nunca se sincronizaba a Supabase — la
  // línea seguía viva ahí después de "borrarla" en pantalla. Si la línea
  // se había agregado hace instantes y su sincronización todavía está en
  // vuelo (_sbPendingPromise), se espera a que termine antes de decidir
  // si hace falta un delete — así no queda huérfana en Supabase por
  // haberla borrado demasiado rápido.
  if (pmDB.disponible() && l) {
    const escritura = (async () => {
      if (!l._sbId && l._sbPendingPromise) {
        await l._sbPendingPromise.catch(() => {});
      }
      if (!l._sbId) return; // nunca llegó a existir en Supabase, nada que borrar
      return pmDB.pedidos.lineas.eliminar(l._sbId);
    })().catch(e => {
      console.warn('[pmDB] ppDelLinea error:', e.message);
      pmToast('⚠️ Línea borrada solo local — no se borró en Supabase: ' + e.message, 'err');
    });
    _sbPedidoLineasPendientes.push(escritura);
    escritura.finally(() => {
      _sbPedidoLineasPendientes = _sbPedidoLineasPendientes.filter(p2 => p2 !== escritura);
    });
  }
}

function ppDel(id) {
  if (!confirm('¿Eliminar este pedido?')) return;
  const p = G.pedidosPan.find(x=>x.id===id);
  G.pedidosPan = G.pedidosPan.filter(x=>x.id!==id);
  pmSave('pedidos'); ppRender(); pmToast('Pedido eliminado');
  if (pmDB.disponible() && p?._sbId) {
    pmDB.hardDelete('pedidos', p._sbId)
      .catch(e => console.warn('[pmDB] ppDel error:', e.message));
  }
}
