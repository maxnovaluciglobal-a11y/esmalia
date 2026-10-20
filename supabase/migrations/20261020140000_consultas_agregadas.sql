-- Consultas agregadas en Postgres (auditoría de rendimiento, 20-oct-2026).
--
-- PostgREST corta toda respuesta en `max_rows` (1000 en Supabase) sin avisar.
-- Tres lecturas traían filas crudas para agregarlas en JS y se quedaban cortas
-- en silencio con volumen real:
--
--   1. patient_balances: el saldo por paciente (ficha, agenda, morosidad y el
--      aviso de saldo pendiente). Con más de 1000 líneas de tratamiento o
--      pagos en la clínica, el saldo salía mal y el outreach de "saldo" podía
--      escribirle a quien ya pagó.
--   2. outreach_patient_visits: última visita finalizada y si tiene una cita
--      futura, por paciente con WhatsApp habilitado (recall de higiene e
--      invitación a referidos). Antes eran las 2000 citas finalizadas más
--      recientes (1000 de verdad), justo las que NO necesita el recall.
--   3. clinical_note_versions_meta: el historial de versiones de las notas de
--      un paciente sin el contenido completo de cada versión (se pide aparte,
--      al abrir el comparador) y sin un `.in()` de ids en la URL.
--
-- Las tres son SECURITY INVOKER: corren con los permisos de quien llama, así
-- que la RLS de cada tabla (incluida la de MFA, `mfa_exige_aal2`) se aplica
-- igual que en un SELECT por REST. No cambian ninguna política.

-- ─── 1. Saldo por paciente ──────────────────────────────────────────────────
-- Misma regla que tenía fetchPatientBalances (patients.functions.ts):
--   facturado = Σ coalesce(patient_cents, price_cents) de treatment_items de la
--               clínica cuyo plan no está 'cancelled' (patient_cents es lo que
--               le toca al paciente con convenio; 0 es un valor real).
--   pagado    = Σ amount_cents de payments de la clínica no reversados.
-- Un paciente aparece si tiene al menos una línea facturada o un pago.
create or replace function public.patient_balances(
  p_clinic_id uuid,
  p_patient_ids uuid[] default null
)
returns table (patient_id uuid, billed_cents bigint, paid_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with facturado as (
    select tp.patient_id,
           sum(coalesce(ti.patient_cents, ti.price_cents, 0))::bigint as cents
    from public.treatment_items ti
    join public.treatment_plans tp on tp.id = ti.plan_id
    where ti.clinic_id = p_clinic_id
      and tp.status <> 'cancelled'
      and (p_patient_ids is null or tp.patient_id = any (p_patient_ids))
    group by tp.patient_id
  ),
  pagado as (
    select pa.patient_id,
           sum(coalesce(pa.amount_cents, 0))::bigint as cents
    from public.payments pa
    where pa.clinic_id = p_clinic_id
      and pa.reversed_at is null
      and (p_patient_ids is null or pa.patient_id = any (p_patient_ids))
    group by pa.patient_id
  )
  select coalesce(f.patient_id, p.patient_id) as patient_id,
         coalesce(f.cents, 0)::bigint as billed_cents,
         coalesce(p.cents, 0)::bigint as paid_cents
  from facturado f
  full join pagado p on p.patient_id = f.patient_id;
$$;

comment on function public.patient_balances(uuid, uuid[]) is
  'Saldo por paciente (facturado y pagado). SECURITY INVOKER: respeta la RLS de treatment_items, treatment_plans y payments.';

revoke all on function public.patient_balances(uuid, uuid[]) from public, anon;
grant execute on function public.patient_balances(uuid, uuid[]) to authenticated, service_role;

-- ─── 2. Visitas para el outreach ────────────────────────────────────────────
-- Una fila por paciente con WhatsApp habilitado (wa_opt_in y sin baja) que
-- tuvo al menos una cita finalizada.
create or replace function public.outreach_patient_visits(p_clinic_id uuid)
returns table (patient_id uuid, last_visit_at timestamptz, has_future boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select pt.id as patient_id,
         ultima.last_visit_at,
         exists (
           select 1
           from public.appointments fu
           where fu.clinic_id = p_clinic_id
             and fu.patient_id = pt.id
             and fu.status <> 'cancelada'
             and fu.starts_at > now()
         ) as has_future
  from public.patients pt
  join lateral (
    select max(a.ends_at) as last_visit_at
    from public.appointments a
    where a.clinic_id = p_clinic_id
      and a.patient_id = pt.id
      and a.status = 'finalizada'
  ) ultima on ultima.last_visit_at is not null
  where pt.clinic_id = p_clinic_id
    and pt.wa_opt_in
    and pt.wa_opt_out_at is null;
$$;

comment on function public.outreach_patient_visits(uuid) is
  'Última visita finalizada y cita futura por paciente con WhatsApp habilitado. SECURITY INVOKER.';

revoke all on function public.outreach_patient_visits(uuid) from public, anon;
grant execute on function public.outreach_patient_visits(uuid) to authenticated, service_role;

-- ─── 3. Historial de versiones sin contenido ────────────────────────────────
-- `matches_note` replica `versionVigente` (clinical-notes.ts): la versión
-- vigente es la de número más alto cuyo título y contenido coinciden con lo
-- guardado en clinical_notes. `preview` alcanza para las dos líneas que
-- muestra la lista; el contenido completo se pide al abrir el comparador.
create or replace function public.clinical_note_versions_meta(
  p_clinic_id uuid,
  p_note_ids uuid[]
)
returns table (
  id uuid,
  note_id uuid,
  version integer,
  title text,
  preview text,
  ai_assisted boolean,
  ai_action text,
  author_id uuid,
  created_at timestamptz,
  matches_note boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select v.id,
         v.note_id,
         v.version,
         v.title,
         left(v.content, 280) as preview,
         v.ai_assisted,
         v.ai_action,
         v.author_id,
         v.created_at,
         (v.content = n.content and v.title = n.title) as matches_note
  from public.clinical_note_versions v
  join public.clinical_notes n on n.id = v.note_id
  where v.clinic_id = p_clinic_id
    and v.note_id = any (p_note_ids);
$$;

comment on function public.clinical_note_versions_meta(uuid, uuid[]) is
  'Versiones de notas clínicas sin el contenido completo. SECURITY INVOKER: respeta la RLS de clinical_note_versions y clinical_notes.';

revoke all on function public.clinical_note_versions_meta(uuid, uuid[]) from public, anon;
grant execute on function public.clinical_note_versions_meta(uuid, uuid[]) to authenticated, service_role;

-- Reversa:
-- drop function if exists public.patient_balances(uuid, uuid[]);
-- drop function if exists public.outreach_patient_visits(uuid);
-- drop function if exists public.clinical_note_versions_meta(uuid, uuid[]);
