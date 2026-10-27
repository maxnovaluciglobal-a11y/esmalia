-- Ola 11 · frente A (1/2): lecturas de los informes "por pregunta"
-- (INF-02 a INF-10).
--
-- Mismo criterio que las `finanzas_*` del #183 (20261106100300): las sumas se
-- hacen en Postgres porque PostgREST corta en `max_rows` sin avisar, y todas
-- son SECURITY INVOKER, así que la RLS de cada tabla (incluida la de MFA)
-- decide qué filas cuentan, igual que en un SELECT por REST. Una clínica de
-- la que el usuario no es miembro no aporta filas.
--
-- Dinero (regla 15): las métricas en cents (producción, cobrado,
-- presupuestado) y el paso "pagado" del embudo exigen además un rol con
-- finanzas (owner, admin, accounting y, por has_clinic_role, coordinator):
-- sin él, la métrica falla con 42501 y el embudo devuelve NULL en "pagados"
-- (no un cero inventado, regla 11). El servidor repite el chequeo con la
-- matriz de access.ts antes de llamarlas.
--
-- Fechas (regla 7): `p_desde`/`p_hasta` son días civiles de la clínica. Cada
-- `timestamptz` se pasa a la zona de la clínica antes de compararlo o de
-- cortarlo por día u hora.
--
-- `informe_metrica` e `informe_detalle` arman su SQL con fragmentos de una
-- lista cerrada (métrica y corte se validan contra ella antes de usarse);
-- ningún texto del cliente llega al SQL. Los valores van como parámetros.
--
-- No cambian ninguna tabla ni política, no escriben datos ni redefinen
-- funciones existentes. Reversa al pie.

begin;

-- ─── 0. Catálogo: métricas, cortes y los fragmentos de SQL ────────────────

