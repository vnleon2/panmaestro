// ── 📖 COSTEO ──────────────────────────────────────────
function cvMostrar(id) {
  ['cv-lista','cv-nueva','cv-gm','cv-maestro','cv-personal'].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = v===id ? 'block' : 'none';
  });
}

function fillRscSel() {
  const sel = document.getElementById('rsc-sel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— seleccionar —</option>' +
    _sbRecLista().map(r => `<option value="${r.id}">${r.code} · ${r.name}</option>`).join('');
}

function rscCalc() {
  const id    = document.getElementById('rsc-sel').value;
  const mass  = parseFloat(document.getElementById('rsc-mass').value)||0;
  const units = parseInt(document.getElementById('rsc-units').value)||1;
  const el    = document.getElementById('rsc-result');
  if (!id||!mass) { el.innerHTML=''; return; }
  const r = _sbGetRec(id) || (G.recetas||[]).find(x=>x.id===id);
  if (!r) return;
  const c = pmCostoReceta(r, mass);
  el.innerHTML = `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px">
    <div style="font-size:11px;color:var(--cream2);margin-bottom:8px">Escalado para ${mass}g · ${units} ud</div>
    ${c.lines.map(l=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--border)">
      <span>${l.name||'—'}</span>
      <span style="font-family:'DM Mono',monospace;color:var(--gold2)">${l.g.toFixed(1)}g</span>
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;padding:6px 0 0;color:var(--gold2)">
      <span>Costo total</span><span>${pmMoney(Math.round(c.totalMerma))}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--cream2)">
      <span>Por unidad</span><span>${pmMoney(Math.round(c.totalMerma/units))}</span>
    </div>
  </div>`;
}

function recRender() {
  const q   = (document.getElementById('rec-search')||{}).value?.toLowerCase().trim()||'';
  const cat = (document.getElementById('rec-cat')||{}).value||'';
  let list  = _sbRecLista().filter(r => r.code && r.code.startsWith('R-'));

  if (q) list = list.filter(r => {
    const name  = (r.name||'').toLowerCase();
    const code  = (r.code||'').toLowerCase();
    const notes = (r.notes||'').toLowerCase();
    const ings  = [...(r.flour||[]), ...(r.other||[])]
      .map(i => (i.productName||i.manualName||'').toLowerCase()).join(' ');
    return name.includes(q) || code.includes(q) || notes.includes(q) || ings.includes(q);
  });

  if (cat) list = list.filter(r => r.cat === cat);

  // Orden elegido: código (por defecto) o alfabético. Se recuerda en
  // localStorage para que quede como el usuario lo dejó la última vez.
  const ordenEl = document.getElementById('rec-orden');
  let orden = ordenEl ? ordenEl.value : (localStorage.getItem('pm_rec_orden') || 'codigo');
  if (ordenEl && !ordenEl.dataset.init) {
    ordenEl.value = localStorage.getItem('pm_rec_orden') || 'codigo';
    orden = ordenEl.value;
    ordenEl.dataset.init = '1';
  }
  localStorage.setItem('pm_rec_orden', orden);
  list = orden === 'nombre'
    ? list.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'es'))
    : list.sort((a,b) => (a.code||'').localeCompare(b.code||''));

  const el = document.getElementById('rec-list');
  if (!el) return;

  if (!list.length) {
    const total = _sbRecLista().length;
    el.innerHTML = `<div class="ph" style="flex-direction:column;align-items:flex-start;padding:20px">
      <span style="font-size:28px">📖</span>
      <div style="font-size:14px;font-weight:600;color:var(--cream);margin:8px 0 4px">
        ${q ? `Sin resultados para "${q}"` : 'Sin recetas'}
      </div>
      <div style="font-size:12px;color:var(--cream2)">
        ${total ? `Hay ${total} receta(s) en total — probá otro término` : 'Creá una con "+ Nueva receta"'}
      </div>
    </div>`;
    return;
  }

  // SESIÓN 11: caché compartido para toda la lista (evita recalcular
  // la misma sub-receta/relleno una y otra vez por cada tarjeta)
  const _sharedCache = new Map();
  el.innerHTML = list.map(r => recCard(r, _sharedCache)).join('');
}

const CAT_ICON = {pan:'🍞',pan_mm:'🌾',galleta:'🍪',masa:'🫧',otro:'📦'};

