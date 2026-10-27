-- Ola 7 · Frente A (2/2): funciones de la reserva en línea y de la gestión
-- de la cita por link firmado.
--
-- El navegador del paciente NUNCA llama a la base (patrón de la firma a
-- distancia, Ola 5). Llama server functions de la app, que validan la
-- entrada, aplican un límite por IP en memoria, calculan la disponibilidad
-- con el mismo motor de la agenda y recién ahí llaman estas funciones con el
-- rol de servicio. Todas revocan EXECUTE a PUBLIC, anon y authenticated.
--
--   reserva_en_linea_atiende            ¿el profesional atiende? (EQU-04;
--                                       interna, también la usa el resto)
--   reserva_en_linea_contexto           clínica, sucursales, profesionales
--                                       que atienden y motivos reservables de
--                                       un slug encendido. Sin pacientes.
--   reserva_en_linea_preparar_codigo    guarda el sha256 del código (10 min)
--                                       y aplica los límites por correo,
--                                       teléfono e IP.
--   reserva_en_linea_confirmar          valida el código (5 intentos), busca
--                                       la ficha por RUT (índice ciego) o
--                                       correo o crea una mínima, revisa que
--                                       el horario siga libre (con candado
--                                       por profesional) y crea la cita
--                                       'tentativa'. Nunca 'confirmada'.
--   cita_gestion_ver / _confirmar /     lo que hace el paciente desde
--   _cancelar / _reagendar              /mi-cita/<token>. El token lo valida
--                                       el servidor (HMAC); acá llegan el id
--                                       de la cita y de la clínica firmados.
--
-- Funciones nuevas: no redefine ninguna existente. No escribe datos.
-- Reversa al pie.

begin;

-- ─── Internas ──────────────────────────────────────────────────────────────

-- EQU-04: la marca explícita manda; sin marca, el rol del usuario vinculado
-- (AGE-17: owner/admin/dentist o sin usuario = atiende).
create or replace function public.reserva_en_linea_atiende(p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p.attends_patients,
    p.user_id is null
      or not exists (
        select 1 from public.clinic_members m
         where m.clinic_id = p.clinic_id and m.user_id = p.user_id
      )
      or exists (
        select 1 from public.clinic_members m
         where m.clinic_id = p.clinic_id and m.user_id = p.user_id
           and m.role in ('owner', 'admin', 'dentist')
      )
  )
  from public.professionals p
  where p.id = p_professional_id;
$$;

revoke all on function public.reserva_en_linea_atiende(uuid) from public, anon, authenticated;

