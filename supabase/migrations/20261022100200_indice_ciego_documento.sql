-- Ola 1 · PAC-03: buscar pacientes por RUT con un índice ciego (blind index).
-- "12.345.678-5" y "123456785" encuentran la misma ficha, y el hash nunca
-- llega al cliente.
--
-- Por qué una tabla aparte y no una columna en patients: PostgREST deja leer
-- cualquier columna de patients a quien puede leer la fila (la app pide
-- columnas puntuales, pero el JWT vive en el navegador y se puede llamar
-- /rest/v1/patients?select=* a mano). Esconder una columna exigiría quitar el
-- SELECT de la tabla entera y darlo columna por columna, lo que rompe el
-- código en producción. patient_document_bidx tiene RLS activa y NINGUNA
-- política: solo la leen las funciones SECURITY DEFINER de abajo.
--
-- La clave: se reusa la de Vault `esmalia_document_id_key` (la misma del
-- cifrado del documento, migración 20261019160100). Esta migración NO crea
-- secretos. Para no usar la misma clave en dos funciones distintas, el
-- índice usa una subclave derivada:
--
--   subclave = hex(HMAC-SHA256(clave, 'esmalia/document_bidx/v1'))
--   document_bidx = hex(HMAC-SHA256(subclave, normalizado))
--
-- (separación de dominio estándar: conocer un document_bidx no dice nada del
-- `document_id_hash` existente, que usa la clave directa y otra
-- normalización). Rotar la clave = recalcular este índice con el backfill.
--
-- Normalización (par de normalizarDocumento en src/lib/patients/rut.ts):
-- solo letras y dígitos, en mayúscula. "12.345.678-k" → "12345678K".
--
-- Sin clave en Vault (base de tests, ensayo de restauración): todo queda en
-- no-op. indice_ciego_documento devuelve NULL, el trigger no escribe y el
-- backfill se saltea con un NOTICE, igual que el backfill del cifrado.
--
-- Duplicados: el índice NO es único. Puede haber fichas repetidas cargadas
-- antes (importaciones, altas a mano); un UNIQUE haría fallar esta
-- migración o un alta legítima. La app avisa al crear y ofrece fusionar.
--
-- Reversa al pie.

begin;

-- Tabla ----------------------------------------------------------------------

create table if not exists public.patient_document_bidx (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  document_bidx text not null,
  updated_at timestamptz not null default now()
);

comment on table public.patient_document_bidx is
  'PAC-03: índice ciego (HMAC-SHA256 con subclave derivada de Vault) del documento normalizado. RLS sin políticas: solo lo leen buscar_pacientes_por_documento y el trigger.';

create index if not exists patient_document_bidx_busqueda_idx
  on public.patient_document_bidx (clinic_id, document_bidx);

alter table public.patient_document_bidx enable row level security;
-- Sin políticas a propósito (fail-closed), y sin privilegios para la API.
revoke all on table public.patient_document_bidx from anon, authenticated;

-- Funciones ------------------------------------------------------------------

