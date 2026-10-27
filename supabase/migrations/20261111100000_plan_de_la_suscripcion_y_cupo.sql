-- Cierre de fase · Bloque 1: plan guardado en la suscripción y cupo 25 / 75 GB.
--
-- 1. `subscriptions.plan` ('solo' | 'clinica', nullable): lo escribe el webhook
--    de Stripe desde el metadata de la suscripción (o el precio). Así el plan
--    ya no depende de que `storage_quota_plans.stripe_price_id` coincida con
--    un ID de precio que vive en una variable de Vercel: cambiar el precio de
--    US$29/US$69 a US$19,99/US$49,99 crea precios nuevos en Stripe y no rompe
--    el cupo de las suscripciones existentes.
-- 2. `plan_de_almacenamiento` y `cupo_de_almacenamiento_bytes` se redefinen:
--    primero `subscriptions.plan`; si es null, el precio de Stripe como hasta
--    ahora; sin suscripción o sin match, 'clinica' (el lado generoso). Partí de
--    las definiciones vigentes en producción (comparadas el 27-oct-2026).
-- 3. Cupo decidido por Walter (27-oct-2026): Solo 25 GB, Clínica 75 GB.
--
-- Escribe datos: UPDATE de las dos filas de `storage_quota_plans` y relleno
-- de `plan` donde el precio ya coincide (hoy ninguna fila). Redefine dos
-- funciones existentes. Reversa al pie.

begin;

alter table public.subscriptions add column if not exists plan text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'subscriptions_plan_check'
       and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_plan_check check (plan is null or plan in ('solo', 'clinica'));
  end if;
end $$;

comment on column public.subscriptions.plan is
  'Plan de Esmalia (solo | clinica) según Stripe; lo escribe el webhook. Null = suscripciones anteriores a esta columna: se deduce del precio.';

update public.subscriptions s
   set plan = q.plan
  from public.storage_quota_plans q
 where s.plan is null
   and q.stripe_price_id is not null
   and q.stripe_price_id = s.stripe_price_id;

create or replace function public.plan_de_almacenamiento(p_clinic_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.plan
        from public.subscriptions s
       where s.clinic_id = p_clinic_id
         and s.plan is not null
       limit 1
    ),
    (
      select q.plan
        from public.subscriptions s
        join public.storage_quota_plans q
          on q.stripe_price_id is not null and q.stripe_price_id = s.stripe_price_id
       where s.clinic_id = p_clinic_id
       limit 1
    ),
    'clinica'
  );
$$;

revoke all on function public.plan_de_almacenamiento(uuid) from public, anon, authenticated;
grant execute on function public.plan_de_almacenamiento(uuid) to service_role;

create or replace function public.cupo_de_almacenamiento_bytes(p_clinic_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select q.quota_bytes
        from public.storage_quota_plans q
       where q.plan = public.plan_de_almacenamiento(p_clinic_id)
    ),
    (select quota_bytes from public.storage_quota_plans where plan = 'clinica'),
    80530636800
  );
$$;

revoke all on function public.cupo_de_almacenamiento_bytes(uuid) from public, anon, authenticated;
grant execute on function public.cupo_de_almacenamiento_bytes(uuid) to service_role;

update public.storage_quota_plans set quota_bytes = 26843545600, updated_at = now() where plan = 'solo';     -- 25 GB
update public.storage_quota_plans set quota_bytes = 80530636800, updated_at = now() where plan = 'clinica';  -- 75 GB

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- update public.storage_quota_plans set quota_bytes = 5368709120 where plan = 'solo';
-- update public.storage_quota_plans set quota_bytes = 21474836480 where plan = 'clinica';
-- (volver a crear las dos funciones con la definición de 20261109100000)
-- alter table public.subscriptions drop column plan;  -- solo si no se usa
