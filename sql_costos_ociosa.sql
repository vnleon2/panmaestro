-- ═══════════════════════════════════════════════════════════════
-- Módulo de Costos — nuevo tipo de departamento "ociosa" (capacidad ociosa)
--
-- Permite guardar tipo = 'ociosa' en cost_departamentos. Si la tabla tenía una
-- restricción (check) sobre la columna tipo, la reemplaza por otra que incluye
-- 'ociosa'. No toca datos. Seguro de re-correr.
-- ═══════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'cost_departamentos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table cost_departamentos drop constraint %I', r.conname);
  end loop;
end $$;

alter table cost_departamentos
  add constraint cost_departamentos_tipo_check
  check (tipo in ('productivo','apoyo','venta','mercadeo','administracion','ociosa'));

notify pgrst, 'reload schema';

-- Verificación (debe listar la restricción con 'ociosa'):
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'cost_departamentos'::regclass and contype = 'c';
