// ═══════════════════════════════════════════════════════════════
// explosion.js — Reporte "🧪 Explosión de ingredientes" (prefijo ex*)
//
// Se elige un pan o galleta del maestro de tipos de pan/galleta
// (G.tiposPan / G.tiposGalleta) y una cantidad (unidades o gramos). El reporte
// lee la receta ligada al producto, abre subrecetas y rellenos hasta los
// ingredientes, y muestra:
//   1. explosión por componente
//   2. sumario total de ingredientes
//   3. hidratación real
//
// Solo reporte: no escribe en Supabase.
//
// Hidratación:
//   · "real"        = (agua + agua que aportan leche, huevo, yogur y la masa
//                      madre) ÷ harina total. Cada ingrediente aporta según su
//                      contenido de agua (leche 87 %, huevo 75 %, …).
//   · "solo agua"   = la cifra clásica: agua ÷ harina, contando el agua y la
//                      harina que trae la masa madre pero no leche ni huevo.
//   · mantequilla (≈16 % de agua) no se cuenta, como es habitual.
//
// Masa madre / inóculo: un ingrediente cuyo nombre dice masa madre, mm o
// levain se abre en harina y agua usando el número al final del nombre como
// hidratación ("Mm De Centeno 80" → 80 %). Sin número se supone 100 % y se
// avisa en el reporte.
// ═══════════════════════════════════════════════════════════════

// Contenido de agua por ingrediente. k:'agua' cuenta en las dos hidrataciones;
// k:'aporte' solo en la real. La primera regla que coincide manda.
const EX_AGUA = [
  { re: /^(agua|hielo)\b(?!\s+de\s)/i,       w: 1,    k: 'agua'   },
  { re: /leche en polvo|leche polvo/i,       w: 0.04, k: 'aporte' },
  { re: /leche condensada/i,                 w: 0.27, k: 'aporte' },
  { re: /leche evaporada/i,                  w: 0.74, k: 'aporte' },
  { re: /leche/i,                            w: 0.87, k: 'aporte' },
  { re: /yogur/i,                            w: 0.85, k: 'aporte' },
  { re: /yema/i,                             w: 0.50, k: 'aporte' },
  { re: /clara/i,                            w: 0.88, k: 'aporte' },
  { re: /huevo/i,                            w: 0.75, k: 'aporte' }
];
const EX_HARINA_RE   = /harina|s[eé]mola/i;
const EX_INOCULO_RE  = /masa madre|\bmm\b|levain|starter|cultivo/i;

let _exSel = '';          // clave del producto ('P:id' | 'G:id')
let _exModo = 'u';        // 'u' unidades | 'g' gramos
let _exCant = 1;
let _exEstiloOk = false;

function _exLimpiar(n) {
  return String(n || '').replace(/^[^\wÁÉÍÓÚÑáéíóúñ]+/, '').trim();
}

function _exAguaDe(nombre) {
  const n = _exLimpiar(nombre);
  for (const r of EX_AGUA) if (r.re.test(n)) return { w: r.w, k: r.k };
  return null;
}

// ── Productos del maestro ──────────────────────────────────────
function _exRecPorCodigo(cod) {
  return (_sbRecLista() || []).find(r => r.code === cod) || null;
}

function _exItems() {
  const out = [];
  (G.tiposPan || []).forEach(p => out.push({
    key: 'P:' + p.id, tipo: 'pan', cod: p.id, nombre: p.nombre, peso: p.peso, recCode: p.recetaCod || ''
  }));
  (G.tiposGalleta || []).forEach(p => out.push({
    key: 'G:' + p.id, tipo: 'galleta', cod: p.id, nombre: p.nombre, peso: p.peso, recCode: p.recetaCod || ''
  }));
  return out;
}

