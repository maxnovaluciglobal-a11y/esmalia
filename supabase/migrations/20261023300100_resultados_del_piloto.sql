-- Resultados del piloto (INF-14, Ola 2).
--
-- Una pantalla de Reportes que le muestra a una clínica piloto lo que ganó
-- desde que usa Esmalia, para la conversación de cierre del piloto. Todo se
-- agrega en Postgres: los montos (presupuestos y cobros) y los conteos pasan
-- fácil las 1000 filas que PostgREST corta sin avisar (`max_rows`).
--
-- SECURITY INVOKER: cada tabla se lee con la RLS de quien llama (incluida
-- `mfa_exige_aal2`). Quien no puede leer `payments` ve 0 en lo cobrado, igual
-- que en un SELECT por REST; la pantalla además exige owner/admin y
-- `requireFinanceView` para mostrar montos (regla 15).
--
-- El rango son fechas civiles [p_desde, p_hasta] en el huso de la clínica
-- (regla 7): el 1 de octubre en Santiago empieza a las 03:00 UTC, no a las
-- 00:00 UTC. Sin clínica visible, el huso por defecto es el de Chile, como en
-- la app.
--
-- Definiciones:
--   citas agendadas    = citas que empiezan en el rango, sin las anuladas
--   atendidas / ausentes = las de ese grupo en 'finalizada' / 'ausente'
--   anuladas           = citas que empiezan en el rango en 'cancelada'
--   recordatorios      = mensajes salientes de recordatorio o check-in
--                        ('appointment_reminder', 'appointment_checkin', los
--                        mismos que mide /efectividad) creados en el rango,
--                        sin los fallidos ni los borradores
--   pacientes nuevos   = fichas creadas en el rango, sin las que se fusionaron
--                        en otra (eran duplicados); se agrupan por
--                        `acquisition_source` (null = sin dato)
--   presupuestos       = creados en el rango y emitidos (no 'draft');
--                        aceptados = 'accepted' o 'converted', como en Finanzas
--   cobrado            = pagos con `paid_at` en el rango, no reversados

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
           count(*)::integer as n
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

-- Reversa:
-- drop function if exists public.pilot_results(uuid, date, date);
