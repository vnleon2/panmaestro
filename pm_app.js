// pm_app.js — Bootstrap de la aplicación PanMaestro
// Extraído de index.html en la sesión de limpieza (punto 4 del plan de auditoría).
// Contiene: navegación de pestañas (showTab, pmOpenModule) y autenticación
// (login/logout, verificación de sesión, arranque de la app en DOMContentLoaded).
// Debe cargarse DESPUÉS de todos los demás módulos (pm_core.js y los 15 módulos),
// tal como estaba el bloque de auth original al final de index.html.

// ── TAB NAVIGATION ──────────────────────────────────────────
function showTab(id) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('on');
    p.style.display = 'none';
  });
  const page = document.getElementById(id);
  if (page) {
    page.classList.add('on');
    page.style.display = 'flex';
  }
  document.querySelectorAll('.ntab').forEach(t => t.classList.remove('on'));
  const btn = document.querySelector('.ntab[data-tab="' + id + '"]');
  if (btn) btn.classList.add('on');
  const labels = {
    'pg-dash':'DASHBOARD','pg-pedidos':'PAN','pg-galletas':'GALLETAS',
    'pg-com':'COMERCIAL','pg-prod':'PRODUCCIÓN','pg-rep':'REPORTES',
    'pg-gastos':'GASTOS','pg-costeo':'COSTEO','pg-hid':'HIDRATACIÓN',
    'app-inner':'MAESTROS','pg-rec':'RECETARIO','pg-gmrec':'GLUTEN MORGEN','pg-planlibre':'PLAN LIBRE'
  };
  const modEl = document.querySelector('.brand-mod');
  if (modEl) modEl.textContent = labels[id] || 'PANMAESTRO';
  const inits = {
    'pg-dash':    () => { document.getElementById('dash-date').value = pmHoy(); dashRender(); },
    'pg-pedidos': () => { document.getElementById('pp-fecha').value = pmHoy(); ppCargarSb(); },
    'pg-galletas':() => { document.getElementById('pg-fecha').value = pmHoy(); pgCargarSb(); },
    'pg-com':     () => { document.getElementById('pc-fecha').value = pmHoy(); pcCargarClientes(); pcRender(); },
    'pg-prod':    () => { document.getElementById('prod-date').value = pmHoy(); prodRenderConSb(); _sbLotesCargar(); },
    'pg-rep':     () => { const rf=document.getElementById('r-fecha'); const rm=document.getElementById('r-mes'); if(rf&&!rf.value)rf.value=pmHoy(); if(rm&&!rm.value)rm.value=pmHoy().slice(0,7); repCurrentTab=repCurrentTab||'pan'; repRender(); },
    'pg-gastos':  () => { document.getElementById('g-fecha').value = pmHoy(); document.getElementById('g-mes').value = pmHoy().slice(0,7); gastoRender(); },
    'pg-costeo':  () => { _sbCosteoCargar().then(() => { cvMostrar('cv-maestro'); cvMaestroRender(); recRender(); }); const el = document.getElementById('mro-margen-default'); if(el) el.value = G.margenDefault||40; },
    'pg-hid':     () => { hidCalc(); },
    'app-inner':  () => { currentTab = currentTab||'pan'; if(currentTab==='sync') pmSyncUIRefresh(); panRecetaPopulate(); panCargarSb(); ingCargarSb(); },
    'pg-rec':     () => { _sbCosteoCargar().then(() => recetarioRender()); },
    'pg-gmrec':   () => { gmRecetarioRender(); },
  };
  if (inits[id]) inits[id]();
}

