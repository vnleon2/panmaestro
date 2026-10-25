// ═══════════════════════════════════════════════════════════════════
// costos_rutas_import.js — Importar rutas de elaboración desde JSON (prefijo cri*)
//
// Lee un archivo {formato:'panmaestro-rutas-estimadas', productos:[...]} y
// crea las rutas (cost_rutas + cost_ruta_etapas) de los productos.
//   - Producto: se busca por `codigo`.   - Etapa: por nombre (sin tildes/mayúsculas).
//   - Lote: lo calcula la app con la receta (cstHojaDatos, máx. 4 000 g de harina).
//   - Etapas con tanda 'lote': q_tanda = lote; t_tanda_min = min_fijos_lote + min_por_pieza × lote.
//   - Horneado: q_tanda = piezas por carga; t_tanda_min = minutos; personas (0,2).
// Vista previa primero; por defecto NO toca productos que ya tienen ruta.
// ═══════════════════════════════════════════════════════════════════

let _criPlan = null;   // { archivo, items:[...] }

function _criNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function _criR(n, d) { const k = Math.pow(10, d); return Math.round((Number(n) + 1e-12) * k) / k; }

function criElegirArchivo() {
  const i = document.getElementById('cri-file');
  if (i) { i.value = ''; i.click(); }
}

async function criCargarArchivo(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); }
  catch (e) { pmToast('El archivo no es un JSON válido', 'err'); return; }
  if (!data || data.formato !== 'panmaestro-rutas-estimadas' || !Array.isArray(data.productos)) {
    pmToast('El archivo no es de rutas estimadas (formato incorrecto)', 'err'); return;
  }
  try { await cstRutDatos(); } catch (e) { pmToast('⚠️ ' + _cstErr(e), 'err'); return; }
  _criPlan = criArmarPlan(data, f.name);
  criRenderVista();
}

// Calcula, por producto, qué se haría. No escribe nada.
function criArmarPlan(data, nombreArchivo) {
  const etaPorNombre = {};
  _cstEtapas.filter(e => e.activo !== false).forEach(e => { etaPorNombre[_criNorm(e.nombre)] = e; });
  const items = data.productos.map(src => {
    const it = { src, estado: 'ok', msg: '', prod: null, lote: 0, lineas: [], minHH: 0, minReloj: 0, tieneRuta: false };
    const prod = _cstRutProd.find(p => p.codigo === src.codigo);
    if (!prod) { it.estado = 'err'; it.msg = 'Producto no encontrado (¿inactivo o código distinto?)'; return it; }
    it.prod = prod;
    it.tieneRuta = !!_cstRutaDe(prod.id) && _cstRutaLineas(_cstRutaDe(prod.id).id).length > 0;
    let d;
    try { d = cstHojaDatos(prod, 0); } catch (e) { d = null; }
    it.lote = d && d.auto > 0 ? d.auto : 0;
    if (!it.lote) { it.estado = 'err'; it.msg = 'No se pudo calcular el lote (falta peso o receta)'; return it; }
    const avisos = (d.avisos || []).filter(a => !/no tiene ruta/i.test(a));
    let orden = 0;
    for (const e of (src.etapas || [])) {
      const eta = etaPorNombre[_criNorm(e.etapa)];
      if (!eta) { it.estado = 'err'; it.msg = `Etapa no encontrada en PanMaestro: «${e.etapa}»`; return it; }
      const pers = Number(e.personas) || 1;
      let q, t;
      if (e.tanda === 'lote') { q = it.lote; t = Number(e.min_fijos_lote || 0) + Number(e.min_por_pieza || 0) * it.lote; }
      else { q = Number(e.tanda); t = Number(e.min_tanda); }
      if (!(q > 0) || !(t >= 0)) { it.estado = 'err'; it.msg = `Datos inválidos en «${e.etapa}»`; return it; }
      q = _criR(q, 3); t = _criR(t, 3);
      it.lineas.push({ etapa_id: eta.id, orden: ++orden, unidad: e.unidad === 'kg' ? 'kg' : 'pz', q_tanda: q, t_tanda_min: t, t_unidad_min: 0, personas: pers });
      it.minReloj += t / q;
      it.minHH += (t / q) * pers;
    }
    if (!it.lineas.length) { it.estado = 'err'; it.msg = 'Sin etapas'; return it; }
    if (avisos.length) it.msg = avisos[0];
    return it;
  });
  return { archivo: nombreArchivo, items };
}

