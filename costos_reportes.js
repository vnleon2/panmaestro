// costos_reportes.js — Módulo de Costos · Entrega 8: Reportes de costo
// Prefijo cst (cstRep = pantalla y reportes; cstRepCalcular = cálculo puro)
// Depende de costos_core.js, costos_empaques.js, costos_maestros.js, costos_personal.js,
// costos_laboral.js, costos_gastos.js, costos_capacidad.js, costos_rutas.js y costos_tasas.js.
//
// DISEÑO: SOLO LECTURA. No crea tablas ni escribe nada: junta lo que ya existe
//   · materiales  → receta ligada al producto (receta_cod), con pmCostoReceta() tal como está (con la merma de la receta)
//   · empaque     → asignación de empaques por producto (entrega 1)
//   · conversión  → MOD y CIF por la ruta del producto y las tarifas del período (entregas 6 y 7)
//   · gasto       → tasa por kg del período × masa de la pieza (entrega 7)
// y lo compara con el costo que Costeo / Precio de venta usan hoy (materiales + % de MOD + % de GG),
// para ver la diferencia ANTES de conectar el nuevo sistema (entrega 9).
// Criterio: los materiales se calculan siempre sobre el peso del producto terminado; la merma de la receta
// es el factor de ajuste del costo. Materiales por pieza = (costo de la receta con merma ÷ masa total de la receta) × peso del producto.
// (La conversión y el gasto del período usan la masa por pieza de la ruta si se indicó, o el peso del producto: lo normal es dejarla vacía.)
// Las tarifas son las congeladas si el período está aprobado; si está en borrador, las calculadas en vivo.

let _cstRepVer = 'pz';     // 'pz' | 'kg'
let _cstRepSel = '';       // producto con el desglose abierto

// ── Cálculo (puro) ──────────────────────────────────────────
function _cstRepReceta(p) {
  if (typeof _sbRecLista !== 'function' || typeof pmCostoReceta !== 'function') return null;
  return (_sbRecLista() || []).find(r => r.code === p.receta_cod) || null;
}

// Materiales por pieza y costo "actual" (método porcentual de Costeo / Precio de venta)
function cstRepMateriales(p, ruta, cache) {
  if (typeof _sbRecLista !== 'function' || typeof pmCostoReceta !== 'function') return { ok: false, motivo: 'las recetas no están cargadas' };
  if (!p.receta_cod) return { ok: false, motivo: 'no tiene receta ligada (se liga en Maestros)' };
  const r = _cstRepReceta(p);
  if (!r) return { ok: false, motivo: `la receta ${p.receta_cod} no existe` };
  const c = pmCostoReceta(r, undefined, undefined, cache);
  if (!c || !(c.totalMerma > 0) || !(r.totalMass > 0)) return { ok: false, motivo: 'la receta no tiene costo calculable (falta precio o masa total)' };
  const cpg = c.totalMerma / r.totalMass;
  const peso = Number(p.peso_g) > 0 ? Number(p.peso_g) : 0;
  // Criterio: los materiales se calculan siempre sobre el peso del producto terminado; la merma de la receta es el factor de ajuste
  if (!(peso > 0)) return { ok: false, motivo: 'no tiene peso (se indica en Maestros)' };
  const masaRuta = ruta && Number(ruta.masa_pieza_g) > 0 ? Number(ruta.masa_pieza_g) : 0;
  const out = { ok: true, receta: r, cpg, masaG: peso, matPz: cpg * peso, masaRuta };
  // Costo actual del sistema: materiales (con el peso del producto) + MOD % + GG %
  const pesoPv = peso > 0 ? peso : r.totalMass / (r.units || 1);
  const matPv = cpg * pesoPv;
  const clase = typeof _pvClase === 'function' ? _pvClase(r, { nombre: p.nombre, tipo: p.tipo }) : (p.tipo || 'otro');
  const ref = (typeof PV_REF !== 'undefined' && PV_REF[clase]) || { mod: 80, gg: 45, iva: 13 };
  const mod = r.modPct !== undefined && r.modPct !== null ? Number(r.modPct) : ref.mod;
  const gg = r.ggPct !== undefined && r.ggPct !== null ? Number(r.ggPct) : ref.gg;
  out.actual = matPv * (1 + mod / 100 + gg / 100);
  out.iva = ref.iva;
  return out;
}

