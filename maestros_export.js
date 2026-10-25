// ═══════════════════════════════════════════════════════════════════
// maestros_export.js — Exportar maestros a un archivo JSON (prefijo mex*)
//
// Solo LEE de Supabase (pmDB.get) y descarga un archivo. No escribe nada
// en la base de datos ni en el almacenamiento local.
//
// Entradas en la interfaz:
//   - Maestros → Backup: tarjeta "Exportar maestros" con casillas por grupo.
//   - Maestros → Tipos de pan / Tipos galleta: botón rápido (solo productos).
//
// Formato del archivo:
//   { formato, version, exportado, app_version, grupos, conteos, avisos,
//     tipos_pan, tipos_galleta, datos: { <tabla>: [filas...] } }
// ═══════════════════════════════════════════════════════════════════

// Grupos de maestros. `def` = marcado por defecto en la tarjeta.
// Clientes y personal/nómina quedan desmarcados: traen datos personales
// (teléfonos, sueldos) y conviene incluirlos solo a propósito.
const MEX_GRUPOS = [
  { id: 'productos',    def: true,  label: 'Tipos de pan y galleta (productos terminados)', tablas: ['productos_terminados'] },
  { id: 'ingredientes', def: true,  label: 'Ingredientes',                                   tablas: ['ingredientes'] },
  { id: 'recetas',      def: true,  label: 'Recetas (con sus ingredientes)',                 tablas: ['recetas', 'receta_items'] },
  { id: 'mercadeo',     def: true,  label: 'Mercadeo (categorías, estilos, atributos)',      tablas: ['categorias', 'estilos', 'atributos', 'producto_categoria', 'producto_estilo', 'producto_atributo'] },
  { id: 'estados',      def: true,  label: 'Estados de pedido e instrucciones',              tablas: ['estados_pedido', 'instrucciones_especiales'] },
  { id: 'costos',       def: true,  label: 'Costos: departamentos, cuentas, etapas, rutas, empaques',
    tablas: ['cost_departamentos', 'cost_cuentas', 'cost_etapas', 'cost_rutas', 'cost_ruta_etapas',
             'cost_empaque_clases', 'cost_empaques', 'cost_empaque_precio', 'cost_producto_empaque',
             'cost_drivers', 'cost_cargos', 'cost_tarifas', 'cost_capacidad'] },
  { id: 'clientes',     def: false, label: 'Clientes y precios especiales (datos personales)', tablas: ['clientes', 'precios_cliente'] },
  { id: 'personal',     def: false, label: 'Personal y nómina (incluye sueldos)',             tablas: ['cost_colaboradores', 'cost_colab_depto', 'cost_conceptos_nomina', 'cost_nomina_lineas'] },
];

const MEX_PAGINA = 1000; // tope por consulta de PostgREST

// Dibuja las casillas en la tarjeta de Backup (se llama al abrir esa pestaña).
function mexRenderGrupos() {
  const el = document.getElementById('mex-grupos');
  if (!el) return;
  el.innerHTML = MEX_GRUPOS.map(g => `
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;margin-bottom:6px;cursor:pointer">
      <input type="checkbox" id="mex-g-${g.id}" ${g.def ? 'checked' : ''} style="margin-top:2px">
      <span>${pmEsc(g.label)}</span>
    </label>`).join('');
}

// Lee una tabla completa. Si llega al tope de 1000 filas, vuelve a leer
// paginando con orden estable para no perder filas en silencio.
async function mexLeerTabla(tabla, avisos) {
  let filas = (await pmDB.get(tabla, {})) || [];
  if (filas.length < MEX_PAGINA) return filas;
  try {
    const todas = [];
    for (let off = 0; off < 200000; off += MEX_PAGINA) {
      const pag = (await pmDB.get(tabla, {}, `*&order=id.asc&limit=${MEX_PAGINA}&offset=${off}`)) || [];
      todas.push(...pag);
      if (pag.length < MEX_PAGINA) break;
    }
    return todas;
  } catch (e) {
    avisos.push(`${tabla}: llegó al tope de ${MEX_PAGINA} filas y no se pudo paginar (${e.message}); puede estar incompleta`);
    return filas;
  }
}

// Versión "amigable" de productos_terminados, con los mismos nombres de campo
// que usa el maestro en pantalla (id, nombre, precio, peso, recetaCod).
function mexProductoAmigable(r) {
  return {
    id: r.codigo,
    nombre: r.nombre,
    peso_g: r.peso_g || 0,
    precio: r.precio_full || r.precio || 0,
    receta: r.receta_cod || '',
    activo: r.activo !== false,
  };
}

function mexDescargar(obj, nombre) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Núcleo: exporta los grupos indicados (arreglo de ids).
async function mexExportar(idsGrupos, nombreBase) {
  if (!pmDB.disponible()) {
    pmToast('⚠️ Sin conexión con la nube: no se puede exportar ahora', 'err');
    return;
  }
  const grupos = MEX_GRUPOS.filter(g => idsGrupos.includes(g.id));
  if (!grupos.length) { pmToast('Marcá al menos un grupo', 'err'); return; }

  pmToast('⏳ Exportando maestros…', 'ok', 4000);
  const datos = {}, conteos = {}, avisos = [];
  for (const g of grupos) {
    for (const t of g.tablas) {
      try {
        datos[t] = await mexLeerTabla(t, avisos);
        conteos[t] = datos[t].length;
      } catch (e) {
        avisos.push(`${t}: no se pudo leer (${e.message})`);
      }
    }
  }

  const salida = {
    formato: 'panmaestro-maestros',
    version: 1,
    exportado: new Date().toISOString(),
    app_version: (typeof PM_VERSION !== 'undefined') ? PM_VERSION : '',
    grupos: grupos.map(g => g.id),
    conteos,
    avisos,
  };
  if (datos.productos_terminados) {
    const prods = datos.productos_terminados;
    salida.tipos_pan = prods.filter(r => r.tipo === 'pan').map(mexProductoAmigable);
    salida.tipos_galleta = prods.filter(r => r.tipo === 'galleta').map(mexProductoAmigable);
  }
  salida.datos = datos;

  const hoy = (typeof pmHoy === 'function') ? pmHoy() : new Date().toISOString().slice(0, 10);
  mexDescargar(salida, `${nombreBase}_${hoy}.json`);
  const total = Object.values(conteos).reduce((s, n) => s + n, 0);
  pmToast(avisos.length
    ? `Exportado con ${avisos.length} aviso(s) — ${total} filas (ver el archivo)`
    : `Maestros exportados ✓ (${total} filas)`, avisos.length ? 'err' : 'ok', 4000);
}

// Botón de la tarjeta de Backup: usa las casillas marcadas.
function mexExportarSeleccion() {
  const ids = MEX_GRUPOS.filter(g => document.getElementById('mex-g-' + g.id)?.checked).map(g => g.id);
  mexExportar(ids, 'panmaestro_maestros');
}

// Botón rápido de Tipos de pan / Tipos galleta.
function mexExportarProductos() {
  mexExportar(['productos'], 'panmaestro_tipos_producto');
}
