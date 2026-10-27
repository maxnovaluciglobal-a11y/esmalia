-- Ola 6 · Migración asistida (2/2): funciones de la importación por lotes
-- (EXP-05).
--
--   - `normalizar_nombre_persona(text)`: minúsculas, sin tildes y con un solo
--     espacio. Par de `normalizarNombrePersona` (src/lib/migracion/normalizar.ts).
--   - `migracion_buscar_pacientes(clinica, refs, fuente)`: para cada
--     referencia de un archivo (id externo, documento, nombre y fecha de
--     nacimiento) devuelve las fichas de la clínica que coinciden. El
--     documento se busca por el índice ciego (o normalizado si la base no
--     tiene clave en Vault). SECURITY DEFINER porque el índice ciego no tiene
--     políticas; devuelve solo ids.
--   - `migracion_importar_bloque(lote, filas)`: escribe un bloque de filas ya
--     normalizadas y resueltas por el servidor. SECURITY INVOKER: corre con la
--     RLS de quien importa (owner/admin), y cada fila va en su propio
--     subbloque, así una fila con error no tumba el resto del bloque. Cada
--     llamada es una transacción.
--   - `migracion_bloqueos_de_lote(lote)`: lo que impide deshacer el lote
--     (actividad posterior sobre lo importado), como (tabla importada, tabla
--     que la usa, cantidad). Se calcula con las FKs del catálogo, así una
--     tabla nueva que apunte a pacientes queda cubierta sin tocar esto.
--   - `migracion_deshacer_lote(lote)`: borra todo lo que creó el lote y
--     vacía los campos que completó, si nada lo usó después.
--
-- Todas exigen owner/admin de la clínica del lote y, a quien activó MFA, una
-- sesión aal2. Las SECURITY DEFINER revocan EXECUTE a PUBLIC y anon.
--
-- ⚠️ NO APLICADA. Requiere OK de Walter (regla 5 del CLAUDE.md del repo).

begin;

-- ─── Nombre de persona normalizado ─────────────────────────────────────────

create or replace function public.normalizar_nombre_persona(p_nombre text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      lower(translate(
        coalesce(p_nombre, ''),
        'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'
      )),
      '\s+', ' ', 'g'
    )),
    ''
  )
$$;

comment on function public.normalizar_nombre_persona(text) is
  'EXP-05: nombre en minúsculas, sin tildes y con un solo espacio, para detectar duplicados por nombre y fecha de nacimiento. Par de normalizarNombrePersona (src/lib/migracion/normalizar.ts).';

-- ─── Guardas comunes ───────────────────────────────────────────────────────

