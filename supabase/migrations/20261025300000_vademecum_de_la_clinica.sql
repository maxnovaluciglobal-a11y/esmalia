-- Ola 4 · Frente Receta (1/3): MKT-05, vademécum de la clínica.
--
-- El vademécum odontológico base (principio activo, presentación,
-- concentración, vía y posología sugerida) vive en el código
-- (src/lib/clinical/vademecum.ts): es igual para todas las clínicas, se
-- versiona con la app y lo usan el autocompletado y el aviso de alergias sin
-- ir a la base. Esta tabla guarda solo los medicamentos que agrega cada
-- clínica (o su variante de uno del vademécum base, con otra posología).
--
-- Sin datos de pacientes: no lleva la política `mfa_exige_aal2` (está en
-- TABLAS_SIN_AAL2 de src/lib/auth/mfa-rls.ts). Leen los roles clínicos;
-- agregan y editan quienes recetan (owner, admin, dentist). No se borra: se
-- desactiva (`active`), así una receta emitida nunca apunta a un ítem que ya
-- no existe (la receta guarda además su propia copia del medicamento).
--
-- Compatible con el código en producción (RUNBOOK regla 3): solo una tabla
-- nueva. Reversa al pie.

begin;

create table if not exists public.clinic_medications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- Principio activo, en español: "Amoxicilina".
  active_ingredient text not null,
  -- "500 mg", "0,12 %", "100.000 UI/mL".
  concentration text,
  -- "cápsulas", "colutorio", "gel oral".
  form text,
  -- Familia para el aviso de alergias (src/lib/clinical/vademecum.ts). NULL =
  -- sin familia conocida: el aviso compara solo por nombre.
  pharmacological_group text,
  route text not null default 'oral',
  -- Código ATC de la OMS, si se conoce (FHIR: Medication.code).
  atc_code text,
  -- Posología sugerida: se copia al recetar y el profesional la edita.
  dose text,
  frequency text,
  duration text,
  instructions text,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_medications_ingredient_check
    check (char_length(btrim(active_ingredient)) between 2 and 120),
  constraint clinic_medications_concentration_check
    check (concentration is null or char_length(concentration) <= 60),
  constraint clinic_medications_form_check
    check (form is null or char_length(form) <= 60),
  constraint clinic_medications_group_check check (pharmacological_group is null or pharmacological_group in (
    'penicilinas', 'cefalosporinas', 'macrolidos', 'lincosamidas', 'nitroimidazoles',
    'aine', 'analgesicos', 'opioides', 'corticoides', 'antisepticos', 'antifungicos',
    'antivirales', 'anestesicos_locales', 'fluoruros', 'gastroprotectores'
  )),
  constraint clinic_medications_route_check check (route in (
    'oral', 'sublingual', 'enjuague_bucal', 'topica_bucal', 'dental', 'cutanea'
  )),
  constraint clinic_medications_atc_check
    check (atc_code is null or atc_code ~ '^[A-Z][0-9]{2}[A-Z]{0,2}[0-9]{0,2}$'),
  constraint clinic_medications_posologia_check check (
    coalesce(char_length(dose), 0) <= 120
    and coalesce(char_length(frequency), 0) <= 120
    and coalesce(char_length(duration), 0) <= 120
    and coalesce(char_length(instructions), 0) <= 500
  )
);

comment on table public.clinic_medications is
  'MKT-05: medicamentos que agrega la clínica a su vademécum (el base vive en el código). Sin datos de pacientes; no se borra, se desactiva.';

create index if not exists clinic_medications_clinic_idx
  on public.clinic_medications (clinic_id, active, active_ingredient);

drop trigger if exists clinic_medications_updated_at on public.clinic_medications;
create trigger clinic_medications_updated_at
  before update on public.clinic_medications
  for each row execute function public.set_updated_at();

-- Quién lo creó y cuándo no se reescriben desde la app.
create or replace function public.clinic_medications_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Un medicamento no cambia de clínica.' using errcode = '23514';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.active_ingredient := btrim(new.active_ingredient);
  return new;
end;
$$;

revoke execute on function public.clinic_medications_proteger() from public, anon, authenticated;

drop trigger if exists clinic_medications_proteger on public.clinic_medications;
create trigger clinic_medications_proteger
  before insert or update on public.clinic_medications
  for each row execute function public.clinic_medications_proteger();

drop trigger if exists block_demo_writes on public.clinic_medications;
create trigger block_demo_writes
  before insert or update or delete on public.clinic_medications
  for each row execute function public.block_demo_writes();

grant select, insert, update on public.clinic_medications to authenticated;
revoke delete, truncate on public.clinic_medications from anon, authenticated;
grant all on public.clinic_medications to service_role;
alter table public.clinic_medications enable row level security;

drop policy if exists clinic_medications_select_clinicos on public.clinic_medications;
create policy clinic_medications_select_clinicos on public.clinic_medications
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]));

drop policy if exists clinic_medications_insert_prescriptores on public.clinic_medications;
create policy clinic_medications_insert_prescriptores on public.clinic_medications
  for insert to authenticated
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[]));

drop policy if exists clinic_medications_update_prescriptores on public.clinic_medications;
create policy clinic_medications_update_prescriptores on public.clinic_medications
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[]));

commit;

-- Cómo revertir (se pierden los medicamentos que agregaron las clínicas; las
-- recetas emitidas no se tocan, guardan su propia copia):
--
-- begin;
-- drop table if exists public.clinic_medications;
-- drop function if exists public.clinic_medications_proteger();
-- commit;
