// ═══════════════════════════════════════════════════════════════
// simulador.js — "🔬 Simulador de receta" (prefijo sim*)
//
// Se elige un pan o galleta del maestro de tipos de pan/galleta y un gramaje
// (g por unidad × unidades). La receta se explota en todos los niveles
// (subrecetas, masa madre, rellenos) con su % panadero y su costo, y al lado
// se puede cambiar la cantidad de cualquier ingrediente para ver el efecto
// sobre el costo total, el costo por gramo y la hidratación.
//
// Es SOLO un simulador comparativo: no escribe en Supabase ni en la receta.
// Si la simulación convence, el cambio real se hace en Costeo. Los números
// simulados se pueden imprimir.
//
// Reutiliza de explosion.js (debe cargarse antes): _exItems, _exRecPorCodigo,
// _exPesoDefecto, _exMasaBase, _exLimpiar, _exAguaDe, exHojas, _exF,
// EX_HARINA_RE y EX_INOCULO_RE — así la hidratación y la masa madre se
// calculan igual que en el reporte de Explosión.
//
// Costos: cada ingrediente lleva su costo por gramo y el factor de merma de
// las recetas que lo contienen (igual que pmCostoReceta), de modo que la suma
// del costo explotado coincide con el costo de la receta en Costeo.
// ═══════════════════════════════════════════════════════════════

let _simSel = '';          // clave del producto ('P:id' | 'G:id')
let _simPeso = null;       // g por unidad escritos a mano (null = el del maestro)
let _simUds = 1;           // unidades
let _simRatios = {};       // id de nodo → factor sobre la cantidad original
let _simCtx = null;        // receta explotada (se rehace al cambiar producto/gramaje)
let _simIndex = {};        // id → nodo original (para convertir gramos escritos en factor)
let _simEstiloOk = false;

// ── Explosión con costo ────────────────────────────────────────
// Igual que exExpandir, pero cada ingrediente lleva cpg (costo por gramo) y f
// (factor de merma acumulado: la merma de su receta × la de las recetas padre
// de las que forma parte la masa). Un relleno reinicia la cadena, como hace
// pmCostoReceta (el relleno no recibe la merma de la receta padre).
function simExpandir(r, targetMass, visited, f) {
  const vis = new Set(visited || []);
  if (r.code) vis.add(r.code);
  const res = pmCostoReceta(r, targetMass);
  const lista = _sbRecLista() || [];
  const fAqui = f * (1 + (r.merma || 0) / 100);
  const nodos = [];

  (res.lines || []).forEach(l => {
    if (l.isSub || l.isAddon) return;
    const n = _exLimpiar(l.name);
    if (n && l.g > 0) nodos.push({ tipo: 'ing', n, g: l.g, cpg: l.cost / l.g, f: fAqui });
  });

  (r.subrecs || []).forEach(sub => {
    const ref = lista.find(x => x.code === sub.recId);
    if (!ref || vis.has(ref.code)) return;
    const m = sub.gFijos > 0 ? sub.gFijos : (sub.pct > 0 ? res.flourW * sub.pct / 100 : 0);
    if (m <= 0) return;
    nodos.push({
      tipo: 'sub', n: _exLimpiar(sub.label || ref.name), rec: ref.code + ' · ' + ref.name,
      g: m, hijos: simExpandir(ref, m, vis, fAqui)
    });
  });

  (r.addons || []).forEach(addon => {
    const ref = lista.find(x => x.code === addon.recId);
    if (!ref || !addon.gPorUnidad || vis.has(ref.code)) return;
    const m = addon.gPorUnidad * (r.units || 1);
    nodos.push({
      tipo: 'addon', n: _exLimpiar(addon.label || ref.name), rec: ref.code + ' · ' + ref.name,
      g: m, hijos: simExpandir(ref, m, vis, 1)
    });
  });
  return nodos;
}

