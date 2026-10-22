-- Ola 4 · Frente Motor de plantillas y documentos (1/3): DOC-01, DOC-06, DOC-08.
--
-- Un solo motor para los documentos que la clínica emite con datos de la
-- ficha (certificados, informes, reembolso; después el PDF del presupuesto y
-- la receta). El texto se arma en la app (src/lib/documentos/motor.ts); la
-- base guarda las plantillas con sus versiones y el documento emitido tal
-- como quedó, con su huella.
--
--   1. professionals: registro en la Superintendencia de Salud (dato nuevo,
--      nullable) y la imagen de firma del profesional (ruta + sha256). La
--      firma la registra cada profesional para sí mismo con
--      `registrar_mi_firma`; un administrador solo puede quitarla.
--   2. Bucket privado `professional-signatures`: `<clinic_id>/<professional_id>/<uuid>.png`.
--      Lo leen los roles clínicos de la clínica; lo sube solo el propio
--      profesional. Sin UPDATE ni DELETE: una firma usada en un documento
--      emitido no se reemplaza in situ (una firma nueva es un archivo nuevo).
--   3. document_templates + document_template_versions: editar una plantilla
--      crea una versión nueva (INSERT), nunca reescribe la anterior. La
--      plantilla apunta a su versión vigente.
--   4. issued_documents: el documento emitido guarda el id de la versión, los
--      bloques y el HTML canónico renderizados, los datos de quien firma, de la
--      clínica y del paciente (copiados por la base, no por el cliente), el
--      correlativo y la huella sha256 que calcula la base. No se edita ni se
--      borra: solo se anula con motivo, quién y cuándo (Decreto 41: la ficha
--      se conserva 15 años).
--
-- Permisos (regla 2): leer plantillas y documentos, los roles clínicos
-- (owner, admin, dentist, assistant). Emitir: owner, admin y dentist, con su
-- propia ficha de profesional. Editar plantillas: owner y admin
-- (`can_manage_clinic`, par de `settings:manage`). Política RESTRICTIVE
-- `mfa_exige_aal2` en issued_documents (src/lib/auth/mfa-rls.ts).
--
-- Compatible con el código en producción (RUNBOOK regla 3): solo tablas,
-- columnas nullable, funciones, triggers y un bucket nuevos.
--
-- Reversa al pie.

begin;

-- ─── 1. professionals: registro SIS y firma ────────────────────────────────

alter table public.professionals
  add column if not exists sis_registry_number text,
  add column if not exists signature_storage_path text,
  add column if not exists signature_sha256 text,
  add column if not exists signature_updated_at timestamptz;

alter table public.professionals
  drop constraint if exists professionals_sis_registry_number_check;
alter table public.professionals
  add constraint professionals_sis_registry_number_check
  check (sis_registry_number is null or char_length(btrim(sis_registry_number)) between 1 and 40);

comment on column public.professionals.sis_registry_number is
  'Número en el Registro Nacional de Prestadores Individuales de la Superintendencia de Salud (Chile). NULL = sin cargar.';
comment on column public.professionals.signature_storage_path is
  'Imagen de la firma del profesional en el bucket professional-signatures. La registra el propio profesional (registrar_mi_firma).';

-- La firma es personal: solo el propio profesional la cambia (vía
-- registrar_mi_firma, que corre con su identidad). Un administrador puede
-- quitarla (dejarla en NULL), por ejemplo si el profesional se va.
create or replace function public.professionals_firma_propia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.signature_storage_path is not distinct from old.signature_storage_path
     and new.signature_sha256 is not distinct from old.signature_sha256 then
    new.signature_updated_at := old.signature_updated_at;
    return new;
  end if;
  if auth.uid() is not null
     and new.user_id is distinct from auth.uid()
     and not (new.signature_storage_path is null and new.signature_sha256 is null
              and public.can_manage_clinic(new.clinic_id)) then
    raise exception 'Solo el propio profesional puede registrar su firma.' using errcode = '42501';
  end if;
  if new.signature_storage_path is not null
     and new.signature_storage_path not like new.clinic_id::text || '/' || new.id::text || '/%' then
    raise exception 'La firma tiene que estar en la carpeta del profesional.' using errcode = '22023';
  end if;
  if (new.signature_storage_path is null) <> (new.signature_sha256 is null) then
    raise exception 'La firma necesita su archivo y su huella.' using errcode = '22023';
  end if;
  new.signature_updated_at := case when new.signature_storage_path is null then null else now() end;
  return new;
