-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 14 · Frente A (2/2): lo que hace cada dispositivo (AUT-01 a AUT-06).
--
-- El navegador del dispositivo NUNCA llama a la base (mismo patrón que la
-- reserva en línea de la Ola 7). Llama server functions de la app con su
-- token; el servidor calcula la huella, aplica un límite por dispositivo y
-- recién ahí llama estas funciones con el rol de servicio. Todas revocan
-- EXECUTE a PUBLIC, anon y authenticated, y cada una exige el TIPO de
-- dispositivo y lo acota a SU clínica y SU sucursal.
--
--   dispositivo_vincular        canjea el código de un solo uso por la huella
--                               del token (el código se borra al usarse).
--   dispositivo_por_token       quién es el dispositivo (o nada si está
--                               revocado); anota el último uso.
--   totem_identificar           RUT + dato de verificación (últimos 4 del
--                               teléfono o día y mes de nacimiento). Límite:
--                               3 fallos por RUT en 30 min y 8 por tótem en
--                               10 min. Abre una sesión de 3 minutos.
--   totem_resumen               nombre de pila y citas de HOY en la sucursal.
--   totem_marcar_llegada        la cita de hoy pasa a 'en-sala' con su turno.
--                               Nunca 'confirmada'.
--   totem_agendar               cita 'tentativa' con las reglas de la reserva
--                               en línea (misma configuración y motivos).
--   totem_terminar              cierra la sesión (vuelta a la pantalla inicial).
--   sala_estado                 llamado actual, recientes y en espera de la
--                               sucursal (nombre y turno; el servidor lo
--                               reduce a iniciales o número).
--   box_estado / dispositivo_llamar   pantalla del box y "llamar al siguiente".
--
-- totem_identifications: bitácora de intentos y sesiones del tótem (solo
-- huellas). Sin políticas: solo el rol de servicio.
-- sin-grant-authenticated: tabla de backend, la lee y escribe solo el servidor.
--
-- No redefine funciones existentes. No escribe datos. Reversa al pie.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.totem_identifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  device_id uuid not null references public.clinic_devices(id) on delete cascade,
  rut_hash text check (rut_hash ~ '^[0-9a-f]{64}$'),
  ok boolean not null,
  session_hash text unique check (session_hash ~ '^[0-9a-f]{64}$'),
  -- Bitácora de backend: si la ficha desaparece, su rastro acá también.
  patient_id uuid references public.patients(id) on delete cascade,
  expires_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.totem_identifications is
  'AUT-01: intentos de identificación en el tótem y sesiones de 3 minutos (solo huellas). Solo service_role.';

create index if not exists totem_identifications_device_idx
  on public.totem_identifications (device_id, created_at);
create index if not exists totem_identifications_rut_idx
  on public.totem_identifications (clinic_id, rut_hash, created_at);

alter table public.totem_identifications enable row level security;
revoke all on public.totem_identifications from public, anon, authenticated;
grant all on public.totem_identifications to service_role;

-- ─── Vincular y reconocer ─────────────────────────────────────────────────

create or replace function public.dispositivo_vincular(p_code_hash text, p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d record;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false);
  end if;
  update public.clinic_devices
     set token_hash = p_token_hash,
         pairing_code_hash = null,
         pairing_expires_at = null,
         paired_at = now(),
         last_used_at = now()
   where pairing_code_hash = p_code_hash
     and pairing_expires_at > now()
     and revoked_at is null
  returning id, kind into d;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'kind', d.kind);
end;
$$;

