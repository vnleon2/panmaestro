-- ═══════════════════════════════════════════════════════════════
-- Tienda web pública de PanMaestro (tienda.html) — 6 nov 2026
--
-- Diseño (mismo criterio que el módulo de Mercadeo):
--   · NO modifica productos_terminados ni abre ninguna tabla existente
--     a lectura pública. El sitio público solo habla con 2 FUNCIONES:
--       tienda_catalogo()       → devuelve SOLO los productos que tú
--                                 marcaste para publicar (nombre, peso,
--                                 precio, descripción, foto).
--       tienda_crear_pedido()   → recibe un pedido, lo VALIDA en el
--                                 servidor (precios recalculados desde
--                                 la base, nunca los del navegador) y lo
--                                 guarda en pedidos_web.
--   · Tablas nuevas (ambas con RLS: solo tú, con sesión, las ves):
--       tienda_productos  → qué productos se publican y su descripción.
--       pedidos_web       → bandeja de pedidos que llegan del sitio.
--   · Para deshacer todo sin afectar PanMaestro:
--       drop function if exists tienda_crear_pedido(text,text,text,text,date,jsonb);
--       drop function if exists tienda_catalogo();
--       drop table if exists pedidos_web;
--       drop table if exists tienda_productos;
--
-- Seguro de correr más de una vez. Correr ANTES de subir el código
-- nuevo (tienda.html, tienda_admin.js, index.html, pm_app.js).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Qué se publica ───────────────────────────────────────────
create table if not exists tienda_productos (
  producto_id  uuid primary key references productos_terminados(id) on delete cascade,
  publicar     boolean not null default false,
  proximamente boolean not null default false,   -- se ve en el sitio pero no se puede pedir
  descripcion  text,
  orden        integer not null default 100,
  updated_at   timestamptz not null default now()
);

alter table tienda_productos enable row level security;
drop policy if exists "auth_only" on tienda_productos;
create policy "auth_only" on tienda_productos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── 2. Bandeja de pedidos que llegan del sitio ──────────────────
create table if not exists pedidos_web (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  codigo          text not null unique,          -- ej. W261106-4821 (el cliente lo ve)
  nombre          text not null,
  telefono        text not null,
  direccion       text,
  notas           text,
  fecha_entrega   date,                          -- fecha preferida por el cliente (opcional)
  lineas          jsonb not null,                -- [{producto_id,nombre,tipo,cantidad,precio}]
  total           numeric not null default 0,    -- sin envío (el envío se cotiza por WhatsApp)
  estado          text not null default 'Nuevo', -- Nuevo | Confirmado | Enviado a PanMaestro | Cancelado
  pedido_pm_ids   jsonb not null default '[]'::jsonb,
  notas_internas  text
);

create index if not exists idx_pedidos_web_estado on pedidos_web (estado, created_at desc);

alter table pedidos_web enable row level security;
drop policy if exists "auth_only" on pedidos_web;
create policy "auth_only" on pedidos_web
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- (sin política para anon: el público NO puede leer ni escribir directo;
--  solo crea pedidos a través de tienda_crear_pedido)

-- ── 3. Catálogo público (solo lo publicado) ─────────────────────
create or replace function tienda_catalogo()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(json_agg(x order by x.orden, x.nombre), '[]'::json)
  from (
    select pt.id,
           pt.codigo,
           pt.nombre,
           pt.tipo,
           pt.peso_g,
           coalesce(pt.precio_full, 0) as precio,
           tp.descripcion,
           tp.proximamente,
           tp.orden,
           (select cf.foto_url from catalogo_fotos cf
             where cf.producto_codigo = pt.codigo limit 1) as foto_url
      from tienda_productos tp
      join productos_terminados pt on pt.id = tp.producto_id
     where tp.publicar and pt.activo
  ) x
$$;

