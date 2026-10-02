// ═══════════════════════════════════════════════════════════════
// precio_venta.js — Reporte "💲 Precio de venta" (prefijo pv*)
//
// Una hoja por producto (pan, galleta u otro) con el método de 8 pasos:
// ingredientes → mano de obra → otros costos → costo real → margen →
// impuesto → precio final. Solo reporte: no escribe en Supabase.
//
// De dónde sale cada número (se muestra con una etiqueta en pantalla):
//   · "receta"  → dato guardado por Victor en la receta (modPct, ggPct, margen)
//   · "estimado"→ referencia por tipo de producto (PV_REF), cuando la receta
//                 no trae el dato. Es una estimación general de la industria,
//                 NO una medición de este obrador: conviene calibrarla.
//   · "manual"  → valor que se escribió a mano en los supuestos de la hoja
//
// Los costos de materiales NO se estiman: salen de pmCostoReceta(), igual
// que el resto de PanMaestro (con merma de la receta incluida).
// ═══════════════════════════════════════════════════════════════

// Referencias por tipo de producto (porcentajes sobre el costo de materiales,
// mismo criterio que usa Costeo para MOD y GG). margen:null → usa G.margenDefault.
const PV_REF = {
  pan:     { mod: 80,  gg: 45, margen: null, iva: 1,  label: 'Pan' },
  pan_mm:  { mod: 90,  gg: 50, margen: null, iva: 1,  label: 'Pan de masa madre' },
  boll:    { mod: 100, gg: 50, margen: 45,   iva: 13, label: 'Pan dulce / bollería' },
  galleta: { mod: 45,  gg: 40, margen: 50,   iva: 13, label: 'Galleta' },
  otro:    { mod: 70,  gg: 45, margen: null, iva: 13, label: 'Otro producto' }
};

let _pvSel = '';          // clave del producto seleccionado ('P:id' | 'G:id' | 'R:code')
let _pvOv  = {};          // supuestos editados a mano, por clave de producto
let _pvEstiloOk = false;

// ── Lista de productos reportables ─────────────────────────────
function _pvRecPorCodigo(cod) {
  return (_sbRecLista() || []).find(r => r.code === cod) || null;
}

function _pvItems() {
  const items = [];
  const usadas = new Set();
  (G.tiposPan || []).forEach(p => {
    items.push({ key: 'P:' + p.id, tipo: 'pan', nombre: p.nombre, peso: p.peso, precio: p.precio, recCode: p.recetaCod || '' });
    if (p.recetaCod) usadas.add(p.recetaCod);
  });
  (G.tiposGalleta || []).forEach(p => {
    items.push({ key: 'G:' + p.id, tipo: 'galleta', nombre: p.nombre, peso: p.peso, precio: p.precio, recCode: p.recetaCod || '' });
    if (p.recetaCod) usadas.add(p.recetaCod);
  });
  // "Otros": recetas de categoría "otro" que no están ligadas a ningún tipo de pan/galleta
  (_sbRecLista() || []).forEach(r => {
    if (!r.code || usadas.has(r.code)) return;
    if (String(r.cat || '').toLowerCase() !== 'otro') return;
    items.push({ key: 'R:' + r.code, tipo: 'otro', nombre: r.name, peso: null, precio: null, recCode: r.code });
  });
  return items;
}

function _pvClase(r, item) {
  const cat    = String((r && r.cat) || '').toLowerCase();
  const nombre = (item && item.nombre) || (r && r.name) || '';
  if (cat === 'galleta' || (item && item.tipo === 'galleta')) return 'galleta';
  if (cat !== 'pan_mm' && /golfeado|roles? de canela|croissant|brioche|dan[eé]s|hojaldre|pan dulce|cachito/i.test(nombre)) return 'boll';
  if (cat === 'pan_mm') return 'pan_mm';
  if (cat === 'pan' || (item && item.tipo === 'pan')) return 'pan';
  return 'otro';
}

