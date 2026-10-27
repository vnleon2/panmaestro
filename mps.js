// mps.js — MPS (Plan maestro de producción) · Entrega 1: hoja de estimado y calendario de entregas
// Prefijo de función: mps
//
// DISEÑO: módulo independiente, igual que mercadeo.js.
// - Lee productos_terminados (vía pmDB.productos.listarPanes(), ya existente)
//   pero NUNCA escribe ahí.
// - Toda escritura propia va a 5 tablas con prefijo mps_: mps_periodos,
//   mps_estimado, mps_inventario, mps_calendario, mps_excepciones
//   (ver sql_mps.sql en la raíz del repo).
// - Usa solo métodos GENÉRICOS de pmDB (get/insert/update/upsert/hardDelete)
//   — no se le agregó nada a pm_db.js. Si este archivo se borra, el resto de
//   PanMaestro sigue funcionando igual.
// - Estado propio (_mps*), nunca toca el objeto global G ni pmSave(): esta
//   data vive siempre en Supabase.
//
// QUÉ HACE (entrega 1):
//   1. Hoja de estimado: una fila por pan, columnas Comercial / Doméstico /
//      Feria (unidades del mes) e Inventario inicial. Calcula total y kilos
//      netos (unidades × peso del pan). Navegación tipo Excel (Enter, flechas,
//      Tab) y pegado de bloques desde Excel.
//   2. Calendario de entregas por canal (días de la semana) y excepciones
//      (feriados): de ahí salen los "días de entrega del mes" de cada canal.
//   3. Estado del mes: borrador / aprobado (aprobado bloquea la hoja).
// Lo que viene en entregas siguientes: balance diario (inventario final),
// chequeo de capacidad contra Costos, estimado vs real.

const MPS_CANALES = [
  { id: 'comercial', nombre: 'Comercial' },
  { id: 'domestico', nombre: 'Doméstico' },
  { id: 'feria',     nombre: 'Feria' }
];
// Días en orden de semana; n usa la convención de JavaScript (0 = domingo).
const MPS_DIAS = [
  { n: 1, t: 'Lun' }, { n: 2, t: 'Mar' }, { n: 3, t: 'Mié' }, { n: 4, t: 'Jue' },
  { n: 5, t: 'Vie' }, { n: 6, t: 'Sáb' }, { n: 0, t: 'Dom' }
];
// Columnas editables de la hoja, en orden (también el orden al pegar desde Excel).
const MPS_COLS = ['comercial', 'domestico', 'feria', 'inv'];

let _mpsMes = '';            // mes abierto, 'YYYY-MM'
let _mpsPerPorMes = {};      // 'YYYY-MM' -> fila de mps_periodos (solo los que ya existen en Supabase)
let _mpsProductos = [];      // panes activos [{ id, codigo, nombre, peso_g }]
let _mpsEst = {};            // producto_id -> { comercial, domestico, feria }  (mes abierto)
let _mpsInv = {};            // producto_id -> inventario inicial               (mes abierto)
let _mpsCal = [];            // filas de mps_calendario
let _mpsExc = [];            // filas de mps_excepciones
let _mpsReq = 0;             // contador para descartar cargas viejas si se cambia de mes rápido
let _mpsListeners = false;   // los eventos de la hoja se enganchan una sola vez
let _mpsCola = Promise.resolve();   // las escrituras se hacen una tras otra, en orden
let _mpsPend = 0;            // escrituras en curso o en cola
let _mpsErrGuardar = false;  // la última escritura falló

// ═══════════════════════════════════════════════════════════
// FUNCIONES PURAS (sin pantalla, fáciles de probar)
// ═══════════════════════════════════════════════════════════
function mpsMesActual() { return pmHoy().slice(0, 7); }

// Suma d meses a un mes 'YYYY-MM' (d puede ser negativo).
function mpsMesDesplazar(mes, d) {
  const [y, m] = mes.split('-').map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}

function mpsMesTxt(mes) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-CR', { month: 'long', year: 'numeric' });
}

