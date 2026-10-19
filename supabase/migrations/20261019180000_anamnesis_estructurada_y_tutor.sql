-- Auditoría 360 (18-oct-2026), hallazgos CLI-10 y CLI-11.
--
-- CLI-10: la anamnesis era texto libre (3 listas + notas). Se suma, SIN tocar
-- lo existente:
--   (a) `allergy_details`: cada alergia con su severidad y reacción. La
--       columna `allergies text[]` se queda y la app la mantiene igual a los
--       nombres de `allergy_details`, así que la agenda, la exportación, la
--       fusión de fichas y cualquier lector viejo siguen funcionando igual.
--   (b) `risk_questionnaire`: cuestionario de riesgo odontológico cerrado
--       (sí/no + detalle) en un objeto JSON. La forma la valida el zod del
--       servidor (`anamnesis.ts`); acá solo se exige que sea un objeto.
--   (c) `patient_vital_signs`: presión, pulso y temperatura opcional por
--       atención. Es un evento clínico, así que es append-only (regla 9): se
--       corrige registrando otra medición, nunca editando.
--   (d) La auditoría `patient_medical_history_audit` guarda también las dos
--       columnas nuevas, y `changed_by` pasa a salir de `auth.uid()` y no de
--       `NEW.updated_by`, que manda el cliente (evidencia de CLI-10).
--
-- CLI-11: no existía el tutor ni el representante legal del menor.
--   (e) `patient_guardians`: nombre, documento, parentesco y contacto, con un
--       único tutor principal vigente por paciente. Nunca se borra: se archiva.
--       Cambios auditados en `patient_guardians_audit`.
--   (f) `patient_consents` guarda quién firmó y en qué calidad. Un trigger
--       BEFORE INSERT (no la app) decide: si el paciente es menor de 18 a la
--       fecha de la firma, exige un tutor del mismo paciente y copia su
--       nombre, documento y parentesco al snapshot. Misma lección que
--       `created_by` y la moneda: lo que la base estampa no se puede olvidar
--       ni falsificar desde el cliente.
--
-- Segura con datos existentes: todo es ADD COLUMN con default constante o
-- nullable, tablas nuevas y triggers nuevos. Los consentimientos ya firmados
-- quedan con `signer_role` NULL (no se sabe en qué calidad firmaron, y no se
-- fabrica el dato; regla 11).
--
-- Permisos (regla 2): lo clínico (anamnesis, signos vitales) solo lo leen
-- owner/admin/dentist/assistant. El tutor es un dato de contacto, como el
-- teléfono del paciente: lo ve todo miembro de la clínica (recepción lo
-- necesita para avisar de una cita) y lo edita todo rol salvo contabilidad.

-- ---------------------------------------------------------------------------
-- (a) + (b) Anamnesis estructurada
-- ---------------------------------------------------------------------------
ALTER TABLE public.patient_medical_history
  ADD COLUMN IF NOT EXISTS allergy_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_questionnaire jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.patient_medical_history
  DROP CONSTRAINT IF EXISTS patient_medical_history_allergy_details_array,
  ADD CONSTRAINT patient_medical_history_allergy_details_array
    CHECK (jsonb_typeof(allergy_details) = 'array'),
  DROP CONSTRAINT IF EXISTS patient_medical_history_risk_questionnaire_object,
  ADD CONSTRAINT patient_medical_history_risk_questionnaire_object
    CHECK (jsonb_typeof(risk_questionnaire) = 'object');

-- ---------------------------------------------------------------------------
-- (d) Auditoría de la anamnesis: columnas nuevas y actor desde la sesión
-- ---------------------------------------------------------------------------
-- Nullable: las filas de auditoría anteriores a esta migración no tenían el
-- dato, y NULL dice exactamente eso ("no existía"), no "vacío".
ALTER TABLE public.patient_medical_history_audit
  ADD COLUMN IF NOT EXISTS allergy_details jsonb,
  ADD COLUMN IF NOT EXISTS risk_questionnaire jsonb;

CREATE OR REPLACE FUNCTION public.log_patient_medical_history_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- `changed_by` sale de la sesión. NULL = lo hizo el sistema (rol de
  -- servicio, script, reinicio de la demo), igual que `clinical_note_audit`.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.patient_medical_history_audit
      (clinic_id, patient_id, allergies, chronic_medications, conditions, notes,
       allergy_details, risk_questionnaire, changed_by, change_kind)
    VALUES
      (NEW.clinic_id, NEW.patient_id, NEW.allergies, NEW.chronic_medications, NEW.conditions,
       NEW.notes, NEW.allergy_details, NEW.risk_questionnaire, auth.uid(), 'insert');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Guarda el estado ANTERIOR (OLD): el nuevo ya está en la tabla.
    INSERT INTO public.patient_medical_history_audit
      (clinic_id, patient_id, allergies, chronic_medications, conditions, notes,
       allergy_details, risk_questionnaire, changed_by, change_kind)
    VALUES
      (OLD.clinic_id, OLD.patient_id, OLD.allergies, OLD.chronic_medications, OLD.conditions,
       OLD.notes, OLD.allergy_details, OLD.risk_questionnaire, auth.uid(), 'update');
    RETURN NEW;
  END IF;
  RETURN NEW;
