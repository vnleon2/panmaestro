// costeo_nombres.js — Renombrado rápido de recetas (solo el campo nombre)
// Prefijo de función: cnm
//
// Vista dentro de Costeo (botón "✏️ Nombres"): lista código · nombre actual ·
// nombre sugerido (editable). Victor marca las que quiere y guarda.
//
// QUÉ TOCA: únicamente recetas.nombre (y el nombre en la copia local G.recetas).
// QUÉ NO TOCA: código, id, ingredientes (receta_items), subrecetas, addons,
// gm_source, costos, márgenes. Es más seguro que el guardado completo de
// recSave(), que reescribe todos los campos y los ingredientes.
//
// SEGURIDAD:
// - Nada se cambia sin marcar la casilla de cada fila y confirmar el diálogo.
// - Optimistic locking por fila: si la receta cambió en Supabase desde que se
//   cargó esta lista (updated_at distinto), esa fila se salta y se avisa.
// - No permite dejar dos recetas con el mismo nombre.
// - La sugerencia usa depTitulo() de depuracion.js (si no estuviera cargado,
//   la sugerencia es el mismo nombre actual y no se propone nada).

let _cnmFilas = [];   // { id, codigo, cat, actual, sug, upd, ck }

function _cnmNorm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

async function cnmInit() {
  const box = document.getElementById('cnm-lista');
  if (!box) return;
  if (!pmDB.disponible()) {
    box.innerHTML = '<div class="card" style="font-size:13px;color:var(--cream2)">Sin conexión a Supabase — no se pueden renombrar recetas ahora.</div>';
    return;
  }
  box.innerHTML = '<div class="card" style="font-size:13px;color:var(--cream2)">⏳ Leyendo recetas…</div>';
  try {
    const rows = await pmDB.recetas.listar();   // ya descarta las dadas de baja
    _cnmFilas = (rows || []).map(r => ({
      id: r.id,
      codigo: r.codigo || '',
      cat: r.categoria || '',
      actual: r.nombre == null ? '' : String(r.nombre),
      sug: typeof depTitulo === 'function' ? depTitulo(r.nombre) : String(r.nombre || ''),
      upd: r.updated_at || null,
      ck: false,
    })).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  } catch (e) {
    box.innerHTML = '<div class="card" style="font-size:13px;color:#B91C1C">No se pudo leer: ' + pmEsc(e.message) + '</div>';
    return;
  }
  cnmRender();
}

function cnmFiltradas() {
  const q = _cnmNorm((document.getElementById('cnm-buscar') || {}).value);
  const soloCambian = !!(document.getElementById('cnm-solo') || {}).checked;
  const out = [];
  _cnmFilas.forEach((f, i) => {
    if (soloCambian && f.sug === f.actual) return;
    if (q && !_cnmNorm(f.codigo + ' ' + f.actual).includes(q)) return;
    out.push(i);
  });
  return out;
}

function cnmRender() {
  const box = document.getElementById('cnm-lista');
  if (!box) return;
  const idx = cnmFiltradas();
  const cambian = _cnmFilas.filter(f => f.sug !== f.actual).length;
  let html = `<div style="font-size:12px;color:var(--cream2);margin:0 0 8px">${_cnmFilas.length} recetas activas · ${cambian} con sugerencia distinta · mostrando ${idx.length}</div>`;
  if (!idx.length) html += '<div class="card" style="font-size:13px;color:var(--cream2)">Nada que mostrar con este filtro.</div>';
  idx.slice(0, 400).forEach(i => {
    const f = _cnmFilas[i];
    html += `<div class="item-row" style="flex-wrap:wrap;align-items:center;gap:8px">
      <input type="checkbox" ${f.ck ? 'checked' : ''} onchange="cnmMarcar(${i},this.checked)" style="width:18px;height:18px;flex-shrink:0">
      <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--gold3);min-width:62px">${pmEsc(f.codigo || 's/c')}</div>
      <div style="flex:1;min-width:150px;font-size:13px;word-break:break-word">${pmEsc(f.actual) || '(vacío)'}</div>
      <div style="flex:1;min-width:170px"><input type="text" value="${pmEsc(f.sug)}" onchange="cnmEditarSug(${i},this.value)" style="width:100%;font-size:13px;font-weight:600"></div>
    </div>`;
  });
  if (idx.length > 400) html += '<div class="card" style="font-size:12px;color:var(--cream2)">Se muestran las primeras 400; usa el buscador para ver el resto.</div>';
  box.innerHTML = html;
  cnmContar();
}

