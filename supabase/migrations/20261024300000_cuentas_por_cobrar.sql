-- Ola 3 · Frente Cobros (1/3): cuentas por cobrar, cuotas y cobro con varios
-- medios (FIN-02, FIN-03, FIN-04).
--
-- Hasta acá la deuda de un paciente era un solo número calculado (facturado −
-- pagado, `patient_balances`). Eso alcanza para el encabezado de la ficha,
-- pero no para responder "¿qué le vence este mes?", "¿esta deuda está en
-- cuotas?" ni "¿cuánto de lo vencido es de más de 90 días?". Esta migración
-- agrega la cuenta por cobrar como objeto propio, sin cambiar cómo se calcula
-- el saldo del paciente:
--
--   - `receivables`: una deuda con monto, fecha de emisión y vencimiento
--     opcional. Nace de un presupuesto aceptado (migración 3/3) o de un plan de
--     tratamiento existente (desde la ficha). Su monto es la parte del
--     paciente de ese presupuesto o plan, así que siempre es un subconjunto de
--     lo "facturado" que ya suma `patient_balances`: el saldo del paciente no
--     cambia ni se duplica.
--   - `receivable_installments`: la cuenta dividida en N cuotas con fecha.
--     Las cuotas suman exactamente el monto de la cuenta (constraint trigger
--     diferido). La imputación de pagos a cuotas NO se guarda: se calcula
--     (lo pagado de la cuenta cubre primero la cuota más antigua), así que un
--     pago reversado libera su cuota sin ninguna reescritura.
--   - `payments.receivable_id`: a qué cuenta se imputa un pago (opcional,
--     placeholder nullable, regla 11). Un pago sin cuenta pero con el plan de
--     la cuenta también le cuenta (ver `receivable_paid_totals`).
--   - `payments.payment_group_id`: un mismo cobro repartido en varios medios
--     (efectivo + tarjeta + transferencia) se guarda como una fila por medio,
--     todas con el mismo `payment_group_id`. Cada fila conserva su `method`,
--     su snapshot y su neto, así que la caja, el arqueo y los reportes lo ven
--     por medio sin cambiar una línea. `amount_cents` sigue significando lo
--     mismo: lo cobrado en ESA fila.
--
-- Estados (FIN-02): solo "anulada" se guarda (`voided_at`). Pendiente,
-- parcial, pagada y vencida se calculan con lo pagado y las fechas
-- (`src/lib/finance/cuentas-por-cobrar.ts`): guardarlos obligaría a
-- recalcularlos con cada pago, reversa y cambio de día.
--
-- Permisos: mismo público que `payments` (regla 2: assistant no ve ni toca
-- dinero). Leer: owner, admin, dentist, reception, accounting. Escribir: los
-- mismos (accounting incluido: arma las cuotas y anula cuentas). Sin DELETE:
-- una cuenta se anula, no se borra. Política RESTRICTIVE `mfa_exige_aal2` en
-- las dos tablas (src/lib/auth/mfa-rls.ts).
--
-- Compatible con el código en producción (RUNBOOK regla 3): solo tablas,
-- columnas nullable, funciones y triggers nuevos. El trigger de `payments`
-- solo actúa cuando `receivable_id` viene informado, cosa que el código
-- actual nunca hace.

begin;

-- ─── 1. Cuentas por cobrar ──────────────────────────────────────────────────

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- RESTRICT como el resto de las FKs clínicas: los pacientes se archivan.
  patient_id uuid not null references public.patients(id) on delete restrict,
  -- Origen. Un presupuesto genera como mucho una cuenta (índice único abajo):
  -- es lo que hace idempotente la creación automática (PLA-07).
  quote_id uuid references public.quotes(id) on delete set null,
  treatment_plan_id uuid references public.treatment_plans(id) on delete set null,
  description text not null
    check (char_length(btrim(description)) between 1 and 200),
  amount_cents bigint not null check (amount_cents > 0),
  -- La fija `moneda_desde_la_clinica` (regla 14): sin default a propósito.
  currency text not null,
  -- Día contable de emisión (fecha de la clínica, no instante).
  issued_on date not null,
  -- Vencimiento de la cuenta cuando no está en cuotas. NULL = sin vencimiento,
  -- no "vence hoy" (regla 11).
  due_on date,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Para la FK compuesta de cuotas y pagos: la cuota y el pago tienen que ser
  -- de la misma clínica que la cuenta.
  unique (id, clinic_id),
  constraint receivables_anulacion_consistente check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and void_reason is not null)
  )
);