function criRenderVista() {
  const el = document.getElementById('cri-panel');
  if (!el) return;
  if (!_criPlan) { el.innerHTML = ''; return; }
  const its = _criPlan.items;
  const nNuevas = its.filter(i => i.estado === 'ok' && !i.tieneRuta).length;
  const nExist = its.filter(i => i.estado === 'ok' && i.tieneRuta).length;
  const nErr = its.filter(i => i.estado === 'err').length;
  const filas = its.map(i => {
    let est;
    if (i.estado === 'err') est = '<span style="color:var(--red,#e57373)">✗ ' + pmEsc(i.msg) + '</span>';
    else if (i.tieneRuta) est = '<span style="color:var(--cream2)">Ya tiene ruta → se omite</span>';
    else est = '<span style="color:var(--green,#7bc47f)">Nueva</span>';
    const nota = i.estado === 'ok' && i.msg ? `<div style="font-size:10px;color:var(--cream2)">⚠ ${pmEsc(i.msg)}</div>` : '';
    return `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:10px">${pmEsc(i.src.codigo)}</td>
      <td>${pmEsc(i.src.nombre || (i.prod && i.prod.nombre) || '')}${nota}</td>
      <td style="text-align:right">${i.lote || '—'}</td>
      <td style="text-align:right">${i.estado === 'ok' ? _cstNum(i.minHH, 2) : '—'}</td>
      <td>${est}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="card">
    <div class="ctitle">📥 Vista previa: ${pmEsc(_criPlan.archivo)}</div>
    <div style="font-size:12px;margin-bottom:8px">${nNuevas} ruta(s) nueva(s) · ${nExist} ya con ruta · ${nErr} con problema</div>
    <div style="overflow-x:auto"><table class="tbl" style="width:100%;font-size:12px">
      <thead><tr><th>Código</th><th>Producto</th><th style="text-align:right">Lote (pz)</th><th style="text-align:right">min-HH/pz</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
    <label style="display:flex;gap:6px;align-items:center;justify-content:flex-start;font-size:12px;text-transform:none;letter-spacing:0;font-weight:400;margin-top:10px;cursor:pointer">
      <input type="checkbox" id="cri-reemplazar" style="width:auto;margin:0" onchange="criRenderBoton()"> Reemplazar también las rutas que ya existen (borra sus líneas actuales)</label>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn" id="cri-btn-aplicar" onclick="criAplicar()">Importar</button>
      <button class="btn" onclick="criCancelar()">Cancelar</button>
    </div></div>`;
  criRenderBoton();
}

function criRenderBoton() {
  const b = document.getElementById('cri-btn-aplicar');
  if (!b || !_criPlan) return;
  const rep = !!document.getElementById('cri-reemplazar')?.checked;
  const n = _criPlan.items.filter(i => i.estado === 'ok' && (rep || !i.tieneRuta)).length;
  b.textContent = `Importar ${n} ruta(s)`;
  b.disabled = n === 0;
}

function criCancelar() { _criPlan = null; criRenderVista(); }

async function criAplicar() {
  if (!_criPlan) return;
  const rep = !!document.getElementById('cri-reemplazar')?.checked;
  const lista = _criPlan.items.filter(i => i.estado === 'ok' && (rep || !i.tieneRuta));
  if (!lista.length) return;
  if (rep && lista.some(i => i.tieneRuta) && !confirm('Se borrarán las líneas actuales de las rutas existentes marcadas. ¿Continuar?')) return;
  const btn = document.getElementById('cri-btn-aplicar');
  if (btn) btn.disabled = true;
  const log = [];
  let ok = 0;
  for (let k = 0; k < lista.length; k++) {
    const it = lista[k];
    if (btn) btn.textContent = `Importando ${k + 1}/${lista.length}…`;
    try {
      let ruta = _cstRutaDe(it.prod.id);
      if (ruta) {
        const viejas = _cstRutaLineas(ruta.id).map(l => l.id);
        if (viejas.length) await pmDB.hardDeleteMany('cost_ruta_etapas', viejas);
      } else {
        const rows = await pmDB.insert('cost_rutas', { producto_id: it.prod.id });
        ruta = rows && rows[0];
        if (!ruta) throw new Error('no se creó la ruta');
      }
      await pmDB.insert('cost_ruta_etapas', it.lineas.map(l => Object.assign({ ruta_id: ruta.id }, l)), false);
      ok++;
      log.push(`${it.src.codigo}\tOK\t${it.lineas.length} etapas, lote ${it.lote}`);
    } catch (e) {
      log.push(`${it.src.codigo}\tERROR\t${e.message}`);
    }
  }
  const omit = _criPlan.items.filter(i => !lista.includes(i)).map(i => `${i.src.codigo}\tOMITIDO\t${i.estado === 'err' ? i.msg : 'ya tenía ruta'}`);
  const hoy = (typeof pmHoy === 'function') ? pmHoy() : new Date().toISOString().slice(0, 10);
  const blob = new Blob([log.concat(omit).join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `importacion_rutas_${hoy}.txt`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  pmToast(`Rutas importadas: ${ok} de ${lista.length}` + (ok < lista.length ? ' (ver el registro descargado)' : ' ✓'), ok < lista.length ? 'err' : 'ok', 5000);
  _criPlan = null;
  criRenderVista();
  await cstRutCargar();
}
