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

-- CORRECCIÓN (ver auditoría previa a la documentación v1.0): la política
-- original de este archivo era "gm_raw_recetas_all" con
-- using(true) with check(true) — abierta a cualquiera con la key pública,
-- sin exigir sesión. Esa política ya fue cerrada directamente en Supabase
-- durante el Punto 2 del plan de auditoría de julio 2026 (RLS + login en
-- herramientas standalone), pero este archivo del repo había quedado sin
-- actualizar — si alguien lo re-corría tal cual, reabría el hueco.
-- Confirmado por consulta en vivo a pg_policies: la política vigente hoy
-- es "auth_only", solo usuarios autenticados, para ALL (select/insert/
-- update/delete). Se deja aquí la definición correcta para que este
-- archivo vuelva a ser una fuente de verdad confiable.
drop policy if exists "gm_raw_recetas_all" on gm_raw_recetas;
drop policy if exists "auth_only" on gm_raw_recetas;
create policy "auth_only" on gm_raw_recetas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
