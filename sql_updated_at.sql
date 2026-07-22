-- ═══════════════════════════════════════════════════════════════
-- Punto 5 del plan de auditoría: base para optimistic locking
-- (detección de "alguien más ya cambió esto mientras lo editabas").
--
-- Agrega updated_at a las tablas donde todavía no lo teníamos
-- trackeado (pedidos ya lo maneja desde código, en pmDB.pedidos.editar).
-- Un trigger de Postgres lo actualiza solo en cada UPDATE — así no
-- depende de que el código JS se acuerde de mandarlo en cada escritura.
--
-- Seguro de correr aunque la columna ya exista (IF NOT EXISTS) y
-- aunque el trigger ya exista (DROP IF EXISTS antes de crear).
-- ═══════════════════════════════════════════════════════════════

alter table recetas              add column if not exists updated_at timestamptz not null default now();
alter table ingredientes         add column if not exists updated_at timestamptz not null default now();
alter table productos_terminados add column if not exists updated_at timestamptz not null default now();
alter table clientes             add column if not exists updated_at timestamptz not null default now();

create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_updated_at on recetas;
create trigger trg_updated_at before update on recetas
  for each row execute function pm_set_updated_at();

drop trigger if exists trg_updated_at on ingredientes;
create trigger trg_updated_at before update on ingredientes
  for each row execute function pm_set_updated_at();

drop trigger if exists trg_updated_at on productos_terminados;
create trigger trg_updated_at before update on productos_terminados
  for each row execute function pm_set_updated_at();

drop trigger if exists trg_updated_at on clientes;
create trigger trg_updated_at before update on clientes
  for each row execute function pm_set_updated_at();

-- Verificación rápida — debería devolver las 4 tablas con la columna:
-- select table_name, column_name from information_schema.columns
-- where column_name = 'updated_at'
--   and table_name in ('recetas','ingredientes','productos_terminados','clientes');
