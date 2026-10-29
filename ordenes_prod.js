// ordenes_prod.js — Órdenes de producción · Entrega 1: generador por tanda (prefijo opg)
//
// DISEÑO: módulo independiente, igual que mps.js y mercadeo.js.
// - Lee el maestro de tipos de pan/galleta, las recetas y los costos con las
//   funciones que ya existen (explosion.js: exCalcular, _exItems, etc.) pero
//   NUNCA escribe en esas tablas.
// - Toda escritura propia va a 3 tablas con prefijo op_: op_ordenes,
//   op_documentos, op_lineas (ver sql_ordenes_produccion.sql en la raíz).
// - Usa solo métodos GENÉRICOS de pmDB (get/insert/update/hardDelete) y el
//   correlativo ya existente (_corrSiguiente, de comercial.js).
// - Estado propio (_opg*), nunca toca el objeto global G ni pmSave(): esta data
//   vive siempre en Supabase.
//
// QUÉ HACE (entrega 1):
//   1. Generador: una lista de panes a fabricar (código, fecha de inicio,
//      unidades, peso). Por cada fila calcula la masa cruda con el motor de
//      explosion.js (misma cuenta que Recetario) y muestra qué documentos va a
//      emitir.
//   2. Al generar, emite UNA orden por pan (OP-0001…) con sus documentos:
//      la orden principal y una sub-orden por cada masa madre (M), otra
//      subreceta (S), relleno (R) o cobertura (C), cada una con su receta.
//   3. Congela el estándar al emitir: cantidad, costo estándar por gramo y
//      costo de cada línea. El costo NO se imprime; solo se guarda.
//   4. Imprime todas las órdenes juntas (o una sola, o las seleccionadas), con
//      columna "Real (anotar)" y filas "Otro material usado" para anotar a mano
//      el consumo real. Cada sub-orden lleva "Cantidad real obtenida".
//   5. Lista de órdenes emitidas para consultarlas, reimprimirlas o anularlas.
// Lo que viene en entregas siguientes: hoja de ruta (etapas del módulo Costos),
// captura del consumo real en pantalla, variaciones y cierre de la orden.
//
// SEGURIDAD DE LA FÓRMULA: antes de emitir cada orden se verifica que las
// sumas cuadren (principal = masa cruda; cada sub-orden = su cantidad; todos
// los ingredientes juntos = masa + rellenos). Si algo no cuadra por más de 1 g,
// la orden NO se emite y se explica por qué.

const OPG_SUFIJO = { masa_madre: 'M', subreceta: 'S', relleno: 'R', cobertura: 'C' };
const OPG_TITULO = { principal: 'Orden principal', masa_madre: 'Masa madre', subreceta: 'Subreceta', relleno: 'Relleno', cobertura: 'Cobertura' };
const OPG_CHIP   = { principal: 'p', masa_madre: 'm', subreceta: 's', relleno: 'r', cobertura: 'c' };

let _opgFilas = [];          // filas del generador [{ cod, fecha, uds, peso }]
let _opgEmitidas = [];       // paquetes emitidos en la última tanda [{ orden, docs:[{...doc, lineas}] }]
let _opgLista = [];          // órdenes cargadas en "Órdenes emitidas"
let _opgDocsRes = {};        // orden_id -> documentos (resumen) para la lista
let _opgSel = new Set();     // ids seleccionados en la lista
let _opgTabAct = 'gen';
let _opgOcupado = false;
let _opgEstiloOk = false;

// ═══════════════════════════════════════════════════════════
// FUNCIONES PURAS (sin pantalla, fáciles de probar)
// ═══════════════════════════════════════════════════════════
function opgR2(x) { return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }
function opgF(x) { return Number(x).toLocaleString('es-CR', { maximumFractionDigits: 1 }); }
function opgSumG(ls) { return (ls || []).reduce((a, l) => a + (Number(l.cant_std_g) || 0), 0); }