function recCard(r, _sharedCache) {
  const c = pmCostoReceta(r, undefined, undefined, _sharedCache);
  const icon = CAT_ICON[r.cat||'otro']||'📦';
  const mass = r.totalMass || 1000;

  // Separate lines by type
  const ingLines   = c.lines.filter(l => !l.isSub && !l.isAddon);
  const subLines   = c.lines.filter(l => l.isSub);
  const addonLines = c.lines.filter(l => l.isAddon);

  const costIng    = ingLines.reduce((s,l)=>s+l.cost,0);
  const costSubs   = subLines.reduce((s,l)=>s+l.cost,0);
  const costAddons = addonLines.reduce((s,l)=>s+l.cost,0);
  // SESIÓN 11: mismos subtotales pero en peso (g), para mostrar junto al costo
  const pesoIng    = ingLines.reduce((s,l)=>s+(l.g||0),0);
  const pesoSubs   = subLines.reduce((s,l)=>s+(l.g||0),0);
  const pesoAddons = addonLines.reduce((s,l)=>s+(l.g||0),0);
  const merma      = r.merma || 0;
  // FIX: recCard() recalculaba costMatTotal desde cero con la fórmula
  // vieja — (ing+subs+addons)*(1+merma) — en vez de usar el valor ya
  // corregido de pmCostoReceta() (c.totalMerma). Esto reintroducía en
  // esta pantalla el mismo bug de merma duplicada en addons (B1,
  // Sesión 2) aunque el motor de cálculo ya estaba arreglado. Ahora la
  // merma se aplica solo a masa (ingredientes+subrecetas); los addons
  // se suman después, sin merma adicional — igual que en pmCostoReceta().
  const costMatTotal = (costIng + costSubs) * (1 + merma/100) + costAddons;
  const modPct = r.modPct !== undefined ? r.modPct : 80;
  const ggPct  = r.ggPct  !== undefined ? r.ggPct  : 45;
  const costMOD = costMatTotal * modPct / 100;
  const costGG  = costMatTotal * ggPct  / 100;
  const costTotal   = costMatTotal + costMOD + costGG;
  const units       = r.units || 1;
  const costTotalUd = costTotal / units;
  const costTotalG  = r.totalMass ? costTotal / r.totalMass : 0;

  function tblRow(l) {
    const costCell = l.cost > 0 ? pmMoney(Math.round(l.cost)) : '—';
    const icon = l.isSub ? '🔗' : l.flour ? '🌾' : '·';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px">${icon} ${l.name||'—'}</td>
      <td style="padding:5px 8px;text-align:right;color:var(--cream2);font-size:11px">${parseFloat(l.pct||0).toFixed(1)}%</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px">${l.g>0?l.g.toFixed(1)+'g':'—'}</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;color:${l.cost>0?'var(--gold2)':'var(--cream2)'}">${costCell}</td>
    </tr>`;
  }

  const ingSection = ingLines.length ? `
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--cream2);padding:6px 8px 2px;background:rgba(200,146,42,.05)">Ingredientes</div>
    ${ingLines.map(tblRow).join('')}
    <tr style="background:rgba(200,146,42,.06);font-weight:600">
      <td style="padding:5px 8px" colspan="2">Subtotal ingredientes</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px">${pesoIng.toFixed(0)}g</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">${pmMoney(Math.round(costIng))}</td>
    </tr>` : '';

  const subSection = subLines.length ? `
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--blue);padding:6px 8px 2px;background:rgba(74,128,192,.05)">Sub-recetas / Rellenos / Coberturas</div>
    ${subLines.map(tblRow).join('')}
    <tr style="background:rgba(74,128,192,.06);font-weight:600">
      <td style="padding:5px 8px" colspan="2">Subtotal sub-recetas</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px">${pesoSubs.toFixed(0)}g</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--blue)">${pmMoney(Math.round(costSubs))}</td>
    </tr>` : '';

  const addonSection = addonLines.length ? `
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--red);padding:6px 8px 2px;background:rgba(192,64,64,.05)">Rellenos / Coberturas</div>
    ${addonLines.map(l=>`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px">${l.name}</td>
      <td style="padding:5px 8px;text-align:right;color:var(--cream2);font-size:11px">${l.gPorUnidad}g/ud</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px">${l.g.toFixed(0)}g</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">${pmMoney(Math.round(l.cost))}</td>
    </tr>`).join('')}
    <tr style="background:rgba(192,64,64,.06);font-weight:600">
      <td style="padding:5px 8px" colspan="2">Subtotal rellenos/coberturas</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px">${pesoAddons.toFixed(0)}g</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--red)">${pmMoney(Math.round(costAddons))}</td>
    </tr>` : '';

  const mermaRow = merma > 0 ? `
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:5px 8px;font-size:11px;color:var(--cream2)" colspan="3">Merma ${merma}% (solo sobre masa, no sobre rellenos/coberturas)</td>
      <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:var(--cream2)">+${pmMoney(Math.round((costIng+costSubs)*merma/100))}</td>
    </tr>` : '';

  return `<div class="rec-card">
    <div class="rec-head" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
      <span class="rec-code">${r.code}</span>
      <span class="rec-name">${icon} ${r.name}</span>
      <span class="rec-meta">${mass}g · ${r.units||1} ud</span>
      <div style="text-align:right">
        <div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--gold2);font-weight:700">${pmMoney(Math.round(costTotal))}</div>
        <div style="font-size:10px;color:var(--cream2)">${pmMoney(Math.round(costTotalUd))}/ud</div>
      </div>
    </div>
    <div class="rec-body">
      <div class="cpills">
        <div class="cpill">🌾 Ing: <span>${pmMoney(Math.round(costIng))}</span></div>
        ${subLines.length?`<div class="cpill">🔗 Subs: <span>${pmMoney(Math.round(costSubs))}</span></div>`:''}
        ${addonLines.length?`<div class="cpill">🎂 Rellenos: <span>${pmMoney(Math.round(costAddons))}</span></div>`:''}
        ${merma?`<div class="cpill">Merma: <span>${merma}%</span></div>`:''}
        <div class="cpill" style="background:rgba(200,146,42,.15)">Total: <span style="color:var(--gold2)">${pmMoney(Math.round(costTotal))}</span></div>
        <div class="cpill">💰 Costo/ud: <span style="color:var(--gold2)">${pmMoney(Math.round(costTotalUd))}</span></div>
        <div class="cpill">₡/g: <span>${costTotalG.toFixed(2)}</span></div>
        ${(() => {
          const margen = (r.margen !== undefined ? r.margen : (G.margenDefault || 40));
          const m = margen / 100;
          const ps = m < 1 ? costTotalUd / (1 - m) : null;
          if (!ps) return '';
          return `<div class="cpill" style="background:rgba(74,144,96,.15);border-color:rgba(74,144,96,.3)">🏷 Precio/ud: <span style="color:var(--green)">${pmMoney(Math.round(ps))}</span><span style="font-size:9px;color:var(--cream2)"> (${margen}% mg)</span></div>`;
        })()}
      </div>
      <table class="ing-tbl" style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:rgba(200,146,42,.08)">
          <th style="padding:5px 8px;text-align:left">Componente</th>
          <th style="padding:5px 8px;text-align:right">%</th>
          <th style="padding:5px 8px;text-align:right">g</th>
          <th style="padding:5px 8px;text-align:right">Costo</th>
        </tr></thead>
        <tbody>
          ${ingSection}
          ${subSection}
          ${addonSection}
          ${mermaRow}
          <tr style="background:rgba(200,146,42,.08);font-weight:600;border-top:2px solid rgba(200,146,42,.3)">
            <td style="padding:6px 8px;font-size:12px" colspan="3">📦 Total costo materiales</td>
            <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">${pmMoney(Math.round(costMatTotal))}</td>
          </tr>
          <tr style="background:rgba(74,144,96,.08);font-weight:600">
            <td style="padding:6px 8px;font-size:12px" colspan="2">⚖️ Peso total${addonLines.length?' (con relleno)':''}</td>
            <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--green)">${c.mass.toFixed(0)}g</td>
            <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:var(--cream2)">${r.units>1?(c.mass/r.units).toFixed(0)+'g/ud':'—'}</td>
          </tr>
          <tr style="background:rgba(74,128,192,.06);border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-size:11px">👷 Mano de obra
              <input type="number" value="${modPct}" min="0" max="999" step="1"
                style="width:45px;margin-left:6px;padding:2px 4px;background:var(--sf);border:1px solid var(--border);border-radius:4px;color:var(--cream);font-size:11px;text-align:right"
                onchange="cvActualizarMOD('${r.id}', this.value)"> %
            </td>
            <td style="padding:5px 8px;text-align:right;font-size:11px;color:var(--cream2)">${modPct}%</td>
            <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px">—</td>
            <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--blue)">${pmMoney(Math.round(costMOD))}</td>
          </tr>
          <tr style="background:rgba(74,128,192,.04);border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-size:11px">🏭 Gastos generales
              <input type="number" value="${ggPct}" min="0" max="999" step="1"
                style="width:45px;margin-left:6px;padding:2px 4px;background:var(--sf);border:1px solid var(--border);border-radius:4px;color:var(--cream);font-size:11px;text-align:right"
                onchange="cvActualizarGG('${r.id}', this.value)"> %
            </td>
            <td style="padding:5px 8px;text-align:right;font-size:11px;color:var(--cream2)">${ggPct}%</td>
            <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px">—</td>
            <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--blue)">${pmMoney(Math.round(costGG))}</td>
          </tr>
          <tr style="background:rgba(200,146,42,.12);font-weight:700;border-top:2px solid var(--gold)">
            <td style="padding:6px 8px" colspan="3">COSTO TOTAL (${units} ud · ${r.totalMass||0}g)</td>
            <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">${pmMoney(Math.round(costTotal))}</td>
          </tr>
          <tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-size:11px;color:var(--cream2)" colspan="3">💰 Costo por unidad (÷ ${units} ud)</td>
            <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-weight:600;color:var(--gold2)">${pmMoney(Math.round(costTotalUd))}</td>
          </tr>
          <tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px;font-size:11px;color:var(--cream2)" colspan="3">₡/g (÷ ${r.totalMass||0}g)</td>
            <td style="padding:5px 8px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:var(--cream2)">${costTotalG.toFixed(2)}</td>
          </tr>
          ${(() => {
            const margen = (r.margen !== undefined ? r.margen : (G.margenDefault || 40));
            const m = margen / 100;
            const ps = m < 1 ? costTotalUd / (1 - m) : null;
            if (!ps) return '';
            return `<tr style="background:rgba(74,144,96,.1);border-top:2px solid rgba(74,144,96,.3);font-weight:700">
              <td style="padding:6px 8px;color:var(--green)" colspan="3">🏷 Precio sugerido/ud (${margen}% margen)</td>
              <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--green)">${pmMoney(Math.round(ps))}</td>
            </tr>`;
          })()}
        </tbody>
      </table>
      ${r.notes?`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:11px;color:var(--cream2);white-space:pre-wrap;margin-top:8px">${r.notes}</div>`:''}
      <div style="margin-top:10px;display:flex;gap:6px">
        <button class="btn btn-out btn-sm" onclick="recEditar('${r.id}')">✏️ Editar</button>
        <button class="btn btn-red btn-sm" onclick="recEliminar('${r.id}')">🗑 Eliminar</button>
      </div>
    </div>
  </div>`;
}

// ── Actualizar MOD% y GG% directamente desde el costeo ──
function cvActualizarMOD(recId, val) {
  const r = _sbGetRec(recId) || G.recetas.find(x => x.id===recId);
  if (!r) return;
  r.modPct = parseFloat(val) || 0;
  pmSave('costeo');
  cvMaestroRender();
}
function cvActualizarGG(recId, val) {
  const r = _sbGetRec(recId) || G.recetas.find(x => x.id===recId);
  if (!r) return;
  r.ggPct = parseFloat(val) || 0;
  pmSave('costeo');
  cvMaestroRender();
}

let mrIngCount = 0, mrSubCount = 0;

function recNuevo() {
  window._mrEditUpdatedAt = null; // punto 5: sin receta base, nada que comparar al guardar
  document.getElementById('cv-nueva-titulo').textContent = 'Nueva receta';
  document.getElementById('mr-id').value = '';
  document.getElementById('mr-code').value = 'R-' + String(_sbRecLista().filter(r=>r.code&&r.code.startsWith('R-')).length+1).padStart(4,'0');
  // FIX SESIÓN 2 (B2): reactivar el campo código — solo queda bloqueado
  // al editar una receta ya existente (ver recEditar).
  document.getElementById('mr-code').disabled = false;
  document.getElementById('mr-name').value = '';
  document.getElementById('mr-masa').value = 1000;
  document.getElementById('mr-units').value = 1;
  document.getElementById('mr-merma').value = 0;
  document.getElementById('mr-mod') && (document.getElementById('mr-mod').value = '');
  document.getElementById('mr-gg')  && (document.getElementById('mr-gg').value  = '');
  document.getElementById('mr-notes').value = '';
  document.getElementById('mr-cat').value = 'pan';
  document.getElementById('mr-ing-list').innerHTML = '';
  document.getElementById('mr-sub-list').innerHTML = '';
  document.getElementById('mr-addon-list').innerHTML = '';
  document.getElementById('mr-ing-empty').style.display = 'block';
  mrIngCount = 0; mrSubCount = 0; window._mrAddonCount = 0;
}

async function recEditar(id) {
  // SESIÓN 11 fix crítico: si la descarga de Supabase todavía no terminó,
  // esperamos a que termine ANTES de abrir el formulario — así nunca se
  // abre "Editar" con datos viejos/incompletos que luego, al Guardar,
  // podrían sobrescribir rellenos/coberturas reales con datos vacíos.
  if (pmDB.disponible() && !_sbRecCache) {
    await _sbCosteoCargar();
  }
  const r = _sbGetRec(id) || (G.recetas||[]).find(x=>x.id===id);
  if (!r) return;
  // Punto 5 del plan de auditoría: guardamos con qué updated_at se abrió
  // este formulario, para poder detectar en recSave() si alguien más
  // (otro dispositivo/pestaña) cambió la receta mientras la editábamos.
  window._mrEditUpdatedAt = r.updated_at || null;
  cvMostrar('cv-nueva');
  document.getElementById('cv-nueva-titulo').textContent = 'Editar: ' + r.name;
  document.getElementById('mr-id').value = r.id;
  document.getElementById('mr-code').value = r.code;
  // FIX SESIÓN 2 (B2): el código queda BLOQUEADO al editar una receta ya
  // existente. Antes se podía cambiar aquí, se actualizaba solo en
  // G.recetas (local), pero el payload de actualización a Supabase nunca
  // incluye `codigo` — quedaba desincronizado entre el navegador y
  // Supabase, y como sub-recetas/addons resuelven por código (Sesión 11),
  // eso podía romper esa resolución en otros dispositivos sin aviso.
  // Opción "simple" del informe de auditoría: no se puede editar el
  // código de una receta que ya existe.
  document.getElementById('mr-code').disabled = true;
  document.getElementById('mr-name').value = r.name;
  document.getElementById('mr-masa').value = r.totalMass||1000;
  document.getElementById('mr-units').value = r.units||1;
  document.getElementById('mr-merma').value = r.merma||0;
  document.getElementById('mr-margen').value = r.margen!==undefined ? r.margen : '';
  document.getElementById('mr-mod') && (document.getElementById('mr-mod').value = r.modPct!==undefined ? r.modPct : '');
  document.getElementById('mr-gg')  && (document.getElementById('mr-gg').value  = r.ggPct!==undefined  ? r.ggPct  : '');
  document.getElementById('mr-notes').value = r.notes||'';
  document.getElementById('mr-cat').value = r.cat||'pan';
  document.getElementById('mr-ing-list').innerHTML = '';
  document.getElementById('mr-sub-list').innerHTML = '';
  document.getElementById('mr-addon-list').innerHTML = '';
  mrIngCount = 0; mrSubCount = 0; window._mrAddonCount = 0;
  (r.flour||[]).forEach(i=>mrAddIng(i.productName||i.manualName||'', i.pct, true, i.ingredientId||''));
  (r.other||[]).forEach(i=>mrAddIng(i.productName||i.manualName||'', i.pct, false, i.ingredientId||''));
  (r.subrecs||[]).forEach(s=>mrAddSub(s));
  (r.addons||[]).forEach(a=>mrAddAddon(a));
  mrRefreshEmpty();
  document.getElementById('pg-costeo').scrollTo({top:0, behavior:'smooth'});
}

function mrRefreshEmpty() {
  const list = document.getElementById('mr-ing-list');
  const sub  = document.getElementById('mr-sub-list');
  const empty= document.getElementById('mr-ing-empty');
  if (!empty) return;
  const hasItems = list.children.length > 0 || sub.children.length > 0;
  empty.style.display = hasItems ? 'none' : 'block';
}

function mrAddIng(name='', pct='', isFlour=false, ingredientId='') {
  mrIngCount++;
  const uid = 'mri-' + mrIngCount;
  const dlId = 'dl-' + mrIngCount;
  // Build datalist options from ingredientes cache (Supabase + local)
  const dlOpts = Object.keys(_sbIngLista()).map(k => `<option value="${k}">`).join('');
  const hasCosto = name && _sbGetIng(name);
  const costoHint = hasCosto
    ? `<span style="font-size:10px;color:var(--green)">✓ con costo</span>`
    : name
      ? `<span style="font-size:10px;color:var(--cream2)">sin costo — registrá en Maestros</span>`
      : '';
  const div = document.createElement('div');
  div.id = uid;
  div.style.cssText = 'margin-bottom:8px;padding:8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px';
  div.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <select style="flex:0 0 80px;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)">
        <option value="flour"${isFlour?' selected':''}>Harina</option>
        <option value="other"${!isFlour?' selected':''}>Otro</option>
      </select>
      <div style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:3px">
        <input type="text" id="inp-${uid}" value="${name}" data-ing-id="${ingredientId||''}" placeholder="Tocar para buscar ingrediente..."
          readonly
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);cursor:pointer"
          onclick="ingPickerOpen('${uid}')">
        <span id="hint-${uid}" style="font-size:10px;margin-left:2px">${costoHint}</span>
      </div>
      <input type="number" placeholder="%" value="${pct}" min="0" step="0.1"
        style="flex:0 0 72px;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);text-align:center">
      <button class="btn btn-red btn-xs" onclick="document.getElementById('${uid}').remove();mrRefreshEmpty()">✕</button>
    </div>`;
  document.getElementById('mr-ing-list').appendChild(div);
  mrRefreshEmpty();
}