// Una fila por producto: todo por pieza (el kg se obtiene dividiendo por la masa de la pieza)
function cstRepCalcular() {
  const tas = cstTasActuales();
  const cache = new Map();
  return _cstRutProd.map(p => {
    const ruta = _cstRutaDe(p.id);
    const avisos = [];
    const m = cstRepMateriales(p, ruta, cache);
    if (!m.ok) avisos.push('Materiales: ' + m.motivo);
    else if (m.masaRuta && Math.abs(m.masaRuta - Number(p.peso_g)) > 0.005) avisos.push(`Ruta: la masa por pieza (${_cstNum(m.masaRuta, 1)} g) es distinta del peso del producto (${_cstNum(Number(p.peso_g), 1)} g); los materiales usan el peso del producto — si la dejás vacía, la masa cruda se calcula sola con la merma de la receta`);
    const c = cstTasCostoProducto(p, tas);
    if (c.sinRuta) avisos.push('Conversión: no tiene ruta (se arma en Etapas y rutas)');
    else c.avisos.forEach(a => avisos.push('Conversión: ' + a));
    const lineasEmp = _cstProdEmp[p.id] || [];
    const emp = cstProdTotal(p.id);
    if (!lineasEmp.length) avisos.push('Empaque: no tiene empaque asignado');
    const kgPz = c.sinRuta ? cstMasaPiezaKg(p, ruta) : c.kgPz;
    const completo = m.ok && !c.sinRuta && c.completo;
    const mat = m.ok ? m.matPz : null;
    const convOk = !c.sinRuta && c.completo;   // con la ruta o las tarifas incompletas no se muestran cifras a medias
    const conv = convOk ? c.conv : null;
    const capa2 = convOk ? c.capa2 : null;
    const total = completo ? mat + emp + conv + capa2 : null;
    const precio = Number(p.precio_full) > 0 ? Number(p.precio_full) : null;
    const iva = m.ok ? m.iva : 13;
    const neto = precio !== null ? precio / (1 + iva / 100) : null;
    const margen = total !== null && neto > 0 ? (neto - total) / neto * 100 : null;
    const actual = m.ok ? m.actual : null;
    return {
      p, ruta, kgPz, mat, emp, mod: convOk ? c.mod : null, fija: convOk ? c.fija : null, vari: convOk ? c.vari : null,
      conv, capa2, total, actual, dif: total !== null && actual !== null ? total - actual : null,
      precio, iva, margen, completo, avisos, c, m,
    };
  });
}

// Divisor de la vista: 1 por pieza; 1/masa por kg
function _cstRepF(fila) { return _cstRepVer === 'kg' ? (fila.kgPz > 0 ? 1 / fila.kgPz : null) : 1; }
function _cstRepV(fila, k) { const f = _cstRepF(fila); return f === null || fila[k] === null ? null : fila[k] * f; }

// ── Carga ───────────────────────────────────────────────────
async function cstRepInit() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  await cstCfgCargar();
  try {
    await cstPersonalDatos();
    await cstPerCargar();
    await cstRutDatos();
  } catch (e) {
    console.warn('[cstRepInit]', e.message);
    pmToast('⚠️ ' + _cstErr(e, 'sql_costos_maestros.sql, sql_costos_personal.sql, sql_costos_gastos.sql, sql_costos_rutas.sql y sql_costos_tarifas.sql'), 'err');
    return;
  }
  await cstEmpCargarMaestros();   // empaques y su asignación a cada producto
  cstPerInicial();
  await cstTasCargar();
  cstPerLlenarSelectId('cstrp-periodo');
  cstRepLlenarFiltros();
  cstRepRender();
}

async function cstRepElegirPer(id) {
  _cstPerSel = id || '';
  try { localStorage.setItem(CST_PER_LS, _cstPerSel); } catch (e) { /* ok */ }
  await cstTasCargar();
  cstRepRender();
}

function cstRepLlenarFiltros() {
  const t = document.getElementById('cstrp-tipo');
  if (t && !t.options.length) t.innerHTML = '<option value="">Todos</option><option value="pan">Panes</option><option value="galleta">Galletas</option>';
}

function cstRepVer(modo) {
  _cstRepVer = modo === 'kg' ? 'kg' : 'pz';
  cstRepRender();
}

function cstRepDetalle(prodId) {
  _cstRepSel = _cstRepSel === prodId ? '' : prodId;
  cstRepRender();
}

