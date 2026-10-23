// costos_hoja.js — Módulo de Costos · Hoja de estándares de producción (sin costos)
// Prefijo cst (cstHoja = pantalla, cstHojaDatos = cálculo puro, cstHojaHtml = documento imprimible)
// Depende de costos_core.js, costos_rutas.js, costos_capacidad.js, costos_tasas.js y costos_reportes.js,
// y de costeo.js / pm_core.js / amasado.js (recetas, pmCostoReceta y límite de la batidora).
//
// DISEÑO: SOLO LECTURA. No crea tablas ni escribe nada. Hoja de ingeniería de un producto:
//   1. datos del producto y del lote estándar
//   2. receta de nivel 1 para el lote (las subrecetas aparecen en una línea, sin abrirse)
//   3. equipos y controles (límite de harina de la batidora, horas de horno)
//   4. hoja de ruta: operaciones con tanda, tiempo, personas, minutos por pieza y por lote,
//      y una columna en blanco para anotar el tiempo cronometrado real
//   5. resumen de tiempos por pieza, por lote y por kg de masa cruda
// No muestra ningún costo. Se abre desde Reportes de costo → tocar un producto → "Hoja de estándares".
//
// LOTE ESTÁNDAR: el máximo de piezas enteras cuya harina total (incluida la harina de los cultivos,
// como hace la Guía de Amasado) cabe en la batidora (AMAS_HARINA_MAX_G). Se puede cambiar a mano
// en la pantalla; el cambio no se guarda.

let _cstHojaProd = '';   // producto con la hoja abierta
let _cstHojaLote = 0;    // piezas por lote elegidas a mano (0 = automático)

const CST_HOJA_REF_MASA_G = 7000;   // si no se puede calcular por harina: masa cruda de referencia por batida

