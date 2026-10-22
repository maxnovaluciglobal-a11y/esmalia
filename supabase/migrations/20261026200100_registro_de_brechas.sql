-- Ola 5 · Frente Derechos del titular y brechas (2/2): SEG-06, registro de
-- incidentes de seguridad y brechas de datos personales (Ley 21.719, Chile).
--
-- La clínica (responsable de los datos de sus pacientes) tiene que poder
-- mostrar qué pasó, cuándo lo supo, qué datos y cuántos titulares tocó, cómo
-- evaluó el riesgo, qué hizo y si notificó a la Agencia y a los titulares (o
-- por qué no). Es una bitácora: lo escrito no se corrige, se le agregan
-- seguimientos.
--
--   1. security_incidents: el registro inicial (detección, descripción,
--      categorías de datos, titulares afectados estimados, riesgo, medidas,
--      decisión de notificar y responsable).
--   2. security_incident_updates: seguimientos. Cada uno trae una nota y,
--      si cambió algo, el valor nuevo (estado, riesgo, medidas, titulares,
--      categorías, decisión de notificar, fechas de notificación). El estado
--      vigente es el registro inicial más los seguimientos en orden: lo
--      calcula `estadoActualDeBrecha` (src/lib/derechos/brechas.ts).
--   3. Ninguna de las dos se edita ni se borra (ni el rol de servicio),
--      salvo la cascada al borrar la clínica entera. `created_by` y
--      `created_at` los estampa la base.
--
-- Solo owner/admin leen y escriben (can_manage_clinic). Pueden describir
-- datos de salud de pacientes: llevan `mfa_exige_aal2` (TABLAS_CON_AAL2). La
-- clínica demo no escribe (block_demo_writes).
--
-- Compatible con el código en producción (RUNBOOK regla 3): dos tablas y una
-- función nuevas. Usa `registro_titular_inmutable()` de 20261026200000.
-- Reversa al pie.

begin;

-- ─── 1. Incidentes ─────────────────────────────────────────────────────────

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- Cuándo la clínica tomó conocimiento (la "hora 0" del runbook).
  detected_at timestamptz not null,
  -- Cuándo ocurrió, si se sabe.
  occurred_at timestamptz,
  title text not null,
  description text not null,
  -- Categorías de datos afectados. 'salud' es dato sensible.
  data_categories text[] not null default '{}',
  -- Estimado; NULL = todavía no se sabe (no se fabrica un cero).
  affected_subjects_estimate integer,
  risk_level text not null default 'por_evaluar',
  risk_assessment text,
  measures text,
  notify_agency text not null default 'por_decidir',
  notify_subjects text not null default 'por_decidir',
  -- Fundamento de la decisión de notificar o no.
  notification_reason text,
  responsible_name text not null,
  status text not null default 'abierto',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint security_incidents_title_check
    check (char_length(btrim(title)) between 3 and 160),
  constraint security_incidents_description_check
    check (char_length(btrim(description)) between 10 and 4000),
  constraint security_incidents_categories_check check (data_categories <@ array[
    'identificacion', 'contacto', 'salud', 'financieros', 'credenciales', 'documentos', 'otros'
  ]::text[]),
  constraint security_incidents_affected_check
    check (affected_subjects_estimate is null or affected_subjects_estimate >= 0),
  constraint security_incidents_risk_check
    check (risk_level in ('por_evaluar', 'bajo', 'medio', 'alto')),
  constraint security_incidents_notify_agency_check
    check (notify_agency in ('por_decidir', 'si', 'no')),
  constraint security_incidents_notify_subjects_check
    check (notify_subjects in ('por_decidir', 'si', 'no')),
  constraint security_incidents_status_check
    check (status in ('abierto', 'contenido', 'cerrado')),
  constraint security_incidents_responsible_check
    check (char_length(btrim(responsible_name)) between 2 and 120),
  constraint security_incidents_textos_check check (
    coalesce(char_length(risk_assessment), 0) <= 4000
    and coalesce(char_length(measures), 0) <= 4000
    and coalesce(char_length(notification_reason), 0) <= 2000
  )
);

comment on table public.security_incidents is
  'SEG-06 (Ley 21.719): registro de incidentes de seguridad y brechas de datos personales de la clínica. Bitácora: no se edita ni se borra; se agregan seguimientos en security_incident_updates. Solo owner/admin.';

create index if not exists security_incidents_clinic_detected_idx
  on public.security_incidents (clinic_id, detected_at desc);

-- ─── 2. Seguimientos ───────────────────────────────────────────────────────

create table if not exists public.security_incident_updates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  incident_id uuid not null references public.security_incidents(id) on delete cascade,
  note text not null,
  -- Valores nuevos; NULL = sin cambios en ese campo.
  status text,
  risk_level text,
  risk_assessment text,
  measures text,
  affected_subjects_estimate integer,
  data_categories text[],
  notify_agency text,
  notify_subjects text,
  notification_reason text,
  agency_notified_at timestamptz,
  subjects_notified_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint security_incident_updates_note_check
    check (char_length(btrim(note)) between 3 and 4000),
  constraint security_incident_updates_status_check
    check (status is null or status in ('abierto', 'contenido', 'cerrado')),
  constraint security_incident_updates_risk_check
    check (risk_level is null or risk_level in ('por_evaluar', 'bajo', 'medio', 'alto')),
  constraint security_incident_updates_notify_agency_check
    check (notify_agency is null or notify_agency in ('por_decidir', 'si', 'no')),
  constraint security_incident_updates_notify_subjects_check
    check (notify_subjects is null or notify_subjects in ('por_decidir', 'si', 'no')),
  constraint security_incident_updates_affected_check
    check (affected_subjects_estimate is null or affected_subjects_estimate >= 0),
  constraint security_incident_updates_categories_check check (data_categories is null or data_categories <@ array[
    'identificacion', 'contacto', 'salud', 'financieros', 'credenciales', 'documentos', 'otros'
  ]::text[]),
  constraint security_incident_updates_textos_check check (
    coalesce(char_length(risk_assessment), 0) <= 4000
    and coalesce(char_length(measures), 0) <= 4000
    and coalesce(char_length(notification_reason), 0) <= 2000
  )
);