// ── Pintado ─────────────────────────────────────────────────
const _CST_RP_CEL = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px';
const _CST_RP_MONO = ";text-align:right;font-family:'DM Mono',monospace;white-space:nowrap";
const _CST_RP_HEAD = 'text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--cream2)';

function _cstRepMoneda(n) { return n === null || n === undefined ? '—' : cstMoneyU(n); }
function _cstRepPct(n) { return n === null || n === undefined ? '—' : _cstFmtPct(n); }
function _cstRepSigno(n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + cstMoneyU(n); }

function _cstRepFiltradas(filas) {
  const q = _cstVal('cstrp-buscar').toLowerCase().trim();
  const tipo = _cstVal('cstrp-tipo');
  return filas.filter(f => (!tipo || f.p.tipo === tipo) && (!q || (f.p.nombre || '').toLowerCase().includes(q) || (f.p.codigo || '').toLowerCase().includes(q)));
}

function cstRepRender() {
  const per = _cstPerActual();
  const estEl = document.getElementById('cstrp-estado');
  const stats = document.getElementById('cstrp-stats');
  const avisosEl = document.getElementById('cstrp-avisos');
  const tabEl = document.getElementById('cstrp-tabla');
  const detEl = document.getElementById('cstrp-detalle');
  if (!estEl || !stats || !avisosEl || !tabEl || !detEl) return;
  if (!per) {
    estEl.textContent = ''; stats.innerHTML = ''; avisosEl.innerHTML = ''; detEl.innerHTML = '';
    tabEl.innerHTML = _cstPh('📅', 'Creá primero un período en Costo laboral y cargá sus datos');
    return;
  }
  const guardado = per.estado !== 'borrador';
  estEl.innerHTML = `<span class="badge ${guardado ? 'b3' : 'b0'}">${pmEsc(per.estado)}</span> <span style="font-size:11px;color:var(--cream2)">${guardado ? 'Tarifas aprobadas y congeladas' : 'Tarifas calculadas en vivo con los datos del período (se congelan al aprobarlo en Tarifas y aprobación)'}</span>`;

  const todas = cstRepCalcular();
  const filas = _cstRepFiltradas(todas);
  const comp = todas.filter(f => f.completo);
  const conMargen = comp.filter(f => f.margen !== null);
  const stat = (lbl, val, sub) => `<div class="stat"><div class="stat-lbl">${lbl}</div><div class="stat-val" style="font-size:17px">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  const prom = conMargen.length ? conMargen.reduce((a, f) => a + f.margen, 0) / conMargen.length : null;
  const peor = conMargen.length ? conMargen.reduce((a, f) => (f.margen < a.margen ? f : a)) : null;
  const dif = comp.filter(f => f.dif !== null && f.actual > 0);
  const difProm = dif.length ? dif.reduce((a, f) => a + f.dif / f.actual * 100, 0) / dif.length : null;
  stats.innerHTML = stat('Productos', String(todas.length), 'activos') +
    stat('Con costo completo', `${comp.length} de ${todas.length}`, comp.length < todas.length ? 'revisar avisos' : 'todo en orden') +
    stat('Margen promedio', _cstRepPct(prom), 'sobre el precio sin IVA') +
    stat('Menor margen', peor ? _cstRepPct(peor.margen) : '—', peor ? pmEsc(peor.p.nombre) : '') +
    stat('Estándar vs. actual', difProm === null ? '—' : (difProm > 0 ? '+' : '') + _cstFmtPct(difProm), 'diferencia promedio de costo');

  // Avisos agrupados
  const grupos = {};
  todas.forEach(f => f.avisos.forEach(a => {
    const k = a.replace(/:.*/, '') + ': ' + a.replace(/^[^:]*:\s*/, '').replace(/^la receta .* no existe$/, 'la receta ligada no existe');
    (grupos[k] = grupos[k] || []).push(f.p.nombre);
  }));
  const ks = Object.keys(grupos);
  avisosEl.innerHTML = ks.length
    ? `<div class="card" style="border-color:var(--red)"><div class="ctitle" style="color:var(--red)">Revisar</div>${ks.map(k => {
      const n = grupos[k].length;
      return `<div style="font-size:12px;margin-bottom:3px">⚠ ${pmEsc(k)} — ${n} producto${n === 1 ? '' : 's'}: ${pmEsc(grupos[k].slice(0, 4).join(', '))}${n > 4 ? ` y ${n - 4} más` : ''}</div>`;
    }).join('')}</div>`
    : '<div class="card" style="border-color:var(--green,#22A06B)"><div style="font-size:12px">✓ Todos los productos tienen materiales, empaque, ruta y tarifas</div></div>';

  // Tabla principal
  const th = (t, r) => `<th style="${_CST_RP_CEL}${r ? ';text-align:right' : ''}">${t}</th>`;
  const u = _cstRepVer === 'kg' ? 'por kg de masa' : 'por pieza';
  const celda = (f, k, neg) => { const n = _cstRepV(f, k); return `<td style="${_CST_RP_CEL}${_CST_RP_MONO}${neg ? ';font-weight:600' : ''}">${_cstRepMoneda(n)}</td>`; };
  const colMargen = m => m === null ? 'inherit' : m < 0 ? 'var(--red)' : m < 20 ? '#B45309' : 'var(--green,#22A06B)';
  tabEl.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--cream2)">Ver por:</span>
      <button class="btn btn-sm ${_cstRepVer === 'pz' ? 'btn-gold' : 'btn-out'}" onclick="cstRepVer('pz')">pieza</button>
      <button class="btn btn-sm ${_cstRepVer === 'kg' ? 'btn-gold' : 'btn-out'}" onclick="cstRepVer('kg')">kg</button>
      <span style="flex:1"></span>
      <button class="btn btn-out btn-sm" onclick="cstRepImprimir()">🖨 Imprimir</button>
      <button class="btn btn-out btn-sm" onclick="cstRepExportar()">⬇ CSV</button>
    </div>` + (filas.length ? `
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:1180px">
        <thead><tr style="${_CST_RP_HEAD}">${th('Producto')}${th('Materiales', 1)}${th('Empaque', 1)}${th('MOD', 1)}${th('CIF fija', 1)}${th('CIF variable', 1)}${th('Gasto del período', 1)}${th('Costo estándar', 1)}${th('Costo actual', 1)}${th('Diferencia', 1)}${th('Precio de lista', 1)}${th('Margen', 1)}</tr></thead>
        <tbody>${filas.map(f => `<tr onclick="cstRepDetalle('${f.p.id}')" style="cursor:pointer;${_cstRepSel === f.p.id ? 'background:#EEF4FF' : ''}">
          <td style="${_CST_RP_CEL}">${pmEsc(f.p.nombre)}${f.avisos.length ? `<span title="${pmEsc(f.avisos.join(' · '))}" style="color:var(--red);margin-left:4px;cursor:help">⚠</span>` : ''}</td>
          ${celda(f, 'mat')}${celda(f, 'emp')}${celda(f, 'mod')}${celda(f, 'fija')}${celda(f, 'vari')}${celda(f, 'capa2')}${celda(f, 'total', 1)}${celda(f, 'actual')}
          <td style="${_CST_RP_CEL}${_CST_RP_MONO};color:${f.dif === null ? 'inherit' : f.dif > 0 ? '#B45309' : 'var(--green,#22A06B)'}">${_cstRepSigno(_cstRepV(f, 'dif'))}</td>
          ${celda(f, 'precio')}
          <td style="${_CST_RP_CEL}${_CST_RP_MONO};font-weight:600;color:${colMargen(f.margen)}">${_cstRepPct(f.margen)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--cream2);margin:4px 2px 0">Valores ${u}. <b>Costo estándar</b> = materiales + empaque + MOD + CIF + gasto del período. <b>Costo actual</b> = el que usan hoy Costeo y Precio de venta (materiales + % de MOD + % de gastos generales; sin empaque aparte). Diferencia = estándar − actual. Margen = (precio sin IVA − costo estándar) ÷ precio sin IVA. Toca un producto para ver el desglose.</div>`
    : _cstPh('📊', todas.length ? 'Ningún producto coincide con el filtro' : 'No hay productos activos'));

  // Desglose del producto elegido
  const sel = _cstRepSel ? todas.find(f => f.p.id === _cstRepSel) : null;
  detEl.innerHTML = sel ? cstRepDetalleHtml(sel) : '';
}

