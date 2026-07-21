// ── 📋 PLAN LIBRE ────────────────────────────────────────────────────────────

function planLibreGetClave(fecha) {
  return 'pl_' + (fecha || pmHoy());
}

function planLibreGetPlan(fecha) {
  // Plan libre se guarda en G.planLibre separado de G.planProduccion
  if (!G.planLibre) G.planLibre = {};
  if (!G.planLibre[fecha]) G.planLibre[fecha] = [];
  return G.planLibre[fecha];
}

function planLibreNav(d) {
  const dt = new Date(document.getElementById('pl-fecha').value + 'T12:00:00');
  dt.setDate(dt.getDate() + d);
  document.getElementById('pl-fecha').value = dt.toISOString().slice(0,10);
  planLibreRender();
}

function planLibreRender() {
  const fecha = document.getElementById('pl-fecha')?.value || pmHoy();
  if (!document.getElementById('pl-fecha').value)
    document.getElementById('pl-fecha').value = fecha;

  const plan = planLibreGetPlan(fecha);

  // Llenar selector
  const sel = document.getElementById('pl-sel-pan');
  if (sel) {
    const yaEnPlan = new Set(plan.map(r => r.pid));
    sel.innerHTML = G.tiposPan
      .filter(p => !yaEnPlan.has(p.id))
      .map(p => {
        const rec = p.recetaCod ? ` [${p.recetaCod}]` : '';
        return `<option value="${p.id}">${p.nombre}${rec}</option>`;
      }).join('') || '<option value="">— todos en el plan —</option>';
  }

  // Stats
  const totalUd    = plan.reduce((s,r) => s + (r.cant||0), 0);
  const totalPeso  = plan.reduce((s,r) => {
    const tp = G.tiposPan.find(p => p.id === r.pid);
    return s + (r.cant||0) * (tp?.peso||0);
  }, 0);
  const totalVal   = plan.reduce((s,r) => {
    const tp = G.tiposPan.find(p => p.id === r.pid);
    return s + (r.cant||0) * (tp?.precio||0);
  }, 0);

  document.getElementById('pl-stats').innerHTML = `
    <div class="stat"><div class="stat-lbl">Tipos</div><div class="stat-val">${plan.length}</div></div>
    <div class="stat"><div class="stat-lbl">Unidades</div><div class="stat-val" style="color:var(--gold)">${totalUd}</div></div>
    <div class="stat"><div class="stat-lbl">Peso total</div><div class="stat-val">${(totalPeso/1000).toFixed(1)} kg</div></div>
    <div class="stat"><div class="stat-lbl">Valor ₡</div><div class="stat-val" style="color:var(--green)">${pmMoney(totalVal)}</div></div>
  `;

  // Tabla
  const tbody = document.getElementById('pl-tabla');
  if (!plan.length) {
    tbody.innerHTML = '<div class="ph"><span class="ph-icon">📋</span>Plan vacío — agregá tipos de pan abajo</div>';
    return;
  }

  tbody.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:rgba(200,146,42,.1)">
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Pan</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--blue)">Receta</th>
          <th style="padding:8px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px;width:90px;color:var(--gold)">Cantidad</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.6px;width:80px">Peso tot.</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Nota</th>
          <th style="width:36px" class="no-print"></th>
        </tr>
      </thead>
      <tbody>
        ${plan.map((r,i) => {
          const tp = G.tiposPan.find(p => p.id === r.pid) || { nombre: r.pid, peso:0, recetaCod:'' };
          const pesoTot = (r.cant||0) * (tp.peso||0);
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 10px;font-weight:600;font-size:13px">${tp.nombre}</td>
            <td style="padding:8px 10px">
              ${tp.recetaCod
                ? `<span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--blue);background:rgba(74,128,192,.12);padding:2px 8px;border-radius:10px;border:1px solid rgba(74,128,192,.3)">${tp.recetaCod}</span>`
                : `<span style="font-size:11px;color:var(--cream2);opacity:.4">—</span>`}
            </td>
            <td style="padding:8px 10px;text-align:center">
              <input type="number" min="0" value="${r.cant||0}"
                oninput="planLibreActualizar(${i}, 'cant', parseInt(this.value)||0)"
                style="width:68px;padding:5px 7px;background:var(--sf);border:1px solid var(--gold);border-radius:8px;color:var(--gold);font-family:'DM Mono',monospace;font-size:16px;font-weight:700;text-align:center">
            </td>
            <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--cream2)">
              ${pesoTot >= 1000 ? (pesoTot/1000).toFixed(2)+' kg' : pesoTot+' g'}
            </td>
            <td style="padding:8px 10px">
              <input type="text" value="${r.nota||''}" placeholder="Nota..."
                oninput="planLibreActualizar(${i}, 'nota', this.value)"
                style="width:100%;padding:5px 8px;background:var(--sf);border:1px solid var(--border);border-radius:8px;color:var(--cream);font-size:12px">
            </td>
            <td style="padding:8px 6px;text-align:center" class="no-print">
              <button class="btn btn-red btn-xs" onclick="planLibreQuitar(${i})">✕</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr style="background:rgba(200,146,42,.08);font-weight:700">
          <td style="padding:8px 10px" colspan="2">TOTAL</td>
          <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;color:var(--gold)">${totalUd} ud</td>
          <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px">${(totalPeso/1000).toFixed(2)} kg</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>`;
}

function planLibreActualizar(i, campo, val) {
  const fecha = document.getElementById('pl-fecha').value || pmHoy();
  const plan  = planLibreGetPlan(fecha);
  if (plan[i]) {
    plan[i][campo] = val;
    // Recalcular stats sin re-renderizar toda la tabla (evita perder foco)
    const totalUd   = plan.reduce((s,r) => s + (r.cant||0), 0);
    const totalPeso = plan.reduce((s,r) => {
      const tp = G.tiposPan.find(p => p.id === r.pid);
      return s + (r.cant||0) * (tp?.peso||0);
    }, 0);
    const totalVal  = plan.reduce((s,r) => {
      const tp = G.tiposPan.find(p => p.id === r.pid);
      return s + (r.cant||0) * (tp?.precio||0);
    }, 0);
    document.getElementById('pl-stats').innerHTML = `
      <div class="stat"><div class="stat-lbl">Tipos</div><div class="stat-val">${plan.length}</div></div>
      <div class="stat"><div class="stat-lbl">Unidades</div><div class="stat-val" style="color:var(--gold)">${totalUd}</div></div>
      <div class="stat"><div class="stat-lbl">Peso total</div><div class="stat-val">${(totalPeso/1000).toFixed(1)} kg</div></div>
      <div class="stat"><div class="stat-lbl">Valor ₡</div><div class="stat-val" style="color:var(--green)">${pmMoney(totalVal)}</div></div>
    `;
  }
}

function planLibreAgregar() {
  const fecha = document.getElementById('pl-fecha').value || pmHoy();
  const pid   = document.getElementById('pl-sel-pan').value;
  const cant  = parseInt(document.getElementById('pl-sel-cant').value) || 1;
  if (!pid) { pmToast('Seleccioná un tipo de pan', 'err'); return; }
  const plan = planLibreGetPlan(fecha);
  if (plan.find(r => r.pid === pid)) { pmToast('Ya está en el plan', 'err'); return; }
  plan.push({ pid, cant, nota: '' });
  planLibreRender();
  pmToast('Agregado al plan ✓');
}

function planLibreQuitar(i) {
  const fecha = document.getElementById('pl-fecha').value || pmHoy();
  const plan  = planLibreGetPlan(fecha);
  plan.splice(i, 1);
  planLibreRender();
}

function planLibreGuardar() {
  const fecha = document.getElementById('pl-fecha').value || pmHoy();
  const plan  = planLibreGetPlan(fecha);
  pmSave('planlibre');
  pmToast('Plan guardado ✓', 'ok');
  // ── Sesión 7: dual write a Supabase plan_produccion (tipo='libre') ──
  if (pmDB.disponible()) {
    const rows = plan.map(r => {
      const sbId = _sbProdMap?.[r.pid];
      if (!sbId) return null;
      return { fecha, producto_id: sbId, cantidad: r.cant || 0, tipo: 'libre', nota: r.nota || null };
    }).filter(Boolean);
    const mapaProdOk = _sbProdMap && Object.keys(_sbProdMap).length > 0;
    if (rows.length) {
      pmDB.planProduccion.guardar(rows, fecha, 'libre').catch(e => console.warn('[pmDB] plan_produccion libre upsert:', e.message));
    } else if (mapaProdOk) {
      // SESIÓN 11 fix: mismo bug que en el plan normal — si quedó vacío
      // (todo borrado) había que avisar a Supabase para limpiar lo viejo.
      pmDB.planProduccion.guardar([], fecha, 'libre').catch(e => console.warn('[pmDB] plan_produccion libre clear:', e.message));
    }
  }
}

function planLibreLimpiar() {
  if (!confirm('¿Limpiar el plan de este día?')) return;
  const fecha = document.getElementById('pl-fecha').value || pmHoy();
  if (G.planLibre) G.planLibre[fecha] = [];
  planLibreRender();
  pmToast('Plan limpiado');
}




// ─── SESIÓN 10 — CLIENTES Y PRECIOS ESPECIALES ──────────────────────────────
// Fuente primaria: Supabase (tablas clientes + precios_cliente)
// Los clientes NO viven en localStorage G — solo en Supabase

let _sbCliCache = null;

// ── Cargar clientes desde Supabase ──
async function _sbCliCargar() {
  if (!pmDB.disponible()) return [];
  try {
    const rows = await pmDB.clientes.listar();
    _sbCliCache = rows || [];
    return _sbCliCache;
  } catch(e) {
    console.warn('[pmDB] cliCargar:', e.message);
    return [];
  }
}

// ── Generar próximo código ──
async function _cliNextCodigo() {
  const clientes = _sbCliCache || await _sbCliCargar();
  const nums = clientes
    .map(c => c.codigo || '')
    .filter(c => /^CLI-\d+$/.test(c))
    .map(c => parseInt(c.replace('CLI-', '')));
  const max = nums.length ? Math.max(...nums) : 0;
  return 'CLI-' + String(max + 1).padStart(4, '0');
}

// ── Mostrar/ocultar campo días crédito ──
function cliCondPagoChange() {
  const val = document.getElementById('cli-condpago').value;
  document.getElementById('cli-dias-col').style.display = val === 'credito' ? 'block' : 'none';
}

// ── Abrir formulario nuevo cliente ──
async function cliNuevo() {
  document.getElementById('cli-edit-id').value  = '';
  document.getElementById('cli-nom').value      = '';
  document.getElementById('cli-tipo').value     = 'regular';
  document.getElementById('cli-tel').value      = '';
  document.getElementById('cli-condpago').value = 'contado';
  document.getElementById('cli-dias').value     = '7';
  document.getElementById('cli-dias-col').style.display = 'none';
  document.getElementById('cli-form-title').textContent = 'Nuevo cliente';
  document.getElementById('cli-email').value    = '';
  document.getElementById('cli-dir-fact').value = '';
  document.getElementById('cli-dir-env').value  = '';
  const next = await _cliNextCodigo();
  document.getElementById('cli-cod').value = next;
  const fc = document.getElementById('cli-form-card');
  fc.style.display = 'block';
  fc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('cli-nom').focus();
}

// ── Render lista de clientes ──
async function cliRender() {
  const el = document.getElementById('cli-list');
  if (!el) return;
  el.innerHTML = '<div class="ph" style="padding:10px 0"><span class="ph-icon" style="font-size:20px">⏳</span>Cargando...</div>';
  const clientes = await _sbCliCargar();
  const q = (document.getElementById('cli-search')?.value || '').toLowerCase();
  const lista = clientes
    .filter(c => !q || c.nombre.toLowerCase().includes(q))
    .sort((a, b) => (a.codigo||'').localeCompare(b.codigo||''));
  const countEl = document.getElementById('cli-count');
  if (countEl) countEl.textContent = 'Clientes (' + lista.length + ')';
  if (!lista.length) {
    el.innerHTML = q
      ? '<div class="ph"><span class="ph-icon">🔍</span>Sin resultados para esa búsqueda</div>'
      : '<div class="ph"><span class="ph-icon">👥</span>Sin clientes — presioná "+ Nuevo cliente"</div>';
    return;
  }
  const tipoBadge = t => {
    const map = {
      comercial: ['var(--gold)',  'rgba(200,146,42,.15)', 'rgba(200,146,42,.3)',  'Comercial'],
      mayorista: ['var(--blue)',  'rgba(74,128,192,.12)', 'rgba(74,128,192,.3)',  'Mayorista'],
      minorista: ['var(--cream2)','rgba(100,100,100,.1)', 'rgba(100,100,100,.2)', 'Minorista'],
      regular:   ['var(--cream2)','rgba(74,128,192,.08)', 'rgba(74,128,192,.2)',  'Regular'],
    };
    const [color, bg, border, label] = map[t] || map.regular;
    return '<span style="font-size:10px;font-weight:600;color:'+color+';background:'+bg+';border:1px solid '+border+';border-radius:10px;padding:1px 8px">'+label+'</span>';
  };
  const condBadge = c => {
    if (!c.condicion_pago || c.condicion_pago === 'contado')
      return '<span style="font-size:10px;color:var(--green)">💵 Contado</span>';
    const dias = c.dias_credito || 7;
    return '<span style="font-size:10px;color:var(--blue)">📅 Crédito ' + dias + 'd</span>';
  };
  el.innerHTML = lista.map(c => {
    const nomEsc = c.nombre.replace(/'/g, "\\'");
    return '<div class="item-row" style="align-items:center;gap:8px">' +
      '<div style="flex:1;min-width:0">' +
        '<div class="item-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--cream2);background:rgba(37,99,235,.08);border:1px solid var(--border);border-radius:6px;padding:1px 7px">' + (c.codigo||'') + '</span>' +
          '<span style="font-weight:600">' + c.nombre + '</span>' +
          tipoBadge(c.tipo||'regular') +
        '</div>' +
        '<div style="font-size:11px;color:var(--cream2);margin-top:3px;display:flex;gap:10px;flex-wrap:wrap">' +
          (c.telefono ? '<span>📞 ' + c.telefono + '</span>' : '') +
          (c.email ? '<span>✉️ ' + c.email + '</span>' : '') +
          condBadge(c) +
          (c.direccion_facturacion ? '<span style="font-size:10px">📍 ' + c.direccion_facturacion + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:5px;flex-shrink:0">' +
        '<button class="btn btn-out btn-sm" onclick="cliEditar(\''+c.id+'\')">✎</button>' +
        '<button class="btn btn-out btn-sm" onclick="cliPreciosVer(\''+c.id+'\',\''+nomEsc+'\')">💲</button>' +
        '<button class="btn btn-red btn-xs" onclick="cliDel(\''+c.id+'\')">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Guardar cliente (nuevo o edición) ──
async function cliSave() {
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  const editId = document.getElementById('cli-edit-id').value;
  const cod    = document.getElementById('cli-cod').value.trim().toUpperCase();
  const nom    = document.getElementById('cli-nom').value.trim();
  const tipo   = document.getElementById('cli-tipo').value;
  const tel    = document.getElementById('cli-tel').value.trim();
  const cond   = document.getElementById('cli-condpago').value;
  const dias   = cond === 'credito' ? (parseInt(document.getElementById('cli-dias').value) || 7) : null;
  const email  = document.getElementById('cli-email').value.trim() || null;
  const dirFact = document.getElementById('cli-dir-fact').value.trim() || null;
  const dirEnv  = document.getElementById('cli-dir-env').value.trim() || null;
  if (!nom) { pmToast('Completá el nombre', 'err'); return; }
  if (!cod) { pmToast('El código es requerido', 'err'); return; }
  const clientes = _sbCliCache || await _sbCliCargar();
  const dup = clientes.find(c => c.codigo === cod && c.id !== editId);
  if (dup) { pmToast('Código ' + cod + ' ya existe — ' + dup.nombre, 'err'); return; }
  const datos = { codigo: cod, nombre: nom, tipo, telefono: tel || null, condicion_pago: cond, dias_credito: dias, email, direccion_facturacion: dirFact, direccion_envio: dirEnv };
  try {
    if (editId) {
      await pmDB.clientes.editar(editId, datos);
      pmToast('Cliente actualizado ✓', 'ok');
    } else {
      const rows = await pmDB.clientes.crear({ ...datos, activo: true });
      pmToast('Cliente agregado ✓', 'ok');
      // Si hay un pedido de pan esperando vinculación, vincular automáticamente
      if (window._ppVincularPedId && rows?.[0]) {
        const pedId = window._ppVincularPedId;
        const p     = G.pedidosPan.find(x => x.id === pedId);
        if (p) {
          p.cliId  = rows[0].id;
          p.cliCod = cod;
          p.cliNom = nom;
          pmSave('pedidos');
          pmToast(`Vinculado con pedido de ${p.cli} ✓`, 'ok');
          // FIX: mismo bug que ppConfirmarVinculo — antes esto tampoco
          // se sincronizaba a Supabase.
          if (pmDB.disponible() && (p._sbId || p._sbCreatePromise)) {
            (async () => {
              try {
                if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
                if (!p._sbId) throw new Error('el pedido todavía no se creó en Supabase');
                await pmDB.pedidos.editar(p._sbId, { cliente_id: rows[0].id });
              } catch(e) {
                console.warn('[pmDB] ppVincular (nuevo cliente) error:', e.message);
                pmToast('⚠️ Vínculo guardado solo local — no se sincronizó a Supabase: ' + e.message, 'err');
              }
            })();
          }
        }
        window._ppVincularPedId = null;
      }
      if (window._pgVincularPedId && rows?.[0]) {
        const pedId = window._pgVincularPedId;
        const p     = G.pedidosGalletas.find(x => x.id === pedId);
        if (p) {
          p.cliId  = rows[0].id;
          p.cliCod = cod;
          p.cliNom = nom;
          pmSave('pedidos');
          pmToast(`Vinculado con pedido de ${p.cli} ✓`, 'ok');
          // FIX: mismo bug — antes tampoco se sincronizaba a Supabase.
          if (pmDB.disponible() && (p._sbId || p._sbCreatePromise)) {
            (async () => {
              try {
                if (!p._sbId && p._sbCreatePromise) await p._sbCreatePromise.catch(()=>{});
                if (!p._sbId) throw new Error('el pedido todavía no se creó en Supabase');
                await pmDB.pedidos.editar(p._sbId, { cliente_id: rows[0].id });
              } catch(e) {
                console.warn('[pmDB] pgVincular (nuevo cliente) error:', e.message);
                pmToast('⚠️ Vínculo guardado solo local — no se sincronizó a Supabase: ' + e.message, 'err');
              }
            })();
          }
        }
        window._pgVincularPedId = null;
      }
    }
    cliCancelarEdicion();
    _sbCliCache = null;
    cliRender();
  } catch(e) {
    pmToast('Error al guardar cliente', 'err');
    console.error('[pmDB] cliSave:', e);
  }
}

// ── Editar cliente existente ──
function cliEditar(id) {
  const c = (_sbCliCache || []).find(x => x.id === id);
  if (!c) return;
  document.getElementById('cli-edit-id').value   = id;
  document.getElementById('cli-cod').value        = c.codigo || '';
  document.getElementById('cli-nom').value        = c.nombre;
  document.getElementById('cli-tipo').value       = c.tipo || 'regular';
  document.getElementById('cli-tel').value        = c.telefono || '';
  document.getElementById('cli-condpago').value   = c.condicion_pago || 'contado';
  document.getElementById('cli-dias').value       = c.dias_credito || 7;
  document.getElementById('cli-dias-col').style.display = (c.condicion_pago === 'credito') ? 'block' : 'none';
  document.getElementById('cli-email').value      = c.email || '';
  document.getElementById('cli-dir-fact').value   = c.direccion_facturacion || '';
  document.getElementById('cli-dir-env').value    = c.direccion_envio || '';
  document.getElementById('cli-form-title').textContent = 'Editar — ' + c.nombre;
  const fc = document.getElementById('cli-form-card');
  fc.style.display = 'block';
  fc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Cancelar / cerrar formulario ──
function cliCancelarEdicion() {
  document.getElementById('cli-form-card').style.display = 'none';
  document.getElementById('cli-edit-id').value = '';
}

// ── Eliminar cliente (soft delete) ──
async function cliDel(id) {
  const c = (_sbCliCache || []).find(x => x.id === id);
  if (!confirm('¿Eliminar a ' + (c?.nombre || 'este cliente') + '?')) return;
  if (!pmDB.disponible()) { pmToast('Sin conexión Supabase', 'err'); return; }
  try {
    await pmDB.clientes.eliminar(id);
    _sbCliCache = null;
    cliRender();
    pmToast('Cliente eliminado');
  } catch(e) {
    pmToast('Error al eliminar', 'err');
  }
}

// ── Abrir modal portafolio de precios ──
async function cliPreciosVer(clienteId, clienteNom) {
  document.getElementById('cli-precios-id').value = clienteId;
  document.getElementById('cli-precios-nombre').textContent = clienteNom;
  document.getElementById('cli-precios-modal').style.display = 'block';
  cpCancelarEdicion();
  await _sbProdEnsureMap();
  const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
  const sel = document.getElementById('cp-prod');
  sel.innerHTML = '<option value="">— seleccionar producto —</option>' +
    prods.map(p => '<option value="' + p.id + '">' + p.nombre + (p.precio ? ' · ₡'+p.precio : '') + '</option>').join('');
  document.getElementById('cp-precio').value = '';
  document.getElementById('cp-desc').value   = '0';
  await cpListarPrecios(clienteId);
}

function cliPreciosCerrar() {
  document.getElementById('cli-precios-modal').style.display = 'none';
}

// ── Listar portafolio ──
async function cpListarPrecios(clienteId) {
  const el = document.getElementById('cli-precios-list');
  el.innerHTML = '<div class="ph" style="padding:8px 0"><span class="ph-icon" style="font-size:18px">⏳</span></div>';
  if (!pmDB.disponible()) { el.innerHTML = '<div class="ph"><span class="ph-icon">⚠️</span>Sin conexión Supabase</div>'; return; }
  try {
    const rows = await pmDB.get('precios_cliente', { cliente_id: clienteId, activo: true });
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="ph" style="padding:10px 0"><span class="ph-icon">💲</span>Sin productos en el portafolio</div>';
      return;
    }
    const escalaColor = { comercial:'var(--gold)', mayorista:'var(--blue)', minorista:'var(--cream2)', vip:'var(--green)' };
    const prods = [...(G.tiposPan||[]), ...(G.tiposGalleta||[])];
    el.innerHTML =
      '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--cream2);margin-bottom:8px">Portafolio (' + rows.length + ' producto' + (rows.length!==1?'s':'') + ')</div>' +
      rows.map(r => {
        const codigo = _sbProdMapInv?.[r.producto_id] || '';
        const prod   = prods.find(p => p.id === codigo) || { nombre: r.producto_id, precio: 0 };
        const esc    = r.escala || '';
        const escLabel = esc.charAt(0).toUpperCase() + esc.slice(1);
        return '<div style="background:var(--sf);border-radius:10px;padding:12px;margin-bottom:8px;border:1px solid var(--border)">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">' +
            '<div>' +
              '<div style="font-weight:600;font-size:13px">' + prod.nombre + '</div>' +
              '<span style="font-size:10px;font-weight:700;color:'+(escalaColor[esc]||'var(--cream2)')+';background:rgba(37,99,235,.08);border-radius:10px;padding:1px 8px;border:1px solid var(--border)">' + escLabel + '</span>' +
            '</div>' +
            '<div style="display:flex;gap:5px">' +
              '<button class="btn btn-gold btn-xs" onclick="cpEditar(\''+r.id+'\')">✎ Editar</button>' +
              '<button class="btn btn-red btn-xs" onclick="cpEliminar(\''+r.id+'\',\''+clienteId+'\')">✕</button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:16px;font-family:\'DM Mono\',monospace;font-size:12px">' +
            '<span>Precio full: <b style="color:var(--cream2)">₡'+(prod.precio||0)+'</b></span>' +
            (r.precio_especial ? '<span>Precio especial: <b style="color:var(--gold)">₡'+r.precio_especial+'</b></span>' : '') +
            (r.descuento_pct   ? '<span>Descuento: <b style="color:var(--red)">'+r.descuento_pct+'%</b></span>' : '') +
          '</div>' +
        '</div>';
      }).join('');
  } catch(e) {
    el.innerHTML = '<div class="ph"><span class="ph-icon">⚠️</span>Error: ' + e.message + '</div>';
  }
}

// ── Guardar precio (nuevo o edición) ──
async function cpGuardar() {
  const clienteId    = document.getElementById('cli-precios-id').value;
  const editPrecioId = document.getElementById('cp-edit-id').value;
  const prodLocalId  = document.getElementById('cp-prod').value;
  const escala       = document.getElementById('cp-escala').value;
  const precio       = parseFloat(document.getElementById('cp-precio').value) || null;
  const descPct      = parseFloat(document.getElementById('cp-desc').value) || 0;
  if (!prodLocalId) { pmToast('Seleccioná un producto', 'err'); return; }
  if (!precio && !descPct) { pmToast('Ingresá precio o descuento', 'err'); return; }
  await _sbProdEnsureMap();
  const productoSbId = _sbProdMap?.[prodLocalId];
  if (!productoSbId) { pmToast('Producto sin UUID en Supabase', 'err'); return; }
  try {
    if (editPrecioId) {
      await pmDB.update('precios_cliente', editPrecioId, { escala, precio_especial: precio, descuento_pct: descPct });
      pmToast('Precio actualizado ✓', 'ok');
    } else {
      const exist = await pmDB.get('precios_cliente', { cliente_id: clienteId, producto_id: productoSbId, escala });
      if (exist && exist.length > 0) {
        await pmDB.update('precios_cliente', exist[0].id, { precio_especial: precio, descuento_pct: descPct, activo: true });
        pmToast('Precio actualizado ✓', 'ok');
      } else {
        await pmDB.insert('precios_cliente', { cliente_id: clienteId, producto_id: productoSbId, escala, precio_especial: precio, descuento_pct: descPct, activo: true });
        pmToast('Producto agregado al portafolio ✓', 'ok');
      }
    }
    cpCancelarEdicion();
    await cpListarPrecios(clienteId);
  } catch(e) {
    pmToast('Error al guardar precio: ' + e.message, 'err');
    console.error('[pmDB] cpGuardar:', e);
  }
}

// ── Editar precio existente ──
function cpEditar(precioId) {
  document.getElementById('cp-edit-id').value        = precioId;
  document.getElementById('cp-form-title').textContent = 'Editar precio';
  document.getElementById('cp-save-btn').textContent  = '💾 Guardar';
  document.getElementById('cp-cancel-btn').style.display = 'inline-block';
  document.getElementById('cp-precio').value = '';
  document.getElementById('cp-desc').value   = '0';
  document.getElementById('cp-form-title').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── Cancelar edición de precio ──
function cpCancelarEdicion() {
  document.getElementById('cp-edit-id').value         = '';
  document.getElementById('cp-form-title').textContent = 'Agregar producto';
  document.getElementById('cp-save-btn').textContent   = '+ Agregar';
  document.getElementById('cp-cancel-btn').style.display = 'none';
  document.getElementById('cp-precio').value = '';
  document.getElementById('cp-desc').value   = '0';
}

// ── Eliminar precio del portafolio ──
async function cpEliminar(precioId, clienteId) {
  if (!confirm('¿Quitar este producto del portafolio?')) return;
  try {
    await pmDB.softDelete('precios_cliente', precioId);
    pmToast('Producto eliminado del portafolio');
    await cpListarPrecios(clienteId);
  } catch(e) {
    pmToast('Error al eliminar precio', 'err');
  }
}
