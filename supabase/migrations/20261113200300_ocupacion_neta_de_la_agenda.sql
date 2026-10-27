-- Cierre de la fase · Bloque 5 · ítem 8: mapa de calor de la agenda con la
-- disponibilidad NETA (INF-05).
--
-- `informe_ocupacion` (20261107100000) mide los minutos agendados contra el
-- horario semanal declarado de los profesionales y dice, en su propio
-- comentario, que «bloqueos y feriados no se descuentan todavía». El efecto:
-- una clínica que cerró dos semanas por vacaciones, o que tiene un almuerzo
-- bloqueado todos los días, aparece «medio vacía» cuando en realidad no podía
-- agendar en esos tramos.
--
-- `informe_ocupacion_neta` calcula la misma grilla (día de la semana × hora)
-- pero la disponibilidad es:
--
--     horario semanal del profesional
--       − bloqueos que le tocan (del profesional, de su sucursal o de toda la
--         clínica; incluidos los que se repiten cada semana)
--       − los días feriados que manda el servidor (los feriados públicos del
--         país vienen de un servicio externo, no de la base)
--       + las aperturas excepcionales del profesional (AGE-08), también netas
--         de bloqueos y sin contar dos veces lo que ya estaba en su horario.
--
-- Qué se decidió:
--   · Un bloqueo de BOX (sin profesional) no descuenta horas del profesional:
--     el box no es el profesional. Sí cuentan los bloqueos de profesional, de
--     sucursal (para los profesionales que atienden ahí) y de toda la clínica.
--   · Un feriado descuenta el horario semanal de ese día entero; una apertura
--     excepcional puesta en un feriado SÍ cuenta (la clínica la abrió a
--     propósito).
--   · Las horas de pared de los bloqueos (`starts_local`) se leen tal cual: son
--     las mismas que usa la agenda. Un bloqueo de varios días (vacaciones)
--     descuenta cada día que toca, recortado a ese día.
--   · Además de la disponibilidad se devuelven los minutos descontados por
--     bloqueo y por feriado, para decirlo en pantalla y poder exportarlo.
--
-- Función NUEVA (no reemplaza a `informe_ocupacion`, que queda para el código
-- que todavía la llama durante el despliegue). SECURITY INVOKER: la RLS de
-- cada tabla decide qué filas cuentan. No escribe datos. Reversa al pie.

begin;