end;
$$;

revoke execute on function public.professionals_firma_propia() from public, anon, authenticated;

drop trigger if exists professionals_firma_propia on public.professionals;
create trigger professionals_firma_propia
  before update on public.professionals
  for each row execute function public.professionals_firma_propia();

-- Registro de la firma y del número SIS del propio profesional. SECURITY
-- DEFINER porque la RLS de professionals solo deja escribir a quien gestiona
-- la clínica; acá se escribe solo la fila vinculada a auth.uid().
create or replace function public.registrar_mi_firma(
  p_clinic_id uuid,
  p_storage_path text,
  p_sha256 text,
  p_registro_sis text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prof record;
  v_registro text := nullif(btrim(coalesce(p_registro_sis, '')), '');
  -- '' = no cambiar (la app manda texto vacío en vez de NULL).
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_sha text := nullif(btrim(coalesce(p_sha256, '')), '');
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión.' using errcode = '42501';
  end if;
  if not public.has_clinic_role(p_clinic_id, array['owner','admin','dentist']::public.app_role[]) then
    raise exception 'Tu rol no firma documentos clínicos.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinics where id = p_clinic_id and is_demo) then
    raise exception 'Esta es la clínica demo: es de solo lectura.';
  end if;
  if v_registro is not null and char_length(v_registro) > 40 then
    raise exception 'El número de registro es demasiado largo.' using errcode = '22023';
  end if;
  if v_path is not null and (v_sha is null or v_sha !~ '^[0-9a-f]{64}$') then
    raise exception 'Huella de la firma inválida.' using errcode = '22023';
  end if;

  select id into v_prof
    from public.professionals
   where clinic_id = p_clinic_id and user_id = v_uid and is_active
   order by created_at
   limit 1;
  if v_prof.id is null then
    raise exception 'Tu usuario no tiene una ficha de profesional en esta clínica. Pídele a un administrador que la vincule en Profesionales.';
  end if;

  if v_path is not null and not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'professional-signatures' and o.name = v_path
  ) then
    raise exception 'No encontramos el archivo de la firma.' using errcode = '22023';
  end if;

  update public.professionals
     set signature_storage_path = coalesce(v_path, signature_storage_path),
         signature_sha256 = case when v_path is null then signature_sha256 else v_sha end,
         sis_registry_number = coalesce(v_registro, sis_registry_number)
   where id = v_prof.id;
end;
$$;

comment on function public.registrar_mi_firma(uuid, text, text, text) is
  'DOC-06: el profesional vinculado a auth.uid() registra su imagen de firma y su número de la Superintendencia de Salud.';

revoke all on function public.registrar_mi_firma(uuid, text, text, text) from public, anon;
grant execute on function public.registrar_mi_firma(uuid, text, text, text) to authenticated;

-- ─── 2. Bucket de firmas ───────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'professional-signatures',
  'professional-signatures',
  false,
  1048576, -- 1 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- ¿La carpeta `<clinic_id>/<professional_id>/` es la del usuario que sube?
-- Invoker: lee professionals con la RLS de quien llama (los miembros la ven).
create or replace function public.firma_es_de_mi_profesional(_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.professionals p
     where (storage.foldername(_name))[2] ~ '^[0-9a-f-]{36}$'
       and (storage.foldername(_name))[1] ~ '^[0-9a-f-]{36}$'
       and p.id = ((storage.foldername(_name))[2])::uuid
       and p.clinic_id = ((storage.foldername(_name))[1])::uuid
       and p.user_id = auth.uid()
  );
$$;

revoke execute on function public.firma_es_de_mi_profesional(text) from public, anon;
grant execute on function public.firma_es_de_mi_profesional(text) to authenticated;

drop policy if exists "professional_signatures_select" on storage.objects;
create policy "professional_signatures_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'professional-signatures'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.has_clinic_role(
      public.storage_clinic_id_of(name),
      array['owner','admin','dentist','assistant']::public.app_role[]
    )
  );

drop policy if exists "professional_signatures_insert" on storage.objects;
create policy "professional_signatures_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'professional-signatures'
    and public.firma_es_de_mi_profesional(name)
  );

