-- ═══════════════════════════════════════════════════════════════
-- MPS — Rolling forecast (matriz de 12 meses por producto)
--
--   mps_forecast : unidades del forecast por mes y por producto.
--                  mes = primer día del mes (ej. 2026-12-01).
--                  Solo guarda lo que se corrige a mano: si un mes no tiene fila,
--                  el forecast vale lo que diga el budget (cost_budget_venta).
--                  Los meses ya vividos no se guardan: salen de mps_venta_real.
--
-- No toca ninguna tabla existente (solo referencia productos_terminados).
-- Para deshacer:  drop table if exists mps_forecast;
-- Seguro de re-correr: IF NOT EXISTS / DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists mps_forecast (
  id uuid primary key default gen_random_uuid(),
  mes date not null check (extract(day from mes) = 1),
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  unidades numeric(14,2) not null default 0 check (unidades >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_mps_forecast_celda on mps_forecast(mes, producto_id);
create index if not exists idx_mps_forecast_prod on mps_forecast(producto_id);

drop trigger if exists trg_updated_at on mps_forecast;
create trigger trg_updated_at before update on mps_forecast for each row execute function pm_set_updated_at();

alter table mps_forecast enable row level security;
drop policy if exists "auth_only" on mps_forecast;
create policy "auth_only" on mps_forecast for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

-- Verificación rápida (debe salir la tabla y el índice uq_mps_forecast_celda):
-- select column_name from information_schema.columns where table_name = 'mps_forecast' order by ordinal_position;
-- select indexname from pg_indexes where tablename = 'mps_forecast';
