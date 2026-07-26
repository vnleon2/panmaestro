// mercadeo.js — Módulo de Mercadeo (category management)
// Prefijo de función: mkt
//
// DISEÑO: módulo completamente independiente del núcleo de PanMaestro.
// - Lee productos_terminados (vía pmDB.productos.listar(), ya existente)
//   pero NUNCA escribe ahí.
// - Toda escritura propia va a 6 tablas satélite: categorias,
//   producto_categoria, estilos, producto_estilo, atributos,
//   producto_atributo (ver sql_categorias.sql / sql_estilos.sql /
//   sql_atributos.sql en la raíz del repo).
// - Usa solo los métodos GENÉRICOS de pmDB (get/insert/update/
//   softDelete/hardDelete) — no se le agregó nada a pm_db.js. Si este
//   archivo se borra, el resto de PanMaestro sigue funcionando igual.
// - Estado propio (_mkt*), nunca toca el objeto global G ni pmSave() —
//   esta data siempre vive en Supabase, no hace falta caché offline
//   para una pantalla de administración de catálogo.

let _mktCat = [];              // categorias activas
let _mktEst = [];              // estilos activos
let _mktAtr = [];              // atributos activos
let _mktProductos = [];        // productos_terminados (pan+galleta)
let _mktProdCat = {};          // producto_id -> { id (fila producto_categoria), categoria_id }
let _mktProdEst = {};          // producto_id -> { id (fila producto_estilo), estilo_id }
let _mktProdAtr = {};          // producto_id -> [ { id (fila producto_atributo), atributo_id }, ... ]

