// ── 🏷️ ETIQUETAS EN LOTE ─────────────────────────────────────
// Lista de todos los panes y galletas: se marca (tick) cuáles imprimir, con qué
// tipo de etiqueta (individual 7×4 cm o hoja carta de 6 cm) y cuántas de cada una.
// Un solo botón imprime todo:
//   · Individuales → una ventana de impresión con todas las etiquetas seguidas.
//   · Hoja carta   → un solo PDF; las etiquetas de todos los productos van
//     seguidas (sin saltar de hoja entre un producto y otro) para ahorrar papel.
// Reutiliza etEtiquetaHtml/ET_CSS (etiquetas.js) y ethContenido/ethEtiqueta
// (etiquetas_hoja.js). Prefijo: etl.

let _etlLista = [];   // [{ key, id, tipo, nombre, peso, recCode, precio, es_masa_madre }]

async function etlInit() {
  const cont = document.getElementById('etl-lista');
  if (!cont) return;
  try { await etRefrescarProductos(); } catch (e) { console.warn('[etlInit] productos', e.message); }
  try { await _sbCosteoCargar(); } catch (e) { console.warn('[etlInit] recetas', e.message); }

  // Precio y masa madre vienen de productos_terminados (Supabase) si existe el producto allá.
  const sb = new Map();
  try {
    if (pmDB.disponible()) {
      const data = await pmDB.get('productos_terminados', { activo: true }, 'codigo,peso_g,precio_full,es_masa_madre') || [];
      data.forEach(d => sb.set(d.codigo, d));
    }
  } catch (e) { console.warn('[etlInit] productos_terminados', e.message); }

  const lista = ethListaProductos().map(p => {
    const id = p.key.slice(2);
    const fila = sb.get(id);
    const g = ((p.tipo === 'pan' ? G.tiposPan : G.tiposGalleta) || []).find(x => x.id === id) || {};
    return {
      key: p.key, id, tipo: p.tipo, nombre: p.nombre, recCode: p.recCode,
      peso: (fila && fila.peso_g) || p.peso || '',
      precio: (fila && fila.precio_full) || g.precio || '',
      es_masa_madre: !!(fila && fila.es_masa_madre)
    };
  });
  _etlLista = [
    ...pmOrdenar(lista.filter(p => p.tipo === 'pan'), 'nombre'),
    ...pmOrdenar(lista.filter(p => p.tipo === 'galleta'), 'nombre')
  ];

  if (!_etlLista.length) { cont.innerHTML = '<div style="font-size:13px;opacity:.7">No hay panes ni galletas cargados.</div>'; return; }

  const filaHtml = (p, i) => `
    <div style="display:grid;grid-template-columns:24px 1fr 150px 72px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(128,128,128,.25)">
      <input type="checkbox" id="etl-chk-${i}" style="width:auto" onchange="etlActualizarResumen()">
      <label for="etl-chk-${i}" style="margin:0;cursor:pointer">${pmEsc(p.nombre)}${p.peso ? ' <span style="opacity:.6">— ' + pmEsc(p.peso) + ' g</span>' : ''}${p.tipo === 'galleta' ? ' <span style="opacity:.6">🍪</span>' : ''}</label>
      <select id="etl-tipo-${i}">
        <option value="ind">Individual 7×4</option>
        <option value="indsp">Individual 7×4 sin precio</option>
        <option value="hoja">Hoja carta 6 cm</option>
      </select>
      <input type="number" id="etl-cant-${i}" min="1" step="1" value="1" title="Cantidad de etiquetas" onfocus="this.select()">
    </div>`;
  cont.innerHTML = _etlLista.map(filaHtml).join('');
  etlActualizarResumen();
}

function etlMarcarTodos(v) {
  _etlLista.forEach((_, i) => { const c = document.getElementById('etl-chk-' + i); if (c) c.checked = v; });
  etlActualizarResumen();
}

// Aplica un tipo (o cantidad) a TODAS las filas, para no cambiarlas una por una.
function etlTipoTodos(v) {
  if (!v) return;
  _etlLista.forEach((_, i) => { const s = document.getElementById('etl-tipo-' + i); if (s) s.value = v; });
  document.getElementById('etl-tipo-todos').value = '';
}
function etlCantTodos(v) {
  const n = parseInt(v);
  if (!(n >= 1)) return;
  _etlLista.forEach((_, i) => { const c = document.getElementById('etl-cant-' + i); if (c) c.value = n; });
}

function etlSeleccion() {
  const out = [];
  _etlLista.forEach((p, i) => {
    const chk = document.getElementById('etl-chk-' + i);
    if (!chk || !chk.checked) return;
    const cant = Math.max(1, parseInt(document.getElementById('etl-cant-' + i).value) || 1);
    out.push({ p, cant, tipo: document.getElementById('etl-tipo-' + i).value });
  });
  return out;
}

