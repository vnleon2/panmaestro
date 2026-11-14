// mps_forecast.js — MPS · Rolling forecast (matriz de 12 meses por producto)
// Prefijo de función: mpf
//
// DISEÑO: el MPS como rolling forecast, con la misma matriz del Budget de ventas (Costos).
//   · Meses ya vividos: se llenan solos con lo realmente vendido (mps_venta_real), sin canales; no se editan.
//   · Mes en curso y siguientes: valen lo que diga el budget hasta que se corrijan a mano. Lo corregido
//     queda en mps_forecast (sql_mps_forecast.sql). Borrar la celda vuelve al budget.
//   · El budget NUNCA cambia solo: aquí solo se lee.
//   · Venta = producción (sin inventario). Muestra el desvío contra el budget y la capacidad de cada mes.
//   · Los canales (comercial, doméstico, feria) siguen en la hoja "Estimado del mes"; el reparto por canal
//     queda para un módulo de demand manager más adelante.
// Reutiliza de Costos: la carga de datos, el cálculo de capacidad (cstBudCalcular) y los grupos por categoría
// de mercadeo (costos_budget.js).

let _mpfInicio = '';      // 'AAAA-MM' del primer mes de la ventana (rolling)
let _mpfRows = [];        // mps_forecast
let _mpfReal = {};        // 'AAAA-MM' → { producto_id: unidades reales }
let _mpfReq = 0;

const _MPF_CEL = 'padding:4px 6px;border-bottom:1px solid #E2E8F0;font-size:12px';
const _MPF_MONO = ";text-align:right;font-family:'DM Mono',monospace;white-space:nowrap";
const _MPF_HEAD = 'font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)';

function _mpfHoy() { return pmHoy().slice(0, 7); }
function _mpfMeses() { return Array.from({ length: 12 }, (_, i) => _cstBudSumarMes(_mpfInicio, i)); }
function _mpfFila(pid, ym) { return _mpfRows.find(r => r.producto_id === pid && r.mes === ym) || null; }
function _mpfReal_(pid, ym) { return (_mpfReal[ym] && _mpfReal[ym][pid]) || 0; }

// Unidades de un producto en un mes: real si ya pasó; forecast corregido si existe; si no, el budget.
function mpfUnidades(pid, ym) {
  if (ym < _mpfHoy()) return _mpfReal_(pid, ym);
  const f = _mpfFila(pid, ym);
  return f ? Number(f.unidades) : _cstBudUn(pid, ym);
}
function mpfEsCorregido(pid, ym) { return ym >= _mpfHoy() && !!_mpfFila(pid, ym); }

// ── Carga ───────────────────────────────────────────────────
async function mpfCargar() {
  const root = document.getElementById('mpf-root');
  if (!root) return;
  const req = ++_mpfReq;
  if (!/^\d{4}-\d{2}$/.test(_mpfInicio)) _mpfInicio = _cstBudSumarMes(_mpfHoy(), -1);
  root.innerHTML = '<div class="ph"><span class="ph-icon">⏳</span>Cargando...</div>';
  if (!(await cstBudAsegurarCostos())) { root.innerHTML = '<div class="ph"><span class="ph-icon">⚠️</span>No se pudieron cargar los datos de Costos</div>'; return; }
  await cstBudCargarDatos();   // budget y categorías de mercadeo
  try {
    const r = await pmDB.get('mps_forecast');
    _mpfRows = (r || []).map(x => Object.assign({}, x, { mes: String(x.mes).slice(0, 7), unidades: Number(x.unidades) }));
  } catch (e) {
    _mpfRows = [];
    const falta = /PGRST205|Could not find the table|42P01|404/.test(e.message);
    if (falta) { root.innerHTML = '<div class="ph" style="flex-direction:column;gap:6px"><span class="ph-icon">⚠️</span>Falta la tabla del forecast. Corré <b>sql_mps_forecast.sql</b> en el editor SQL y recargá la pantalla.</div>'; return; }
    pmToast('⚠️ ' + e.message, 'err');
  }
  try {
    _mpfReal = await cstRealPorMes(_mpfInicio, _cstBudSumarMes(_mpfHoy(), 1));   // meses vividos y lo real a hoy del mes en curso
  } catch (e) { console.warn('[mpfCargar real]', e.message); _mpfReal = {}; }
  if (req !== _mpfReq) return;
  mpfRender();
}

function mpfNav(d) { _mpfInicio = _cstBudSumarMes(_mpfInicio, d); mpfCargar(); }
function mpfHoy() { _mpfInicio = _cstBudSumarMes(_mpfHoy(), -1); mpfCargar(); }