// ── Supuestos: receta → estimado → manual ──────────────────────
function _pvSupuestos(r, item) {
  const clase = _pvClase(r, item);
  const ref   = PV_REF[clase];
  const ov    = _pvOv[item.key] || {};
  const pick = (campo, deReceta, deRef) => {
    if (ov[campo] !== undefined && ov[campo] !== '') return { v: parseFloat(ov[campo]) || 0, origen: 'manual' };
    if (deReceta !== undefined && deReceta !== null)  return { v: deReceta, origen: 'receta' };
    return { v: deRef, origen: 'estimado' };
  };
  return {
    clase,
    claseLabel: ref.label,
    mod:    pick('mod',    r.modPct,  ref.mod),
    gg:     pick('gg',     r.ggPct,   ref.gg),
    margen: pick('margen', r.margen,  ref.margen !== null ? ref.margen : (G.margenDefault || 40)),
    iva:    pick('iva',    undefined, ref.iva)
  };
}

// ── Cálculo (todo en colones enteros, para que la hoja cuadre) ─
function _pvCalcular(r, item, s) {
  const c = pmCostoReceta(r);
  if (!c || !c.totalMerma || !r.totalMass) return null;

  const peso   = item.peso || (r.totalMass / (r.units || 1));
  const cpgMat = c.totalMerma / r.totalMass;          // ₡/g de materiales, con merma
  const matPz  = cpgMat * peso;                       // materiales por pieza

  // Desglose de ingredientes: se reparte matPz según el peso de cada línea en el costo
  const sumL = c.lines.reduce((a, l) => a + (l.cost || 0), 0);
  const porNombre = {};
  c.lines.forEach(l => {
    const nom = String(l.name || '').replace(/^[^\wÁÉÍÓÚÑáéíóúñ]+/, '').trim() || 'Ingrediente';
    porNombre[nom] = (porNombre[nom] || 0) + (l.cost || 0);
  });
  let ings = Object.entries(porNombre)
    .map(([nombre, cost]) => ({ nombre, exacto: sumL > 0 ? cost / sumL * matPz : 0 }))
    .sort((a, b) => b.exacto - a.exacto);
  const MAXI = 7;
  if (ings.length > MAXI) {
    const resto = ings.slice(MAXI - 1).reduce((a, x) => a + x.exacto, 0);
    ings = ings.slice(0, MAXI - 1).concat([{ nombre: 'Otros ingredientes', exacto: resto }]);
  }
  ings.forEach(x => { x.v = Math.round(x.exacto); });
  const matR = Math.round(matPz);
  // ajustar redondeo en la fila más grande para que la suma sea exactamente matR
  const dif = matR - ings.reduce((a, x) => a + x.v, 0);
  if (ings.length && dif !== 0) ings[0].v += dif;

  const modR  = Math.round(matPz * s.mod.v / 100);
  const ggR   = Math.round(matPz * s.gg.v / 100);
  const costo = matR + modR + ggR;

  const m = s.margen.v / 100;
  if (m >= 1) return null;
  const neto    = Math.round(costo / (1 - m));
  const ivaR    = Math.round(neto * s.iva.v / 100);
  const final   = neto + ivaR;
  const paso    = final < 200 ? 5 : final < 1000 ? 25 : 50;   // redondeo al siguiente múltiplo de moneda
  const carta   = Math.ceil(final / paso) * paso;
  const netoCarta   = carta / (1 + s.iva.v / 100);
  const margenCarta = netoCarta > 0 ? (netoCarta - costo) / netoCarta * 100 : 0;

  return { c, peso, matR, ings, modR, ggR, costo, neto, ivaR, final, carta, paso, margenCarta, merma: r.merma || 0 };
}

