-- Cierre de la demo completa: recetas de ejemplo en la clínica demo (28-oct-2026).
--
-- /api/demo-reset deja dos recetas emitidas de ejemplo en las fichas de la demo, firmadas por
-- la profesional vinculada al usuario dueño (con el registro ficticio EJEMPLO-000000), para
-- que la pestaña Recetas, la página de la receta y su PDF no estén vacíos. El reseteo corre
-- con el rol de servicio, sin sesión, y `prescriptions_emitir` exigía `auth.uid()`.
--
-- Se redefine `prescriptions_emitir` con UNA excepción, como ya hace `issued_documents_emitir`
-- (20261025200200) con el documento de ejemplo: solo para el rol de servicio, solo en la
-- clínica demo y solo a nombre del usuario que queda en `issued_by` (que tiene que ser el
-- `user_id` de la ficha del profesional y quien emitió el documento de la receta). Todo lo
-- demás (snapshots, folio, huella) queda igual: el folio sale del mismo upsert atómico que
-- `next_clinic_counter` (que exige una sesión miembro), como hace `issued_documents_emitir`: para una sesión
-- normal la función hace exactamente lo mismo.
--
-- Partida de la definición vigente (20261025300100, `pg_get_functiondef` de la base con todas
-- las migraciones aplicadas): redefine una función existente; no escribe datos ni toca tablas.
-- Aplicar en producción solo con el OK de Walter (RUNBOOK_MIGRACIONES.md).
--
-- Reversa al pie: volver a crear la función con el texto de 20261025300100.

begin;

CREATE OR REPLACE FUNCTION public.prescriptions_emitir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prof record;
  v_clinic record;
  v_branch record;
  v_patient record;
  v_item jsonb;
  v_doc record;
  v_emisor uuid := auth.uid();
  v_servicio boolean := false;