// Todas las fechas del mes como [{ fecha:'YYYY-MM-DD', dow:0-6 }].
function mpsFechasDelMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  const out = [];
  for (let d = 1; d <= n; d++) {
    out.push({ fecha: mes + '-' + String(d).padStart(2, '0'), dow: new Date(y, m - 1, d).getDay() });
  }
  return out;
}

// Fechas del mes en que un canal entrega: su día de la semana está en el
// calendario y la fecha no tiene una excepción (de ese canal o de todos).
function mpsFechasEntrega(mes, canal, cal, exc) {
  const dias = new Set((cal || []).filter(r => r.canal === canal).map(r => Number(r.dia_semana)));
  return mpsFechasDelMes(mes)
    .filter(f => dias.has(f.dow))
    .filter(f => !(exc || []).some(e => e.fecha === f.fecha && (!e.canal || e.canal === canal)))
    .map(f => f.fecha);
}

function mpsKilos(unidades, pesoG) {
  const u = Number(unidades) || 0, p = Number(pesoG) || 0;
  return p > 0 ? u * p / 1000 : 0;
}

// Texto de un campo numérico: vacío = 0; acepta coma decimal; null si no vale.
function mpsNum(s) {
  const t = String(s === undefined || s === null ? '' : s).replace(/\s/g, '').replace(',', '.');
  if (t === '') return 0;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const v = parseFloat(t);
  return isNaN(v) || v < 0 ? null : v;
}

// Texto copiado de Excel → matriz de strings (filas por salto de línea, columnas por tab).
function mpsParsePegado(txt) {
  const filas = String(txt).replace(/\r/g, '').split('\n');
  while (filas.length && filas[filas.length - 1].trim() === '') filas.pop();
  return filas.map(f => f.split('\t'));
}

function mpsFmt(n, dec) {
  return Number(n).toLocaleString('es-CR', { maximumFractionDigits: dec === undefined ? 0 : dec });
}

function mpsValor(pid, col) {
  if (col === 'inv') return Number(_mpsInv[pid]) || 0;
  return Number((_mpsEst[pid] || {})[col]) || 0;
}

function mpsPonerValor(pid, col, v) {
  if (col === 'inv') { _mpsInv[pid] = v; return; }
  if (!_mpsEst[pid]) _mpsEst[pid] = {};
  _mpsEst[pid][col] = v;
}

function mpsBloqueado() {
  const p = _mpsPerPorMes[_mpsMes];
  return !!(p && p.estado === 'aprobado');
}

