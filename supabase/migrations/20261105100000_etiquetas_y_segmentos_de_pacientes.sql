-- Ola 8 · frente A · PAC-06, PAC-07 y PAC-15: etiquetas, segmentos y motivo
-- de archivo de las fichas.
--
-- 1. patient_labels: catálogo de etiquetas por clínica ("VIP", "Ortodoncia
--    2026", "Prefiere la tarde"…), con un color de una paleta cerrada que la
--    app traduce a tokens del sistema visual (nunca un hex libre).
-- 2. patient_label_assignments: qué etiquetas tiene cada paciente. La clínica
--    de la fila tiene que coincidir con la del paciente y la de la etiqueta
--    (lo valida un trigger, no la app).
-- 3. patient_segments: segmentos guardados = una combinación de filtros de
--    /pacientes con nombre, reutilizable (campañas del frente B). Guarda solo
--    los filtros (jsonb), nunca la lista de pacientes: se resuelve al usarlo.
-- 4. patients.archive_reason: por qué se archivó una ficha (PAC-15, "eliminar
--    de forma segura" = archivar). Se borra solo al restaurar.
--
-- `patients.tags` (texto libre del esquema original) queda como está: no se
-- migra ni se borra. Las etiquetas nuevas viven en el catálogo.
--
-- Permisos:
-- - Leer: cualquier miembro de la clínica (la lista de pacientes la ven todos
--   los roles con `patients:view`).
-- - Crear o editar etiquetas y asignarlas, crear segmentos: los roles con
--   `patients:manage` (owner, admin, dentist, reception).
-- - Borrar una etiqueta del catálogo (se va de todas las fichas): owner/admin.
-- - Borrar un segmento: quien lo creó u owner/admin.
-- - Todas exigen aal2 a quien activó MFA (`mfa_exige_aal2`), como el resto de
--   las tablas con datos de pacientes.
--
-- Tablas nuevas, sin datos que migrar. La columna nueva es nullable.

-- ─── 1. Catálogo de etiquetas ───────────────────────────────────────────────
create table if not exists public.patient_labels (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  color text not null default 'ocre',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_labels_name_check check (char_length(btrim(name)) between 1 and 40),
  constraint patient_labels_color_check check (
    color in ('ocre', 'azul', 'verde', 'ambar', 'rojo', 'violeta', 'gris')
  ),
  -- Para la FK compuesta de las asignaciones (misma clínica).
  constraint patient_labels_id_clinic_key unique (id, clinic_id)
);

create unique index if not exists patient_labels_nombre_unico
  on public.patient_labels (clinic_id, lower(btrim(name)));

comment on table public.patient_labels is
  'PAC-07: catálogo de etiquetas de pacientes por clínica, con un color de la paleta del sistema.';

revoke all on public.patient_labels from anon, authenticated;
grant select, insert, update, delete on public.patient_labels to authenticated;
grant all on public.patient_labels to service_role;
alter table public.patient_labels enable row level security;

drop policy if exists patient_labels_select on public.patient_labels;
create policy patient_labels_select on public.patient_labels
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists patient_labels_insert on public.patient_labels;
create policy patient_labels_insert on public.patient_labels
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists patient_labels_update on public.patient_labels;
create policy patient_labels_update on public.patient_labels
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists patient_labels_delete on public.patient_labels;
create policy patient_labels_delete on public.patient_labels
  for delete to authenticated
  using (public.can_manage_clinic(clinic_id));

drop policy if exists mfa_exige_aal2 on public.patient_labels;
create policy mfa_exige_aal2 on public.patient_labels
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- La clínica y el autor no se cambian; updated_at lo pone la base.
create or replace function public.patient_labels_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Una etiqueta no cambia de clínica.' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.patient_labels_proteger() from public, anon, authenticated;

drop trigger if exists patient_labels_proteger on public.patient_labels;
create trigger patient_labels_proteger
  before insert or update on public.patient_labels
  for each row execute function public.patient_labels_proteger();

drop trigger if exists block_demo_writes on public.patient_labels;
create trigger block_demo_writes
  before insert or update or delete on public.patient_labels
  for each row execute function public.block_demo_writes();

-- ─── 2. Etiquetas de cada paciente ──────────────────────────────────────────
create table if not exists public.patient_label_assignments (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- No es historia clínica: CASCADE como `messages` (20261019220000). Igual
  -- las fichas no se borran (se archivan).
  patient_id uuid not null references public.patients(id) on delete cascade,
  label_id uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (patient_id, label_id),
  -- La etiqueta es de la misma clínica que la fila; borrarla del catálogo la
  -- saca de todas las fichas.
  constraint patient_label_assignments_label_fkey
    foreign key (label_id, clinic_id) references public.patient_labels (id, clinic_id)
    on delete cascade
);

create index if not exists patient_label_assignments_label_idx
  on public.patient_label_assignments (clinic_id, label_id);

comment on table public.patient_label_assignments is
  'PAC-07: etiquetas asignadas a cada paciente (mismo clinic_id que el paciente y la etiqueta).';

revoke all on public.patient_label_assignments from anon, authenticated;
grant select, insert, delete on public.patient_label_assignments to authenticated;
grant all on public.patient_label_assignments to service_role;
alter table public.patient_label_assignments enable row level security;

drop policy if exists patient_label_assignments_select on public.patient_label_assignments;
create policy patient_label_assignments_select on public.patient_label_assignments
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists patient_label_assignments_insert on public.patient_label_assignments;
create policy patient_label_assignments_insert on public.patient_label_assignments
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists patient_label_assignments_delete on public.patient_label_assignments;
create policy patient_label_assignments_delete on public.patient_label_assignments
  for delete to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists mfa_exige_aal2 on public.patient_label_assignments;
create policy mfa_exige_aal2 on public.patient_label_assignments
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- El paciente es de la clínica de la fila (la etiqueta ya la ata la FK). SECURITY
-- DEFINER para mirar el paciente aunque la fila venga del rol de servicio; no
-- devuelve nada al usuario, solo acepta o rechaza.
create or replace function public.patient_label_assignments_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.patients p where p.id = new.patient_id and p.clinic_id = new.clinic_id
  ) then
    raise exception 'El paciente no es de esta clínica.' using errcode = '42501';
  end if;
  new.created_at := now();
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.patient_label_assignments_validar() from public, anon, authenticated;

drop trigger if exists patient_label_assignments_validar on public.patient_label_assignments;
create trigger patient_label_assignments_validar
  before insert on public.patient_label_assignments
  for each row execute function public.patient_label_assignments_validar();

drop trigger if exists block_demo_writes on public.patient_label_assignments;
create trigger block_demo_writes
  before insert or update or delete on public.patient_label_assignments
  for each row execute function public.block_demo_writes();

-- ─── 3. Segmentos guardados ─────────────────────────────────────────────────
create table if not exists public.patient_segments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  description text,
  -- Filtros de /pacientes (src/lib/patients/filtros-pacientes.ts). La app los
  -- normaliza al leer: una clave desconocida se ignora, no rompe.
  filters jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint patient_segments_name_check check (char_length(btrim(name)) between 2 and 60),
  constraint patient_segments_description_check check (
    description is null or char_length(description) <= 200
  ),
  constraint patient_segments_filters_check check (
    jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 4000
  )
);

