// ═══════════════════════════════════════════════════════════════════════════
// ing_import.js — Importar lista de precios al maestro de Ingredientes
// Prefijo: ingImp*   (vive en Maestros → Ingredientes, tarjeta "Importar lista")
//
// Flujo: pegar lista → "Analizar" → vista previa (nuevos / actualizar /
// sin cambios / posibles parecidos) → "Importar seleccionados".
// Nada se guarda hasta que Victor confirma. Guarda igual que ingAdd():
// local primero (G.ingredientes + pmSave) y luego Supabase (precio_ref,
// qty_base, codigo ING-xxx, unidad 'g').
// ═══════════════════════════════════════════════════════════════════════════

let _ingImpFilas = [];

// ── Utilidades puras (testeables en node) ──────────────────────────────────
function _ingImpNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// "5.400,00" → 5400 | "5,400.00" → 5400 | "₡7500" → 7500 | "4.000" → 4000
function _ingImpPrecio(txt) {
  let t = String(txt || '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return NaN;
  const iDot = t.lastIndexOf('.'), iCom = t.lastIndexOf(',');
  if (iDot > -1 && iCom > -1) {
    // el último separador es el decimal
    t = iCom > iDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (iCom > -1) {
    const despues = t.length - iCom - 1;
    const unaSola = t.indexOf(',') === iCom;
    t = (unaSola && despues <= 2) ? t.replace(',', '.') : t.replace(/,/g, '');
  } else if (iDot > -1) {
    const despues = t.length - iDot - 1;
    const varias = (t.match(/\./g) || []).length > 1;
    if (varias || despues === 3) t = t.replace(/\./g, '');
  }
  return parseFloat(t);
}

// "1 kg" → 1000 | "500 g" → 500 | "900g" → 900 | "2 lb" → 907.18 | "1000" → 1000
function _ingImpGramos(cant, unidad) {
  const n = _ingImpPrecio(cant);
  if (!(n > 0)) return NaN;
  const u = String(unidad || 'g').toLowerCase();
  const f = { kg: 1000, g: 1, gr: 1, lb: 453.592, oz: 28.3495, l: 1000, lt: 1000, ml: 1 }[u];
  if (!f) return NaN;
  return Math.round(n * f * 100) / 100;
}

function _ingImpLimpiarLinea(raw) {
  return String(raw || '')
    .replace(/\\text\{([^}]*)\}/g, '$1')      // restos de LaTeX: \text{ kg}
    .replace(/[\\{}]/g, '')
    .replace(/^\s*(?:[*\-•·]|\d+[.)])\s+/, '') // viñetas
    .replace(/\s+/g, ' ')
    .trim();
}

// Devuelve { filas:[{nombre, price, qty}], noEntendidas:[texto] }
function ingImpParsear(texto) {
  const filas = [], noEntendidas = [];
  String(texto || '').split(/\r?\n/).forEach(raw => {
    const l = _ingImpLimpiarLinea(raw);
    if (!l) return;

    // Formato A: Nombre (1 kg): ₡5.400,00     (el nombre puede traer otros paréntesis)
    let m = l.match(/^(.*?)\s*\(\s*([\d.,]+)\s*(kg|gr|g|lb|oz|lt|l|ml)\s*\)\s*[:\-–=]\s*(.+)$/i);
    if (m) {
      const qty = _ingImpGramos(m[2], m[3]), price = _ingImpPrecio(m[4]);
      if (m[1].trim() && qty > 0 && price >= 0) { filas.push({ nombre: m[1].trim(), price, qty }); return; }
    }

    // Formato B: columnas separadas por tab o ;  →  nombre ; presentación ; precio
    const cols = l.split(/\t|;/).map(c => c.trim());
    if (cols.length >= 3) {
      const pm = cols[1].match(/^([\d.,]+)\s*(kg|gr|g|lb|oz|lt|l|ml)?$/i);
      const qty = pm ? _ingImpGramos(pm[1], pm[2]) : NaN;
      const price = _ingImpPrecio(cols[2]);
      if (cols[0] && qty > 0 && price >= 0) { filas.push({ nombre: cols[0], price, qty }); return; }
    }

    // Solo avisar de líneas que parecen datos (con precio o dos puntos + número)
    if (/₡|\d.*:|:\s*\d/.test(l)) noEntendidas.push(l);
  });
  return { filas, noEntendidas };
}

