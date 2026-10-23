-- ═══════════════════════════════════════════════════════════════
-- Módulo de Costos — Plan de producción del período
--
--   cost_plan : cantidad de piezas de cada producto que estará disponible como
--               producto terminado cada día de la semana (1 = lunes ... 7 = domingo),
--               dentro de un período. Es una "semana tipo": el mes se obtiene
--               multiplicando por las semanas del período.
--
-- Requiere haber corrido antes sql_costos_maestros.sql y sql_costos_personal.sql
-- (cost_periodos). No toca ninguna tabla existente.
--
-- Para deshacer:  drop table if exists cost_plan;
-- Seguro de re-correr: IF NOT EXISTS / DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

create table if not exists cost_plan (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references cost_periodos(id) on delete cascade,
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  dia smallint not null check (dia between 1 and 7),
  cantidad numeric(14,2) not null default 0 check (cantidad >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (periodo_id, producto_id, dia)
);
create index if not exists idx_cost_plan_per  on cost_plan(periodo_id);
create index if not exists idx_cost_plan_prod on cost_plan(producto_id);

drop trigger if exists trg_updated_at on cost_plan;
create trigger trg_updated_at before update on cost_plan for each row execute function pm_set_updated_at();

alter table cost_plan enable row level security;
drop policy if exists "auth_only" on cost_plan;
create policy "auth_only" on cost_plan for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

-- Verificación rápida (debe salir 0):
-- select count(*) from cost_plan;
