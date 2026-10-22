-- Ola 1 · Frente Pacientes: datos de Chile en la ficha (plan maestro del
-- 21-oct-2026). FIC-01 tipo de documento y RUT validado, FIC-02 previsión,
-- FIC-03 contacto de emergencia, FIC-04 origen del paciente, más dirección y
-- comuna para el indicador de ficha completa (SEG-08, Decreto 41).
--
-- Compatible con el código que está en producción (RUNBOOK_MIGRACIONES,
-- regla 3): solo agrega columnas NULLABLE, una tabla nueva y funciones. Las
-- filas existentes quedan con todo en NULL (la UI las muestra "Pendiente").
--
-- Qué hace:
--  1. rut_es_valido(text): dígito verificador módulo 11, misma lógica que
--     src/lib/patients/rut.ts (tests/rut.test.ts prueba los mismos casos).
--  2. Columnas nuevas en patients (todas nullable) con sus CHECK.
--  3. CHECK patients_rut_valido NOT VALID: si document_type = 'rut', el
--     documento tiene que tener un dígito verificador correcto. NOT VALID =
--     no revisa las filas que ya existen (todas tienen document_type NULL).
--  4. clinic_patient_options: listas editables por clínica (isapres y origen
--     del paciente), con RLS, sembradas para cada clínica existente y para
--     cada clínica nueva por trigger.
--
-- Reversa al pie.

begin;

-- 1. RUT ------------------------------------------------------------------

