-- Integridad de la historia clínica (auditoría 360 del 18-oct-2026):
-- LEG-08 = CLI-05, CLI-06, CLI-07 y CLI-08.
--
-- 1. La ficha no se borra, se archiva. La historia clínica se conserva por ley
--    (CL 15 años, Ley 20.584 art. 13; CO 15, Res. 839/2017; AR 10, Ley 26.529
--    art. 18; MX 5, NOM-004 5.4). Se quita la política de DELETE de pacientes,
--    se revoca el DELETE a los usuarios y las FKs que iban en cascada desde
--    `patients` a los datos clínicos pasan a RESTRICT.
-- 2. Fusión de fichas: `merge_patients` intentaba `UPDATE clinical_notes SET
--    patient_id` y esa columna no existe (las notas cuelgan de `patient_ref`,
--    texto): la fusión fallaba siempre. Las notas no se reescriben: quedan con
--    la ficha en la que se escribieron y la ficha destino las muestra junto a
--    las suyas (y también la anamnesis de la ficha absorbida, como alerta).
-- 3. Nota firmada = cerrada. No se reabre: se le agrega una adenda (otra nota,
--    vinculada por `addendum_of`, con su autor, su fecha y su propia firma).
--    Guardar una nota y su versión pasa a ser una sola transacción
--    (`guardar_nota_clinica`) y la base rechaza un cambio de contenido sin su
--    versión (trigger diferido), aunque llegue directo por la API.
-- 4. Firmar exige nombre completo y número de registro del profesional; la
--    firma guarda una foto de ambos, la fecha y el hash del contenido.
--
-- SIN APLICAR: requiere el OK de Walter (ver la descripción del PR). Se puede
-- correr dos veces sin romper nada (IF EXISTS / CREATE OR REPLACE / DROP ...
-- IF EXISTS) y va en una sola transacción.

BEGIN;

-- ═══ 1 · LA FICHA SE ARCHIVA, NO SE BORRA (LEG-08 / CLI-05) ═══════════════

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

COMMENT ON COLUMN public.patients.archived_at IS
  'Ficha archivada (sale de los listados). La historia clínica se conserva: archivar reemplaza al borrado.';
COMMENT ON COLUMN public.patients.archived_by IS
  'Quién archivó la ficha. Lo estampa el trigger patients_controlar_archivo, no la app.';