// ── "Lectura del analista": observaciones por reglas ───────────
function _pvLectura(r, item, s, d) {
  const out = [];
  const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;

  // 1) Qué pesa más en el costo
  const top = d.ings.find(x => x.nombre !== 'Otros ingredientes');
  if (top && d.matR > 0) {
    const share = pct(top.v, d.matR);
    // sensibilidad: +10% en ese ingrediente, arrastrando MOD/GG (que son % de materiales)
    const dCosto  = top.exacto * 0.10 * (1 + (s.mod.v + s.gg.v) / 100);
    const dPrecio = dCosto / (1 - s.margen.v / 100) * (1 + s.iva.v / 100);
    out.push(`<b>${pmEsc(top.nombre)}</b> es el ingrediente que más pesa: ${share}% del costo de materiales. Si su precio sube 10%, el precio final sube cerca de ${pmMoney(Math.round(dPrecio))} por unidad.`);
  }

  // 2) Peso relativo de MOD y GG
  const base = d.costo || 1;
  out.push(`De cada ${pmMoney(100)} de costo, ${pmMoney(pct(d.matR, base))} son materiales, ${pmMoney(pct(d.modR, base))} mano de obra y ${pmMoney(pct(d.ggR, base))} otros costos.`);

  // 3) Comparación contra el precio actual de lista
  if (item.precio > 0) {
    const netoAct   = item.precio / (1 + s.iva.v / 100);
    const margenAct = (netoAct - d.costo) / netoAct * 100;
    const dif = item.precio - d.carta;
    if (margenAct >= s.margen.v - 0.05) {
      out.push(`Con el precio actual de ${pmMoney(item.precio)} el margen real es ${margenAct.toFixed(1)}%, igual o por encima del objetivo de ${s.margen.v}%.${dif > 0 ? ' Hay espacio para bajar el precio sin salir del objetivo.' : ''}`);
    } else {
      out.push(`Con el precio actual de ${pmMoney(item.precio)} el margen real es ${margenAct.toFixed(1)}%, por debajo del objetivo de ${s.margen.v}%. Para llegar al objetivo faltan ${pmMoney(d.carta - item.precio)} por unidad.`);
    }
    out.push(`<span style="color:#666">Se asume que el precio actual ya incluye impuesto.</span>`);
  }

  // 4) Calidad de los supuestos
  const est = ['mod', 'gg', 'margen', 'iva'].filter(k => s[k].origen === 'estimado');
  if (est.length) {
    const nom = { mod: 'mano de obra', gg: 'otros costos', margen: 'margen', iva: 'impuesto' };
    out.push(`Estimado con referencia de ${s.claseLabel.toLowerCase()} (no hay dato propio en la receta): ${est.map(k => nom[k]).join(', ')}. Ajusta los supuestos con los datos reales del obrador y el precio se recalcula.`);
  }
  if (d.merma > 0) out.push(`Los materiales incluyen ${d.merma}% de merma de la receta.`);
  return out;
}

// ── Hoja (misma para pantalla e impresión) ─────────────────────
function _pvEtiqueta(o) {
  const t = { receta: 'receta', estimado: 'estimado', manual: 'manual' }[o];
  return `<span class="pv-tag pv-${o}">${t}</span>`;
}