// ── Explosión de la receta ─────────────────────────────────────
// Devuelve nodos { tipo:'ing'|'sub'|'addon', n, g, rec?, hijos? }.
// Los gramos son los de la receta base; después se escalan a la cantidad pedida.
function exExpandir(r, targetMass, visited) {
  const vis = new Set(visited || []);
  if (r.code) vis.add(r.code);
  const res = pmCostoReceta(r, targetMass);
  const lista = _sbRecLista() || [];
  const nodos = [];

  (res.lines || []).forEach(l => {
    if (l.isSub || l.isAddon) return;
    const n = _exLimpiar(l.name);
    if (n && l.g > 0) nodos.push({ tipo: 'ing', n, g: l.g });
  });

  (r.subrecs || []).forEach(sub => {
    const ref = lista.find(x => x.code === sub.recId);
    if (!ref || vis.has(ref.code)) return;
    const m = sub.gFijos > 0 ? sub.gFijos : (sub.pct > 0 ? res.flourW * sub.pct / 100 : 0);
    if (m <= 0) return;
    nodos.push({
      tipo: 'sub', n: _exLimpiar(sub.label || ref.name), rec: ref.code + ' · ' + ref.name,
      g: m, hijos: exExpandir(ref, m, vis)
    });
  });

  (r.addons || []).forEach(addon => {
    const ref = lista.find(x => x.code === addon.recId);
    if (!ref || !addon.gPorUnidad || vis.has(ref.code)) return;
    const m = addon.gPorUnidad * (r.units || 1);
    nodos.push({
      tipo: 'addon', n: _exLimpiar(addon.label || ref.name), rec: ref.code + ' · ' + ref.name,
      g: m, hijos: exExpandir(ref, m, vis)
    });
  });
  return nodos;
}

// Abre los inóculos (masa madre) en harina + agua, y escala todo por k.
function exProcesar(nodos, k) {
  return nodos.map(nd => {
    const g = nd.g * k;
    if (nd.tipo === 'ing' && EX_INOCULO_RE.test(nd.n)) {
      const mNum = nd.n.match(/(\d{2,3})\s*%?\s*$/);
      const hid = mNum ? parseFloat(mNum[1]) : 100;
      const harina = /centeno/i.test(nd.n) ? 'Harina de centeno' : 'Harina';
      return {
        tipo: 'ino', n: nd.n, g, hid, supuesto: !mNum,
        hijos: [
          { tipo: 'ing', n: harina, g: g * 100 / (100 + hid), via: 'ino' },
          { tipo: 'ing', n: 'Agua',  g: g * hid / (100 + hid), via: 'ino' }
        ]
      };
    }
    if (nd.hijos) return Object.assign({}, nd, { g, hijos: exProcesar(nd.hijos, k) });
    return Object.assign({}, nd, { g });
  });
}

// Hojas (ingredientes finales) de un árbol de nodos.
function exHojas(nodos, via, out) {
  out = out || [];
  nodos.forEach(nd => {
    if (nd.tipo === 'ing') { out.push({ n: nd.n, g: nd.g, via: nd.via || via || '' }); return; }
    exHojas(nd.hijos || [], nd.tipo === 'ino' ? 'ino' : (via || nd.tipo), out);
  });
  return out;
}

