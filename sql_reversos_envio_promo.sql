-- ════════════════════════════════════════════════════════════════
-- Reverso de ventas + envío en pedido promocional (18 nov 2026)
--
-- 1) pedido_promo.envio_monto / envio_nota
--      El pedido promocional también cobra envío (campo propio, como en
--      los pedidos comerciales). El IVA futuro se calcula sobre el total
--      incluido el envío.
--
-- 2) ventas: columnas para registrar REVERSOS como movimientos negativos
--      es_reverso       true en la fila negativa que reversa una venta
--      venta_origen_id  id de la venta que se reversa (texto, sin FK)
--      motivo           por qué se reversa
--      detalle          jsonb con lo reversado: [{k, nombre, cant, monto}]
--
-- 3) Si la tabla ventas tuviera una restricción CHECK sobre `total`
--    (p. ej. total >= 0), se elimina para permitir los reversos.
--
-- Seguro de correr más de una vez.
-- ════════════════════════════════════════════════════════════════

alter table public.pedido_promo add column if not exists envio_monto numeric not null default 0;
alter table public.pedido_promo add column if not exists envio_nota  text;

alter table public.ventas add column if not exists es_reverso      boolean not null default false;
alter table public.ventas add column if not exists venta_origen_id text;
alter table public.ventas add column if not exists motivo          text;
alter table public.ventas add column if not exists detalle         jsonb;

create index if not exists ventas_origen_idx on public.ventas (venta_origen_id);

do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.ventas'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%total%'
  loop
    execute format('alter table public.ventas drop constraint %I', c.conname);
  end loop;
end $$;

comment on column public.pedido_promo.envio_monto is 'Cargo de envío del pedido promocional (colones). Se suma al total a cobrar.';
comment on column public.ventas.es_reverso is 'true = fila negativa que reversa (total o parcialmente) otra venta.';

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════
-- Limpieza (18 nov 2026): venta del pedido promocional duplicada
-- ════════════════════════════════════════════════════════════════
-- 1) Borra los duplicados de una misma venta PRM-<id> (deja la más antigua)
delete from public.ventas v
 using public.ventas w
 where v.notas like 'PRM-%'
   and v.notas = w.notas
   and (v.created_at, v.id::text) > (w.created_at, w.id::text);

-- 2) Una sola venta por pedido promocional, para siempre
create unique index if not exists ventas_prm_unica
  on public.ventas (notas) where notas like 'PRM-%';

-- 3) Rellena el nombre del cliente en las ventas PRM que quedaron sin nombre
update public.ventas v
   set cliente_nom = c.nombre
  from public.pedido_promo p
  join public.clientes c on c.id = p.cliente_id
 where v.notas = 'PRM-' || p.id::text
   and coalesce(v.cliente_nom, '') = '';