create or replace function public.migracion_exigir_gestion(p_clinic_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
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
  if p_clinic_id is null or not public.can_manage_clinic(p_clinic_id) then
    raise exception 'No tienes permisos para importar datos en esta clínica.' using errcode = '42501';
  end if;
end;
$$;

comment on function public.migracion_exigir_gestion(uuid) is
  'EXP-05: corta si quien llama no es owner/admin de la clínica o si tiene MFA y la sesión no es aal2.';

revoke execute on function public.migracion_exigir_gestion(uuid) from public, anon;
grant execute on function public.migracion_exigir_gestion(uuid) to authenticated, service_role;

-- ─── Búsqueda de fichas para duplicados y referencias ──────────────────────

-- p_refs: [{"i": 1, "externo": "123", "documento": "12.345.678-5",
--           "nombre": "Ana Pérez", "nacimiento": "1980-03-01"}, ...]
-- Devuelve una fila por coincidencia: (i, patient_id, via). `via`:
--   'externo'          → mismo id del sistema de origen (import_external_id)
--   'documento'        → mismo documento
--   'nombre_nacimiento'→ mismo nombre normalizado y misma fecha de nacimiento
--   'nombre'           → solo el nombre (si p_por_nombre)
-- Las fichas fusionadas en otra no cuentan (su historia ya vive en la otra).
create or replace function public.migracion_buscar_pacientes(
  p_clinic_id uuid,
  p_refs jsonb,
  p_fuente text default null,
  p_por_nombre boolean default false
)
returns table (i integer, patient_id uuid, via text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_con_clave boolean;
begin
  perform public.migracion_exigir_gestion(p_clinic_id);
  if jsonb_typeof(p_refs) is distinct from 'array' then
    raise exception 'Referencias inválidas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_refs) > 1000 then
    raise exception 'Demasiadas referencias en una sola búsqueda (máximo 1000).' using errcode = '22023';
  end if;

  v_con_clave := exists (
    select 1 from vault.decrypted_secrets where name = 'esmalia_document_id_key'
  );

  return query
  with refs as (
    select r.i, nullif(btrim(r.externo), '') as externo,
           public.normalizar_documento(r.documento) as doc,
           case when v_con_clave then public.indice_ciego_documento(r.documento) end as bidx,
           public.normalizar_nombre_persona(r.nombre) as nombre,
           r.nacimiento
      from jsonb_to_recordset(p_refs)
        as r(i integer, externo text, documento text, nombre text, nacimiento date)
  ),
  vivos as (
    select p.id, p.import_external_id, p.import_source, p.document_id, p.birth_date,
           public.normalizar_nombre_persona(p.full_name) as nombre
      from public.patients p
     where p.clinic_id = p_clinic_id
       and p.merged_into is null
  )
  select r.i, v.id, 'externo'::text
    from refs r
    join vivos v on v.import_external_id = r.externo
                and v.import_source is not distinct from p_fuente
   where r.externo is not null
  union
  select r.i, b.patient_id, 'documento'::text
    from refs r
    join public.patient_document_bidx b
      on v_con_clave and b.clinic_id = p_clinic_id and b.document_bidx = r.bidx
    join vivos v on v.id = b.patient_id
   where r.bidx is not null
  union
  select r.i, v.id, 'documento'::text
    from refs r
    join vivos v on not v_con_clave and public.normalizar_documento(v.document_id) = r.doc
   where r.doc is not null
  union
  select r.i, v.id, 'nombre_nacimiento'::text
    from refs r
    join vivos v on v.nombre = r.nombre and v.birth_date = r.nacimiento
   where r.nombre is not null and r.nacimiento is not null
  union
  select r.i, v.id, 'nombre'::text
    from refs r
    join vivos v on p_por_nombre and v.nombre = r.nombre
   where r.nombre is not null;
end;
$$;

comment on function public.migracion_buscar_pacientes(uuid, jsonb, text, boolean) is
  'EXP-05: fichas de la clínica que coinciden con cada referencia de un archivo importado (id externo, documento por índice ciego, nombre + nacimiento). Devuelve solo ids.';

revoke execute on function public.migracion_buscar_pacientes(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.migracion_buscar_pacientes(uuid, jsonb, text, boolean) to authenticated, service_role;

-- ─── Escribir un bloque ────────────────────────────────────────────────────

-- SECURITY INVOKER: las inserciones pasan por la RLS de quien importa. Las
-- filas llegan normalizadas y con los ids resueltos por el servidor; acá se
-- vuelve a verificar que cada id sea de la clínica del lote.
create or replace function public.migracion_importar_bloque(p_batch_id uuid, p_filas jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lote record;
  v_fila jsonb;
  v_res jsonb := '[]'::jsonb;
  v_id uuid;
  v_accion text;
  v_mensaje text;
  v_creados integer := 0;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
  v_fallidos integer := 0;
  v_campos jsonb;
  v_pac record;
  v_original jsonb;
begin
  select b.id, b.clinic_id, b.kind, b.source, b.status
    into v_lote
    from public.import_batches b
   where b.id = p_batch_id;
  if not found then
    raise exception 'No encontramos el lote de importación.' using errcode = '42501';
  end if;
  perform public.migracion_exigir_gestion(v_lote.clinic_id);
  if v_lote.status <> 'en_curso' then
    raise exception 'El lote de importación ya está cerrado.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 500 then
    raise exception 'Bloque inválido (máximo 500 filas).' using errcode = '22023';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    v_id := null;
    v_accion := 'creado';
    v_mensaje := null;
    v_original := case when jsonb_typeof(v_fila->'original') = 'object' then v_fila->'original' end;
    begin
      -- ── Pacientes ──
      if v_lote.kind = 'pacientes' then
        if v_fila->>'accion' = 'completar' then
          select p.* into v_pac
            from public.patients p
           where p.id = (v_fila->>'patient_id')::uuid
             and p.clinic_id = v_lote.clinic_id
           for update;
          if not found then
            raise exception 'La ficha a completar no es de esta clínica.';
          end if;
          v_campos := '{}'::jsonb;
          if v_pac.phone is null and nullif(v_fila->>'telefono', '') is not null then
            v_campos := v_campos || jsonb_build_object('phone', v_fila->>'telefono');
          end if;
          if v_pac.email is null and nullif(v_fila->>'email', '') is not null then
            v_campos := v_campos || jsonb_build_object('email', v_fila->>'email');
          end if;
          if v_pac.birth_date is null and nullif(v_fila->>'nacimiento', '') is not null then
            v_campos := v_campos || jsonb_build_object('birth_date', v_fila->>'nacimiento');
          end if;
          if v_pac.address is null and nullif(v_fila->>'direccion', '') is not null then
            v_campos := v_campos || jsonb_build_object('address', v_fila->>'direccion');
          end if;
          if v_pac.commune is null and nullif(v_fila->>'comuna', '') is not null then
            v_campos := v_campos || jsonb_build_object('commune', v_fila->>'comuna');
          end if;
          if v_pac.health_plan is null and nullif(v_fila->>'prevision', '') is not null then
            v_campos := v_campos || jsonb_build_object('health_plan', v_fila->>'prevision');
            if nullif(v_fila->>'tramo', '') is not null then
              v_campos := v_campos || jsonb_build_object('health_plan_tier', v_fila->>'tramo');
            end if;
            if nullif(v_fila->>'institucion', '') is not null then
              v_campos := v_campos || jsonb_build_object('health_plan_institution', v_fila->>'institucion');
            end if;
          end if;
          if v_pac.acquisition_source is null and nullif(v_fila->>'origen', '') is not null then
            v_campos := v_campos || jsonb_build_object('acquisition_source', v_fila->>'origen');
          end if;
          if v_pac.emergency_contact_name is null and v_pac.emergency_contact_phone is null
             and nullif(v_fila->>'emergencia_nombre', '') is not null
             and nullif(v_fila->>'emergencia_telefono', '') is not null then
            v_campos := v_campos || jsonb_build_object(
              'emergency_contact_name', v_fila->>'emergencia_nombre',
              'emergency_contact_phone', v_fila->>'emergencia_telefono'
            );
            if nullif(v_fila->>'emergencia_relacion', '') is not null then
              v_campos := v_campos || jsonb_build_object('emergency_contact_relationship', v_fila->>'emergencia_relacion');
            end if;
          end if;

          if v_campos = '{}'::jsonb then
            v_accion := 'omitido';
            v_mensaje := 'La ficha ya tenía todos esos datos.';
          else
            update public.patients p set
              phone = coalesce(p.phone, v_campos->>'phone'),
              email = coalesce(p.email, v_campos->>'email'),
              birth_date = coalesce(p.birth_date, (v_campos->>'birth_date')::date),
              address = coalesce(p.address, v_campos->>'address'),
              commune = coalesce(p.commune, v_campos->>'commune'),
              health_plan = coalesce(p.health_plan, v_campos->>'health_plan'),
              health_plan_tier = case when p.health_plan is null then v_campos->>'health_plan_tier' else p.health_plan_tier end,
              health_plan_institution = case when p.health_plan is null then v_campos->>'health_plan_institution' else p.health_plan_institution end,
              acquisition_source = coalesce(p.acquisition_source, v_campos->>'acquisition_source'),
              emergency_contact_name = coalesce(p.emergency_contact_name, v_campos->>'emergency_contact_name'),
              emergency_contact_phone = coalesce(p.emergency_contact_phone, v_campos->>'emergency_contact_phone'),
              emergency_contact_relationship = coalesce(p.emergency_contact_relationship, v_campos->>'emergency_contact_relationship')
             where p.id = v_pac.id and p.clinic_id = v_lote.clinic_id;
            insert into public.import_batch_changes (batch_id, clinic_id, patient_id, campos)
            values (v_lote.id, v_lote.clinic_id, v_pac.id, v_campos);
            v_id := v_pac.id;
            v_accion := 'actualizado';
          end if;
          if v_accion = 'omitido' then v_id := v_pac.id; end if;
        else
          insert into public.patients (
            clinic_id, full_name, document_id, document_type, birth_date, phone, email,
            address, commune, health_plan, health_plan_tier, health_plan_institution,
            acquisition_source, emergency_contact_name, emergency_contact_relationship,
            emergency_contact_phone, status, created_by,
            import_batch_id, import_external_id, import_original
          ) values (
            v_lote.clinic_id,
            v_fila->>'nombre',
            nullif(v_fila->>'documento', ''),
            nullif(v_fila->>'documento_tipo', ''),
            nullif(v_fila->>'nacimiento', '')::date,
            nullif(v_fila->>'telefono', ''),
            nullif(v_fila->>'email', ''),
            nullif(v_fila->>'direccion', ''),
            nullif(v_fila->>'comuna', ''),
            nullif(v_fila->>'prevision', ''),
            nullif(v_fila->>'tramo', ''),
            nullif(v_fila->>'institucion', ''),
            nullif(v_fila->>'origen', ''),
            nullif(v_fila->>'emergencia_nombre', ''),
            nullif(v_fila->>'emergencia_relacion', ''),
            nullif(v_fila->>'emergencia_telefono', ''),
            'active',
            auth.uid(),
            v_lote.id,
            nullif(v_fila->>'externo', ''),
            v_original
          )
          returning id into v_id;
        end if;

      -- ── Citas ──
      elsif v_lote.kind = 'citas' then
        if not exists (select 1 from public.patients where id = (v_fila->>'patient_id')::uuid and clinic_id = v_lote.clinic_id)
           or not exists (select 1 from public.professionals where id = (v_fila->>'professional_id')::uuid and clinic_id = v_lote.clinic_id)
           or not exists (select 1 from public.branches where id = (v_fila->>'branch_id')::uuid and clinic_id = v_lote.clinic_id) then
          raise exception 'El paciente, el profesional o la sucursal no son de esta clínica.';
        end if;
        select a.id into v_id
          from public.appointments a
         where a.clinic_id = v_lote.clinic_id
           and a.patient_id = (v_fila->>'patient_id')::uuid
           and a.professional_id = (v_fila->>'professional_id')::uuid
           and a.starts_at = (v_fila->>'inicio')::timestamptz
         limit 1;
        if v_id is not null then
          v_accion := 'omitido';
          v_mensaje := 'Ya existe una cita de ese paciente con ese profesional a esa hora.';
        else
          insert into public.appointments (
            clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at,
            status, treatment_label, notes, created_by, import_batch_id, import_external_id,
            import_original
          ) values (
            v_lote.clinic_id,
            (v_fila->>'branch_id')::uuid,
            (v_fila->>'patient_id')::uuid,
            (v_fila->>'professional_id')::uuid,
            (v_fila->>'inicio')::timestamptz,
            (v_fila->>'fin')::timestamptz,
            coalesce(nullif(v_fila->>'estado', ''), 'tentativa')::public.appointment_status,
            coalesce(nullif(v_fila->>'motivo', ''), 'Cita importada'),
            nullif(v_fila->>'notas', ''),
            auth.uid(),
            v_lote.id,
            nullif(v_fila->>'externo', ''),
            v_original
          )
          returning id into v_id;
        end if;
      end if;

      if v_accion = 'creado' then
        v_creados := v_creados + 1;
      elsif v_accion = 'actualizado' then
        v_actualizados := v_actualizados + 1;
      else
        v_omitidos := v_omitidos + 1;
      end if;
    exception when others then
      v_accion := 'error';
      v_id := null;
      v_mensaje := sqlerrm;
      v_fallidos := v_fallidos + 1;
    end;

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'fila', (v_fila->>'fila')::integer,
      'accion', v_accion,
      'id', v_id,
      'mensaje', v_mensaje
    ));
  end loop;

  update public.import_batches b set
    rows_created = b.rows_created + v_creados,
    rows_updated = b.rows_updated + v_actualizados,
    rows_skipped = b.rows_skipped + v_omitidos,
    rows_failed = b.rows_failed + v_fallidos
   where b.id = v_lote.id;

  return v_res;
end;
$$;

comment on function public.migracion_importar_bloque(uuid, jsonb) is
  'EXP-05: escribe un bloque (≤ 500 filas) de un lote en curso, con la RLS de quien importa. Una fila con error no tumba el bloque. Devuelve el resultado por fila.';

revoke execute on function public.migracion_importar_bloque(uuid, jsonb) from public, anon;
grant execute on function public.migracion_importar_bloque(uuid, jsonb) to authenticated, service_role;


-- ─── Qué impide deshacer un lote ───────────────────────────────────────────

-- Una fila por motivo: (tabla importada, tabla que la usa o motivo, cantidad).
-- "Usar" = cualquier fila de otra tabla con FK a lo importado que NO sea del
-- mismo lote (una cita, un pago, una nota clínica, un mensaje, las citas de
-- otro lote…), más las fichas y citas editadas o fusionadas después de
-- importarlas. Las FKs se leen del catálogo: una tabla nueva que apunte a
-- pacientes o citas queda cubierta sin tocar esto.
create or replace function public.migracion_bloqueos_de_lote(p_batch_id uuid)
returns table (tabla text, usada_por text, cantidad bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lote record;
  v_tabla text;
  v_fk record;
  v_n bigint;
  v_sql text;
begin
  select b.id, b.clinic_id, b.reminders_enabled_at into v_lote
    from public.import_batches b where b.id = p_batch_id;
  if not found then
    raise exception 'No encontramos el lote de importación.' using errcode = '42501';
  end if;
  perform public.migracion_exigir_gestion(v_lote.clinic_id);

  foreach v_tabla in array array['patients', 'appointments'] loop
    for v_fk in
      select distinct c.conrelid::regclass::text as hija, ah.attname::text as columna
        from pg_constraint c
        cross join lateral unnest(c.conkey, c.confkey) as k(hijo, padre)
        join pg_attribute ap on ap.attrelid = c.confrelid and ap.attnum = k.padre and ap.attname = 'id'
        join pg_attribute ah on ah.attrelid = c.conrelid and ah.attnum = k.hijo
       where c.contype = 'f'
         and c.confrelid = format('public.%I', v_tabla)::regclass
         -- Lo que la base escribe sola al crear la ficha (índice ciego del
         -- documento) no es actividad.
         and c.conrelid::regclass::text not in ('patient_document_bidx')
    loop
      v_sql := format(
        'select count(*) from %s h where h.%I in (select x.id from public.%I x where x.import_batch_id = $1)',
        v_fk.hija, v_fk.columna, v_tabla
      );
      if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = v_fk.hija and column_name = 'import_batch_id'
      ) then
        v_sql := v_sql || ' and h.import_batch_id is distinct from $1';
      end if;
      -- Autorreferencias (p. ej. merged_into, referred_by_patient_id): solo
      -- cuentan las de fichas que no son del lote.
      if v_fk.hija = v_tabla and v_fk.hija <> 'patients' then
        v_sql := v_sql || ' and h.import_batch_id is distinct from $1';
      end if;
      execute v_sql into v_n using p_batch_id;
      if v_n > 0 then
        tabla := v_tabla;
        usada_por := v_fk.hija;
        cantidad := v_n;
        return next;
      end if;
    end loop;
  end loop;

  -- Notas clínicas: se enlazan por texto (`patient_ref`), sin FK.
  select count(*) into v_n
    from public.clinical_notes n
   where n.clinic_id = v_lote.clinic_id
     and n.patient_ref in (
       select p.id::text from public.patients p where p.import_batch_id = p_batch_id
     );
  if v_n > 0 then
    tabla := 'patients'; usada_por := 'clinical_notes'; cantidad := v_n; return next;
  end if;

  -- Fichas fusionadas en otra después de importarlas.
  select count(*) into v_n
    from public.patients p
   where p.import_batch_id = p_batch_id and p.merged_into is not null;
  if v_n > 0 then
    tabla := 'patients'; usada_por := 'fusion'; cantidad := v_n; return next;
  end if;

  -- Fichas y citas editadas después de importarlas. Activar los
  -- recordatorios del lote toca las citas pero no cuenta como edición.
  select count(*) into v_n
    from public.patients p
   where p.import_batch_id = p_batch_id and p.updated_at > p.imported_at;
  if v_n > 0 then
    tabla := 'patients'; usada_por := 'edicion'; cantidad := v_n; return next;
  end if;
  select count(*) into v_n
    from public.appointments a
   where a.import_batch_id = p_batch_id
     and a.updated_at > greatest(a.imported_at, coalesce(v_lote.reminders_enabled_at, a.imported_at));
  if v_n > 0 then
    tabla := 'appointments'; usada_por := 'edicion'; cantidad := v_n; return next;
  end if;
end;
$$;

comment on function public.migracion_bloqueos_de_lote(uuid) is
  'EXP-05: lo que impide deshacer un lote: registros de otras tablas (o de otros lotes) que usan lo importado, y fichas o citas editadas o fusionadas después.';

revoke execute on function public.migracion_bloqueos_de_lote(uuid) from public, anon;
grant execute on function public.migracion_bloqueos_de_lote(uuid) to authenticated, service_role;

-- ─── Deshacer un lote ──────────────────────────────────────────────────────

create or replace function public.migracion_deshacer_lote(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote record;
  v_cambio record;
  v_campo text;
  v_n_citas integer;
  v_n_pacientes integer;
  v_n_completados integer := 0;
  v_n integer;
  -- Orden: el tramo y la institución antes que la previsión (CHECK
  -- patients_health_plan_tier_fonasa).
  v_campos_permitidos constant text[] := array[
    'phone', 'email', 'birth_date', 'address', 'commune', 'health_plan_tier',
    'health_plan_institution', 'health_plan', 'acquisition_source',
    'emergency_contact_relationship', 'emergency_contact_phone', 'emergency_contact_name'
  ];
begin
  select b.* into v_lote from public.import_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'No encontramos el lote de importación.' using errcode = '42501';
  end if;
  perform public.migracion_exigir_gestion(v_lote.clinic_id);
  if v_lote.status = 'deshecho' then
    raise exception 'Este lote ya se deshizo.' using errcode = '23514';
  end if;
  if exists (select 1 from public.migracion_bloqueos_de_lote(p_batch_id)) then
    raise exception 'No se puede deshacer: hay registros que se usaron después de importarlos.'
      using errcode = '55000';
  end if;

  perform set_config('esmalia.lote_en_reversa', p_batch_id::text, true);

  -- Campos completados en fichas que ya existían: se vacían solo si siguen
  -- con el valor que puso el lote.
  for v_cambio in
    select c.patient_id, c.campos from public.import_batch_changes c where c.batch_id = p_batch_id
  loop
    foreach v_campo in array v_campos_permitidos loop
      if v_cambio.campos ? v_campo then
        execute format(
          'update public.patients set %I = null where id = $1 and clinic_id = $2 and %I::text is not distinct from $3',
          v_campo, v_campo
        ) using v_cambio.patient_id, v_lote.clinic_id, v_cambio.campos->>v_campo;
        get diagnostics v_n = row_count;
        v_n_completados := v_n_completados + v_n;
      end if;
    end loop;
  end loop;

  delete from public.appointments where import_batch_id = p_batch_id and clinic_id = v_lote.clinic_id;
  get diagnostics v_n_citas = row_count;
  -- El índice ciego del documento lo escribe la base al crear la ficha.
  delete from public.patient_document_bidx b
   using public.patients p
   where b.patient_id = p.id and p.import_batch_id = p_batch_id and p.clinic_id = v_lote.clinic_id;
  delete from public.patients where import_batch_id = p_batch_id and clinic_id = v_lote.clinic_id;
  get diagnostics v_n_pacientes = row_count;

  update public.import_batches
     set status = 'deshecho', reverted_at = now(), reverted_by = auth.uid(),
         completed_at = coalesce(completed_at, now())
   where id = p_batch_id;

  return jsonb_build_object(
    'pacientes', v_n_pacientes,
    'citas', v_n_citas,
    'campos_vaciados', v_n_completados
  );
end;
$$;

comment on function public.migracion_deshacer_lote(uuid) is
  'EXP-05: borra todo lo que creó un lote y vacía los campos que completó, si nada de eso se usó después (ver migracion_bloqueos_de_lote).';

revoke execute on function public.migracion_deshacer_lote(uuid) from public, anon;
grant execute on function public.migracion_deshacer_lote(uuid) to authenticated, service_role;

-- ─── Activar recordatorios de un lote de citas (REC-06) ────────────────────

-- Las citas de un lote importado sin la casilla no aparecen en
-- Recordatorios. Esto las incluye después, de una vez para todo el lote.
-- No manda nada: solo deja que el staff las vea en /recordatorios.
create or replace function public.migracion_activar_recordatorios(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote record;
  v_n integer;
begin
  select b.* into v_lote from public.import_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'No encontramos el lote de importación.' using errcode = '42501';
  end if;
  perform public.migracion_exigir_gestion(v_lote.clinic_id);
  if v_lote.kind <> 'citas' or v_lote.status <> 'completado' then
    raise exception 'Solo se activan los recordatorios de un lote de citas completado.' using errcode = '23514';
  end if;
  if v_lote.include_in_reminders then
    return 0;
  end if;

  perform set_config('esmalia.lote_avisos', p_batch_id::text, true);
  update public.import_batches
     set include_in_reminders = true, reminders_enabled_at = now()
   where id = p_batch_id;
  update public.appointments
     set reminders_muted = false
   where import_batch_id = p_batch_id and clinic_id = v_lote.clinic_id and reminders_muted;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.migracion_activar_recordatorios(uuid) is
  'REC-06: incluye en Recordatorios las citas de un lote importado sin la casilla. No envía nada.';

revoke execute on function public.migracion_activar_recordatorios(uuid) from public, anon;
grant execute on function public.migracion_activar_recordatorios(uuid) to authenticated, service_role;

commit;

-- ─── Cómo revertir ─────────────────────────────────────────────────────────
-- begin;
-- drop function if exists public.migracion_activar_recordatorios(uuid);
-- drop function if exists public.migracion_deshacer_lote(uuid);
-- drop function if exists public.migracion_bloqueos_de_lote(uuid);
-- drop function if exists public.migracion_importar_bloque(uuid, jsonb);
-- drop function if exists public.migracion_buscar_pacientes(uuid, jsonb, text, boolean);
-- drop function if exists public.migracion_exigir_gestion(uuid);
-- drop function if exists public.normalizar_nombre_persona(text);
-- commit;
