-- ════════════════════════════════════════════════════════════════
-- Reversos de ventas con pedido (23 nov 2026)
--
-- Problema: la tabla ventas tiene UNIQUE(pedido_id) — una venta por pedido.
-- El reverso copiaba el pedido_id de la venta original, así que chocaba con
-- esa restricción y el guardado fallaba con "duplicado". Ahora el reverso se
-- guarda SIN pedido_id (el vínculo con la venta original es venta_origen_id).
--
-- Efecto colateral que este SQL corrige: el trigger fill_venta_cliente
-- (BEFORE INSERT en ventas) hace SELECT ... INTO NEW.cliente_nom FROM pedidos
-- WHERE id = NEW.pedido_id; sin pedido_id esa consulta no encuentra fila y
-- deja cliente_nom en NULL, borrando el nombre que se había enviado.
-- Ahora solo busca el nombre cuando hay pedido_id (mismo comportamiento de
-- siempre para las ventas de pedidos; las promocionales y los reversos
-- conservan el nombre que traen).
--
-- Seguro de correr más de una vez.
-- ════════════════════════════════════════════════════════════════

create or replace function public.fill_venta_cliente()
returns trigger
language plpgsql
as $function$
begin
  if NEW.pedido_id is not null then
    select cliente_nom into NEW.cliente_nom
      from pedidos
     where id = NEW.pedido_id;
  end if;
  return NEW;
end;
$function$;

notify pgrst, 'reload schema';
