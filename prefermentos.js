// ── 🫧 PREFERMENTOS (dentro de Recetario) ────────────────────────
// Calculadora de SOLO LECTURA: toma la receta ya elegida en Recetario y
// la muestra ajustada a un prefermento (poolish / biga / pâte fermentée
// con hidratación fija, o masa madre con proporción manual harina:agua).
// No escribe nada en Supabase — es una vista alterna, como el escalador.

const PREM_TIPOS = {
  poolish: { label: 'Poolish',        hidr: 1.0, fija: true },
  biga50:  { label: 'Biga 50%',       hidr: 0.5, fija: true },
  biga60:  { label: 'Biga 60%',       hidr: 0.6, fija: true },
  pate:    { label: 'Pâte fermentée', hidr: 1.1, fija: true },
  mm:      { label: 'Masa madre',     hidr: null, fija: false }
};

// Una receta "ya tiene mm nativa" si alguna de sus subrecetas apunta a
// una receta de categoría pan_mm (criterio confirmado por Victor).
function _premRecetaTieneMmNativa(r) {
  return (r.subrecs || []).some(s => {
    const ref = (_sbRecLista() || []).find(x => x.code === s.recId);
    return ref && ref.cat === 'pan_mm';
  });
}

// Repuebla el <select> de tipo de prefermento según la receta activa —
// oculta "Masa madre" si la receta ya trae su propio cultivo nativo.
function premPoblarTipos() {
  const id  = _recetarioActual;
  const r   = id ? (_sbGetRec(id) || (G.recetas || []).find(x => x.id === id)) : null;
  const sel = document.getElementById('prem-tipo');
  if (!sel) return;
  const tieneMm = r ? _premRecetaTieneMmNativa(r) : false;
  sel.innerHTML = Object.keys(PREM_TIPOS)
    .filter(k => k !== 'mm' || !tieneMm)
    .map(k => `<option value="${k}">${PREM_TIPOS[k].label}</option>`).join('');
}

// Repuebla el selector de cultivo — incluye pan_mm y masa (mezcladas con
// otras masas que no son mm), filtrable por texto porque la categoría
// "masa" no alcanza para distinguir cuál es cultivo de verdad.
function premPoblarCultivos() {
  const sel = document.getElementById('prem-mm-sub');
  if (!sel) return;
  const q = (document.getElementById('prem-mm-buscar')?.value || '').toLowerCase().trim();
  let cultivos = (_sbRecLista() || []).filter(r => r.cat === 'pan_mm' || r.cat === 'masa');
  if (q) cultivos = cultivos.filter(r =>
    (r.name || '').toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q)
  );
  cultivos.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  sel.innerHTML = cultivos.length
    ? cultivos.map(r => `<option value="${r.code}">${r.code} · ${r.name}${r.cat === 'masa' ? ' (masa)' : ''}</option>`).join('')
    : '<option value="">Sin resultados</option>';
}

function premTipoCambiado() {
  const tipoKey = document.getElementById('prem-tipo').value;
  const tipo    = PREM_TIPOS[tipoKey];
  const esMm    = tipoKey === 'mm';
  document.getElementById('prem-mm-fields').style.display = esMm ? 'flex' : 'none';
  document.getElementById('prem-levadura-field').style.display = esMm ? 'none' : 'block';
  if (esMm && !document.getElementById('prem-mm-sub').options.length) premPoblarCultivos();
  document.getElementById('prem-hidr-fija').textContent = (!esMm && tipo)
    ? `Hidratación fija: 1 : ${tipo.hidr} (harina : agua)`
    : '';
  premRender();
}

