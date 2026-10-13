// costos_core.js — Módulo de Costos · Entrega 2: Configuración y moneda
// Núcleo compartido del módulo (prefijo cst). Se carga ANTES que costos_empaques.js
// y los módulos de Costos que vengan después.
//
// Contiene:
// - Parámetros del módulo (cost_config, un solo registro): moneda ISO,
//   decimales de totales y de costos unitarios, regla de redondeo.
// - Formato de montos: cstMoney (totales) y cstMoneyU (costos unitarios),
//   más cstRound para redondear cálculos con la misma regla.
// - Utilidades comunes: _cstVal, _cstPh, _cstErr, _cstConflicto (optimistic locking).
// - La pantalla "⚙️ Parámetros" (cstCfg*).
//
// DISEÑO: independiente del núcleo de PanMaestro. Solo usa los métodos
// genéricos de pmDB y una tabla propia (cost_config, ver sql_costos_config.sql).
// Si la tabla no existe todavía, el módulo sigue funcionando con los valores
// de partida (CRC, 2 decimales, redondeo normal).
// Nota: pmMoney() del núcleo y las pantallas actuales de Costeo/Maestros siguen
// en ₡ hasta la entrega 9 (conexión); este archivo no las toca.

const CST_CFG_DEFECTO = {
  moneda_iso: 'CRC',
  decimales: 2,          // totales
  decimales_unit: 4,     // costos unitarios (por pieza / por kg)
  redondeo: 'normal',    // normal | arriba | abajo
  base_capa2: 'kg_ventas_normales',
  updated_at: null,
};

// Monedas elegibles (ISO 4217). Maestro fijo: no es dato del usuario.
const CST_MONEDAS = [
  { iso: 'CRC', nombre: 'Colón costarricense' },
  { iso: 'USD', nombre: 'Dólar estadounidense' },
  { iso: 'EUR', nombre: 'Euro' },
  { iso: 'MXN', nombre: 'Peso mexicano' },
  { iso: 'GTQ', nombre: 'Quetzal guatemalteco' },
  { iso: 'HNL', nombre: 'Lempira hondureño' },
  { iso: 'NIO', nombre: 'Córdoba nicaragüense' },
  { iso: 'PAB', nombre: 'Balboa panameño' },
  { iso: 'COP', nombre: 'Peso colombiano' },
  { iso: 'VES', nombre: 'Bolívar venezolano' },
  { iso: 'ARS', nombre: 'Peso argentino' },
  { iso: 'CLP', nombre: 'Peso chileno' },
  { iso: 'PEN', nombre: 'Sol peruano' },
  { iso: 'BRL', nombre: 'Real brasileño' },
  { iso: 'DOP', nombre: 'Peso dominicano' },
  { iso: 'UYU', nombre: 'Peso uruguayo' },
  { iso: 'BOB', nombre: 'Boliviano' },
  { iso: 'PYG', nombre: 'Guaraní paraguayo' },
  { iso: 'CAD', nombre: 'Dólar canadiense' },
  { iso: 'GBP', nombre: 'Libra esterlina' },
  { iso: 'CHF', nombre: 'Franco suizo' },
  { iso: 'JPY', nombre: 'Yen japonés' },
  { iso: 'CNY', nombre: 'Yuan chino' },
];

const CST_REDONDEOS = [
  { id: 'normal', nombre: 'Normal (0,5 sube)' },
  { id: 'arriba', nombre: 'Siempre hacia arriba' },
  { id: 'abajo',  nombre: 'Siempre hacia abajo' },
];

let _cstCfg = Object.assign({}, CST_CFG_DEFECTO);
let _cstCfgFila = false;      // true si cost_config tiene su registro (id=1)
let _cstCfgCargada = false;   // true si se leyó de Supabase al menos una vez
let _cstCfgError = '';        // mensaje si la tabla no existe todavía
let _cstBase = {};            // 'tabla:id' -> updated_at al abrir la edición
const _cstSimbolos = {};      // iso -> símbolo (caché)

// ── Símbolo y formato ───────────────────────────────────────
function cstSimbolo(iso) {
  if (_cstSimbolos[iso]) return _cstSimbolos[iso];
  let s = iso;
  try {
    let parts;
    try { parts = new Intl.NumberFormat('es-CR', { style: 'currency', currency: iso, currencyDisplay: 'narrowSymbol' }).formatToParts(1); }
    catch (e) { parts = new Intl.NumberFormat('es-CR', { style: 'currency', currency: iso }).formatToParts(1); }
    const p = parts.find(x => x.type === 'currency');
    if (p && p.value) s = p.value;
  } catch (e) { /* queda el código ISO */ }
  _cstSimbolos[iso] = s;
  return s;
}

