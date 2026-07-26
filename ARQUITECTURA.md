# Arquitectura de PanMaestro

Documento técnico interno — insumo para el PDF explicativo de PanMaestro.
Describe cómo está armado el proyecto por dentro: módulos, convenciones de
nombres, patrones de sincronización con Supabase, y las decisiones de
diseño detrás de cada uno.

**Actualizado el 26 de julio de 2026**, sobre la línea base v1.0 del
sistema (ver `PanMaestro_Documentacion_v1.0.docx` para la documentación
completa de negocio/base de datos). Esta es la segunda versión de este
documento — reemplaza la escrita justo después de la primera ronda de
auditoría, que ya había quedado desactualizada en varios puntos (ver
sección 9, "Qué cambió desde la versión anterior").

---

## 1. Panorama general

PanMaestro es una SPA (single-page app) de un solo `index.html` que carga
**19** archivos `.js` en un orden fijo, más **2** herramientas standalone
(`labrec.html`, `utilidades.html`) que viven aparte pero comparten la
misma cuenta de Supabase.

No hay build step ni bundler — todo es JavaScript plano cargado con
`<script src="...">`, en el orden en que aparece en `index.html`. Los
19 archivos comparten un espacio de nombres global (`window`): cualquier
función o variable declarada en un módulo es visible para los que se
cargan después. Esto es intencional (permite que `pan.js` llame
funciones de `pm_core.js`, por ejemplo) pero también significa que el
**orden de carga importa** y que dos módulos nunca deben declarar una
función con el mismo nombre.

### Orden de carga (tal como queda en `index.html`)

```
supabase-js (CDN)
pm_db.js       ← capa de acceso a Supabase (fetch + retry)
pm_core.js     ← utilidades compartidas (fechas, dinero, escape HTML, toasts, modales)
dashboard.js
pan.js
galletas.js
comercial.js
produccion.js
reportes.js
gastos.js
costeo.js
gluten_morgen.js
recetario.js
hidratacion.js
maestros.js
catalogo.js
etiquetas.js
mercadeo.js
plan_libre.js
pm_app.js      ← bootstrap: navegación de pestañas + login/sesión (debe ir último)
```

`pm_app.js` va al final a propósito: define `showTab()`, que llama
funciones de *todos* los demás módulos, así que tiene que existir todo
lo demás antes de que se ejecute cualquier navegación.

---

## 2. Convención de prefijos por módulo

Cada módulo tiene un prefijo de función dominante, pensado para poder
adivinar en qué archivo vive una función con solo leer su nombre. En la
práctica **no es perfecto** — hay excepciones documentadas abajo.

