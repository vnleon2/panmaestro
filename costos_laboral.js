// costos_laboral.js — Módulo de Costos · Entrega 4: Períodos y costo laboral
// Prefijo cst (cstPer = períodos, cstLab = nómina del período)
// Depende de costos_core.js, costos_maestros.js y costos_personal.js.
//
// DISEÑO: independiente del núcleo de PanMaestro. Tablas propias cost_periodos y
// cost_nomina_lineas (sql_costos_personal.sql).
// - Un período es la cabecera de todo lo que se carga por período (nómina hoy;
//   gastos y capacidad en la entrega 5). Estado: borrador → aprobado → cerrado
//   (la aprobación llega en la entrega 7; por ahora todo es borrador y editable).
// - La nómina del período se GENERA desde los maestros (sueldo base y conceptos) y
//   queda guardada: cambios posteriores en los maestros no la alteran, salvo que
//   se pida regenerarla. Cada monto se puede ajustar a mano (horas extra, ausencias...).
// - El resumen reparte el costo de cada persona por su % de tiempo en cada
//   departamento y lo clasifica: MOD (productivo), MOI (apoyo) o gasto del período.
// - HH productivas = horas pagadas × meses × % de utilización × % de tiempo (solo productivos).
//   Costo por HH = MOD ÷ HH productivas (referencia; la tarifa oficial la fija el motor, entrega 7).

let _cstPeriodos = [];   // todos los períodos
let _cstPerSel = '';     // id del período seleccionado
let _cstLineas = [];     // nómina del período seleccionado

const CST_PER_LS = 'cst_periodo_sel';

// ── Períodos ────────────────────────────────────────────────
function _cstPerActual() { return _cstPeriodos.find(p => p.id === _cstPerSel) || null; }
function _cstPerEditable() { const p = _cstPerActual(); return !!p && p.estado === 'borrador'; }

function _cstPerTxt(p) {
  const est = p.estado === 'borrador' ? '' : ' · ' + p.estado;
  return `${p.codigo} · v${p.version}${est} (${Number(p.meses)} ${Number(p.meses) === 1 ? 'mes' : 'meses'})`;
}

// Propone el siguiente mes sin período: código AAAA-MM, primer y último día
function cstPerSugerir() {
  if (_cstVal('cstper-codigo')) return;
  const hoy = pmHoy();
  let y = parseInt(hoy.slice(0, 4), 10), m = parseInt(hoy.slice(5, 7), 10);
  const usado = cod => _cstPeriodos.some(p => p.codigo === cod);
  for (let i = 0; i < 24 && usado(`${y}-${String(m).padStart(2, '0')}`); i++) { m++; if (m > 12) { m = 1; y++; } }
  const mm = String(m).padStart(2, '0');
  const ultimo = new Date(y, m, 0).getDate();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('cstper-codigo', `${y}-${mm}`);
  set('cstper-inicio', `${y}-${mm}-01`);
  set('cstper-fin', `${y}-${mm}-${String(ultimo).padStart(2, '0')}`);
  set('cstper-meses', '1');
}

async function cstPerCargar() {
  const r = await pmDB.get('cost_periodos');
  _cstPeriodos = (r || []).sort((a, b) => (b.inicio || '').localeCompare(a.inicio || '') || b.version - a.version);
}

function cstPerLlenarSelect() {
  const sel = document.getElementById('cstlab-periodo');
  if (!sel) return;
  sel.innerHTML = _cstPeriodos.length
    ? _cstPeriodos.map(p => `<option value="${p.id}">${pmEsc(_cstPerTxt(p))}</option>`).join('')
    : '<option value="">— Sin períodos: creá el primero —</option>';
  if (_cstPerSel) sel.value = _cstPerSel;
}

async function cstPerElegir(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* sin almacenamiento: no pasa nada */ }
  const sel = document.getElementById('cstlab-periodo');
  if (sel && sel.value !== _cstPerSel) sel.value = _cstPerSel;
  await cstLabCargarLineas();
  cstLabRender();
}

