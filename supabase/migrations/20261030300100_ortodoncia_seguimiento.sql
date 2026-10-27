-- Ola 9 · Frente C (2/2): ortodoncia, ORT-02 a ORT-06.
--
-- Un caso de ortodoncia sabía si era de brackets o de alineadores, cuándo
-- empezó y cuándo debería terminar. Faltaba lo que se mira en cada control:
--
--   ORT-02  sistema: brackets metálicos, estéticos, autoligado, lingual o
--           alineadores (refina `kind`, que se mantiene);
--   ORT-03  alineadores: número actual / total, cambio cada N días y desde
--           cuándo lleva el actual (de ahí sale el próximo cambio);
--   ORT-04  progreso: se calcula en la app (alineadores o meses), sin columna;
--   ORT-05  etapas (alineación, nivelación, cierre de espacios, finalización,
--           contención) con su historial;
--   ORT-06  las vistas (ficha y lista) leen todo esto.
--
-- Aditivo y compatible con el código en producción (RUNBOOK regla 3):
-- columnas nullable en `ortho_cases`, una UNIQUE nueva sobre la PK y una
-- tabla nueva. No escribe datos. Reversa al pie.

begin;

alter table public.ortho_cases
  add column if not exists appliance_system text,
  add column if not exists aligner_current smallint,
  add column if not exists aligner_total smallint,
  add column if not exists aligner_change_days smallint,
  add column if not exists aligner_changed_on date;

alter table public.ortho_cases
  add constraint ortho_cases_appliance_system_check check (appliance_system is null or appliance_system in (
    'metalicos', 'esteticos', 'autoligado', 'lingual', 'alineadores'
  )),
  add constraint ortho_cases_aligner_total_check
    check (aligner_total is null or aligner_total between 1 and 200),
  add constraint ortho_cases_aligner_current_check check (
    aligner_current is null
    or (aligner_current between 0 and 200
        and (aligner_total is null or aligner_current <= aligner_total))
  ),
  add constraint ortho_cases_aligner_change_days_check
    check (aligner_change_days is null or aligner_change_days between 1 and 60);

comment on column public.ortho_cases.appliance_system is
  'ORT-02: sistema (metalicos | esteticos | autoligado | lingual | alineadores).';
comment on column public.ortho_cases.aligner_current is
  'ORT-03: número del alineador que usa hoy (0 = todavía no empieza).';
comment on column public.ortho_cases.aligner_total is 'ORT-03: total de alineadores del plan.';
comment on column public.ortho_cases.aligner_change_days is
  'ORT-03: cada cuántos días cambia de alineador.';
comment on column public.ortho_cases.aligner_changed_on is
  'ORT-03: día en que empezó el alineador actual; el próximo cambio es este día + aligner_change_days.';

-- Clave compuesta para que una etapa no pueda colgar de un caso de otra clínica.
alter table public.ortho_cases
  add constraint ortho_cases_id_clinic_key unique (id, clinic_id);

-- ─── Etapas con historial (ORT-05) ──────────────────────────────────────
-- Evento versionado (regla 9): cada cambio de etapa es una fila nueva; la
-- etapa actual es la de `started_on` más reciente. No se edita ni se borra:
-- si se cargó mal, se registra la etapa correcta encima.
create table if not exists public.ortho_stage_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  ortho_case_id uuid not null,
  stage text not null,
  started_on date not null,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint ortho_stage_events_case_fk foreign key (ortho_case_id, clinic_id)
    references public.ortho_cases (id, clinic_id) on delete cascade,
  constraint ortho_stage_events_stage_check check (stage in (
    'alineacion', 'nivelacion', 'cierre_espacios', 'finalizacion', 'contencion'
  )),
  constraint ortho_stage_events_notes_check check (notes is null or char_length(notes) <= 500)
);

comment on table public.ortho_stage_events is
  'ORT-05: historial de etapas de un caso de ortodoncia. Solo se agregan filas; la etapa actual es la de started_on más reciente.';

create index if not exists ortho_stage_events_case_idx
  on public.ortho_stage_events (ortho_case_id, started_on desc, created_at desc);
create index if not exists ortho_stage_events_clinic_idx
  on public.ortho_stage_events (clinic_id);

create or replace function public.ortho_stage_events_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

revoke execute on function public.ortho_stage_events_proteger() from public, anon, authenticated;

drop trigger if exists ortho_stage_events_proteger on public.ortho_stage_events;
create trigger ortho_stage_events_proteger
  before insert on public.ortho_stage_events
  for each row execute function public.ortho_stage_events_proteger();

drop trigger if exists block_demo_writes on public.ortho_stage_events;
create trigger block_demo_writes
  before insert or update or delete on public.ortho_stage_events
  for each row execute function public.block_demo_writes();

grant select, insert on public.ortho_stage_events to authenticated;
revoke update, delete, truncate on public.ortho_stage_events from anon, authenticated;
grant all on public.ortho_stage_events to service_role;
alter table public.ortho_stage_events enable row level security;

-- Mismo criterio que ortho_controls: lo ve cualquier miembro, lo escribe
-- quien gestiona tratamientos.
drop policy if exists ortho_stage_events_select_members on public.ortho_stage_events;
create policy ortho_stage_events_select_members on public.ortho_stage_events
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists ortho_stage_events_insert_clinical_roles on public.ortho_stage_events;
create policy ortho_stage_events_insert_clinical_roles on public.ortho_stage_events
  for insert to authenticated
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]));

-- Dato clínico de un paciente: exige aal2 a quien tiene MFA (TABLAS_CON_AAL2).
drop policy if exists mfa_exige_aal2 on public.ortho_stage_events;
create policy mfa_exige_aal2 on public.ortho_stage_events
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- Cómo revertir (se pierde el historial de etapas y los datos de sistema y
-- alineadores; los casos y sus controles no se tocan):
--
-- begin;
-- drop policy if exists mfa_exige_aal2 on public.ortho_stage_events;
-- drop table if exists public.ortho_stage_events;
-- drop function if exists public.ortho_stage_events_proteger();
-- alter table public.ortho_cases
--   drop constraint if exists ortho_cases_id_clinic_key,
--   drop constraint if exists ortho_cases_appliance_system_check,
--   drop constraint if exists ortho_cases_aligner_total_check,
--   drop constraint if exists ortho_cases_aligner_current_check,
--   drop constraint if exists ortho_cases_aligner_change_days_check,
--   drop column if exists appliance_system,
--   drop column if exists aligner_current,
--   drop column if exists aligner_total,
--   drop column if exists aligner_change_days,
--   drop column if exists aligner_changed_on;
-- commit;