// Escala por k (masa) y kAdd (rellenos) y abre la masa madre en harina + agua.
// El costo de la masa madre va en su propia fila (cpg × g); la harina y el
// agua que salen de abrirla no llevan costo aparte.
function simProcesar(nodos, k, kAdd) {
  return nodos.map(nd => {
    if (nd.tipo === 'addon') {
      return Object.assign({}, nd, { g: nd.g * kAdd, hijos: simProcesar(nd.hijos || [], kAdd, kAdd) });
    }
    const g = nd.g * k;
    if (nd.tipo === 'ing' && EX_INOCULO_RE.test(nd.n)) {
      const mNum = nd.n.match(/(\d{2,3})\s*%?\s*$/);
      const hid = mNum ? parseFloat(mNum[1]) : 100;
      const harina = /centeno/i.test(nd.n) ? 'Harina de centeno' : 'Harina';
      return {
        tipo: 'ino', n: nd.n, g, hid, supuesto: !mNum, cpg: nd.cpg, f: nd.f,
        hijos: [
          { tipo: 'ing', n: harina, g: g * 100 / (100 + hid), via: 'ino', cpg: 0, f: 1 },
          { tipo: 'ing', n: 'Agua',  g: g * hid / (100 + hid), via: 'ino', cpg: 0, f: 1 }
        ]
      };
    }
    if (nd.hijos) return Object.assign({}, nd, { g, hijos: simProcesar(nd.hijos, k, kAdd) });
    return Object.assign({}, nd, { g });
  });
}

function simAsignarIds(nodos, cont) {
  cont = cont || { n: 0 };
  nodos.forEach(nd => {
    nd.id = 'n' + (++cont.n);
    if (nd.hijos) simAsignarIds(nd.hijos, cont);
  });
}

function _simIndexar(nodos, idx) {
  nodos.forEach(nd => { idx[nd.id] = nd; if (nd.hijos) _simIndexar(nd.hijos, idx); });
  return idx;
}

// Prepara la receta para un producto, unos g por unidad y unas unidades.
function simPreparar(item, pesoU, unidades) {
  const r = item && item.recCode ? _exRecPorCodigo(item.recCode) : null;
  if (!r) return null;
  const masaBase = _exMasaBase(r);
  if (!(masaBase > 0) || !(pesoU > 0) || !(unidades > 0)) return null;
  const gramos = pesoU * unidades;
  const merma = r.merma || 0;
  const gMezcla = gramos * (1 + merma / 100);
  const k = gMezcla / masaBase;
  const kAdd = unidades / (r.units || 1);
  const arbol = simProcesar(simExpandir(r, undefined, [], 1), k, kAdd);
  simAsignarIds(arbol);
  return { r, item, pesoU, unidades, gramos, merma, gMezcla, arbol };
}

// ── Cálculo: árbol con cantidades (originales o simuladas) ─────
// Solo se editan los ingredientes y la masa madre (como bloque); la harina y
// el agua que salen de abrir la masa madre se escalan con ella.
function _simEditable(nd) { return (nd.tipo === 'ing' && nd.via !== 'ino') || nd.tipo === 'ino'; }
function _simDerivado(nd) { return nd.tipo === 'ing' && nd.via === 'ino'; }

function simMat(nodos, ratios) {
  return nodos.map(nd => {
    if (nd.tipo === 'ing') {
      const ra = nd.via === 'ino' ? 1 : (ratios[nd.id] !== undefined ? ratios[nd.id] : 1);
      const g = nd.g * ra;
      return Object.assign({}, nd, { g, c: g * (nd.cpg || 0) * (nd.f || 1) });
    }
    if (nd.tipo === 'ino') {
      const ra = ratios[nd.id] !== undefined ? ratios[nd.id] : 1;
      const g = nd.g * ra;
      const hijos = nd.hijos.map(h => Object.assign({}, h, { g: h.g * ra, c: 0 }));
      return Object.assign({}, nd, { g, hijos, c: g * (nd.cpg || 0) * (nd.f || 1) });
    }
    const hijos = simMat(nd.hijos || [], ratios);
    return Object.assign({}, nd, {
      hijos,
      g: hijos.reduce((a, h) => a + h.g, 0),
      c: hijos.reduce((a, h) => a + h.c, 0)
    });
  });
}

