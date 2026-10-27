-- Ola 13 · frente A (2/2): exámenes por tipo (IMG-01), sesiones de fotos y
-- antes/después (IMG-02) y su lugar en la ficha (FIC-17).
--
--   clinical_photo_sessions  sesión de fotos clínicas: fecha, motivo, etapa
--                            (antes/durante/después/control) y plan de
--                            tratamiento opcional.
--   patient_exams            un examen = un archivo: tipo, fecha, piezas FDI,
--                            profesional, nota y, si es foto clínica, su
--                            sesión. Metadatos del archivo (ruta, tipo MIME,
--                            tamaño, miniatura).
--
-- Archivos: bucket privado `clinical-exams` (200 MB por archivo como techo;
-- el límite real por tipo lo pone la base: 200 MB para CBCT/DICOM y
-- escaneos intraorales, 20 MB para el resto). Ruta
-- `<clinic_id>/<patient_id>/<exam_id>/<archivo>`. Nadie sube con su sesión:
-- el servidor reserva la fila (RLS + cupo), firma una URL de subida con el
-- service role y confirma el tamaño real al terminar. Leer: política de
-- storage por clínica y rol clínico (regla 2), con URLs firmadas cortas.
--
-- Cupo (bloqueo en servidor): el trigger rechaza una fila nueva (o un
-- tamaño confirmado mayor) si la clínica pasaría su cupo
-- (`cupo_de_almacenamiento_bytes`, migración 20261109100000). El uso cuenta
-- los exámenes (también los archivados y las subidas reservadas: el archivo
-- sigue ocupando lugar) y los documentos clínicos anteriores
-- (`patient_documents`).
--
-- Permisos (regla 2): solo owner/admin/dentist/assistant ven y cargan.
-- Recepción, contabilidad, coordinación y técnico dental no. Permiso por
-- persona: un "quitar historia clínica" (EQU-01) también se cumple acá.
--
-- Nunca se borra un examen ni una sesión (Decreto 41): se archivan con
-- motivo. Sin DELETE para authenticated; restaurar solo owner/admin. La
-- única fila que se borra es una subida que nunca se confirmó (la borra el
-- servidor con el service role al cancelar).
--
-- Lecturas (SEG-02): nueva sección 'examenes' en `clinical_access_log`.
--
-- Escribe datos solo en storage.buckets (crea el bucket, idempotente).
-- Redefine el CHECK de `clinical_access_log.section` (agrega 'examenes';
-- no quita ninguno). No redefine funciones existentes. Reversa al pie.

begin;