// ── Guardar ─────────────────────────────────────────────────
async function mpfSet(pid, ym, valor) {
  const txt = String(valor).trim();
  const ex = _mpfFila(pid, ym);
  try {
    if (txt === '') {   // celda vacía = volver al budget
      if (ex) { await pmDB.hardDelete('mps_forecast', ex.id); _mpfRows = _mpfRows.filter(x => x.id !== ex.id); }
    } else {
      const n = parseFloat(txt.replace(',', '.'));
      if (isNaN(n) || n < 0) { pmToast('Ingresá una cantidad de 0 o más', 'err'); mpfRender(); return; }
      if (ex) { await pmDB.update('mps_forecast', ex.id, { unidades: n }); ex.unidades = n; }
      else {
        const rows = await pmDB.insert('mps_forecast', { mes: ym + '-01', producto_id: pid, unidades: n });
        const nueva = (rows && rows[0]) || { id: 'tmp-' + Math.random() };
        nueva.mes = ym; nueva.producto_id = pid; nueva.unidades = n;
        _mpfRows.push(nueva);
      }
    }
  } catch (e) {
    console.warn('[mpfSet]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + e.message, 'err');
    await mpfCargar();
    return;
  }
  mpfTotales();
}

// Vuelve todo el forecast de los meses futuros al budget
async function mpfVolverBudget() {
  const futuras = _mpfRows.filter(r => r.mes >= _mpfHoy());
  if (!futuras.length) { pmToast('No hay nada corregido: ya todo es igual al budget'); return; }
  if (!confirm(`Se van a borrar ${futuras.length} corrección${futuras.length === 1 ? '' : 'es'} del forecast y esos meses vuelven a valer lo del budget. ¿Seguir?`)) return;
  try {
    await pmDB.hardDeleteMany('mps_forecast', futuras.map(r => r.id));
    _mpfRows = _mpfRows.filter(r => r.mes < _mpfHoy());
  } catch (e) { pmToast('⚠️ ' + e.message, 'err'); await mpfCargar(); return; }
  mpfRender();
}

// ── Pintado ─────────────────────────────────────────────────
function mpfRender() {
  const root = document.getElementById('mpf-root');
  if (!root) return;
  if (!_cstRutProd.length) { root.innerHTML = '<div class="ph"><span class="ph-icon">🍞</span>No hay productos activos en Maestros</div>'; return; }
  const meses = _mpfMeses();
  const hoy = _mpfHoy();
  const grupos = _cstBudGrupos(_cstRutProd.slice());
  const th = (t, r, extra) => `<th ${extra || ''} style="${_MPF_CEL};${r ? 'text-align:right' : 'text-align:left'};${_MPF_HEAD}">${t}</th>`;
  const encMes = ym => {
    const rot = ym < hoy ? 'real' : ym === hoy ? 'en curso' : 'forecast';
    return th(`${_cstBudMesTxt(ym)}<br><span style="font-weight:400;text-transform:none;letter-spacing:0">${rot}</span>`, 1);
  };
  const celda = (p, ym) => {
    if (ym < hoy) {
      const v = _mpfReal_(p.id, ym);
      return `<td style="${_MPF_CEL}${_MPF_MONO};background:#F1F5F9" title="Vendido real">${v > 0 ? _cstNum(v, 0) : '—'}</td>`;
    }
    const f = _mpfFila(p.id, ym), b = _cstBudUn(p.id, ym);
    const tip = `Budget: ${_cstNum(b, 0)}` + (ym === hoy ? ` · Real a hoy: ${_cstNum(_mpfReal_(p.id, ym), 0)}` : '');
    return `<td style="${_MPF_CEL}" title="${tip}"><input type="number" min="0" step="1" value="${f ? f.unidades : ''}" placeholder="${b > 0 ? b : '—'}" onchange="mpfSet('${p.id}','${ym}',this.value)" onfocus="this.select()" style="width:62px;text-align:right;${f ? 'font-weight:700' : ''}"></td>`;
  };
  const filas = grupos.map(g => `
    <tr style="background:#F1F5F9"><td style="${_MPF_CEL};font-weight:600">${pmEsc(g.nombre)}</td>${meses.map(() => `<td style="${_MPF_CEL}"></td>`).join('')}</tr>
    ${g.prods.map(p => `<tr><td style="${_MPF_CEL};white-space:nowrap">${pmEsc(p.nombre)}</td>${meses.map(ym => celda(p, ym)).join('')}</tr>`).join('')}`).join('');
  const pie = (id, lbl, bold) => `<tr style="background:#F8FAFC"><td style="${_MPF_CEL};font-weight:600">${lbl}</td>${meses.map((ym, i) => `<td style="${_MPF_CEL}${_MPF_MONO};${bold ? 'font-weight:600' : ''}" id="mpf-${id}-${i}">—</td>`).join('')}</tr>`;
  root.innerHTML = `
    <div class="card" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-out btn-sm" onclick="mpfNav(-1)">◀</button>
      <b style="min-width:210px;text-align:center">${_cstBudMesTxt(meses[0])} → ${_cstBudMesTxt(meses[11])}</b>
      <button class="btn btn-out btn-sm" onclick="mpfNav(1)">▶</button>
      <button class="btn btn-out btn-sm" onclick="mpfHoy()">Hoy</button>
      <span style="flex:1"></span>
      <button class="btn btn-out btn-sm" onclick="mpfVolverBudget()" title="Borra las correcciones de este y los próximos meses">↺ Volver todo al budget</button>
    </div>
    <div class="stats" id="mpf-stats"></div>
    <div id="mpf-avisos"></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="border-collapse:collapse;min-width:1000px;width:100%">
        <thead><tr>${th('Unidades por mes')}${meses.map(encMes).join('')}</tr></thead>
        <tbody>${filas}</tbody>
        <tfoot>
          ${pie('un', 'Total unidades (forecast)', 1)}
          ${pie('kg', 'Total kg de masa', 1)}
          ${pie('cap', 'Capacidad usada', 1)}
          ${pie('bud', 'Budget (unidades)')}
          ${pie('dev', 'Desvío contra el budget')}
        </tfoot>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">Los meses en gris son lo <b>realmente vendido</b> y no se editan. Del mes en curso en adelante, la celda vale lo que diga el <b>budget</b> (el número gris de fondo) hasta que escribas otro; en negrita lo corregido. Si la dejás vacía vuelve al budget. El budget no cambia solo. El reparto por canal sigue en «Estimado del mes».</div>`;
  mpfTotales();
}

function mpfTotales() {
  const meses = _mpfMeses();
  const hoy = _mpfHoy();
  const C = cstBudCalcular(mpfUnidades, meses);
  const set = (id, html, color, title) => { const el = document.getElementById(id); if (el) { el.innerHTML = html; el.style.color = color || ''; el.title = title || ''; } };
  const col = { ok: 'var(--green,#22A06B)', medio: '#B45309', alto: 'var(--red)' };
  const exceden = [];
  C.porMes.forEach((m, i) => {
    set(`mpf-un-${i}`, m.un > 0 ? _cstNum(m.un, 0) : '—');
    set(`mpf-kg-${i}`, m.kg > 0 ? _cstNum(m.kg, 1) : '—');
    const nv = _cstBudNivel(m.uso);
    set(`mpf-cap-${i}`, m.un > 0 && m.uso !== null ? _cstFmtPct(m.uso) : '—', nv && m.un > 0 ? col[nv] : '', m.un > 0 && m.donde ? 'Limita: ' + m.donde : '');
    if (m.ym >= hoy && m.un > 0 && m.uso !== null && m.uso > 100) exceden.push(m);
    const bud = _cstRutProd.reduce((a, p) => a + _cstBudUn(p.id, m.ym), 0);
    set(`mpf-bud-${i}`, bud > 0 ? _cstNum(bud, 0) : '—');
    const dev = bud > 0 ? (m.un - bud) / bud * 100 : null;
    set(`mpf-dev-${i}`, dev === null ? '—' : (dev > 0 ? '+' : '') + _cstNum(dev, 1) + ' %', dev === null || Math.abs(dev) < 0.05 ? '' : dev < 0 ? '#B45309' : 'var(--green,#22A06B)', dev === null ? '' : `${_cstNum(m.un - bud, 0)} unidades`);
  });
  const fut = C.porMes.filter(m => m.ym >= hoy && m.kg > 0);
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const real = C.porMes.filter(m => m.ym < hoy && m.un > 0);
  const stats = document.getElementById('mpf-stats');
  if (stats) {
    const kgFut = fut.reduce((a, m) => a + m.kg, 0);
    stats.innerHTML =
      stat('Meses vividos con venta', String(real.length), real.length ? `${_cstNum(real.reduce((a, m) => a + m.un, 0), 0)} unidades reales` : 'sin ventas reales en la ventana') +
      stat('Forecast de lo que viene', kgFut > 0 ? _cstNum(kgFut, 0) + ' kg' : '—', fut.length ? `${fut.length} mes${fut.length === 1 ? '' : 'es'} con unidades` : '') +
      stat('Meses que exceden la capacidad', C.hayTarifas ? String(exceden.length) : '—', C.hayTarifas ? (exceden.length ? exceden.map(m => _cstBudMesTxt(m.ym)).join(', ') : 'ninguno') : 'falta un período con capacidad');
  }
  const av = [];
  if (!C.hayTarifas) av.push({ r: 0, t: 'No hay un período con capacidad cargada en Costos: no se puede medir la capacidad (se define en Capacidad y reparto).' });
  exceden.forEach(m => av.push({ r: 1, t: `${_cstBudMesTxt(m.ym)}: el forecast usa ${_cstFmtPct(m.uso)} de la capacidad (${m.donde}).` }));
  if (C.sinMasa.length) av.push({ r: 0, t: `Sin masa por pieza (no suman kg): ${C.sinMasa.slice(0, 5).map(p => p.nombre).join(', ')}${C.sinMasa.length > 5 ? ` y ${C.sinMasa.length - 5} más` : ''}.` });
  const avEl = document.getElementById('mpf-avisos');
  if (avEl) {
    const rojo = av.some(a => a.r);
    avEl.innerHTML = av.length ? `<div class="card" style="border-color:${rojo ? 'var(--red)' : '#B45309'}"><div class="ctitle" style="color:${rojo ? 'var(--red)' : '#B45309'}">Revisar</div>${av.map(a => `<div style="font-size:12px;margin-bottom:3px;color:${a.r ? 'var(--red)' : '#B45309'}">⚠ ${pmEsc(a.t)}</div>`).join('')}</div>` : '';
  }
}