create or replace function public.normalizar_documento(p_documento text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_documento, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

comment on function public.normalizar_documento(text) is
  'PAC-03: documento sin puntos, guiones ni espacios y en mayúscula. Par de normalizarDocumento (src/lib/patients/rut.ts).';

create or replace function public.indice_ciego_documento(p_documento text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, vault
as $$
declare
  v_norm text;
  v_key text;
begin
  v_norm := public.normalizar_documento(p_documento);
  if v_norm is null then
    return null;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'esmalia_document_id_key';
  if v_key is null then
    return null; -- base sin clave: no hay índice
  end if;

  return encode(
    hmac(v_norm, encode(hmac('esmalia/document_bidx/v1', v_key, 'sha256'), 'hex'), 'sha256'),
    'hex'
  );
end;
$$;

-- Interna: sería un oráculo para calcular el índice de un RUT adivinado.
revoke all on function public.indice_ciego_documento(text) from public, anon, authenticated;
grant execute on function public.indice_ciego_documento(text) to service_role;

-- Trigger: mantiene el índice al crear o cambiar el documento ----------------

create or replace function public.patients_actualizar_indice_ciego()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bidx text;
begin
  if tg_op = 'UPDATE' and new.document_id is not distinct from old.document_id then
    return null;
  end if;

  begin
    v_bidx := public.indice_ciego_documento(new.document_id);
  exception when others then
    -- Nunca bloquea un alta ni una edición por el índice.
    raise warning 'patients_actualizar_indice_ciego: % (paciente %)', sqlerrm, new.id;
    v_bidx := null;
  end;

  if v_bidx is null then
    delete from public.patient_document_bidx where patient_id = new.id;
  else
    insert into public.patient_document_bidx (patient_id, clinic_id, document_bidx, updated_at)
    values (new.id, new.clinic_id, v_bidx, now())
    on conflict (patient_id) do update
      set document_bidx = excluded.document_bidx,
          clinic_id = excluded.clinic_id,
          updated_at = now();
  end if;
  return null;
end;
$$;

revoke all on function public.patients_actualizar_indice_ciego() from public, anon, authenticated;

drop trigger if exists patients_actualizar_indice_ciego on public.patients;
create trigger patients_actualizar_indice_ciego
  after insert or update of document_id on public.patients
  for each row execute function public.patients_actualizar_indice_ciego();

-- RPC de búsqueda --------------------------------------------------------------

create or replace function public.buscar_pacientes_por_documento(
  p_clinic_id uuid,
  p_documento text
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bidx text;
  v_mfa_ok boolean;
begin
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  -- Dinámico: funciona igual si la función de aal2 todavía no existe.
  if to_regprocedure('public.sesion_cumple_mfa()') is not null then
    execute 'select public.sesion_cumple_mfa()' into v_mfa_ok;
    if not coalesce(v_mfa_ok, false) then
      raise exception 'Se requiere verificación en dos pasos.' using errcode = '42501';
    end if;
  end if;

  if not public.is_clinic_member(p_clinic_id) then
    raise exception 'No tienes permisos para buscar pacientes en esta clínica.' using errcode = '42501';
  end if;

  v_bidx := public.indice_ciego_documento(p_documento);
  if v_bidx is null then
    return;
  end if;

  -- Solo ids: los datos del paciente se leen después con la RLS de patients.
  return query
    select b.patient_id
      from public.patient_document_bidx b
     where b.clinic_id = p_clinic_id
       and b.document_bidx = v_bidx
     order by b.patient_id
     limit 20;
end;
$$;

comment on function public.buscar_pacientes_por_documento(uuid, text) is
  'PAC-03: ids de los pacientes de la clínica con ese documento (cualquier formato), por el índice ciego. Nunca devuelve el hash.';

revoke execute on function public.buscar_pacientes_por_documento(uuid, text) from public, anon;
grant execute on function public.buscar_pacientes_por_documento(uuid, text) to authenticated, service_role;

-- Backfill + verificación -----------------------------------------------------

do $$
declare
  v_key text;
  v_filas integer;
  v_faltan integer;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'esmalia_document_id_key';

  if v_key is null then
    raise notice 'Sin esmalia_document_id_key en Vault: índice ciego salteado (base sin clave).';
    return;
  end if;

  insert into public.patient_document_bidx (patient_id, clinic_id, document_bidx, updated_at)
  select p.id, p.clinic_id, public.indice_ciego_documento(p.document_id), now()
    from public.patients p
   where public.normalizar_documento(p.document_id) is not null
  on conflict (patient_id) do update
    set document_bidx = excluded.document_bidx,
        clinic_id = excluded.clinic_id,
        updated_at = now();
  get diagnostics v_filas = row_count;

  select count(*) into v_faltan
    from public.patients p
   where public.normalizar_documento(p.document_id) is not null
     and not exists (
       select 1 from public.patient_document_bidx b where b.patient_id = p.id
     );
  if v_faltan > 0 then
    raise exception 'Índice ciego incompleto: % pacientes con documento sin índice.', v_faltan;
  end if;

  raise notice 'Índice ciego de documentos: % filas.', v_filas;
end
$$;

commit;

-- Cómo revertir (en una migración correctiva, ver el PR):
-- begin;
-- drop trigger if exists patients_actualizar_indice_ciego on public.patients;
-- drop function if exists public.patients_actualizar_indice_ciego();
-- drop function if exists public.buscar_pacientes_por_documento(uuid, text);
-- drop function if exists public.indice_ciego_documento(text);
-- drop function if exists public.normalizar_documento(text);
-- drop table if exists public.patient_document_bidx;
-- commit;
