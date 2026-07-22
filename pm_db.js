// =============================================================================
// pm_db.js — Capa de abstracción Supabase para PanMaestro
// Versión: 1.1 | Sesión 9 — Auth token support
//
// USO: Incluir este script DESPUÉS del Supabase JS SDK y ANTES del script principal
//
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="pm_db.js"></script>
//   ... resto del HTML ...
//
// Este módulo expone el objeto global `pmDB` con métodos para
// leer y escribir en Supabase. Usa el token de sesión del usuario
// autenticado cuando está disponible (RLS auth_only).
// =============================================================================

const pmDB = (() => {

  // ─── CONFIGURACIÓN ──────────────────────────────────────────────────────
  const URL  = 'https://xmhokxmuxfkfypttvkjz.supabase.co';
  const KEY  = 'sb_publishable_pmKVIGa_lNxtzRos-iY_0Q_LXEcj77v';

  let _disponible = true; // se pone false si Supabase falla

  // FIX SESIÓN 1 (E1): fecha de "hoy" en hora LOCAL, no UTC.
  // new Date().toISOString().slice(0,10) convierte a UTC — en Costa Rica
  // (UTC-6) eso hace que entre las 6:00pm y medianoche la fecha reportada
  // ya sea la del día siguiente. Este helper arma la fecha con
  // getFullYear/getMonth/getDate, que respetan la hora local.
  function _hoyLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ─── TOKEN DE SESIÓN ─────────────────────────────────────────────────────
  // Usa el JWT de sesión si está disponible, si no usa la anon key.
  // Compatible con file:// y http://
  async function _getToken() {
    try {
      // Intentar obtener token del cliente Auth (puede no existir en file://)
      const client = window._sbAuthClient;
      if (client) {
        const { data } = await client.auth.getSession();
        if (data?.session?.access_token) return data.session.access_token;
      }
    } catch(e) {}
    // Fallback: anon key (funciona cuando RLS está deshabilitado)
    return KEY;
  }

  // ─── HELPER BASE ────────────────────────────────────────────────────────
  function headers(token, extra = {}) {
    // extra solo agrega headers adicionales (ej: Prefer)
    // nunca sobreescribe apikey ni Authorization
    const base = {
      'Content-Type': 'application/json',
      'apikey': KEY,
      'Authorization': `Bearer ${token}`,
    };
    // Merge: extra puede agregar Prefer u otros, pero apikey/Auth son intocables
    return Object.assign({}, extra, base);
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Un solo intento — sin retry. Marca el error con _esFalloRed (nunca
  // llegó respuesta del servidor) y _status (código HTTP, si sí hubo
  // respuesta) para que _fetch() decida si vale la pena reintentar.
  async function _fetchOnce(path, opts = {}) {
    let res;
    try {
      const token = await _getToken();
      const { headers: _ignored, ...restOpts } = opts; // separar headers del resto
      res = await fetch(`${URL}/rest/v1/${path}`, {
        ...restOpts,  // method, body, etc — pero NO headers
        headers: headers(token, opts.headers || {}),  // headers siempre con auth
      });
    } catch (e) {
      // fetch() en sí falló — nunca hubo respuesta del servidor. Este es
      // el único caso donde reintentar una escritura es seguro: la
      // petición jamás llegó a procesarse.
      const err = new Error(e.message);
      err._esFalloRed = true;
      throw err;
    }
    if (!res.ok) {
      const errTxt = await res.text();
      const err = new Error(`${res.status}: ${errTxt}`);
      err._status = res.status;
      throw err;
    }
    // Sin contenido: 204 explícito, o 201/200 con body vacío (típico de
    // Prefer: return=minimal en inserts/updates con retornar=false).
    // Antes solo se chequeaba 204, así que un 201 vacío tronaba en res.json().
    const raw = await res.text();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  // RETRY/BACKOFF: envuelve _fetchOnce con hasta 2 reintentos adicionales
  // (3 intentos en total) con espera creciente (400ms, 1200ms).
  // Reglas de cuándo SÍ reintentar (importante para no duplicar datos):
  //   - Falla de red pura (_esFalloRed): la petición nunca llegó al
  //     servidor, así que reintentar es seguro sin importar el método.
  //   - Error 5xx del servidor: solo se reintenta en lecturas (GET),
  //     porque en una escritura (POST/PATCH/DELETE) un 5xx significa que
  //     la petición SÍ llegó al servidor y no sabemos si alcanzó a
  //     procesarla antes de fallar — reintentar podría duplicar un
  //     pedido o una venta.
  const MAX_REINTENTOS = 2;
  const ESPERA_BASE_MS = 400;

  async function _fetch(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    let lastErr;
    for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
      try {
        const result = await _fetchOnce(path, opts);
        _disponible = true;
        return result;
      } catch (e) {
        lastErr = e;
        const es5xx = e._status >= 500 && e._status < 600;
        const reintentable = e._esFalloRed || (method === 'GET' && es5xx);
        if (e._esFalloRed) _disponible = false;
        if (!reintentable || intento === MAX_REINTENTOS) {
          console.warn('[pmDB] Error:', e.message);
          throw e;
        }
        const espera = ESPERA_BASE_MS * Math.pow(3, intento);
        console.warn(`[pmDB] reintentando (${intento + 1}/${MAX_REINTENTOS}) en ${espera}ms — ${method} ${path}:`, e.message);
        await _sleep(espera);
      }
    }
    throw lastErr;
  }

  // =========================================================================
  // MÉTODOS PÚBLICOS
  // =========================================================================

  // ── LEER ─────────────────────────────────────────────────────────────────

  /**
   * Obtener todos los registros de una tabla
   * @param {string} tabla
   * @param {object} filtros — ej: { activo: true }
   * @param {string} select — ej: 'id,nombre,precio' (default: '*')
   * @returns {Array}
   */
  async function get(tabla, filtros = {}, select = '*') {
    let query = `${tabla}?select=${select}`;
    for (const [k, v] of Object.entries(filtros)) {
      query += `&${k}=eq.${v}`;
    }
    return await _fetch(query);
  }

  /**
   * Obtener un solo registro por id
   */
  async function getById(tabla, id) {
    const data = await _fetch(`${tabla}?id=eq.${id}&select=*`);
    return data?.[0] || null;
  }

  // ── INSERTAR ─────────────────────────────────────────────────────────────

  /**
   * Insertar uno o varios registros
   * @param {string} tabla
   * @param {object|Array} datos
   * @param {boolean} retornar — si true, devuelve el registro creado
   * @returns {object|Array|null}
   */
  async function insert(tabla, datos, retornar = true) {
    const prefer = retornar
      ? 'return=representation'
      : 'return=minimal';
    return await _fetch(tabla, {
      method: 'POST',
      headers: { 'Prefer': prefer },
      body: JSON.stringify(datos)
    });
  }

  // ── ACTUALIZAR ────────────────────────────────────────────────────────────

  /**
   * Actualizar registro por id
   * @param {string} tabla
   * @param {string} id — uuid del registro
   * @param {object} datos — campos a actualizar
   * @returns {object|null}
   */
  async function update(tabla, id, datos) {
    return await _fetch(`${tabla}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(datos)
    });
  }

  /**
   * Actualizar por cualquier filtro (no solo id)
   */
  async function updateWhere(tabla, filtros, datos) {
    let query = tabla + '?';
    query += Object.entries(filtros).map(([k,v]) => `${k}=eq.${v}`).join('&');
    return await _fetch(query, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(datos)
    });
  }

  // ── ELIMINAR (soft) ───────────────────────────────────────────────────────

  /**
   * Soft delete — pone activo=false
   */
  async function softDelete(tabla, id) {
    return await update(tabla, id, { activo: false });
  }

  /**
   * Hard delete — elimina físicamente (usar con cuidado)
   */
  async function hardDelete(tabla, id) {
    return await _fetch(`${tabla}?id=eq.${id}`, {
      method: 'DELETE',
      headers: { 'Prefer': 'return=minimal' }
    });
  }

  // ── UPSERT ────────────────────────────────────────────────────────────────

  /**
   * Insert o Update según si el registro existe
   */
  async function upsert(tabla, datos) {
    return await _fetch(tabla, {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(datos)
    });
  }

  // =========================================================================
  // MÉTODOS DE DOMINIO (shortcuts para módulos específicos)
  // =========================================================================

  // ── INGREDIENTES ──────────────────────────────────────────────────────────
  const ingredientes = {
    listar:   ()       => get('ingredientes', { activo: true }),
    obtener:  (id)     => getById('ingredientes', id),
    crear:    (datos)  => insert('ingredientes', datos),
    editar:   (id, d)  => update('ingredientes', id, d),
    eliminar: (id)     => softDelete('ingredientes', id),
  };

  // ── PRODUCTOS TERMINADOS ──────────────────────────────────────────────────
  const productos = {
    listar:       ()     => get('productos_terminados', { activo: true }),
    listarPanes:  ()     => get('productos_terminados', { activo: true, tipo: 'pan' }),
    listarGalletas: ()   => get('productos_terminados', { activo: true, tipo: 'galleta' }),
    obtener:      (id)   => getById('productos_terminados', id),
    crear:        (d)    => insert('productos_terminados', d),
    editar:       (id,d) => update('productos_terminados', id, d),
    eliminar:     (id)   => softDelete('productos_terminados', id),
  };

  // ── RECETAS ───────────────────────────────────────────────────────────────
  const recetas = {
    listar:   ()       => get('recetas', { activo: true }),
    obtener:  (id)     => getById('recetas', id),
    crear:    (datos)  => insert('recetas', datos),
    editar:   (id, d)  => update('recetas', id, d),
    eliminar: (id)     => softDelete('recetas', id),
    items:    (recId)  => get('receta_items', { receta_id: recId }),
  };

  // ── CLIENTES ──────────────────────────────────────────────────────────────
  const clientes = {
    listar:   ()       => get('clientes', { activo: true }),
    obtener:  (id)     => getById('clientes', id),
    crear:    (datos)  => insert('clientes', datos),
    editar:   (id, d)  => update('clientes', id, d),
    eliminar: (id)     => softDelete('clientes', id),
    /**
     * Obtener precio especial de un cliente para un producto
     * Retorna { precio_especial, descuento_pct } o null si no tiene precio especial
     */
    async precioParaProducto(clienteId, productoId) {
      const data = await get('precios_cliente',
        { cliente_id: clienteId, producto_id: productoId, activo: true }
      );
      return data?.[0] || null;
    }
  };

  // ── PEDIDOS ───────────────────────────────────────────────────────────────
  const pedidos = {
    listar:      (filtros = {}) => get('pedidos', filtros),
    listarHoy:   ()             => {
      const hoy = _hoyLocal();
      return get('pedidos', { fecha: hoy });
    },
    obtener:     (id)           => getById('pedidos', id),
    crear:       (datos)        => insert('pedidos', datos),
    editar:      (id, d)        => update('pedidos', id, { ...d, updated_at: new Date().toISOString() }),
    /**
     * Cambiar estado — si el estado tiene genera_venta=true,
     * el trigger de BD crea la venta automáticamente
     */
    cambiarStatus: (id, status) => update('pedidos', id, {
      status,
      updated_at: new Date().toISOString()
    }),
    lineas: {
      listar:  (pedidoId) => get('pedido_lineas', { pedido_id: pedidoId }),
      agregar: (datos)    => insert('pedido_lineas', datos),
      editar:  (id, d)    => update('pedido_lineas', id, d),
      eliminar:(id)       => hardDelete('pedido_lineas', id),
    }
  };

  // ── GASTOS ────────────────────────────────────────────────────────────────
  const gastos = {
    listar:   (filtros = {}) => get('gastos', filtros),
    crear:    (datos)        => insert('gastos', datos),
    editar:   (id, d)        => update('gastos', id, d),
    eliminar: (id)           => hardDelete('gastos', id),
  };

  // ── PLAN DE PRODUCCIÓN ────────────────────────────────────────────────────
  const planProduccion = {
    listarFecha: (fecha)       => get('plan_produccion', { fecha }),
    listarSemana: async (fechaIso) => {
      // Trae los 7 días de la semana a partir de fechaIso
      const d = new Date(fechaIso);
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const f = new Date(d);
        f.setDate(d.getDate() + i);
        dias.push(f.toISOString().slice(0,10));
      }
      // Traer todos los registros del rango
      const [inicio, fin] = [dias[0], dias[6]];
      return await _fetch(
        `plan_produccion?fecha=gte.${inicio}&fecha=lte.${fin}&select=*`
      );
    },
    guardar: async (datos, fechaOverride, tipoOverride) => {
      // SESIÓN 11 fix crítico: antes, si "datos" venía vacío (ej. porque el
      // usuario puso todo en 0 para borrar), la función se salía ANTES de
      // borrar los registros viejos — el plan de producción quedaba
      // "pegado" para siempre, sin forma de vaciarlo desde la app.
      const fecha = fechaOverride || (datos && datos[0] && datos[0].fecha);
      const tipo  = tipoOverride  || (datos && datos[0] && datos[0].tipo);
      if (!fecha || !tipo) return; // sin info suficiente para saber qué borrar
      // Delete existing rows for this fecha+tipo — SIEMPRE, haya o no datos nuevos
      await _fetch(`plan_produccion?fecha=eq.${fecha}&tipo=eq.${tipo}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
      if (datos && datos.length) {
        return await insert('plan_produccion', datos, false);
      }
    },
    eliminar: (id)   => hardDelete('plan_produccion', id),
  };

  // ── VENTAS ────────────────────────────────────────────────────────────────
  const ventas = {
    listar:   (filtros = {}) => get('ventas', filtros),
    obtener:  (id)           => getById('ventas', id),
    // Las ventas se crean automáticamente por el trigger de BD
    // pero se puede crear manualmente si es necesario:
    crear:    (datos)        => insert('ventas', datos),
    editar:   (id, d)        => update('ventas', id, d),
  };

  // ── LOTES DE PRODUCCIÓN ───────────────────────────────────────────────────
  const lotes = {
    listar:     (filtros = {}) => get('lotes_produccion', filtros),
    listarHoy:  ()             => get('lotes_produccion', {
      fecha: _hoyLocal()
    }),
    crear:      (datos)        => insert('lotes_produccion', datos),
    cerrar:     (id)           => update('lotes_produccion', id, { status: 'cerrado' }),
    items: {
      listar:   (loteId)       => get('lote_items', { lote_id: loteId }),
      agregar:  (datos)        => insert('lote_items', datos),
      editar:   (id, d)        => update('lote_items', id, d),
    }
  };

  // ── ESTADOS ───────────────────────────────────────────────────────────────
  const estados = {
    listar: () => get('estados_pedido'),
  };

  // ── INSTRUCCIONES ─────────────────────────────────────────────────────────
  const instrucciones = {
    listar: () => get('instrucciones_especiales', { activo: true }),
  };

  // =========================================================================
  // UTILIDADES
  // =========================================================================

  /**
   * Verificar si Supabase está disponible
   */
  function disponible() { return _disponible; }

  /**
   * Test de conexión — llamar al arrancar la app
   */
  async function testConexion() {
    try {
      await _fetch('estados_pedido?select=id&limit=1');
      _disponible = true;
      return true;
    } catch(e) {
      _disponible = false;
      console.warn('[pmDB] ⚠️ Sin conexión a Supabase — modo offline (localStorage)');
      return false;
    }
  }

  // =========================================================================
  // API PÚBLICA
  // =========================================================================
  return {
    // Métodos genéricos
    get,
    getById,
    insert,
    update,
    updateWhere,
    softDelete,
    hardDelete,
    upsert,

    // Módulos de dominio
    ingredientes,
    productos,
    recetas,
    clientes,
    pedidos,
    gastos,
    planProduccion,
    ventas,
    lotes,
    estados,
    instrucciones,

    // Utilidades
    disponible,
    testConexion,
  };

})();

// Test automático al cargar
pmDB.testConexion();
