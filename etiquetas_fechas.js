// ── 📅 ETIQUETAS DE FECHAS (elaboración y vencimiento) ───────────────────────
// Hoja carta con muchas etiquetas pequeñas (4,6 × 2,2 cm, 4 columnas × 10 filas =
// 40 por hoja) que dicen "PAN MAESTRO", fecha de elaboración y fecha de vencimiento.
// Se pide: fecha de elaboración + días de vida útil. El conteo de días empieza al
// día siguiente de elaborar: vencimiento = elaboración + días (elaboro el 19 con
// 3 días → vence el 22). Sale como PDF (jsPDF, igual que Hoja carta). Prefijo: etf.

const ETF_CM = 72 / 2.54;   // puntos por cm
const ETF_LW = 4.6 * ETF_CM, ETF_LH = 2.2 * ETF_CM, ETF_GAP = 0.3 * ETF_CM;
const ETF_COLS = 4, ETF_MARGEN = 1.1 * ETF_CM;

function _etfHoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 'aaaa-mm-dd' → Date local; null si no es válida
function _etfParseFecha(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function _etfFmt(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

// Devuelve { elab, venc } (Date) o null si faltan datos
function etfCalcular() {
  const elab = _etfParseFecha(document.getElementById('etf-fecha').value);
  const dias = parseInt(document.getElementById('etf-dias').value);
  if (!elab || !(dias >= 1)) return null;
  return { elab, venc: new Date(elab.getFullYear(), elab.getMonth(), elab.getDate() + dias) };
}

function etfInit() {
  const f = document.getElementById('etf-fecha');
  if (f && !f.value) f.value = _etfHoy();
  etfActualizar();
}

function etfActualizar() {
  const r = etfCalcular();
  const el = document.getElementById('etf-resumen');
  if (!el) return;
  el.textContent = r ? 'Elaborado: ' + _etfFmt(r.elab) + ' · Vence: ' + _etfFmt(r.venc) : 'Poné la fecha y los días de vida útil';
}

function _etfDibujarEtiqueta(doc, x, y, elab, venc) {
  doc.setDrawColor(0); doc.setLineWidth(0.8);
  doc.rect(x, y, ETF_LW, ETF_LH);
  const cx = x + ETF_LW / 2;
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('PAN MAESTRO', cx, y + 0.8 * ETF_CM, { align: 'center' });
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Elaborado: ' + elab, cx, y + 1.32 * ETF_CM, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Vence: ' + venc, cx, y + 1.78 * ETF_CM, { align: 'center' });
}

function etfGenerar() {
  const r = etfCalcular();
  if (!r) { pmToast('Poné la fecha de elaboración y los días de vida útil', 'err'); return; }
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) { pmToast('No cargó la librería de PDF. Recargá la página e intentá de nuevo', 'err'); return; }

  const doc = new jsPDFCtor({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const filas = Math.max(1, Math.floor((H - 2 * ETF_MARGEN + ETF_GAP) / (ETF_LH + ETF_GAP)));
  const porHoja = ETF_COLS * filas;
  const x0 = (W - (ETF_COLS * ETF_LW + (ETF_COLS - 1) * ETF_GAP)) / 2;
  const y0 = (H - (filas * ETF_LH + (filas - 1) * ETF_GAP)) / 2;

  const pedido = parseInt(document.getElementById('etf-cantidad').value);
  const total = pedido > 0 ? pedido : porHoja;
  const elab = _etfFmt(r.elab), venc = _etfFmt(r.venc);

  for (let i = 0; i < total; i++) {
    const pos = i % porHoja;
    if (i > 0 && pos === 0) doc.addPage();
    const col = pos % ETF_COLS, fila = Math.floor(pos / ETF_COLS);
    _etfDibujarEtiqueta(doc, x0 + col * (ETF_LW + ETF_GAP), y0 + fila * (ETF_LH + ETF_GAP), elab, venc);
  }

  doc.save('etiquetas-fechas-' + r.elab.getFullYear() + String(r.elab.getMonth() + 1).padStart(2, '0') + String(r.elab.getDate()).padStart(2, '0') + '.pdf');
  const hojas = Math.ceil(total / porHoja);
  pmToast('Hoja generada: ' + total + ' etiqueta' + (total === 1 ? '' : 's') + ' en ' + hojas + ' hoja' + (hojas === 1 ? '' : 's') + ' (' + porHoja + ' por hoja)');
}
