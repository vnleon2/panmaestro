// ── 🥖 GUÍA DE AMASADO (dentro de Recetario) ─────────────────────
// Calculadora de SOLO LECTURA, mismo patrón que Prefermentos: toma la
// receta y la masa objetivo ya elegidas en Recetario (comparte
// _recetarioActual y el campo #rec-masa-obj con el Escalador) y genera
// una secuencia de amasado paso a paso, por reglas, específica para la
// batidora de Victor (20 qt · 1.1 HP · 3 velocidades). No escribe nada
// en Supabase.
//
// Reglas de detección (mismo criterio que prefermentos.js: buscar por
// nombre de ingrediente — avisar a Victor si alguna receta usa nombres
// que no calcen con "agua" / "mantequilla" / "margarina" / "manteca").
// Reglas de secuencia confirmadas por Victor (26-27 set 2026):
//  - Autolisis SOLO en masas con masa madre nativa (no por hidratación).
//  - Con masa madre: sal entra junto con el cultivo, cuando la masa ya
//    se consolidó — no en la autolisis. Sin masa madre: sal desde el
//    arranque del mezclado.
//  - Grasa: 0-9% nivel bajo, 10-20% nivel medio, 21%+ nivel alto
//    (enriquecida/brioche) — siempre entra DESPUÉS de la ventana de
//    gluten, en tandas si es medio o alto.
//  - Hidratación (aplica a cualquier masa, no solo con masa madre):
//    ≤65% normal; 66-75% masa más floja, tope de tiempo en vel. 2;
//    76%+ evitar vel. 2 o usarla muy poco, priorizar vel. 1 prolongada.
//  - Batidora: máx. 4.0 kg de harina por batch — si la receta escalada
//    supera eso, se reparte en batches parejos.

const AMAS_HARINA_MAX_G = 4000; // límite confirmado por Victor para su batidora

function amasNivelGrasa(pct) {
  if (pct >= 21) return { key: 'alta',  label: 'nivel alto (enriquecida)' };
  if (pct >= 10) return { key: 'media', label: 'nivel medio' };
  return { key: 'baja', label: 'nivel bajo' };
}

function amasNivelHidratacion(pct) {
  if (pct >= 76) return { key: 'alta',  label: 'muy alta',   maxVel2Min: 1 };
  if (pct >= 66) return { key: 'media', label: 'media-alta', maxVel2Min: 3 };
  return { key: 'normal', label: 'normal', maxVel2Min: null };
}

// Repuebla el badge "kg de harina" cuando cambia la masa objetivo — mismo
// campo que usa el Escalador (#rec-masa-obj), sin duplicar el input.
function amasadoParams(r, c) {
  const lineasMasa = c.lines.filter(l => !l.isAddon);
  const aguaPct = lineasMasa
    .filter(l => !l.flour && (l.name || '').toLowerCase().includes('agua'))
    .reduce((s, l) => s + (l.pct || 0), 0);
  const grasaKw = ['mantequilla', 'margarina', 'manteca'];
  const grasaPct = lineasMasa
    .filter(l => !l.flour && grasaKw.some(k => (l.name || '').toLowerCase().includes(k)))
    .reduce((s, l) => s + (l.pct || 0), 0);
  const tieneMM = typeof _premRecetaTieneMmNativa === 'function' ? _premRecetaTieneMmNativa(r) : false;
  return { hidratacionPct: aguaPct, grasaPct, tieneMM };
}

function amasadoCalcularBatches(harinaG) {
  if (harinaG <= AMAS_HARINA_MAX_G) return { n: 1, porBatch: harinaG, excede: false };
  const n = Math.ceil(harinaG / AMAS_HARINA_MAX_G);
  return { n, porBatch: harinaG / n, excede: true };
}

