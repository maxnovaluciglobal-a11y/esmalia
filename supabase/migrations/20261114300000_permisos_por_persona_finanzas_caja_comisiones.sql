-- ═══════════════════════════════════════════════════════════════════════════
-- Cierre · Bloque 5 · ítem 11: permisos por persona también en finanzas, caja
-- y comisiones (continúa EQU-01, migración 20261106300200).
--
-- Hoy `finance:view`, `cash:manage`, `payments:reverse` y `commission:view-own`
-- se definen solo por el rol. Esta migración deja que el propietario o la
-- administración DEN o QUITEN cada área a una persona, sin cambiar lo que
-- cada rol trae por defecto:
--
--   Finanzas   `finance:view`           (reportes, gastos, morosidad, presupuestos)
--   Caja       `cash:manage`            (abrir/cerrar caja, traspasos)
--              `payments:reverse`       (reversar pagos y anular cuentas)
--   Comisiones `commission:view-own`    (la propia)
--              `commission:view-all`    (NUEVO: todo el equipo; antes iba atado a
--                                        `finance:view`. Lo traen los mismos roles
--                                        que ya veían todo: owner, admin,
--                                        coordinación y contabilidad)
--
-- Cómo se cumple en la base:
--   · QUITAR: políticas RESTRICTIVAS `ajuste_quita_*` (solo pueden negar, se
--     combinan con AND con las que ya existen; ninguna política existente se
--     toca). Gastos y gastos fijos (finance:view); abrir/cerrar caja y
--     traspasos (cash:manage); reversar pagos y anular cuentas por cobrar
--     (payments:reverse); reglas y liquidaciones de comisiones, lo ajeno y lo
--     propio por separado (commission:view-all / view-own).
--   · DAR: políticas PERMISIVAS `ajuste_da_*` nuevas, estrictamente acotadas:
--     solo de lectura para gastos y comisiones (finance:view,
--     commission:view-all) y, para caja, solo la caja PROPIA de quien la abre.
--     Solo se activan con un "dar" vigente Y admitido para el rol actual
--     (`permiso_otorgado` revalida el catálogo `ajuste_de_permiso_admitido`):
--     si la persona cambia de rol, el "dar" deja de valer solo.
--   · Regla 2 (CLAUDE.md): asistente dental nunca recibe finanzas, caja,
--     reversas ni comisiones de todos (catálogo + trigger). La historia clínica
--     no se toca. Los pagos siguen sin ser legibles por asistente.
--   · El catálogo `ajuste_de_permiso_admitido` es el espejo de
--     `AJUSTES_POR_PERMISO` / `ajusteAdmitido` (src/lib/access/access.ts);
--     `tests/permisos-por-persona-db.test.ts` los compara combinación por
--     combinación.
--   · `panel_de_hoy` (Hoy) respeta lo quitado y lo dado para sus bloques de
--     dinero y de caja.
--
-- Funciones redefinidas (partiendo de su definición vigente en producción,
-- verificada igual al repo el 27-oct-2026): `ajuste_de_permiso_admitido`,
-- `validar_ajuste_de_permiso`, `panel_de_hoy`, `informe_validar` e `informe_embudo`. Se suma `permiso_otorgado`.
-- No hay tablas nuevas ni se escriben datos. Los "quitar" que ya existían
-- (clínico, agenda, pacientes) no cambian.
--
-- Límites conocidos (documentados en el PR):
--   · Informes con montos e Informes → embudo respetan lo dado y lo quitado
--     (`informe_validar`, `informe_embudo`).
--   · La lógica de cobro (otro frente) no se toca.
-- Reversa al pie.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Catálogo de ajustes admitidos (espejo de access.ts) ────────────────