function mrCheckCosto(input, uid) {
  const name = input.value.trim();
  const hint = document.getElementById('hint-' + uid);
  if (!hint) return;
  if (!name) { hint.innerHTML = ''; return; }
  if (G.ingredientes[name] || _sbGetIng(name)) {
    const ing = _sbGetIng(name) || G.ingredientes[name];
    const cpg = ing.price / ing.qty;
    hint.innerHTML = `<span style="color:var(--green)">✓ con costo — ₡${cpg.toFixed(2)}/g</span>`;
  } else {
    hint.innerHTML = `<span style="color:var(--amber);cursor:pointer;text-decoration:underline"
      onclick="ingPickerOpen('${uid}')">⚠ Sin costo — tocar para elegir del maestro</span>`;
  }
}

function ingPickerOpen(uid) {
  // Store which uid we're filling
  document.getElementById('ing-picker-modal').dataset.uid = uid;
  document.getElementById('ing-picker-search').value = '';
  ingPickerRender();
  document.getElementById('ing-picker-modal').style.display = 'block';
  setTimeout(() => document.getElementById('ing-picker-search').focus(), 100);
}

function ingPickerClose() {
  document.getElementById('ing-picker-modal').style.display = 'none';
}

function ingPickerRender() {
  const q    = document.getElementById('ing-picker-search').value.toLowerCase();
  const keys = Object.keys(_sbIngLista()).filter(k => !q || k.toLowerCase().includes(q)).sort();
  const list = document.getElementById('ing-picker-list');
  list.innerHTML = '';
  if (!keys.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--cream2);font-size:13px">Sin resultados</div>';
    return;
  }
  keys.forEach(k => {
    const ing = _sbGetIng(k) || {};
    const cpg = ing.price && ing.qty ? '₡' + (ing.price/ing.qty).toFixed(2) + '/g' : 'sin precio';
    const hasCosto = ing.price > 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = [
      'width:100%','display:flex','justify-content:space-between','align-items:center',
      'padding:12px 14px','border:none','border-bottom:1px solid var(--border)',
      'background:transparent','cursor:pointer','text-align:left',
      'transition:background .12s'
    ].join(';');
    btn.innerHTML = `
      <span style="font-size:14px;font-weight:600;color:var(--cream)">${k}</span>
      <span style="font-size:11px;font-family:'DM Mono',monospace;
        color:${hasCosto?'var(--gold2)':'var(--cream2)'}">
        ${cpg}
      </span>`;
    btn.addEventListener('pointerdown', () => btn.style.background = 'rgba(200,146,42,.18)');
    btn.addEventListener('pointerup',   () => btn.style.background = '');
    btn.addEventListener('pointerout',  () => btn.style.background = '');
    btn.addEventListener('click', () => ingPickerSelect(k));
    list.appendChild(btn);
  });
}

function ingPickerSelect(name) {
  const uid  = document.getElementById('ing-picker-modal').dataset.uid;
  const inp  = document.getElementById('inp-' + uid);
  const hint = document.getElementById('hint-' + uid);
  if (inp) {
    inp.value = name;
    // SESIÓN 11: guardar el id estable del ingrediente junto al nombre visible
    const ing = _sbGetIng(name);
    inp.dataset.ingId = ing?.sbId || _sbIngMap?.[name] || '';
  }
  if (hint) {
    const ing = _sbGetIng(name) || G.ingredientes[name];
    if (ing) {
      hint.innerHTML = `<span style="color:var(--green)">✓ con costo — ₡${(ing.price/ing.qty).toFixed(2)}/g</span>`;
    } else {
      hint.innerHTML = `<span style="color:var(--amber);cursor:pointer;text-decoration:underline"
        onclick="ingPickerOpen('${uid}')">⚠ Sin costo — tocar para elegir</span>`;
    }
  }
  ingPickerClose();
  pmToast(name + ' asignado ✓');
}

function mrAddSub(data={}) {
  mrSubCount++;
  const uid = 'mrs-' + mrSubCount;
  const recOpts = _sbRecLista()
    .filter(r => r.code && r.code.startsWith('R-'))
    .sort((a,b) => (a.code||'').localeCompare(b.code||''))
    .map(r => `<option value="${r.code}"${r.code===data.recId?' selected':''}>${r.code} · ${r.name}</option>`)
    .join('');

  const div = document.createElement('div');
  div.id = uid;
  div.style.cssText = 'background:rgba(74,128,192,.06);border:1px solid rgba(74,128,192,.25);border-radius:8px;padding:10px;margin-bottom:8px';
  div.innerHTML = `
    <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--blue);margin-bottom:8px;font-weight:600">🔗 Sub-receta / Relleno / Cobertura</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
      <div style="flex:2;min-width:140px">
        <label style="font-size:11px;color:var(--cream2)">Receta base</label>
        <select id="sub-rec-${uid}"
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)"
          onchange="mrSubCostPreview('${uid}')">
          <option value="">— seleccionar —</option>${recOpts}
        </select>
      </div>
      <div style="width:68px">
        <label style="font-size:11px;color:var(--cream2)">% masa</label>
        <input type="number" id="sub-pct-${uid}" placeholder="10" value="${data.pct||''}"
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)"
          oninput="mrSubCostPreview('${uid}')">
      </div>
      <div style="width:72px">
        <label style="font-size:11px;color:var(--cream2)">g fijos</label>
        <input type="number" id="sub-g-${uid}" placeholder="0" value="${data.gFijos||''}"
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)"
          oninput="mrSubCostPreview('${uid}')">
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:11px;color:var(--cream2)">Etiqueta</label>
        <input type="text" id="sub-lbl-${uid}" placeholder="Ej: Relleno guayaba" value="${data.label||''}"
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)">
      </div>
      <button class="btn btn-red btn-xs" onclick="document.getElementById('${uid}').remove();mrRefreshEmpty()" style="align-self:flex-end">✕</button>
    </div>
    <div id="sub-cost-${uid}" style="margin-top:6px;font-size:11px;color:var(--blue);font-family:'DM Mono',monospace"></div>`;

  document.getElementById('mr-sub-list').appendChild(div);
  mrRefreshEmpty();
  // Show cost if editing existing
  if (data.recId) setTimeout(() => mrSubCostPreview(uid), 50);
}

