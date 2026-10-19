-- SEG-01 (MFA), segunda parte: la verificación en dos pasos de quien la
-- activó tiene que valer también contra la API, no solo en la pantalla.
--
-- Hasta acá el desafío TOTP lo pedía `_authenticated/route.tsx` (cliente).
-- El JWT `aal1` (solo contraseña) seguía siendo aceptado por PostgREST, así
-- que con la contraseña robada de alguien CON MFA se podía leer la historia
-- clínica llamando /rest/v1 directo (docs/MFA.md, "Límite conocido").
--
-- Patrón oficial de Supabase (RLS + MFA): una política RESTRICTIVE por tabla
-- sensible. Las restrictivas se combinan con AND con las permisivas que ya
-- existen (is_clinic_member / has_clinic_role): no abren nada, solo pueden
-- cerrar.
--
--   - Sin factor verificado              → true (todo igual que hoy).
--   - Con factor verificado y JWT aal2   → true.
--   - Con factor verificado y JWT aal1   → false: 0 filas al leer, error de
--                                           RLS al escribir.
--   - Cuenta demo (demo@esmalia.com)     → true siempre. Ya no puede tener
--     factores (20261019140000), esto es el cinturón por si alguno quedara:
--     la contraseña de la demo es pública y la app nunca le pide el código.
--   - service_role                       → no la ve (BYPASSRLS). Webhooks,
--     crons, portal del paciente y portal del laboratorio siguen igual.
--   - anon                               → no aplica (`to authenticated`).
--
-- Rendimiento: la función es STABLE y cada política la llama envuelta en
-- `(select ...)`, así Postgres la evalúa UNA vez por consulta (InitPlan) y no
-- una vez por fila. Por dentro son dos búsquedas por índice
-- (auth.mfa_factors.user_id y auth.users.id).
--
-- SECURITY DEFINER con search_path vacío: `authenticated` no tiene por qué
-- leer auth.mfa_factors ni auth.users. EXECUTE solo para authenticated y
-- service_role (las políticas se evalúan con el rol del usuario).
--
-- La lista de tablas sale de `src/lib/auth/mfa-rls.ts` y
-- `tests/mfa-rls-tablas.test.ts` exige que este archivo tenga exactamente el
-- SQL que genera `sqlPoliticaAal2` para cada una, y que toda tabla nueva del
-- schema quede clasificada (con o sin aal2).
--
-- RPC SECURITY DEFINER: saltean RLS, así que las que leen o escriben datos
-- de pacientes reciben un guard al inicio del cuerpo (sección final). Cada
-- `create or replace` copia la ÚLTIMA definición vigente de la función en
-- supabase/migrations/ y le agrega solo el guard; el test lo verifica, así que
-- si otra migración la redefine, el CI pide volver a copiarla. CREATE OR
-- REPLACE conserva dueño y GRANTs.
--
-- Idempotente (create or replace / drop policy if exists). Reversa al pie.
--
-- ⚠️ NO APLICADA. Requiere OK de Walter (regla 5 del CLAUDE.md del repo).

begin;

create or replace function public.sesion_cumple_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not exists (
      select 1
        from auth.mfa_factors f
       where f.user_id = auth.uid()
         and f.status = 'verified'
    )
    or exists (
      select 1
        from auth.users u
       where u.id = auth.uid()
         and lower(coalesce(u.email, '')) = 'demo@esmalia.com'
    );
$$;

comment on function public.sesion_cumple_mfa() is
  'SEG-01: true si la sesión es aal2, si el usuario no tiene factores MFA verificados, o si es la cuenta demo. La usan las políticas RESTRICTIVE mfa_exige_aal2.';

revoke execute on function public.sesion_cumple_mfa() from public, anon;
grant execute on function public.sesion_cumple_mfa() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tablas con datos de salud, de pacientes o de dinero
-- (generado desde src/lib/auth/mfa-rls.ts, no editar a mano)
-- ---------------------------------------------------------------------------

