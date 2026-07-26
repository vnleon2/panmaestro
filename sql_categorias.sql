-- ═══════════════════════════════════════════════════════════════
-- Category management — dimensión de marketing/surtido, separada
-- de la clasificación de manufactura que ya existe en recetas.categoria.
--
-- Diseño: tabla satélite. NO modifica productos_terminados en absoluto.
-- Si algún día se quiere deshacer, alcanza con:
--   drop table if exists producto_categoria;
--   drop table if exists categorias;
-- y el resto del sistema queda exactamente igual que antes.
-- ═══════════════════════════════════════════════════════════════

create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table categorias enable row level security;
drop policy if exists "auth_only" on categorias;
create policy "auth_only" on categorias
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Relación producto ↔ categoría. Un producto tiene UNA sola categoría
-- (dimensión excluyente) — de ahí el unique en producto_id. Atributos
-- transversales (ej. es_masa_madre) siguen viviendo en productos_terminados,
-- no aquí — no se mezclan las dos dimensiones.
create table if not exists producto_categoria (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null unique references productos_terminados(id) on delete cascade,
  categoria_id uuid not null references categorias(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table producto_categoria enable row level security;
drop policy if exists "auth_only" on producto_categoria;
create policy "auth_only" on producto_categoria
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Precarga de las 7 categorías definidas con Victor (26-jul-2026).
-- Seguro de re-correr: on conflict no duplica si el código ya existe.
insert into categorias (codigo, nombre, orden) values
  ('MSAL', 'Masas saladas', 1),
  ('MDUL', 'Masas dulces', 2),
  ('GALL', 'Galletas', 3),
  ('BOLL', 'Bollería', 4),
  ('EMPA', 'Empanadas y panes rellenos salados', 5),
  ('PIZZ', 'Pizzas', 6),
  ('OTRO', 'Otros / Repostería', 7)
on conflict (codigo) do nothing;

-- Verificación rápida:
-- select codigo, nombre, orden from categorias order by orden;