function etlActualizarResumen() {
  const sel = etlSeleccion();
  const ind = sel.filter(x => x.tipo === 'ind' || x.tipo === 'indsp').reduce((a, x) => a + x.cant, 0);
  const hoja = sel.filter(x => x.tipo === 'hoja').reduce((a, x) => a + x.cant, 0);
  const el = document.getElementById('etl-resumen');
  if (el) el.textContent = sel.length
    ? sel.length + ' producto' + (sel.length === 1 ? '' : 's') + ' · ' + ind + ' individuales · ' + hoja + ' en hoja carta'
    : 'Marcá los productos que querés imprimir';
  const btn = document.getElementById('etl-btn');
  if (btn) btn.disabled = !sel.length;
}

function etlImprimir() {
  const sel = etlSeleccion();
  const avisos = [];
  if (!sel.length) { pmToast('Marcá al menos un producto', 'err'); return; }

  // 1) Individuales: todas seguidas en una sola ventana (abrirla antes que nada, es el clic del usuario)
  const ind = sel.filter(x => x.tipo === 'ind' || x.tipo === 'indsp');
  if (ind.length) {
    const html = ind.map(x => etEtiquetaHtml(
      { nombre: x.p.nombre, es_masa_madre: x.p.es_masa_madre }, x.p.peso, x.p.precio, x.tipo === 'indsp'
    ).repeat(x.cant)).join('');
    const win = window.open('', '_blank');
    if (!win) { avisos.push('El navegador bloqueó la ventana de las etiquetas individuales: permití ventanas emergentes e intentá de nuevo.'); }
    else {
      win.document.write(`<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>Etiquetas en lote</title>
        <style>${ET_CSS}</style>
      </head><body>${html}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
      win.document.close();
    }
  }

  // 2) Hoja carta: un solo PDF con todos los productos seguidos
  const hoja = sel.filter(x => x.tipo === 'hoja');
  if (hoja.length) {
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      avisos.push('No cargó la librería de PDF. Recargá la página e intentá de nuevo (las de hoja carta no se imprimieron).');
    } else {
      const grupos = [];
      hoja.forEach(x => {
        const r = x.p.recCode ? (_sbRecLista() || []).find(y => y.code === x.p.recCode) : null;
        const c = ethContenido(r);
        if (!c || !c.texto) { avisos.push(x.p.nombre + ': sin contenido (receta no ligada o sin ingredientes); no se imprimió en hoja carta.'); return; }
        const pesoVal = parseFloat(x.p.peso);
        grupos.push({
          cant: x.cant,
          d: {
            marca: String((typeof ETMK_DATOS !== 'undefined' && ETMK_DATOS.nombre) || 'PanMaestro').toUpperCase(),
            nombre: pmNombreSinPeso(x.p.nombre),
            pesoTxt: pesoVal > 0 ? pesoVal + ' g' : '',
            contenido: c.texto,
            gluten: c.gluten
          }
        });
      });
      if (grupos.length) {
        const doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const LW = 6 * ETH_CM, GAP = 0.4 * ETH_CM, COLS = 3;
        const MARGEN_MIN = 1.0 * ETH_CM;
        // todas las filas usan el mismo paso: el alto de la etiqueta más alta
        const alto = Math.max(...grupos.map(g => ethEtiqueta(doc, g.d, 0, 0, false)));
        const filas = Math.max(1, Math.floor((H - 2 * MARGEN_MIN + GAP) / (alto + GAP)));
        const porHoja = COLS * filas;
        const x0 = (W - (COLS * LW + (COLS - 1) * GAP)) / 2;
        const y0 = MARGEN_MIN;

        let n = 0;
        grupos.forEach(g => {
          for (let k = 0; k < g.cant; k++, n++) {
            const pos = n % porHoja;
            if (n > 0 && pos === 0) doc.addPage();
            const col = pos % COLS, fila = Math.floor(pos / COLS);
            ethEtiqueta(doc, g.d, x0 + col * (LW + GAP), y0 + fila * (alto + GAP), true);
          }
        });
        doc.save('etiquetas-lote.pdf');
        pmToast('Hoja carta generada: ' + n + ' etiqueta' + (n === 1 ? '' : 's') + ' en ' + Math.ceil(n / porHoja) + ' hoja' + (Math.ceil(n / porHoja) === 1 ? '' : 's'));
      }
    }
  }

  const av = document.getElementById('etl-aviso');
  if (av) av.innerHTML = avisos.length ? avisos.map(a => '⚠️ ' + pmEsc(a)).join('<br>') : '';
}