// ═══════════════════════════════════════════════════════════
// NAVEGACIÓN
// ═══════════════════════════════════════════════════════════
function mpsTab(tab, btn) {
  ['est', 'ven', 'bal', 'cal'].forEach(t => {
    const el = document.getElementById('mpst-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('#mps-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  if (tab === 'cal') mpsCalRender();
  if (tab === 'ven' && typeof mpvCargar === 'function') mpvCargar();
  if (tab === 'bal' && typeof mpbCargar === 'function') mpbCargar();
}

function mpsMesNav(d) {
  _mpsMes = mpsMesDesplazar(_mpsMes || mpsMesActual(), d);
  document.getElementById('mps-mes').value = _mpsMes;
  mpsCargar();
}

function mpsMesCambiado() {
  const v = document.getElementById('mps-mes').value;
  if (!/^\d{4}-\d{2}$/.test(v)) { document.getElementById('mps-mes').value = _mpsMes; return; }
  _mpsMes = v;
  mpsCargar();
}

async function mpsInit() {
  if (!_mpsMes) _mpsMes = mpsMesActual();
  document.getElementById('mps-mes').value = _mpsMes;
  mpsEnganchar();
  await mpsCargar();
}

// ═══════════════════════════════════════════════════════════
// CARGA
// ═══════════════════════════════════════════════════════════
async function mpsCargar() {
  const req = ++_mpsReq;
  const mes = _mpsMes;
  const hoja = document.getElementById('mps-hoja');
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase', 'err'); }
  if (hoja) hoja.innerHTML = '<div class="ph"><span class="ph-icon">⏳</span>Cargando...</div>';
  try {
    const [productos, cal, exc, per] = await Promise.all([
      pmDB.productos.listarPanes(),
      pmDB.get('mps_calendario'),
      pmDB.get('mps_excepciones'),
      pmDB.get('mps_periodos', { mes: mes + '-01' })
    ]);
    let est = [], inv = [];
    const periodo = (per && per[0]) || null;
    if (periodo) {
      [est, inv] = await Promise.all([
        pmDB.get('mps_estimado', { periodo_id: periodo.id }),
        pmDB.get('mps_inventario', { periodo_id: periodo.id })
      ]);
    }
    if (req !== _mpsReq) return;   // el usuario ya cambió de mes: esta respuesta quedó vieja
    // Un "pan" de 5 g o menos no es un pan sino un cobro (ej. "Entrega Dimarkit moto",
    // 1 g): no se produce, así que no entra al MPS. Sin peso (null) sí entra, para poder corregirlo.
    _mpsProductos = (productos || []).filter(p => !(p.peso_g !== null && p.peso_g !== undefined && Number(p.peso_g) <= 5))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    _mpsCal = cal || [];
    _mpsExc = exc || [];
    if (periodo) _mpsPerPorMes[mes] = periodo; else delete _mpsPerPorMes[mes];
    _mpsEst = {}; _mpsInv = {};
    (est || []).forEach(r => {
      if (!_mpsEst[r.producto_id]) _mpsEst[r.producto_id] = {};
      _mpsEst[r.producto_id][r.canal] = Number(r.cantidad) || 0;
    });
    (inv || []).forEach(r => { _mpsInv[r.producto_id] = Number(r.inv_inicial) || 0; });
  } catch (e) {
    if (req !== _mpsReq) return;
    console.warn('[mpsCargar]', e.message);
    const faltaSql = /PGRST205|Could not find the table|404/.test(e.message);
    if (hoja) hoja.innerHTML = `<div class="ph" style="flex-direction:column;gap:6px"><span class="ph-icon">⚠️</span>
      ${faltaSql
        ? 'Faltan las tablas del MPS en Supabase. Corré <b>sql_mps.sql</b> en el editor SQL y recargá la pantalla.'
        : 'No se pudo cargar el MPS: ' + pmEsc(e.message)}</div>`;
    return;
  }
  mpsRender();
  mpsCalRender();
  // Si se cambió de mes estando en otra pestaña, esa pestaña se recalcula.
  const visible = id => { const el = document.getElementById(id); return el && el.style.display === 'block'; };
  if (visible('mpst-ven') && typeof mpvCargar === 'function') mpvCargar();
  if (visible('mpst-bal') && typeof mpbCargar === 'function') mpbCargar();
}

// Crea el período del mes en Supabase la primera vez que se guarda algo.
async function mpsAsegurarPeriodo(mes) {
  if (_mpsPerPorMes[mes]) return _mpsPerPorMes[mes];
  let fila = null;
  try {
    const rows = await pmDB.insert('mps_periodos', { mes: mes + '-01' });
    fila = rows && rows[0];
  } catch (e) {
    // 409 = otro dispositivo (u otra pestaña) ya lo creó: se usa el que existe.
    if (e._status === 409 || /duplicate|23505/.test(e.message)) {
      const rows = await pmDB.get('mps_periodos', { mes: mes + '-01' });
      fila = rows && rows[0];
    } else throw e;
  }
  if (!fila) throw new Error('No se pudo crear el período del mes');
  _mpsPerPorMes[mes] = fila;
  return fila;
}

// ═══════════════════════════════════════════════════════════
// HOJA DE ESTIMADO
// ═══════════════════════════════════════════════════════════
function mpsCabeceraCanal(c) {
  const dias = MPS_DIAS.filter(d => _mpsCal.some(r => r.canal === c.id && Number(r.dia_semana) === d.n)).map(d => d.t);
  const n = mpsFechasEntrega(_mpsMes, c.id, _mpsCal, _mpsExc).length;
  return `<th>${c.nombre}<span class="mps-sub">${dias.length ? dias.join(' · ') : 'sin días'} · ${n} día${n === 1 ? '' : 's'}</span></th>`;
}

function mpsRender() {
  const hoja = document.getElementById('mps-hoja');
  if (!hoja) return;
  if (!_mpsProductos.length) {
    hoja.innerHTML = '<div class="ph"><span class="ph-icon">🍞</span>No hay tipos de pan activos en Maestros</div>';
    mpsEncabezado();
    return;
  }
  const lock = mpsBloqueado() ? 'disabled' : '';
  const celda = (p, i, col) => {
    const v = mpsValor(p.id, col);
    return `<td><input class="mps-in" inputmode="decimal" autocomplete="off" placeholder="0" ${lock}
      data-r="${i}" data-c="${col}" data-pid="${p.id}" value="${v ? v : ''}"></td>`;
  };
  const filas = _mpsProductos.map((p, i) => `
    <tr>
      <td><b>${pmEsc(p.nombre)}</b><span class="mps-sub">${pmEsc(p.codigo || '')} · ${p.peso_g ? mpsFmt(p.peso_g) + ' g' : '<span style="color:var(--red)">sin peso</span>'}</span></td>
      ${celda(p, i, 'comercial')}${celda(p, i, 'domestico')}${celda(p, i, 'feria')}
      <td class="mps-n" id="mps-tot-${i}">0</td>
      <td class="mps-n" id="mps-kg-${i}">—</td>
      ${celda(p, i, 'inv')}
    </tr>`).join('');
  hoja.innerHTML = `<div class="mps-wrap"><table class="mps-tbl">
    <thead><tr>
      <th>Pan</th>
      ${MPS_CANALES.map(mpsCabeceraCanal).join('')}
      <th>Total ud</th><th>Kilos netos</th><th>Inv. inicial<span class="mps-sub">unidades</span></th>
    </tr></thead>
    <tbody>${filas}</tbody>
    <tfoot>
      <tr><td>Total unidades</td>${MPS_CANALES.map(c => `<td class="mps-n" id="mps-ft-u-${c.id}">0</td>`).join('')}<td class="mps-n" id="mps-ft-u-total">0</td><td></td><td class="mps-n" id="mps-ft-inv">0</td></tr>
      <tr><td>Kilos netos</td>${MPS_CANALES.map(c => `<td class="mps-n" id="mps-ft-k-${c.id}">0</td>`).join('')}<td></td><td class="mps-n" id="mps-ft-k-total">0</td><td></td></tr>
      <tr><td>≈ ud por día de entrega</td>${MPS_CANALES.map(c => `<td class="mps-n" id="mps-ft-d-${c.id}">—</td>`).join('')}<td></td><td></td><td></td></tr>
    </tfoot>
  </table></div>
  <div style="font-size:11px;color:var(--cream2);margin-top:8px">
    Tab / Enter / flechas para moverte. Podés pegar un bloque desde Excel: las columnas deben ir en el orden Comercial · Doméstico · Feria · Inv. inicial.
    Los kilos salen de unidades × peso del pan (campo "Peso g" de Maestros).
  </div>`;
  mpsActualizarTotales();
  mpsEncabezado();
}

// Recalcula totales y kilos leyendo el estado en memoria; no vuelve a dibujar
// la hoja (así no se pierde el foco ni la posición mientras se escribe).
function mpsActualizarTotales() {
  const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  const uCanal = { comercial: 0, domestico: 0, feria: 0 };
  const kCanal = { comercial: 0, domestico: 0, feria: 0 };
  let uTotal = 0, kTotal = 0, invTotal = 0, conEstimado = 0;
  _mpsProductos.forEach((p, i) => {
    let uFila = 0;
    MPS_CANALES.forEach(c => {
      const u = mpsValor(p.id, c.id);
      uFila += u;
      uCanal[c.id] += u;
      kCanal[c.id] += mpsKilos(u, p.peso_g);
    });
    const kFila = mpsKilos(uFila, p.peso_g);
    uTotal += uFila; kTotal += kFila; invTotal += mpsValor(p.id, 'inv');
    if (uFila > 0) conEstimado++;
    setTxt('mps-tot-' + i, uFila ? mpsFmt(uFila, 1) : '0');
    setTxt('mps-kg-' + i, p.peso_g ? (kFila ? mpsFmt(kFila, 1) : '0') : '—');
  });
  MPS_CANALES.forEach(c => {
    const dias = mpsFechasEntrega(_mpsMes, c.id, _mpsCal, _mpsExc).length;
    setTxt('mps-ft-u-' + c.id, mpsFmt(uCanal[c.id], 1));
    setTxt('mps-ft-k-' + c.id, mpsFmt(kCanal[c.id], 1));
    setTxt('mps-ft-d-' + c.id, dias ? mpsFmt(uCanal[c.id] / dias, 1) : '—');
  });
  setTxt('mps-ft-u-total', mpsFmt(uTotal, 1));
  setTxt('mps-ft-k-total', mpsFmt(kTotal, 1));
  setTxt('mps-ft-inv', mpsFmt(invTotal, 1));
  const stats = document.getElementById('mps-stats');
  if (stats) {
    stats.innerHTML = `
      <div class="stat"><div class="stat-lbl">Unidades del mes</div><div class="stat-val">${mpsFmt(uTotal, 1)}</div></div>
      <div class="stat"><div class="stat-lbl">Kilos netos</div><div class="stat-val">${mpsFmt(kTotal, 1)}</div></div>
      <div class="stat"><div class="stat-lbl">Panes con estimado</div><div class="stat-val">${conEstimado}</div><div class="stat-sub">de ${_mpsProductos.length}</div></div>`;
  }
}

// Encabezado del módulo: estado del mes y botones.
function mpsEncabezado() {
  const per = _mpsPerPorMes[_mpsMes];
  const aprobado = !!(per && per.estado === 'aprobado');
  const badge = document.getElementById('mps-estado-badge');
  if (badge) {
    badge.textContent = aprobado ? 'Aprobado' : 'Borrador';
    badge.style.background = aprobado ? 'rgba(58,157,93,.15)' : 'rgba(217,150,26,.15)';
    badge.style.color = aprobado ? 'var(--green)' : 'var(--amber)';
  }
  const btnA = document.getElementById('mps-btn-aprobar');
  if (btnA) btnA.textContent = aprobado ? '🔓 Reabrir' : '✔ Aprobar mes';
  const btnC = document.getElementById('mps-btn-copiar');
  if (btnC) btnC.disabled = aprobado;
  const tit = document.getElementById('mps-mes-txt');
  if (tit) tit.textContent = _mpsMes ? mpsMesTxt(_mpsMes) : '';
}

function mpsEstadoGuardado() {
  const el = document.getElementById('mps-guardado');
  if (!el) return;
  if (_mpsErrGuardar) { el.textContent = '⚠️ No se guardó el último cambio'; el.style.color = 'var(--red)'; }
  else if (_mpsPend > 0) { el.textContent = 'Guardando…'; el.style.color = 'var(--cream2)'; }
  else { el.textContent = 'Guardado ✓'; el.style.color = 'var(--green)'; }
}

// ── Eventos de la hoja (delegados en el contenedor, se enganchan una vez) ──
function mpsEnganchar() {
  if (_mpsListeners) return;
  const hoja = document.getElementById('mps-hoja');
  if (!hoja) return;
  _mpsListeners = true;
  hoja.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('mps-in')) e.target.select(); });
  hoja.addEventListener('change', e => { if (e.target.classList && e.target.classList.contains('mps-in')) mpsCommit(e.target); });
  hoja.addEventListener('keydown', mpsTecla);
  hoja.addEventListener('paste', mpsPegar);
}

