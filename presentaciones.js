// ═══════════════════════════════════════════════════════════════
// presentaciones.js — varias presentaciones de un mismo producto (prefijo prs*)
// Maestros → Tipos de pan y Tipos de galleta.
//
// Un mismo pan puede venderse en varios pesos ("Pan Masa Madre Tartine" 600,
// 750, 800 y 1000 g). En el maestro cada presentación es un producto con su
// propio código (P0xx / G0xx): el nombre que se guarda es solo el nombre base y
// el peso va en su propio campo (la app arma "Nombre 600 g").
//
// Esta pantalla crea todas las presentaciones de un golpe:
//   - un nombre y una receta (compartida por todas; es la misma masa),
//   - una tabla Peso g | Precio ₡ con "＋ Presentación",
//   - el precio de cada fila arranca SUGERIDO proporcional al de la primera fila
//     (o al de una presentación que ya exista) y se puede escribir otro,
//   - "Guardar" crea un producto por fila con código consecutivo.
//
// Entradas: botón "＋ Presentaciones" del formulario de agregar (arrastra lo que
// ya escribiste) y botón "＋" en cada fila de la lista (agrega un tamaño a un
// producto que ya existe, con nombre y receta ya puestos).
//
// No cambia la base de datos: usa el mismo pmDB.productos.crear que panAdd/gallAdd.
// ═══════════════════════════════════════════════════════════════

const PRS_PASO_PRECIO = 50;   // el precio sugerido se redondea a múltiplos de ₡50

let _prs = null;   // { tipo, nombre, rec, filas:[{peso,precio,auto}], familia:[...], limpiarForm }

// ── Lógica pura (se prueba sin pantalla) ───────────────────────

// Precio proporcional por gramos, redondeado al paso. 0 si falta algún dato.
function _prsSugerirPrecio(refPeso, refPrecio, peso, paso) {
  const rp = Number(refPeso), rpr = Number(refPrecio), p = Number(peso), st = paso || PRS_PASO_PRECIO;
  if (!(rp > 0) || !(rpr > 0) || !(p > 0)) return 0;
  return Math.round((rpr / rp * p) / st) * st;
}

function _prsListaTipo(tipo) { return (tipo === 'pan' ? G.tiposPan : G.tiposGalleta) || []; }

// Presentaciones ya existentes con el mismo nombre base (sin distinguir mayúsculas)
function _prsFamilia(tipo, nombre) {
  const k = String(nombre || '').trim().toLowerCase();
  if (!k) return [];
  return _prsListaTipo(tipo).filter(p => String(p.nombreBase ?? p.nombre).trim().toLowerCase() === k)
    .slice().sort((a, b) => (Number(a.peso) || 0) - (Number(b.peso) || 0));
}

// n códigos consecutivos libres (P001… o G001…), mirando lo local y lo ya conocido de Supabase
function _prsSiguientesCodigos(tipo, n) {
  const pref = tipo === 'pan' ? 'P' : 'G';
  const nums = _prsListaTipo(tipo).map(p => parseInt(String(p.id).replace(pref, ''), 10) || 0);
  if (typeof _sbProdMap !== 'undefined' && _sbProdMap) {
    Object.keys(_sbProdMap).forEach(k => { if (k.charAt(0) === pref) nums.push(parseInt(k.slice(1), 10) || 0); });
  }
  let max = Math.max(0, ...nums);
  const out = [];
  for (let i = 0; i < n; i++) out.push(pref + String(++max).padStart(3, '0'));
  return out;
}

// Devuelve la lista de problemas (vacía = se puede guardar)
function _prsValidar(st, familia) {
  const err = [];
  const nom = String(st.nombre || '').trim();
  if (!nom) err.push('Ingresá el nombre');
  else if (pmNombreTienePeso(nom)) err.push('El nombre no lleva el peso: escribilo solo en la columna Peso g');
  if (!st.filas.length) err.push('Agregá al menos una presentación');
  const vistos = {};
  st.filas.forEach((f, i) => {
    const n = i + 1, peso = Number(f.peso), precio = Number(f.precio);
    if (!(peso > 5)) err.push('Presentación ' + n + ': el peso debe ser mayor a 5 g');
    else if (vistos[peso]) err.push('Presentación ' + n + ': el peso ' + peso + ' g está repetido');
    else vistos[peso] = true;
    if (!(precio > 0)) err.push('Presentación ' + n + ': falta el precio');
    if (peso > 5 && (familia || []).some(p => Number(p.peso) === peso)) err.push('Presentación ' + n + ': ya existe ' + nom + ' de ' + peso + ' g');
  });
  return err;
}

