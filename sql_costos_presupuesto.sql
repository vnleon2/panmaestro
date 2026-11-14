-- ═══════════════════════════════════════════════════════════════
-- Módulo de Costos — Presupuesto de gasto fijo y activos depreciables
--
--   cost_gasto_budget : gasto presupuestado por mes, cuenta y departamento
--                       (mercadeo, administración, venta y demás cuentas de gasto).
--                       mes = primer día del mes (ej. 2026-11-01). depto_id vacío = compartido.
--   cost_activos      : maestro de activos depreciables por departamento.
--                       Depreciación mensual (línea recta) = (costo - valor residual) / vida útil en meses,
--                       desde el mes de inicio y durante la vida útil. Entra al presupuesto como gasto fijo.
--
-- No toca ninguna tabla existente. Requiere haber corrido antes sql_costos_maestros.sql
-- (departamentos y cuentas). Crea pm_set_updated_at si no existe.
--
-- Para deshacer:
--   drop table if exists cost_gasto_budget;
--   drop table if exists cost_activos;
-- Seguro de re-correr: IF NOT EXISTS / DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── 1. Gasto presupuestado por mes ──
create table if not exists cost_gasto_budget (
  id uuid primary key default gen_random_uuid(),
  mes date not null check (extract(day from mes) = 1),
  cuenta_id uuid not null references cost_cuentas(id) on delete restrict,
  depto_id uuid references cost_departamentos(id) on delete restrict,
  monto numeric(16,4) not null default 0 check (monto >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_cost_gasto_budget_celda
  on cost_gasto_budget (mes, cuenta_id, coalesce(depto_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_cost_gasto_budget_cuenta on cost_gasto_budget(cuenta_id);
create index if not exists idx_cost_gasto_budget_depto  on cost_gasto_budget(depto_id);

-- ── 2. Maestro de activos depreciables ──
create table if not exists cost_activos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  depto_id uuid references cost_departamentos(id) on delete restrict,
  costo numeric(16,4) not null default 0 check (costo >= 0),
  valor_residual numeric(16,4) not null default 0 check (valor_residual >= 0),
  vida_util_meses integer not null default 60 check (vida_util_meses > 0),
  inicio date not null check (extract(day from inicio) = 1),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cost_activos_depto on cost_activos(depto_id);

-- ── Triggers de updated_at ──
drop trigger if exists trg_updated_at on cost_gasto_budget;
create trigger trg_updated_at before update on cost_gasto_budget for each row execute function pm_set_updated_at();
drop trigger if exists trg_updated_at on cost_activos;
create trigger trg_updated_at before update on cost_activos for each row execute function pm_set_updated_at();

-- ── Seguridad (RLS) ──
alter table cost_gasto_budget enable row level security;
drop policy if exists "auth_only" on cost_gasto_budget;
create policy "auth_only" on cost_gasto_budget for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table cost_activos enable row level security;
drop policy if exists "auth_only" on cost_activos;
create policy "auth_only" on cost_activos for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

-- Verificación rápida (deben salir las dos tablas):
-- select table_name from information_schema.tables where table_name in ('cost_gasto_budget','cost_activos');
