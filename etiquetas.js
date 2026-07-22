// ── 🏷️ ETIQUETAS DE PRODUCTO ────────────────────────────────
// Anexado desde etiquetas_producto.html (antes standalone con su propio
// login). Ya no necesita login ni cliente Supabase propio — usa pmDB y
// la sesión de PanMaestro directo. La impresión abre una ventana aparte
// (mismo patrón que docImprimirNota/repComImprimir en reportes.js) en
// vez de la técnica @media print del archivo original, para no chocar
// con el CSS de impresión que ya tiene la app principal.

let etProductos = [];
let etActual = null;

async function etCargarCatalogo() {
  const sel = document.getElementById('et-producto');
  if (!sel) return;
  try {
    const data = await pmDB.get('productos_terminados',
      { activo: true },
      'codigo,nombre,peso_g,precio_full,es_masa_madre'
    );
    etProductos = (data || []).sort((a,b) => (a.codigo||'').localeCompare(b.codigo||''));
    sel.innerHTML = '<option value="">Seleccioná un producto…</option>' +
      etProductos.map((p, i) => `<option value="${i}">${pmEsc(p.codigo)} — ${pmEsc(p.nombre)}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option>Error cargando catálogo</option>';
    pmToast('Error al cargar catálogo: ' + e.message, 'err');
  }
}

function etSeleccionar(idx) {
  if (idx === '') { etActual = null; document.getElementById('et-btn-imprimir').disabled = true; return; }
  etActual = etProductos[Number(idx)];
  if (!etActual) return;
  document.getElementById('et-peso').value   = etActual.peso_g ?? '';
  document.getElementById('et-precio').value = etActual.precio_full ?? '';
  etActualizarPreview();
  document.getElementById('et-btn-imprimir').disabled = false;
}

function etActualizarPreview() {
  const nombre = etActual ? etActual.nombre : '—';
  const pesoVal   = document.getElementById('et-peso').value;
  const precioVal = document.getElementById('et-precio').value;
  const peso   = pesoVal ? `${pesoVal} g` : '—';
  const precio = precioVal ? `₡${Number(precioVal).toLocaleString('es-CR')}` : '—';
  const esMM   = etActual ? !!etActual.es_masa_madre : false;

  document.getElementById('et-p-nombre').textContent = nombre;
  document.getElementById('et-p-peso').textContent   = peso;
  document.getElementById('et-p-precio').textContent = precio;

  const badge = document.getElementById('et-mm-badge');
  badge.classList.toggle('off', !esMM);

  const preview = document.getElementById('et-preview');
  let mmEl = preview.querySelector('.et-mm');
  if (esMM) {
    if (!mmEl) {
      mmEl = document.createElement('div');
      mmEl.className = 'et-mm';
      mmEl.textContent = 'MASA MADRE';
      preview.querySelector('.et-fila').appendChild(mmEl);
    }
  } else if (mmEl) {
    mmEl.remove();
  }
}

function etImprimir() {
  if (!etActual) return;
  const cantidad = Math.max(1, parseInt(document.getElementById('et-cantidad').value) || 1);
  const pesoVal   = document.getElementById('et-peso').value;
  const precioVal = document.getElementById('et-precio').value;
  const peso   = pesoVal ? `${pesoVal} g` : '';
  const precio = precioVal ? `₡${Number(precioVal).toLocaleString('es-CR')}` : '';
  const esMM   = !!etActual.es_masa_madre;

  const CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .label{width:7cm;height:4cm;border:2px solid #000;padding:0.3cm;display:flex;flex-direction:column;justify-content:space-between;background:#fff;page-break-after:always}
    .label:last-child{page-break-after:auto}
    .nombre{font-size:22px;font-weight:600;line-height:1.15}
    .fila{display:flex;gap:0.25cm;align-items:center}
    .campo{border:1px solid #000;border-radius:4px;padding:0.12cm 0.25cm;flex:1}
    .campo .k{font-size:9px;color:#555}
    .campo .v{font-size:15px;font-weight:600}
    .mm{border:2px solid #000;border-radius:20px;padding:0.1cm 0.3cm;font-size:11px;font-weight:700;text-align:center;white-space:nowrap}
    @page{size:7cm 4cm;margin:0}
  `;

  const unaEtiqueta = `
    <div class="label">
      <div class="nombre">${pmEsc(etActual.nombre)}</div>
      <div class="fila">
        <div class="campo"><div class="k">peso</div><div class="v">${peso}</div></div>
        <div class="campo"><div class="k">precio</div><div class="v">${precio}</div></div>
        ${esMM ? '<div class="mm">MASA MADRE</div>' : ''}
      </div>
    </div>`;

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Etiquetas — ${pmEsc(etActual.nombre)}</title>
    <style>${CSS}</style>
  </head><body>${unaEtiqueta.repeat(cantidad)}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}
