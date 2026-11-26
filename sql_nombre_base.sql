-- ═══════════════════════════════════════════════════════════════
-- Nombre base + peso — limpieza de nombres (25-nov-2026)
-- Regla nueva: el peso es un CAMPO (peso_g) y el nombre que se guarda es
-- solo el nombre base. La app arma el nombre mostrable: "Nombre 500 g".
-- Este script le quita el peso escrito DENTRO del nombre a 37 productos.
-- Solo cambia filas cuyo nombre sigue igual al de la lista (si ya lo
-- editaste a mano, no lo pisa). Seguro de re-correr.
-- Para deshacer: el respaldo queda en respaldo_nombres_productos.
-- ═══════════════════════════════════════════════════════════════

-- 1) Respaldo de los nombres actuales (solo la primera vez)
create table if not exists respaldo_nombres_productos as
  select codigo, nombre, now() as respaldado_en from productos_terminados;
alter table respaldo_nombres_productos enable row level security;   -- sin acceso desde afuera

-- 2) Nombres sin el peso
update productos_terminados p
   set nombre = v.nuevo
  from (values
  ('P001', 'Pan Masa Madre Tartine 1000g', 'Pan Masa Madre Tartine'),
  ('P005', 'Pan de Masa Madre 800g Semi Integral', 'Pan de Masa Madre Semi Integral'),
  ('P007', 'Pan de Molde Masa Madre Aove 1.1 Kilos', 'Pan de Molde Masa Madre Aove'),
  ('P010', 'Pan Andino Dulce MM Talvina Barra 500g', 'Pan Andino Dulce MM Talvina Barra'),
  ('P011', 'Pan Andino Bollo de 225g', 'Pan Andino Bollo'),
  ('P012', 'Pan de Masa Madre con Semillas LF 1 Kilo', 'Pan de Masa Madre con Semillas LF'),
  ('P013', 'Pan Masa Madre Tartine 600g', 'Pan Masa Madre Tartine'),
  ('P014', 'Pan Diario de Masa Madre  600g', 'Pan Diario de Masa Madre'),
  ('P015', 'Pan Italiano 1k', 'Pan Italiano'),
  ('P017', 'Pan Dulce 200g', 'Pan Dulce'),
  ('P018', 'Pan de Molde Masa Madre Rústico Semi Integral 750g', 'Pan de Molde Masa Madre Rústico Semi Integral'),
  ('P020', 'Pan Masa Madre Tartine Hogaza LF 800g', 'Pan Masa Madre Tartine Hogaza LF'),
  ('P022', 'Pan de Masa Madre con Ajo 1 Kilo', 'Pan de Masa Madre con Ajo'),
  ('P023', 'Pan Diario de Masa Madre con Semillas 800g', 'Pan Diario de Masa Madre con Semillas'),
  ('P024', 'Pan Piñitas de Talvina 280g', 'Pan Piñitas de Talvina'),
  ('P025', 'Pan Canilla Masa Madre 250g', 'Pan Canilla Masa Madre'),
  ('P026', 'Pan Campesino Venezolano Masa Madre 500g', 'Pan Campesino Venezolano Masa Madre'),
  ('P027', 'Pan de Molde Rustico Masa Madre 750g', 'Pan de Molde Rustico Masa Madre'),
  ('P028', 'Baguette de Masa Madre Larga Ferm. 250g', 'Baguette de Masa Madre Larga Ferm.'),
  ('P031', 'Pan Diario de Masa Madre 1000g', 'Pan Diario de Masa Madre'),
  ('P033', 'Pan Trenzado  Dulce  tipo challah 500g', 'Pan Trenzado Dulce tipo challah'),
  ('P034', 'Baguette Mm Larga Fermentación Mm 333g', 'Baguette Mm Larga Fermentación Mm'),
  ('P035', 'Pan de Maíz Bollitos 100', 'Pan de Maíz Bollitos'),
  ('P038', 'Pan Hogaza Molde 600 G Masa Blanca', 'Pan Hogaza Molde Masa Blanca'),
  ('P042', 'Pan de Masa Madre LF 600g', 'Pan de Masa Madre LF'),
  ('P055', 'Pan de Masa Madre LF 800g', 'Pan de Masa Madre LF'),
  ('P056', 'Pan de Masa Madre LF 1000g', 'Pan de Masa Madre LF'),
  ('P057', 'Pan Diario Masa Madre 800g', 'Pan Diario Masa Madre'),
  ('P058', 'Pan Campesino Venezolano Regular 500g', 'Pan Campesino Venezolano Regular'),
  ('P059', 'Baguette Italiana 250g', 'Baguette Italiana'),
  ('P063', 'Pan Masa Madre Tartine 750 G', 'Pan Masa Madre Tartine'),
  ('P067', 'Pan Trenzado regular Azucarado 300g', 'Pan Trenzado regular Azucarado'),
  ('P068', 'Pan Trenzado Relleno 300g', 'Pan Trenzado Relleno'),
  ('P071', 'Pan Masa Madre Tartine 800g', 'Pan Masa Madre Tartine'),
  ('P073', 'Pan Masa Madre Semiintegral. Semillas 600g', 'Pan Masa Madre Semiintegral. Semillas'),
  ('P076', 'Pan francés clásico 120g', 'Pan francés clásico'),
  ('G013', 'Galletas planas mixtas 170 crunch', 'Galletas planas mixtas crunch')
  ) as v(codigo, actual, nuevo)
 where p.codigo = v.codigo
   and p.nombre = v.actual;

-- 3) Verificación: no debe quedar ningún nombre con el peso adentro
select codigo, nombre, peso_g
  from productos_terminados
 where nombre ~* '(^|[[:space:](])[0-9]+([.,][0-9]+)?[[:space:]]*(gramos?|grs?|kgs?|kilos?|g|k)([^a-záéíóúñ]|$)'
 order by codigo;

-- Deshacer (solo si hace falta):
-- update productos_terminados p set nombre = r.nombre
--   from respaldo_nombres_productos r where r.codigo = p.codigo;
