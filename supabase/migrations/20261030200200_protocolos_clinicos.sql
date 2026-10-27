-- Ola 9 · frente B · FIC-15: protocolos clínicos por clínica.
--
-- Un protocolo es una lista de pasos e indicaciones para un procedimiento
-- (exodoncia simple, blanqueamiento, endodoncia…). Se aplica a una atención
-- desde el editor de notas: el texto del protocolo entra en la nota, así que
-- queda registrado en su versión (y en su firma) como cualquier otro
-- contenido de la nota, sin tabla intermedia que mantener.
--
-- No tiene datos de pacientes: es configuración de la clínica, como las
-- plantillas de documentos. Lo leen los roles clínicos (lo usan al escribir
-- la nota) y lo administran owner/admin/dentist. No se borra: se desactiva,
-- para no perder de dónde salió el texto de notas viejas.
--
-- Tabla nueva, sin datos que migrar.

create table if not exists public.clinical_protocols (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  procedure_label text,
  steps jsonb not null default '[]'::jsonb,
  indications text,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_protocols_name_check check (char_length(btrim(name)) between 2 and 120),
  constraint clinical_protocols_procedure_check check (
    procedure_label is null or char_length(procedure_label) <= 120
  ),
  -- La forma de cada paso (texto corto) la valida el zod del servidor
  -- (`protocolos.ts`); acá, que sea una lista de 1 a 40 elementos.
  constraint clinical_protocols_steps_check check (
    jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 40
  ),
  constraint clinical_protocols_indications_check check (
    indications is null or char_length(indications) <= 4000
  )
);

create unique index if not exists clinical_protocols_nombre_unico
  on public.clinical_protocols (clinic_id, lower(btrim(name)));

comment on table public.clinical_protocols is
  'FIC-15: protocolos clínicos de la clínica (pasos e indicaciones por procedimiento). Se aplican copiando su texto a la nota.';

revoke all on public.clinical_protocols from anon, authenticated;
grant select, insert, update on public.clinical_protocols to authenticated;
grant all on public.clinical_protocols to service_role;
alter table public.clinical_protocols enable row level security;

drop policy if exists clinical_protocols_select on public.clinical_protocols;
create policy clinical_protocols_select on public.clinical_protocols
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists clinical_protocols_insert on public.clinical_protocols;
create policy clinical_protocols_insert on public.clinical_protocols
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[])
    and created_by = (select auth.uid())
  );

drop policy if exists clinical_protocols_update on public.clinical_protocols;
create policy clinical_protocols_update on public.clinical_protocols
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[]));

-- Quién lo cambió y cuándo los pone la base; la clínica y el autor no cambian.
create or replace function public.estampar_protocolo_clinico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id or new.created_by is distinct from old.created_by then
      raise exception 'La clínica y el autor de un protocolo no se cambian.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.estampar_protocolo_clinico() from public, anon, authenticated;

drop trigger if exists clinical_protocols_estampar on public.clinical_protocols;
create trigger clinical_protocols_estampar
  before insert or update on public.clinical_protocols
  for each row execute function public.estampar_protocolo_clinico();

drop trigger if exists block_demo_writes on public.clinical_protocols;
create trigger block_demo_writes
  before insert or update or delete on public.clinical_protocols
  for each row execute function public.block_demo_writes();

-- ── Reversa (hacer antes un backup si ya hay protocolos) ──────────────────
-- drop trigger if exists block_demo_writes on public.clinical_protocols;
-- drop trigger if exists clinical_protocols_estampar on public.clinical_protocols;
-- drop function if exists public.estampar_protocolo_clinico();
-- drop table if exists public.clinical_protocols;
