// ═══════════════════════════════════════════════════════════════
// molde.js — "📏 Masa por molde" (prefijo mol*)
//
// Calculadora de cuánta masa cruda poner en un molde:
//   V = Largo × Ancho × Alto   (cm³; molde redondo: π × r² × Alto)
//   M = V × F                  (F = factor de llenado en g/cm³)
//
// Es SOLO una utilidad de cálculo: no lee ni escribe Supabase, ni
// localStorage, ni toca recetas. Todo vive en memoria mientras la pestaña
// está abierta. Valores de referencia orientativos (ajustar tras 2–3 pruebas).
// ═══════════════════════════════════════════════════════════════

const MOL_TIPOS = [
  { n: 'Masa blanca, hidratación 65–70 %', min: 0.40, max: 0.45 },
  { n: 'Masa blanca, hidratación 70–75 %', min: 0.38, max: 0.43 },
  { n: 'Masa integral',                    min: 0.42, max: 0.48 },
  { n: 'Masa con semillas',                min: 0.43, max: 0.48 },
  { n: 'Masa enriquecida',                 min: 0.40, max: 0.45 }
];
const MOL_FACTORES = [
  { v: 0.40, n: 'Masa blanca ligera' },
  { v: 0.42, n: 'Masa blanca estándar' },
  { v: 0.45, n: 'Masa más densa' },
  { v: 0.48, n: 'Integral o con semillas' }
];
const MOL_VOLS = [1000, 1500, 2000, 2500, 3000, 3500];

let _molForma = 'rect';   // 'rect' | 'redondo'
let _molF = 0.42;         // factor de llenado elegido
let _molEstiloOk = false;