-- ─── 3. Plantillas y versiones ─────────────────────────────────────────────

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  kind text not null default 'otro',
  title text not null,
  description text,
  -- Versión vigente. FK agregada abajo, cuando existe la tabla de versiones.
  current_version_id uuid,
  active boolean not null default true,
  -- 'esmalia_model' = la sembró Esmalia (texto modelo para revisar).
  source text not null default 'clinic',
  seed_key text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  constraint document_templates_kind_check check (kind in (
    'certificado_atencion', 'reposo', 'derivacion', 'alta', 'informe',
    'consentimiento', 'reembolso', 'otro'
  )),
  constraint document_templates_title_check check (char_length(btrim(title)) between 2 and 120),
  constraint document_templates_description_check check (description is null or char_length(description) <= 300),
  constraint document_templates_source_check check (source in ('clinic', 'esmalia_model'))
);

comment on table public.document_templates is
  'DOC-01/DOC-09: plantilla de documento de la clínica. El texto vive en document_template_versions; current_version_id es la vigente.';

create unique index if not exists document_templates_seed_key_uniq
  on public.document_templates (clinic_id, seed_key)
  where seed_key is not null;
create index if not exists document_templates_clinic_idx
  on public.document_templates (clinic_id, active, title);

create table if not exists public.document_template_versions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  template_id uuid not null,
  version integer not null,
  title text not null,
  body text not null,
  -- NULL = la sembró el sistema.
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (template_id, version),
  unique (id, clinic_id),
  foreign key (template_id, clinic_id)
    references public.document_templates (id, clinic_id) on delete cascade,
  constraint document_template_versions_version_check check (version >= 1),
  constraint document_template_versions_title_check check (char_length(btrim(title)) between 2 and 120),
  constraint document_template_versions_body_check check (char_length(body) between 1 and 20000)
);

comment on table public.document_template_versions is
  'DOC-01: versión inmutable del texto de una plantilla (solo INSERT). Un documento emitido guarda el id de la versión con la que se armó.';

create index if not exists document_template_versions_clinic_idx
  on public.document_template_versions (clinic_id);

alter table public.document_templates
  drop constraint if exists document_templates_current_version_fk;
alter table public.document_templates
  add constraint document_templates_current_version_fk
  foreign key (current_version_id) references public.document_template_versions (id)
  on delete set null;

-- Numera la versión, la fecha y su autor los pone la base.
create or replace function public.document_template_versions_numerar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
begin
  select id, clinic_id into v_template
    from public.document_templates
   where id = new.template_id
   for update;
  if v_template.id is null or v_template.clinic_id <> new.clinic_id then
    raise exception 'La plantilla no existe en esta clínica.' using errcode = '23503';
  end if;
  select coalesce(max(version), 0) + 1 into new.version
    from public.document_template_versions
   where template_id = new.template_id;
  new.created_at := now();
  new.created_by := auth.uid();
  new.title := btrim(new.title);
  return new;
end;
$$;

revoke execute on function public.document_template_versions_numerar() from public, anon, authenticated;

drop trigger if exists document_template_versions_numerar on public.document_template_versions;
create trigger document_template_versions_numerar
  before insert on public.document_template_versions
  for each row execute function public.document_template_versions_numerar();

-- La versión nueva pasa a ser la vigente, y el título de la plantilla sigue
-- al de su versión vigente.
create or replace function public.document_template_versions_vigente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.document_templates
     set current_version_id = new.id,
         title = new.title,
         updated_at = now()
   where id = new.template_id;
  return null;
end;
$$;

revoke execute on function public.document_template_versions_vigente() from public, anon, authenticated;

drop trigger if exists document_template_versions_vigente on public.document_template_versions;
create trigger document_template_versions_vigente
  after insert on public.document_template_versions
  for each row execute function public.document_template_versions_vigente();

-- Una versión no se edita (también se le quita el permiso abajo).
create or replace function public.document_template_versions_inmutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Una versión de plantilla no se edita: guarda una versión nueva.' using errcode = '23514';
end;
$$;

revoke execute on function public.document_template_versions_inmutables() from public, anon, authenticated;

drop trigger if exists document_template_versions_inmutables on public.document_template_versions;
create trigger document_template_versions_inmutables
  before update on public.document_template_versions
  for each row execute function public.document_template_versions_inmutables();

-- En la plantilla: el origen y la clave de siembra no se reescriben desde la
-- app, y la versión vigente tiene que ser de la misma plantilla.
create or replace function public.document_templates_proteger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'Una plantilla no cambia de clínica.' using errcode = '23514';
  end if;
  new.source := old.source;
  new.seed_key := old.seed_key;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.current_version_id is distinct from old.current_version_id
     and new.current_version_id is not null
     and not exists (
       select 1 from public.document_template_versions v
        where v.id = new.current_version_id and v.template_id = new.id
     ) then
    raise exception 'La versión vigente tiene que ser de esta plantilla.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.document_templates_proteger() from public, anon, authenticated;

