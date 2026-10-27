-- Ola 7 · Frente A (1/2): reserva en línea (RES-01 a RES-07), gestión de la
-- cita por link firmado (RES-05 + REC-11) y "Atiende pacientes" (EQU-04).
--
-- Solo agrega: columnas nullable, una restricción más ancha y dos tablas
-- nuevas. No escribe datos ni redefine funciones existentes.
--
--   professionals.attends_patients   EQU-04. null = se deduce del rol del
--                                    usuario vinculado (como hasta hoy,
--                                    AGE-17); true/false = marca explícita.
--   appointments.booking_source      'reserva_en_linea' si la cita la pidió
--                                    el paciente desde el link público.
--   appointments.patient_cancelled_at  el PACIENTE canceló desde su link
--                                    (eje aparte, como patient_confirmed_at).
--   appointments.patient_confirmed_via  suma 'enlace' (confirmó desde
--                                    /mi-cita/<token>).
--   online_booking_settings          reglas de la reserva por clínica.
--   online_booking_verifications     códigos de 6 dígitos (solo el sha256)
--                                    y límites por correo, teléfono e IP. Sin
--                                    políticas: solo el rol de servicio.
--
-- Nada de esto pone `status = 'confirmada'`: eso lo sigue aceptando el
-- profesional (migración 20260907160000).
--
-- Reversa al pie.

begin;

-- ─── EQU-04: "Atiende pacientes" ───────────────────────────────────────────

alter table public.professionals
  add column if not exists attends_patients boolean;

comment on column public.professionals.attends_patients is
  'EQU-04: atiende pacientes (aparece en la agenda y en la reserva en línea). null = se deduce del rol del usuario vinculado (owner/admin/dentist o sin usuario: sí).';

-- ─── Citas: origen y cancelación del paciente ─────────────────────────────

alter table public.appointments
  add column if not exists booking_source text
    check (booking_source in ('reserva_en_linea')),
  add column if not exists patient_cancelled_at timestamptz;

comment on column public.appointments.booking_source is
  'RES-01: por dónde entró la cita cuando no la agendó el equipo. reserva_en_linea = link público /reservar. null = la agendó la clínica.';
comment on column public.appointments.patient_cancelled_at is
  'RES-05: cuándo el PACIENTE canceló desde su link /mi-cita. El equipo cancela con status, sin tocar esta columna.';

-- Confirmación del paciente desde su link: mismo eje (patient_confirmed_at),
-- un canal más. Ensanchar el CHECK no invalida ninguna fila existente.
alter table public.appointments
  drop constraint if exists appointments_patient_confirmed_via_check;
alter table public.appointments
  add constraint appointments_patient_confirmed_via_check
  check (patient_confirmed_via in ('whatsapp', 'portal', 'telefono', 'presencial', 'enlace'));

create index if not exists appointments_reserva_en_linea_idx
  on public.appointments (clinic_id, patient_id, starts_at)
  where booking_source is not null;

-- ─── Reglas de la reserva por clínica ─────────────────────────────────────

create table if not exists public.online_booking_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  enabled boolean not null default false,
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  min_notice_hours smallint not null default 2
    check (min_notice_hours between 0 and 720),
  max_days_ahead smallint not null default 30
    check (max_days_ahead between 1 and 180),
  bookable_procedure_ids uuid[] not null default '{}'
    check (cardinality(bookable_procedure_ids) <= 60),
  bookable_appointment_type_ids uuid[] not null default '{}'
    check (cardinality(bookable_appointment_type_ids) <= 30),
  welcome_note text check (char_length(welcome_note) <= 400),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.online_booking_settings is
  'RES-02: reserva en línea por clínica (link /reservar/<slug>): encendido, anticipación mínima y máxima, procedimientos y tipos de cita reservables.';

create trigger online_booking_settings_updated_at
  before update on public.online_booking_settings
  for each row execute function public.set_updated_at();

create trigger block_demo_writes
  before insert or update or delete on public.online_booking_settings
  for each row execute function public.block_demo_writes();

alter table public.online_booking_settings enable row level security;

-- La lee el equipo (la agenda muestra el link); la cambian owner/admin. La
-- página pública NO la lee con anon: pasa por el servidor con service_role.
create policy online_booking_settings_select on public.online_booking_settings
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy online_booking_settings_insert on public.online_booking_settings
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

create policy online_booking_settings_update on public.online_booking_settings
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists mfa_exige_aal2 on public.online_booking_settings;
create policy mfa_exige_aal2 on public.online_booking_settings
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── Códigos de verificación y límites ─────────────────────────────────────

create table if not exists public.online_booking_verifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- sha256 de la solicitud canónica (horario, profesional, datos): el código
  -- sirve solo para ESA reserva. Los datos del paciente no se guardan acá.
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  -- sha256(clinic_id:correo) y sha256(clinic_id:teléfono): para contar
  -- pedidos sin guardar el contacto.
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  phone_hash text check (phone_hash ~ '^[0-9a-f]{64}$'),
  ip_hint text check (char_length(ip_hint) <= 64),
  attempts smallint not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.online_booking_verifications is
  'RES-04: códigos de 6 dígitos de la reserva en línea (solo su sha256, 10 min, 5 intentos) y conteo por correo, teléfono e IP. RLS sin políticas: solo service_role.';

create index if not exists online_booking_verifications_email_idx
  on public.online_booking_verifications (clinic_id, email_hash, created_at);
create index if not exists online_booking_verifications_phone_idx
  on public.online_booking_verifications (clinic_id, phone_hash, created_at)
  where phone_hash is not null;
create index if not exists online_booking_verifications_ip_idx
  on public.online_booking_verifications (ip_hint, created_at);

alter table public.online_booking_verifications enable row level security;
revoke all on table public.online_booking_verifications from anon, authenticated;

drop policy if exists mfa_exige_aal2 on public.online_booking_verifications;
create policy mfa_exige_aal2 on public.online_booking_verifications
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- ─── Reversa (no se corre sola) ────────────────────────────────────────────
-- drop policy if exists mfa_exige_aal2 on public.online_booking_verifications;
-- drop policy if exists mfa_exige_aal2 on public.online_booking_settings;
-- drop table if exists public.online_booking_verifications;
-- drop table if exists public.online_booking_settings;
-- drop index if exists public.appointments_reserva_en_linea_idx;
-- update public.appointments set patient_confirmed_via = 'portal' where patient_confirmed_via = 'enlace';
-- alter table public.appointments drop constraint if exists appointments_patient_confirmed_via_check;
-- alter table public.appointments add constraint appointments_patient_confirmed_via_check
--   check (patient_confirmed_via in ('whatsapp', 'portal', 'telefono', 'presencial'));
-- alter table public.appointments drop column if exists patient_cancelled_at;
-- alter table public.appointments drop column if exists booking_source;
-- alter table public.professionals drop column if exists attends_patients;
