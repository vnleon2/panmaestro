-- ═══════════════════════════════════════════════════════════════
-- MPS — Previsión de venta por día (pan × canal × fecha)
--
-- Para cuando Victor ya sabe qué se va a vender un día concreto y no
-- quiere el reparto parejo del estimado mensual (ej. "el viernes 4
-- hogazas en la feria"). En ese día y canal, la previsión REEMPLAZA al
-- estimado repartido; los pedidos siguen contando si superan la previsión.
--
-- Módulo independiente. Para deshacer:  drop table if exists mps_prevision;
-- Seguro de correr más de una vez.
-- ═══════════════════════════════════════════════════════════════

create table if not exists mps_prevision (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  canal text not null check (canal in ('comercial', 'domestico', 'feria')),
  cantidad numeric not null default 0 check (cantidad >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fecha, producto_id, canal)
);

create index if not exists idx_mps_prevision_fecha on mps_prevision (fecha);

drop trigger if exists trg_updated_at on mps_prevision;
create trigger trg_updated_at before update on mps_prevision
  for each row execute function pm_set_updated_at();

alter table mps_prevision enable row level security;
drop policy if exists "auth_only" on mps_prevision;
create policy "auth_only" on mps_prevision
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
