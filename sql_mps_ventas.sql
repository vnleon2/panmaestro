-- ═══════════════════════════════════════════════════════════════
-- MPS — Entrega 2a: ventas reales por día, pan y canal
--
-- Una fila = unidades vendidas de un pan, en un día, por un canal.
--   origen = 'pedidos'  la cargó el botón "Traer ventas de pedidos"
--   origen = 'manual'   la escribió/corrigió Victor (feria, correcciones);
--                       el botón de pedidos NUNCA pisa una fila manual
--
-- Módulo independiente: no modifica ninguna tabla existente. Para deshacer:
--   drop table if exists mps_venta_real;
-- Seguro de correr más de una vez.
-- ═══════════════════════════════════════════════════════════════

create table if not exists mps_venta_real (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  producto_id uuid not null references productos_terminados(id) on delete cascade,
  canal text not null check (canal in ('comercial', 'domestico', 'feria')),
  cantidad numeric not null default 0 check (cantidad >= 0),
  origen text not null default 'manual' check (origen in ('pedidos', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fecha, producto_id, canal)
);

create index if not exists idx_mps_venta_real_fecha on mps_venta_real (fecha);

drop trigger if exists trg_updated_at on mps_venta_real;
create trigger trg_updated_at before update on mps_venta_real
  for each row execute function pm_set_updated_at();

alter table mps_venta_real enable row level security;
drop policy if exists "auth_only" on mps_venta_real;
create policy "auth_only" on mps_venta_real
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';

-- Verificación (debe devolver 0 filas la primera vez):
-- select count(*) from mps_venta_real;
