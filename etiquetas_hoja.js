// ═══════════════════════════════════════════════════════════════
// etiquetas_hoja.js — Etiquetas de producto en hoja carta (prefijo eth*)
//
// Se elige un pan o una galleta y se genera un PDF tamaño carta lleno de
// etiquetas de 6 cm de ancho: nombre grande, peso, contenido, aviso de
// gluten y "Proceso artesanal". Es un reporte aparte del de 7×4 cm que ya
// existe en etiquetas.js; no escribe nada en Supabase.
//
// De dónde sale cada dato:
//   · nombre y peso → el producto (G.tiposPan / G.tiposGalleta)
//   · contenido     → la receta ligada al producto (recetaCod), incluyendo
//                     subrecetas y rellenos/coberturas
//   · gluten        → se detecta por el nombre de los ingredientes
//
// Contenido: los ingredientes base (harina, agua, sal, masa madre, levadura)
// se nombran; los demás se informan por grupo (huevos, grasa, esencia, …) sin
// más detalle. Lo que no se reconoce se imprime con su nombre y se avisa en
// pantalla para que Victor lo revise.
//
// El PDF se arma con jsPDF (se carga desde cdnjs en index.html).
// ═══════════════════════════════════════════════════════════════

// ── Clasificación de ingredientes ──────────────────────────────
// La primera regla que coincide manda. label:null → no es un ingrediente
// (horneo, gas, empaque, mano de obra…) y no aparece en la etiqueta.
const ETH_REGLAS = [
  { re: /horneo|horno|\bgas\b|energ[ií]a|electric|empaque|bolsa|caja|etiqueta|mano de obra|\bmod\b|\bgg\b/i, label: null },
  { re: /masa madre|\bmm\b|levain|cultivo|starter/i,         label: 'masa madre' },
  { re: /levadura/i,                                          label: 'levadura' },
  { re: /huevo|yema|clara/i,                                  label: 'huevos' },
  { re: /esencia|vainilla|extracto|saborizante|aroma/i,       label: 'esencia' },
  { re: /mantequilla|margarina|manteca|aceite|aove|oliva|shortening|grasa/i, label: 'grasa' },
  { re: /^(agua|hielo)\b(?!\s+de\s)/i,                        label: 'agua' },
  { re: /^sal\b/i,                                            label: 'sal' },
  { re: /harina|s[eé]mola|trigo|centeno|espelta|cebada/i,     label: 'harina' },
  { re: /az[uú]car|panela|piloncillo|tapa de dulce|papel[oó]n|melao|melado/i, label: 'azúcar' },
  { re: /queso/i,                                             label: 'queso' },
  { re: /leche|nata|suero|yogur|crema de leche/i,             label: 'leche' },
  { re: /chocolate|cacao|cocoa|gotas/i,                       label: 'chocolate' },
  { re: /nutella/i,                                           label: 'crema de avellanas' },
  { re: /poo?lish|biga|esponja|p[aâ]t[eé] ferment|tang?zh?on/i, label: 'prefermento' },
  { re: /maicena|almid[oó]n/i,                                label: 'maicena' },
  { re: /polvo (de|para) hornear|bicarbonato/i,                      label: 'polvo de hornear' },
  { re: /canela|especia|an[ií]s|moscada|clavo|pimienta|jengibre/i, label: 'especias' },
  { re: /ajonjol[ií]|s[eé]samo/i,                             label: 'ajonjolí' },
  { re: /semilla|linaza|ch[ií]a|girasol/i,                    label: 'semillas' },
  { re: /nuez|nueces/i,                                       label: 'nueces' },
  { re: /^miel\b/i,                                           label: 'miel' },
  { re: /vinagre/i,                                           label: 'vinagre' },
  { re: /ar[aá]ndano|pasa|fruta|uva|manzana|pi[ñn]a|banan|guayaba/i, label: 'fruta' }
];

// Harinas / ingredientes que llevan gluten (trigo, centeno, cebada, avena…).
// Harinas de maíz, arroz, almendra, etc. NO cuentan.
const ETH_GLUTEN_RE = /harina(?!.*(ma[ií]z|arroz|almendra|coco|garbanzo|yuca|tapioca|sin gluten))|trigo|centeno|cebada|espelta|s[eé]mola|kamut|malta|avena|masa madre|\bmm\b|levain|cultivo/i;