-- ── Piezas FDI ────────────────────────────────────────────────────────────
-- Permanentes 11-48 (cuadrante 1-4, pieza 1-8) y temporales 51-85
-- (cuadrante 5-8, pieza 1-5). Misma regla que `esPiezaFdi` de la app.
create or replace function public.es_lista_de_piezas_fdi(p_piezas smallint[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(array_length(p_piezas, 1), 0) <= 32
     and not exists (
       select 1 from unnest(p_piezas) t
        where t is null
           or not (
             (t / 10 between 1 and 4 and t % 10 between 1 and 8)
             or (t / 10 between 5 and 8 and t % 10 between 1 and 5)
           )
     );
$$;

-- ── Sesiones de fotos ─────────────────────────────────────────────────────
create table if not exists public.clinical_photo_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_date date not null,
  reason text not null,
  stage text,
  treatment_plan_id uuid references public.treatment_plans(id) on delete set null,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  constraint clinical_photo_sessions_reason_check check (char_length(btrim(reason)) between 2 and 200),
  constraint clinical_photo_sessions_stage_check check (
    stage is null or stage in ('antes', 'durante', 'despues', 'control')
  ),
  constraint clinical_photo_sessions_notes_check check (notes is null or char_length(notes) <= 1000),
  constraint clinical_photo_sessions_archivo_check check (
    (archived_at is null and archive_reason is null)
    or (
      archived_at is not null
      and archive_reason is not null
      and char_length(btrim(archive_reason)) between 3 and 500
    )
  )
);

create index if not exists clinical_photo_sessions_patient_idx
  on public.clinical_photo_sessions (clinic_id, patient_id, session_date desc);

comment on table public.clinical_photo_sessions is
  'IMG-02: sesiones de fotos clínicas (fecha, motivo, etapa, plan). Se archivan con motivo, no se borran.';

-- ── Exámenes ──────────────────────────────────────────────────────────────
create table if not exists public.patient_exams (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null,
  taken_on date not null,
  teeth smallint[] not null default '{}',
  professional_id uuid references public.professionals(id) on delete set null,
  -- Regla 10: el nombre del profesional tal como estaba al registrar.
  professional_name text,
  notes text,
  photo_session_id uuid references public.clinical_photo_sessions(id) on delete restrict,
  storage_path text not null,
  thumb_path text,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'pendiente',
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  constraint patient_exams_storage_path_key unique (storage_path),
  constraint patient_exams_kind_check check (
    kind in (
      'periapical', 'bite_wing', 'panoramica', 'telerradiografia', 'cbct_dicom',
      'escaneo_intraoral', 'foto_clinica', 'documento', 'otro'
    )
  ),
  constraint patient_exams_teeth_check check (public.es_lista_de_piezas_fdi(teeth)),
  constraint patient_exams_notes_check check (notes is null or char_length(notes) <= 1000),
  constraint patient_exams_filename_check check (char_length(btrim(filename)) between 1 and 200),
  constraint patient_exams_mime_check check (char_length(mime_type) between 3 and 120),
  constraint patient_exams_size_check check (size_bytes > 0),
  constraint patient_exams_status_check check (status in ('pendiente', 'listo')),
  constraint patient_exams_sesion_solo_fotos_check check (
    photo_session_id is null or kind = 'foto_clinica'
  ),
  constraint patient_exams_archivo_check check (
    (archived_at is null and archive_reason is null)
    or (
      archived_at is not null
      and archive_reason is not null
      and char_length(btrim(archive_reason)) between 3 and 500
    )
  )
);

create index if not exists patient_exams_patient_idx
  on public.patient_exams (clinic_id, patient_id, taken_on desc);
create index if not exists patient_exams_session_idx
  on public.patient_exams (photo_session_id) where photo_session_id is not null;
create index if not exists patient_exams_teeth_idx
  on public.patient_exams using gin (teeth);

comment on table public.patient_exams is
  'IMG-01/FIC-17: exámenes del paciente por tipo (radiografías, CBCT, escaneos, fotos, documentos). Un archivo por fila en el bucket clinical-exams. Se archivan con motivo, no se borran.';

-- ── Permisos de tabla ─────────────────────────────────────────────────────
revoke all on public.clinical_photo_sessions from anon, authenticated;
grant select, insert, update on public.clinical_photo_sessions to authenticated;
grant all on public.clinical_photo_sessions to service_role;
alter table public.clinical_photo_sessions enable row level security;

revoke all on public.patient_exams from anon, authenticated;
grant select, insert, update on public.patient_exams to authenticated;
grant all on public.patient_exams to service_role;
alter table public.patient_exams enable row level security;

-- Sesiones
drop policy if exists clinical_photo_sessions_select on public.clinical_photo_sessions;
create policy clinical_photo_sessions_select on public.clinical_photo_sessions
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists clinical_photo_sessions_insert on public.clinical_photo_sessions;
create policy clinical_photo_sessions_insert on public.clinical_photo_sessions
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.patients p
       where p.id = clinical_photo_sessions.patient_id and p.clinic_id = clinical_photo_sessions.clinic_id
    )
  );

drop policy if exists clinical_photo_sessions_update on public.clinical_photo_sessions;
create policy clinical_photo_sessions_update on public.clinical_photo_sessions
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

