-- Cierre · Bloque 5 · ítem 1: la cuota de membresía cobrada pasa por `payments`
-- (y por lo tanto por la caja, el arqueo y los reportes de caja).
--
-- Hasta ahora cobrar una cuota solo marcaba `membership_charges.status = 'paid'`:
-- un cobro en efectivo no aparecía en el arqueo. Desde esta migración, cobrar
-- una cuota es UNA operación atómica (`cobrar_cuota_de_membresia`) que:
--   1. bloquea la cuota,
--   2. inserta el pago real en `payments` (con su medio, su caja y su hora),
--   3. marca la cuota como cobrada.
--
-- Idempotencia: un segundo cobro de la misma cuota no crea otro pago (la
-- función devuelve el pago que ya existía con `ya_cobrada = true`) y un índice
-- único parcial lo garantiza aunque dos personas cobren a la vez.
--
-- Qué NO cambia: un pago de cuota no resta del saldo de tratamientos del
-- paciente (la cuota no es un tratamiento), no es base de comisión (no tiene
-- prestación ni plan) y no se suma dos veces en la vista general de finanzas
-- (que ya muestra "cuotas de membresía" aparte). Por eso se redefinen cuatro
-- funciones de lectura agregando una sola condición:
-- `membership_charge_id is null`. Cada una parte de su definición vigente en
-- producción (leída con `pg_get_functiondef` el 27-oct-2026).
--
-- Reversa: reversar el pago anula la cuota y anular una cuota cobrada reversa
-- su pago (dos triggers, sin recursión). Así la caja y la cuota nunca quedan
-- contando distinto.
--
-- Datos: no escribe ni migra ninguno. En producción hay una sola cuota cobrada
-- y es de la clínica demo (que se resetea a diario); las cuotas cobradas antes
-- de esta migración quedan sin pago, como estaban.
--
-- Sin tablas nuevas: no hay RLS ni GRANT que agregar (el pago nuevo va en
-- `payments`, que ya los tiene).
--
-- Compatible con el código en producción: columna nullable nueva, función
-- nueva y condiciones extra en lecturas que hoy no ven pagos de cuota.

begin;

-- ─── 1. El pago sabe de qué cuota viene ────────────────────────────────────

alter table public.payments
  add column if not exists membership_charge_id uuid references public.membership_charges(id);

comment on column public.payments.membership_charge_id is
  'Cuota de membresía que este pago cobra (cierre, ítem 1). NULL = pago de tratamientos. Un pago de cuota no resta del saldo de tratamientos del paciente.';

create index if not exists payments_membership_charge_idx
  on public.payments (membership_charge_id)
  where membership_charge_id is not null;

-- Un solo pago vigente por cuota: la red de seguridad de la idempotencia.
create unique index if not exists payments_una_vigente_por_cuota
  on public.payments (membership_charge_id)
  where membership_charge_id is not null and reversed_at is null;

-- El pago de una cuota es de la misma clínica y del mismo paciente que la
-- cuota y por el mismo monto; después, ni la cuota ni el monto cambian
-- (el paciente sí puede cambiar: lo mueve la fusión de fichas).
create or replace function public.validar_pago_de_cuota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cuota record;
begin
  if new.membership_charge_id is null then
    if tg_op = 'UPDATE' and old.membership_charge_id is not null then
      raise exception 'Un pago de cuota de membresía no se desvincula de su cuota: reversa el pago.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.membership_charge_id is distinct from old.membership_charge_id
       or new.amount_cents is distinct from old.amount_cents then
      raise exception 'El monto y la cuota de un pago de membresía no se editan: reversa el pago.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select c.clinic_id, c.patient_id, c.amount_cents into v_cuota
    from public.membership_charges c
   where c.id = new.membership_charge_id;
  if not found or v_cuota.clinic_id is distinct from new.clinic_id then
    raise exception 'La cuota no existe en esta clínica.' using errcode = '23503';
  end if;
  if v_cuota.patient_id is distinct from new.patient_id then
    raise exception 'La cuota es de otro paciente.' using errcode = '23514';
  end if;
  if v_cuota.amount_cents is distinct from new.amount_cents then
    raise exception 'El pago de una cuota tiene que ser por el monto de la cuota.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.validar_pago_de_cuota() from public, anon;