// Similitud por palabras (Dice) — para avisar de posibles duplicados
function _ingImpSimilitud(a, b) {
  const A = new Set(_ingImpNorm(a).split(' ').filter(Boolean));
  const B = new Set(_ingImpNorm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(w => { if (B.has(w)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

// Compara la lista contra el maestro actual y arma las filas de la vista previa
function ingImpArmarFilas(parseadas, existentes) {
  // existentes: { nombre → {price, qty} }
  const porNorm = {};
  Object.keys(existentes).forEach(n => { porNorm[_ingImpNorm(n)] = n; });

  // Nombres repetidos dentro de la misma lista (otra presentación): gana la de menor ₡/g
  const grupos = {};
  parseadas.forEach((f, i) => {
    const k = _ingImpNorm(f.nombre);
    (grupos[k] = grupos[k] || []).push(i);
  });
  const secundaria = new Set();
  Object.values(grupos).forEach(idxs => {
    if (idxs.length < 2) return;
    idxs.sort((a, b) => (parseadas[a].price / parseadas[a].qty) - (parseadas[b].price / parseadas[b].qty));
    idxs.slice(1).forEach(i => secundaria.add(i));
  });

  return parseadas.map((f, i) => {
    const norm = _ingImpNorm(f.nombre);
    const cpg = f.qty ? f.price / f.qty : 0;
    const fila = { nombre: f.nombre, price: f.price, qty: f.qty, cpg,
      estado: 'nuevo', existente: null, candidato: null, usarCandidato: false, sel: true, nota: '' };

    if (secundaria.has(i)) {
      fila.estado = 'alterna'; fila.sel = false;
      fila.nota = 'Mismo nombre con otra presentación (se usa la de menor ₡/g)';
      return fila;
    }
    const ex = porNorm[norm];
    if (ex) {
      fila.existente = ex;
      const act = existentes[ex];
      const igual = Math.abs((act.price || 0) - f.price) < 0.005 && Math.abs((act.qty || 0) - f.qty) < 0.005;
      fila.estado = igual ? 'igual' : 'actualiza';
      fila.sel = !igual;
      fila.antes = act;
      return fila;
    }
    // Sin coincidencia exacta: ¿se parece a alguno que ya existe?
    let mejor = null, score = 0;
    Object.keys(existentes).forEach(n => {
      const s = _ingImpSimilitud(f.nombre, n);
      if (s > score) { score = s; mejor = n; }
    });
    if (mejor && score >= 0.6) fila.candidato = mejor;
    return fila;
  });
}

// ── UI ─────────────────────────────────────────────────────────────────────
function ingImpAnalizar() {
  const txt = document.getElementById('ingimp-txt')?.value || '';
  const { filas, noEntendidas } = ingImpParsear(txt);
  if (!filas.length) {
    document.getElementById('ingimp-prev').innerHTML =
      '<div style="font-size:12px;color:var(--gold);margin-top:8px">No se encontró ninguna línea con el formato «Nombre (1 kg): ₡5.400,00» ni «Nombre ; 1 kg ; 5400».</div>';
    _ingImpFilas = [];
    return;
  }
  const existentes = Object.assign({}, G.ingredientes || {});
  // incluir los de Supabase (aunque estén inactivos) para no duplicar ni chocar el código
  if (typeof _sbIngCache !== 'undefined' && _sbIngCache) {
    Object.keys(_sbIngCache).forEach(n => {
      if (!existentes[n]) existentes[n] = { price: _sbIngCache[n].precio_ref || 0, qty: _sbIngCache[n].qty_base || 1000 };
    });
  }
  _ingImpFilas = ingImpArmarFilas(filas, existentes);
  _ingImpFilas.noEntendidas = noEntendidas;
  ingImpRender();
}

function ingImpToggle(i, v)   { if (_ingImpFilas[i]) { _ingImpFilas[i].sel = !!v; ingImpRender(true); } }
function ingImpAccion(i, v)   { if (_ingImpFilas[i]) { _ingImpFilas[i].usarCandidato = (v === 'actualizar'); } }
function ingImpTodos(v)       { _ingImpFilas.forEach(f => { if (f.estado !== 'igual' && f.estado !== 'alterna') f.sel = v; }); ingImpRender(); }

function ingImpRender(soloResumen) {
  const box = document.getElementById('ingimp-prev');
  if (!box) return;
  const filas = _ingImpFilas;
  const cnt = e => filas.filter(f => f.estado === e).length;
  const nSel = filas.filter(f => f.sel).length;
  const fm = n => '₡' + Number(Math.round(n * 100) / 100).toLocaleString('es-CR');
  const resumen = `<div id="ingimp-resumen" style="font-size:12px;margin:10px 0;color:var(--cream2)">
      <b style="color:var(--cream)">${filas.length}</b> líneas leídas ·
      <span style="color:var(--gold2)">${cnt('nuevo')} nuevos</span> ·
      <span style="color:var(--gold2)">${cnt('actualiza')} a actualizar</span> ·
      ${cnt('igual')} sin cambios · ${cnt('alterna')} presentaciones alternas ·
      <b style="color:var(--cream)">${nSel} seleccionados</b></div>`;
  if (soloResumen) {
    const r = document.getElementById('ingimp-resumen');
    if (r) { r.outerHTML = resumen; return; }
  }

  const etiqueta = f => ({
    nuevo:     '<span style="color:var(--gold2)">Nuevo</span>',
    actualiza: '<span style="color:var(--gold2)">Actualiza</span>',
    igual:     '<span style="color:var(--cream2)">Sin cambios</span>',
    alterna:   '<span style="color:var(--cream2)">Alterna</span>',
  }[f.estado]);

  const detalle = f => {
    if (f.estado === 'actualiza') {
      const a = f.antes;
      return `Antes: ${fm(a.price)} / ${a.qty}g (₡${(a.price / a.qty).toFixed(2)}/g)`;
    }
    if (f.estado === 'alterna') return pmEsc(f.nota);
    if (f.candidato) {
      return `¿Será «${pmEsc(f.candidato)}»? <select onchange="ingImpAccion(${filas.indexOf(f)},this.value)"
        style="background:var(--sf);color:var(--cream);border:1px solid var(--border);border-radius:6px;font-size:11px;padding:2px 4px">
        <option value="crear">Crear como nuevo</option>
        <option value="actualizar"${f.usarCandidato ? ' selected' : ''}>Actualizar ese</option></select>`;
    }
    return '';
  };

  const rows = filas.map((f, i) => `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 8px"><input type="checkbox" ${f.sel ? 'checked' : ''} ${f.estado === 'igual' ? 'disabled' : ''}
        onchange="ingImpToggle(${i},this.checked)"></td>
      <td style="padding:6px 8px;font-weight:500">${pmEsc(f.nombre)}</td>
      <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace">${fm(f.price)} / ${f.qty}g</td>
      <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">₡${f.cpg.toFixed(2)}</td>
      <td style="padding:6px 8px">${etiqueta(f)}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--cream2)">${detalle(f)}</td>
    </tr>`).join('');

  const avisos = (filas.noEntendidas && filas.noEntendidas.length)
    ? `<div style="font-size:11px;color:var(--gold);margin-top:8px">⚠️ ${filas.noEntendidas.length} línea(s) no se entendieron y se omitieron:<br>${filas.noEntendidas.map(pmEsc).join('<br>')}</div>` : '';

  box.innerHTML = resumen + `
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn btn-out btn-xs" onclick="ingImpTodos(true)">Marcar todos</button>
      <button class="btn btn-out btn-xs" onclick="ingImpTodos(false)">Desmarcar todos</button>
      <button class="btn btn-gold btn-sm" onclick="ingImpEjecutar()">📥 Importar seleccionados</button>
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:rgba(200,146,42,.1);text-align:left">
        <th style="padding:7px 8px"></th><th style="padding:7px 8px">Ingrediente</th>
        <th style="padding:7px 8px;text-align:right">Precio / base</th>
        <th style="padding:7px 8px;text-align:right">₡/g</th>
        <th style="padding:7px 8px">Estado</th><th style="padding:7px 8px">Detalle</th>
      </tr></thead><tbody>${rows}</tbody></table></div>${avisos}
    <div id="ingimp-log" style="margin-top:10px;font-family:'DM Mono',monospace;font-size:11px;white-space:pre-wrap"></div>`;
}

function ingImpLimpiar() {
  const t = document.getElementById('ingimp-txt'); if (t) t.value = '';
  const p = document.getElementById('ingimp-prev'); if (p) p.innerHTML = '';
  _ingImpFilas = [];
}

// ── Guardado ───────────────────────────────────────────────────────────────
async function ingImpEjecutar() {
  const sel = _ingImpFilas.filter(f => f.sel);
  if (!sel.length) { pmToast('No hay filas seleccionadas', 'err'); return; }
  const nNuevos = sel.filter(f => f.estado === 'nuevo' && !f.usarCandidato).length;
  if (!confirm(`¿Importar ${sel.length} ingrediente(s)? (${nNuevos} nuevos, ${sel.length - nNuevos} actualizaciones)`)) return;

  const logEl = document.getElementById('ingimp-log');
  const log = m => { if (logEl) logEl.textContent += m + '\n'; };
  if (logEl) logEl.textContent = '⏳ Importando...\n';

  // 1) Resolver destino de cada fila (evitando escribir dos veces el mismo nombre)
  const vistos = new Set();
  const trabajo = [];
  sel.forEach(f => {
    const destino = f.existente || (f.usarCandidato ? f.candidato : null);
    const nombre = destino || f.nombre;
    const k = _ingImpNorm(nombre);
    if (vistos.has(k)) { log(`⚠️ «${f.nombre}» omitido: ya se importó «${nombre}» en esta tanda`); return; }
    vistos.add(k);
    trabajo.push({ nombre, esExistente: !!destino, price: f.price, qty: f.qty });
  });

  // 2) Local primero (mismo patrón que ingAdd)
  trabajo.forEach(t => { G.ingredientes[t.nombre] = { price: t.price, qty: t.qty }; });
  pmSave('maestros');
  log(`✅ ${trabajo.length} guardados localmente`);

  // 3) Supabase
  if (!pmDB.disponible()) {
    log('⚠️ Sin conexión a Supabase: quedó solo en este navegador. Volvé a importar con conexión para sincronizar.');
    ingRender();
    return;
  }
  let ok = 0, fallos = 0;
  try {
    _sbIngMap = null; _sbIngCache = null; // forzar recarga
    await _sbIngEnsureMap();
    const todas = await pmDB.get('ingredientes', {}, '*');
    let siguiente = Math.max(0, ...(todas || []).map(r => r.codigo || '')
      .filter(c => c.startsWith('ING-')).map(c => parseInt(c.replace('ING-', '')) || 0)) + 1;
    const nuevoCodigo = () => `ING-${String(siguiente++).padStart(3, '0')}`;

    for (const t of trabajo) {
      try {
        const uuid = _sbIngMap?.[t.nombre];
        if (uuid) {
          const datos = { precio_ref: t.price, qty_base: t.qty, activo: true };
          if (!_sbIngCache?.[t.nombre]?.codigo) datos.codigo = nuevoCodigo();
          await pmDB.ingredientes.editar(uuid, datos);
          if (_sbIngCache?.[t.nombre]) _sbIngCache[t.nombre] = { ..._sbIngCache[t.nombre], ...datos };
        } else {
          const rows = await pmDB.ingredientes.crear({
            codigo: nuevoCodigo(), nombre: t.nombre, unidad: 'g',
            precio_ref: t.price, qty_base: t.qty, activo: true });
          if (rows?.[0]) { _sbIngMap[t.nombre] = rows[0].id; _sbIngCache[t.nombre] = rows[0]; }
          else throw new Error('Supabase no devolvió el registro creado');
        }
        ok++;
      } catch (e) {
        fallos++;
        log(`❌ ${t.nombre}: ${e.message}`);
        console.warn('[ingImp]', t.nombre, e.message);
      }
    }
  } catch (e) {
    log(`❌ ERROR general: ${e.message}`);
    console.warn('[ingImpEjecutar]', e.message);
  }
  log(`${fallos ? '⚠️' : '✅'} Supabase: ${ok} sincronizados${fallos ? `, ${fallos} con error (quedaron guardados localmente)` : ''}`);
  pmToast(fallos ? `Importado con ${fallos} error(es) — revisá el detalle` : `${ok} ingredientes importados ✓`, fallos ? 'err' : 'ok');
  await ingCargarSb();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ingImpParsear, ingImpArmarFilas, _ingImpPrecio, _ingImpGramos, _ingImpNorm };
}