create unique index if not exists patient_segments_nombre_unico
  on public.patient_segments (clinic_id, lower(btrim(name)));

comment on table public.patient_segments is
  'PAC-06: segmentos de pacientes guardados por clínica (filtros con nombre, sin la lista de pacientes).';

revoke all on public.patient_segments from anon, authenticated;
grant select, insert, update, delete on public.patient_segments to authenticated;
grant all on public.patient_segments to service_role;
alter table public.patient_segments enable row level security;

drop policy if exists patient_segments_select on public.patient_segments;
create policy patient_segments_select on public.patient_segments
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists patient_segments_insert on public.patient_segments;
create policy patient_segments_insert on public.patient_segments
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists patient_segments_update on public.patient_segments;
create policy patient_segments_update on public.patient_segments
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists patient_segments_delete on public.patient_segments;
create policy patient_segments_delete on public.patient_segments
  for delete to authenticated
  using (
    public.can_manage_clinic(clinic_id)
    or (
      created_by = (select auth.uid())
      and public.has_clinic_role(clinic_id, array['dentist','reception']::public.app_role[])
    )
  );

drop policy if exists mfa_exige_aal2 on public.patient_segments;
create policy mfa_exige_aal2 on public.patient_segments
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

create or replace function public.patient_segments_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.created_at := now();
    new.updated_by := null;
  else
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Un segmento no cambia de clínica.' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.patient_segments_proteger() from public, anon, authenticated;

