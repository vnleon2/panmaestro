// ── ⚙️ MAESTROS ──────────────────────────────────────────
let currentTab = 'pan';
function mTab(tab, btn) {
  currentTab = tab;
  ['pan','galleta','ing','clientes','estados','catalogo','sync','backup'].forEach(t => {
    const el = document.getElementById('mt-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#m-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  const renders = {pan:panCargarSb, galleta:gallCargarSb, ing:ingCargarSb, clientes:() => { _sbCliCache = null; cliRender(); }, estados:estCargarSb, catalogo:catRender};
  if (renders[tab]) renders[tab]();
  if (tab === 'sync') pmSyncUIRefresh();
}

// ─── MAESTROS — PRODUCTOS TERMINADOS (pan y galleta) ────────────────────────
// Sesión 4: escribe en localStorage + Supabase simultáneamente.
// _sbProdMap: cache local { codigo → uuid } para no consultar Supabase en cada op.
// _sbProdMapInv: inverso { uuid → codigo } para lookup en lotes
let _sbProdMap = null;
let _sbProdMapInv = null;
async function _sbProdEnsureMap(forzar = false) {
  // FIX: antes, si la carga fallaba (red, error), igual se guardaba
  // `_sbProdMap = {}` — un objeto vacío es "verdadero" en JS, así que la
  // condición de arriba nunca volvía a intentar cargar el mapa el resto
  // de la sesión. Además, si un producto se creaba/sincronizaba DESPUÉS
  // de la primera carga, el mapa quedaba desactualizado sin forma de
  // refrescarlo. Ahora se puede forzar un refresco (forzar=true) y un
  // fallo real ya no se cachea como si fuera un mapa válido.
  if (_sbProdMap && !forzar) return;
  try {
    const rows = await pmDB.productos.listar();
    const map = {}, inv = {};
    (rows||[]).forEach(r => { map[r.codigo] = r.id; inv[r.id] = r.codigo; });
    _sbProdMap = map;
    _sbProdMapInv = inv;
  } catch(e) {
    console.warn('[pmDB] _sbProdEnsureMap error:', e.message);
    // No se cachea el fallo — _sbProdMap queda como estaba (null la
    // primera vez) para poder reintentar en la próxima llamada.
  }
}

function panAdd() {
  const nom = document.getElementById('pan-nom').value.trim();
  const pr  = parseFloat(document.getElementById('pan-pr').value)||0;
  const peso= parseFloat(document.getElementById('pan-peso').value)||0;
  const rec = document.getElementById('pan-rec').value.trim();
  if (!nom) { pmToast('Ingresá el nombre','err'); return; }
  const existing = G.tiposPan.map(p => parseInt(p.id.replace('P',''))||0);
  const next = String(Math.max(0,...existing)+1).padStart(3,'0');
  const newId = 'P'+next;
  G.tiposPan.push({ id:newId, nombre:nom, precio:pr, peso, recetaCod: rec });
  pmSave('sistema');
  document.getElementById('pan-nom').value='';
  document.getElementById('pan-pr').value='';
  document.getElementById('pan-peso').value='';
  document.getElementById('pan-rec').value='';
  panRender();
  pmToast('Tipo de pan agregado ✓');
  // Supabase — dual write
  if (pmDB.disponible()) {
    // FIX: antes un fallo acá solo dejaba un console.warn — invisible.
    // Si esto falla, el tipo de pan queda SOLO local (como pasó con
    // "Pan del Día") y cualquier pedido que lo use nunca podrá
    // sincronizar su línea a Supabase, sin ninguna pista de por qué.
    pmDB.productos.crear({ codigo:newId, nombre:nom, tipo:'pan', presentacion:'unidad', peso_g:peso||null, precio_full:pr, receta_cod:rec||null, activo:true })
      .then(rows => { if (rows?.[0]) { if(!_sbProdMap)_sbProdMap={}; _sbProdMap[newId]=rows[0].id; } else {
        pmToast('⚠️ "' + nom + '" guardado solo local — revisá la sincronización con Supabase', 'err');
      } })
      .catch(e => {
        console.warn('[pmDB] panAdd sync error:', e.message);
        pmToast('⚠️ "' + nom + '" guardado solo local — no se sincronizó a Supabase: ' + e.message, 'err');
      });
  }
}

// ── Carga tipos de pan desde Supabase (fuente primaria) ──
async function panCargarSb() {
  if (pmDB.disponible()) {
    try {
      await _sbProdEnsureMap();
      const rows = await pmDB.productos.listarPanes();
      if (rows && rows.length) {
        // Reconstruir G.tiposPan desde SB manteniendo orden y campos locales
        const sbPanes = rows.map(r => {
          const local = G.tiposPan.find(p => p.id === r.codigo);
          return {
            id: r.codigo,
            nombre: r.nombre,
            precio: r.precio_full || r.precio || 0,
            peso: r.peso_g || local?.peso || 0,
            recetaCod: r.receta_cod || local?.recetaCod || ''
          };
        });
        // Mantener panes locales que no estén en SB (offline)
        const offline = G.tiposPan.filter(p => !sbPanes.find(s => s.id === p.id));
        G.tiposPan = [...sbPanes, ...offline];
        pmSave('sistema');
      }
    } catch(e) { console.warn('[panCargarSb]', e.message); }
  }
  panRender();
}

// ── Carga tipos de galleta desde Supabase (fuente primaria) ──
async function gallCargarSb() {
  if (pmDB.disponible()) {
    try {
      await _sbProdEnsureMap();
      const rows = await pmDB.productos.listarGalletas();
      if (rows && rows.length) {
        const sbGalletas = rows.map(r => {
          const local = G.tiposGalleta.find(p => p.id === r.codigo);
          return {
            id: r.codigo,
            nombre: r.nombre,
            precio: r.precio_full || r.precio || 0,
            peso: r.peso_g || local?.peso || 0,
            recetaCod: r.receta_cod || local?.recetaCod || ''
          };
        });
        const offline = G.tiposGalleta.filter(p => !sbGalletas.find(s => s.id === p.id));
        G.tiposGalleta = [...sbGalletas, ...offline];
        pmSave('sistema');
      }
    } catch(e) { console.warn('[gallCargarSb]', e.message); }
  }
  gallRender();
}

function panRender() {
  const q = (document.getElementById('pan-search')?.value||'').toLowerCase();
  const list = G.tiposPan.filter(p => !q || p.nombre.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)).sort((a,b) => (a.id||'').localeCompare(b.id||''));
  document.getElementById('pan-count').textContent = `Tipos de pan (${list.length})`;
  document.getElementById('pan-list').innerHTML = list.map(p => {
    // Calcular costo desde receta vinculada
    let cpgRec = null, costoTipoPan = null, margenReal = null;
    if (p.recetaCod && p.peso) {
      const rec = _sbRecLista().find(r => r.code === p.recetaCod);
      if (rec) {
        const c = pmCostoReceta(rec);
        if (c.totalMerma && rec.totalMass) {
          const modPct = rec.modPct !== undefined ? rec.modPct : 80;
          const ggPct  = rec.ggPct  !== undefined ? rec.ggPct  : 45;
          const costTotal = c.totalMerma * (1 + (modPct + ggPct) / 100);
          cpgRec = costTotal / rec.totalMass;
          costoTipoPan = cpgRec * p.peso;
          if (p.precio > 0) margenReal = (p.precio - costoTipoPan) / p.precio * 100;
        }
      }
    }
    const cpgCell = cpgRec !== null
      ? `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--cream2)">₡${cpgRec.toFixed(2)}/g</div>`
      : `<div style="font-size:10px;color:var(--cream2);opacity:.4">—</div>`;
    const costoCell = costoTipoPan !== null
      ? `<div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--gold2);font-weight:600">${pmMoney(Math.round(costoTipoPan))}</div>`
      : `<div style="font-size:10px;color:var(--cream2);opacity:.4">—</div>`;
    const margenColor = margenReal === null ? 'var(--cream2)' : margenReal >= 40 ? 'var(--green)' : margenReal >= 20 ? 'var(--amber)' : 'var(--red)';
    const margenCell = margenReal !== null
      ? `<div style="font-family:'DM Mono',monospace;font-size:11px;color:${margenColor};font-weight:600">${margenReal.toFixed(1)}%</div>`
      : `<div style="font-size:10px;color:var(--cream2);opacity:.4">—</div>`;
    return `
    <div class="item-row" id="pan-row-${p.id}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:44px">${p.id}</div>
      <div class="item-name">${p.nombre}</div>
      <div class="item-meta">${pmMoney(p.precio)} · ${p.peso}g</div>
      ${p.recetaCod ? `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--blue);background:rgba(74,128,192,.12);padding:2px 7px;border-radius:10px;border:1px solid rgba(74,128,192,.3)">${p.recetaCod}</div>` : `<div style="font-size:10px;color:var(--cream2);opacity:.4">—</div>`}
      ${cpgCell}
      ${costoCell}
      ${margenCell}
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="panEdit('${p.id}')">✏️</button>
        <button class="btn btn-red btn-xs" onclick="panDel('${p.id}')">✕</button>
      </div>
    </div>`;
  }).join('') || '<div class="ph"><span class="ph-icon">🍞</span>Sin tipos de pan</div>';
}

// ── Poblar dropdown de recetas en formulario de tipos de pan ──
function panRecetaPopulate() {
  const sel = document.getElementById('pan-rec');
  if (!sel) return;
  const recetas = _sbRecLista().filter(r => r.code && r.code.startsWith('R-'));
  const current = sel.value;
  sel.innerHTML = '<option value="">— Sin receta —</option>' +
    recetas.map(r => `<option value="${r.code}"${r.code===current?' selected':''}>${r.code} · ${r.name}</option>`).join('');
}

function panEdit(id) {
  const p = G.tiposPan.find(x => x.id===id);
  if (!p) return;
  document.querySelectorAll('.pan-edit-form').forEach(el => el.remove());
  const row = document.getElementById('pan-row-' + id);
  if (!row) { panRender(); return; }
  const recetas = _sbRecLista().filter(r => r.code && r.code.startsWith('R-'));
  const recOpts = '<option value="">— Sin receta —</option>' +
    recetas.map(r => `<option value="${r.code}"${r.code===(p.recetaCod||'')?' selected':''}>${r.code} · ${r.name}</option>`).join('');
  const form = document.createElement('div');
  form.className = 'pan-edit-form';
  form.style.cssText = 'padding:10px 12px;background:rgba(200,146,42,.06);border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end';
  form.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:2px;flex:2;min-width:140px">
      <label style="font-size:11px;color:var(--cream2)">Nombre</label>
      <input id="pe-nom-${id}" type="text" value="${p.nombre.replace(/"/g,'&quot;')}" style="font-size:12px;padding:4px 7px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)">
    </div>
    <div style="display:flex;flex-direction:column;gap:2px;min-width:80px">
      <label style="font-size:11px;color:var(--cream2)">Precio ₡</label>
      <input id="pe-pr-${id}" type="number" value="${p.precio||0}" style="font-size:12px;padding:4px 7px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);width:80px">
    </div>
    <div style="display:flex;flex-direction:column;gap:2px;min-width:70px">
      <label style="font-size:11px;color:var(--cream2)">Peso g</label>
      <input id="pe-peso-${id}" type="number" value="${p.peso||0}" style="font-size:12px;padding:4px 7px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);width:70px">
    </div>
    <div style="display:flex;flex-direction:column;gap:2px;flex:2;min-width:160px">
      <label style="font-size:11px;color:var(--cream2)">Receta</label>
      <select id="pe-rec-${id}" style="font-size:12px;padding:4px 7px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream)">${recOpts}</select>
    </div>
    <div style="display:flex;gap:4px;padding-bottom:1px">
      <button class="btn btn-gold btn-sm" onclick="panEditSave('${id}')">💾 Guardar</button>
      <button class="btn btn-out btn-sm" onclick="panEditCancelar()">✕</button>
    </div>`;
  row.after(form);
  document.getElementById('pe-nom-' + id)?.focus();
}

function panEditCancelar() {
  document.querySelectorAll('.pan-edit-form').forEach(el => el.remove());
}

function panEditSave(id) {
  const p = G.tiposPan.find(x => x.id===id);
  if (!p) return;
  const nom  = document.getElementById('pe-nom-'  + id)?.value.trim();
  const pr   = parseFloat(document.getElementById('pe-pr-'   + id)?.value)||0;
  const peso = parseFloat(document.getElementById('pe-peso-' + id)?.value)||0;
  const rec  = document.getElementById('pe-rec-'  + id)?.value || '';
  if (!nom) { pmToast('El nombre no puede estar vacío','err'); return; }
  p.nombre = nom; p.precio = pr; p.peso = peso; p.recetaCod = rec;
  pmSave('sistema');
  panRender();
  pmToast('Actualizado ✓');
  if (pmDB.disponible()) {
    _sbProdEnsureMap().then(() => {
      const uuid = _sbProdMap?.[id];
      if (uuid) pmDB.productos.editar(uuid, { nombre:p.nombre, precio_full:p.precio, peso_g:p.peso||null, receta_cod:p.recetaCod||null })
        .catch(e => console.warn('[pmDB] panEditSave sync error:', e.message));
    });
  }
}

function panDel(id) {
  if (!confirm('¿Eliminar este tipo de pan?')) return;
  G.tiposPan = G.tiposPan.filter(x => x.id!==id);
  pmSave('sistema'); panRender(); pmToast('Eliminado');
  // Supabase — soft delete
  if (pmDB.disponible()) {
    _sbProdEnsureMap().then(() => {
      const uuid = _sbProdMap?.[id];
      if (uuid) pmDB.productos.eliminar(uuid)
        .catch(e => console.warn('[pmDB] panDel sync error:', e.message));
    });
  }
}

// ─── GALLETAS ────────────────────────────────────────────────────────────────

function gallAdd() {
  const nom = document.getElementById('gall-nom').value.trim();
  const pr  = parseFloat(document.getElementById('gall-pr').value)||0;
  const peso= parseFloat(document.getElementById('gall-peso').value)||0;
  if (!nom) { pmToast('Ingresá el nombre','err'); return; }
  const existing = G.tiposGalleta.map(p => parseInt(p.id.replace('G',''))||0);
  const next = String(Math.max(0,...existing)+1).padStart(3,'0');
  const newId = 'G'+next;
  G.tiposGalleta.push({ id:newId, nombre:nom, precio:pr, peso });
  pmSave('sistema');
  document.getElementById('gall-nom').value='';
  document.getElementById('gall-pr').value='';
  document.getElementById('gall-peso').value='';
  gallRender(); pmToast('Tipo de galleta agregado ✓');
  // Supabase — dual write
  if (pmDB.disponible()) {
    pmDB.productos.crear({ codigo:newId, nombre:nom, tipo:'galleta', presentacion:'unidad', peso_g:peso||null, precio_full:pr, activo:true })
      .then(rows => { if (rows?.[0]) { if(!_sbProdMap)_sbProdMap={}; _sbProdMap[newId]=rows[0].id; } })
      .catch(e => console.warn('[pmDB] gallAdd sync error:', e.message));
  }
}

function gallRender() {
  document.getElementById('gall-count').textContent = `Tipos galleta (${G.tiposGalleta.length})`;
  document.getElementById('gall-list').innerHTML = G.tiposGalleta.map(p => `
    <div class="item-row">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:44px">${p.id}</div>
      <div class="item-name">${p.nombre}</div>
      <div class="item-meta">${pmMoney(p.precio)} · ${p.peso}g</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="gallEdit('${p.id}')">✏️</button>
        <button class="btn btn-red btn-xs" onclick="gallDel('${p.id}')">✕</button>
      </div>
    </div>`).join('') || '<div class="ph"><span class="ph-icon">🍪</span>Sin tipos de galleta</div>';
}

function gallEdit(id) {
  const p = G.tiposGalleta.find(x=>x.id===id);
  if (!p) return;
  const nom=prompt('Nombre:',p.nombre); if(!nom) return;
  const pr=prompt('Precio:',p.precio); if(pr===null) return;
  const peso=prompt('Peso:',p.peso); if(peso===null) return;
  p.nombre=nom; p.precio=parseFloat(pr)||p.precio; p.peso=parseFloat(peso)||p.peso;
  pmSave('sistema'); gallRender(); pmToast('Actualizado ✓');
  // Supabase — dual write
  if (pmDB.disponible()) {
    _sbProdEnsureMap().then(() => {
      const uuid = _sbProdMap?.[id];
      if (uuid) pmDB.productos.editar(uuid, { nombre:p.nombre, precio_full:p.precio, peso_g:p.peso||null })
        .catch(e => console.warn('[pmDB] gallEdit sync error:', e.message));
    });
  }
}

function gallDel(id) {
  if (!confirm('¿Eliminar?')) return;
  G.tiposGalleta=G.tiposGalleta.filter(x=>x.id!==id);
  pmSave('sistema'); gallRender();
  // Supabase — soft delete
  if (pmDB.disponible()) {
    _sbProdEnsureMap().then(() => {
      const uuid = _sbProdMap?.[id];
      if (uuid) pmDB.productos.eliminar(uuid)
        .catch(e => console.warn('[pmDB] gallDel sync error:', e.message));
    });
  }
}

// ─── INGREDIENTES ─────────────────────────────────────────────────────────────
// Cache local { nombre → uuid } para ingredientes en Supabase
let _sbIngMap = null;
let _sbIngById = null; // { uuid → registro completo del ingrediente } — SESIÓN 11: migración a id estable
async function _sbIngEnsureMap() {
  if (_sbIngMap) return;
  try {
    // Load ALL ingredients including inactive to detect existing records
    const rows = await pmDB.get('ingredientes', {}, '*');
    _sbIngMap = {};
    _sbIngCache = {};
    _sbIngById = {};
    (rows||[]).forEach(r => {
      _sbIngMap[r.nombre] = r.id;
      _sbIngCache[r.nombre] = r;
      _sbIngById[r.id] = { price: r.precio_ref||0, qty: r.qty_base||1000, sbId: r.id, codigo: r.codigo, nombre: r.nombre };
    });
  } catch(e) { _sbIngMap = {}; _sbIngCache = {}; _sbIngById = {}; }
}

// ── Carga ingredientes desde Supabase (fuente primaria) ──
async function ingCargarSb() {
  if (pmDB.disponible()) {
    try {
      const rows = await pmDB.ingredientes.listar();
      if (rows && rows.length) {
        if (!_sbIngMap) _sbIngMap = {};
        if (!_sbIngCache) _sbIngCache = {};
        if (!_sbIngById) _sbIngById = {};
        rows.forEach(r => {
          _sbIngMap[r.nombre] = r.id;
          _sbIngCache[r.nombre] = r; // guardar objeto completo para acceder a codigo
          _sbIngById[r.id] = { price: r.precio_ref||0, qty: r.qty_base||1000, sbId: r.id, codigo: r.codigo, nombre: r.nombre }; // lookup estable por id — SESIÓN 11
          G.ingredientes[r.nombre] = { price: r.precio_ref||0, qty: r.qty_base||1000 };
        });
        pmSave('maestros');
      }
    } catch(e) { console.warn('[ingCargarSb]', e.message); }
  }
  ingRender();
}

async function ingAdd() {
  const nom = document.getElementById('ing-nom').value.trim();
  const pr  = parseFloat(document.getElementById('ing-pr').value)||0;
  const qty = parseFloat(document.getElementById('ing-qty').value)||1000;
  if (!nom) { pmToast('Ingresá el nombre','err'); return; }
  const key = nom.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  G.ingredientes[key] = { price:pr, qty };
  pmSave('maestros');
  document.getElementById('ing-nom').value='';
  document.getElementById('ing-pr').value='';
  document.getElementById('ing-qty').value='';
  ingRender();
  // Mostrar mensaje persistente de debug
  const dbgDiv = document.getElementById('ing-debug') || (() => {
    const d = document.createElement('div');
    d.id = 'ing-debug';
    d.style.cssText = 'background:#1a1a2e;color:#fff;padding:12px;margin:8px 0;border-radius:8px;font-size:12px;white-space:pre-wrap;border:1px solid #gold';
    document.getElementById('ing-list').before(d);
    return d;
  })();
  const log = (msg) => { dbgDiv.textContent += msg + '\n'; };
  dbgDiv.textContent = '⏳ Iniciando...\n';

  try {
    log('1. Cargando mapa SB...');
    _sbIngMap = null; _sbIngCache = null; // forzar recarga
    await _sbIngEnsureMap();
    log(`2. Mapa cargado: ${Object.keys(_sbIngMap||{}).length} ingredientes`);
    
    const existing = _sbIngMap?.[key];
    log(`3. ¿Existe "${key}"? ${existing ? 'SÍ → ' + existing : 'NO'}`);
    
    if (existing) {
      const cachedRec = _sbIngCache?.[key];
      const updateData = { precio_ref:pr, qty_base:qty, activo:true };
      if (!cachedRec?.codigo) {
        const allRows = await pmDB.get('ingredientes', {}, '*');
        const nums = (allRows||[]).map(r => r.codigo||'')
          .filter(c => c.startsWith('ING-'))
          .map(c => parseInt(c.replace('ING-',''))||0);
        const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
        updateData.codigo = `ING-${String(nextNum).padStart(3,'0')}`;
        log(`4. Asignando código: ${updateData.codigo}`);
      } else {
        log(`4. Ya tiene código: ${cachedRec.codigo}`);
      }
      await pmDB.ingredientes.editar(existing, updateData);
      if (_sbIngCache?.[key]) { _sbIngCache[key] = {..._sbIngCache[key], ...updateData}; }
      log(`5. ✅ Actualizado en SB`);
    } else {
      log('4. Calculando siguiente código...');
      const allRows = await pmDB.get('ingredientes', {}, '*');
      const nums = (allRows||[]).map(r => r.codigo||'')
        .filter(c => c.startsWith('ING-'))
        .map(c => parseInt(c.replace('ING-',''))||0);
      const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
      const codigo = `ING-${String(nextNum).padStart(3,'0')}`;
      log(`5. Código asignado: ${codigo}`);
      log(`6. Creando en SB...`);
      const rows = await pmDB.ingredientes.crear({ codigo, nombre:key, unidad:'g', precio_ref:pr, qty_base:qty, activo:true });
      log(`7. Respuesta SB: ${JSON.stringify(rows)}`);
      if (rows?.[0]) {
        if (!_sbIngMap) _sbIngMap = {};
        if (!_sbIngCache) _sbIngCache = {};
        _sbIngMap[key] = rows[0].id;
        _sbIngCache[key] = rows[0];
        log(`8. ✅ Creado con ID: ${rows[0].id}`);
      } else {
        log('8. ❌ Sin respuesta de SB - rows vacío');
      }
    }
    await ingCargarSb();
    log('9. ✅ COMPLETADO');
  } catch(e) {
    log(`❌ ERROR: ${e.message}`);
    console.warn('[ingAdd]', e.message);
  }
}

// ── Vista tabla de ingredientes por código ──
let _ingVistaTabla = false;

function ingSetVista(codigosMode) {
  _ingVistaTabla = codigosMode;
  const tabAlfa = document.getElementById('ing-tab-alfa');
  const tabCod  = document.getElementById('ing-tab-cod');
  if (tabAlfa && tabCod) {
    if (codigosMode) {
      tabAlfa.style.cssText = '';
      tabAlfa.className = 'btn btn-out btn-sm';
      tabCod.style.cssText = 'background:rgba(200,146,42,.15);border:1px solid var(--gold);color:var(--gold)';
      tabCod.className = 'btn btn-sm';
    } else {
      tabAlfa.style.cssText = 'background:rgba(200,146,42,.15);border:1px solid var(--gold);color:var(--gold)';
      tabAlfa.className = 'btn btn-sm';
      tabCod.style.cssText = '';
      tabCod.className = 'btn btn-out btn-sm';
    }
  }
  ingRender();
}

function ingRenderTabla(keys, sbCodMap) {
  const rows = keys
    .map(k => ({ k, cod: sbCodMap[k] || '' }))
    .sort((a,b) => a.cod.localeCompare(b.cod) || a.k.localeCompare(b.k));

  return `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead>
      <tr style="background:rgba(200,146,42,.1);text-align:left">
        <th style="padding:7px 10px;font-weight:600;letter-spacing:.5px">Código</th>
        <th style="padding:7px 10px;font-weight:600">Ingrediente</th>
        <th style="padding:7px 10px;font-weight:600;text-align:right">Precio</th>
        <th style="padding:7px 10px;font-weight:600;text-align:right">Base g</th>
        <th style="padding:7px 10px;font-weight:600;text-align:right">₡/g</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(({k, cod}) => {
        const ing = G.ingredientes[k];
        const cpg = ing.price && ing.qty ? (ing.price/ing.qty).toFixed(2) : '—';
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px 10px;font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3)">${cod||'—'}</td>
          <td style="padding:6px 10px;font-weight:500">${k}</td>
          <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace">₡${pmMoney(ing.price)}</td>
          <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace">${ing.qty}g</td>
          <td style="padding:6px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">₡${cpg}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function ingRender() {
  const q = (document.getElementById('ing-search')?.value||'').toLowerCase();
  // Construir lista con código desde _sbIngMap invertido
  const sbCodMap = {}; // nombre → codigo
  if (_sbIngMap) {
    // _sbIngMap = { nombre → uuid }, necesitamos el codigo
    // Lo tenemos en _sbIngCache si está cargado
    (_sbIngCache ? Object.values(_sbIngCache) : []).forEach(r => {
      if (r && r.nombre && r.codigo) sbCodMap[r.nombre] = r.codigo;
    });
  }
  const keys = Object.keys(G.ingredientes)
    .filter(k => !q || k.toLowerCase().includes(q))
    .sort((a,b) => a.localeCompare(b, 'es'));
  document.getElementById('ing-count').textContent = `Ingredientes (${keys.length})`;
  if (_ingVistaTabla) {
    document.getElementById('ing-list').innerHTML = keys.length
      ? ingRenderTabla(keys, sbCodMap)
      : '<div class="ph"><span class="ph-icon">🌾</span>Sin ingredientes</div>';
    return;
  }
  document.getElementById('ing-list').innerHTML = keys.map(k => {
    const ing = G.ingredientes[k];
    const cpg = ing.price && ing.qty ? (ing.price/ing.qty).toFixed(2) : '—';
    const cod = sbCodMap[k] ? `<span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:60px">${sbCodMap[k]}</span>` : '';
    return `<div class="item-row">
      ${cod}
      <div class="item-name">${k}</div>
      <div class="item-meta">${pmMoney(ing.price)} / ${ing.qty}g · <span style="color:var(--gold2)">₡${cpg}/g</span></div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="ingEdit('${k}')">✏️</button>
        <button class="btn btn-red btn-xs" onclick="ingDel('${k}')">✕</button>
      </div>
    </div>`;
  }).join('') || '<div class="ph"><span class="ph-icon">🌾</span>Sin ingredientes</div>';
}

async function ingEdit(nom) {
  const ing = G.ingredientes[nom];
  if (!ing) return;
  await _sbIngEnsureMap();
  const rows = document.querySelectorAll('#ing-list .item-row');
  let targetRow = null;
  rows.forEach(row => {
    if (row.querySelector('.item-name')?.textContent === nom) targetRow = row;
  });
  if (!targetRow) return;
  const cod = _sbIngCache?.[nom]?.codigo || '—';
  const key = nom.replace(/[^a-z0-9]/gi,'_');
  targetRow.innerHTML = `
    <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:60px">${cod}</span>
    <input type="text" id="ie-nom-${key}" value="${nom.replace(/"/g,'&quot;')}"
      style="flex:1;min-width:120px;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px"
      placeholder="Nombre">
    <input type="number" id="ie-price-${key}" value="${ing.price||0}" min="0"
      style="width:90px;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px"
      placeholder="Precio">
    <input type="number" id="ie-qty-${key}" value="${ing.qty||1000}" min="1"
      style="width:80px;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px"
      placeholder="g base">
    <button class="btn btn-gold btn-xs" onclick="ingEditSave('${nom}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="ingRender()">✕</button>`;
  targetRow.querySelector('input').focus();
}

/**
 * Renombrar es seguro para el costeo: pmCostoReceta() ya resuelve por
 * ingredientId (estable) y ahora también toma el NOMBRE en vivo del
 * maestro cuando hay id — ver fix en pmCostoReceta(). Las líneas de
 * receta guardan el texto viejo (productName/manualName) pero eso ya
 * no importa para costear ni para mostrar el nombre en Costeo.
 *
 * Lo único que hay que migrar con cuidado son los CACHÉS LOCALES
 * (G.ingredientes, _sbIngMap, _sbIngCache, _sbIngById) — todos están
 * indexados por nombre salvo _sbIngById. Si solo escribiéramos la
 * clave nueva sin borrar la vieja, quedaría un ingrediente "fantasma"
 * duplicado con el nombre anterior (mismo bug que ya vimos con otros
 * módulos). Por eso el rename borra la clave vieja explícitamente en
 * los 3 cachés keyed-by-name, además de actualizar Supabase por uuid.
 */
async function ingEditSave(nomOriginal) {
  const key   = nomOriginal.replace(/[^a-z0-9]/gi,'_');
  const nomEl = document.getElementById('ie-nom-'   + key);
  const prEl  = document.getElementById('ie-price-' + key);
  const qtyEl = document.getElementById('ie-qty-'   + key);
  if (!prEl || !qtyEl) return;

  const nuevoNombre = (nomEl?.value || nomOriginal).trim();
  const price = parseFloat(prEl.value)  || 0;
  const qty   = parseFloat(qtyEl.value) || 1000;

  if (!nuevoNombre) { pmToast('El nombre no puede quedar vacío','err'); return; }

  const renombrando = nuevoNombre !== nomOriginal;
  if (renombrando && G.ingredientes[nuevoNombre]) {
    pmToast(`Ya existe un ingrediente llamado "${nuevoNombre}" — elegí otro nombre o borrá el duplicado primero`, 'err');
    return;
  }

  // Local — mismo patrón "local primero, avisar si falla Supabase" que ya usa panAdd/panEditSave
  if (renombrando) {
    G.ingredientes[nuevoNombre] = { price, qty };
    delete G.ingredientes[nomOriginal];
  } else {
    G.ingredientes[nomOriginal] = { price, qty };
  }
  pmSave('maestros');
  ingRender();
  pmToast(renombrando ? `Renombrado a "${nuevoNombre}" ✓` : nomOriginal + ' actualizado ✓');

  if (pmDB.disponible()) {
    await _sbIngEnsureMap();
    const uuid = _sbIngMap?.[nomOriginal] || (renombrando ? _sbIngMap?.[nuevoNombre] : null);
    if (!uuid) {
      console.warn('[pmDB] ingEditSave: no se encontró uuid para', nomOriginal);
      if (renombrando) pmToast('⚠️ Renombrado solo local — no se encontró el registro en Supabase, revisá la sincronización', 'err');
      return;
    }
    const payload = { precio_ref:price, qty_base:qty };
    if (renombrando) payload.nombre = nuevoNombre;
    try {
      await pmDB.ingredientes.editar(uuid, payload);
      if (renombrando) {
        // Migrar claves en los 3 cachés locales indexados por nombre —
        // sin esto queda una entrada fantasma con el nombre viejo.
        if (_sbIngMap) { _sbIngMap[nuevoNombre] = uuid; delete _sbIngMap[nomOriginal]; }
        if (_sbIngCache) {
          const row = _sbIngCache[nomOriginal];
          if (row) { _sbIngCache[nuevoNombre] = { ...row, nombre: nuevoNombre }; delete _sbIngCache[nomOriginal]; }
        }
        if (_sbIngById && _sbIngById[uuid]) _sbIngById[uuid].nombre = nuevoNombre;
        ingRender();
      }
    } catch(e) {
      console.warn('[pmDB] ingEditSave sync error:', e.message);
      pmToast('⚠️ "' + nuevoNombre + '" guardado local pero no se sincronizó a Supabase: ' + e.message, 'err');
    }
  }
}

function ingDel(nom) {
  const uuid = _sbIngMap?.[nom] || null;
  // SESIÓN 11: revisar contra la lista completa (Supabase + local), no solo local
  const usedIn = _sbRecLista().filter(r => {
    return [...(r.flour||[]), ...(r.other||[])].some(i =>
      (uuid && i.ingredientId === uuid) || i.productName === nom || i.manualName === nom);
  }).map(r => r.code + ' ' + r.name);
  if (usedIn.length) {
    pmToast('Usado en: ' + usedIn.slice(0,3).join(', ') + (usedIn.length>3?' y más...':'') + ' — no se puede eliminar', 'err');
    return;
  }
  if (!confirm(`¿Eliminar "${nom}"?`)) return;
  delete G.ingredientes[nom];
  pmSave('maestros'); ingRender();
  // Supabase — soft delete
  if (pmDB.disponible()) {
    _sbIngEnsureMap().then(() => {
      const uuid = _sbIngMap?.[nom];
      if (uuid) {
        pmDB.ingredientes.eliminar(uuid)
          .catch(e => console.warn('[pmDB] ingDel sync error:', e.message));
        delete _sbIngMap[nom];
      }
    });
  }
}

async function estAdd() {
  const v = document.getElementById('est-nuevo').value.trim();
  if (!v || G.estados.includes(v)) return;
  G.estados.push(v);
  pmSave('sistema');
  document.getElementById('est-nuevo').value='';
  estRender(); pmToast('Estado agregado ✓');
  if (pmDB.disponible()) {
    // FIX: si este estado ya existía y se había "borrado" (borrado suave,
    // activo:false — ver estDel), insertar una fila nueva con el mismo
    // nombre choca con la restricción de unicidad en Supabase (409
    // Conflict). Se revisa primero si ya hay una fila con este nombre
    // (activa o no) y, si existe, se reactiva en vez de insertar una
    // duplicada.
    (async () => {
      try {
        const existing = await pmDB.get('estados_pedido', { nombre: v });
        if (existing?.[0]) {
          await pmDB.update('estados_pedido', existing[0].id, { activo: true });
        } else {
          await pmDB.insert('estados_pedido', { nombre: v, activo: true }, false);
        }
      } catch(e) {
        console.warn('[estAdd SB]', e.message);
        pmToast('⚠️ "' + v + '" se guardó local pero no en Supabase: ' + e.message, 'err');
      }
    })();
  }
}

async function instAdd() {
  const v = document.getElementById('inst-nuevo').value.trim();
  if (!v || G.instrucciones.includes(v)) return;
  G.instrucciones.push(v);
  pmSave('sistema');
  document.getElementById('inst-nuevo').value='';
  estRender(); pmToast('Instrucción agregada ✓');
  if (pmDB.disponible()) {
    // FIX: mismo caso que estAdd() — reactivar en vez de insertar
    // duplicado si ya existe una fila (activa o no) con este texto.
    (async () => {
      try {
        const existing = await pmDB.get('instrucciones_especiales', { texto: v });
        if (existing?.[0]) {
          await pmDB.update('instrucciones_especiales', existing[0].id, { activo: true });
        } else {
          await pmDB.insert('instrucciones_especiales', { texto: v, activo: true }, false);
        }
      } catch(e) {
        console.warn('[instAdd SB]', e.message);
        pmToast('⚠️ "' + v + '" se guardó local pero no en Supabase: ' + e.message, 'err');
      }
    })();
  }
}

async function estCargarSb() {
  if (pmDB.disponible()) {
    try {
      const estados = await pmDB.estados.listar();
      if (estados && estados.length) {
        const nombresEst = estados.map(e => e.nombre).filter(Boolean);
        // Mergear: conservar los fijos (primeros 4) + los de SB
        const fijos = G.estados.slice(0, 4);
        const extras = nombresEst.filter(n => !fijos.includes(n));
        G.estados = [...fijos, ...extras];
      }
      const instrucciones = await pmDB.instrucciones.listar();
      if (instrucciones && instrucciones.length) {
        const textos = instrucciones.map(i => i.texto).filter(Boolean);
        G.instrucciones = [...new Set([...G.instrucciones, ...textos])];
      }
      pmSave('sistema');
    } catch(e) { console.warn('[estCargarSb]', e.message); }
  }
  estRender();
}

function estRender() {
  document.getElementById('est-list').innerHTML = G.estados.map((e,i) => `
    <div class="item-row">
      ${pmBadge(e)}
      <div class="item-name" style="margin-left:8px">${e}</div>
      ${i>3 ? `<button class="btn btn-red btn-xs" onclick="estDel(${i})">✕</button>` : '<span style="font-size:10px;color:var(--cream2)">fijo</span>'}
    </div>`).join('');
  document.getElementById('inst-list').innerHTML = G.instrucciones.map((inst,i) => `
    <div class="item-row">
      <div class="item-name">📌 ${inst}</div>
      <button class="btn btn-red btn-xs" onclick="instDel(${i})">✕</button>
    </div>`).join('');
}

async function estDel(i) {
  const nombre = G.estados[i];
  G.estados.splice(i,1); pmSave('sistema'); estRender();
  if (pmDB.disponible() && nombre) {
    try {
      const rows = await pmDB.get('estados_pedido', { nombre });
      if (rows?.[0]) pmDB.update('estados_pedido', rows[0].id, { activo: false })
        .catch(e => {
          console.warn('[estDel SB]', e.message);
          pmToast('⚠️ "' + nombre + '" se borró local pero no en Supabase: ' + e.message, 'err');
        });
    } catch(e) {
      console.warn('[estDel SB]', e.message);
      pmToast('⚠️ "' + nombre + '" se borró local pero no en Supabase: ' + e.message, 'err');
    }
  }
}
async function instDel(i) {
  const texto = G.instrucciones[i];
  G.instrucciones.splice(i,1); pmSave('sistema'); estRender();
  if (pmDB.disponible() && texto) {
    try {
      const rows = await pmDB.get('instrucciones_especiales', { texto });
      if (rows?.[0]) pmDB.update('instrucciones_especiales', rows[0].id, { activo: false })
        .catch(e => {
          console.warn('[instDel SB]', e.message);
          pmToast('⚠️ Instrucción borrada local pero no en Supabase: ' + e.message, 'err');
        });
    } catch(e) {
      console.warn('[instDel SB]', e.message);
      pmToast('⚠️ Instrucción borrada local pero no en Supabase: ' + e.message, 'err');
    }
  }
}



function resetOps() {
  if (!confirm('¿Eliminar TODOS los pedidos y gastos? Los maestros se mantienen.')) return;
  G.pedidosPan=[]; G.pedidosGalletas=[]; G.pedidosCom=[]; G.gastos=[];
  pmSave('sistema'); pmToast('Pedidos y gastos eliminados');
}

function onDataLoaded() {
  // Called after data loads - refresh active tab
  const activeTab = document.querySelector('.page.on');
  if (activeTab && activeTab.id === 'pg-rep') repRender();
}
