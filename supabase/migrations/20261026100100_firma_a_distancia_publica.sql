-- Ola 5 · Frente Firma a distancia (2/2): las funciones de la página pública
-- `/firmar/<token>` (sin login).
--
-- El navegador del paciente NUNCA llama a la base. Llama a server functions
-- de la app, que validan la entrada, aplican un límite por IP en memoria y
-- llaman estas funciones con el rol de servicio. Por eso todas revocan
-- EXECUTE a PUBLIC, anon y authenticated y solo las ejecuta service_role
-- (tests/permisos-funciones-definer.test.ts).
--
-- Cada una recibe el sha256 del token (el token no viaja a la base) y queda
-- acotada a ESA solicitud:
--
--   firma_remota_abrir             estado mínimo para la primera pantalla
--                                  (sin datos clínicos ni del paciente)
--   firma_remota_verificar_rut     compara el RUT con la ficha (índice ciego
--                                  si hay clave en Vault, documento
--                                  normalizado si no). Bien: abre una sesión
--                                  de 30 min (se guarda el sha256 del secreto
--                                  de sesión) y devuelve el documento. Mal:
--                                  suma un intento; 5 = bloqueo de 15 min.
--   firma_remota_ubicacion         clínica, paciente, tipo y título (para la
--                                  ruta de la imagen de la firma y el texto
--                                  aceptado), solo con sesión.
--   firma_remota_preparar_codigo   guarda el sha256 del código de 6 dígitos
--                                  (vence a los 10 min; uno por minuto, 5 por
--                                  solicitud) y devuelve a qué correo
--                                  mandarlo. El servidor lo manda.
--   firma_remota_firmar            valida sesión y código (5 intentos y
--                                  bloqueo), guarda la evidencia y su huella;
--                                  en un presupuesto, lo acepta por la
--                                  transición de siempre (UPDATE de status:
--                                  los triggers validan la transición, crean
--                                  el plan y escriben el historial).
--   firma_remota_guardar_copia     registra el PDF firmado (una vez, hasta 15
--                                  min después de firmar).
--
-- Límite por IP en la base (además del de memoria del servidor): más de 60
-- eventos de una IP en 10 minutos corta todas las funciones para esa IP.
--
-- Compatible con el código en producción: solo funciones nuevas.
--
-- Reversa al pie.

begin;

-- ─── Internas ──────────────────────────────────────────────────────────────

