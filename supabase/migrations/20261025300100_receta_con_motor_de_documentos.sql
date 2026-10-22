-- Ola 4 · Frente Receta (2/3): MKT-05, la receta sale del motor de documentos.
--
-- Hasta acá una receta (`prescriptions`, CLI-13) se imprimía con su propio
-- PDF. Desde esta migración cada receta nueva son DOS filas que se escriben
-- juntas, en una sola transacción (`emitir_receta`):
--
--   issued_documents (kind 'receta')  el documento tal como se imprime:
--                                     bloques + HTML del motor, folio,
--                                     firma del profesional y huella. Es lo
--                                     que se descarga, se imprime y se anula.
--   prescriptions                     la receta estructurada (paciente con su
--                                     RUT, medicamento con principio activo,
--                                     vía, dosis, frecuencia y duración),
--                                     lista para mapear a FHIR R4
--                                     MedicationRequest (docs/RECETA_FHIR.md).
--
-- `prescriptions.issued_document_id` las une. Anular una anula la otra
-- (trigger `recetas_anular_juntas`), con el mismo motivo.
--
--   1. document_templates.kind admite 'receta' (y 'presupuesto', del frente
--      paralelo de esta ola, para que el orden en que se apliquen las dos
--      migraciones no importe).
--   2. prescriptions gana: el documento emitido, el documento de identidad del
--      paciente (RUT) y el registro SIS del profesional copiados por la base,
--      y los avisos de alergia que el profesional vio y confirmó al emitir.
--   3. prescriptions_emitir se redefine partiendo de su definición vigente
--      (20261019190000, la única): para las recetas con documento valida que
--      el documento sea una receta de la misma clínica, paciente y
--      profesional, emitida por el mismo usuario y sin anular; exige el
--      registro de la Superintendencia de Salud en clínicas de Chile y la vía
--      de cada medicamento, y suma los datos nuevos a la huella. Las recetas
--      sin documento (el flujo anterior) siguen exactamente igual.
--   4. prescriptions pierde el permiso de DELETE (nunca tuvo política: el
--      permiso venía de los privilegios por defecto y no se usaba).
--   5. `recetas_anular_juntas`: anular una fila anula la otra.
--   6. `emitir_receta`: inserta las dos filas con la identidad y la RLS de
--      quien llama (SECURITY INVOKER: las políticas, incluida mfa_exige_aal2,
--      y los triggers de cada tabla se aplican tal cual).
--
-- Compatible con el código en producción (RUNBOOK regla 3): columnas
-- nullable, una función nueva, triggers nuevos, un CHECK más amplio y un
-- permiso (DELETE) que ningún código usa. El código viejo sigue emitiendo
-- recetas sin documento como hasta hoy.
--
-- Reversa al pie.

begin;

-- ─── 1. Tipo de documento 'receta' ─────────────────────────────────────────

alter table public.document_templates
  drop constraint if exists document_templates_kind_check;
alter table public.document_templates
  add constraint document_templates_kind_check check (kind in (
    'certificado_atencion', 'reposo', 'derivacion', 'alta', 'informe',
    'consentimiento', 'reembolso', 'presupuesto', 'receta', 'otro'
  ));

-- ─── 2. prescriptions: documento, RUT, registro SIS y alergias ─────────────

alter table public.prescriptions
  add column if not exists issued_document_id uuid
    references public.issued_documents(id) on delete restrict,
  add column if not exists patient_document_type_snapshot text,
  add column if not exists patient_document_id_snapshot text,
  add column if not exists professional_sis_snapshot text,
  add column if not exists allergy_alerts jsonb;

alter table public.prescriptions
  drop constraint if exists prescriptions_allergy_alerts_check;
alter table public.prescriptions
  add constraint prescriptions_allergy_alerts_check check (
    allergy_alerts is null
    or (jsonb_typeof(allergy_alerts) = 'array' and jsonb_array_length(allergy_alerts) <= 40)
  );

-- Una receta por documento.
create unique index if not exists prescriptions_issued_document_uniq
  on public.prescriptions (issued_document_id)
  where issued_document_id is not null;

-- Sin DELETE: ya no había política, pero el permiso venía de los privilegios
-- por defecto de Supabase (un DELETE no fallaba, borraba 0 filas). Igual que
-- issued_documents: se quita el permiso y el intento falla de frente.
revoke delete, truncate on public.prescriptions from anon, authenticated;

comment on column public.prescriptions.issued_document_id is
  'MKT-05: documento emitido (issued_documents, kind receta) con el que se imprime esta receta. NULL = receta del flujo anterior (PDF propio).';
comment on column public.prescriptions.patient_document_id_snapshot is
  'Documento de identidad del paciente (RUT en Chile) al emitir, copiado por la base. FHIR: Patient.identifier.';
comment on column public.prescriptions.allergy_alerts is
  'Avisos de alergia que el profesional vio y confirmó al emitir (texto). NULL = receta anterior a MKT-05.';

-- ─── 3. prescriptions_emitir ────────────────────────────────────────────────
-- Parte de la definición de 20261019190000 (la vigente en producción: ninguna
-- migración posterior la redefinió). Lo nuevo va marcado con "MKT-05".

CREATE OR REPLACE FUNCTION public.prescriptions_emitir()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prof record;
  v_clinic record;
  v_branch record;
  v_patient record;
  v_item jsonb;
  v_doc record;
BEGIN
  -- Rol de servicio o scripts sin usuario: no hay a quién atribuir la receta.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Una receta la emite un profesional con su propia cuenta.';
  END IF;
  NEW.issued_by := auth.uid();
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
  IF v_prof.user_id IS DISTINCT FROM auth.uid() THEN
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
       OR v_doc.issued_by IS DISTINCT FROM auth.uid()
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
  NEW.number := public.next_clinic_counter(NEW.clinic_id, 'prescription', NEW.year);

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
$$;