create or replace function public.ajuste_de_permiso_admitido(
  _role public.app_role,
  _permission text,
  _effect text
) returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when _role is null or _role = 'owner'::public.app_role then false
    -- Regla 2: la historia clínica nunca a quien no es owner/admin/dentist/assistant…
    when _effect = 'grant'
         and _permission in ('clinical:view', 'clinical:write')
         and _role not in ('owner', 'admin', 'dentist', 'assistant') then false
    -- …y los pagos (y el dinero que de ellos sale) nunca a assistant.
    when _effect = 'grant'
         and _permission in ('finance:view', 'cash:manage', 'payments:reverse', 'commission:view-all')
         and _role = 'assistant'::public.app_role then false
    when _effect = 'grant' then
      case _permission
        when 'clinical:view' then _role in ('assistant')
        when 'clinical:write' then _role in ('assistant')
        when 'agenda:view' then _role in ('accounting')
        when 'team:view' then _role in ('assistant', 'lab_technician')
        when 'finance:view' then _role in ('reception', 'dentist')
        when 'cash:manage' then _role in ('dentist')
        when 'payments:reverse' then _role in ('reception')
        when 'commission:view-own' then _role in ('reception', 'accounting', 'coordinator')
        when 'commission:view-all' then _role in ('reception', 'dentist')
        else false
      end
    when _effect = 'revoke' then
      case _permission
        when 'clinical:view' then _role in ('admin', 'dentist')
        when 'clinical:write' then _role in ('admin', 'dentist')
        when 'agenda:manage' then _role in ('admin', 'coordinator', 'dentist', 'reception')
        when 'patients:manage' then _role in ('admin', 'coordinator', 'dentist', 'reception')
        when 'finance:view' then _role in ('admin', 'coordinator', 'accounting')
        when 'cash:manage' then _role in ('admin', 'coordinator', 'reception', 'accounting')
        when 'payments:reverse' then _role in ('admin', 'coordinator', 'accounting')
        when 'commission:view-own' then _role in ('admin', 'dentist')
        when 'commission:view-all' then _role in ('admin', 'coordinator', 'accounting')
        else false
      end
    else false
  end;
$function$;

-- ─── 2. Trigger de validación: regla 2 también para comisiones de todos ────

create or replace function public.validar_ajuste_de_permiso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member public.clinic_members%rowtype;
begin
  if tg_op = 'UPDATE' and (new.member_id <> old.member_id or new.clinic_id <> old.clinic_id) then
    raise exception 'Un ajuste no se puede mover a otro integrante.' using errcode = '42501';
  end if;

  select * into v_member from public.clinic_members where id = new.member_id;
  if not found then
    raise exception 'No encontramos a ese integrante.' using errcode = 'P0002';
  end if;
  -- Aislamiento: el ajuste y el integrante son de la misma clínica.
  if v_member.clinic_id <> new.clinic_id then
    raise exception 'Ese integrante no es de esta clínica.' using errcode = '42501';
  end if;
  if auth.uid() is not null and v_member.user_id = auth.uid() then
    raise exception 'No puedes ajustar tus propios permisos.' using errcode = '42501';
  end if;
  if v_member.role = 'owner'::public.app_role then
    raise exception 'El propietario tiene acceso completo: no se ajusta por persona.'
      using errcode = '42501';
  end if;

  -- Regla 2 (explícita, aunque el catálogo ya la cubre).
  if new.effect = 'grant'
     and new.permission in ('clinical:view', 'clinical:write')
     and v_member.role not in ('owner', 'admin', 'dentist', 'assistant') then
    raise exception 'La historia clínica solo la ven propietario, administración, profesionales y asistentes.'
      using errcode = '42501';
  end if;
  if new.effect = 'grant'
     and new.permission in ('finance:view', 'cash:manage', 'payments:reverse', 'commission:view-all')
     and v_member.role = 'assistant'::public.app_role then
    raise exception 'Asistente dental no maneja pagos ni finanzas.' using errcode = '42501';
  end if;

  if not public.ajuste_de_permiso_admitido(v_member.role, new.permission, new.effect) then
    raise exception 'Ese ajuste no está permitido para el rol de esta persona.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- ─── 3. ¿Le dieron este permiso al usuario actual? ─────────────────────────
-- Espejo de `permiso_quitado`: solo cuentan los "dar" vigentes para su rol
-- actual (si cambió de rol y el ajuste ya no corresponde, deja de valer).

create or replace function public.permiso_otorgado(_clinic_id uuid, _permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.clinic_member_permission_overrides o
      join public.clinic_members m on m.id = o.member_id
     where m.clinic_id = _clinic_id
       and o.clinic_id = _clinic_id
       and m.user_id = auth.uid()
       and o.permission = _permission
       and o.effect = 'grant'
       and public.ajuste_de_permiso_admitido(m.role, o.permission, o.effect)
  );
$function$;