function opgFechaTxt(iso) {
  const p = String(iso || '').slice(0, 10).split('-').map(Number);
  if (p.length < 3 || !p[0]) return '';
  return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function opgSumarDias(iso, n) {
  const p = String(iso).slice(0, 10).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2] + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Ingredientes finales de un árbol de nodos de explosion.js. Un inóculo ('ino',
// ingrediente de tipo masa madre) cuenta como UN ingrediente con su costo, igual
// que cualquier otro del maestro.
function opgHojas(nodos, out) {
  out = out || [];
  (nodos || []).forEach(nd => {
    if (nd.tipo === 'ing' || nd.tipo === 'ino') out.push({ n: nd.n, g: nd.g, cpg: nd.cpg || 0 });
    else opgHojas(nd.hijos || [], out);
  });
  return out;
}

// Junta el mismo ingrediente de distintos componentes (mismo criterio que el sumario de explosion.js).
function opgAgrupar(hojas) {
  const m = new Map();
  hojas.forEach(h => {
    const k = String(h.n).toLowerCase();
    const x = m.get(k) || { n: h.n, g: 0, costo: 0 };
    x.g += h.g;
    x.costo += h.g * (h.cpg || 0);
    m.set(k, x);
  });
  return [...m.values()];
}

function opgMkLinea(n, g, costo, esSub) {
  return {
    ingrediente: n,
    cant_std_g: opgR2(g),
    cpg_std: g > 0 ? Math.round(costo / g * 1e6) / 1e6 : 0,
    costo_std: Math.round(costo * 1e4) / 1e4,
    es_sub: !!esSub,
    nota: null,
    pct_panadero: null
  };
}

// % panadero de cada línea: sobre la harina directa del documento; si no tiene
// harina (relleno, cobertura), sobre el total del documento.
function opgBaseDe(lineas) {
  return (lineas || []).some(l => !l.es_sub && EX_HARINA_RE.test(l.ingrediente) && Number(l.cant_std_g) > 0) ? 'harina' : 'total';
}
function opgPcts(lineas) {
  const base = opgBaseDe(lineas);
  const harina = lineas.filter(l => !l.es_sub && EX_HARINA_RE.test(l.ingrediente)).reduce((a, l) => a + l.cant_std_g, 0);
  const den = base === 'harina' ? harina : opgSumG(lineas);
  lineas.forEach(l => { l.pct_panadero = den > 0 ? Math.round(l.cant_std_g / den * 1000) / 10 : null; });
  return base;
}

// Todos los ingredientes finales de un conjunto de documentos (las líneas que
// son sub-órdenes no cuentan: su detalle ya está en su propio documento).
function opgConsolidado(docs) {
  const m = new Map();
  (docs || []).forEach(doc => (doc.lineas || []).forEach(l => {
    if (l.es_sub) return;
    const k = String(l.ingrediente).toLowerCase();
    const x = m.get(k) || { n: l.ingrediente, g: 0 };
    x.g += Number(l.cant_std_g) || 0;
    m.set(k, x);
  }));
  return [...m.values()].sort((a, b) => b.g - a.g);
}

// d = resultado de exCalcular(). Arma la orden y sus documentos, sin guardar nada.
function opgConstruir(d) {
  const arbol = d.arbol || [];
  const masa = arbol.filter(nd => nd.tipo !== 'addon');
  const addons = arbol.filter(nd => nd.tipo === 'addon');
  const cont = {};
  const sufijoDe = tipo => {
    const b = OPG_SUFIJO[tipo];
    cont[b] = (cont[b] || 0) + 1;
    return cont[b] === 1 ? b : b + cont[b];
  };

  const subs = [], rels = [], lineasP = [];
  masa.forEach(nd => {
    if (nd.tipo === 'sub') {
      const tipo = EX_INOCULO_RE.test(nd.n + ' ' + (nd.rec || '')) ? 'masa_madre' : 'subreceta';
      const suf = sufijoDe(tipo);
      const grupos = opgAgrupar(opgHojas(nd.hijos || []));
      const costo = grupos.reduce((a, x) => a + x.costo, 0);
      const lineas = grupos.map(x => opgMkLinea(x.n, x.g, x.costo, false));
      opgPcts(lineas);
      subs.push({
        sufijo: suf, tipo, titulo: OPG_TITULO[tipo] + ' · ' + nd.n, receta: nd.rec || '',
        cantidad_g: opgR2(nd.g), costo_std: opgR2(costo), en_principal: true, lineas
      });
      const l = opgMkLinea(nd.n, nd.g, costo, true);
      l.nota = suf;                       // qué sub-orden detalla esta línea
      lineasP.push(l);
    } else {
      lineasP.push(opgMkLinea(nd.n, nd.g, nd.g * (nd.cpg || 0), false));
    }
  });
  opgPcts(lineasP);
  const costoP = lineasP.reduce((a, l) => a + l.costo_std, 0);

  addons.forEach(nd => {
    const tipo = String(nd.at || '').toLowerCase() === 'cobertura' ? 'cobertura' : 'relleno';
    const suf = sufijoDe(tipo);
    const grupos = opgAgrupar(opgHojas(nd.hijos || []));
    const costo = grupos.reduce((a, x) => a + x.costo, 0);
    const lineas = grupos.map(x => opgMkLinea(x.n, x.g, x.costo, false));
    opgPcts(lineas);
    rels.push({
      sufijo: suf, tipo, titulo: OPG_TITULO[tipo] + ' · ' + nd.n, receta: nd.rec || '',
      cantidad_g: opgR2(nd.g), costo_std: opgR2(costo), en_principal: false, lineas
    });
  });

  const principal = {
    sufijo: '', tipo: 'principal', titulo: OPG_TITULO.principal, receta: '',
    cantidad_g: opgR2(d.gMezcla), costo_std: opgR2(costoP), en_principal: false, lineas: lineasP
  };
  const docs = [principal].concat(subs, rels);
  docs.forEach((doc, k) => { doc.orden = k; });

  // ── Verificación de la fórmula: todo tiene que cuadrar ──
  const errores = [];
  const avisos = [];
  const tol = 1; // gramos
  const dif = (a, b) => Math.abs(a - b) > tol;
  if (dif(opgSumG(lineasP), d.gMezcla)) {
    errores.push('la orden principal suma ' + opgF(opgSumG(lineasP)) + ' g y la masa cruda es ' + opgF(d.gMezcla) + ' g');
  }
  subs.concat(rels).forEach(doc => {
    if (dif(opgSumG(doc.lineas), doc.cantidad_g)) {
      errores.push(doc.titulo + ' suma ' + opgF(opgSumG(doc.lineas)) + ' g y debería ser ' + opgF(doc.cantidad_g) + ' g');
    }
  });
  const consolidado = opgConsolidado(docs);
  const totalCons = consolidado.reduce((a, x) => a + x.g, 0);
  if (dif(totalCons, d.gMezcla + (d.gAddons || 0))) {
    errores.push('los ingredientes de todos los documentos suman ' + opgF(totalCons) + ' g y deberían sumar ' + opgF(d.gMezcla + (d.gAddons || 0)) + ' g (masa + rellenos)');
  }
  const sinCosto = [];
  // El agua suele costar cero en el maestro; no se avisa por ella.
  docs.forEach(doc => doc.lineas.forEach(l => {
    if (!l.es_sub && !(l.cpg_std > 0) && !/^(agua|hielo)\b/i.test(l.ingrediente) && !sinCosto.includes(l.ingrediente)) sinCosto.push(l.ingrediente);
  }));
  if (sinCosto.length) avisos.push('sin costo en el maestro de ingredientes: ' + sinCosto.join(', '));
  (d.sinNumero || []).forEach(n => avisos.push('«' + n + '» no trae hidratación en el nombre'));

  const costoTotal = opgR2(costoP + rels.reduce((a, x) => a + x.costo_std, 0));
  return {
    orden: {
      producto_cod: d.item.cod, producto_nombre: d.item.nombre,
      receta_code: d.r.code, receta_nombre: d.r.name,
      unidades: d.unidades, peso_unidad_g: d.pesoU,
      masa_cruda_g: opgR2(d.gMezcla), merma_pct: d.merma || 0,
      costo_std_total: costoTotal
    },
    docs, errores, avisos, consolidado
  };
}

// ═══════════════════════════════════════════════════════════
// CÁLCULO POR FILA DEL GENERADOR
// ═══════════════════════════════════════════════════════════
function _opgBuscar(cod) {
  const c = String(cod || '').trim().toUpperCase();
  if (!c) return null;
  return _exItems().find(i => String(i.cod).toUpperCase() === c) || null;
}

function opgCalcFila(f) {
  if (!String(f.cod || '').trim()) return { vacia: true };
  const item = _opgBuscar(f.cod);
  if (!item) return { error: 'Código no encontrado en el maestro' };
  if (!item.recCode || !_exRecPorCodigo(item.recCode)) return { item, error: 'El producto no tiene receta ligada' };
  const unidades = parseFloat(f.uds);
  const pesoDef = _exPesoDefecto(item);
  const pesoU = parseFloat(f.peso) > 0 ? parseFloat(f.peso) : pesoDef;
  if (!(unidades > 0)) return { item, pesoDef, error: 'Falta la cantidad de unidades' };
  if (!(pesoU > 0)) return { item, pesoDef, error: 'Falta el peso por unidad' };
  const d = exCalcular(item, pesoU, unidades);
  if (!d) return { item, pesoDef, error: 'No se pudo calcular: revisá la receta (masa total e ingredientes)' };
  return { item, pesoDef, pesoU, d, b: opgConstruir(d) };
}

// ═══════════════════════════════════════════════════════════
// PANTALLA — GENERADOR
// ═══════════════════════════════════════════════════════════
function _opgEstilo() {
  if (_opgEstiloOk) return;
  const st = document.createElement('style');
  st.id = 'opg-style';
  st.textContent = `
  .opg-sc{overflow-x:auto}
  .opg-t{width:100%;border-collapse:collapse;font-size:13px;min-width:900px}
  .opg-t th{text-align:left;font-size:11px;font-weight:600;color:var(--cream2);padding:6px 8px;border-bottom:1px solid var(--border2);white-space:nowrap}
  .opg-t td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
  .opg-t .n{text-align:right;white-space:nowrap}
  .opg-t input{width:100%;min-width:60px}
  .opg-err{color:var(--red);font-size:12px}
  .opg-mu{color:var(--cream2);font-size:11px}
  .opg-chip{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin:1px 3px 1px 0}
  .opg-chip.p{background:#E7E4DA;color:#1D2227}
  .opg-chip.m{background:#E3EEE9;color:#1F4A3D}
  .opg-chip.s{background:#E8EAEF;color:#2A3150}
  .opg-chip.r{background:#F6E7C8;color:#6B4306}
  .opg-chip.c{background:#E4E8F4;color:#2B3F78}
  .opg-ord{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
  .opg-ord:last-child{border-bottom:none}
  .opg-num{font-family:monospace;font-weight:700;background:#1D2227;color:#fff;padding:3px 9px;border-radius:6px;font-size:13px}
  .opg-pie{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-top:10px}
  `;
  document.head.appendChild(st);
  _opgEstiloOk = true;
}

function _opgFilaNueva() { return { cod: '', fecha: pmHoy(), uds: '', peso: '' }; }

async function opgInit() {
  _opgEstilo();
  if (!_opgFilas.length) _opgFilas = [_opgFilaNueva()];
  if (pmDB.disponible() && typeof _sbRecCache !== 'undefined' && !_sbRecCache) {
    try { await _sbCosteoCargar(); } catch (e) { console.warn('[opgInit]', e.message); }
  }
  opgTab(_opgTabAct);
}

function opgTab(t) {
  _opgTabAct = t;
  document.getElementById('opgt-gen').style.display = t === 'gen' ? '' : 'none';
  document.getElementById('opgt-lst').style.display = t === 'lst' ? '' : 'none';
  document.getElementById('opg-pill-gen').classList.toggle('on', t === 'gen');
  document.getElementById('opg-pill-lst').classList.toggle('on', t === 'lst');
  if (t === 'gen') { opgPintarLista(); opgPintarRes(); } else { opgCargarLista(); }
}

function _opgOpcionesDatalist() {
  return _exItems().map(i => {
    const ok = i.recCode && _exRecPorCodigo(i.recCode);
    return `<option value="${pmEsc(i.cod)}">${pmEsc(i.nombre)}${ok ? '' : ' (sin receta ligada)'}</option>`;
  }).join('');
}

function _opgFilaHTML(f, i) {
  return `<tr id="opg-tr-${i}">
    <td style="width:90px"><input id="opg-cod-${i}" list="opg-dl" value="${pmEsc(f.cod)}" placeholder="Código" autocomplete="off"
         oninput="opgSet(${i},'cod',this.value)" style="font-family:monospace;text-transform:uppercase"></td>
    <td id="opg-nom-${i}"></td>
    <td style="width:160px"><input type="date" value="${pmEsc(f.fecha)}" oninput="opgSet(${i},'fecha',this.value)" aria-label="Inicio de producción fila ${i + 1}"></td>
    <td style="width:100px"><input id="opg-uds-${i}" type="number" min="0" step="any" value="${pmEsc(f.uds)}" oninput="opgSet(${i},'uds',this.value)" style="text-align:right" aria-label="Unidades fila ${i + 1}"></td>
    <td style="width:110px"><input id="opg-peso-${i}" type="number" min="0" step="any" value="${pmEsc(f.peso)}" oninput="opgSet(${i},'peso',this.value)" style="text-align:right" aria-label="Peso por unidad fila ${i + 1}"></td>
    <td id="opg-mc-${i}" class="n" style="font-weight:600"></td>
    <td id="opg-docs-${i}"></td>
    <td style="width:44px;text-align:center"><button class="btn btn-out btn-sm" onclick="opgQuitar(${i})" aria-label="Quitar fila ${i + 1}" title="Quitar">×</button></td>
  </tr>`;
}

function opgPintarLista() {
  const el = document.getElementById('opg-lista');
  if (!el) return;
  el.innerHTML = `
    <div style="font-weight:700;margin-bottom:2px">1. Lista de panes a fabricar</div>
    <div class="opg-mu" style="margin-bottom:8px">Escribí el código; el nombre, la masa cruda y los documentos que se van a emitir se completan solos. El peso sale del maestro si lo dejás vacío.</div>
    <div class="opg-sc"><table class="opg-t"><thead><tr>
      <th>Código</th><th>Nombre del pan</th><th>Inicio de producción</th><th class="n">Unidades</th><th class="n">Peso (g)</th><th class="n">Masa cruda (g)</th><th>Documentos que se emitirán</th><th></th>
    </tr></thead><tbody id="opg-tbody">${_opgFilas.map(_opgFilaHTML).join('')}</tbody></table></div>
    <datalist id="opg-dl">${_opgOpcionesDatalist()}</datalist>
    <div class="opg-pie">
      <button class="btn btn-out btn-sm" onclick="opgAgregar()">+ Agregar pan</button>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span class="opg-mu" id="opg-tot"></span>
        <button class="btn btn-gold" id="opg-btn-gen" onclick="opgGenerar()">Generar órdenes</button>
      </div>
    </div>`;
  _opgFilas.forEach((f, i) => opgPintarCalc(i));
  opgPintarPie();
}

function opgAgregar() {
  _opgFilas.push(_opgFilaNueva());
  const i = _opgFilas.length - 1;
  const tb = document.getElementById('opg-tbody');
  if (tb) tb.insertAdjacentHTML('beforeend', _opgFilaHTML(_opgFilas[i], i));
  opgPintarCalc(i);
  const c = document.getElementById('opg-cod-' + i);
  if (c) c.focus();
  opgPintarPie();
}

function opgQuitar(i) {
  _opgFilas.splice(i, 1);
  if (!_opgFilas.length) _opgFilas.push(_opgFilaNueva());
  opgPintarLista();
}

function opgSet(i, campo, valor) {
  const f = _opgFilas[i];
  if (!f) return;
  f[campo] = campo === 'cod' ? String(valor).trim().toUpperCase() : valor;
  opgPintarCalc(i);
  opgPintarPie();
  // Siempre hay una fila libre al final: al llenar la última con un código, se agrega otra.
  if (campo === 'cod' && i === _opgFilas.length - 1 && _opgBuscar(f.cod)) {
    _opgFilas.push(_opgFilaNueva());
    const tb = document.getElementById('opg-tbody');
    if (tb) tb.insertAdjacentHTML('beforeend', _opgFilaHTML(_opgFilas[_opgFilas.length - 1], _opgFilas.length - 1));
    opgPintarCalc(_opgFilas.length - 1);
  }
}

function _opgChipsDocs(b, numero) {
  return b.docs.map(doc => {
    const etiqueta = doc.tipo === 'principal' ? 'Orden' : OPG_TITULO[doc.tipo];
    const num = numero ? ' ' + numero + (doc.sufijo ? '-' + doc.sufijo : '') : '';
    const cant = doc.tipo === 'principal' ? '' : ' · ' + opgF(doc.cantidad_g) + ' g';
    return `<span class="opg-chip ${OPG_CHIP[doc.tipo]}">${pmEsc(etiqueta + num + cant)}</span>`;
  }).join('');
}

// Actualiza solo las celdas calculadas de la fila (no reconstruye la tabla, para no perder el foco).
function opgPintarCalc(i) {
  const f = _opgFilas[i];
  const nom = document.getElementById('opg-nom-' + i);
  const mc = document.getElementById('opg-mc-' + i);
  const dc = document.getElementById('opg-docs-' + i);
  const peso = document.getElementById('opg-peso-' + i);
  if (!f || !nom) return;
  const c = opgCalcFila(f);
  if (peso) peso.placeholder = c.pesoDef > 0 ? String(Math.round(c.pesoDef * 10) / 10) : '';
  if (c.vacia) { nom.innerHTML = ''; mc.textContent = ''; dc.innerHTML = ''; return; }
  if (c.error) {
    nom.innerHTML = (c.item ? pmEsc(c.item.nombre) + '<br>' : '') + `<span class="opg-err">${pmEsc(c.error)}</span>`;
    mc.textContent = ''; dc.innerHTML = '';
    return;
  }
  nom.textContent = c.item.nombre;
  mc.textContent = opgF(c.d.gMezcla);
  let h = _opgChipsDocs(c.b, '');
  if (c.b.errores.length) h += `<div class="opg-err">⚠️ No cuadra: ${pmEsc(c.b.errores[0])}</div>`;
  else if (c.b.avisos.length) h += `<div class="opg-mu">ℹ️ ${pmEsc(c.b.avisos.join(' · '))}</div>`;
  dc.innerHTML = h;
}

function opgPintarPie() {
  const tot = document.getElementById('opg-tot');
  const btn = document.getElementById('opg-btn-gen');
  if (!tot || !btn) return;
  let n = 0, docs = 0, masa = 0;
  _opgFilas.forEach(f => {
    const c = opgCalcFila(f);
    if (c.d) { n++; docs += c.b.docs.length; masa += c.d.gMezcla; }
  });
  tot.textContent = n ? `${n} ${n === 1 ? 'pan' : 'panes'} · ${docs} documentos · masa cruda total ${opgF(masa)} g` : '';
  btn.textContent = n ? `Generar ${n} ${n === 1 ? 'orden' : 'órdenes'}` : 'Generar órdenes';
}

// ═══════════════════════════════════════════════════════════
// EMITIR (guardar en Supabase)
// ═══════════════════════════════════════════════════════════
async function opgEmitir(f, c) {
  const num = await _corrSiguiente('op');
  if (!num) throw new Error('no se pudo obtener el número de orden');
  const numero = 'OP-' + String(num).padStart(4, '0');
  const o = c.b.orden;
  const ins = await pmDB.insert('op_ordenes', {
    numero, producto_cod: o.producto_cod, producto_nombre: o.producto_nombre,
    receta_code: o.receta_code, receta_nombre: o.receta_nombre,
    fecha_inicio: f.fecha, unidades: o.unidades, peso_unidad_g: o.peso_unidad_g,
    masa_cruda_g: o.masa_cruda_g, merma_pct: o.merma_pct,
    estado: 'emitida', costo_std_total: o.costo_std_total
  });
  const oid = ins && ins[0] && ins[0].id;
  if (!oid) throw new Error('Supabase no devolvió la orden creada');
  try {
    const docRows = await pmDB.insert('op_documentos', c.b.docs.map(doc => ({
      orden_id: oid, sufijo: doc.sufijo, tipo: doc.tipo, titulo: doc.titulo,
      cantidad_g: doc.cantidad_g, costo_std: doc.costo_std, en_principal: doc.en_principal, orden: doc.orden
    })));
    const lineas = [];
    c.b.docs.forEach(doc => {
      const dr = (docRows || []).find(r => r.sufijo === doc.sufijo);
      if (!dr) throw new Error('no se creó el documento ' + (doc.sufijo || 'principal'));
      doc.lineas.forEach((l, j) => lineas.push({
        documento_id: dr.id, orden_id: oid, orden: j, ingrediente: l.ingrediente,
        pct_panadero: l.pct_panadero, cant_std_g: l.cant_std_g, cpg_std: l.cpg_std,
        costo_std: l.costo_std, es_sub: !!l.es_sub, nota: l.nota || null
      }));
    });
    await pmDB.insert('op_lineas', lineas, false);
  } catch (e) {
    // Una orden a medias es peor que ninguna: se deshace (los documentos y líneas caen en cascada).
    try { await pmDB.hardDelete('op_ordenes', oid); } catch (_) { /* nada más que hacer */ }
    throw e;
  }
  return {
    orden: Object.assign({ id: oid, numero, fecha_inicio: f.fecha, estado: 'emitida' }, o),
    docs: c.b.docs
  };
}

async function opgGenerar() {
  if (_opgOcupado) return;
  if (!pmDB.disponible()) { pmToast('Hace falta conexión con Supabase para emitir las órdenes', 'err'); return; }
  const trabajo = [];
  for (let i = 0; i < _opgFilas.length; i++) {
    const f = _opgFilas[i];
    const c = opgCalcFila(f);
    if (c.vacia) continue;
    if (c.error) { pmToast(`Fila ${i + 1}: ${c.error}`, 'err', 5000); return; }
    if (!f.fecha) { pmToast(`Fila ${i + 1} (${f.cod}): falta la fecha de inicio`, 'err', 5000); return; }
    if (c.b.errores.length) { pmToast(`Fila ${i + 1} (${f.cod}) no cuadra: ${c.b.errores[0]}`, 'err', 8000); return; }
    trabajo.push({ f, c });
  }
  if (!trabajo.length) { pmToast('Agregá al menos un pan a la lista', 'err'); return; }

  _opgOcupado = true;
  const btn = document.getElementById('opg-btn-gen');
  if (btn) { btn.disabled = true; btn.textContent = 'Emitiendo…'; }
  const hechos = [];
  let fallo = null;
  for (const t of trabajo) {
    try { hechos.push(await opgEmitir(t.f, t.c)); }
    catch (e) { fallo = { cod: t.f.cod, msg: e.message }; break; }
  }
  _opgOcupado = false;

  _opgEmitidas = hechos;
  // Las filas ya emitidas salen de la lista; las que faltaron se quedan para reintentar.
  _opgFilas = trabajo.slice(hechos.length).map(t => t.f);
  _opgFilas.push(_opgFilaNueva());
  opgPintarLista();
  opgPintarRes();

  if (fallo) {
    pmToast(`⚠️ Se emitieron ${hechos.length}; falló ${fallo.cod}: ${fallo.msg}. ¿Corriste sql_ordenes_produccion.sql?`, 'err', 9000);
  } else {
    pmToast(`✓ ${hechos.length} ${hechos.length === 1 ? 'orden emitida' : 'órdenes emitidas'}`);
  }
}

function opgPintarRes() {
  const el = document.getElementById('opg-res');
  if (!el) return;
  if (!_opgEmitidas.length) { el.innerHTML = ''; return; }
  const nDocs = _opgEmitidas.reduce((a, p) => a + p.docs.length, 0);
  const cons = opgConsolidado([].concat(..._opgEmitidas.map(p => p.docs)));
  el.innerHTML = `
    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-weight:700">2. Órdenes emitidas · ${_opgEmitidas.length} ${_opgEmitidas.length === 1 ? 'orden' : 'órdenes'} · ${nDocs} documentos</div>
        <button class="btn btn-gold" onclick="opgImprimir(_opgEmitidas)">🖨 Imprimir todo (${nDocs} documentos)</button>
      </div>
      ${_opgEmitidas.map((p, k) => `
        <div class="opg-ord">
          <span class="opg-num">${pmEsc(p.orden.numero)}</span>
          <div style="flex:1 1 220px"><b>${pmEsc(p.orden.producto_cod)} · ${pmEsc(p.orden.producto_nombre)}</b>
            <div class="opg-mu">Inicio ${pmEsc(opgFechaTxt(p.orden.fecha_inicio))} · ${opgF(p.orden.unidades)} × ${opgF(p.orden.peso_unidad_g)} g · masa cruda ${opgF(p.orden.masa_cruda_g)} g</div></div>
          <div style="flex:2 1 300px">${_opgChipsDocs({ docs: p.docs }, p.orden.numero)}</div>
          <button class="btn btn-out btn-sm" onclick="opgImprimir([_opgEmitidas[${k}]])">🖨 Imprimir</button>
        </div>`).join('')}
    </div>
    <div class="card">
      <div style="font-weight:700;margin-bottom:6px">Pesaje consolidado de la tanda</div>
      <div class="opg-mu" style="margin-bottom:6px">Todo lo que hay que sacar de bodega para estas órdenes (la masa madre y los rellenos ya están abiertos en sus ingredientes).</div>
      <div class="opg-sc"><table class="opg-t" style="min-width:320px;max-width:520px">
        <thead><tr><th>Materia prima</th><th class="n">Total (g)</th></tr></thead>
        <tbody>${cons.map(x => `<tr><td>${pmEsc(x.n)}</td><td class="n">${opgF(x.g)}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="n"><b>${opgF(cons.reduce((a, x) => a + x.g, 0))}</b></td></tr></tbody>
      </table></div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// PANTALLA — ÓRDENES EMITIDAS
// ═══════════════════════════════════════════════════════════
async function opgCargarLista() {
  _opgEstilo();
  const fil = document.getElementById('opg-filtros');
  const tab = document.getElementById('opg-tabla');
  if (!fil || !tab) return;
  if (!document.getElementById('opg-desde')) {
    fil.innerHTML = `<div class="row">
      <div class="col sm"><label for="opg-desde">Inicio desde</label><input type="date" id="opg-desde" value="${opgSumarDias(pmHoy(), -7)}" onchange="opgPintarTabla()"></div>
      <div class="col sm"><label for="opg-hasta">Hasta</label><input type="date" id="opg-hasta" value="${opgSumarDias(pmHoy(), 30)}" onchange="opgPintarTabla()"></div>
      <div class="col" style="flex:0 0 auto"><label style="display:flex;gap:6px;align-items:center;margin-top:18px"><input type="checkbox" id="opg-anul" onchange="opgPintarTabla()" style="width:auto"> Incluir anuladas</label></div>
      <div class="col" style="flex:1"></div>
      <div class="col" style="flex:0 0 auto"><button class="btn btn-gold btn-sm" onclick="opgImprimirSel()">🖨 Imprimir seleccionadas</button></div>
    </div>`;
  }
  tab.innerHTML = '<div class="opg-mu">Cargando…</div>';
  if (!pmDB.disponible()) { tab.innerHTML = '<div class="opg-err">Sin conexión con Supabase.</div>'; return; }
  try {
    const [ords, docs] = await Promise.all([
      pmDB.get('op_ordenes'),
      pmDB.get('op_documentos', {}, 'orden_id,sufijo,tipo,cantidad_g')
    ]);
    _opgLista = ords || [];
    _opgDocsRes = {};
    (docs || []).forEach(d => { (_opgDocsRes[d.orden_id] = _opgDocsRes[d.orden_id] || []).push(d); });
    opgPintarTabla();
  } catch (e) {
    tab.innerHTML = `<div class="opg-err">No se pudieron cargar las órdenes: ${pmEsc(e.message)}<br>¿Ya corriste sql_ordenes_produccion.sql en Supabase?</div>`;
  }
}

function opgPintarTabla() {
  const tab = document.getElementById('opg-tabla');
  if (!tab) return;
  const desde = document.getElementById('opg-desde').value || '0000-01-01';
  const hasta = document.getElementById('opg-hasta').value || '9999-12-31';
  const conAnul = document.getElementById('opg-anul').checked;
  const lst = _opgLista
    .filter(o => String(o.fecha_inicio).slice(0, 10) >= desde && String(o.fecha_inicio).slice(0, 10) <= hasta)
    .filter(o => conAnul || o.estado !== 'anulada')
    .sort((a, b) => String(b.numero).localeCompare(String(a.numero)));
  if (!lst.length) { tab.innerHTML = '<div class="opg-mu">No hay órdenes en ese rango de fechas.</div>'; return; }
  tab.innerHTML = `<div class="opg-sc"><table class="opg-t" style="min-width:820px"><thead><tr>
    <th style="width:34px"></th><th>Orden</th><th>Producto</th><th>Inicio</th><th class="n">Unidades × peso</th><th class="n">Masa cruda (g)</th><th>Documentos</th><th>Estado</th><th></th>
  </tr></thead><tbody>${lst.map(o => {
    const docs = (_opgDocsRes[o.id] || []).slice().sort((a, b) => String(a.sufijo).localeCompare(String(b.sufijo)));
    const chips = docs.map(d => `<span class="opg-chip ${OPG_CHIP[d.tipo] || 'p'}">${pmEsc(d.tipo === 'principal' ? 'Orden' : (OPG_TITULO[d.tipo] || d.tipo))}</span>`).join('');
    const anul = o.estado === 'anulada';
    return `<tr${anul ? ' style="opacity:.55"' : ''}>
      <td><input type="checkbox" ${_opgSel.has(o.id) ? 'checked' : ''} onchange="opgToggleSel('${o.id}',this.checked)" aria-label="Seleccionar ${pmEsc(o.numero)}" style="width:auto;min-width:0"></td>
      <td><span class="opg-num">${pmEsc(o.numero)}</span></td>
      <td>${pmEsc(o.producto_cod)} · ${pmEsc(o.producto_nombre || '')}</td>
      <td>${pmEsc(opgFechaTxt(o.fecha_inicio))}</td>
      <td class="n">${opgF(o.unidades)} × ${opgF(o.peso_unidad_g)} g</td>
      <td class="n">${opgF(o.masa_cruda_g || 0)}</td>
      <td>${chips}</td>
      <td>${pmEsc(o.estado)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-out btn-sm" onclick="opgImprimirUna('${o.id}')">🖨</button>
        ${anul || o.estado === 'cerrada' ? '' : `<button class="btn btn-out btn-sm" onclick="opgAnular('${o.id}')">Anular</button>`}
      </td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function opgToggleSel(id, on) { if (on) _opgSel.add(id); else _opgSel.delete(id); }

async function opgCargarPaquete(o) {
  const [docs, lins] = await Promise.all([
    pmDB.get('op_documentos', { orden_id: o.id }),
    pmDB.get('op_lineas', { orden_id: o.id })
  ]);
  const dd = (docs || []).slice().sort((a, b) => a.orden - b.orden).map(d => Object.assign({}, d, {
    lineas: (lins || []).filter(l => l.documento_id === d.id).sort((a, b) => a.orden - b.orden)
  }));
  return { orden: o, docs: dd };
}

async function opgImprimirUna(id) {
  const o = _opgLista.find(x => x.id === id);
  if (!o) return;
  try { opgImprimir([await opgCargarPaquete(o)]); }
  catch (e) { pmToast('No se pudo cargar la orden: ' + e.message, 'err'); }
}

async function opgImprimirSel() {
  const ords = _opgLista.filter(o => _opgSel.has(o.id)).sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
  if (!ords.length) { pmToast('Marcá al menos una orden', 'err'); return; }
  try {
    const paquetes = [];
    for (const o of ords) paquetes.push(await opgCargarPaquete(o));
    opgImprimir(paquetes);
  } catch (e) { pmToast('No se pudieron cargar las órdenes: ' + e.message, 'err'); }
}

async function opgAnular(id) {
  const o = _opgLista.find(x => x.id === id);
  if (!o) return;
  if (!confirm('¿Anular la orden ' + o.numero + '? Queda en el historial como anulada.')) return;
  try {
    await pmDB.update('op_ordenes', id, { estado: 'anulada' });
    o.estado = 'anulada';
    opgPintarTabla();
    pmToast('Orden ' + o.numero + ' anulada');
  } catch (e) { pmToast('No se pudo anular: ' + e.message, 'err'); }
}

// ═══════════════════════════════════════════════════════════
// IMPRESIÓN — una hoja carta por documento
// ═══════════════════════════════════════════════════════════
const _OPG_CSS = `
@page{size:letter;margin:1.2cm}
.opg-pag{page-break-after:always;color:#111418;font-family:Arial,Helvetica,sans-serif;font-size:13px}
.opg-pag:last-child{page-break-after:auto}
.opg-hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111418;padding-bottom:8px;margin-bottom:10px}
.opg-hd .a{font-size:20px;font-weight:700}
.opg-hd .b{font-size:11px;color:#4A5058}
.opg-hd .r{text-align:right}
.opg-hd .t{font-size:11px;letter-spacing:.08em;color:#4A5058;font-weight:700}
.opg-hd .nn{font-family:'Courier New',monospace;font-size:26px;font-weight:700;line-height:1}
.opg-meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #111418;margin-bottom:12px}
.opg-meta div{padding:5px 9px;border-right:1px solid #111418;border-bottom:1px solid #111418}
.opg-meta div:nth-child(3n){border-right:none}
.opg-meta .w2{grid-column:span 2;border-right:1px solid #111418}
.opg-meta small{display:block;font-size:10px;color:#4A5058}
.opg-meta b{font-size:14px}
.opg-h3{font-size:12px;font-weight:700;letter-spacing:.04em;margin:12px 0 4px}
.opg-pt{width:100%;border-collapse:collapse;font-size:13px}
.opg-pt th,.opg-pt td{border:1px solid #111418;padding:5px 8px;text-align:left}
.opg-pt th{background:#E9EAEC;font-size:11px}
.opg-pt td.n,.opg-pt th.n{text-align:right;white-space:nowrap;font-family:'Courier New',monospace}
.opg-pt td.n b{font-weight:700}
.opg-pt tr.tot td{background:#E9EAEC;font-weight:700}
.opg-pt td.ot{color:#6B7078;font-size:11px;height:24px}
.opg-pt .sub{color:#2B3F78;font-size:11px}
.opg-ctl{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #111418;margin-top:12px}
.opg-ctl div{padding:6px 9px;border-right:1px solid #111418;height:46px;font-size:10px;color:#4A5058}
.opg-ctl div:last-child{border-right:none}
.opg-obs{display:flex;border:1px solid #111418;margin-top:12px;min-height:120px}
.opg-obs .o{flex:2;padding:6px 9px;font-size:10px;color:#4A5058;border-right:1px solid #111418}
.opg-obs .f{flex:1;padding:6px 9px;font-size:10px;color:#4A5058;display:flex;flex-direction:column;justify-content:space-between}
.opg-obs .f span{border-top:1px solid #111418;padding-top:3px}
.opg-pie{font-size:10px;color:#555;text-align:center;margin-top:10px}
`;

function opgResumenHTML(paquetes) {
  const todas = [].concat(...paquetes.map(p => p.docs));
  const cons = opgConsolidado(todas);
  const hoy = new Date().toLocaleDateString('es-CR', { day: '2-digit', month: 'long', year: 'numeric' });
  return `<section class="opg-pag">
    <div class="opg-hd"><div><div class="a">PanMaestro</div><div class="b">Resumen de la tanda · ${pmEsc(hoy)}</div></div>
      <div class="r"><div class="t">TANDA DE PRODUCCIÓN</div><div class="nn">${paquetes.length} órdenes</div></div></div>
    <div class="opg-h3">ÓRDENES DE LA TANDA</div>
    <table class="opg-pt"><thead><tr><th>Orden</th><th>Producto</th><th>Inicio</th><th class="n">Unidades × peso</th><th class="n">Masa cruda (g)</th><th>Documentos</th></tr></thead><tbody>
      ${paquetes.map(p => `<tr><td>${pmEsc(p.orden.numero)}</td><td>${pmEsc(p.orden.producto_cod)} · ${pmEsc(p.orden.producto_nombre || '')}</td><td>${pmEsc(opgFechaTxt(p.orden.fecha_inicio))}</td>
        <td class="n">${opgF(p.orden.unidades)} × ${opgF(p.orden.peso_unidad_g)} g</td><td class="n">${opgF(p.orden.masa_cruda_g || 0)}</td><td>${p.docs.length}</td></tr>`).join('')}
    </tbody></table>
    <div class="opg-h3">PESAJE CONSOLIDADO · MATERIA PRIMA A SACAR DE BODEGA</div>
    <table class="opg-pt"><thead><tr><th>Materia prima</th><th class="n">Total (g)</th><th>Pesado ✓</th></tr></thead><tbody>
      ${cons.map(x => `<tr><td>${pmEsc(x.n)}</td><td class="n"><b>${opgF(x.g)}</b></td><td></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td class="n">${opgF(cons.reduce((a, x) => a + x.g, 0))}</td><td></td></tr>
    </tbody></table>
  </section>`;
}

function opgDocHTML(orden, doc, todosDocs) {
  const num = orden.numero + (doc.sufijo ? '-' + doc.sufijo : '');
  const lineas = doc.lineas || [];
  const base = opgBaseDe(lineas);
  const esPrincipal = doc.tipo === 'principal';
  const titulo = esPrincipal ? 'ORDEN DE PRODUCCIÓN' : 'SUB-ORDEN · ' + String(OPG_TITULO[doc.tipo] || doc.tipo).toUpperCase();
  const merma = Number(orden.merma_pct) || 0;

  const meta = esPrincipal
    ? `<div class="w2"><small>Producto</small><b>${pmEsc(orden.producto_cod)} · ${pmEsc(orden.producto_nombre || '')}</b></div>
       <div><small>Receta</small><b>${pmEsc(orden.receta_code || '')}${orden.receta_nombre ? ' · ' + pmEsc(orden.receta_nombre) : ''}</b></div>
       <div><small>Inicio de producción</small><b>${pmEsc(opgFechaTxt(orden.fecha_inicio))}</b></div>
       <div><small>Unidades × peso</small><b>${opgF(orden.unidades)} × ${opgF(orden.peso_unidad_g)} g</b></div>
       <div><small>Masa cruda${merma > 0 ? ' (merma ' + opgF(merma) + ' %)' : ''}</small><b>${opgF(orden.masa_cruda_g || 0)} g</b></div>
       <div class="w2"><small>Documentos de esta orden</small><b>${(todosDocs || []).map(d => pmEsc(orden.numero + (d.sufijo ? '-' + d.sufijo : ''))).join(' · ')}</b></div>
       <div><small>Emitida</small><b>${pmEsc(opgFechaTxt(String(orden.created_at || '').slice(0, 10) || pmHoy()))}</b></div>`
    : `<div class="w2"><small>Para la orden</small><b>${pmEsc(orden.numero)} · ${pmEsc(orden.producto_cod)} ${pmEsc(orden.producto_nombre || '')}</b></div>
       <div><small>Cantidad requerida</small><b>${opgF(doc.cantidad_g)} g</b></div>
       <div class="w2"><small>${esPrincipal ? '' : 'Detalle'}</small><b>${pmEsc(String(doc.titulo || '').replace(/^[^·]*· ?/, ''))}</b></div>
       <div><small>Inicio de producción de la orden</small><b>${pmEsc(opgFechaTxt(orden.fecha_inicio))}</b></div>`;

  const filas = lineas.map(l => {
    const sub = l.es_sub && l.nota ? ` <span class="sub">· ver ${pmEsc(orden.numero + '-' + l.nota)}</span>` : '';
    const pct = l.pct_panadero === null || l.pct_panadero === undefined ? '—' : opgF(l.pct_panadero);
    return `<tr><td>${pmEsc(l.ingrediente)}${sub}</td><td class="n">${pct}</td><td class="n"><b>${opgF(l.cant_std_g)}</b></td><td></td></tr>`;
  }).join('');
  const otros = '<tr><td class="ot">Otro material usado:</td><td></td><td></td><td></td></tr>'.repeat(3);

  const consol = esPrincipal && (todosDocs || []).length > 1
    ? `<div class="opg-h3">PESAJE CONSOLIDADO DE LA ORDEN</div>
       <table class="opg-pt"><thead><tr><th>Materia prima</th><th class="n">Total (g)</th></tr></thead><tbody>
       ${opgConsolidado(todosDocs).map(x => `<tr><td>${pmEsc(x.n)}</td><td class="n"><b>${opgF(x.g)}</b></td></tr>`).join('')}
       </tbody></table>`
    : '';

  let ctl = '';
  if (doc.tipo === 'masa_madre' || doc.tipo === 'subreceta') {
    ctl = `<div class="opg-ctl"><div>Hora de preparación</div><div>Temperatura (°C)</div><div>Hora lista para usar</div></div>
           <div class="opg-ctl" style="margin-top:0;border-top:none;grid-template-columns:1fr"><div style="border-right:none">Cantidad real obtenida (g)</div></div>`;
  } else if (!esPrincipal) {
    ctl = `<div class="opg-ctl" style="grid-template-columns:1fr"><div style="border-right:none">Cantidad real obtenida (g)</div></div>`;
  }
  const firma = esPrincipal
    ? `<div class="o">Observaciones</div><div class="f"><div>Piezas producidas (real)</div><span>Responsable / firma</span></div>`
    : `<div class="o">Observaciones</div><div class="f"><div></div><span>Responsable / firma</span></div>`;

  return `<section class="opg-pag">
    <div class="opg-hd"><div><div class="a">PanMaestro</div><div class="b">San Joaquín de Flores, Heredia</div></div>
      <div class="r"><div class="t">${pmEsc(titulo)}</div><div class="nn">${pmEsc(num)}</div></div></div>
    <div class="opg-meta">${meta}</div>
    <div class="opg-h3">${esPrincipal ? 'MASA FINAL · FÓRMULA PANADERA' : 'RECETA'}</div>
    <table class="opg-pt"><thead><tr><th>Ingrediente</th><th class="n">${base === 'harina' ? '% panadero' : '% del total'}</th><th class="n">Estándar (g)</th><th style="width:150px">Real (anotar)</th></tr></thead><tbody>
      ${filas}${otros}
      <tr class="tot"><td>Total</td><td class="n"></td><td class="n">${opgF(opgSumG(lineas))}</td><td></td></tr>
    </tbody></table>
    ${consol}${ctl}
    <div class="opg-obs">${firma}</div>
  </section>`;
}

function opgImprimir(paquetes) {
  if (!paquetes || !paquetes.length) { pmToast('No hay órdenes para imprimir', 'err'); return; }
  let h = '';
  if (paquetes.length > 1) h += opgResumenHTML(paquetes);
  paquetes.forEach(p => p.docs.forEach(doc => { h += opgDocHTML(p.orden, doc, p.docs); }));
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Órdenes de producción</title>
    <style>
      body{margin:0;padding:14px;background:#fff}
      .tb{margin-bottom:12px}.tb button{font-size:12px;padding:6px 14px;cursor:pointer}
      @media print{.tb{display:none}body{padding:0}}
      ${_OPG_CSS}
    </style></head><body>
    <div class="tb"><button onclick="window.print()">🖨 Imprimir / guardar PDF</button></div>
    ${h}
  </body></html>`);
  w.document.close();
  w.focus();
}
