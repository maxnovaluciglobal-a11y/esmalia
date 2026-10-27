-- Ola 7 · Frente B (1/2): correos automáticos al paciente.
--
-- REC-02 recordatorio por correo N horas antes · REC-03 confirmación al
-- agendar · REC-07 configuración por clínica · MKT-07 formulario antes de la
-- cita · MKT-08 encuesta NPS después de la cita.
--
-- Decisión de la ola: el correo al paciente SÍ sale solo (lo dispara el cron
-- horario), pero respeta el modo de prueba de la clínica
-- (`email_sandbox_config`), la baja (`patients.email_opt_out_at`), el tutor
-- y esta configuración. WhatsApp nunca sale desde un cron: no hay nada de
-- WhatsApp acá.
--
--   1. patient_notification_settings: una fila por clínica. Sin fila, todo
--      apagado (la clínica lo enciende en /notificaciones-a-pacientes). Un
--      trigger anota desde cuándo está encendida la confirmación y la
--      encuesta: el cron no le escribe por citas creadas o terminadas antes.
--   2. patient_email_dispatches: registro e idempotencia de cada correo
--      automático. UNIQUE (appointment_id, kind, slot): el doble disparo del
--      cron (Vercel + GitHub) no duplica nada. Solo la escribe el servidor.
--   3. patient_intake_forms: el formulario antes de la cita (datos de
--      contacto y anamnesis). El link es un token de 256 bits: la base guarda
--      solo su sha256. Lo que el paciente envía queda "respondido" y NO toca
--      la ficha hasta que el staff lo acepta.
--   4. patient_nps_responses: la encuesta NPS (0-10 + comentario) de una cita
--      finalizada. Mismo esquema de token.
--
-- Las funciones de las páginas públicas (/formulario/:token y
-- /encuesta/:token) van en la migración siguiente (20261028200100).
--
-- Permisos: la configuración la lee cualquier miembro y la edita owner/admin
-- (`can_manage_clinic`). El registro de envíos lo lee cualquier miembro (es
-- el historial de mensajes de la cita). Los formularios, con anamnesis, solo
-- los roles clínicos (igual que `patient_medical_history`). Las respuestas
-- NPS, owner/admin. Nadie escribe por la API salvo la configuración: el
-- resto lo escribe el servidor (rol de servicio) o funciones de la base.
-- Política RESTRICTIVE `mfa_exige_aal2` en las tres tablas con datos de
-- pacientes (src/lib/auth/mfa-rls.ts).
--
-- Compatible con el código en producción: solo tablas, funciones y triggers
-- nuevos. No escribe datos.
--
-- Reversa al pie.

begin;

-- ─── 1. Configuración por clínica ─────────────────────────────────────────

create table if not exists public.patient_notification_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  confirmation_enabled boolean not null default false,
  confirmation_enabled_at timestamptz,
  reminder_enabled boolean not null default false,
  reminder_hours smallint[] not null default '{24}',
  intake_form_mode text not null default 'off',
  nps_enabled boolean not null default false,
  nps_enabled_at timestamptz,
  nps_hours_after smallint not null default 3,
  google_review_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint patient_notification_settings_horas_check check (
    cardinality(reminder_hours) between 1 and 2
    and 1 <= all (reminder_hours) and 72 >= all (reminder_hours)
  ),
  constraint patient_notification_settings_formulario_check check (
    intake_form_mode in ('off', 'confirmation', 'reminder')
  ),
  constraint patient_notification_settings_nps_horas_check check (
    nps_hours_after between 1 and 72
  ),
  constraint patient_notification_settings_resena_check check (
    google_review_url is null
    or (google_review_url ~ '^https://[^[:space:]]+$' and length(google_review_url) <= 500)
  )
);

comment on table public.patient_notification_settings is
  'REC-07: qué correos automáticos le manda la clínica a sus pacientes. Sin fila = todo apagado.';
comment on column public.patient_notification_settings.confirmation_enabled_at is
  'Desde cuándo está encendida la confirmación: solo se confirman citas creadas después.';
comment on column public.patient_notification_settings.nps_enabled_at is
  'Desde cuándo está encendida la encuesta: solo se encuestan citas terminadas después.';

create or replace function public.patient_notification_settings_fechas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.confirmation_enabled
     and (tg_op = 'INSERT' or not old.confirmation_enabled) then
    new.confirmation_enabled_at := now();
  elsif tg_op = 'UPDATE' and not new.confirmation_enabled then
    new.confirmation_enabled_at := null;
  elsif tg_op = 'UPDATE' then
    new.confirmation_enabled_at := old.confirmation_enabled_at;
  end if;

  if new.nps_enabled and (tg_op = 'INSERT' or not old.nps_enabled) then
    new.nps_enabled_at := now();
  elsif tg_op = 'UPDATE' and not new.nps_enabled then
    new.nps_enabled_at := null;
  elsif tg_op = 'UPDATE' then
    new.nps_enabled_at := old.nps_enabled_at;
  end if;

  if tg_op = 'INSERT' and not new.confirmation_enabled then
    new.confirmation_enabled_at := null;
  end if;
  if tg_op = 'INSERT' and not new.nps_enabled then
    new.nps_enabled_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.patient_notification_settings_fechas() from public, anon;