revoke all on function public.permiso_otorgado(uuid, text) from public, anon;
grant execute on function public.permiso_otorgado(uuid, text) to authenticated, service_role;

-- ─── 4. QUITAR · políticas restrictivas ────────────────────────────────────

-- 4.a Finanzas (finance:view): gastos y gastos fijos, que solo leen quienes
-- ven finanzas. Pagos, presupuestos y cuentas por cobrar NO se restringen acá
-- porque recepción y profesionales los usan para cobrar; ahí manda el servidor
-- (`requireFinanceView`, regla 15).

drop policy if exists ajuste_quita_ver_finanzas on public.expenses;
create policy ajuste_quita_ver_finanzas on public.expenses
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'finance:view'));

drop policy if exists ajuste_quita_ver_finanzas on public.recurring_expenses;
create policy ajuste_quita_ver_finanzas on public.recurring_expenses
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'finance:view'));

-- 4.b Caja (cash:manage): abrir/cerrar caja y mover plata entre cajas.

drop policy if exists ajuste_quita_caja_insert on public.cash_registers;
create policy ajuste_quita_caja_insert on public.cash_registers
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'cash:manage'));

drop policy if exists ajuste_quita_caja_update on public.cash_registers;
create policy ajuste_quita_caja_update on public.cash_registers
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'cash:manage'))
  with check (not public.permiso_quitado(clinic_id, 'cash:manage'));

drop policy if exists ajuste_quita_caja_insert on public.cash_movements;
create policy ajuste_quita_caja_insert on public.cash_movements
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'cash:manage'));

-- 4.c Reversar (payments:reverse): marcar un pago como reversado o anular una
-- cuenta por cobrar. Editar otros campos de esas filas no cambia.

drop policy if exists ajuste_quita_reversar_update on public.payments;
create policy ajuste_quita_reversar_update on public.payments
  as restrictive for update to authenticated
  using ((select auth.uid()) is not null)
  with check (not (public.permiso_quitado(clinic_id, 'payments:reverse') and reversed_at is not null));

drop policy if exists ajuste_quita_anular_update on public.receivables;
create policy ajuste_quita_anular_update on public.receivables
  as restrictive for update to authenticated
  using ((select auth.uid()) is not null)
  with check (not (public.permiso_quitado(clinic_id, 'payments:reverse') and voided_at is not null));

-- 4.d Comisiones: lo ajeno (commission:view-all) y lo propio (commission:view-own)
-- se quitan por separado. Sin 'ver todo', solo quedan las filas del propio
-- profesional; sin 'ver lo propio', se esconden esas filas.

drop policy if exists ajuste_quita_ver_comisiones_ajenas on public.commission_rules;
create policy ajuste_quita_ver_comisiones_ajenas on public.commission_rules
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'commission:view-all')
    or exists (select 1 from public.professionals pr
             where pr.id = commission_rules.professional_id
               and pr.user_id = (select auth.uid())));

drop policy if exists ajuste_quita_ver_comisiones_propias on public.commission_rules;
create policy ajuste_quita_ver_comisiones_propias on public.commission_rules
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'commission:view-own')
    or not exists (select 1 from public.professionals pr
             where pr.id = commission_rules.professional_id
               and pr.user_id = (select auth.uid())));

drop policy if exists ajuste_quita_ver_comisiones_ajenas on public.commission_settlements;
create policy ajuste_quita_ver_comisiones_ajenas on public.commission_settlements
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'commission:view-all')
    or exists (select 1 from public.professionals pr
             where pr.id = commission_settlements.professional_id
               and pr.user_id = (select auth.uid())));

drop policy if exists ajuste_quita_ver_comisiones_propias on public.commission_settlements;
create policy ajuste_quita_ver_comisiones_propias on public.commission_settlements
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'commission:view-own')
    or not exists (select 1 from public.professionals pr
             where pr.id = commission_settlements.professional_id
               and pr.user_id = (select auth.uid())));

drop policy if exists ajuste_quita_ver_comisiones_ajenas on public.commission_rule_versions;
create policy ajuste_quita_ver_comisiones_ajenas on public.commission_rule_versions
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'commission:view-all')
    or exists (select 1 from public.professionals pr
             where pr.id = commission_rule_versions.professional_id
               and pr.user_id = (select auth.uid())));

