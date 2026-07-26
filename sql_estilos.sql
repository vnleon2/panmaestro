-- ═══════════════════════════════════════════════════════════════
-- Estilo / origen — atributo transversal con catálogo (a diferencia
-- de es_masa_madre, que es un simple sí/no). Un producto tiene UN
-- solo estilo (o ninguno) — confirmado con Victor: no se combinan
-- varios estilos en un mismo producto.
--
-- Mismo patrón satélite que categorias/producto_categoria: NO toca
-- productos_terminados. Para deshacer:
--   drop table if exists producto_estilo;
--   drop table if exists estilos;
-- ═══════════════════════════════════════════════════════════════

create table if not exists estilos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table estilos enable row level security;
drop policy if exists "auth_only" on estilos;
create policy "auth_only" on estilos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Relación producto ↔ estilo. Un producto tiene UN solo estilo (o
-- ninguno, si no aplica) — de ahí el unique en producto_id, igual
-- que en producto_categoria.
create table if not exists producto_estilo (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null unique references productos_terminados(id) on delete cascade,
  estilo_id uuid not null references estilos(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table producto_estilo enable row level security;
drop policy if exists "auth_only" on producto_estilo;
create policy "auth_only" on producto_estilo
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Precarga de los 3 estilos definidos con Victor (26-jul-2026).
insert into estilos (codigo, nombre, orden) values
  ('TICA', 'Costarricense (tica)', 1),
  ('VENZ', 'Venezolana', 2),
  ('ESPA', 'Española', 3)
on conflict (codigo) do nothing;

-- Verificación rápida:
-- select codigo, nombre, orden from estilos order by orden;
