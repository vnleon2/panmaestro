// ── 📷 CATÁLOGO ──────────────────────────────────────────────────────────────

const CAT_BUCKET = 'catalogo';
const SB_STORAGE_URL = 'https://xmhokxmuxfkfypttvkjz.supabase.co/storage/v1';

async function catRender() {
  const galeria = document.getElementById('cat-galeria');
  const empty   = document.getElementById('cat-empty');
  if (!galeria) return;
  galeria.innerHTML = '<div style="color:var(--cream2);font-size:12px;padding:20px">Cargando...</div>';

  try {
    const fotos = await pmDB.get('catalogo_fotos', {}, '*');
    const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];

    if (!fotos || !fotos.length) {
      galeria.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    galeria.innerHTML = fotos.map(f => {
      const prod = prods.find(p => p.id === f.producto_codigo);
      const nombre = prod?.nombre || f.producto_codigo;
      const precio = prod ? pmMoney(prod.precio) : '—';
      const peso   = prod ? (prod.peso + 'g') : '—';
      return `<div class="card" style="padding:0;overflow:hidden;border-radius:12px">
        <div style="position:relative">
          <img src="${f.foto_url}" alt="${nombre}"
            style="width:100%;height:150px;object-fit:cover;display:block"
            onerror="this.style.display='none'">
          <button onclick="catEliminarFoto('${f.id}','${f.foto_url}')"
            class="no-print"
            style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.6);border:none;border-radius:50%;width:26px;height:26px;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div style="padding:10px 12px">
          <div style="font-size:10px;color:var(--gold3);font-family:'DM Mono',monospace">${f.producto_codigo}</div>
          <div style="font-size:13px;font-weight:600;color:var(--cream);margin:2px 0">${nombre}</div>
          <div style="font-size:11px;color:var(--cream2)">₡${precio} · ${peso}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    galeria.innerHTML = `<div style="color:var(--red);font-size:12px">Error: ${e.message}</div>`;
  }
}

function catAbrirSubida() {
  const modal = document.getElementById('cat-modal');
  if (!modal) return;
  // Poblar selector de productos
  const sel = document.getElementById('cat-prod-sel');
  const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
  sel.innerHTML = '<option value="">— seleccionar —</option>' +
    prods.map(p => `<option value="${p.id}">${p.id} · ${p.nombre}</option>`).join('');
  document.getElementById('cat-status').textContent = '';
  document.getElementById('cat-preview-wrap').style.display = 'none';
  document.getElementById('cat-foto-input').value = '';
  modal.style.display = 'flex';
}

function catCerrarSubida() {
  const modal = document.getElementById('cat-modal');
  if (modal) modal.style.display = 'none';
}

function catPreviewFoto(input) {
  const file = input.files[0];
  if (!file) return;
  const wrap = document.getElementById('cat-preview-wrap');
  const img  = document.getElementById('cat-preview-img');
  const reader = new FileReader();
  reader.onload = e => { img.src = e.target.result; wrap.style.display = 'block'; };
  reader.readAsDataURL(file);
}

async function catGuardarFoto() {
  const codigo = document.getElementById('cat-prod-sel').value;
  const input  = document.getElementById('cat-foto-input');
  const status = document.getElementById('cat-status');
  const file   = input.files[0];

  if (!codigo) { status.textContent = '⚠️ Seleccioná un producto'; return; }
  if (!file)   { status.textContent = '⚠️ Seleccioná una foto'; return; }

  // Panel de diagnóstico visible (sin depender de consola — celular no la muestra)
  status.style.whiteSpace = 'pre-wrap';
  status.style.textAlign = 'left';
  status.style.fontFamily = "'DM Mono',monospace";
  status.style.fontSize = '11px';
  const log = (msg) => { status.textContent += msg + '\n'; };
  status.textContent = '';
  log(`⏳ Iniciando... archivo: ${file.name} (${(file.size/1024).toFixed(0)} KB, tipo: "${file.type||'—'}")`);
  log(`Conexión reportada por el navegador: ${navigator.onLine ? 'online' : 'OFFLINE'}`);

  try {
    // Obtener token
    const token = await (async () => {
      try {
        const c = window._sbAuthClient;
        if (c) { const {data} = await c.auth.getSession(); if (data?.session?.access_token) return data.session.access_token; }
      } catch(e) {}
      return 'sb_publishable_pmKVIGa_lNxtzRos-iY_0Q_LXEcj77v';
    })();
    log(`Token listo (${token.startsWith('sb_') ? 'anon key' : 'sesión JWT'})`);

    // Prueba de conectividad simple al servicio de Storage ANTES de subir el archivo,
    // para distinguir "no llega ni a Supabase" de "llega pero rechaza la subida".
    log('Probando conexión a Storage...');
    try {
      const ping = await fetch(`${SB_STORAGE_URL}/bucket/${CAT_BUCKET}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': token }
      });
      log(`✓ Storage respondió — status ${ping.status}`);
    } catch (pingErr) {
      log(`✗ Storage NO respondió: ${pingErr.name}: ${pingErr.message}`);
      log('→ Esto confirma que el bloqueo es de red/navegador, no de Supabase.');
      log('→ Probá: desactivar "Data Saver" o "Modo Lite" en Chrome, o probar otra red.');
      throw pingErr;
    }

    // Upload a Supabase Storage
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = `${codigo}_${Date.now()}.${ext}`;
    log(`Subiendo a: ${CAT_BUCKET}/${path}`);
    const uploadRes = await fetch(`${SB_STORAGE_URL}/object/${CAT_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': token,
        'Content-Type': file.type,
        'x-upsert': 'true'
      },
      body: file
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`HTTP ${uploadRes.status}: ${err}`);
    }
    log('✓ Archivo subido');

    // URL pública
    const foto_url = `${SB_STORAGE_URL}/object/public/${CAT_BUCKET}/${path}`;

    // Guardar en tabla catalogo_fotos
    await pmDB.insert('catalogo_fotos', { producto_codigo: codigo, foto_url }, false);

    log('✅ Foto guardada');
    setTimeout(() => { catCerrarSubida(); catRender(); }, 1200);
  } catch(e) {
    log(`❌ Error final: ${e.name || ''}: ${e.message}`);
    console.warn('[catGuardarFoto]', e.message);
  }
}

async function catEliminarFoto(id, url) {
  if (!confirm('¿Eliminar esta foto del catálogo?')) return;
  try {
    await pmDB.hardDelete('catalogo_fotos', id);
    // Intentar borrar del Storage también
    const path = url.split(`/object/public/${CAT_BUCKET}/`)[1];
    if (path) {
      const token = await (async () => {
        try { const c = window._sbAuthClient; if (c) { const {data} = await c.auth.getSession(); if (data?.session?.access_token) return data.session.access_token; } } catch(e) {}
        return 'sb_publishable_pmKVIGa_lNxtzRos-iY_0Q_LXEcj77v';
      })();
      await fetch(`${SB_STORAGE_URL}/object/${CAT_BUCKET}/${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': token }
      }).catch(() => {});
    }
    pmToast('Foto eliminada ✓');
    catRender();
  } catch(e) {
    pmToast('Error al eliminar: ' + e.message, 'err');
  }
}
