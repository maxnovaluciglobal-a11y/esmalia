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
-- Fuera de alcance (ver docs/MFA.md): las funciones SECURITY DEFINER
-- llamables por RPC que devuelven datos de pacientes
-- (list_patients_with_last_and_next_appointment, get_patient_document_id)
-- saltean RLS por diseño y por lo tanto también esta política.
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

commit;

-- ---------------------------------------------------------------------------
-- REVERSA (copiar sin los "-- " y correr con psql si hubiera que volver atrás)
-- ---------------------------------------------------------------------------
-- begin;
-- drop policy if exists mfa_exige_aal2_clinical_documents on storage.objects;
-- drop policy if exists mfa_exige_aal2 on public.appointment_requests;
-- drop policy if exists mfa_exige_aal2 on public.appointments;
-- drop policy if exists mfa_exige_aal2 on public.cash_registers;
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
-- drop policy if exists mfa_exige_aal2 on public.patient_medical_history;
-- drop policy if exists mfa_exige_aal2 on public.patient_medical_history_audit;
-- drop policy if exists mfa_exige_aal2 on public.patients;
-- drop policy if exists mfa_exige_aal2 on public.payments;
-- drop policy if exists mfa_exige_aal2 on public.periodontal_charts;
-- drop policy if exists mfa_exige_aal2 on public.periodontal_measurements;
-- drop policy if exists mfa_exige_aal2 on public.portal_access_log;
-- drop policy if exists mfa_exige_aal2 on public.quote_items;
-- drop policy if exists mfa_exige_aal2 on public.quotes;
-- drop policy if exists mfa_exige_aal2 on public.treatment_items;
-- drop policy if exists mfa_exige_aal2 on public.treatment_plans;
-- drop policy if exists mfa_exige_aal2 on public.waitlist_entries;
-- drop policy if exists mfa_exige_aal2 on public.whatsapp_leads;
-- drop function if exists public.sesion_cumple_mfa();
-- commit;