-- Archivar es lo que antes era borrar: solo owner/admin. El actor y la fecha
-- los pone la base (mismo criterio que la auditoría de notas: no se le cree
-- a la app quién hizo qué).
CREATE OR REPLACE FUNCTION public.controlar_archivo_de_paciente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.archived_at := NULL;
      NEW.archived_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
     AND NEW.archived_by IS NOT DISTINCT FROM OLD.archived_by THEN
    RETURN NEW;
  END IF;

  -- Rol de servicio / scripts: sin identidad no hay a quién estampar.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_clinic_role(OLD.clinic_id, ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Solo el propietario o un administrador puede archivar o restaurar una ficha.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.archived_at IS NULL THEN
    NEW.archived_by := NULL;           -- restaurar
  ELSIF OLD.archived_at IS NULL THEN
    NEW.archived_at := now();          -- archivar
    NEW.archived_by := v_uid;
  ELSE
    NEW.archived_at := OLD.archived_at; -- ya estaba archivada: no se reescribe
    NEW.archived_by := OLD.archived_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patients_controlar_archivo ON public.patients;
CREATE TRIGGER patients_controlar_archivo
  BEFORE INSERT OR UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.controlar_archivo_de_paciente();

-- Nadie borra pacientes con su JWT. El rol de servicio (reset de la demo,
-- scripts) sí puede, pero solo fichas sin datos clínicos: las FKs de abajo y
-- el trigger de notas lo frenan. Borrar la CLÍNICA entera (reset de la demo)
-- sigue funcionando: la cascada desde `clinics` se lleva todo junto.
DROP POLICY IF EXISTS patients_delete_managers ON public.patients;
REVOKE DELETE, TRUNCATE ON public.patients FROM anon, authenticated;

-- FKs clínicas: CASCADE → RESTRICT. Se busca el nombre real de cada FK en el
-- catálogo (no se asume el nombre por defecto) y se recrea NOT VALID +
-- VALIDATE: la validación no bloquea escrituras y no puede fallar con los
-- datos actuales, porque la FK anterior ya garantizaba lo mismo. Antes de
-- tocar nada se cuentan huérfanos y, si hubiera alguno, la migración se
-- detiene con el detalle (en vez de dejar una FK a medio validar).
--
-- Quedan en CASCADE a propósito, porque no son historia clínica:
-- `messages`, `appointment_requests` (y `waitlist_entries`/`whatsapp_leads`,
-- que ya eran SET NULL).
DO $$
DECLARE
  t text;
  v_fk text;
  v_huerfanos bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointments',
    'lab_orders',
    'odontogram_marks',
    'ortho_cases',
    'patient_consents',
    'patient_documents',
    'patient_medical_history',
    'patient_medical_history_audit',
    'payments',
    'periodontal_charts',
    'portal_access_log',
    'quotes',
    'treatment_plans'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabla public.% no existe, se omite.', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I x WHERE x.patient_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = x.patient_id)', t)
      INTO v_huerfanos;
    IF v_huerfanos > 0 THEN
      RAISE EXCEPTION 'public.% tiene % filas con patient_id sin paciente: revisar antes de migrar.',
        t, v_huerfanos;
    END IF;

    SELECT c.conname INTO v_fk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND c.conrelid = ('public.' || t)::regclass
       AND c.confrelid = 'public.patients'::regclass
       AND a.attname = 'patient_id'
     LIMIT 1;

    IF v_fk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, v_fk);
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (patient_id)
         REFERENCES public.patients(id) ON DELETE RESTRICT NOT VALID',
      t, t || '_patient_id_fkey');
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t || '_patient_id_fkey');
  END LOOP;
END;
$$;

-- `clinical_notes` cuelga del paciente por `patient_ref` (texto), no por FK:
-- el freno equivalente es este trigger. Deja pasar el borrado cuando lo que
-- se está borrando es la clínica entera (la cascada ya borró la fila de
-- `clinics` cuando llega acá).
CREATE OR REPLACE FUNCTION public.impedir_borrar_paciente_con_notas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.clinics WHERE id = OLD.clinic_id)
     AND EXISTS (
       SELECT 1 FROM public.clinical_notes
        WHERE clinic_id = OLD.clinic_id AND patient_ref = OLD.id::text
     ) THEN
    RAISE EXCEPTION 'La ficha tiene notas clínicas: no se borra, se archiva (la historia clínica se conserva por ley).'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS patients_impedir_borrar_con_notas ON public.patients;
CREATE TRIGGER patients_impedir_borrar_con_notas
  BEFORE DELETE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.impedir_borrar_paciente_con_notas();

-- ═══ 2 · FUSIÓN DE FICHAS (CLI-06) ════════════════════════════════════════
-- Cambios respecto de 20260904160000:
--   - sin el UPDATE a clinical_notes.patient_id (columna inexistente: hacía
--     fallar la fusión entera). Las notas quedan con su `patient_ref`
--     original; la ficha destino las lista junto a las suyas.
--   - no se fusiona hacia una ficha archivada ni una ficha ya fusionada (una
--     cadena A→B→C escondería la historia).
-- La anamnesis sigue sin combinarse sola: la ficha destino muestra las
-- alergias y antecedentes de la absorbida como alerta (lo arma la app).
CREATE OR REPLACE FUNCTION public.merge_patients(
  p_clinic_id uuid,
  p_source_id uuid,
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source record;
  v_target record;
BEGIN
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
  UPDATE public.quotes              SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.treatment_plans     SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.odontogram_marks    SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.periodontal_charts  SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.patient_documents   SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.patient_consents    SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.messages            SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.lab_orders          SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;

  UPDATE public.patients
     SET merged_into = p_target_id,
         merged_at = now(),
         status = 'inactive'
   WHERE id = p_source_id AND clinic_id = p_clinic_id;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_patients(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merge_patients(uuid, uuid, uuid) TO authenticated;

COMMIT;
