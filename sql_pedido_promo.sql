-- =====================================================
-- PEDIDO COMERCIAL PROMOCIONAL - PanMaestro
-- Script completo, ejecutar de una vez y en este orden
-- =====================================================

-- 1) Configuración (teléfono SINPE)
create table if not exists config_pago (
  clave text primary key,
  valor text not null
);
insert into config_pago (clave, valor)
values ('sinpe_telefono', '6026-7852')
on conflict (clave) do update set valor = excluded.valor;

-- 2) Cabecera
create table if not exists pedido_promo (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null,
  titulo text,
  fecha_pedido date not null default current_date,
  fecha_entrega date not null,
  estado text not null default 'borrador'
    check (estado in ('borrador','confirmado','producido','entregado','cobrado','anulado')),
  condiciones text,
  telefono_pago text,
  monto_cobrado numeric(14,2),
  fecha_cobro date,
  referencia_pago text,
  created_at timestamptz default now()
);

-- 3) Líneas
create table if not exists pedido_promo_det (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedido_promo(id) on delete cascade,
  producto_id uuid,
  producto_nombre text not null,
  peso_g numeric(8,2),
  cantidad numeric(10,2) not null check (cantidad >= 0),
  pvp numeric(12,2) not null,
  precio_pactado numeric(12,2) not null,
  regalia_cant numeric(10,2) not null default 0,
  regalia_motivo text check (regalia_motivo in ('cortesia','premio')),
  costo_unit_estandar numeric(12,2),
  costo_origen text not null default 'receta'
    check (costo_origen in ('receta','estandar','manual')),
  check (regalia_cant <= cantidad),
  valor_pvp      numeric(14,2) generated always as (cantidad * pvp) stored,
  valor_pactado  numeric(14,2) generated always as (cantidad * precio_pactado) stored,
  monto_regalia  numeric(14,2) generated always as (regalia_cant * precio_pactado) stored,
  neto_cobrar    numeric(14,2) generated always as ((cantidad - regalia_cant) * precio_pactado) stored,
  descuento_pct  numeric(7,3)  generated always as
    (case when pvp > 0 then (1 - precio_pactado / pvp) * 100 else 0 end) stored,
  costo_total    numeric(14,2) generated always as (cantidad * coalesce(costo_unit_estandar,0)) stored,
  costo_regalia  numeric(14,2) generated always as (regalia_cant * coalesce(costo_unit_estandar,0)) stored
);

-- 4) Teléfono SINPE vigente al crear el pedido
create or replace function fn_pedido_promo_telefono()
returns trigger language plpgsql as $$
begin
  if new.telefono_pago is null then
    select valor into new.telefono_pago from config_pago where clave = 'sinpe_telefono';
  end if;
  return new;
end $$;

drop trigger if exists trg_pedido_promo_telefono on pedido_promo;
create trigger trg_pedido_promo_telefono
before insert on pedido_promo
for each row execute function fn_pedido_promo_telefono();

-- 5) Costo unitario de la receta (AJUSTAR a tu esquema real)
create or replace function costo_receta_unitario(p_producto_id uuid)
returns numeric language sql stable as $$
  -- Reemplaza por la consulta que devuelve el costo por unidad del producto, ej:
  -- select costo_unitario from receta where producto_id = p_producto_id
  select null::numeric
$$;

-- 6) Al confirmar el pedido, congela el costo de receta en las líneas
create or replace function fn_pedido_promo_congelar_costo()
returns trigger language plpgsql as $$
begin
  if new.estado = 'confirmado' and old.estado = 'borrador' then
    update pedido_promo_det
       set costo_unit_estandar = costo_receta_unitario(producto_id),
           costo_origen = 'receta'
     where pedido_id = new.id
       and costo_unit_estandar is null
       and producto_id is not null;
  end if;
  return new;
end $$;

drop trigger if exists trg_pedido_promo_congelar_costo on pedido_promo;
create trigger trg_pedido_promo_congelar_costo
after update of estado on pedido_promo
for each row execute function fn_pedido_promo_congelar_costo();

-- 7) Totales, costo y margen por pedido
create or replace view pedido_promo_totales as
select d.pedido_id,
       sum(d.valor_pvp)      as total_pvp,
       sum(d.valor_pactado)  as total_pactado,
       sum(d.monto_regalia)  as total_regalia,
       sum(d.neto_cobrar)    as total_neto_cobrar,
       sum(d.costo_total)    as costo_total,
       sum(d.costo_regalia)  as costo_regalia,
       sum(d.neto_cobrar) - sum(d.costo_total) as margen_bruto
from pedido_promo_det d
group by d.pedido_id;

-- 8) Diferencia entre lo que debía cobrarse y lo cobrado
create or replace view pedido_promo_cobro as
select p.id as pedido_id, p.estado,
       t.total_neto_cobrar,
       p.monto_cobrado,
       coalesce(p.monto_cobrado,0) - t.total_neto_cobrar as diferencia
from pedido_promo p
join pedido_promo_totales t on t.pedido_id = p.id;

-- 9) Demanda para el MPS: cantidad total, canal 'promocional', por mes
create or replace view mps_demanda_promocional as
select date_trunc('month', p.fecha_entrega)::date as mes,
       'promocional'::text as canal,
       d.producto_id,
       d.producto_nombre,
       sum(d.cantidad)     as cantidad_total,
       sum(d.regalia_cant) as de_la_cual_regalia,
       count(distinct p.id) as pedidos
from pedido_promo p
join pedido_promo_det d on d.pedido_id = p.id
where p.estado in ('confirmado','producido','entregado','cobrado')
group by 1, d.producto_id, d.producto_nombre;
