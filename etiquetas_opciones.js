// ── ✅ ETIQUETAS CON OPCIONES (cuadritos para marcar con bolígrafo) ──────────
// Etiqueta de 6 × 4 cm para pan: franja "PanMaestro" + peso, nombre grande,
// ingredientes y hasta 5 opciones de sabor/textura, cada una con un cuadrito para
// hacerle el tic a mano (Integral, Semiintegral, Regular, Con semilla, Relleno…).
// Abajo: Instagram y WhatsApp de PanMaestro. Se escribe todo a mano (nombre, peso,
// ingredientes, opciones, cantidad); no toca Supabase. Sale como PDF en hoja carta
// (jsPDF): 3 columnas × 6 filas = 18 por hoja. Prefijo: eto.

const ETO_CM = 72 / 2.54;   // puntos por cm
const ETO_LW = 6 * ETO_CM, ETO_LH = 4 * ETO_CM, ETO_GAP = 0.3 * ETO_CM;
const ETO_COLS = 3;
const ETO_MAX_OPC = 5;
const ETO_INSTAGRAM = 'Instagram @panmaestro.cr';
const ETO_WHATSAPP = 'WhatsApp 7056 5587';
const ETO_TINTA = [31, 26, 23];

// Lee el formulario → { nombre, peso, ingredientes, opciones[] }
function etoLeer() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const opciones = [];
  for (let i = 1; i <= ETO_MAX_OPC; i++) {
    const t = val('eto-opc' + i).trim();
    if (t) opciones.push(t);
  }
  const peso = parseFloat(val('eto-peso'));
  return {
    nombre: val('eto-nombre').trim(),
    peso: peso > 0 ? peso : 0,
    ingredientes: val('eto-ingredientes').trim(),
    opciones
  };
}

function etoInit() { etoActualizar(); }

// Vista previa a escala 2:1 (igual al facsímil aprobado)
function etoActualizar() {
  const el = document.getElementById('eto-preview');
  if (!el) return;
  const d = etoLeer();
  const caja = '<span style="width:24px;height:24px;border:2px solid #1f1a17;box-sizing:border-box;flex:none"></span>';
  const fila = t => '<div style="display:flex;align-items:center;gap:8px;height:26px">' + caja +
    '<span style="font-size:19px;font-weight:500;color:#1f1a17;white-space:nowrap">' + pmEsc(t) + '</span></div>';
  const mitad = Math.ceil(d.opciones.length / 2);
  const col = lista => '<div style="display:flex;flex-direction:column">' + lista.map(fila).join('') + '</div>';
  el.innerHTML =
    '<div style="width:454px;height:302px;box-sizing:border-box;background:#fff;border:1px solid #1f1a17;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif">' +
      '<div style="height:36px;flex:none;background:#1f1a17;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 14px">' +
        '<span style="font-weight:700;font-size:26px;letter-spacing:.5px">PanMaestro</span>' +
        '<span style="font-size:22px;font-weight:600">' + (d.peso ? pmEsc(String(d.peso)) + ' g' : '') + '</span></div>' +
      '<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 14px 6px;gap:5px;box-sizing:border-box">' +
        '<div style="font-weight:700;font-size:35px;line-height:1.05;color:#1f1a17">' + (pmEsc(d.nombre) || '—') + '</div>' +
        (d.ingredientes ? '<div style="font-size:16px;line-height:1.25;color:#3a342f"><span style="font-weight:600">Ingredientes:</span> ' + pmEsc(d.ingredientes) + '</div>' : '') +
        '<div style="display:flex;gap:22px;margin-top:2px">' + col(d.opciones.slice(0, mitad)) + col(d.opciones.slice(mitad)) + '</div>' +
        '<div style="margin-top:auto;border-top:1px solid #1f1a17;padding-top:4px;display:flex;justify-content:space-between;font-size:16px;font-weight:500;color:#1f1a17">' +
          '<span>' + ETO_INSTAGRAM + '</span><span>' + ETO_WHATSAPP + '</span></div>' +
      '</div></div>';
}