drop trigger if exists payments_validar_cuota on public.payments;
create trigger payments_validar_cuota
  before insert or update on public.payments
  for each row execute function public.validar_pago_de_cuota();

-- ─── 2. Cobrar una cuota: una sola operación atómica e idempotente ─────────
-- SECURITY DEFINER porque escribe en dos tablas con roles de escritura
-- distintos (contabilidad puede cobrar cuotas pero no insertar pagos de
-- tratamiento). Como el DEFINER salta la RLS, se repiten acá los chequeos que
-- la RLS haría: rol de caja de la clínica de la cuota y MFA.
create or replace function public.cobrar_cuota_de_membresia(
  p_charge_id uuid,
  p_payment_method_id uuid default null,
  p_method public.payment_method default 'other',
  p_net_cents bigint default null,
  p_reference text default null
)
returns table (payment_id uuid, ya_cobrada boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cuota record;
  v_medio_id uuid;
  v_medio_nombre text;
  v_pago uuid;
  v_concepto text;
begin
  select c.id, c.clinic_id, c.patient_id, c.amount_cents, c.status, c.period_start,
         m.plan_name_snapshot
    into v_cuota
    from public.membership_charges c
    join public.patient_memberships m on m.id = c.membership_id
   where c.id = p_charge_id
     for update of c;
  if not found then
    raise exception 'La cuota no existe.' using errcode = '23503';
  end if;

  if not public.has_clinic_role(
       v_cuota.clinic_id,
       array['owner', 'admin', 'reception', 'accounting']::public.app_role[]
     ) then
    raise exception 'No tienes permisos para cobrar.' using errcode = '42501';
  end if;
  if not (select public.sesion_cumple_mfa()) then
    raise exception 'Verifica tu identidad en dos pasos para cobrar.' using errcode = '42501';
  end if;

  if v_cuota.status = 'void' then
    raise exception 'La cuota está anulada.' using errcode = '23514';
  end if;

  -- Idempotencia: si ya está cobrada, se devuelve el pago que existe.
  if v_cuota.status = 'paid' then
    select p.id into v_pago
      from public.payments p
     where p.membership_charge_id = v_cuota.id and p.reversed_at is null;
    return query select v_pago, true;
    return;
  end if;

  if p_payment_method_id is not null then
    select pm.id, pm.name into v_medio_id, v_medio_nombre
      from public.payment_methods pm
     where pm.id = p_payment_method_id and pm.clinic_id = v_cuota.clinic_id;
    if not found then
      raise exception 'Ese medio de pago no existe en esta clínica.' using errcode = '23503';
    end if;
  end if;

  v_concepto := 'Cuota de membresía · ' || v_cuota.plan_name_snapshot;

  insert into public.payments
    (clinic_id, patient_id, amount_cents, method, payment_method_id,
     method_name_snapshot, net_cents, reference, notes, membership_charge_id)
  values
    (v_cuota.clinic_id, v_cuota.patient_id, v_cuota.amount_cents, p_method,
     v_medio_id, v_medio_nombre, p_net_cents, nullif(btrim(p_reference), ''), v_concepto, v_cuota.id)
  returning id into v_pago;

  update public.membership_charges
     set status = 'paid',
         paid_at = now(),
         payment_method_id = v_medio_id,
         method_name_snapshot = v_medio_nombre,
         reference = nullif(btrim(p_reference), '')
   where id = v_cuota.id;

  return query select v_pago, false;
end;
$$;

comment on function public.cobrar_cuota_de_membresia(uuid, uuid, public.payment_method, bigint, text) is
  'Cierre ítem 1: cobra una cuota de membresía como pago real (payments + caja del cobrador) y la marca cobrada, atómico e idempotente. SECURITY DEFINER: valida rol de caja y MFA.';

revoke all on function public.cobrar_cuota_de_membresia(uuid, uuid, public.payment_method, bigint, text)
  from public, anon;
grant execute on function public.cobrar_cuota_de_membresia(uuid, uuid, public.payment_method, bigint, text)
  to authenticated, service_role;

-- ─── 3. Reversa en los dos sentidos (sin recursión) ────────────────────────
-- Anular una cuota ya cobrada reversa su pago.
create or replace function public.cuota_anulada_reversa_su_pago()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quien uuid := coalesce(auth.uid(), new.voided_by, new.paid_by, new.created_by);
begin
  if old.status = 'paid' and new.status = 'void' then
    update public.payments
       set reversed_at = now(),
           reversed_by = v_quien,
           reversal_reason = left('Cuota de membresía anulada: ' || coalesce(new.void_reason, ''), 500)
     where membership_charge_id = new.id and reversed_at is null;
  end if;
  return new;
end;
$$;

revoke execute on function public.cuota_anulada_reversa_su_pago() from public, anon;

drop trigger if exists membership_charges_reversa_pago on public.membership_charges;
create trigger membership_charges_reversa_pago
  after update of status on public.membership_charges
  for each row execute function public.cuota_anulada_reversa_su_pago();

-- Reversar el pago de una cuota anula la cuota.
create or replace function public.pago_reversado_anula_su_cuota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.membership_charge_id is not null
     and old.reversed_at is null and new.reversed_at is not null then
    update public.membership_charges
       set status = 'void',
           void_reason = left('Pago reversado: ' || coalesce(new.reversal_reason, ''), 300)
     where id = new.membership_charge_id and status <> 'void';
  end if;
  return new;
end;
$$;

revoke execute on function public.pago_reversado_anula_su_cuota() from public, anon;

drop trigger if exists payments_anula_cuota on public.payments;
create trigger payments_anula_cuota
  after update of reversed_at on public.payments
  for each row execute function public.pago_reversado_anula_su_cuota();

-- ─── 4. Lecturas que miran el saldo de tratamientos o la venta ─────────────
-- Mismas definiciones que en producción, con una condición más en los pagos.

-- Saldo por paciente: la cuota no es un tratamiento, no resta de lo que debe.
create or replace function public.patient_balances(
  p_clinic_id uuid,
  p_patient_ids uuid[] default null
)
returns table (patient_id uuid, billed_cents bigint, paid_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with facturado as (
    select tp.patient_id,
           sum(coalesce(ti.patient_cents, ti.price_cents, 0))::bigint as cents
    from public.treatment_items ti
    join public.treatment_plans tp on tp.id = ti.plan_id
    where ti.clinic_id = p_clinic_id
      and tp.status <> 'cancelled'
      and (p_patient_ids is null or tp.patient_id = any (p_patient_ids))
    group by tp.patient_id
  ),
  pagado as (
    select pa.patient_id,
           sum(coalesce(pa.amount_cents, 0))::bigint as cents
    from public.payments pa
    where pa.clinic_id = p_clinic_id
      and pa.reversed_at is null
      and pa.membership_charge_id is null
      and (p_patient_ids is null or pa.patient_id = any (p_patient_ids))
    group by pa.patient_id
  )
  select coalesce(f.patient_id, p.patient_id) as patient_id,
         coalesce(f.cents, 0)::bigint as billed_cents,
         coalesce(p.cents, 0)::bigint as paid_cents
  from facturado f
  full join pagado p on p.patient_id = f.patient_id;
$$;

-- Vista general: "cobrado" son los pagos de tratamientos; las cuotas de
-- membresía ya se suman aparte (`cuotas_cobradas_*`), así que sus pagos no
-- pueden contar también en `cobros` (se duplicaría el ingreso).
create or replace function public.finanzas_por_sucursal(
  p_clinic_id uuid,
  p_desde date,
  p_hasta date
)
returns table (
  branch_id uuid,
  cobrado_cents bigint,
  pagos bigint,
  cuotas_cobradas_cents bigint,
  cuotas_cobradas bigint,
  gastos_cents bigint,
  gastos bigint,
  realizado_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with zona as (
    select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
      from public.clinics c where c.id = p_clinic_id
  ),
  cobros as (
    select coalesce(cr.branch_id, pt.branch_id) as branch_id,
           sum(pa.amount_cents)::bigint as cents, count(*)::bigint as n
      from public.payments pa
      cross join zona
      left join public.cash_registers cr on cr.id = pa.cash_register_id
      left join public.patients pt on pt.id = pa.patient_id
     where pa.clinic_id = p_clinic_id
       and pa.reversed_at is null
       and pa.membership_charge_id is null
       and (pa.paid_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  cuotas as (
    select pt.branch_id, sum(mc.amount_cents)::bigint as cents, count(*)::bigint as n
      from public.membership_charges mc
      cross join zona
      left join public.patients pt on pt.id = mc.patient_id
     where mc.clinic_id = p_clinic_id
       and mc.status = 'paid'
       and (mc.paid_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  egresos as (
    select e.branch_id, sum(e.amount_cents)::bigint as cents, count(*)::bigint as n
      from public.expenses e
     where e.clinic_id = p_clinic_id
       and e.incurred_on between p_desde and p_hasta
     group by 1
  ),
  produccion as (
    select pt.branch_id, sum(ti.price_cents)::bigint as cents
      from public.treatment_items ti
      cross join zona
      join public.treatment_plans tp on tp.id = ti.plan_id
      left join public.patients pt on pt.id = tp.patient_id
     where ti.clinic_id = p_clinic_id
       and ti.status = 'completed'
       and (ti.completed_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  sucursales as (
    select branch_id from cobros
    union select branch_id from cuotas
    union select branch_id from egresos
    union select branch_id from produccion
  )
  select s.branch_id,
         coalesce(co.cents, 0)::bigint,
         coalesce(co.n, 0)::bigint,
         coalesce(cu.cents, 0)::bigint,
         coalesce(cu.n, 0)::bigint,
         coalesce(eg.cents, 0)::bigint,
         coalesce(eg.n, 0)::bigint,
         coalesce(pr.cents, 0)::bigint
    from sucursales s
    left join cobros co on co.branch_id is not distinct from s.branch_id
    left join cuotas cu on cu.branch_id is not distinct from s.branch_id
    left join egresos eg on eg.branch_id is not distinct from s.branch_id
    left join produccion pr on pr.branch_id is not distinct from s.branch_id;
$$;

-- Venta real: lo cobrado de tratamientos por profesional (la cuota no tiene
-- profesional ni prestación).
create or replace function public.finanzas_venta_real(
  p_clinic_id uuid,
  p_desde date,
  p_hasta date
)
returns table (
  professional_id uuid,
  presupuestado_cents bigint,
  presupuestos bigint,
  realizado_cents bigint,
  realizado_paciente_cents bigint,
  realizado_items bigint,
  cobrado_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with zona as (
    select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
      from public.clinics c where c.id = p_clinic_id
  ),
  aceptados as (
    select q.professional_id,
           sum(coalesce(q.accepted_total_cents, q.total_cents))::bigint as cents,
           count(*)::bigint as n
      from public.quotes q
      cross join zona
     where q.clinic_id = p_clinic_id
       and q.status in ('accepted', 'converted', 'partially_accepted')
       and q.accepted_at is not null
       and (q.accepted_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  realizados as (
    select ti.professional_id,
           sum(ti.price_cents)::bigint as cents,
           sum(coalesce(ti.patient_cents, ti.price_cents))::bigint as paciente,
           count(*)::bigint as n
      from public.treatment_items ti
      cross join zona
     where ti.clinic_id = p_clinic_id
       and ti.status = 'completed'
       and (ti.completed_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  cobrados as (
    select ti.professional_id, sum(pa.amount_cents)::bigint as cents
      from public.payments pa
      cross join zona
      left join public.treatment_items ti on ti.id = pa.treatment_item_id
     where pa.clinic_id = p_clinic_id
       and pa.reversed_at is null
       and pa.membership_charge_id is null
       and (pa.paid_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  profesionales as (
    select professional_id from aceptados
    union select professional_id from realizados
    union select professional_id from cobrados
  )
  select p.professional_id,
         coalesce(a.cents, 0)::bigint,
         coalesce(a.n, 0)::bigint,
         coalesce(r.cents, 0)::bigint,
         coalesce(r.paciente, 0)::bigint,
         coalesce(r.n, 0)::bigint,
         coalesce(c.cents, 0)::bigint
    from profesionales p
    left join aceptados a on a.professional_id is not distinct from p.professional_id
    left join realizados r on r.professional_id is not distinct from p.professional_id
    left join cobrados c on c.professional_id is not distinct from p.professional_id;
$$;

-- Estado de cuenta de una empresa con convenio: lo que pagaron sus afiliados
-- por tratamientos (la cuota de membresía no es parte de la planilla).
create or replace function public.estado_cuenta_empresa(
  p_clinic_id uuid,
  p_company_id uuid,
  p_desde date,
  p_hasta date
)
returns table (
  patient_id uuid,
  full_name text,
  employee_code text,
  realizado_cents bigint,
  pagado_cents bigint,
  saldo_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with zona as (
    select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
      from public.clinics c where c.id = p_clinic_id
  ),
  afiliados as (
    select a.patient_id, a.employee_code, pt.full_name
      from public.partner_company_patients a
      join public.patients pt on pt.id = a.patient_id
     where a.clinic_id = p_clinic_id and a.company_id = p_company_id
  ),
  ids as (select array_agg(patient_id) as lista from afiliados),
  realizado as (
    select tp.patient_id, sum(coalesce(ti.patient_cents, ti.price_cents))::bigint as cents
      from public.treatment_items ti
      cross join zona
      join public.treatment_plans tp on tp.id = ti.plan_id
     where ti.clinic_id = p_clinic_id
       and ti.status = 'completed'
       and tp.patient_id in (select patient_id from afiliados)
       and (ti.completed_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  pagado as (
    select pa.patient_id, sum(pa.amount_cents)::bigint as cents
      from public.payments pa
      cross join zona
     where pa.clinic_id = p_clinic_id
       and pa.reversed_at is null
       and pa.membership_charge_id is null
       and pa.patient_id in (select patient_id from afiliados)
       and (pa.paid_at at time zone zona.tz)::date between p_desde and p_hasta
     group by 1
  ),
  saldos as (
    select b.patient_id, (b.billed_cents - b.paid_cents)::bigint as cents
      from ids, public.patient_balances(p_clinic_id, ids.lista) b
     where ids.lista is not null
  )
  select a.patient_id, a.full_name, a.employee_code,
         coalesce(r.cents, 0)::bigint,
         coalesce(p.cents, 0)::bigint,
         coalesce(s.cents, 0)::bigint
    from afiliados a
    left join realizado r on r.patient_id = a.patient_id
    left join pagado p on p.patient_id = a.patient_id
    left join saldos s on s.patient_id = a.patient_id
   order by a.full_name;
$$;

commit;

-- Cómo revertir (las cuotas cobradas con pago quedarían cobradas sin pago;
-- respaldar `payments` antes si ya hay cobros de cuota):
--
-- begin;
-- drop trigger if exists payments_anula_cuota on public.payments;
-- drop function if exists public.pago_reversado_anula_su_cuota();
-- drop trigger if exists membership_charges_reversa_pago on public.membership_charges;
-- drop function if exists public.cuota_anulada_reversa_su_pago();
-- drop function if exists public.cobrar_cuota_de_membresia(uuid, uuid, public.payment_method, bigint, text);
-- drop trigger if exists payments_validar_cuota on public.payments;
-- drop function if exists public.validar_pago_de_cuota();
-- (volver a crear patient_balances, finanzas_por_sucursal, finanzas_venta_real y
--  estado_cuenta_empresa sin la condición `membership_charge_id is null`, desde
--  20261020140000 y 20261106100300)
-- drop index if exists public.payments_una_vigente_por_cuota;
-- drop index if exists public.payments_membership_charge_idx;
-- alter table public.payments drop column if exists membership_charge_id;
-- commit;