-- Métricas de la agenda: admiten todos los cortes (incluidos hora, box,
-- estado y canal). El resto, solo los cortes de tiempo, persona y paciente.
create or replace function public.informe_metrica_es_de_agenda(p_metrica text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metrica in ('citas', 'atenciones', 'ausencias', 'cancelaciones', 'horas_agendadas');
$$;

create or replace function public.informe_metrica_es_dinero(p_metrica text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metrica in ('produccion', 'cobrado', 'presupuestado');
$$;

create or replace function public.informe_corte_admitido(p_metrica text, p_corte text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_corte in ('total', 'dia', 'semana', 'mes', 'dia_semana', 'profesional', 'sucursal',
                     'edad', 'comuna', 'prevision', 'origen') then true
    when p_corte in ('hora', 'box', 'estado', 'canal') then public.informe_metrica_es_de_agenda(p_metrica)
    else false
  end;
$$;

-- Hechos de cada métrica, con las mismas columnas:
--   ref_id, momento (timestamptz o NULL), fecha (día civil de la clínica),
--   patient_id, professional_id, operatory_id, branch_id, estado, canal,
--   valor (1 para conteos; minutos o cents si la métrica es una suma).
-- Usan `z` (zona de la clínica) y los parámetros $1 = clínica, $2 = desde,
-- $3 = hasta. El filtro grueso por timestamptz (un día de margen) deja usar
-- los índices; el fino se hace por `fecha` afuera.
create or replace function public.informe_hechos_sql(p_metrica text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
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
begin
  return case p_metrica
    when 'citas' then format(v_citas, '1::bigint', $f$a.status <> 'cancelada'$f$)
    when 'atenciones' then format(v_citas, '1::bigint', $f$a.status = 'finalizada'$f$)
    when 'ausencias' then format(v_citas, '1::bigint', $f$a.status = 'ausente'$f$)
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
$$;

-- Expresión de cada corte sobre `h` (hechos), `p` (paciente) y `z` (zona).
-- NULL = "Sin dato" (paciente sin fecha de nacimiento, sin comuna, cita sin
-- box…): la UI lo muestra como tal, nunca lo reparte.
create or replace function public.informe_corte_sql(p_corte text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_corte
    when 'total' then $e$'total'$e$
    when 'dia' then $e$to_char(h.fecha, 'YYYY-MM-DD')$e$
    when 'semana' then $e$to_char(date_trunc('week', h.fecha)::date, 'YYYY-MM-DD')$e$
    when 'mes' then $e$to_char(h.fecha, 'YYYY-MM')$e$
    when 'dia_semana' then $e$extract(dow from h.fecha)::int::text$e$
    when 'hora' then $e$lpad(extract(hour from (h.momento at time zone z.tz))::int::text, 2, '0')$e$
    when 'profesional' then $e$h.professional_id::text$e$
    when 'box' then $e$h.operatory_id::text$e$
    when 'sucursal' then $e$h.branch_id::text$e$
    when 'estado' then $e$h.estado$e$
    when 'canal' then $e$h.canal$e$
    when 'edad' then $e$case
        when p.birth_date is null or p.birth_date > h.fecha then null
        when extract(year from age(h.fecha, p.birth_date)) < 12 then '0-11'
        when extract(year from age(h.fecha, p.birth_date)) < 18 then '12-17'
        when extract(year from age(h.fecha, p.birth_date)) < 30 then '18-29'
        when extract(year from age(h.fecha, p.birth_date)) < 45 then '30-44'
        when extract(year from age(h.fecha, p.birth_date)) < 60 then '45-59'
        else '60+'
      end$e$
    when 'comuna' then $e$initcap(lower(nullif(btrim(p.commune), '')))$e$
    when 'prevision' then $e$nullif(btrim(p.health_plan), '')$e$
    when 'origen' then $e$nullif(btrim(p.acquisition_source), '')$e$
    else null
  end;
$$;

-- Valida métrica, cortes, rango y dinero. Común a métrica y detalle.
create or replace function public.informe_validar(
  p_clinic_id uuid,
  p_metrica text,
  p_desde date,
  p_hasta date,
  p_corte text,
  p_corte2 text
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.informe_hechos_sql(p_metrica) is null then
    raise exception 'Métrica desconocida.' using errcode = '22023';
  end if;
  if not public.informe_corte_admitido(p_metrica, p_corte)
     or not public.informe_corte_admitido(p_metrica, p_corte2) then
    raise exception 'Ese corte no aplica a esta métrica.' using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El período no es válido.' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 731 then
    raise exception 'El período puede tener hasta dos años.' using errcode = '22023';
  end if;
  if public.informe_metrica_es_dinero(p_metrica)
     and not public.has_clinic_role(p_clinic_id, array['owner','admin','accounting']::public.app_role[]) then
    raise exception 'No tienes permisos para ver montos.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.informe_metrica_es_de_agenda(text) from public, anon;
revoke all on function public.informe_metrica_es_dinero(text) from public, anon;
revoke all on function public.informe_corte_admitido(text, text) from public, anon;
revoke all on function public.informe_hechos_sql(text) from public, anon;
revoke all on function public.informe_corte_sql(text) from public, anon;
revoke all on function public.informe_validar(uuid, text, date, date, text, text) from public, anon;
grant execute on function public.informe_metrica_es_de_agenda(text) to authenticated, service_role;
grant execute on function public.informe_metrica_es_dinero(text) to authenticated, service_role;
grant execute on function public.informe_corte_admitido(text, text) to authenticated, service_role;
grant execute on function public.informe_hechos_sql(text) to authenticated, service_role;
grant execute on function public.informe_corte_sql(text) to authenticated, service_role;
grant execute on function public.informe_validar(uuid, text, date, date, text, text) to authenticated, service_role;

-- ─── 1. INF-02 / INF-04 / INF-08 / INF-09 / INF-10: una métrica por cortes ──
-- Devuelve una fila por combinación de cortes: suma (`valor`), cantidad de
-- hechos (`n`) y pacientes distintos (`pacientes`). Filtros opcionales por
-- sucursal y profesional.
create or replace function public.informe_metrica(
  p_clinic_id uuid,
  p_metrica text,
  p_desde date,
  p_hasta date,
  p_corte text default 'total',
  p_corte2 text default 'total',
  p_branch_id uuid default null,
  p_professional_id uuid default null
)
returns table (clave text, clave2 text, valor bigint, n bigint, pacientes bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform public.informe_validar(p_clinic_id, p_metrica, p_desde, p_hasta, p_corte, p_corte2);
  return query execute format(
    $sql$
      with z as (
        select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
          from public.clinics c where c.id = $1
      ),
      h as (
        select b.* from (%s) b
         where b.fecha between $2 and $3
           and ($4::uuid is null or b.branch_id = $4)
           and ($5::uuid is null or b.professional_id = $5)
      )
      select (%s)::text, (%s)::text, sum(h.valor)::bigint, count(*)::bigint,
             count(distinct h.patient_id)::bigint
        from h
        cross join z
        left join public.patients p on p.id = h.patient_id
       group by 1, 2
    $sql$,
    public.informe_hechos_sql(p_metrica),
    public.informe_corte_sql(p_corte),
    public.informe_corte_sql(p_corte2)
  ) using p_clinic_id, p_desde, p_hasta, p_branch_id, p_professional_id;
end;
$$;

comment on function public.informe_metrica(uuid, text, date, date, text, text, uuid, uuid) is
  'INF-02/04/08/09/10: una métrica del período agrupada por hasta dos cortes (lista cerrada). Montos solo con rol de finanzas (42501). SECURITY INVOKER.';

revoke all on function public.informe_metrica(uuid, text, date, date, text, text, uuid, uuid) from public, anon;
grant execute on function public.informe_metrica(uuid, text, date, date, text, text, uuid, uuid)
  to authenticated, service_role;

-- ─── 2. INF-03: el detalle de una cifra ────────────────────────────────────
-- Los hechos que componen una celda (corte = clave, corte2 = clave2; NULL =
-- "Sin dato"), los más recientes primero, con el total aunque se corte en
-- `p_limite`.
create or replace function public.informe_detalle(
  p_clinic_id uuid,
  p_metrica text,
  p_desde date,
  p_hasta date,
  p_corte text default 'total',
  p_clave text default 'total',
  p_corte2 text default 'total',
  p_clave2 text default 'total',
  p_branch_id uuid default null,
  p_professional_id uuid default null,
  p_limite integer default 200
)
returns table (
  ref_id uuid,
  momento timestamptz,
  fecha date,
  patient_id uuid,
  professional_id uuid,
  operatory_id uuid,
  branch_id uuid,
  estado text,
  valor bigint,
  total bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform public.informe_validar(p_clinic_id, p_metrica, p_desde, p_hasta, p_corte, p_corte2);
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'El límite va de 1 a 1000.' using errcode = '22023';
  end if;
  return query execute format(
    $sql$
      with z as (
        select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
          from public.clinics c where c.id = $1
      ),
      h as (
        select b.* from (%s) b
         where b.fecha between $2 and $3
           and ($4::uuid is null or b.branch_id = $4)
           and ($5::uuid is null or b.professional_id = $5)
      ),
      f as (
        select h.ref_id, h.momento, h.fecha, h.patient_id, h.professional_id,
               h.operatory_id, h.branch_id, h.estado, h.valor
          from h
          cross join z
          left join public.patients p on p.id = h.patient_id
         where (%s)::text is not distinct from $6
           and (%s)::text is not distinct from $7
      )
      select f.*, count(*) over ()::bigint
        from f
       order by f.momento desc nulls last, f.fecha desc, f.ref_id
       limit $8
    $sql$,
    public.informe_hechos_sql(p_metrica),
    public.informe_corte_sql(p_corte),
    public.informe_corte_sql(p_corte2)
  ) using p_clinic_id, p_desde, p_hasta, p_branch_id, p_professional_id, p_clave, p_clave2, p_limite;
end;
$$;

comment on function public.informe_detalle(uuid, text, date, date, text, text, text, text, uuid, uuid, integer) is
  'INF-03: los hechos que componen una cifra de informe_metrica (hasta 1000, con el total). Montos solo con rol de finanzas. SECURITY INVOKER.';

revoke all on function public.informe_detalle(uuid, text, date, date, text, text, text, text, uuid, uuid, integer) from public, anon;
grant execute on function public.informe_detalle(uuid, text, date, date, text, text, text, text, uuid, uuid, integer)
  to authenticated, service_role;

-- ─── 3. INF-05: mapa de calor de la agenda (día de la semana × hora) ───────
-- minutos_ocupados: citas no canceladas, repartidas en cada hora que tocan.
-- minutos_disponibles: horario declarado de los profesionales
--   (professional_schedules, 0 = domingo) en cada día del período. 0 = no
--   hay horario declarado para esa franja; la UI lo muestra sin porcentaje.
-- dias: cuántas veces aparece ese día de la semana en el período.
-- Bloqueos y feriados (agenda_exceptions) no se descuentan todavía.
create or replace function public.informe_ocupacion(
  p_clinic_id uuid,
  p_desde date,
  p_hasta date,
  p_branch_id uuid default null,
  p_professional_id uuid default null
)
returns table (
  dia_semana integer,
  hora integer,
  citas bigint,
  minutos_ocupados bigint,
  minutos_disponibles bigint,
  dias bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta - p_desde > 731 then
    raise exception 'El período no es válido.' using errcode = '22023';
  end if;
  return query
    with z as (
      select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
        from public.clinics c where c.id = p_clinic_id
    ),
    dias as (
      select d::date as dia from generate_series(p_desde, p_hasta, interval '1 day') d
    ),
    franjas as (
      select dw, hr from generate_series(0, 6) dw cross join generate_series(0, 23) hr
    ),
    citas as (
      select (a.starts_at at time zone z.tz) as ini, (a.ends_at at time zone z.tz) as fin
        from public.appointments a
        cross join z
       where a.clinic_id = p_clinic_id
         and a.status <> 'cancelada'
         and a.ends_at > a.starts_at
         and (a.starts_at at time zone z.tz)::date between p_desde and p_hasta
         and (p_branch_id is null or a.branch_id = p_branch_id)
         and (p_professional_id is null or a.professional_id = p_professional_id)
    ),
    ocupado as (
      select extract(dow from s)::int as dw, extract(hour from s)::int as hr,
             sum(extract(epoch from (least(c.fin, s + interval '1 hour') - greatest(c.ini, s))) / 60)::bigint as minutos,
             count(*) filter (where s = date_trunc('hour', c.ini))::bigint as n
        from citas c
        cross join lateral generate_series(date_trunc('hour', c.ini), c.fin - interval '1 microsecond', interval '1 hour') s
       group by 1, 2
    ),
    horario as (
      select extract(dow from d.dia)::int as dw, hr.hr,
             sum(greatest(0,
               least(extract(epoch from ps.end_time) / 60, hr.hr * 60 + 60)
               - greatest(extract(epoch from ps.start_time) / 60, hr.hr * 60)
             ))::bigint as minutos
        from dias d
        join public.professional_schedules ps
          on ps.clinic_id = p_clinic_id and ps.day_of_week = extract(dow from d.dia)::int
        cross join generate_series(0, 23) hr(hr)
       where (p_branch_id is null or ps.branch_id is null or ps.branch_id = p_branch_id)
         and (p_professional_id is null or ps.professional_id = p_professional_id)
         and extract(epoch from ps.start_time) / 60 < hr.hr * 60 + 60
         and extract(epoch from ps.end_time) / 60 > hr.hr * 60
       group by 1, 2
    ),
    cuenta as (
      select extract(dow from d.dia)::int as dw, count(*)::bigint as n from dias d group by 1
    )
    select f.dw, f.hr,
           coalesce(o.n, 0)::bigint,
           coalesce(o.minutos, 0)::bigint,
           coalesce(hz.minutos, 0)::bigint,
           coalesce(cu.n, 0)::bigint
      from franjas f
      cross join z
      left join ocupado o on o.dw = f.dw and o.hr = f.hr
      left join horario hz on hz.dw = f.dw and hz.hr = f.hr
      left join cuenta cu on cu.dw = f.dw
     where coalesce(o.minutos, 0) > 0 or coalesce(hz.minutos, 0) > 0;
end;
$$;

comment on function public.informe_ocupacion(uuid, date, date, uuid, uuid) is
  'INF-05: minutos agendados y disponibles por día de la semana (0 = domingo) y hora, en la zona de la clínica. SECURITY INVOKER.';

revoke all on function public.informe_ocupacion(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.informe_ocupacion(uuid, date, date, uuid, uuid) to authenticated, service_role;

-- ─── 4. INF-06: uso por box ────────────────────────────────────────────────
-- Por box (operatories) del período: citas y atenciones, minutos ocupados y
-- minutos que la sucursal del box estuvo abierta (branch_hours). Las citas
-- sin box salen en una fila con operatory_id NULL. Boxes activos sin citas
-- aparecen con 0 (es un cero real: el box existe y no se usó).
create or replace function public.informe_uso_box(
  p_clinic_id uuid,
  p_desde date,
  p_hasta date,
  p_branch_id uuid default null
)
returns table (
  operatory_id uuid,
  branch_id uuid,
  citas bigint,
  atenciones bigint,
  minutos_ocupados bigint,
  minutos_abiertos bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta - p_desde > 731 then
    raise exception 'El período no es válido.' using errcode = '22023';
  end if;
  return query
    with z as (
      select coalesce(nullif(c.timezone, ''), 'America/Santiago') as tz
        from public.clinics c where c.id = p_clinic_id
    ),
    uso as (
      select a.operatory_id, a.branch_id,
             count(*)::bigint as citas,
             count(*) filter (where a.status = 'finalizada')::bigint as atenciones,
             sum(greatest(0, round(extract(epoch from (a.ends_at - a.starts_at)) / 60)))::bigint as minutos
        from public.appointments a
        cross join z
       where a.clinic_id = p_clinic_id
         and a.status <> 'cancelada'
         and (a.starts_at at time zone z.tz)::date between p_desde and p_hasta
         and (p_branch_id is null or a.branch_id = p_branch_id)
       group by 1, 2
    ),
    abierto as (
      select bh.branch_id,
             sum(extract(epoch from (bh.closes_at - bh.opens_at)) / 60)::bigint as minutos
        from generate_series(p_desde, p_hasta, interval '1 day') d
        join public.branch_hours bh
          on bh.clinic_id = p_clinic_id and bh.day_of_week = extract(dow from d)::int
       group by 1
    ),
    boxes as (
      select o.id as operatory_id
        from public.operatories o
       where o.clinic_id = p_clinic_id
         and o.is_active
         and (p_branch_id is null or o.branch_id = p_branch_id)
    ),
    filas as (
      select b.operatory_id from boxes b
      union
      select u.operatory_id from uso u
    )
    select f.operatory_id, o.branch_id,
           coalesce(sum(u.citas), 0)::bigint,
           coalesce(sum(u.atenciones), 0)::bigint,
           coalesce(sum(u.minutos), 0)::bigint,
           max(ab.minutos)::bigint
      from filas f
      left join public.operatories o on o.id = f.operatory_id
      left join uso u on u.operatory_id is not distinct from f.operatory_id
      left join abierto ab on ab.branch_id = o.branch_id
     group by f.operatory_id, o.branch_id;
end;
$$;

comment on function public.informe_uso_box(uuid, date, date, uuid) is
  'INF-06: citas, atenciones y minutos ocupados por box, y minutos abiertos de su sucursal en el período. SECURITY INVOKER.';

revoke all on function public.informe_uso_box(uuid, date, date, uuid) from public, anon;
grant execute on function public.informe_uso_box(uuid, date, date, uuid) to authenticated, service_role;

-- ─── 5. INF-07: embudo contacto → cita → atención → presupuesto → aceptado → pagado ─
-- Cohorte: fichas creadas en el período (incluye las que crea la reserva en
-- línea). Cada paso cuenta pacientes de esa cohorte que llegaron a él, en
-- cualquier momento desde que se creó la ficha hasta hoy.
-- canal: 'reserva_en_linea' si la primera cita del paciente vino de la
-- reserva en línea; si no, 'otros'.
-- pagados: NULL sin rol de finanzas (regla 15; nunca un cero inventado).
create or replace function public.informe_embudo(
  p_clinic_id uuid,
  p_desde date,
  p_hasta date,
  p_branch_id uuid default null
)
returns table (
  canal text,
  contactos bigint,
  con_cita bigint,
  atendidos bigint,
  con_presupuesto bigint,
  aceptados bigint,
  pagados bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
               select a.booking_source from public.appointments a
                where a.clinic_id = p_clinic_id and a.patient_id = c.id
                order by a.created_at, a.id limit 1
             ), 'otros') as canal,
             exists (
               select 1 from public.appointments a
                where a.clinic_id = p_clinic_id and a.patient_id = c.id
             ) as con_cita,
             exists (
               select 1 from public.appointments a
                where a.clinic_id = p_clinic_id and a.patient_id = c.id
                  and (a.status = 'finalizada' or a.arrived_at is not null)
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
$$;

comment on function public.informe_embudo(uuid, date, date, uuid) is
  'INF-07: embudo de las fichas creadas en el período por canal (reserva en línea u otros). pagados = NULL sin rol de finanzas. SECURITY INVOKER.';

revoke all on function public.informe_embudo(uuid, date, date, uuid) from public, anon;
grant execute on function public.informe_embudo(uuid, date, date, uuid) to authenticated, service_role;

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- drop function if exists public.informe_embudo(uuid, date, date, uuid);
-- drop function if exists public.informe_uso_box(uuid, date, date, uuid);
-- drop function if exists public.informe_ocupacion(uuid, date, date, uuid, uuid);
-- drop function if exists public.informe_detalle(uuid, text, date, date, text, text, text, text, uuid, uuid, integer);
-- drop function if exists public.informe_metrica(uuid, text, date, date, text, text, uuid, uuid);
-- drop function if exists public.informe_validar(uuid, text, date, date, text, text);
-- drop function if exists public.informe_corte_sql(text);
-- drop function if exists public.informe_hechos_sql(text);
-- drop function if exists public.informe_corte_admitido(text, text);
-- drop function if exists public.informe_metrica_es_dinero(text);
-- drop function if exists public.informe_metrica_es_de_agenda(text);
