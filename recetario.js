// ── 📚 RECETARIO ──────────────────────────────────────────────
let _recetarioActual = null;

function recetarioRender() {
  recetarioFiltrar();
  document.getElementById('rec-vista').style.display = 'none';
}

function recetarioFiltrar() {
  const q   = (document.getElementById('rec-sel-search').value||'').toLowerCase().trim();
  const cat = document.getElementById('rec-sel-cat').value||'';
  // Only R-type recipes (not raw GM) — SESIÓN 11: ahora leído de Supabase
  let list = _sbRecLista().filter(r => r.code && r.code.startsWith('R-'));
  if (q)   list = list.filter(r =>
    (r.name||'').toLowerCase().includes(q) || (r.code||'').toLowerCase().includes(q)
  );
  if (cat) list = list.filter(r => r.cat === cat);
  list.sort((a,b) => (a.code||'').localeCompare(b.code||''));

  const el = document.getElementById('rec-sel-list');
  const _recetarioSharedCache = new Map();
  if (!list.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--cream2);padding:8px">Sin recetas' + (q?` para "${q}"`:'') + '</div>';
    return;
  }

  el.innerHTML = list.map(r => {
    const c = pmCostoReceta(r, undefined, undefined, _recetarioSharedCache);
    const CAT = {pan:'🍞',pan_mm:'🌾',galleta:'🍪',masa:'🫧',otro:'📦'};
    const icon = CAT[r.cat||'otro']||'📦';
    const active = _recetarioActual === r.id;
    return `<button onclick="recetarioSeleccionar('${r.id}')"
      style="padding:8px 14px;border-radius:8px;border:1px solid ${active?'var(--gold)':'var(--border)'};
        background:${active?'rgba(200,146,42,.15)':'var(--sf)'};color:var(--cream);cursor:pointer;
        font-size:12px;text-align:left;display:flex;flex-direction:column;gap:2px;min-width:140px">
      <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold2)">${r.code}</span>
      <span style="font-weight:600">${icon} ${r.name}</span>
      <span style="font-size:10px;color:var(--cream2)">${r.totalMass||1000}g · ${c.totalMerma>0?pmMoney(Math.round(c.totalMerma)):'sin costo'}</span>
    </button>`;
  }).join('');
}

function recetarioSeleccionar(id) {
  _recetarioActual = id;
  recetarioFiltrar();
  const r = _sbGetRec(id) || (G.recetas||[]).find(x => x.id === id);
  if (!r) return;
  // Set masa objetivo to recipe's base mass
  document.getElementById('rec-masa-obj').value = r.totalMass || 1000;
  document.getElementById('rec-vista').style.display = 'block';
  recetarioEscalar();
  // Scroll to vista
  document.getElementById('rec-vista').scrollIntoView({behavior:'smooth', block:'start'});
}

/**
 * SESIÓN 11 — Calculadora alternativa: unidades a fabricar × peso por unidad.
 * Solo calcula la masa objetivo y la mete en el campo de siempre — la lógica
 * de escalado y merma sigue siendo exactamente la misma (recetarioEscalar).
 */
function recetarioCalcularPorUnidades() {
  const uds    = parseFloat(document.getElementById('rec-unidades-obj').value);
  const pesoUd = parseFloat(document.getElementById('rec-peso-ud-obj').value);
  if (!uds || !pesoUd) return; // esperar a que ambos campos tengan valor
  const masaObj = Math.round(uds * pesoUd);
  document.getElementById('rec-masa-obj').value = masaObj;
  recetarioEscalar();
}