REVOKE EXECUTE ON FUNCTION public.prescriptions_emitir() FROM PUBLIC, anon, authenticated;

-- El trigger ya existe (20261019190000) y apunta a esta función: no se toca.

-- ─── 5. Anular una anula la otra ───────────────────────────────────────────
-- Se anula desde la tarjeta de recetas (prescriptions) o desde la página del
-- documento (issued_documents): la otra fila queda anulada con el mismo
-- motivo. Los triggers `*_solo_anular` de cada tabla siguen decidiendo quién
-- puede (con el mismo auth.uid(): SECURITY DEFINER no cambia la identidad).
-- Sin recursión: la segunda actualización encuentra la primera ya anulada.

create or replace function public.recetas_anular_juntas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.voided_at is not null or new.voided_at is null then
    return null;
  end if;
  if tg_table_name = 'issued_documents' then
    if new.kind = 'receta' then
      update public.prescriptions
         set voided_at = now(), voided_by = new.voided_by, void_reason = new.void_reason
       where issued_document_id = new.id and voided_at is null;
    end if;
  elsif tg_table_name = 'prescriptions' then
    if new.issued_document_id is not null then
      update public.issued_documents
         set voided_at = now(), voided_by = new.voided_by, void_reason = new.void_reason
       where id = new.issued_document_id and voided_at is null;
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.recetas_anular_juntas() from public, anon, authenticated;

drop trigger if exists recetas_anular_juntas on public.issued_documents;
create trigger recetas_anular_juntas
  after update on public.issued_documents
  for each row execute function public.recetas_anular_juntas();

drop trigger if exists recetas_anular_juntas on public.prescriptions;
create trigger recetas_anular_juntas
  after update on public.prescriptions
  for each row execute function public.recetas_anular_juntas();

-- ─── 6. emitir_receta: documento + receta en una sola transacción ──────────
-- SECURITY INVOKER: corre con la identidad y la RLS de quien llama. El
-- contenido (bloques y HTML) lo arma el servidor de la app con el motor
-- (src/lib/documentos/motor.ts); la base pone el resto en cada trigger.

create or replace function public.emitir_receta(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_professional_id uuid,
  p_template_version_id uuid,
  p_fields jsonb,
  p_content_blocks jsonb,
  p_content_html text,
  p_items jsonb,
  p_instructions text,
  p_allergy_alerts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_doc record;
  v_receta_id uuid;
begin
  if not exists (
    select 1
      from public.document_template_versions v
      join public.document_templates t on t.id = v.template_id
     where v.id = p_template_version_id
       and v.clinic_id = p_clinic_id
       and t.kind = 'receta'
  ) then
    raise exception 'Elige una plantilla de receta.' using errcode = '22023';
  end if;

  insert into public.issued_documents
    (clinic_id, patient_id, template_version_id, professional_id, fields,
     content_blocks, content_html, issued_by)
  values
    (p_clinic_id, p_patient_id, p_template_version_id, p_professional_id,
     coalesce(p_fields, '{}'::jsonb), p_content_blocks, p_content_html, auth.uid())
  returning id, year, number, content_sha256 into v_doc;

  insert into public.prescriptions
    (clinic_id, patient_id, professional_id, items, instructions,
     issued_document_id, allergy_alerts, issued_by)
  values
    (p_clinic_id, p_patient_id, p_professional_id, p_items,
     nullif(btrim(coalesce(p_instructions, '')), ''),
     v_doc.id, p_allergy_alerts, auth.uid())
  returning id into v_receta_id;

  return jsonb_build_object(
    'document_id', v_doc.id,
    'prescription_id', v_receta_id,
    'year', v_doc.year,
    'number', v_doc.number,
    'content_sha256', v_doc.content_sha256
  );
end;
$$;

comment on function public.emitir_receta(uuid, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb) is
  'MKT-05: emite una receta (documento del motor + receta estructurada) en una transacción, con la RLS de quien llama.';

revoke all on function public.emitir_receta(uuid, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.emitir_receta(uuid, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb) to authenticated;

commit;

-- Cómo revertir (las recetas emitidas con documento quedan: sus documentos
-- siguen en issued_documents; solo se pierde el vínculo y los datos nuevos):
--
-- begin;
-- drop function if exists public.emitir_receta(uuid, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb);
-- drop trigger if exists recetas_anular_juntas on public.prescriptions;
-- drop trigger if exists recetas_anular_juntas on public.issued_documents;
-- drop function if exists public.recetas_anular_juntas();
-- -- prescriptions_emitir: volver a crear la definición de
-- -- 20261019190000_consentimientos_plantillas_y_recetas.sql (sección 4).
-- drop index if exists public.prescriptions_issued_document_uniq;
-- grant delete on public.prescriptions to authenticated; -- (sin política, no borra nada)
-- alter table public.prescriptions
--   drop constraint if exists prescriptions_allergy_alerts_check,
--   drop column if exists allergy_alerts,
--   drop column if exists professional_sis_snapshot,
--   drop column if exists patient_document_id_snapshot,
--   drop column if exists patient_document_type_snapshot,
--   drop column if exists issued_document_id;
-- -- El CHECK de kind solo se puede volver atrás si no quedan plantillas
-- -- 'receta' ni 'presupuesto' (las de receta las borra la reversa de 20261025300200).
-- alter table public.document_templates drop constraint if exists document_templates_kind_check;
-- alter table public.document_templates add constraint document_templates_kind_check check (kind in (
--   'certificado_atencion', 'reposo', 'derivacion', 'alta', 'informe',
--   'consentimiento', 'reembolso', 'otro'));
-- commit;