function cnmMarcar(i, v) {
  if (_cnmFilas[i]) _cnmFilas[i].ck = !!v;
  cnmContar();
}

function cnmEditarSug(i, v) {
  if (!_cnmFilas[i]) return;
  _cnmFilas[i].sug = String(v || '').replace(/\s+/g, ' ').trim();
  _cnmFilas[i].ck = _cnmFilas[i].sug !== _cnmFilas[i].actual && !!_cnmFilas[i].sug;   // editar a mano = quieres ese cambio
  cnmRender();
}

function cnmMarcarTodas(v) {
  cnmFiltradas().forEach(i => { _cnmFilas[i].ck = v && _cnmFilas[i].sug !== _cnmFilas[i].actual && !!_cnmFilas[i].sug; });
  cnmRender();
}

function _cnmSeleccion() {
  return _cnmFilas.filter(f => f.ck && f.sug && f.sug !== f.actual);
}

function cnmContar() {
  const el = document.getElementById('cnm-guardar-btn');
  if (el) el.textContent = '💾 Guardar marcadas (' + _cnmSeleccion().length + ')';
}

async function cnmGuardar() {
  const sel = _cnmSeleccion();
  if (!sel.length) { pmToast('No hay ninguna receta marcada con un nombre nuevo', 'err'); return; }
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase', 'err'); return; }
  if (!confirm('¿Cambiar el nombre de ' + sel.length + ' receta(s)?\n\nSolo cambia el nombre. Código, ingredientes y vínculos no se tocan.')) return;

  // nombre efectivo de cada receta después de aplicar lo marcado: sirve para no dejar duplicados
  const selIds = new Set(sel.map(f => f.id));
  const conteo = {};
  _cnmFilas.forEach(f => {
    const n = _cnmNorm(selIds.has(f.id) ? f.sug : f.actual);
    conteo[n] = (conteo[n] || 0) + 1;
  });

  let ok = 0;
  const saltadas = [];
  for (const f of sel) {
    const nuevo = f.sug;
    if (conteo[_cnmNorm(nuevo)] > 1) { saltadas.push(`${f.codigo}: "${nuevo}" ya lo tiene otra receta`); continue; }
    try {
      const fresca = await pmDB.recetas.obtener(f.id);
      if (!fresca || fresca.activo === false) { saltadas.push(`${f.codigo}: la receta ya no existe`); continue; }
      if (f.upd && fresca.updated_at && fresca.updated_at !== f.upd) {
        saltadas.push(`${f.codigo}: cambió en otro dispositivo mientras tanto — recarga y vuelve a intentar`);
        continue;
      }
      await pmDB.recetas.editar(f.id, { nombre: nuevo });   // SOLO el nombre
      (G.recetas || []).forEach(r => {                      // copia local de este dispositivo
        if (r.sbId === f.id || (r.code && r.code === f.codigo)) r.name = nuevo;
      });
      f.actual = nuevo;
      f.ck = false;
      ok++;
    } catch (e) {
      saltadas.push(`${f.codigo}: error — ${e.message}`);
    }
  }
  if (ok) {
    try { pmSave('costeo'); } catch (e) { /* la copia local se corrige sola en la próxima carga */ }
    _sbRecCache = null;   // fuerza a Costeo a releer las recetas con el nombre nuevo
  }
  cnmRender();
  pmToast(ok + ' nombre(s) cambiado(s)' + (saltadas.length ? ' · ' + saltadas.length + ' saltado(s)' : ''), saltadas.length ? 'err' : 'ok');
  const res = document.getElementById('cnm-resultado');
  if (res) {
    res.innerHTML = saltadas.length
      ? '<div class="card" style="font-size:12px;line-height:1.55"><b>No se cambiaron:</b><br>' + saltadas.map(t => '• ' + pmEsc(t)).join('<br>') + '</div>'
      : '';
  }
}