drop trigger if exists document_templates_proteger on public.document_templates;
create trigger document_templates_proteger
  before update on public.document_templates
  for each row execute function public.document_templates_proteger();

drop trigger if exists block_demo_writes on public.document_templates;
create trigger block_demo_writes
  before insert or update or delete on public.document_templates
  for each row execute function public.block_demo_writes();
drop trigger if exists block_demo_writes on public.document_template_versions;
create trigger block_demo_writes
  before insert or update or delete on public.document_template_versions
  for each row execute function public.block_demo_writes();

grant select, insert, update on public.document_templates to authenticated;
-- Una plantilla usada en documentos emitidos no se borra: se desactiva.
revoke delete, truncate on public.document_templates from anon, authenticated;
grant all on public.document_templates to service_role;
alter table public.document_templates enable row level security;

drop policy if exists document_templates_select_clinicos on public.document_templates;
create policy document_templates_select_clinicos on public.document_templates
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]));
drop policy if exists document_templates_insert_gestion on public.document_templates;
create policy document_templates_insert_gestion on public.document_templates
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));
drop policy if exists document_templates_update_gestion on public.document_templates;
create policy document_templates_update_gestion on public.document_templates
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

grant select, insert on public.document_template_versions to authenticated;
revoke update, delete, truncate on public.document_template_versions from anon, authenticated;
grant all on public.document_template_versions to service_role;
alter table public.document_template_versions enable row level security;

drop policy if exists document_template_versions_select_clinicos on public.document_template_versions;
create policy document_template_versions_select_clinicos on public.document_template_versions
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]));
drop policy if exists document_template_versions_insert_gestion on public.document_template_versions;
create policy document_template_versions_insert_gestion on public.document_template_versions
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

-- ─── 4. Documentos emitidos ─────────────────────────────────────────────────

create table if not exists public.issued_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- RESTRICT como el resto de las FKs clínicas: los pacientes se archivan.
  patient_id uuid not null references public.patients(id) on delete restrict,
  template_id uuid references public.document_templates(id) on delete set null,
  -- La versión exacta con la que se armó. Las versiones no se borran.
  template_version_id uuid not null references public.document_template_versions(id) on delete restrict,
  kind text not null,
  title text not null,
  -- Correlativo por clínica y año (next_clinic_counter, kind 'document').
  year integer not null,
  number integer not null,
  professional_id uuid references public.professionals(id) on delete set null,
  professional_name_snapshot text not null,
  professional_registry_snapshot text,
  professional_specialty_snapshot text,
  clinic_name_snapshot text not null,
  clinic_legal_name_snapshot text,
  clinic_tax_id_snapshot text,
  clinic_address_snapshot text,
  clinic_phone_snapshot text,
  patient_name_snapshot text not null,
  -- Lo completado al emitir (`{{campo.*}}`): nombre → texto.
  fields jsonb not null default '{}'::jsonb,
  -- Bloques renderizados (src/lib/documentos/tipos.ts) y su HTML canónico.
  content_blocks jsonb not null,
  content_html text not null,
  signature_storage_path text,
  signature_sha256 text,
  -- sha256(content_html || U+001F || coalesce(signature_sha256, '')): lo calcula la base.
  content_sha256 text not null,
  issued_at timestamptz not null default now(),
  issued_by uuid not null default auth.uid(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  constraint issued_documents_number_uniq unique (clinic_id, year, number),
  constraint issued_documents_blocks_check check (jsonb_typeof(content_blocks) = 'array'),
  constraint issued_documents_fields_check check (jsonb_typeof(fields) = 'object'),
  constraint issued_documents_html_check check (char_length(content_html) between 1 and 200000),
  constraint issued_documents_void_reason_check check (
    voided_at is null or char_length(btrim(coalesce(void_reason, ''))) between 3 and 300
  )
);

comment on table public.issued_documents is
  'DOC-01/DOC-08: documento emitido desde una plantilla. Inmutable: solo se anula (voided_at, voided_by, void_reason). Se conserva con la ficha (Decreto 41).';

create index if not exists issued_documents_patient_idx
  on public.issued_documents (clinic_id, patient_id, issued_at desc);
create index if not exists issued_documents_patient_id_idx
  on public.issued_documents (patient_id);
