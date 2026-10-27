-- Cierre de la fase · Bloque 5 · ítem 3: la fusión de fichas mueve también la
-- afiliación a empresa con convenio, la membresía, sus cuotas y las
-- inscripciones a citas grupales (hasta hoy se quedaban en la ficha absorbida).
--
-- Reglas que se respetan:
--   · Las notas y los documentos firmados NO se mueven (se leen desde la
--     ficha destino, como siempre).
--   · Nada se borra: las FKs siguen en RESTRICT y la ficha absorbida queda
--     marcada (`merged_into`), no eliminada.
--   · Conflictos con salida clara, ANTES de mover algo (la fusión es una
--     transacción: si falla, no queda a medias): dos membresías vigentes, o
--     dos empresas distintas. Misma empresa: la fila absorbida se queda.
--   · Inscripciones a una misma cita grupal en las dos fichas: la absorbida se
--     retira (si no tenía asistencia marcada) o se deja como está.
--
-- Se redefinen (partiendo de su definición en producción del 27-oct-2026,
-- `pg_get_functiondef`), sin perder comportamiento:
--   · public.merge_patients(uuid, uuid, uuid): mismas validaciones y mismas
--     tablas de antes; se suman las de arriba.
--   · public.membership_charges_reglas(): el paciente de una cuota se puede
--     cambiar solo dentro de la fusión (marca de transacción local
--     `esmalia.fusion_de_fichas`, que `merge_patients` enciende y se apaga sola
--     al cerrar la transacción; las rutas de la API no pueden fijarla).
--   · public.validar_participante_de_grupo(): igual, para el paciente de una
--     inscripción.
--
-- No escribe datos al aplicarse. Reversa al pie.

begin;