create or replace function public.informe_ocupacion_neta(
  p_clinic_id uuid,
  p_desde date,
  p_hasta date,
  p_branch_id uuid default null,
  p_professional_id uuid default null,
  p_feriados date[] default '{}'
)
returns table (
  dia_semana integer,
  hora integer,
  citas bigint,
  minutos_ocupados bigint,
  minutos_disponibles bigint,
  dias bigint,
  minutos_bloqueados bigint,
  minutos_feriado bigint
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
    dias_p as (
      select d::date as dia from generate_series(p_desde, p_hasta, interval '1 day') d
    ),
    franjas as (
      select dw, hr from generate_series(0, 6) dw cross join generate_series(0, 23) hr
    ),
    -- ── Lo agendado (igual que informe_ocupacion) ─────────────────────────
    citas_p as (
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
        from citas_p c
        cross join lateral generate_series(date_trunc('hour', c.ini), c.fin - interval '1 microsecond', interval '1 hour') s
       group by 1, 2
    ),
    -- ── Horario semanal declarado, un tramo por profesional y día ─────────
    ventanas as (
      select d.dia, ps.professional_id, ps.branch_id,
             tsrange(d.dia + ps.start_time, d.dia + ps.end_time) as r
        from dias_p d
        join public.professional_schedules ps
          on ps.clinic_id = p_clinic_id and ps.day_of_week = extract(dow from d.dia)::int
       where (p_branch_id is null or ps.branch_id is null or ps.branch_id = p_branch_id)
         and (p_professional_id is null or ps.professional_id = p_professional_id)
    ),
    -- ── Bloqueos y aperturas, ya recortados a cada día ────────────────────
    exc as (
      select d.dia, e.kind, e.professional_id, e.branch_id, e.operatory_id,
             (case
                when e.repeat_weekly then tsrange(
                  d.dia + e.starts_local::time,
                  case when e.ends_local::date > e.starts_local::date
                       then (d.dia + 1)::timestamp
                       else d.dia + e.ends_local::time end
                )
                else tsrange(e.starts_local, e.ends_local)
              end) * tsrange(d.dia::timestamp, (d.dia + 1)::timestamp) as r
        from dias_p d
        join public.agenda_exceptions e on e.clinic_id = p_clinic_id
       where (
               e.repeat_weekly
               and d.dia >= e.starts_local::date
               and (e.repeat_until is null or d.dia <= e.repeat_until)
               and extract(dow from d.dia) = extract(dow from e.starts_local)
             )
          or (
               not e.repeat_weekly
               and e.starts_local < (d.dia + 1)::timestamp
               and e.ends_local > d.dia::timestamp
             )
    ),
    bloqueos as (
      select * from exc where kind = 'bloqueo' and not isempty(r)
    ),
    aperturas as (
      select * from exc
       where kind = 'apertura' and professional_id is not null and not isempty(r)
         and (p_professional_id is null or professional_id = p_professional_id)
         and (p_branch_id is null or branch_id is null or branch_id = p_branch_id)
    ),
    -- ── Horario menos bloqueos, por tramo ─────────────────────────────────
    libres as (
      select v.dia, v.r,
             (v.dia = any(coalesce(p_feriados, '{}'::date[]))) as feriado,
             tsmultirange(v.r) - coalesce((
               select range_agg(b.r)
                 from bloqueos b
                where b.dia = v.dia
                  and (
                    b.professional_id = v.professional_id
                    or (b.professional_id is null and b.operatory_id is null
                        and (b.branch_id is null or b.branch_id = coalesce(v.branch_id, p_branch_id)))
                  )
             ), '{}'::tsmultirange) as libre
        from ventanas v
    ),
    por_hora as (
      select extract(dow from l.dia)::int as dw, h.hr,
             case when l.feriado then 0 else m.libre_min end as disponible,
             case when l.feriado then 0 else m.bruto_min - m.libre_min end as bloqueado,
             case when l.feriado then m.bruto_min else 0 end as feriado
        from libres l
        cross join lateral generate_series(
          extract(hour from lower(l.r))::int,
          extract(hour from upper(l.r) - interval '1 microsecond')::int
        ) h(hr)
        cross join lateral (
          select
            coalesce((
              select sum(extract(epoch from (upper(x) - lower(x))) / 60)
                from unnest(
                  tsmultirange(l.r) * tsmultirange(tsrange(
                    l.dia + make_interval(hours => h.hr),
                    l.dia + make_interval(hours => h.hr + 1)))
                ) x
            ), 0) as bruto_min,
            coalesce((
              select sum(extract(epoch from (upper(x) - lower(x))) / 60)
                from unnest(
                  l.libre * tsmultirange(tsrange(
                    l.dia + make_interval(hours => h.hr),
                    l.dia + make_interval(hours => h.hr + 1)))
                ) x
            ), 0) as libre_min
        ) m
    ),
    -- ── Aperturas excepcionales netas de horario y de bloqueos ────────────
    aper_netas as (
      select a.dia,
             tsmultirange(a.r)
               - coalesce((
                   select range_agg(v.r) from ventanas v
                    where v.dia = a.dia and v.professional_id = a.professional_id
                 ), '{}'::tsmultirange)
               - coalesce((
                   select range_agg(b.r) from bloqueos b
                    where b.dia = a.dia
                      and (
                        b.professional_id = a.professional_id
                        or (b.professional_id is null and b.operatory_id is null
                            and (b.branch_id is null or b.branch_id = coalesce(a.branch_id, p_branch_id)))
                      )
                 ), '{}'::tsmultirange) as mr
        from aperturas a
    ),
    aper_hora as (
      select extract(dow from n.dia)::int as dw, h.hr,
             coalesce((
               select sum(extract(epoch from (upper(x) - lower(x))) / 60)
                 from unnest(
                   n.mr * tsmultirange(tsrange(
                     n.dia + make_interval(hours => h.hr),
                     n.dia + make_interval(hours => h.hr + 1)))
                 ) x
             ), 0) as disponible
        from aper_netas n
        cross join generate_series(0, 23) h(hr)
       where not isempty(n.mr)
    ),
    horario as (
      select t.dw, t.hr,
             round(sum(t.disponible))::bigint as disponible,
             round(sum(t.bloqueado))::bigint as bloqueado,
             round(sum(t.feriado))::bigint as feriado
        from (
          select dw, hr, disponible, bloqueado, feriado from por_hora
          union all
          select dw, hr, disponible, 0, 0 from aper_hora
        ) t
       group by 1, 2
    ),
    cuenta as (
      select extract(dow from d.dia)::int as dw, count(*)::bigint as n from dias_p d group by 1
    )
    select f.dw, f.hr,
           coalesce(o.n, 0)::bigint,
           coalesce(o.minutos, 0)::bigint,
           coalesce(hz.disponible, 0)::bigint,
           coalesce(cu.n, 0)::bigint,
           coalesce(hz.bloqueado, 0)::bigint,
           coalesce(hz.feriado, 0)::bigint
      from franjas f
      cross join z
      left join ocupado o on o.dw = f.dw and o.hr = f.hr
      left join horario hz on hz.dw = f.dw and hz.hr = f.hr
      left join cuenta cu on cu.dw = f.dw
     where coalesce(o.minutos, 0) > 0
        or coalesce(hz.disponible, 0) > 0
        or coalesce(hz.bloqueado, 0) > 0
        or coalesce(hz.feriado, 0) > 0;
end;
$$;

comment on function public.informe_ocupacion_neta(uuid, date, date, uuid, uuid, date[]) is
  'INF-05: minutos agendados y disponibles por día de la semana (0 = domingo) y hora, con el horario neto de bloqueos y feriados (más las aperturas excepcionales). Devuelve también los minutos descontados. SECURITY INVOKER.';

revoke all on function public.informe_ocupacion_neta(uuid, date, date, uuid, uuid, date[]) from public, anon;
grant execute on function public.informe_ocupacion_neta(uuid, date, date, uuid, uuid, date[]) to authenticated, service_role;

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- drop function if exists public.informe_ocupacion_neta(uuid, date, date, uuid, uuid, date[]);
