-- Ola 7 · Frente B (2/2): funciones de las páginas públicas del paciente
-- (sin login): `/formulario/<token>` (MKT-07) y `/encuesta/<token>` (MKT-08).
--
-- El navegador del paciente NUNCA llama a la base. Llama a server functions
-- de la app, que validan la entrada, aplican un límite por IP y llaman estas
-- funciones con el rol de servicio. Por eso todas revocan EXECUTE a PUBLIC,
-- anon y authenticated (tests/permisos-funciones-definer.test.ts y
-- tests/correos-pacientes-db.test.ts).
--
-- Cada una recibe el sha256 del token (el token no viaja a la base) y queda
-- acotada a ESE formulario o ESA encuesta:
--
--   formulario_previo_abrir    estado, clínica, primer nombre, fecha de la
--                              cita y los datos de contacto actuales (para
--                              precargar). Nunca devuelve datos clínicos.
--   formulario_previo_enviar   guarda lo que el paciente envió, una vez. No
--                              toca `patients` ni `patient_medical_history`:
--                              queda "respondido" hasta que el staff lo
--                              acepta en la ficha.
--   encuesta_nps_abrir         estado, clínica, fecha y profesional.
--   encuesta_nps_responder     guarda la nota (0-10) y el comentario, una
--                              vez. A un promotor (9-10) le devuelve el link
--                              de reseña de Google de la clínica (o el de la
--                              sucursal de la cita); si no hay, nada.
--
-- Compatible con el código en producción: solo funciones nuevas.
--
-- Reversa al pie.

begin;

-- ─── Formulario antes de la cita ──────────────────────────────────────────

