// depuracion.js — Depuración de maestros (detección de nombres parecidos)
// Prefijo de función: dep
//
// DISEÑO: utilidad de SOLO LECTURA sobre los maestros.
// - Lee ingredientes, recetas, clientes, productos_terminados y receta_items
//   directo de Supabase (siempre datos frescos, no usa el caché local G).
// - NUNCA modifica un maestro. Corregir un nombre se sigue haciendo desde
//   Maestros (ingEdit) o Costeo; esta pantalla solo produce la lista de qué
//   revisar.
// - Lo único que escribe es la tabla satélite depuracion_descartes (pares
//   marcados "no es duplicado", ver sql_depuracion.sql). Si esa tabla aún no
//   existe, guarda los descartes en localStorage como respaldo.
// - Estado propio (_dep*), no toca el objeto global G ni pmSave().
// - Algoritmo: normalización + 3 medidas de similitud en JS puro (distancia
//   de edición, coincidencia palabra por palabra y Jaro-Winkler). Sin IA ni
//   librerías externas.

let _depTab = 'ingredientes';
let _depDatos = {};                 // maestro -> filas activas
let _depItems = null;               // receta_items (todas)
let _depResultados = {};            // maestro -> pares sospechosos (ya calculados)
let _depDescartes = new Set();      // "maestro|clave"
let _depDescIds = {};               // "maestro|clave" -> id de fila en Supabase
let _depSbOk = false;               // ¿existe la tabla depuracion_descartes?
let _depCargando = false;

const DEP_LS_KEY = 'pm_dep_descartes';
const DEP_MAX_PARES = 300;          // tope de pares mostrados por pantalla
const DEP_STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'en', 'a', 'al']);

const DEP_MAESTROS = {
  ingredientes: { label: 'Ingredientes', tabla: 'ingredientes', detalle: r => [r.unidad, r.precio_ref ? '₡' + r.precio_ref : 'sin precio'].filter(Boolean).join(' · ') },
  recetas:      { label: 'Recetas',      tabla: 'recetas',      detalle: r => r.categoria || '' },
  clientes:     { label: 'Clientes',     tabla: 'clientes',     detalle: () => '' },
  productos:    { label: 'Productos terminados', tabla: 'productos_terminados', detalle: r => r.tipo || '' },
};

// ═══════════════════════════════════════════════════════════
// ALGORITMO DE SIMILITUD
// ═══════════════════════════════════════════════════════════