// Calcula todo el reporte para un producto y una cantidad. Devuelve null si no se puede.
function exCalcular(item, modo, cant) {
  const r = item && item.recCode ? _exRecPorCodigo(item.recCode) : null;
  if (!r) return null;
  const base = pmCostoReceta(r);
  if (!base || !base.mass) return null;

  let pesoU = item.peso, pesoDeReceta = false;
  if (!(pesoU > 0)) { pesoU = base.mass / (r.units || 1); pesoDeReceta = true; }
  const gramos = modo === 'g' ? cant : cant * pesoU;
  if (!(gramos > 0)) return null;
  const unidades = gramos / pesoU;

  const k = gramos / base.mass;
  const arbol = exProcesar(exExpandir(r), k);
  const hojas = exHojas(arbol);

  let H = 0, Aagua = 0, Aaporte = 0;
  hojas.forEach(h => {
    if (EX_HARINA_RE.test(h.n)) { H += h.g; return; }
    const a = _exAguaDe(h.n);
    if (!a) return;
    if (a.k === 'agua') Aagua += a.w * h.g; else Aaporte += a.w * h.g;
  });

  // Hidratación declarada: agua directa ÷ harina directa de la receta
  const flourPct = (r.flour || []).reduce((a, i) => a + (parseFloat(i.pct) || 0), 0);
  const aguaPct = (r.other || []).reduce((a, i) => {
    const nom = _exLimpiar(i.productName || i.manualName || '');
    return /^(agua|hielo)\b/i.test(nom) ? a + (parseFloat(i.pct) || 0) : a;
  }, 0);
  const declarada = flourPct > 0 && aguaPct > 0 ? aguaPct / flourPct * 100 : null;

  // Sumario: mismo ingrediente de distintos componentes se junta
  const mapa = new Map();
  hojas.forEach(h => {
    const key = h.n.toLowerCase();
    const x = mapa.get(key) || { n: h.n, g: 0, main: false, ino: false };
    x.g += h.g;
    if (h.via === 'ino') x.ino = true; else x.main = true;
    mapa.set(key, x);
  });
  const filas = [...mapa.values()].map(x => {
    const esH = EX_HARINA_RE.test(x.n);
    const a = esH ? null : _exAguaDe(x.n);
    return Object.assign(x, { harina: esH, agua: a });
  });

  const sinNumero = [];
  (function rec(ns) { ns.forEach(nd => { if (nd.tipo === 'ino' && nd.supuesto) sinNumero.push(nd.n); if (nd.hijos) rec(nd.hijos); }); })(arbol);

  return {
    r, item, gramos, unidades, pesoU, pesoDeReceta, arbol, filas, H,
    Aagua, Aaporte, declarada, sinNumero,
    real: H > 0 ? (Aagua + Aaporte) / H * 100 : null,
    soloAgua: H > 0 ? Aagua / H * 100 : null,
    aplica: item.tipo !== 'galleta' && H > 0 && (Aagua + Aaporte) > 0
  };
}

