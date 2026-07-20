// ── 💰 GASTOS ──────────────────────────────────────────
function gastoAdd() {
  const fecha = document.getElementById('g-fecha').value || pmHoy();
  const prov  = document.getElementById('g-prov').value.trim();
  const det   = document.getElementById('g-det').value.trim();
  const monto = parseFloat(document.getElementById('g-monto').value)||0;
  if (!prov||!monto) { pmToast('Completá proveedor y monto','err'); return; }
  const newId = pmId();
  G.gastos.push({ id: newId, fecha, prov, det, monto, _sbId: null });
  document.getElementById('g-prov').value='';
  document.getElementById('g-det').value='';
  document.getElementById('g-monto').value='';
  pmSave('sistema'); gastoRender(); pmToast('Gasto registrado ✓');
  // ── Sesión 8: dual write a Supabase ──
  if (pmDB.disponible()) {
    pmDB.gastos.crear({ fecha, proveedor_nom: prov, detalle: det, monto })
      .then(rows => {
        if (rows?.[0]?.id) {
          const g = G.gastos.find(x => x.id === newId);
          if (g) g._sbId = rows[0].id;
        }
      })
      .catch(e => console.warn('[pmDB] gastoAdd:', e.message));
  }
}

function gastoRender() {
  const q   = document.getElementById('g-search').value.toLowerCase();
  const mes = document.getElementById('g-mes').value;
  let list  = G.gastos;
  if (q)   list = list.filter(g => g.prov.toLowerCase().includes(q)||(g.det||'').toLowerCase().includes(q));
  if (mes) list = list.filter(g => g.fecha.startsWith(mes));
  list = [...list].sort((a,b) => b.id-a.id);
  const total = list.reduce((s,g)=>s+g.monto,0);
  const prom  = list.length ? total/list.length : 0;
  document.getElementById('g-stats').innerHTML = `
    <div class="stat"><div class="stat-lbl">Total</div><div class="stat-val" style="font-size:18px;color:var(--red)">${pmMoney(total)}</div><div class="stat-sub">${list.length} registros</div></div>
    <div class="stat"><div class="stat-lbl">Promedio</div><div class="stat-val" style="font-size:18px">${pmMoney(Math.round(prom))}</div><div class="stat-sub">por registro</div></div>
  `;
  const el = document.getElementById('g-list');
  if (!list.length) { el.innerHTML='<div class="ph"><span class="ph-icon">💰</span>Sin gastos registrados</div>'; return; }
  el.innerHTML = list.map(g => `
    <div class="item-row">
      <div style="min-width:48px;font-size:10px;color:var(--cream2)">${pmFmtDateShort(g.fecha)}</div>
      <div style="flex:1"><div class="item-name">${g.prov}</div><div style="font-size:11px;color:var(--cream2)">${g.det||''}</div></div>
      <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--gold2)">${pmMoney(g.monto)}</div>
      <button class="btn btn-red btn-xs" onclick="gastoDel(${g.id})">✕</button>
    </div>`).join('');
}

function gastoDel(id) {
  const g = G.gastos.find(x => x.id === id);
  G.gastos = G.gastos.filter(x=>x.id!==id);
  pmSave('sistema'); gastoRender();
  // ── Sesión 8: eliminar de Supabase si tiene sbId ──
  if (g?._sbId && pmDB.disponible()) {
    pmDB.gastos.eliminar(g._sbId).catch(e => console.warn('[pmDB] gastoDel:', e.message));
  }
}

