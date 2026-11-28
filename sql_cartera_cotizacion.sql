-- ═══════════════════════════════════════════════════════════════
-- CARTERA DE CLIENTE DESDE COTIZACIÓN — PanMaestro (Mercadeo y ventas)
--
-- La cartera de un cliente comercial ya vive en public.precios_cliente
-- (precio_especial = lo que se le vende, fecha_desde / fecha_hasta = vigencia).
-- Este script solo agrega lo que faltaba para cargarla desde una cotización:
--
--   precio_full              precio "al público" que se le cotizó a ese cliente
--                            (puede ser distinto al del maestro de panes)
--   descuento_cotizado_pct   % de descuento comerciante de la cotización
--                            (solo informativo: el precio de venta es
--                            precio_especial y descuento_pct queda en 0,
--                            porque comercial.js aplica descuento_pct ENCIMA
--                            de precio_especial)
--   cotizacion_id            cotización de la que salió la línea
--
-- Seguro de correr más de una vez. Correr DESPUÉS de sql_cotizador.sql.
-- ═══════════════════════════════════════════════════════════════

alter table public.precios_cliente
  add column if not exists precio_full            numeric(12,2),
  add column if not exists descuento_cotizado_pct numeric(6,2),
  add column if not exists cotizacion_id          uuid references public.cotizacion(id) on delete set null;

create index if not exists idx_precios_cliente_cotizacion on public.precios_cliente (cotizacion_id);

notify pgrst, 'reload schema';
