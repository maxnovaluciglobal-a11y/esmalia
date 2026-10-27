-- Cierre de la fase · Bloque 5 · ítem 4: las citas grupales para TODOS los
-- inscritos, no solo para el titular (AGE-22, Ola 14).
--
-- La Ola 14 dejó `appointments.patient_id` como «titular» de la cita grupal
-- (el primer inscrito vigente). Todo lo que leía esa columna sin mirar a los
-- inscritos veía solo al titular. Esta migración corrige lo que se calcula en
-- la base; el resto (portal, «mis datos», campañas, recordatorios y la
-- confirmación por WhatsApp) se corrige en el código de la aplicación.
--
-- 1. Confirmación del paciente POR INSCRITO. `appointments.patient_confirmed_at`
--    es una sola marca por cita: en una grupal, el «sí» del titular marcaba la
--    cita entera. Se suman `patient_confirmed_at` y `patient_confirmed_via` a
--    `appointment_group_participants` (nullable; el webhook de WhatsApp los
--    escribe con service_role). La marca de la cita queda para las individuales.
--
-- 2. Cada inscrito vigente cuenta con su PROPIA asistencia (igual que
--    `patient_appointment_counters`, 20261110200000: cita cancelada manda;
--    después asistió → finalizada, ausente → ausente; pendiente → el estado de la
--    cita) en lo que alimenta el recall, el seguimiento y las campañas:
--      · seguimiento_datos_de_pacientes   (riesgo de abandono, control periódico)
--      · seguimiento_planes_activos       (tratamientos detenidos)
--      · outreach_patient_visits          (última visita y «tiene próxima cita»)
--      · list_patients_with_last_and_next_appointment (última y próxima cita)
--
-- 3. Informes de asistencia: `atenciones` y `ausencias` cuentan un hecho por
--    inscrito (con su paciente, para los cortes de edad, sexo, etc.); `citas`,
--    `horas_agendadas` y `cancelaciones` siguen contando la sesión UNA vez, así
--    que las horas del profesional y del box no se duplican. El embudo
--    (`informe_embudo`) cuenta a los inscritos como pacientes con cita y
--    atendidos.
--
-- Sin correos nuevos: esta migración no toca los avisos automáticos (los de
-- citas grupales siguen excluidos de `/api/patient-emails`). WhatsApp nunca sale
-- solo.
--
-- Se redefinen (partiendo de su definición en producción del 27-oct-2026,
-- `pg_get_functiondef`), con la misma firma y el mismo resultado para las citas
-- individuales: seguimiento_datos_de_pacientes, seguimiento_planes_activos,
-- outreach_patient_visits, list_patients_with_last_and_next_appointment,
-- informe_hechos_sql e informe_embudo. No escribe datos. Reversa al pie.

begin;

alter table public.appointment_group_participants
  add column if not exists patient_confirmed_at timestamptz,
  add column if not exists patient_confirmed_via text
    check (patient_confirmed_via is null or char_length(patient_confirmed_via) <= 30);

comment on column public.appointment_group_participants.patient_confirmed_at is
  'AGE-22: cuándo avisó ESTE inscrito que viene (por WhatsApp). La confirmación de la cita grupal es por persona; appointments.patient_confirmed_at queda para las individuales.';

