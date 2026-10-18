// ═══════════════════════════════════════════════════════════════
// simulador.js — "🔬 Simulador de receta" (prefijo sim*)
//
// Se elige un pan o galleta del maestro de tipos de pan/galleta y un gramaje
// (g por unidad × unidades). La receta se explota en todos los niveles
// (subrecetas, masa madre, rellenos) con su % panadero y su costo. Sobre ella
// se arman hasta DOS escenarios simulados (A y B) que se comparan contra el
// original:
//   · cambiar el % panadero de cualquier ingrediente
//   · cambiar un ingrediente por otro del maestro (⇄)
//   · agregar un ingrediente del maestro (➕)
//   · fijar una meta de hidratación y que ajuste el agua
// y en todo momento se ve (barra fija arriba) el costo total, el costo por
// gramo, el margen y la hidratación de cada escenario.
//
// Es SOLO un simulador: no escribe en Supabase ni en la receta. Si la
// simulación convence, el cambio real se hace en Costeo.
//
// Reutiliza de explosion.js (debe cargarse antes): _exItems, _exRecPorCodigo,
// _exPesoDefecto, _exMasaBase, _exLimpiar, _exAguaDe, exHojas, _exF,
// EX_HARINA_RE y EX_INOCULO_RE — así la hidratación y la masa madre se
// calculan igual que en el reporte de Explosión.
//
// Costos: cada ingrediente lleva su costo por gramo y el factor de merma de
// las recetas que lo contienen (igual que pmCostoReceta), de modo que la suma
// del costo explotado coincide con el costo de la receta en Costeo.
// Margen: igual que Costeo/Maestros — costo real = materiales × (1 + (MOD% +
// GG%)/100), margen = (precio − costo real) ÷ precio.
// Los % panadero se calculan sobre la harina total ORIGINAL (= 100 %).
// ═══════════════════════════════════════════════════════════════

let _simSel = '';          // clave del producto ('P:id' | 'G:id')
let _simPeso = null;       // g por unidad escritos a mano (null = el del maestro)
let _simUds = 1;           // unidades
function _simEscNuevo() { return { ratios: {}, swaps: {}, adds: [] }; }
let _simEsc = { A: _simEscNuevo(), B: _simEscNuevo() };  // cambios de cada escenario
let _simUsaB = false;      // ¿está activo el escenario B?
let _simPrecio = null;     // precio de venta por unidad (null = el del maestro)
let _simMod = null;        // MOD % (null = el de la receta)
let _simGG = null;         // GG %  (null = el de la receta)
let _simCtx = null;        // receta explotada (se rehace al cambiar producto/gramaje)
let _simIndex = {};        // id → nodo original
let _simSeqAdd = 0;        // contador de ingredientes agregados
let _simEstiloOk = false;
let _simModal = null;      // { modo:'cambio'|'agregar', k, id }

function _simKeys() { return _simUsaB ? ['A', 'B'] : ['A']; }

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

// ── Cálculo de un escenario ────────────────────────────────────
// Se editan los ingredientes y la masa madre (como bloque); la harina y el
// agua que salen de abrir la masa madre se escalan con ella.
function _simEditable(nd) { return (nd.tipo === 'ing' && nd.via !== 'ino') || nd.tipo === 'ino'; }
function _simDerivado(nd) { return nd.tipo === 'ing' && nd.via === 'ino'; }

// Árbol con las cantidades de un escenario: esc = { ratios, swaps, adds }.
// Un ingrediente cambiado conserva su cantidad y toma el nombre y precio del
// nuevo (la hidratación se recalcula con el nombre nuevo).
function simMat(nodos, esc) {
  return nodos.map(nd => {
    if (nd.tipo === 'ing' && nd.via === 'ino') {
      return Object.assign({}, nd, { c: 0 });
    }
    if (nd.tipo === 'ing' || nd.tipo === 'ino') {
      const ra = esc.ratios[nd.id] !== undefined ? esc.ratios[nd.id] : 1;
      const g = nd.g * ra;
      const sw = esc.swaps[nd.id];
      if (sw) {
        return Object.assign({}, nd, {
          tipo: 'ing', n: sw.nombre, nOrig: nd.n, swap: true, hijos: undefined,
          g, cpg: sw.cpg, c: g * sw.cpg * (nd.f || 1)
        });
      }
      if (nd.tipo === 'ino') {
        const hijos = nd.hijos.map(h => Object.assign({}, h, { g: h.g * ra, c: 0 }));
        return Object.assign({}, nd, { g, hijos, c: g * (nd.cpg || 0) * (nd.f || 1) });
      }
      return Object.assign({}, nd, { g, c: g * (nd.cpg || 0) * (nd.f || 1) });
    }
    const hijos = simMat(nd.hijos || [], esc);
    return Object.assign({}, nd, {
      hijos,
      g: hijos.reduce((a, h) => a + h.g, 0),
      c: hijos.reduce((a, h) => a + h.c, 0)
    });
  });
}

