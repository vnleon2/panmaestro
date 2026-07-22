-- Respaldo crudo de recetas de Gluten Morgen (as-is), independiente de labrec_recetas.
-- El nombre es la clave: al reimportar, se actualiza si cambió, no se duplica.
create table if not exists gm_raw_recetas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  peso numeric,
  nota text,
  ingredientes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table gm_raw_recetas enable row level security;

create policy "gm_raw_recetas_all" on gm_raw_recetas
  for all using (true) with check (true);