// Redondea n a `dec` decimales con la regla `modo` (normal | arriba | abajo).
// "arriba"/"abajo" se miden en valor absoluto (alejándose / acercándose a cero),
// que es lo natural para costos. Limpia el ruido binario (1,005 → 1,01).
function cstRound(n, dec, modo) {
  const x = Number(n);
  if (!isFinite(x)) return 0;
  const d = dec === undefined ? _cstCfg.decimales : dec;
  const m = modo || _cstCfg.redondeo;
  const f = Math.pow(10, d);
  const y = Number((Math.abs(x) * f).toPrecision(14));
  let r;
  if (m === 'arriba') r = Math.ceil(y);
  else if (m === 'abajo') r = Math.floor(y);
  else r = Math.floor(y + 0.5);
  return (x < 0 ? -1 : 1) * r / f;
}

// Formato puro con una configuración dada (la usa la vista previa).
// min/max = decimales mínimo/máximo a mostrar; se redondea a max.
function cstFormat(n, cfg, min, max) {
  const mx = max === undefined ? min : max;
  const v = cstRound(n, mx, cfg.redondeo);
  const txt = Math.abs(v).toLocaleString('es-CR', { minimumFractionDigits: min, maximumFractionDigits: mx });
  const sim = cstSimbolo(cfg.moneda_iso);
  const sep = /[A-Za-z]$/.test(sim) ? ' ' : '';
  return (v < 0 ? '-' : '') + sim + sep + txt;
}

// Totales y montos en general (decimales configurados)
function cstMoney(n, min, max) {
  const mn = min === undefined ? _cstCfg.decimales : min;
  return cstFormat(n, _cstCfg, mn, max === undefined ? mn : Math.max(mn, max));
}

// Costos unitarios: muestra al menos los decimales de totales y, si hace falta,
// hasta los de costo unitario (los ceros sobrantes se omiten: ₡45,50 / ₡12,3456).
function cstMoneyU(n) {
  const mn = Math.min(_cstCfg.decimales, _cstCfg.decimales_unit);
  return cstFormat(n, _cstCfg, mn, _cstCfg.decimales_unit);
}

// ── Utilidades comunes del módulo ───────────────────────────
function _cstVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function _cstPh(icono, texto) {
  return `<div class="ph"><span class="ph-icon">${icono}</span>${texto}</div>`;
}

function _cstErr(e, archivoSql) {
  const m = String((e && e.message) || e || '');
  if (/PGRST205|42P01|does not exist/i.test(m)) {
    return 'Faltan tablas del módulo de Costos en Supabase — corré ' + (archivoSql || 'el SQL de la entrega (sql_costos_*.sql)');
  }
  if (/duplicate key|23505/i.test(m)) return 'Ya existe un registro con ese código';
  return m;
}

// Chequeo de conflicto de edición (optimistic locking). Devuelve true si
// detectó conflicto y abrió el modal — el llamador debe parar de guardar.
async function _cstConflicto(tabla, id, etiqueta, onRecargar, onReintentar) {
  const base = _cstBase[tabla + ':' + id];
  if (!base) return false;
  try {
    const actual = await pmDB.getById(tabla, id);
    if (actual && actual.updated_at && actual.updated_at !== base) {
      pmMostrarConflicto(
        `${etiqueta} fue modificado en otro dispositivo o pestaña mientras lo editabas.`,
        onRecargar,
        () => { _cstBase[tabla + ':' + id] = actual.updated_at; onReintentar(); }
      );
      return true;
    }
  } catch (e) { console.warn('[cst conflicto]', e.message); }
  return false;
}

// ── Carga de la configuración ───────────────────────────────
// Nunca bloquea: si falla, el módulo sigue con los valores de partida.
async function cstCfgCargar() {
  if (!pmDB.disponible()) return;
  try {
    const r = await pmDB.getById('cost_config', 1);
    _cstCfgError = '';
    _cstCfgFila = !!r;
    _cstCfg = Object.assign({}, CST_CFG_DEFECTO, r ? {
      moneda_iso: r.moneda_iso,
      decimales: Number(r.decimales),
      decimales_unit: Number(r.decimales_unit),
      redondeo: r.redondeo,
      base_capa2: r.base_capa2,
      updated_at: r.updated_at,
    } : {});
    _cstCfgCargada = true;
  } catch (e) {
    _cstCfgError = _cstErr(e, 'sql_costos_config.sql');
    console.warn('[cstCfgCargar]', e.message);
  }
}

// ── Pantalla ⚙️ Parámetros ───────────────────────────────────
async function cstCfgInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  cstCfgRender();
}