-- Más de 30 pedidos de código desde una IP en una hora (todas las clínicas)
-- corta la reserva para esa IP.
create or replace function public.reserva_en_linea_ip_limitada(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select nullif(p_ip, '') is not null and (
    select count(*) from public.online_booking_verifications v
     where v.ip_hint = left(p_ip, 64)
       and v.created_at > now() - interval '1 hour'
  ) >= 30;
$$;

revoke all on function public.reserva_en_linea_ip_limitada(text) from public, anon, authenticated;

-- Duración que la reserva le da a un motivo: la del procedimiento o la de la
-- agenda de la clínica (30 si no hay ninguna).
create or replace function public.reserva_en_linea_duracion(
  p_clinic_id uuid,
  p_procedure_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(5, least(480, coalesce(
    (select pr.duration_min from public.procedures pr
      where pr.id = p_procedure_id and pr.clinic_id = p_clinic_id),
    (select s.default_duration_min::integer from public.clinic_agenda_settings s
      where s.clinic_id = p_clinic_id),
    30
  )));
$$;

revoke all on function public.reserva_en_linea_duracion(uuid, uuid) from public, anon, authenticated;

-- ─── Contexto público de un slug ───────────────────────────────────────────

create or replace function public.reserva_en_linea_contexto(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.online_booking_settings%rowtype;
  c record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$' then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  select * into s from public.online_booking_settings where slug = p_slug;
  if not found then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  select id, name, timezone, country, logo_url into c from public.clinics where id = s.clinic_id;
  if not s.enabled then
    return jsonb_build_object('estado', 'apagada', 'clinica', c.name);
  end if;

  return jsonb_build_object(
    'estado', 'activa',
    'clinic_id', c.id,
    'clinica', c.name,
    'zona', coalesce(c.timezone, 'America/Santiago'),
    'pais', c.country,
    'nota', s.welcome_note,
    'min_notice_hours', s.min_notice_hours,
    'max_days_ahead', s.max_days_ahead,
    'sucursales', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'nombre', b.name, 'direccion', b.address, 'ciudad', b.city,
               'zona', coalesce(b.timezone, c.timezone, 'America/Santiago'))
             order by b.created_at)
        from public.branches b
       where b.clinic_id = c.id and b.is_active
    ), '[]'::jsonb),
    'profesionales', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nombre', p.full_name, 'sucursal_id', p.branch_id,
               'box_id', p.default_operatory_id)
             order by p.full_name)
        from public.professionals p
       where p.clinic_id = c.id and p.is_active
         and public.reserva_en_linea_atiende(p.id)
    ), '[]'::jsonb),
    'procedimientos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'nombre', pr.name,
               'duracion', public.reserva_en_linea_duracion(c.id, pr.id))
             order by pr.position nulls last, pr.name)
        from public.procedures pr
       where pr.clinic_id = c.id and pr.is_active
         and pr.id = any (s.bookable_procedure_ids)
    ), '[]'::jsonb),
    'tipos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'nombre', t.name,
               'duracion', public.reserva_en_linea_duracion(c.id, null))
             order by t.position, t.name)
        from public.appointment_types t
       where t.clinic_id = c.id and t.is_active
         and t.id = any (s.bookable_appointment_type_ids)
    ), '[]'::jsonb)
  );
end;
$$;

-- ─── Código de verificación ────────────────────────────────────────────────