function premRender() {
  const id = _recetarioActual;
  if (!id) return;
  const r = _sbGetRec(id) || (G.recetas || []).find(x => x.id === id);
  if (!r) return;

  const tipoSel = document.getElementById('prem-tipo');
  if (tipoSel && !tipoSel.options.length) { premPoblarTipos(); }
  const tipoKey = tipoSel ? tipoSel.value : 'poolish';
  const tipo    = PREM_TIPOS[tipoKey];
  if (!tipo) return;
  const esMm = tipoKey === 'mm';

  const masaObj = parseFloat(document.getElementById('prem-masa-obj').value) || r.totalMass || 1000;
  const pct     = Math.min(100, Math.max(0, parseFloat(document.getElementById('prem-pct').value) || 0));

  const c        = pmCostoReceta(r, masaObj);
  const flourW   = c.flourW;
  const preHarina = flourW * pct / 100;

  const hidr = tipo.fija
    ? tipo.hidr
    : Math.max(0, parseFloat(document.getElementById('prem-mm-ratio').value) || 1);
  const preAgua = preHarina * hidr;

  // Levadura mínima del prefermento: % sobre la harina DEL PREFERMENTO
  // (práctica usual), solo aplica a poolish/biga/pâte — no a masa madre.
  const levaduraPct = esMm ? 0 : Math.max(0, parseFloat(document.getElementById('prem-levadura-pct').value) || 0);
  const preLevadura = preHarina * levaduraPct / 100;

  const cultivoCode = esMm ? (document.getElementById('prem-mm-sub').value || null) : null;
  const cultivo = cultivoCode ? (_sbRecLista() || []).find(x => x.code === cultivoCode) : null;

  // Masa restante: se reduce proporcionalmente cada línea de harina, se
  // resta el agua del prefermento de la(s) línea(s) cuyo nombre incluye
  // "agua". La levadura: en modo mm se elimina por completo (se reemplaza
  // por el cultivo); en los demás tipos se le resta solo lo que se llevó
  // el prefermento (preLevadura).
  const fraccionHarinaRestante = flourW > 0 ? Math.max(0, 1 - (preHarina / flourW)) : 1;
  let aguaPorAsignar = preAgua;
  let levaduraPorAsignar = preLevadura;

  const restoLines = c.lines.filter(l => !l.isAddon).map(l => {
    const esLevadura = (l.name || '').toLowerCase().includes('levadura');
    if (esMm && esLevadura) return null;
    if (l.flour) {
      return { ...l, g: l.g * fraccionHarinaRestante, cost: l.cost * fraccionHarinaRestante };
    }
    if (!esMm && esLevadura && levaduraPorAsignar > 0) {
      const resta   = Math.min(l.g, levaduraPorAsignar);
      const fracRes = l.g > 0 ? (l.g - resta) / l.g : 0;
      levaduraPorAsignar -= resta;
      return { ...l, g: l.g - resta, cost: l.cost * fracRes };
    }
    if (!l.isSub && (l.name || '').toLowerCase().includes('agua') && aguaPorAsignar > 0) {
      const resta   = Math.min(l.g, aguaPorAsignar);
      const fracRes = l.g > 0 ? (l.g - resta) / l.g : 0;
      aguaPorAsignar -= resta;
      return { ...l, g: l.g - resta, cost: l.cost * fracRes };
    }
    return l;
  }).filter(Boolean);

  const restoTotalG = restoLines.reduce((s, l) => s + l.g, 0);
  const restoCostoG = restoLines.reduce((s, l) => s + l.cost, 0);

  function row(name, g, cost, icon = '') {
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:7px 10px;font-weight:500">${icon}${name}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:15px;font-weight:700;color:var(--gold2)">${g > 0 ? Math.round(g) + 'g' : '—'}</td>
      <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--cream2)">${cost > 0 ? pmMoney(Math.round(cost)) : '—'}</td>
    </tr>`;
  }
  function header(label, color = 'var(--cream2)', bg = 'rgba(200,146,42,.06)') {
    return `<tr><td colspan="3" style="padding:6px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:${bg};color:${color}">${label}</td></tr>`;
  }

  let tbody = '';
  tbody += header(`🫧 Prefermento — ${tipo.label} (${pct}% de la harina)`, 'var(--blue)', 'rgba(74,128,192,.06)');
  tbody += row('Harina', preHarina, 0, '🌾 ');
  tbody += row('Agua', preAgua, 0, '💧 ');
  if (!esMm && preLevadura > 0) tbody += row(`Levadura (${levaduraPct}% s/harina prefermento)`, preLevadura, 0, '🟤 ');
  if (cultivo) {
    tbody += `<tr><td colspan="3" style="padding:6px 10px;font-size:11px;color:var(--cream2)">🔗 Cultivo/inóculo: ${cultivo.code} · ${cultivo.name} — cantidad según tu manejo habitual de refresco</td></tr>`;
  }
  tbody += `<tr style="font-weight:700;background:rgba(74,128,192,.08)">
    <td style="padding:7px 10px;color:var(--blue)">Subtotal prefermento</td>
    <td style="padding:7px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--blue)">${Math.round(preHarina + preAgua)}g</td>
    <td></td></tr>`;

  tbody += header('🍞 Resto de la masa (ya ajustado)');
  restoLines.forEach(l => { tbody += row(l.name, l.g, l.cost, l.flour ? '🌾 ' : (l.isSub ? '🔗 ' : '')); });
  tbody += `<tr style="font-weight:800;background:rgba(200,146,42,.14);border-top:2px solid var(--gold)">
    <td style="padding:8px 10px;color:var(--gold)">TOTAL RESTO</td>
    <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:16px;color:var(--gold)">${Math.round(restoTotalG)}g</td>
    <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--gold2)">${restoCostoG > 0 ? pmMoney(Math.round(restoCostoG)) : '—'}</td>
  </tr>`;

  const CAT  = { pan: '🍞', pan_mm: '🌾', galleta: '🍪', masa: '🫧', otro: '📦' };
  const icon = CAT[r.cat || 'otro'] || '📦';

  document.getElementById('prem-vista-content').innerHTML = `
    <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--gold)">
      <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:900;color:var(--cream)">${icon} ${r.name}</div>
      <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--gold2);margin-top:2px">${r.code} · masa objetivo ${masaObj}g · harina total ${Math.round(flourW)}g</div>
    </div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:var(--r)">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:rgba(200,146,42,.1)">
          <th style="padding:7px 10px;text-align:left">Componente</th>
          <th style="padding:7px 10px;text-align:right;color:var(--gold)">Gramos</th>
          <th style="padding:7px 10px;text-align:right">Costo</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--cream2)">
      Nota: el agua se resta de la(s) línea(s) cuyo nombre incluye "agua"; si en alguna receta el agua tiene otro nombre, avisame para ajustar la detección.
    </div>`;
}