function cstCfgRender() {
  const selM = document.getElementById('cstcfg-moneda');
  if (!selM) return;
  selM.innerHTML = CST_MONEDAS.map(m =>
    `<option value="${m.iso}">${m.iso} — ${pmEsc(m.nombre)} (${pmEsc(cstSimbolo(m.iso))})</option>`).join('');
  // Si la moneda guardada no está en la lista (no debería), se agrega para no perderla
  if (!CST_MONEDAS.some(m => m.iso === _cstCfg.moneda_iso)) {
    selM.insertAdjacentHTML('afterbegin', `<option value="${pmEsc(_cstCfg.moneda_iso)}">${pmEsc(_cstCfg.moneda_iso)}</option>`);
  }
  selM.value = _cstCfg.moneda_iso;

  const opts = (desde, hasta) => { let h = ''; for (let i = desde; i <= hasta; i++) h += `<option value="${i}">${i}</option>`; return h; };
  document.getElementById('cstcfg-dec').innerHTML = opts(0, 4);
  document.getElementById('cstcfg-decu').innerHTML = opts(0, 6);
  document.getElementById('cstcfg-dec').value = String(_cstCfg.decimales);
  document.getElementById('cstcfg-decu').value = String(_cstCfg.decimales_unit);
  document.getElementById('cstcfg-redo').innerHTML = CST_REDONDEOS.map(r => `<option value="${r.id}">${pmEsc(r.nombre)}</option>`).join('');
  document.getElementById('cstcfg-redo').value = _cstCfg.redondeo;

  _cstBase['cost_config:1'] = _cstCfg.updated_at || '';

  const info = document.getElementById('cstcfg-info');
  if (info) {
    if (_cstCfgError) {
      info.innerHTML = `<span style="color:var(--red)">⚠️ ${pmEsc(_cstCfgError)}</span>`;
    } else if (_cstCfg.updated_at) {
      info.textContent = 'Última actualización: ' + new Date(_cstCfg.updated_at).toLocaleString('es-CR');
    } else {
      info.textContent = 'Valores de partida (todavía no guardaste cambios).';
    }
  }
  cstCfgPreview();
}

// Configuración que hay ahora mismo en el formulario (sin guardar)
function _cstCfgDelForm() {
  return {
    moneda_iso: _cstVal('cstcfg-moneda') || _cstCfg.moneda_iso,
    decimales: Number(_cstVal('cstcfg-dec')),
    decimales_unit: Number(_cstVal('cstcfg-decu')),
    redondeo: _cstVal('cstcfg-redo') || 'normal',
  };
}

function cstCfgPreview() {
  const box = document.getElementById('cstcfg-preview');
  if (!box) return;
  const c = _cstCfgDelForm();
  const aviso = c.decimales_unit < c.decimales
    ? `<div style="color:var(--red);font-size:12px;margin-top:6px">Los decimales de costo unitario no pueden ser menos que los de totales.</div>` : '';
  const minU = Math.min(c.decimales, c.decimales_unit);
  const fila = (txt, val) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--border,rgba(255,255,255,.08))"><span style="color:var(--cream2);font-size:12px">${txt}</span><b style="font-family:'DM Mono',monospace;color:var(--gold2);white-space:nowrap">${val}</b></div>`;
  box.innerHTML =
    fila('Total (1234567,895)', cstFormat(1234567.895, c, c.decimales, c.decimales)) +
    fila('Costo unitario (70,014567)', cstFormat(70.014567, c, minU, c.decimales_unit)) +
    fila('Costo unitario redondo (45,5)', cstFormat(45.5, c, minU, c.decimales_unit)) +
    fila('Redondeo de 2,345 a 2 decimales', cstFormat(2.345, c, 2, 2)) +
    aviso;
}

async function cstCfgSave() {
  const c = _cstCfgDelForm();
  if (!CST_REDONDEOS.some(r => r.id === c.redondeo)) { pmToast('Elegí una regla de redondeo', 'err'); return; }
  if (!/^[A-Z]{3}$/.test(c.moneda_iso)) { pmToast('Elegí una moneda de la lista', 'err'); return; }
  if (!(c.decimales >= 0 && c.decimales <= 4) || !(c.decimales_unit >= 0 && c.decimales_unit <= 6)) { pmToast('Decimales fuera de rango', 'err'); return; }
  if (c.decimales_unit < c.decimales) { pmToast('Los decimales de costo unitario no pueden ser menos que los de totales', 'err'); return; }
  if (c.moneda_iso !== _cstCfg.moneda_iso &&
      !confirm(`Vas a cambiar la moneda de ${_cstCfg.moneda_iso} a ${c.moneda_iso}.\n\nEsto NO convierte los montos ya cargados (empaques, etc.): solo cambia el símbolo y el formato con que se muestran. ¿Continuar?`)) return;

  if (_cstCfgFila && await _cstConflicto('cost_config', 1, 'Los parámetros de Costos', cstCfgInit, cstCfgSave)) return;

  const datos = { moneda_iso: c.moneda_iso, decimales: c.decimales, decimales_unit: c.decimales_unit, redondeo: c.redondeo };
  try {
    if (_cstCfgFila) await pmDB.update('cost_config', 1, datos);
    else await pmDB.insert('cost_config', Object.assign({ id: 1 }, datos));
    pmToast('✅ Parámetros guardados');
  } catch (e) {
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_config.sql'), 'err');
    return;
  }
  await cstCfgCargar();
  cstCfgRender();
  // Refresca las pantallas de Costos que ya estén cargadas con el nuevo formato
  if (typeof cstEmpRefrescarFormato === 'function') cstEmpRefrescarFormato();
}