-- Exámenes
drop policy if exists patient_exams_select on public.patient_exams;
create policy patient_exams_select on public.patient_exams
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists patient_exams_insert on public.patient_exams;
create policy patient_exams_insert on public.patient_exams
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
    and uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.patients p
       where p.id = patient_exams.patient_id and p.clinic_id = patient_exams.clinic_id
    )
  );

drop policy if exists patient_exams_update on public.patient_exams;
create policy patient_exams_update on public.patient_exams
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

-- EQU-01: "quitar ver/escribir historia clínica" a una persona también vale acá.
drop policy if exists ajuste_quita_ver_historia on public.patient_exams;
create policy ajuste_quita_ver_historia on public.patient_exams
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_escribir_historia_insert on public.patient_exams;
create policy ajuste_quita_escribir_historia_insert on public.patient_exams
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_update on public.patient_exams;
create policy ajuste_quita_escribir_historia_update on public.patient_exams
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:write'))
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_ver_historia on public.clinical_photo_sessions;
create policy ajuste_quita_ver_historia on public.clinical_photo_sessions
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_photo_sessions;
create policy ajuste_quita_escribir_historia_insert on public.clinical_photo_sessions
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_update on public.clinical_photo_sessions;
create policy ajuste_quita_escribir_historia_update on public.clinical_photo_sessions
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:write'))
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists mfa_exige_aal2 on public.clinical_photo_sessions;
create policy mfa_exige_aal2 on public.clinical_photo_sessions
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.patient_exams;
create policy mfa_exige_aal2 on public.patient_exams
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ── Cupo ──────────────────────────────────────────────────────────────────
-- Límite por archivo según el tipo. Espejo de LIMITE_POR_ARCHIVO en
-- src/lib/examenes/tipos.ts (tests/examenes-cupo.test.ts los compara).
create or replace function public.limite_por_archivo_de_examen(p_kind text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('cbct_dicom', 'escaneo_intraoral') then 209715200::bigint -- 200 MB
    else 20971520::bigint                                                     -- 20 MB
  end;
$$;

-- Bytes ocupados por la clínica: exámenes (todos: listos, reservados y
-- archivados) + documentos clínicos anteriores.
create or replace function public.bytes_usados_por_la_clinica(p_clinic_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(size_bytes) from public.patient_exams where clinic_id = p_clinic_id), 0)::bigint
       + coalesce((select sum(size_bytes) from public.patient_documents where clinic_id = p_clinic_id), 0)::bigint;
$$;

revoke all on function public.bytes_usados_por_la_clinica(uuid) from public, anon, authenticated;
grant execute on function public.bytes_usados_por_la_clinica(uuid) to service_role;

