-- Ola 13 · frente A (1/2): cupo de almacenamiento por clínica.
--
-- Cuánto pueden ocupar los archivos clínicos de una clínica (exámenes, fotos
-- y documentos). El valor sale de su plan y vive en una tabla, para cambiarlo
-- con un UPDATE sin desplegar código:
--
--   update public.storage_quota_plans set quota_bytes = <bytes> where plan = 'solo';
--
-- Propuesta del plan maestro (Ola 13), PENDIENTE DE DECISIÓN DE WALTER:
-- 5 GB plan Solo y 20 GB plan Clínica. `src/lib/examenes/cupo.ts` repite los
-- mismos valores como default de la pantalla y `tests/examenes-cupo.test.ts`
-- vigila que no se separen.
--
-- Cómo se sabe el plan de una clínica: el precio de Stripe de su suscripción
-- (`subscriptions.stripe_price_id`) contra `storage_quota_plans.stripe_price_id`.
-- Esos ids dependen de la cuenta de Stripe, así que se cargan a mano en
-- producción (mismo valor que STRIPE_PRICE_ID_SOLO_MONTHLY):
--
--   update public.storage_quota_plans set stripe_price_id = 'price_...' where plan = 'solo';
--
-- Sin precio cargado, sin suscripción (prueba, demo) o con un precio que no
-- está en la tabla, la clínica usa el cupo del plan 'clinica'. Es a propósito
-- el lado generoso: un cupo que bloquea de más le impide a una clínica subir
-- una radiografía; uno de más solo cuesta almacenamiento.
--
-- La tabla no tiene datos de pacientes ni de clínicas. Nadie de la app la lee
-- directo: el cupo y el uso salen por `uso_de_almacenamiento()` (migración
-- 20261109100100), SECURITY DEFINER.
-- sin-grant-authenticated: configuración del producto, la lee solo el servidor y las funciones SECURITY DEFINER.
--
-- Escribe datos: inserta las dos filas de configuración (idempotente).
-- No redefine funciones existentes. Reversa al pie.

begin;

create table if not exists public.storage_quota_plans (
  plan text primary key,
  quota_bytes bigint not null,
  stripe_price_id text,
  updated_at timestamptz not null default now(),
  constraint storage_quota_plans_plan_check check (plan in ('solo', 'clinica')),
  constraint storage_quota_plans_quota_check check (quota_bytes > 0),
  constraint storage_quota_plans_price_check check (
    stripe_price_id is null or char_length(stripe_price_id) between 3 and 200
  )
);

comment on table public.storage_quota_plans is
  'Ola 13: cupo de almacenamiento de archivos clínicos por plan (bytes). Propuesta 5 GB Solo / 20 GB Clínica, decisión final de Walter.';

insert into public.storage_quota_plans (plan, quota_bytes)
values
  ('solo', 5368709120),     -- 5 GB
  ('clinica', 21474836480)  -- 20 GB
on conflict (plan) do nothing;

revoke all on public.storage_quota_plans from anon, authenticated;
grant all on public.storage_quota_plans to service_role;
alter table public.storage_quota_plans enable row level security;
-- Sin políticas: solo service_role y las funciones SECURITY DEFINER.

-- Cupo en bytes de una clínica. La usan el trigger de exámenes y
-- `uso_de_almacenamiento`; no se expone a la API.
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
        from public.subscriptions s
        join public.storage_quota_plans q
          on q.stripe_price_id is not null and q.stripe_price_id = s.stripe_price_id
       where s.clinic_id = p_clinic_id
       limit 1
    ),
    (select quota_bytes from public.storage_quota_plans where plan = 'clinica'),
    21474836480
  );
$$;

revoke all on function public.cupo_de_almacenamiento_bytes(uuid) from public, anon, authenticated;
grant execute on function public.cupo_de_almacenamiento_bytes(uuid) to service_role;

-- Plan de almacenamiento que aplica ('solo' o 'clinica'), con la misma regla.
create or replace function public.plan_de_almacenamiento(p_clinic_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
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

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- (antes revertir 20261109100100, que usa estas funciones)
-- drop function if exists public.plan_de_almacenamiento(uuid);
-- drop function if exists public.cupo_de_almacenamiento_bytes(uuid);
-- drop table if exists public.storage_quota_plans;
