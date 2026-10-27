-- Ola 9 · frente B · MKT-09: seguimiento de implantes.
--
-- Registro de cada implante del paciente: pieza (FDI), marca, modelo,
-- diámetro y largo, lote y referencia del fabricante, fecha, profesional,
-- estado y controles. Sirve para el día a día (qué tiene puesto el paciente)
-- y para un retiro de lote del fabricante: la búsqueda por lote encuentra a
-- todos los pacientes de la clínica con ese lote.
--
--   patient_implants          el implante (se edita: estado, notas, datos
--                             mal cargados). Cada cambio de estado queda
--                             además en un control.
--   patient_implant_controls  los controles: fecha, hallazgo, ISQ opcional y
--                             estado resultante. Append-only (regla 9): un
--                             control mal cargado se corrige con otro.
--
-- El estado del implante lo actualiza la base al registrar un control con
-- estado (trigger), así el implante y su historial no se separan.
--
-- Permisos (regla 2): historia clínica → solo owner/admin/dentist/assistant.
-- Nadie borra: un implante que se sacó queda "retirado".
--
-- Tablas nuevas, sin datos que migrar.

create table if not exists public.patient_implants (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  tooth smallint not null,
  brand text not null,
  model text,
  diameter_mm numeric(4,2),
  length_mm numeric(4,2),
  lot text not null,
  reference text,
  placed_on date not null,
  professional_id uuid references public.professionals(id) on delete set null,
  -- Regla 10: el nombre del profesional tal como estaba al registrar.
  professional_name text,
  status text not null default 'colocado',
  removed_on date,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FDI de dientes permanentes: cuadrante 1-4, pieza 1-8.
  constraint patient_implants_tooth_check check (
    tooth between 11 and 48 and tooth % 10 between 1 and 8
  ),
  constraint patient_implants_brand_check check (char_length(btrim(brand)) between 1 and 80),
  constraint patient_implants_model_check check (model is null or char_length(model) <= 80),
  constraint patient_implants_diameter_check check (
    diameter_mm is null or diameter_mm between 2 and 8
  ),
  constraint patient_implants_length_check check (length_mm is null or length_mm between 4 and 25),
  constraint patient_implants_lot_check check (char_length(btrim(lot)) between 1 and 60),
  constraint patient_implants_reference_check check (
    reference is null or char_length(reference) <= 60
  ),
  constraint patient_implants_status_check check (
    status in ('colocado', 'oseointegrado', 'cargado', 'en_observacion', 'fallido', 'retirado')
  ),
  constraint patient_implants_removed_check check (
    removed_on is null or removed_on >= placed_on
  ),
  constraint patient_implants_notes_check check (notes is null or char_length(notes) <= 1000)
);

create index if not exists patient_implants_patient_idx
  on public.patient_implants (clinic_id, patient_id, placed_on desc);
-- Búsqueda por lote (retiro del fabricante), sin distinguir mayúsculas.
create index if not exists patient_implants_lote_idx
  on public.patient_implants (clinic_id, lower(btrim(lot)));

comment on table public.patient_implants is
  'MKT-09: implantes de cada paciente (pieza, marca, modelo, medidas, lote, fecha, profesional y estado). Se busca por lote para un retiro del fabricante.';

create table if not exists public.patient_implant_controls (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  implant_id uuid not null references public.patient_implants(id) on delete restrict,
  controlled_on date not null,
  finding text not null,
  isq smallint,
  status_after text,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  constraint patient_implant_controls_finding_check check (
    char_length(btrim(finding)) between 2 and 1000
  ),
  constraint patient_implant_controls_isq_check check (isq is null or isq between 1 and 99),
  constraint patient_implant_controls_status_check check (
    status_after is null
    or status_after in ('colocado', 'oseointegrado', 'cargado', 'en_observacion', 'fallido', 'retirado')
  )
);

create index if not exists patient_implant_controls_implant_idx
  on public.patient_implant_controls (implant_id, controlled_on desc);

comment on table public.patient_implant_controls is
  'MKT-09: controles de cada implante (append-only). El estado resultante actualiza el implante.';

-- ── Permisos ──────────────────────────────────────────────────────────────
revoke all on public.patient_implants from anon, authenticated;
grant select, insert, update on public.patient_implants to authenticated;
grant all on public.patient_implants to service_role;
alter table public.patient_implants enable row level security;

revoke all on public.patient_implant_controls from anon, authenticated;
grant select, insert on public.patient_implant_controls to authenticated;
grant all on public.patient_implant_controls to service_role;
alter table public.patient_implant_controls enable row level security;

