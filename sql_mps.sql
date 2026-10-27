-- ═══════════════════════════════════════════════════════════════
-- MPS (Plan maestro de producción) — Entrega 1: tablas base
--
-- Diseño: módulo independiente, igual que Mercadeo. 5 tablas propias con
-- prefijo mps_; NO modifica ninguna tabla existente (solo referencia
-- productos_terminados). Si algún día se quiere deshacer, alcanza con:
--   drop table if exists mps_excepciones, mps_calendario, mps_inventario,
--                        mps_estimado, mps_periodos;
-- y el resto del sistema queda exactamente igual que antes.
--
--   mps_periodos     un mes (primer día del mes) y su estado: borrador/aprobado
--   mps_estimado     unidades estimadas del mes por pan y por canal
--   mps_inventario   inventario inicial del mes por pan (0 si no hay fila)
--   mps_calendario   días de la semana en que se entrega cada canal
--                    (una fila = ese canal entrega ese día; dia_semana usa la
--                    convención de JavaScript: 0=domingo, 1=lunes ... 6=sábado)
--   mps_excepciones  fechas puntuales sin entrega (feriados, vacaciones);
--                    canal null = ningún canal entrega ese día
--
-- Seguro de correr más de una vez (IF NOT EXISTS / ON CONFLICT).
-- ═══════════════════════════════════════════════════════════════

-- Función de updated_at (ya existe si corriste sql_updated_at.sql; se
-- recrea igual para que este archivo funcione solo).
create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── Períodos ────────────────────────────────────────────────────
create table if not exists mps_periodos (
  id uuid primary key default gen_random_uuid(),
  mes date not null unique,
  estado text not null default 'borrador' check (estado in ('borrador', 'aprobado')),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Estimado de venta (unidades) por pan y canal ────────────────
create table if not exists mps_estimado (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references mps_periodos(id) on delete cascade,
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  canal text not null check (canal in ('comercial', 'domestico', 'feria')),
  cantidad numeric not null default 0 check (cantidad >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (periodo_id, producto_id, canal)
);

-- ── Inventario inicial del mes por pan ──────────────────────────
create table if not exists mps_inventario (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references mps_periodos(id) on delete cascade,
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  inv_inicial numeric not null default 0 check (inv_inicial >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (periodo_id, producto_id)
);

-- ── Calendario de entregas por canal ────────────────────────────
create table if not exists mps_calendario (
  id uuid primary key default gen_random_uuid(),
  canal text not null check (canal in ('comercial', 'domestico', 'feria')),
  dia_semana integer not null check (dia_semana between 0 and 6),
  created_at timestamptz not null default now(),
  unique (canal, dia_semana)
);

-- ── Excepciones (fechas sin entrega) ────────────────────────────
create table if not exists mps_excepciones (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  canal text check (canal is null or canal in ('comercial', 'domestico', 'feria')),
  motivo text,
  created_at timestamptz not null default now()
);

-- Una misma fecha no se repite para el mismo canal (ni dos veces "todos").
create unique index if not exists uq_mps_excepciones
  on mps_excepciones (fecha, coalesce(canal, '*'));

-- ── updated_at automático ───────────────────────────────────────
drop trigger if exists trg_updated_at on mps_periodos;
create trigger trg_updated_at before update on mps_periodos
  for each row execute function pm_set_updated_at();

drop trigger if exists trg_updated_at on mps_estimado;
create trigger trg_updated_at before update on mps_estimado
  for each row execute function pm_set_updated_at();

drop trigger if exists trg_updated_at on mps_inventario;
create trigger trg_updated_at before update on mps_inventario
  for each row execute function pm_set_updated_at();

-- ── RLS: mismo patrón auth_only que el resto de las tablas ──────
alter table mps_periodos enable row level security;
drop policy if exists "auth_only" on mps_periodos;
create policy "auth_only" on mps_periodos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table mps_estimado enable row level security;
drop policy if exists "auth_only" on mps_estimado;
create policy "auth_only" on mps_estimado
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table mps_inventario enable row level security;
drop policy if exists "auth_only" on mps_inventario;
create policy "auth_only" on mps_inventario
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table mps_calendario enable row level security;
drop policy if exists "auth_only" on mps_calendario;
create policy "auth_only" on mps_calendario
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table mps_excepciones enable row level security;
drop policy if exists "auth_only" on mps_excepciones;
create policy "auth_only" on mps_excepciones
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Calendario de entregas acordado (26-oct-2026) ───────────────
--   Comerciales: martes y sábado · Domésticos: jueves y sábado · Feria: viernes
-- Después se puede cambiar desde la pantalla MPS → Calendario de entregas.
insert into mps_calendario (canal, dia_semana) values
  ('comercial', 2), ('comercial', 6),
  ('domestico', 4), ('domestico', 6),
  ('feria', 5)
on conflict (canal, dia_semana) do nothing;

-- Refrescar la caché de esquema de la API para que las tablas se vean ya.
notify pgrst, 'reload schema';

-- Verificación (debe devolver las 5 filas del calendario):
-- select canal, dia_semana from mps_calendario order by canal, dia_semana;