// Ingredientes agregados de un escenario, como nodos de la masa. Su cantidad
// es % panadero × harina total original; llevan la merma de la receta.
function _simAddNodos(esc, Ho, ctx) {
  const f = 1 + ctx.merma / 100;
  return esc.adds.map(a => {
    const g = Ho > 0 ? a.pct / 100 * Ho : a.pct;
    return { id: a.id, tipo: 'ing', n: a.nombre, g, cpg: a.cpg, f, c: g * a.cpg * f, added: true };
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

// Precio de venta del maestro para el producto elegido (0 si no tiene).
function _simPrecioMaestro(item) {
  const lst = item.tipo === 'galleta' ? (G.tiposGalleta || []) : (G.tiposPan || []);
  const p = lst.find(x => x.id === item.cod);
  return p && p.precio > 0 ? p.precio : 0;
}
function _simPrecioEf() { return _simPrecio !== null ? _simPrecio : (_simCtx ? _simPrecioMaestro(_simCtx.item) : 0); }
function _simModEf() { return _simMod !== null ? _simMod : (_simCtx && _simCtx.r.modPct !== undefined ? _simCtx.r.modPct : 80); }
function _simGGEf() { return _simGG !== null ? _simGG : (_simCtx && _simCtx.r.ggPct !== undefined ? _simCtx.r.ggPct : 45); }

// Costo real por unidad y margen de un escenario (mismo criterio que Costeo).
function simFin(T) {
  const uds = _simCtx.unidades;
  const matUd = T.costo / uds;
  const realUd = matUd * (1 + (_simModEf() + _simGGEf()) / 100);
  const precio = _simPrecioEf();
  return {
    matUd, realUd, precio,
    margen: precio > 0 ? precio - realUd : null,
    margenPct: precio > 0 ? (precio - realUd) / precio * 100 : null
  };
}

// Todo el cálculo: original + cada escenario activo.
function _simEscenarios() {
  if (!_simCtx) return null;
  const mo = simMat(_simCtx.arbol, _simEscNuevo());
  const To = simTotales(mo, _simCtx);
  const Ho = To.hid.H;
  const E = { mo, To, Ho, fin0: simFin(To), esc: {} };
  _simKeys().forEach(k => {
    const e = _simEsc[k];
    const m = simMat(_simCtx.arbol, e);
    const adds = _simAddNodos(e, Ho, _simCtx);
    const T = simTotales(m.concat(adds), _simCtx);
    E.esc[k] = { m, adds, T, fin: simFin(T) };
  });
  return E;
}

// Recorre el árbol original y el de cada escenario en paralelo.
// sl[k] = lista de nodos del escenario k en este nivel (o undefined).
function _simParesK(os, sl, keys, nivel, out) {
  os.forEach((o, i) => {
    const s = {};
    keys.forEach(k => { s[k] = sl[k] ? sl[k][i] : undefined; });
    out.push({ o, s, nivel });
    if (o.hijos) {
      const sub = {};
      keys.forEach(k => { sub[k] = (s[k] && s[k].hijos) ? s[k].hijos : undefined; });
      _simParesK(o.hijos, sub, keys, nivel + 1, out);
    }
  });
  return out;
}

function _simSeccion(E, addon) {
  const keys = _simKeys();
  const f = nd => (nd.tipo === 'addon') === addon;
  const sl = {};
  keys.forEach(k => { sl[k] = E.esc[k].m.filter(f); });
  return _simParesK(E.mo.filter(f), sl, keys, 0, []);
}

// ── Formatos ───────────────────────────────────────────────────
function _simM(x) {
  const d = Math.abs(x) >= 100 ? 0 : 2;
  return '₡' + Number(x).toLocaleString('es-CR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function _simMg(x) { return '₡' + Number(x).toLocaleString('es-CR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
function _simPct(x) { return x === null || x === undefined ? '—' : _exF(x) + ' %'; }

// Diferencia con signo. modo: 'costo' (subir es malo), 'bien' (subir es bueno), 'neu'.
function _simDelta(d, fmt, modo) {
  if (Math.abs(d) < 1e-9) return '<span class="sim-ig">—</span>';
  const cls = modo === 'neu' ? 'sim-ne' : (modo === 'bien' ? (d > 0 ? 'sim-dn' : 'sim-up') : (d > 0 ? 'sim-up' : 'sim-dn'));
  return `<span class="${cls}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
}

// ── Hoja: tabla de ingredientes ────────────────────────────────
function _simCeldaOrig(o, Ho) {
  const der = _simDerivado(o);
  const sinPrecio = o.tipo === 'ing' && !der && o.g > 0 && !(o.cpg > 0);
  return {
    g0: _exF(o.g) + ' g',
    p0: Ho > 0 ? _exF(o.g / Ho * 100) + ' %' : '—',
    c0: der ? '—' : _simM(o.c) + (sinPrecio ? ' ⚠' : '')
  };
}

function _simCeldaEsc(o, s, Ho) {
  if (!s) return { gs: '—', ps: '—', cs: '—' };
  const der = _simDerivado(o);
  const sinPrecio = s.tipo === 'ing' && !der && s.g > 0 && !(s.cpg > 0);
  return {
    gs: _exF(s.g) + ' g',
    ps: Ho > 0 ? _exF(s.g / Ho * 100) + ' %' : '—',
    cs: der ? '—' : _simM(s.c) + (sinPrecio ? ' ⚠' : '')
  };
}

function _simCambiado(o, s) {
  return !!s && (Math.abs(s.g - o.g) > 1e-9 || Math.abs(s.c - o.c) > 1e-9 || !!s.swap);
}

// Celda "% pan." editable de un escenario (con ⇄ para cambiar el ingrediente).
function _simCeldaInput(k, o, s, Ho, modo) {
  const id = o.id;
  const ce = _simCeldaEsc(o, s, Ho);
  const swTxt = s && s.swap ? `<div class="sim-sw">⇄ ${pmEsc(s.n)}</div>` : '';
  if (!s) return `<span>—</span>`;
  if (!(_simEditable(o) && o.g > 0) || modo !== 'pantalla') return `<span id="sim-ps-${k}-${id}">${ce.ps}</span>${swTxt}`;
  const pctMode = Ho > 0;
  const val = pctMode ? Math.round(s.g / Ho * 10000) / 100 : Math.round(s.g * 10) / 10;
  const ph = pctMode ? Math.round(o.g / Ho * 10000) / 100 : Math.round(o.g * 10) / 10;
  const hay = _simEsc[k].swaps[id];
  return `<span class="sim-ed"><input type="number" inputmode="decimal" min="0" step="any" class="sim-in" id="sim-in-${k}-${id}" value="${val}" placeholder="${ph}" oninput="simEditar('${k}','${id}',this.value)"><span class="sim-u">${pctMode ? '%' : 'g'}</span>` +
    `<button class="sim-b" title="Cambiar por otro ingrediente" onclick="simAbrirCambio('${k}','${id}')">⇄</button>` +
    (hay ? `<button class="sim-b" title="Volver al ingrediente original" onclick="simQuitarCambio('${k}','${id}')">↺</button>` : '') +
    `</span>${swTxt}`;
}

function _simFilaHTML(par, modo, Ho, keys) {
  const { o, s, nivel } = par;
  const pad = ` style="padding-left:${7 + nivel * 16}px"`;
  const der = _simDerivado(o);
  const cls = der ? 'der' : (o.tipo === 'sub' || o.tipo === 'addon' ? 'grp' : '');
  const co = _simCeldaOrig(o, Ho);
  const id = o.id;
  let nombre = pmEsc(o.n);
  if (o.tipo === 'ino') nombre += ` <span class="sim-mu">· masa madre, hidratación ${_exF(o.hid)} %${o.supuesto ? ' (supuesto)' : ''}</span>`;
  else if (o.tipo === 'sub' || o.tipo === 'addon') nombre += ` <span class="sim-mu">· ${pmEsc(o.rec || '')}</span>`;
  else if (der) nombre += ' <span class="sim-mu">(de la masa madre)</span>';
  const chg = keys.filter(k => _simCambiado(o, s[k])).map(k => ' chg' + k).join('');
  let h = `<tr id="sim-r-${id}" class="${cls}${chg}"><td${pad}>${nombre}</td>`;
  h += `<td class="n" id="sim-g0-${id}">${co.g0}</td><td class="n" id="sim-p0-${id}">${co.p0}</td><td class="n" id="sim-c0-${id}">${co.c0}</td>`;
  keys.forEach(k => {
    const ce = _simCeldaEsc(o, s[k], Ho);
    h += `<td class="n sim-s${k}">${_simCeldaInput(k, o, s[k], Ho, modo)}</td><td class="n sim-s${k}" id="sim-gs-${k}-${id}">${ce.gs}</td><td class="n sim-s${k}" id="sim-cs-${k}-${id}">${ce.cs}</td>`;
  });
  return h + '</tr>';
}

function _simFilaAgregada(k, a, E, modo, keys) {
  const Ho = E.Ho;
  const g = Ho > 0 ? a.pct / 100 * Ho : a.pct;
  const c = g * a.cpg * (1 + _simCtx.merma / 100);
  let h = `<tr id="sim-add-${a.id}"><td>➕ ${pmEsc(a.nombre)} <span class="sim-mu">· agregado en el escenario ${k}</span></td>`;
  h += `<td class="n">—</td><td class="n">—</td><td class="n">—</td>`;
  keys.forEach(kk => {
    if (kk !== k) { h += `<td class="n sim-s${kk}">—</td><td class="n sim-s${kk}">—</td><td class="n sim-s${kk}">—</td>`; return; }
    const ctl = modo === 'pantalla'
      ? `<span class="sim-ed"><input type="number" inputmode="decimal" min="0" step="any" class="sim-in" id="sim-in-${k}-${a.id}" value="${a.pct}" oninput="simEditar('${k}','${a.id}',this.value)"><span class="sim-u">%</span><button class="sim-b" title="Quitar este ingrediente" onclick="simQuitarAdd('${k}','${a.id}')">✕</button></span>`
      : `<span>${_exF(a.pct)} %</span>`;
    const sinP = !(a.cpg > 0) ? ' ⚠' : '';
    h += `<td class="n sim-s${k}">${ctl}</td><td class="n sim-s${k}" id="sim-gs-${k}-${a.id}">${_exF(g)} g</td><td class="n sim-s${k}" id="sim-cs-${k}-${a.id}">${_simM(c)}${sinP}</td>`;
  });
  return h + '</tr>';
}

function _simTotalFila(E, keys) {
  const cm = a => a.filter(nd => nd.tipo !== 'addon').reduce((x, n) => x + n.c, 0);
  let h = `<tr class="tot"><td>Total masa a mezclar</td><td class="n" id="sim-tm-g0">${_exF(E.To.masa)} g</td><td class="n"></td><td class="n" id="sim-tm-c0">${_simM(cm(E.mo))}</td>`;
  keys.forEach(k => {
    const e = E.esc[k];
    const masa = e.T.masa;
    h += `<td class="n sim-s${k}"></td><td class="n sim-s${k}" id="sim-tm-gs-${k}">${_exF(masa)} g</td><td class="n sim-s${k}" id="sim-tm-cs-${k}">${_simM(cm(e.m) + e.adds.reduce((x, n) => x + n.c, 0))}</td>`;
  });
  return h + '</tr>';
}

function _simTablaHTML(E, modo) {
  const keys = _simKeys();
  const Ho = E.Ho;
  let h = `<div class="sim-scroll"><table class="sim-t"><thead><tr><th rowspan="2">Ingrediente</th><th colspan="3" class="n">Original</th>`;
  keys.forEach(k => { h += `<th colspan="3" class="n sim-s${k}">Escenario ${k}</th>`; });
  h += `</tr><tr><th class="n">Gramos</th><th class="n">% pan.</th><th class="n">Costo</th>`;
  keys.forEach(k => { h += `<th class="n sim-s${k}">% pan.${modo === 'pantalla' ? ' ✎' : ''}</th><th class="n sim-s${k}">Gramos</th><th class="n sim-s${k}">Costo</th>`; });
  h += `</tr></thead><tbody>`;
  _simSeccion(E, false).forEach(par => { h += _simFilaHTML(par, modo, Ho, keys); });
  const adds = [];
  keys.forEach(k => E.esc[k].adds.forEach(a => adds.push([k, a])));
  if (adds.length) {
    h += `<tr class="grp"><td colspan="${4 + keys.length * 3}">Ingredientes agregados (simulados)</td></tr>`;
    adds.forEach(([k, a]) => { h += _simFilaAgregada(k, a, E, modo, keys); });
  }
  h += _simTotalFila(E, keys);
  const addons = _simSeccion(E, true);
  if (addons.length) {
    h += `<tr class="grp"><td colspan="${4 + keys.length * 3}">Rellenos y coberturas</td></tr>`;
    addons.forEach(par => { h += _simFilaHTML(par, modo, Ho, keys); });
  }
  return h + `</tbody></table></div>`;
}

// ── Hoja: resumen comparativo ──────────────────────────────────
// Cada fila: valor del original y, por escenario, valor + diferencia.
function _simResumenFilas(E) {
  const keys = _simKeys();
  const g1 = x => _exF(x) + ' g';
  const pp = x => _exF(x) + ' pp';
  const ap = E.To.aplica;
  const fila = (etq, get, fmt, dfmt, modo, extra) => {
    const a = get(E.To, E.fin0);
    let h = `<tr${extra ? ' class="' + extra + '"' : ''}><td>${etq}</td><td class="n">${a === null || a === undefined ? '—' : fmt(a)}</td>`;
    keys.forEach(k => {
      const b = get(E.esc[k].T, E.esc[k].fin);
      const d = (a === null || a === undefined || b === null || b === undefined) ? null : b - a;
      h += `<td class="n sim-s${k}">${b === null || b === undefined ? '—' : fmt(b)}${d === null ? '' : ' <small>' + _simDelta(d, dfmt || fmt, modo) + '</small>'}</td>`;
    });
    return h + '</tr>';
  };
  let h = '';
  h += fila('Costo total de materiales (con merma)', (T) => T.costo, _simM, null, 'costo', 'dest');
  h += fila('Costo por gramo', (T) => T.cpg, _simMg, null, 'costo', 'dest');
  h += fila('Costo de materiales por unidad', (T, F) => F.matUd, _simM, null, 'costo');
  h += fila('Costo real por unidad (con MOD y GG)', (T, F) => F.realUd, _simM, null, 'costo');
  h += fila('Precio de venta por unidad', (T, F) => F.precio > 0 ? F.precio : null, _simM, null, 'neu');
  h += fila('Margen por unidad', (T, F) => F.margen, _simM, null, 'bien', 'dest');
  h += fila('Margen %', (T, F) => F.margenPct, _simPct, pp, 'bien', 'dest');
  h += fila('Hidratación real', (T) => ap ? T.hid.real : null, _simPct, pp, 'neu', 'dest');
  h += fila('Solo agua (clásica)', (T) => ap ? T.hid.soloAgua : null, _simPct, pp, 'neu');
  h += fila('Harina total', (T) => T.hid.H, g1, null, 'neu');
  h += fila('Agua total', (T) => ap ? T.hid.Aagua + T.hid.Aaporte : null, g1, null, 'neu');
  h += fila('Masa a mezclar', (T) => T.masa, g1, null, 'neu');
  h += fila('Masa vendida' + (E.To.add > 0 ? ' + rellenos' : ''), (T) => T.vendida, g1, null, 'neu');
  return h;
}

function _simResumenHead(keys) {
  return `<tr><th></th><th class="n">Original</th>${keys.map(k => `<th class="n sim-s${k}">Escenario ${k}</th>`).join('')}</tr>`;
}

// Cambios de cada escenario, en palabras.
function _simCambiosHTML(E) {
  const keys = _simKeys();
  const Ho = E.Ho;
  const sec = [];
  keys.forEach(k => {
    const items = [];
    _simSeccion(E, false).concat(_simSeccion(E, true)).forEach(({ o, s }) => {
      const x = s[k];
      if (!x || !_simEditable(o)) return;
      if (x.swap) {
        items.push(`<li><b>${pmEsc(o.n)}</b> → <b>${pmEsc(x.n)}</b>: ${Ho > 0 ? _exF(o.g / Ho * 100) + ' % → ' + _exF(x.g / Ho * 100) + ' % · ' : ''}${_exF(x.g)} g · costo ${_simM(o.c)} → ${_simM(x.c)}</li>`);
      } else if (Math.abs(x.g - o.g) > 1e-9) {
        const pc = Ho > 0 ? `${_exF(o.g / Ho * 100)} % → <b>${_exF(x.g / Ho * 100)} %</b> · ` : '';
        items.push(`<li>${pmEsc(o.n)}: ${pc}${_exF(o.g)} g → ${_exF(x.g)} g (${x.g > o.g ? '+' : '−'}${_exF(Math.abs(x.g - o.g))} g)</li>`);
      }
    });
    E.esc[k].adds.forEach(a => {
      items.push(`<li>➕ <b>${pmEsc(a.n)}</b>: ${Ho > 0 ? _exF(a.g / Ho * 100) + ' % · ' : ''}${_exF(a.g)} g · costo ${_simM(a.c)}</li>`);
    });
    sec.push(items.length
      ? `<div class="sim-camb sim-s${k}"><b>Escenario ${k}</b><ul class="sim-notas">${items.join('')}</ul></div>`
      : `<div class="sim-camb sim-s${k}"><b>Escenario ${k}</b> <span class="sim-mu">sin cambios todavía</span></div>`);
  });
  return `<h3>Cambios simulados</h3>${sec.join('')}`;
}

function _simNotasHTML(E) {
  const notas = [];
  const sinPrecio = [];
  const ver = (nd) => { if (nd.tipo === 'ing' && !_simDerivado(nd) && nd.g > 0 && !(nd.cpg > 0)) sinPrecio.push(pmEsc(nd.n)); };
  const rec = (ns) => ns.forEach(nd => { ver(nd); if (nd.hijos) rec(nd.hijos); });
  rec(E.mo);
  _simKeys().forEach(k => { rec(E.esc[k].m); E.esc[k].adds.forEach(ver); });
  const uniq = [...new Set(sinPrecio)];
  if (uniq.length) notas.push(`<b>⚠ Sin precio en el maestro de ingredientes:</b> ${uniq.join(', ')}. Cuentan como ₡0, así que el costo está subestimado.`);
  if (E.To.aplica) {
    notas.push('Hidratación real = agua total ÷ harina total; cuenta el agua, la de la masa madre y la que aportan leche, huevo y otros líquidos. Solo agua = la cifra clásica, sin leche ni huevo.');
  } else if (_simCtx.item.tipo === 'galleta') {
    notas.push('La hidratación no aplica a las galletas.');
  }
  if (E.Ho > 0) notas.push('Los % panadero se calculan sobre la harina total de la receta original (= 100 %). Si cambias el % de una harina, la harina total del escenario deja de ser 100 %; la hidratación sí usa la harina real de cada escenario.');
  notas.push(`Costo real = materiales × (1 + (MOD ${_exF(_simModEf())} % + GG ${_exF(_simGGEf())} %) ÷ 100), igual que Costeo. Margen = (precio − costo real) ÷ precio. Costo por gramo = costo de materiales ÷ (masa vendida + rellenos).`);
  _simCtx.arbol.forEach(function r2(nd) {
    if (nd.tipo === 'ino' && nd.supuesto) notas.push(`<b>Supuesto:</b> «${pmEsc(nd.n)}» no trae número en el nombre; se supuso 100 % de hidratación.`);
    (nd.hijos || []).forEach(r2);
  });
  return `<ul class="sim-notas">${notas.map(n => `<li>${n}</li>`).join('')}</ul>`;
}

function _simHojaHTML(E, modo) {
  const { r, item } = _simCtx;
  const keys = _simKeys();
  const hoy = new Date().toLocaleDateString('es-CR', { day: '2-digit', month: 'long', year: 'numeric' });
  const un = _simCtx.unidades % 1 === 0 ? String(_simCtx.unidades) : _exF(_simCtx.unidades);
  return `
  <div class="sim-hoja">
    <h1>SIMULADOR DE RECETA</h1>
    <div class="sim-sub">${pmEsc(item.nombre)} · ${_exF(_simCtx.gramos)} g de masa · original vs. ${keys.length > 1 ? 'escenarios A y B' : 'escenario A'}</div>
    <div class="sim-meta">
      <div><div class="sim-k">Código de producto</div><div>${pmEsc(item.cod)}</div></div>
      <div><div class="sim-k">Receta ligada</div><div>${pmEsc(r.code)} · ${pmEsc(r.name)}</div></div>
      <div><div class="sim-k">Peso unitario</div><div>${_exF(_simCtx.pesoU)} g</div></div>
      <div><div class="sim-k">Unidades</div><div>${un}</div></div>
      <div><div class="sim-k">MOD / GG</div><div>${_exF(_simModEf())} % / ${_exF(_simGGEf())} %</div></div>
    </div>
    <h3>RESUMEN</h3>
    <div class="sim-scroll"><table class="sim-t sim-res"><thead>${_simResumenHead(keys)}</thead>
      <tbody id="sim-resumen-body">${_simResumenFilas(E)}</tbody></table></div>
    <div id="sim-cambios">${_simCambiosHTML(E)}</div>
    <h3>EXPLOSIÓN POR NIVELES</h3>
    ${_simTablaHTML(E, modo)}
    ${_simNotasHTML(E)}
    <div class="sim-pie">Simulación: no modifica la receta ni el costeo · Victor's Bakery &amp; Sweets · PanMaestro · ${hoy}</div>
  </div>`;
}

// ── Barra fija: lo esencial siempre a la vista ─────────────────
function _simBarraHTML(E) {
  const keys = _simKeys();
  const chip = (nombre, cls, T, F) => {
    const ap = E.To.aplica;
    return `<div class="sim-chip ${cls}"><div class="sim-chip-t">${nombre}</div>` +
      `<div><b>${_simM(T.costo)}</b> <span class="sim-mu">costo total</span></div>` +
      `<div><b>${_simMg(T.cpg)}</b> <span class="sim-mu">por gramo</span></div>` +
      `<div><b>${F.margenPct === null ? '—' : _exF(F.margenPct) + ' %'}</b> <span class="sim-mu">margen</span></div>` +
      `<div><b>${ap && T.hid.real !== null ? _exF(T.hid.real) + ' %' : '—'}</b> <span class="sim-mu">hidrat.</span></div></div>`;
  };
  let h = chip('Original', 'sim-co', E.To, E.fin0);
  keys.forEach(k => { h += chip('Escenario ' + k, 'sim-s' + k, E.esc[k].T, E.esc[k].fin); });
  return h;
}

const _SIM_CSS = `
.sim-hoja{background:#faf6ec;color:#161616;font-family:Arial,Helvetica,sans-serif;padding:22px 26px;border-radius:6px;max-width:1180px;margin:0 auto}
.sim-hoja h1{text-align:center;font-size:26px;line-height:1.05;margin:0 0 6px;font-weight:900;letter-spacing:.3px}
.sim-sub{text-align:center;font-size:13px;border-top:2px solid #161616;border-bottom:2px solid #161616;padding:7px 0;margin-bottom:12px}
.sim-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;font-size:13px;padding-bottom:10px;border-bottom:1px solid #161616}
.sim-k{font-size:11px;color:#555}
.sim-hoja h3{font-size:15px;margin:16px 0 4px;font-weight:900}
.sim-scroll{overflow-x:auto}
.sim-t{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0}
.sim-scroll .sim-t{min-width:760px}
.sim-t th,.sim-t td{border:1.5px solid #161616;padding:3px 7px;text-align:left}
.sim-t th{background:#ece4d0}
.sim-t td.n,.sim-t th.n{text-align:right;white-space:nowrap}
.sim-t td.sim-sA{background:#e8f0e2}
.sim-t th.sim-sA{background:#d5e4cb}
.sim-t td.sim-sB{background:#e3ecf6}
.sim-t th.sim-sB{background:#cbdcee}
.sim-t tr.grp td{font-weight:700;background:#f3ecd9}
.sim-t tr.der td{color:#666;font-size:11.5px}
.sim-t tr.tot td{font-weight:700}
.sim-t tr.dest td{font-weight:700}
.sim-t tr.chgA td:first-child{box-shadow:inset 4px 0 0 #3f8a3a}
.sim-t tr.chgB td:first-child{box-shadow:inset 4px 0 0 #2f6db0}
.sim-t tr.chgA.chgB td:first-child{box-shadow:inset 4px 0 0 #3f8a3a,inset 8px 0 0 #2f6db0}
.sim-res{max-width:760px}
.sim-res small{font-size:11px;font-weight:400}
.sim-mu{color:#666;font-weight:400}
.sim-ig{color:#999}
.sim-up{color:#a32020;font-weight:700}
.sim-dn{color:#1d6b2e;font-weight:700}
.sim-ne{color:#555;font-weight:700}
.sim-ed{display:inline-flex;align-items:center;gap:2px}
.sim-u{margin-left:2px;color:#555;font-size:12px}
.sim-in{width:70px;text-align:right;padding:3px 5px;font-size:12.5px;border:1.5px solid #161616;border-radius:3px;background:#fff;color:#161616}
.sim-b{border:1px solid #888;background:#fff;color:#161616;border-radius:3px;padding:1px 5px;font-size:12px;cursor:pointer;margin-left:3px}
.sim-b:hover{background:#ece4d0}
.sim-sw{font-size:11px;color:#444;white-space:normal;text-align:right;margin-top:1px}
.sim-camb{border-radius:4px;padding:4px 10px;margin:4px 0;font-size:12.5px}
.sim-camb.sim-sA{background:#e8f0e2}.sim-camb.sim-sB{background:#e3ecf6}
.sim-notas{margin:6px 0 0;padding-left:18px;font-size:11.5px;line-height:1.45}
.sim-pie{text-align:center;font-size:10.5px;color:#555;margin-top:12px}
.sim-barra{position:sticky;top:0;z-index:20;display:flex;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #CBD5E1;border-radius:8px;padding:8px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,.10)}
.sim-chip{flex:1 1 150px;border-radius:6px;padding:5px 9px;font-size:12.5px;line-height:1.35;color:#161616;border:1.5px solid #161616}
.sim-chip-t{font-weight:900;font-size:12px;margin-bottom:2px}
.sim-chip.sim-co{background:#faf6ec}.sim-chip.sim-sA{background:#e8f0e2}.sim-chip.sim-sB{background:#e3ecf6}
.sim-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;align-items:center;justify-content:center;padding:16px}
.sim-mbox{background:#fff;color:#161616;border-radius:10px;padding:16px;width:100%;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.3)}
.sim-mbox input{width:100%;box-sizing:border-box}
.sim-mt{font-weight:900;font-size:15px;margin-bottom:4px}
.sim-mb{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
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

// ── Maestro de ingredientes (para cambiar / agregar) ───────────
function _simListaIng() {
  const lista = _sbIngLista() || {};
  return Object.keys(lista).map(nombre => {
    const v = lista[nombre] || {};
    const cpg = v.price && v.qty ? v.price / v.qty : 0;
    return { nombre, cpg };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function _simAsegurarModal() {
  if (document.getElementById('sim-modal')) return;
  const d = document.createElement('div');
  d.id = 'sim-modal';
  d.className = 'sim-modal';
  d.style.display = 'none';
  d.innerHTML = `<div class="sim-mbox">
    <div class="sim-mt" id="sim-m-titulo"></div>
    <div class="sim-mu" id="sim-m-info" style="margin-bottom:8px;font-size:12.5px"></div>
    <label>Ingrediente del maestro (escribí para buscar)</label>
    <input id="sim-m-ing" list="sim-dl" autocomplete="off" oninput="simModalPrecio()">
    <datalist id="sim-dl"></datalist>
    <div class="sim-mu" id="sim-m-precio" style="margin:4px 0 8px;font-size:12.5px"></div>
    <div id="sim-m-pctw"><label>% panadero (sobre la harina total original)</label>
      <input id="sim-m-pct" type="number" inputmode="decimal" min="0" step="any"></div>
    <div class="sim-mb"><button class="btn btn-out btn-sm" onclick="simModalCerrar()">Cancelar</button>
      <button class="btn btn-gold btn-sm" onclick="simModalOk()">Aplicar</button></div>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) simModalCerrar(); });
  document.body.appendChild(d);
}

function _simAbrirModal(modo, k, id) {
  _simAsegurarModal();
  _simModal = { modo, k, id };
  const lista = _simListaIng();
  document.getElementById('sim-dl').innerHTML = lista.map(i => `<option value="${pmEsc(i.nombre)}"></option>`).join('');
  document.getElementById('sim-m-ing').value = '';
  document.getElementById('sim-m-precio').textContent = '';
  const pct = document.getElementById('sim-m-pct');
  pct.value = '';
  if (modo === 'cambio') {
    const o = _simIndex[id];
    document.getElementById('sim-m-titulo').textContent = '⇄ Cambiar ingrediente · escenario ' + k;
    document.getElementById('sim-m-info').textContent = `Reemplaza «${o ? o.n : ''}». Mantiene la cantidad que tiene ahora en el escenario; después puedes ajustar su %.`;
    document.getElementById('sim-m-pctw').style.display = 'none';
  } else {
    document.getElementById('sim-m-titulo').textContent = '➕ Agregar ingrediente · escenario ' + k;
    document.getElementById('sim-m-info').textContent = 'Se suma a la masa. Escribe cuánto lleva en % panadero (sobre la harina total original).';
    document.getElementById('sim-m-pctw').style.display = '';
  }
  document.getElementById('sim-modal').style.display = 'flex';
  setTimeout(() => { const el = document.getElementById('sim-m-ing'); if (el) el.focus(); }, 50);
}

function simAbrirCambio(k, id) { _simAbrirModal('cambio', k, id); }
function simAbrirAgregar(k) { _simAbrirModal('agregar', k, null); }

function _simBuscarIng(nombre) {
  const n = String(nombre || '').trim().toLowerCase();
  return _simListaIng().find(i => i.nombre.toLowerCase() === n) || null;
}

function simModalPrecio() {
  const el = document.getElementById('sim-m-ing');
  const i = _simBuscarIng(el ? el.value : '');
  const out = document.getElementById('sim-m-precio');
  if (!out) return;
  out.textContent = i ? (i.cpg > 0 ? `Precio: ${_simM(i.cpg * 1000)} por kg` : '⚠ Este ingrediente no tiene precio en el maestro (costaría ₡0)') : '';
}

function simModalCerrar() {
  const m = document.getElementById('sim-modal');
  if (m) m.style.display = 'none';
  _simModal = null;
}

function simModalOk() {
  if (!_simModal) return;
  const i = _simBuscarIng(document.getElementById('sim-m-ing').value);
  if (!i) { pmToast('Elegí un ingrediente de la lista del maestro', 'err'); return; }
  const { modo, k, id } = _simModal;
  if (modo === 'cambio') {
    _simEsc[k].swaps[id] = { nombre: i.nombre, cpg: i.cpg };
  } else {
    const pct = parseFloat(String(document.getElementById('sim-m-pct').value).replace(',', '.'));
    if (!(pct >= 0)) { pmToast('Escribe el % panadero que lleva', 'err'); return; }
    _simEsc[k].adds.push({ id: 'a' + (++_simSeqAdd), nombre: i.nombre, cpg: i.cpg, pct });
  }
  simModalCerrar();
  simPintar();
}

function simQuitarCambio(k, id) { delete _simEsc[k].swaps[id]; simPintar(); }
function simQuitarAdd(k, id) { _simEsc[k].adds = _simEsc[k].adds.filter(a => a.id !== id); simPintar(); }

// ── Pantalla ───────────────────────────────────────────────────
async function simInit() {
  _simAsegurarEstilo();
  _simAsegurarModal();
  if (pmDB.disponible() && !_sbRecCache) { await _sbCosteoCargar(); }
  const items = _exItems();
  if (!_simSel || !items.find(i => i.key === _simSel)) {
    const primero = items.find(i => i.recCode && _exRecPorCodigo(i.recCode));
    _simSel = primero ? primero.key : '';
    _simPeso = null;
    _simReiniciarTodo();
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
    <div class="row" style="margin-top:8px">
      <div class="col sm"><label>Precio de venta (₡/unidad)</label>
        <input type="number" id="sim-precio" inputmode="decimal" min="0" step="any" value="" placeholder="maestro" oninput="simCambiarFin()" style="text-align:right">
      </div>
      <div class="col sm"><label>MOD %</label>
        <input type="number" id="sim-mod" inputmode="decimal" min="0" step="any" value="" placeholder="receta" oninput="simCambiarFin()" style="text-align:right">
      </div>
      <div class="col sm"><label>GG %</label>
        <input type="number" id="sim-gg" inputmode="decimal" min="0" step="any" value="" placeholder="receta" oninput="simCambiarFin()" style="text-align:right">
      </div>
      <div class="col sm"><label>Meta de hidratación real (%)</label>
        <input type="number" id="sim-meta" inputmode="decimal" min="0" step="any" value="" placeholder="ej. 72" style="text-align:right">
      </div>
      <div class="col" style="display:flex;align-items:flex-end;gap:6px;flex-wrap:wrap">
        <button class="btn btn-out btn-sm" onclick="simMetaHid('A')">Ajustar agua en A</button>
        <button class="btn btn-out btn-sm" id="sim-meta-b" onclick="simMetaHid('B')" style="display:${_simUsaB ? '' : 'none'}">Ajustar agua en B</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-out btn-sm" onclick="simAbrirAgregar('A')">➕ Agregar ingrediente (A)</button>
      <button class="btn btn-out btn-sm" id="sim-add-b" onclick="simAbrirAgregar('B')" style="display:${_simUsaB ? '' : 'none'}">➕ Agregar ingrediente (B)</button>
      <button class="btn btn-out btn-sm" id="sim-tog-b" onclick="simToggleB()">${_simUsaB ? '✕ Quitar escenario B' : '＋ Escenario B'}</button>
      <button class="btn btn-out btn-sm" onclick="simReset()">↺ Volver a la receta original</button>
      <button class="btn btn-gold btn-sm" onclick="simImprimir()">🖨 Imprimir / guardar PDF</button>
    </div>
    <div style="font-size:12px;color:#64748B;margin-top:8px">Es un simulador: nada se guarda. En cada ingrediente puedes cambiar su % panadero o usar ⇄ para reemplazarlo por otro del maestro; ➕ agrega uno nuevo. Si el cambio te convence, hazlo en Costeo.</div>
  </div>`;
  simPintar();
}

function _simReiniciarTodo() {
  _simEsc = { A: _simEscNuevo(), B: _simEscNuevo() };
  _simPrecio = null; _simMod = null; _simGG = null;
}

function simElegir(key) {
  _simSel = key;
  _simPeso = null;
  _simReiniciarTodo();
  ['sim-precio', 'sim-mod', 'sim-gg', 'sim-meta'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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

// Precio de venta / MOD / GG escritos a mano: solo recalcula números.
function simCambiarFin() {
  const num = id => { const el = document.getElementById(id); if (!el || el.value === '') return null; const v = parseFloat(String(el.value).replace(',', '.')); return isNaN(v) ? null : v; };
  _simPrecio = num('sim-precio');
  _simMod = num('sim-mod');
  _simGG = num('sim-gg');
  simActualizar();
}

function simToggleB() {
  _simUsaB = !_simUsaB;
  if (!_simUsaB) _simEsc.B = _simEscNuevo();
  const t = document.getElementById('sim-tog-b'); if (t) t.textContent = _simUsaB ? '✕ Quitar escenario B' : '＋ Escenario B';
  ['sim-add-b', 'sim-meta-b'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = _simUsaB ? '' : 'none'; });
  simPintar();
}

function simReset() {
  _simEsc = { A: _simEscNuevo(), B: _simEscNuevo() };
  simPintar();
}

function simPintar() {
  const out = document.getElementById('sim-out');
  if (!out) return;
  const barra = document.getElementById('sim-barra');
  const item = _exItems().find(i => i.key === _simSel);
  if (!item) { _simCtx = null; if (barra) barra.innerHTML = ''; out.innerHTML = '<div class="card">Elegí un producto con receta ligada (Maestros → Tipos de pan/galleta).</div>'; return; }
  const pesoU = _simPeso !== null ? _simPeso : _exPesoDefecto(item);
  _simCtx = simPreparar(item, pesoU, _simUds);
  if (!_simCtx) {
    _simIndex = {};
    if (barra) barra.innerHTML = '';
    out.innerHTML = '<div class="card">Indicá gramos por unidad y unidades (ambos mayores a cero). Si ya lo hiciste, revisá que la receta tenga ingredientes y masa total.</div>';
    return;
  }
  _simIndex = _simIndexar(_simCtx.arbol, {});
  const E = _simEscenarios();
  if (barra) { barra.className = 'sim-barra no-print'; barra.innerHTML = _simBarraHTML(E); }
  out.innerHTML = _simHojaHTML(E, 'pantalla');
}

// Se llama en cada tecla dentro de un ingrediente: actualiza los números sin
// repintar la tabla (así el cursor no se pierde).
function simEditar(k, id, val) {
  const e = _simEsc[k];
  if (!e) return;
  const v = parseFloat(String(val).replace(',', '.'));
  const Ho = _simEscenarios().Ho;
  const add = e.adds.find(a => a.id === id);
  if (add) {
    add.pct = isNaN(v) ? 0 : Math.max(0, v);
  } else {
    const nd = _simIndex[id];
    if (!nd) return;
    if (val === '' || isNaN(v) || !(nd.g > 0)) delete e.ratios[id];
    else e.ratios[id] = (Ho > 0 ? Math.max(0, v) / 100 * Ho : Math.max(0, v)) / nd.g;
  }
  simActualizar();
}

function simActualizar() {
  const E = _simEscenarios();
  if (!E) return;
  const keys = _simKeys();
  const Ho = E.Ho;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  _simSeccion(E, false).concat(_simSeccion(E, true)).forEach(({ o, s }) => {
    set('sim-p0-' + o.id, _simCeldaOrig(o, Ho).p0);
    keys.forEach(k => {
      const ce = _simCeldaEsc(o, s[k], Ho);
      set('sim-gs-' + k + '-' + o.id, ce.gs);
      set('sim-cs-' + k + '-' + o.id, ce.cs);
      if (!document.getElementById('sim-in-' + k + '-' + o.id)) set('sim-ps-' + k + '-' + o.id, ce.ps);
    });
    const tr = document.getElementById('sim-r-' + o.id);
    if (tr) keys.forEach(k => tr.classList.toggle('chg' + k, _simCambiado(o, s[k])));
  });
  keys.forEach(k => {
    const e = E.esc[k];
    e.adds.forEach(a => {
      set('sim-gs-' + k + '-' + a.id, _exF(a.g) + ' g');
      set('sim-cs-' + k + '-' + a.id, _simM(a.c) + (!(a.cpg > 0) ? ' ⚠' : ''));
    });
    const cm = e.m.filter(nd => nd.tipo !== 'addon').reduce((x, n) => x + n.c, 0) + e.adds.reduce((x, n) => x + n.c, 0);
    set('sim-tm-gs-' + k, _exF(e.T.masa) + ' g');
    set('sim-tm-cs-' + k, _simM(cm));
  });
  set('sim-resumen-body', _simResumenFilas(E));
  set('sim-cambios', _simCambiosHTML(E));
  set('sim-barra', _simBarraHTML(E));
}

// Meta de hidratación: calcula cuánta agua debe llevar el escenario para
// llegar a la hidratación real pedida, y la fija (la harina no cambia).
function simMetaHid(k) {
  const el = document.getElementById('sim-meta');
  const meta = el ? parseFloat(String(el.value).replace(',', '.')) : NaN;
  if (!(meta > 0)) { pmToast('Escribe la hidratación que buscas, por ejemplo 72', 'err'); return; }
  const E = _simEscenarios();
  if (!E) return;
  if (!E.To.aplica) { pmToast('La hidratación no aplica a este producto', 'err'); return; }
  const e = _simEsc[k];
  // El ingrediente "agua" que se ajusta: el primero que no esté cambiado ni sea de la masa madre
  const cand = _simSeccion(E, false).filter(({ o, s }) => {
    if (o.tipo !== 'ing' || _simDerivado(o)) return false;
    const a = _exAguaDe(o.n);
    return a && a.k === 'agua' && s[k] && !s[k].swap;
  });
  if (!cand.length) { pmToast('Esta receta no tiene un ingrediente de agua que ajustar', 'err'); return; }
  const { o, s } = cand[0];
  const T = E.esc[k].T;
  const aguaResto = T.hid.Aagua + T.hid.Aaporte - s[k].g;    // el agua que aportan los demás
  const gNuevo = meta / 100 * T.hid.H - aguaResto;
  if (gNuevo < 0) { pmToast('Esa meta es menor que el agua que ya aportan los otros ingredientes', 'err'); return; }
  e.ratios[o.id] = gNuevo / o.g;
  simPintar();
  pmToast(`Agua en ${k}: ${_exF(gNuevo)} g (${_exF(gNuevo / T.hid.H * 100)} % panadero)`);
}

function simImprimir() {
  const E = _simEscenarios();
  if (!E) { pmToast('Elegí un producto y una cantidad', 'err'); return; }
  const w = window.open('', '_blank', 'width=1100,height=1000');
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