END; $$;

-- CREATE OR REPLACE conserva los permisos; se repite el REVOKE de
-- 20261013000100 por si esta migración corre en una base sin aquella.
REVOKE EXECUTE ON FUNCTION public.log_patient_medical_history_change() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (c) Signos vitales por atención
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_vital_signs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- La atención en la que se tomó. Opcional: también se mide en una urgencia
  -- sin cita. SET NULL: si la cita desaparece, la medición sigue siendo del
  -- paciente.
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  systolic_mmhg smallint NOT NULL CHECK (systolic_mmhg BETWEEN 50 AND 300),
  diastolic_mmhg smallint NOT NULL CHECK (diastolic_mmhg BETWEEN 20 AND 200),
  heart_rate_bpm smallint NOT NULL CHECK (heart_rate_bpm BETWEEN 20 AND 250),
  temperature_c numeric(4,1) CHECK (temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_vital_signs_presion_coherente CHECK (systolic_mmhg > diastolic_mmhg)
);

CREATE INDEX IF NOT EXISTS patient_vital_signs_patient_idx
  ON public.patient_vital_signs (clinic_id, patient_id, measured_at DESC);

-- Append-only: sin UPDATE ni DELETE para la app (regla 9).
GRANT SELECT, INSERT ON public.patient_vital_signs TO authenticated;
GRANT ALL ON public.patient_vital_signs TO service_role;
ALTER TABLE public.patient_vital_signs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vital_signs_select_clinical" ON public.patient_vital_signs;
CREATE POLICY "vital_signs_select_clinical" ON public.patient_vital_signs
  FOR SELECT TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant']::public.app_role[]));

-- El paciente y la cita tienen que ser de la misma clínica que la fila: el
-- FK solo asegura que existen, no que sean de esta clínica.
DROP POLICY IF EXISTS "vital_signs_insert_clinical" ON public.patient_vital_signs;
CREATE POLICY "vital_signs_insert_clinical" ON public.patient_vital_signs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant']::public.app_role[])
    AND recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = patient_vital_signs.patient_id AND p.clinic_id = patient_vital_signs.clinic_id
    )
    AND (
      appointment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.id = patient_vital_signs.appointment_id
          AND a.clinic_id = patient_vital_signs.clinic_id
          AND a.patient_id = patient_vital_signs.patient_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- (e) Tutor o representante legal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  -- Obligatorio: es lo que identifica a quien firma por el menor.
  document_id text NOT NULL CHECK (char_length(btrim(document_id)) BETWEEN 3 AND 40),
  relationship text NOT NULL
    CHECK (relationship IN ('madre', 'padre', 'tutor_legal', 'familiar', 'otro')),
  -- "Abuela", "tía", "curador designado por el juzgado"… cuando el parentesco
  -- es familiar u otro.
  relationship_detail text CHECK (relationship_detail IS NULL OR char_length(relationship_detail) <= 60),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 30),
  email text CHECK (email IS NULL OR char_length(email) <= 160),
  is_primary boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_guardians_con_contacto CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS patient_guardians_patient_idx
  ON public.patient_guardians (clinic_id, patient_id);
-- Un solo tutor principal vigente por paciente: es el destinatario de las
-- comunicaciones y el firmante sugerido.
CREATE UNIQUE INDEX IF NOT EXISTS patient_guardians_un_principal
  ON public.patient_guardians (patient_id)
  WHERE is_primary AND archived_at IS NULL;

DROP TRIGGER IF EXISTS patient_guardians_updated_at ON public.patient_guardians;
CREATE TRIGGER patient_guardians_updated_at
  BEFORE UPDATE ON public.patient_guardians
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sin DELETE: un tutor que firmó un consentimiento es evidencia. Se archiva.
GRANT SELECT, INSERT, UPDATE ON public.patient_guardians TO authenticated;
GRANT ALL ON public.patient_guardians TO service_role;
ALTER TABLE public.patient_guardians ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_guardians_select_members" ON public.patient_guardians;
CREATE POLICY "patient_guardians_select_members" ON public.patient_guardians
  FOR SELECT TO authenticated
  USING (public.is_clinic_member(clinic_id));

