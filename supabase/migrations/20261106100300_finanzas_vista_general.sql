-- Ola 10 · frente A (4/4): lecturas agregadas de la vista general de finanzas
-- (FIN-01), la venta real (FIN-18) y el estado de cuenta de una empresa con
-- convenio (FIN-11).
--
-- Mismo motivo que `patient_balances` (20261020140000): PostgREST corta en
-- `max_rows` sin avisar, así que las sumas nuevas se hacen en Postgres y no en
-- JS. Las cuatro son SECURITY INVOKER: la RLS de cada tabla (y la de MFA) se
-- aplica igual que en un SELECT por REST. El servidor exige además
-- `finance:view` (regla 15) antes de llamarlas.
--
-- Fechas: `p_desde`/`p_hasta` son días contables de la clínica. Los
-- `timestamptz` (paid_at, completed_at, accepted_at) se pasan a la zona de la
-- clínica antes de compararlos (regla 7), no a límites UTC.
--
-- Sucursal: un pago va a la sucursal de su caja y, sin caja, a la del
-- paciente; la producción y las cuotas, a la del paciente; el gasto, a la
-- suya. NULL = sin sucursal (clínica entera o paciente sin sucursal).
--
-- No cambian ninguna tabla ni política.

begin;

-- ─── 1. Por sucursal: cobrado, cuotas cobradas, gastos y producción ────────
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

comment on function public.finanzas_por_sucursal(uuid, date, date) is
  'FIN-01: cobrado, cuotas de membresía cobradas, gastos y producción del período por sucursal (NULL = sin sucursal). SECURITY INVOKER.';

revoke all on function public.finanzas_por_sucursal(uuid, date, date) from public, anon;
grant execute on function public.finanzas_por_sucursal(uuid, date, date) to authenticated, service_role;

-- ─── 2. Venta real por profesional: presupuestado, realizado y cobrado ─────
-- presupuestado = presupuestos aceptados en el período (total aceptado, o el
--                 total si no se guardó el aceptado), del profesional del
--                 presupuesto.
-- realizado     = ítems completados en el período: valor de lista
--                 (`price_cents`) y lo que le toca al paciente
--                 (`coalesce(patient_cents, price_cents)`, 0 es real).
-- cobrado       = pagos del período no reversados; al profesional del ítem si
--                 el pago está imputado a uno, si no "sin profesional" (NULL).
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

comment on function public.finanzas_venta_real(uuid, date, date) is
  'FIN-18: presupuestado (aceptado), realizado (completado) y cobrado del período por profesional (NULL = sin profesional). SECURITY INVOKER.';

revoke all on function public.finanzas_venta_real(uuid, date, date) from public, anon;
grant execute on function public.finanzas_venta_real(uuid, date, date) to authenticated, service_role;

-- ─── 3. Por cobrar hoy: saldo de pacientes y cuotas pendientes ─────────────
-- El saldo usa `patient_balances` tal cual (la misma fórmula que la ficha y
-- morosidad): solo suma los saldos positivos; un saldo a favor no compensa la
-- deuda de otro paciente. Las fichas fusionadas no cuentan (su deuda ya se
-- movió a la ficha destino).
create or replace function public.finanzas_por_cobrar(p_clinic_id uuid)
returns table (
  saldo_pacientes_cents bigint,
  pacientes_con_saldo bigint,
  cuotas_pendientes_cents bigint,
  cuotas_pendientes bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with saldos as (
    select b.patient_id, (b.billed_cents - b.paid_cents) as saldo
      from public.patient_balances(p_clinic_id) b
      join public.patients pt on pt.id = b.patient_id and pt.merged_into is null
  ),
  cuotas as (
    select coalesce(sum(mc.amount_cents), 0)::bigint as cents, count(*)::bigint as n
      from public.membership_charges mc
     where mc.clinic_id = p_clinic_id and mc.status = 'pending'
  )
  select coalesce((select sum(saldo) from saldos where saldo > 0), 0)::bigint,
         (select count(*) from saldos where saldo > 0)::bigint,
         cuotas.cents,
         cuotas.n
    from cuotas;
$$;

comment on function public.finanzas_por_cobrar(uuid) is
  'FIN-01: saldo positivo de pacientes (patient_balances) y cuotas de membresía pendientes. SECURITY INVOKER.';

revoke all on function public.finanzas_por_cobrar(uuid) from public, anon;
grant execute on function public.finanzas_por_cobrar(uuid) to authenticated, service_role;

-- ─── 4. Estado de cuenta de una empresa con convenio ──────────────────────
-- Una fila por paciente afiliado: lo realizado en el período (parte del
-- paciente), lo pagado en el período y su saldo de hoy (`patient_balances`).
-- Con descuento por planilla, la suma de los saldos es lo que la empresa
-- debería descontar y pagarle a la clínica.
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

comment on function public.estado_cuenta_empresa(uuid, uuid, date, date) is
  'FIN-11: estado de cuenta de una empresa con convenio (realizado y pagado del período y saldo de hoy de cada afiliado). SECURITY INVOKER.';

revoke all on function public.estado_cuenta_empresa(uuid, uuid, date, date) from public, anon;
grant execute on function public.estado_cuenta_empresa(uuid, uuid, date, date) to authenticated, service_role;

commit;

-- Cómo revertir (solo lecturas: no hay datos que tocar):
--
-- begin;
-- drop function if exists public.estado_cuenta_empresa(uuid, uuid, date, date);
-- drop function if exists public.finanzas_por_cobrar(uuid);
-- drop function if exists public.finanzas_venta_real(uuid, date, date);
-- drop function if exists public.finanzas_por_sucursal(uuid, date, date);
-- commit;
