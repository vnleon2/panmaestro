-- ═══════════════════════════════════════════════════════════════
-- COTIZADOR A COMERCIANTES — PanMaestro (módulo Mercadeo)
--
-- Tablas:
--   cotizacion      cabecera: número COT-0001 (automático), fecha, validez en
--                   días, cliente (del maestro o escrito libre), descuento %
--                   por defecto, redondeo, quién cotiza y código de firma
--                   aleatorio (los dos últimos se generan solos al guardar).
--   cotizacion_det  líneas: congelan el producto, los gramos, el precio al
--                   público y el % usados, de modo que un cambio posterior de
--                   precios en el maestro NO altera cotizaciones ya emitidas.
--
-- Una línea sin cantidad = línea de lista de precios. Si ninguna línea tiene
-- cantidad, el documento se imprime como "Lista de precios".
-- "Usar como base" copia una cotización a otra nueva (base_id guarda el
-- origen); el número y el código de firma de la copia salen nuevos.
--
-- Seguro de correr más de una vez.
-- ═══════════════════════════════════════════════════════════════

create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create sequence if not exists cotizacion_seq start 1;

create table if not exists cotizacion (
  id uuid primary key default gen_random_uuid(),
  numero text unique,                                  -- 'COT-0001' (lo pone el trigger)
  fecha date not null default current_date,
  validez_dias integer not null default 15 check (validez_dias > 0),
  cliente_id uuid,                                     -- null si el nombre se escribió libre
  cliente_nombre text not null,
  descuento_pct numeric(6,2) not null default 20 check (descuento_pct >= 0 and descuento_pct < 100),
  redondeo integer not null default 5 check (redondeo in (1, 5, 10, 50, 100)),
  firmante text,
  codigo_firma text,                                   -- aleatorio, lo pone el trigger
  notas text,
  estado text not null default 'vigente' check (estado in ('vigente', 'anulada')),
  base_id uuid references cotizacion(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cotizacion_fecha on cotizacion (fecha desc);

create table if not exists cotizacion_det (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references cotizacion(id) on delete cascade,
  orden integer not null default 0,
  producto_id uuid,
  producto_codigo text,
  producto_nombre text not null,
  peso_base_g numeric(10,2),                           -- gramos del maestro
  pvp_base numeric(12,2),                              -- precio al público del maestro (para ese peso)
  peso_g numeric(10,2),                                -- gramos cotizados
  pvp numeric(12,2) not null,                          -- precio al público ajustado a los gramos cotizados
  descuento_pct numeric(6,2) not null default 0,
  precio_comerciante numeric(12,2) not null,           -- pvp con el % de descuento
  descuento_monto numeric(12,2) not null default 0,    -- se resta del precio al comerciante, por unidad
  precio_neto numeric(12,2) not null,                  -- precio neto cotizado
  cantidad numeric(10,2) check (cantidad is null or cantidad >= 0),
  comentario text,
  total numeric(14,2) generated always as
    (case when cantidad is not null then cantidad * precio_neto end) stored
);

create index if not exists idx_cotizacion_det_cot on cotizacion_det (cotizacion_id, orden);

-- Número correlativo y código de firma, generados siempre en el servidor
-- (el navegador no los manda, así no se pueden repetir ni falsear).
create or replace function fn_cotizacion_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numero is null then
    new.numero := 'COT-' || lpad(nextval('cotizacion_seq')::text, 4, '0');
  end if;
  if new.codigo_firma is null then
    new.codigo_firma := upper(
      substr(md5(random()::text || clock_timestamp()::text || new.id::text), 1, 4) || '-' ||
      substr(md5(clock_timestamp()::text || random()::text), 1, 4));
  end if;
  return new;
end $$;

drop trigger if exists trg_cotizacion_numero on cotizacion;
create trigger trg_cotizacion_numero
before insert on cotizacion
for each row execute function fn_cotizacion_numero();

drop trigger if exists trg_updated_at on cotizacion;
create trigger trg_updated_at before update on cotizacion
  for each row execute function pm_set_updated_at();

-- Seguridad: mismo patrón auth_only que el resto de las tablas
alter table public.cotizacion     enable row level security;
alter table public.cotizacion_det enable row level security;

drop policy if exists "auth_only" on public.cotizacion;
create policy "auth_only" on public.cotizacion
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth_only" on public.cotizacion_det;
create policy "auth_only" on public.cotizacion_det
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

notify pgrst, 'reload schema';