| Archivo             | Prefijo(s) dominante(s)      | Qué maneja |
|----------------------|-------------------------------|------------|
| `dashboard.js`       | `dash`                        | Panel principal, resumen del día |
| `pan.js`             | `pp`                           | **Pedidos** de pan (no el catálogo de tipos de pan) |
| `galletas.js`        | `pg`                           | **Pedidos** de galletas (no el catálogo) |
| `comercial.js`       | `pc`, `lc`                     | Pedidos comerciales (`pc`); modal de línea de pedido comercial (`lc`) |
| `produccion.js`      | `prod`, `lote`                 | Plan de producción diario/semanal (`prod`); lotes de producción (`lote`) |
| `reportes.js`        | `rep`, `doc`, `contable`        | Reportes generales (`rep`); notas/facturas imprimibles (`doc`); conciliación pedidos↔ventas (`contable`) |
| `gastos.js`          | `gasto`                        | Registro de gastos |
| `costeo.js`          | `cv`, `mr`, `rec`, `rsc`, `ing` | Vista de costeo (`cv`); formulario Maestro de Recetas (`mr`); CRUD de recetas (`rec`); calculadora de sub-recetas (`rsc`); lectura de ingredientes para costeo (`ing`) |
| `gluten_morgen.js`   | `gm`, `personal`                | Importar/gestionar recetas de Gluten Morgen (`gm`); parser de Recetas Personales (`personal`) |
| `recetario.js`       | `recetario`                    | Vista de recetario para producción (cálculo por unidades) |
| `hidratacion.js`     | `hid`, `gm` (⚠️ ver nota)        | Calculadora de hidratación/DDT (`hid`); **también** el recetario-visor de Gluten Morgen (`gmRecetario*`) |
| `maestros.js`        | `pan`, `gall`, `ing`, `est`      | **Catálogo** de tipos de pan/galleta (⚠️ ver nota) y CRUD de ingredientes/estados |
| `catalogo.js`        | `cat`                           | Fotos de catálogo (Supabase Storage) |
| `etiquetas.js`       | `et`                            | Impresión de etiquetas de producto (integrada como pestaña propia — antes standalone) |
| `mercadeo.js`        | `mkt`                           | Categorías, estilos y atributos de producto — módulo de marketing (ver sección 7) |
| `plan_libre.js`      | `plan`, `cli`, `cp`              | Plan libre (`plan`); clientes (`cli`); precios especiales por cliente (`cp`) |
| `pm_core.js`         | `pm`                            | Utilidades compartidas: fechas, dinero, escape HTML, toasts, modales genéricos |
| `pm_db.js`           | `pmDB.*` (objeto, no prefijo suelto) | Toda la comunicación con Supabase |
| `pm_app.js`          | `showTab`, `pm*`                | Navegación de pestañas + login/sesión |

### ⚠️ Dos advertencias importantes de nomenclatura

**"pan" significa dos cosas distintas según el archivo.** En `pan.js`,
el prefijo `pp` (de "pedidos de pan") maneja los **pedidos** de clientes.
En `maestros.js`, funciones como `panAdd`/`panRender`/`panEdit` manejan
el **catálogo** de tipos de pan (nombre, precio, receta vinculada) — es
otra tabla (`productos_terminados`), otra pantalla, otro propósito.

**Hay dos cosas llamadas "gm".** `gluten_morgen.js` (prefijo `gm`)
maneja la importación y gestión de la biblioteca de recetas de Gluten
Morgen. Pero `hidratacion.js` también tiene funciones `gmRecetario*`
que son un **visor/escalador** de esas mismas recetas, usado desde la
pestaña de Hidratación.

---

## 3. Patrón de sincronización con Supabase

Todos los módulos de pedidos comparten hoy **un solo patrón**: local-first
con dual-write. Esto cambió desde la versión anterior de este documento
(ver sección 9) — Comercial se reescribió para dejar de ser la excepción.

### 3.1 Local-first con dual-write (`pan.js`, `galletas.js`, `comercial.js`)

El pedido se crea **al instante** en un array local (`G.pedidosPan`,
`G.pedidosGalletas`, `G.pedidosCom`), se guarda en `localStorage` vía
`pmSave()`, y la UI responde de inmediato sin esperar a Supabase. La
escritura a Supabase pasa en segundo plano:

```js
newPed._sbCreatePromise = pmDB.pedidos.crear({...})
  .then(rows => { if (rows?.[0]) newPed._sbId = rows[0].id; return rows; })
  .catch(e => { ... });
```

La promesa se guarda en el propio objeto (`_sbCreatePromise`). Si el
usuario agrega una línea al pedido *antes* de que esa promesa resuelva,
la función que agrega la línea espera (`await ped._sbCreatePromise`)
antes de intentar escribir la línea a Supabase.

**Comercial** (reescrito en el Punto 7 de la auditoría de julio 2026)
sigue exactamente este mismo patrón, con una particularidad: el número
de pedido (correlativo) no se puede asignar offline — se muestra
"⏳ pendiente" hasta sincronizar. También cachea clientes y precios
especiales localmente (`G.clientesCache`, `G.preciosClienteCache`),
algo que antes solo vivía en memoria y se perdía al recargar.