drop trigger if exists patient_notification_settings_fechas on public.patient_notification_settings;
create trigger patient_notification_settings_fechas
  before insert or update on public.patient_notification_settings
  for each row execute function public.patient_notification_settings_fechas();

revoke all on public.patient_notification_settings from anon, authenticated;
grant select, insert, update on public.patient_notification_settings to authenticated;
grant all on public.patient_notification_settings to service_role;
alter table public.patient_notification_settings enable row level security;

drop policy if exists patient_notification_settings_select on public.patient_notification_settings;
create policy patient_notification_settings_select on public.patient_notification_settings
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists patient_notification_settings_insert on public.patient_notification_settings;
create policy patient_notification_settings_insert on public.patient_notification_settings
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists patient_notification_settings_update on public.patient_notification_settings;
create policy patient_notification_settings_update on public.patient_notification_settings
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

-- ─── 2. Registro e idempotencia de los envíos ─────────────────────────────

create table if not exists public.patient_email_dispatches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  kind text not null,
  slot text not null default 'once',
  status text not null default 'pending',
  recipient_role text,
  recipient text,
  redirected_to text,
  reason text,
  attempts smallint not null default 1,
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_email_dispatches_kind_check check (
    kind in ('confirmation', 'reminder', 'nps')
  ),
  constraint patient_email_dispatches_status_check check (
    status in ('pending', 'sent', 'skipped', 'error')
  ),
  constraint patient_email_dispatches_rol_check check (
    recipient_role is null or recipient_role in ('paciente', 'tutor')
  ),
  constraint patient_email_dispatches_slot_check check (slot ~ '^(once|[0-9]{1,2}h)$'),
  constraint patient_email_dispatches_unico unique (appointment_id, kind, slot)
);

create index if not exists patient_email_dispatches_clinic_idx
  on public.patient_email_dispatches (clinic_id, created_at desc);
create index if not exists patient_email_dispatches_patient_idx
  on public.patient_email_dispatches (patient_id, kind, created_at desc);

comment on table public.patient_email_dispatches is
  'REC-02/03, MKT-08: cada correo automático a un paciente (o su tutor). UNIQUE por cita, tipo y franja: el doble disparo del cron no duplica. Solo lo escribe el servidor.';

revoke all on public.patient_email_dispatches from anon, authenticated;
grant select on public.patient_email_dispatches to authenticated;
grant all on public.patient_email_dispatches to service_role;
alter table public.patient_email_dispatches enable row level security;

drop policy if exists patient_email_dispatches_select on public.patient_email_dispatches;
create policy patient_email_dispatches_select on public.patient_email_dispatches
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists mfa_exige_aal2 on public.patient_email_dispatches;
create policy mfa_exige_aal2 on public.patient_email_dispatches
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 3. Formulario antes de la cita ───────────────────────────────────────

create table if not exists public.patient_intake_forms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  token_hash text not null,
  expires_at timestamptz not null,
  status text not null default 'enviado',
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  submitted_at timestamptz,
  submitted_contact jsonb,
  submitted_questionnaire jsonb,
  submitted_allergies text[],
  submitted_medications text[],
  submitted_comment text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  constraint patient_intake_forms_token_unico unique (token_hash),
  constraint patient_intake_forms_cita_unica unique (appointment_id),
  constraint patient_intake_forms_token_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint patient_intake_forms_status_check check (
    status in ('enviado', 'abierto', 'respondido', 'aceptado', 'descartado')
  ),
  constraint patient_intake_forms_comentario_check check (
    submitted_comment is null or length(submitted_comment) <= 1000
  )
);

create index if not exists patient_intake_forms_pendientes_idx
  on public.patient_intake_forms (clinic_id, patient_id)
  where status = 'respondido';

comment on table public.patient_intake_forms is
  'MKT-07: formulario que el paciente completa antes de la cita (contacto y anamnesis). Lo enviado queda en "respondido" y no toca la ficha hasta que el staff lo acepta.';

revoke all on public.patient_intake_forms from anon, authenticated;
-- SELECT por columna: el staff NO lee la huella del token.
grant select (
  id, clinic_id, patient_id, appointment_id, expires_at, status, sent_at, opened_at,
  submitted_at, submitted_contact, submitted_questionnaire, submitted_allergies,
  submitted_medications, submitted_comment, reviewed_at, reviewed_by, created_at
) on public.patient_intake_forms to authenticated;
grant all on public.patient_intake_forms to service_role;
alter table public.patient_intake_forms enable row level security;

