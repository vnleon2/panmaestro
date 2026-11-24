-- ════════════════════════════════════════════════════════════════
-- Nota de crédito (23 nov 2026)
-- Número propio y permanente para la nota de crédito que se imprime desde
-- "Reversar venta" (una por cliente y fecha de reverso). El correlativo
-- sale de la tabla correlativos (tipo 'nota_credito', formato NC-0000001).
-- Seguro de correr más de una vez.
-- ════════════════════════════════════════════════════════════════
alter table public.ventas add column if not exists numero_nc text;
create index if not exists ventas_numero_nc_idx on public.ventas (numero_nc);
notify pgrst, 'reload schema';