function amasadoGenerarPasos({ tieneMM, grasaPct, hidratacionPct }) {
  const nGrasa = amasNivelGrasa(grasaPct);
  const nHidr  = amasNivelHidratacion(hidratacionPct);
  const pasos  = [];
  let n = 1;

  if (tieneMM) {
    pasos.push({
      n: n++, titulo: 'Autolisis', velocidad: '—', tiempo: '20-30 min (reposo, sin batidora)', minutos: 0,
      texto: 'Mezclar solo harina y agua, sin sal ni cultivo. Tapar y dejar reposar.',
      porque: 'Solo aplica cuando la receta lleva masa madre — ayuda a desarrollar gluten antes de amasar.'
    });
    pasos.push({
      n: n++, titulo: 'Mezcla con cultivo', velocidad: 'Vel. 1', tiempo: '~2 min', minutos: 2,
      texto: 'Agregar el cultivo de masa madre y la sal sobre la autolisis. Batir en velocidad 1 hasta integrar.',
      porque: 'La sal entra cuando la masa ya se consolidó, junto con el cultivo — no en la autolisis.'
    });
  } else {
    pasos.push({
      n: n++, titulo: 'Mezcla inicial', velocidad: 'Vel. 1', tiempo: '~2 min', minutos: 2,
      texto: 'Incorporar harina, líquidos y sal desde el arranque. Batir en velocidad 1 hasta que no queden grumos secos.',
      porque: 'Sin masa madre, la sal entra desde el arranque del mezclado.'
    });
  }

  let glutenVel = 'Vel. 2', glutenTiempo = '~5 min', glutenMin = 5;
  let glutenTexto = 'Subir a velocidad 2 y batir hasta ventana de gluten.';
  let glutenPorque = 'La grasa aún no se incorpora — el gluten se desarrolla mejor sin su interferencia.';
  let glutenAlerta = false;
  if (nHidr.key === 'media') {
    glutenVel = `Vel. 2 · máx. ${nHidr.maxVel2Min} min`;
    glutenTiempo = '~7 min'; glutenMin = 7;
    glutenTexto = `Velocidad 2 hasta un máximo de ${nHidr.maxVel2Min} min; si la masa no toma punto, terminar en velocidad 1 en vez de prolongarla.`;
    glutenPorque = `Hidratación ${Math.round(hidratacionPct)}% (media-alta): masa más floja — evitar forzar la velocidad 2 por mucho tiempo.`;
    glutenAlerta = true;
  } else if (nHidr.key === 'alta') {
    glutenVel = `Vel. 1 (evitar Vel. 2, máx. ${nHidr.maxVel2Min} min si hace falta)`;
    glutenTiempo = '~8 min'; glutenMin = 8;
    glutenTexto = `Priorizar velocidad 1 prolongada. Si usás velocidad 2, no más de ${nHidr.maxVel2Min} min.`;
    glutenPorque = `Hidratación ${Math.round(hidratacionPct)}% (muy alta): la masa "chapotea" en velocidad 2 y no desarrolla bien con este motor.`;
    glutenAlerta = true;
  }
  pasos.push({ n: n++, titulo: 'Desarrollo de gluten', velocidad: glutenVel, tiempo: glutenTiempo, minutos: glutenMin, texto: glutenTexto, porque: glutenPorque, alerta: glutenAlerta });

  if (grasaPct > 0) {
    if (nGrasa.key === 'baja') {
      pasos.push({
        n: n++, titulo: 'Incorporación de grasa', velocidad: 'Vel. 1', tiempo: '~2 min', minutos: 2,
        texto: 'Agregar la mantequilla o margarina y batir hasta integrar.',
        porque: `${Math.round(grasaPct)}% de grasa — nivel bajo: se incorpora sin mayor cuidado especial.`
      });
    } else {
      const tandas = nGrasa.key === 'alta' ? '3 a 4 tandas, fría y en cubos' : '2 a 3 tandas';
      const tiempo = nGrasa.key === 'alta' ? '~9 min' : '~4 min';
      const minutos = nGrasa.key === 'alta' ? 9 : 4;
      pasos.push({
        n: n++, titulo: 'Incorporación de grasa', velocidad: 'Vel. 1-2', tiempo, minutos,
        texto: `Agregar la mantequilla o margarina en ${tandas}, esperando que cada tanda se integre antes de añadir la siguiente.`,
        porque: `${Math.round(grasaPct)}% de grasa — ${nGrasa.label}: entra después de la ventana de gluten, en tandas.`,
        alerta: nGrasa.key === 'alta'
      });
    }
  }

  pasos.push({
    n: n++, titulo: 'Punto final', velocidad: 'Vel. 1', tiempo: '~2 min', minutos: 2,
    texto: 'Verificar que la masa se despegue del bowl y tome brillo. Vigilar la temperatura de la masa antes de sacarla.',
    porque: nGrasa.key === 'alta'
      ? 'Con grasa en nivel alto, la fricción sube la temperatura más rápido — vigilar de cerca.'
      : (nGrasa.key === 'media'
        ? 'Con grasa en nivel medio, la fricción sube la temperatura más rápido que en una masa magra.'
        : 'Masa magra — el punto final es el indicador principal.')
  });

  return pasos;
}