function mpsCeldaEn(r, col) {
  return document.querySelector(`#mps-hoja input.mps-in[data-r="${r}"][data-c="${col}"]`);
}

function mpsMover(inp, dr, dc) {
  const r = Number(inp.dataset.r) + dr;
  const c = MPS_COLS.indexOf(inp.dataset.c) + dc;
  if (r < 0 || r >= _mpsProductos.length || c < 0 || c >= MPS_COLS.length) return false;
  const dest = mpsCeldaEn(r, MPS_COLS[c]);
  if (!dest) return false;
  dest.focus();
  return true;
}

function mpsTecla(e) {
  const inp = e.target;
  if (!inp.classList || !inp.classList.contains('mps-in')) return;
  const alFinal = inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length;
  const todoSel = inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
  if (e.key === 'Enter') {
    e.preventDefault(); mpsCommit(inp); mpsMover(inp, e.shiftKey ? -1 : 1, 0);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault(); mpsCommit(inp); mpsMover(inp, 1, 0);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); mpsCommit(inp); mpsMover(inp, -1, 0);
  } else if (e.key === 'ArrowRight' && (alFinal || todoSel)) {
    e.preventDefault(); mpsCommit(inp); mpsMover(inp, 0, 1);
  } else if (e.key === 'ArrowLeft' && inp.selectionStart === 0) {
    e.preventDefault(); mpsCommit(inp); mpsMover(inp, 0, -1);
  } else if (e.key === 'Escape') {
    const v = mpsValor(inp.dataset.pid, inp.dataset.c);
    inp.value = v ? v : '';
    inp.select();
  }
}