CREATE OR REPLACE FUNCTION public.seguimiento_datos_de_pacientes(p_clinic_id uuid)
 RETURNS TABLE(patient_id uuid, full_name text, phone text, created_at timestamp with time zone, last_visit_at timestamp with time zone, visits integer, has_future boolean, no_shows_12m integer, cancelled_12m integer, rejected_quotes_12m integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with eventos as (
    -- Citas individuales.
    select a.patient_id, a.starts_at, a.status::text as status, a.patient_cancelled_at
      from public.appointments a
     where a.clinic_id = p_clinic_id
       and not exists (select 1 from public.appointment_groups g where g.appointment_id = a.id)
    union all
    -- Citas grupales: cada inscrito cuenta con su propia asistencia (AGE-22).
    select gp.patient_id, a.starts_at,
           case
             when a.status = 'cancelada' then 'cancelada'
             when gp.attendance = 'asistio' then 'finalizada'
             when gp.attendance = 'ausente' then 'ausente'
             else a.status::text
           end,
           a.patient_cancelled_at
      from public.appointment_group_participants gp
      join public.appointments a on a.id = gp.appointment_id
     where gp.clinic_id = p_clinic_id
       and gp.withdrawn_at is null
  ),
  citas as (
    select e.patient_id,
           max(e.starts_at) filter (where e.status = 'finalizada') as last_visit_at,
           count(*) filter (where e.status = 'finalizada') as visits,
           coalesce(bool_or(e.starts_at > now() and e.status in ('tentativa', 'confirmada', 'en-sala')), false) as has_future,
           count(*) filter (where e.status = 'ausente' and e.starts_at > now() - interval '12 months') as no_shows,
           count(*) filter (
             where e.status = 'cancelada'
               and e.patient_cancelled_at is not null
               and e.starts_at > now() - interval '12 months'
           ) as cancelled
      from eventos e
     group by e.patient_id
  ),
  presupuestos as (
    select q.patient_id,
           count(*) filter (
             where q.status in ('rejected', 'expired') and q.updated_at > now() - interval '12 months'
           ) as rejected
      from public.quotes q
     where q.clinic_id = p_clinic_id
     group by q.patient_id
  )
  select p.id,
         p.full_name,
         p.phone,
         p.created_at,
         c.last_visit_at,
         coalesce(c.visits, 0)::integer,
         coalesce(c.has_future, false),
         coalesce(c.no_shows, 0)::integer,
         coalesce(c.cancelled, 0)::integer,
         coalesce(pr.rejected, 0)::integer
    from public.patients p
    left join citas c on c.patient_id = p.id
    left join presupuestos pr on pr.patient_id = p.id
   where p.clinic_id = p_clinic_id
     and p.archived_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.seguimiento_planes_activos(p_clinic_id uuid)
 RETURNS TABLE(plan_id uuid, patient_id uuid, patient_name text, plan_name text, plan_created_at timestamp with time zone, plan_started_at timestamp with time zone, quote_id uuid, pending_items integer, completed_items integer, last_item_completed_at timestamp with time zone, last_visit_at timestamp with time zone, has_future boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with items as (
    select i.plan_id,
           count(*) filter (where i.status in ('pending', 'in_progress')) as pendientes,
           count(*) filter (where i.status = 'completed') as completados,
           max(i.completed_at) as ultimo
      from public.treatment_items i
     where i.clinic_id = p_clinic_id
     group by i.plan_id
  ),
  eventos as (
    select a.patient_id, a.starts_at, a.status::text as status
      from public.appointments a
     where a.clinic_id = p_clinic_id
       and not exists (select 1 from public.appointment_groups g where g.appointment_id = a.id)
    union all
    select gp.patient_id, a.starts_at,
           case
             when a.status = 'cancelada' then 'cancelada'
             when gp.attendance = 'asistio' then 'finalizada'
             when gp.attendance = 'ausente' then 'ausente'
             else a.status::text
           end
      from public.appointment_group_participants gp
      join public.appointments a on a.id = gp.appointment_id
     where gp.clinic_id = p_clinic_id
       and gp.withdrawn_at is null
  ),
  citas as (
    select e.patient_id,
           max(e.starts_at) filter (where e.status = 'finalizada') as last_visit_at,
           coalesce(bool_or(e.starts_at > now() and e.status in ('tentativa', 'confirmada', 'en-sala')), false) as has_future
      from eventos e
     group by e.patient_id
  )
  select tp.id,
         tp.patient_id,
         p.full_name,
         tp.name,
         tp.created_at,
         tp.started_at,
         tp.quote_id,
         coalesce(it.pendientes, 0)::integer,
         coalesce(it.completados, 0)::integer,
         it.ultimo,
         c.last_visit_at,
         coalesce(c.has_future, false)
    from public.treatment_plans tp
    join public.patients p on p.id = tp.patient_id and p.archived_at is null
    left join items it on it.plan_id = tp.id
    left join citas c on c.patient_id = tp.patient_id
   where tp.clinic_id = p_clinic_id
     and tp.status = 'active';
$function$;

CREATE OR REPLACE FUNCTION public.outreach_patient_visits(p_clinic_id uuid)
 RETURNS TABLE(patient_id uuid, last_visit_at timestamp with time zone, has_future boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select pt.id as patient_id,
         ultima.last_visit_at,
         (
           exists (
             select 1
             from public.appointments fu
             where fu.clinic_id = p_clinic_id
               and fu.patient_id = pt.id
               and fu.status <> 'cancelada'
               and fu.starts_at > now()
               and not exists (select 1 from public.appointment_groups g where g.appointment_id = fu.id)
           )
           -- Cita grupal: tiene una próxima cita quien está inscrito (AGE-22).
           or exists (
             select 1
             from public.appointment_group_participants gp
             join public.appointments fu on fu.id = gp.appointment_id
             where gp.clinic_id = p_clinic_id
               and gp.patient_id = pt.id
               and gp.withdrawn_at is null
               and fu.status <> 'cancelada'
               and fu.starts_at > now()
           )
         ) as has_future
  from public.patients pt
  join lateral (
    select max(v.ends_at) as last_visit_at
    from (
      select a.ends_at
      from public.appointments a
      where a.clinic_id = p_clinic_id
        and a.patient_id = pt.id
        and a.status = 'finalizada'
        and not exists (select 1 from public.appointment_groups g where g.appointment_id = a.id)
      union all
      -- Cita grupal: vino quien asistió (o, sin lista pasada, si la sesión se finalizó).
      select a.ends_at
      from public.appointment_group_participants gp
      join public.appointments a on a.id = gp.appointment_id
      where gp.clinic_id = p_clinic_id
        and gp.patient_id = pt.id
        and gp.withdrawn_at is null
        and (gp.attendance = 'asistio' or (gp.attendance = 'pendiente' and a.status = 'finalizada'))
    ) v
  ) ultima on ultima.last_visit_at is not null
  where pt.clinic_id = p_clinic_id
    and pt.wa_opt_in
    and pt.wa_opt_out_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.list_patients_with_last_and_next_appointment(p_clinic_id uuid)
 RETURNS TABLE(patient_id uuid, last_appointment_at timestamp with time zone, last_appointment_status appointment_status, next_appointment_at timestamp with time zone, next_appointment_status appointment_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'No tienes permisos sobre esta clínica.';
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT a.patient_id, a.starts_at, a.status
    FROM public.appointments a
    WHERE a.clinic_id = p_clinic_id AND a.status <> 'cancelada'
      AND NOT EXISTS (SELECT 1 FROM public.appointment_groups g WHERE g.appointment_id = a.id)
    UNION ALL
    -- Cita grupal: la ve cada inscrito, con su propia asistencia (AGE-22).
    SELECT gp.patient_id, a.starts_at,
           CASE
             WHEN gp.attendance = 'asistio' THEN 'finalizada'::public.appointment_status
             WHEN gp.attendance = 'ausente' THEN 'ausente'::public.appointment_status
             ELSE a.status
           END
    FROM public.appointment_group_participants gp
    JOIN public.appointments a ON a.id = gp.appointment_id
    WHERE gp.clinic_id = p_clinic_id
      AND gp.withdrawn_at IS NULL
      AND a.status <> 'cancelada'
  ),
  ranked AS (
    SELECT
      s.patient_id,
      s.starts_at,
      s.status,
      s.starts_at < now() AS is_past,
      ROW_NUMBER() OVER (
        PARTITION BY s.patient_id, s.starts_at < now()
        ORDER BY CASE WHEN s.starts_at < now() THEN s.starts_at END DESC,
                 CASE WHEN s.starts_at >= now() THEN s.starts_at END ASC
      ) AS rn
    FROM scoped s
  )
  SELECT
    p.id AS patient_id,
    MAX(CASE WHEN r.is_past AND r.rn = 1 THEN r.starts_at END) AS last_appointment_at,
    (array_agg(r.status) FILTER (WHERE r.is_past AND r.rn = 1))[1] AS last_appointment_status,
    MAX(CASE WHEN NOT r.is_past AND r.rn = 1 THEN r.starts_at END) AS next_appointment_at,
    (array_agg(r.status) FILTER (WHERE NOT r.is_past AND r.rn = 1))[1] AS next_appointment_status
  FROM public.patients p
  LEFT JOIN ranked r ON r.patient_id = p.id
  WHERE p.clinic_id = p_clinic_id
  GROUP BY p.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.informe_hechos_sql(p_metrica text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_citas constant text := $q$
    select a.id as ref_id, a.starts_at as momento,
           (a.starts_at at time zone z.tz)::date as fecha,
           a.patient_id, a.professional_id, a.operatory_id, a.branch_id,
           a.status::text as estado, coalesce(a.booking_source, 'otros') as canal,
           %s as valor
      from public.appointments a
      cross join z
     where a.clinic_id = $1
       and a.starts_at >= ($2::date - 1)::timestamp at time zone 'UTC'
       and a.starts_at < ($3::date + 2)::timestamp at time zone 'UTC'
       and %s
  $q$;
  -- Citas grupales (AGE-22): cada inscrito vigente es un hecho propio, con su
  -- asistencia. Solo para atenciones y ausencias; citas, horas y cancelaciones
  -- siguen contando la sesión una vez (las horas del profesional y del box no
  -- se duplican). `ref_id` es el id del inscrito (único por hecho).
  v_inscritos constant text := $q$
    select gp.id as ref_id, a.starts_at as momento,
           (a.starts_at at time zone z.tz)::date as fecha,
           gp.patient_id, a.professional_id, a.operatory_id, a.branch_id,
           case when gp.attendance = 'asistio' then 'finalizada'
                when gp.attendance = 'ausente' then 'ausente'
                else a.status::text end as estado,
           coalesce(a.booking_source, 'otros') as canal,
           1::bigint as valor
      from public.appointment_group_participants gp
      join public.appointments a on a.id = gp.appointment_id
      cross join z
     where gp.clinic_id = $1
       and gp.withdrawn_at is null
       and a.status <> 'cancelada'
       and a.starts_at >= ($2::date - 1)::timestamp at time zone 'UTC'
       and a.starts_at < ($3::date + 2)::timestamp at time zone 'UTC'
       and %s
  $q$;
  v_sin_grupal constant text :=
    ' and not exists (select 1 from public.appointment_groups g where g.appointment_id = a.id)';
begin
  return case p_metrica
    when 'citas' then format(v_citas, '1::bigint', $f$a.status <> 'cancelada'$f$)
    when 'atenciones' then
      format(v_citas, '1::bigint', $f$a.status = 'finalizada'$f$ || v_sin_grupal)
      || ' union all '
      || format(v_inscritos, $f$(gp.attendance = 'asistio' or (gp.attendance = 'pendiente' and a.status = 'finalizada'))$f$)
    when 'ausencias' then
      format(v_citas, '1::bigint', $f$a.status = 'ausente'$f$ || v_sin_grupal)
      || ' union all '
      || format(v_inscritos, $f$gp.attendance = 'ausente'$f$)
    when 'cancelaciones' then format(v_citas, '1::bigint', $f$a.status = 'cancelada'$f$)
    when 'horas_agendadas' then format(
      v_citas,
      'greatest(0, round(extract(epoch from (a.ends_at - a.starts_at)) / 60))::bigint',
      $f$a.status <> 'cancelada'$f$
    )
    when 'pacientes_nuevos' then $q$
      select pt.id as ref_id, pt.created_at as momento,
             (pt.created_at at time zone z.tz)::date as fecha,
             pt.id as patient_id, pt.primary_professional_id as professional_id,
             null::uuid as operatory_id, pt.branch_id,
             pt.status::text as estado, null::text as canal, 1::bigint as valor
        from public.patients pt
        cross join z
       where pt.clinic_id = $1
         and pt.merged_into is null
         and pt.created_at >= ($2::date - 1)::timestamp at time zone 'UTC'
         and pt.created_at < ($3::date + 2)::timestamp at time zone 'UTC'
    $q$
    when 'presupuestos' then $q$
      select q.id as ref_id, q.created_at as momento,
             (q.created_at at time zone z.tz)::date as fecha,
             q.patient_id, q.professional_id, null::uuid as operatory_id, pt.branch_id,
             q.status::text as estado, null::text as canal, 1::bigint as valor
        from public.quotes q
        cross join z
        left join public.patients pt on pt.id = q.patient_id
       where q.clinic_id = $1
         and q.created_at >= ($2::date - 1)::timestamp at time zone 'UTC'
         and q.created_at < ($3::date + 2)::timestamp at time zone 'UTC'
    $q$
    when 'presupuestos_aceptados' then $q$
      select q.id as ref_id, q.accepted_at as momento,
             (q.accepted_at at time zone z.tz)::date as fecha,
             q.patient_id, q.professional_id, null::uuid as operatory_id, pt.branch_id,
             q.status::text as estado, null::text as canal, 1::bigint as valor
        from public.quotes q
        cross join z
        left join public.patients pt on pt.id = q.patient_id
       where q.clinic_id = $1
         and q.status in ('accepted', 'converted', 'partially_accepted')
         and q.accepted_at >= ($2::date - 1)::timestamp at time zone 'UTC'
         and q.accepted_at < ($3::date + 2)::timestamp at time zone 'UTC'
    $q$
    when 'presupuestado' then $q$
      select q.id as ref_id, q.accepted_at as momento,
             (q.accepted_at at time zone z.tz)::date as fecha,
             q.patient_id, q.professional_id, null::uuid as operatory_id, pt.branch_id,
             q.status::text as estado, null::text as canal,
             coalesce(q.accepted_total_cents, q.total_cents)::bigint as valor
        from public.quotes q
        cross join z
        left join public.patients pt on pt.id = q.patient_id
       where q.clinic_id = $1
         and q.status in ('accepted', 'converted', 'partially_accepted')
         and q.accepted_at >= ($2::date - 1)::timestamp at time zone 'UTC'
         and q.accepted_at < ($3::date + 2)::timestamp at time zone 'UTC'
    $q$
    when 'produccion' then $q$
      select ti.id as ref_id, ti.completed_at as momento,
             (ti.completed_at at time zone z.tz)::date as fecha,
             tp.patient_id, ti.professional_id, null::uuid as operatory_id, pt.branch_id,
             ti.status::text as estado, null::text as canal, ti.price_cents::bigint as valor
        from public.treatment_items ti
        cross join z
        join public.treatment_plans tp on tp.id = ti.plan_id
        left join public.patients pt on pt.id = tp.patient_id
       where ti.clinic_id = $1
         and ti.status = 'completed'
         and ti.completed_at >= ($2::date - 1)::timestamp at time zone 'UTC'
         and ti.completed_at < ($3::date + 2)::timestamp at time zone 'UTC'
    $q$
    when 'cobrado' then $q$
      select pa.id as ref_id, pa.paid_at as momento,
             (pa.paid_at at time zone z.tz)::date as fecha,
             pa.patient_id, ti.professional_id, null::uuid as operatory_id,
             coalesce(cr.branch_id, pt.branch_id) as branch_id,
             null::text as estado, null::text as canal, pa.amount_cents::bigint as valor
        from public.payments pa
        cross join z
        left join public.cash_registers cr on cr.id = pa.cash_register_id
        left join public.patients pt on pt.id = pa.patient_id
        left join public.treatment_items ti on ti.id = pa.treatment_item_id
       where pa.clinic_id = $1
         and pa.reversed_at is null
         and pa.paid_at >= ($2::date - 1)::timestamp at time zone 'UTC'
         and pa.paid_at < ($3::date + 2)::timestamp at time zone 'UTC'
    $q$
    else null
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.informe_embudo(p_clinic_id uuid, p_desde date, p_hasta date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(canal text, contactos bigint, con_cita bigint, atendidos bigint, con_presupuesto bigint, aceptados bigint, pagados bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_finanzas boolean := public.has_clinic_role(
    p_clinic_id, array['owner','admin','accounting']::public.app_role[]
  );
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta - p_desde > 731 then
    raise exception 'El período no es válido.' using errcode = '22023';
  end if;
  return query
    with z as (
      select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
        from public.clinics c where c.id = p_clinic_id
    ),
    cohorte as (
      select pt.id, pt.created_at
        from public.patients pt
        cross join z
       where pt.clinic_id = p_clinic_id
         and pt.merged_into is null
         and (pt.created_at at time zone z.tz)::date between p_desde and p_hasta
         and (p_branch_id is null or pt.branch_id = p_branch_id)
    ),
    pasos as (
      select c.id,
             coalesce((
               select x.booking_source
                 from (
                   select a.booking_source, a.created_at, a.id from public.appointments a
                    where a.clinic_id = p_clinic_id and a.patient_id = c.id
                   union all
                   -- Cita grupal (AGE-22): vale la fecha en que se inscribió.
                   select a.booking_source, gp.enrolled_at, gp.id
                     from public.appointment_group_participants gp
                     join public.appointments a on a.id = gp.appointment_id
                    where gp.clinic_id = p_clinic_id and gp.patient_id = c.id
                 ) x
                order by x.created_at, x.id limit 1
             ), 'otros') as canal,
             (
               exists (
                 select 1 from public.appointments a
                  where a.clinic_id = p_clinic_id and a.patient_id = c.id
               )
               or exists (
                 select 1 from public.appointment_group_participants gp
                  where gp.clinic_id = p_clinic_id and gp.patient_id = c.id
               )
             ) as con_cita,
             (
               exists (
                 select 1 from public.appointments a
                  where a.clinic_id = p_clinic_id and a.patient_id = c.id
                    and not exists (select 1 from public.appointment_groups g where g.appointment_id = a.id)
                    and (a.status = 'finalizada' or a.arrived_at is not null)
               )
               -- Cita grupal: atendido es quien asistió (o, sin lista, si la sesión se finalizó).
               or exists (
                 select 1
                   from public.appointment_group_participants gp
                   join public.appointments a on a.id = gp.appointment_id
                  where gp.clinic_id = p_clinic_id and gp.patient_id = c.id
                    and gp.withdrawn_at is null
                    and (gp.attendance = 'asistio'
                         or (gp.attendance = 'pendiente'
                             and (a.status = 'finalizada' or a.arrived_at is not null)))
               )
             ) as atendido,
             exists (
               select 1 from public.quotes q
                where q.clinic_id = p_clinic_id and q.patient_id = c.id
             ) as con_presupuesto,
             exists (
               select 1 from public.quotes q
                where q.clinic_id = p_clinic_id and q.patient_id = c.id
                  and q.status in ('accepted', 'converted', 'partially_accepted')
             ) as aceptado,
             case when v_finanzas then exists (
               select 1 from public.payments pa
                where pa.clinic_id = p_clinic_id and pa.patient_id = c.id
                  and pa.reversed_at is null
             ) end as pagado
        from cohorte c
    )
    select p.canal,
           count(*)::bigint,
           count(*) filter (where p.con_cita)::bigint,
           count(*) filter (where p.atendido)::bigint,
           count(*) filter (where p.con_presupuesto)::bigint,
           count(*) filter (where p.aceptado)::bigint,
           case when v_finanzas then count(*) filter (where p.pagado) end::bigint
      from pasos p
     group by p.canal;
end;
$function$;

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- Volver a aplicar las definiciones anteriores de:
--   seguimiento_datos_de_pacientes y seguimiento_planes_activos
--     (20261105200000_seguimiento_de_pacientes.sql),
--   outreach_patient_visits y list_patients_with_last_and_next_appointment
--     (la definición de producción previa a esta migración),
--   informe_hechos_sql e informe_embudo (20261107100000_informes_lecturas.sql).
-- Las columnas nuevas se pueden dejar (son nullable) o borrar:
--   alter table public.appointment_group_participants
--     drop column if exists patient_confirmed_via, drop column if exists patient_confirmed_at;