function ethLimpiarNombre(n) {
  return String(n || '').replace(/^[^\wÁÉÍÓÚÑáéíóúñ]+/, '').trim();
}

function ethClasificar(nombre) {
  const n = ethLimpiarNombre(nombre);
  if (!n) return { label: null, conocido: true, gluten: false };
  for (const r of ETH_REGLAS) {
    if (r.re.test(n)) {
      return { label: r.label, conocido: true, gluten: r.label ? ETH_GLUTEN_RE.test(n) : false };
    }
  }
  return { label: n.toLowerCase(), conocido: false, gluten: ETH_GLUTEN_RE.test(n) };
}

// ── Recolectar ingredientes (con subrecetas y addons) ──────────
function ethRecolectar(r, targetMass, visited, out) {
  if (!r) return;
  if (r.code && visited.has(r.code)) return;
  const vis = new Set(visited);
  if (r.code) vis.add(r.code);

  const res = pmCostoReceta(r, targetMass);
  (res.lines || []).forEach(l => {
    if (l.isSub || l.isAddon) return;
    const nombre = ethLimpiarNombre(l.name);
    if (nombre && l.g > 0) out.push({ nombre, g: l.g });
  });

  const lista = _sbRecLista() || [];

  (r.subrecs || []).forEach(sub => {
    const ref = lista.find(x => x.code === sub.recId);
    if (!ref) return;
    const m = sub.gFijos > 0 ? sub.gFijos : (sub.pct > 0 ? res.flourW * sub.pct / 100 : 0);
    if (m <= 0) return;
    // Un cultivo de masa madre se nombra como tal, y además se abre para
    // que su harina cuente (ej. centeno) para el aviso de gluten.
    if (String(ref.cat || '').toLowerCase() === 'pan_mm') out.push({ nombre: 'Masa madre', g: m });
    ethRecolectar(ref, m, vis, out);
  });

  (r.addons || []).forEach(addon => {
    const ref = lista.find(x => x.code === addon.recId);
    if (!ref || !addon.gPorUnidad) return;
    ethRecolectar(ref, addon.gPorUnidad * (r.units || 1), vis, out);
  });
}

// Devuelve { texto, gluten, sinClasificar:[…], items:[…] } o null si no hay receta.
function ethContenido(r) {
  if (!r) return null;
  const crudo = [];
  ethRecolectar(r, undefined, new Set(), crudo);

  const grupos = new Map();   // label → { g, gluten, conocido }
  let gluten = false;
  crudo.forEach(x => {
    const c = ethClasificar(x.nombre);
    if (c.gluten) gluten = true;
    if (!c.label) return;
    const prev = grupos.get(c.label) || { g: 0, conocido: c.conocido };
    prev.g += x.g;
    grupos.set(c.label, prev);
  });

  const items = [...grupos.entries()]
    .map(([label, v]) => ({ label, g: v.g, conocido: v.conocido }))
    .sort((a, b) => b.g - a.g);

  const texto = items.length
    ? items.map(i => i.label).join(', ').replace(/^./, c => c.toUpperCase()) + '.'
    : '';

  return { texto, gluten, items, sinClasificar: items.filter(i => !i.conocido).map(i => i.label) };
}

// ── Pantalla ───────────────────────────────────────────────────
let _ethProductos = [];   // [{ key, tipo, nombre, peso, recCode }]
let _ethActual = null;

function ethListaProductos() {
  const out = [];
  (G.tiposPan || []).forEach(p => out.push({
    key: 'P:' + p.id, tipo: 'pan', nombre: p.nombre, peso: p.peso, recCode: p.recetaCod || ''
  }));
  (G.tiposGalleta || []).forEach(p => out.push({
    key: 'G:' + p.id, tipo: 'galleta', nombre: p.nombre, peso: p.peso, recCode: p.recetaCod || ''
  }));
  return out;
}

