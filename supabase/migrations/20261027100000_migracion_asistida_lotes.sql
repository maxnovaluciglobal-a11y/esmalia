-- Ola 6 · Migración asistida (1/2): lotes de importación y registros importados
-- (EXP-05, EXP-06, REC-06).
--
-- Una clínica que llega desde Dentalink (u otro sistema) trae exports de
-- pacientes y de citas. El asistente de Ajustes ("Traer datos de otro
-- sistema", ruta /migracion) importa cada archivo en un LOTE:
--
--   - `import_batches`: un lote por archivo importado. Guarda el tipo, el
--     perfil de columnas ("dentalink", "generico"), los conteos y el estado
--     (en_curso → completado → deshecho). Solo owner/admin lo ven y lo usan.
--   - `import_batch_changes`: cuando una fila de pacientes coincide con una
--     ficha que ya existía y la clínica eligió "completar campos vacíos", se
--     anota qué campos llenó el lote, para poder deshacerlo.
--   - Columnas `import_batch_id`, `imported_at`, `import_source`,
--     `import_external_id` e `import_original` (nullable) en patients y
--     appointments. Todo registro creado por un lote lleva su
--     `import_batch_id`; deshacer el lote borra exactamente esas filas
--     (migración 2/2). `import_original` guarda la fila tal como venía en el
--     archivo: es el "dato de origen" que se muestra con el sello "Importado
--     de <origen> el <fecha>" y que nadie edita (EXP-06).
--   - `appointments.reminders_muted` (REC-06): las citas importadas no
--     aparecen en Recordatorios salvo que el lote se haya importado con la
--     casilla "incluir en recordatorios" (o se active después desde el lote).
--
-- Reglas que pone la base (no la pantalla):
--
--   1. La marca de importación solo se pone al INSERTAR, dentro de un lote
--      `en_curso` de la misma clínica, y después no se edita. Así nadie puede
--      "marcar como importado" un registro propio para que una reversa lo
--      borre, ni reescribir el dato de origen.
--   2. Las citas importadas que ya habían pasado al importarlas son historial
--      del sistema anterior: no se editan ni se borran (EXP-06). Únicas
--      excepciones: el cambio de paciente de una fusión de fichas
--      (merge_patients) y la reversa del propio lote. Las fichas de paciente
--      importadas sí se completan y editan normalmente, y las citas futuras
--      importadas se pueden mover o cancelar. Una cita importada que ya
--      empezó entra siempre con un estado cerrado (finalizada, ausente o
--      cancelada): si venía sin estado o abierta, como finalizada. Así nunca
--      aparece en "citas pasadas sin cerrar" ni en su cierre en lote (PAN-05).
--
-- Compatible con el código en producción (RUNBOOK regla 3): tablas nuevas,
-- columnas nullable (o con default) y triggers que solo actúan sobre filas
-- con `import_batch_id`, que el código actual nunca escribe.
--
-- ⚠️ NO APLICADA. Requiere OK de Walter (regla 5 del CLAUDE.md del repo).

begin;

-- ─── 1. Lotes ───────────────────────────────────────────────────────────────

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  kind text not null check (kind in ('pacientes', 'citas')),
  -- Perfil de columnas usado: "dentalink", "generico". Se copia a cada fila
  -- importada (`import_source`) para mostrar "Importado de Dentalink".
  source text not null check (source ~ '^[a-z0-9_]{1,30}$'),
  file_name text check (file_name is null or char_length(file_name) <= 200),
  status text not null default 'en_curso'
    check (status in ('en_curso', 'completado', 'deshecho')),
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_created integer not null default 0 check (rows_created >= 0),
  rows_updated integer not null default 0 check (rows_updated >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  rows_failed integer not null default 0 check (rows_failed >= 0),
  -- Qué hacer con un paciente que ya existe (solo lotes de pacientes).
  duplicate_policy text
    check (duplicate_policy is null or duplicate_policy in ('omitir', 'completar')),
  -- REC-06: las citas de este lote ¿entran en Recordatorios? Por defecto no.
  -- Aunque sea true, nada sale solo: el staff despacha cada aviso a mano.
  include_in_reminders boolean not null default false,
  reminders_enabled_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reverted_at timestamptz,
  reverted_by uuid,
  unique (id, clinic_id),
  constraint import_batches_reversa_consistente check (
    (status = 'deshecho') = (reverted_at is not null)
  )
);

comment on table public.import_batches is
  'EXP-05: lote de una importación desde otro sistema (un archivo). Las filas creadas llevan import_batch_id; deshacer el lote las borra (migracion_deshacer_lote).';

create index import_batches_clinic_idx on public.import_batches (clinic_id, created_at desc);

-- Lo que identifica al lote no cambia, y el estado solo avanza:
-- en_curso → completado (lo cierra el asistente) y → deshecho (solo la
-- función de reversa, que se identifica con `esmalia.lote_en_reversa`).
-- `include_in_reminders` solo pasa de false a true con
-- migracion_activar_recordatorios (`esmalia.lote_avisos`).
create or replace function public.import_batches_transiciones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clinic_id is distinct from old.clinic_id
     or new.kind is distinct from old.kind
     or new.source is distinct from old.source
     or new.file_name is distinct from old.file_name
     or new.duplicate_policy is distinct from old.duplicate_policy
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Los datos de origen de un lote de importación no se editan.'
      using errcode = '23514';
  end if;
  if old.status = 'deshecho' then
    raise exception 'Este lote ya se deshizo.' using errcode = '23514';
  end if;
  if new.status = 'deshecho'
     and coalesce(current_setting('esmalia.lote_en_reversa', true), '') <> old.id::text then
    raise exception 'Un lote se deshace solo con la reversa.' using errcode = '23514';
  end if;
  if old.status = 'completado' and new.status = 'en_curso' then
    raise exception 'Un lote completado no se reabre.' using errcode = '23514';
  end if;
  if (new.include_in_reminders is distinct from old.include_in_reminders
      or new.reminders_enabled_at is distinct from old.reminders_enabled_at)
     and coalesce(current_setting('esmalia.lote_avisos', true), '') <> old.id::text then
    raise exception 'Los recordatorios de un lote se activan desde el asistente de migración.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.import_batches_transiciones() from public, anon;

create trigger import_batches_transiciones
  before update on public.import_batches
  for each row execute function public.import_batches_transiciones();

create trigger block_demo_writes
  before insert or update or delete on public.import_batches
  for each row execute function public.block_demo_writes();

alter table public.import_batches enable row level security;

-- Solo quien administra la clínica (owner/admin) importa y deshace. Sin
-- DELETE: un lote deshecho queda como registro de lo que pasó.
create policy import_batches_select on public.import_batches
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

create policy import_batches_insert on public.import_batches
  for insert to authenticated
  with check (
    public.can_manage_clinic(clinic_id)
    and created_by = (select auth.uid())
    and status = 'en_curso'
    and reverted_at is null
    and reminders_enabled_at is null
  );

create policy import_batches_update on public.import_batches
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists mfa_exige_aal2 on public.import_batches;
create policy mfa_exige_aal2 on public.import_batches
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 2. Campos completados en fichas existentes ────────────────────────────

create table public.import_batch_changes (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  -- {"phone": "+56912345678", "birth_date": "1980-03-01"}: los valores que el
  -- lote escribió en campos que estaban vacíos. La reversa los vuelve a vaciar
  -- solo si nadie los cambió después.
  campos jsonb not null check (jsonb_typeof(campos) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (batch_id, clinic_id)
    references public.import_batches(id, clinic_id) on delete cascade
);

comment on table public.import_batch_changes is
  'EXP-05: campos vacíos de una ficha existente que completó un lote de pacientes (política "completar"). La reversa los vuelve a vaciar si siguen iguales.';

create index import_batch_changes_batch_idx on public.import_batch_changes (batch_id);
create index import_batch_changes_patient_idx on public.import_batch_changes (patient_id);

create trigger block_demo_writes
  before insert or update or delete on public.import_batch_changes
  for each row execute function public.block_demo_writes();

alter table public.import_batch_changes enable row level security;

-- Sin UPDATE ni DELETE: lo escribe el importador y lo lee la reversa.
create policy import_batch_changes_select on public.import_batch_changes
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

create policy import_batch_changes_insert on public.import_batch_changes
  for insert to authenticated
  with check (
    public.can_manage_clinic(clinic_id)
    and exists (
      select 1 from public.import_batches b
       where b.id = batch_id and b.clinic_id = import_batch_changes.clinic_id
         and b.status = 'en_curso'
    )
    and exists (
      select 1 from public.patients p
       where p.id = patient_id and p.clinic_id = import_batch_changes.clinic_id
    )
  );

drop policy if exists mfa_exige_aal2 on public.import_batch_changes;
create policy mfa_exige_aal2 on public.import_batch_changes
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 3. Marca de importación en las tablas importables ─────────────────────

alter table public.patients
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete restrict,
  add column if not exists imported_at timestamptz,
  add column if not exists import_source text,
  add column if not exists import_external_id text
    check (import_external_id is null or char_length(import_external_id) <= 80),
  add column if not exists import_original jsonb
    check (import_original is null
           or (jsonb_typeof(import_original) = 'object' and pg_column_size(import_original) <= 8192));

alter table public.appointments
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete restrict,
  add column if not exists imported_at timestamptz,
  add column if not exists import_source text,
  add column if not exists import_external_id text
    check (import_external_id is null or char_length(import_external_id) <= 80),
  add column if not exists import_original jsonb
    check (import_original is null
           or (jsonb_typeof(import_original) = 'object' and pg_column_size(import_original) <= 8192)),
  add column if not exists reminders_muted boolean not null default false;

comment on column public.patients.import_batch_id is
  'EXP-05: lote que creó la ficha (null = creada en Esmalia). Lo pone la importación al insertar; no se edita.';
comment on column public.patients.import_external_id is
  'EXP-05: id del paciente en el sistema de origen (p. ej. Dentalink), para enlazar las citas del mismo export.';
comment on column public.patients.import_original is
  'EXP-06: la fila del archivo tal como venía del sistema de origen. Solo lectura.';
comment on column public.appointments.import_original is
  'EXP-06: la fila del archivo tal como venía del sistema de origen. Solo lectura.';
comment on column public.appointments.reminders_muted is
  'REC-06: true = cita importada que no entra en Recordatorios (el lote se importó sin la casilla). Solo la cambia migracion_activar_recordatorios.';

create index if not exists patients_import_batch_idx
  on public.patients (import_batch_id) where import_batch_id is not null;
create index if not exists patients_import_external_idx
  on public.patients (clinic_id, import_source, import_external_id)
  where import_external_id is not null;
create index if not exists appointments_import_batch_idx
  on public.appointments (import_batch_id) where import_batch_id is not null;

-- Regla 1: la marca solo nace al insertar, en un lote abierto de la misma
-- clínica, y no se edita. `imported_at`, `import_source` y (en citas)
-- `reminders_muted` los pone la base desde el lote.
create or replace function public.validar_marca_de_importacion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lote record;
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb;
begin
  if tg_op = 'UPDATE' then
    v_viejo := to_jsonb(old);
    if v_nuevo->'import_batch_id' is distinct from v_viejo->'import_batch_id'
       or v_nuevo->'imported_at' is distinct from v_viejo->'imported_at'
       or v_nuevo->'import_source' is distinct from v_viejo->'import_source'
       or v_nuevo->'import_external_id' is distinct from v_viejo->'import_external_id'
       or v_nuevo->'import_original' is distinct from v_viejo->'import_original' then
      raise exception 'La marca de importación de un registro no se edita.'
        using errcode = '23514';
    end if;
    if v_nuevo->'reminders_muted' is distinct from v_viejo->'reminders_muted'
       and coalesce(current_setting('esmalia.lote_avisos', true), '') <> coalesce(v_viejo->>'import_batch_id', '-') then
      raise exception 'Los recordatorios de una cita importada se activan desde el asistente de migración.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.import_batch_id is null then
    if new.imported_at is not null or new.import_source is not null
       or new.import_external_id is not null or new.import_original is not null
       or coalesce((v_nuevo->>'reminders_muted')::boolean, false) then
      raise exception 'Un registro sin lote no lleva marca de importación.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select b.clinic_id, b.status, b.source, b.kind, b.include_in_reminders
    into v_lote
    from public.import_batches b
   where b.id = new.import_batch_id;
  if v_lote.clinic_id is null or v_lote.clinic_id <> new.clinic_id then
    raise exception 'El lote de importación no es de esta clínica.' using errcode = '42501';
  end if;
  if v_lote.status <> 'en_curso' then
    raise exception 'El lote de importación ya está cerrado.' using errcode = '23514';
  end if;
  if (tg_table_name = 'patients' and v_lote.kind <> 'pacientes')
     or (tg_table_name = 'appointments' and v_lote.kind <> 'citas') then
    raise exception 'El lote de importación es de otro tipo.' using errcode = '23514';
  end if;

  new.imported_at := now();
  new.import_source := v_lote.source;
  if tg_table_name = 'appointments' then
    new := jsonb_populate_record(new, jsonb_build_object('reminders_muted', not v_lote.include_in_reminders));
    -- Una cita que ya empezó al importarla es historial de solo lectura
    -- (proteger_historial_importado): no puede quedar abierta, porque
    -- entonces aparecería en "citas pasadas sin cerrar" (PAN-05) y nadie
    -- podría cerrarla. Sin estado o con uno abierto, entra como atendida.
    if (v_nuevo->>'starts_at')::timestamptz < now()
       and v_nuevo->>'status' in ('tentativa', 'confirmada', 'en-sala') then
      new := jsonb_populate_record(new, jsonb_build_object('status', 'finalizada'));
    end if;
  end if;
  return new;
end;
$$;

comment on function public.validar_marca_de_importacion() is
  'EXP-05: la marca de importación solo se pone al insertar, en un lote en curso de la misma clínica y del mismo tipo, y no se edita.';

revoke execute on function public.validar_marca_de_importacion() from public, anon;

create trigger validar_marca_de_importacion
  before insert or update of import_batch_id, imported_at, import_source, import_external_id, import_original
  on public.patients
  for each row execute function public.validar_marca_de_importacion();
create trigger validar_marca_de_importacion
  before insert or update of import_batch_id, imported_at, import_source, import_external_id, import_original, reminders_muted
  on public.appointments
  for each row execute function public.validar_marca_de_importacion();

-- ─── 4. Historial de citas importado, de solo lectura (EXP-06) ─────────────

-- Una cita importada que ya había pasado cuando se importó es historial del
-- sistema anterior: no se edita ni se borra. Lo único que puede cambiar es el
-- paciente (fusión de fichas), `updated_at`/`updated_by` y `reminders_muted`
-- (activación de recordatorios del lote). La reversa del lote sí la borra.
create or replace function public.proteger_historial_importado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.import_batch_id is null
     or old.starts_at >= old.imported_at
     or coalesce(current_setting('esmalia.lote_en_reversa', true), '') = old.import_batch_id::text then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['patient_id', 'updated_at', 'updated_by', 'reminders_muted'])
         = (to_jsonb(old) - array['patient_id', 'updated_at', 'updated_by', 'reminders_muted']) then
    return new;
  end if;

  raise exception 'Esta cita se importó de otro sistema y es historial: no se edita ni se borra. Si está mal, deshaz el lote desde Migración de datos.'
    using errcode = '23514';
end;
$$;

comment on function public.proteger_historial_importado() is
  'EXP-06: las citas importadas que ya habían pasado al importarlas son de solo lectura (salvo el paciente, por la fusión de fichas). Solo la reversa del lote las borra.';

revoke execute on function public.proteger_historial_importado() from public, anon;

create trigger proteger_historial_importado
  before update or delete on public.appointments
  for each row execute function public.proteger_historial_importado();

commit;

-- ─── Cómo revertir ─────────────────────────────────────────────────────────
-- (Primero la reversa de 20261027100100.)
-- begin;
-- drop trigger if exists proteger_historial_importado on public.appointments;
-- drop function if exists public.proteger_historial_importado();
-- drop trigger if exists validar_marca_de_importacion on public.patients;
-- drop trigger if exists validar_marca_de_importacion on public.appointments;
-- drop function if exists public.validar_marca_de_importacion();
-- alter table public.patients drop column if exists import_batch_id, drop column if exists imported_at, drop column if exists import_source, drop column if exists import_external_id, drop column if exists import_original;
-- alter table public.appointments drop column if exists import_batch_id, drop column if exists imported_at, drop column if exists import_source, drop column if exists import_external_id, drop column if exists import_original, drop column if exists reminders_muted;
-- drop policy if exists mfa_exige_aal2 on public.import_batch_changes;
-- drop policy if exists mfa_exige_aal2 on public.import_batches;
-- drop table if exists public.import_batch_changes;
-- drop table if exists public.import_batches;
-- drop function if exists public.import_batches_transiciones();
-- commit;
-- ⚠️ Borrar las columnas pierde la marca de lo importado (los registros
-- quedan). Si ya se importaron datos reales, preferir dejar las columnas.