create or replace function public.firma_remota_ip_limitada(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_ip is not null and (
    select count(*) from public.patient_signature_events e
     where e.ip_hint = left(p_ip, 64)
       and e.created_at > now() - interval '10 minutes'
  ) >= 60;
$$;

revoke all on function public.firma_remota_ip_limitada(text) from public, anon, authenticated;

-- Estado visible: una abierta que pasó su vencimiento es 'vencida'.
create or replace function public.firma_remota_estado_visible(p_status text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('enviada', 'abierta') and p_expires_at <= now() then 'vencida'
    else p_status
  end
$$;

revoke all on function public.firma_remota_estado_visible(text, timestamptz) from public, anon;

-- Par exacto de huellaDeEvidencia (src/lib/firma-distancia/evidencia.ts).
create or replace function public.firma_remota_huella_evidencia(
  p_id uuid,
  p_document_sha256 text,
  p_signer_role text,
  p_signer_name text,
  p_signer_rut_sha256 text,
  p_signer_rut_masked text,
  p_code_channel text,
  p_code_recipient_masked text,
  p_signed_at timestamptz,
  p_signed_ip text,
  p_signed_user_agent text,
  p_accepted_text text,
  p_signature_sha256 text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(array_to_string(array[
    p_id::text,
    coalesce(p_document_sha256, ''),
    coalesce(p_signer_role, ''),
    coalesce(p_signer_name, ''),
    coalesce(p_signer_rut_sha256, ''),
    coalesce(p_signer_rut_masked, ''),
    coalesce(p_code_channel, ''),
    coalesce(p_code_recipient_masked, ''),
    to_char(p_signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    coalesce(p_signed_ip, ''),
    coalesce(p_signed_user_agent, ''),
    coalesce(p_accepted_text, ''),
    coalesce(p_signature_sha256, '')
  ], chr(31)), 'UTF8')), 'hex')
$$;

revoke all on function public.firma_remota_huella_evidencia(
  uuid, text, text, text, text, text, text, text, timestamptz, text, text, text, text
) from public, anon;

-- ─── 1. Abrir ──────────────────────────────────────────────────────────────

create or replace function public.firma_remota_abrir(
  p_token_hash text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_estado text;
  v_clinica text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('estado', 'invalida');
  end if;
  if public.firma_remota_ip_limitada(p_ip) then
    return jsonb_build_object('estado', 'limitada');
  end if;

  select * into r
    from public.patient_signature_requests
   where token_hash = p_token_hash
   for update;
  if not found then
    return jsonb_build_object('estado', 'invalida');
  end if;

  v_estado := public.firma_remota_estado_visible(r.status, r.expires_at);
  if r.status = 'enviada' and v_estado = 'enviada' then
    update public.patient_signature_requests
       set status = 'abierta', opened_at = now()
     where id = r.id;
    v_estado := 'abierta';
  end if;
  insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
  values (r.clinic_id, r.id, 'abierta', nullif(left(p_ip, 64), ''), nullif(left(p_user_agent, 400), ''));

  select name into v_clinica from public.clinics where id = r.clinic_id;

  return jsonb_build_object(
    'estado', v_estado,
    'tipo', r.kind,
    'clinica', v_clinica,
    'firmante', r.signer_role,
    'codigo_a', r.code_recipient_masked,
    'vence', r.expires_at,
    'bloqueada_hasta', case when r.locked_until > now() then r.locked_until end,
    'firmada_el', r.signed_at,
    'zona', r.clinic_timezone
  );
end;
$$;

-- ─── 2. Verificar el RUT ───────────────────────────────────────────────────

create or replace function public.firma_remota_verificar_rut(
  p_token_hash text,
  p_documento text,
  p_session_hash text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_estado text;
  v_norm text := public.normalizar_documento(p_documento);
  v_bidx text;
  v_guardado text;
  v_ok boolean := false;
  v_intentos integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'estado', 'invalida');
  end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Sesión inválida.' using errcode = '22023';
  end if;
  if public.firma_remota_ip_limitada(p_ip) then
    return jsonb_build_object('ok', false, 'estado', 'limitada');
  end if;

  select * into r
    from public.patient_signature_requests
   where token_hash = p_token_hash
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'estado', 'invalida');
  end if;
  v_estado := public.firma_remota_estado_visible(r.status, r.expires_at);
  if v_estado not in ('enviada', 'abierta') then
    return jsonb_build_object('ok', false, 'estado', v_estado);
  end if;
  if r.locked_until > now() then
    return jsonb_build_object('ok', false, 'estado', v_estado, 'bloqueada_hasta', r.locked_until);
  end if;

  if v_norm is not null and char_length(v_norm) between 3 and 40 then
    if r.signer_role = 'tutor' then
      select public.normalizar_documento(g.document_id) into v_guardado
        from public.patient_guardians g
       where g.id = r.guardian_id and g.patient_id = r.patient_id;
      v_ok := v_guardado is not null and v_guardado = v_norm;
    else
      -- Índice ciego (HMAC con la clave de Vault) si la base lo tiene; si no
      -- (base sin clave), el documento normalizado de la ficha. Nada de
      -- esto sale de la base.
      v_bidx := public.indice_ciego_documento(p_documento);
      if v_bidx is not null and exists (
        select 1 from public.patient_document_bidx b where b.patient_id = r.patient_id
      ) then
        v_ok := exists (
          select 1 from public.patient_document_bidx b
           where b.patient_id = r.patient_id and b.document_bidx = v_bidx
        );
      else
        select public.normalizar_documento(p.document_id) into v_guardado
          from public.patients p
         where p.id = r.patient_id;
        v_ok := v_guardado is not null and v_guardado = v_norm;
      end if;
    end if;
  end if;

  if not v_ok then
    v_intentos := r.rut_attempts + 1;
    if v_intentos >= 5 then
      update public.patient_signature_requests
         set rut_attempts = 0, locked_until = now() + interval '15 minutes',
             session_hash = null, session_expires_at = null
       where id = r.id;
      insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
      values (r.clinic_id, r.id, 'bloqueada', nullif(left(p_ip, 64), ''), nullif(left(p_user_agent, 400), ''));
      return jsonb_build_object(
        'ok', false, 'estado', v_estado, 'restantes', 0,
        'bloqueada_hasta', now() + interval '15 minutes'
      );
    end if;
    update public.patient_signature_requests set rut_attempts = v_intentos where id = r.id;
    insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
    values (r.clinic_id, r.id, 'rut_incorrecto', nullif(left(p_ip, 64), ''), nullif(left(p_user_agent, 400), ''));
    return jsonb_build_object('ok', false, 'estado', v_estado, 'restantes', 5 - v_intentos);
  end if;

  update public.patient_signature_requests
     set rut_attempts = 0,
         rut_verified_at = now(),
         session_hash = p_session_hash,
         session_expires_at = now() + interval '30 minutes',
         signer_rut_masked = '•••' || right(v_norm, 4),
         signer_rut_sha256 = encode(sha256(convert_to(r.id::text || chr(31) || v_norm, 'UTF8')), 'hex'),
         status = 'abierta',
         opened_at = coalesce(opened_at, now())
   where id = r.id;
  insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
  values (r.clinic_id, r.id, 'rut_correcto', nullif(left(p_ip, 64), ''), nullif(left(p_user_agent, 400), ''));

  return jsonb_build_object(
    'ok', true,
    'estado', 'abierta',
    'tipo', r.kind,
    'titulo', r.title,
    'hoja', r.sheet,
    'bloques', r.content_blocks,
    'documento_sha256', r.document_sha256,
    'firmante', r.signer_role,
    'firmante_nombre', r.signer_expected_name,
    'codigo_a', r.code_recipient_masked,
    'firma_profesional_path', r.professional_signature_path,
    'sesion_vence', now() + interval '30 minutes',
    'vence', r.expires_at
  );
end;
$$;

-- ─── 3. Ubicación (para guardar la imagen de la firma) ─────────────────────

create or replace function public.firma_remota_ubicacion(p_token_hash text, p_session_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  select id, clinic_id, patient_id, kind, title, status, expires_at, session_hash, session_expires_at
    into r
    from public.patient_signature_requests
   where token_hash = p_token_hash;
  if not found
     or public.firma_remota_estado_visible(r.status, r.expires_at) not in ('enviada', 'abierta')
     or r.session_hash is distinct from p_session_hash
     or r.session_expires_at <= now() then
    return null;
  end if;
  return jsonb_build_object(
    'id', r.id, 'clinic_id', r.clinic_id, 'patient_id', r.patient_id,
    'kind', r.kind, 'title', r.title
  );
end;
$$;

-- ─── 4. Preparar el código ─────────────────────────────────────────────────

create or replace function public.firma_remota_preparar_codigo(
  p_token_hash text,
  p_session_hash text,
  p_code_hash text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_estado text;
  v_email text;
  v_nombre text;
  v_clinica text;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Código inválido.' using errcode = '22023';
  end if;
  if public.firma_remota_ip_limitada(p_ip) then
    return jsonb_build_object('ok', false, 'motivo', 'limitada');
  end if;

  select * into r
    from public.patient_signature_requests
   where token_hash = p_token_hash
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  v_estado := public.firma_remota_estado_visible(r.status, r.expires_at);
  if v_estado not in ('enviada', 'abierta') then
    return jsonb_build_object('ok', false, 'motivo', v_estado);
  end if;
  if r.locked_until > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueada', 'bloqueada_hasta', r.locked_until);
  end if;
  if r.session_hash is distinct from p_session_hash or r.session_expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  if r.code_sent_at > now() - interval '60 seconds' then
    return jsonb_build_object(
      'ok', false, 'motivo', 'espera',
      'esperar', ceil(extract(epoch from (r.code_sent_at + interval '60 seconds' - now())))::integer
    );
  end if;
  if r.codes_sent >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiados');
  end if;

  if r.signer_role = 'tutor' then
    select coalesce(nullif(btrim(g.email), ''), nullif(btrim(p.email), '')), g.full_name
      into v_email, v_nombre
      from public.patients p
      left join public.patient_guardians g on g.id = r.guardian_id
     where p.id = r.patient_id;
  else
    select nullif(btrim(p.email), ''), p.full_name into v_email, v_nombre
      from public.patients p
     where p.id = r.patient_id;
  end if;
  if v_email is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_correo');
  end if;

  update public.patient_signature_requests
     set code_hash = p_code_hash,
         code_sent_at = now(),
         code_expires_at = now() + interval '10 minutes',
         code_attempts = 0,
         codes_sent = codes_sent + 1
   where id = r.id;
  insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
  values (r.clinic_id, r.id, 'codigo_enviado', nullif(left(p_ip, 64), ''), nullif(left(p_user_agent, 400), ''));

  select name into v_clinica from public.clinics where id = r.clinic_id;
  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'nombre', coalesce(v_nombre, r.signer_expected_name),
    'clinic_id', r.clinic_id,
    'clinica', v_clinica,
    'codigo_a', r.code_recipient_masked,
    'vence', now() + interval '10 minutes'
  );
end;
$$;

-- ─── 5. Firmar ─────────────────────────────────────────────────────────────

create or replace function public.firma_remota_firmar(
  p_token_hash text,
  p_session_hash text,
  p_code_hash text,
  p_nombre text,
  p_texto_aceptado text,
  p_firma_path text,
  p_firma_sha256 text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  q record;
  v_estado text;
  v_intentos integer;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_texto text := btrim(coalesce(p_texto_aceptado, ''));
  v_path text := nullif(btrim(coalesce(p_firma_path, '')), '');
  v_sha text := nullif(btrim(coalesce(p_firma_sha256, '')), '');
  v_firmado timestamptz := date_trunc('milliseconds', now());
  v_hoy date;
  v_huella text;
  -- Sin dato = NULL (no texto vacío): la constancia dice "Sin dato".
  v_ip text := nullif(btrim(left(p_ip, 64)), '');
  v_ua text := nullif(btrim(left(p_user_agent, 400)), '');
  v_inet inet;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Código inválido.' using errcode = '22023';
  end if;
  if char_length(v_nombre) not between 3 and 120 then
    raise exception 'Escribe tu nombre completo.' using errcode = '22023';
  end if;
  if char_length(v_texto) not between 10 and 600 then
    raise exception 'Falta la declaración de aceptación.' using errcode = '22023';
  end if;
  if (v_path is null) <> (v_sha is null) or (v_sha is not null and v_sha !~ '^[0-9a-f]{64}$') then
    raise exception 'La imagen de la firma no es válida.' using errcode = '22023';
  end if;
  if public.firma_remota_ip_limitada(p_ip) then
    return jsonb_build_object('ok', false, 'motivo', 'limitada');
  end if;

  select * into r
    from public.patient_signature_requests
   where token_hash = p_token_hash
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  v_estado := public.firma_remota_estado_visible(r.status, r.expires_at);
  if v_estado not in ('enviada', 'abierta') then
    return jsonb_build_object('ok', false, 'motivo', v_estado);
  end if;
  if r.locked_until > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueada', 'bloqueada_hasta', r.locked_until);
  end if;
  if r.session_hash is distinct from p_session_hash or r.session_expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  if r.code_hash is null or r.code_expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_vencido');
  end if;

  if r.code_hash <> p_code_hash then
    v_intentos := r.code_attempts + 1;
    if v_intentos >= 5 then
      update public.patient_signature_requests
         set code_attempts = 0, code_hash = null, code_expires_at = null,
             locked_until = now() + interval '15 minutes'
       where id = r.id;
      insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
      values (r.clinic_id, r.id, 'bloqueada', v_ip, v_ua);
      return jsonb_build_object(
        'ok', false, 'motivo', 'bloqueada', 'restantes', 0,
        'bloqueada_hasta', now() + interval '15 minutes'
      );
    end if;
    update public.patient_signature_requests set code_attempts = v_intentos where id = r.id;
    insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
    values (r.clinic_id, r.id, 'codigo_incorrecto', v_ip, v_ua);
    return jsonb_build_object('ok', false, 'motivo', 'codigo_incorrecto', 'restantes', 5 - v_intentos);
  end if;

  if v_path is not null then
    if v_path not like r.clinic_id::text || '/' || r.patient_id::text || '/firmas-a-distancia/%' then
      raise exception 'La firma tiene que estar en la carpeta del paciente.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'clinical-documents' and o.name = v_path
    ) then
      raise exception 'No encontramos la imagen de la firma.' using errcode = '22023';
    end if;
  end if;

  -- Presupuesto: firmar = aceptarlo entero, por la transición de siempre.
  if r.kind = 'presupuesto' then
    select id, status, valid_until into q
      from public.quotes
     where id = r.quote_id
     for update;
    if q.id is null or q.status not in ('draft', 'sent') then
      return jsonb_build_object('ok', false, 'motivo', 'presupuesto_no_disponible');
    end if;
    v_hoy := (now() at time zone coalesce(r.clinic_timezone, 'America/Santiago'))::date;
    if q.valid_until is not null and q.valid_until < v_hoy then
      return jsonb_build_object('ok', false, 'motivo', 'presupuesto_vencido');
    end if;
    if public.huella_de_presupuesto(q.id) is distinct from r.quote_fingerprint then
      return jsonb_build_object('ok', false, 'motivo', 'presupuesto_cambio');
    end if;
    -- quotes.accepted_ip es inet: una IP que no se lee queda en NULL (la
    -- evidencia completa, con el texto tal cual, está en la solicitud).
    begin
      v_inet := v_ip::inet;
    exception when others then
      v_inet := null;
    end;
    update public.quotes
       set status = 'accepted',
           accepted_at = v_firmado,
           accepted_by_name = v_nombre,
           accepted_ip = v_inet,
           accepted_user_agent = v_ua,
           accepted_signature_path = v_path
     where id = q.id;
  end if;

  v_huella := public.firma_remota_huella_evidencia(
    r.id, r.document_sha256, r.signer_role, v_nombre, r.signer_rut_sha256, r.signer_rut_masked,
    r.code_channel, r.code_recipient_masked, v_firmado, v_ip, v_ua, v_texto, v_sha
  );

  update public.patient_signature_requests
     set status = 'firmada',
         signed_at = v_firmado,
         signer_name = v_nombre,
         accepted_text = v_texto,
         signed_ip = v_ip,
         signed_user_agent = v_ua,
         signature_storage_path = v_path,
         signature_sha256 = v_sha,
         signed_at_local = to_char(v_firmado at time zone r.clinic_timezone, 'DD-MM-YYYY HH24:MI:SS')
                           || ' (' || r.clinic_timezone || ')',
         evidence_sha256 = v_huella,
         session_hash = null,
         session_expires_at = null,
         code_hash = null,
         code_expires_at = null
   where id = r.id;
  insert into public.patient_signature_events (clinic_id, request_id, kind, ip_hint, user_agent)
  values (r.clinic_id, r.id, 'firmada', v_ip, v_ua);

  return jsonb_build_object(
    'ok', true,
    'id', r.id,
    'clinic_id', r.clinic_id,
    'patient_id', r.patient_id,
    'firmada_el', v_firmado,
    'evidencia_sha256', v_huella
  );
end;
$$;

-- ─── 6. Guardar la copia firmada ───────────────────────────────────────────

create or replace function public.firma_remota_guardar_copia(
  p_token_hash text,
  p_path text,
  p_sha256 text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Huella de la copia inválida.' using errcode = '22023';
  end if;
  select id, clinic_id, patient_id, status, signed_at, signed_copy_path into r
    from public.patient_signature_requests
   where token_hash = p_token_hash
   for update;
  if r.id is null or r.status <> 'firmada' then
    raise exception 'La solicitud no está firmada.' using errcode = '23514';
  end if;
  if r.signed_copy_path is not null then
    raise exception 'La copia firmada ya está guardada.' using errcode = '23514';
  end if;
  if r.signed_at < now() - interval '15 minutes' then
    raise exception 'Pasó el plazo para guardar la copia.' using errcode = '23514';
  end if;
  if p_path is distinct from
     r.clinic_id::text || '/' || r.patient_id::text || '/firmas-a-distancia/' || r.id::text || '.pdf' then
    raise exception 'Ruta de la copia inválida.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'clinical-documents' and o.name = p_path
  ) then
    raise exception 'No encontramos la copia firmada.' using errcode = '22023';
  end if;

  update public.patient_signature_requests
     set signed_copy_path = p_path, signed_copy_sha256 = p_sha256, signed_copy_at = now()
   where id = r.id;
  insert into public.patient_signature_events (clinic_id, request_id, kind)
  values (r.clinic_id, r.id, 'copia_guardada');
end;
$$;

-- ─── Permisos: solo el rol de servicio ─────────────────────────────────────

revoke all on function public.firma_remota_abrir(text, text, text) from public, anon, authenticated;
revoke all on function public.firma_remota_verificar_rut(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.firma_remota_ubicacion(text, text) from public, anon, authenticated;
revoke all on function public.firma_remota_preparar_codigo(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.firma_remota_firmar(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.firma_remota_guardar_copia(text, text, text) from public, anon, authenticated;

grant execute on function public.firma_remota_abrir(text, text, text) to service_role;
grant execute on function public.firma_remota_verificar_rut(text, text, text, text, text) to service_role;
grant execute on function public.firma_remota_ubicacion(text, text) to service_role;
grant execute on function public.firma_remota_preparar_codigo(text, text, text, text, text) to service_role;
grant execute on function public.firma_remota_firmar(text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.firma_remota_guardar_copia(text, text, text) to service_role;

commit;

-- Cómo revertir:
--
-- begin;
-- drop function if exists public.firma_remota_guardar_copia(text, text, text);
-- drop function if exists public.firma_remota_firmar(text, text, text, text, text, text, text, text, text);
-- drop function if exists public.firma_remota_preparar_codigo(text, text, text, text, text);
-- drop function if exists public.firma_remota_ubicacion(text, text);
-- drop function if exists public.firma_remota_verificar_rut(text, text, text, text, text);
-- drop function if exists public.firma_remota_abrir(text, text, text);
-- drop function if exists public.firma_remota_huella_evidencia(uuid, text, text, text, text, text, text, text, timestamptz, text, text, text, text);
-- drop function if exists public.firma_remota_estado_visible(text, timestamptz);
-- drop function if exists public.firma_remota_ip_limitada(text);
-- commit;