create or replace function public.formulario_previo_abrir(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_estado text;
  p record;
  v_clinica text;
  v_zona text;
  v_cita timestamptz;
  v_cita_estado text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select * into r from public.patient_intake_forms where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select name, coalesce(nullif(timezone, ''), 'America/Santiago')
    into v_clinica, v_zona
    from public.clinics where id = r.clinic_id;
  select starts_at, status::text into v_cita, v_cita_estado
    from public.appointments where id = r.appointment_id;

  v_estado := case
    when r.status in ('respondido', 'aceptado', 'descartado') then 'respondido'
    when r.expires_at <= now() then 'vencido'
    when v_cita_estado = 'cancelada' then 'cita_cancelada'
    else 'abierto'
  end;

  if v_estado <> 'abierto' then
    return jsonb_build_object('estado', v_estado, 'clinica', v_clinica, 'zona', v_zona);
  end if;

  if r.status = 'enviado' then
    update public.patient_intake_forms
       set status = 'abierto', opened_at = now()
     where id = r.id;
  end if;

  select full_name, email, phone, address, commune,
         emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
    into p
    from public.patients where id = r.patient_id;

  return jsonb_build_object(
    'estado', 'abierto',
    'clinica', v_clinica,
    'zona', v_zona,
    'nombre', split_part(trim(coalesce(p.full_name, '')), ' ', 1),
    'cita', v_cita,
    'vence', r.expires_at,
    'contacto', jsonb_build_object(
      'email', p.email,
      'phone', p.phone,
      'address', p.address,
      'commune', p.commune,
      'emergency_contact_name', p.emergency_contact_name,
      'emergency_contact_phone', p.emergency_contact_phone,
      'emergency_contact_relationship', p.emergency_contact_relationship
    )
  );
end;
$$;

comment on function public.formulario_previo_abrir(text) is
  'MKT-07: abre el formulario antes de la cita por la huella de su token. Solo rol de servicio.';

revoke all on function public.formulario_previo_abrir(text) from public, anon, authenticated;
grant execute on function public.formulario_previo_abrir(text) to service_role;

create or replace function public.formulario_previo_enviar(
  p_token_hash text,
  p_contacto jsonb,
  p_cuestionario jsonb,
  p_alergias text[],
  p_medicacion text[],
  p_comentario text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cita_estado text;
  v_contacto jsonb := '{}'::jsonb;
  v_clave text;
  v_valor text;
  v_alergias text[];
  v_medicacion text[];
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select * into r from public.patient_intake_forms where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('estado', 'invalido');
  end if;
  if r.status in ('respondido', 'aceptado', 'descartado') then
    return jsonb_build_object('estado', 'respondido');
  end if;
  if r.expires_at <= now() then
    return jsonb_build_object('estado', 'vencido');
  end if;
  select status::text into v_cita_estado from public.appointments where id = r.appointment_id;
  if v_cita_estado = 'cancelada' then
    return jsonb_build_object('estado', 'cita_cancelada');
  end if;

  -- Solo las claves conocidas, como texto corto. El servidor ya validó con
  -- zod; esto es la segunda línea.
  if jsonb_typeof(p_contacto) = 'object' then
    foreach v_clave in array array[
      'email', 'phone', 'address', 'commune',
      'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship'
    ] loop
      v_valor := nullif(trim(p_contacto ->> v_clave), '');
      if v_valor is not null then
        v_contacto := v_contacto || jsonb_build_object(v_clave, left(v_valor, 200));
      end if;
    end loop;
  end if;

  if p_cuestionario is not null
     and (jsonb_typeof(p_cuestionario) <> 'object' or pg_column_size(p_cuestionario) > 16000) then
    raise exception 'Cuestionario inválido.' using errcode = '22023';
  end if;

  select array_agg(left(trim(x), 120)) into v_alergias
    from (select x from unnest(coalesce(p_alergias, '{}')) x where trim(x) <> '' limit 30) s;
  select array_agg(left(trim(x), 120)) into v_medicacion
    from (select x from unnest(coalesce(p_medicacion, '{}')) x where trim(x) <> '' limit 30) s;

  update public.patient_intake_forms
     set status = 'respondido',
         submitted_at = now(),
         opened_at = coalesce(opened_at, now()),
         submitted_contact = case when v_contacto = '{}'::jsonb then null else v_contacto end,
         submitted_questionnaire = case
           when p_cuestionario is null or p_cuestionario = '{}'::jsonb then null
           else p_cuestionario
         end,
         submitted_allergies = v_alergias,
         submitted_medications = v_medicacion,
         submitted_comment = nullif(left(trim(coalesce(p_comentario, '')), 1000), '')
   where id = r.id;

  return jsonb_build_object('estado', 'enviado');
end;
$$;

comment on function public.formulario_previo_enviar(text, jsonb, jsonb, text[], text[], text) is
  'MKT-07: guarda lo que el paciente envió en el formulario (una vez). No toca la ficha. Solo rol de servicio.';

revoke all on function public.formulario_previo_enviar(text, jsonb, jsonb, text[], text[], text)
  from public, anon, authenticated;
grant execute on function public.formulario_previo_enviar(text, jsonb, jsonb, text[], text[], text)
  to service_role;

-- ─── Encuesta NPS ─────────────────────────────────────────────────────────

create or replace function public.encuesta_nps_abrir(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_clinica text;
  v_zona text;
  v_cita timestamptz;
  v_profesional text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('estado', 'invalida');
  end if;

  select * into r from public.patient_nps_responses where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('estado', 'invalida');
  end if;

  select name, coalesce(nullif(timezone, ''), 'America/Santiago')
    into v_clinica, v_zona
    from public.clinics where id = r.clinic_id;

  if r.responded_at is not null then
    return jsonb_build_object('estado', 'respondida', 'clinica', v_clinica, 'zona', v_zona);
  end if;
  if r.expires_at <= now() then
    return jsonb_build_object('estado', 'vencida', 'clinica', v_clinica, 'zona', v_zona);
  end if;

  if r.opened_at is null then
    update public.patient_nps_responses set opened_at = now() where id = r.id;
  end if;

  select starts_at into v_cita from public.appointments where id = r.appointment_id;
  select full_name into v_profesional from public.professionals where id = r.professional_id;

  return jsonb_build_object(
    'estado', 'abierta',
    'clinica', v_clinica,
    'zona', v_zona,
    'cita', v_cita,
    'profesional', v_profesional
  );
end;
$$;

comment on function public.encuesta_nps_abrir(text) is
  'MKT-08: abre la encuesta NPS por la huella de su token. Solo rol de servicio.';

revoke all on function public.encuesta_nps_abrir(text) from public, anon, authenticated;
grant execute on function public.encuesta_nps_abrir(text) to service_role;

create or replace function public.encuesta_nps_responder(
  p_token_hash text,
  p_score integer,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_url text;
  v_promotor boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('estado', 'invalida');
  end if;
  if p_score is null or p_score < 0 or p_score > 10 then
    raise exception 'La nota va de 0 a 10.' using errcode = '22023';
  end if;

  select * into r from public.patient_nps_responses where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('estado', 'invalida');
  end if;
  if r.responded_at is not null then
    return jsonb_build_object('estado', 'respondida');
  end if;
  if r.expires_at <= now() then
    return jsonb_build_object('estado', 'vencida');
  end if;

  v_promotor := p_score >= 9;
  if v_promotor then
    select coalesce(
      (select nullif(trim(s.google_review_url), '')
         from public.patient_notification_settings s where s.clinic_id = r.clinic_id),
      (select nullif(trim(b.google_review_url), '')
         from public.appointments a join public.branches b on b.id = a.branch_id
        where a.id = r.appointment_id)
    ) into v_url;
    if v_url is not null and v_url !~ '^https://[^[:space:]]+$' then
      v_url := null;
    end if;
  end if;

  update public.patient_nps_responses
     set score = p_score,
         comment = nullif(left(trim(coalesce(p_comment, '')), 1000), ''),
         responded_at = now(),
         opened_at = coalesce(opened_at, now()),
         review_link_shown = v_url is not null
   where id = r.id;

  return jsonb_build_object(
    'estado', 'gracias',
    'promotor', v_promotor,
    'resena_url', v_url
  );
end;
$$;

comment on function public.encuesta_nps_responder(text, integer, text) is
  'MKT-08: guarda la respuesta NPS (una vez) y, a un promotor, le devuelve el link de reseña de Google si existe. Solo rol de servicio.';

revoke all on function public.encuesta_nps_responder(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.encuesta_nps_responder(text, integer, text) to service_role;

commit;

-- Cómo revertir:
--
-- begin;
-- drop function if exists public.encuesta_nps_responder(text, integer, text);
-- drop function if exists public.encuesta_nps_abrir(text);
-- drop function if exists public.formulario_previo_enviar(text, jsonb, jsonb, text[], text[], text);
-- drop function if exists public.formulario_previo_abrir(text);
-- commit;
