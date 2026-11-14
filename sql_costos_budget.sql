-- ═══════════════════════════════════════════════════════════════
-- Módulo de Costos — Budget de ventas (matriz de 12 meses)
--
--   cost_budget_venta : unidades presupuestadas por mes y por producto
--                       (pan, galleta u otro de productos_terminados).
--                       mes = primer día del mes (ej. 2026-11-01).
--
-- Es el BUDGET: la base para el costo estándar, el presupuesto de materiales
-- (explosión de recetas) y la estimación de nómina. El MPS es el rolling forecast.
-- Venta = producción (sin inventario).
--
-- No toca ninguna tabla existente (solo referencia productos_terminados).
-- Requiere haber corrido antes sql_updated_at.sql (función pm_set_updated_at);
-- si no, este archivo la crea igual.
--
-- Para deshacer:  drop table if exists cost_budget_venta;
-- Seguro de re-correr: IF NOT EXISTS / DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists cost_budget_venta (
  id uuid primary key default gen_random_uuid(),
  mes date not null check (extract(day from mes) = 1),
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  unidades numeric(14,2) not null default 0 check (unidades >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_cost_budget_venta_celda on cost_budget_venta(mes, producto_id);
create index if not exists idx_cost_budget_venta_prod on cost_budget_venta(producto_id);

drop trigger if exists trg_updated_at on cost_budget_venta;
create trigger trg_updated_at before update on cost_budget_venta for each row execute function pm_set_updated_at();

alter table cost_budget_venta enable row level security;
drop policy if exists "auth_only" on cost_budget_venta;
create policy "auth_only" on cost_budget_venta for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

-- Verificación rápida (debe salir la tabla y el índice uq_cost_budget_venta_celda):
-- select column_name from information_schema.columns where table_name = 'cost_budget_venta' order by ordinal_position;
-- select indexname from pg_indexes where tablename = 'cost_budget_venta';