async function cstPerNuevo() {
  const codigo = _cstNorm(_cstVal('cstper-codigo'));
  const inicio = _cstVal('cstper-inicio');
  const fin = _cstVal('cstper-fin');
  const meses = parseFloat(_cstVal('cstper-meses'));
  if (!codigo) { pmToast('Escribí el código del período (ej. 2026-11)', 'err'); return; }
  if (!inicio || !fin) { pmToast('Indicá la fecha de inicio y la de fin', 'err'); return; }
  if (fin < inicio) { pmToast('La fecha de fin no puede ser anterior a la de inicio', 'err'); return; }
  if (!(meses > 0 && meses <= 12)) { pmToast('Los meses del período van entre 0,5 y 12', 'err'); return; }
  if (_cstPeriodos.some(p => p.codigo === codigo)) { pmToast(`Ya existe el período ${codigo}`, 'err'); return; }
  try {
    const rows = await pmDB.insert('cost_periodos', { codigo, version: 1, inicio, fin, meses });
    document.getElementById('cstper-codigo').value = '';
    await cstPerCargar();
    _cstPerSel = (rows && rows[0] && rows[0].id) || '';
    try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
    pmToast('Período creado ✓ — ahora generá su nómina');
    await cstLabCargarLineas();
    cstPerLlenarSelect();
    cstPerSugerir();
    cstLabRender();
  } catch (e) {
    console.warn('[cstPerNuevo]', e.message);
    pmToast('⚠️ No se pudo crear el período: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

async function cstPerEliminar() {
  const p = _cstPerActual();
  if (!p) return;
  if (p.estado !== 'borrador') { pmToast('Solo se puede eliminar un período en borrador', 'err'); return; }
  const n = _cstLineas.length;
  if (!confirm(`¿Eliminar el período ${p.codigo}? Se borran también sus ${n} línea${n === 1 ? '' : 's'} de nómina. Esto no se puede deshacer.`)) return;
  try {
    await pmDB.hardDelete('cost_periodos', p.id);
    await cstPerCargar();
    _cstPerSel = _cstPeriodos.length ? _cstPeriodos[0].id : '';
    try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
    pmToast('Período eliminado');
    await cstLabCargarLineas();
    cstPerLlenarSelect();
    cstPerSugerir();
    cstLabRender();
  } catch (e) {
    console.warn('[cstPerEliminar]', e.message);
    pmToast('⚠️ No se pudo eliminar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

// ── Pantalla ────────────────────────────────────────────────
async function cstLabInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  try {
    await cstPersonalDatos();
    await cstPerCargar();
  } catch (e) {
    console.warn('[cstLabInit]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql y sql_costos_personal.sql'), 'err');
    return;
  }
  let guardado = '';
  try { guardado = localStorage.getItem(CST_PER_LS) || ''; } catch (e) { /* ok */ }
  const quedo = _cstPeriodos.some(p => p.id === _cstPerSel) ? _cstPerSel : guardado;
  _cstPerSel = _cstPeriodos.some(p => p.id === quedo) ? quedo : (_cstPeriodos[0] ? _cstPeriodos[0].id : '');
  await cstLabCargarLineas();
  cstPerLlenarSelect();
  cstPerSugerir();
  cstLabRender();
}

async function cstLabCargarLineas() {
  if (!_cstPerSel) { _cstLineas = []; return; }
  try {
    const r = await pmDB.get('cost_nomina_lineas', { periodo_id: _cstPerSel });
    _cstLineas = (r || []).map(l => Object.assign({}, l, { monto: Number(l.monto) }));
  } catch (e) {
    console.warn('[cstLabCargarLineas]', e.message);
    _cstLineas = [];
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
  }
}

// ── Generación de la nómina ─────────────────────────────────
async function cstLabGenerar(regenerar) {
  const per = _cstPerActual();
  if (!per) { pmToast('Elegí o creá un período', 'err'); return; }
  if (per.estado !== 'borrador') { pmToast('El período no está en borrador', 'err'); return; }
  const colabs = _cstColabs.filter(c => c.activo !== false);
  const conceptos = cstConceptosActivos();
  if (!colabs.length) { pmToast('No hay colaboradores activos — cargalos en Personal', 'err'); return; }
  if (!conceptos.length) { pmToast('No hay conceptos de nómina activos', 'err'); return; }
  const meses = Number(per.meses);
  const nuevas = [], cambios = [];
  colabs.forEach(c => conceptos.forEach(k => {
    const monto = cstRound(cstMontoConcepto(c, k) * meses, 4, 'normal');
    const ex = _cstLineas.find(l => l.colaborador_id === c.id && l.concepto_id === k.id);
    if (!ex) nuevas.push({ periodo_id: per.id, colaborador_id: c.id, concepto_id: k.id, monto });
    else if (regenerar && Math.abs(Number(ex.monto) - monto) > 0.00005) cambios.push({ id: ex.id, monto });
  }));
  if (!nuevas.length && !cambios.length) { pmToast(regenerar ? 'Nada que recalcular: los montos ya coinciden con los maestros' : 'La nómina ya está completa'); return; }
  if (cambios.length && !confirm(`Se van a recalcular ${cambios.length} línea${cambios.length === 1 ? '' : 's'} con los valores actuales de los maestros, y se pierden los ajustes manuales que hayas hecho en ellas. ¿Continuar?`)) return;
  try {
    if (nuevas.length) await pmDB.insert('cost_nomina_lineas', nuevas, false);
    for (const c of cambios) await pmDB.update('cost_nomina_lineas', c.id, { monto: c.monto });
    await cstLabCargarLineas();
    cstLabRender();
    pmToast(`Nómina generada ✓ (${nuevas.length} línea${nuevas.length === 1 ? '' : 's'} nueva${nuevas.length === 1 ? '' : 's'}${cambios.length ? ', ' + cambios.length + ' recalculada' + (cambios.length === 1 ? '' : 's') : ''})`);
  } catch (e) {
    console.warn('[cstLabGenerar]', e.message);
    pmToast('⚠️ No se pudo generar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
    await cstLabCargarLineas();
    cstLabRender();
  }
}

async function cstLabSetMonto(lineaId, valor) {
  if (!_cstPerEditable()) { pmToast('El período no está en borrador', 'err'); return; }
  const l = _cstLineas.find(x => x.id === lineaId);
  if (!l) return;
  const monto = parseFloat(valor);
  if (valor === '' || isNaN(monto) || monto < 0) { pmToast('Ingresá un monto de 0 o más', 'err'); cstLabRender(); return; }
  try {
    await pmDB.update('cost_nomina_lineas', lineaId, { monto: cstRound(monto, 4, 'normal') });
    await cstLabCargarLineas();
    cstLabRender();
  } catch (e) {
    console.warn('[cstLabSetMonto]', e.message);
    pmToast('⚠️ No se pudo guardar: ' + _cstErr(e, 'sql_costos_personal.sql'), 'err');
    await cstLabCargarLineas();
    cstLabRender();
  }
}

// ── Resumen del período ─────────────────────────────────────
// Reparte el costo de cada persona por su % de tiempo y lo clasifica.
function cstLabResumen() {
  const per = _cstPerActual();
  const meses = per ? Number(per.meses) : 1;
  const porDepto = {};
  const tot = { MOD: 0, MOI: 0, GASTO: 0, sinAsignar: 0, hh: 0 };
  const avisos = [];
  const porColab = {};
  _cstLineas.forEach(l => { porColab[l.colaborador_id] = (porColab[l.colaborador_id] || 0) + Number(l.monto); });
  Object.keys(porColab).forEach(colId => {
    const c = _cstColabs.find(x => x.id === colId);
    const monto = porColab[colId];
    const nombre = c ? c.nombre : '(colaborador eliminado)';
    const rep = cstRepartoDe(colId);
    if (!c || !rep.length) {
      tot.sinAsignar += monto;
      avisos.push(`${nombre}: no tiene reparto de tiempo — su costo no se asigna a ningún departamento`);
      return;
    }
    if (!_cstRepartoOk(colId)) avisos.push(`${nombre}: el reparto de tiempo suma ${_cstFmtPct(cstRepartoSuma(colId))}, no 100 %`);
    rep.forEach(r => {
      const d = _cstDeps.find(x => x.id === r.depto_id);
      if (!d) return;
      if (!porDepto[d.id]) porDepto[d.id] = { depto: d, costo: 0, hh: 0 };
      const parte = monto * r.pct / 100;
      const hh = cstHHDepto(c, r) * meses;
      porDepto[d.id].costo += parte;
      porDepto[d.id].hh += hh;
      tot[cstTratamiento(d.tipo)] += parte;
      tot.hh += hh;
    });
  });
  const sinNomina = _cstColabs.filter(c => c.activo !== false && !porColab[c.id]);
  if (_cstLineas.length && sinNomina.length) {
    avisos.push(`${sinNomina.length} colaborador${sinNomina.length === 1 ? '' : 'es'} activo${sinNomina.length === 1 ? '' : 's'} sin nómina en este período (${sinNomina.map(c => c.nombre).join(', ')}) — usá "Generar nómina"`);
  }
  return { porDepto, tot, avisos, porColab };
}

function cstLabRender() {
  const per = _cstPerActual();
  const estEl = document.getElementById('cstlab-estado');
  const stats = document.getElementById('cstlab-stats');
  const deptosEl = document.getElementById('cstlab-deptos');
  const avisosEl = document.getElementById('cstlab-avisos');
  const colabsEl = document.getElementById('cstlab-colabs');
  if (!stats || !deptosEl || !colabsEl) return;
  const btns = ['cstlab-btn-gen', 'cstlab-btn-regen', 'cstlab-btn-del'].map(i => document.getElementById(i));
  btns.forEach(b => { if (b) b.disabled = !per || per.estado !== 'borrador'; });

  if (!per) {
    if (estEl) estEl.textContent = '';
    stats.innerHTML = ''; avisosEl.innerHTML = '';
    deptosEl.innerHTML = _cstPh('📅', 'Creá el primer período para cargar la nómina');
    colabsEl.innerHTML = '';
    return;
  }
  if (estEl) {
    const col = per.estado === 'borrador' ? 'b0' : 'b3';
    estEl.innerHTML = `<span class="badge ${col}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${pmEsc(per.inicio)} → ${pmEsc(per.fin)}</span>`;
  }
  const rs = cstLabResumen();
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const total = Object.values(rs.porColab).reduce((a, x) => a + x, 0);   // suma real de las líneas (aunque un reparto no cuadre)
  const modHH = rs.tot.hh > 0 ? rs.tot.MOD / rs.tot.hh : null;
  stats.innerHTML = _cstLineas.length
    ? stat('Nómina del período', cstMoney(total), `${Object.keys(rs.porColab).length} persona${Object.keys(rs.porColab).length === 1 ? '' : 's'}`) +
      stat('MOD', cstMoney(rs.tot.MOD), 'mano de obra directa') +
      stat('MOI', cstMoney(rs.tot.MOI), 'mano de obra indirecta') +
      stat('Gasto del período', cstMoney(rs.tot.GASTO), 'venta · mercadeo · admin.') +
      stat('HH productivas', rs.tot.hh.toLocaleString('es-CR', { maximumFractionDigits: 1 }), 'en departamentos productivos') +
      stat('MOD por HH', modHH === null ? '—' : cstMoneyU(modHH), 'referencia')
    : '';
  avisosEl.innerHTML = rs.avisos.length
    ? `<div class="card" style="border-color:var(--red)"><div class="ctitle" style="color:var(--red)">Revisar</div>${rs.avisos.map(a => `<div style="font-size:12px;margin-bottom:3px">⚠ ${pmEsc(a)}</div>`).join('')}</div>`
    : '';

  // Tabla por departamento
  const filas = Object.values(rs.porDepto).sort((a, b) => a.depto.codigo.localeCompare(b.depto.codigo, 'es', { numeric: true }));
  const celda = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
  deptosEl.innerHTML = filas.length ? `
    <div class="sec"><h2>Costo laboral por departamento</h2></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:560px">
        <thead><tr style="text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)">
          <th style="${celda}">Departamento</th><th style="${celda}">Tratamiento</th>
          <th style="${celda};text-align:right">Costo laboral</th><th style="${celda};text-align:right">HH productivas</th><th style="${celda};text-align:right">Costo por HH</th>
        </tr></thead>
        <tbody>${filas.map(f => {
          const t = cstTratamiento(f.depto.tipo);
          return `<tr>
            <td style="${celda}">${pmEsc(f.depto.codigo)} · ${pmEsc(f.depto.nombre)}</td>
            <td style="${celda}">${t === 'GASTO' ? 'Gasto del período' : t}</td>
            <td style="${celda};text-align:right;font-family:'DM Mono',monospace">${cstMoney(f.costo)}</td>
            <td style="${celda};text-align:right;font-family:'DM Mono',monospace">${f.hh ? f.hh.toLocaleString('es-CR', { maximumFractionDigits: 1 }) : '—'}</td>
            <td style="${celda};text-align:right;font-family:'DM Mono',monospace">${f.hh ? cstMoneyU(f.costo / f.hh) : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '';

  // Detalle por colaborador
  const ids = Object.keys(rs.porColab).sort((a, b) => {
    const ca = _cstColabs.find(x => x.id === a), cb = _cstColabs.find(x => x.id === b);
    return (ca ? ca.codigo : '').localeCompare(cb ? cb.codigo : '', 'es', { numeric: true });
  });
  const editable = per.estado === 'borrador';
  const st = 'width:130px;padding:4px 8px;background:var(--sf);border:1px solid #CBD5E1;border-radius:6px;font-size:12px;text-align:right;font-family:\'DM Mono\',monospace';
  colabsEl.innerHTML = ids.length ? `
    <div class="sec"><h2>Nómina por colaborador</h2></div>` + ids.map(colId => {
      const c = _cstColabs.find(x => x.id === colId);
      const lineas = _cstLineas.filter(l => l.colaborador_id === colId)
        .sort((a, b) => {
          const ka = _cstConceptos.find(x => x.id === a.concepto_id), kb = _cstConceptos.find(x => x.id === b.concepto_id);
          return ((ka && ka.orden) || 0) - ((kb && kb.orden) || 0);
        });
      return `
      <div class="card" style="padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <div><span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--gold3)">${c ? pmEsc(c.codigo) : ''}</span>
            <b style="margin-left:6px">${pmEsc(c ? c.nombre : '(colaborador eliminado)')}</b>
            <span style="font-size:11px;color:var(--cream2);margin-left:6px">${c ? _cstTratamientoHtml(c.id) : ''}</span></div>
          <b style="font-family:'DM Mono',monospace;color:var(--gold2)">${cstMoney(rs.porColab[colId])}</b>
        </div>
        ${lineas.map(l => {
          const k = _cstConceptos.find(x => x.id === l.concepto_id);
          return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:3px 0;border-bottom:1px dashed #E2E8F0;font-size:12px">
            <span style="color:var(--cream2)">${pmEsc(k ? k.nombre : '—')}</span>
            ${editable
              ? `<input type="number" min="0" step="any" id="cstlin-${l.id}" value="${l.monto}" onchange="cstLabSetMonto('${l.id}', this.value)" style="${st}">`
              : `<b style="font-family:'DM Mono',monospace">${cstMoney(l.monto)}</b>`}
          </div>`;
        }).join('')}
      </div>`;
    }).join('') : (rs.avisos.length ? '' : _cstPh('💵', 'Todavía no hay nómina en este período — pulsá "Generar nómina"'));
}