DROP POLICY IF EXISTS "patient_guardians_insert_staff" ON public.patient_guardians;
CREATE POLICY "patient_guardians_insert_staff" ON public.patient_guardians
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[])
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = patient_guardians.patient_id AND p.clinic_id = patient_guardians.clinic_id
    )
  );

DROP POLICY IF EXISTS "patient_guardians_update_staff" ON public.patient_guardians;
CREATE POLICY "patient_guardians_update_staff" ON public.patient_guardians
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner','admin','dentist','assistant','reception']::public.app_role[]));

-- Lo que identifica la fila no se mueve: un tutor no se "pasa" a otro
-- paciente ni a otra clínica, y un archivado no vuelve (se crea otro).
CREATE OR REPLACE FUNCTION public.enforce_patient_guardian_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'El tutor no se puede mover a otro paciente.';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'Un tutor archivado no se reactiva: registra uno nuevo.';
  END IF;
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    NEW.archived_by := auth.uid();
    NEW.is_primary := false;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS patient_guardians_enforce_update ON public.patient_guardians;
CREATE TRIGGER patient_guardians_enforce_update
  BEFORE UPDATE ON public.patient_guardians
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_guardian_update();

-- Auditoría append-only, mismo patrón que patient_medical_history_audit:
-- la escribe la base, la app solo puede leerla.
CREATE TABLE IF NOT EXISTS public.patient_guardians_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- Sin FK a propósito: la auditoría no puede impedir borrar lo auditado.
  guardian_id uuid NOT NULL,
  -- INSERT: la fila nueva. UPDATE: la fila ANTERIOR al cambio.
  snapshot jsonb NOT NULL,
  changed_by uuid,
  change_kind text NOT NULL CHECK (change_kind IN ('insert', 'update')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_guardians_audit_patient_idx
  ON public.patient_guardians_audit (patient_id, recorded_at DESC);

GRANT SELECT ON public.patient_guardians_audit TO authenticated;
GRANT ALL ON public.patient_guardians_audit TO service_role;
ALTER TABLE public.patient_guardians_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_guardians_audit_select_managers" ON public.patient_guardians_audit;
CREATE POLICY "patient_guardians_audit_select_managers" ON public.patient_guardians_audit
  FOR SELECT TO authenticated
  USING (public.can_manage_clinic(clinic_id));

CREATE OR REPLACE FUNCTION public.log_patient_guardian_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.patient_guardians_audit
      (clinic_id, patient_id, guardian_id, snapshot, changed_by, change_kind)
    VALUES (NEW.clinic_id, NEW.patient_id, NEW.id, to_jsonb(NEW), auth.uid(), 'insert');
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.patient_guardians_audit
      (clinic_id, patient_id, guardian_id, snapshot, changed_by, change_kind)
    VALUES (OLD.clinic_id, OLD.patient_id, OLD.id, to_jsonb(OLD), auth.uid(), 'update');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS patient_guardians_audit_trigger ON public.patient_guardians;
CREATE TRIGGER patient_guardians_audit_trigger
  AFTER INSERT OR UPDATE ON public.patient_guardians
  FOR EACH ROW EXECUTE FUNCTION public.log_patient_guardian_change();

-- ---------------------------------------------------------------------------
-- (f) Firmante del consentimiento
-- ---------------------------------------------------------------------------
ALTER TABLE public.patient_consents
  ADD COLUMN IF NOT EXISTS signer_role text,
  -- SET NULL y no RESTRICT: si se borra el paciente (o la clínica) en
  -- cascada, este FK no puede trabar el borrado. La evidencia de quién firmó
  -- son los snapshots, no el FK.
  ADD COLUMN IF NOT EXISTS guardian_id uuid REFERENCES public.patient_guardians(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signer_document_snapshot text,
  ADD COLUMN IF NOT EXISTS signer_relationship_snapshot text;

ALTER TABLE public.patient_consents
  DROP CONSTRAINT IF EXISTS patient_consents_signer_role_check,
  ADD CONSTRAINT patient_consents_signer_role_check
    CHECK (signer_role IS NULL OR signer_role IN ('paciente', 'tutor'));

-- Mayoría de edad: 18 en CL, AR, CO, PE y MX. La fecha de la firma se toma
-- en la zona horaria de la clínica (el día del cumpleaños cuenta en su hora
-- local, no en UTC). `birth_date + 18 años` en Postgres lleva un 29-feb al
-- 28-feb; `esMenorDeEdad` (src/lib/patients/tutor.ts) hace lo mismo.
-- Sin fecha de nacimiento no se puede saber: se acepta la firma del paciente
-- y la ficha avisa que falta la fecha.
CREATE OR REPLACE FUNCTION public.stamp_patient_consent_signer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_birth date;
  v_tz text;
  v_fecha_firma date;
  v_tutor public.patient_guardians%ROWTYPE;
BEGIN
  SELECT p.birth_date, COALESCE(c.timezone, 'UTC')
    INTO v_birth, v_tz
    FROM public.patients p
    JOIN public.clinics c ON c.id = p.clinic_id
   WHERE p.id = NEW.patient_id AND p.clinic_id = NEW.clinic_id;

  v_fecha_firma := (COALESCE(NEW.signed_at, now()) AT TIME ZONE v_tz)::date;

  IF NEW.guardian_id IS NOT NULL THEN
    SELECT * INTO v_tutor
      FROM public.patient_guardians g
     WHERE g.id = NEW.guardian_id
       AND g.patient_id = NEW.patient_id
       AND g.clinic_id = NEW.clinic_id
       AND g.archived_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El tutor elegido no corresponde a este paciente.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.signer_role := 'tutor';
    NEW.signed_by_name := v_tutor.full_name;
    NEW.signer_document_snapshot := v_tutor.document_id;
    -- Texto legible, el mismo que `parentescoLegible` (src/lib/patients/tutor.ts):
    -- el snapshot tiene que entenderse solo, dentro de diez años.
    NEW.signer_relationship_snapshot := COALESCE(
      NULLIF(btrim(v_tutor.relationship_detail), ''),
      CASE v_tutor.relationship
        WHEN 'madre' THEN 'Madre'
        WHEN 'padre' THEN 'Padre'
        WHEN 'tutor_legal' THEN 'Tutor legal'
        WHEN 'familiar' THEN 'Otro familiar'
        ELSE 'Otro representante'
      END
    );
  ELSIF v_birth IS NOT NULL AND (v_birth + interval '18 years')::date > v_fecha_firma THEN
    RAISE EXCEPTION 'El paciente es menor de edad: el consentimiento lo firma su tutor o representante legal.'
      USING ERRCODE = 'check_violation';
  ELSE
    NEW.signer_role := 'paciente';
    NEW.signer_document_snapshot := NULL;
    NEW.signer_relationship_snapshot := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS patient_consents_stamp_signer ON public.patient_consents;
CREATE TRIGGER patient_consents_stamp_signer
  BEFORE INSERT ON public.patient_consents
  FOR EACH ROW EXECUTE FUNCTION public.stamp_patient_consent_signer();

-- Trigger propio (no se toca `enforce_patient_consent_update`) para que el
-- snapshot del firmante sea tan inmutable como el resto. `guardian_id` solo
-- puede pasar a NULL, que es lo que hace el ON DELETE SET NULL en cascada.
CREATE OR REPLACE FUNCTION public.enforce_patient_consent_signer_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.signer_role IS DISTINCT FROM OLD.signer_role
    OR NEW.signer_document_snapshot IS DISTINCT FROM OLD.signer_document_snapshot
    OR NEW.signer_relationship_snapshot IS DISTINCT FROM OLD.signer_relationship_snapshot
    OR (NEW.guardian_id IS NOT NULL AND NEW.guardian_id IS DISTINCT FROM OLD.guardian_id)
  THEN
    RAISE EXCEPTION 'Un consentimiento firmado solo se puede revocar, no editar.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS patient_consents_enforce_signer_update ON public.patient_consents;
CREATE TRIGGER patient_consents_enforce_signer_update
  BEFORE UPDATE ON public.patient_consents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_consent_signer_update();

-- ---------------------------------------------------------------------------
-- Demo de solo lectura y permisos de las funciones de trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS block_demo_writes ON public.patient_guardians;
CREATE TRIGGER block_demo_writes BEFORE INSERT OR UPDATE OR DELETE ON public.patient_guardians
  FOR EACH ROW EXECUTE FUNCTION public.block_demo_writes();
DROP TRIGGER IF EXISTS block_demo_writes ON public.patient_vital_signs;
CREATE TRIGGER block_demo_writes BEFORE INSERT OR UPDATE OR DELETE ON public.patient_vital_signs
  FOR EACH ROW EXECUTE FUNCTION public.block_demo_writes();

-- Funciones de trigger SECURITY DEFINER: nadie las llama directo (mismo
-- criterio que 20261013000100).
REVOKE EXECUTE ON FUNCTION public.enforce_patient_guardian_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_patient_guardian_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_patient_consent_signer() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_patient_consent_signer_update() FROM PUBLIC, anon, authenticated;