function _pvHojaHTML(item, r, s, d, conLectura) {
  const hoy = new Date().toLocaleDateString('es-CR', { day: '2-digit', month: 'long', year: 'numeric' });
  const filaIng = d.ings.map(x => `<tr><td>${pmEsc(x.nombre)}</td><td class="n">${pmMoney(x.v)}</td></tr>`).join('');
  const lectura = conLectura
    ? `<div class="pv-lectura"><h3>LECTURA DEL ANALISTA</h3><ul>${_pvLectura(r, item, s, d).map(t => `<li>${t}</li>`).join('')}</ul></div>`
    : '';
  const pesoTxt = item.peso ? `${Math.round(d.peso)} g` : `${Math.round(d.peso)} g (rendimiento de receta)`;
  return `
  <div class="pv-hoja">
    <h1>CÓMO CALCULAR<br>EL PRECIO DE VENTA</h1>
    <div class="pv-sub">${pmEsc(item.nombre)} · ${pesoTxt} · receta ${pmEsc(r.code || '')}</div>
    <div class="pv-grid">
      <div class="pv-col">
        <h3>1. ¿QUÉ NECESITAS?</h3>
        <p>Antes de poner precio, calcula cuánto cuesta producir una unidad.</p>
        <ul class="pv-mini"><li>Ingredientes</li><li>Mano de obra</li><li>Otros costos</li></ul>
        <hr>
        <h3>2. INGREDIENTES</h3>
        <p>Costo de cada ingrediente en una unidad${d.merma > 0 ? ` (incluye ${d.merma}% de merma)` : ''}.</p>
        <table class="pv-t"><thead><tr><th>Ingrediente</th><th>Costo</th></tr></thead><tbody>${filaIng}
          <tr class="tot"><td>Total ingredientes</td><td class="n">${pmMoney(d.matR)}</td></tr></tbody></table>
        <hr>
        <h3>3. MANO DE OBRA</h3>
        <p>Tiempo de preparación, horneado y servicio: ${s.mod.v}% del costo de ingredientes ${_pvEtiqueta(s.mod.origen)}</p>
        <p class="b">Mano de obra: ${pmMoney(d.modR)}</p>
        <hr>
        <h3>4. OTROS COSTOS</h3>
        <p>Gastos indirectos como gas, electricidad, agua, alquiler, empaque: ${s.gg.v}% del costo de ingredientes ${_pvEtiqueta(s.gg.origen)}</p>
        <p class="b">Otros costos: ${pmMoney(d.ggR)}</p>
      </div>
      <div class="pv-col">
        <h3>5. COSTO REAL</h3>
        <p>Suma ingredientes, mano de obra y otros costos.</p>
        <table class="pv-t"><thead><tr><th>Concepto</th><th>Costo</th></tr></thead><tbody>
          <tr><td>Ingredientes</td><td class="n">${pmMoney(d.matR)}</td></tr>
          <tr><td>Mano de obra</td><td class="n">${pmMoney(d.modR)}</td></tr>
          <tr><td>Otros costos</td><td class="n">${pmMoney(d.ggR)}</td></tr>
          <tr class="tot"><td>Costo total de producción</td><td class="n">${pmMoney(d.costo)}</td></tr></tbody></table>
        <hr>
        <h3>6. MARGEN DE BENEFICIO</h3>
        <p>Margen objetivo: ${s.margen.v}% ${_pvEtiqueta(s.margen.origen)}<br>El costo representa el ${(100 - s.margen.v)}% del precio de venta antes de impuestos.</p>
        <p class="f">Precio antes de impuestos = Costo total ÷ ${((100 - s.margen.v) / 100).toFixed(2)}<br>${pmMoney(d.costo)} ÷ ${((100 - s.margen.v) / 100).toFixed(2)} = ${pmMoney(d.neto)}</p>
        <p class="b">Precio antes de impuestos: ${pmMoney(d.neto)}</p>
        <hr>
        <h3>7. IMPUESTOS</h3>
        <p class="f">IVA ${s.iva.v}% ${_pvEtiqueta(s.iva.origen)}<br>${pmMoney(d.neto)} × ${s.iva.v}% = ${pmMoney(d.ivaR)}<br>${pmMoney(d.neto)} + ${pmMoney(d.ivaR)} = ${pmMoney(d.final)}</p>
        <hr>
        <h3>8. PRECIO FINAL</h3>
        <p>Precio calculado: ${pmMoney(d.final)}</p>
        <p class="b">Precio recomendado en carta: ${pmMoney(d.carta)}</p>
        <p class="f">Redondeado a ₡${d.paso} · margen efectivo ${d.margenCarta.toFixed(1)}%${item.precio > 0 ? `<br>Precio actual de lista: ${pmMoney(item.precio)}` : ''}</p>
      </div>
    </div>
    ${lectura}
    <div class="pv-pie">Victor's Bakery &amp; Sweets · PanMaestro · ${hoy}</div>
  </div>`;
}

