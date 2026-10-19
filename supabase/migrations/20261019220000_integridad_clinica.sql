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

-- FKs clínicas: CASCADE → RESTRICT. Se toman del catálogo (no de una lista
-- fija, para cubrir las tablas nuevas) y se recrean con el mismo nombre, NOT VALID +
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
  r record;
  v_huerfanos bigint;
  v_nombre text;
BEGIN
  -- Todas las FKs que hoy van en CASCADE desde `patients` (incluidas las
  -- tablas clínicas que agregaron migraciones anteriores a esta: tutores,
  -- signos vitales, recetas, ...), menos las que no son historia clínica.
  FOR r IN
    SELECT c.conrelid::regclass::text AS tabla, c.conname, a.attname AS columna
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.patients'::regclass
       AND c.confdeltype = 'c'
       AND array_length(c.conkey, 1) = 1
       AND c.conrelid::regclass::text NOT IN ('messages', 'appointment_requests')
     ORDER BY 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s x WHERE x.%I IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = x.%I)',
      r.tabla, r.columna, r.columna)
      INTO v_huerfanos;
    IF v_huerfanos > 0 THEN
      RAISE EXCEPTION '% tiene % filas con %.% sin paciente: revisar antes de migrar.',
        r.tabla, v_huerfanos, r.tabla, r.columna;
    END IF;

    v_nombre := r.conname;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabla, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I)
         REFERENCES public.patients(id) ON DELETE RESTRICT NOT VALID',
      r.tabla, v_nombre, r.columna);
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tabla, v_nombre);
    RAISE NOTICE 'FK %.% → patients: CASCADE → RESTRICT', r.tabla, r.columna;
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
--   - documentos y consentimientos firmados tampoco se mueven (sus triggers
--     de inmutabilidad lo impiden): se leen desde la ficha destino.
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
  -- patient_documents y patient_consents NO se mueven: sus triggers de
  -- inmutabilidad (con razón) rechazan cambiar el patient_id y hacían fallar
  -- la fusión. Igual que las notas, la ficha destino los lee desde las
  -- fichas fusionadas en ella.
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

-- ═══ 3 · NOTAS: ADENDA, FIRMA CON REGISTRO Y VERSIÓN ATÓMICA ═════════════

ALTER TABLE public.clinical_notes
  -- NO ACTION (y no RESTRICT): al borrar una clínica entera, la nota y su
  -- adenda caen en la misma sentencia y el chequeo se hace al final.
  ADD COLUMN IF NOT EXISTS addendum_of uuid REFERENCES public.clinical_notes(id),
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by uuid,
  ADD COLUMN IF NOT EXISTS signer_name text,
  ADD COLUMN IF NOT EXISTS signer_license text,
  ADD COLUMN IF NOT EXISTS signed_content_hash text;

COMMENT ON COLUMN public.clinical_notes.addendum_of IS
  'Nota firmada a la que esta adenda corrige o completa. Una nota firmada no se reabre: se le agrega una adenda.';
COMMENT ON COLUMN public.clinical_notes.signer_license IS
  'Número de registro/colegiatura del firmante al momento de firmar (foto, no FK: si después cambia, la firma no cambia).';
COMMENT ON COLUMN public.clinical_notes.signed_content_hash IS
  'sha256 (hex) de título + salto de línea + contenido al firmar.';

CREATE INDEX IF NOT EXISTS clinical_notes_addendum_idx
  ON public.clinical_notes (addendum_of) WHERE addendum_of IS NOT NULL;

-- Datos de firma de quien no tiene ficha de profesional vinculada (hoy casi
-- nadie la tiene: `professionals.user_id` solo lo llena la demo). Por
-- clínica, porque el registro es por país.
ALTER TABLE public.clinic_members
  ADD COLUMN IF NOT EXISTS signature_name text,
  ADD COLUMN IF NOT EXISTS license_number text;

COMMENT ON COLUMN public.clinic_members.license_number IS
  'Número de registro/colegiatura con el que firma notas clínicas en esta clínica. Lo carga la persona (registrar_mis_datos_de_firma).';