create or replace function public.dispositivo_por_token(p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d record;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select dv.id, dv.clinic_id, dv.branch_id, dv.kind, dv.name, dv.operatory_id, dv.privacy_mode,
         dv.last_used_at, c.name as clinica, c.country, c.currency, b.name as sucursal,
         coalesce(b.timezone, c.timezone, 'America/Santiago') as zona, o.name as box
    into d
    from public.clinic_devices dv
    join public.clinics c on c.id = dv.clinic_id
    join public.branches b on b.id = dv.branch_id
    left join public.operatories o on o.id = dv.operatory_id
   where dv.token_hash = p_token_hash and dv.revoked_at is null;
  if not found then
    return null;
  end if;
  if d.last_used_at is null or d.last_used_at < now() - interval '1 minute' then
    update public.clinic_devices set last_used_at = now() where id = d.id;
  end if;
  return jsonb_build_object(
    'id', d.id, 'clinic_id', d.clinic_id, 'branch_id', d.branch_id, 'kind', d.kind,
    'nombre', d.name, 'operatory_id', d.operatory_id, 'box', d.box,
    'privacidad', d.privacy_mode, 'clinica', d.clinica, 'sucursal', d.sucursal,
    'zona', d.zona, 'pais', d.country, 'moneda', d.currency
  );
end;
$$;

-- Dispositivo vigente del tipo pedido, o null.
create or replace function public.dispositivo_de_tipo(p_device_id uuid, p_kind text)
returns public.clinic_devices
language sql
stable
security definer
set search_path = public
as $$
  select d.* from public.clinic_devices d
   where d.id = p_device_id and d.kind = p_kind
     and d.revoked_at is null and d.token_hash is not null;
$$;

-- ─── Tótem: identificación y sesión ───────────────────────────────────────

create or replace function public.totem_identificar(
  p_device_id uuid,
  p_rut text,
  p_tipo text,
  p_valor text,
  p_session_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d public.clinic_devices%rowtype;
  v_doc text;
  v_rut_hash text;
  v_fallos_disp int;
  v_fallos_rut int;
  v_bidx text;
  v_paciente uuid;
  v_ok boolean := false;
  v_dato text;
  v_valor text := regexp_replace(coalesce(p_valor, ''), '\D', '', 'g');
begin
  d := public.dispositivo_de_tipo(p_device_id, 'totem');
  if d.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'dispositivo');
  end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
     or p_tipo not in ('telefono', 'nacimiento') then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;

  -- Limpieza: la bitácora del tótem guarda 30 días.
  delete from public.totem_identifications
   where device_id = d.id and created_at < now() - interval '30 days';

  select count(*) into v_fallos_disp
    from public.totem_identifications t
   where t.device_id = d.id and not t.ok and t.created_at > now() - interval '10 minutes';
  if v_fallos_disp >= 8 then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado_dispositivo');
  end if;

  v_doc := public.normalizar_documento(p_rut);
  if v_doc is null then
    insert into public.totem_identifications (clinic_id, device_id, ok) values (d.clinic_id, d.id, false);
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  v_rut_hash := encode(sha256(convert_to(d.clinic_id::text || ':' || v_doc, 'UTF8')), 'hex');

  select count(*) into v_fallos_rut
    from public.totem_identifications t
   where t.clinic_id = d.clinic_id and t.rut_hash = v_rut_hash and not t.ok
     and t.created_at > now() - interval '30 minutes';
  if v_fallos_rut >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado_rut');
  end if;

  -- Ficha por RUT: índice ciego y, si no, documento normalizado (como la
  -- reserva en línea). Solo fichas vigentes de ESTA clínica.
  v_bidx := public.indice_ciego_documento(p_rut);
  if v_bidx is not null then
    select b.patient_id into v_paciente
      from public.patient_document_bidx b
      join public.patients p on p.id = b.patient_id
     where b.clinic_id = d.clinic_id and b.document_bidx = v_bidx
       and p.clinic_id = d.clinic_id and p.archived_at is null and p.merged_into is null
     order by p.created_at
     limit 1;
  end if;
  if v_paciente is null then
    select p.id into v_paciente
      from public.patients p
     where p.clinic_id = d.clinic_id
       and p.archived_at is null and p.merged_into is null
       and public.normalizar_documento(p.document_id) = v_doc
     order by p.created_at
     limit 1;
  end if;

  if v_paciente is not null and char_length(v_valor) = 4 then
    if p_tipo = 'telefono' then
      select right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 4) into v_dato
        from public.patients p where p.id = v_paciente;
      v_ok := char_length(v_dato) = 4 and v_dato = v_valor;
    else
      select to_char(p.birth_date, 'DDMM') into v_dato
        from public.patients p where p.id = v_paciente;
      v_ok := v_dato is not null and v_dato = v_valor;
    end if;
  end if;

  if not v_ok then
    insert into public.totem_identifications (clinic_id, device_id, rut_hash, ok)
    values (d.clinic_id, d.id, v_rut_hash, false);
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_fallos_rut + 1 >= 3 then 'bloqueado_rut' else 'datos' end,
      'restantes', greatest(0, 2 - v_fallos_rut)
    );
  end if;

  -- Una sola sesión abierta por tótem: la anterior se cierra.
  update public.totem_identifications
     set ended_at = now()
   where device_id = d.id and ok and ended_at is null;

  insert into public.totem_identifications
    (clinic_id, device_id, rut_hash, ok, session_hash, patient_id, expires_at)
  values
    (d.clinic_id, d.id, v_rut_hash, true, p_session_hash, v_paciente, now() + interval '3 minutes');

  return jsonb_build_object('ok', true);