// Confirma el valor de una celda: actualiza memoria, totales y guarda.
function mpsCommit(inp) {
  if (mpsBloqueado()) return;
  const pid = inp.dataset.pid, col = inp.dataset.c;
  const prev = mpsValor(pid, col);
  const v = mpsNum(inp.value);
  if (v === null) {
    pmToast('Número no válido', 'err');
    inp.value = prev ? prev : '';
    return;
  }
  inp.value = v ? v : '';
  if (v === prev) return;
  mpsPonerValor(pid, col, v);
  mpsActualizarTotales();
  mpsGuardar([{ pid, col, v }]);
}

// Pegado desde Excel: un bloque se acomoda desde la celda activa hacia la
// derecha y hacia abajo. Un pegado de un solo valor se comporta normal.
function mpsPegar(e) {
  const inp = e.target;
  if (!inp.classList || !inp.classList.contains('mps-in')) return;
  if (mpsBloqueado()) { e.preventDefault(); return; }
  const txt = (e.clipboardData || window.clipboardData).getData('text');
  if (!txt || (txt.indexOf('\t') < 0 && !/\n/.test(txt.replace(/\r?\n$/, '')))) return;
  e.preventDefault();
  const filas = mpsParsePegado(txt);
  const r0 = Number(inp.dataset.r), c0 = MPS_COLS.indexOf(inp.dataset.c);
  const cambios = [];
  let invalidas = 0, leidas = 0;
  filas.forEach((fila, i) => fila.forEach((celda, j) => {
    const r = r0 + i, c = c0 + j;
    if (r >= _mpsProductos.length || c >= MPS_COLS.length) return;
    if (celda.trim() === '') return;          // celda vacía de Excel: no se toca
    const v = mpsNum(celda);
    if (v === null) { invalidas++; return; }
    leidas++;
    const pid = _mpsProductos[r].id, col = MPS_COLS[c];
    if (v === mpsValor(pid, col)) return;
    mpsPonerValor(pid, col, v);
    const el = mpsCeldaEn(r, col);
    if (el) el.value = v ? v : '';
    cambios.push({ pid, col, v });
  }));
  mpsActualizarTotales();
  if (cambios.length) mpsGuardar(cambios);
  pmToast(`Pegado: ${leidas} celda${leidas === 1 ? '' : 's'}${invalidas ? ' · ' + invalidas + ' no válida' + (invalidas === 1 ? '' : 's') : ''}`, invalidas ? 'err' : 'ok');
}

