// costos_consulta.js — Módulo de Costos · Consulta de tipos de pan y galleta (costo estándar)
// Prefijo cst (cstCon = pantalla; el cálculo lo hace cstRepCalcular de costos_reportes.js)
// Depende de costos_core.js, costos_empaques.js, costos_maestros.js, costos_personal.js,
// costos_laboral.js, costos_gastos.js, costos_capacidad.js, costos_rutas.js, costos_tasas.js
// y costos_reportes.js.
//
// DISEÑO: SOLO LECTURA. Es la misma consulta que Maestros → "Tipos de pan" y "Tipos galleta"
// (código, nombre, precio · peso, receta, ₡/g, costo, margen), pero el costo NO sale de
// receta + % de MOD + % de gastos: sale del sistema de costeo nuevo, o sea
//   materiales (receta, con su merma) + empaque + MOD + CIF + gasto del período.
// No escribe nada ni toca Maestros. Maestros sigue mostrando el costo de hoy.
// La fórmula del margen es la misma de Maestros: (precio de lista − costo) ÷ precio de lista.

let _cstConTab = 'pan';   // 'pan' | 'galleta'

// ── Carga ───────────────────────────────────────────────────
async function cstConInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  try {
    await cstPersonalDatos();
    await cstPerCargar();
    await cstRutDatos();
  } catch (e) {
    console.warn('[cstConInit]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql, sql_costos_personal.sql, sql_costos_gastos.sql, sql_costos_rutas.sql y sql_costos_tarifas.sql'), 'err');
    return;
  }
  await cstEmpCargarMaestros();   // empaques y su asignación a cada producto
  cstPerInicial();
  await cstTasCargar();
  cstPerLlenarSelectId('cstco-periodo');
  cstConRender();
}

async function cstConElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstConRender();
}

function cstConTab(tab, btn) {
  _cstConTab = tab === 'galleta' ? 'galleta' : 'pan';
  document.querySelectorAll('#cstco-pills .pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  cstConRender();
}

// ── Pintado ─────────────────────────────────────────────────
const _CST_CO_DIM = '<div style="font-size:10px;color:var(--cream2);opacity:.4">—</div>';
const _CST_CO_MONO = "font-family:'DM Mono',monospace";

function _cstConDesglose(f) {
  const d = (n, v) => v === null || v === undefined ? null : `${n} ${cstMoneyU(v)}`;
  return [d('Materiales', f.mat), d('Empaque', f.emp), d('MOD', f.mod), d('CIF fija', f.fija), d('CIF variable', f.vari), d('Gasto del período', f.capa2)]
    .filter(Boolean).join(' · ');
}

function cstConRender() {
  const per = _cstPerActual();
  const estEl = document.getElementById('cstco-estado');
  const listEl = document.getElementById('cstco-lista');
  const cntEl = document.getElementById('cstco-count');
  const notaEl = document.getElementById('cstco-nota');
  if (!estEl || !listEl || !cntEl || !notaEl) return;
  if (!per) {
    estEl.textContent = ''; notaEl.innerHTML = ''; cntEl.textContent = '';
    listEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral y cargá sus datos');
    return;
  }
  const guardado = per.estado !== 'borrador';
  estEl.innerHTML = `<span class="badge ${guardado ? 'b3' : 'b0'}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${guardado ? 'Tarifas aprobadas y congeladas' : 'Tarifas calculadas en vivo con los datos del período'}</span>`;

  const q = _cstVal('cstco-buscar').toLowerCase().trim();
  const esGall = _cstConTab === 'galleta';
  const todas = cstRepCalcular().filter(f => f.p.tipo === _cstConTab);
  const filas = todas
    .filter(f => !q || (f.p.nombre || '').toLowerCase().includes(q) || (f.p.codigo || '').toLowerCase().includes(q))
    .sort((a, b) => (a.p.codigo || '').localeCompare(b.p.codigo || '', 'es', { numeric: true }));
  cntEl.textContent = (esGall ? 'Tipos galleta' : 'Tipos de pan') + ` (${filas.length})`;

  listEl.innerHTML = filas.map(f => {
    const p = f.p;
    const peso = Number(p.peso_g) || 0;
    const precio = Number(p.precio_full) || 0;
    const costo = f.total;                                  // por pieza, null si falta algo
    const cpg = costo !== null && peso > 0 ? costo / peso : null;
    const margen = costo !== null && precio > 0 ? (precio - costo) / precio * 100 : null;
    const piezas = esGall && f.m && f.m.ok && peso > 0 ? Math.floor(f.m.receta.totalMass / peso) : null;

    const recBadge = p.receta_cod
      ? `<div style="${_CST_CO_MONO};font-size:10px;color:var(--blue);background:rgba(74,128,192,.12);padding:2px 7px;border-radius:10px;border:1px solid rgba(74,128,192,.3)">${pmEsc(p.receta_cod)}</div>`
      : _CST_CO_DIM;
    const piezasCell = esGall
      ? (piezas !== null ? `<div style="${_CST_CO_MONO};font-size:10px;color:var(--cream2)">${piezas} pzs</div>` : _CST_CO_DIM)
      : '';
    const cpgCell = cpg !== null
      ? `<div style="${_CST_CO_MONO};font-size:10px;color:var(--cream2)">${cstMoney(cpg, 2)}/g</div>`
      : _CST_CO_DIM;
    // Galletas son baratas: debajo de 100 se muestra un decimal para no perder precisión (igual que Maestros)
    const costoTxt = costo === null ? '' : (esGall && costo < 100 ? cstMoney(costo, 1) : cstMoney(Math.round(costo), 0));
    const costoCell = costo !== null
      ? `<div title="${pmEsc(_cstConDesglose(f))}" style="${_CST_CO_MONO};font-size:11px;color:var(--gold2);font-weight:600;cursor:help">${costoTxt}</div>`
      : _CST_CO_DIM;
    const margenColor = margen === null ? 'var(--cream2)' : margen >= 40 ? 'var(--green)' : margen >= 20 ? 'var(--amber)' : 'var(--red)';
    const margenCell = margen !== null
      ? `<div style="${_CST_CO_MONO};font-size:11px;color:${margenColor};font-weight:600">${margen.toFixed(1)}%</div>`
      : _CST_CO_DIM;
    const aviso = costo === null && f.avisos.length
      ? `<span title="${pmEsc(f.avisos.join(' · '))}" style="color:var(--red);margin-left:4px;cursor:help">⚠</span>` : '';
    return `
    <div class="item-row">
      <div style="${_CST_CO_MONO};font-size:10px;color:var(--gold3);min-width:44px">${pmEsc(p.codigo || '')}</div>
      <div class="item-name">${pmEsc(p.nombre || '')}${aviso}</div>
      <div class="item-meta">${cstMoney(precio, 0)} · ${peso}g</div>
      ${recBadge}
      ${piezasCell}
      ${cpgCell}
      ${costoCell}
      ${margenCell}
    </div>`;
  }).join('') || `<div class="ph"><span class="ph-icon">${esGall ? '🍪' : '🍞'}</span>${esGall ? 'Sin tipos de galleta' : 'Sin tipos de pan'}</div>`;

  const incompletos = todas.filter(f => f.total === null).length;
  notaEl.innerHTML = `Costo por pieza del <b>costo estándar</b>: materiales (receta con su merma) + empaque + mano de obra + carga fabril + gasto del período. Pasá el cursor sobre el costo para ver el desglose.`
    + (incompletos ? ` <span style="color:var(--red)">${incompletos} sin costo completo (marcados con ⚠ o «—»): ver el detalle en <b>Reportes de costo</b>.</span>` : '');
}
