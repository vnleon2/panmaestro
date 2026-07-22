// ── 🍪 GALLETAS ──────────────────────────────────────────
function pgInstOpts(selected='') {
  return '<option value="">— ninguna —</option>' +
    (G.instrucciones||[]).map(i=>`<option value="${i}"${i===selected?' selected':''}>${i}</option>`).join('');
}

// ── Resumen del día — galletas ──
function pgVerResumen() {
  const fecha   = document.getElementById('pg-fecha').value || pmHoy();
  const peds    = G.pedidosGalletas.filter(p => p.date === fecha);
  const vistaEl = document.getElementById('pg-vista-extra');
  if (!peds.length) {
    vistaEl.style.display = 'block';
    vistaEl.innerHTML = `<div class="card">
      <button class="btn btn-out btn-sm" onclick="pgCerrarVista()" style="margin-bottom:12px">← Volver a Pedidos</button>
      <div class="ph"><span class="ph-icon">📋</span>Sin pedidos para este día</div>
    </div>`;
    return;
  }
  const totPorGall = {};
  peds.forEach(p => (p.lineas||[]).forEach(l => {
    if (!totPorGall[l.pid]) totPorGall[l.pid] = { nombre: pmNombreGall(l.pid), cant: 0, clientes: [] };
    totPorGall[l.pid].cant += l.cant;
    totPorGall[l.pid].clientes.push(p.cli);
  }));
  const totalUnid = Object.values(totPorGall).reduce((s,v) => s + v.cant, 0);
  const rows = Object.entries(totPorGall)
    .sort((a,b) => b[1].cant - a[1].cant)
    .map(([pid,v]) => `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:9px 10px;font-weight:600">${v.nombre}</td>
      <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700;font-size:16px;color:var(--gold)">${v.cant}</td>
      <td style="padding:9px 10px;font-size:11px;color:var(--cream2)">${[...new Set(v.clientes)].join(', ')}</td>
    </tr>`).join('');
  vistaEl.style.display = 'block';
  vistaEl.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <button class="btn btn-out btn-sm" onclick="pgCerrarVista()">← Volver a Pedidos</button>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:var(--cream)">📋 Resumen del día</div>
      <div style="font-size:12px;color:var(--cream2)">${pmFmtDate(fecha)} · ${peds.length} cliente(s) · ${totalUnid} unidades</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Galleta</th>
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

// ── Plan vs Pedidos — galletas ──
function pgVerPlanVsPedidos() {
  const fecha   = document.getElementById('pg-fecha').value || pmHoy();
  const plan    = prodGetPlan(fecha);
  const peds    = G.pedidosGalletas.filter(p => p.date === fecha);
  const vistaEl = document.getElementById('pg-vista-extra');
  const pedPorGall = {};
  peds.forEach(p => (p.lineas||[]).forEach(l => {
    pedPorGall[l.pid] = (pedPorGall[l.pid] || 0) + l.cant;
  }));
  // Solo galletas — filtrar PIDs que empiezan con G
  const allPids = [...new Set([
    ...Object.keys(plan).filter(k => k.startsWith('G')),
    ...Object.keys(pedPorGall)
  ])];
  if (!allPids.length) {
    vistaEl.style.display = 'block';
    vistaEl.innerHTML = `<div class="card">
      <button class="btn btn-out btn-sm" onclick="pgCerrarVista()" style="margin-bottom:12px">← Volver a Pedidos</button>
      <div class="ph"><span class="ph-icon">🔥</span>Sin plan ni pedidos de galletas para este día</div>
    </div>`;
    return;
  }
  const rows = allPids.map(pid => {
    const planCant = plan[pid] || 0;
    const pedCant  = pedPorGall[pid] || 0;
    const diff     = planCant - pedCant;
    const diffColor = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--cream2)';
    const diffText  = diff > 0 ? `+${diff} disponible` : diff < 0 ? `${diff} FALTANTE` : '✓ Exacto';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:9px 10px;font-weight:600">${pmNombreGall(pid)}</td>
      <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700">${planCant}</td>
      <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${pedCant}</td>
      <td style="padding:9px 10px;text-align:center;font-family:'DM Mono',monospace;font-weight:700;color:${diffColor}">${diffText}</td>
    </tr>`;
  }).join('');
  vistaEl.style.display = 'block';
  vistaEl.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <button class="btn btn-out btn-sm" onclick="pgCerrarVista()">← Volver a Pedidos</button>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:var(--cream)">🔥 Plan vs Pedidos</div>
      <div style="font-size:12px;color:var(--cream2)">${pmFmtDate(fecha)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Galleta</th>
        <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">🔥 Plan</th>
        <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">📋 Pedidos</th>
        <th style="padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Diferencia</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:11px;color:var(--cream2);margin-top:12px">🟢 Verde = disponible · 🔴 Rojo = faltante · ✓ = exacto</div>
  </div>`;
  vistaEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function pgCerrarVista() {
  const v = document.getElementById('pg-vista-extra');
  v.style.display = 'none';
  v.innerHTML = '';
  document.getElementById('pg-list').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function pgAdd() {
  const fecha = document.getElementById('pg-fecha').value || pmHoy();
  const cli = document.getElementById('pg-cli').value.trim();
  if (!cli) { pmToast('Ingresá el nombre del cliente','err'); return; }
  const newPed = { id:pmId(), date:fecha, cli, status:G.estados[0]||'Pedido', lineas:[] };
  G.pedidosGalletas.push(newPed);
  document.getElementById('pg-cli').value='';
  document.getElementById('pg-cli').focus();
  pmSave('pedidos'); pgRender();
  pmToast(`Pedido iniciado para ${cli} ✓`);
  setTimeout(() => {
    const sf = document.getElementById('sgf-' + newPed.id);
    if (sf) sf.classList.add('open');
    const cantEl = document.getElementById('lgc-cant-' + newPed.id);
    if (cantEl) cantEl.focus();
  }, 50);
  // Supabase — dual write
  if (pmDB.disponible()) {
    // FIX A2/mismo patrón que Pan: se guarda la promesa de creación (no
    // solo el resultado) para que pgAddLinea() pueda esperarla si el
    // usuario agrega una galleta antes de que el pedido termine de
    // crearse en Supabase.
    newPed._sbCreatePromise = pmDB.pedidos.crear({ fecha, cliente_nom:cli, tipo:'galleta', status:newPed.status, total:0 })
      .then(rows => { if (rows?.[0]) newPed._sbId = rows[0].id; return rows; })
      .catch(e => { console.warn('[pmDB] pgAdd error:', e.message); throw e; });
  }
}

// ── Carga pedidos de galleta desde Supabase (fuente primaria) ──
// FIX A2: mismo patrón de condición de carrera que se arregló en Pan
// (ver _sbPedidoLineasPendientes) — pgAddLinea() ahora sí sincroniza a
// Supabase, y este registro evita que pgCargarSb() pise una línea que
// todavía está en camino.
let _sbLineasPendientesGalletas = [];

async function pgCargarSb() {
  if (pmDB.disponible()) {
    try {
      if (_sbLineasPendientesGalletas.length) {
        await Promise.allSettled(_sbLineasPendientesGalletas);
        _sbLineasPendientesGalletas = [];
      }
      const fecha = document.getElementById('pg-fecha').value || pmHoy();
      await _sbProdEnsureMap();
      const rows = await pmDB.get('pedidos', { tipo: 'galleta', fecha }, '*');
      if (rows) {
        const sbPeds = [];
        for (const sb of rows) {
          let lineas = [];
          try {
            const lins = await pmDB.get('pedido_lineas', { pedido_id: sb.id }, '*');
            lineas = (lins||[]).map(l => {
              const pid = _sbProdMapInv?.[l.producto_id] || '';
              return { lid: l.id, _sbId: l.id, pid, cant: l.cantidad||1, inst: l.instruccion||'' };
            }).filter(l => l.pid);
          } catch(e) { console.warn('[pgCargarSb] lineas:', e.message); }
          const local = G.pedidosGalletas.find(p => p._sbId === sb.id);
          // FIX: mismo patrón que ppCargarSb — antes se descartaba el
          // vínculo con cliente por completo en cada reload.
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
        const otrosFechas = G.pedidosGalletas.filter(p => p.date !== fecha);
        const offline     = G.pedidosGalletas.filter(p => p.date === fecha && !p._sbId);
        G.pedidosGalletas = [...otrosFechas, ...sbPeds, ...offline];
        pmSave('pedidos');
      }
    } catch(e) { console.warn('[pgCargarSb]', e.message); }
  }
  pgRender();
}

function pgRender() {
  const fecha = document.getElementById('pg-fecha').value || pmHoy();
  const peds = G.pedidosGalletas.filter(p => p.date === fecha);
  const totalUnid = peds.reduce((s,p) => s + (p.lineas||[]).reduce((a,l)=>a+l.cant,0), 0);
  const badge = document.getElementById('pg-tot-badge');
  if (badge) badge.textContent = totalUnid ? `${totalUnid} unidad(es)` : '';
  const el = document.getElementById('pg-list');
  if (!peds.length) { el.innerHTML='<div class="ph"><span class="ph-icon">🍪</span>Sin pedidos para este día — agregá uno arriba</div>'; return; }
  el.innerHTML = peds.map(p => pgCard(p)).join('');
}

function pgCard(p) {
  const locked = p.status === (G.estados[G.estados.length-1]||'Pagado');
  const totCli = (p.lineas||[]).reduce((s,l)=>s+l.cant,0);
  const galOpts = G.tiposGalleta.map(x=>`<option value="${x.id}">${x.nombre} · ${pmMoney(x.precio||0)}</option>`).join('');
  const estOpts = G.estados.map(e=>`<option value="${e}"${e===p.status?' selected':''}>${e}</option>`).join('');

  let lineasHtml = '';
  if ((p.lineas||[]).length) {
    lineasHtml = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:rgba(200,146,42,.1)">
        <th style="padding:6px 10px;text-align:left">Galleta</th>
        <th style="padding:6px 10px;text-align:left">Cant.</th>
        <th style="padding:6px 10px;text-align:left">Instrucción</th>
        <th style="padding:6px 10px" colspan="2">${locked?'Estado':'Acciones'}</th>
      </tr></thead>
      <tbody id="lgtbody-${p.id}">`;
    p.lineas.forEach(l => {
      lineasHtml += `<tr id="lgr-${l.lid}" style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 10px;font-weight:600">${pmNombreGall(l.pid)}</td>
        <td style="padding:6px 10px"><strong>${l.cant}</strong></td>
        <td style="padding:6px 10px">${l.inst?`<span style="font-size:11px;color:var(--blue)">📌 ${pmEsc(l.inst)}</span>`:''}</td>
        ${locked
          ? `<td colspan="2" style="padding:6px 10px;font-size:11px;color:var(--cream2)">🔒 Bloqueado</td>`
          : `<td style="padding:6px 4px"><button class="btn btn-out btn-sm" onclick="pgEditLinea(${p.id},'${l.lid}')">✏</button></td>
             <td style="padding:6px 4px"><button class="btn btn-red btn-sm" onclick="pgDelLinea(${p.id},'${l.lid}')">✕</button></td>`
        }
      </tr>`;
    });
    lineasHtml += `<tr style="background:rgba(200,146,42,.08);font-weight:700" id="lgtot-${p.id}">
      <td style="padding:6px 10px">TOTAL</td><td style="padding:6px 10px">${totCli}</td>
      <td colspan="3" style="padding:6px 10px;text-align:right">${pmMoney(pmTotalGall(p))}</td>
    </tr></tbody></table></div>`;
  } else {
    lineasHtml = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:rgba(200,146,42,.1)">
        <th style="padding:6px 10px;text-align:left">Galleta</th><th>Cant.</th><th>Instrucción</th><th colspan="2">Acciones</th>
      </tr></thead>
      <tbody id="lgtbody-${p.id}">
        <tr id="lgempty-${p.id}"><td colspan="5" style="padding:14px 10px;color:var(--cream2);font-size:12px">Sin líneas — usá el formulario de abajo.</td></tr>
      </tbody></table></div>`;
  }

  const subform = locked ? '' : `
    <div class="pp-subform" id="sgf-${p.id}">
      <div style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2);margin-bottom:10px">Agregar producto</div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:140px">
          <label style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">Galleta</label>
          <select id="lgc-pan-${p.id}" style="padding:8px 10px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px">${galOpts}</select>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;width:80px">
          <label style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">Cant.</label>
          <input type="number" id="lgc-cant-${p.id}" min="1" value="1" onkeydown="if(event.key==='Enter')pgAddLinea(${p.id})" style="padding:8px 10px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px;width:100%">
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:140px">
          <label style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">Instrucción</label>
          <select id="lgc-inst-${p.id}" style="padding:8px 10px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:13px">${pgInstOpts()}</select>
        </div>
        <div>
          <button class="btn btn-gold btn-sm" onclick="pgAddLinea(${p.id})" style="padding:9px 14px">+ Agregar</button>
        </div>
      </div>
    </div>`;

  return `<div class="ped-card" id="pgcard-${p.id}" style="margin-bottom:14px;border-radius:12px;overflow:hidden;border:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;align-items:center;background:var(--sf);padding:11px 16px;gap:10px;flex-wrap:wrap;cursor:pointer" onclick="pgToggle(${p.id})">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-family:'Playfair Display',serif;font-size:15px;color:var(--cream);font-weight:700">👤 ${pmEsc(p.cli)}</span>
        ${p.cliId ? (() => {
          const nomCli = p.cliNom || (_sbCliCache||[]).find(c=>c.id===p.cliId)?.nombre || '';
          return `<span style="font-size:10px;color:var(--green);background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.2);border-radius:8px;padding:1px 7px">✓ ${pmEsc(p.cliCod||'')} ${pmEsc(nomCli)}</span>`;
        })() : ''}
        <span style="font-size:12px;font-weight:600;color:var(--gold)" id="pgct-${p.id}">${totCli} unidad(es)</span>
        ${pmBadge(p.status)}
      </div>
      <div style="display:flex;gap:6px;align-items:center" onclick="event.stopPropagation()">
        ${locked?'':`<select title="Método de pago" style="font-size:11px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--cream)" onchange="pgSetMetodoPago(${p.id},this.value)">${pmMetodoPagoOpts(p.metodoPago)}</select>`}
        ${locked?`<button class="btn btn-out btn-sm" onclick="pgDesbloquear(${p.id})">🔓</button>`:`<select style="font-size:11px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--cream)" onchange="pgChgSt(${p.id},this.value)">${estOpts}</select>`}
        ${locked?'':`<button class="btn btn-out btn-sm" onclick="pgToggleForm(${p.id})">＋ Producto</button>`}
        ${locked?'':`<button class="btn btn-gold btn-sm" onclick="pgListo(${p.id})">✓ Listo</button>`}
        <button class="btn btn-red btn-sm" onclick="pgDel(${p.id})">✕</button>
      </div>
    </div>
    <div style="padding:4px 16px 8px;background:var(--sf);border-top:1px solid var(--border)">
      <button class="btn btn-out btn-sm" onclick="pgVincularCliente(${p.id})" style="font-size:11px">🔗 Vincular cliente</button>
    </div>
    <div id="pgb-${p.id}" style="display:none">
      ${subform}
      ${lineasHtml}
    </div>
  </div>`;
}

// ── Vincular pedido de galleta con cliente del maestro ──
async function pgVincularCliente(pedId) {
  const p = G.pedidosGalletas.find(x => x.id === pedId);
  if (!p) return;
  document.getElementById('vincular-ped-id').value = pedId;
  document.getElementById('vincular-ped-nom').textContent = `Pedido de: ${p.cli}`;
  const res = document.getElementById('vincular-resultados');
  res.innerHTML = '<div style="color:var(--cream2);font-size:12px">⏳ Buscando...</div>';
  // Guardar tipo para que ppConfirmarVinculo sepa qué pedido vincular
  window._vincularTipo = 'galleta';
  mOpen('m-vincular-cli');
  let clientes = [];
  try {
    clientes = _sbCliCache || await _sbCliCargar();
  } catch(e) {
    res.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px 0">Error: ${e.message}</div>`;
    return;
  }
  if (!clientes || !clientes.length) {
    res.innerHTML = `<div style="color:var(--cream2);font-size:12px;padding:8px 0">No hay clientes en el maestro aún.</div>`;
    return;
  }
  const q = p.cli.toLowerCase();
  let coincidencias = clientes.filter(c =>
    c.nombre.toLowerCase().includes(q) || q.includes(c.nombre.toLowerCase())
  ).slice(0, 8);
  if (!coincidencias.length) coincidencias = clientes.slice(0, 8);
  res.innerHTML = `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--cream2);margin-bottom:8px">Coincidencias:</div>
    ${coincidencias.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--sf);border-radius:8px;margin-bottom:6px;border:1px solid var(--border)">
        <div>
          <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--cream2)">${pmEsc(c.codigo)}</span>
          <span style="font-weight:600;margin-left:8px">${pmEsc(c.nombre)}</span>
        </div>
        <button class="btn btn-gold btn-sm" onclick="pgConfirmarVinculo(${pedId},'${c.id}','${pmEsc(c.codigo)}','${pmEsc(c.nombre.replace(/'/g,"\\'"))}')">Vincular</button>
      </div>`).join('')}`;
}

function pgConfirmarVinculo(pedId, cliId, cliCod, cliNom) {
  const p = G.pedidosGalletas.find(x => x.id === pedId);
  if (!p) return;
  p.cliId  = cliId;
  p.cliCod = cliCod;
  p.cliNom = cliNom;
  pmSave('pedidos');
  mClose('m-vincular-cli');
  pgRender();
  pmToast(`Vinculado con ${cliNom} ✓`, 'ok');
  // FIX: mismo patrón que ppConfirmarVinculo — antes esto nunca se
  // sincronizaba a Supabase, así que el vínculo se perdía en el
  // siguiente reload desde Supabase.
  if (pmDB.disponible() && (p._sbId || p._sbCreatePromise)) {
    (async () => {
      try {
        if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
        if (!p._sbId) throw new Error('el pedido todavía no se creó en Supabase');
        await pmDB.pedidos.editar(p._sbId, { cliente_id: cliId });
      } catch(e) {
        console.warn('[pmDB] pgConfirmarVinculo error:', e.message);
        pmToast('⚠️ Vínculo guardado solo local — no se sincronizó a Supabase: ' + e.message, 'err');
      }
    })();
  }
}

async function pgCrearYVincular() {
  const pedId = parseInt(document.getElementById('vincular-ped-id').value);
  const p     = G.pedidosGalletas.find(x => x.id === pedId);
  if (!p) return;
  mClose('m-vincular-cli');
  window._pgVincularPedId = pedId;
  showTab('app-inner');
  setTimeout(async () => {
    const cliPill = [...document.querySelectorAll('#m-pills .pill')].find(b => b.textContent.includes('Clientes'));
    mTab('clientes', cliPill);
    await new Promise(r => setTimeout(r, 600));
    await cliNuevo();
    document.getElementById('cli-nom').value = p.cli;
    document.getElementById('cli-form-title').textContent = `Nuevo cliente — ${p.cli}`;
    pmToast('Completá los datos y guardá el cliente ✓', 'ok');
  }, 200);
}

function pgToggle(id) {
  const b = document.getElementById('pgb-'+id);
  if (b) b.style.display = b.style.display==='none' ? 'block' : 'none';
}
function pgToggleForm(id) {
  const sf = document.getElementById('sgf-'+id);
  if (sf) sf.classList.toggle('open');
  const b = document.getElementById('pgb-'+id);
  if (b) b.style.display = 'block';
}
function pgListo(id) {
  const b = document.getElementById('pgb-'+id);
  if (b) b.style.display = 'none';
  document.getElementById('pg-galletas').scrollTo({ top:0, behavior:'smooth' });
  document.getElementById('pg-cli').focus();
}
// FIX D3: guardar el método de pago elegido para este pedido de galletas.
function pgSetMetodoPago(id, v) {
  const p = G.pedidosGalletas.find(x=>x.id===id);
  if (!p) return;
  p.metodoPago = v;
  pmSave('pedidos');
}

async function pgChgSt(id, st) {
  const p = G.pedidosGalletas.find(x=>x.id===id);
  if (!p) return;
  const prevSt = p.status;
  p.status = st; pmSave('pedidos'); pgRender();
  if (pmDB.disponible()) {
    if (p._sbId) pmDB.pedidos.cambiarStatus(p._sbId, st).catch(e => console.warn('[pmDB] pgChgSt:', e.message));
    // Crear venta al pagar
    if ((st === 'Pagado' || st === 'en recepción pagado') && prevSt !== st) {
      const refId = 'GALL-' + id;
      const exist = await pmDB.get('ventas', { notas: refId }).catch(()=>[]);
      if (!exist || !exist.length) {
        // FIX SESIÓN 4 (A3): antes esto recalculaba el total con un reduce
        // manual en vez de reusar pmTotalGall(p), que ya existe y se usa
        // en el resto del módulo — mismo resultado, pero duplicaba lógica
        // que podía desincronizarse si pmTotalGall cambiara en el futuro.
        const total = pmTotalGall(p);
        try {
          await pmDB.ventas.crear({
            fecha_pago:  pmHoy(),
            total,
            metodo_pago: p.metodoPago || 'efectivo',
            cliente_nom: p.cliNom || p.cli,
            tipo:        'galleta',
            notas:       refId,
            pedido_id:   p._sbId || null
          });
          pmToast('Venta registrada ✓', 'ok');
        } catch(e) {
          console.warn('[pmDB] pgVenta crear:', e.message);
          pmToast('⚠️ No se pudo registrar la venta: ' + e.message, 'err');
        }
      }
    }
    // Anular venta al desmarcar Pagado
    if (prevSt === 'Pagado' || prevSt === 'en recepción pagado') {
      if (st !== 'Pagado' && st !== 'en recepción pagado') {
        const refId = 'GALL-' + id;
        const exist = await pmDB.get('ventas', { notas: refId }).catch(()=>[]);
        if (exist && exist.length) {
          await pmDB.hardDelete('ventas', exist[0].id).catch(e => console.warn('[pmDB] pgVenta anular:', e.message));
          pmToast('Venta anulada', 'ok');
        }
      }
    }
  }
}

function pgAddLinea(pedId) {
  const ped = G.pedidosGalletas.find(p=>p.id===pedId);
  if (!ped) return;
  const selEl  = document.getElementById('lgc-pan-'  + pedId);
  const cantEl = document.getElementById('lgc-cant-' + pedId);
  const instEl = document.getElementById('lgc-inst-' + pedId);
  const pid  = selEl.value;
  const cant = parseInt(cantEl.value)||1;
  const inst = instEl ? instEl.value : '';
  if (!pid) { pmToast('Seleccioná una galleta','err'); return; }
  const lid = pmId();
  ped.lineas.push({ lid, pid, cant, inst });
  pmSave('pedidos');

  const totCli = ped.lineas.reduce((s,l)=>s+l.cant,0);
  let tbody = document.getElementById('lgtbody-' + pedId);
  if (!tbody) {
    pgRender();
    setTimeout(()=>{ const b=document.getElementById('pgb-'+pedId); if(b) b.style.display='block'; },20);
  } else {
    const empty = document.getElementById('lgempty-' + pedId);
    if (empty) empty.remove();
    const totRow = document.getElementById('lgtot-' + pedId);
    if (totRow) totRow.remove();
    const tr = document.createElement('tr');
    tr.id = 'lgr-' + lid;
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:6px 10px;font-weight:600">${pmNombreGall(pid)}</td>
      <td style="padding:6px 10px"><strong>${cant}</strong></td>
      <td style="padding:6px 10px">${inst?`<span style="font-size:11px;color:var(--blue)">📌 ${inst}</span>`:''}</td>
      <td style="padding:6px 4px"><button class="btn btn-out btn-sm" onclick="pgEditLinea(${pedId},'${lid}')">✏</button></td>
      <td style="padding:6px 4px"><button class="btn btn-red btn-sm" onclick="pgDelLinea(${pedId},'${lid}')">✕</button></td>`;
    tbody.appendChild(tr);
    const totTr = document.createElement('tr');
    totTr.id = 'lgtot-' + pedId;
    totTr.style.cssText = 'background:rgba(200,146,42,.08);font-weight:700';
    totTr.innerHTML = `<td style="padding:6px 10px">TOTAL</td><td style="padding:6px 10px">${totCli}</td><td colspan="3" style="padding:6px 10px;text-align:right">${pmMoney(pmTotalGall(ped))}</td>`;
    tbody.appendChild(totTr);
    const ctEl = document.getElementById('pgct-' + pedId);
    if (ctEl) ctEl.textContent = totCli + ' unidad(es)';
    const badge = document.getElementById('pg-tot-badge');
    if (badge) {
      const fecha = document.getElementById('pg-fecha').value || pmHoy();
      const all = G.pedidosGalletas.filter(p=>p.date===fecha).reduce((s,p)=>s+(p.lineas||[]).reduce((a,l)=>a+l.cant,0),0);
      badge.textContent = all ? `${all} unidad(es)` : '';
    }
  }
  cantEl.value = 1;
  cantEl.focus();
  pmToast('Línea agregada ✓');

  // Supabase — agregar línea (FIX A2: antes esto no existía — pgAddLinea
  // nunca sincronizaba a Supabase, ni siquiera lo intentaba. Se copia acá
  // el mismo bloque de ppAddLinea, ya con todos los fixes de la sesión de
  // hoy incluidos: esperar la creación del pedido si todavía está en
  // camino, refrescar el mapa de productos si no encuentra la galleta, y
  // avisar con toast visible si algo falla en vez de fallar en silencio.
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
      const precio = G.tiposGalleta.find(x=>x.id===pid)?.precio || 0;
      if (!prodUuid) {
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
      console.warn('[pmDB] pgAddLinea error:', e.message);
      pmToast('⚠️ Línea guardada solo local — no se sincronizó a Supabase: ' + e.message, 'err');
    });
    _sbLineasPendientesGalletas.push(escritura);
    const lineaRef = ped.lineas.find(x => x.lid === lid);
    if (lineaRef) lineaRef._sbPendingPromise = escritura;
    escritura.finally(() => {
      _sbLineasPendientesGalletas = _sbLineasPendientesGalletas.filter(p => p !== escritura);
    });
  }
}

