// ── 💧 HIDRAT. ──────────────────────────────────────────

// ══════════════════════════════════════════════════════════
// RECETARIO GLUTEN MORGEN — lee de G.gmRecipes (JSON GM)
// ══════════════════════════════════════════════════════════

let _gmRecActual = null;

function gmRecetarioRender() {
  gmRecetarioFiltrar();
  document.getElementById('gmrec-vista').style.display = 'none';
}

function gmRecetarioFiltrar() {
  const q  = (document.getElementById('gmrec-sel-search').value||'').toLowerCase().trim();
  const el = document.getElementById('gmrec-sel-list');
  let list = (G.gmRecipes||[]).slice();
  if (q) list = list.filter(function(r){ return (r.name||'').toLowerCase().includes(q); });
  list.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });

  el.innerHTML = '';
  if (!list.length) {
    var msg = q ? 'Sin resultados para "'+q+'"'
                : 'No hay recetas GM. Importá tu JSON desde <strong>Costeo ▸ 🌾 Gluten Morgen</strong>.';
    el.innerHTML = '<div style="font-size:12px;color:var(--cream2);padding:8px">'+msg+'</div>';
    return;
  }
  list.forEach(function(r) {
    var active = (_gmRecActual === r.name);
    var btn = document.createElement('button');
    btn.style.cssText = 'padding:8px 14px;border-radius:8px;border:1px solid '
      +(active?'var(--gold)':'var(--border)')+';background:'+(active?'rgba(200,146,42,.15)':'var(--sf)')
      +';color:var(--cream);cursor:pointer;font-size:12px;text-align:left;'
      +'display:flex;flex-direction:column;gap:2px;min-width:140px;margin-bottom:2px';
    var code = r.code ? r.code+' · ' : '';
    btn.innerHTML = '<span style="font-family:monospace;font-size:10px;color:var(--gold2)">'+code+(r.weight||1000)+'g</span>'
      +'<span style="font-weight:600">🌾 '+(r.name||'')+'</span>'
      +'<span style="font-size:10px;color:var(--cream2)">'+(r.ingredients||[]).length+' ingredientes</span>';
    btn.addEventListener('click', function(){ gmRecetarioSeleccionar(r.name); });
    el.appendChild(btn);
  });
}

function gmRecetarioSeleccionar(name) {
  _gmRecActual = name;
  gmRecetarioFiltrar();
  var r = (G.gmRecipes||[]).find(function(x){ return x.name === name; });
  document.getElementById('gmrec-masa-obj').value = r ? (r.weight||1000) : 1000;
  document.getElementById('gmrec-vista').style.display = 'block';
  gmRecetarioEscalar();
  document.getElementById('gmrec-vista').scrollIntoView({behavior:'smooth',block:'start'});
}

