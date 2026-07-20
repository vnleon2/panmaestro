// ── 📊 DASHBOARD ──────────────────────────────────────────
function dashNav(d) {
  const dt = new Date(document.getElementById('dash-date').value + 'T12:00:00');
  dt.setDate(dt.getDate()+d);
  document.getElementById('dash-date').value = dt.toISOString().slice(0,10);
  dashRender();
}

// ── Sincronización general desde Supabase ──
async function syncGeneral() {
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase','err'); return; }
  const btn = document.getElementById('sync-btn');
  const st  = document.getElementById('sync-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizando...'; }
  if (st) st.textContent = '';
  const t0 = Date.now();
  try {
    await Promise.all([
      panCargarSb().catch(e => console.warn('sync pan:', e.message)),
      gallCargarSb().catch(e => console.warn('sync gall:', e.message)),
      ingCargarSb().catch(e => console.warn('sync ing:', e.message)),
      _sbCosteoCargar().catch(e => console.warn('sync costeo:', e.message)),
      _sbCliCargar().catch(e => console.warn('sync cli:', e.message)),
      estCargarSb().catch(e => console.warn('sync estados:', e.message)),
    ]);
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    if (st) st.textContent = `✓ Sincronizado en ${seg}s`;
    pmToast('Sincronización completa ✓');
  } catch(e) {
    if (st) st.textContent = 'Error en sincronización';
    pmToast('Error al sincronizar','err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '☁️ Sincronizar todo'; }
  }
}

function dashRender() {
  const fecha = document.getElementById('dash-date').value || pmHoy();
  const x = new Date(fecha+'T12:00:00');
  document.getElementById('dash-label').textContent =
    `${DIAS_L[x.getDay()]} ${x.getDate()} de ${MESES_L[x.getMonth()]} ${x.getFullYear()}`;

  const pan  = G.pedidosPan.filter(p=>p.date===fecha);
  const gall = G.pedidosGalletas.filter(p=>p.date===fecha);
  const com  = G.pedidosCom.filter(p=>p.date===fecha);
  const gastos = G.gastos.filter(g=>g.fecha===fecha);

  let rev = 0;
  pan.forEach(p=>rev+=pmTotalPan(p));
  gall.forEach(p=>rev+=pmTotalGall(p));
  com.forEach(p=>rev+=pmTotalCom(p));
  const gast = gastos.reduce((s,g)=>s+g.monto,0);
  const pend = pan.filter(p=>!['Pagado','En recepción pagado'].includes(p.status)).length;

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat"><div class="stat-lbl">Pedidos</div><div class="stat-val">${pan.length+gall.length+com.length}</div><div class="stat-sub">${pend} pendientes</div></div>
    <div class="stat"><div class="stat-lbl">Ventas est.</div><div class="stat-val" style="font-size:16px">${pmMoney(rev)}</div></div>
    <div class="stat"><div class="stat-lbl">Gastos</div><div class="stat-val" style="font-size:16px;color:var(--red)">${pmMoney(gast)}</div></div>
    <div class="stat"><div class="stat-lbl">Margen</div><div class="stat-val" style="font-size:16px;color:var(--green)">${pmMoney(rev-gast)}</div></div>
  `;

  const all = [
    ...pan.map(p=>({...p,tipo:'pan'})),
    ...gall.map(p=>({...p,tipo:'gall'})),
    ...com.map(p=>({...p,tipo:'com'}))
  ];

  const el = document.getElementById('dash-list');
  if (!all.length) { el.innerHTML='<div class="ph"><span class="ph-icon">📭</span>Sin pedidos para este día</div>'; return; }
  el.innerHTML = all.map(p=>{
    const icon = p.tipo==='pan'?'🍞':p.tipo==='gall'?'🍪':'🏪';
    const tot  = p.tipo==='pan'?pmTotalPan(p):p.tipo==='gall'?pmTotalGall(p):pmTotalCom(p);
    const items = p.lineas.map(l=>{
      const nom = p.tipo==='gall'?pmNombreGall(l.pid):pmNombrePan(l.pid);
      return `${l.cant}× ${nom}`;
    }).join(', ');
    return `<div class="ped-card">
      <div class="ped-head" style="cursor:default">
        <div class="ped-cli">${icon} ${p.cli}</div>
        <div class="ped-meta" style="font-size:11px;color:var(--cream2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${items||'Sin productos'}</div>
        ${pmBadge(p.status)}
        <div class="ped-total">${pmMoney(tot)}</div>
      </div>
    </div>`;
  }).join('');
}