### 3.2 Híbrido (`costeo.js` / recetas)

Las recetas se cargan una vez a un caché (`_sbCosteoCargar()` →
`_sbRecCache`), se editan sobre la copia local (`G.recetas`), y al
guardar se escribe primero local (instantáneo) y después se dispara la
escritura a Supabase — parecido al patrón anterior, pero sin el
mecanismo de `_sbCreatePromise` para encadenar operaciones dependientes.
Este es el único módulo con optimistic locking real (ver sección 6).

### 3.3 Mayormente síncrono (Producción, Gastos, Maestros, Plan Libre, Mercadeo)

Piden y escriben contra Supabase en el momento, con algo de caché en
memoria (no persistente entre recargas). Mercadeo es un caso particular:
al ser una pantalla de administración de catálogo (no de punto de venta),
deliberadamente no usa `G`/`pmSave()` en absoluto — cada cambio se
guarda directo contra Supabase, sin capa offline (ver sección 7).

### ¿Cuál se usa dónde?

| Módulo | Patrón |
|---|---|
| Pan, Galletas, Comercial | Local-first + dual-write (`_sbCreatePromise`) |
| Costeo/Recetas | Híbrido — local-first sin `_sbCreatePromise`, con optimistic locking |
| Producción, Gastos, Maestros, Plan Libre | Mayormente síncrono contra Supabase, con caché en memoria |
| Mercadeo | Síncrono puro, sin caché local ni `G`/`pmSave()` (a propósito) |

---

## 4. Capa de acceso a datos: `pm_db.js`

Todo el proyecto habla con Supabase a través de un único punto de
entrada, el objeto global `pmDB`. Nunca se llama `fetch()` directo
fuera de este archivo.

- **Métodos genéricos**: `get`, `getById`, `insert`, `update`,
  `updateWhere`, `softDelete`, `hardDelete`, `upsert`.
- **Métodos de dominio**: agrupados por tabla (`pmDB.pedidos.crear()`,
  `pmDB.recetas.editar()`, etc.) — son atajos sobre los genéricos.
  `mercadeo.js` es el único módulo que **no** usa métodos de dominio
  propios — llama los genéricos directo (`pmDB.get('categorias', ...)`,
  etc.), a propósito, para no tener que tocar `pm_db.js` (ver sección 7).
- **Autenticación**: usa el JWT de sesión del usuario logueado si existe
  (`_getToken()`), con la clave pública ("publishable key") como
  respaldo si no hay sesión activa — RLS bloquea igual sin sesión válida
  en todas las tablas salvo la lectura de `catalogo_fotos`.
- **Retry/backoff**: toda petición pasa por `_fetch()`, que reintenta
  hasta 2 veces con espera creciente (400ms, 1200ms). Lecturas (`GET`)
  reintentan tanto en fallas de red como en errores 5xx del servidor.
  Escrituras (`POST`/`PATCH`/`DELETE`) **solo** reintentan si la
  petición nunca llegó a tocar el servidor.
- **`disponible()`**: refleja si la última petición pudo conectar. Se
  marca `false` en una falla de red pura y se recupera solo en la
  siguiente escritura/lectura exitosa.

---

## 5. Seguridad

- **RLS (Row Level Security)**: las **22** tablas de Supabase tienen
  RLS activo, confirmado por consulta en vivo a `pg_catalog` (no solo
  por revisión de código) el 26 de julio de 2026. 21 tablas usan la
  política `auth_only` (todo bloqueado sin sesión); `catalogo_fotos`
  tiene además una política de lectura pública, para el futuro sitio de
  pedidos online. Pendiente conocido: `productos_terminados` también
  va a necesitar SELECT público cuando se construya ese sitio.