-- ── 4. Crear pedido desde el sitio (validado en el servidor) ────
create or replace function tienda_crear_pedido(
  p_nombre    text,
  p_telefono  text,
  p_direccion text,
  p_notas     text,
  p_fecha     date,
  p_lineas    jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre   text := btrim(coalesce(p_nombre, ''));
  v_tel      text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_dir      text := nullif(btrim(coalesce(p_direccion, '')), '');
  v_notas    text := nullif(btrim(coalesce(p_notas, '')), '');
  v_hoy      date := (now() at time zone 'America/Costa_Rica')::date;
  v_pedidas  integer;
  v_halladas integer;
  v_lineas   jsonb;
  v_total    numeric;
  v_codigo   text;
  v_intento  integer := 0;
begin
  -- datos del cliente
  if char_length(v_nombre) < 2 or char_length(v_nombre) > 80 then
    raise exception 'Escribe tu nombre (entre 2 y 80 letras).';
  end if;
  if char_length(v_tel) < 8 or char_length(v_tel) > 15 then
    raise exception 'Escribe un teléfono válido (8 dígitos).';
  end if;
  if v_dir is not null and char_length(v_dir) > 300 then
    raise exception 'La dirección es demasiado larga.';
  end if;
  if v_notas is not null and char_length(v_notas) > 500 then
    raise exception 'Las notas son demasiado largas.';
  end if;
  if p_fecha is not null and (p_fecha < v_hoy or p_fecha > v_hoy + 60) then
    raise exception 'La fecha de entrega no es válida.';
  end if;

  -- líneas
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array'
     or jsonb_array_length(p_lineas) < 1 or jsonb_array_length(p_lineas) > 30 then
    raise exception 'Agrega al menos un producto a tu pedido.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lineas) as e(producto_id uuid, cantidad integer)
     where e.producto_id is null or e.cantidad is null or e.cantidad < 1 or e.cantidad > 50
  ) then
    raise exception 'Las cantidades deben estar entre 1 y 50.';
  end if;

  -- límites contra abuso: por teléfono y global (por hora)
  if (select count(*) from pedidos_web
       where telefono = v_tel and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Ya recibimos varios pedidos de este teléfono. Escríbenos por WhatsApp.';
  end if;
  if (select count(*) from pedidos_web where created_at > now() - interval '1 hour') >= 80 then
    raise exception 'Estamos recibiendo muchos pedidos ahora. Intenta en un rato o escríbenos por WhatsApp.';
  end if;

  -- precios y nombres SIEMPRE desde la base (solo productos publicados y pedibles)
  select count(*) into v_pedidas
    from (select distinct e.producto_id
            from jsonb_to_recordset(p_lineas) as e(producto_id uuid, cantidad integer)) d;

  select count(*),
         jsonb_agg(jsonb_build_object(
           'producto_id', pt.id, 'nombre', pt.nombre, 'tipo', pt.tipo,
           'cantidad', s.cantidad, 'precio', coalesce(pt.precio_full, 0)) order by pt.nombre),
         coalesce(sum(s.cantidad * coalesce(pt.precio_full, 0)), 0)
    into v_halladas, v_lineas, v_total
    from (select e.producto_id, sum(e.cantidad)::integer as cantidad
            from jsonb_to_recordset(p_lineas) as e(producto_id uuid, cantidad integer)
           group by e.producto_id) s
    join productos_terminados pt on pt.id = s.producto_id and pt.activo
    join tienda_productos tp on tp.producto_id = pt.id and tp.publicar and not tp.proximamente;

  if v_halladas is null or v_halladas <> v_pedidas then
    raise exception 'Alguno de los productos ya no está disponible. Recarga la página e intenta de nuevo.';
  end if;

  -- código corto para el cliente
  loop
    v_intento := v_intento + 1;
    v_codigo := 'W' || to_char(now() at time zone 'America/Costa_Rica', 'YYMMDD')
                || '-' || lpad((floor(random() * 10000))::integer::text, 4, '0');
    begin
      insert into pedidos_web (codigo, nombre, telefono, direccion, notas, fecha_entrega, lineas, total)
      values (v_codigo, v_nombre, v_tel, v_dir, v_notas, p_fecha, v_lineas, v_total);
      exit;
    exception when unique_violation then
      if v_intento >= 5 then raise exception 'No se pudo generar el pedido. Intenta de nuevo.'; end if;
    end;
  end loop;

  return json_build_object('codigo', v_codigo, 'total', v_total, 'lineas', v_lineas);
end;
$$;

-- solo estas dos funciones quedan expuestas al público
revoke all on function tienda_catalogo() from public;
revoke all on function tienda_crear_pedido(text,text,text,text,date,jsonb) from public;
grant execute on function tienda_catalogo() to anon, authenticated;
grant execute on function tienda_crear_pedido(text,text,text,text,date,jsonb) to anon, authenticated;

-- Refrescar la caché de esquema de la API para que las tablas/funciones se vean ya.
notify pgrst, 'reload schema';