drop trigger if exists patient_segments_proteger on public.patient_segments;
create trigger patient_segments_proteger
  before insert or update on public.patient_segments
  for each row execute function public.patient_segments_proteger();

drop trigger if exists block_demo_writes on public.patient_segments;
create trigger block_demo_writes
  before insert or update or delete on public.patient_segments
  for each row execute function public.block_demo_writes();

-- ─── 4. Motivo de archivo de la ficha ───────────────────────────────────────
alter table public.patients add column if not exists archive_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'patients_archive_reason_check'
  ) then
    alter table public.patients
      add constraint patients_archive_reason_check
      check (archive_reason is null or char_length(archive_reason) <= 500);
  end if;
end;
$$;

comment on column public.patients.archive_reason is
  'PAC-15: por qué se archivó la ficha. Solo se escribe al archivar y se borra al restaurar (trigger patients_motivo_de_archivo).';

-- Corre después de `patients_controlar_archivo` (orden alfabético de los
-- triggers BEFORE), que ya decidió si el archivo cambia y quién puede. Acá
-- solo se cuida el motivo: no se reescribe con la ficha ya archivada y se va
-- al restaurar. No toca la función existente.
create or replace function public.patients_motivo_de_archivo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.archived_at is null then
      new.archive_reason := null;
    end if;
    return new;
  end if;
  if new.archived_at is null then
    new.archive_reason := null;                 -- restaurar (o nunca archivada)
  elsif old.archived_at is not null then
    new.archive_reason := old.archive_reason;   -- ya archivada: no se reescribe
  else
    new.archive_reason := nullif(btrim(new.archive_reason), '');
  end if;
  return new;
end;
$$;

revoke all on function public.patients_motivo_de_archivo() from public, anon, authenticated;

drop trigger if exists patients_motivo_de_archivo on public.patients;
create trigger patients_motivo_de_archivo
  before insert or update on public.patients
  for each row execute function public.patients_motivo_de_archivo();


-- ── Reversa (hacer antes un backup si ya hay etiquetas o segmentos) ───────
-- drop trigger if exists patients_motivo_de_archivo on public.patients;
-- drop function if exists public.patients_motivo_de_archivo();
-- alter table public.patients drop constraint if exists patients_archive_reason_check;
-- alter table public.patients drop column if exists archive_reason;
-- drop policy if exists mfa_exige_aal2 on public.patient_segments;
-- drop policy if exists mfa_exige_aal2 on public.patient_label_assignments;
-- drop policy if exists mfa_exige_aal2 on public.patient_labels;
-- drop table if exists public.patient_segments;
-- drop table if exists public.patient_label_assignments;
-- drop table if exists public.patient_labels;
-- drop function if exists public.patient_segments_proteger();
-- drop function if exists public.patient_label_assignments_validar();
-- drop function if exists public.patient_labels_proteger();
