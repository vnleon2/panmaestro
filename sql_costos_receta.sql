-- % de mano de obra y gastos generales por receta (costeo).
-- NULL = usar el valor por defecto de la app (MOD 80%, GG 45%).
alter table recetas add column if not exists mod_pct numeric;
alter table recetas add column if not exists gg_pct  numeric;
notify pgrst, 'reload schema';