CREATE OR REPLACE FUNCTION public.merge_patients(p_clinic_id uuid, p_source_id uuid, p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source record;
  v_target record;
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'No se puede fusionar una ficha consigo misma.';
  END IF;

  IF NOT public.has_clinic_role(
    p_clinic_id, ARRAY['owner','admin']::public.app_role[]
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para fusionar fichas.';
  END IF;

  SELECT id, merged_into INTO v_source
    FROM public.patients WHERE id = p_source_id AND clinic_id = p_clinic_id
    FOR UPDATE;
  SELECT id, merged_into, archived_at INTO v_target
    FROM public.patients WHERE id = p_target_id AND clinic_id = p_clinic_id
    FOR UPDATE;
  IF v_source.id IS NULL OR v_target.id IS NULL THEN
    RAISE EXCEPTION 'Alguna de las dos fichas no pertenece a esta clínica.';
  END IF;
  IF v_source.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'Esa ficha ya fue fusionada en otra.';
  END IF;
  IF v_target.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'La ficha destino ya fue fusionada en otra: elige la ficha que quedó.';
  END IF;
  IF v_target.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'La ficha destino está archivada: restáurala antes de fusionar.';
  END IF;

  UPDATE public.appointments        SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.payments            SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.receivables         SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.quotes              SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.treatment_plans     SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.odontogram_marks    SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.periodontal_charts  SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  -- patient_documents y patient_consents NO se mueven: sus triggers de
  -- inmutabilidad (con razón) rechazan cambiar el patient_id y hacían fallar
  -- la fusión. Igual que las notas, la ficha destino los lee desde las
  -- fichas fusionadas en ella.
  UPDATE public.messages            SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.lab_orders          SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  -- Signos vitales (20261019180000): mediciones sin trigger de inmutabilidad,
  -- se mueven con la atención. Recetas (20261019190000) y tutores no se
  -- mueven: sus triggers lo impiden a propósito; las recetas se leen desde la
  -- ficha destino y los tutores quedan en la ficha absorbida.
  IF to_regclass('public.patient_vital_signs') IS NOT NULL THEN
    EXECUTE 'UPDATE public.patient_vital_signs SET patient_id = $1 WHERE patient_id = $2 AND clinic_id = $3'
      USING p_target_id, p_source_id, p_clinic_id;
  END IF;

  -- ── Cierre · Bloque 5 · ítem 3: afiliación a empresa, membresía, cuotas e
  -- inscripciones a citas grupales viajan a la ficha que queda. ──────────────
  -- Dos membresías vigentes (activa o pausada) no caben en una ficha: el
  -- índice único de patient_memberships lo impide. Se avisa antes de mover
  -- nada, con la salida (cancelar una), en vez de fallar a mitad de camino.
  IF EXISTS (
       SELECT 1 FROM public.patient_memberships
        WHERE patient_id = p_source_id AND clinic_id = p_clinic_id AND status <> 'cancelled'
     ) AND EXISTS (
       SELECT 1 FROM public.patient_memberships
        WHERE patient_id = p_target_id AND clinic_id = p_clinic_id AND status <> 'cancelled'
     ) THEN
    RAISE EXCEPTION 'Las dos fichas tienen una membresía vigente. Cancela una de las dos antes de fusionar.';
  END IF;
  -- Una empresa por paciente (unique(patient_id)): si la ficha que queda ya
  -- tiene una empresa distinta, la fusión no elige por la clínica.
  IF EXISTS (
       SELECT 1
         FROM public.partner_company_patients s
         JOIN public.partner_company_patients t
           ON t.patient_id = p_target_id AND t.clinic_id = p_clinic_id
        WHERE s.patient_id = p_source_id AND s.clinic_id = p_clinic_id
          AND s.company_id <> t.company_id
     ) THEN
    RAISE EXCEPTION 'Las dos fichas están afiliadas a empresas con convenio distintas. Quita una de las afiliaciones antes de fusionar.';
  END IF;

  -- Marca de la transacción: sus triggers de inmutabilidad dejan cambiar el
  -- paciente de una cuota o de una inscripción SOLO desde acá (se apaga sola
  -- al terminar la transacción; `true` = local).
  PERFORM set_config('esmalia.fusion_de_fichas', 'on', true);

  -- Afiliación a empresa: se mueve si la ficha que queda no tiene ninguna; si
  -- ya está en la misma empresa, la fila de la ficha absorbida se queda donde
  -- está (no se borra).
  UPDATE public.partner_company_patients s
     SET patient_id = p_target_id
   WHERE s.patient_id = p_source_id AND s.clinic_id = p_clinic_id
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_company_patients t
        WHERE t.patient_id = p_target_id AND t.clinic_id = p_clinic_id
     );

  -- Membresías (con su historial cancelado) y sus cuotas. La cuota pactada es
  -- un snapshot: solo cambia de dueño. Las cuotas siguen a su membresía.
  UPDATE public.patient_memberships
     SET patient_id = p_target_id
   WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.membership_charges
     SET patient_id = p_target_id
   WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;

  -- Inscripciones a citas grupales. Si la ficha que queda ya está en esa
  -- misma cita, la absorbida no se duplica: si no tenía asistencia marcada se
  -- retira (queda el registro), y si la tenía se deja como está.
  UPDATE public.appointment_group_participants r
     SET patient_id = p_target_id
   WHERE r.patient_id = p_source_id AND r.clinic_id = p_clinic_id
     AND NOT EXISTS (
       SELECT 1 FROM public.appointment_group_participants t
        WHERE t.appointment_id = r.appointment_id AND t.patient_id = p_target_id
     );
  UPDATE public.appointment_group_participants r
     SET withdrawn_at = now(),
         withdraw_reason = 'Ficha fusionada: el paciente ya estaba inscrito con la ficha que quedó'
   WHERE r.patient_id = p_source_id AND r.clinic_id = p_clinic_id
     AND r.withdrawn_at IS NULL AND r.attendance = 'pendiente'
     AND EXISTS (
       SELECT 1 FROM public.appointment_group_participants t
        WHERE t.appointment_id = r.appointment_id AND t.patient_id = p_target_id
          AND t.withdrawn_at IS NULL
     );

  UPDATE public.patients
     SET merged_into = p_target_id,
         merged_at = now(),
         status = 'inactive'
   WHERE id = p_source_id AND clinic_id = p_clinic_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.membership_charges_reglas()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    select pm.currency, pm.patient_id
      into new.currency, new.patient_id
      from public.patient_memberships pm
     where pm.id = new.membership_id and pm.clinic_id = new.clinic_id;
    if not found then
      raise exception 'La membresía no existe en esta clínica.' using errcode = '23503';
    end if;
    if new.status <> 'pending' then
      raise exception 'Una cuota nace pendiente.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.clinic_id is distinct from old.clinic_id
     or new.membership_id is distinct from old.membership_id
     or (
       new.patient_id is distinct from old.patient_id
       -- Fusión de fichas (merge_patients): la cuota cambia de dueño junto con su membresía.
       and coalesce(current_setting('esmalia.fusion_de_fichas', true), '') <> 'on'
     )
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency then
    raise exception 'El monto y el período de una cuota no se editan: anúlala.' using errcode = '23514';
  end if;
  if old.status = 'void' then
    raise exception 'Una cuota anulada no cambia.' using errcode = '23514';
  end if;
  if old.status = 'paid' and new.status = 'pending' then
    raise exception 'Una cuota cobrada no vuelve a pendiente: anúlala con el motivo.' using errcode = '23514';
  end if;
  if new.status = 'paid' and old.status = 'pending' then
    new.paid_at := coalesce(new.paid_at, now());
    new.paid_by := auth.uid();
  end if;
  if new.status = 'void' and old.status <> 'void' then
    new.voided_at := now();
    new.voided_by := auth.uid();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validar_participante_de_grupo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_grupo record;
  v_cita record;
  v_vigentes integer;
  v_reincorpora boolean := false;
begin
  -- Candado de la fila del grupo: dos inscripciones a la vez no pasan las dos
  -- el chequeo del cupo.
  select g.clinic_id, g.capacity into v_grupo
    from public.appointment_groups g
   where g.appointment_id = new.appointment_id
   for update;
  if not found then
    raise exception 'La cita no es grupal.' using errcode = '23503';
  end if;
  select a.status, a.starts_at into v_cita
    from public.appointments a
   where a.id = new.appointment_id;

  if tg_op = 'INSERT' then
    new.clinic_id := v_grupo.clinic_id;
    if not exists (
      select 1 from public.patients p
       where p.id = new.patient_id
         and p.clinic_id = new.clinic_id
         and p.archived_at is null
         and p.merged_into is null
    ) then
      raise exception 'El paciente no es de esta clínica o su ficha está archivada.'
        using errcode = '42501';
    end if;
    new.enrolled_at := clock_timestamp();
    new.enrolled_by := coalesce(v_uid, new.enrolled_by);
    new.withdrawn_at := null;
    new.withdrawn_by := null;
    new.withdraw_reason := null;
    new.attendance := 'pendiente';
    new.attendance_marked_at := null;
    new.attendance_marked_by := null;
    v_reincorpora := true;
  else
    -- Fusión de fichas (merge_patients): el inscrito cambia de ficha y nada
    -- más (ni cupo, ni asistencia, ni fecha de inscripción).
    if coalesce(current_setting('esmalia.fusion_de_fichas', true), '') = 'on'
       and new.patient_id is distinct from old.patient_id
       and new.appointment_id is not distinct from old.appointment_id
       and new.clinic_id is not distinct from old.clinic_id then
      new.updated_at := now();
      return new;
    end if;
    if new.appointment_id is distinct from old.appointment_id
       or new.patient_id is distinct from old.patient_id
       or new.clinic_id is distinct from old.clinic_id then
      raise exception 'La cita, el paciente y la clínica de un inscrito no se cambian.'
        using errcode = '42501';
    end if;
    new.enrolled_by := old.enrolled_by;

    if old.withdrawn_at is not null and new.withdrawn_at is null then
      -- Reincorporación: vuelve a ocupar cupo.
      new.enrolled_at := clock_timestamp();
      new.enrolled_by := coalesce(v_uid, old.enrolled_by);
      new.withdrawn_by := null;
      new.withdraw_reason := null;
      new.attendance := 'pendiente';
      new.attendance_marked_at := null;
      new.attendance_marked_by := null;
      v_reincorpora := true;
    elsif old.withdrawn_at is null and new.withdrawn_at is not null then
      -- Retiro: queda el registro, libera el cupo.
      if not exists (
        select 1 from public.appointment_group_participants o
         where o.appointment_id = new.appointment_id
           and o.id <> new.id
           and o.withdrawn_at is null
      ) then
        raise exception 'Una cita grupal necesita al menos un paciente: para dejarla vacía, cancela la cita.'
          using errcode = '23514';
      end if;
      new.withdrawn_at := now();
      new.withdrawn_by := v_uid;
      new.enrolled_at := old.enrolled_at;
      new.attendance := 'pendiente';
      new.attendance_marked_at := null;
      new.attendance_marked_by := null;
    else
      new.enrolled_at := old.enrolled_at;
      new.withdrawn_at := old.withdrawn_at;
      new.withdrawn_by := old.withdrawn_by;
      if old.withdrawn_at is not null then
        -- Retirado: sin asistencia hasta que se reincorpore.
        if new.attendance is distinct from old.attendance then
          raise exception 'Un paciente retirado no tiene asistencia: reincorpóralo primero.'
            using errcode = '23514';
        end if;
        new.withdraw_reason := coalesce(new.withdraw_reason, old.withdraw_reason);
        new.attendance_marked_at := null;
        new.attendance_marked_by := null;
      elsif new.attendance is distinct from old.attendance then
        -- Asistencia individual, desde que empieza la cita.
        if new.attendance <> 'pendiente' and v_cita.starts_at > now() then
          raise exception 'La asistencia se marca desde que empieza la cita.'
            using errcode = '23514';
        end if;
        if new.attendance = 'pendiente' then
          new.attendance_marked_at := null;
          new.attendance_marked_by := null;
        else
          new.attendance_marked_at := now();
          new.attendance_marked_by := v_uid;
        end if;
      else
        new.attendance_marked_at := old.attendance_marked_at;
        new.attendance_marked_by := old.attendance_marked_by;
      end if;
    end if;
  end if;

  if v_reincorpora then
    if v_cita.status = 'cancelada' then
      raise exception 'La cita grupal está cancelada: no se inscriben pacientes.'
        using errcode = '23514';
    end if;
    select count(*) into v_vigentes
      from public.appointment_group_participants o
     where o.appointment_id = new.appointment_id
       and o.withdrawn_at is null
       and o.id <> new.id;
    if v_vigentes >= v_grupo.capacity then
      raise exception 'La cita grupal está llena: tiene % de % cupos ocupados.', v_vigentes, v_grupo.capacity
        using errcode = '23514';
    end if;
  end if;

  if new.withdraw_reason is not null then
    new.withdraw_reason := nullif(btrim(new.withdraw_reason), '');
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- Permisos: sin cambios (CREATE OR REPLACE conserva la ACL); se reafirman.
revoke execute on function public.merge_patients(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_patients(uuid, uuid, uuid) to authenticated, service_role;

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- Volver a aplicar, en este orden, las definiciones anteriores:
--   · public.merge_patients: 20261024300000_cuentas_por_cobrar.sql (agregó receivables)
--     y, si ya está, la versión de producción previa a esta migración.
--   · public.membership_charges_reglas: 20261106100100_empresas_y_membresias.sql
--   · public.validar_participante_de_grupo: 20261110200000_citas_grupales.sql
