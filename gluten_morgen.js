// ── 🌾 GLUTEN MORGEN ──────────────────────────────────────────
function gmLoadJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let data;
    try { data = JSON.parse(ev.target.result); } catch(err) {
      pmToast('Error al leer JSON: ' + err.message, 'err'); return;
    }
    if (!Array.isArray(data)) {
      pmToast('El archivo no es un backup de Gluten Morgen (se esperaba un array).', 'err'); return;
    }
    G.gmRecipes = data;
    G.gmRecipesLoaded = true;
    pmSave('costeo');
    gmRenderList();
    pmToast('✓ ' + data.length + ' recetas GM cargadas');
  };
  reader.readAsText(file);
  e.target.value = '';
}

function gmClear() {
  if (!confirm('¿Eliminar la biblioteca GM cargada? No afecta tus recetas de PanMaestro.')) return;
  G.gmRecipes = [];
  G.gmRecipesLoaded = false;
  pmSave('costeo');
  gmRenderList();
  pmToast('Biblioteca GM eliminada');
}

function gmRenderList() {
  const listEl    = document.getElementById('gm-list');
  const wrapEl    = document.getElementById('gm-search-wrap');
  const clearBtn  = document.getElementById('gm-clear-btn');
  const counterEl = document.getElementById('gm-counter');
  const recipes   = G.gmRecipes || [];

  if (!recipes.length) {
    if (wrapEl)   wrapEl.style.display   = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    if (counterEl) counterEl.textContent = '';
    if (listEl) listEl.innerHTML = `<div class="ph" style="flex-direction:column;align-items:center;padding:32px 0">
      <span style="font-size:40px">🌾</span>
      <div style="font-size:14px;font-weight:600;color:var(--cream);margin:10px 0 4px">Sin recetas GM cargadas</div>
      <div style="font-size:12px;color:var(--cream2)">Usá el botón "⬇ Cargar JSON de GM" para importar tu backup de Gluten Morgen</div>
    </div>`;
    return;
  }

  if (wrapEl)   wrapEl.style.display   = 'block';
  if (clearBtn) clearBtn.style.display = 'inline-flex';

  const q = (document.getElementById('gm-search')?.value || '').toLowerCase().trim();
  const transferred = new Set((G.recetas||[]).filter(r=>r.gmSource).map(r=>r.gmSource));

  let list = recipes.slice().sort((a,b)=>(a.order||0)-(b.order||0));
  if (q) list = list.filter(r => r.name.toLowerCase().includes(q));

  if (counterEl) counterEl.textContent = list.length + ' de ' + recipes.length + ' recetas';

  if (!list.length) {
    listEl.innerHTML = '<div class="ph"><span class="ph-icon">🔍</span>Sin resultados para "' + q + '"</div>';
    return;
  }

  listEl.innerHTML = list.map(r => {
    const done = transferred.has(r.name);
    const agua = (r.ingredients||[]).find(x => /agua/i.test(x.name));
    const hid  = agua ? ' · ' + Math.round(agua.percentage) + '% hid' : '';
    const cats = [...new Set((r.ingredients||[]).map(i => i.name))].slice(0,3).join(', ');
    return `<div class="ped-card" style="cursor:pointer;margin-bottom:8px;border-color:${done?'rgba(74,144,96,0.4)':'var(--border)'}"
      onclick="gmOpenModal('${encodeURIComponent(r.name)}')">
      <div class="ped-head" style="pointer-events:none">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:var(--cream)">
            ${r.name}
            ${done?'<span style="font-size:10px;background:rgba(74,144,96,.2);color:#5aad73;padding:2px 7px;border-radius:4px;margin-left:6px">✓ transferida</span>':''}
          </div>
          <div style="font-size:11px;color:var(--cream2);margin-top:2px">${r.weight||'?'}g · ${(r.ingredients||[]).length} ingredientes${hid}</div>
        </div>
        <span style="font-size:18px;color:var(--cream2)">›</span>
      </div>
    </div>`;
  }).join('');
}