comment on table public.security_incident_updates is
  'SEG-06: seguimientos de un incidente de seguridad (nota + valores nuevos). No se editan ni se borran. Solo owner/admin.';

create index if not exists security_incident_updates_incident_idx
  on public.security_incident_updates (incident_id, created_at);
create index if not exists security_incident_updates_clinic_idx
  on public.security_incident_updates (clinic_id, created_at desc);

-- ─── 3. Reglas ─────────────────────────────────────────────────────────────

-- Estampa autor y fecha; un seguimiento es de un incidente de la misma
-- clínica; nada en el futuro. SECURITY INVOKER: lee con la RLS de quien
-- escribe (owner/admin de esa clínica).
create or replace function public.security_incidents_al_registrar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();

  if tg_table_name = 'security_incidents' then
    new.title := btrim(new.title);
    new.description := btrim(new.description);
    new.responsible_name := btrim(new.responsible_name);
    if new.detected_at > now() + interval '5 minutes' then
      raise exception 'La fecha de detección no puede ser futura.' using errcode = '23514';
    end if;
    if new.occurred_at is not null and new.occurred_at > now() + interval '5 minutes' then
      raise exception 'La fecha en que ocurrió no puede ser futura.' using errcode = '23514';
    end if;
    if new.occurred_at is not null and new.occurred_at > new.detected_at then
      raise exception 'Ocurrió después de detectarse: revisa las fechas.' using errcode = '23514';
    end if;
  else
    if not exists (
      select 1 from public.security_incidents i
       where i.id = new.incident_id and i.clinic_id = new.clinic_id
    ) then
      raise exception 'El incidente no pertenece a esta clínica.' using errcode = '23503';
    end if;
    new.note := btrim(new.note);
    if (new.agency_notified_at is not null and new.agency_notified_at > now() + interval '5 minutes')
       or (new.subjects_notified_at is not null and new.subjects_notified_at > now() + interval '5 minutes')
    then
      raise exception 'Una notificación no puede tener fecha futura.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.security_incidents_al_registrar() from public, anon, authenticated;

drop trigger if exists security_incidents_al_registrar on public.security_incidents;
create trigger security_incidents_al_registrar
  before insert on public.security_incidents
  for each row execute function public.security_incidents_al_registrar();

drop trigger if exists security_incident_updates_al_registrar on public.security_incident_updates;
create trigger security_incident_updates_al_registrar
  before insert on public.security_incident_updates
  for each row execute function public.security_incidents_al_registrar();

drop trigger if exists security_incidents_inmutable on public.security_incidents;
create trigger security_incidents_inmutable
  before update or delete on public.security_incidents
  for each row execute function public.registro_titular_inmutable();

drop trigger if exists security_incident_updates_inmutable on public.security_incident_updates;
create trigger security_incident_updates_inmutable
  before update or delete on public.security_incident_updates
  for each row execute function public.registro_titular_inmutable();

drop trigger if exists block_demo_writes on public.security_incidents;
create trigger block_demo_writes
  before insert or update or delete on public.security_incidents
  for each row execute function public.block_demo_writes();

drop trigger if exists block_demo_writes on public.security_incident_updates;
create trigger block_demo_writes
  before insert or update or delete on public.security_incident_updates
  for each row execute function public.block_demo_writes();

-- ─── 4. Permisos y RLS ─────────────────────────────────────────────────────

revoke all on public.security_incidents from public, anon, authenticated;
grant select, insert on public.security_incidents to authenticated;
grant all on public.security_incidents to service_role;
alter table public.security_incidents enable row level security;

drop policy if exists security_incidents_select_gestion on public.security_incidents;
create policy security_incidents_select_gestion on public.security_incidents
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

drop policy if exists security_incidents_insert_gestion on public.security_incidents;
create policy security_incidents_insert_gestion on public.security_incidents
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

revoke all on public.security_incident_updates from public, anon, authenticated;
grant select, insert on public.security_incident_updates to authenticated;
grant all on public.security_incident_updates to service_role;
alter table public.security_incident_updates enable row level security;

drop policy if exists security_incident_updates_select_gestion on public.security_incident_updates;
create policy security_incident_updates_select_gestion on public.security_incident_updates
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

drop policy if exists security_incident_updates_insert_gestion on public.security_incident_updates;
create policy security_incident_updates_insert_gestion on public.security_incident_updates
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

-- SEG-01: quien activó MFA necesita una sesión aal2 (docs/MFA.md).
drop policy if exists mfa_exige_aal2 on public.security_incident_updates;
create policy mfa_exige_aal2 on public.security_incident_updates
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.security_incidents;
create policy mfa_exige_aal2 on public.security_incidents
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- Cómo revertir (se pierde el registro de incidentes; exportarlo antes en
-- PDF o CSV desde la pantalla de incidentes):
--
-- begin;
-- drop policy if exists mfa_exige_aal2 on public.security_incident_updates;
-- drop policy if exists mfa_exige_aal2 on public.security_incidents;
-- drop table if exists public.security_incident_updates;
-- drop table if exists public.security_incidents;
-- drop function if exists public.security_incidents_al_registrar();
-- commit;