drop policy if exists ajuste_quita_ver_comisiones_propias on public.commission_rule_versions;
create policy ajuste_quita_ver_comisiones_propias on public.commission_rule_versions
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'commission:view-own')
    or not exists (select 1 from public.professionals pr
             where pr.id = commission_rule_versions.professional_id
               and pr.user_id = (select auth.uid())));

-- ─── 5. DAR · políticas permisivas acotadas ────────────────────────────────

-- 5.a Finanzas (finance:view): solo LECTURA de gastos y gastos fijos. Escribir
-- gastos sigue siendo de owner/admin/contabilidad por rol. Pagos, presupuestos,
-- cuentas por cobrar y convenios ya los leen recepción y profesionales.

drop policy if exists ajuste_da_ver_finanzas on public.expenses;
create policy ajuste_da_ver_finanzas on public.expenses
  for select to authenticated
  using (public.permiso_otorgado(clinic_id, 'finance:view'));

drop policy if exists ajuste_da_ver_finanzas on public.recurring_expenses;
create policy ajuste_da_ver_finanzas on public.recurring_expenses
  for select to authenticated
  using (public.permiso_otorgado(clinic_id, 'finance:view'));

-- 5.b Comisiones de todo el equipo (commission:view-all): solo lectura.

drop policy if exists ajuste_da_ver_comisiones_de_todos on public.commission_rules;
create policy ajuste_da_ver_comisiones_de_todos on public.commission_rules
  for select to authenticated
  using (public.permiso_otorgado(clinic_id, 'commission:view-all'));

drop policy if exists ajuste_da_ver_comisiones_de_todos on public.commission_settlements;
create policy ajuste_da_ver_comisiones_de_todos on public.commission_settlements
  for select to authenticated
  using (public.permiso_otorgado(clinic_id, 'commission:view-all'));

drop policy if exists ajuste_da_ver_comisiones_de_todos on public.commission_rule_versions;
create policy ajuste_da_ver_comisiones_de_todos on public.commission_rule_versions
  for select to authenticated
  using (public.permiso_otorgado(clinic_id, 'commission:view-all'));

-- 5.c Caja (cash:manage): quien la recibe por persona maneja SU caja (la que
-- abre a su nombre) y los traspasos que salen de ella. La caja general y las
-- cajas de otras personas siguen siendo de recepción, contabilidad y
-- administración.

drop policy if exists ajuste_da_caja_insert on public.cash_registers;
create policy ajuste_da_caja_insert on public.cash_registers
  for insert to authenticated
  with check (public.permiso_otorgado(clinic_id, 'cash:manage')
    and opened_by = (select auth.uid())
    and operator_id = (select auth.uid()));

drop policy if exists ajuste_da_caja_update on public.cash_registers;
create policy ajuste_da_caja_update on public.cash_registers
  for update to authenticated
  using (public.permiso_otorgado(clinic_id, 'cash:manage')
    and operator_id = (select auth.uid()))
  with check (public.permiso_otorgado(clinic_id, 'cash:manage')
    and operator_id = (select auth.uid()));

drop policy if exists ajuste_da_caja_ver_movimientos on public.cash_movements;
create policy ajuste_da_caja_ver_movimientos on public.cash_movements
  for select to authenticated
  using (public.permiso_otorgado(clinic_id, 'cash:manage')
    and exists (
      select 1 from public.cash_registers r
       where r.clinic_id = cash_movements.clinic_id
         and r.id in (cash_movements.from_register_id, cash_movements.to_register_id)
         and r.operator_id = (select auth.uid())
    ));

drop policy if exists ajuste_da_caja_mover on public.cash_movements;
create policy ajuste_da_caja_mover on public.cash_movements
  for insert to authenticated
  with check (public.permiso_otorgado(clinic_id, 'cash:manage')
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.cash_registers r
       where r.id = cash_movements.from_register_id
         and r.clinic_id = cash_movements.clinic_id
         and r.operator_id = (select auth.uid())
    ));