// Referencia para sugerir precios: primera fila con peso y precio escritos por la
// persona; si no hay, una presentación ya existente de la familia.
function _prsReferencia(st) {
  const f = st.filas.find(x => Number(x.peso) > 0 && Number(x.precio) > 0 && !x.auto);
  if (f) return { peso: Number(f.peso), precio: Number(f.precio) };
  const e = (st.familia || []).find(p => Number(p.peso) > 0 && Number(p.precio) > 0);
  return e ? { peso: Number(e.peso), precio: Number(e.precio) } : null;
}

// Recalcula el precio de las filas que aún llevan el sugerido (auto)
function _prsRecalcAuto(st) {
  const ref = _prsReferencia(st);
  st.filas.forEach(f => {
    if (f.auto || !(Number(f.precio) > 0)) {
      const s = ref ? _prsSugerirPrecio(ref.peso, ref.precio, f.peso, PRS_PASO_PRECIO) : 0;
      f.precio = s || '';
      f.auto = !!s;
    }
  });
}

// ── Pantalla ───────────────────────────────────────────────────
async function _prsRecetas() {
  if (typeof _panRecEnsure === 'function') await _panRecEnsure();
  return pmOrdenar(_sbRecLista().filter(r => r.code && r.code.startsWith('R-')), 'name');
}

// Desde el botón ＋ de una fila de la lista: agrega un tamaño a un producto existente
async function prsAbrirDesde(tipo, id) {
  const p = _prsListaTipo(tipo).find(x => x.id === id);
  if (!p) return;
  await _prsAbrir(tipo, { nombre: p.nombreBase ?? p.nombre, rec: p.recetaCod || '', filas: [{ peso: '', precio: '', auto: false }] });
}

// Desde el formulario de agregar: arrastra lo que ya escribiste como primera presentación
async function prsDesdeFormulario(tipo) {
  const pre = tipo === 'pan' ? 'pan' : 'gall';
  const val = id => (document.getElementById(id)?.value || '').trim();
  const peso = parseFloat(val(pre + '-peso')) || '', precio = parseFloat(val(pre + '-pr')) || '';
  await _prsAbrir(tipo, {
    nombre: val(pre + '-nom'), rec: val(pre + '-rec'), limpiarForm: true,
    filas: [{ peso, precio, auto: false }, { peso: '', precio: '', auto: false }]
  });
}