comment on table public.receivables is
  'Cuenta por cobrar (FIN-02). Estado calculado salvo anulada (voided_at). Monto = parte del paciente de un presupuesto o plan: subconjunto de lo facturado en patient_balances.';
comment on column public.receivables.due_on is
  'Vencimiento si la cuenta no está en cuotas. NULL = sin vencimiento.';

create unique index receivables_quote_unica
  on public.receivables (quote_id) where quote_id is not null;
-- Un plan tiene a lo sumo una cuenta vigente: así un pago imputado solo al
-- plan (sin cuenta) se le atribuye sin ambigüedad.
create unique index receivables_plan_vigente_unica
  on public.receivables (treatment_plan_id)
  where treatment_plan_id is not null and voided_at is null;
create index receivables_clinic_patient_idx on public.receivables (clinic_id, patient_id);
create index receivables_clinic_issued_idx on public.receivables (clinic_id, issued_on desc, id);

create trigger receivables_updated_at before update on public.receivables
  for each row execute function public.set_updated_at();

create trigger moneda_desde_la_clinica
  before insert on public.receivables
  for each row execute function public.aplicar_moneda_de_la_clinica();

-- La demo pública es de solo lectura, como `payments` y `quotes`.
create trigger block_demo_writes
  before insert or update or delete on public.receivables
  for each row execute function public.block_demo_writes();

-- Lo que define la deuda no se edita: si estaba mal, se anula y se crea otra.
-- `patient_id` sí puede cambiar (fusión de fichas, merge_patients).
create or replace function public.receivables_campos_inmutables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clinic_id is distinct from old.clinic_id
     or new.amount_cents is distinct from old.amount_cents
     or new.quote_id is distinct from old.quote_id
     or new.currency is distinct from old.currency then
    raise exception 'El monto y el origen de una cuenta por cobrar no se editan: anúlala y crea otra.'
      using errcode = '23514';
  end if;
  if old.voided_at is not null and new.voided_at is null then
    raise exception 'Una cuenta anulada no se puede reactivar.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.receivables_campos_inmutables() from public, anon;

create trigger receivables_campos_inmutables
  before update on public.receivables
  for each row execute function public.receivables_campos_inmutables();

grant select, insert, update on public.receivables to authenticated;
-- Los privilegios por defecto de Supabase dan DELETE a todos: una cuenta se
-- anula, no se borra, así que se quita también a nivel de permiso.
revoke delete, truncate on public.receivables from anon, authenticated;
grant all on public.receivables to service_role;
alter table public.receivables enable row level security;

create policy receivables_select_finance_roles on public.receivables
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy receivables_insert_finance_roles on public.receivables
  for insert to authenticated
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy receivables_update_finance_roles on public.receivables
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.receivables;
create policy mfa_exige_aal2 on public.receivables
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 2. Cuotas ──────────────────────────────────────────────────────────────

create table public.receivable_installments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  receivable_id uuid not null,
  number smallint not null check (number between 1 and 120),
  due_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (receivable_id, number),
  foreign key (receivable_id, clinic_id)
    references public.receivables (id, clinic_id) on delete cascade
);

comment on table public.receivable_installments is
  'Cuotas de una cuenta por cobrar (FIN-03). Suman exactamente el monto de la cuenta. Lo pagado se imputa a la cuota más antigua al calcular, no se guarda.';

create index receivable_installments_clinic_due_idx
  on public.receivable_installments (clinic_id, due_on);

create trigger block_demo_writes
  before insert or update or delete on public.receivable_installments
  for each row execute function public.block_demo_writes();