function mrAddAddon(data={}) {
  if (!window._mrAddonCount) window._mrAddonCount = 0;
  window._mrAddonCount++;
  const uid = 'mra-' + window._mrAddonCount;
  const recOpts = _sbRecLista()
    .filter(r => r.code && r.code.startsWith('R-'))
    .sort((a,b) => (a.code||'').localeCompare(b.code||''))
    .map(r => `<option value="${r.code}"${r.code===data.recId?' selected':''}>${r.code} · ${r.name}</option>`)
    .join('');

  const div = document.createElement('div');
  div.id = uid;
  div.style.cssText = 'background:rgba(192,64,64,.06);border:1px solid rgba(192,64,64,.25);border-radius:8px;padding:10px;margin-bottom:8px';
  div.innerHTML = `
    <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--red);margin-bottom:8px;font-weight:600">🎂 Relleno / Cobertura</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
      <div style="flex:1;min-width:120px">
        <label style="font-size:11px;color:var(--cream2)">Tipo</label>
        <select id="adn-tipo-${uid}" style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)">
          <option value="relleno"${(data.tipo||'relleno')==='relleno'?' selected':''}>🍯 Relleno</option>
          <option value="cobertura"${data.tipo==='cobertura'?' selected':''}>🍫 Cobertura</option>
          <option value="otro"${data.tipo==='otro'?' selected':''}>📦 Otro</option>
        </select>
      </div>
      <div style="flex:2;min-width:140px">
        <label style="font-size:11px;color:var(--cream2)">Sub-receta</label>
        <select id="adn-rec-${uid}"
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)"
          onchange="mrAddonCostPreview('${uid}')">
          <option value="">— seleccionar —</option>${recOpts}
        </select>
      </div>
      <div style="width:80px">
        <label style="font-size:11px;color:var(--cream2)">g / unidad</label>
        <input type="number" id="adn-g-${uid}" min="0" step="1" value="${data.gPorUnidad||''}"
          placeholder="30"
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)"
          oninput="mrAddonCostPreview('${uid}')">
      </div>
      <div style="flex:1;min-width:100px">
        <label style="font-size:11px;color:var(--cream2)">Etiqueta</label>
        <input type="text" id="adn-lbl-${uid}" value="${data.label||''}" placeholder="Ej: Relleno canela"
          style="width:100%;font-size:12px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream)">
      </div>
      <button class="btn btn-red btn-xs" onclick="document.getElementById('${uid}').remove();mrRefreshEmpty()" style="align-self:flex-end">✕</button>
    </div>
    <div id="adn-cost-${uid}" style="margin-top:6px;font-size:11px;color:var(--red);font-family:'DM Mono',monospace"></div>`;

  document.getElementById('mr-addon-list').appendChild(div);
  mrRefreshEmpty();
  if (data.recId) setTimeout(() => mrAddonCostPreview(uid), 50);
}

function mrAddonCostPreview(uid) {
  const selEl  = document.getElementById('adn-rec-' + uid);
  const gEl    = document.getElementById('adn-g-'   + uid);
  const costEl = document.getElementById('adn-cost-' + uid);
  if (!selEl || !costEl) return;
  const recId = selEl.value;
  const gPorU = parseFloat(gEl?.value) || 0;
  if (!recId || !gPorU) { costEl.textContent = ''; return; }
  const ref = (_sbRecLista()||[]).find(x => x.code === recId);
  if (!ref) return;
  const units = parseInt(document.getElementById('mr-units')?.value) || 1;
  const totalG = gPorU * units;
  const c = pmCostoReceta(ref, totalG);
  const cpg = c.totalMerma / totalG;
  costEl.innerHTML = `🎂 ${ref.name} · ${gPorU}g/ud × ${units} ud = ${totalG}g → <strong style="color:var(--gold2)">${pmMoney(Math.round(c.totalMerma))}</strong> total · ₡${cpg.toFixed(2)}/g`;
}

function mrSubCostPreview(uid) {
  const selEl  = document.getElementById('sub-rec-' + uid);
  const pctEl  = document.getElementById('sub-pct-' + uid);
  const gEl    = document.getElementById('sub-g-'   + uid);
  const costEl = document.getElementById('sub-cost-' + uid);
  if (!selEl || !costEl) return;

  const recId = selEl.value;
  if (!recId) { costEl.textContent = ''; return; }

  const ref = (_sbRecLista()||[]).find(x => x.code === recId);
  if (!ref) { costEl.textContent = ''; return; }

  // Get current base mass from the editor
  const baseMass = parseFloat(document.getElementById('mr-masa')?.value) || 1000;
  const pct  = parseFloat(pctEl?.value) || 0;
  const gFij = parseFloat(gEl?.value)   || 0;
  // Calculate flour weight from current ingredients in editor
  let flourPctEditor = 0;
  document.querySelectorAll('#mr-ing-list > div').forEach(row => {
    const tipoSel = row.querySelector('select');
    const pctInp  = row.querySelector('input[type=number]');
    if (tipoSel && tipoSel.value === 'flour' && pctInp) {
      flourPctEditor += parseFloat(pctInp.value)||0;
    }
  });
  // If no flour defined yet, approximate: flour ~ 55% of total mass
  const flourW_editor = flourPctEditor > 0
    ? baseMass * flourPctEditor / (100 + flourPctEditor)
    : baseMass * 0.55;
  const subMass = gFij > 0 ? gFij : (pct > 0 ? flourW_editor * pct / 100 : 0);

  if (subMass <= 0) {
    costEl.textContent = ref.name + ' — ingresá % o g para ver costo';
    return;
  }

  const subCost = pmCostoReceta(ref, subMass);
  costEl.innerHTML = `🔗 ${ref.name} · ${subMass.toFixed(1)}g → <strong style="color:var(--gold2)">${pmMoney(Math.round(subCost.totalMerma))}</strong> (${pmMoney(Math.round(subCost.perUnit))}/ud base)`;
}

// ── Guardar receta_items en Supabase ──
async function _sbSaveRecetaItems(sbRecId, flour, other) {
  if (!pmDB.disponible() || !sbRecId) return;
  try {
    // FIX SESIÓN 3 (D2): antes se borraba todo primero y se insertaba
    // después — un corte de red a mitad de camino dejaba la receta con
    // ingredientes borrados y no reemplazados (pérdida real de datos,
    // mismo tipo de riesgo que causó el problema de plan_producción
    // antes del fix de Sesión 11). Ahora se guardan los ids viejos,
    // se insertan los NUEVOS items primero, y solo se borran los viejos
    // al final, ya confirmado que los nuevos se guardaron bien. Si algo
    // falla a mitad de camino, en el peor caso quedan ingredientes
    // duplicados (se puede volver a guardar para corregir), nunca
    // borrados sin reemplazo.
    const existing = await pmDB.get('receta_items', { receta_id: sbRecId });
    const oldIds = (existing || []).map(item => item.id);

    // Insertar nuevos items
    // SESIÓN 11 fix real: 'tipo' en esta tabla NO distingue harina/otro — solo
    // acepta 'ingrediente' | 'subreceta' | 'addon' (confirmado con el constraint
    // real en Supabase). La harina se marca con la columna 'es_harina' (boolean).
    for (const ing of (flour || [])) {
      const nom = ing.productName || ing.manualName || '';
      const ingId = ing.ingredientId || _sbIngMapNom?.[nom] || _sbIngMap?.[nom] || null;
      await pmDB.insert('receta_items', {
        receta_id:      sbRecId,
        ingrediente_id: ingId,
        nombre_manual:  ingId ? null : (nom || null),
        porcentaje:     ing.pct || 0,
        tipo:           'ingrediente',
        es_harina:      true
      }, false);
    }
    for (const ing of (other || [])) {
      const nom = ing.productName || ing.manualName || '';
      const ingId = ing.ingredientId || _sbIngMapNom?.[nom] || _sbIngMap?.[nom] || null;
      await pmDB.insert('receta_items', {
        receta_id:      sbRecId,
        ingrediente_id: ingId,
        nombre_manual:  ingId ? null : (nom || null),
        porcentaje:     ing.pct || 0,
        tipo:           'ingrediente',
        es_harina:      false
      }, false);
    }

    // Recién ahora, con los nuevos ya insertados y confirmados, borrar
    // los viejos.
    for (const id of oldIds) {
      await pmDB.hardDelete('receta_items', id);
    }
  } catch(e) {
    console.warn('[pmDB] _sbSaveRecetaItems error:', e.message);
    throw e; // SESIÓN 11 fix: antes se tragaba el error en silencio y quien
             // llamaba a esta función creía que había guardado bien aunque no.
  }
}

/**
 * SESIÓN 11 — Mantenimiento único: completar ingredientId faltante en recetas
 * existentes, resolviendo por nombre contra el maestro de ingredientes actual.
 * NO toca nombre, precio, masa, márgenes ni ningún otro dato de la receta —
 * solo agrega el id donde falte y el nombre coincide exactamente.
 * Seguro de correr varias veces: los items que ya tienen id no se tocan.
 */
async function _backfillIngredientIds() {
  const logEl = document.getElementById('backfill-log');
  if (!logEl) return;
  const log = (msg) => { logEl.textContent += msg + '\n'; };
  logEl.textContent = '';

  if (!pmDB.disponible()) { log('⚠️ Sin conexión a Supabase — no se puede reparar ahora.'); return; }

  log('⏳ Cargando ingredientes y recetas desde Supabase...');
  _sbIngMap = null; // forzar recarga fresca del mapa nombre→id
  await _sbIngEnsureMap();
  await _sbCosteoCargar();
  const recs = _sbRecCache || [];
  log(`Recetas cargadas: ${recs.length}`);

  let recetasActualizadas = 0, itemsReparados = 0;
  const sinResolver = [];

  for (const r of recs) {
    if (!r.sbId) continue; // solo recetas que ya existen en Supabase
    let cambios = false;

    const reparar = (lista) => (lista || []).map(item => {
      if (item.ingredientId) return item; // ya enganchado — no tocar
      const nombre = item.productName || item.manualName || '';
      const id = _sbIngMap?.[nombre];
      if (id) {
        cambios = true;
        itemsReparados++;
        return { ...item, ingredientId: id };
      }
      if (nombre) sinResolver.push(`${r.code} · "${nombre}"`);
      return item;
    });

    const flourFix = reparar(r.flour);
    const otherFix = reparar(r.other);

    if (cambios) {
      try {
        await _sbSaveRecetaItems(r.sbId, flourFix, otherFix);
        recetasActualizadas++;
        log(`✓ ${r.code} · ${r.name} — id(s) completado(s)`);
      } catch(e) {
        log(`✗ ${r.code} · ${r.name} — error: ${e.message}`);
      }
    }
  }

  log('──────────');
  log(`✅ Listo. ${recetasActualizadas} recetas actualizadas · ${itemsReparados} líneas reparadas.`);
  if (sinResolver.length) {
    log(`⚠️ ${sinResolver.length} línea(s) sin poder resolver por nombre — revisar a mano:`);
    sinResolver.forEach(x => log('   · ' + x));
  } else {
    log('Sin líneas huérfanas — todas las recetas quedaron enganchadas a un id estable.');
  }
  _sbRecCache = null; // forzar recarga limpia la próxima vez que se abra Costeo
}

/**
 * SESIÓN 11 — Mantenimiento único: detectar recetas R-xxxx que existen en el
 * navegador local pero nunca llegaron a crearse en Supabase (bug de las
 * transferencias GM, ya corregido hacia adelante) y crearlas ahora.
 * Compara por código exacto — nunca duplica una receta que ya existe allá.
 */