function gmRecetarioEscalar() {
  var name = _gmRecActual;
  if (!name) return;
  var r = (G.gmRecipes||[]).find(function(x){ return x.name === name; });
  if (!r) return;

  var masaObj  = parseFloat(document.getElementById('gmrec-masa-obj').value)||1000;
  var baseMasa = r.weight||1000;
  var factor   = masaObj / baseMasa;
  var FLOUR_RE = /harina|s[eé]mol|centeno|espelta|trigo|sarraceno/i;

  var ingrs  = (r.ingredients||[]).slice().sort(function(a,b){ return (a.order||0)-(b.order||0); });
  var flIngrs = ingrs.filter(function(i){ return FLOUR_RE.test(i.name); });
  var othIngrs= ingrs.filter(function(i){ return !FLOUR_RE.test(i.name); });
  var flList  = (flIngrs.length ? flIngrs : ingrs.slice(0,1)).map(function(i){ return {name:i.name, pct:parseFloat(i.percentage)||0}; });
  var othList = (flIngrs.length ? othIngrs : ingrs.slice(1)).map(function(i){ return {name:i.name, pct:parseFloat(i.percentage)||0}; });

  var sumAll   = ingrs.reduce(function(s,i){ return s+(parseFloat(i.percentage)||0); },0)||100;
  var masaTot  = masaObj; // sin merma para GM
  var harBase  = baseMasa / (sumAll/100);

  function gIng(pct){ return pct/100*harBase*factor; }

  function row(label, pct, g) {
    return '<tr style="border-bottom:1px solid var(--border)">'
      +'<td style="padding:7px 10px;font-weight:500">'+label+'</td>'
      +'<td style="padding:7px 10px;text-align:right;color:var(--cream2);font-size:12px">'+(pct?pct.toFixed(1)+'%':'—')+'</td>'
      +'<td style="padding:7px 10px;text-align:right;font-family:monospace;font-size:15px;font-weight:700;color:var(--gold2)">'+(g>0?Math.round(g)+'g':'—')+'</td>'
      +'</tr>';
  }

  var tbody = '';
  var gFlTot = 0, gOthTot = 0;

  if (flList.length) {
    tbody += '<tr><td colspan="3" style="padding:6px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(200,146,42,.06);color:var(--cream2)">🌾 Harinas</td></tr>';
    flList.forEach(function(f){ var g=gIng(f.pct); gFlTot+=g; tbody+=row('🌾 '+f.name,f.pct,g); });
    tbody += '<tr style="font-weight:700;background:rgba(200,146,42,.08)"><td style="padding:7px 10px;color:var(--gold)" colspan="2">Subtotal harinas</td><td style="padding:7px 10px;text-align:right;font-family:monospace;color:var(--gold)">'+Math.round(gFlTot)+'g</td></tr>';
  }
  if (othList.length) {
    tbody += '<tr><td colspan="3" style="padding:6px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(100,100,100,.06);color:var(--cream2)">🧂 Otros ingredientes</td></tr>';
    othList.forEach(function(f){ var g=gIng(f.pct); gOthTot+=g; tbody+=row(f.name,f.pct,g); });
    tbody += '<tr style="font-weight:700;background:rgba(200,146,42,.08)"><td style="padding:7px 10px;color:var(--cream)" colspan="2">Subtotal otros</td><td style="padding:7px 10px;text-align:right;font-family:monospace;color:var(--cream)">'+Math.round(gOthTot)+'g</td></tr>';
  }

  var units = Math.round(factor*100)/100;
  tbody += '<tr style="font-weight:800;background:rgba(200,146,42,.14);border-top:2px solid var(--gold)"><td style="padding:8px 10px;color:var(--gold)" colspan="2">TOTAL MASA</td><td style="padding:8px 10px;text-align:right;font-family:monospace;font-size:16px;color:var(--gold)">'+Math.round(masaTot)+'g</td></tr>'
    +'<tr style="background:rgba(200,146,42,.05)"><td style="padding:7px 10px;color:var(--cream2);font-size:12px" colspan="2">Factor de escala</td><td style="padding:7px 10px;text-align:right;font-family:monospace;font-weight:700;color:var(--gold)">×'+factor.toFixed(2)+' ('+masaObj+'g ÷ '+baseMasa+'g base)</td></tr>';

  var notesHtml = r.note
    ? '<div style="margin-top:16px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--gold);margin-bottom:6px">Notas / Procedimiento</div><pre style="font-size:12px;color:var(--cream2);line-height:1.8;white-space:pre-wrap;font-family:inherit,sans-serif">'+r.note+'</pre></div>'
    : '';
  var code = r.code ? r.code+' · ' : '';

  document.getElementById('gmrec-vista-content').innerHTML =
    '<div id="gmrec-print-area">'
    +'<div style="margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--gold);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">'
    +'<div><div style="font-family:inherit,serif;font-size:22px;font-weight:900;color:var(--cream)">🌾 '+r.name+'</div>'
    +'<div style="font-size:11px;font-family:monospace;color:var(--gold2);margin-top:2px">'+code+'factor ×'+factor.toFixed(2)+'</div></div>'
    +'<div style="text-align:right"><div style="font-size:11px;color:var(--cream2)">Masa objetivo</div>'
    +'<div style="font-family:monospace;font-size:24px;font-weight:700;color:var(--gold)">'+masaObj+'g</div></div>'
    +'</div>'
    +'<div style="overflow-x:auto;border:1px solid var(--border);border-radius:var(--r);margin-bottom:12px">'
    +'<table style="width:100%;border-collapse:collapse;font-size:13px">'
    +'<thead><tr style="background:rgba(200,146,42,.1)"><th style="padding:7px 10px;text-align:left">Componente</th><th style="padding:7px 10px;text-align:right">%</th><th style="padding:7px 10px;text-align:right;color:var(--gold)">Gramos</th></tr></thead>'
    +'<tbody>'+tbody+'</tbody></table></div>'
    +notesHtml+'</div>';
}

