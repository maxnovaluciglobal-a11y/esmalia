-- Cierre de la fase · Bloque 5 · ítem 7: campo opcional «sexo» en la ficha del
-- paciente y su corte demográfico en Informes.
--
--   · patients.sex: nullable (NULL = sin registrar). «prefiere_no_decir» es una
--     respuesta distinta de no haber preguntado; el informe las muestra por
--     separado y nunca reparte «Sin dato».
--   · informe_corte_admitido / informe_corte_sql: el corte 'sexo' (lista
--     cerrada, como edad, comuna, previsión y origen).
--
-- Compatible con el código que está en producción: solo agrega una columna
-- NULLABLE y redefine dos funciones puras (immutable) agregando un caso; el
-- código viejo no conoce el corte y no lo pide. No escribe datos.
--
-- Las dos funciones se redefinen partiendo de su definición en producción del
-- 27-oct-2026 (`pg_get_functiondef`), sin perder comportamiento.
-- Reversa al pie.

begin;

alter table public.patients
  add column if not exists sex text
    check (sex in ('femenino', 'masculino', 'otro', 'prefiere_no_decir'));

comment on column public.patients.sex is
  'Sexo declarado por el paciente (opcional). NULL = sin registrar; prefiere_no_decir es una respuesta. Solo para el corte demográfico de Informes; no cuenta para la ficha completa.';

CREATE OR REPLACE FUNCTION public.informe_corte_admitido(p_metrica text, p_corte text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_corte in ('total', 'dia', 'semana', 'mes', 'dia_semana', 'profesional', 'sucursal',
                     'edad', 'comuna', 'prevision', 'origen', 'sexo') then true
    when p_corte in ('hora', 'box', 'estado', 'canal') then public.informe_metrica_es_de_agenda(p_metrica)
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.informe_corte_sql(p_corte text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
    when 'sexo' then $e$nullif(btrim(p.sex), '')$e$
    else null
  end;
$function$;

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- Volver a aplicar las definiciones de informe_corte_admitido e
-- informe_corte_sql de 20261107100000_informes_lecturas.sql, y después:
--   alter table public.patients drop column if exists sex;   -- (borra el dato)
