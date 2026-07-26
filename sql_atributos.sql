-- ═══════════════════════════════════════════════════════════════
-- Atributos — módulo de marketing, completamente independiente del
-- núcleo de PanMaestro (pensado como parte de un ERP más grande a
-- futuro, donde Marketing es un módulo aparte). A diferencia de
-- es_masa_madre (columna heredada ya existente en productos_terminados,
-- de antes de este módulo), TODO lo nuevo de aquí en adelante vive en
-- tablas satélite — cero columnas nuevas en productos_terminados.
--
-- Diseño genérico y dinámico: en vez de una tabla por cada atributo
-- booleano nuevo, un catálogo (atributos) + una relación muchos-a-muchos
-- (producto_atributo) — un producto puede tener varios atributos a la
-- vez (ej. sin gluten Y vegano), a diferencia de categoría/estilo que
-- son de a uno. Agregar un atributo nuevo el día de mañana es un solo
-- INSERT en atributos, sin tocar código.
--
-- Para deshacer todo el módulo de marketing sin afectar PanMaestro:
--   drop table if exists producto_atributo;
--   drop table if exists atributos;
--   drop table if exists producto_estilo;
--   drop table if exists estilos;
--   drop table if exists producto_categoria;
--   drop table if exists categorias;
-- ═══════════════════════════════════════════════════════════════

create table if not exists atributos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table atributos enable row level security;
drop policy if exists "auth_only" on atributos;
create policy "auth_only" on atributos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Relación muchos-a-muchos: un producto puede tener varios atributos
-- (sin gluten Y vegano a la vez), a diferencia de categoría/estilo.
create table if not exists producto_atributo (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  atributo_id uuid not null references atributos(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (producto_id, atributo_id)
);

alter table producto_atributo enable row level security;
drop policy if exists "auth_only" on producto_atributo;
create policy "auth_only" on producto_atributo
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Primer atributo confirmado con Victor (26-jul-2026). Agregar más
-- (vegano, sin lactosa, etc.) más adelante es un simple insert:
--   insert into atributos (codigo, nombre, orden) values ('VEGANO', 'Vegano', 2);
insert into atributos (codigo, nombre, orden) values
  ('SIN_GLUTEN', 'Sin gluten', 1)
on conflict (codigo) do nothing;

-- Verificación rápida:
-- select codigo, nombre, orden from atributos order by orden;