// ── Guardado (en cola: una escritura a la vez, en el orden en que se hicieron) ──
function mpsGuardar(cambios) {
  const mes = _mpsMes;     // el mes se fija ahora: si el usuario cambia de mes, esto igual va al suyo
  _mpsPend++;
  _mpsErrGuardar = false;
  mpsEstadoGuardado();
  _mpsCola = _mpsCola.then(async () => {
    try {
      const per = await mpsAsegurarPeriodo(mes);
      const est = [], inv = [];
      cambios.forEach(c => {
        if (c.col === 'inv') inv.push({ periodo_id: per.id, producto_id: c.pid, inv_inicial: c.v });
        else est.push({ periodo_id: per.id, producto_id: c.pid, canal: c.col, cantidad: c.v });
      });
      if (est.length) await pmDB.upsert('mps_estimado?on_conflict=periodo_id,producto_id,canal', est);
      if (inv.length) await pmDB.upsert('mps_inventario?on_conflict=periodo_id,producto_id', inv);
    } catch (e) {
      console.warn('[mpsGuardar]', e.message);
      _mpsErrGuardar = true;
      pmToast('No se guardó en Supabase: ' + e.message, 'err', 5000);
    } finally {
      _mpsPend--;
      mpsEstadoGuardado();
    }
  });
}