-- Las cuotas suman el monto de la cuenta. Diferido al COMMIT para que
-- reemplazar todas las cuotas (borrar + insertar) en una transacción no falle
-- a mitad de camino. Una cuenta sin cuotas es válida (se cobra entera).
create or replace function public.cuotas_suman_el_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.receivable_id, old.receivable_id);
  v_monto bigint;
  v_suma bigint;
  v_cantidad integer;
begin
  select r.amount_cents into v_monto from public.receivables r where r.id = v_id;
  if not found then
    return null; -- la cuenta se borró en la misma transacción (cascade)
  end if;
  select coalesce(sum(i.amount_cents), 0), count(*)
    into v_suma, v_cantidad
    from public.receivable_installments i
   where i.receivable_id = v_id;
  if v_cantidad > 0 and v_suma <> v_monto then
    raise exception 'Las cuotas suman % y la cuenta por cobrar es de %.', v_suma, v_monto
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function public.cuotas_suman_el_total() from public, anon;

create constraint trigger receivable_installments_suman_el_total
  after insert or update or delete on public.receivable_installments
  deferrable initially deferred
  for each row execute function public.cuotas_suman_el_total();

grant select, insert, update, delete on public.receivable_installments to authenticated;
grant all on public.receivable_installments to service_role;
alter table public.receivable_installments enable row level security;

create policy receivable_installments_select_finance_roles on public.receivable_installments
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy receivable_installments_insert_finance_roles on public.receivable_installments
  for insert to authenticated
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy receivable_installments_update_finance_roles on public.receivable_installments
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy receivable_installments_delete_finance_roles on public.receivable_installments
  for delete to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.receivable_installments;