let _amasBatchActual = 1;
function amasSetBatch(i) {
  _amasBatchActual = i;
  document.querySelectorAll('.amas-batch-pill').forEach(el => {
    const on = parseInt(el.dataset.batch, 10) === i;
    el.style.background = on ? 'var(--gold)' : 'var(--bg3)';
    el.style.color = on ? '#FFFFFF' : 'var(--cream2)';
  });
}

// Recalcula cuando cambia la receta o la masa objetivo (#rec-masa-obj,
// compartido con el Escalador — ver recetarioMasaObjInput en recetario.js).
async function amasRender() {
  const id = _recetarioActual;
  if (!id) return;
  if (pmDB.disponible() && !_sbRecCache) await _sbCosteoCargar();
  const r = _sbGetRec(id) || (G.recetas || []).find(x => x.id === id);
  if (!r) return;

  const masaObj   = parseFloat(document.getElementById('rec-masa-obj').value) || 1000;
  const merma     = r.merma || 0;
  const masaTotal = masaObj * (1 + merma / 100);
  const c         = pmCostoReceta(r, masaTotal);

  const params  = amasadoParams(r, c);
  const batches = amasadoCalcularBatches(c.flourW);
  const pasos   = amasadoGenerarPasos(params);

  _amasBatchActual = 1;
  const minPorBatch   = pasos.reduce((s, p) => s + (p.minutos || 0), 0);
  const minTotalTodos = minPorBatch * batches.n;

  const CAT  = { pan: '🍞', pan_mm: '🌾', galleta: '🍪', masa: '🫧', otro: '📦' };
  const icon = CAT[r.cat || 'otro'] || '📦';

  function pill(texto, bg, color) {
    return `<span style="font-family:'DM Mono',monospace;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:20px;white-space:nowrap;background:${bg};color:${color}">${texto}</span>`;
  }

  const paramRows = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span style="font-size:12.5px;color:var(--cream2)">Hidratación</span>
        ${pill(Math.round(params.hidratacionPct) + '%', 'var(--bg3)', 'var(--cream)')}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span style="font-size:12.5px;color:var(--cream2)">Grasa</span>
        ${pill(Math.round(params.grasaPct) + '% · ' + amasNivelGrasa(params.grasaPct).label, 'rgba(217,119,6,.12)', 'var(--amber)')}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span style="font-size:12.5px;color:var(--cream2)">Masa madre</span>
        ${pill(params.tieneMM ? 'Sí' : 'No', 'var(--bg3)', 'var(--cream2)')}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span style="font-size:12.5px;color:var(--cream2)">Harina en este lote</span>
        ${pill(Math.round(c.flourW) + ' g', 'var(--bg3)', 'var(--cream)')}
      </div>
    </div>`;

  const avisoBatches = batches.excede ? `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:13px 15px;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.25);border-radius:var(--rs);margin-bottom:14px">
      <span style="flex-shrink:0">⚠️</span>
      <div style="font-size:13px;line-height:1.55;color:var(--red)">
        <strong>${Math.round(c.flourW)} g de harina</strong> supera el máximo de ${AMAS_HARINA_MAX_G / 1000} kg por batch de tu batidora (20 qt · 1.1 HP).
        Se recomienda dividir en <strong>${batches.n} batches de ${(batches.porBatch / 1000).toFixed(2)} kg</strong> cada uno — misma secuencia para cada uno.
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:10.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--cream2)">Batches</span>
      <div style="display:flex;gap:6px">
        ${Array.from({ length: batches.n }, (_, i) => i + 1).map(i =>
          `<span class="amas-batch-pill" data-batch="${i}" onclick="amasSetBatch(${i})"
             style="cursor:pointer;font-size:12px;font-weight:600;padding:5px 12px;border-radius:20px;
               background:${i === 1 ? 'var(--gold)' : 'var(--bg3)'};color:${i === 1 ? '#FFFFFF' : 'var(--cream2)'}">Batch ${i}</span>`
        ).join('')}
      </div>
      <span style="font-size:11.5px;color:var(--cream2);margin-left:auto">${(batches.porBatch / 1000).toFixed(2)} kg de harina en este batch</span>
    </div>` : `
    <div style="display:flex;gap:10px;align-items:flex-start;padding:13px 15px;background:rgba(22,163,74,.06);border:1px solid rgba(22,163,74,.25);border-radius:var(--rs);margin-bottom:14px">
      <span style="flex-shrink:0">✅</span>
      <div style="font-size:13px;line-height:1.5;color:var(--green)">
        <strong>${Math.round(c.flourW)} g de harina</strong> — dentro del límite recomendado (máx. ${AMAS_HARINA_MAX_G / 1000} kg) para esta batidora, en un solo batch.
      </div>
    </div>`;

  const pasosHtml = pasos.map(p => `
    <div style="display:flex;gap:14px;padding:14px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);align-items:flex-start;margin-bottom:12px">
      <div style="width:28px;height:28px;flex-shrink:0;border-radius:8px;background:rgba(37,99,235,.1);color:var(--gold);display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-weight:700;font-size:13px">${p.n}</div>
      <div style="flex:1;display:flex;flex-direction:column;gap:5px;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font-weight:700;font-size:14.5px;color:var(--cream)">${p.titulo}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${pill(p.tiempo, 'var(--bg3)', 'var(--cream2)')}
            ${pill(p.velocidad, p.alerta ? 'rgba(217,119,6,.12)' : 'var(--bg3)', p.alerta ? 'var(--amber)' : 'var(--cream2)')}
          </div>
        </div>
        <div style="font-size:13.5px;line-height:1.55;color:var(--cream)">${p.texto}</div>
        <div style="font-size:12px;font-style:italic;color:var(--cream2)">Por qué: ${p.porque}</div>
      </div>
    </div>`).join('');

  document.getElementById('amas-vista-content').innerHTML = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
      <div class="card" style="flex:0 0 260px;min-width:220px">
        <div class="ctitle">Parámetros detectados</div>
        <div style="font-family:'Playfair Display',serif;font-size:17px;font-weight:700;color:var(--cream);margin-bottom:12px">${icon} ${r.name}</div>
        ${paramRows}
        <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border);font-size:11.5px;color:var(--cream2)">
          🌀 Tu batidora: 20 qt · 1.1 HP · 3 velocidades<br>Máx. recomendado: ${AMAS_HARINA_MAX_G / 1000} kg de harina por batch
        </div>
      </div>
      <div style="flex:1;min-width:320px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:2px">
          <div style="font-family:'Playfair Display',serif;font-size:19px;font-weight:700;color:var(--cream)">Secuencia de amasado</div>
          <div style="font-size:12.5px;color:var(--cream2)">Por batch: <strong style="color:var(--cream)">~${minPorBatch} min</strong>${batches.n > 1 ? ` · Total (${batches.n} batches): <strong style="color:var(--cream)">~${minTotalTodos} min</strong>` : ''}</div>
        </div>
        <div style="font-size:12.5px;color:var(--cream2);margin-bottom:14px">Generada según hidratación, grasa y masa madre de la receta. Los tiempos son de referencia — ajustá según cómo se vea la masa.</div>
        ${avisoBatches}
        ${pasosHtml}
      </div>
    </div>`;
}