async function _backfillRecetasFaltantes() {
  const logEl = document.getElementById('backfill-log');
  if (!logEl) return;
  const log = (msg) => { logEl.textContent += msg + '\n'; };
  logEl.textContent = '';

  if (!pmDB.disponible()) { log('⚠️ Sin conexión a Supabase — no se puede revisar ahora.'); return; }

  log('⏳ Comparando recetas locales contra Supabase...');
  const sbRecs = await pmDB.recetas.listar();
  const sbCodes = new Set((sbRecs || []).map(r => r.codigo));
  const locales = (G.recetas || []).filter(r => r.code && r.code.startsWith('R-'));
  log(`Recetas locales (R-xxxx): ${locales.length}`);
  log(`Recetas ya en Supabase: ${sbCodes.size}`);

  const faltantes = locales.filter(r => !sbCodes.has(r.code));
  log(`Faltantes por crear: ${faltantes.length}`);
  if (!faltantes.length) {
    log('✅ Todo está sincronizado — nada que hacer.');
    return;
  }

  let creadas = 0;
  for (const rec of faltantes) {
    try {
      const rows = await pmDB.recetas.crear({
        codigo: rec.code, nombre: rec.name, categoria: rec.cat,
        masa_total_g: rec.totalMass, unidades: rec.units,
        merma_pct: rec.merma || 0, margen_pct: (rec.margen ?? null),
        notas: rec.notes || '', origen: 'propia', activo: true,
        subrecs: rec.subrecs || [], addons: rec.addons || []
      });
      if (rows?.[0]) {
        rec.sbId = rows[0].id;
        await _sbSaveRecetaItems(rows[0].id, rec.flour, rec.other);
        creadas++;
        log(`✓ ${rec.code} · ${rec.name} — creada`);
      } else {
        log(`✗ ${rec.code} · ${rec.name} — Supabase no devolvió id`);
      }
    } catch(e) {
      log(`✗ ${rec.code} · ${rec.name} — error: ${e.message}`);
    }
  }

  log('──────────');
  log(`✅ Listo. ${creadas} de ${faltantes.length} recetas creadas en Supabase.`);
  _sbRecCache = null;
  pmSave('costeo');
}

/**
 * SESIÓN 11 — Mantenimiento único: detectar recetas que YA existen en Supabase
 * pero sin ningún receta_items (probable resto de una migración antigua que
 * creó las cabezas sin copiar los ingredientes), y completarlas usando los
 * ingredientes que sí siguen intactos en la copia local (G.recetas), emparejando
 * por código exacto. No crea recetas nuevas ni toca las que ya tienen ingredientes.
 */
async function _backfillItemsFaltantes() {
  const logEl = document.getElementById('backfill-log');
  if (!logEl) return;
  const log = (msg) => { logEl.textContent += msg + '\n'; };
  logEl.textContent = '';

  if (!pmDB.disponible()) { log('⚠️ Sin conexión a Supabase — no se puede revisar ahora.'); return; }

  log('⏳ Buscando recetas en Supabase sin ingredientes...');
  const sbRecs = await pmDB.recetas.listar();
  const todosItems = await pmDB.get('receta_items', {}).catch(() => []);
  const conItems = new Set((todosItems || []).map(i => i.receta_id));
  const vacias = (sbRecs || []).filter(r => !conItems.has(r.id));

  log(`Recetas en Supabase: ${sbRecs.length}`);
  log(`Sin ingredientes: ${vacias.length}`);
  if (!vacias.length) { log('✅ Nada que reparar.'); return; }

  const gByCode = {};
  (G.recetas || []).forEach(r => { if (r.code) gByCode[r.code] = r; });

  let reparadas = 0;
  const sinLocal = [];
  for (const rec of vacias) {
    const local = gByCode[rec.codigo];
    if (!local || (!(local.flour||[]).length && !(local.other||[]).length)) {
      sinLocal.push(rec.codigo);
      continue;
    }
    try {
      await _sbSaveRecetaItems(rec.id, local.flour, local.other);
      reparadas++;
      log(`✓ ${rec.codigo} · ${rec.nombre} — ingredientes copiados desde local`);
    } catch(e) {
      log(`✗ ${rec.codigo} · ${rec.nombre} — error: ${e.message}`);
    }
  }

  log('──────────');
  log(`✅ Listo. ${reparadas} de ${vacias.length} recetas reparadas.`);
  if (sinLocal.length) {
    log(`⚠️ ${sinLocal.length} sin datos locales disponibles para copiar (revisar a mano):`);
    sinLocal.forEach(c => log('   · ' + c));
  }
  _sbRecCache = null;
}

/**
 * SESIÓN 11 — Mantenimiento único: los rellenos/coberturas (subrecs/addons)
 * nunca viajaban a Supabase — vivían solo en el navegador donde se crearon,
 * por eso una misma receta podía verse distinta en celular vs. laptop.
 * Esto empuja lo que ya existe localmente hacia las columnas nuevas en
 * Supabase (subrecs/addons), emparejando por código exacto.
 */
async function _backfillSubrecsAddons() {
  const logEl = document.getElementById('backfill-log');
  if (!logEl) return;
  const log = (msg) => { logEl.textContent += msg + '\n'; };
  logEl.textContent = '';

  if (!pmDB.disponible()) { log('⚠️ Sin conexión a Supabase — no se puede revisar ahora.'); return; }

  log('⏳ Buscando rellenos/coberturas guardados solo en este navegador...');
  const candidatos = (G.recetas || []).filter(r =>
    (r.subrecs && r.subrecs.length) || (r.addons && r.addons.length));
  log(`Recetas locales con rellenos/coberturas: ${candidatos.length}`);
  if (!candidatos.length) { log('✅ No hay nada que sincronizar desde este navegador.'); return; }

  const sbRecs = await pmDB.recetas.listar();
  const byCode = {};
  (sbRecs || []).forEach(r => { byCode[r.codigo] = r; });

  let actualizadas = 0;
  const sinFila = [];
  const omitidas = [];
  for (const rec of candidatos) {
    const sb = byCode[rec.code];
    if (!sb) { sinFila.push(rec.code); continue; }
    // FIX SESIÓN 3 (D1): antes esto sobrescribía subrecs/addons en Supabase
    // con lo que hubiera en ESTE navegador, sin comparar antes si Supabase
    // ya tenía algo distinto. Corrido desde un navegador desactualizado,
    // podía pisar rellenos/coberturas correctos ya sincronizados desde
    // otro dispositivo, sin ningún aviso. Ahora solo se sincroniza si
    // Supabase todavía tiene el campo vacío — nunca se pisa un dato que
    // ya existe ahí.
    const sbTieneSubrecs = Array.isArray(sb.subrecs) && sb.subrecs.length > 0;
    const sbTieneAddons  = Array.isArray(sb.addons)  && sb.addons.length  > 0;
    if (sbTieneSubrecs || sbTieneAddons) {
      omitidas.push(rec.code);
      log(`⏭ ${rec.code} · ${rec.name} — Supabase ya tiene datos ahí, NO se toca (revisar a mano si hace falta)`);
      continue;
    }
    try {
      await pmDB.recetas.editar(sb.id, { subrecs: rec.subrecs || [], addons: rec.addons || [] });
      actualizadas++;
      log(`✓ ${rec.code} · ${rec.name} — rellenos/coberturas sincronizados`);
    } catch(e) {
      log(`✗ ${rec.code} · ${rec.name} — error: ${e.message}`);
    }
  }

  log('──────────');
  log(`✅ Listo. ${actualizadas} de ${candidatos.length} sincronizadas.`);
  if (omitidas.length) {
    log(`⏭ ${omitidas.length} omitidas porque Supabase ya tenía datos: ${omitidas.join(', ')}`);
  }
  if (sinFila.length) {
    log(`⚠️ Sin fila en Supabase (revisar a mano): ${sinFila.join(', ')}`);
  }
  _sbRecCache = null;
}

/**
 * SESIÓN 11 fix: antes se contaba cuántas recetas R- había en el navegador
 * LOCAL y se sumaba 1 — si el local estaba desincronizado de Supabase
 * (con menos recetas de las que realmente existen), el "siguiente" número
 * ya estaba usado y chocaba con una receta real (pasó con R-0020).
 * Ahora se toma el número más alto que exista (local + Supabase) y se
 * suma 1 — nunca puede repetir uno ya usado.
 */