drop policy if exists mfa_exige_aal2 on public.appointment_requests;
create policy mfa_exige_aal2 on public.appointment_requests
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.appointments;
create policy mfa_exige_aal2 on public.appointments
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.cash_registers;
create policy mfa_exige_aal2 on public.cash_registers
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.clinical_access_log;
create policy mfa_exige_aal2 on public.clinical_access_log
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.clinical_note_audit;
create policy mfa_exige_aal2 on public.clinical_note_audit
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.clinical_note_entities;
create policy mfa_exige_aal2 on public.clinical_note_entities
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.clinical_note_reviews;
create policy mfa_exige_aal2 on public.clinical_note_reviews
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.clinical_note_versions;
create policy mfa_exige_aal2 on public.clinical_note_versions
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.clinical_notes;
create policy mfa_exige_aal2 on public.clinical_notes
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.commission_settlements;
create policy mfa_exige_aal2 on public.commission_settlements
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.expenses;
create policy mfa_exige_aal2 on public.expenses
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.lab_orders;
create policy mfa_exige_aal2 on public.lab_orders
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.messages;
create policy mfa_exige_aal2 on public.messages
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.notifications;
create policy mfa_exige_aal2 on public.notifications
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.odontogram_marks;
create policy mfa_exige_aal2 on public.odontogram_marks
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.ortho_cases;
create policy mfa_exige_aal2 on public.ortho_cases
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.ortho_controls;
create policy mfa_exige_aal2 on public.ortho_controls
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_consents;
create policy mfa_exige_aal2 on public.patient_consents
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_documents;
create policy mfa_exige_aal2 on public.patient_documents
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_guardians;
create policy mfa_exige_aal2 on public.patient_guardians
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_guardians_audit;
create policy mfa_exige_aal2 on public.patient_guardians_audit
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_medical_history;
create policy mfa_exige_aal2 on public.patient_medical_history
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_medical_history_audit;
create policy mfa_exige_aal2 on public.patient_medical_history_audit
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_vital_signs;
create policy mfa_exige_aal2 on public.patient_vital_signs
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patients;
create policy mfa_exige_aal2 on public.patients
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.payments;
create policy mfa_exige_aal2 on public.payments
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.periodontal_charts;
create policy mfa_exige_aal2 on public.periodontal_charts
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.periodontal_measurements;
create policy mfa_exige_aal2 on public.periodontal_measurements
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.portal_access_log;
create policy mfa_exige_aal2 on public.portal_access_log
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.prescriptions;
create policy mfa_exige_aal2 on public.prescriptions
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.quote_items;
create policy mfa_exige_aal2 on public.quote_items
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.quotes;
create policy mfa_exige_aal2 on public.quotes
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.treatment_items;
create policy mfa_exige_aal2 on public.treatment_items
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.treatment_plans;
create policy mfa_exige_aal2 on public.treatment_plans
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.waitlist_entries;
create policy mfa_exige_aal2 on public.waitlist_entries
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.whatsapp_leads;
create policy mfa_exige_aal2 on public.whatsapp_leads
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ---------------------------------------------------------------------------
-- Storage: documentos clínicos y firmas (bucket privado clinical-documents)
-- ---------------------------------------------------------------------------
-- Las políticas existentes (clinical_documents_select/insert) dan acceso por
-- rol de clínica. Esta restrictiva solo mira objetos de ese bucket; el resto
-- de los buckets no cambia.

drop policy if exists mfa_exige_aal2_clinical_documents on storage.objects;
create policy mfa_exige_aal2_clinical_documents on storage.objects
  as restrictive
  for all
  to authenticated
  using (bucket_id <> 'clinical-documents' or (select public.sesion_cumple_mfa()))
  with check (bucket_id <> 'clinical-documents' or (select public.sesion_cumple_mfa()));