- **Escape de HTML**: `pmEsc()` en `pm_core.js` escapa `& < > " '`.
  Aplicada en `pan.js`, `galletas.js` y `comercial.js` sobre todo texto
  que un cliente pudiera escribir antes de insertarlo vía `innerHTML`.
  Sigue sin aplicarse en el resto del proyecto — riesgo bajo porque son
  datos que el propio Victor escribe, no clientes externos.
- **Login en herramientas standalone**: `labrec.html` comparte la misma
  cuenta de Supabase Auth que `index.html`. `etiquetas_producto.html` y
  `consultarecetas.html` ya no existen — se integraron/descartaron (ver
  sección 9).
- **Gobernanza del repositorio**: la rama `main` en GitHub está
  protegida contra borrado y force-push (julio 2026) — sin exigir
  revisión de Pull Request, porque el flujo de trabajo es de un único
  desarrollador subiendo directo por la interfaz web.

---

## 6. Optimistic locking

Para detectar cuando dos dispositivos/pestañas editan el mismo registro
al mismo tiempo:

- Las tablas `recetas`, `ingredientes`, `productos_terminados` y
  `clientes` tienen una columna `updated_at` con un trigger de Postgres
  que la actualiza sola en cada `UPDATE`.
- `pmMostrarConflicto(mensaje, onRecargar, onSobrescribir)` en
  `pm_core.js` es el helper genérico reutilizable — abre un modal
  (`#m-conflicto` en `index.html`) con dos botones: Recargar (descarta
  lo escrito y trae la versión más reciente) o Sobrescribir (acepta la
  base nueva y guarda igual lo propio).

**Cobertura — ya completa en las 4 áreas planeadas:**

| Área | Módulo | Funciones |
|---|---|---|
| Recetas | `costeo.js` | `recEditar()` / `recSave()` — piloto original |
| Ingredientes | `maestros.js` | `ingEdit()` / `ingEditSave()` |
| Tipos de pan | `maestros.js` | `panEdit()` / `panEditSave()` |
| Tipos de galleta | `maestros.js` | `gallEdit()` |
| Clientes | `plan_libre.js` | `cliEditar()` / `cliSave()` |

Pendiente: probar el conflicto real (mismo registro editado en dos
pestañas a la vez) en los 4 casos nuevos — el mecanismo está
implementado y revisado, falta forzarlo en producción.

---

## 7. Módulo de Mercadeo (nuevo, julio 2026)

Categorías, estilos y atributos de producto — pensado como un módulo de
**marketing/surtido**, deliberadamente separado del núcleo operacional
de PanMaestro (visión a futuro: parte de un ERP más grande donde
Marketing es un módulo aparte).

**Regla de diseño estricta**: cero columnas nuevas en
`productos_terminados`. Todo vive en 6 tablas satélite:

- `categorias` + `producto_categoria` (relación 1:1 — un producto tiene
  una sola categoría).
- `estilos` + `producto_estilo` (relación 1:1 — un producto tiene un
  solo estilo, o ninguno).
- `atributos` + `producto_atributo` (relación muchos-a-muchos — un
  producto puede tener varios atributos a la vez, ej. sin gluten *y*
  vegano).

`es_masa_madre` (columna booleana en `productos_terminados`) es la
única excepción — es legado de antes de este módulo y se dejó como está,
no se migró a la tabla `atributos`.

`mercadeo.js` es el único módulo que no usa `G`/`pmSave()` en absoluto
(no necesita caché offline para una pantalla de administración de
catálogo) y el único que no tiene métodos de dominio propios en
`pm_db.js` — usa los genéricos directo. Si se borra el archivo, el botón
del menú y las 6 tablas, el resto de PanMaestro queda exactamente igual
que antes de que existiera.

**Nota operativa para quien vuelva a correr las migraciones**: después
de crear una tabla nueva vía el SQL Editor de Supabase (en vez de sus
migraciones propias), PostgREST puede tardar en darse cuenta —
error típico `PGRST205 "Could not find the table ... in the schema
cache"`. Se resuelve con `NOTIFY pgrst, 'reload schema';`.