function _pmNextRecCode() {
  const nums = _sbRecLista()
    .map(r => r.code || '')
    .filter(c => /^R-\d+$/.test(c))
    .map(c => parseInt(c.slice(2), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return 'R-' + String(max + 1).padStart(4, '0');
}

async function recSave() {
  const id    = document.getElementById('mr-id').value;
  const code  = document.getElementById('mr-code').value.trim();
  const name  = document.getElementById('mr-name').value.trim();
  const masa  = parseFloat(document.getElementById('mr-masa').value)||1000;
  const units = parseInt(document.getElementById('mr-units').value)||1;
  const merma = parseFloat(document.getElementById('mr-merma').value)||0;
  const notes = document.getElementById('mr-notes').value;
  const cat   = document.getElementById('mr-cat').value;
  if (!name) { pmToast('Ingresá el nombre de la receta','err'); return; }
  if (!code) { pmToast('Ingresá un código','err'); return; }

  const flour=[], other=[];
  document.querySelectorAll('#mr-ing-list > div').forEach(row => {
    const tipoSel = row.querySelector('select');
    const nameInp = document.getElementById('inp-' + row.id) || row.querySelector('input[type=text]');
    const pctInp  = row.querySelector('input[type=number]');
    if (!tipoSel||!nameInp||!pctInp) return;
    const tipo = tipoSel.value;
    const prod = nameInp.value.trim();
    const pct  = parseFloat(pctInp.value)||0;
    if (prod && pct) {
      // Preferimos el id guardado por el picker (SESIÓN 11); si no hay (línea manual
      // o receta vieja no migrada), resolvemos por nombre como antes.
      const ingId = nameInp.dataset.ingId || _sbIngMap?.[prod] || '';
      const key = G.ingredientes[prod] ? 'productName' : 'manualName';
      const entry = { pct, [key]: prod, ...(ingId ? { ingredientId: ingId } : {}) };
      if (tipo==='flour') flour.push(entry);
      else                other.push(entry);
    }
  });

  const subrecs=[];
  document.querySelectorAll('#mr-sub-list > div').forEach(row => {
    const rowId = row.id;
    const sel   = document.getElementById('sub-rec-' + rowId);
    const pctEl = document.getElementById('sub-pct-' + rowId);
    const gEl   = document.getElementById('sub-g-'   + rowId);
    const lblEl = document.getElementById('sub-lbl-' + rowId);
    if (!sel||!sel.value) return;
    subrecs.push({
      recId:  sel.value,
      pct:    parseFloat(pctEl?.value)||0,
      gFijos: parseFloat(gEl?.value)||0,
      label:  lblEl?.value||''
    });
  });
  const addons=[];
  document.querySelectorAll('#mr-addon-list > div').forEach(row => {
    const rowId  = row.id;
    const tipoEl = document.getElementById('adn-tipo-' + rowId);
    const recEl  = document.getElementById('adn-rec-'  + rowId);
    const gEl    = document.getElementById('adn-g-'    + rowId);
    const lblEl  = document.getElementById('adn-lbl-'  + rowId);
    if (!recEl||!recEl.value) return;
    addons.push({
      tipo:       tipoEl?.value||'relleno',
      recId:      recEl.value,
      gPorUnidad: parseFloat(gEl?.value)||0,
      label:      lblEl?.value||''
    });
  });

  const margenVal = document.getElementById('mr-margen').value;
  const margen = margenVal !== '' ? parseFloat(margenVal) : undefined;
  const modPctVal = document.getElementById('mr-mod')?.value;
  const ggPctVal  = document.getElementById('mr-gg')?.value;
  const modPct = modPctVal !== '' && modPctVal !== undefined ? parseFloat(modPctVal) : undefined;
  const ggPct  = ggPctVal  !== '' && ggPctVal  !== undefined ? parseFloat(ggPctVal)  : undefined;
  const obj = {code, name, cat, totalMass:masa, units, merma,
    ...(margen!==undefined?{margen}:{}),
    ...(modPct!==undefined?{modPct}:{}),
    ...(ggPct!==undefined?{ggPct}:{}),
    notes, flour, other, subrecs, addons};

  if (!G.recetas) G.recetas = [];
  // Parse id — may carry gmsource or personalsource marker
  let realId = id, gmSource = null, personalSourceName = null;
  if (id && id.includes('|gmsource|')) {
    const parts = id.split('|gmsource|');
    realId  = parts[0];
    gmSource= parts[1];
  } else if (id && id.includes('|personalsource|')) {
    const parts = id.split('|personalsource|');
    realId = parts[0];
    personalSourceName = decodeURIComponent(parts[1]);
  }

  if (personalSourceName) {
    // Guardando desde el editor de Recetas Personales. A diferencia de
    // Gluten Morgen, acá no hay biblioteca que rastrear — cada receta
    // personal se usa una sola vez y se descarta (ver personalTransferir),
    // así que esto siempre es una receta NUEVA. Solo se etiqueta de
    // dónde vino, a modo informativo.
    const newCode = code || _pmNextRecCode();
    G.recetas.push({ id: String(Date.now()), code: newCode, personalSource: personalSourceName, ...obj });
    pmToast(newCode + ' · "' + obj.name + '" guardada ✓');

    if (pmDB.disponible()) {
      const target = G.recetas[G.recetas.length - 1];
      // NOTA: no se manda personal_source a Supabase (columna que
      // probablemente no existe todavía) — mismo criterio que la
      // columna receta_cod que faltó hoy.
      pmDB.recetas.crear({
        codigo: target.code, nombre: obj.name, categoria: obj.cat,
        masa_total_g: obj.totalMass, unidades: obj.units,
        merma_pct: obj.merma, margen_pct: obj.margen || null,
        notas: obj.notes, origen: 'propia', activo: true,
        subrecs: obj.subrecs || [], addons: obj.addons || []
      }).then(rows => {
        if (rows?.[0]) {
          target.sbId = rows[0].id;
          _sbSaveRecetaItems(rows[0].id, obj.flour, obj.other).catch(e => console.warn('[pmDB] items personalSource error:', e.message));
        }
      }).catch(e => console.warn('[pmDB] recSave personalSource create error:', e.message));
      _sbRecCache = null;
    }
  } else if (gmSource) {
    // Saving from GM editor — find by gmSource to preserve id/code
    const exIdx = G.recetas.findIndex(x => x.gmSource === gmSource);
    if (exIdx >= 0) {
      const ex = G.recetas[exIdx];
      G.recetas[exIdx] = { id: ex.id, code: ex.code, gmSource, ...obj };
      pmToast('Receta "' + obj.name + '" actualizada ✓');
    } else {
      const newCode = _pmNextRecCode();
      G.recetas.push({ id: String(Date.now()), code: newCode, gmSource, ...obj });
      pmToast(newCode + ' · "' + obj.name + '" guardada ✓');
    }
    // Supabase dual write — crear si nunca se creó, actualizar si ya existe.
    // SESIÓN 11 fix: antes esto solo actualizaba (nunca creaba), así que una
    // receta transferida de GM jamás llegaba a existir en Supabase.
    if (pmDB.disponible()) {
      const target = G.recetas.find(x => x.gmSource === gmSource);
      const cached = _sbGetRec(target.id);
      if (cached?.sbId) {
        pmDB.recetas.editar(cached.sbId, {
          nombre: obj.name, categoria: obj.cat, masa_total_g: obj.totalMass,
          unidades: obj.units, merma_pct: obj.merma, margen_pct: obj.margen, notas: obj.notes,
          subrecs: obj.subrecs || [], addons: obj.addons || []
        }).then(() => _sbSaveRecetaItems(cached.sbId, obj.flour, obj.other))
          .catch(e => console.warn('[pmDB] recSave gmSource update error:', e.message));
      } else {
        pmDB.recetas.crear({
          codigo: target.code, nombre: obj.name, categoria: obj.cat,
          masa_total_g: obj.totalMass, unidades: obj.units,
          merma_pct: obj.merma, margen_pct: obj.margen || null,
          notas: obj.notes, origen: 'propia', activo: true,
          subrecs: obj.subrecs || [], addons: obj.addons || []
        }).then(rows => {
          if (rows?.[0]) {
            target.sbId = rows[0].id;
            _sbSaveRecetaItems(rows[0].id, obj.flour, obj.other).catch(e => console.warn('[pmDB] items gmSource error:', e.message));
          }
        }).catch(e => console.warn('[pmDB] recSave gmSource create error:', e.message));
      }
      _sbRecCache = null; // invalidar cache para que recargue
    }
  } else if (realId) {
    // Editing existing recipe
    // Punto 5 del plan de auditoría — optimistic locking: si tenemos con
    // qué comparar (la receta vino de Supabase y sabemos el updated_at
    // con el que se abrió el formulario), verificamos que nadie más la
    // haya cambiado entretanto. Solo aplica cuando hay conexión y sbId —
    // si no, no hay con qué comparar y se guarda como siempre.
    const cachedParaConflicto = _sbGetRec(realId);
    if (pmDB.disponible() && cachedParaConflicto?.sbId && window._mrEditUpdatedAt) {
      try {
        const actual = await pmDB.recetas.obtener(cachedParaConflicto.sbId);
        if (actual && actual.updated_at && actual.updated_at !== window._mrEditUpdatedAt) {
          pmMostrarConflicto(
            `La receta "${cachedParaConflicto.name || obj.name}" fue modificada en otro dispositivo o pestaña mientras la editabas.`,
            () => { recEditar(realId); }, // Recargar lo más reciente — descarta lo que escribiste acá
            () => {
              // Sobrescribir con lo mío: aceptamos el updated_at actual como
              // nueva base de comparación y reintentamos — ya no habrá
              // conflicto en el segundo intento (a menos que alguien vuelva
              // a cambiarlo en el ratito entre que aceptás y se guarda).
              window._mrEditUpdatedAt = actual.updated_at;
              recSave();
            }
          );
          return; // pausar acá — no seguir guardando hasta que Victor elija
        }
      } catch (e) {
        console.warn('[pmDB] recSave — verificación de conflicto falló, se guarda igual:', e.message);
      }
    }

    // SESIÓN 11 fix crítico: antes esto solo buscaba en la copia LOCAL — si
    // la receta existía en Supabase pero nunca se había agregado a este
    // navegador (posible ahora que Costeo/Recetario leen de Supabase),
    // Guardar no hacía NADA, en silencio, sin avisar (pasó con Pan Dulce).
    const cached = _sbGetRec(realId);
    let rIdx = G.recetas.findIndex(x => x.id === realId);
    if (rIdx < 0 && cached) {
      G.recetas.push({ id: realId, code: cached.code, ...obj });
      rIdx = G.recetas.length - 1;
    } else if (rIdx >= 0) {
      G.recetas[rIdx] = { ...G.recetas[rIdx], ...obj };
    }
    if (rIdx >= 0) {
      pmToast('Receta actualizada ✓');
      // Supabase dual write — actualizar datos maestros
      if (pmDB.disponible()) {
        if (cached?.sbId) {
          pmDB.recetas.editar(cached.sbId, {
            nombre: obj.name, categoria: obj.cat, masa_total_g: obj.totalMass,
            unidades: obj.units, merma_pct: obj.merma, margen_pct: obj.margen, notas: obj.notes,
            subrecs: obj.subrecs || [], addons: obj.addons || []
          }).then(() => _sbSaveRecetaItems(cached.sbId, obj.flour, obj.other))
            .catch(e => console.warn('[pmDB] recSave edit error:', e.message));
        } else {
          pmToast('⚠️ Guardado local, pero no se pudo confirmar en Supabase', 'err');
        }
        _sbRecCache = null; // invalidar cache
      }
    } else {
      pmToast('❌ No se encontró la receta — no se guardó nada. Avisar a soporte.', 'err');
    }
  } else {
    // New recipe
    const newCode = code || _pmNextRecCode();
    const newRec = { id: String(Date.now()), code: newCode, ...obj };
    G.recetas.push(newRec);
    pmToast(newCode + ' · "' + obj.name + '" creada ✓');
    // Supabase dual write — insertar registro maestro
    if (pmDB.disponible()) {
      pmDB.recetas.crear({
        codigo: newCode, nombre: obj.name, categoria: obj.cat,
        masa_total_g: obj.totalMass, unidades: obj.units,
        merma_pct: obj.merma, margen_pct: obj.margen || null,
        notas: obj.notes, origen: 'propia', activo: true,
        subrecs: obj.subrecs || [], addons: obj.addons || []
      }).then(rows => {
        if (rows?.[0]) {
          newRec.sbId = rows[0].id;
          _sbSaveRecetaItems(rows[0].id, obj.flour, obj.other).catch(e => console.warn('[pmDB] items create error:', e.message));
        }
      }).catch(e => console.warn('[pmDB] recSave create error:', e.message));
      _sbRecCache = null; // invalidar cache
    }
  }

  pmSave('costeo');
  fillRscSel();
  cvMostrar('cv-lista');
  recRender();
}

function recEliminar(id) {
  if (!confirm('¿Eliminar esta receta?')) return;
  // Supabase dual write — soft delete
  if (pmDB.disponible()) {
    const cached = _sbGetRec(id);
    if (cached?.sbId) {
      pmDB.recetas.eliminar(cached.sbId)
        .catch(e => console.warn('[pmDB] recEliminar error:', e.message));
    }
    _sbRecCache = null; // invalidar cache
  }
  G.recetas = G.recetas.filter(x=>x.id!==id);
  pmSave('costeo');
  fillRscSel();
  recRender();
  pmToast('Receta eliminada');
}
// ── 📋 MAESTRO DE RECETAS ──────────────────────────────────────
function cvMaestroRender() {
  const q   = (document.getElementById('mro-search')||{}).value?.toLowerCase()||'';
  const cat = (document.getElementById('mro-cat')||{}).value||'';
  const origen = (document.getElementById('mro-origen')||{}).value||'';
  // SESIÓN 11: ahora lee de Supabase (merged), no solo del navegador local
  let list  = _sbRecLista().slice();
  if (origen === 'R') list = list.filter(r =>  r.code && r.code.startsWith('R-'));
  if (origen === 'G') list = list.filter(r => !r.code || !r.code.startsWith('R-'));
  list = list.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'es'));
  if (q)   list = list.filter(r => (r.name||'').toLowerCase().includes(q) || (r.code||'').toLowerCase().includes(q));
  if (cat) list = list.filter(r => r.cat === cat);
  const el  = document.getElementById('mro-list');
  if (!el) return;

  if (!list.length) {
    el.innerHTML = '<div class="ph"><span class="ph-icon">📋</span>Sin recetas</div>';
    return;
  }

  // SESIÓN 11: un solo caché compartido para toda la lista — evita recalcular
  // el costo de la misma sub-receta/relleno una y otra vez por cada fila
  const _sharedCache = new Map();

  const CAT_ICON = {pan:'🍞', pan_mm:'🌾', galleta:'🍪', masa:'🫧', otro:'📦'};

  const rows = list.map(r => {
    const c = pmCostoReceta(r, undefined, undefined, _sharedCache);
    const hasCost = c.totalMerma > 0;
    const icon = CAT_ICON[r.cat||'otro']||'📦';
    const ingCount = (r.flour||[]).length + (r.other||[]).length;
    const subCount = (r.subrecs||[]).length;
    return `<tr onclick="recEditar('${r.id}');cvMostrar('cv-nueva')" style="cursor:pointer;border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-family:'DM Mono',monospace;font-size:12px;color:var(--gold2);white-space:nowrap">${r.code||'—'}</td>
      <td style="padding:8px 10px">
        <div style="font-weight:600;font-size:13px">${icon} ${r.name}</div>
        <div style="font-size:10px;color:var(--cream2);margin-top:2px">
          ${r.totalMass||1000}g · ${r.units||1} ud · ${ingCount} ing${subCount?` · ${subCount} sub`:''}
        </div>
      </td>
      <td style="padding:8px 10px;text-align:center">
        <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(200,146,42,.1);color:var(--cream2)">${r.cat||'otro'}</span>
      </td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:13px;color:${hasCost?'var(--gold2)':'var(--cream2)'}">
        ${hasCost ? pmMoney(Math.round(c.totalMerma)) : '<span style="font-size:11px">sin costo</span>'}
      </td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--cream2)">
        ${hasCost ? 'Costo: '+pmMoney(Math.round(c.perUnit)) : '—'}
      </td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:13px;color:var(--green);font-weight:600">
        ${(() => { const ps = pmPrecioSugerido(r, _sharedCache); return ps ? pmMoney(Math.round(ps)) : '—'; })()}
      </td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:11px;color:var(--cream2)">
        ${hasCost && r.totalMass ? (() => { const modP = r.modPct!==undefined?r.modPct:80; const ggP = r.ggPct!==undefined?r.ggPct:45; const ct = c.totalMerma*(1+(modP+ggP)/100); const pu = r.totalMass/(r.units||1); return (ct/pu).toFixed(2); })() : '—'}
      </td>
    </tr>`;
  }).join('');

  const totalConCosto = list.filter(r => pmCostoReceta(r, undefined, undefined, _sharedCache).totalMerma > 0).length;

  el.innerHTML = `
    <div style="font-size:11px;color:var(--cream2);margin-bottom:8px;display:flex;justify-content:space-between">
      <span>${list.length} receta(s) · ${totalConCosto} con costo calculado</span>
      <span style="color:var(--cream2)">Clic en una receta para editar</span>
    </div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:var(--r)">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:rgba(200,146,42,.1)">
            <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px;white-space:nowrap">Código</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Nombre</th>
            <th style="padding:8px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Cat.</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Costo total</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Por unidad</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--green)">Precio/ud</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--cream2)">₡/g</th>
          </tr>
        </thead>
        <tbody id="mro-tbody">${rows}</tbody>
      </table>
    </div>`;
}