function cstRepDetalleHtml(f) {
  const kgPz = f.kgPz;
  const por = _cstRepVer === 'kg' ? 'kg' : 'pieza';
  const comps = [
    ['Materiales', f.mat], ['Empaque', f.emp], ['MOD (mano de obra directa)', f.mod], ['CIF fija', f.fija], ['CIF variable', f.vari], ['Gasto del período (venta, mercadeo, admin.)', f.capa2],
  ];
  const tot = f.total;
  const th = (t, r) => `<th style="${_CST_RP_CEL}${r ? ';text-align:right' : ''}">${t}</th>`;
  const F = _cstRepF(f);
  const filaC = ([n, v]) => {
    const x = v === null || F === null ? null : v * F;
    return `<tr><td style="${_CST_RP_CEL}">${n}</td><td style="${_CST_RP_CEL}${_CST_RP_MONO}">${_cstRepMoneda(x)}</td><td style="${_CST_RP_CEL}${_CST_RP_MONO}">${tot && v !== null ? _cstFmtPct(v / tot * 100) : '—'}</td></tr>`;
  };
  const un = d => d.t.driver_codigo === 'HH' ? 'HH' : d.t.unidad || 'u';
  const dep = f.c && !f.c.sinRuta ? f.c.porDepto : [];
  const mi = cstMasaPiezaInfo(f.p, f.ruta);
  const masaTxt = kgPz > 0 ? `${_cstNum(kgPz * 1000, 1)} g de masa cruda` + (mi.origen === 'ruta' ? ' (masa escrita en la ruta)' : mi.origen === 'receta' ? ` (${cstMasaPiezaFormula(mi)}, según la receta)` : ' (peso del producto, la receta no tiene merma)') : 'sin masa';
  return `
    <div class="sec" style="margin-top:14px"><h2>Desglose · ${pmEsc(f.p.nombre)}</h2></div>
    <div style="margin-bottom:8px"><button class="btn btn-gold btn-sm" onclick="cstHojaAbrir('${f.p.id}')">📄 Hoja de estándares (sin costos)</button></div>
    <div style="font-size:11px;color:var(--cream2);margin-bottom:6px">Masa por pieza: <b>${masaTxt}</b>${f.m && f.m.ok ? ` · receta ${pmEsc(f.m.receta.code)}` : ''} · valores por ${por}</div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:360px">
        <thead><tr style="${_CST_RP_HEAD}">${th('Componente')}${th('Costo', 1)}${th('% del estándar', 1)}</tr></thead>
        <tbody>${comps.map(filaC).join('')}
          <tr><td style="${_CST_RP_CEL};font-weight:600">Costo estándar</td><td style="${_CST_RP_CEL}${_CST_RP_MONO};font-weight:600">${_cstRepMoneda(_cstRepV(f, 'total'))}</td><td style="${_CST_RP_CEL}${_CST_RP_MONO}">${tot ? '100 %' : '—'}</td></tr></tbody>
      </table>
    </div>` + (dep.length ? `
    <div class="card" style="padding:0;overflow-x:auto;margin-top:8px">
      <table style="width:100%;border-collapse:collapse;min-width:620px">
        <thead><tr style="${_CST_RP_HEAD}">${th('Departamento')}${th('Consumo de su base', 1)}${th('min-HH', 1)}${th('MOD', 1)}${th('CIF fija', 1)}${th('CIF variable', 1)}</tr></thead>
        <tbody>${dep.map(d => {
          const m = _cstRepF(f);
          const v = x => m === null ? null : x * m;
          return `<tr><td style="${_CST_RP_CEL}">${pmEsc(d.depto ? d.depto.codigo + ' · ' + d.depto.nombre : '—')}</td>
            <td style="${_CST_RP_CEL}${_CST_RP_MONO}">${d.q === null || m === null ? '—' : _cstNum(v(d.q), 4) + ' ' + pmEsc(un(d))}</td>
            <td style="${_CST_RP_CEL}${_CST_RP_MONO}">${m === null ? '—' : _cstNum(v(d.hh * 60), 2)}</td>
            <td style="${_CST_RP_CEL}${_CST_RP_MONO}">${_cstRepMoneda(v(d.mod))}</td><td style="${_CST_RP_CEL}${_CST_RP_MONO}">${_cstRepMoneda(v(d.fija))}</td><td style="${_CST_RP_CEL}${_CST_RP_MONO}">${_cstRepMoneda(v(d.vari))}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '') + (f.avisos.length ? `<div style="font-size:12px;margin-top:6px;color:var(--red)">${f.avisos.map(a => '⚠ ' + pmEsc(a)).join('<br>')}</div>` : '');
}

