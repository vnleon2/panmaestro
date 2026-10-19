-- ═══════════════════════════════════════════════════════════════
-- Módulo de Costos — Entrega 5: Gastos, capacidad y reparto del período
--
--   cost_presupuesto : gastos del período por cuenta y departamento (o compartidos),
--                      con su % variable
--   cost_capacidad   : por departamento y período, la base (driver) y la capacidad normal
--                      (productivos: base de absorción; apoyo: base de servicio)
--   cost_reparto     : cantidades de cada base por departamento (m², kWh, HH...), para
--                      repartir los gastos compartidos y los departamentos de apoyo
--
-- Requiere haber corrido antes sql_costos_maestros.sql y sql_costos_personal.sql
-- (departamentos, cuentas, drivers y períodos). No toca ninguna tabla existente.
--
-- Para deshacer esta entrega:
--   drop table if exists cost_reparto;
--   drop table if exists cost_capacidad;
--   drop table if exists cost_presupuesto;
--
-- Seguro de re-correr: IF NOT EXISTS / DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── 1. Gastos del período ──
-- depto_id vacío = gasto compartido: se reparte entre departamentos por la base de la cuenta.
-- monto = total del período (no mensual). pct_variable parte del valor de la cuenta y se puede ajustar.
create table if not exists cost_presupuesto (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references cost_periodos(id) on delete cascade,
  cuenta_id uuid not null references cost_cuentas(id) on delete restrict,
  depto_id uuid references cost_departamentos(id) on delete restrict,
  monto numeric(16,4) not null default 0 check (monto >= 0),
  pct_variable numeric(5,2) not null default 0 check (pct_variable between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Una sola línea por período + cuenta + departamento (la compartida cuenta como un "departamento" más)
create unique index if not exists uq_cost_presupuesto
  on cost_presupuesto (periodo_id, cuenta_id, coalesce(depto_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_cost_presup_per    on cost_presupuesto(periodo_id);
create index if not exists idx_cost_presup_cuenta on cost_presupuesto(cuenta_id);
create index if not exists idx_cost_presup_depto  on cost_presupuesto(depto_id);

-- ── 2. Capacidad por departamento ──
-- capacidad_normal: denominador de la tarifa fija (capacidad normal del período).
-- nivel_normal    : denominador de la tarifa variable; vacío = igual a la capacidad normal.
-- En departamentos de apoyo solo importa driver_id (base para repartir su costo).
create table if not exists cost_capacidad (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references cost_periodos(id) on delete cascade,
  depto_id uuid not null references cost_departamentos(id) on delete restrict,
  driver_id uuid not null references cost_drivers(id) on delete restrict,
  capacidad_normal numeric(18,4) check (capacidad_normal is null or capacidad_normal >= 0),
  nivel_normal numeric(18,4) check (nivel_normal is null or nivel_normal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (periodo_id, depto_id)
);
create index if not exists idx_cost_cap_per    on cost_capacidad(periodo_id);
create index if not exists idx_cost_cap_depto  on cost_capacidad(depto_id);
create index if not exists idx_cost_cap_driver on cost_capacidad(driver_id);

-- ── 3. Bases de reparto: cantidad de cada driver por departamento ──
create table if not exists cost_reparto (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references cost_periodos(id) on delete cascade,
  driver_id uuid not null references cost_drivers(id) on delete restrict,
  depto_id uuid not null references cost_departamentos(id) on delete restrict,
  cantidad numeric(18,4) not null default 0 check (cantidad >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (periodo_id, driver_id, depto_id)
);
create index if not exists idx_cost_rep_per    on cost_reparto(periodo_id);
create index if not exists idx_cost_rep_driver on cost_reparto(driver_id);
create index if not exists idx_cost_rep_depto  on cost_reparto(depto_id);

-- ── Triggers de updated_at ──
drop trigger if exists trg_updated_at on cost_presupuesto;
create trigger trg_updated_at before update on cost_presupuesto for each row execute function pm_set_updated_at();
drop trigger if exists trg_updated_at on cost_capacidad;
create trigger trg_updated_at before update on cost_capacidad for each row execute function pm_set_updated_at();
drop trigger if exists trg_updated_at on cost_reparto;
create trigger trg_updated_at before update on cost_reparto for each row execute function pm_set_updated_at();

-- ── RLS: auth_only ──
alter table cost_presupuesto enable row level security;
alter table cost_capacidad   enable row level security;
alter table cost_reparto     enable row level security;

drop policy if exists "auth_only" on cost_presupuesto;
create policy "auth_only" on cost_presupuesto for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth_only" on cost_capacidad;
create policy "auth_only" on cost_capacidad for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "auth_only" on cost_reparto;
create policy "auth_only" on cost_reparto for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

-- Verificación rápida (deben salir 3 tablas, todas en 0 filas):
-- select (select count(*) from cost_presupuesto) as presupuesto,
--        (select count(*) from cost_capacidad)   as capacidad,
--        (select count(*) from cost_reparto)     as reparto;