create index if not exists issued_documents_template_version_idx
  on public.issued_documents (template_version_id);
create index if not exists issued_documents_template_idx
  on public.issued_documents (template_id) where template_id is not null;
create index if not exists issued_documents_professional_idx
  on public.issued_documents (professional_id) where professional_id is not null;

-- Lo que la base sabe mejor que el cliente: quién, cuándo, el correlativo,
-- los datos del profesional (y su firma), de la clínica y del paciente, y la
-- huella. El cliente no puede fechar hacia atrás, firmar por otro ni
-- inventar el número.
create or replace function public.issued_documents_emitir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof record;
  v_version record;
  v_clinic record;
  v_branch record;
  v_patient record;
begin
  if auth.uid() is null then
    raise exception 'Un documento lo emite un profesional con su propia cuenta.';
  end if;
  new.issued_by := auth.uid();
  new.issued_at := now();
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;

  select p.full_name, p.license_number, p.sis_registry_number, p.user_id, p.branch_id,
         p.signature_storage_path, p.signature_sha256, s.name as specialty
    into v_prof
    from public.professionals p
    left join public.specialties s on s.id = p.specialty_id
   where p.id = new.professional_id and p.clinic_id = new.clinic_id;
  if not found then
    raise exception 'Elige un profesional de esta clínica.';
  end if;
  if v_prof.user_id is distinct from auth.uid() then
    raise exception 'Solo puedes emitir documentos con tu propia ficha de profesional.';
  end if;
  if nullif(btrim(coalesce(v_prof.sis_registry_number, v_prof.license_number)), '') is null then
    raise exception 'Carga tu número de registro de la Superintendencia de Salud antes de emitir documentos.';
  end if;

  select v.id, v.template_id, v.title, t.kind, t.active
    into v_version
    from public.document_template_versions v
    join public.document_templates t on t.id = v.template_id
   where v.id = new.template_version_id and v.clinic_id = new.clinic_id;
  if not found then
    raise exception 'La plantilla no existe en esta clínica.';
  end if;

  select name, legal_name, tax_id, timezone into v_clinic
    from public.clinics where id = new.clinic_id;

  -- Dirección y teléfono: la sucursal del profesional, o la primera activa.
  select address, city, phone into v_branch
    from public.branches
   where clinic_id = new.clinic_id
   order by (id = v_prof.branch_id) desc, is_active desc, created_at
   limit 1;

  select full_name into v_patient
    from public.patients where id = new.patient_id and clinic_id = new.clinic_id;
  if not found then
    raise exception 'El paciente no pertenece a esta clínica.';
  end if;

  new.template_id := v_version.template_id;
  new.kind := v_version.kind;
  new.title := v_version.title;
  new.professional_name_snapshot := btrim(v_prof.full_name);
  new.professional_registry_snapshot := nullif(btrim(coalesce(v_prof.sis_registry_number, v_prof.license_number)), '');
  new.professional_specialty_snapshot := v_prof.specialty;
  new.signature_storage_path := v_prof.signature_storage_path;
  new.signature_sha256 := v_prof.signature_sha256;
  new.clinic_name_snapshot := v_clinic.name;
  new.clinic_legal_name_snapshot := v_clinic.legal_name;
  new.clinic_tax_id_snapshot := v_clinic.tax_id;
  new.clinic_address_snapshot := nullif(concat_ws(', ', nullif(btrim(v_branch.address), ''), nullif(btrim(v_branch.city), '')), '');
  new.clinic_phone_snapshot := nullif(btrim(v_branch.phone), '');
  new.patient_name_snapshot := v_patient.full_name;

  -- Año en la hora de la clínica, no en UTC.
  new.year := extract(year from now() at time zone coalesce(v_clinic.timezone, 'America/Santiago'))::integer;
  new.number := public.next_clinic_counter(new.clinic_id, 'document', new.year);

  -- Par exacto de src/lib/documentos/huella.ts.
  new.content_sha256 := encode(sha256(convert_to(
    new.content_html || chr(31) || coalesce(new.signature_sha256, ''),
    'UTF8'
  )), 'hex');
  return new;
end;
$$;

revoke execute on function public.issued_documents_emitir() from public, anon, authenticated;

drop trigger if exists issued_documents_emitir on public.issued_documents;
create trigger issued_documents_emitir
  before insert on public.issued_documents
  for each row execute function public.issued_documents_emitir();