// ── Exportar e imprimir ─────────────────────────────────────
function _cstRepNum(n, dec) { return n === null || n === undefined ? '' : String(Number(Number(n).toFixed(dec === undefined ? 4 : dec))); }

function cstRepCsv() {
  const per = _cstPerActual();
  const esc = s => '"' + String(s === null || s === undefined ? '' : s).replace(/"/g, '""') + '"';
  const cab = ['codigo', 'producto', 'tipo', 'masa_pieza_g', 'materiales_pz', 'empaque_pz', 'mod_pz', 'cif_fija_pz', 'cif_variable_pz', 'gasto_periodo_pz',
    'costo_estandar_pz', 'costo_estandar_kg', 'costo_actual_pz', 'precio_lista', 'margen_pct', 'periodo', 'estado_periodo', 'observaciones'];
  const lineas = [cab.join(',')];
  _cstRepFiltradas(cstRepCalcular()).forEach(f => {
    lineas.push([esc(f.p.codigo), esc(f.p.nombre), esc(f.p.tipo), _cstRepNum(f.kgPz * 1000, 2), _cstRepNum(f.mat), _cstRepNum(f.emp), _cstRepNum(f.mod), _cstRepNum(f.fija), _cstRepNum(f.vari), _cstRepNum(f.capa2),
      _cstRepNum(f.total), _cstRepNum(f.total !== null && f.kgPz > 0 ? f.total / f.kgPz : null), _cstRepNum(f.actual), _cstRepNum(f.precio, 2), _cstRepNum(f.margen, 2),
      esc(per ? per.codigo : ''), esc(per ? per.estado : ''), esc(f.avisos.join(' | '))].join(','));
  });
  return lineas.join('\r\n');
}

function cstRepExportar() {
  const per = _cstPerActual();
  if (!per) { pmToast('Elegí un período', 'err'); return; }
  const blob = new Blob(['﻿' + cstRepCsv()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `costos_${per.codigo}_${pmHoy()}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function cstRepHtmlImprimible() {
  const per = _cstPerActual();
  const filas = _cstRepFiltradas(cstRepCalcular());
  const u = _cstRepVer === 'kg' ? 'por kg de masa' : 'por pieza';
  const td = (f, k, b) => `<td class="n${b ? ' b' : ''}">${_cstRepMoneda(_cstRepV(f, k))}</td>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Costo estándar ${pmEsc(per ? per.codigo : '')}</title>
<style>body{font-family:Arial,sans-serif;font-size:11px;margin:16px;color:#111}h1{font-size:16px;margin:0 0 2px}.s{color:#555;margin-bottom:10px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}th{font-size:9px;text-transform:uppercase;color:#555}
.n{text-align:right;font-family:monospace}.b{font-weight:bold}.f{margin-top:8px;color:#555;font-size:10px}@media print{body{margin:6mm}}</style></head><body>
<h1>Costo estándar por producto</h1>
<div class="s">Período ${pmEsc(per ? per.codigo : '')} · ${pmEsc(per ? per.estado : '')} · valores ${u} · ${pmEsc(pmHoy())}</div>
<table><thead><tr><th>Producto</th><th class="n">Materiales</th><th class="n">Empaque</th><th class="n">MOD</th><th class="n">CIF fija</th><th class="n">CIF variable</th><th class="n">Gasto período</th><th class="n">Costo estándar</th><th class="n">Costo actual</th><th class="n">Precio lista</th><th class="n">Margen</th></tr></thead><tbody>
${filas.map(f => `<tr><td>${pmEsc(f.p.nombre)}${f.avisos.length ? ' ⚠' : ''}</td>${td(f, 'mat')}${td(f, 'emp')}${td(f, 'mod')}${td(f, 'fija')}${td(f, 'vari')}${td(f, 'capa2')}${td(f, 'total', 1)}${td(f, 'actual')}${td(f, 'precio')}<td class="n b">${_cstRepPct(f.margen)}</td></tr>`).join('')}
</tbody></table>
<div class="f">Costo estándar = materiales + empaque + MOD + CIF + gasto del período. Costo actual = método porcentual de Costeo. Margen sobre el precio sin IVA. ⚠ = producto con datos incompletos.</div>
</body></html>`;
}

function cstRepImprimir() {
  if (!_cstPerActual()) { pmToast('Elegí un período', 'err'); return; }
  const w = window.open('', '_blank');
  if (!w) { pmToast('El navegador bloqueó la ventana — permití ventanas emergentes para imprimir', 'err'); return; }
  w.document.open(); w.document.write(cstRepHtmlImprimible()); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* el usuario puede imprimir a mano */ } }, 300);
}