async function ethInit() {
  const sel = document.getElementById('eth-producto');
  if (!sel) return;
  try { await _sbCosteoCargar(); } catch (e) { console.warn('[ethInit] recetas', e.message); }
  _ethProductos = ethListaProductos();
  const op = (p) => `<option value="${pmEsc(p.key)}">${pmEsc(p.nombre)}${p.peso ? ' — ' + pmEsc(p.peso) + ' g' : ''}</option>`;
  const panes = _ethProductos.filter(p => p.tipo === 'pan');
  const gall  = _ethProductos.filter(p => p.tipo === 'galleta');
  sel.innerHTML = '<option value="">Seleccioná un pan o galleta…</option>' +
    (panes.length ? '<optgroup label="Panes">' + panes.map(op).join('') + '</optgroup>' : '') +
    (gall.length  ? '<optgroup label="Galletas">' + gall.map(op).join('') + '</optgroup>' : '');
  ethSeleccionar(sel.value);
}

function ethSeleccionar(key) {
  const aviso = document.getElementById('eth-aviso');
  const btn = document.getElementById('eth-btn');
  _ethActual = _ethProductos.find(p => p.key === key) || null;
  if (!_ethActual) {
    document.getElementById('eth-contenido').value = '';
    document.getElementById('eth-gluten').checked = false;
    document.getElementById('eth-peso').value = '';
    aviso.textContent = '';
    btn.disabled = true;
    return;
  }
  document.getElementById('eth-peso').value = _ethActual.peso || '';

  const r = _ethActual.recCode ? (_sbRecLista() || []).find(x => x.code === _ethActual.recCode) : null;
  const c = ethContenido(r);
  if (!c || !c.texto) {
    document.getElementById('eth-contenido').value = '';
    document.getElementById('eth-gluten').checked = false;
    aviso.innerHTML = !_ethActual.recCode
      ? '⚠️ Este producto no tiene receta ligada. Escribí el contenido a mano o ligá la receta en Maestros.'
      : '⚠️ No se encontraron ingredientes en la receta ' + pmEsc(_ethActual.recCode) + '. Escribí el contenido a mano.';
  } else {
    document.getElementById('eth-contenido').value = c.texto;
    document.getElementById('eth-gluten').checked = c.gluten;
    aviso.innerHTML = c.sinClasificar.length
      ? '⚠️ Sin clasificar (se imprimen con su nombre): <b>' + c.sinClasificar.map(pmEsc).join(', ') + '</b>. Revisá el texto antes de generar.'
      : '';
  }
  btn.disabled = false;
}

// ── Generación del PDF ─────────────────────────────────────────
const ETH_CM = 72 / 2.54;  // puntos por cm