// minúsculas, sin tildes, sin signos, espacios simples
function depNorm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// quita plural simple (panes→pan, huevos→huevo) para comparar palabras
function depRaiz(t) {
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

// precalcula todo lo que la comparación necesita, una sola vez por registro
function depPrep(nombre) {
  const norm = depNorm(nombre);
  let tokens = norm.split(' ').filter(t => t && !DEP_STOP.has(t)).map(depRaiz);
  if (!tokens.length) tokens = norm.split(' ').filter(Boolean);
  const sorted = tokens.slice().sort().join(' ');
  const nums = tokens.filter(t => /\d/.test(t)).sort().join(' ');
  const bg = new Set();
  for (let i = 0; i < sorted.length - 1; i++) bg.add(sorted.substr(i, 2));
  return { norm, tokens, sorted, nums, bg };
}

// Coeficiente de Dice sobre pares de letras: filtro muy barato para descartar
// de entrada pares que no se parecen en nada, antes del cálculo pesado.
function depDice(A, B) {
  const [c, g] = A.bg.size <= B.bg.size ? [A.bg, B.bg] : [B.bg, A.bg];
  if (!c.size && !g.size) return 1;
  let comunes = 0;
  c.forEach(x => { if (g.has(x)) comunes++; });
  return (2 * comunes) / (A.bg.size + B.bg.size);
}

// distancia de Levenshtein (dos filas, sin matriz completa)
function depLev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

function depRatio(a, b) {
  const mx = Math.max(a.length, b.length);
  return mx ? 1 - depLev(a, b) / mx : 1;
}

// mismas palabras se comparan miles de veces ("harina", "trigo"…): se guardan
// los resultados durante una corrida de análisis
let _depRatioCache = new Map();
function depRatioC(a, b) {
  const k = a < b ? a + '|' + b : b + '|' + a;
  let v = _depRatioCache.get(k);
  if (v === undefined) { v = depRatio(a, b); _depRatioCache.set(k, v); }
  return v;
}

function depJW(s1, s2) {
  if (s1 === s2) return 1;
  const l1 = s1.length, l2 = s2.length;
  if (!l1 || !l2) return 0;
  const md = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false);
  let matches = 0;
  for (let i = 0; i < l1; i++) {
    const lo = Math.max(0, i - md), hi = Math.min(l2 - 1, i + md);
    for (let j = lo; j <= hi; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = m2[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const jaro = (matches / l1 + matches / l2 + (matches - t / 2) / matches) / 3;
  let p = 0;
  while (p < 4 && p < l1 && p < l2 && s1[p] === s2[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

// coincidencia palabra por palabra, tolerando tipeos dentro de cada palabra
function depTokScore(ta, tb) {
  if (!ta.length || !tb.length) return 0;
  const mejorA = new Array(ta.length).fill(0), mejorB = new Array(tb.length).fill(0);
  for (let i = 0; i < ta.length; i++) {
    for (let j = 0; j < tb.length; j++) {
      let r = depRatioC(ta[i], tb[j]);
      if (r < 0.67) r = 0;       // por debajo de esto es ruido, no tipeo
      if (r > mejorA[i]) mejorA[i] = r;
      if (r > mejorB[j]) mejorB[j] = r;
    }
  }
  let s = 0;
  mejorA.forEach(v => { s += v; });
  mejorB.forEach(v => { s += v; });
  return s / (ta.length + tb.length);
}

// A y B vienen de depPrep(). Devuelve { score 0-100, motivo }
// 'min' (opcional): puntaje mínimo que interesa. Si ni en el mejor caso
// posible el par llega, se descarta sin calcular lo caro.
function depSimilitud(A, B, min) {
  if (!A.norm || !B.norm) return { score: 0, motivo: '' };
  if (A.norm === B.norm) return { score: 100, motivo: 'Idénticos salvo mayúsculas, tildes, espacios o signos' };
  if (A.sorted === B.sorted) return { score: 98, motivo: 'Mismas palabras (plural o distinto orden)' };
  const tok = depTokScore(A.tokens, B.tokens);
  const numDif = A.nums !== B.nums;
  // mejor caso: lev=1 y jw=1  →  60 + 40*tok  (menos 20 si difieren los números)
  if (min != null && (60 + 40 * tok - (numDif ? 20 : 0)) < min) return { score: 0, motivo: '' };
  const lev = depRatio(A.sorted, B.sorted);
  const jw = depJW(A.sorted, B.sorted);
  let score = (0.4 * lev + 0.4 * tok + 0.2 * jw) * 100;
  if (numDif) score -= 20;       // "Harina 000" vs "Harina 0000" suelen ser cosas distintas
  score = Math.max(0, Math.min(99, Math.round(score)));
  let motivo = lev >= 0.85 ? 'Posible error de tipeo'
    : tok >= 0.85 ? 'Palabras muy parecidas'
    : 'Nombres parecidos';
  if (numDif) motivo += ' · difieren los números (¿son distintos?)';
  return { score, motivo };
}

function depClave(idA, idB) {
  return [String(idA), String(idB)].sort().join('|');
}

// Busca todos los pares sospechosos de una lista de filas
function depBuscarPares(filas, umbral) {
  _depRatioCache = new Map();
  const prep = filas.map(r => ({ r, p: depPrep(r.nombre) }));
  const pares = [];
  for (let i = 0; i < prep.length; i++) {
    const A = prep[i];
    if (!A.p.norm) continue;
    for (let j = i + 1; j < prep.length; j++) {
      const B = prep[j];
      if (!B.p.norm) continue;
      const la = A.p.sorted.length, lb = B.p.sorted.length;
      if (Math.min(la, lb) / Math.max(la, lb) < 0.4) continue;   // largos muy distintos: no compiten
      if (A.p.norm !== B.p.norm && A.p.sorted !== B.p.sorted && depDice(A.p, B.p) < 0.3) continue;   // ni letras en común
      const s = depSimilitud(A.p, B.p, umbral);
      if (s.score >= umbral) pares.push({ a: A.r, b: B.r, score: s.score, motivo: s.motivo });
    }
  }
  pares.sort((x, y) => y.score - x.score);
  return pares;
}

// ═══════════════════════════════════════════════════════════
// CARGA DE DATOS
// ═══════════════════════════════════════════════════════════

// Trae TODAS las filas de una tabla en páginas de 1000 (límite por defecto de
// Supabase). Se pasa limit/offset/order dentro del parámetro select, que
// pmDB.get() concatena tal cual a la URL.
async function depTraerTodo(tabla) {
  const PAG = 1000;
  let todo = [];
  for (let off = 0; ; off += PAG) {
    const rows = await pmDB.get(tabla, {}, `*&order=id&limit=${PAG}&offset=${off}`);
    todo = todo.concat(rows || []);
    if (!rows || rows.length < PAG) break;
  }
  return todo;
}

async function depCargarDescartes() {
  _depDescartes = new Set();
  _depDescIds = {};
  _depSbOk = false;
  try {
    const rows = await depTraerTodo('depuracion_descartes');
    (rows || []).forEach(r => {
      const k = r.maestro + '|' + r.clave;
      _depDescartes.add(k);
      _depDescIds[k] = r.id;
    });
    _depSbOk = true;
  } catch (e) { _depSbOk = false; }   // tabla aún no creada: se usa localStorage
  try {
    JSON.parse(localStorage.getItem(DEP_LS_KEY) || '[]').forEach(k => _depDescartes.add(k));
  } catch (e) { /* localStorage vacío o bloqueado */ }
}

function _depGuardarLocal() {
  try {
    const locales = [..._depDescartes].filter(k => !_depDescIds[k]);
    localStorage.setItem(DEP_LS_KEY, JSON.stringify(locales));
  } catch (e) { /* sin localStorage: el descarte vale solo en esta sesión */ }
}

async function depCargarDatos() {
  if (!pmDB.disponible()) { pmToast('Sin conexión a Supabase — no se puede analizar ahora', 'err'); return false; }
  const activos = rows => (rows || []).filter(r => r.activo !== false);
  const [ing, rec, cli, pro, items] = await Promise.all([
    depTraerTodo('ingredientes'),
    depTraerTodo('recetas'),
    depTraerTodo('clientes'),
    depTraerTodo('productos_terminados'),
    depTraerTodo('receta_items').catch(() => []),
  ]);
  _depDatos = {
    ingredientes: activos(ing),
    recetas: activos(rec),
    clientes: activos(cli),
    productos: activos(pro),
  };
  _depDatos._ingTodos = ing || [];       // incluye dados de baja (para detectar referencias a ellos)
  _depItems = items || [];
  await depCargarDescartes();
  return true;
}

// ═══════════════════════════════════════════════════════════
// UI — sub-pestañas y análisis
// ═══════════════════════════════════════════════════════════

function depInit() {
  if (!document.getElementById('dep-resultados')) return;
  if (!Object.keys(_depDatos).length) {
    document.getElementById('dep-resultados').innerHTML =
      '<div class="card" style="color:var(--cream2);font-size:13px">Presiona <b>🔍 Analizar</b> para revisar los maestros.</div>';
  }
}

function depTab(tab, btn) {
  _depTab = tab;
  document.querySelectorAll('#dep-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  const ctrl = document.getElementById('dep-controles');
  if (ctrl) ctrl.style.display = tab === 'otras' ? 'none' : 'block';
  depRender();
}

function depUmbral() {
  const v = parseInt((document.getElementById('dep-umbral') || {}).value, 10);
  return isNaN(v) ? 80 : v;
}

function depUmbralCambio() {
  const el = document.getElementById('dep-umbral-val');
  if (el) el.textContent = depUmbral();
  if (Object.keys(_depDatos).length) { _depResultados = {}; depRender(); }
}

async function depAnalizar() {
  if (_depCargando) return;
  _depCargando = true;
  const box = document.getElementById('dep-resultados');
  if (box) box.innerHTML = '<div class="card" style="color:var(--cream2);font-size:13px">⏳ Leyendo maestros de Supabase…</div>';
  try {
    const ok = await depCargarDatos();
    if (!ok) { depInit(); return; }
    _depResultados = {};
    depRender();
  } catch (e) {
    console.warn('[depAnalizar]', e.message);
    if (box) box.innerHTML = '<div class="card" style="color:#B91C1C;font-size:13px">No se pudo leer: ' + pmEsc(e.message) + '</div>';
  } finally {
    _depCargando = false;
  }
}

function depRender() {
  const box = document.getElementById('dep-resultados');
  if (!box) return;
  if (!Object.keys(_depDatos).length) { depInit(); return; }
  if (_depTab === 'otras') { box.innerHTML = depOtrasHTML(); return; }

  const cfg = DEP_MAESTROS[_depTab];
  const filas = _depDatos[_depTab] || [];
  const umbral = depUmbral();
  if (!_depResultados[_depTab]) _depResultados[_depTab] = depBuscarPares(filas, Math.min(umbral, 100));
  const todos = _depResultados[_depTab].filter(p => p.score >= umbral);
  const verDesc = !!(document.getElementById('dep-ver-desc') || {}).checked;
  const visibles = todos.filter(p => verDesc || !_depDescartes.has(_depTab + '|' + depClave(p.a.id, p.b.id)));
  const nDesc = todos.length - todos.filter(p => !_depDescartes.has(_depTab + '|' + depClave(p.a.id, p.b.id))).length;

  const lado = r => `<div style="min-width:0">
      <div style="font-size:13px;font-weight:600;word-break:break-word">${pmEsc(r.nombre)}</div>
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--cream2)">${pmEsc(r.codigo || 'sin código')}${cfg.detalle(r) ? ' · ' + pmEsc(cfg.detalle(r)) : ''}</div>
    </div>`;

  const color = s => s >= 95 ? '#B91C1C' : s >= 88 ? '#C2410C' : '#A16207';

  let html = `<div class="sec"><h2>${pmEsc(cfg.label)} — ${filas.length} activos · ${visibles.length} pares sospechosos${nDesc ? ` (${nDesc} descartados${verDesc ? '' : ' ocultos'})` : ''}</h2></div>`;
  if (!_depSbOk) {
    html += '<div class="card" style="font-size:12px;color:#A16207">Los descartes se guardan solo en este navegador (falta correr sql_depuracion.sql en Supabase para compartirlos entre dispositivos).</div>';
  }
  if (!visibles.length) {
    html += '<div class="card" style="font-size:13px;color:var(--cream2)">✅ No se encontraron nombres parecidos con el umbral actual. Baja el umbral si quieres una revisión más estricta.</div>';
  }
  visibles.slice(0, DEP_MAX_PARES).forEach(p => {
    const k = _depTab + '|' + depClave(p.a.id, p.b.id);
    const desc = _depDescartes.has(k);
    html += `<div class="item-row" style="align-items:flex-start;flex-wrap:wrap;${desc ? 'opacity:.55' : ''}">
      <span class="badge" style="background:${color(p.score)};color:#fff;flex-shrink:0">${p.score}</span>
      <div style="flex:1;min-width:220px;display:grid;grid-template-columns:1fr 1fr;gap:10px">${lado(p.a)}${lado(p.b)}</div>
      <div style="flex-basis:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--cream2)">${pmEsc(p.motivo)}</span>
        <button class="btn btn-out btn-sm no-print" onclick="${desc ? 'depRestaurar' : 'depDescartar'}('${_depTab}','${pmEsc(p.a.id)}','${pmEsc(p.b.id)}')">${desc ? '↩ Restaurar' : '✓ No es duplicado'}</button>
      </div>
    </div>`;
  });
  if (visibles.length > DEP_MAX_PARES) {
    html += `<div class="card" style="font-size:12px;color:var(--cream2)">Se muestran los ${DEP_MAX_PARES} pares más parecidos de ${visibles.length}. Corrige estos y vuelve a analizar, o sube el umbral.</div>`;
  }
  box.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// DESCARTAR / RESTAURAR
// ═══════════════════════════════════════════════════════════

async function depDescartar(maestro, idA, idB) {
  const clave = depClave(idA, idB);
  const k = maestro + '|' + clave;
  _depDescartes.add(k);
  if (_depSbOk) {
    try {
      const r = await pmDB.insert('depuracion_descartes', { maestro, clave });
      const fila = Array.isArray(r) ? r[0] : r;
      if (fila && fila.id) _depDescIds[k] = fila.id;
    } catch (e) { console.warn('[depDescartar] Supabase falló, queda local:', e.message); }
  }
  _depGuardarLocal();
  depRender();
}

async function depRestaurar(maestro, idA, idB) {
  const k = maestro + '|' + depClave(idA, idB);
  _depDescartes.delete(k);
  if (_depDescIds[k]) {
    try { await pmDB.hardDelete('depuracion_descartes', _depDescIds[k]); }
    catch (e) { console.warn('[depRestaurar]', e.message); }
    delete _depDescIds[k];
  }
  _depGuardarLocal();
  depRender();
}

// ═══════════════════════════════════════════════════════════
// OTRAS REVISIONES (integridad básica de los maestros)
// ═══════════════════════════════════════════════════════════

function depOtras() {
  const sec = [];
  const add = (titulo, items, ayuda) => sec.push({ titulo, items, ayuda: ayuda || '' });
  const ing = _depDatos.ingredientes || [], rec = _depDatos.recetas || [];
  const cli = _depDatos.clientes || [], pro = _depDatos.productos || [];
  const nom = r => `${r.codigo || 'sin código'} · ${r.nombre || '(sin nombre)'}`;

  add('Ingredientes sin precio de referencia',
    ing.filter(r => !(Number(r.precio_ref) > 0)).map(nom),
    'El costeo de cualquier receta que los use queda subestimado.');

  add('Clientes sin código', cli.filter(r => !r.codigo).map(r => r.nombre || '(sin nombre)'),
    'Mismo caso que el cliente duplicado con y sin código.');
  add('Recetas sin código', rec.filter(r => !r.codigo).map(r => r.nombre || '(sin nombre)'));
  add('Productos terminados sin código', pro.filter(r => !r.codigo).map(r => r.nombre || '(sin nombre)'));

  // códigos repetidos dentro de un mismo maestro
  const dupCod = [];
  [['Ingredientes', ing], ['Recetas', rec], ['Clientes', cli], ['Productos', pro]].forEach(([n, filas]) => {
    const por = {};
    filas.forEach(r => { if (r.codigo) (por[r.codigo] = por[r.codigo] || []).push(r.nombre); });
    Object.keys(por).filter(c => por[c].length > 1).forEach(c => dupCod.push(`${n}: ${c} → ${por[c].join(' / ')}`));
  });
  add('Códigos repetidos', dupCod, 'Un código debe identificar un solo registro.');

  // formato de nombre dudoso
  const fmt = [];
  [['Ingrediente', ing], ['Receta', rec], ['Cliente', cli], ['Producto', pro]].forEach(([n, filas]) => {
    filas.forEach(r => {
      const s = r.nombre == null ? '' : String(r.nombre);
      if (!s.trim()) fmt.push(`${n} ${r.codigo || ''}: nombre vacío`);
      else if (s !== s.trim() || /\s{2,}/.test(s)) fmt.push(`${n}: "${s}" tiene espacios sobrantes`);
      else if (s.length > 3 && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s)) fmt.push(`${n}: "${s}" está todo en mayúsculas`);
    });
  });
  add('Nombres con formato dudoso', fmt);

  // productos que apuntan a una receta que no existe
  const codRec = new Set(rec.map(r => r.codigo).filter(Boolean));
  add('Productos cuya receta no existe',
    pro.filter(r => r.receta_cod && !codRec.has(r.receta_cod)).map(r => `${nom(r)} → receta ${r.receta_cod}`),
    'El código de receta del producto no coincide con ninguna receta activa.');

  // recetas sin ingredientes
  const conItems = new Set((_depItems || []).map(i => i.receta_id));
  add('Recetas sin ningún ingrediente', rec.filter(r => !conItems.has(r.id)).map(nom));

  // ingredientes de recetas: ligados a uno dado de baja / sin ligar al maestro
  const ingPorId = {};
  (_depDatos._ingTodos || []).forEach(r => { ingPorId[r.id] = r; });
  const recPorId = {};
  rec.forEach(r => { recPorId[r.id] = r; });
  const deBaja = [], sinLigar = {};
  (_depItems || []).forEach(it => {
    const r = recPorId[it.receta_id];
    if (!r) return;                                  // receta inactiva: no importa
    if (it.tipo && it.tipo !== 'ingrediente') return; // subrecetas / addons se ligan distinto
    if (it.ingrediente_id) {
      const g = ingPorId[it.ingrediente_id];
      if (!g) deBaja.push(`${r.codigo || ''} ${r.nombre}: ingrediente ${it.ingrediente_id} no existe`);
      else if (g.activo === false) deBaja.push(`${r.codigo || ''} ${r.nombre}: usa "${g.nombre}" (dado de baja)`);
    } else if (it.nombre_manual) {
      const key = depNorm(it.nombre_manual);
      if (!sinLigar[key]) sinLigar[key] = { nombre: it.nombre_manual, recetas: new Set() };
      sinLigar[key].recetas.add(r.codigo || r.nombre);
    }
  });
  add('Recetas que usan ingredientes dados de baja o inexistentes', deBaja);

  // para cada nombre sin ligar, sugerir el ingrediente del maestro más parecido
  const prepIng = ing.map(r => ({ r, p: depPrep(r.nombre) }));
  const sl = Object.values(sinLigar).map(o => {
    const p = depPrep(o.nombre);
    let mejor = null;
    prepIng.forEach(x => {
      const s = depSimilitud(p, x.p);
      if (!mejor || s.score > mejor.score) mejor = { score: s.score, nombre: x.r.nombre };
    });
    const sug = mejor && mejor.score >= 70 ? ` → ¿"${mejor.nombre}"? (${mejor.score})` : ' → sin parecido en el maestro';
    return `"${o.nombre}" en ${[...o.recetas].slice(0, 4).join(', ')}${o.recetas.size > 4 ? '…' : ''}${sug}`;
  });
  add('Ingredientes escritos a mano en recetas (sin ligar al maestro)', sl,
    'Quedan fuera de la actualización de precios y del renombrado automático del ingrediente.');

  return sec;
}

function depOtrasHTML() {
  const sec = depOtras();
  const total = sec.reduce((a, s) => a + s.items.length, 0);
  let html = `<div class="sec"><h2>Otras revisiones — ${total} hallazgos</h2></div>`;
  sec.forEach(s => {
    html += `<div class="card"><div class="ctitle">${s.items.length ? '⚠️' : '✅'} ${pmEsc(s.titulo)} (${s.items.length})</div>`;
    if (s.ayuda) html += `<div style="font-size:11px;color:var(--cream2);margin-bottom:6px">${pmEsc(s.ayuda)}</div>`;
    if (s.items.length) {
      html += '<div style="font-size:12px;line-height:1.55;max-height:260px;overflow:auto">' +
        s.items.slice(0, 200).map(t => '• ' + pmEsc(t)).join('<br>') +
        (s.items.length > 200 ? `<br>… y ${s.items.length - 200} más` : '') + '</div>';
    }
    html += '</div>';
  });
  return html;
}

// ═══════════════════════════════════════════════════════════
// EXPORTAR / IMPRIMIR
// ═══════════════════════════════════════════════════════════

// Filas planas de lo que se está viendo (pares o hallazgos)
function _depFilasExport() {
  if (_depTab === 'otras') {
    const filas = [['Revisión', 'Detalle']];
    depOtras().forEach(s => s.items.forEach(t => filas.push([s.titulo, t])));
    return filas;
  }
  const umbral = depUmbral();
  const pares = (_depResultados[_depTab] || []).filter(p =>
    p.score >= umbral && !_depDescartes.has(_depTab + '|' + depClave(p.a.id, p.b.id)));
  const filas = [['Puntaje', 'Código A', 'Nombre A', 'Código B', 'Nombre B', 'Motivo']];
  pares.forEach(p => filas.push([p.score, p.a.codigo || '', p.a.nombre || '', p.b.codigo || '', p.b.nombre || '', p.motivo]));
  return filas;
}

function depCSV() {
  if (!Object.keys(_depDatos).length) { pmToast('Primero presiona Analizar', 'err'); return; }
  const filas = _depFilasExport();
  const celda = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = '﻿' + filas.map(f => f.map(celda).join(';')).join('\r\n');   // BOM + ; para que Excel en español lo abra bien
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'depuracion_' + _depTab + '_' + pmHoy() + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function depImprimir() {
  if (!Object.keys(_depDatos).length) { pmToast('Primero presiona Analizar', 'err'); return; }
  const filas = _depFilasExport();
  const titulo = _depTab === 'otras' ? 'Otras revisiones' : DEP_MAESTROS[_depTab].label + ' — nombres parecidos (umbral ' + depUmbral() + ')';
  const tabla = '<table><thead><tr>' + filas[0].map(h => '<th>' + pmEsc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    filas.slice(1).map(f => '<tr>' + f.map(c => '<td>' + pmEsc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const w = window.open('', '_blank');
  if (!w) { pmToast('El navegador bloqueó la ventana de impresión', 'err'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Depuración</title>
    <style>body{font-family:Arial,sans-serif;font-size:11px;margin:16px}h1{font-size:15px;margin:0 0 4px}
    p{margin:0 0 10px;color:#555}table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:top}th{background:#eee}</style></head>
    <body><h1>Depuración de maestros — ${pmEsc(titulo)}</h1><p>${pmEsc(pmHoy())} · ${filas.length - 1} filas</p>${tabla}
    <script>window.onload=function(){window.print();}<\/script></body></html>`);
  w.document.close();
}