-- ─── 6. Hoy respeta lo dado y lo quitado en dinero y caja ──────────────────
-- Misma función que la vigente (20261107200000); solo cambian `v_finanzas` y
-- `v_caja`, que ahora suman `permiso_otorgado` y restan `permiso_quitado`.

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
  v_finanzas := (public.has_clinic_role(p_clinic_id, array['owner','admin','accounting']::public.app_role[])
                 or public.permiso_otorgado(p_clinic_id, 'finance:view'))
                and not public.permiso_quitado(p_clinic_id, 'finance:view');
  v_caja := (public.has_clinic_role(p_clinic_id, array['owner','admin','reception','accounting']::public.app_role[])
             or public.permiso_otorgado(p_clinic_id, 'cash:manage'))
            and not public.permiso_quitado(p_clinic_id, 'cash:manage');
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
  'PAN-03..08 (Ola 11): alertas y bloques por rol de Hoy. SECURITY INVOKER (RLS del usuario) y cada sección gateada por el permiso de access.ts, con los ajustes por persona (dar y quitar) en dinero y caja.';

revoke all on function public.panel_de_hoy(uuid) from public, anon;
grant execute on function public.panel_de_hoy(uuid) to authenticated, service_role;

-- ─── 7. Informes con montos respetan lo dado y lo quitado ──────────────────
-- Mismas funciones que las vigentes (20261107100000); solo cambia quién cuenta
-- como «con finanzas»: el rol, más lo dado, menos lo quitado. Sin esto, a
-- recepción con finanzas dadas la base le rechazaría los montos con 42501.

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
     and not (
       (public.has_clinic_role(p_clinic_id, array['owner','admin','accounting']::public.app_role[])
        or public.permiso_otorgado(p_clinic_id, 'finance:view'))
       and not public.permiso_quitado(p_clinic_id, 'finance:view')
     ) then
    raise exception 'No tienes permisos para ver montos.' using errcode = '42501';
  end if;
end;
$$;

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
  v_finanzas boolean := (
    public.has_clinic_role(p_clinic_id, array['owner','admin','accounting']::public.app_role[])
    or public.permiso_otorgado(p_clinic_id, 'finance:view')
  ) and not public.permiso_quitado(p_clinic_id, 'finance:view');
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

-- ═══ Reversa (no se ejecuta) ════════════════════════════════════════════════
-- Las funciones vuelven a su versión anterior re-ejecutando las definiciones
-- de 20261106300200 (catálogo y trigger) y de 20261107200000 (panel_de_hoy) y 20261107100000 (informe_validar, informe_embudo).
-- delete from public.clinic_member_permission_overrides
--  where permission in ('finance:view','cash:manage','payments:reverse','commission:view-own','commission:view-all');
-- drop policy if exists ajuste_da_caja_mover on public.cash_movements;
-- drop policy if exists ajuste_da_caja_ver_movimientos on public.cash_movements;
-- drop policy if exists ajuste_da_caja_update on public.cash_registers;
-- drop policy if exists ajuste_da_caja_insert on public.cash_registers;
-- drop policy if exists ajuste_da_ver_comisiones_de_todos on public.commission_rule_versions;
-- drop policy if exists ajuste_da_ver_comisiones_de_todos on public.commission_settlements;
-- drop policy if exists ajuste_da_ver_comisiones_de_todos on public.commission_rules;
-- drop policy if exists ajuste_da_ver_finanzas on public.recurring_expenses;
-- drop policy if exists ajuste_da_ver_finanzas on public.expenses;
-- drop policy if exists ajuste_quita_ver_comisiones_propias on public.commission_rule_versions;
-- drop policy if exists ajuste_quita_ver_comisiones_propias on public.commission_settlements;
-- drop policy if exists ajuste_quita_ver_comisiones_propias on public.commission_rules;
-- drop policy if exists ajuste_quita_ver_comisiones_ajenas on public.commission_rule_versions;
-- drop policy if exists ajuste_quita_ver_comisiones_ajenas on public.commission_settlements;
-- drop policy if exists ajuste_quita_ver_comisiones_ajenas on public.commission_rules;
-- drop policy if exists ajuste_quita_anular_update on public.receivables;
-- drop policy if exists ajuste_quita_reversar_update on public.payments;
-- drop policy if exists ajuste_quita_caja_insert on public.cash_movements;
-- drop policy if exists ajuste_quita_caja_update on public.cash_registers;
-- drop policy if exists ajuste_quita_caja_insert on public.cash_registers;
-- drop policy if exists ajuste_quita_ver_finanzas on public.recurring_expenses;
-- drop policy if exists ajuste_quita_ver_finanzas on public.expenses;
-- drop function if exists public.permiso_otorgado(uuid, text);