drop policy if exists patient_intake_forms_select on public.patient_intake_forms;
create policy patient_intake_forms_select on public.patient_intake_forms
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists mfa_exige_aal2 on public.patient_intake_forms;
create policy mfa_exige_aal2 on public.patient_intake_forms
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- El staff marca el formulario como aceptado (después de pasar los datos a
-- la ficha con sus propios permisos) o descartado. Solo roles clínicos y
-- solo un formulario respondido.
create or replace function public.formulario_previo_revisar(p_form_id uuid, p_resultado text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_form record;
begin
  if v_uid is null then
    raise exception 'No tienes permisos para revisar este formulario.' using errcode = '42501';
  end if;
  if p_resultado not in ('aceptado', 'descartado') then
    raise exception 'Resultado inválido.' using errcode = '22023';
  end if;
  if not (select public.sesion_cumple_mfa()) then
    raise exception 'Necesitas verificar tu identidad en dos pasos.' using errcode = '42501';
  end if;

  select id, clinic_id, status into v_form
    from public.patient_intake_forms
   where id = p_form_id
   for update;
  if v_form.id is null
     or not public.has_clinic_role(
       v_form.clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]
     ) then
    raise exception 'No tienes permisos para revisar este formulario.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinics where id = v_form.clinic_id and is_demo) then
    raise exception 'Esta es la clínica demo, de solo lectura.';
  end if;
  if v_form.status <> 'respondido' then
    raise exception 'Este formulario ya fue revisado.' using errcode = '23514';
  end if;

  update public.patient_intake_forms
     set status = p_resultado, reviewed_at = now(), reviewed_by = v_uid
   where id = v_form.id;
end;
$$;

comment on function public.formulario_previo_revisar(uuid, text) is
  'MKT-07: el staff acepta o descarta lo que el paciente envió en el formulario antes de la cita.';

revoke all on function public.formulario_previo_revisar(uuid, text) from public, anon;
grant execute on function public.formulario_previo_revisar(uuid, text) to authenticated;

-- ─── 4. Encuesta NPS ──────────────────────────────────────────────────────

create table if not exists public.patient_nps_responses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  token_hash text not null,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  score smallint,
  comment text,
  responded_at timestamptz,
  review_link_shown boolean not null default false,
  created_at timestamptz not null default now(),
  constraint patient_nps_responses_token_unico unique (token_hash),
  constraint patient_nps_responses_cita_unica unique (appointment_id),
  constraint patient_nps_responses_token_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint patient_nps_responses_score_check check (score is null or score between 0 and 10),
  constraint patient_nps_responses_comentario_check check (
    comment is null or length(comment) <= 1000
  ),
  constraint patient_nps_responses_respuesta_check check (
    (score is null) = (responded_at is null)
  )
);

create index if not exists patient_nps_responses_clinic_idx
  on public.patient_nps_responses (clinic_id, responded_at desc);
create index if not exists patient_nps_responses_patient_idx
  on public.patient_nps_responses (patient_id, sent_at desc);

comment on table public.patient_nps_responses is
  'MKT-08: encuesta NPS (0-10 y comentario) después de una cita finalizada. A los promotores (9-10) se les muestra el pedido de reseña en Google si la clínica cargó el link.';

revoke all on public.patient_nps_responses from anon, authenticated;
grant select (
  id, clinic_id, patient_id, appointment_id, professional_id, expires_at, sent_at, opened_at,
  score, comment, responded_at, review_link_shown, created_at
) on public.patient_nps_responses to authenticated;
grant all on public.patient_nps_responses to service_role;
alter table public.patient_nps_responses enable row level security;

drop policy if exists patient_nps_responses_select on public.patient_nps_responses;
create policy patient_nps_responses_select on public.patient_nps_responses
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

drop policy if exists mfa_exige_aal2 on public.patient_nps_responses;
create policy mfa_exige_aal2 on public.patient_nps_responses
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- Cómo revertir (se pierden la configuración, el registro de envíos, los
-- formularios y las respuestas NPS: hacer un backup antes si ya hay datos):
--
-- begin;
-- drop function if exists public.formulario_previo_revisar(uuid, text);
-- drop policy if exists mfa_exige_aal2 on public.patient_nps_responses;
-- drop policy if exists mfa_exige_aal2 on public.patient_intake_forms;
-- drop policy if exists mfa_exige_aal2 on public.patient_email_dispatches;
-- drop table if exists public.patient_nps_responses;
-- drop table if exists public.patient_intake_forms;
-- drop table if exists public.patient_email_dispatches;
-- drop table if exists public.patient_notification_settings;
-- drop function if exists public.patient_notification_settings_fechas();
-- commit;