-- Uso y cupo para la pantalla (Ajustes y el diálogo de subida). Cualquier
-- integrante de la clínica lo puede ver: son números, sin datos de pacientes.
create or replace function public.uso_de_almacenamiento(p_clinic_id uuid)
returns table (
  usado_bytes bigint,
  cupo_bytes bigint,
  plan text,
  examenes_bytes bigint,
  documentos_bytes bigint,
  examenes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_clinic_member(p_clinic_id) then
    raise exception 'No tienes permisos para ver el almacenamiento de esta clínica.'
      using errcode = '42501';
  end if;
  return query
  select public.bytes_usados_por_la_clinica(p_clinic_id),
         public.cupo_de_almacenamiento_bytes(p_clinic_id),
         public.plan_de_almacenamiento(p_clinic_id),
         coalesce((select sum(e.size_bytes) from public.patient_exams e where e.clinic_id = p_clinic_id), 0)::bigint,
         coalesce((select sum(d.size_bytes) from public.patient_documents d where d.clinic_id = p_clinic_id), 0)::bigint,
         (select count(*) from public.patient_exams e where e.clinic_id = p_clinic_id and e.status = 'listo')::integer;
end;
$$;

revoke all on function public.uso_de_almacenamiento(uuid) from public, anon;
grant execute on function public.uso_de_almacenamiento(uuid) to authenticated, service_role;

-- ── Reglas de los exámenes ────────────────────────────────────────────────
-- "Sistema" = sin usuario (service role, cascadas, tests): es el servidor
-- confirmando el tamaño real o cancelando una subida.
create or replace function public.validar_examen_clinico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sistema boolean := auth.uid() is null;
  v_nombre text;
  v_usado bigint;
  v_cupo bigint;
  v_limite bigint;
  v_extra bigint := 0;
begin
  if tg_op = 'INSERT' then
    if not v_sistema then
      new.uploaded_by := v_uid;
      new.status := 'pendiente';
      new.confirmed_at := null;
      new.thumb_path := null;
      new.archived_at := null;
      new.archived_by := null;
      new.archive_reason := null;
    end if;
    new.created_at := now();
    if new.storage_path not like new.clinic_id::text || '/' || new.patient_id::text || '/%'
       or new.storage_path like '%..%' then
      raise exception 'La ruta del archivo no corresponde a esta clínica y paciente.'
        using errcode = '42501';
    end if;
    v_extra := new.size_bytes;
  else
    if new.clinic_id is distinct from old.clinic_id
       or new.patient_id is distinct from old.patient_id
       or new.storage_path is distinct from old.storage_path
       or new.uploaded_by is distinct from old.uploaded_by then
      raise exception 'La clínica, el paciente, el archivo y quién lo subió no se cambian.'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;

    if not v_sistema then
      -- Lo que describe el archivo lo fija el servidor al confirmar.
      new.size_bytes := old.size_bytes;
      new.mime_type := old.mime_type;
      new.filename := old.filename;
      new.status := old.status;
      new.confirmed_at := old.confirmed_at;
      new.thumb_path := old.thumb_path;

      if old.archived_at is not null and new.archived_at is not null then
        raise exception 'Un examen archivado no se edita: restáuralo primero.'
          using errcode = '42501';
      elsif old.archived_at is null and new.archived_at is not null then
        new.archived_at := now();
        new.archived_by := v_uid;
      elsif old.archived_at is not null and new.archived_at is null then
        if not public.has_clinic_role(new.clinic_id, array['owner','admin']::public.app_role[]) then
          raise exception 'Solo owner o admin restauran un examen archivado.'
            using errcode = '42501';
        end if;
        new.archived_by := null;
        new.archive_reason := null;
      end if;
    end if;

    if new.size_bytes > old.size_bytes then
      v_extra := new.size_bytes - old.size_bytes;
    end if;
  end if;

  -- Límite por archivo según el tipo.
  v_limite := public.limite_por_archivo_de_examen(new.kind);
  if new.size_bytes > v_limite then
    raise exception 'El archivo supera el máximo de % MB para este tipo de examen.',
      v_limite / 1048576
      using errcode = 'ES002';
  end if;

  -- Profesional de la clínica, con su nombre como snapshot.
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
    new.professional_name := coalesce(new.professional_name, old.professional_name);
  end if;

  -- La sesión de fotos tiene que ser del mismo paciente y estar vigente.
  if new.photo_session_id is not null
     and (tg_op = 'INSERT' or new.photo_session_id is distinct from old.photo_session_id) then
    if not exists (
      select 1 from public.clinical_photo_sessions s
       where s.id = new.photo_session_id
         and s.clinic_id = new.clinic_id
         and s.patient_id = new.patient_id
         and s.archived_at is null
    ) then
      raise exception 'La sesión de fotos no es de este paciente o está archivada.'
        using errcode = '42501';
    end if;
  end if;

  -- Cupo de la clínica (bloqueo al 100 % en el servidor). El candado por
  -- clínica evita que dos subidas simultáneas pasen las dos el chequeo.
  if v_extra > 0 then
    perform pg_advisory_xact_lock(hashtextextended('cupo-almacenamiento:' || new.clinic_id::text, 0));
    v_usado := public.bytes_usados_por_la_clinica(new.clinic_id);
    v_cupo := public.cupo_de_almacenamiento_bytes(new.clinic_id);
    if v_usado + v_extra > v_cupo then
      raise exception 'La clínica llegó al 100 %% de su almacenamiento. Archivar no libera espacio: escríbenos para ampliar el cupo.'
        using errcode = 'ES001';
    end if;
  end if;

  new.teeth := coalesce(
    (select array_agg(distinct t order by t) from unnest(new.teeth) t),
    '{}'::smallint[]
  );
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validar_examen_clinico() from public, anon, authenticated;

drop trigger if exists patient_exams_validar on public.patient_exams;
create trigger patient_exams_validar
  before insert or update on public.patient_exams
  for each row execute function public.validar_examen_clinico();

-- Nadie con sesión borra un examen (además de no tener el permiso): solo el
-- servidor, para una subida que nunca se confirmó, y las cascadas de una
-- clínica que se elimina.
create or replace function public.examen_no_se_borra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'Un examen no se borra: se archiva con motivo.' using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.examen_no_se_borra() from public, anon, authenticated;

drop trigger if exists patient_exams_no_se_borra on public.patient_exams;
create trigger patient_exams_no_se_borra
  before delete on public.patient_exams
  for each row execute function public.examen_no_se_borra();

drop trigger if exists clinical_photo_sessions_no_se_borra on public.clinical_photo_sessions;
create trigger clinical_photo_sessions_no_se_borra
  before delete on public.clinical_photo_sessions
  for each row execute function public.examen_no_se_borra();

-- ── Reglas de las sesiones ────────────────────────────────────────────────
create or replace function public.validar_sesion_de_fotos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
      new.archived_at := null;
      new.archived_by := null;
      new.archive_reason := null;
    end if;
    new.created_at := now();
  else
    if new.clinic_id is distinct from old.clinic_id
       or new.patient_id is distinct from old.patient_id
       or new.created_by is distinct from old.created_by then
      raise exception 'La clínica, el paciente y quién creó la sesión no se cambian.'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    if v_uid is not null then
      if old.archived_at is not null and new.archived_at is not null then
        raise exception 'Una sesión archivada no se edita: restáurala primero.'
          using errcode = '42501';
      elsif old.archived_at is null and new.archived_at is not null then
        new.archived_at := now();
        new.archived_by := v_uid;
      elsif old.archived_at is not null and new.archived_at is null then
        if not public.has_clinic_role(new.clinic_id, array['owner','admin']::public.app_role[]) then
          raise exception 'Solo owner o admin restauran una sesión archivada.'
            using errcode = '42501';
        end if;
        new.archived_by := null;
        new.archive_reason := null;
      end if;
    end if;
  end if;

  if new.treatment_plan_id is not null
     and (tg_op = 'INSERT' or new.treatment_plan_id is distinct from old.treatment_plan_id) then
    if not exists (
      select 1 from public.treatment_plans t
       where t.id = new.treatment_plan_id
         and t.clinic_id = new.clinic_id
         and t.patient_id = new.patient_id
    ) then
      raise exception 'El plan de tratamiento no es de este paciente.' using errcode = '42501';
    end if;
  end if;

  new.reason := btrim(new.reason);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validar_sesion_de_fotos() from public, anon, authenticated;

drop trigger if exists clinical_photo_sessions_validar on public.clinical_photo_sessions;
create trigger clinical_photo_sessions_validar
  before insert or update on public.clinical_photo_sessions
  for each row execute function public.validar_sesion_de_fotos();

-- La demo es de solo lectura.
drop trigger if exists block_demo_writes on public.clinical_photo_sessions;
create trigger block_demo_writes
  before insert or update or delete on public.clinical_photo_sessions
  for each row execute function public.block_demo_writes();

drop trigger if exists block_demo_writes on public.patient_exams;
create trigger block_demo_writes
  before insert or update or delete on public.patient_exams
  for each row execute function public.block_demo_writes();

-- ── Storage: bucket privado de exámenes ───────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-exams',
  'clinical-exams',
  false,
  209715200, -- 200 MB (techo; el límite por tipo lo pone patient_exams)
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'application/dicom', 'application/zip', 'application/x-zip-compressed',
    'model/stl', 'model/obj', 'model/ply', 'application/sla', 'application/vnd.ms-pki.stl',
    'text/plain', 'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- Leer (y firmar URLs de lectura): rol clínico de la clínica dueña de la
-- carpeta. Sin INSERT/UPDATE/DELETE para authenticated: sube el servidor con
-- URLs firmadas de subida, y un examen no se reemplaza ni se borra.
drop policy if exists clinical_exams_select on storage.objects;
create policy clinical_exams_select on storage.objects
  for select to authenticated using (
    bucket_id = 'clinical-exams'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.has_clinic_role(
      public.storage_clinic_id_of(name),
      array['owner','admin','dentist','assistant']::public.app_role[]
    )
    and not public.permiso_quitado(public.storage_clinic_id_of(name), 'clinical:view')
  );

drop policy if exists mfa_exige_aal2_clinical_exams on storage.objects;
create policy mfa_exige_aal2_clinical_exams on storage.objects
  as restrictive
  for all
  to authenticated
  using (bucket_id <> 'clinical-exams' or (select public.sesion_cumple_mfa()))
  with check (bucket_id <> 'clinical-exams' or (select public.sesion_cumple_mfa()));

-- ── Lecturas de la ficha: sección 'examenes' ──────────────────────────────
alter table public.clinical_access_log drop constraint if exists clinical_access_log_section_check;
alter table public.clinical_access_log add constraint clinical_access_log_section_check CHECK (
  section IN ('datos', 'notas', 'odontograma', 'periodontograma', 'anamnesis', 'documentos', 'examenes')
);

commit;

-- ── Reversa ───────────────────────────────────────────────────────────────
-- (hacer antes un backup si ya hay exámenes; los archivos del bucket quedan
-- en Storage hasta vaciarlo desde el panel)
-- alter table public.clinical_access_log drop constraint if exists clinical_access_log_section_check;
-- alter table public.clinical_access_log add constraint clinical_access_log_section_check CHECK (
--   section IN ('datos', 'notas', 'odontograma', 'periodontograma', 'anamnesis', 'documentos'));
--   (falla si ya hay lecturas 'examenes': borrarlas antes no es aceptable, dejar el CHECK ampliado)
-- drop policy if exists mfa_exige_aal2_clinical_exams on storage.objects;
-- drop policy if exists clinical_exams_select on storage.objects;
-- delete from storage.buckets where id = 'clinical-exams';  -- solo con el bucket vacío
-- drop trigger if exists block_demo_writes on public.patient_exams;
-- drop trigger if exists block_demo_writes on public.clinical_photo_sessions;
-- drop trigger if exists clinical_photo_sessions_validar on public.clinical_photo_sessions;
-- drop trigger if exists clinical_photo_sessions_no_se_borra on public.clinical_photo_sessions;
-- drop trigger if exists patient_exams_no_se_borra on public.patient_exams;
-- drop trigger if exists patient_exams_validar on public.patient_exams;
-- drop function if exists public.validar_sesion_de_fotos();
-- drop function if exists public.examen_no_se_borra();
-- drop function if exists public.validar_examen_clinico();
-- drop function if exists public.uso_de_almacenamiento(uuid);
-- drop function if exists public.bytes_usados_por_la_clinica(uuid);
-- drop function if exists public.limite_por_archivo_de_examen(text);
-- drop policy if exists mfa_exige_aal2 on public.patient_exams;
-- drop policy if exists mfa_exige_aal2 on public.clinical_photo_sessions;
-- drop table if exists public.patient_exams;
-- drop table if exists public.clinical_photo_sessions;
-- drop function if exists public.es_lista_de_piezas_fdi(smallint[]);
