-- ════════════════════════════════════════════════════════════════
-- Migrar el producto "Entrega Dimarkit Moto" (P041) al campo Envío del pedido
-- (11 nov 2026). Requisito: haber corrido sql_pedido_envio.sql.
--
-- Nota: precio_applied ya trae el descuento; el total del pedido es cantidad × precio_applied.
-- Un solo bloque atómico: o se aplica todo o nada.
--  1) Se detiene si algún pedido afectado ya tiene envío cargado.
--  2) Respalda las líneas en pedido_lineas_envio_bk.
--  3) Pasa el valor de cada línea a pedidos.envio_monto (nota: Entrega Dimarkit Moto).
--  4) Borra las líneas.
--  5) Verifica que productos + envío = total en cada pedido; si no, revierte.
-- Después: eliminar el tipo de pan P041 desde Maestros → Tipos de pan.
-- ════════════════════════════════════════════════════════════════
do $$
declare
  pid constant text := 'a99144d8-08a3-4bf2-8040-77735ffe2019';  -- P041 Entrega Dimarkit Moto
  ya_tienen int;
  descuadre int;
begin
  select count(*) into ya_tienen
  from pedidos where id in (select pedido_id from pedido_lineas where producto_id::text = pid)
    and coalesce(envio_monto, 0) > 0;
  if ya_tienen > 0 then
    raise exception 'Hay % pedido(s) que ya tienen envío cargado; no se cambia nada', ya_tienen;
  end if;

  create table if not exists pedido_lineas_envio_bk as
    select l.*, now() as respaldado_en from pedido_lineas l where false;
  alter table pedido_lineas_envio_bk enable row level security;
  drop policy if exists "auth_only" on pedido_lineas_envio_bk;
  create policy "auth_only" on pedido_lineas_envio_bk
    for all to authenticated using (true) with check (true);
  insert into pedido_lineas_envio_bk
    select l.*, now() from pedido_lineas l
    where l.producto_id::text = pid
      and not exists (select 1 from pedido_lineas_envio_bk b where b.id = l.id);

  update pedidos pe
  set envio_monto = x.monto,
      envio_nota  = coalesce(pe.envio_nota, 'Entrega Dimarkit Moto'),
      updated_at  = now()
  from (
    select pedido_id,
           round(sum(cantidad * precio_applied)) as monto
    from pedido_lineas where producto_id::text = pid
    group by pedido_id
  ) x
  where pe.id = x.pedido_id;

  delete from pedido_lineas where producto_id::text = pid;

  select count(*) into descuadre
  from pedidos pe
  where pe.id in (select pedido_id from pedido_lineas_envio_bk where producto_id::text = pid)
    and abs(pe.total - (
          (select coalesce(round(sum(l.cantidad * l.precio_applied)), 0)
           from pedido_lineas l where l.pedido_id = pe.id) + pe.envio_monto)) > 1;
  if descuadre > 0 then
    raise exception 'El total de % pedido(s) no cuadra; se revierte todo', descuadre;
  end if;
end $$;

-- comprobación: diferencia debe ser 0 en cada fila
select pe.id, pe.fecha, pe.status, pe.total, pe.envio_monto, pe.envio_nota,
       pe.total - (round(coalesce(sum(l.cantidad * l.precio_applied), 0)) + pe.envio_monto) as diferencia
from pedidos pe
left join pedido_lineas l on l.pedido_id = pe.id
where pe.id in (select pedido_id from pedido_lineas_envio_bk where producto_id::text = 'a99144d8-08a3-4bf2-8040-77735ffe2019')
group by pe.id, pe.fecha, pe.status, pe.total, pe.envio_monto, pe.envio_nota
order by pe.fecha;