// ── Copiar el estimado del mes anterior ──
async function mpsCopiarAnterior() {
  if (mpsBloqueado()) return;
  const mes = _mpsMes;
  const ant = mpsMesDesplazar(mes, -1);
  try {
    const per = await pmDB.get('mps_periodos', { mes: ant + '-01' });
    if (!per || !per[0]) { pmToast('No hay estimado guardado en ' + mpsMesTxt(ant), 'err'); return; }
    const est = (await pmDB.get('mps_estimado', { periodo_id: per[0].id })) || [];
    const validos = est.filter(r => _mpsProductos.some(p => p.id === r.producto_id) && Number(r.cantidad) > 0);
    if (!validos.length) { pmToast('El mes anterior no tiene cantidades', 'err'); return; }
    if (mes !== _mpsMes) return;
    const hayDatos = _mpsProductos.some(p => MPS_CANALES.some(c => mpsValor(p.id, c.id) > 0));
    if (hayDatos && !confirm(`Este mes ya tiene cantidades. Se copiarán ${validos.length} del mes anterior encima de las actuales (el inventario inicial no se copia). ¿Continuar?`)) return;
    const cambios = [];
    validos.forEach(r => {
      const v = Number(r.cantidad);
      if (v === mpsValor(r.producto_id, r.canal)) return;
      mpsPonerValor(r.producto_id, r.canal, v);
      cambios.push({ pid: r.producto_id, col: r.canal, v });
    });
    mpsRender();
    if (cambios.length) mpsGuardar(cambios);
    pmToast(`Copiado de ${mpsMesTxt(ant)}: ${validos.length} cantidades ✓`);
  } catch (e) {
    pmToast('No se pudo copiar: ' + e.message, 'err');
  }
}