function pgEditLinea(pedId, lid) {
  const ped = G.pedidosGalletas.find(p=>p.id===pedId);
  if (!ped) return;
  const l = ped.lineas.find(x=>String(x.lid)===String(lid));
  if (!l) return;
  const tr = document.getElementById('lgr-' + lid);
  if (!tr) return;
  const galOpts = G.tiposGalleta.map(x=>`<option value="${x.id}"${x.id===l.pid?' selected':''}>${x.nombre}</option>`).join('');
  tr.innerHTML = `
    <td style="padding:4px 6px"><select id="eg-pan-${lid}" style="font-size:12px;padding:4px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)">${galOpts}</select></td>
    <td style="padding:4px 6px"><input type="number" id="eg-cant-${lid}" value="${l.cant}" min="1" style="width:56px;font-size:12px;padding:4px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)"></td>
    <td style="padding:4px 6px"><select id="eg-inst-${lid}" style="font-size:12px;padding:4px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)">${pgInstOpts(l.inst)}</select></td>
    <td style="padding:4px 4px"><button class="btn btn-gold btn-sm" onclick="pgSaveLinea(${pedId},'${lid}')">💾</button></td>
    <td style="padding:4px 4px"><button class="btn btn-out btn-sm" onclick="pgRender()">✕</button></td>`;
}
function pgSaveLinea(pedId, lid) {
  const ped = G.pedidosGalletas.find(p=>p.id===pedId);
  if (!ped) return;
  const l = ped.lineas.find(x=>String(x.lid)===String(lid));
  if (!l) return;
  l.pid  = document.getElementById('eg-pan-'  + lid).value;
  l.cant = parseInt(document.getElementById('eg-cant-' + lid).value)||1;
  l.inst = document.getElementById('eg-inst-' + lid).value;
  pmSave('pedidos'); pgRender();
  setTimeout(()=>{ const b=document.getElementById('pgb-'+pedId); if(b) b.style.display='block'; },20);
  pmToast('Línea actualizada ✓');

  // FIX: mismo patrón que ppSaveLinea — antes editar una línea de
  // galletas nunca se sincronizaba a Supabase.
  if (pmDB.disponible() && (ped._sbId || ped._sbCreatePromise)) {
    const escritura = (async () => {
      if (!ped._sbId && ped._sbCreatePromise) {
        await ped._sbCreatePromise.catch(() => {});
      }
      if (!ped._sbId) throw new Error('el pedido todavía no se creó en Supabase');
      await _sbProdEnsureMap();
      let prodUuid = _sbProdMap?.[l.pid];
      const precio = G.tiposGalleta.find(x=>x.id===l.pid)?.precio || 0;
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
      console.warn('[pmDB] pgSaveLinea error:', e.message);
      pmToast('⚠️ Edición guardada solo local — no se sincronizó a Supabase: ' + e.message, 'err');
    });
    _sbLineasPendientesGalletas.push(escritura);
    escritura.finally(() => {
      _sbLineasPendientesGalletas = _sbLineasPendientesGalletas.filter(p => p !== escritura);
    });
  }
}
function pgDelLinea(pedId, lid) {
  const p = G.pedidosGalletas.find(x=>x.id===pedId);
  if (!p) return;
  const l = p.lineas.find(x=>String(x.lid)===String(lid));
  p.lineas = p.lineas.filter(x=>String(x.lid)!==String(lid));
  pmSave('pedidos'); pgRender();
  setTimeout(()=>{ const b=document.getElementById('pgb-'+pedId); if(b) b.style.display='block'; },20);
  // FIX: mismo patrón que ppDelLinea — antes borrar una línea de
  // galletas nunca se sincronizaba a Supabase, y una línea borrada muy
  // rápido (antes de que su alta terminara de sincronizar) podía quedar
  // huérfana ahí.
  if (pmDB.disponible() && l) {
    const escritura = (async () => {
      if (!l._sbId && l._sbPendingPromise) {
        await l._sbPendingPromise.catch(() => {});
      }
      if (!l._sbId) return;
      return pmDB.pedidos.lineas.eliminar(l._sbId);
    })().catch(e => {
      console.warn('[pmDB] pgDelLinea error:', e.message);
      pmToast('⚠️ Línea borrada solo local — no se borró en Supabase: ' + e.message, 'err');
    });
    _sbLineasPendientesGalletas.push(escritura);
    escritura.finally(() => {
      _sbLineasPendientesGalletas = _sbLineasPendientesGalletas.filter(p2 => p2 !== escritura);
    });
  }
}
function pgDel(id) {
  if (!confirm('¿Eliminar este pedido?')) return;
  const p = G.pedidosGalletas.find(x=>x.id===id);
  G.pedidosGalletas = G.pedidosGalletas.filter(x=>x.id!==id);
  pmSave('pedidos'); pgRender(); pmToast('Pedido eliminado');
  if (pmDB.disponible() && p?._sbId) {
    pmDB.hardDelete('pedidos', p._sbId)
      .catch(e => console.warn('[pmDB] pgDel error:', e.message));
  }
}