function cvMaestroPrint() {
  const el = document.getElementById('mro-list');
  if (!el) return;
  const w = window.open('','_blank','width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Maestro de Recetas — PanMaestro</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600&family=DM+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;font-size:12px;color:#1a1006;padding:24px;background:#fff}
      h1{font-family:'Playfair Display',serif;font-size:20px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse}
      th{background:#f5e8d0;padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px}
      td{padding:7px 10px;border-bottom:1px solid #e8dcc8;vertical-align:middle}
      .mono{font-family:'DM Mono',monospace}
      .no-print{display:none}
      @media print{body{padding:12px}}
    </style>
  </head><body>
  <h1>📋 Maestro de Recetas — PanMaestro</h1>
  `);
  w.document.write(el.innerHTML);
  w.document.write('</body></html>');
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
}


// ── PRECIO SUGERIDO ──────────────────────────────────────────
function pmPrecioSugerido(r, _cache) {
  // Precio sugerido por unidad: costo/ud (con MOD y GG) + margen
  const c = pmCostoReceta(r, undefined, undefined, _cache);
  if (!c.perUnit) return null;
  const margen = (r.margen !== undefined ? r.margen : (G.margenDefault || 40)) / 100;
  if (margen >= 1) return null;
  return c.perUnit / (1 - margen);
}

// ══════════════════════════════════════════════════════════
// REPORTE — Recetas × Producto terminado
// Solo reporte (no persiste nada) — se genera al vuelo y se
// imprime en ventana aparte, igual patrón que recetarioImprimir().
// Por ahora solo cubre "Tipos de pan" (G.tiposPan), que es el
// único catálogo con receta_cod vinculada desde la UI. Los tipos
// de galleta (G.tiposGalleta) todavía no tienen ese campo expuesto
// — ver nota en el pie del reporte.
// ══════════════════════════════════════════════════════════
function _repCostoProducto(r, p) {
  if (!p || !p.peso) return null;
  const c = pmCostoReceta(r);
  if (!c.totalMerma || !r.totalMass) return null;
  const modPct = r.modPct !== undefined ? r.modPct : 80;
  const ggPct  = r.ggPct  !== undefined ? r.ggPct  : 45;
  const costTotal = c.totalMerma * (1 + (modPct + ggPct) / 100);
  const cpg = costTotal / r.totalMass;
  const costoUd = cpg * p.peso;
  const margen  = p.precio > 0 ? (p.precio - costoUd) / p.precio * 100 : null;
  return { costoUd, margen };
}

function repRecProductoImprimir() {
  const recetas = (_sbRecLista() || []).slice().sort((a,b) => (a.code||'').localeCompare(b.code||''));
  const filas = [];
  recetas.forEach(r => {
    const vinculados = (G.tiposPan||[]).filter(p => p.recetaCod === r.code);
    if (!vinculados.length) filas.push({ r, prod: null });
    else vinculados.forEach(p => filas.push({ r, prod: p }));
  });

  const conProducto = filas.filter(f => f.prod);
  const sinProducto = filas.filter(f => !f.prod);

  const rowCon = f => {
    const costo = _repCostoProducto(f.r, f.prod);
    const margenColor = costo && costo.margen !== null
      ? (costo.margen >= 40 ? '#2e7d32' : costo.margen >= 20 ? '#b8860b' : '#b91c1c')
      : '#8a7050';
    return `<tr>
      <td class="mono">${f.r.code||'—'}</td>
      <td>${f.r.name||''}</td>
      <td>${f.prod.nombre}</td>
      <td style="text-align:right" class="mono">${f.prod.peso||'—'}g</td>
      <td style="text-align:right" class="mono gold">${costo ? pmMoney(Math.round(costo.costoUd)) : '—'}</td>
      <td style="text-align:right" class="mono">${f.prod.precio ? pmMoney(f.prod.precio) : '—'}</td>
      <td style="text-align:right" class="mono" style="color:${margenColor}">${costo && costo.margen!==null ? costo.margen.toFixed(1)+'%' : '—'}</td>
    </tr>`;
  };
  const rowSin = f => `<tr>
      <td class="mono">${f.r.code||'—'}</td>
      <td colspan="6" style="color:#9a8560;font-style:italic">${f.r.name||''} — sin producto terminado vinculado</td>
    </tr>`;

  const bodyCon = conProducto.map(rowCon).join('') || '<tr><td colspan="7" style="text-align:center;color:#9a8560;padding:16px">Ningún tipo de pan tiene receta vinculada todavía</td></tr>';
  const bodySin = sinProducto.map(rowSin).join('');
  const fecha = new Date().toLocaleDateString('es-CR', { year:'numeric', month:'long', day:'numeric' });

  const w = window.open('', '_blank', 'width=1000,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Reporte Recetas × Producto — ${fecha}</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600&family=DM+Mono&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;font-size:12px;color:#1a1006;padding:28px;background:#fff}
      h1{font-family:'Playfair Display',serif;font-size:22px;font-weight:900;margin-bottom:2px}
      .sub{font-size:11px;color:#8a7050;margin-bottom:18px}
      table{width:100%;border-collapse:collapse;margin-bottom:20px}
      th{background:#f5e8d0;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px}
      td{padding:7px 9px;border-bottom:1px solid #e8dcc8;vertical-align:middle;font-size:12px}
      .mono{font-family:'DM Mono',monospace}
      .gold{color:#a8721a;font-weight:700}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#8a5a10;margin:18px 0 8px;border-bottom:1px solid #e0c88a;padding-bottom:4px}
      .foot{font-size:10px;color:#9a8560;margin-top:10px;line-height:1.6}
      @media print{body{padding:16px} .foot{page-break-inside:avoid}}
    </style>
  </head><body>
    <h1>🍞 Recetas × Producto terminado</h1>
    <div class="sub">Generado ${fecha} · PanMaestro — reporte, no se guarda</div>
    <h2>Con producto terminado vinculado</h2>
    <table>
      <thead><tr><th>Código</th><th>Receta</th><th>Producto</th><th style="text-align:right">Peso</th><th style="text-align:right">Costo/ud</th><th style="text-align:right">Precio</th><th style="text-align:right">Margen</th></tr></thead>
      <tbody>${bodyCon}</tbody>
    </table>
    ${sinProducto.length ? `<h2>Sin producto vinculado (sub-recetas, masas madre, rellenos, coberturas, etc.)</h2>
    <table>
      <thead><tr><th>Código</th><th colspan="6">Receta</th></tr></thead>
      <tbody>${bodySin}</tbody>
    </table>` : ''}
    <div class="foot">Costo/ud incluye mano de obra y gastos generales de cada receta (ver % en el editor). Los tipos de galleta todavía no tienen receta vinculada en este reporte.</div>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 600);
}
// ─── SESIÓN 6 — COSTEO: CACHE SUPABASE ──────────────────────────────────────
// _sbRecCache  : Array de recetas Supabase (objeto compatible con G.recetas)
// _sbIngCache  : Object { nombre → { price, qty, sbId } } compatible con G.ingredientes
// Estos se cargan al entrar al tab pg-costeo y se usan como fuente primaria.
// Fallback automático a G.recetas / G.ingredientes si Supabase no está disponible.

let _sbRecCache  = null;   // null = no cargado aún; [] = cargado pero vacío
let _sbIngCache  = null;
let _sbRecMap    = null;   // { sbId → objeto receta } para lookups por uuid de Supabase
let _sbIngMapNom = null;   // { nombre → sbId }

/**
 * Carga recetas e ingredientes desde Supabase y los guarda en cache local.
 * Las recetas de Supabase se fusionan con los objetos en G.recetas para
 * mantener los campos de fórmula (flour, other, subrecs, addons) que sólo
 * existen en localStorage.
 */
async function _sbCosteoCargar() {
  if (!pmDB.disponible()) {
    fillRscSel();
    recRender();
    return;
  }
  try {
    // ── Ingredientes ──────────────────────────────────────────────────────
    const sbIngs = await pmDB.ingredientes.listar();
    _sbIngCache  = {};
    _sbIngMapNom = {};
    if (!_sbIngById) _sbIngById = {};
    (sbIngs || []).forEach(row => {
      _sbIngCache[row.nombre]  = { price: row.precio_ref || 0, qty: row.qty_base || 1000, sbId: row.id, codigo: row.codigo };
      _sbIngMapNom[row.nombre] = row.id;
      _sbIngById[row.id]       = { price: row.precio_ref || 0, qty: row.qty_base || 1000, sbId: row.id, codigo: row.codigo, nombre: row.nombre };
    });
    Object.entries(G.ingredientes || {}).forEach(([k, v]) => {
      if (!_sbIngCache[k]) _sbIngCache[k] = v;
    });

    // ── Recetas ───────────────────────────────────────────────────────────
    const sbRecs = await pmDB.recetas.listar();
    _sbRecMap    = {};

    // Cargar todos los receta_items de una vez
    const todosItems = await pmDB.get('receta_items', {}).catch(() => []);
    // Agrupar items por receta_id
    const itemsPorReceta = {};
    (todosItems || []).forEach(item => {
      if (!itemsPorReceta[item.receta_id]) itemsPorReceta[item.receta_id] = [];
      itemsPorReceta[item.receta_id].push(item);
    });

    // Mapa de ingredientes por UUID → nombre
    const ingPorId = {};
    Object.entries(_sbIngCache).forEach(([nom, v]) => {
      if (v.sbId) ingPorId[v.sbId] = nom;
    });

    const gByCode = {};
    (G.recetas || []).forEach(r => { if (r.code) gByCode[r.code] = r; });

    _sbRecCache = (sbRecs || []).map(row => {
      const local = gByCode[row.codigo] || {};
      const items = itemsPorReceta[row.id] || [];

      // Convertir items de Supabase a formato flour/other
      let flour = [], other = [];
      if (items.length) {
        items.forEach(item => {
          // Nombre del ingrediente: etiqueta > nombre_manual > ingrediente via cache
          const nomIng = item.etiqueta || item.nombre_manual || ingPorId[item.ingrediente_id] || item.ingrediente_id || '';
          const entry  = { pct: item.porcentaje || 0, productName: nomIng, ingredientId: item.ingrediente_id || null };
          // SESIÓN 11 fix: clasificar por 'tipo' (que es lo que _sbSaveRecetaItems realmente escribe),
          // no por 'es_harina' que nunca se guarda — antes esto mandaba todo a "other" silenciosamente.
          // SESIÓN 11 fix real: la clasificación harina/otro vive en 'es_harina',
          // confirmado con el esquema real de Supabase. 'tipo' es otra cosa
          // (ingrediente/subreceta/addon) y nunca debió usarse para esto.
          if (item.es_harina) flour.push(entry);
          else other.push(entry);
        });
        // FIX SESIÓN 2 (B4): se eliminó el sort() sin efecto (comparador
        // (a,b)=>0 siempre devolvía 0, no ordenaba nada — solo confundía
        // a quien leyera el código). Si algún día se quiere ordenar por
        // un campo 'orden' real, implementarlo aquí.
      } else {
        // Fallback a localStorage si no hay items en Supabase
        flour = local.flour || [];
        other = local.other || [];
      }

      const merged = {
        id:        local.id   || row.id,
        sbId:      row.id,
        code:      row.codigo,
        name:      row.nombre,
        cat:       row.categoria,
        totalMass: row.masa_total_g  || local.totalMass || 1000,
        // FIX SESIÓN 2 (B3): antes usaba `row.x || local.x || 0` — si el
        // valor en Supabase era legítimamente 0 (merma 0%, margen 0%,
        // 0 unidades), el OR lógico lo trataba como falso y caía al valor
        // local viejo en su lugar, sin que se notara el motivo. Ahora se
        // comprueba explícitamente null/undefined.
        units:     row.unidades   != null ? row.unidades   : (local.units  || 1),
        merma:     row.merma_pct  != null ? row.merma_pct  : (local.merma  || 0),
        margen:    row.margen_pct != null ? row.margen_pct : local.margen,
        notes:     row.notas         || local.notes     || '',
        flour,
        other,
        // SESIÓN 11: rellenos/coberturas ahora también viven en Supabase.
        // Se prefiere lo que viene de Supabase; si esa receta todavía no
        // fue migrada (columna vacía), se cae al local como antes.
        subrecs: (row.subrecs && row.subrecs.length ? row.subrecs : local.subrecs) || [],
        addons:  (row.addons  && row.addons.length  ? row.addons  : local.addons)  || [],
        gmSource: local.gmSource,
      };
      _sbRecMap[row.id] = merged;
      return merged;
    });

    // Agregar recetas locales que no están en Supabase todavía
    const sbCodes = new Set((sbRecs||[]).map(r=>r.codigo));
    (G.recetas||[]).forEach(r => {
      if (r.code && !sbCodes.has(r.code)) {
        _sbRecCache.push(r);
      }
    });

  } catch(e) {
    console.warn('[pmDB] Costeo cache error — usando localStorage:', e.message);
    _sbRecCache = null;
    _sbIngCache = null;
  }
  fillRscSel();
  recRender();
}

/** Lista de recetas: Supabase cache si disponible, G.recetas como fallback */
function _sbRecLista() {
  return _sbRecCache !== null ? _sbRecCache : (G.recetas || []);
}

/** Lista de ingredientes: Supabase cache si disponible, G.ingredientes como fallback */
function _sbIngLista() {
  return _sbIngCache !== null ? _sbIngCache : (G.ingredientes || {});
}

/** Buscar receta por id local o sbId */
function _sbGetRec(id) {
  if (!id) return null;
  const lista = _sbRecLista();
  return lista.find(x => x.id === id || x.sbId === id) || null;
}

/** Obtener ingrediente por nombre */
function _sbGetIng(nombre) {
  const cache = _sbIngLista();
  return cache[nombre] || null;
}

/**
 * SESIÓN 11 — Resolver ingrediente de una línea de receta.
 * Prioriza ingredientId (estable, no se rompe si el nombre cambia).
 * Si no hay id (líneas manuales o recetas viejas sin migrar), cae a nombre.
 */
function _sbResolveIng(entry) {
  if (!entry) return null;
  if (entry.ingredientId && _sbIngById && _sbIngById[entry.ingredientId]) {
    return _sbIngById[entry.ingredientId];
  }
  const name = entry.productName || entry.manualName || '';
  return _sbGetIng(name) || G.ingredientes[name] || null;
}