function gmRecetarioImprimir() {
  var area = document.getElementById('gmrec-print-area');
  if (!area) return;
  var masa = document.getElementById('gmrec-masa-obj').value;
  var w = window.open('','_blank','width=900,height=700');
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+(_gmRecActual||'GM')+' — '+masa+'g</title>'
    +'<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600&family=DM+Mono&display=swap" rel="stylesheet">'
    +'<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"DM Sans",sans-serif;font-size:13px;color:#1a1006;padding:28px;background:#fff}table{width:100%;border-collapse:collapse}th{background:#f5e8d0;padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px}td{padding:8px 10px;border-bottom:1px solid #e8dcc8;vertical-align:middle}pre{font-family:"DM Sans",sans-serif;white-space:pre-wrap;line-height:1.8;font-size:12px;color:#5a4020}@media print{body{padding:16px}}</style>'
    +'</head><body>');
  w.document.write(area.innerHTML.replace(/var\(--[^)]+\)/g,'inherit').replace(/class="cpill"/g,''));
  w.document.write('</body></html>');
  w.document.close();
  w.focus();
  setTimeout(function(){ w.print(); },600);
}



function hidCalc() {
  const harina = parseFloat(document.getElementById('hh').value)||0;
  const agua   = parseFloat(document.getElementById('ha').value)||0;
  const mm     = parseFloat(document.getElementById('hmm').value)||0;
  const mms    = parseFloat(document.getElementById('hmms').value)||1;
  const mmh    = parseFloat(document.getElementById('hmmh').value)||1;
  const mma    = parseFloat(document.getElementById('hmma').value)||1;
  const tz     = parseFloat(document.getElementById('htz').value)||0;
  const tzh    = parseFloat(document.getElementById('htzh').value)||1;
  const tza    = parseFloat(document.getElementById('htza').value)||5;
  const huevo  = parseFloat(document.getElementById('hhuevo').value)||0;
  const leche  = parseFloat(document.getElementById('hleche').value)||0;
  const mant   = parseFloat(document.getElementById('hmant').value)||0;

  const mmD   = mms+mmh+mma;
  const mmHw  = mmD>0 ? mm*(mmh/mmD) : 0;
  const mmAw  = mmD>0 ? mm*(mma/mmD) : 0;
  const tzD   = tzh+tza;
  const tzHw  = tzD>0 ? tz*(tzh/tzD) : 0;
  const tzAw  = tzD>0 ? tz*(tza/tzD) : 0;
  const aqEnr = huevo*0.74 + leche*0.87 + mant*0.16;
  const hTotal= harina + mmHw + tzHw;
  const aTotal= agua   + mmAw + tzAw + aqEnr;
  const hid   = hTotal>0 ? (aTotal/hTotal*100) : 0;
  const masa  = harina+agua+mm+tz+huevo+leche+mant;

  const f = n => n.toFixed(1);
  const line = (lbl,val,gold=false) =>
    `<div class="hid-line${gold?' hid-total':''}"><span>${lbl}</span><span>${val}</span></div>`;

  let html = '';
  html += line('Harina base', f(harina)+'g');
  if (mm>0) html += line(`  → MM harina (${f(mm)}g)`, f(mmHw)+'g');
  if (tz>0) html += line(`  → Tang Zhong harina`, f(tzHw)+'g');
  html += `<div class="hid-line"><span><strong>Harina total</strong></span><span><strong>${f(hTotal)}g</strong></span></div>`;
  html += '<div style="height:6px"></div>';
  html += line('Agua base', f(agua)+'g');
  if (mm>0) html += line('  → MM agua', f(mmAw)+'g');
  if (tz>0) html += line('  → TZ agua', f(tzAw)+'g');
  if (aqEnr>0) html += line('  → Enriquecidos agua', f(aqEnr)+'g');
  html += `<div class="hid-line"><span><strong>Agua total</strong></span><span><strong>${f(aTotal)}g</strong></span></div>`;
  html += '<div style="height:6px"></div>';
  html += `<div class="hid-line hid-total"><span>🌊 HIDRATACIÓN REAL</span><span>${hid.toFixed(1)}%</span></div>`;
  html += line('Masa total aprox.', f(masa)+'g');

  document.getElementById('hid-result').innerHTML = html;
}

function hidReset() {
  document.getElementById('hh').value=500;
  document.getElementById('ha').value=350;
  document.getElementById('hmm').value=100;
  ['htz','hhuevo','hleche','hmant'].forEach(id=>document.getElementById(id).value=0);
  document.getElementById('hmms').value=1;
  document.getElementById('hmmh').value=1;
  document.getElementById('hmma').value=1;
  document.getElementById('htzh').value=1;
  document.getElementById('htza').value=5;
  hidCalc();
}
