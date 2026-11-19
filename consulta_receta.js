// ═══════════════════════════════════════════════════════════════
// consulta_receta.js — "🔗 Dónde se usa" (prefijo crq*)
//
// Consulta sencilla de SOLO LECTURA: eliges una receta y ves, a un solo
// nivel (hijos directos, sin cascada):
//   1) Los panes y galletas (tipos de producto) cuya receta es esa.
//   2) Las recetas que la llevan directamente como sub-receta, relleno
//      o cobertura (subrecs / addons).
// No escribe en Supabase ni en localStorage.
// ═══════════════════════════════════════════════════════════════

let _crqCod = '';

function crqInit() {
  const out = document.getElementById('crq-out');
  if (!out) return;
  const recs = pmOrdenar((_sbRecLista() || []).filter(r => r.code), 'name');
  out.innerHTML =
    '<div class="card">' +
      '<label>Receta</label>' +
      '<select id="crq-sel" onchange="crqElegir(this.value)">' +
        '<option value="">— Elige una receta —</option>' +
        recs.map(r => '<option value="' + pmEsc(r.code) + '"' + (r.code === _crqCod ? ' selected' : '') + '>' +
          pmEsc(r.name) + ' · ' + pmEsc(r.code) + '</option>').join('') +
      '</select>' +
    '</div>' +
    '<div id="crq-res"></div>';
  if (_crqCod) crqElegir(_crqCod);
}

function crqElegir(cod) {
  _crqCod = cod || '';
  const el = document.getElementById('crq-res');
  if (!el) return;
  if (!_crqCod) { el.innerHTML = ''; return; }

  const recs = _sbRecLista() || [];
  const rec = recs.find(r => r.code === _crqCod);

  // 1) Productos directos (pan y galleta)
  const prods = [];
  (G.tiposPan || []).forEach(p => { if (p.recetaCod === _crqCod) prods.push({ tipo: '🍞 Pan', p: p }); });
  (G.tiposGalleta || []).forEach(p => { if (p.recetaCod === _crqCod) prods.push({ tipo: '🍪 Galleta', p: p }); });
  prods.sort((a, b) => String(a.p.nombre).localeCompare(String(b.p.nombre), 'es'));

  // 2) Recetas que la usan directamente (sub-receta, relleno o cobertura)
  const padres = [];
  recs.forEach(r => {
    if (r.code === _crqCod) return;
    const rol = [];
    if ((r.subrecs || []).some(s => s.recId === _crqCod)) rol.push('Sub-receta');
    if ((r.addons || []).some(a => a.recId === _crqCod)) rol.push('Relleno / cobertura');
    if (rol.length) padres.push({ r: r, rol: rol.join(' + ') });
  });
  padres.sort((a, b) => String(a.r.name).localeCompare(String(b.r.name), 'es'));

  const th = 'style="text-align:left;padding:6px 8px;background:var(--bg3);color:var(--gold2);font-size:12px"';
  const td = 'style="padding:6px 8px;border-top:1px solid #E1E8DD;font-size:13px"';
  const tdn = 'style="padding:6px 8px;border-top:1px solid #E1E8DD;font-size:13px;text-align:right"';

  let h = '<div class="card"><div class="ctitle">Se elabora con ' + pmEsc(rec ? rec.name : _crqCod) + ' (' + pmEsc(_crqCod) + ')</div>';
  if (prods.length) {
    h += '<table style="width:100%;border-collapse:collapse"><tr>' +
      '<th ' + th + '>Tipo</th><th ' + th + '>Producto</th><th ' + th + '>Peso</th><th ' + th + '>Precio</th></tr>' +
      prods.map(x =>
        '<tr><td ' + td + '>' + x.tipo + '</td><td ' + td + '>' + pmEsc(x.p.nombre) + '</td>' +
        '<td ' + tdn + '>' + (x.p.peso ? pmEsc(String(x.p.peso)) + ' g' : '—') + '</td>' +
        '<td ' + tdn + '>' + (x.p.precio ? pmEsc(pmMoney(Math.round(x.p.precio))) : '—') + '</td></tr>').join('') +
      '</table>';
  } else {
    h += '<div style="font-size:13px;color:var(--cream2)">Ningún tipo de pan ni de galleta usa esta receta directamente.</div>';
  }
  h += '</div>';

  h += '<div class="card"><div class="ctitle">Recetas que la llevan dentro</div>';
  if (padres.length) {
    h += '<table style="width:100%;border-collapse:collapse"><tr>' +
      '<th ' + th + '>Receta</th><th ' + th + '>Código</th><th ' + th + '>Como</th></tr>' +
      padres.map(x =>
        '<tr><td ' + td + '>' + pmEsc(x.r.name) + '</td><td ' + td + '>' + pmEsc(x.r.code) + '</td>' +
        '<td ' + td + '>' + pmEsc(x.rol) + '</td></tr>').join('') +
      '</table>';
  } else {
    h += '<div style="font-size:13px;color:var(--cream2)">Ninguna otra receta la usa como sub-receta, relleno o cobertura.</div>';
  }
  h += '</div>';

  el.innerHTML = h;
}