BEGIN
  IF v_emisor IS NULL THEN
    -- Única excepción: el rol de servicio sembrando las recetas de ejemplo de la
    -- clínica demo (/api/demo-reset), a nombre del profesional de la demo vinculado
    -- al usuario dueño (`issued_by` explícito). Cualquier otro caso sin sesión se
    -- rechaza como antes: no hay a quién atribuir la receta.
    IF coalesce(auth.role(), '') <> 'service_role'
       OR NEW.issued_by IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.id = NEW.clinic_id AND c.is_demo)
    THEN
      RAISE EXCEPTION 'Una receta la emite un profesional con su propia cuenta.';
    END IF;
    v_emisor := NEW.issued_by;
    v_servicio := true;
  END IF;
  NEW.issued_by := v_emisor;
  NEW.issued_at := now();
  NEW.voided_at := NULL;
  NEW.voided_by := NULL;
  NEW.void_reason := NULL;

  SELECT p.full_name, p.license_number, p.sis_registry_number, p.user_id, p.branch_id,
         s.name AS specialty
    INTO v_prof
    FROM public.professionals p
    LEFT JOIN public.specialties s ON s.id = p.specialty_id
   WHERE p.id = NEW.professional_id AND p.clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Elige un profesional de esta clínica.';
  END IF;
  IF v_prof.user_id IS DISTINCT FROM v_emisor THEN
    RAISE EXCEPTION 'Solo puedes emitir recetas con tu propia ficha de profesional.';
  END IF;

  SELECT name, legal_name, tax_id, timezone, country INTO v_clinic
    FROM public.clinics WHERE id = NEW.clinic_id;

  IF NEW.issued_document_id IS NULL THEN
    IF nullif(btrim(v_prof.license_number), '') IS NULL THEN
      RAISE EXCEPTION 'Carga tu número de registro profesional antes de emitir recetas.';
    END IF;
  ELSE
    -- MKT-05: en Chile la receta lleva el registro de la Superintendencia de
    -- Salud; en otros países alcanza el registro profesional.
    IF coalesce(v_clinic.country, 'CL') = 'CL'
       AND nullif(btrim(coalesce(v_prof.sis_registry_number, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Carga tu número de registro de la Superintendencia de Salud antes de emitir recetas.';
    END IF;
    IF nullif(btrim(coalesce(v_prof.sis_registry_number, v_prof.license_number, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Carga tu número de registro profesional antes de emitir recetas.';
    END IF;

    -- MKT-05: el documento tiene que ser la receta recién emitida por esta
    -- misma persona, para el mismo paciente y con la misma ficha.
    SELECT d.id, d.clinic_id, d.patient_id, d.kind, d.issued_by, d.professional_id,
           d.voided_at, d.signature_sha256
      INTO v_doc
      FROM public.issued_documents d
     WHERE d.id = NEW.issued_document_id;
    IF NOT FOUND
       OR v_doc.clinic_id <> NEW.clinic_id
       OR v_doc.patient_id <> NEW.patient_id
       OR v_doc.kind <> 'receta'
       OR v_doc.issued_by IS DISTINCT FROM v_emisor
       OR v_doc.professional_id IS DISTINCT FROM NEW.professional_id
       OR v_doc.voided_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'El documento no corresponde a esta receta.' USING ERRCODE = '22023';
    END IF;
    -- La firma la puso el documento (la del profesional al emitir).
    NEW.signature_storage_path := NULL;
    NEW.signature_sha256 := v_doc.signature_sha256;

    IF NEW.allergy_alerts IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(NEW.allergy_alerts) a
          WHERE jsonb_typeof(a) <> 'string' OR char_length(a #>> '{}') > 500
       )
    THEN
      RAISE EXCEPTION 'Avisos de alergia inválidos.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Dirección y teléfono: la sucursal del profesional, o la primera activa.
  SELECT address, city, phone INTO v_branch
    FROM public.branches
   WHERE clinic_id = NEW.clinic_id
   ORDER BY (id = v_prof.branch_id) DESC, is_active DESC, created_at
   LIMIT 1;

  SELECT full_name, birth_date, document_type, document_id INTO v_patient
    FROM public.patients WHERE id = NEW.patient_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El paciente no pertenece a esta clínica.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR nullif(btrim(v_item->>'medication'), '') IS NULL
      OR nullif(btrim(v_item->>'dose'), '') IS NULL
      OR nullif(btrim(v_item->>'frequency'), '') IS NULL
      OR nullif(btrim(v_item->>'duration'), '') IS NULL
    THEN
      RAISE EXCEPTION 'Cada medicamento necesita nombre, dosis, frecuencia y duración.';
    END IF;
    -- MKT-05: la vía de administración (FHIR: dosageInstruction.route).
    IF NEW.issued_document_id IS NOT NULL
       AND coalesce(v_item->>'route', '') NOT IN
         ('oral', 'sublingual', 'enjuague_bucal', 'topica_bucal', 'dental', 'cutanea')
    THEN
      RAISE EXCEPTION 'Indica la vía de administración de cada medicamento.';
    END IF;
  END LOOP;

  NEW.professional_name_snapshot := v_prof.full_name;
  NEW.professional_license_snapshot := coalesce(
    nullif(btrim(v_prof.license_number), ''),
    btrim(v_prof.sis_registry_number)
  );
  NEW.professional_sis_snapshot := nullif(btrim(coalesce(v_prof.sis_registry_number, '')), '');
  NEW.professional_specialty_snapshot := v_prof.specialty;
  NEW.clinic_name_snapshot := v_clinic.name;
  NEW.clinic_legal_name_snapshot := v_clinic.legal_name;
  NEW.clinic_tax_id_snapshot := v_clinic.tax_id;
  NEW.clinic_address_snapshot := nullif(concat_ws(', ', nullif(btrim(v_branch.address), ''), nullif(btrim(v_branch.city), '')), '');
  NEW.clinic_phone_snapshot := nullif(btrim(v_branch.phone), '');
  NEW.patient_name_snapshot := v_patient.full_name;
  NEW.patient_birth_date_snapshot := v_patient.birth_date;
  NEW.patient_document_type_snapshot := v_patient.document_type;
  NEW.patient_document_id_snapshot := nullif(btrim(coalesce(v_patient.document_id, '')), '');

  -- Año en la hora de la clínica, no en UTC (misma lección que presupuestos).
  NEW.year := extract(year FROM now() AT TIME ZONE coalesce(v_clinic.timezone, 'America/Santiago'))::integer;
  IF v_servicio THEN
    -- next_clinic_counter exige una sesión miembro de la clínica: el rol de servicio no la
    -- tiene. Mismo upsert atómico que esa función (regla 8 de CLAUDE.md).
    INSERT INTO public.clinic_counters (clinic_id, kind, year, next_value)
    VALUES (NEW.clinic_id, 'prescription', NEW.year, 2)
    ON CONFLICT (clinic_id, kind, year)
    DO UPDATE SET next_value = clinic_counters.next_value + 1, updated_at = now()
    RETURNING next_value - 1 INTO NEW.number;
  ELSE
    NEW.number := public.next_clinic_counter(NEW.clinic_id, 'prescription', NEW.year);
  END IF;

  -- Recetas sin documento: la misma huella de siempre. Con documento
  -- (MKT-05), además el RUT, el registro SIS, el documento y los avisos.
  NEW.content_sha256 := encode(sha256(convert_to(concat_ws(
    E'\x1f',
    NEW.clinic_id::text,
    NEW.patient_id::text,
    NEW.year::text,
    NEW.number::text,
    NEW.professional_name_snapshot,
    NEW.professional_license_snapshot,
    coalesce(NEW.patient_name_snapshot, ''),
    NEW.items::text,
    coalesce(NEW.instructions, ''),
    coalesce(NEW.signature_sha256, ''),
    to_char(NEW.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) || CASE WHEN NEW.issued_document_id IS NULL THEN '' ELSE E'\x1f' || concat_ws(
    E'\x1f',
    NEW.issued_document_id::text,
    coalesce(NEW.patient_document_type_snapshot, ''),
    coalesce(NEW.patient_document_id_snapshot, ''),
    coalesce(NEW.professional_sis_snapshot, ''),
    coalesce(NEW.allergy_alerts::text, '')
  ) END, 'UTF8')), 'hex');

  RETURN NEW;
END;
$function$;

revoke execute on function public.prescriptions_emitir() from public, anon, authenticated;

commit;

-- Reversa: recrear `public.prescriptions_emitir()` con la definición de
-- 20261025300100_receta_con_motor_de_documentos.sql (sin la excepción del rol de servicio).
