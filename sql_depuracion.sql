-- ═══════════════════════════════════════════════════════════════
-- Depuración de maestros — pares de nombres que Victor marcó como
-- "no es duplicado", para que la revisión no vuelva a mostrarlos.
--
-- Módulo independiente (depuracion.js, prefijo dep*): solo LEE los
-- maestros (ingredientes, recetas, clientes, productos_terminados) y
-- solo ESCRIBE en esta tabla satélite. Cero columnas nuevas en tablas
-- existentes.
--
-- Si esta tabla no existe, depuracion.js sigue funcionando y guarda
-- los descartes en el navegador (localStorage) como respaldo — pero
-- entonces no se comparten entre celular y laptop. Correr este SQL
-- una vez en Supabase los hace compartidos.
--
-- Para deshacer todo el módulo sin afectar PanMaestro:
--   drop table if exists depuracion_descartes;
-- ═══════════════════════════════════════════════════════════════

create table if not exists depuracion_descartes (
  id uuid primary key default gen_random_uuid(),
  maestro text not null,          -- 'ingredientes' | 'recetas' | 'clientes' | 'productos'
  clave text not null,            -- ids de los dos registros, ordenados y unidos con '|'
  created_at timestamptz not null default now(),
  unique (maestro, clave)
);

alter table depuracion_descartes enable row level security;
drop policy if exists "auth_only" on depuracion_descartes;
create policy "auth_only" on depuracion_descartes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