function gmOpenModal(encodedName) {
  const name = decodeURIComponent(encodedName);
  const r = (G.gmRecipes||[]).find(x => x.name === name);
  if (!r) return;

  const transferred = new Set((G.recetas||[]).filter(x=>x.gmSource).map(x=>x.gmSource));
  const done = transferred.has(r.name);
  const ingrs = (r.ingredients||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0));

  const FLOUR_RE = /harina|sémola|semola|centeno|espelta|trigo|sarraceno/i;

  let body = `<div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:var(--gold);margin-bottom:4px">${r.name}</div>`;
  body += `<div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--cream2);margin-bottom:14px">
    ${r.weight||'?'}g · ${(r.ingredients||[]).length} ingredientes
    ${r.updatedAt ? '· ' + new Date(r.updatedAt).toLocaleDateString('es-CR') : ''}
  </div>`;

  body += `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--gold);margin-bottom:8px">Ingredientes</div>`;

  body += ingrs.map(ing => {
    const pct  = parseFloat(ing.percentage)||0;
    const g    = ((r.weight||1000) * pct / 100).toFixed(1);
    const isF  = FLOUR_RE.test(ing.name);
    const inMaestro = G.ingredientes && G.ingredientes[ing.name];
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span>
        <span style="font-size:10px;padding:2px 6px;border-radius:4px;margin-right:6px;font-family:'DM Mono',monospace;
          background:${isF?'rgba(200,146,42,.15)':'rgba(74,128,192,.15)'};
          color:${isF?'var(--gold)':'var(--blue)'}">${pct}%</span>
        ${ing.name}
        ${inMaestro?'<span style="font-size:10px;color:var(--green);margin-left:4px">✓</span>':''}
      </span>
      <span style="font-family:'DM Mono',monospace;color:var(--cream2)">≈${g}g</span>
    </div>`;
  }).join('');

  if (r.note && r.note.trim()) {
    body += `<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--gold);margin-bottom:6px">Notas</div>
      <pre style="font-size:12px;color:var(--cream2);line-height:1.7;white-space:pre-wrap;font-family:'DM Mono',monospace">${r.note}</pre>
    </div>`;
  }

  if (done) {
    body += `<div style="margin-top:12px;padding:8px 12px;border-radius:8px;background:rgba(74,144,96,.12);color:#5aad73;font-size:12px">
      ✓ Ya transferida a PanMaestro
    </div>`;
  }

  document.getElementById('gm-modal-body').innerHTML = body;

  const btns = document.getElementById('gm-modal-btns');
  btns.innerHTML = '';

  const btnT = document.createElement('button');
  btnT.className = 'btn btn-gold';
  btnT.style.flex = '1';
  btnT.textContent = done ? '↺ Volver a transferir' : '→ Transferir a PanMaestro';
  btnT.onclick = () => gmDoTransfer(name, false);
  btns.appendChild(btnT);

  const btnE = document.createElement('button');
  btnE.className = 'btn btn-out btn-sm';
  btnE.textContent = '✏️ Editar y transferir';
  btnE.onclick = () => gmDoTransfer(name, true);
  btns.appendChild(btnE);

  document.getElementById('gm-modal').style.display = 'block';
}

function gmCloseModal() {
  document.getElementById('gm-modal').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// RECETA PERSONAL — una sola a la vez, sin biblioteca. El JSON ya
// vive en el dispositivo del usuario (lo bajó de la herramienta
// standalone) como respaldo — acá solo se guarda "la que está en
// proceso ahora mismo", y se vacía sola en cuanto se transfiere.
// ══════════════════════════════════════════════════════════════

function personalCargarJson() {
  const raw = document.getElementById('personal-json-input').value.trim();
  if (!raw) { pmToast('Pegá el JSON de la receta primero', 'err'); return; }
  personalProcesarTexto(raw);
}

function personalCargarArchivo(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    personalProcesarTexto(ev.target.result);
  };
  reader.onerror = () => pmToast('No se pudo leer el archivo', 'err');
  reader.readAsText(file);
  e.target.value = '';
}

function personalProcesarTexto(raw) {
  let data;
  try { data = JSON.parse(raw); } catch(err) {
    pmToast('Error al leer JSON: ' + err.message, 'err'); return;
  }
  if (!data || !data.name || !Array.isArray(data.flour)) {
    pmToast('Ese JSON no tiene la forma de una receta personal válida', 'err'); return;
  }
  G.recetaPersonalActual = data;
  pmSave('costeo');
  document.getElementById('personal-json-input').value = '';
  personalRenderPreview();
  pmToast('✓ Receta cargada — revisala abajo');
}

function personalDescartar() {
  G.recetaPersonalActual = null;
  pmSave('costeo');
  personalRenderPreview();
}

function personalRenderPreview() {
  const el = document.getElementById('personal-preview');
  const r = G.recetaPersonalActual;
  if (!el) return;
  if (!r) { el.innerHTML = ''; return; }

  const ingrs = [...(r.flour||[]).map(i=>({...i,esHarina:true})), ...(r.other||[]).map(i=>({...i,esHarina:false}))];

  let body = `<div class="card">`;
  body += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:4px">
    <div style="font-family:'Playfair Display',serif;font-size:19px;font-weight:700;color:var(--gold)">${r.name}</div>
    <button class="btn btn-out btn-sm" onclick="personalDescartar()" title="Descartar">✕</button>
  </div>`;
  body += `<div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--cream2);margin-bottom:14px">
    ${r.totalMass||'?'}g · ${r.units||1} unidad(es) · ${ingrs.length} ingredientes${r.merma?' · merma '+r.merma+'%':''}
  </div>`;

  body += `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--gold);margin-bottom:8px">Ingredientes</div>`;
  body += ingrs.map(ing => {
    const pct  = parseFloat(ing.pct)||0;
    const g    = ((r.totalMass||1000) * pct / 100).toFixed(1);
    const nom  = ing.manualName || ing.productName || '(sin nombre)';
    const inMaestro = G.ingredientes && G.ingredientes[nom];
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span>
        <span style="font-size:10px;padding:2px 6px;border-radius:4px;margin-right:6px;font-family:'DM Mono',monospace;
          background:${ing.esHarina?'rgba(200,146,42,.15)':'rgba(74,128,192,.15)'};
          color:${ing.esHarina?'var(--gold)':'var(--blue)'}">${pct}%</span>
        ${nom}
        ${inMaestro?'<span style="font-size:10px;color:var(--green);margin-left:4px">✓</span>':''}
      </span>
      <span style="font-family:'DM Mono',monospace;color:var(--cream2)">≈${g}g</span>
    </div>`;
  }).join('');

  if (r.notes && r.notes.trim()) {
    body += `<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--gold);margin-bottom:6px">Notas</div>
      <pre style="font-size:12px;color:var(--cream2);line-height:1.7;white-space:pre-wrap;font-family:'DM Mono',monospace">${r.notes}</pre>
    </div>`;
  }

  body += `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-gold" style="flex:1" onclick="personalTransferir(false)">→ Transferir a PanMaestro</button>
    <button class="btn btn-out btn-sm" onclick="personalTransferir(true)">✏️ Editar y transferir</button>
  </div>`;
  body += `</div>`;

  el.innerHTML = body;
}

function _personalConvert(r) {
  return {
    id:         'personal_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    code:       '',
    personalSource: r.personalSource || r.name,
    name:       r.name,
    cat:        r.cat || 'pan',
    totalMass:  r.totalMass || 1000,
    units:      r.units || 1,
    merma:      r.merma || 0,
    notes:      r.notes || '',
    flour: (r.flour||[]).map(i => ({ pct: i.pct, manualName: i.manualName||'', productName: G.ingredientes?.[i.manualName] ? i.manualName : (i.productName||'') })),
    other: (r.other||[]).map(i => ({ pct: i.pct, manualName: i.manualName||'', productName: G.ingredientes?.[i.manualName] ? i.manualName : (i.productName||'') })),
    subrecs: []
  };
}

function personalTransferir(toEditor) {
  const r = G.recetaPersonalActual;
  if (!r) return;
  const rec = _personalConvert(r);

  if (toEditor) {
    document.getElementById('cv-nueva-titulo').textContent = 'Importando: ' + rec.name;
    document.getElementById('mr-id').value = rec.id;
    document.getElementById('mr-code').value = _pmNextRecCode();
    document.getElementById('mr-code').disabled = false;
    document.getElementById('mr-name').value = rec.name;
    document.getElementById('mr-masa').value = rec.totalMass||1000;
    document.getElementById('mr-units').value = rec.units||1;
    document.getElementById('mr-merma').value = rec.merma||0;
    document.getElementById('mr-notes').value = rec.notes||'';
    document.getElementById('mr-cat').value = rec.cat||'pan';
    document.getElementById('mr-ing-list').innerHTML = '';
    document.getElementById('mr-sub-list').innerHTML = '';
    mrIngCount = 0; mrSubCount = 0;
    (rec.flour||[]).forEach(i => mrAddIng(i.manualName||i.productName||'', i.pct, true));
    (rec.other||[]).forEach(i => mrAddIng(i.manualName||i.productName||'', i.pct, false));
    mrRefreshEmpty();
    // Marcar el origen (solo informativo, ver recSave) — no hace falta
    // rastrear "ya transferida" porque no hay biblioteca persistente.
    document.getElementById('mr-id').value = rec.id + '|personalsource|' + encodeURIComponent(rec.personalSource);
    cvMostrar('cv-nueva');
    // Se vacía la casilla apenas se entrega al editor — el trabajo ya
    // pasó a manos del formulario normal de recetas.
    G.recetaPersonalActual = null;
    pmSave('costeo');
    pmToast('Receta en editor — revisá ingredientes y guardá ✓');
    return;
  }

  // Transferencia directa — siempre crea una receta nueva con código R-xxxx
  if (!G.recetas) G.recetas = [];
  rec.code = _pmNextRecCode();
  G.recetas.push(rec);
  pmSave('recetas');

  if (pmDB.disponible()) {
    // NOTA: no se manda personal_source a Supabase — esa columna
    // probablemente no existe todavía en la tabla recetas (mismo tipo
    // de problema que tuvimos hoy con receta_cod faltante).
    pmDB.recetas.crear({
      codigo: rec.code, nombre: rec.name, categoria: rec.cat,
      masa_total_g: rec.totalMass, unidades: rec.units, merma_pct: rec.merma || 0,
      notas: rec.notes || '', origen: 'propia', activo: true,
      subrecs: rec.subrecs||[], addons: []
    }).then(rows => {
      if (rows?.[0]) {
        const idx = G.recetas.findIndex(x=>x.id===rec.id);
        if (idx >= 0) { G.recetas[idx]._sbId = rows[0].id; pmSave('recetas'); }
        _sbSaveRecetaItems(rows[0].id, rec.flour, rec.other).catch(e => console.warn('[pmDB] items personal error:', e.message));
      }
    }).catch(e => console.warn('[pmDB] personal transfer crear error:', e.message));
  }

  G.recetaPersonalActual = null;
  pmSave('costeo');
  personalRenderPreview();
  pmToast('✓ "' + rec.name + '" transferida como ' + rec.code);
}

function _gmConvert(r) {
  const FLOUR_RE = /harina|sémola|semola|centeno|espelta|trigo|sarraceno/i;
  const ingrs = (r.ingredients||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0));
  let flourIngrs = ingrs.filter(i => FLOUR_RE.test(i.name));
  let otherIngrs = ingrs.filter(i => !FLOUR_RE.test(i.name));
  if (flourIngrs.length === 0 && ingrs.length > 0) {
    flourIngrs = [ingrs[0]];
    otherIngrs = ingrs.slice(1);
  }
  return {
    id:        'gm_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    code:      '',
    gmCode:    r.code || '',
    name:      r.name,
    cat:       'pan',
    totalMass: r.weight || 1000,
    units:     1,
    merma:     0,
    notes:     r.note || '',
    gmSource:  r.name,
    flour: flourIngrs.map(i => ({ pct: i.percentage, manualName: i.name, productName: G.ingredientes?.[i.name] ? i.name : '' })),
    other: otherIngrs.map(i => ({ pct: i.percentage, manualName: i.name, productName: G.ingredientes?.[i.name] ? i.name : '' })),
    subrecs: []
  };
}

function gmDoTransfer(name, toEditor) {
  const r = (G.gmRecipes||[]).find(x => x.name === name);
  if (!r) return;
  const rec = _gmConvert(r);

  if (toEditor) {
    gmCloseModal();
    // Load into the editor
    document.getElementById('cv-nueva-titulo').textContent = 'Importando: ' + rec.name;
    document.getElementById('mr-id').value = rec.id;
    // Check if already transferred — use existing code
    const existingGm = (G.recetas||[]).find(x => x.gmSource === name);
    document.getElementById('mr-code').value = existingGm ? existingGm.code : _pmNextRecCode();
    // FIX SESIÓN 2 (B2): mismo bloqueo — si esta receta GM ya fue
    // transferida antes, su código ya existe y no debe editarse aquí,
    // por el mismo motivo que en recEditar().
    document.getElementById('mr-code').disabled = !!existingGm;
    document.getElementById('mr-name').value = rec.name;
    document.getElementById('mr-masa').value = rec.totalMass||1000;
    document.getElementById('mr-units').value = rec.units||1;
    document.getElementById('mr-merma').value = rec.merma||0;
    document.getElementById('mr-notes').value = rec.notes||'';
    document.getElementById('mr-cat').value = 'pan';
    document.getElementById('mr-ing-list').innerHTML = '';
    document.getElementById('mr-sub-list').innerHTML = '';
    mrIngCount = 0; mrSubCount = 0;
    (rec.flour||[]).forEach(i => mrAddIng(i.manualName||i.productName||'', i.pct, true));
    (rec.other||[]).forEach(i => mrAddIng(i.manualName||i.productName||'', i.pct, false));
    mrRefreshEmpty();
    // Mark as GM source
    document.getElementById('mr-id').value = rec.id + '|gmsource|' + rec.gmSource;
    cvMostrar('cv-nueva');
    pmToast('Receta en editor — revisá ingredientes y guardá ✓');
    return;
  }

  // Direct transfer — always use auto R-XXXX code, preserve if already transferred
  if (!G.recetas) G.recetas = [];
  const idx = G.recetas.findIndex(x => x.gmSource === name);
  if (idx >= 0) {
    // Already transferred — update content but KEEP our own id and code
    const existing = G.recetas[idx];
    rec.id   = existing.id;
    rec.code = existing.code;      // Keep our R-XXXX
    delete rec.gmCode;             // Remove GM code reference
    G.recetas[idx] = rec;
    pmToast('↺ "' + name + '" actualizada en sistema');
  } else {
    // First transfer — assign our own sequential code
    rec.code = _pmNextRecCode();
    delete rec.gmCode;             // Remove GM code reference
    G.recetas.push(rec);
    pmToast('✓ "' + name + '" → ' + rec.code + ' en sistema');
  }
  // Supabase dual write — crear si nunca se creó, actualizar si ya existe.
  // SESIÓN 11 fix: la transferencia directa (sin pasar por el editor) tampoco
  // creaba nunca el registro en Supabase — quedaba solo en el navegador local.
  if (pmDB.disponible()) {
    const cached = _sbGetRec(rec.id);
    if (cached?.sbId) {
      pmDB.recetas.editar(cached.sbId, {
        nombre: rec.name, categoria: rec.cat, masa_total_g: rec.totalMass,
        unidades: rec.units, merma_pct: rec.merma, notas: rec.notes,
        subrecs: rec.subrecs || [], addons: rec.addons || []
      }).then(() => _sbSaveRecetaItems(cached.sbId, rec.flour, rec.other))
        .catch(e => console.warn('[pmDB] gmDoTransfer update error:', e.message));
    } else {
      pmDB.recetas.crear({
        codigo: rec.code, nombre: rec.name, categoria: rec.cat,
        masa_total_g: rec.totalMass, unidades: rec.units,
        merma_pct: rec.merma, margen_pct: null,
        notas: rec.notes, origen: 'propia', activo: true,
        subrecs: rec.subrecs || [], addons: rec.addons || []
      }).then(rows => {
        if (rows?.[0]) {
          rec.sbId = rows[0].id;
          console.log('[pmDB] ✅ Receta GM (transferencia directa) creada en Supabase:', rec.code);
          _sbSaveRecetaItems(rows[0].id, rec.flour, rec.other).catch(e => console.warn('[pmDB] items gmDirect error:', e.message));
        }
      }).catch(e => console.warn('[pmDB] gmDoTransfer create error:', e.message));
    }
    _sbRecCache = null;
  }
  pmSave('costeo');
  fillRscSel();
  gmRenderList();
  gmCloseModal();
}