// Mide y dibuja una etiqueta con el borde superior-izquierdo en (x, y).
// Con dibujar=false solo devuelve el alto, para calcular filas por hoja.
function ethEtiqueta(doc, d, x, y, dibujar) {
  const LW = 6 * ETH_CM, PAD = 0.4 * ETH_CM;
  const iw = LW - 2 * PAD;

  let size = 28;
  let lineas;
  doc.setFont('times', 'bold');
  for (; size > 16; size--) {
    doc.setFontSize(size);
    lineas = doc.splitTextToSize(d.nombre, iw);
    if (lineas.length <= 2 && lineas.every(l => doc.getTextWidth(l) <= iw)) break;
  }
  doc.setFontSize(size);
  lineas = doc.splitTextToSize(d.nombre, iw);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const cont = doc.splitTextToSize(d.contenido || '', iw);

  const yMarca = y + PAD + 7;
  const yRegla = yMarca + 6;
  let yNom = yRegla + 6 + size * 0.9;
  const yUltNom = yNom + (lineas.length - 1) * size * 1.08;
  const yPeso = yUltNom + 18;
  const yLinea1 = yPeso + 7;
  const yContiene = yLinea1 + 12;
  const yCont0 = yContiene + 11;
  const yUltCont = yCont0 + Math.max(cont.length - 1, 0) * 10.5;
  let yFin = yUltCont;
  let yGluten = null;
  if (d.gluten) { yGluten = yUltCont + 5; yFin = yGluten + 13; }
  const yLinea2 = yFin + 8;
  const yProceso = yLinea2 + 13;
  const alto = yProceso + 8 + PAD * 0.6 - y;

  if (!dibujar) return alto;

  const INK = [59, 42, 26];
  doc.setDrawColor(...INK); doc.setTextColor(...INK);
  doc.setLineWidth(0.8);
  doc.rect(x, y, LW, alto);
  const cx = x + LW / 2;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text(d.marca, cx, yMarca, { align: 'center' });
  doc.setLineWidth(1.4); doc.line(x + PAD, yRegla, x + LW - PAD, yRegla);
  doc.setLineWidth(0.4); doc.line(x + PAD, yRegla + 2.5, x + LW - PAD, yRegla + 2.5);

  doc.setFont('times', 'bold'); doc.setFontSize(size);
  lineas.forEach((l, i) => doc.text(l, cx, yNom + i * size * 1.08, { align: 'center' }));

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(d.pesoTxt, cx, yPeso, { align: 'center' });

  doc.setLineWidth(0.4); doc.line(x + PAD, yLinea1, x + LW - PAD, yLinea1);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.text('Contiene', x + PAD, yContiene);
  doc.setFont('helvetica', 'normal');
  cont.forEach((l, i) => doc.text(l, x + PAD, yCont0 + i * 10.5));

  if (d.gluten) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    const t = 'CONTIENE GLUTEN';
    const tw = doc.getTextWidth(t);
    doc.setLineWidth(0.9);
    doc.rect(x + PAD, yGluten, tw + 10, 13);
    doc.text(t, x + PAD + 5, yGluten + 9.5);
  }

  doc.setLineWidth(0.4); doc.line(x + PAD, yLinea2, x + LW - PAD, yLinea2);
  doc.setFont('times', 'italic'); doc.setFontSize(10);
  doc.text('Proceso artesanal', cx, yProceso, { align: 'center' });
  return alto;
}

function ethGenerar() {
  if (!_ethActual) { pmToast('Elegí primero un pan o galleta', 'err'); return; }
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) { pmToast('No cargó la librería de PDF. Recargá la página e intentá de nuevo', 'err'); return; }

  const pesoVal = parseFloat(document.getElementById('eth-peso').value);
  const contenido = document.getElementById('eth-contenido').value.trim();
  if (!contenido) { pmToast('Escribí el contenido de la etiqueta', 'err'); return; }

  const d = {
    marca: String((typeof ETMK_DATOS !== 'undefined' && ETMK_DATOS.nombre) || "Victor's Bakery").toUpperCase(),
    nombre: _ethActual.nombre,
    pesoTxt: pesoVal > 0 ? pesoVal + ' g' : '',
    contenido,
    gluten: document.getElementById('eth-gluten').checked
  };

  const doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const LW = 6 * ETH_CM, GAP = 0.4 * ETH_CM, COLS = 3;
  const MARGEN_MIN = 1.0 * ETH_CM;

  const alto = ethEtiqueta(doc, d, 0, 0, false);
  const filas = Math.max(1, Math.floor((H - 2 * MARGEN_MIN + GAP) / (alto + GAP)));
  const porHoja = COLS * filas;
  const x0 = (W - (COLS * LW + (COLS - 1) * GAP)) / 2;
  const y0 = (H - (filas * alto + (filas - 1) * GAP)) / 2;

  const pedido = parseInt(document.getElementById('eth-cantidad').value);
  const total = pedido > 0 ? pedido : porHoja;

  for (let i = 0; i < total; i++) {
    const pos = i % porHoja;
    if (i > 0 && pos === 0) doc.addPage();
    const col = pos % COLS, fila = Math.floor(pos / COLS);
    ethEtiqueta(doc, d, x0 + col * (LW + GAP), y0 + fila * (alto + GAP), true);
  }

  const archivo = 'etiquetas-' + d.nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
  doc.save(archivo);
  pmToast('Hoja generada: ' + total + ' etiqueta' + (total === 1 ? '' : 's') + ' (' + porHoja + ' por hoja)');
}