// ── Aprobar / reabrir el mes ──
async function mpsAprobar() {
  const mes = _mpsMes;
  const aprobado = mpsBloqueado();
  if (!aprobado && !confirm(`¿Aprobar el estimado de ${mpsMesTxt(mes)}? La hoja queda bloqueada hasta que la reabras.`)) return;
  try {
    await _mpsCola;   // que termine de guardarse lo pendiente antes de cambiar el estado
    const per = await mpsAsegurarPeriodo(mes);
    const rows = await pmDB.update('mps_periodos', per.id, { estado: aprobado ? 'borrador' : 'aprobado' });
    _mpsPerPorMes[mes] = (rows && rows[0]) || { ...per, estado: aprobado ? 'borrador' : 'aprobado' };
    if (mes === _mpsMes) mpsRender();
    pmToast(aprobado ? 'Mes reabierto ✓' : 'Mes aprobado ✓');
  } catch (e) {
    pmToast('No se pudo cambiar el estado: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════
// CALENDARIO DE ENTREGAS Y EXCEPCIONES
// ═══════════════════════════════════════════════════════════
function mpsCalRender() {
  const el = document.getElementById('mps-cal');
  if (!el) return;
  el.innerHTML = `<table class="mps-tbl" style="width:auto">
    <thead><tr><th>Canal</th>${MPS_DIAS.map(d => `<th>${d.t}</th>`).join('')}<th>Días en ${_mpsMes ? mpsMesTxt(_mpsMes) : 'el mes'}</th></tr></thead>
    <tbody>${MPS_CANALES.map(c => {
      const n = mpsFechasEntrega(_mpsMes, c.id, _mpsCal, _mpsExc).length;
      return `<tr><td><b>${c.nombre}</b></td>${MPS_DIAS.map(d => {
        const on = _mpsCal.some(r => r.canal === c.id && Number(r.dia_semana) === d.n);
        return `<td style="text-align:center"><input type="checkbox" ${on ? 'checked' : ''} onchange="mpsCalToggle('${c.id}',${d.n},this)"></td>`;
      }).join('')}<td class="mps-n">${n}</td></tr>`;
    }).join('')}</tbody></table>`;
  mpsExcRender();
}

async function mpsCalToggle(canal, dia, chk) {
  const fila = _mpsCal.find(r => r.canal === canal && Number(r.dia_semana) === dia);
  try {
    if (chk.checked && !fila) {
      const rows = await pmDB.insert('mps_calendario', { canal, dia_semana: dia });
      if (rows && rows[0]) _mpsCal.push(rows[0]);
    } else if (!chk.checked && fila) {
      await pmDB.hardDelete('mps_calendario', fila.id);
      _mpsCal = _mpsCal.filter(r => r.id !== fila.id);
    }
    mpsCalRender();
    if (document.getElementById('mps-hoja').querySelector('table')) mpsRender();
  } catch (e) {
    chk.checked = !chk.checked;
    pmToast('No se pudo guardar el calendario: ' + e.message, 'err');
  }
}

function mpsExcRender() {
  const el = document.getElementById('mps-exc-list');
  if (!el) return;
  const delMes = _mpsExc.filter(e => (e.fecha || '').slice(0, 7) === _mpsMes)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const nombreCanal = id => (MPS_CANALES.find(c => c.id === id) || { nombre: 'Todos los canales' }).nombre;
  el.innerHTML = delMes.map(e => `
    <div class="item-row">
      <div style="font-family:'DM Mono',monospace;font-size:12px;min-width:90px">${pmEsc(e.fecha)}</div>
      <div class="item-name">${nombreCanal(e.canal)}${e.motivo ? ' · ' + pmEsc(e.motivo) : ''}</div>
      <button class="btn btn-red btn-xs" onclick="mpsExcDel('${e.id}')">✕</button>
    </div>`).join('') || '<div class="ph" style="padding:12px 0"><span class="ph-icon">📅</span>Sin excepciones en este mes</div>';
}

async function mpsExcAdd() {
  const fecha = document.getElementById('mps-exc-fecha').value;
  const canal = document.getElementById('mps-exc-canal').value || null;
  const motivo = document.getElementById('mps-exc-motivo').value.trim() || null;
  if (!fecha) { pmToast('Elegí la fecha', 'err'); return; }
  if (_mpsExc.some(e => e.fecha === fecha && (e.canal || null) === canal)) { pmToast('Esa excepción ya existe', 'err'); return; }
  try {
    const rows = await pmDB.insert('mps_excepciones', { fecha, canal, motivo });
    if (rows && rows[0]) _mpsExc.push(rows[0]);
    document.getElementById('mps-exc-fecha').value = '';
    document.getElementById('mps-exc-motivo').value = '';
    pmToast('Excepción agregada ✓');
    mpsCalRender();
    if (document.getElementById('mps-hoja').querySelector('table')) mpsRender();
  } catch (e) {
    pmToast('No se pudo agregar: ' + e.message, 'err');
  }
}

async function mpsExcDel(id) {
  try {
    await pmDB.hardDelete('mps_excepciones', id);
    _mpsExc = _mpsExc.filter(e => e.id !== id);
    mpsCalRender();
    if (document.getElementById('mps-hoja').querySelector('table')) mpsRender();
  } catch (e) {
    pmToast('No se pudo quitar: ' + e.message, 'err');
  }
}
