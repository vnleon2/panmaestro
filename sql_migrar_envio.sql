-- ════════════════════════════════════════════════════════════════
-- Migrar el "tipo de pan Envío" al campo Envío del pedido (11 nov 2026)
--
-- Requisito: ya corriste sql_pedido_envio.sql (columnas envio_monto / envio_nota).
--
-- QUÉ HACE: por cada línea de pedido que usa el producto "Envío":
--   1) suma su valor (cantidad × precio × (1 − descuento)) a pedidos.envio_monto
--   2) borra la línea
--   3) deja pedidos.total EXACTAMENTE igual que antes (si algún total cambiara,
--      todo se revierte solo y no se guarda nada)
-- Las líneas borradas quedan respaldadas en pedido_lineas_envio_bk.
-- Los pedidos pagados / ventas no se tocan en monto: solo cambia dónde se guarda el envío.
--
-- ORDEN: corre primero el PASO A (solo lee). Si lo que muestra es lo esperado,
-- corre el PASO B. Después elimina el producto "Envío" en Maestros → Tipos de pan.
-- ════════════════════════════════════════════════════════════════

-- ═══ PASO A — SOLO LEE (no cambia nada) ═══════════════════════════
-- A1. Productos candidatos (debe salir solo "Envío"; si sale otro, avísame)
select id, codigo, nombre, tipo, activo
from productos_terminados
where translate(lower(nombre), 'íÍ', 'ii') like '%envio%';

-- A2. Cuántas líneas y pedidos se verían afectados, y cuánto suman
select count(*) as lineas,
       count(distinct l.pedido_id) as pedidos,
       sum(l.cantidad * l.precio_applied * (1 - coalesce(l.descuento_pct,0)/100.0)) as monto_total
from pedido_lineas l
join productos_terminados p on p.id = l.producto_id
where translate(lower(p.nombre), 'íÍ', 'ii') = 'envio';

-- ═══ PASO B — MIGRACIÓN (solo después del paso A) ════════════════
-- Un solo bloque: o se aplica todo o no se aplica nada. Seguro de repetir:
-- solo mueve las líneas Envío que todavía existan.
do $$
declare
  antes jsonb;
  cambiados int;
begin
  -- respaldo de las líneas que se van a borrar
  create table if not exists pedido_lineas_envio_bk as
    select l.*, now() as respaldado_en from pedido_lineas l where false;
  alter table pedido_lineas_envio_bk enable row level security;
  drop policy if exists "auth_only" on pedido_lineas_envio_bk;
  create policy "auth_only" on pedido_lineas_envio_bk
    for all to authenticated using (true) with check (true);

  insert into pedido_lineas_envio_bk
    select l.*, now() from pedido_lineas l
    where l.producto_id in (select id from productos_terminados where translate(lower(nombre), 'íÍ', 'ii') = 'envio')
      and not exists (select 1 from pedido_lineas_envio_bk b where b.id = l.id);

  -- totales de los pedidos afectados ANTES del cambio
  select jsonb_object_agg(pe.id::text, pe.total::text) into antes
  from pedidos pe
  where pe.id in (select pedido_id from pedido_lineas
                  where producto_id in (select id from productos_terminados where translate(lower(nombre), 'íÍ', 'ii') = 'envio'));

  -- pasar el valor de las líneas Envío al campo envio_monto del pedido
  update pedidos pe
  set envio_monto = coalesce(pe.envio_monto, 0) + x.monto,
      updated_at = now()
  from (
    select pedido_id,
           round(sum(cantidad * precio_applied * (1 - coalesce(descuento_pct,0)/100.0))) as monto
    from pedido_lineas
    where producto_id in (select id from productos_terminados where translate(lower(nombre), 'íÍ', 'ii') = 'envio')
    group by pedido_id
  ) x
  where pe.id = x.pedido_id;

  -- borrar las líneas Envío
  delete from pedido_lineas
  where producto_id in (select id from productos_terminados where translate(lower(nombre), 'íÍ', 'ii') = 'envio');

  -- verificación: el total no puede haber cambiado en ningún pedido
  select count(*) into cambiados
  from pedidos pe
  where antes ? pe.id::text and pe.total::text is distinct from antes->>(pe.id::text);
  if cambiados > 0 then
    raise exception 'Se cambiaría el total de % pedido(s); se revierte todo', cambiados;
  end if;
end $$;

-- ═══ PASO C — comprobación final (solo lee) ═══════════════════════
-- Debe dar 0 líneas; y los pedidos migrados ahora muestran su envío:
select count(*) as lineas_envio_que_quedan
from pedido_lineas l join productos_terminados p on p.id = l.producto_id
where translate(lower(p.nombre), 'íÍ', 'ii') = 'envio';

select pe.id, pe.fecha, pe.total, pe.envio_monto
from pedidos pe
where pe.id in (select pedido_id from pedido_lineas_envio_bk)
order by pe.fecha;
