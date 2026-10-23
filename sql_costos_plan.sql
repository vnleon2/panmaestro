-- ═══════════════════════════════════════════════════════════════
-- Módulo de Costos — Plan de producción del período (por semanas)
--
--   cost_plan : cantidad de piezas de cada producto que estará disponible como
--               producto terminado en cada día de cada semana del período.
--               semana = 1, 2, 3... (semanas de lunes a domingo que tocan el período)
--               dia    = 1 (lunes) ... 7 (domingo)
--
-- Requiere haber corrido antes sql_costos_maestros.sql y sql_costos_personal.sql
-- (cost_periodos). No toca ninguna tabla existente.
--
-- Sirve igual si la tabla cost_plan ya existía de la primera versión (sin columna
-- semana): le agrega la columna (las filas viejas quedan en la semana 1) y cambia
-- la llave única.
--
-- Para deshacer:  drop table if exists cost_plan;
-- Seguro de re-correr: IF NOT EXISTS / DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

create table if not exists cost_plan (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references cost_periodos(id) on delete cascade,
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  semana smallint not null default 1 check (semana between 1 and 6),
  dia smallint not null check (dia between 1 and 7),
  cantidad numeric(14,2) not null default 0 check (cantidad >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Si la tabla venía de la primera versión: agregar semana y cambiar la llave única
alter table cost_plan add column if not exists semana smallint not null default 1;
alter table cost_plan drop constraint if exists cost_plan_semana_check;
alter table cost_plan add constraint cost_plan_semana_check check (semana between 1 and 6);
alter table cost_plan drop constraint if exists cost_plan_periodo_id_producto_id_dia_key;
create unique index if not exists uq_cost_plan_celda on cost_plan(periodo_id, producto_id, semana, dia);

create index if not exists idx_cost_plan_per  on cost_plan(periodo_id);
create index if not exists idx_cost_plan_prod on cost_plan(producto_id);

drop trigger if exists trg_updated_at on cost_plan;
create trigger trg_updated_at before update on cost_plan for each row execute function pm_set_updated_at();

alter table cost_plan enable row level security;
drop policy if exists "auth_only" on cost_plan;
create policy "auth_only" on cost_plan for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

-- Verificación rápida (debe salir la columna semana y la llave uq_cost_plan_celda):
-- select column_name from information_schema.columns where table_name = 'cost_plan' order by ordinal_position;
-- select indexname from pg_indexes where tablename = 'cost_plan';