---

## 8. Convenciones y decisiones de diseño notables

- **Fechas en hora local, no UTC**: `pmHoy()` arma la fecha con
  `getFullYear/getMonth/getDate` en vez de
  `new Date().toISOString().slice(0,10)`, porque este último convierte a
  UTC y en Costa Rica (UTC-6) eso corría la fecha al día siguiente entre
  las 6pm y medianoche.
- **Sub-recetas y addons referencian por código estable** (`R-0008`),
  no por id local (`Date.now()`).
- **Códigos de receta nunca se reciclan**: `_pmNextRecCode()` toma el
  número más alto que exista (local + Supabase) y suma 1.
- **El código de una receta se bloquea al editar** (no al crear).
- **Comparaciones de id a prueba de tipo**: en `comercial.js` y
  `reportes.js`, las comparaciones de id de pedido usan
  `String(x.id) === String(y.id)` en vez de `===` directo — `pmId()`
  devuelve número, pero los `onclick` generados en HTML y los `<select>`
  siempre entregan string, y `número === texto` es siempre falso en JS.

---

## 9. Qué cambió desde la versión anterior de este documento

Esta es la segunda versión de `ARQUITECTURA.md`. Cambios principales
desde la primera (escrita justo después de la auditoría técnica, antes
del Punto 7 en adelante):

- **Comercial reescrito** — pasó de "Supabase-primario, síncrono, sin
  caché, no funciona offline" a local-first + dual-write, igual que
  Pan/Galletas (sección 3).
- **Optimistic locking extendido** — de "solo Recetas, piloto" a los 4
  módulos completos (sección 6).
- **Etiquetas integrada** — `etiquetas_producto.html` (standalone) se
  convirtió en `etiquetas.js`, pestaña propia dentro de PanMaestro.
- **Consulta Recetas descartada** — `consultarecetas.html` se eliminó
  por completo, era redundante con Recetario.
- **Menú rediseñado** — de 13 pestañas en fila plana a 6 grupos con
  dropdown en escritorio y menú hamburguesa en celular.
- **Módulo de Mercadeo agregado** — categorías/estilos/atributos de
  producto (sección 7), nuevo.
- **RLS verificado en vivo** — antes se documentaba por revisión de
  código; ahora está confirmado por consulta SQL directa a Supabase.
- **Gobernanza de repositorio** — rama `main` protegida, limpieza de
  Pull Requests obsoletas.
- **Versión 1.0 establecida** — ver
  `PanMaestro_Documentacion_v1.0.docx` para la documentación completa
  de negocio y base de datos (este archivo se enfoca solo en
  arquitectura técnica).

---

## 10. Deuda técnica conocida (a julio 2026)

- `pmEsc()` no aplicada fuera de pan/galletas/comercial — riesgo bajo,
  son datos propios de Victor, no de clientes externos.
- Optimistic locking implementado en los 4 módulos planeados, pero sin
  probar un conflicto real todavía en producción.
- `_sbProdMap` (código↔uuid de producto) vive solo en memoria, no
  persiste — una línea agregada 100% offline sin haber tenido conexión
  ni una vez en la sesión no puede sincronizar el producto hasta
  recuperar señal.
- Sin dump completo y versionado del esquema de base de datos en el
  repo — solo migraciones parciales (`gm_raw_schema_1.sql`,
  `sql_updated_at.sql`, `sql_categorias.sql`, `sql_estilos.sql`,
  `sql_atributos.sql`). El esquema completo de las 22 tablas vive en
  `PanMaestro_Documentacion_v1.0.docx`, no en un `.sql` único.
- Sin configuración de ESLint más allá de la básica agregada en julio
  2026 (reglas mínimas: variables sin usar, bloques vacíos, `==` vs
  `===` — sin `no-undef` porque el proyecto depende de globals
  compartidos entre archivos sin módulos ES).
