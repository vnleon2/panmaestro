-- ═══════════════════════════════════════════════════════════════
-- COTIZADOR → PEDIDO COMERCIAL PROMOCIONAL
-- Enlaza cada pedido promocional con la cotización de la que salió.
-- Correr DESPUÉS de sql_cotizador.sql y pedido_promo.sql.
-- Seguro de correr más de una vez.
-- ═══════════════════════════════════════════════════════════════

alter table public.pedido_promo
  add column if not exists cotizacion_id uuid references public.cotizacion(id) on delete set null;

create index if not exists idx_pedido_promo_cotizacion on public.pedido_promo (cotizacion_id);

notify pgrst, 'reload schema';