// Hidratación de la masa (los rellenos no cuentan), igual que exCalcular.
function simHid(mat) {
  let H = 0, Aagua = 0, Aaporte = 0;
  exHojas(mat).forEach(h => {
    if (h.via === 'addon') return;
    if (EX_HARINA_RE.test(h.n)) { H += h.g; return; }
    const a = _exAguaDe(h.n);
    if (!a) return;
    if (a.k === 'agua') Aagua += a.w * h.g; else Aaporte += a.w * h.g;
  });
  return {
    H, Aagua, Aaporte,
    real: H > 0 ? (Aagua + Aaporte) / H * 100 : null,
    soloAgua: H > 0 ? Aagua / H * 100 : null
  };
}

// Totales de un escenario: masa de mezcla, masa vendida, costo total y por gramo.
function simTotales(mat, ctx) {
  const masa = mat.filter(nd => nd.tipo !== 'addon').reduce((a, nd) => a + nd.g, 0);
  const add = mat.filter(nd => nd.tipo === 'addon').reduce((a, nd) => a + nd.g, 0);
  const costo = mat.reduce((a, nd) => a + nd.c, 0);
  const vendida = masa / (1 + ctx.merma / 100) + add;       // masa vendida + rellenos
  const hid = simHid(mat);
  return {
    masa, add, vendida, costo,
    cpg: vendida > 0 ? costo / vendida : 0,
    hid,
    aplica: ctx.item.tipo !== 'galleta' && hid.H > 0 && (hid.Aagua + hid.Aaporte) > 0
  };
}

function _simPares(os, ss, out) {
  os.forEach((o, i) => {
    out.push([o, ss[i]]);
    if (o.hijos && ss[i].hijos) _simPares(o.hijos, ss[i].hijos, out);
  });
  return out;
}

function _simEscenarios() {
  if (!_simCtx) return null;
  const mo = simMat(_simCtx.arbol, {});
  const ms = simMat(_simCtx.arbol, _simRatios);
  return { mo, ms, To: simTotales(mo, _simCtx), Ts: simTotales(ms, _simCtx) };
}