-- ---------------------------------------------------------------------------
-- RPC SECURITY DEFINER con datos de pacientes
-- (definición vigente de cada una + guard; ver src/lib/auth/mfa-rls.ts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_patient_document_id(p_patient_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  v_key text;
  v_enc bytea;
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  SELECT p.document_id_enc INTO v_enc
  FROM public.patients p
  JOIN public.clinic_members m ON m.clinic_id = p.clinic_id
  WHERE p.id = p_patient_id AND m.user_id = auth.uid();

  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'esmalia_document_id_key';
  RETURN pgp_sym_decrypt(v_enc, v_key);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_patients_with_last_and_next_appointment(p_clinic_id uuid)
RETURNS TABLE (
  patient_id uuid,
  last_appointment_at timestamptz,
  last_appointment_status appointment_status,
  next_appointment_at timestamptz,
  next_appointment_status appointment_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'No tienes permisos sobre esta clínica.';
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT a.patient_id, a.starts_at, a.status
    FROM public.appointments a
    WHERE a.clinic_id = p_clinic_id AND a.status <> 'cancelada'
  ),
  ranked AS (
    SELECT
      s.patient_id,
      s.starts_at,
      s.status,
      s.starts_at < now() AS is_past,
      ROW_NUMBER() OVER (
        PARTITION BY s.patient_id, s.starts_at < now()
        ORDER BY CASE WHEN s.starts_at < now() THEN s.starts_at END DESC,
                 CASE WHEN s.starts_at >= now() THEN s.starts_at END ASC
      ) AS rn
    FROM scoped s
  )
  SELECT
    p.id AS patient_id,
    MAX(CASE WHEN r.is_past AND r.rn = 1 THEN r.starts_at END) AS last_appointment_at,
    (array_agg(r.status) FILTER (WHERE r.is_past AND r.rn = 1))[1] AS last_appointment_status,
    MAX(CASE WHEN NOT r.is_past AND r.rn = 1 THEN r.starts_at END) AS next_appointment_at,
    (array_agg(r.status) FILTER (WHERE NOT r.is_past AND r.rn = 1))[1] AS next_appointment_status
  FROM public.patients p
  LEFT JOIN ranked r ON r.patient_id = p.id
  WHERE p.clinic_id = p_clinic_id
  GROUP BY p.id;
END;
$$;

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

  -- Las dos fichas tienen que ser de la clínica que pide la fusión.
  IF NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE id = p_source_id AND clinic_id = p_clinic_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.patients
     WHERE id = p_target_id AND clinic_id = p_clinic_id
  ) THEN
    RAISE EXCEPTION 'Alguna de las dos fichas no pertenece a esta clínica.';
  END IF;

  UPDATE public.appointments        SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.payments            SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.quotes              SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.treatment_plans     SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.clinical_notes      SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.odontogram_marks    SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.periodontal_charts  SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.patient_documents   SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.patient_consents    SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.messages            SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;
  UPDATE public.lab_orders          SET patient_id = p_target_id WHERE patient_id = p_source_id AND clinic_id = p_clinic_id;

  -- La historia médica NO se mueve: es una fila por paciente y fusionar dos
  -- anamnesis automáticamente inventaría un cuadro clínico que nadie revisó.
  -- Queda en la ficha origen, accesible, para que un profesional la mire.

  UPDATE public.patients
     SET merged_into = p_target_id,
         merged_at = now(),
         status = 'inactive'
   WHERE id = p_source_id AND clinic_id = p_clinic_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_evento_de_nota(
  p_clinic_id uuid,
  p_action text,
  p_note_id uuid DEFAULT NULL,
  p_patient_ref text DEFAULT NULL,
  p_detail text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('conflict', 'ai_draft', 'ai_summary', 'ai_polish', 'ai_structure') THEN
    RAISE EXCEPTION 'accion % no se puede registrar desde la app: la escribe un trigger', p_action
      USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL OR NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'sin permiso sobre esta clinica' USING ERRCODE = '42501';
  END IF;

  -- La nota, si viene, tiene que ser de esa clínica: si no, se podría ensuciar
  -- el historial de una nota ajena desde una clínica propia.
  IF p_note_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clinical_notes
    WHERE id = p_note_id AND clinic_id = p_clinic_id
  ) THEN
    RAISE EXCEPTION 'la nota no pertenece a esta clinica' USING ERRCODE = '42501';
  END IF;

  PERFORM public.anotar_auditoria_de_nota(
    p_note_id, p_clinic_id, coalesce(p_patient_ref, ''), p_action, p_detail, v_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_exportacion_de_clinica(
  p_clinic_id uuid,
  p_detalle jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL OR NOT public.can_manage_clinic(p_clinic_id) THEN
    RAISE EXCEPTION 'sin permiso para exportar los datos de esta clinica' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.clinic_data_exports (clinic_id, actor_id, formato, detalle)
  VALUES (p_clinic_id, v_actor, 'zip_csv', coalesce(p_detalle, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_lectura_ficha(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_seccion text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL OR NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'sin permiso para leer fichas de esta clinica' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
     WHERE p.id = p_patient_id AND p.clinic_id = p_clinic_id
  ) THEN
    RAISE EXCEPTION 'el paciente no pertenece a esta clinica' USING ERRCODE = '42501';
  END IF;

  -- Las pestañas de la ficha cargan en paralelo y a veces dos veces la misma
  -- sección (odontograma vigente + historial): sin este candado, dos
  -- llamadas simultáneas pasan las dos el chequeo de abajo y anotan doble.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':' || p_patient_id::text || ':' || coalesce(p_seccion, ''), 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.clinical_access_log l
     WHERE l.actor_id = v_actor
       AND l.patient_id = p_patient_id
       AND l.section = p_seccion
       AND l.accessed_at > now() - interval '15 minutes'
  ) THEN
    RETURN false;
  END IF;

  -- Una sección fuera del vocabulario la rechaza el CHECK de la tabla.
  INSERT INTO public.clinical_access_log (clinic_id, patient_id, actor_id, section)
  VALUES (p_clinic_id, p_patient_id, v_actor, p_seccion);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_patient_document_id(p_patient_id uuid, p_document_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_enc bytea;
  v_hash text;
BEGIN
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id
      AND public.has_clinic_role(p.clinic_id, ARRAY['owner','admin','dentist','reception']::public.app_role[])
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para modificar este paciente.';
  END IF;

  SELECT c.documento_enc, c.documento_hash INTO v_enc, v_hash
    FROM public.cifrar_documento_id(p_document_id) c;

  UPDATE public.patients
     SET document_id_enc = v_enc,
         document_id_hash = v_hash
   WHERE id = p_patient_id;
END;
$$;

commit;

-- ---------------------------------------------------------------------------
-- REVERSA (copiar sin los "-- " y correr con psql si hubiera que volver atrás)
-- ---------------------------------------------------------------------------
-- begin;
-- drop policy if exists mfa_exige_aal2_clinical_documents on storage.objects;
-- drop policy if exists mfa_exige_aal2 on public.appointment_requests;
-- drop policy if exists mfa_exige_aal2 on public.appointments;
-- drop policy if exists mfa_exige_aal2 on public.cash_registers;
-- drop policy if exists mfa_exige_aal2 on public.clinical_access_log;
-- drop policy if exists mfa_exige_aal2 on public.clinical_note_audit;
-- drop policy if exists mfa_exige_aal2 on public.clinical_note_entities;
-- drop policy if exists mfa_exige_aal2 on public.clinical_note_reviews;
-- drop policy if exists mfa_exige_aal2 on public.clinical_note_versions;
-- drop policy if exists mfa_exige_aal2 on public.clinical_notes;
-- drop policy if exists mfa_exige_aal2 on public.commission_settlements;
-- drop policy if exists mfa_exige_aal2 on public.expenses;
-- drop policy if exists mfa_exige_aal2 on public.lab_orders;
-- drop policy if exists mfa_exige_aal2 on public.messages;
-- drop policy if exists mfa_exige_aal2 on public.notifications;
-- drop policy if exists mfa_exige_aal2 on public.odontogram_marks;
-- drop policy if exists mfa_exige_aal2 on public.ortho_cases;
-- drop policy if exists mfa_exige_aal2 on public.ortho_controls;
-- drop policy if exists mfa_exige_aal2 on public.patient_consents;
-- drop policy if exists mfa_exige_aal2 on public.patient_documents;
-- drop policy if exists mfa_exige_aal2 on public.patient_guardians;
-- drop policy if exists mfa_exige_aal2 on public.patient_guardians_audit;
-- drop policy if exists mfa_exige_aal2 on public.patient_medical_history;
-- drop policy if exists mfa_exige_aal2 on public.patient_medical_history_audit;
-- drop policy if exists mfa_exige_aal2 on public.patient_vital_signs;
-- drop policy if exists mfa_exige_aal2 on public.patients;
-- drop policy if exists mfa_exige_aal2 on public.payments;
-- drop policy if exists mfa_exige_aal2 on public.periodontal_charts;
-- drop policy if exists mfa_exige_aal2 on public.periodontal_measurements;
-- drop policy if exists mfa_exige_aal2 on public.portal_access_log;
-- drop policy if exists mfa_exige_aal2 on public.prescriptions;
-- drop policy if exists mfa_exige_aal2 on public.quote_items;
-- drop policy if exists mfa_exige_aal2 on public.quotes;
-- drop policy if exists mfa_exige_aal2 on public.treatment_items;
-- drop policy if exists mfa_exige_aal2 on public.treatment_plans;
-- drop policy if exists mfa_exige_aal2 on public.waitlist_entries;
-- drop policy if exists mfa_exige_aal2 on public.whatsapp_leads;
-- -- Las RPC: volver a correr su definición anterior (la última de cada una
-- -- en supabase/migrations/ antes de este archivo), que es esta sin el guard.
-- drop function if exists public.sesion_cumple_mfa();
-- commit;
