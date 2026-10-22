-- Ola 3 · Frente Cobros (4/4): "Resultados del piloto" cuenta cobros, no filas.
--
-- `pilot_results` (20261023300100, ya aplicada: no se edita) contaba
-- `count(*)` de `payments`. Desde FIN-04 un cobro repartido en efectivo +
-- tarjeta son dos filas con el mismo `payment_group_id`, y desde MKT-03
-- (frente Arancel) un bono + copago son dos filas con el mismo
-- `coverage_group_id`: el contador mostraba dos "pagos" por un solo cobro.
-- Ahora cuenta grupos distintos (o la fila suelta). Lo cobrado (la suma) no
-- cambia.
--
-- Copia de la definición vigente con solo esa línea distinta; misma firma y
-- mismo tipo de retorno, así que `create or replace` conserva dueño y GRANTs
-- (igual se repiten abajo). Compatible con el código en producción.

create or replace function public.pilot_results(
  p_clinic_id uuid,
  p_desde date,
  p_hasta date
)
returns table (
  currency text,
  appointments_scheduled integer,
  appointments_attended integer,
  appointments_no_show integer,
  appointments_cancelled integer,
  reminders_sent integer,
  patients_new integer,
  patients_by_source jsonb,
  quotes_issued integer,
  quotes_issued_cents bigint,
  quotes_accepted integer,
  quotes_accepted_cents bigint,
  collected_cents bigint,
  payments_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with clinica as (
    select c.currency,
           coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
    from public.clinics c
    where c.id = p_clinic_id
  ),
  rango as (
    select (p_desde::timestamp at time zone coalesce((select tz from clinica), 'America/Santiago')) as desde,
           ((p_hasta + 1)::timestamp at time zone coalesce((select tz from clinica), 'America/Santiago')) as hasta
  ),
  citas as (
    select
      count(*) filter (where a.status <> 'cancelada')::integer as agendadas,
      count(*) filter (where a.status = 'finalizada')::integer as atendidas,
      count(*) filter (where a.status = 'ausente')::integer as ausentes,
      count(*) filter (where a.status = 'cancelada')::integer as anuladas
    from public.appointments a, rango r
    where a.clinic_id = p_clinic_id
      and a.starts_at >= r.desde
      and a.starts_at < r.hasta
  ),
  recordatorios as (
    select count(*)::integer as enviados
    from public.messages m, rango r
    where m.clinic_id = p_clinic_id
      and m.direction = 'outbound'
      and m.template_kind in ('appointment_reminder', 'appointment_checkin')
      and m.status not in ('failed', 'draft')
      and m.created_at >= r.desde
      and m.created_at < r.hasta
  ),
  nuevos as (
    select p.acquisition_source as origen, count(*)::integer as n
    from public.patients p, rango r
    where p.clinic_id = p_clinic_id
      and p.merged_into is null
      and p.created_at >= r.desde
      and p.created_at < r.hasta
    group by p.acquisition_source
  ),
  presupuestos as (
    select
      count(*)::integer as emitidos,
      coalesce(sum(q.total_cents), 0)::bigint as emitidos_cents,
      count(*) filter (where q.status in ('accepted', 'converted'))::integer as aceptados,
      coalesce(sum(q.total_cents) filter (where q.status in ('accepted', 'converted')), 0)::bigint
        as aceptados_cents
    from public.quotes q, rango r
    where q.clinic_id = p_clinic_id
      and q.status <> 'draft'
      and q.created_at >= r.desde
      and q.created_at < r.hasta
  ),
  cobros as (
    select coalesce(sum(pa.amount_cents), 0)::bigint as cents,
           -- Un cobro, no una fila: el repartido en varios medios (FIN-04)
           -- y el bono + copago (MKT-03) son varias filas de un mismo cobro.
           count(distinct coalesce(pa.payment_group_id, pa.coverage_group_id, pa.id))::integer as n
    from public.payments pa, rango r
    where pa.clinic_id = p_clinic_id
      and pa.reversed_at is null
      and pa.paid_at >= r.desde
      and pa.paid_at < r.hasta
  )
  select
    (select currency from clinica),
    citas.agendadas,
    citas.atendidas,
    citas.ausentes,
    citas.anuladas,
    recordatorios.enviados,
    coalesce((select sum(n) from nuevos), 0)::integer,
    coalesce(
      (select jsonb_agg(jsonb_build_object('source', origen, 'count', n) order by n desc, origen)
       from nuevos),
      '[]'::jsonb
    ),
    presupuestos.emitidos,
    presupuestos.emitidos_cents,
    presupuestos.aceptados,
    presupuestos.aceptados_cents,
    cobros.cents,
    cobros.n
  from citas, recordatorios, presupuestos, cobros;
$$;

comment on function public.pilot_results(uuid, date, date) is
  'Resultados del piloto (INF-14): citas, asistencia, recordatorios, pacientes nuevos por origen, presupuestos y cobros en un rango de fechas civiles en el huso de la clínica. SECURITY INVOKER.';

revoke all on function public.pilot_results(uuid, date, date) from public, anon;
grant execute on function public.pilot_results(uuid, date, date) to authenticated, service_role;

-- Reversa: volver a aplicar la definición de
-- 20261023300100_resultados_del_piloto.sql (la misma función con count(*)).