drop policy if exists patient_implants_select on public.patient_implants;
create policy patient_implants_select on public.patient_implants
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists patient_implants_insert on public.patient_implants;
create policy patient_implants_insert on public.patient_implants
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.patients p
       where p.id = patient_implants.patient_id and p.clinic_id = patient_implants.clinic_id
    )
  );

drop policy if exists patient_implants_update on public.patient_implants;
create policy patient_implants_update on public.patient_implants
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists patient_implant_controls_select on public.patient_implant_controls;
create policy patient_implant_controls_select on public.patient_implant_controls
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

-- El implante tiene que ser de la misma clínica y del mismo paciente: el FK
-- solo asegura que existe.
drop policy if exists patient_implant_controls_insert on public.patient_implant_controls;
create policy patient_implant_controls_insert on public.patient_implant_controls
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
    and recorded_by = (select auth.uid())
    and exists (
      select 1 from public.patient_implants i
       where i.id = patient_implant_controls.implant_id
         and i.clinic_id = patient_implant_controls.clinic_id
         and i.patient_id = patient_implant_controls.patient_id
    )
  );

drop policy if exists mfa_exige_aal2 on public.patient_implants;
create policy mfa_exige_aal2 on public.patient_implants
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_implant_controls;
create policy mfa_exige_aal2 on public.patient_implant_controls
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ── Reglas ────────────────────────────────────────────────────────────────
-- Implante: el profesional tiene que ser de la clínica (y su nombre queda
-- como snapshot); clínica, paciente y autor no cambian; quién y cuándo los
-- pone la base.
create or replace function public.validar_implante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id
       or new.patient_id is distinct from old.patient_id
       or new.created_by is distinct from old.created_by then
      raise exception 'La clínica, el paciente y quién registró el implante no se cambian.'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;

  if new.professional_id is not null
     and (tg_op = 'INSERT' or new.professional_id is distinct from old.professional_id) then
    select full_name into v_nombre
      from public.professionals
     where id = new.professional_id and clinic_id = new.clinic_id;
    if not found then
      raise exception 'El profesional no es de esta clínica.' using errcode = '42501';
    end if;
    new.professional_name := v_nombre;
  elsif new.professional_id is null and tg_op = 'UPDATE' and old.professional_id is not null then
    -- El profesional se borró (SET NULL) o se quitó: el nombre queda.
    new.professional_name := coalesce(new.professional_name, old.professional_name);
  end if;

  if new.status = 'retirado' and new.removed_on is null then
    new.removed_on := current_date;
  end if;
  new.lot := btrim(new.lot);
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validar_implante() from public, anon, authenticated;

drop trigger if exists patient_implants_validar on public.patient_implants;
create trigger patient_implants_validar
  before insert or update on public.patient_implants
  for each row execute function public.validar_implante();

-- Control: el estado resultante pasa al implante (con la fecha de retiro si
-- corresponde). SECURITY DEFINER: quien registra el control ya pasó la RLS
-- del INSERT, y el implante es de la misma clínica y paciente.
create or replace function public.aplicar_control_de_implante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status_after is not null then
    update public.patient_implants
       set status = new.status_after,
           removed_on = case
             when new.status_after = 'retirado' then coalesce(removed_on, new.controlled_on)
             else removed_on
           end
     where id = new.implant_id
       and clinic_id = new.clinic_id
       and status is distinct from new.status_after;
  end if;
  return null;
end;
$$;

revoke all on function public.aplicar_control_de_implante() from public, anon, authenticated;

drop trigger if exists patient_implant_controls_aplicar on public.patient_implant_controls;
create trigger patient_implant_controls_aplicar
  after insert on public.patient_implant_controls
  for each row execute function public.aplicar_control_de_implante();

drop trigger if exists block_demo_writes on public.patient_implants;
create trigger block_demo_writes
  before insert or update or delete on public.patient_implants
  for each row execute function public.block_demo_writes();

drop trigger if exists block_demo_writes on public.patient_implant_controls;
create trigger block_demo_writes
  before insert or update or delete on public.patient_implant_controls
  for each row execute function public.block_demo_writes();

-- ── Reversa (hacer antes un backup si ya hay implantes) ───────────────────
-- drop trigger if exists block_demo_writes on public.patient_implant_controls;
-- drop trigger if exists block_demo_writes on public.patient_implants;
-- drop trigger if exists patient_implant_controls_aplicar on public.patient_implant_controls;
-- drop function if exists public.aplicar_control_de_implante();
-- drop trigger if exists patient_implants_validar on public.patient_implants;
-- drop function if exists public.validar_implante();
-- drop policy if exists mfa_exige_aal2 on public.patient_implant_controls;
-- drop policy if exists mfa_exige_aal2 on public.patient_implants;
-- drop table if exists public.patient_implant_controls;
-- drop table if exists public.patient_implants;