// ── Formatos ───────────────────────────────────────────────────
function _simM(x) {
  const d = Math.abs(x) >= 100 ? 0 : 2;
  return '₡' + Number(x).toLocaleString('es-CR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function _simMg(x) { return '₡' + Number(x).toLocaleString('es-CR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
function _simPct(x) { return x === null || x === undefined ? '—' : _exF(x) + ' %'; }

// Diferencia con signo; vacío si no cambió.
function _simDelta(d, fmt) {
  if (Math.abs(d) < 1e-9) return '<span class="sim-ig">—</span>';
  return `<span class="${d > 0 ? 'sim-up' : 'sim-dn'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
}

function _simCeldas(o, s, Ho, Hs) {
  const der = _simDerivado(o);
  const sinPrecio = o.tipo === 'ing' && !der && o.g > 0 && !(o.cpg > 0);
  return {
    g0: _exF(o.g) + ' g',
    p0: Ho > 0 ? _exF(o.g / Ho * 100) + ' %' : '—',
    c0: der ? '—' : _simM(o.c) + (sinPrecio ? ' ⚠' : ''),
    gs: _exF(s.g) + ' g',
    ps: Hs > 0 ? _exF(s.g / Hs * 100) + ' %' : '—',
    cs: der ? '—' : _simM(s.c) + (sinPrecio ? ' ⚠' : ''),
    dc: der ? '' : _simDelta(s.c - o.c, _simM)
  };
}

// ── Hoja: tabla de ingredientes ────────────────────────────────
function _simFilaHTML(o, s, nivel, modo, Ho, Hs) {
  const pad = ` style="padding-left:${7 + nivel * 16}px"`;
  const edit = _simEditable(o);
  const der = _simDerivado(o);
  const cls = der ? 'der' : (o.tipo === 'sub' || o.tipo === 'addon' ? 'grp' : '');
  const ce = _simCeldas(o, s, Ho, Hs);
  const id = o.id;
  let nombre = pmEsc(o.n);
  if (o.tipo === 'ino') nombre += ` <span class="sim-mu">· masa madre, hidratación ${_exF(o.hid)} %${o.supuesto ? ' (supuesto)' : ''}</span>`;
  else if (o.tipo === 'sub' || o.tipo === 'addon') nombre += ` <span class="sim-mu">· ${pmEsc(o.rec || '')}</span>`;
  else if (der) nombre += ' <span class="sim-mu">(de la masa madre)</span>';

  const celdaGs = (edit && modo === 'pantalla' && o.g > 0)
    ? `<input type="number" inputmode="decimal" min="0" step="any" class="sim-in" id="sim-in-${id}" value="${Math.round(s.g * 10) / 10}" placeholder="${Math.round(o.g * 10) / 10}" oninput="simEditar('${id}',this.value)">`
    : `<span id="sim-gs-${id}">${ce.gs}</span>`;

  let h = `<tr id="sim-r-${id}" class="${cls}${Math.abs(s.g - o.g) > 1e-9 || Math.abs(s.c - o.c) > 1e-9 ? ' chg' : ''}">`;
  h += `<td${pad}>${nombre}</td>`;
  h += `<td class="n" id="sim-g0-${id}">${ce.g0}</td><td class="n" id="sim-p0-${id}">${ce.p0}</td><td class="n" id="sim-c0-${id}">${ce.c0}</td>`;
  h += `<td class="n sim-s">${celdaGs}</td><td class="n sim-s" id="sim-ps-${id}">${ce.ps}</td><td class="n sim-s" id="sim-cs-${id}">${ce.cs}</td>`;
  h += `<td class="n" id="sim-dc-${id}">${ce.dc}</td></tr>`;
  return h;
}

function _simFilasHTML(os, ss, nivel, modo, Ho, Hs) {
  let h = '';
  os.forEach((o, i) => {
    h += _simFilaHTML(o, ss[i], nivel, modo, Ho, Hs);
    if (o.hijos && ss[i].hijos) h += _simFilasHTML(o.hijos, ss[i].hijos, nivel + 1, modo, Ho, Hs);
  });
  return h;
}

function _simTablaHTML(E, modo) {
  const Ho = E.To.hid.H, Hs = E.Ts.hid.H;
  const masa = E.mo.filter(nd => nd.tipo !== 'addon');
  const masaS = E.ms.filter(nd => nd.tipo !== 'addon');
  const add = E.mo.filter(nd => nd.tipo === 'addon');
  const addS = E.ms.filter(nd => nd.tipo === 'addon');
  let h = `<div class="sim-scroll"><table class="sim-t"><thead>
    <tr><th rowspan="2">Ingrediente</th><th colspan="3" class="n">Original</th><th colspan="3" class="n sim-s">Simulado</th><th rowspan="2" class="n">Δ costo</th></tr>
    <tr><th class="n">Gramos</th><th class="n">% pan.</th><th class="n">Costo</th><th class="n sim-s">Gramos</th><th class="n sim-s">% pan.</th><th class="n sim-s">Costo</th></tr>
  </thead><tbody>`;
  h += _simFilasHTML(masa, masaS, 0, modo, Ho, Hs);
  h += `<tr class="tot"><td>Total masa a mezclar</td><td class="n" id="sim-tm-g0">${_exF(E.To.masa)} g</td><td class="n"></td><td class="n" id="sim-tm-c0">${_simM(masa.reduce((a, x) => a + x.c, 0))}</td>
        <td class="n sim-s" id="sim-tm-gs">${_exF(E.Ts.masa)} g</td><td class="n sim-s"></td><td class="n sim-s" id="sim-tm-cs">${_simM(masaS.reduce((a, x) => a + x.c, 0))}</td><td class="n" id="sim-tm-dc"></td></tr>`;
  if (add.length) {
    h += `<tr class="grp"><td colspan="8">Rellenos y coberturas</td></tr>`;
    h += _simFilasHTML(add, addS, 0, modo, Ho, Hs);
  }
  h += `</tbody></table></div>`;
  return h;
}

// ── Hoja: resumen comparativo ──────────────────────────────────
function _simResumenFilas(E) {
  const { To, Ts } = E;
  const fila = (k, a, b, fmt, dfmt, extra) => {
    const d = (a === null || b === null) ? null : b - a;
    return `<tr${extra ? ' class="' + extra + '"' : ''}><td>${k}</td><td class="n">${a === null ? '—' : fmt(a)}</td><td class="n sim-s">${b === null ? '—' : fmt(b)}</td><td class="n">${d === null ? '' : _simDelta(d, dfmt || fmt)}</td></tr>`;
  };
  const g1 = x => _exF(x) + ' g';
  const pp = x => _exF(x) + ' pp';
  const ap = To.aplica;
  let h = '';
  h += fila('Costo total (con merma)', To.costo, Ts.costo, _simM, null, 'dest');
  h += fila('Costo por gramo', To.cpg, Ts.cpg, _simMg, null, 'dest');
  h += fila('Hidratación real', ap ? To.hid.real : null, ap ? Ts.hid.real : null, _simPct, pp, 'dest');
  h += fila('Solo agua (clásica)', ap ? To.hid.soloAgua : null, ap ? Ts.hid.soloAgua : null, _simPct, pp);
  h += fila('Harina total', To.hid.H, Ts.hid.H, g1);
  h += fila('Agua total', ap ? To.hid.Aagua + To.hid.Aaporte : null, ap ? Ts.hid.Aagua + Ts.hid.Aaporte : null, g1);
  h += fila('Masa a mezclar', To.masa, Ts.masa, g1);
  h += fila('Masa vendida' + (To.add > 0 ? ' + rellenos' : ''), To.vendida, Ts.vendida, g1);
  return h;
}

function _simCambiosHTML(E) {
  const items = [];
  _simPares(E.mo, E.ms, []).forEach(([o, s]) => {
    if (!_simEditable(o)) return;
    if (Math.abs(s.g - o.g) < 1e-9) return;
    items.push(`<li>${pmEsc(o.n)}: ${_exF(o.g)} g → <b>${_exF(s.g)} g</b> (${s.g > o.g ? '+' : '−'}${_exF(Math.abs(s.g - o.g))} g)</li>`);
  });
  return items.length
    ? `<h3>Cambios simulados</h3><ul class="sim-notas">${items.join('')}</ul>`
    : `<div class="sim-mu" style="margin-top:8px">Sin cambios todavía: escribí otra cantidad en la columna «Simulado» de cualquier ingrediente.</div>`;
}

function _simNotasHTML(E) {
  const notas = [];
  const sinPrecio = [];
  _simPares(E.mo, E.mo, []).forEach(([o]) => {
    if (o.tipo === 'ing' && !_simDerivado(o) && o.g > 0 && !(o.cpg > 0)) sinPrecio.push(pmEsc(o.n));
  });
  if (sinPrecio.length) notas.push(`<b>⚠ Sin precio en el maestro de ingredientes:</b> ${sinPrecio.join(', ')}. Cuentan como ₡0, así que el costo está subestimado.`);
  if (E.To.aplica) {
    notas.push('Hidratación real = agua total ÷ harina total; cuenta el agua, la de la masa madre y la que aportan leche, huevo y otros líquidos. Solo agua = la cifra clásica, sin leche ni huevo.');
  } else if (_simCtx.item.tipo === 'galleta') {
    notas.push('La hidratación no aplica a las galletas.');
  }
  notas.push('Costo por gramo = costo total ÷ (masa vendida + rellenos). El costo incluye la merma de la receta.');
  _simCtx.arbol.forEach(function rec(nd) {
    if (nd.tipo === 'ino' && nd.supuesto) notas.push(`<b>Supuesto:</b> «${pmEsc(nd.n)}» no trae número en el nombre; se supuso 100 % de hidratación.`);
    (nd.hijos || []).forEach(rec);
  });
  return `<ul class="sim-notas">${notas.map(n => `<li>${n}</li>`).join('')}</ul>`;
}

function _simHojaHTML(E, modo) {
  const { r, item } = _simCtx;
  const hoy = new Date().toLocaleDateString('es-CR', { day: '2-digit', month: 'long', year: 'numeric' });
  const un = _simCtx.unidades % 1 === 0 ? String(_simCtx.unidades) : _exF(_simCtx.unidades);
  return `
  <div class="sim-hoja">
    <h1>SIMULADOR DE RECETA</h1>
    <div class="sim-sub">${pmEsc(item.nombre)} · ${_exF(_simCtx.gramos)} g de masa · comparativo original vs. simulado</div>
    <div class="sim-meta">
      <div><div class="sim-k">Código de producto</div><div>${pmEsc(item.cod)}</div></div>
      <div><div class="sim-k">Receta ligada</div><div>${pmEsc(r.code)} · ${pmEsc(r.name)}</div></div>
      <div><div class="sim-k">Peso unitario</div><div>${_exF(_simCtx.pesoU)} g</div></div>
      <div><div class="sim-k">Unidades</div><div>${un}</div></div>
    </div>
    <h3>RESUMEN</h3>
    <table class="sim-t sim-res"><thead><tr><th></th><th class="n">Original</th><th class="n sim-s">Simulado</th><th class="n">Diferencia</th></tr></thead>
      <tbody id="sim-resumen-body">${_simResumenFilas(E)}</tbody></table>
    <div id="sim-cambios">${_simCambiosHTML(E)}</div>
    <h3>EXPLOSIÓN POR NIVELES</h3>
    ${_simTablaHTML(E, modo)}
    ${_simNotasHTML(E)}
    <div class="sim-pie">Simulación: no modifica la receta ni el costeo · Victor's Bakery &amp; Sweets · PanMaestro · ${hoy}</div>
  </div>`;
}

const _SIM_CSS = `
.sim-hoja{background:#faf6ec;color:#161616;font-family:Arial,Helvetica,sans-serif;padding:22px 26px;border-radius:6px;max-width:980px;margin:0 auto}
.sim-hoja h1{text-align:center;font-size:26px;line-height:1.05;margin:0 0 6px;font-weight:900;letter-spacing:.3px}
.sim-sub{text-align:center;font-size:13px;border-top:2px solid #161616;border-bottom:2px solid #161616;padding:7px 0;margin-bottom:12px}
.sim-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;font-size:13px;padding-bottom:10px;border-bottom:1px solid #161616}
.sim-k{font-size:11px;color:#555}
.sim-hoja h3{font-size:15px;margin:16px 0 4px;font-weight:900}
.sim-scroll{overflow-x:auto}
.sim-t{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}
.sim-scroll .sim-t{min-width:700px}
.sim-t th,.sim-t td{border:1.5px solid #161616;padding:3px 7px;text-align:left}
.sim-t th{background:#ece4d0}
.sim-t td.n,.sim-t th.n{text-align:right;white-space:nowrap}
.sim-t .sim-s{background:#e8f0e2}
.sim-t th.sim-s{background:#d5e4cb}
.sim-t tr.grp td{font-weight:700;background:#f3ecd9}
.sim-t tr.der td{color:#666;font-size:11.5px}
.sim-t tr.tot td{font-weight:700;background:#ece4d0}
.sim-t tr.dest td{font-weight:700}
.sim-t tr.chg td:first-child{box-shadow:inset 4px 0 0 #c9871a}
.sim-res{max-width:560px}
.sim-mu{color:#666;font-weight:400}
.sim-ig{color:#999}
.sim-up{color:#a32020;font-weight:700}
.sim-dn{color:#1d6b2e;font-weight:700}
.sim-in{width:84px;text-align:right;padding:3px 5px;font-size:12.5px;border:1.5px solid #161616;border-radius:3px;background:#fff;color:#161616}
.sim-notas{margin:6px 0 0;padding-left:18px;font-size:11.5px;line-height:1.45}
.sim-pie{text-align:center;font-size:10.5px;color:#555;margin-top:12px}
@media (max-width:640px){.sim-hoja{padding:14px 10px}.sim-hoja h1{font-size:21px}}
`;

function _simAsegurarEstilo() {
  if (_simEstiloOk) return;
  const st = document.createElement('style');
  st.id = 'sim-style';
  st.textContent = _SIM_CSS;
  document.head.appendChild(st);
  _simEstiloOk = true;
}

// ── Pantalla ───────────────────────────────────────────────────
async function simInit() {
  _simAsegurarEstilo();
  if (pmDB.disponible() && !_sbRecCache) { await _sbCosteoCargar(); }
  const items = _exItems();
  if (!_simSel || !items.find(i => i.key === _simSel)) {
    const primero = items.find(i => i.recCode && _exRecPorCodigo(i.recCode));
    _simSel = primero ? primero.key : '';
    _simPeso = null;
    _simRatios = {};
  }
  const grupo = (tipo, titulo) => {
    const lst = items.filter(i => i.tipo === tipo);
    if (!lst.length) return '';
    return `<optgroup label="${titulo}">` + lst.map(i => {
      const ok = i.recCode && _exRecPorCodigo(i.recCode);
      return `<option value="${pmEsc(i.key)}" ${i.key === _simSel ? 'selected' : ''} ${ok ? '' : 'disabled'}>${pmEsc(i.cod)} · ${pmEsc(i.nombre)}${ok ? '' : ' (sin receta ligada)'}</option>`;
    }).join('') + `</optgroup>`;
  };
  const sel = items.find(i => i.key === _simSel);
  const pesoVal = _simPeso !== null ? _simPeso : (Math.round(_exPesoDefecto(sel) * 10) / 10 || '');
  const ctrl = document.getElementById('sim-ctrl');
  if (!ctrl) return;
  ctrl.innerHTML = `
  <div class="card no-print" style="margin-bottom:12px">
    <div class="row">
      <div class="col"><label>Producto terminado (maestro de tipos de pan y galleta)</label>
        <select id="sim-sel" onchange="simElegir(this.value)">${grupo('pan', '🍞 Panes')}${grupo('galleta', '🍪 Galletas')}</select>
      </div>
      <div class="col sm"><label>Gramos por unidad</label>
        <input type="number" id="sim-peso" inputmode="decimal" min="0" step="any" value="${pesoVal}" oninput="simCambiarGramaje()" style="text-align:right">
      </div>
      <div class="col sm"><label>Unidades</label>
        <input type="number" id="sim-uds" inputmode="decimal" min="0" step="any" value="${_simUds}" oninput="simCambiarGramaje()" style="text-align:right">
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-out btn-sm" onclick="simReset()">↺ Volver a la receta original</button>
      <button class="btn btn-gold btn-sm" onclick="simImprimir()">🖨 Imprimir / guardar PDF</button>
    </div>
    <div style="font-size:12px;color:#64748B;margin-top:8px">Es un simulador: nada se guarda. Cambiá cantidades en la columna «Simulado»; si el cambio te convence, hacelo en Costeo.</div>
  </div>`;
  simPintar();
}

function simElegir(key) {
  _simSel = key;
  _simPeso = null;
  _simRatios = {};
  const p = document.getElementById('sim-peso');
  if (p) p.value = Math.round(_exPesoDefecto(_exItems().find(i => i.key === key)) * 10) / 10 || '';
  simPintar();
}

// Cambia el gramaje: las cantidades simuladas se conservan como variación
// proporcional (un +10 % en la sal sigue siendo +10 %).
function simCambiarGramaje() {
  const p = document.getElementById('sim-peso');
  const u = document.getElementById('sim-uds');
  if (p) _simPeso = parseFloat(p.value) || 0;
  if (u) _simUds = parseFloat(u.value) || 0;
  simPintar();
}

function simReset() {
  _simRatios = {};
  simPintar();
}

function simPintar() {
  const out = document.getElementById('sim-out');
  if (!out) return;
  const item = _exItems().find(i => i.key === _simSel);
  if (!item) { _simCtx = null; out.innerHTML = '<div class="card">Elegí un producto con receta ligada (Maestros → Tipos de pan/galleta).</div>'; return; }
  const pesoU = _simPeso !== null ? _simPeso : _exPesoDefecto(item);
  _simCtx = simPreparar(item, pesoU, _simUds);
  if (!_simCtx) {
    _simIndex = {};
    out.innerHTML = '<div class="card">Indicá gramos por unidad y unidades (ambos mayores a cero). Si ya lo hiciste, revisá que la receta tenga ingredientes y masa total.</div>';
    return;
  }
  _simIndex = _simIndexar(_simCtx.arbol, {});
  out.innerHTML = _simHojaHTML(_simEscenarios(), 'pantalla');
}

// Se llama en cada tecla dentro de un ingrediente: actualiza los números sin
// repintar la tabla (así el cursor no se pierde).
function simEditar(id, val) {
  const nd = _simIndex[id];
  if (!nd) return;
  const v = parseFloat(String(val).replace(',', '.'));
  if (val === '' || isNaN(v) || !(nd.g > 0)) delete _simRatios[id];
  else _simRatios[id] = Math.max(0, v) / nd.g;
  simActualizar();
}

function simActualizar() {
  const E = _simEscenarios();
  if (!E) return;
  const Ho = E.To.hid.H, Hs = E.Ts.hid.H;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  _simPares(E.mo, E.ms, []).forEach(([o, s]) => {
    const ce = _simCeldas(o, s, Ho, Hs);
    set('sim-gs-' + o.id, ce.gs);
    set('sim-ps-' + o.id, ce.ps);
    set('sim-cs-' + o.id, ce.cs);
    set('sim-dc-' + o.id, ce.dc);
    set('sim-p0-' + o.id, ce.p0);
    const tr = document.getElementById('sim-r-' + o.id);
    if (tr) tr.classList.toggle('chg', Math.abs(s.g - o.g) > 1e-9 || Math.abs(s.c - o.c) > 1e-9);
  });
  const cm = a => a.filter(nd => nd.tipo !== 'addon').reduce((x, n) => x + n.c, 0);
  set('sim-tm-g0', _exF(E.To.masa) + ' g');
  set('sim-tm-gs', _exF(E.Ts.masa) + ' g');
  set('sim-tm-c0', _simM(cm(E.mo)));
  set('sim-tm-cs', _simM(cm(E.ms)));
  set('sim-tm-dc', _simDelta(cm(E.ms) - cm(E.mo), _simM));
  set('sim-resumen-body', _simResumenFilas(E));
  set('sim-cambios', _simCambiosHTML(E));
}

function simImprimir() {
  const E = _simEscenarios();
  if (!E) { pmToast('Elegí un producto y una cantidad', 'err'); return; }
  const w = window.open('', '_blank', 'width=1000,height=1000');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Simulación — ${pmEsc(_simCtx.item.nombre)}</title>
    <style>
      @page{size:letter landscape;margin:1cm}
      body{margin:0;padding:14px;background:#fff;font-family:Arial,Helvetica,sans-serif}
      .tb{margin-bottom:12px}.tb button{font-size:12px;padding:6px 14px;cursor:pointer}
      .sim-hoja{border-radius:0;max-width:none;padding:0}
      .sim-scroll .sim-t{min-width:0}
      @media print{.tb{display:none}body{padding:0}.sim-t tr{page-break-inside:avoid}}
      ${_SIM_CSS}
    </style></head><body>
    <div class="tb"><button onclick="window.print()">🖨 Imprimir / guardar PDF</button></div>
    ${_simHojaHTML(E, 'imprimir')}
  </body></html>`);
  w.document.close();
  w.focus();
}