async function _prsAbrir(tipo, ini) {
  _prs = { tipo, nombre: ini.nombre || '', rec: ini.rec || '', filas: ini.filas, familia: [], limpiarForm: !!ini.limpiarForm, guardando: false };
  _prs.familia = _prsFamilia(tipo, _prs.nombre);
  _prsRecalcAuto(_prs);
  const recetas = await _prsRecetas();
  document.getElementById('prs-modal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'prs-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
  const inp = 'font-size:13px;padding:6px 8px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);box-sizing:border-box;width:100%';
  const recOpts = '<option value="">— Sin receta —</option>' + recetas.map(r =>
    '<option value="' + pmEsc(r.code) + '"' + (r.code === _prs.rec ? ' selected' : '') + '>' + pmEsc(r.name) + ' · ' + pmEsc(r.code) + '</option>').join('');
  ov.innerHTML =
    '<div class="card" style="max-width:560px;width:100%;max-height:92vh;overflow:auto;background:#fff;padding:16px">' +
      '<div style="font-weight:700;font-size:15px;margin-bottom:10px">＋ Presentaciones de ' + (tipo === 'pan' ? 'pan' : 'galleta') + '</div>' +
      '<label style="font-size:11px;color:var(--cream2)">Nombre (sin el peso)</label>' +
      '<input id="prs-nom" type="text" style="' + inp + '" value="' + pmEsc(_prs.nombre) + '" oninput="prsNombre(this.value)" placeholder="Pan de Masa Madre Integral">' +
      '<div id="prs-fam" style="font-size:11px;color:var(--cream2);margin:4px 0 8px"></div>' +
      '<label style="font-size:11px;color:var(--cream2)">Receta (la misma para todas las presentaciones)</label>' +
      '<select id="prs-rec" style="' + inp + ';margin-bottom:10px" onchange="_prs.rec=this.value">' + recOpts + '</select>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' +
        '<th style="text-align:left;font-size:11px;color:var(--cream2);padding:2px 4px;width:90px">Peso g</th>' +
        '<th style="text-align:left;font-size:11px;color:var(--cream2);padding:2px 4px;width:110px">Precio ₡</th>' +
        '<th style="text-align:left;font-size:11px;color:var(--cream2);padding:2px 4px">Quedará como</th><th></th></tr></thead>' +
        '<tbody id="prs-filas"></tbody></table>' +
      '<div style="margin-top:8px"><button class="btn btn-out btn-sm" onclick="prsAddFila()">＋ Presentación</button></div>' +
      '<div style="font-size:11px;color:var(--cream2);margin-top:8px">El precio se sugiere proporcional a los gramos de la primera presentación (en amarillo); escribí otro si querés. Cada presentación se crea como un producto con su propio código.</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
        '<button class="btn btn-out" onclick="prsCerrar()">Cancelar</button>' +
        '<button class="btn btn-gold" id="prs-guardar" onclick="prsGuardar()">💾 Guardar todas</button></div>' +
    '</div>';
  document.body.appendChild(ov);
  prsRenderFilas();
  _prsRenderFamilia();
  if (!_prs.nombre) document.getElementById('prs-nom')?.focus();
}

function prsCerrar() { document.getElementById('prs-modal')?.remove(); _prs = null; }

function _prsRenderFamilia() {
  const el = document.getElementById('prs-fam');
  if (!el || !_prs) return;
  el.innerHTML = _prs.familia.length
    ? 'Ya existen: ' + _prs.familia.map(p => pmEsc(p.id) + ' · ' + pmFmtPeso(p.peso) + ' · ' + pmMoney(p.precio)).join(' — ')
    : '';
}

function prsNombre(v) {
  _prs.nombre = v;
  _prs.familia = _prsFamilia(_prs.tipo, v);
  _prsRecalcAuto(_prs);
  _prsRenderFamilia();
  _prsActualizarTodo();
}

function prsAddFila() { _prs.filas.push({ peso: '', precio: '', auto: false }); prsRenderFilas(); }
function prsDelFila(i) { _prs.filas.splice(i, 1); _prsRecalcAuto(_prs); prsRenderFilas(); }

function prsPeso(i, v) {
  _prs.filas[i].peso = parseFloat(v) || '';
  const f = _prs.filas[i];
  if (!(Number(f.precio) > 0) || f.auto) f.auto = true;   // sin precio propio: sigue al sugerido
  _prsRecalcAuto(_prs);
  _prsActualizarTodo();
}
function prsPrecio(i, v) {
  const f = _prs.filas[i];
  f.precio = parseFloat(v) || '';
  f.auto = false;
  _prsRecalcAuto(_prs);   // las demás filas en sugerido se reajustan a este precio si es la referencia
  _prsActualizarTodo(i);
}

function prsRenderFilas() {
  const tb = document.getElementById('prs-filas');
  if (!tb || !_prs) return;
  const inp = 'font-size:13px;padding:5px 7px;background:var(--sf);border:1px solid var(--border);border-radius:6px;color:var(--cream);width:100%;box-sizing:border-box;text-align:right';
  tb.innerHTML = _prs.filas.map((f, i) =>
    '<tr><td style="padding:3px 4px"><input id="prs-peso-' + i + '" type="number" min="0" step="any" style="' + inp + '" value="' + (f.peso || '') + '" oninput="prsPeso(' + i + ',this.value)"></td>' +
    '<td style="padding:3px 4px"><input id="prs-pr-' + i + '" type="number" min="0" step="any" style="' + inp + (f.auto ? ';border-color:#B7791F;background:#FFF8E6' : '') + '" value="' + (f.precio || '') + '" oninput="prsPrecio(' + i + ',this.value)" onblur="_prsActualizarTodo()"></td>' +
    '<td style="padding:3px 4px;font-size:12px" id="prs-prev-' + i + '"></td>' +
    '<td style="width:30px;padding:3px 0">' + (_prs.filas.length > 1 ? '<button class="btn btn-red btn-xs" onclick="prsDelFila(' + i + ')">✕</button>' : '') + '</td></tr>').join('');
  _prsActualizarTodo();
}

// Refresca vista previa y precios sugeridos sin reconstruir las casillas (no pierde el foco)
function _prsActualizarTodo(foco) {
  if (!_prs) return;
  const cods = _prsSiguientesCodigos(_prs.tipo, _prs.filas.length);
  const vistos = {};
  _prs.filas.forEach(f => { const p = Number(f.peso); if (p > 0) vistos[p] = (vistos[p] || 0) + 1; });
  _prs.filas.forEach((f, i) => {
    const pr = document.getElementById('prs-pr-' + i);
    if (pr && i !== foco) { pr.value = f.precio || ''; pr.style.borderColor = f.auto ? '#B7791F' : ''; pr.style.background = f.auto ? '#FFF8E6' : ''; }
    const pv = document.getElementById('prs-prev-' + i);
    if (!pv) return;
    const p = Number(f.peso);
    const existe = p > 0 && _prs.familia.some(x => Number(x.peso) === p);
    const rep = p > 0 && vistos[p] > 1;
    pv.innerHTML = (existe || rep)
      ? '<span style="color:var(--red)">⚠ ' + (existe ? 'ya existe con ese peso' : 'peso repetido') + '</span>'
      : (p > 5 ? pmEsc(pmNombreProd(_prs.nombre || '…', p)) + ' <span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--gold3)">' + cods[i] + '</span>' : '<span style="color:var(--cream2)">—</span>');
  });
}

async function prsGuardar() {
  if (!_prs || _prs.guardando) return;
  const st = _prs;
  const nombre = st.nombre.trim();
  const errores = _prsValidar(st, st.familia);
  if (errores.length) { pmToast(errores[0], 'err', 5000); return; }
  st.guardando = true;
  const btn = document.getElementById('prs-guardar'); if (btn) btn.disabled = true;

  const codigos = _prsSiguientesCodigos(st.tipo, st.filas.length);
  const lista = _prsListaTipo(st.tipo);
  const rec = (st.rec || '').trim();
  const soloLocal = [];
  let ultimoError = '';
  for (let i = 0; i < st.filas.length; i++) {
    const f = st.filas[i], id = codigos[i];
    lista.push(pmAplicarNombre({ id, precio: Number(f.precio), recetaCod: rec }, nombre, Number(f.peso)));
    if (pmDB.disponible()) {
      try {
        const rows = await pmDB.productos.crear({ codigo: id, nombre, tipo: st.tipo, presentacion: 'unidad',
          peso_g: Number(f.peso), precio_full: Number(f.precio), receta_cod: rec || null, activo: true });
        if (rows?.[0]) {
          if (!_sbProdMap) _sbProdMap = {};
          if (!_sbProdMapInv) _sbProdMapInv = {};
          _sbProdMap[id] = rows[0].id; _sbProdMapInv[rows[0].id] = id;
        } else soloLocal.push(id);
      } catch (e) { soloLocal.push(id); ultimoError = e.message; }
    }
  }
  pmSave('sistema');
  if (st.limpiarForm) {
    const pre = st.tipo === 'pan' ? 'pan' : 'gall';
    ['-nom', '-pr', '-peso', '-rec'].forEach(s => { const el = document.getElementById(pre + s); if (el) el.value = ''; });
  }
  if (st.tipo === 'pan') panRender(); else gallRender();
  prsCerrar();
  if (soloLocal.length) {
    pmToast('⚠️ ' + (st.filas.length - soloLocal.length) + ' creadas; ' + soloLocal.join(', ') + ' quedaron solo locales (no se sincronizaron a Supabase' + (ultimoError ? ': ' + ultimoError : '') + ')', 'err', 9000);
  } else {
    pmToast(st.filas.length + ' presentación(es) creadas ✓ ' + codigos.join(', '));
  }
}
