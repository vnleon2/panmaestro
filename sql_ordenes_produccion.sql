-- ═══════════════════════════════════════════════════════════════
-- Órdenes de producción — Entrega 1: tablas base
--
-- Diseño: módulo independiente, igual que MPS y Mercadeo. 3 tablas propias
-- con prefijo op_; NO modifica ninguna tabla existente. Si algún día se quiere
-- deshacer, alcanza con:
--   drop table if exists op_lineas, op_documentos, op_ordenes;
-- y el resto del sistema queda exactamente igual que antes.
--
--   op_ordenes     una orden = UN pan (número OP-0001, fecha de inicio,
--                  unidades, peso, masa cruda, estado)
--   op_documentos  los documentos de la orden: el principal (sufijo '') y las
--                  sub-órdenes (M = masa madre, S = otra subreceta,
--                  R = relleno, C = cobertura). Cada una es un objeto de costo
--                  propio y guarda la cantidad real obtenida (para inventarios
--                  en proceso, más adelante).
--   op_lineas      los ingredientes de cada documento, con la FOTO CONGELADA
--                  del estándar al emitir: cantidad estándar, costo estándar
--                  por gramo y costo de la línea. cant_real_g queda vacío
--                  hasta que alguien anote el consumo real (variación de uso);
--                  es_extra marca un material que no estaba en la receta.
--
-- El número de orden sale de la tabla correlativos (tipo 'op'), el mismo
-- mecanismo que ya usan los pedidos. Se crea sola la primera vez.
--
-- Seguro de correr más de una vez (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════

-- Función de updated_at (ya existe si corriste sql_updated_at.sql; se
-- recrea igual para que este archivo funcione solo).
create or replace function pm_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── Órdenes ─────────────────────────────────────────────────────
create table if not exists op_ordenes (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,                       -- 'OP-0087'
  producto_cod text not null,                        -- 'P020' (código del maestro de tipos de pan/galleta)
  producto_nombre text,
  receta_code text,                                  -- 'R-0001'
  receta_nombre text,
  fecha_inicio date not null,
  unidades numeric not null check (unidades > 0),
  peso_unidad_g numeric not null check (peso_unidad_g > 0),
  masa_cruda_g numeric,                              -- masa a mezclar (ya con la merma)
  merma_pct numeric not null default 0,
  estado text not null default 'emitida'
    check (estado in ('emitida', 'en_proceso', 'cerrada', 'anulada')),
  costo_std_total numeric not null default 0,        -- principal (incluye masa madre) + rellenos y coberturas
  unidades_producidas numeric,                       -- se llena al cerrar la orden
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_op_ordenes_fecha on op_ordenes (fecha_inicio);

-- ── Documentos (orden principal + sub-órdenes) ──────────────────
create table if not exists op_documentos (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references op_ordenes(id) on delete cascade,
  sufijo text not null default '',                   -- '' principal · 'M' · 'S' · 'R' · 'C' (con número si se repite: 'R2')
  tipo text not null
    check (tipo in ('principal', 'masa_madre', 'subreceta', 'relleno', 'cobertura')),
  titulo text,
  cantidad_g numeric,                                -- cantidad requerida
  cantidad_real_g numeric,                           -- cantidad realmente obtenida (se llena después)
  costo_std numeric not null default 0,
  en_principal boolean not null default false,       -- true: su costo ya está dentro del principal (masa madre, subrecetas)
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (orden_id, sufijo)
);

-- ── Líneas de ingredientes ──────────────────────────────────────
create table if not exists op_lineas (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references op_documentos(id) on delete cascade,
  orden_id uuid not null references op_ordenes(id) on delete cascade,
  orden integer not null default 0,
  ingrediente text not null,
  pct_panadero numeric,                              -- null si el documento no tiene base de harina ni de total
  cant_std_g numeric not null,                       -- estándar congelado
  cpg_std numeric not null default 0,                -- costo estándar por gramo congelado
  costo_std numeric not null default 0,
  es_sub boolean not null default false,             -- la línea es una sub-orden (su detalle está en otro documento)
  cant_real_g numeric,                               -- consumo real anotado (vacío hasta que alguien lo capture)
  es_extra boolean not null default false,           -- material usado que no estaba en la receta
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_op_lineas_doc on op_lineas (documento_id);
create index if not exists idx_op_lineas_orden on op_lineas (orden_id);

-- ── updated_at automático ───────────────────────────────────────
drop trigger if exists trg_updated_at on op_ordenes;
create trigger trg_updated_at before update on op_ordenes
  for each row execute function pm_set_updated_at();

drop trigger if exists trg_updated_at on op_documentos;
create trigger trg_updated_at before update on op_documentos
  for each row execute function pm_set_updated_at();

drop trigger if exists trg_updated_at on op_lineas;
create trigger trg_updated_at before update on op_lineas
  for each row execute function pm_set_updated_at();

-- ── RLS: mismo patrón auth_only que el resto de las tablas ──────
alter table op_ordenes enable row level security;
drop policy if exists "auth_only" on op_ordenes;
create policy "auth_only" on op_ordenes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table op_documentos enable row level security;
drop policy if exists "auth_only" on op_documentos;
create policy "auth_only" on op_documentos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table op_lineas enable row level security;
drop policy if exists "auth_only" on op_lineas;
create policy "auth_only" on op_lineas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Refrescar la caché de esquema de la API para que las tablas se vean ya.
notify pgrst, 'reload schema';

-- Verificación (debe devolver 3 filas):
-- select table_name from information_schema.tables
--  where table_name in ('op_ordenes', 'op_documentos', 'op_lineas') order by 1;
