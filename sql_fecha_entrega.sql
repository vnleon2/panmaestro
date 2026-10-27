-- ═══════════════════════════════════════════════════════════════
-- Fecha de entrega en pedidos (26 oct 2026)
--
-- Separa dos fechas que antes estaban mezcladas en una sola:
--   pedidos.fecha          → cuándo se TOMÓ el pedido (no cambia)
--   pedidos.fecha_entrega  → cuándo el cliente lo necesita (nueva, opcional)
--
-- La pestaña Producción arma el plan de un día con los pedidos cuya
-- fecha_entrega cae ese día; si un pedido no tiene fecha_entrega, se
-- produce el día en que se tomó (como siempre), así los pedidos viejos
-- no cambian de comportamiento.
--
-- Seguro de correr más de una vez (IF NOT EXISTS). Correr ANTES de subir
-- el código nuevo al repo.
-- ═══════════════════════════════════════════════════════════════

alter table pedidos add column if not exists fecha_entrega date;

create index if not exists idx_pedidos_fecha_entrega on pedidos (fecha_entrega);

comment on column pedidos.fecha_entrega is
  'Fecha en que el cliente necesita el pedido. Null = se produce el día de pedidos.fecha.';

-- Refrescar la caché de esquema de la API para que la columna se vea ya.
notify pgrst, 'reload schema';

-- ───────────────────────────────────────────────────────────────
-- OPCIONAL (correr aparte, solo si aplica): poner jueves 29 oct 2026
-- como entrega a los pedidos de pan que anotaste hoy lunes 26 oct.
-- Si algún pedido de hoy NO es para el jueves, mejor ponele la fecha
-- a mano en su tarjeta (campo "📅 Entrega").
--
-- update pedidos
--    set fecha_entrega = '2026-10-29'
--  where tipo = 'pan'
--    and fecha = '2026-10-26'
--    and fecha_entrega is null;
-- ───────────────────────────────────────────────────────────────