create policy mfa_exige_aal2 on public.receivable_installments
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- Reemplaza las cuotas de una cuenta en una sola llamada (borrar + insertar
-- es atómico dentro de la función). SECURITY INVOKER: la RLS de las dos
-- tablas decide quién puede. `p_cuotas` = [{"due_on": "2026-11-05",
-- "amount_cents": 50000}, ...] en el orden en que se numeran; [] las quita.
create or replace function public.definir_cuotas(p_receivable_id uuid, p_cuotas jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cuenta record;
  v_suma bigint;
begin
  if jsonb_typeof(p_cuotas) is distinct from 'array' then
    raise exception 'Las cuotas tienen que venir como una lista.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_cuotas) > 120 then
    raise exception 'Una cuenta admite hasta 120 cuotas.' using errcode = '22023';
  end if;

  select r.id, r.clinic_id, r.amount_cents, r.voided_at
    into v_cuenta
    from public.receivables r
   where r.id = p_receivable_id
   for update;
  if v_cuenta.id is null then
    raise exception 'No encontramos esa cuenta por cobrar.' using errcode = 'P0002';
  end if;
  if v_cuenta.voided_at is not null then
    raise exception 'La cuenta está anulada: no se le pueden definir cuotas.' using errcode = '23514';
  end if;

  delete from public.receivable_installments where receivable_id = p_receivable_id;

  if jsonb_array_length(p_cuotas) = 0 then
    return;
  end if;

  insert into public.receivable_installments (clinic_id, receivable_id, number, due_on, amount_cents)
  select v_cuenta.clinic_id, p_receivable_id, c.n::smallint,
         (c.cuota ->> 'due_on')::date, (c.cuota ->> 'amount_cents')::bigint
    from jsonb_array_elements(p_cuotas) with ordinality as c(cuota, n);

  select sum(i.amount_cents) into v_suma
    from public.receivable_installments i
   where i.receivable_id = p_receivable_id;
  -- El constraint trigger lo frena igual al COMMIT; acá con un mensaje antes.
  if v_suma <> v_cuenta.amount_cents then
    raise exception 'Las cuotas suman % y la cuenta por cobrar es de %.', v_suma, v_cuenta.amount_cents
      using errcode = '23514';
  end if;
end;
$$;

comment on function public.definir_cuotas(uuid, jsonb) is
  'FIN-03: reemplaza las cuotas de una cuenta por cobrar. SECURITY INVOKER (respeta la RLS).';

revoke all on function public.definir_cuotas(uuid, jsonb) from public, anon;
grant execute on function public.definir_cuotas(uuid, jsonb) to authenticated, service_role;

-- ─── 3. Pagos: imputación a una cuenta y cobro con varios medios ───────────

alter table public.payments
  add column receivable_id uuid,
  add column payment_group_id uuid;

-- FK compuesta: la cuenta es de la misma clínica que el pago. Si la cuenta se
-- borrara (solo service_role puede), el pago queda sin imputar, no se borra.
alter table public.payments
  add constraint payments_receivable_fk
  foreign key (receivable_id, clinic_id)
  references public.receivables (id, clinic_id)
  on delete set null (receivable_id);

comment on column public.payments.receivable_id is
  'Cuenta por cobrar a la que se imputa el pago. NULL = pago a cuenta o solo al plan.';
comment on column public.payments.payment_group_id is
  'Mismo cobro repartido en varios medios: una fila por medio con el mismo id de grupo. NULL = cobro de un solo medio.';

create index payments_receivable_idx on public.payments (receivable_id)
  where receivable_id is not null;
create index payments_group_idx on public.payments (payment_group_id)
  where payment_group_id is not null;

-- La cuenta tiene que ser del mismo paciente y no estar anulada. Solo actúa
-- cuando se informa o cambia `receivable_id`: la fusión de fichas mueve
-- `patient_id` de los pagos sin tocar esta columna y no pasa por acá.
create or replace function public.validar_cuenta_del_pago()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cuenta record;
begin
  if new.receivable_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.receivable_id is not distinct from old.receivable_id then
    return new;
  end if;
  select r.patient_id, r.voided_at into v_cuenta
    from public.receivables r
   where r.id = new.receivable_id and r.clinic_id = new.clinic_id;
  if not found then
    raise exception 'La cuenta por cobrar no existe en esta clínica.' using errcode = '23503';
  end if;
  if v_cuenta.patient_id <> new.patient_id then
    raise exception 'La cuenta por cobrar es de otro paciente.' using errcode = '23514';
  end if;
  if v_cuenta.voided_at is not null then
    raise exception 'La cuenta por cobrar está anulada.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.validar_cuenta_del_pago() from public, anon;

create trigger payments_validar_cuenta
  before insert or update of receivable_id on public.payments
  for each row execute function public.validar_cuenta_del_pago();

-- ─── 4. Lo pagado por cuenta, en SQL ────────────────────────────────────────
-- Mismo motivo que `patient_balances` (20261020140000): agregar en JS corta en
-- silencio en `max_rows`. SECURITY INVOKER: respeta la RLS de receivables y
-- payments (y la de MFA).
--
-- Un pago cuenta para una cuenta si está imputado a ella, o si no está
-- imputado a ninguna y es del plan de la cuenta (los pagos "al plan" de
-- siempre, incluidos los anteriores a esta migración). Los reversados no
-- cuentan, igual que en el saldo del paciente.
create or replace function public.receivable_paid_totals(
  p_clinic_id uuid,
  p_receivable_ids uuid[] default null
)
returns table (receivable_id uuid, paid_cents bigint, last_paid_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id as receivable_id,
         sum(pa.amount_cents)::bigint as paid_cents,
         max(pa.paid_at) as last_paid_at
    from public.receivables r
    join public.payments pa
      on pa.clinic_id = r.clinic_id
     and pa.reversed_at is null
     and (
       pa.receivable_id = r.id
       or (pa.receivable_id is null
           and r.treatment_plan_id is not null
           and pa.treatment_plan_id = r.treatment_plan_id)
     )
   where r.clinic_id = p_clinic_id
     and (p_receivable_ids is null or r.id = any (p_receivable_ids))
   group by r.id;
$$;

comment on function public.receivable_paid_totals(uuid, uuid[]) is
  'Pagado por cuenta por cobrar (imputado a la cuenta, o al plan de la cuenta sin cuenta). Sin pagos = sin fila. SECURITY INVOKER.';

revoke all on function public.receivable_paid_totals(uuid, uuid[]) from public, anon;
grant execute on function public.receivable_paid_totals(uuid, uuid[]) to authenticated, service_role;

-- ─── 5. Fusión de fichas: las cuentas viajan con los pagos ──────────────────
-- Copia de la definición vigente (20261019230000_rls_exige_aal2.sql, con el
-- guard de MFA) más la línea de `receivables`. Sin ella, los pagos de la
-- ficha absorbida pasarían a la destino y sus cuentas no.
CREATE OR REPLACE FUNCTION public.merge_patients(
  p_clinic_id uuid,
  p_source_id uuid,
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source record;
  v_target record;
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'No se puede fusionar una ficha consigo misma.';
  END IF;

  IF NOT public.has_clinic_role(
    p_clinic_id, ARRAY['owner','admin']::public.app_role[]
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para fusionar fichas.';
  END IF;

  SELECT id, merged_into INTO v_source
    FROM public.patients WHERE id = p_source_id AND clinic_id = p_clinic_id
    FOR UPDATE;
  SELECT id, merged_into, archived_at INTO v_target
    FROM public.patients WHERE id = p_target_id AND clinic_id = p_clinic_id
    FOR UPDATE;
  IF v_source.id IS NULL OR v_target.id IS NULL THEN
    RAISE EXCEPTION 'Alguna de las dos fichas no pertenece a esta clínica.';
  END IF;
  IF v_source.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'Esa ficha ya fue fusionada en otra.';
  END IF;
  IF v_target.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'La ficha destino ya fue fusionada en otra: elige la ficha que quedó.';
  END IF;
  IF v_target.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'La ficha destino está archivada: restáurala antes de fusionar.';
  END IF;

  UPDATE public.appointments        SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.payments            SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.receivables         SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.quotes              SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.treatment_plans     SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.odontogram_marks    SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.periodontal_charts  SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  -- patient_documents y patient_consents NO se mueven: sus triggers de
  -- inmutabilidad (con razón) rechazan cambiar el patient_id y hacían fallar
  -- la fusión. Igual que las notas, la ficha destino los lee desde las
  -- fichas fusionadas en ella.
  UPDATE public.messages            SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.lab_orders          SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  -- Signos vitales (20261019180000): mediciones sin trigger de inmutabilidad,
  -- se mueven con la atención. Recetas (20261019190000) y tutores no se
  -- mueven: sus triggers lo impiden a propósito; las recetas se leen desde la
  -- ficha destino y los tutores quedan en la ficha absorbida.
  IF to_regclass('public.patient_vital_signs') IS NOT NULL THEN
    EXECUTE 'UPDATE public.patient_vital_signs SET patient_id = $1 WHERE patient_id = $2 AND clinic_id = $3'
      USING p_target_id, p_source_id, p_clinic_id;
  END IF;

  UPDATE public.patients
     SET merged_into = p_target_id,
         merged_at = now(),
         status = 'inactive'
   WHERE id = p_source_id AND clinic_id = p_clinic_id;
END;
$$;

revoke execute on function public.merge_patients(uuid, uuid, uuid) from public, anon;

commit;

-- Cómo revertir (en este orden; no hay datos que migrar de vuelta: los pagos
-- conservan monto, medio y plan, solo pierden la imputación a la cuenta y el
-- agrupador del cobro con varios medios):
--
-- begin;
-- (merge_patients: volver a aplicar su definición de 20261019230000_rls_exige_aal2.sql)
-- drop function if exists public.receivable_paid_totals(uuid, uuid[]);
-- drop trigger if exists payments_validar_cuenta on public.payments;
-- drop function if exists public.validar_cuenta_del_pago();
-- alter table public.payments drop constraint if exists payments_receivable_fk;
-- alter table public.payments drop column if exists payment_group_id, drop column if exists receivable_id;
-- drop function if exists public.definir_cuotas(uuid, jsonb);
-- drop policy if exists mfa_exige_aal2 on public.receivable_installments;
-- drop table if exists public.receivable_installments;
-- drop function if exists public.cuotas_suman_el_total();
-- drop policy if exists mfa_exige_aal2 on public.receivables;
-- drop table if exists public.receivables;
-- drop function if exists public.receivables_campos_inmutables();
-- commit;