// ── Sub-navegación (pills) ──────────────────────────────────
function mktTab(tab, btn) {
  ['cat', 'est', 'atr', 'prod'].forEach(t => {
    const el = document.getElementById('mktt-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#mkt-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  if (tab === 'prod' && !_mktProductos.length) mktProdCargar();
}

async function mktInit() {
  await Promise.all([mktCatCargar(), mktEstCargar(), mktAtrCargar()]);
}

// ═══════════════════════════════════════════════════════════
// CATEGORÍAS
// ═══════════════════════════════════════════════════════════
async function mktCatCargar() {
  if (!pmDB.disponible()) return;
  try {
    const rows = await pmDB.get('categorias', { activo: true });
    _mktCat = (rows || []).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  } catch (e) { console.warn('[mktCatCargar]', e.message); }
  mktCatRender();
}

function mktCatRender() {
  const el = document.getElementById('mktcat-list');
  if (!el) return;
  document.getElementById('mktcat-count').textContent = `Categorías (${_mktCat.length})`;
  el.innerHTML = _mktCat.map(c => `
    <div class="item-row" id="mktcat-row-${c.id}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:60px">${pmEsc(c.codigo)}</div>
      <div class="item-name">${pmEsc(c.nombre)}</div>
      <div class="item-meta">orden ${c.orden}</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="mktCatEdit('${c.id}')">✏️</button>
        <button class="btn btn-red btn-xs" onclick="mktCatDel('${c.id}')">✕</button>
      </div>
    </div>`).join('') || '<div class="ph"><span class="ph-icon">🗂</span>Sin categorías</div>';
}

async function mktCatAdd() {
  const codigo = document.getElementById('mktcat-codigo').value.trim().toUpperCase();
  const nombre = document.getElementById('mktcat-nombre').value.trim();
  const orden  = parseInt(document.getElementById('mktcat-orden').value) || (_mktCat.length + 1);
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (_mktCat.some(c => c.codigo === codigo)) { pmToast(`Ya existe una categoría con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.insert('categorias', { codigo, nombre, orden });
    document.getElementById('mktcat-codigo').value = '';
    document.getElementById('mktcat-nombre').value = '';
    document.getElementById('mktcat-orden').value = '';
    pmToast('Categoría agregada ✓');
    mktCatCargar();
  } catch (e) {
    console.warn('[mktCatAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + e.message, 'err');
  }
}

function mktCatEdit(id) {
  const c = _mktCat.find(x => x.id === id);
  if (!c) return;
  const row = document.getElementById('mktcat-row-' + id);
  if (!row) return;
  row.innerHTML = `
    <input type="text" id="mce-cod-${id}" value="${c.codigo}" style="width:70px;font-family:'DM Mono',monospace;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px;text-transform:uppercase">
    <input type="text" id="mce-nom-${id}" value="${c.nombre.replace(/"/g, '&quot;')}" style="flex:1;min-width:120px;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px">
    <input type="number" id="mce-ord-${id}" value="${c.orden}" style="width:60px;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px">
    <button class="btn btn-gold btn-xs" onclick="mktCatEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="mktCatRender()">✕</button>`;
}

async function mktCatEditSave(id) {
  const codigo = document.getElementById('mce-cod-' + id).value.trim().toUpperCase();
  const nombre = document.getElementById('mce-nom-' + id).value.trim();
  const orden  = parseInt(document.getElementById('mce-ord-' + id).value) || 0;
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (_mktCat.some(c => c.codigo === codigo && c.id !== id)) { pmToast(`Ya existe otra categoría con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.update('categorias', id, { codigo, nombre, orden });
    pmToast('Categoría actualizada ✓');
    mktCatCargar();
  } catch (e) {
    console.warn('[mktCatEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + e.message, 'err');
  }
}

async function mktCatDel(id) {
  const c = _mktCat.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`¿Desactivar la categoría "${c.nombre}"? Los productos que la tengan asignada la conservan, pero deja de aparecer en la lista.`)) return;
  try {
    await pmDB.softDelete('categorias', id);
    pmToast('Categoría desactivada');
    mktCatCargar();
  } catch (e) {
    console.warn('[mktCatDel]', e.message);
    pmToast('⚠️ No se pudo desactivar: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// ESTILOS
// ═══════════════════════════════════════════════════════════
async function mktEstCargar() {
  if (!pmDB.disponible()) return;
  try {
    const rows = await pmDB.get('estilos', { activo: true });
    _mktEst = (rows || []).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  } catch (e) { console.warn('[mktEstCargar]', e.message); }
  mktEstRender();
}

function mktEstRender() {
  const el = document.getElementById('mktest-list');
  if (!el) return;
  document.getElementById('mktest-count').textContent = `Estilos (${_mktEst.length})`;
  el.innerHTML = _mktEst.map(s => `
    <div class="item-row" id="mktest-row-${s.id}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:60px">${pmEsc(s.codigo)}</div>
      <div class="item-name">${pmEsc(s.nombre)}</div>
      <div class="item-meta">orden ${s.orden}</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="mktEstEdit('${s.id}')">✏️</button>
        <button class="btn btn-red btn-xs" onclick="mktEstDel('${s.id}')">✕</button>
      </div>
    </div>`).join('') || '<div class="ph"><span class="ph-icon">🌎</span>Sin estilos</div>';
}

async function mktEstAdd() {
  const codigo = document.getElementById('mktest-codigo').value.trim().toUpperCase();
  const nombre = document.getElementById('mktest-nombre').value.trim();
  const orden  = parseInt(document.getElementById('mktest-orden').value) || (_mktEst.length + 1);
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (_mktEst.some(s => s.codigo === codigo)) { pmToast(`Ya existe un estilo con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.insert('estilos', { codigo, nombre, orden });
    document.getElementById('mktest-codigo').value = '';
    document.getElementById('mktest-nombre').value = '';
    document.getElementById('mktest-orden').value = '';
    pmToast('Estilo agregado ✓');
    mktEstCargar();
  } catch (e) {
    console.warn('[mktEstAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + e.message, 'err');
  }
}

function mktEstEdit(id) {
  const s = _mktEst.find(x => x.id === id);
  if (!s) return;
  const row = document.getElementById('mktest-row-' + id);
  if (!row) return;
  row.innerHTML = `
    <input type="text" id="mee-cod-${id}" value="${s.codigo}" style="width:70px;font-family:'DM Mono',monospace;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px;text-transform:uppercase">
    <input type="text" id="mee-nom-${id}" value="${s.nombre.replace(/"/g, '&quot;')}" style="flex:1;min-width:120px;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px">
    <input type="number" id="mee-ord-${id}" value="${s.orden}" style="width:60px;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px">
    <button class="btn btn-gold btn-xs" onclick="mktEstEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="mktEstRender()">✕</button>`;
}

async function mktEstEditSave(id) {
  const codigo = document.getElementById('mee-cod-' + id).value.trim().toUpperCase();
  const nombre = document.getElementById('mee-nom-' + id).value.trim();
  const orden  = parseInt(document.getElementById('mee-ord-' + id).value) || 0;
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (_mktEst.some(s => s.codigo === codigo && s.id !== id)) { pmToast(`Ya existe otro estilo con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.update('estilos', id, { codigo, nombre, orden });
    pmToast('Estilo actualizado ✓');
    mktEstCargar();
  } catch (e) {
    console.warn('[mktEstEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + e.message, 'err');
  }
}

async function mktEstDel(id) {
  const s = _mktEst.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`¿Desactivar el estilo "${s.nombre}"? Los productos que lo tengan asignado lo conservan, pero deja de aparecer en la lista.`)) return;
  try {
    await pmDB.softDelete('estilos', id);
    pmToast('Estilo desactivado');
    mktEstCargar();
  } catch (e) {
    console.warn('[mktEstDel]', e.message);
    pmToast('⚠️ No se pudo desactivar: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// ATRIBUTOS
// ═══════════════════════════════════════════════════════════
async function mktAtrCargar() {
  if (!pmDB.disponible()) return;
  try {
    const rows = await pmDB.get('atributos', { activo: true });
    _mktAtr = (rows || []).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  } catch (e) { console.warn('[mktAtrCargar]', e.message); }
  mktAtrRender();
}

function mktAtrRender() {
  const el = document.getElementById('mktatr-list');
  if (!el) return;
  document.getElementById('mktatr-count').textContent = `Atributos (${_mktAtr.length})`;
  el.innerHTML = _mktAtr.map(a => `
    <div class="item-row" id="mktatr-row-${a.id}">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3);min-width:80px">${pmEsc(a.codigo)}</div>
      <div class="item-name">${pmEsc(a.nombre)}</div>
      <div class="item-meta">orden ${a.orden}</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-out btn-xs" onclick="mktAtrEdit('${a.id}')">✏️</button>
        <button class="btn btn-red btn-xs" onclick="mktAtrDel('${a.id}')">✕</button>
      </div>
    </div>`).join('') || '<div class="ph"><span class="ph-icon">🏷</span>Sin atributos</div>';
}

async function mktAtrAdd() {
  const codigo = document.getElementById('mktatr-codigo').value.trim().toUpperCase().replace(/\s+/g, '_');
  const nombre = document.getElementById('mktatr-nombre').value.trim();
  const orden  = parseInt(document.getElementById('mktatr-orden').value) || (_mktAtr.length + 1);
  if (!codigo || !nombre) { pmToast('Completá código y nombre', 'err'); return; }
  if (_mktAtr.some(a => a.codigo === codigo)) { pmToast(`Ya existe un atributo con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.insert('atributos', { codigo, nombre, orden });
    document.getElementById('mktatr-codigo').value = '';
    document.getElementById('mktatr-nombre').value = '';
    document.getElementById('mktatr-orden').value = '';
    pmToast('Atributo agregado ✓');
    mktAtrCargar();
  } catch (e) {
    console.warn('[mktAtrAdd]', e.message);
    pmToast('⚠️ No se pudo agregar: ' + e.message, 'err');
  }
}

function mktAtrEdit(id) {
  const a = _mktAtr.find(x => x.id === id);
  if (!a) return;
  const row = document.getElementById('mktatr-row-' + id);
  if (!row) return;
  row.innerHTML = `
    <input type="text" id="mae-cod-${id}" value="${a.codigo}" style="width:100px;font-family:'DM Mono',monospace;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px;text-transform:uppercase">
    <input type="text" id="mae-nom-${id}" value="${a.nombre.replace(/"/g, '&quot;')}" style="flex:1;min-width:120px;padding:5px 8px;background:var(--sf);border:1px solid var(--gold);border-radius:6px;color:var(--cream);font-size:12px">
    <input type="number" id="mae-ord-${id}" value="${a.orden}" style="width:60px;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px">
    <button class="btn btn-gold btn-xs" onclick="mktAtrEditSave('${id}')">💾</button>
    <button class="btn btn-out btn-xs" onclick="mktAtrRender()">✕</button>`;
}

async function mktAtrEditSave(id) {
  const codigo = document.getElementById('mae-cod-' + id).value.trim().toUpperCase().replace(/\s+/g, '_');
  const nombre = document.getElementById('mae-nom-' + id).value.trim();
  const orden  = parseInt(document.getElementById('mae-ord-' + id).value) || 0;
  if (!codigo || !nombre) { pmToast('El código y el nombre no pueden quedar vacíos', 'err'); return; }
  if (_mktAtr.some(a => a.codigo === codigo && a.id !== id)) { pmToast(`Ya existe otro atributo con código ${codigo}`, 'err'); return; }
  try {
    await pmDB.update('atributos', id, { codigo, nombre, orden });
    pmToast('Atributo actualizado ✓');
    mktAtrCargar();
  } catch (e) {
    console.warn('[mktAtrEditSave]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + e.message, 'err');
  }
}

async function mktAtrDel(id) {
  const a = _mktAtr.find(x => x.id === id);
  if (!a) return;
  if (!confirm(`¿Desactivar el atributo "${a.nombre}"? Los productos que lo tengan marcado lo conservan, pero deja de aparecer en la lista.`)) return;
  try {
    await pmDB.softDelete('atributos', id);
    pmToast('Atributo desactivado');
    mktAtrCargar();
  } catch (e) {
    console.warn('[mktAtrDel]', e.message);
    pmToast('⚠️ No se pudo desactivar: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// ASIGNACIÓN POR PRODUCTO — categoría (1), estilo (1), atributos (N)
// ═══════════════════════════════════════════════════════════
async function mktProdCargar() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  const el = document.getElementById('mktprod-list');
  if (el) el.innerHTML = '<div class="ph"><span class="ph-icon">⏳</span>Cargando...</div>';
  try {
    const [productos, relCat, relEst, relAtr] = await Promise.all([
      pmDB.productos.listar(),
      pmDB.get('producto_categoria'),
      pmDB.get('producto_estilo'),
      pmDB.get('producto_atributo'),
    ]);
    _mktProductos = (productos || []).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    _mktProdCat = {};
    (relCat || []).forEach(r => { _mktProdCat[r.producto_id] = { id: r.id, categoria_id: r.categoria_id }; });
    _mktProdEst = {};
    (relEst || []).forEach(r => { _mktProdEst[r.producto_id] = { id: r.id, estilo_id: r.estilo_id }; });
    _mktProdAtr = {};
    (relAtr || []).forEach(r => {
      if (!_mktProdAtr[r.producto_id]) _mktProdAtr[r.producto_id] = [];
      _mktProdAtr[r.producto_id].push({ id: r.id, atributo_id: r.atributo_id });
    });
  } catch (e) {
    console.warn('[mktProdCargar]', e.message);
    if (el) el.innerHTML = '<div class="ph">⚠️ Error cargando productos — revisá la conexión</div>';
    return;
  }
  mktProdRender();
}

function mktProdRender() {
  const el = document.getElementById('mktprod-list');
  if (!el) return;
  const q = (document.getElementById('mktprod-search')?.value || '').toLowerCase().trim();
  const lista = q ? _mktProductos.filter(p => (p.nombre || '').toLowerCase().includes(q)) : _mktProductos;
  document.getElementById('mktprod-count').textContent = `Productos (${lista.length})`;

  if (!lista.length) {
    el.innerHTML = '<div class="ph"><span class="ph-icon">📦</span>Sin productos</div>';
    return;
  }

  const catOpts = '<option value="">— Sin categoría —</option>' +
    _mktCat.map(c => `<option value="${c.id}">${pmEsc(c.nombre)}</option>`).join('');
  const estOpts = '<option value="">— Sin estilo —</option>' +
    _mktEst.map(s => `<option value="${s.id}">${pmEsc(s.nombre)}</option>`).join('');

  el.innerHTML = lista.map(p => {
    const catActual = _mktProdCat[p.id]?.categoria_id || '';
    const estActual = _mktProdEst[p.id]?.estilo_id || '';
    const atrActuales = (_mktProdAtr[p.id] || []).map(x => x.atributo_id);
    const atrChips = _mktAtr.map(a => `
      <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--cream2);margin-right:10px;cursor:pointer">
        <input type="checkbox" ${atrActuales.includes(a.id) ? 'checked' : ''}
          onchange="mktProdToggleAtributo('${p.id}','${a.id}',this.checked)">
        ${pmEsc(a.nombre)}
      </label>`).join('');
    return `
    <div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <div style="font-weight:600;color:var(--cream)">${pmEsc(p.nombre)}</div>
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3)">${pmEsc(p.codigo || '')}</div>
      </div>
      <div class="row" style="margin-bottom:8px">
        <div class="col">
          <label style="font-size:11px">Categoría</label>
          <select onchange="mktProdSetCategoria('${p.id}',this.value)" style="width:100%;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px">
            ${catOpts.replace(`value="${catActual}"`, `value="${catActual}" selected`)}
          </select>
        </div>
        <div class="col">
          <label style="font-size:11px">Estilo</label>
          <select onchange="mktProdSetEstilo('${p.id}',this.value)" style="width:100%;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:12px">
            ${estOpts.replace(`value="${estActual}"`, `value="${estActual}" selected`)}
          </select>
        </div>
      </div>
      ${_mktAtr.length ? `<div><label style="font-size:11px;display:block;margin-bottom:4px">Atributos</label>${atrChips}</div>` : ''}
    </div>`;
  }).join('');
}

async function mktProdSetCategoria(prodId, catId) {
  const existing = _mktProdCat[prodId];
  try {
    if (!catId) {
      if (existing) { await pmDB.hardDelete('producto_categoria', existing.id); delete _mktProdCat[prodId]; }
      pmToast('Categoría quitada');
      return;
    }
    if (existing) {
      await pmDB.update('producto_categoria', existing.id, { categoria_id: catId });
      existing.categoria_id = catId;
    } else {
      const rows = await pmDB.insert('producto_categoria', { producto_id: prodId, categoria_id: catId });
      if (rows?.[0]) _mktProdCat[prodId] = { id: rows[0].id, categoria_id: catId };
    }
    pmToast('Categoría actualizada ✓');
  } catch (e) {
    console.warn('[mktProdSetCategoria]', e.message);
    pmToast('⚠️ No se pudo guardar la categoría: ' + e.message, 'err');
  }
}

async function mktProdSetEstilo(prodId, estId) {
  const existing = _mktProdEst[prodId];
  try {
    if (!estId) {
      if (existing) { await pmDB.hardDelete('producto_estilo', existing.id); delete _mktProdEst[prodId]; }
      pmToast('Estilo quitado');
      return;
    }
    if (existing) {
      await pmDB.update('producto_estilo', existing.id, { estilo_id: estId });
      existing.estilo_id = estId;
    } else {
      const rows = await pmDB.insert('producto_estilo', { producto_id: prodId, estilo_id: estId });
      if (rows?.[0]) _mktProdEst[prodId] = { id: rows[0].id, estilo_id: estId };
    }
    pmToast('Estilo actualizado ✓');
  } catch (e) {
    console.warn('[mktProdSetEstilo]', e.message);
    pmToast('⚠️ No se pudo guardar el estilo: ' + e.message, 'err');
  }
}

async function mktProdToggleAtributo(prodId, atrId, checked) {
  if (!_mktProdAtr[prodId]) _mktProdAtr[prodId] = [];
  try {
    if (checked) {
      const rows = await pmDB.insert('producto_atributo', { producto_id: prodId, atributo_id: atrId });
      if (rows?.[0]) _mktProdAtr[prodId].push({ id: rows[0].id, atributo_id: atrId });
      pmToast('Atributo agregado ✓');
    } else {
      const idx = _mktProdAtr[prodId].findIndex(x => x.atributo_id === atrId);
      if (idx >= 0) {
        await pmDB.hardDelete('producto_atributo', _mktProdAtr[prodId][idx].id);
        _mktProdAtr[prodId].splice(idx, 1);
      }
      pmToast('Atributo quitado');
    }
  } catch (e) {
    console.warn('[mktProdToggleAtributo]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + e.message, 'err');
  }
}