// Una etiqueta en el PDF. (x, y) = esquina superior izquierda, en puntos.
function _etoDibujar(doc, x, y, d) {
  const pad = 5.25, ancho = ETO_LW - 2 * pad;

  // Contorno (guía de corte)
  doc.setDrawColor(0); doc.setLineWidth(0.8);
  doc.rect(x, y, ETO_LW, ETO_LH);

  // Franja superior: PanMaestro + peso
  const banda = 13.5;
  doc.setFillColor(ETO_TINTA[0], ETO_TINTA[1], ETO_TINTA[2]);
  doc.rect(x, y, ETO_LW, banda, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('PanMaestro', x + pad, y + 9.8);
  if (d.peso) {
    doc.setFontSize(8.5);
    doc.text(d.peso + ' g', x + ETO_LW - pad, y + 9.5, { align: 'right' });
  }

  doc.setTextColor(ETO_TINTA[0], ETO_TINTA[1], ETO_TINTA[2]);
  let cy = y + banda + 3;

  // Nombre: grande; si no cabe, baja de tamaño y al final pasa a 2 líneas
  doc.setFont('helvetica', 'bold');
  let fs = 13, lineas;
  for (;;) {
    doc.setFontSize(fs);
    lineas = doc.splitTextToSize(d.nombre || ' ', ancho);
    if (lineas.length === 1 || fs <= 9) break;
    fs -= 0.5;
  }
  lineas = lineas.slice(0, 2);
  lineas.forEach(l => { cy += fs * 0.95; doc.text(l, x + pad, cy); });
  cy += 3;

  // Ingredientes (máx. 3 líneas)
  if (d.ingredientes) {
    doc.setFontSize(6.3);
    doc.setFont('helvetica', 'bold');
    const rotulo = 'Ingredientes: ';
    const rw = doc.getTextWidth(rotulo);
    doc.setFont('helvetica', 'normal');
    // Ajuste manual: la primera línea es más corta porque comparte renglón con el rótulo
    const texto = [];
    let actual = '';
    d.ingredientes.split(/\s+/).forEach(p => {
      const limite = texto.length === 0 ? ancho - rw : ancho;
      const prueba = actual ? actual + ' ' + p : p;
      if (actual && doc.getTextWidth(prueba) > limite) { texto.push(actual); actual = p; }
      else actual = prueba;
    });
    if (actual) texto.push(actual);
    const visibles = texto.slice(0, 3);
    const primera = cy + 7.3;
    visibles.forEach((l, i) => {
      cy += 7.3;
      doc.text(l, x + pad + (i === 0 ? rw : 0), cy);
    });
    doc.setFont('helvetica', 'bold');
    doc.text(rotulo.trim(), x + pad, primera);
    cy += 2;
  }

  // Pie: línea + Instagram y WhatsApp
  const pieY = y + ETO_LH - 4.2;
  doc.setLineWidth(0.4);
  doc.line(x + pad, pieY - 6.3, x + ETO_LW - pad, pieY - 6.3);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
  doc.text(ETO_INSTAGRAM, x + pad, pieY);
  doc.text(ETO_WHATSAPP, x + ETO_LW - pad, pieY, { align: 'right' });

  // Opciones con cuadrito (2 columnas), pegadas arriba del pie
  const n = d.opciones.length;
  if (n) {
    const caja = 8.6, fila = 12, mitad = Math.ceil(n / 2);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    const col1 = d.opciones.slice(0, mitad), col2 = d.opciones.slice(mitad);
    const w1 = Math.max(...col1.map(t => doc.getTextWidth(t))) + caja + 3;
    const topOpc = pieY - 6.3 - 2.5 - mitad * fila;
    const dibujarCol = (lista, cx) => lista.forEach((t, i) => {
      const fy = topOpc + i * fila;
      doc.setLineWidth(0.8);
      doc.rect(cx, fy + (fila - caja) / 2, caja, caja);
      doc.text(t, cx + caja + 3, fy + fila / 2 + 2.4);
    });
    dibujarCol(col1, x + pad);
    dibujarCol(col2, x + pad + w1 + 8);
  }
}

function etoGenerar() {
  const d = etoLeer();
  const aviso = document.getElementById('eto-aviso');
  if (aviso) aviso.textContent = '';
  if (!d.nombre) { pmToast('Escribe el nombre del pan', 'err'); return; }
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) { pmToast('No cargó la librería de PDF. Recarga la página e intenta de nuevo', 'err'); return; }

  const doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margen = 1 * ETO_CM;
  const filas = Math.max(1, Math.floor((H - 2 * margen + ETO_GAP) / (ETO_LH + ETO_GAP)));
  const porHoja = ETO_COLS * filas;
  const x0 = (W - (ETO_COLS * ETO_LW + (ETO_COLS - 1) * ETO_GAP)) / 2;
  const y0 = (H - (filas * ETO_LH + (filas - 1) * ETO_GAP)) / 2;

  const pedido = parseInt(document.getElementById('eto-cantidad').value);
  const total = pedido > 0 ? pedido : porHoja;

  for (let i = 0; i < total; i++) {
    const pos = i % porHoja;
    if (i > 0 && pos === 0) doc.addPage();
    const col = pos % ETO_COLS, fila = Math.floor(pos / ETO_COLS);
    _etoDibujar(doc, x0 + col * (ETO_LW + ETO_GAP), y0 + fila * (ETO_LH + ETO_GAP), d);
  }

  const slug = d.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pan';
  doc.save('etiquetas-opciones-' + slug + '.pdf');
  const hojas = Math.ceil(total / porHoja);
  pmToast('Hoja generada: ' + total + ' etiqueta' + (total === 1 ? '' : 's') + ' en ' + hojas + ' hoja' + (hojas === 1 ? '' : 's') + ' (' + porHoja + ' por hoja)');
}