create or replace function public.reserva_en_linea_preparar_codigo(
  p_clinic_id uuid,
  p_request_hash text,
  p_code_hash text,
  p_email_hash text,
  p_phone_hash text,
  p_ip text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ultimo timestamptz;
  v_id uuid;
  v_vence timestamptz := now() + interval '10 minutes';
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_email_hash !~ '^[0-9a-f]{64}$'
     or (nullif(p_phone_hash, '') is not null and p_phone_hash !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  if not exists (
    select 1 from public.online_booking_settings s
     where s.clinic_id = p_clinic_id and s.enabled
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'apagada');
  end if;
  if public.reserva_en_linea_ip_limitada(p_ip) then
    return jsonb_build_object('ok', false, 'motivo', 'limitada');
  end if;

  -- Uno por minuto para el mismo correo en esta clínica.
  select max(v.created_at) into v_ultimo
    from public.online_booking_verifications v
   where v.clinic_id = p_clinic_id and v.email_hash = p_email_hash;
  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    return jsonb_build_object(
      'ok', false, 'motivo', 'espera',
      'esperar', greatest(1, ceil(extract(epoch from (v_ultimo + interval '60 seconds' - now())))::int)
    );
  end if;

  -- 6 códigos por correo y 6 por teléfono en 24 h, por clínica.
  if (select count(*) from public.online_booking_verifications v
       where v.clinic_id = p_clinic_id and v.email_hash = p_email_hash
         and v.created_at > now() - interval '24 hours') >= 6
     or (nullif(p_phone_hash, '') is not null and (
       select count(*) from public.online_booking_verifications v
        where v.clinic_id = p_clinic_id and v.phone_hash = p_phone_hash
          and v.created_at > now() - interval '24 hours') >= 6)
  then
    return jsonb_build_object('ok', false, 'motivo', 'demasiados');
  end if;

  insert into public.online_booking_verifications
    (clinic_id, request_hash, code_hash, email_hash, phone_hash, ip_hint, expires_at)
  values
    (p_clinic_id, p_request_hash, p_code_hash, p_email_hash, nullif(p_phone_hash, ''),
     left(nullif(p_ip, ''), 64), v_vence)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'vence', v_vence);
end;
$$;

-- ─── Confirmar la reserva ──────────────────────────────────────────────────

create or replace function public.reserva_en_linea_confirmar(
  p_verification_id uuid,
  p_request_hash text,
  p_code_hash text,
  p_reserva jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v public.online_booking_verifications%rowtype;
  s public.online_booking_settings%rowtype;
  v_clinic uuid;
  v_branch uuid;
  v_prof uuid;
  v_proc uuid;
  v_tipo uuid;
  v_box uuid;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_duracion integer;
  v_nombre text := btrim(coalesce(p_reserva ->> 'nombre', ''));
  v_email text := lower(btrim(coalesce(p_reserva ->> 'email', '')));
  v_telefono text := nullif(btrim(coalesce(p_reserva ->> 'telefono', '')), '');
  v_rut text := nullif(btrim(coalesce(p_reserva ->> 'rut', '')), '');
  v_nota text := nullif(left(btrim(coalesce(p_reserva ->> 'nota', '')), 500), '');
  v_etiqueta text;
  v_autor uuid;
  v_paciente uuid;
  v_paciente_email text;
  v_bidx text;
  v_nuevo boolean := false;
  v_aviso text;
  v_cita uuid;
  v_intentos int;
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  select * into v from public.online_booking_verifications
   where id = p_verification_id
   for update;
  if not found or v.request_hash <> p_request_hash then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  if v.used_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'usado');
  end if;
  if v.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_vencido');
  end if;
  if v.attempts >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;
  if v.code_hash <> p_code_hash then
    v_intentos := v.attempts + 1;
    update public.online_booking_verifications set attempts = v_intentos where id = v.id;
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_intentos >= 5 then 'bloqueado' else 'codigo_incorrecto' end,
      'restantes', greatest(0, 5 - v_intentos)
    );
  end if;

  v_clinic := v.clinic_id;
  select * into s from public.online_booking_settings where clinic_id = v_clinic;
  if not found or not s.enabled then
    return jsonb_build_object('ok', false, 'motivo', 'apagada');
  end if;

  -- ── Validación de la solicitud (el servidor ya la validó: esto es la red) ──
  begin
    v_branch := (p_reserva ->> 'branch_id')::uuid;
    v_prof := (p_reserva ->> 'professional_id')::uuid;
    v_proc := nullif(p_reserva ->> 'procedure_id', '')::uuid;
    v_tipo := nullif(p_reserva ->> 'appointment_type_id', '')::uuid;
    v_box := nullif(p_reserva ->> 'operatory_id', '')::uuid;
    v_inicio := (p_reserva ->> 'starts_at')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end;

  if v_branch is null or v_prof is null or v_inicio is null
     or char_length(v_nombre) not between 2 and 200
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254
     or (v_telefono is not null and char_length(v_telefono) > 40)
     or (v_rut is not null and char_length(v_rut) > 20)
     or (v_proc is null) = (v_tipo is null) then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  if not exists (select 1 from public.branches b
                  where b.id = v_branch and b.clinic_id = v_clinic and b.is_active)
     or not exists (select 1 from public.professionals p
                     where p.id = v_prof and p.clinic_id = v_clinic and p.is_active)
     or not coalesce(public.reserva_en_linea_atiende(v_prof), false) then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  if v_proc is not null then
    if not (v_proc = any (s.bookable_procedure_ids)) then
      return jsonb_build_object('ok', false, 'motivo', 'invalida');
    end if;
    select pr.name into v_etiqueta from public.procedures pr
     where pr.id = v_proc and pr.clinic_id = v_clinic and pr.is_active;
  else
    if not (v_tipo = any (s.bookable_appointment_type_ids)) then
      return jsonb_build_object('ok', false, 'motivo', 'invalida');
    end if;
    select t.name into v_etiqueta from public.appointment_types t
     where t.id = v_tipo and t.clinic_id = v_clinic and t.is_active;
  end if;
  if v_etiqueta is null then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  if v_box is not null and not exists (
    select 1 from public.operatories o
     where o.id = v_box and o.clinic_id = v_clinic and o.branch_id = v_branch and o.is_active
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  v_duracion := public.reserva_en_linea_duracion(v_clinic, v_proc);
  v_fin := v_inicio + make_interval(mins => v_duracion);

  if v_inicio < now() + make_interval(hours => s.min_notice_hours)
     or v_inicio > now() + make_interval(days => s.max_days_ahead + 1) then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_plazo');
  end if;

  -- ── Horario libre, con candado por profesional (dos reservas a la vez) ──
  perform pg_advisory_xact_lock(hashtextextended('reserva:' || v_prof::text, 0));
  if v_box is not null then
    perform pg_advisory_xact_lock(hashtextextended('reserva-box:' || v_box::text, 0));
  end if;
  if exists (
    select 1 from public.appointments a
     where a.clinic_id = v_clinic
       and a.status not in ('cancelada', 'ausente')
       and a.starts_at < v_fin and a.ends_at > v_inicio
       and (a.professional_id = v_prof or (v_box is not null and a.operatory_id = v_box))
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;

  -- ── Ficha: RUT (índice ciego o documento normalizado), luego correo ──
  if v_rut is not null and public.normalizar_documento(v_rut) is not null then
    v_bidx := public.indice_ciego_documento(v_rut);
    if v_bidx is not null then
      select b.patient_id into v_paciente
        from public.patient_document_bidx b
        join public.patients p on p.id = b.patient_id
       where b.clinic_id = v_clinic and b.document_bidx = v_bidx
         and p.archived_at is null and p.merged_into is null
       order by p.created_at
       limit 1;
    end if;
    if v_paciente is null then
      select p.id into v_paciente
        from public.patients p
       where p.clinic_id = v_clinic
         and p.archived_at is null and p.merged_into is null
         and public.normalizar_documento(p.document_id) = public.normalizar_documento(v_rut)
       order by p.created_at
       limit 1;
    end if;
    if v_paciente is not null then
      select nullif(lower(btrim(p.email)), '') into v_paciente_email
        from public.patients p where p.id = v_paciente;
      -- El RUT es la identidad: la cita va a esa ficha. Si reservó con otro
      -- correo, se avisa al equipo y NO se toca la ficha.
      if v_paciente_email is not null and v_paciente_email <> v_email then
        v_aviso := 'Reservó con un correo distinto al de la ficha: revisar antes de aceptar.';
      end if;
    end if;
  end if;

  if v_paciente is null then
    -- Solo si hay UNA ficha con ese correo y no tiene otro RUT.
    select (array_agg(p.id order by p.created_at))[1] into v_paciente
      from public.patients p
     where p.clinic_id = v_clinic
       and p.archived_at is null and p.merged_into is null
       and lower(btrim(p.email)) = v_email
       and (v_rut is null or nullif(btrim(coalesce(p.document_id, '')), '') is null
            or public.normalizar_documento(p.document_id) = public.normalizar_documento(v_rut))
    having count(*) = 1;
  end if;

  -- Quien figura como autor: quien creó la clínica o, si no está, su owner.
  select coalesce(
    (select c.created_by from public.clinics c
      where c.id = v_clinic
        and exists (select 1 from public.clinic_members m
                     where m.clinic_id = v_clinic and m.user_id = c.created_by)),
    (select m.user_id from public.clinic_members m
      where m.clinic_id = v_clinic and m.role = 'owner'
      order by m.created_at limit 1)
  ) into v_autor;
  if v_autor is null then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  if v_paciente is null then
    insert into public.patients
      (clinic_id, full_name, phone, email, document_type, document_id, branch_id,
       acquisition_source, created_by)
    values
      (v_clinic, v_nombre, v_telefono, v_email,
       case when v_rut is not null then 'rut' end, v_rut, v_branch,
       'Reserva en línea', v_autor)
    returning id into v_paciente;
    v_nuevo := true;
  end if;

  -- Tope por paciente: 3 reservas en línea pendientes a futuro.
  if (select count(*) from public.appointments a
       where a.clinic_id = v_clinic and a.patient_id = v_paciente
         and a.booking_source = 'reserva_en_linea'
         and a.status = 'tentativa' and a.starts_at > now()) >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiadas_reservas');
  end if;

  insert into public.appointments
    (clinic_id, branch_id, patient_id, professional_id, operatory_id, procedure_id,
     appointment_type_id, treatment_label, starts_at, ends_at, status, notes,
     booking_source, created_by)
  values
    (v_clinic, v_branch, v_paciente, v_prof, v_box, v_proc, v_tipo, v_etiqueta,
     v_inicio, v_fin, 'tentativa',
     nullif(concat_ws(E'\n', 'Reservada en línea por el paciente.', v_aviso,
                      case when v_nota is not null then 'Nota del paciente: ' || v_nota end), ''),
     'reserva_en_linea', v_autor)
  returning id into v_cita;

  update public.online_booking_verifications
     set used_at = now(), appointment_id = v_cita
   where id = v.id;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_cita,
    'clinic_id', v_clinic,
    'starts_at', v_inicio,
    'ends_at', v_fin,
    'paciente_nuevo', v_nuevo
  );
end;
$$;

-- ─── Gestión de la cita desde /mi-cita/<token> ─────────────────────────────

create or replace function public.cita_gestion_ver(p_appointment_id uuid, p_clinic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id,
    'clinic_id', a.clinic_id,
    'clinica', c.name,
    'zona', coalesce(b.timezone, c.timezone, 'America/Santiago'),
    'pais', c.country,
    'sucursal_id', a.branch_id,
    'sucursal', b.name,
    'direccion', b.address,
    'telefono_clinica', b.phone,
    'profesional_id', a.professional_id,
    'profesional', p.full_name,
    'motivo', a.treatment_label,
    'procedure_id', a.procedure_id,
    'operatory_id', a.operatory_id,
    'inicio', a.starts_at,
    'fin', a.ends_at,
    'estado', a.status,
    'paciente_confirmo', a.patient_confirmed_at,
    'paciente_cancelo', a.patient_cancelled_at,
    -- Solo el primer nombre: el link puede reenviarse.
    'paciente', split_part(btrim(pa.full_name), ' ', 1),
    'reserva_activa', coalesce(s.enabled, false),
    'min_notice_hours', coalesce(s.min_notice_hours, 2),
    'max_days_ahead', coalesce(s.max_days_ahead, 30)
  )
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  join public.branches b on b.id = a.branch_id
  join public.professionals p on p.id = a.professional_id
  join public.patients pa on pa.id = a.patient_id
  left join public.online_booking_settings s on s.clinic_id = a.clinic_id
  where a.id = p_appointment_id and a.clinic_id = p_clinic_id;
$$;

create or replace function public.cita_gestion_confirmar(p_appointment_id uuid, p_clinic_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a record;
begin
  select id, status, starts_at, patient_confirmed_at into a
    from public.appointments
   where id = p_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  if a.status not in ('tentativa', 'confirmada') or a.starts_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'no_disponible');
  end if;
  if a.patient_confirmed_at is null then
    -- Solo el eje del paciente: status, confirmed_at y confirmed_by no se tocan.
    update public.appointments
       set patient_confirmed_at = now(), patient_confirmed_via = 'enlace'
     where id = a.id and clinic_id = p_clinic_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cita_gestion_cancelar(
  p_appointment_id uuid,
  p_clinic_id uuid,
  p_motivo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a record;
  v_motivo text := nullif(left(btrim(coalesce(p_motivo, '')), 300), '');
begin
  select id, status, starts_at, notes into a
    from public.appointments
   where id = p_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  if a.status = 'cancelada' then
    return jsonb_build_object('ok', true);
  end if;
  if a.status not in ('tentativa', 'confirmada') or a.starts_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'no_disponible');
  end if;
  update public.appointments
     set status = 'cancelada',
         patient_cancelled_at = now(),
         notes = concat_ws(E'\n', nullif(notes, ''),
                           'Cancelada por el paciente desde su link'
                           || coalesce(': ' || v_motivo, '.'))
   where id = a.id and clinic_id = p_clinic_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cita_gestion_reagendar(
  p_appointment_id uuid,
  p_clinic_id uuid,
  p_starts_at timestamptz,
  p_operatory_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a record;
  s public.online_booking_settings%rowtype;
  v_duracion interval;
  v_fin timestamptz;
begin
  select id, status, starts_at, ends_at, professional_id, branch_id into a
    from public.appointments
   where id = p_appointment_id and clinic_id = p_clinic_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;
  if a.status not in ('tentativa', 'confirmada') or a.starts_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'no_disponible');
  end if;
  select * into s from public.online_booking_settings where clinic_id = p_clinic_id;
  if not found or not s.enabled then
    return jsonb_build_object('ok', false, 'motivo', 'apagada');
  end if;
  if p_starts_at is null
     or p_starts_at < now() + make_interval(hours => s.min_notice_hours)
     or p_starts_at > now() + make_interval(days => s.max_days_ahead + 1) then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_plazo');
  end if;
  if p_operatory_id is not null and not exists (
    select 1 from public.operatories o
     where o.id = p_operatory_id and o.clinic_id = p_clinic_id
       and o.branch_id = a.branch_id and o.is_active
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  v_duracion := a.ends_at - a.starts_at;
  v_fin := p_starts_at + v_duracion;

  perform pg_advisory_xact_lock(hashtextextended('reserva:' || a.professional_id::text, 0));
  if p_operatory_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('reserva-box:' || p_operatory_id::text, 0));
  end if;
  if exists (
    select 1 from public.appointments x
     where x.clinic_id = p_clinic_id and x.id <> a.id
       and x.status not in ('cancelada', 'ausente')
       and x.starts_at < v_fin and x.ends_at > p_starts_at
       and (x.professional_id = a.professional_id
            or (p_operatory_id is not null and x.operatory_id = p_operatory_id))
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;

  -- Un horario nuevo vuelve a 'tentativa': el profesional acepta de nuevo.
  -- El aviso del paciente lo limpia el trigger de reprogramación.
  update public.appointments
     set starts_at = p_starts_at,
         ends_at = v_fin,
         operatory_id = p_operatory_id,
         status = 'tentativa',
         notes = concat_ws(E'\n', nullif(notes, ''),
                           'Reagendada por el paciente desde su link.')
   where id = a.id and clinic_id = p_clinic_id;
  return jsonb_build_object('ok', true, 'inicio', p_starts_at, 'fin', v_fin);
end;
$$;

-- ─── Permisos: solo el rol de servicio ─────────────────────────────────────

revoke all on function public.reserva_en_linea_contexto(text) from public, anon, authenticated;
revoke all on function public.reserva_en_linea_preparar_codigo(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.reserva_en_linea_confirmar(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cita_gestion_ver(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cita_gestion_confirmar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cita_gestion_cancelar(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cita_gestion_reagendar(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;

grant execute on function public.reserva_en_linea_contexto(text) to service_role;
grant execute on function public.reserva_en_linea_preparar_codigo(uuid, text, text, text, text, text) to service_role;
grant execute on function public.reserva_en_linea_confirmar(uuid, text, text, jsonb) to service_role;
grant execute on function public.cita_gestion_ver(uuid, uuid) to service_role;
grant execute on function public.cita_gestion_confirmar(uuid, uuid) to service_role;
grant execute on function public.cita_gestion_cancelar(uuid, uuid, text) to service_role;
grant execute on function public.cita_gestion_reagendar(uuid, uuid, timestamptz, uuid) to service_role;

commit;

-- ─── Reversa (no se corre sola) ────────────────────────────────────────────
-- drop function if exists public.cita_gestion_reagendar(uuid, uuid, timestamptz, uuid);
-- drop function if exists public.cita_gestion_cancelar(uuid, uuid, text);
-- drop function if exists public.cita_gestion_confirmar(uuid, uuid);
-- drop function if exists public.cita_gestion_ver(uuid, uuid);
-- drop function if exists public.reserva_en_linea_confirmar(uuid, text, text, jsonb);
-- drop function if exists public.reserva_en_linea_preparar_codigo(uuid, text, text, text, text, text);
-- drop function if exists public.reserva_en_linea_contexto(text);
-- drop function if exists public.reserva_en_linea_duracion(uuid, uuid);
-- drop function if exists public.reserva_en_linea_ip_limitada(text);
-- drop function if exists public.reserva_en_linea_atiende(uuid);