async function recetarioEscalar() {
  const id = _recetarioActual;
  if (!id) return;
  // SESIÓN 11: mismo guard de seguridad que recEditar — si Supabase todavía
  // no terminó de cargar, esperamos antes de leer, para no calcular con
  // datos locales viejos/incompletos.
  if (pmDB.disponible() && !_sbRecCache) {
    await _sbCosteoCargar();
  }
  const r = _sbGetRec(id) || (G.recetas||[]).find(x => x.id === id);
  if (!r) return;

  const masaObj    = parseFloat(document.getElementById('rec-masa-obj').value) || 1000;
  const merma      = r.merma || 0;
  const baseMasaR  = r.totalMass || 1000;
  const baseUnits  = r.units || 1;
  const pesoBaseUd = baseMasaR / baseUnits; // peso neto por unidad base

  // Factor de escala = masa deseada / masa base
  const factor     = masaObj / baseMasaR;

  // Unidades a producir = factor × unidades base
  const units      = Math.round(factor * baseUnits * 100) / 100;

  // Masa real a mezclar = masa objetivo + merma
  const masaTotal  = masaObj * (1 + merma / 100);

  // Calcular receta base (1× factor) para costo unitario de referencia
  const cBase = pmCostoReceta(r, baseMasaR * (1 + merma/100));

  // Escalar: pmCostoReceta a masaTotal
  const c    = pmCostoReceta(r, masaTotal);
  const CAT  = {pan:'🍞', pan_mm:'🌾', galleta:'🍪', masa:'🫧', otro:'📦'};
  const icon = CAT[r.cat||'otro']||'📦';

  // Separate line types
  const ingLines   = c.lines.filter(l => !l.isSub && !l.isAddon);
  const subLines   = c.lines.filter(l =>  l.isSub);

  // Addons: scale by factor (gPorUnidad × units)
  const addonLines = (r.addons||[]).map(addon => {
    const ref = _sbRecLista().find(x => x.code === addon.recId);
    if (!ref || !addon.gPorUnidad) return null;
    const totalG  = addon.gPorUnidad * units;  // factor already in units
    const ca      = pmCostoReceta(ref, totalG);
    const label   = addon.label || (addon.tipo==='cobertura'?'🍫 ':'🍯 ') + ref.name;
    return { name: label, g: totalG, cost: ca.totalMerma,
             gPorUnidad: addon.gPorUnidad, tipo: addon.tipo, isAddon: true };
  }).filter(Boolean);

  const costIng    = ingLines.reduce((s,l)=>s+l.cost,0);
  const costSubs   = subLines.reduce((s,l)=>s+l.cost,0);
  const costMasa   = (costIng + costSubs) * (1 + merma/100);
  const costAddons = addonLines.reduce((s,l)=>s+l.cost,0);
  const costTotal  = costMasa + costAddons; // costo de materiales (como antes)

  // SESIÓN 11: costo total incluyendo mano de obra y gastos generales,
  // usando los mismos porcentajes ya guardados en la receta (modPct/ggPct)
  const modPct2   = r.modPct !== undefined ? r.modPct : 80;
  const ggPct2    = r.ggPct  !== undefined ? r.ggPct  : 45;
  const costMOD2  = costTotal * modPct2 / 100;
  const costGG2   = costTotal * ggPct2  / 100;
  const costFinal = costTotal + costMOD2 + costGG2;

  const gMasa    = ingLines.reduce((s,l)=>s+l.g,0) + subLines.reduce((s,l)=>s+l.g,0);
  const gAddons  = addonLines.reduce((s,l)=>s+l.g,0);
  const pesoUnit = pesoBaseUd; // always the base unit weight

  function row(label, pct, g, cost, style='') {
    return `<tr style="border-bottom:1px solid var(--border);${style}">
      <td style="padding:7px 10px;font-weight:500">${label}</td>
      <td style="padding:7px 10px;text-align:right;color:var(--cream2);font-size:12px">${pct?parseFloat(pct).toFixed(1)+'%':'—'}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:15px;font-weight:700;color:var(--gold2)">${g>0?Math.round(g)+'g':'—'}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--cream2)">${cost>0?pmMoney(Math.round(cost)):'—'}</td>
    </tr>`;
  }

  function subtotalRow(label, g, cost, color='var(--gold)') {
    return `<tr style="font-weight:700;background:rgba(200,146,42,.08)">
      <td style="padding:7px 10px;color:${color}" colspan="2">${label}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;color:${color}">${Math.round(g)}g</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;color:${color}">${cost>0?pmMoney(Math.round(cost)):'—'}</td>
    </tr>`;
  }

  function sectionHeader(label, color='var(--cream2)', bg='rgba(200,146,42,.06)') {
    return `<tr><td colspan="4" style="padding:6px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:${bg};color:${color}">${label}</td></tr>`;
  }

  // ── MASA section ─────────────────────────────────────────────
  let tbody = '';

  // Ingredientes
  if (ingLines.length) {
    tbody += sectionHeader('🌾 Ingredientes de masa');
    ingLines.forEach(l => {
      tbody += row((l.flour?'🌾 ':' ') + l.name, l.pct, l.g, l.cost);
    });
    tbody += subtotalRow('Subtotal ingredientes',
      ingLines.reduce((s,l)=>s+l.g,0),
      costIng);
  }

  // Sub-recetas
  if (subLines.length) {
    tbody += sectionHeader('🔗 Sub-recetas de masa', 'var(--blue)', 'rgba(74,128,192,.06)');
    subLines.forEach(l => {
      tbody += row(l.name, l.pct, l.g, l.cost);
    });
    tbody += subtotalRow('Subtotal sub-recetas',
      subLines.reduce((s,l)=>s+l.g,0),
      costSubs, 'var(--blue)');
  }

  // Merma
  if (merma > 0) {
    tbody += `<tr style="border-top:1px dashed var(--border)">
      <td style="padding:5px 10px;font-size:11px;color:var(--cream2)" colspan="2">Merma ${merma}% (se mezcla pero no se vende)</td>
      <td style="padding:5px 10px;text-align:right;font-size:11px;color:var(--cream2);font-family:'DM Mono',monospace">+${Math.round(masaTotal-masaObj)}g</td>
      <td style="padding:5px 10px;text-align:right;font-size:11px;color:var(--cream2);font-family:'DM Mono',monospace">+${pmMoney(Math.round((costIng+costSubs)*merma/100))}</td>
    </tr>`;
  }

  // Total masa
  tbody += `<tr style="font-weight:800;background:rgba(200,146,42,.14);border-top:2px solid var(--gold)">
    <td style="padding:8px 10px;color:var(--gold)" colspan="2">TOTAL MASA</td>
    <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:16px;color:var(--gold)">${Math.round(masaTotal)}g</td>
    <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">${costMasa>0?pmMoney(Math.round(costMasa)):'—'}</td>
  </tr>`;

  // ── RELLENOS / COBERTURAS ─────────────────────────────────────
  if (addonLines.length) {
    tbody += sectionHeader('🎂 Rellenos y coberturas', 'var(--red)', 'rgba(192,64,64,.06)');
    addonLines.forEach(l => {
      const gU = l.gPorUnidad || 0;
      tbody += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:7px 10px;font-weight:500">${l.name}</td>
        <td style="padding:7px 10px;text-align:right;color:var(--cream2);font-size:12px">${gU}g/ud</td>
        <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:15px;font-weight:700;color:var(--gold2)">${Math.round(l.g)}g</td>
        <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--cream2)">${l.cost>0?pmMoney(Math.round(l.cost)):'—'}</td>
      </tr>`;
    });
    tbody += `<tr style="font-weight:700;background:rgba(192,64,64,.08)">
      <td style="padding:7px 10px;color:var(--red)" colspan="2">Subtotal rellenos/coberturas</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--red)">${Math.round(gAddons)}g</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--red)">${costAddons>0?pmMoney(Math.round(costAddons)):'—'}</td>
    </tr>`;
  }

  // ── RESUMEN FINAL ─────────────────────────────────────────────
  tbody += `<tr style="background:rgba(0,0,0,.15);border-top:3px solid var(--gold)">
    <td colspan="4" style="padding:4px"></td>
  </tr>
  <tr style="background:rgba(200,146,42,.05)">
    <td style="padding:7px 10px;color:var(--cream2);font-size:12px" colspan="2">Factor de escala</td>
    <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">×${factor.toFixed(2)}</td>
    <td style="padding:7px 10px;text-align:right;font-size:11px;color:var(--cream2)">${masaObj}g ÷ ${baseMasaR}g base</td>
  </tr>
  <tr style="background:rgba(200,146,42,.05)">
    <td style="padding:7px 10px;color:var(--cream2);font-size:12px" colspan="2">Unidades a producir</td>
    <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--gold)">${Number.isInteger(units)?units:units.toFixed(1)} ud</td>
    <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--cream2)">${Math.round(pesoBaseUd)}g/ud</td>
  </tr>
  <tr style="background:rgba(200,146,42,.05)">
    <td style="padding:7px 10px;color:var(--cream2);font-size:12px" colspan="2">Costo por unidad</td>
    <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--cream2)">= costo base/ud</td>
    <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:var(--gold2)">${costTotal>0?pmMoney(Math.round(costTotal/units)):'—'}/ud</td>
  </tr>
  <tr style="font-weight:900;background:rgba(200,146,42,.18);border-top:2px solid var(--gold)">
    <td style="padding:10px;font-size:15px;color:var(--gold)" colspan="2">COSTO TOTAL (${Number.isInteger(units)?units:units.toFixed(1)} ud)</td>
    <td style="padding:10px;text-align:right;font-family:'DM Mono',monospace;font-size:13px;color:var(--cream)">×${factor.toFixed(2)} base</td>
    <td style="padding:10px;text-align:right;font-family:'DM Mono',monospace;font-size:18px;color:var(--gold2)">${costTotal>0?pmMoney(Math.round(costTotal)):'Sin costo'}</td>
  </tr>
  <tr><td colspan="4" style="padding:3px"></td></tr>
  <tr style="background:rgba(74,128,192,.05)">
    <td style="padding:6px 10px;color:var(--cream2);font-size:12px" colspan="2">👷 Mano de obra (${modPct2}% de materiales)</td>
    <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--blue)" colspan="2">${costMOD2>0?pmMoney(Math.round(costMOD2)):'—'}</td>
  </tr>
  <tr style="background:rgba(74,128,192,.05)">
    <td style="padding:6px 10px;color:var(--cream2);font-size:12px" colspan="2">🏭 Gastos generales (${ggPct2}% de materiales)</td>
    <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--blue)" colspan="2">${costGG2>0?pmMoney(Math.round(costGG2)):'—'}</td>
  </tr>
  <tr style="font-weight:900;background:rgba(74,144,96,.16);border-top:2px solid var(--green)">
    <td style="padding:10px;font-size:14px;color:var(--green)" colspan="2">💰 COSTO TOTAL con MOD + gastos</td>
    <td style="padding:10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--cream2)">${costFinal>0?pmMoney(Math.round(costFinal/units))+'/ud':'—'}</td>
    <td style="padding:10px;text-align:right;font-family:'DM Mono',monospace;font-size:18px;color:var(--green)">${costFinal>0?pmMoney(Math.round(costFinal)):'Sin costo'}</td>
  </tr>`;

  const notesHtml = r.notes ? `
    <div style="margin-top:16px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--gold);margin-bottom:6px">Procedimiento / Notas</div>
      <pre style="font-size:12px;color:var(--cream2);line-height:1.8;white-space:pre-wrap;font-family:'DM Sans',sans-serif">${r.notes}</pre>
    </div>` : '';

  document.getElementById('rec-vista-content').innerHTML = `
    <div id="rec-print-area">
      <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--gold);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:900;color:var(--cream)">${icon} ${r.name}</div>
          <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--gold2);margin-top:2px">${r.code} · factor ×${factor.toFixed(2)} · ${Number.isInteger(units)?units:units.toFixed(1)} unidades</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--cream2)">Masa objetivo</div>
          <div style="font-family:'DM Mono',monospace;font-size:24px;font-weight:700;color:var(--gold)">${masaObj}g</div>
          ${merma>0?`<div style="font-size:10px;color:var(--cream2)">+${merma}% merma → ${Math.round(masaTotal)}g</div>`:''}
        </div>
      </div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:var(--r);margin-bottom:12px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:rgba(200,146,42,.1)">
            <th style="padding:7px 10px;text-align:left">Componente</th>
            <th style="padding:7px 10px;text-align:right">% / Cant</th>
            <th style="padding:7px 10px;text-align:right;color:var(--gold)">Gramos</th>
            <th style="padding:7px 10px;text-align:right">Costo</th>
          </tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
      ${notesHtml}
    </div>`;
}

function recetarioImprimir() {
  const area = document.getElementById('rec-print-area');
  if (!area) return;
  const r = _sbGetRec(_recetarioActual) || (G.recetas||[]).find(x => x.id === _recetarioActual);
  const masa = document.getElementById('rec-masa-obj').value;
  const w = window.open('','_blank','width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${r?r.name:'Receta'} — ${masa}g</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600&family=DM+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;font-size:13px;color:#1a1006;padding:28px;background:#fff}
      h1{font-family:'Playfair Display',serif;font-size:24px;font-weight:900;margin-bottom:4px}
      table{width:100%;border-collapse:collapse}
      th{background:#f5e8d0;padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px}
      td{padding:8px 10px;border-bottom:1px solid #e8dcc8;vertical-align:middle}
      .tot td{font-weight:700;background:#fdf5e6;border-top:2px solid #C8922A;font-size:15px}
      .sub-hd td{background:#eaf0fa;font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#4060a0}
      .ing-hd td{background:#fdf5e6;font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#8a5a10}
      .mono{font-family:'DM Mono',monospace}
      .gold{color:#C8922A}
      pre{font-family:'DM Sans',sans-serif;white-space:pre-wrap;line-height:1.8;margin-top:8px;font-size:12px;color:#5a4020}
      .note-box{margin-top:16px;padding:12px;border:1px solid #e0c88a;border-radius:8px}
      .no-print{display:none}
      @media print{body{padding:16px}}
    </style>
  </head><body>`);
  w.document.write(area.innerHTML.replace(/var\(--[^)]+\)/g,'inherit').replace(/class="cpill"/g,''));
  w.document.write('</body></html>');
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
}