end;
$$;

-- Paciente de una sesión vigente del tótem, o null.
create or replace function public.totem_paciente_de_sesion(p_device_id uuid, p_session_hash text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.patient_id
    from public.totem_identifications t
    join public.clinic_devices d on d.id = t.device_id
   where t.device_id = p_device_id
     and t.session_hash = p_session_hash
     and t.ok and t.ended_at is null and t.expires_at > now()
     and d.kind = 'totem' and d.revoked_at is null and d.token_hash is not null
     and p_session_hash ~ '^[0-9a-f]{64}$';
$$;

create or replace function public.totem_terminar(p_device_id uuid, p_session_hash text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.totem_identifications
     set ended_at = now()
   where device_id = p_device_id and session_hash = p_session_hash and ended_at is null;
$$;

-- Lo que el tótem muestra: nombre de pila y citas de HOY en su sucursal.
-- Nada clínico: hora, profesional, estado y si puede marcar llegada.
create or replace function public.totem_resumen(p_device_id uuid, p_session_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d public.clinic_devices%rowtype;
  v_paciente uuid;
  v_zona text;
  v_hoy date;
begin
  v_paciente := public.totem_paciente_de_sesion(p_device_id, p_session_hash);
  if v_paciente is null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  d := public.dispositivo_de_tipo(p_device_id, 'totem');
  select coalesce(b.timezone, c.timezone, 'America/Santiago') into v_zona
    from public.branches b join public.clinics c on c.id = b.clinic_id
   where b.id = d.branch_id;
  v_hoy := (now() at time zone v_zona)::date;

  return jsonb_build_object(
    'ok', true,
    'patient_id', v_paciente,
    'nombre', (select split_part(btrim(p.full_name), ' ', 1) from public.patients p where p.id = v_paciente),
    'citas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'inicio', a.starts_at,
               'fin', a.ends_at,
               'profesional', pr.full_name,
               'estado', a.status,
               'turno', t.turn_number,
               'puede_llegar', a.status in ('tentativa', 'confirmada')
                               and now() >= a.starts_at - interval '2 hours'
                               and now() <= a.ends_at)
             order by a.starts_at)
        from public.appointments a
        join public.professionals pr on pr.id = a.professional_id
        left join public.waiting_room_turns t on t.appointment_id = a.id
       where a.clinic_id = d.clinic_id
         and a.branch_id = d.branch_id
         and a.patient_id = v_paciente
         and a.status <> 'cancelada'
         and (a.starts_at at time zone v_zona)::date = v_hoy
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.totem_marcar_llegada(
  p_device_id uuid,
  p_session_hash text,
  p_appointment_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d public.clinic_devices%rowtype;
  v_paciente uuid;
  a record;
  v_turno integer;
begin
  v_paciente := public.totem_paciente_de_sesion(p_device_id, p_session_hash);
  if v_paciente is null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  d := public.dispositivo_de_tipo(p_device_id, 'totem');

  select ap.id, ap.status, ap.starts_at, ap.ends_at,
         coalesce(b.timezone, c.timezone, 'America/Santiago') as zona
    into a
    from public.appointments ap
    join public.clinics c on c.id = ap.clinic_id
    join public.branches b on b.id = ap.branch_id
   where ap.id = p_appointment_id
     and ap.clinic_id = d.clinic_id
     and ap.branch_id = d.branch_id
     and ap.patient_id = v_paciente
   for update of ap;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  if a.status = 'en-sala' then
    select t.turn_number into v_turno from public.waiting_room_turns t where t.appointment_id = a.id;
    return jsonb_build_object('ok', true, 'turno', v_turno, 'ya_estaba', true);
  end if;
  if a.status not in ('tentativa', 'confirmada')
     or (a.starts_at at time zone a.zona)::date <> (now() at time zone a.zona)::date
     or now() < a.starts_at - interval '2 hours'
     or now() > a.ends_at then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_horario');
  end if;

  -- Turno primero (marcado "tótem"); el trigger de la cita ya no hace nada.
  v_turno := public.sala_asignar_turno(a.id, 'totem');
  update public.appointments
     set status = 'en-sala',
         arrived_at = coalesce(arrived_at, now())
   where id = a.id and clinic_id = d.clinic_id;

  return jsonb_build_object('ok', true, 'turno', v_turno);
end;
$$;

-- Agendar desde el tótem: mismas reglas que la reserva en línea (encendida,
-- motivos reservables, anticipación, horario libre con candado y tope de 3
-- pendientes), en la sucursal del tótem y para el paciente identificado.
create or replace function public.totem_agendar(
  p_device_id uuid,
  p_session_hash text,
  p_reserva jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d public.clinic_devices%rowtype;
  s public.online_booking_settings%rowtype;
  v_paciente uuid;
  v_prof uuid;
  v_proc uuid;
  v_tipo uuid;
  v_box uuid;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_duracion integer;
  v_etiqueta text;
  v_autor uuid;
  v_cita uuid;
begin
  v_paciente := public.totem_paciente_de_sesion(p_device_id, p_session_hash);
  if v_paciente is null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  d := public.dispositivo_de_tipo(p_device_id, 'totem');

  select * into s from public.online_booking_settings where clinic_id = d.clinic_id;
  if not found or not s.enabled then
    return jsonb_build_object('ok', false, 'motivo', 'apagada');
  end if;

  begin
    v_prof := (p_reserva ->> 'professional_id')::uuid;
    v_proc := nullif(p_reserva ->> 'procedure_id', '')::uuid;
    v_tipo := nullif(p_reserva ->> 'appointment_type_id', '')::uuid;
    v_box := nullif(p_reserva ->> 'operatory_id', '')::uuid;
    v_inicio := (p_reserva ->> 'starts_at')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end;
  if v_prof is null or v_inicio is null or (v_proc is null) = (v_tipo is null) then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  if not exists (select 1 from public.professionals p
                  where p.id = v_prof and p.clinic_id = d.clinic_id and p.is_active)
     or not coalesce(public.reserva_en_linea_atiende(v_prof), false) then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  if v_proc is not null then
    if not (v_proc = any (s.bookable_procedure_ids)) then
      return jsonb_build_object('ok', false, 'motivo', 'invalida');
    end if;
    select pr.name into v_etiqueta from public.procedures pr
     where pr.id = v_proc and pr.clinic_id = d.clinic_id and pr.is_active;
  else
    if not (v_tipo = any (s.bookable_appointment_type_ids)) then
      return jsonb_build_object('ok', false, 'motivo', 'invalida');
    end if;
    select t.name into v_etiqueta from public.appointment_types t
     where t.id = v_tipo and t.clinic_id = d.clinic_id and t.is_active;
  end if;
  if v_etiqueta is null then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  if v_box is not null and not exists (
    select 1 from public.operatories o
     where o.id = v_box and o.clinic_id = d.clinic_id and o.branch_id = d.branch_id and o.is_active
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  v_duracion := public.reserva_en_linea_duracion(d.clinic_id, v_proc);
  v_fin := v_inicio + make_interval(mins => v_duracion);
  if v_inicio < now() + make_interval(hours => s.min_notice_hours)
     or v_inicio > now() + make_interval(days => s.max_days_ahead + 1) then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_plazo');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reserva:' || v_prof::text, 0));
  if v_box is not null then
    perform pg_advisory_xact_lock(hashtextextended('reserva-box:' || v_box::text, 0));
  end if;
  if exists (
    select 1 from public.appointments a
     where a.clinic_id = d.clinic_id
       and a.status not in ('cancelada', 'ausente')
       and a.starts_at < v_fin and a.ends_at > v_inicio
       and (a.professional_id = v_prof or (v_box is not null and a.operatory_id = v_box))
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;

  if (select count(*) from public.appointments a
       where a.clinic_id = d.clinic_id and a.patient_id = v_paciente
         and a.booking_source = 'reserva_en_linea'
         and a.status = 'tentativa' and a.starts_at > now()) >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiadas_reservas');
  end if;

  select coalesce(
    (select c.created_by from public.clinics c
      where c.id = d.clinic_id
        and exists (select 1 from public.clinic_members m
                     where m.clinic_id = d.clinic_id and m.user_id = c.created_by)),
    (select m.user_id from public.clinic_members m
      where m.clinic_id = d.clinic_id and m.role = 'owner'
      order by m.created_at limit 1)
  ) into v_autor;
  if v_autor is null then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  -- Mismo origen que la reserva en línea: entra en "reservas por aceptar"
  -- del panel y la agenda la marca igual. La nota dice que fue en el tótem.
  insert into public.appointments
    (clinic_id, branch_id, patient_id, professional_id, operatory_id, procedure_id,
     appointment_type_id, treatment_label, starts_at, ends_at, status, notes,
     booking_source, created_by)
  values
    (d.clinic_id, d.branch_id, v_paciente, v_prof, v_box, v_proc, v_tipo, v_etiqueta,
     v_inicio, v_fin, 'tentativa',
     'Agendada por el paciente en el tótem de la sala de espera (' || d.name || ').',
     'reserva_en_linea', v_autor)
  returning id into v_cita;

  return jsonb_build_object('ok', true, 'appointment_id', v_cita,
                            'starts_at', v_inicio, 'ends_at', v_fin);
end;
$$;

-- ─── Sala de espera (TV) ──────────────────────────────────────────────────
-- Devuelve el nombre al SERVIDOR, que lo reduce a iniciales, nombre corto o
-- solo el número según la privacidad del dispositivo antes de mandarlo a la
-- pantalla. Nunca RUT, motivo ni profesional.

create or replace function public.sala_estado(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d public.clinic_devices%rowtype;
  v_zona text;
  v_hoy date;
begin
  d := public.dispositivo_de_tipo(p_device_id, 'sala');
  if d.id is null then
    return jsonb_build_object('ok', false);
  end if;
  select coalesce(b.timezone, c.timezone, 'America/Santiago') into v_zona
    from public.branches b join public.clinics c on c.id = b.clinic_id
   where b.id = d.branch_id;
  v_hoy := (now() at time zone v_zona)::date;

  return jsonb_build_object(
    'ok', true,
    'llamados', coalesce((
      select jsonb_agg(x order by x.llamado_en desc) from (
        select t.turn_number as turno, p.full_name as nombre, o.name as box,
               t.called_at as llamado_en, t.call_count as veces
          from public.waiting_room_turns t
          join public.appointments a on a.id = t.appointment_id
          join public.patients p on p.id = a.patient_id
          left join public.operatories o on o.id = t.called_operatory_id
         where t.clinic_id = d.clinic_id and t.branch_id = d.branch_id
           and t.turn_date = v_hoy and t.called_at is not null
           and t.called_at > now() - interval '60 minutes'
         order by t.called_at desc
         limit 5
      ) x
    ), '[]'::jsonb),
    'en_espera', coalesce((
      select jsonb_agg(x order by x.orden) from (
        select t.turn_number as turno, p.full_name as nombre, a.starts_at as orden
          from public.waiting_room_turns t
          join public.appointments a on a.id = t.appointment_id
          join public.patients p on p.id = a.patient_id
         where t.clinic_id = d.clinic_id and t.branch_id = d.branch_id
           and t.turn_date = v_hoy and t.called_at is null
           and a.status = 'en-sala'
         order by a.starts_at
         limit 8
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ─── Pantalla del box ─────────────────────────────────────────────────────

-- Citas de hoy en el box del dispositivo (la del box o, sin box, la del box
-- por defecto del profesional, como la agenda).
create or replace function public.box_estado(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d public.clinic_devices%rowtype;
  v_zona text;
  v_hoy date;
begin
  d := public.dispositivo_de_tipo(p_device_id, 'box');
  if d.id is null then
    return jsonb_build_object('ok', false);
  end if;
  if d.operatory_id is null then
    return jsonb_build_object('ok', true, 'sin_box', true, 'citas', '[]'::jsonb);
  end if;
  select coalesce(b.timezone, c.timezone, 'America/Santiago') into v_zona
    from public.branches b join public.clinics c on c.id = b.clinic_id
   where b.id = d.branch_id;
  v_hoy := (now() at time zone v_zona)::date;

  return jsonb_build_object(
    'ok', true,
    'sin_box', false,
    'citas', coalesce((
      select jsonb_agg(x order by x.inicio) from (
        select a.id, a.starts_at as inicio, a.ends_at as fin, a.status as estado,
               p.full_name as nombre, a.treatment_label as tratamiento,
               pr.full_name as profesional,
               t.turn_number as turno, t.called_at as llamado_en,
               (t.called_operatory_id = d.operatory_id) as llamado_aqui
          from public.appointments a
          join public.patients p on p.id = a.patient_id
          join public.professionals pr on pr.id = a.professional_id
          left join public.waiting_room_turns t on t.appointment_id = a.id
         where a.clinic_id = d.clinic_id and a.branch_id = d.branch_id
           and a.status not in ('cancelada', 'ausente')
           and (a.starts_at at time zone v_zona)::date = v_hoy
           and coalesce(a.operatory_id, pr.default_operatory_id) = d.operatory_id
         order by a.starts_at
         limit 40
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.dispositivo_llamar(p_device_id uuid, p_appointment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d public.clinic_devices%rowtype;
  a record;
begin
  d := public.dispositivo_de_tipo(p_device_id, 'box');
  if d.id is null or d.operatory_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'dispositivo');
  end if;
  select ap.id, ap.status into a
    from public.appointments ap
    left join public.professionals pr on pr.id = ap.professional_id
   where ap.id = p_appointment_id
     and ap.clinic_id = d.clinic_id
     and ap.branch_id = d.branch_id
     and coalesce(ap.operatory_id, pr.default_operatory_id) = d.operatory_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;
  if a.status <> 'en-sala' then
    return jsonb_build_object('ok', false, 'motivo', 'no_en_sala');
  end if;
  return public.sala_registrar_llamado(a.id, d.operatory_id, null, d.id);
end;
$$;

-- ─── Permisos: solo el rol de servicio ─────────────────────────────────────

revoke all on function public.dispositivo_vincular(text, text) from public, anon, authenticated;
revoke all on function public.dispositivo_por_token(text) from public, anon, authenticated;
revoke all on function public.dispositivo_de_tipo(uuid, text) from public, anon, authenticated;
revoke all on function public.totem_identificar(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.totem_paciente_de_sesion(uuid, text) from public, anon, authenticated;
revoke all on function public.totem_terminar(uuid, text) from public, anon, authenticated;
revoke all on function public.totem_resumen(uuid, text) from public, anon, authenticated;
revoke all on function public.totem_marcar_llegada(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.totem_agendar(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.sala_estado(uuid) from public, anon, authenticated;
revoke all on function public.box_estado(uuid) from public, anon, authenticated;
revoke all on function public.dispositivo_llamar(uuid, uuid) from public, anon, authenticated;

grant execute on function public.dispositivo_vincular(text, text) to service_role;
grant execute on function public.dispositivo_por_token(text) to service_role;
grant execute on function public.dispositivo_de_tipo(uuid, text) to service_role;
grant execute on function public.totem_identificar(uuid, text, text, text, text) to service_role;
grant execute on function public.totem_paciente_de_sesion(uuid, text) to service_role;
grant execute on function public.totem_terminar(uuid, text) to service_role;
grant execute on function public.totem_resumen(uuid, text) to service_role;
grant execute on function public.totem_marcar_llegada(uuid, text, uuid) to service_role;
grant execute on function public.totem_agendar(uuid, text, jsonb) to service_role;
grant execute on function public.sala_estado(uuid) to service_role;
grant execute on function public.box_estado(uuid) to service_role;
grant execute on function public.dispositivo_llamar(uuid, uuid) to service_role;

commit;

-- ─── Reversa (no se corre sola) ────────────────────────────────────────────
-- drop function if exists public.dispositivo_llamar(uuid, uuid);
-- drop function if exists public.box_estado(uuid);
-- drop function if exists public.sala_estado(uuid);
-- drop function if exists public.totem_agendar(uuid, text, jsonb);
-- drop function if exists public.totem_marcar_llegada(uuid, text, uuid);
-- drop function if exists public.totem_resumen(uuid, text);
-- drop function if exists public.totem_terminar(uuid, text);
-- drop function if exists public.totem_paciente_de_sesion(uuid, text);
-- drop function if exists public.totem_identificar(uuid, text, text, text, text);
-- drop function if exists public.dispositivo_de_tipo(uuid, text);
-- drop function if exists public.dispositivo_por_token(text);
-- drop function if exists public.dispositivo_vincular(text, text);
-- drop table if exists public.totem_identifications;