// ── Hoja (pantalla e impresión) ────────────────────────────────
function _exF(x) { return Number(x).toLocaleString('es-CR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function _exP(g, H) { return H > 0 ? _exF(g / H * 100) + ' %' : '—'; }

function _exFilasArbol(nodos, H, nivel) {
  let h = '';
  nodos.forEach(nd => {
    const pad = nivel ? ` style="padding-left:${nivel * 16}px"` : '';
    if (nd.tipo === 'ing') {
      h += `<tr class="${nivel ? 'sub' : ''}"><td${pad}>${pmEsc(nd.n)}</td><td class="n">${_exF(nd.g)} g</td><td class="n">${_exP(nd.g, H)}</td></tr>`;
    } else {
      const det = nd.tipo === 'ino'
        ? `<span class="ex-mu">· hidratación ${_exF(nd.hid)} %${nd.supuesto ? ' (supuesto: el nombre no trae número)' : ''}</span>`
        : `<span class="ex-mu">· ${pmEsc(nd.rec || '')}</span>`;
      h += `<tr class="grp"><td${pad}>${pmEsc(nd.n)} ${det}</td><td class="n">${_exF(nd.g)} g</td><td class="n">${_exP(nd.g, H)}</td></tr>`;
      h += _exFilasArbol(nd.hijos || [], H, nivel + 1);
    }
  });
  return h;
}

function _exHojaHTML(d) {
  const { r, item } = d;
  const hoy = new Date().toLocaleDateString('es-CR', { day: '2-digit', month: 'long', year: 'numeric' });
  const tipoTxt = item.tipo === 'galleta' ? 'Galleta' : (String(r.cat || '').toLowerCase() === 'pan_mm' ? 'Pan de masa madre' : 'Pan');
  const un = d.unidades % 1 === 0 ? String(d.unidades) : _exF(d.unidades);
  const pesoU = Math.round(d.pesoU).toLocaleString('es-CR') + ' g' + (d.pesoDeReceta ? ' (rendimiento de receta)' : '');

  // Sumario
  const harinas = d.filas.filter(x => x.harina).sort((a, b) => b.g - a.g);
  const aguas   = d.filas.filter(x => !x.harina && x.agua && x.agua.k === 'agua');
  const resto   = d.filas.filter(x => !x.harina && !(x.agua && x.agua.k === 'agua')).sort((a, b) => b.g - a.g);
  const fila = (x, nota) => `<tr><td>${pmEsc(x.n)}${nota ? ` <span class="ex-mu">${nota}</span>` : ''}</td><td class="n">${_exF(x.g)} g</td><td class="n">${_exP(x.g, d.H)}</td></tr>`;
  let s = '';
  harinas.forEach(x => { s += fila(x, x.ino && !x.main ? '(de la masa madre)' : ''); });
  s += `<tr class="grp"><td>Harina total</td><td class="n">${_exF(d.H)} g</td><td class="n">${d.H > 0 ? '100,0 %' : '—'}</td></tr>`;
  aguas.forEach(x => { s += fila(x, x.ino && x.main ? '(incluye la de la masa madre)' : (x.ino ? '(de la masa madre)' : '')); });
  resto.forEach(x => {
    const nota = x.agua && x.agua.k === 'aporte' ? `(aporta ${_exF(x.g * x.agua.w)} g de agua)` : '';
    s += fila(x, nota);
  });
  s += `<tr class="tot"><td>Total masa</td><td class="n">${_exF(d.gramos)} g</td><td class="n">${_exP(d.gramos, d.H)}</td></tr>`;

  // Tarjetas de hidratación
  const caja = (k, v, acento) => `<div class="ex-m${acento ? ' ac' : ''}"><div class="ex-k">${k}</div><div class="ex-v">${v}</div></div>`;
  const tarjetas = d.aplica
    ? caja('Hidratación real', _exF(d.real) + ' %', true) +
      caja('Solo agua (clásica)', _exF(d.soloAgua) + ' %') +
      caja('Declarada en la receta', d.declarada !== null ? _exF(d.declarada) + ' %' : '—') +
      caja('Agua total', _exF(d.Aagua + d.Aaporte) + ' g') +
      caja('Harina total', _exF(d.H) + ' g')
    : caja('Hidratación', 'No aplica', false) + caja('Harina total', _exF(d.H) + ' g');

  const notas = [];
  if (d.aplica) {
    notas.push('Hidratación real = agua total ÷ harina total. Cuenta el agua, la que trae la masa madre y la que aportan leche (87 %), huevo (75 %) y otros líquidos, según su contenido de agua. La mantequilla no se cuenta.');
    notas.push('Solo agua = la cifra clásica: agua (con la de la masa madre) ÷ harina total, sin leche ni huevo.');
  } else if (item.tipo === 'galleta') {
    notas.push('La hidratación no aplica a las galletas.');
  } else {
    notas.push('Esta receta no tiene harina o no tiene ningún ingrediente con agua, por eso no se calcula la hidratación.');
  }
  d.sinNumero.forEach(n => notas.push(`<b>Supuesto:</b> el ingrediente «${pmEsc(n)}» no trae número en el nombre; se supuso 100 % de hidratación. Si no es así, ponle el número (por ejemplo "Mm de centeno 80").`));

  return `
  <div class="ex-hoja">
    <h1>EXPLOSIÓN DE INGREDIENTES</h1>
    <div class="ex-sub">${pmEsc(item.nombre)} · ${d.gramos.toLocaleString('es-CR', { maximumFractionDigits: 1 })} g de masa</div>
    <div class="ex-meta">
      <div><div class="ex-k">Tipo</div><div>${tipoTxt}</div></div>
      <div><div class="ex-k">Código de producto</div><div>${pmEsc(item.cod)}</div></div>
      <div><div class="ex-k">Nombre</div><div>${pmEsc(item.nombre)}</div></div>
      <div><div class="ex-k">Receta ligada</div><div>${pmEsc(r.code)} · ${pmEsc(r.name)}</div></div>
      <div><div class="ex-k">Peso unitario</div><div>${pesoU}</div></div>
      <div><div class="ex-k">Unidades</div><div>${un}</div></div>
      <div><div class="ex-k">Peso de masa total</div><div><b>${d.gramos.toLocaleString('es-CR', { maximumFractionDigits: 1 })} g</b></div></div>
    </div>
    <h3>1. EXPLOSIÓN POR COMPONENTE</h3>
    <table class="ex-t"><thead><tr><th>Ingrediente</th><th class="n">Gramos</th><th class="n">% panadero</th></tr></thead><tbody>
      ${_exFilasArbol(d.arbol, d.H, 0)}
      <tr class="tot"><td>Total masa</td><td class="n">${_exF(d.gramos)} g</td><td class="n"></td></tr>
    </tbody></table>
    <h3>2. SUMARIO TOTAL DE INGREDIENTES</h3>
    <table class="ex-t"><thead><tr><th>Ingrediente</th><th class="n">Gramos</th><th class="n">% panadero</th></tr></thead><tbody>${s}</tbody></table>
    <h3>3. HIDRATACIÓN</h3>
    <div class="ex-cajas">${tarjetas}</div>
    <ul class="ex-notas">${notas.map(n => `<li>${n}</li>`).join('')}</ul>
    <div class="ex-pie">Victor's Bakery &amp; Sweets · PanMaestro · ${hoy}</div>
  </div>`;
}

const _EX_CSS = `
.ex-hoja{background:#faf6ec;color:#161616;font-family:Arial,Helvetica,sans-serif;padding:22px 26px;border-radius:6px;max-width:820px;margin:0 auto}
.ex-hoja h1{text-align:center;font-size:26px;line-height:1.05;margin:0 0 6px;font-weight:900;letter-spacing:.3px}
.ex-sub{text-align:center;font-size:13px;border-top:2px solid #161616;border-bottom:2px solid #161616;padding:7px 0;margin-bottom:12px}
.ex-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;font-size:13px;padding-bottom:10px;border-bottom:1px solid #161616}
.ex-k{font-size:11px;color:#555}
.ex-hoja h3{font-size:15px;margin:16px 0 4px;font-weight:900}
.ex-t{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}
.ex-t th,.ex-t td{border:1.5px solid #161616;padding:3px 7px;text-align:left}
.ex-t th{background:#ece4d0}
.ex-t td.n,.ex-t th.n{text-align:right;white-space:nowrap}
.ex-t tr.grp td{font-weight:700;background:#f3ecd9}
.ex-t tr.sub td{color:#333}
.ex-t tr.tot td{font-weight:700}
.ex-mu{color:#666;font-weight:400}
.ex-cajas{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:6px}
.ex-m{border:1.5px solid #161616;padding:7px 10px}
.ex-m.ac{background:#161616;color:#faf6ec}
.ex-m.ac .ex-k{color:#d9d2c0}
.ex-v{font-size:20px;font-weight:700;margin-top:2px}
.ex-notas{margin:10px 0 0;padding-left:18px;font-size:11.5px;line-height:1.45}
.ex-pie{text-align:center;font-size:10.5px;color:#555;margin-top:12px}
@media (max-width:640px){.ex-hoja h1{font-size:21px}}
`;

function _exAsegurarEstilo() {
  if (_exEstiloOk) return;
  const st = document.createElement('style');
  st.id = 'ex-style';
  st.textContent = _EX_CSS;
  document.head.appendChild(st);
  _exEstiloOk = true;
}

// ── Pantalla (se llama desde repRender) ────────────────────────
async function exReporteHTML() {
  _exAsegurarEstilo();
  if (pmDB.disponible() && !_sbRecCache) { await _sbCosteoCargar(); }
  const items = _exItems();
  if (!_exSel || !items.find(i => i.key === _exSel)) {
    const primero = items.find(i => i.recCode && _exRecPorCodigo(i.recCode));
    _exSel = primero ? primero.key : '';
  }
  const grupo = (tipo, titulo) => {
    const lst = items.filter(i => i.tipo === tipo);
    if (!lst.length) return '';
    return `<optgroup label="${titulo}">` + lst.map(i => {
      const ok = i.recCode && _exRecPorCodigo(i.recCode);
      return `<option value="${pmEsc(i.key)}" ${i.key === _exSel ? 'selected' : ''} ${ok ? '' : 'disabled'}>${pmEsc(i.cod)} · ${pmEsc(i.nombre)}${ok ? '' : ' (sin receta ligada)'}</option>`;
    }).join('') + `</optgroup>`;
  };
  setTimeout(exPintar, 0);
  return `
  <div class="card no-print" style="margin-bottom:12px">
    <div class="row">
      <div class="col"><label>Producto terminado (maestro de tipos de pan y galleta)</label>
        <select id="ex-sel" onchange="exElegir(this.value)">${grupo('pan', '🍞 Panes')}${grupo('galleta', '🍪 Galletas')}</select>
      </div>
      <div class="col sm"><label>Cantidad por</label>
        <select id="ex-modo" onchange="exCambiar()"><option value="u" ${_exModo === 'u' ? 'selected' : ''}>Unidades</option><option value="g" ${_exModo === 'g' ? 'selected' : ''}>Gramos</option></select>
      </div>
      <div class="col sm"><label>Cantidad</label>
        <input type="number" id="ex-cant" min="0" step="any" value="${_exCant}" oninput="exCambiar()" style="text-align:right">
      </div>
      <div class="col" style="display:flex;align-items:flex-end">
        <button class="btn btn-gold btn-sm" onclick="exImprimir()">🖨 Imprimir / guardar PDF</button>
      </div>
    </div>
  </div>
  <div id="ex-out"></div>`;
}

function exElegir(key) { _exSel = key; exPintar(); }

function exCambiar() {
  const m = document.getElementById('ex-modo');
  const c = document.getElementById('ex-cant');
  if (m) _exModo = m.value;
  if (c) _exCant = parseFloat(c.value) || 0;
  exPintar();
}

function _exCtx() {
  const item = _exItems().find(i => i.key === _exSel);
  return item ? { item, d: exCalcular(item, _exModo, _exCant) } : null;
}

function exPintar() {
  const out = document.getElementById('ex-out');
  if (!out) return;
  const ctx = _exCtx();
  if (!ctx) { out.innerHTML = '<div class="card">Elegí un producto con receta ligada (Maestros → Tipos de pan/galleta).</div>'; return; }
  if (!ctx.d) { out.innerHTML = '<div class="card">Indicá una cantidad mayor a cero. Si ya lo hiciste, revisá que la receta tenga ingredientes y masa total.</div>'; return; }
  out.innerHTML = _exHojaHTML(ctx.d);
}

function exImprimir() {
  const ctx = _exCtx();
  if (!ctx || !ctx.d) { pmToast('Elegí un producto y una cantidad', 'err'); return; }
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Explosión — ${pmEsc(ctx.item.nombre)}</title>
    <style>
      @page{size:letter;margin:1.2cm}
      body{margin:0;padding:14px;background:#fff;font-family:Arial,Helvetica,sans-serif}
      .tb{margin-bottom:12px}.tb button{font-size:12px;padding:6px 14px;cursor:pointer}
      .ex-hoja{border-radius:0;max-width:none}
      @media print{.tb{display:none}body{padding:0}}
      ${_EX_CSS}
    </style></head><body>
    <div class="tb"><button onclick="window.print()">🖨 Imprimir / guardar PDF</button></div>
    ${_exHojaHTML(ctx.d)}
  </body></html>`);
  w.document.close();
  w.focus();
}
