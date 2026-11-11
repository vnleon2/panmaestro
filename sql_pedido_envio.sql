-- ════════════════════════════════════════════════════════════════
-- Envío en pedidos comerciales (11 nov 2026)
--
-- El envío deja de cobrarse como un "producto" y pasa a ser un cargo
-- propio del pedido:
--   pedidos.envio_monto → monto del envío en colones (0 = sin envío)
--   pedidos.envio_nota  → nota opcional (ej. "Dimarkit, entrega Heredia")
-- pedidos.total pasa a guardar productos + envío (+ IVA cuando aplique).
--
-- Seguro de correr más de una vez (IF NOT EXISTS). Correr ANTES de usar
-- el campo "Envío" en la tarjeta del pedido; sin esto el envío queda
-- guardado solo en el navegador y la app avisa.
-- ════════════════════════════════════════════════════════════════

alter table pedidos add column if not exists envio_monto numeric not null default 0;
alter table pedidos add column if not exists envio_nota text;

comment on column pedidos.envio_monto is 'Cargo de envío del pedido (colones). Se suma al total; no es un producto.';
comment on column pedidos.envio_nota is 'Nota opcional del envío.';

notify pgrst, 'reload schema';