// ── MODULE ROUTING ──────────────────────────────────────────
function pmOpenModule(filename) {
  const map = {
    'panmaestro_dashboard.html':  'pg-dash',
    'panmaestro_pedidos.html':    'pg-pedidos',
    'panmaestro_galletas.html':   'pg-galletas',
    'panmaestro_comercial.html':  'pg-com',
    'panmaestro_produccion.html': 'pg-prod',
    'panmaestro_reportes.html':   'pg-rep',
    'panmaestro_gastos.html':     'pg-gastos',
    'panmaestro_costeo.html':     'pg-costeo',
    'panmaestro_hidratacion.html':'pg-hid',
    'panmaestro_maestros.html':   'app-inner',
  };
  if (map[filename]) {
    showTab(map[filename]);
  } else {
    const href = window.location.href;
    const base = href.substring(0, href.lastIndexOf('/') + 1);
    const a = document.createElement('a');
    a.href = base + filename;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}


// ─── SESIÓN 6 — FIN CACHE ────────────────────────────────────────────────────

// ─── SESIÓN 9 — AUTH SUPABASE ────────────────────────────────────────────────
// Usamos el cliente oficial @supabase/supabase-js para Auth.
// pm_db.js sigue usando fetch directo para las queries — Auth es independiente.

const PM_SB_URL = 'https://xmhokxmuxfkfypttvkjz.supabase.co';
const PM_SB_KEY = 'sb_publishable_pmKVIGa_lNxtzRos-iY_0Q_LXEcj77v';

let _sbAuthClient = null;

function _sbGetAuthClient() {
  if (_sbAuthClient) return _sbAuthClient;
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    _sbAuthClient = supabase.createClient(PM_SB_URL, PM_SB_KEY);
    window._sbAuthClient = _sbAuthClient; // SESIÓN 11 fix: antes nunca se exponía en window
  }
  return _sbAuthClient;
}

// Mostrar/ocultar app vs login
function _pmMostrarApp() {
  document.getElementById('pm-login').style.display = 'none';
  document.getElementById('topbar').style.display = '';
  document.getElementById('app').style.display = '';
}

function _pmMostrarLogin() {
  document.getElementById('pm-login').style.display = 'flex';
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('app').style.display = 'none';
}

async function pmLoginSubmit() {
  const email = document.getElementById('pm-login-email').value.trim();
  const pass  = document.getElementById('pm-login-pass').value;
  const errEl = document.getElementById('pm-login-error');
  const btnEl = document.getElementById('pm-login-btn');
  const ldEl  = document.getElementById('pm-login-loading');
  errEl.style.display = 'none';
  if (!email || !pass) {
    errEl.textContent = 'Completá email y contraseña.';
    errEl.style.display = 'block';
    return;
  }
  btnEl.style.display = 'none';
  ldEl.style.display = 'block';
  const client = _sbGetAuthClient();
  if (!client) {
    errEl.textContent = 'Error: cliente Supabase no disponible.';
    errEl.style.display = 'block';
    btnEl.style.display = 'block';
    ldEl.style.display = 'none';
    return;
  }
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    // Si pmInit no se llamó todavía (primer login), inicializar la app
    if (!window._pmInitDone) {
      pmInit('panmaestro', () => {
        window._pmInitDone = true;
        _pmMostrarApp();
        showTab('pg-dash');
        const plFecha = document.getElementById('pl-fecha');
        if (plFecha && !plFecha.value) plFecha.value = pmHoy();
        pmToast('Sesión iniciada ✓', 'ok');
      });
    } else {
      _pmMostrarApp();
      pmToast('Sesión iniciada ✓', 'ok');
    }
  } catch(e) {
    errEl.textContent = e.message === 'Invalid login credentials'
      ? 'Email o contraseña incorrectos.'
      : e.message;
    errEl.style.display = 'block';
    btnEl.style.display = 'block';
    ldEl.style.display = 'none';
  }
}

async function pmLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  const client = _sbGetAuthClient();
  if (client) await client.auth.signOut().catch(() => {});
  _pmMostrarLogin();
  document.getElementById('pm-login-email').value = '';
  document.getElementById('pm-login-pass').value = '';
  pmToast('Sesión cerrada');
}

async function _pmCheckSession() {
  const client = _sbGetAuthClient();
  if (!client) {
    // Supabase JS no cargó (offline/sin CDN) — dejar pasar igual
    console.warn('[Auth] Supabase JS no disponible — modo sin auth');
    return true;
  }
  const { data: { session } } = await client.auth.getSession();
  if (session) {
    // Renovar token automáticamente
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') _pmMostrarLogin();
    });
    return true;
  }
  return false;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Ocultar app mientras verificamos sesión
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('app').style.display = 'none';

  const tieneSession = await _pmCheckSession();

  if (tieneSession) {
    // Solo arrancar la app si hay sesión válida
    pmInit('panmaestro', () => {
      window._pmInitDone = true;
      _pmMostrarApp();
      showTab('pg-dash');
      const plFecha = document.getElementById('pl-fecha');
      if (plFecha && !plFecha.value) plFecha.value = pmHoy();
    });
  } else {
    _pmMostrarLogin();
  }
});