create or replace function public.rut_es_valido(p_rut text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v text;
  cuerpo text;
  dv text;
  suma integer := 0;
  factor integer := 2;
  resto integer;
  esperado text;
  i integer;
begin
  if p_rut is null or btrim(p_rut) !~ '^[0-9. -]+[0-9kK]$' then
    return false;
  end if;
  v := upper(regexp_replace(p_rut, '[^0-9kK]', '', 'g'));
  -- Cuerpo de 6 a 9 dígitos + dígito verificador.
  if length(v) < 7 or length(v) > 10 then
    return false;
  end if;
  cuerpo := left(v, length(v) - 1);
  dv := right(v, 1);
  if cuerpo !~ '^[0-9]+$' then
    return false;
  end if;
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::integer * factor;
    factor := case when factor = 7 then 2 else factor + 1 end;
  end loop;
  resto := 11 - (suma % 11);
  esperado := case resto when 11 then '0' when 10 then 'K' else resto::text end;
  return dv = esperado;
end;
$$;

comment on function public.rut_es_valido(text) is
  'FIC-01: true si el RUT chileno tiene el dígito verificador correcto (módulo 11). Acepta puntos, guion y k minúscula. Par de src/lib/patients/rut.ts.';

-- 2. Columnas nuevas de patients -------------------------------------------

alter table public.patients
  add column if not exists document_type text
    check (document_type in ('rut', 'pasaporte', 'dni', 'otro')),
  add column if not exists health_plan text
    check (health_plan in ('fonasa', 'isapre', 'particular', 'ffaa', 'extranjero', 'sin_prevision')),
  add column if not exists health_plan_tier text
    check (health_plan_tier in ('A', 'B', 'C', 'D')),
  add column if not exists health_plan_institution text
    check (char_length(health_plan_institution) <= 80),
  add column if not exists emergency_contact_name text
    check (char_length(emergency_contact_name) <= 120),
  add column if not exists emergency_contact_relationship text
    check (char_length(emergency_contact_relationship) <= 60),
  add column if not exists emergency_contact_phone text
    check (char_length(emergency_contact_phone) <= 40),
  add column if not exists acquisition_source text
    check (char_length(acquisition_source) <= 80),
  add column if not exists acquisition_source_detail text
    check (char_length(acquisition_source_detail) <= 200),
  add column if not exists referred_by_patient_id uuid
    references public.patients(id) on delete set null,
  add column if not exists address text
    check (char_length(address) <= 200),
  add column if not exists commune text
    check (char_length(commune) <= 80);

-- El tramo solo existe en Fonasa.
alter table public.patients
  drop constraint if exists patients_health_plan_tier_fonasa;
alter table public.patients
  add constraint patients_health_plan_tier_fonasa
  check (health_plan_tier is null or health_plan = 'fonasa');

-- Nadie se refiere a sí mismo.
alter table public.patients
  drop constraint if exists patients_referred_by_not_self;
alter table public.patients
  add constraint patients_referred_by_not_self
  check (referred_by_patient_id is null or referred_by_patient_id <> id);

create index if not exists patients_referred_by_idx
  on public.patients (referred_by_patient_id)
  where referred_by_patient_id is not null;

comment on column public.patients.document_type is
  'FIC-01: rut | pasaporte | dni | otro. NULL = fila anterior a la Ola 1 (sin tipo).';
comment on column public.patients.health_plan is
  'FIC-02: previsión de salud. NULL = pendiente (fichas anteriores a la Ola 1). Independiente de los convenios.';
comment on column public.patients.health_plan_tier is 'FIC-02: tramo de Fonasa (A-D).';
comment on column public.patients.health_plan_institution is
  'FIC-02: nombre de la isapre (de clinic_patient_options) o Capredena/Dipreca. Texto copiado, no FK (regla 10).';
comment on column public.patients.acquisition_source is
  'FIC-04: origen del paciente, copia del texto de clinic_patient_options (kind = acquisition_source).';
comment on column public.patients.referred_by_patient_id is
  'FIC-04: paciente que lo refirió (por su código de referido).';

-- 3. RUT válido cuando el tipo es RUT (no revisa filas viejas) -------------

alter table public.patients
  drop constraint if exists patients_rut_valido;
alter table public.patients
  add constraint patients_rut_valido
  check (
    document_type is distinct from 'rut'
    or document_id is null
    or btrim(document_id) = ''
    or public.rut_es_valido(document_id)
  ) not valid;

-- 4. Listas editables por clínica -----------------------------------------

create table if not exists public.clinic_patient_options (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  kind text not null check (kind in ('isapre', 'acquisition_source')),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

comment on table public.clinic_patient_options is
  'Ola 1: opciones editables de la ficha por clínica. kind = isapre (FIC-02) o acquisition_source (FIC-04). La ficha guarda una copia del texto, así que desactivar o renombrar una opción no cambia las fichas.';

create unique index if not exists clinic_patient_options_unica
  on public.clinic_patient_options (clinic_id, kind, lower(btrim(label)));
create index if not exists clinic_patient_options_clinica_idx
  on public.clinic_patient_options (clinic_id, kind, position);

alter table public.clinic_patient_options enable row level security;

drop policy if exists "clinic_patient_options_select" on public.clinic_patient_options;
create policy "clinic_patient_options_select" on public.clinic_patient_options
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists "clinic_patient_options_insert" on public.clinic_patient_options;
create policy "clinic_patient_options_insert" on public.clinic_patient_options
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists "clinic_patient_options_update" on public.clinic_patient_options;
create policy "clinic_patient_options_update" on public.clinic_patient_options
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists "clinic_patient_options_delete" on public.clinic_patient_options;
create policy "clinic_patient_options_delete" on public.clinic_patient_options
  for delete to authenticated
  using (public.can_manage_clinic(clinic_id));

revoke all on table public.clinic_patient_options from anon;

-- Siembra: isapres abiertas de Chile y los orígenes de siempre. Una sola
-- lista de orígenes para toda la app (en SuperClini cada pantalla tenía la
-- suya). Idempotente: no duplica lo que ya existe (ni con otra mayúscula).
create or replace function public.seed_clinic_patient_options(p_clinic_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insertadas integer;
begin
  insert into public.clinic_patient_options (clinic_id, kind, label, position, created_by)
  select p_clinic_id, v.kind, v.label, v.position, null
    from (values
      ('isapre', 'Banmédica', 1),
      ('isapre', 'Colmena', 2),
      ('isapre', 'Consalud', 3),
      ('isapre', 'Cruz Blanca', 4),
      ('isapre', 'Nueva Masvida', 5),
      ('isapre', 'Vida Tres', 6),
      ('isapre', 'Esencial', 7),
      ('acquisition_source', 'Instagram', 1),
      ('acquisition_source', 'Google', 2),
      ('acquisition_source', 'Recomendación', 3),
      ('acquisition_source', 'Convenio', 4),
      ('acquisition_source', 'Pasaba por aquí', 5),
      ('acquisition_source', 'Otro', 6)
    ) as v(kind, label, position)
  on conflict (clinic_id, kind, lower(btrim(label))) do nothing;
  get diagnostics v_insertadas = row_count;
  return v_insertadas;
end;
$$;

-- Solo la llaman el trigger y esta migración.
revoke execute on function public.seed_clinic_patient_options(uuid) from public, anon, authenticated;

create or replace function public.seed_clinic_patient_options_al_crear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_clinic_patient_options(new.id);
  return new;
end;
$$;

revoke execute on function public.seed_clinic_patient_options_al_crear() from public, anon, authenticated;

drop trigger if exists on_clinic_created_patient_options on public.clinics;
create trigger on_clinic_created_patient_options
  after insert on public.clinics
  for each row execute function public.seed_clinic_patient_options_al_crear();

-- Clínicas que ya existen.
do $$
declare
  c record;
  v_total integer := 0;
begin
  for c in select id from public.clinics loop
    v_total := v_total + public.seed_clinic_patient_options(c.id);
  end loop;
  raise notice 'clinic_patient_options: % opciones sembradas.', v_total;
end
$$;

commit;

-- Cómo revertir (en una migración correctiva, ver el PR):
-- begin;
-- drop trigger if exists on_clinic_created_patient_options on public.clinics;
-- drop function if exists public.seed_clinic_patient_options_al_crear();
-- drop function if exists public.seed_clinic_patient_options(uuid);
-- drop table if exists public.clinic_patient_options;
-- alter table public.patients drop constraint if exists patients_rut_valido;
-- alter table public.patients drop constraint if exists patients_health_plan_tier_fonasa;
-- alter table public.patients drop constraint if exists patients_referred_by_not_self;
-- drop index if exists public.patients_referred_by_idx;
-- alter table public.patients
--   drop column if exists document_type, drop column if exists health_plan,
--   drop column if exists health_plan_tier, drop column if exists health_plan_institution,
--   drop column if exists emergency_contact_name, drop column if exists emergency_contact_relationship,
--   drop column if exists emergency_contact_phone, drop column if exists acquisition_source,
--   drop column if exists acquisition_source_detail, drop column if exists referred_by_patient_id,
--   drop column if exists address, drop column if exists commune;
-- drop function if exists public.rut_es_valido(text);
-- commit;
