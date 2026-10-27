-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 11 · frente B · PAN-03/04/06/07/08: el panel de Hoy por rol.
--
-- `panel_de_hoy(clinic_id)` arma en una sola llamada lo que Hoy necesita para
-- las alertas accionables ("lo que requiere acción") y los bloques por rol:
-- reservas en línea por aceptar, controles vencidos, órdenes de laboratorio,
-- insumos bajo el mínimo, cajas sin cerrar, cuotas de membresía vencidas,
-- presupuestos, notas sin firmar y el desempeño propio.
--
-- Por qué en la base y no en la app:
--  - SECURITY INVOKER: corre con la RLS del usuario. Nada de lo que devuelve
--    es más de lo que la persona ya puede leer tabla por tabla.
--  - Además, cada sección se pide solo si el permiso de la matriz
--    (`src/lib/access/access.ts`) lo da, con los ajustes por persona del
--    #181 (`permiso_quitado`). Esto importa para el dinero: la RLS de
--    `membership_charges` deja leer a recepción (cobra cuotas en el
--    mostrador), pero Hoy solo muestra montos a quien tiene `finance:view`
--    (owner, admin, coordinación, contabilidad). Regla 15: este es el par en
--    el servidor del gate de la pantalla.
--  - "Hoy" es el de la clínica (`clinics.timezone`), nunca el reloj UTC.
--
-- Solo lee: no escribe nada, no redefine funciones existentes.
--
-- Cómo revertir: `drop function if exists public.panel_de_hoy(uuid);` (la app
-- cae a mostrar Hoy sin alertas nuevas; nada más depende de esta función).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.panel_de_hoy(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_hoy date;
  v_inicio timestamptz;
  v_inicio_mes timestamptz;
  -- Permisos (espejo de ROLE_PERMISSIONS en access.ts; coordinator entra
  -- por has_clinic_role como recepción + contabilidad).
  v_agenda boolean;
  v_finanzas boolean;
  v_caja boolean;
  v_ve_todas_las_cajas boolean;
  v_inventario boolean;
  v_clinico boolean;
  v_solo_lo_propio boolean;
  v_prof uuid;
  r jsonb := '{}'::jsonb;
  alertas jsonb := '{}'::jsonb;
begin
  if v_uid is null or not public.is_clinic_member(p_clinic_id) then
    raise exception 'No tienes permisos para esta clínica.' using errcode = '42501';
  end if;

  select coalesce(nullif(c.timezone, ''), 'America/Santiago')
    into v_tz
    from public.clinics c
   where c.id = p_clinic_id;
  v_tz := coalesce(v_tz, 'America/Santiago');
  v_hoy := (now() at time zone v_tz)::date;
  v_inicio := (v_hoy::timestamp at time zone v_tz);
  v_inicio_mes := (date_trunc('month', v_hoy)::timestamp at time zone v_tz);

  v_agenda := public.has_clinic_role(p_clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
              and not public.permiso_quitado(p_clinic_id, 'agenda:manage');
  v_finanzas := public.has_clinic_role(p_clinic_id, array['owner','admin','accounting']::public.app_role[]);
  v_caja := public.has_clinic_role(p_clinic_id, array['owner','admin','reception','accounting']::public.app_role[]);
  v_ve_todas_las_cajas := public.can_manage_clinic(p_clinic_id);
  v_inventario := public.has_clinic_role(p_clinic_id, array['owner','admin','dentist','assistant','reception','lab_technician']::public.app_role[]);
  v_clinico := public.has_clinic_role(p_clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
               and not public.permiso_quitado(p_clinic_id, 'clinical:write');
  -- Un profesional sin otro rol ve lo suyo (sus órdenes de laboratorio).
  v_solo_lo_propio := public.has_clinic_role(p_clinic_id, array['dentist']::public.app_role[])
                      and not public.has_clinic_role(p_clinic_id, array['owner','admin','reception','lab_technician']::public.app_role[]);

  select p.id into v_prof
    from public.professionals p
   where p.clinic_id = p_clinic_id and p.user_id = v_uid
   order by p.created_at
   limit 1;

  r := jsonb_build_object('hoy', v_hoy, 'zona_horaria', v_tz);

  -- ── Agenda: confirmaciones, reservas en línea y controles ──────────────
  if v_agenda then
    alertas := alertas || jsonb_build_object(
      'citas_por_confirmar', (
        select count(*) from public.appointments a
         where a.clinic_id = p_clinic_id
           and a.status = 'tentativa'
           and a.patient_confirmed_at is null
           and coalesce(a.booking_source, '') <> 'reserva_en_linea'
           and a.starts_at >= now()
           and a.starts_at < v_inicio + interval '3 days'),
      'reservas_por_aceptar', (
        select count(*) from public.appointments a
         where a.clinic_id = p_clinic_id
           and a.status = 'tentativa'
           and a.booking_source = 'reserva_en_linea'
           and a.starts_at >= now()),
      'controles_vencidos', (
        select count(*) from public.patient_controls pc
          join public.patients pa on pa.id = pc.patient_id
         where pc.clinic_id = p_clinic_id
           and pc.status = 'pendiente'
           and pc.due_on < v_hoy
           and pa.archived_at is null)
    );
    r := r || jsonb_build_object('reservas', coalesce((
      select jsonb_agg(x order by x->>'inicio') from (
        select jsonb_build_object(
                 'id', a.id,
                 'paciente_id', a.patient_id,
                 'paciente', pa.full_name,
                 'profesional_id', a.professional_id,
                 'tratamiento', a.treatment_label,
                 'inicio', a.starts_at) as x
          from public.appointments a
          left join public.patients pa on pa.id = a.patient_id
         where a.clinic_id = p_clinic_id
           and a.status = 'tentativa'
           and a.booking_source = 'reserva_en_linea'
           and a.starts_at >= now()
         order by a.starts_at
         limit 5) s), '[]'::jsonb));
  end if;

  -- ── Laboratorio (la RLS de lab_orders decide quién lo lee) ─────────────
  r := r || jsonb_build_object('laboratorio', (
    select jsonb_build_object(
             'atrasadas', count(*) filter (where o.due_on < v_hoy),
             'en_curso', count(*),
             'por_recibir_semana', count(*) filter (where o.due_on between v_hoy and v_hoy + 7),
             'ordenes', coalesce((
               select jsonb_agg(y order by (y->>'atrasada')::boolean desc, y->>'vence' nulls last)
                 from (
                   select jsonb_build_object(
                            'id', o2.id,
                            'paciente_id', o2.patient_id,
                            'paciente', pa.full_name,
                            'descripcion', o2.description,
                            'laboratorio', o2.lab_name_snapshot,
                            'estado', o2.status,
                            'vence', o2.due_on,
                            'atrasada', coalesce(o2.due_on < v_hoy, false)) as y
                     from public.lab_orders o2
                     left join public.patients pa on pa.id = o2.patient_id
                    where o2.clinic_id = p_clinic_id
                      and o2.status in ('enviado', 'en_proceso', 'reprocesar')
                      and (not v_solo_lo_propio or o2.professional_id = v_prof)
                    order by o2.due_on asc nulls last
                    limit 6) s2), '[]'::jsonb))
      from public.lab_orders o
     where o.clinic_id = p_clinic_id
       and o.status in ('enviado', 'en_proceso', 'reprocesar')
       and (not v_solo_lo_propio or o.professional_id = v_prof)));
  alertas := alertas || jsonb_build_object(
    'laboratorio_atrasado', ((r->'laboratorio'->>'atrasadas')::int));

  -- ── Inventario: insumos en o bajo el mínimo (REC-10) ───────────────────
  if v_inventario then
    r := r || jsonb_build_object('stock_bajo', coalesce((
      select jsonb_agg(z order by (z->>'faltan')::numeric desc) from (
        select jsonb_build_object(
                 'id', i.id,
                 'nombre', i.name,
                 'unidad', i.unit,
                 'actual', i.current_stock,
                 'minimo', i.min_stock,
                 'faltan', i.min_stock - i.current_stock) as z
          from public.inventory_items i
         where i.clinic_id = p_clinic_id
           and i.is_active
           and i.min_stock is not null
           and i.current_stock <= i.min_stock
         order by i.min_stock - i.current_stock desc
         limit 8) s3), '[]'::jsonb));
    alertas := alertas || jsonb_build_object('stock_bajo', (
      select count(*) from public.inventory_items i
       where i.clinic_id = p_clinic_id
         and i.is_active
         and i.min_stock is not null
         and i.current_stock <= i.min_stock));
  end if;

  -- ── Caja: estado sin montos (recepción opera caja sin ver finanzas) ────
  if v_caja then
    r := r || jsonb_build_object('cajas', jsonb_build_object(
      'abiertas', (
        select count(*) from public.cash_registers cr
         where cr.clinic_id = p_clinic_id and cr.status = 'open'
           and (v_ve_todas_las_cajas or cr.operator_id is null or cr.operator_id = v_uid)),
      'mia_abierta_desde', (
        select cr.opened_at from public.cash_registers cr
         where cr.clinic_id = p_clinic_id and cr.status = 'open' and cr.operator_id = v_uid
         order by cr.opened_at desc limit 1)));
    alertas := alertas || jsonb_build_object('cajas_sin_cerrar', (
      select count(*) from public.cash_registers cr
       where cr.clinic_id = p_clinic_id and cr.status = 'open'
         and cr.opened_at < v_inicio
         and (v_ve_todas_las_cajas or cr.operator_id is null or cr.operator_id = v_uid)));
  end if;

  -- ── Dinero: solo con finance:view ──────────────────────────────────────
  if v_finanzas then
    alertas := alertas || jsonb_build_object('cuotas_vencidas', (
      select count(*) from public.membership_charges mc
       where mc.clinic_id = p_clinic_id
         and mc.status = 'pending'
         and mc.period_start < v_hoy));
    r := r || jsonb_build_object('presupuestos', (
      select jsonb_build_object(
               'abiertos', count(*) filter (where q.status in ('sent', 'partially_accepted')),
               'abiertos_cents', coalesce(sum(q.total_cents) filter (where q.status in ('sent', 'partially_accepted')), 0),
               'por_vencer', count(*) filter (where q.status = 'sent' and q.valid_until between v_hoy and v_hoy + 7),
               'aceptados_mes', count(*) filter (where q.accepted_at >= v_inicio_mes),
               'aceptados_mes_cents', coalesce(sum(coalesce(q.accepted_total_cents, q.total_cents)) filter (where q.accepted_at >= v_inicio_mes), 0))
        from public.quotes q
       where q.clinic_id = p_clinic_id));
  end if;

  -- ── Clínico: lo que la persona tiene pendiente de firmar o revisar ─────
  if v_clinico then
    alertas := alertas || jsonb_build_object(
      'notas_sin_firmar', (
        select count(*) from public.clinical_notes n
         where n.clinic_id = p_clinic_id and n.created_by = v_uid and n.status = 'draft'),
      'revisiones_pedidas', (
        select count(*) from public.clinical_notes n
         where n.clinic_id = p_clinic_id and n.reviewer_id = v_uid and n.review_status = 'pending'));
    r := r || jsonb_build_object('notas_sin_firmar', coalesce((
      select jsonb_agg(w order by w->>'creada') from (
        select jsonb_build_object(
                 'id', n.id,
                 'paciente_id', n.patient_ref,
                 'paciente', n.patient_name,
                 'titulo', n.title,
                 'creada', n.created_at) as w
          from public.clinical_notes n
         where n.clinic_id = p_clinic_id and n.created_by = v_uid and n.status = 'draft'
         order by n.created_at
         limit 5) s4), '[]'::jsonb));
  end if;

  -- ── Desempeño propio (cuántos atendió en el mes; sin montos) ───────────
  if v_prof is not null then
    r := r || jsonb_build_object('desempeno_propio', (
      select jsonb_build_object(
               'atendidas_mes', count(*) filter (where a.status = 'finalizada'),
               'ausentes_mes', count(*) filter (where a.status = 'ausente'))
        from public.appointments a
       where a.clinic_id = p_clinic_id
         and a.professional_id = v_prof
         and a.starts_at >= v_inicio_mes
         and a.starts_at < v_inicio + interval '1 day'));
  end if;

  return r || jsonb_build_object('alertas', alertas);
end;
$function$;

comment on function public.panel_de_hoy(uuid) is
  'PAN-03..08 (Ola 11): alertas y bloques por rol de Hoy. SECURITY INVOKER (RLS del usuario) y cada sección gateada por el permiso de access.ts; el dinero solo con finance:view.';

revoke all on function public.panel_de_hoy(uuid) from public, anon;
grant execute on function public.panel_de_hoy(uuid) to authenticated, service_role;