-- Quién firma y con qué registro. Primero la ficha de profesional vinculada
-- al usuario (si tiene registro); si no, lo que la persona cargó en su
-- membresía. NULL en cualquiera de los dos = no puede firmar.
CREATE OR REPLACE FUNCTION public.datos_de_firma(p_clinic_id uuid, p_user_id uuid)
RETURNS TABLE (nombre text, registro text, origen text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH profesional AS (
    SELECT btrim(p.full_name) AS nombre, btrim(p.license_number) AS registro
      FROM public.professionals p
     WHERE p.clinic_id = p_clinic_id
       AND p.user_id = p_user_id
       AND p.is_active
       AND coalesce(btrim(p.license_number), '') <> ''
     ORDER BY p.created_at
     LIMIT 1
  ), miembro AS (
    SELECT btrim(m.signature_name) AS nombre, btrim(m.license_number) AS registro
      FROM public.clinic_members m
     WHERE m.clinic_id = p_clinic_id
       AND m.user_id = p_user_id
       AND coalesce(btrim(m.signature_name), '') <> ''
       AND coalesce(btrim(m.license_number), '') <> ''
     LIMIT 1
  )
  SELECT nombre, registro, 'profesional' FROM profesional
  UNION ALL
  SELECT nombre, registro, 'miembro' FROM miembro
   WHERE NOT EXISTS (SELECT 1 FROM profesional)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.datos_de_firma(uuid, uuid) FROM public, anon, authenticated;

-- Lo que la app consulta antes de firmar: solo los datos propios.
CREATE OR REPLACE FUNCTION public.mis_datos_de_firma(p_clinic_id uuid)
RETURNS TABLE (nombre text, registro text, origen text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.nombre, d.registro, d.origen
    FROM public.datos_de_firma(p_clinic_id, auth.uid()) d
   WHERE public.is_clinic_member(p_clinic_id);
$$;

REVOKE ALL ON FUNCTION public.mis_datos_de_firma(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mis_datos_de_firma(uuid) TO authenticated;

-- "Si el profesional no tiene registro, se le pide cargarlo": la persona
-- carga SU nombre y SU registro, nunca los de otro. Si tiene ficha de
-- profesional vinculada sin registro, se completa ahí; si ya tenía registro
-- en esa ficha, lo corrige un administrador desde Profesionales.
CREATE OR REPLACE FUNCTION public.registrar_mis_datos_de_firma(
  p_clinic_id uuid,
  p_nombre text,
  p_registro text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_registro text := btrim(coalesce(p_registro, ''));
  v_prof record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_clinic_role(p_clinic_id, ARRAY['owner','admin','dentist']::public.app_role[]) THEN
    RAISE EXCEPTION 'Tu rol no firma notas clínicas.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clinics WHERE id = p_clinic_id AND is_demo) THEN
    RAISE EXCEPTION 'Esta es la clínica demo — de solo lectura.';
  END IF;
  IF char_length(v_nombre) < 3 OR char_length(v_nombre) > 160 THEN
    RAISE EXCEPTION 'Escribe tu nombre completo, tal como figura en tu registro profesional.'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_registro) < 2 OR char_length(v_registro) > 60 THEN
    RAISE EXCEPTION 'Escribe tu número de registro o colegiatura profesional.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id, license_number INTO v_prof
    FROM public.professionals
   WHERE clinic_id = p_clinic_id AND user_id = v_uid AND is_active
   ORDER BY created_at
   LIMIT 1;

  IF v_prof.id IS NOT NULL THEN
    IF coalesce(btrim(v_prof.license_number), '') <> '' THEN
      RAISE EXCEPTION 'Tu ficha de profesional ya tiene un número de registro. Si hay que corregirlo, pídeselo a un administrador en Profesionales.';
    END IF;
    UPDATE public.professionals SET license_number = v_registro WHERE id = v_prof.id;
  END IF;

  UPDATE public.clinic_members
     SET signature_name = v_nombre,
         license_number = v_registro
   WHERE clinic_id = p_clinic_id AND user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_mis_datos_de_firma(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registrar_mis_datos_de_firma(uuid, text, text) TO authenticated;

-- Transiciones de una nota. Igual que 20260726161856, con tres cambios:
--   - una nota firmada no vuelve a borrador (se corrige con una adenda);
--   - `addendum_of` no se reasigna;
--   - los datos de la firma solo los escribe el trigger de firma.
-- Los mensajes de "reábrela" pasan a "agrega una adenda".
CREATE OR REPLACE FUNCTION public.enforce_clinical_note_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_manager boolean;
  v_clinico boolean;
  v_author boolean;
  v_reviewer boolean;
  v_requester boolean;
  v_content_changed boolean;
  v_status_changed boolean;
  v_review_changed boolean;
  v_reviewer_role public.app_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW; -- service_role / procesos internos
  END IF;

  v_role := public.clinic_role_of(OLD.clinic_id, v_uid);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No perteneces a esta clínica.';
  END IF;

  v_manager  := v_role IN ('owner','admin');
  v_clinico  := v_role IN ('owner','admin','dentist','assistant');
  v_author   := OLD.created_by = v_uid;
  v_reviewer := OLD.reviewer_id = v_uid;
  v_requester := OLD.review_requested_by = v_uid;

  v_content_changed := NEW.title IS DISTINCT FROM OLD.title
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.summary IS DISTINCT FROM OLD.summary;
  v_status_changed := NEW.status IS DISTINCT FROM OLD.status;
  v_review_changed := NEW.review_status IS DISTINCT FROM OLD.review_status
    OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
    OR NEW.review_requested_by IS DISTINCT FROM OLD.review_requested_by;

  IF NOT v_clinico THEN
    RAISE EXCEPTION 'Tu rol no puede modificar notas clínicas.';
  END IF;

  -- La clínica y el paciente de una nota son inmutables
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.patient_ref IS DISTINCT FROM OLD.patient_ref THEN
    RAISE EXCEPTION 'No se puede reasignar una nota a otra clínica o paciente.';
  END IF;

  IF NEW.addendum_of IS DISTINCT FROM OLD.addendum_of THEN
    RAISE EXCEPTION 'Una adenda no se puede reasignar a otra nota.';
  END IF;

  -- La firma la estampa el trigger clinical_notes_firmar al pasar a 'signed'.
  IF (NEW.signed_at, NEW.signed_by, NEW.signer_name, NEW.signer_license, NEW.signed_content_hash)
     IS DISTINCT FROM
     (OLD.signed_at, OLD.signed_by, OLD.signer_name, OLD.signer_license, OLD.signed_content_hash)
     AND NOT (v_status_changed AND NEW.status = 'signed') THEN
    RAISE EXCEPTION 'Los datos de la firma no se editan.';
  END IF;

  -- Edición de contenido
  IF v_content_changed THEN
    IF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'La nota está firmada: para corregirla, agrega una adenda.';
    END IF;
    IF OLD.review_status = 'pending' THEN
      RAISE EXCEPTION 'La nota está en revisión: no puede editarse hasta resolverla.';
    END IF;
    IF NOT (v_author OR v_manager OR v_role = 'dentist') THEN
      RAISE EXCEPTION 'Solo el autor, un doctor/a o un administrador puede editar esta nota.';
    END IF;
  END IF;

  -- Firmar (reabrir ya no existe)
  IF v_status_changed THEN
    IF NEW.status = 'signed' THEN
      IF NOT (v_manager OR v_role = 'dentist') THEN
        RAISE EXCEPTION 'Tu rol no puede firmar notas clínicas.';
      END IF;
    ELSIF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'Una nota firmada no se reabre: agrega una adenda con la corrección.';
    END IF;
  END IF;

  -- Cambios en el flujo de revisión
  IF v_review_changed THEN
    IF NEW.review_status = 'pending' AND OLD.review_status IS DISTINCT FROM 'pending' THEN
      IF NEW.status <> 'signed' THEN
        RAISE EXCEPTION 'Solo puedes enviar a revisión una nota firmada.';
      END IF;
      IF NOT (v_author OR v_manager OR v_role = 'dentist') THEN
        RAISE EXCEPTION 'Tu rol no puede solicitar revisiones clínicas.';
      END IF;
      IF NEW.reviewer_id IS NULL OR NEW.reviewer_id = v_uid THEN
        RAISE EXCEPTION 'Elige a otro profesional como revisor.';
      END IF;
      IF NEW.review_requested_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'La solicitud de revisión debe registrarse a tu nombre.';
      END IF;
      v_reviewer_role := public.clinic_role_of(OLD.clinic_id, NEW.reviewer_id);
      IF v_reviewer_role IS NULL OR v_reviewer_role NOT IN ('owner','admin','dentist') THEN
        RAISE EXCEPTION 'El revisor debe ser doctor/a, administrador o propietario de la clínica.';
      END IF;

    ELSIF NEW.review_status IN ('approved','changes_requested') THEN
      IF OLD.review_status <> 'pending' THEN
        RAISE EXCEPTION 'Esta nota no está pendiente de aprobación.';
      END IF;
      IF NOT (v_reviewer OR v_manager) THEN
        RAISE EXCEPTION 'Solo el revisor asignado o un administrador puede resolver esta revisión.';
      END IF;
      IF NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id THEN
        RAISE EXCEPTION 'No se puede cambiar el revisor al resolver la revisión.';
      END IF;

    ELSIF NEW.review_status = 'none' THEN
      IF OLD.review_status = 'pending' AND NOT (v_requester OR v_manager OR v_reviewer) THEN
        RAISE EXCEPTION 'Solo quien solicitó la revisión, el revisor o un administrador puede cancelarla.';
      END IF;
      IF OLD.review_status <> 'pending' AND NOT (v_author OR v_manager OR v_role = 'dentist') THEN
        RAISE EXCEPTION 'Tu rol no puede limpiar el estado de revisión.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Firmar = estampar quién, con qué nombre y registro, cuándo y sobre qué
-- contenido. Corre después de enforce_clinical_note_update (orden alfabético
-- de los triggers BEFORE: "..._enforce_update" < "..._firmar"), que ya
-- verificó que el rol puede firmar.
CREATE OR REPLACE FUNCTION public.firmar_nota_clinica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_firmante uuid := coalesce(auth.uid(), NEW.updated_by);
  v_nombre text;
  v_registro text;
BEGIN
  SELECT d.nombre, d.registro INTO v_nombre, v_registro
    FROM public.datos_de_firma(NEW.clinic_id, v_firmante) d;

  -- Una persona firma solo con nombre y registro. El rol de servicio (scripts,
  -- seeds) firma con lo que haya: no tiene a quién pedírselo.
  IF v_uid IS NOT NULL AND (v_nombre IS NULL OR v_registro IS NULL) THEN
    RAISE EXCEPTION 'Para firmar necesitas tu nombre completo y tu número de registro profesional.'
      USING ERRCODE = 'P0001', HINT = 'registro_profesional_requerido';
  END IF;

  NEW.signed_at := now();
  NEW.signed_by := v_firmante;
  NEW.signer_name := v_nombre;
  NEW.signer_license := v_registro;
  NEW.signed_content_hash := encode(
    sha256(convert_to(NEW.title || E'\n' || NEW.content, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clinical_notes_firmar ON public.clinical_notes;
CREATE TRIGGER clinical_notes_firmar
  BEFORE UPDATE ON public.clinical_notes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'signed')
  EXECUTE FUNCTION public.firmar_nota_clinica();

-- Alta de una nota por un usuario: nace como borrador y sin firma (antes se
-- podía insertar directo como 'signed', una firma sin firmante). Si es una
-- adenda, apunta a una nota firmada del mismo paciente y que no sea a su vez
-- una adenda.
CREATE OR REPLACE FUNCTION public.validar_alta_de_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_padre record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Una nota nueva empieza como borrador: fírmala después de guardarla.';
  END IF;
  NEW.signed_at := NULL;
  NEW.signed_by := NULL;
  NEW.signer_name := NULL;
  NEW.signer_license := NULL;
  NEW.signed_content_hash := NULL;

  IF NEW.addendum_of IS NOT NULL THEN
    SELECT clinic_id, patient_ref, status, addendum_of INTO v_padre
      FROM public.clinical_notes WHERE id = NEW.addendum_of;
    IF NOT FOUND
       OR v_padre.clinic_id IS DISTINCT FROM NEW.clinic_id
       OR v_padre.patient_ref IS DISTINCT FROM NEW.patient_ref THEN
      RAISE EXCEPTION 'La adenda tiene que ser de una nota de este mismo paciente.';
    END IF;
    IF v_padre.status IS DISTINCT FROM 'signed' THEN
      RAISE EXCEPTION 'Solo se agrega una adenda a una nota firmada; un borrador se edita directamente.';
    END IF;
    IF v_padre.addendum_of IS NOT NULL THEN
      RAISE EXCEPTION 'Agrega la adenda a la nota original, no a otra adenda.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clinical_notes_validar_alta ON public.clinical_notes;
CREATE TRIGGER clinical_notes_validar_alta
  BEFORE INSERT ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.validar_alta_de_nota();

-- Mismo control que antes al insertar una versión, con el mensaje nuevo.
CREATE OR REPLACE FUNCTION public.enforce_note_version_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  n record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT clinic_id, status, review_status INTO n
    FROM public.clinical_notes WHERE id = NEW.note_id;
  IF n IS NULL THEN
    RAISE EXCEPTION 'No encontramos esa nota.';
  END IF;
  IF NEW.clinic_id IS DISTINCT FROM n.clinic_id THEN
    RAISE EXCEPTION 'La versión no coincide con la clínica de la nota.';
  END IF;
  IF n.status = 'signed' THEN
    RAISE EXCEPTION 'La nota está firmada: para corregirla, agrega una adenda.';
  END IF;
  IF n.review_status = 'pending' THEN
    RAISE EXCEPTION 'La nota está en revisión: no puede versionarse hasta resolverla.';
  END IF;

  RETURN NEW;
END;
$$;

-- CLI-07: ningún cambio de contenido sin su versión. Trigger DIFERIDO: se
-- evalúa al confirmar la transacción y exige que exista una versión creada en
-- esta misma transacción (created_at = now(), el inicio de la transacción)
-- con el título, contenido y resumen que quedaron en la nota. Un UPDATE
-- directo por la API (sin versión) se rechaza; `guardar_nota_clinica` hace
-- las dos cosas juntas y pasa. El rol de servicio (seeds, scripts) queda
-- afuera, como en el resto de los triggers de notas.
CREATE OR REPLACE FUNCTION public.exigir_version_de_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT title, content, summary INTO n FROM public.clinical_notes WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clinical_note_versions v
     WHERE v.note_id = NEW.id
       AND v.created_at = now()
       AND v.title = n.title
       AND v.content = n.content
       AND v.summary IS NOT DISTINCT FROM n.summary
  ) THEN
    RAISE EXCEPTION 'Cada cambio de una nota clínica queda como versión: guarda la nota desde Esmalia.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS clinical_notes_exigir_version ON public.clinical_notes;
CREATE CONSTRAINT TRIGGER clinical_notes_exigir_version
  AFTER INSERT OR UPDATE OF title, content, summary ON public.clinical_notes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.exigir_version_de_nota();

-- Guardar = nota + versión en una sola transacción. SECURITY INVOKER: corre
-- con la RLS y los triggers de quien llama (no salta ningún permiso). El
-- UPDATE toma el lock de la fila, así que dos guardados simultáneos de la
-- misma nota se ordenan y no chocan en el número de versión.
CREATE OR REPLACE FUNCTION public.guardar_nota_clinica(
  p_clinic_id uuid,
  p_patient_ref text,
  p_note_id uuid,
  p_title text,
  p_content text,
  p_summary text DEFAULT NULL,
  p_patient_name text DEFAULT NULL,
  p_ai_assisted boolean DEFAULT false,
  p_ai_action text DEFAULT NULL,
  p_addendum_of uuid DEFAULT NULL,
  p_revert_of_version integer DEFAULT NULL
)
RETURNS TABLE (nota_id uuid, version_nueva integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_version integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión.' USING ERRCODE = '42501';
  END IF;

  IF p_note_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.clinical_notes WHERE id = p_note_id) THEN
    UPDATE public.clinical_notes
       SET title = p_title,
           content = p_content,
           summary = p_summary,
           updated_by = v_uid
     WHERE id = p_note_id
       AND clinic_id = p_clinic_id
       AND patient_ref = p_patient_ref
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'No tienes permisos para editar esta nota clínica.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF p_revert_of_version IS NOT NULL THEN
      RAISE EXCEPTION 'No encontramos esa nota.';
    END IF;
    INSERT INTO public.clinical_notes
      (id, clinic_id, patient_ref, patient_name, title, content, summary,
       created_by, updated_by, addendum_of)
    VALUES
      (coalesce(p_note_id, gen_random_uuid()), p_clinic_id, p_patient_ref, p_patient_name,
       p_title, p_content, p_summary, v_uid, v_uid, p_addendum_of)
    RETURNING id INTO v_id;
  END IF;

  SELECT coalesce(max(v.version), 0) + 1 INTO v_version
    FROM public.clinical_note_versions v WHERE v.note_id = v_id;

  INSERT INTO public.clinical_note_versions
    (note_id, clinic_id, version, title, content, summary, ai_assisted, ai_action,
     author_id, origin, origin_version)
  VALUES
    (v_id, p_clinic_id, v_version, p_title, p_content, p_summary,
     coalesce(p_ai_assisted, false), p_ai_action, v_uid,
     CASE WHEN p_revert_of_version IS NULL THEN 'save' ELSE 'revert' END,
     p_revert_of_version);

  RETURN QUERY SELECT v_id, v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_nota_clinica(uuid, text, uuid, text, text, text, text, boolean, text, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.guardar_nota_clinica(uuid, text, uuid, text, text, text, text, boolean, text, uuid, integer) TO authenticated;

-- La adenda deja rastro también en la nota que corrige.
ALTER TABLE public.clinical_note_audit DROP CONSTRAINT IF EXISTS clinical_note_audit_action_check;
ALTER TABLE public.clinical_note_audit ADD CONSTRAINT clinical_note_audit_action_check
  CHECK (action = ANY (ARRAY[
    'create','edit','revert','sign','reopen','addendum',
    'entity_confirm','entity_delete',
    'review_requested','review_approved','review_changes_requested','review_comment','review_cancelled',
    'conflict','ai_draft','ai_summary','ai_polish','ai_structure'
  ]));

CREATE OR REPLACE FUNCTION public.auditar_version_de_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accion text;
  v_detalle text;
  v_patient_ref text;
  v_addendum_of uuid;
BEGIN
  SELECT patient_ref, addendum_of INTO v_patient_ref, v_addendum_of
  FROM public.clinical_notes WHERE id = NEW.note_id;

  IF NEW.origin = 'revert' THEN
    v_accion := 'revert';
    v_detalle := format('Revirtió a v%s como nuevo borrador v%s',
                        NEW.origin_version, NEW.version);
  ELSIF NEW.version = 1 THEN
    v_accion := 'create';
    v_detalle := format('v%s', NEW.version);
  ELSE
    v_accion := 'edit';
    v_detalle := format('v%s', NEW.version);
  END IF;

  IF NEW.origin <> 'revert' AND NEW.ai_assisted THEN
    v_detalle := v_detalle || ' · con asistencia de IA';
  END IF;

  PERFORM public.anotar_auditoria_de_nota(
    NEW.note_id, NEW.clinic_id, coalesce(v_patient_ref, ''),
    v_accion, v_detalle, NEW.author_id);

  IF NEW.version = 1 AND v_addendum_of IS NOT NULL THEN
    PERFORM public.anotar_auditoria_de_nota(
      v_addendum_of, NEW.clinic_id, coalesce(v_patient_ref, ''),
      'addendum', NEW.title, NEW.author_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Funciones de trigger: nadie las llama por RPC (mismo criterio que
-- 20261013000100).
REVOKE ALL ON FUNCTION public.controlar_archivo_de_paciente() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.impedir_borrar_paciente_con_notas() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.firmar_nota_clinica() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_alta_de_nota() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.exigir_version_de_nota() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_clinical_note_update() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_note_version_insert() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.auditar_version_de_nota() FROM public, anon, authenticated;

COMMIT;
