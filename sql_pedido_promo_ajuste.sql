-- =====================================================
-- PEDIDO PROMOCIONAL - Ajuste a las tablas reales de PanMaestro
-- Correr DESPUÉS de pedido_promo.sql. Seguro de correr más de una vez.
-- =====================================================

-- 1) Enlazar con las tablas reales (clientes y productos_terminados)
alter table public.pedido_promo
  drop constraint if exists fk_pedido_promo_cliente;
alter table public.pedido_promo
  add constraint fk_pedido_promo_cliente
  foreign key (cliente_id) references public.clientes(id);

alter table public.pedido_promo_det
  drop constraint if exists fk_pedido_promo_det_producto;
alter table public.pedido_promo_det
  add constraint fk_pedido_promo_det_producto
  foreign key (producto_id) references public.productos_terminados(id);

-- 2) El costo de la receta NO está en la base: PanMaestro lo calcula en el
--    navegador (pmCostoReceta). Por eso se quita el trigger de costo; la
--    pantalla del pedido escribirá costo_unit_estandar al confirmar.
drop trigger if exists trg_pedido_promo_congelar_costo on public.pedido_promo;
drop function if exists public.fn_pedido_promo_congelar_costo();
drop function if exists public.costo_receta_unitario(uuid);

-- 3) Demanda mensual para el MPS: es del canal 'comercial' (el mismo canal
--    del estimado en mps_estimado), no un canal aparte.
drop view if exists public.mps_demanda_promocional;
create view public.mps_demanda_promocional as
select date_trunc('month', p.fecha_entrega)::date as mes,
       'comercial'::text as canal,
       d.producto_id,
       d.producto_nombre,
       sum(d.cantidad)      as cantidad_total,
       sum(d.regalia_cant)  as de_la_cual_regalia,
       count(distinct p.id) as pedidos
from public.pedido_promo p
join public.pedido_promo_det d on d.pedido_id = p.id
where p.estado in ('confirmado','producido','entregado','cobrado')
  and d.producto_id is not null
group by 1, d.producto_id, d.producto_nombre;

-- 4) Comprometido por día (formato fecha / pan / canal / unidades, como el
--    que ya usa el balance del MPS para los pedidos)
drop view if exists public.pedido_promo_comprometido_dia;
create view public.pedido_promo_comprometido_dia as
select p.fecha_entrega as fecha,
       d.producto_id,
       'comercial'::text as canal,
       sum(d.cantidad) as unidades
from public.pedido_promo p
join public.pedido_promo_det d on d.pedido_id = p.id
where p.estado in ('confirmado','producido','entregado','cobrado')
  and d.producto_id is not null
group by 1, 2;

-- 5) Seguridad: mismo patrón auth_only que el resto de las tablas
alter table public.pedido_promo      enable row level security;
alter table public.pedido_promo_det  enable row level security;
alter table public.config_pago       enable row level security;

drop policy if exists "auth_only" on public.pedido_promo;
create policy "auth_only" on public.pedido_promo
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth_only" on public.pedido_promo_det;
create policy "auth_only" on public.pedido_promo_det
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth_only" on public.config_pago;
create policy "auth_only" on public.config_pago
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 6) Vistas: que respeten la seguridad de las tablas (si no, Supabase las
--    marca UNRESTRICTED y se pueden leer con la clave pública)
alter view public.pedido_promo_totales            set (security_invoker = true);
alter view public.pedido_promo_cobro              set (security_invoker = true);
alter view public.mps_demanda_promocional         set (security_invoker = true);
alter view public.pedido_promo_comprometido_dia   set (security_invoker = true);

revoke all on public.pedido_promo_totales          from anon;
revoke all on public.pedido_promo_cobro            from anon;
revoke all on public.mps_demanda_promocional       from anon;
revoke all on public.pedido_promo_comprometido_dia from anon;

notify pgrst, 'reload schema';