const _PV_CSS = `
.pv-hoja{background:#faf6ec;color:#161616;font-family:Arial,Helvetica,sans-serif;padding:22px 26px;border-radius:6px;max-width:900px;margin:0 auto}
.pv-hoja h1{text-align:center;font-size:30px;line-height:1.05;margin:0 0 6px;font-weight:900;letter-spacing:.3px}
.pv-sub{text-align:center;font-size:13px;border-top:2px solid #161616;border-bottom:2px solid #161616;padding:7px 0;margin-bottom:14px}
.pv-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 26px}
.pv-col:first-child{border-right:1px solid #161616;padding-right:22px}
.pv-hoja h3{font-size:17px;margin:8px 0 3px;font-weight:900}
.pv-hoja p{font-size:12.5px;margin:3px 0;line-height:1.35}
.pv-hoja p.b{font-weight:700}
.pv-hoja p.f{font-size:12px}
.pv-hoja hr{border:0;border-top:1px solid #161616;margin:10px 0}
.pv-mini{margin:3px 0;padding-left:16px;font-size:12.5px}
.pv-t{width:100%;border-collapse:collapse;font-size:12.5px;margin:5px 0}
.pv-t th,.pv-t td{border:1.5px solid #161616;padding:3px 7px;text-align:left}
.pv-t td.n,.pv-t th:last-child{text-align:right}
.pv-t th{background:#ece4d0}
.pv-t tr.tot td{font-weight:700}
.pv-lectura{margin-top:14px;border:1.5px solid #161616;padding:8px 14px}
.pv-lectura h3{margin:0 0 4px;font-size:14px}
.pv-lectura ul{margin:0;padding-left:18px;font-size:12px;line-height:1.45}
.pv-lectura li{margin-bottom:3px}
.pv-pie{text-align:center;font-size:10.5px;color:#555;margin-top:12px}
.pv-tag{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:1px 6px;border-radius:8px;vertical-align:middle}
.pv-receta{background:#d9ead3;color:#1e5a1a}
.pv-estimado{background:#ffe9b0;color:#7a5200}
.pv-manual{background:#d6e4f7;color:#1c4a8a}
@media (max-width:640px){.pv-grid{grid-template-columns:1fr}.pv-col:first-child{border-right:0;padding-right:0}.pv-hoja h1{font-size:23px}}
`;

function _pvAsegurarEstilo() {
  if (_pvEstiloOk) return;
  const st = document.createElement('style');
  st.id = 'pv-style';
  st.textContent = _PV_CSS;
  document.head.appendChild(st);
  _pvEstiloOk = true;
}

// ── Pantalla del reporte (se llama desde repRender) ────────────
async function pvReporteHTML() {
  _pvAsegurarEstilo();
  if (pmDB.disponible() && !_sbRecCache) { await _sbCosteoCargar(); }
  const items = _pvItems();
  if (!_pvSel || !items.find(i => i.key === _pvSel)) {
    const primero = items.find(i => i.recCode && _pvRecPorCodigo(i.recCode));
    _pvSel = primero ? primero.key : '';
  }
  const grupo = (tipo, titulo) => {
    const lst = items.filter(i => i.tipo === tipo);
    if (!lst.length) return '';
    return `<optgroup label="${titulo}">` + lst.map(i => {
      const ok = i.recCode && _pvRecPorCodigo(i.recCode);
      return `<option value="${pmEsc(i.key)}" ${i.key === _pvSel ? 'selected' : ''} ${ok ? '' : 'disabled'}>${pmEsc(i.nombre)}${ok ? '' : ' (sin receta ligada)'}</option>`;
    }).join('') + `</optgroup>`;
  };
  setTimeout(pvActualizar, 0);
  return `
  <div class="card no-print" style="margin-bottom:12px">
    <div class="row">
      <div class="col"><label>Producto</label>
        <select id="pv-sel" onchange="pvElegir(this.value)">${grupo('pan', '🍞 Panes')}${grupo('galleta', '🍪 Galletas')}${grupo('otro', '📦 Otros')}</select>
      </div>
      <div class="col" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="pvImprimir()">🖨 Imprimir</button>
        <button class="btn btn-out btn-sm" onclick="pvImprimirTodos()">🖨 Todos los productos</button>
      </div>
    </div>
    <div id="pv-supuestos" style="margin-top:10px"></div>
  </div>
  <div id="pv-hoja-out"></div>`;
}

function pvElegir(key) { _pvSel = key; pvActualizar(); }

function pvEditar(campo, valor) {
  _pvOv[_pvSel] = _pvOv[_pvSel] || {};
  if (valor === '') delete _pvOv[_pvSel][campo]; else _pvOv[_pvSel][campo] = valor;
  _pvPintarHoja();   // solo la hoja: no se tocan los inputs para no perder el foco
}

function pvRestablecer() { delete _pvOv[_pvSel]; pvActualizar(); }