function _molN(id) {
  const el = document.getElementById(id);
  const v = el ? parseFloat(String(el.value).replace(',', '.')) : NaN;
  return isNaN(v) ? 0 : v;
}
function _molFmt(n, d) {
  return n.toLocaleString('es-CR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
}

function _molAsegurarEstilo() {
  if (_molEstiloOk) return;
  _molEstiloOk = true;
  const st = document.createElement('style');
  st.textContent =
    '.mol-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start}' +
    '.mol-fila{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}' +
    '.mol-fila label{display:block;font-size:11px;color:var(--cream2);margin-bottom:3px}' +
    '.mol-opt{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid #C8D4C3;border-radius:var(--rs);margin-bottom:6px;cursor:pointer;font-size:13px}' +
    '.mol-opt input{width:auto;margin:0}' +
    '.mol-opt.on{border-color:var(--gold);background:rgba(46,107,69,.07)}' +
    '.mol-opt b{color:var(--gold);min-width:38px}' +
    '.mol-res{text-align:center;padding:14px 8px;background:var(--bg3);border-radius:var(--r);margin-bottom:10px}' +
    '.mol-res .g{font-family:"Playfair Display",serif;font-size:38px;font-weight:700;color:var(--gold);line-height:1.1}' +
    '.mol-res .s{font-size:12px;color:var(--cream2);margin-top:4px}' +
    '.mol-t{width:100%;border-collapse:collapse;font-size:13px}' +
    '.mol-t th{background:var(--bg3);color:var(--gold2);text-align:left;padding:6px 8px;font-size:12px}' +
    '.mol-t td{padding:6px 8px;border-top:1px solid #E1E8DD}' +
    '.mol-t td.n,.mol-t th.n{text-align:right}' +
    '.mol-t tr.hi td{background:rgba(46,107,69,.1);font-weight:600}' +
    '.mol-nota{font-size:12px;color:var(--cream2);margin-top:8px;line-height:1.5}' +
    '.mol-nota li{margin-left:18px}';
  document.head.appendChild(st);
}

function molInit() {
  _molAsegurarEstilo();
  const out = document.getElementById('mol-out');
  if (!out) return;
  if (out.dataset.listo) { molCalc(); return; }   // ya armada: conserva lo escrito
  out.dataset.listo = '1';
  const opts = MOL_FACTORES.map(f =>
    '<label class="mol-opt" id="mol-opt-' + f.v + '"><input type="radio" name="mol-f" value="' + f.v + '"' +
    (f.v === _molF ? ' checked' : '') + ' onchange="molElegirF(' + f.v + ')"><b>' + f.v.toFixed(2).replace('.', ',') +
    '</b><span>' + f.n + '</span></label>'
  ).join('');
  const tipos = MOL_TIPOS.map(t =>
    '<tr><td>' + t.n + '</td><td class="n">' + t.min.toFixed(2).replace('.', ',') + ' – ' + t.max.toFixed(2).replace('.', ',') + '</td></tr>'
  ).join('');
  out.innerHTML =
    '<div class="mol-grid">' +
    // ── Calculadora ──
    '<div class="card"><h2 style="font-size:15px;margin-bottom:10px">🧮 Calculadora de masa por molde</h2>' +
    '<div style="display:flex;gap:6px;margin-bottom:10px">' +
    '<button class="pill on" id="mol-f-rect" onclick="molForma(\'rect\')">▭ Rectangular</button>' +
    '<button class="pill" id="mol-f-redondo" onclick="molForma(\'redondo\')">◯ Redondo</button></div>' +
    '<div class="mol-fila"><div id="mol-c-largo"><label id="mol-l-largo">Largo (cm)</label><input type="number" id="mol-largo" value="25" min="0" step="0.5" oninput="molCalc()"></div>' +
    '<div id="mol-c-ancho"><label>Ancho (cm)</label><input type="number" id="mol-ancho" value="11" min="0" step="0.5" oninput="molCalc()"></div>' +
    '<div><label>Alto (cm)</label><input type="number" id="mol-alto" value="8" min="0" step="0.5" oninput="molCalc()"></div></div>' +
    '<div style="font-size:12px;font-weight:600;margin-bottom:6px">Factor de llenado (g/cm³)</div>' + opts +
    '<label class="mol-opt" id="mol-opt-otro"><input type="radio" name="mol-f" value="otro" onchange="molElegirF(\'otro\')"><b>Otro</b>' +
    '<input type="number" id="mol-f-otro" value="0.44" min="0.2" max="0.8" step="0.01" style="max-width:90px" oninput="molElegirF(\'otro\')"></label>' +
    '<div style="margin:10px 0 4px"><label style="font-size:11px;color:var(--cream2)">Cantidad de moldes</label>' +
    '<input type="number" id="mol-cant" value="1" min="1" step="1" style="max-width:100px" oninput="molCalc()"></div>' +
    '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-out btn-sm" onclick="molReset()">↺ Restablecer</button></div>' +
    '</div>' +
    // ── Resultado ──
    '<div><div class="card"><div class="mol-res"><div style="font-size:11px;color:var(--cream2);text-transform:uppercase;letter-spacing:1px">Cantidad estimada de masa cruda</div>' +
    '<div class="g" id="mol-g">—</div><div class="s" id="mol-s"></div></div>' +
    '<div id="mol-pasos" style="font-size:13px;line-height:1.7"></div></div>' +
    '<div class="card"><h2 style="font-size:15px;margin-bottom:8px">Factores de llenado orientativos</h2>' +
    '<table class="mol-t"><tr><th>Tipo de masa</th><th class="n">Factor (g/cm³)</th></tr>' + tipos + '</table>' +
    '<div class="mol-nota">Son valores orientativos. El factor de llenado <b>no es la hidratación</b>: la hidratación es la proporción de agua respecto a la harina; el factor se refiere al volumen del molde y la cantidad de masa que se coloca.</div></div>' +
    '</div>' +
    // ── Tabla por volumen + consejos ──
    '<div><div class="card"><h2 style="font-size:15px;margin-bottom:8px">Tabla orientativa por volumen</h2>' +
    '<table class="mol-t" id="mol-tv"></table></div>' +
    '<div class="card"><h2 style="font-size:15px;margin-bottom:8px">💡 Consejos</h2><ul class="mol-nota" style="margin-top:0">' +
    '<li>Usá siempre las dimensiones <b>interiores</b> del molde.</li>' +
    '<li>Pesá la masa antes de colocarla.</li>' +
    '<li>Registrá el volumen que alcanza tras fermentar y hornear.</li>' +
    '<li>Después de 2–3 pruebas, establecé tu propio factor para cada molde.</li></ul></div></div>' +
    '</div>';
  molForma('rect');
}

function molForma(f) {
  _molForma = f;
  const r = document.getElementById('mol-f-rect'), c = document.getElementById('mol-f-redondo');
  if (r) r.classList.toggle('on', f === 'rect');
  if (c) c.classList.toggle('on', f === 'redondo');
  const lbl = document.getElementById('mol-l-largo');
  if (lbl) lbl.textContent = f === 'rect' ? 'Largo (cm)' : 'Diámetro (cm)';
  const an = document.getElementById('mol-c-ancho');
  if (an) an.style.visibility = f === 'rect' ? 'visible' : 'hidden';
  if (f === 'redondo') { const l = document.getElementById('mol-largo'); if (l && _molN('mol-largo') === 25) l.value = 22; if (_molN('mol-alto') === 8) document.getElementById('mol-alto').value = 7; }
  molCalc();
}

function molElegirF(v) {
  if (v === 'otro') {
    _molF = _molN('mol-f-otro');
    const r = document.querySelector('input[name="mol-f"][value="otro"]'); if (r) r.checked = true;
  } else { _molF = v; }
  molCalc();
}

function molReset() {
  const out = document.getElementById('mol-out');
  if (out) { out.dataset.listo = ''; }
  _molForma = 'rect'; _molF = 0.42;
  molInit();
}

function molCalc() {
  const L = _molN('mol-largo'), A = _molN('mol-ancho'), H = _molN('mol-alto');
  const cant = Math.max(1, Math.round(_molN('mol-cant')) || 1);
  const F = _molF;
  const V = _molForma === 'rect' ? L * A * H : Math.PI * Math.pow(L / 2, 2) * H;
  const M = V * F;
  // resaltar opción elegida
  document.querySelectorAll('.mol-opt').forEach(el => el.classList.remove('on'));
  const sel = document.querySelector('input[name="mol-f"]:checked');
  if (sel && sel.parentElement) sel.parentElement.classList.add('on');
  const g = document.getElementById('mol-g'), s = document.getElementById('mol-s'), p = document.getElementById('mol-pasos');
  if (!g) return;
  if (!(V > 0) || !(F > 0)) {
    g.textContent = '—'; s.textContent = 'Ingresá las medidas interiores del molde'; p.innerHTML = '';
  } else {
    g.textContent = _molFmt(Math.round(M)) + ' g';
    s.innerHTML = 'Volumen: <b>' + _molFmt(Math.round(V)) + ' cm³</b>' +
      (cant > 1 ? ' · ' + cant + ' moldes = <b>' + _molFmt(Math.round(M * cant)) + ' g</b> en total' : '');
    const medidas = _molForma === 'rect'
      ? _molFmt(L, 1) + ' × ' + _molFmt(A, 1) + ' × ' + _molFmt(H, 1)
      : 'π × (' + _molFmt(L / 2, 1) + ')² × ' + _molFmt(H, 1);
    p.innerHTML =
      '<b>1.</b> Volumen: ' + medidas + ' = <b>' + _molFmt(Math.round(V)) + ' cm³</b><br>' +
      '<b>2.</b> Masa: ' + _molFmt(Math.round(V)) + ' × ' + String(F).replace('.', ',') + ' = <b>' + _molFmt(Math.round(M)) + ' g</b>';
  }
  // tabla por volumen con el tipo de rango 0,40–0,45 y el volumen más cercano resaltado
  const tv = document.getElementById('mol-tv');
  if (tv) {
    const cerca = V > 0 ? MOL_VOLS.reduce((a, b) => Math.abs(b - V) < Math.abs(a - V) ? b : a) : 0;
    tv.innerHTML = '<tr><th>Volumen del molde (cm³)</th><th class="n">Masa estimada (g)</th></tr>' +
      MOL_VOLS.map(v =>
        '<tr' + (v === cerca && V > 0 && Math.abs(v - V) <= 250 ? ' class="hi"' : '') + '><td>' + _molFmt(v) + '</td><td class="n">' +
        _molFmt(Math.round(v * 0.40)) + ' – ' + _molFmt(Math.round(v * 0.45)) + '</td></tr>'
      ).join('');
  }
}