// ── Cálculo (puro) ──────────────────────────────────────────
function cstHojaDatos(p, loteSel) {
  const avisos = [];
  const per = typeof _cstPerActual === 'function' ? _cstPerActual() : null;
  const ruta = _cstRutaDe(p.id);
  const lineasRuta = ruta ? _cstRutaLineas(ruta.id) : [];
  const mi = cstMasaPiezaInfo(p, ruta);
  const receta = cstRecetaProd(p);
  const limite = typeof AMAS_HARINA_MAX_G !== 'undefined' ? AMAS_HARINA_MAX_G : 4000;

  if (!p.receta_cod) avisos.push('El producto no tiene receta ligada (se liga en Maestros)');
  else if (!receta) avisos.push(`La receta ${p.receta_cod} no existe o no está cargada`);
  if (!(mi.g > 0)) avisos.push('El producto no tiene peso ni masa por pieza: no se puede calcular el lote');
  if (receta && mi.origen !== 'ruta' && !(mi.merma > 0)) avisos.push('La receta no tiene merma: se toma la masa cruda igual al pan horneado');
  if (!ruta || !lineasRuta.length) avisos.push('El producto no tiene ruta (se arma en Etapas y rutas)');

  // Lote automático: piezas enteras cuya harina total cabe en la batidora
  let auto = 0, harinaPz = 0, porHarina = false;
  if (receta && mi.g > 0 && typeof amasadoSumarCultivos === 'function') {
    harinaPz = amasadoSumarCultivos(receta, pmCostoReceta(receta, mi.g)).flourTotal;
    if (harinaPz > 0) { auto = Math.max(1, Math.floor(limite / harinaPz + 1e-9)); porHarina = true; }
  }
  if (!auto && mi.g > 0) {
    auto = Math.max(1, Math.floor(CST_HOJA_REF_MASA_G / mi.g + 1e-9));
    avisos.push(`No se pudo calcular la harina del lote: el lote se estimó con ${_cstNum(CST_HOJA_REF_MASA_G / 1000, 0)} kg de masa cruda`);
  }
  const lote = loteSel > 0 ? Math.floor(loteSel) : auto;
  const masaLoteG = lote * mi.g;

  // Receta de nivel 1 para el lote
  const rec = { lineas: [], totalPct: 0, totalG: 0, harinaLoteG: 0, harinaPrincipalG: 0, pctLimite: null };
  if (receta && masaLoteG > 0) {
    const res = pmCostoReceta(receta, masaLoteG);
    const subs = (receta.subrecs || []).filter(s => {
      const ref = (_sbRecLista() || []).find(x => x.code === s.recId);
      const m = s.gFijos > 0 ? s.gFijos : (s.pct > 0 ? res.flourW * s.pct / 100 : 0);
      return ref && m > 0;
    });
    let iSub = 0;
    res.lines.forEach(l => {
      if (l.isAddon) {
        rec.lineas.push({ nombre: String(l.name).replace(/^[^\wÁÉÍÓÚÑáéíóúñ(]+/, ''), tipo: 'relleno', pct: null, g: (Number(l.gPorUnidad) > 0 ? Number(l.gPorUnidad) : 0) * lote });
      } else if (l.isSub) {
        const s = subs[iSub++];
        const ref = s ? (_sbRecLista() || []).find(x => x.code === s.recId) : null;
        rec.lineas.push({ nombre: String(l.name).replace(/^[^\wÁÉÍÓÚÑáéíóúñ(]+/, ''), tipo: 'sub', ref: ref ? ref.code + ' · ' + ref.name : '', pct: l.pct, g: l.g });
      } else {
        rec.lineas.push({ nombre: l.name, tipo: l.flour ? 'harina' : 'ing', pct: l.pct, g: l.g });
      }
    });
    rec.lineas.forEach(l => { if (l.tipo !== 'relleno') { rec.totalPct += l.pct || 0; rec.totalG += l.g; } });
    rec.harinaPrincipalG = res.flourW;
    rec.harinaLoteG = typeof amasadoSumarCultivos === 'function' ? amasadoSumarCultivos(receta, res).flourTotal : res.flourW;
    rec.pctLimite = limite > 0 ? rec.harinaLoteG / limite * 100 : null;
  }

  // Hoja de ruta
  const tas = typeof cstTasActuales === 'function' ? cstTasActuales() : { tarifas: [] };
  const driverDe = dId => { const t = tas.tarifas.find(x => x.depto_id === dId); return t ? t.driver_codigo : ''; };
  const rc = lineasRuta.length ? cstRutaCalc(p, ruta, lineasRuta) : null;
  const filas = [];
  const tot = { minPz: 0, hhPz: 0, hornoMinPz: 0 };
  if (rc) {
    rc.filas.forEach((f, i) => {
      const dep = f.etapa ? _cstDeps.find(d => d.id === f.etapa.depto_id) : null;
      const drv = f.etapa ? driverDe(f.etapa.depto_id) : '';
      const esHorno = CST_TAS_HORAS.includes(drv);
      filas.push({
        op: (i + 1) * 10, etapa: f.etapa ? f.etapa.nombre : '(etapa eliminada)',
        depto: dep ? dep.codigo : '', unidad: f.lin.unidad, q: f.lin.q_tanda, tTanda: f.lin.t_tanda_min, tUnidad: f.lin.t_unidad_min, pers: f.lin.personas,
        minPz: f.minPz, hhPz: f.hhPz, hhKg: f.hhKg, relojLote: f.minPz === null ? null : f.minPz * lote, hhLote: f.hhPz === null ? null : f.hhPz * lote, esHorno,
      });
      if (f.minPz !== null) { tot.minPz += f.minPz; if (esHorno) tot.hornoMinPz += f.minPz; }
      if (f.hhPz !== null) tot.hhPz += f.hhPz;
    });
    rc.avisos.forEach(a => avisos.push('Ruta: ' + a));
  }
  const kgPz = mi.g / 1000;
  const resumen = {
    hhPz: tot.hhPz, hhLote: tot.hhPz * lote, hhKg: kgPz > 0 ? tot.hhPz / kgPz : null,
    relojPz: tot.minPz, relojLote: tot.minPz * lote,
    hornoHPz: tot.hornoMinPz / 60, hornoHLote: tot.hornoMinPz * lote / 60, hornoHKg: kgPz > 0 ? tot.hornoMinPz / 60 / kgPz : null,
  };
  if (rec.pctLimite !== null && rec.pctLimite > 100) avisos.push(`El lote de ${lote} piezas lleva ${_cstNum(rec.harinaLoteG, 0)} g de harina y supera el límite de la batidora (${_cstNum(limite, 0)} g)`);
  return { p, per, ruta, mi, receta, lote, auto, porHarina, limite, harinaPz, masaLoteG, rec, filas, resumen, avisos, kgPz };
}

// ── Documento imprimible ────────────────────────────────────
function _cstHojaN(n, dec) { return n === null || n === undefined || isNaN(n) ? '—' : _cstNum(n, dec === undefined ? 1 : dec); }

function cstHojaHtml(d) {
  const E = pmEsc;
  const N = _cstHojaN;
  const p = d.p;
  const origenMasa = d.mi.origen === 'ruta' ? 'escrita a mano en la ruta'
    : d.mi.origen === 'receta' ? cstMasaPiezaFormula(d.mi) : d.mi.origen === 'peso' ? 'peso del producto' : '—';
  const dato = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const recTabla = d.rec.lineas.length ? `<table class="t"><thead><tr><th>Ingrediente</th><th class="n">% panadero</th><th class="n">g por lote</th><th class="n">g por pieza</th></tr></thead><tbody>
    ${d.rec.lineas.map(l => `<tr><td>${E(l.nombre)}${l.tipo === 'sub' ? ` <i>(subreceta${l.ref ? ' ' + E(l.ref) : ''})</i>` : l.tipo === 'relleno' ? ' <i>(relleno / cobertura)</i>' : ''}</td>
      <td class="n">${l.pct === null ? '—' : N(l.pct, 1)}</td><td class="n">${N(l.g, 1)}</td><td class="n">${N(d.lote > 0 ? l.g / d.lote : null, 1)}</td></tr>`).join('')}
    <tr class="tot"><td>Total de la masa</td><td class="n">${N(d.rec.totalPct, 1)}</td><td class="n">${N(d.rec.totalG, 1)}</td><td class="n">${N(d.lote > 0 ? d.rec.totalG / d.lote : null, 1)}</td></tr></tbody></table>
    <div class="nota">Receta de nivel 1: las subrecetas aparecen en una sola línea. Cantidades para ${d.lote} ${d.lote === 1 ? 'pieza' : 'piezas'} (${N(d.masaLoteG / 1000, 2)} kg de masa cruda).</div>`
    : '<div class="nota r">Sin receta para mostrar.</div>';
  const rutaTabla = d.filas.length ? `<table class="t"><thead><tr><th>Op.</th><th>Etapa</th><th>Depto</th><th>Base</th><th class="n">Tanda</th><th class="n">Min / tanda</th><th class="n">Min / ${d.filas.some(f => f.tUnidad > 0) ? 'unidad' : 'unidad*'}</th><th class="n">Pers.</th>
      <th class="n">Min reloj / pz</th><th class="n">Min-HH / pz</th><th class="n">Min-HH / kg</th><th class="n">Min-HH / lote</th><th class="c">Tiempo cronometrado</th></tr></thead><tbody>
    ${d.filas.map(f => `<tr><td>${f.op}</td><td>${E(f.etapa)}</td><td>${E(f.depto)}</td><td>${f.unidad === 'pz' ? 'pieza' : 'kg de masa'}</td>
      <td class="n">${N(f.q, 2)} ${f.unidad === 'pz' ? 'pz' : 'kg'}</td><td class="n">${N(f.tTanda, 1)}</td><td class="n">${f.tUnidad > 0 ? N(f.tUnidad, 2) : '—'}</td><td class="n">${N(f.pers, 2)}</td>
      <td class="n">${N(f.minPz, 2)}</td><td class="n">${N(f.hhPz, 2)}</td><td class="n">${N(f.hhKg, 2)}</td><td class="n">${N(f.hhLote, 1)}</td><td class="c"></td></tr>`).join('')}
    <tr class="tot"><td colspan="8">Total</td><td class="n">${N(d.resumen.relojPz, 2)}</td><td class="n">${N(d.resumen.hhPz, 2)}</td><td class="n">${N(d.resumen.hhKg, 2)}</td><td class="n">${N(d.resumen.hhLote, 1)}</td><td class="c"></td></tr></tbody></table>
    <div class="nota">Solo tiempo de manos: las esperas (fermentación, reposos) no se registran. Tiempo por unidad de la etapa = min / tanda ÷ tanda + min por unidad (la unidad es kg de masa o pieza). Min-HH = minutos de reloj × personas.</div>`
    : '<div class="nota r">El producto no tiene ruta.</div>';
  const batidora = d.rec.pctLimite === null ? '—' : `${N(d.rec.harinaLoteG, 0)} g de ${N(d.limite, 0)} g (${N(d.rec.pctLimite, 0)} %)`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hoja de estándares · ${E(p.nombre)}</title>
<style>
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:14px}
h1{font-size:16px;margin:0}h2{font-size:12px;margin:14px 0 4px;padding:3px 6px;background:#EEE;border-left:4px solid #8a5a1f;text-transform:uppercase;letter-spacing:.4px}
.sub{color:#555;margin:2px 0 8px}table{border-collapse:collapse;width:100%}
.t th,.t td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}.t th{background:#F5F5F5;font-size:9px;text-transform:uppercase;color:#444}
.n{text-align:right;font-family:'Courier New',monospace;white-space:nowrap}.c{width:90px}.tot td{font-weight:bold;background:#FAFAFA}
.d th{width:26%;text-align:left;background:#F5F5F5;font-size:10px;border:1px solid #ccc;padding:3px 6px}.d td{border:1px solid #ccc;padding:3px 6px}
.nota{font-size:9.5px;color:#555;margin-top:3px}.r{color:#b00020}.av{margin-top:10px;font-size:10px;color:#b00020}
.firmas{display:flex;gap:18px;margin-top:22px}.firmas div{flex:1;border-top:1px solid #333;padding-top:3px;font-size:10px;color:#444}
.obs{height:50px;border:1px solid #bbb;margin-top:4px}
@media print{body{margin:6mm}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
</style></head><body>
<h1>Hoja de estándares de producción</h1>
<div class="sub">${E(p.nombre)}${p.codigo ? ' · ' + E(p.codigo) : ''} · Período ${E(d.per ? d.per.codigo : '—')}${d.per ? ' (' + E(d.per.estado) + ')' : ''} · ${E(pmHoy())}</div>

<h2>1. Producto y lote estándar</h2>
<table class="d"><tbody>
${dato('Receta', d.receta ? E(d.receta.code + ' · ' + d.receta.name) : '—')}
${dato('Peso terminado', d.mi.peso > 0 ? N(d.mi.peso, 1) + ' g' : '—')}
${dato('Merma de la receta', d.receta ? N(Number(d.receta.merma) || 0, 1) + ' %' : '—')}
${dato('Masa cruda por pieza', d.mi.g > 0 ? `<b>${N(d.mi.g, 1)} g</b> <span class="nota">(${origenMasa})</span>` : '—')}
${dato('Lote estándar', d.lote > 0 ? `<b>${d.lote} ${d.lote === 1 ? 'pieza' : 'piezas'}</b> = ${N(d.masaLoteG / 1000, 2)} kg de masa cruda <span class="nota">(${d.lote === d.auto ? (d.porHarina ? 'máximo que cabe en la batidora' : 'estimado') : 'elegido a mano; automático: ' + d.auto})</span>` : '—')}
</tbody></table>

<h2>2. Receta (nivel 1) · lote de ${d.lote} ${d.lote === 1 ? 'pieza' : 'piezas'}</h2>
${recTabla}

<h2>3. Equipos y controles</h2>
<table class="d"><tbody>
${dato('Batidora (20 qt · 1,1 HP)', `Harina por batida, incluida la de los cultivos: <b>${batidora}</b>`)}
${dato('Masa cruda del lote', d.masaLoteG > 0 ? N(d.masaLoteG / 1000, 2) + ' kg' : '—')}
${dato('Horno', d.resumen.hornoHLote > 0 ? `${N(d.resumen.hornoHLote, 2)} h de horno por lote (${N(d.resumen.hornoHPz * 60, 2)} min por pieza)` : 'sin etapas de horno en la ruta')}
</tbody></table>

<h2>4. Hoja de ruta</h2>
${rutaTabla}

<h2>5. Resumen de tiempos</h2>
<table class="t"><thead><tr><th></th><th class="n">Por pieza</th><th class="n">Por lote (${d.lote} pz)</th><th class="n">Por kg de masa cruda</th></tr></thead><tbody>
<tr><td>Minutos-hombre</td><td class="n">${N(d.resumen.hhPz, 2)}</td><td class="n">${N(d.resumen.hhLote, 1)} (${N(d.resumen.hhLote / 60, 2)} h)</td><td class="n">${N(d.resumen.hhKg, 2)}</td></tr>
<tr><td>Minutos de reloj</td><td class="n">${N(d.resumen.relojPz, 2)}</td><td class="n">${N(d.resumen.relojLote, 1)}</td><td class="n">${N(d.kgPz > 0 ? d.resumen.relojPz / d.kgPz : null, 2)}</td></tr>
<tr><td>Horas de horno</td><td class="n">${N(d.resumen.hornoHPz, 3)}</td><td class="n">${N(d.resumen.hornoHLote, 2)}</td><td class="n">${N(d.resumen.hornoHKg, 3)}</td></tr></tbody></table>

<h2>6. Observaciones</h2>
<div class="obs"></div>
<div class="firmas"><div>Elaboró</div><div>Revisó</div><div>Fecha</div></div>
${d.avisos.length ? `<div class="av"><b>Pendientes de revisar:</b><br>${d.avisos.map(a => '⚠ ' + E(a)).join('<br>')}</div>` : ''}
</body></html>`;
}

// ── Pantalla ────────────────────────────────────────────────
function cstHojaAbrir(prodId) {
  _cstHojaProd = prodId;
  _cstHojaLote = 0;
  cstHojaRender();
  const el = document.getElementById('cstrp-hoja');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cstHojaCerrar() {
  _cstHojaProd = '';
  const el = document.getElementById('cstrp-hoja');
  if (el) el.innerHTML = '';
}

function cstHojaSetLote(v) {
  const n = parseInt(v, 10);
  _cstHojaLote = isNaN(n) || n < 1 ? 0 : n;
  cstHojaRender();
}

function cstHojaRender() {
  const el = document.getElementById('cstrp-hoja');
  if (!el) return;
  const p = _cstHojaProd ? _cstRutProd.find(x => x.id === _cstHojaProd) : null;
  if (!p) { el.innerHTML = ''; return; }
  let d;
  try { d = cstHojaDatos(p, _cstHojaLote); } catch (e) {
    console.warn('[cstHojaRender]', e.message);
    el.innerHTML = _cstPh('⚠️', 'No se pudo armar la hoja: ' + pmEsc(e.message));
    return;
  }
  el.innerHTML = `
    <div class="sec" style="margin-top:14px"><h2>Hoja de estándares · ${pmEsc(p.nombre)}</h2></div>
    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:0 1 150px"><label>Piezas por lote</label><input type="number" min="1" step="1" id="cstho-lote" value="${_cstHojaLote || ''}" placeholder="${d.auto || ''}" onchange="cstHojaSetLote(this.value)"></div>
        <div style="flex:1 1 220px;font-size:11px;color:var(--cream2)">Vacío = ${d.auto || '—'} (${d.porHarina ? 'el máximo que cabe en la batidora' : 'estimado'}). El cambio solo afecta esta hoja.</div>
        <button class="btn btn-gold btn-sm" onclick="cstHojaImprimir()">🖨 Imprimir</button>
        <button class="btn btn-out btn-sm" onclick="cstHojaCerrar()">Cerrar</button>
      </div>
      <iframe id="cstho-frame" style="width:100%;height:960px;border:1px solid #CBD5E1;border-radius:6px;margin-top:10px;background:#fff"></iframe>
    </div>`;
  const fr = document.getElementById('cstho-frame');
  if (fr) fr.srcdoc = cstHojaHtml(d);
}

function cstHojaImprimir() {
  const fr = document.getElementById('cstho-frame');
  if (fr && fr.contentWindow) {
    try { fr.contentWindow.focus(); fr.contentWindow.print(); return; } catch (e) { /* se prueba con ventana nueva */ }
  }
  const p = _cstHojaProd ? _cstRutProd.find(x => x.id === _cstHojaProd) : null;
  if (!p) return;
  const w = window.open('', '_blank');
  if (!w) { pmToast('El navegador bloqueó la ventana — permití ventanas emergentes para imprimir', 'err'); return; }
  w.document.open(); w.document.write(cstHojaHtml(cstHojaDatos(p, _cstHojaLote))); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* imprimir a mano */ } }, 300);
}