function _pvCtx(key) {
  const item = _pvItems().find(i => i.key === key);
  if (!item || !item.recCode) return null;
  const r = _pvRecPorCodigo(item.recCode);
  if (!r) return null;
  const s = _pvSupuestos(r, item);
  const d = _pvCalcular(r, item, s);
  return { item, r, s, d };
}

function _pvPintarHoja() {
  const out = document.getElementById('pv-hoja-out');
  if (!out) return;
  const ctx = _pvCtx(_pvSel);
  if (!ctx) { out.innerHTML = '<div class="card">Selecciona un producto con receta ligada (Maestros → Tipos de pan/galleta).</div>'; return; }
  if (!ctx.d) { out.innerHTML = '<div class="card">Esta receta aún no tiene costo calculable (revisa que tenga ingredientes con precio y masa total).</div>'; return; }
  out.innerHTML = _pvHojaHTML(ctx.item, ctx.r, ctx.s, ctx.d, true);
}

function pvActualizar() {
  const box = document.getElementById('pv-supuestos');
  if (!box) return;
  const ctx = _pvCtx(_pvSel);
  if (!ctx) { box.innerHTML = ''; _pvPintarHoja(); return; }
  const { s } = ctx;
  const campo = (k, lab, suf) => `
    <div class="col sm"><label>${lab} ${_pvEtiqueta(s[k].origen)}</label>
      <input type="number" step="1" min="0" value="${s[k].v}" oninput="pvEditar('${k}', this.value)" style="text-align:right"> <span style="font-size:11px;color:var(--cream2)">${suf}</span></div>`;
  box.innerHTML = `
    <div style="font-size:11px;color:var(--cream2);margin-bottom:6px">Supuestos (${pmEsc(s.claseLabel)}). Lo que no está guardado en la receta se estima; cualquier valor se puede cambiar aquí y la hoja se recalcula.</div>
    <div class="row">
      ${campo('mod', 'Mano de obra', '% de materiales')}
      ${campo('gg', 'Otros costos', '% de materiales')}
      ${campo('margen', 'Margen', '%')}
      ${campo('iva', 'IVA', '%')}
      <div class="col sm" style="display:flex;align-items:flex-end"><button class="btn btn-out btn-sm" onclick="pvRestablecer()">↺ Restablecer</button></div>
    </div>`;
  _pvPintarHoja();
}

// ── Impresión ──────────────────────────────────────────────────
function _pvVentana(cuerpo, titulo) {
  const w = window.open('', '_blank', 'width=950,height=1000');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${pmEsc(titulo)}</title>
    <style>
      @page{size:letter;margin:1.2cm}
      body{margin:0;padding:14px;background:#fff;font-family:Arial,Helvetica,sans-serif}
      .tb{margin-bottom:12px}.tb button{font-size:12px;padding:6px 14px;cursor:pointer}
      .pv-hoja{page-break-after:always;border-radius:0;max-width:none}
      .pv-hoja:last-child{page-break-after:auto}
      @media print{.tb{display:none}body{padding:0}}
      ${_PV_CSS}
    </style></head><body>
    <div class="tb"><button onclick="window.print()">🖨 Imprimir</button></div>
    ${cuerpo}
  </body></html>`);
  w.document.close();
  w.focus();
}

function pvImprimir() {
  const ctx = _pvCtx(_pvSel);
  if (!ctx || !ctx.d) { pmToast('Selecciona un producto con costo calculable', 'err'); return; }
  _pvVentana(_pvHojaHTML(ctx.item, ctx.r, ctx.s, ctx.d, true), 'Precio de venta — ' + ctx.item.nombre);
}

function pvImprimirTodos() {
  const hojas = [];
  let omitidos = 0;
  _pvItems().forEach(i => {
    const ctx = _pvCtx(i.key);
    if (!ctx || !ctx.d) { omitidos++; return; }
    hojas.push(_pvHojaHTML(ctx.item, ctx.r, ctx.s, ctx.d, true));
  });
  if (!hojas.length) { pmToast('No hay productos con costo calculable', 'err'); return; }
  _pvVentana(hojas.join(''), 'Precio de venta — todos los productos');
  if (omitidos) pmToast(`${hojas.length} hojas generadas; ${omitidos} producto(s) sin receta o sin costo quedaron fuera`);
}