-- DOC-08: lo único que cambia es la anulación (una vez, con motivo). Quién y
-- cuándo los pone la base.
create or replace function public.issued_documents_solo_anular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Las FKs con ON DELETE SET NULL (se borró la ficha del profesional o la
  -- plantilla): los snapshots conservan el dato. Pasa aunque esté anulado.
  if (to_jsonb(new) - array['professional_id', 'template_id'])
       = (to_jsonb(old) - array['professional_id', 'template_id'])
     and (new.professional_id is null or new.professional_id = old.professional_id)
     and (new.template_id is null or new.template_id = old.template_id)
     and (new.professional_id is distinct from old.professional_id
          or new.template_id is distinct from old.template_id)
  then
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'Este documento ya está anulado.' using errcode = '23514';
  end if;
  if (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
       is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason'])
     or new.voided_at is null
  then
    raise exception 'Un documento emitido no se edita: si hay un error, anúlalo con el motivo y emite otro.'
      using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(new.void_reason, ''))) < 3 then
    raise exception 'Escribe el motivo de la anulación.' using errcode = '23514';
  end if;
  if auth.uid() is not null
     and old.issued_by is distinct from auth.uid()
     and not public.can_manage_clinic(old.clinic_id)
  then
    raise exception 'Solo quien emitió el documento o un administrador puede anularlo.' using errcode = '42501';
  end if;
  new.void_reason := btrim(new.void_reason);
  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end;
$$;

revoke execute on function public.issued_documents_solo_anular() from public, anon, authenticated;

drop trigger if exists issued_documents_solo_anular on public.issued_documents;
create trigger issued_documents_solo_anular
  before update on public.issued_documents
  for each row execute function public.issued_documents_solo_anular();

drop trigger if exists block_demo_writes on public.issued_documents;
create trigger block_demo_writes
  before insert or update or delete on public.issued_documents
  for each row execute function public.block_demo_writes();

grant select, insert, update on public.issued_documents to authenticated;
-- Sin DELETE: un documento emitido es parte de la ficha. Se quita también el
-- permiso que dan por defecto los privilegios de Supabase.
revoke delete, truncate on public.issued_documents from anon, authenticated;
grant all on public.issued_documents to service_role;
alter table public.issued_documents enable row level security;

drop policy if exists issued_documents_select_clinicos on public.issued_documents;
create policy issued_documents_select_clinicos on public.issued_documents
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]));

-- Emitir es un acto del profesional: roles que firman, con su propia ficha
-- (lo exige el trigger).
drop policy if exists issued_documents_insert_profesionales on public.issued_documents;
create policy issued_documents_insert_profesionales on public.issued_documents
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[])
    and issued_by = (select auth.uid())
  );

-- El único UPDATE es anular; el trigger decide quién y qué columnas.
drop policy if exists issued_documents_update_anular on public.issued_documents;
create policy issued_documents_update_anular on public.issued_documents
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.issued_documents;
create policy mfa_exige_aal2 on public.issued_documents
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- Cómo revertir (no hay datos que migrar de vuelta; los documentos emitidos
-- se pierden con la tabla: hacer un backup antes si ya se emitió alguno):
--
-- begin;
-- drop policy if exists mfa_exige_aal2 on public.issued_documents;
-- drop table if exists public.issued_documents;
-- drop function if exists public.issued_documents_emitir();
-- drop function if exists public.issued_documents_solo_anular();
-- alter table public.document_templates drop constraint if exists document_templates_current_version_fk;
-- drop table if exists public.document_template_versions;
-- drop table if exists public.document_templates;
-- drop function if exists public.document_template_versions_numerar();
-- drop function if exists public.document_template_versions_vigente();
-- drop function if exists public.document_template_versions_inmutables();
-- drop function if exists public.document_templates_proteger();
-- drop policy if exists "professional_signatures_select" on storage.objects;
-- drop policy if exists "professional_signatures_insert" on storage.objects;
-- drop function if exists public.firma_es_de_mi_profesional(text);
-- (el bucket professional-signatures se vacía y borra desde el panel de Storage)
-- drop function if exists public.registrar_mi_firma(uuid, text, text, text);
-- drop trigger if exists professionals_firma_propia on public.professionals;
-- drop function if exists public.professionals_firma_propia();
-- alter table public.professionals
--   drop constraint if exists professionals_sis_registry_number_check,
--   drop column if exists signature_updated_at,
--   drop column if exists signature_sha256,
--   drop column if exists signature_storage_path,
--   drop column if exists sis_registry_number;
-- delete from public.clinic_counters where kind = 'document';
-- commit;
