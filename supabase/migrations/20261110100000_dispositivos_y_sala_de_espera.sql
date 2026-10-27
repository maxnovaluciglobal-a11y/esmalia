-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 14 · Frente A (1/2): dispositivos de la clínica y turnos de la sala de
-- espera (AUT-06, AUT-04, AUT-05).
--
--   clinic_devices        tablet de recepción (tótem), TV de la sala o
--                         pantalla del box. Se vincula con un código de un
--                         solo uso que vence en 10 minutos; el dispositivo
--                         recibe un token propio. La base guarda SOLO la
--                         huella sha256 del código y del token. Revocable.
--                         Lectura: owner/admin. Escritura: solo por las
--                         funciones de abajo (nadie fija una huella a mano).
--   waiting_room_turns    número de turno del día por sucursal y llamados a
--                         sala ("pase al box 2"). Una fila por cita. La crea
--                         el trigger cuando la cita pasa a 'en-sala' (desde la
--                         agenda o desde el tótem). Lectura: miembros de la
--                         clínica. Escritura: solo por funciones.
--
-- Funciones para la app (authenticated, SECURITY DEFINER con chequeo propio):
--   dispositivo_crear / _editar / _emitir_codigo / _revocar   owner/admin
--   llamar_a_sala                                             roles de agenda
-- Internas (sin EXECUTE para nadie): sala_asignar_turno, sala_registrar_llamado.
--
-- Aditiva: dos tablas nuevas y un trigger nuevo en appointments que solo
-- inserta en waiting_room_turns. No redefine funciones existentes. No escribe
-- datos. Reversa al pie.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1. Dispositivos ───────────────────────────────────────────────────────

create table if not exists public.clinic_devices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  kind text not null check (kind in ('totem', 'sala', 'box')),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  -- Pantalla del box: qué box muestra. Null en tótem y sala.
  operatory_id uuid references public.operatories(id) on delete set null,
  -- Sala de espera: cómo se nombra al paciente llamado. Nunca RUT ni motivo.
  privacy_mode text not null default 'iniciales'
    check (privacy_mode in ('turno', 'iniciales', 'nombre_corto')),
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  pairing_code_hash text unique check (pairing_code_hash ~ '^[0-9a-f]{64}$'),
  pairing_expires_at timestamptz,
  paired_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_devices_revocado_sin_token
    check (revoked_at is null or (token_hash is null and pairing_code_hash is null))
);

comment on table public.clinic_devices is
  'AUT-06: dispositivos vinculados (tótem, sala, box). Solo la huella del token y del código de vinculación.';

create index if not exists clinic_devices_clinic_idx on public.clinic_devices (clinic_id, created_at);

-- Sucursal y box de la misma clínica (y el box, de esa sucursal).
create or replace function public.clinic_devices_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.branches b where b.id = new.branch_id and b.clinic_id = new.clinic_id
  ) then
    raise exception 'La sucursal no es de esta clínica.' using errcode = '23503';
  end if;
  if new.operatory_id is not null and not exists (
    select 1 from public.operatories o
     where o.id = new.operatory_id and o.clinic_id = new.clinic_id and o.branch_id = new.branch_id
  ) then
    raise exception 'El box no es de la sucursal del dispositivo.' using errcode = '23503';
  end if;
  if new.kind <> 'box' then
    new.operatory_id := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.clinic_devices_validar() from public, anon, authenticated;

drop trigger if exists clinic_devices_validar on public.clinic_devices;
create trigger clinic_devices_validar
  before insert or update on public.clinic_devices
  for each row execute function public.clinic_devices_validar();

drop trigger if exists block_demo_writes on public.clinic_devices;
create trigger block_demo_writes
  before insert or update or delete on public.clinic_devices
  for each row execute function public.block_demo_writes();

alter table public.clinic_devices enable row level security;

drop policy if exists clinic_devices_select_managers on public.clinic_devices;
create policy clinic_devices_select_managers on public.clinic_devices
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

-- Solo lectura para la app (owner/admin por la política); las escrituras van
-- por las funciones dispositivo_* (que validan y calculan las huellas).
grant select on public.clinic_devices to authenticated;
grant all on public.clinic_devices to service_role;
revoke insert, update, delete on public.clinic_devices from authenticated;

-- ─── 2. Turnos y llamados de la sala de espera ────────────────────────────

create table if not exists public.waiting_room_turns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  turn_date date not null,
  turn_number integer not null check (turn_number > 0),
  checked_in_at timestamptz not null default now(),
  checked_in_via text not null default 'recepcion' check (checked_in_via in ('totem', 'recepcion')),
  called_at timestamptz,
  call_count integer not null default 0 check (call_count >= 0),
  called_operatory_id uuid references public.operatories(id) on delete set null,
  called_by uuid references auth.users(id) on delete set null,
  called_by_device_id uuid references public.clinic_devices(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (branch_id, turn_date, turn_number)
);

comment on table public.waiting_room_turns is
  'AUT-04/05: turno del día por sucursal y llamados a sala. Una fila por cita; la crea el trigger al pasar a en-sala.';

create index if not exists waiting_room_turns_dia_idx
  on public.waiting_room_turns (clinic_id, branch_id, turn_date);

drop trigger if exists block_demo_writes on public.waiting_room_turns;
create trigger block_demo_writes
  before insert or update or delete on public.waiting_room_turns
  for each row execute function public.block_demo_writes();

alter table public.waiting_room_turns enable row level security;

drop policy if exists waiting_room_turns_select_members on public.waiting_room_turns;
create policy waiting_room_turns_select_members on public.waiting_room_turns
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists mfa_exige_aal2 on public.waiting_room_turns;
create policy mfa_exige_aal2 on public.waiting_room_turns
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

grant select on public.waiting_room_turns to authenticated;
grant all on public.waiting_room_turns to service_role;
revoke insert, update, delete on public.waiting_room_turns from authenticated;

-- Turno del día (por sucursal, en la hora local de la sucursal) para una cita
-- de hoy; null si la cita no es de hoy. Correlativo
-- diario: candado por sucursal y día + UNIQUE (branch_id, turn_date,
-- turn_number). No usa next_clinic_counter porque esa exige un usuario
-- miembro (acá llama también el servidor por el tótem) y dejaría una fila por
-- sucursal y día en clinic_counters.
create or replace function public.sala_asignar_turno(p_appointment_id uuid, p_via text)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a record;
  v_dia date;
  v_turno integer;
begin
  select t.turn_number into v_turno
    from public.waiting_room_turns t where t.appointment_id = p_appointment_id;
  if v_turno is not null then
    return v_turno;
  end if;

  select ap.id, ap.clinic_id, ap.branch_id, ap.starts_at,
         coalesce(b.timezone, c.timezone, 'America/Santiago') as zona
    into a
    from public.appointments ap
    join public.clinics c on c.id = ap.clinic_id
    left join public.branches b on b.id = ap.branch_id
   where ap.id = p_appointment_id;
  if not found or a.branch_id is null then
    return null;
  end if;

  -- Solo citas de hoy (hora local de la sucursal): un turno es del día.
  v_dia := (a.starts_at at time zone a.zona)::date;
  if v_dia <> (now() at time zone a.zona)::date then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('turno-sala:' || a.branch_id::text || ':' || v_dia::text, 0));

  select coalesce(max(t.turn_number), 0) + 1 into v_turno
    from public.waiting_room_turns t
   where t.branch_id = a.branch_id and t.turn_date = v_dia;

  insert into public.waiting_room_turns
    (clinic_id, branch_id, appointment_id, turn_date, turn_number, checked_in_via)
  values
    (a.clinic_id, a.branch_id, a.id, v_dia, v_turno,
     case when p_via = 'totem' then 'totem' else 'recepcion' end)
  on conflict (appointment_id) do nothing;

  select t.turn_number into v_turno
    from public.waiting_room_turns t where t.appointment_id = p_appointment_id;
  return v_turno;
end;
$$;

revoke all on function public.sala_asignar_turno(uuid, text) from public, anon, authenticated;
grant execute on function public.sala_asignar_turno(uuid, text) to service_role;

-- Al pasar a 'en-sala' (desde la agenda, el panel o el tótem) la cita recibe
-- su turno del día. Si ya lo tenía (el tótem lo asigna antes), no hace nada.
create or replace function public.sala_turno_al_pasar_a_sala()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'en-sala'
     and (tg_op = 'INSERT' or old.status is distinct from 'en-sala') then
    perform public.sala_asignar_turno(new.id, 'recepcion');
  end if;
  return null;
end;
$$;

revoke all on function public.sala_turno_al_pasar_a_sala() from public, anon, authenticated;

drop trigger if exists appointments_turno_de_sala on public.appointments;
create trigger appointments_turno_de_sala
  after insert or update of status on public.appointments
  for each row execute function public.sala_turno_al_pasar_a_sala();

-- Registra el llamado: turno (si faltaba), hora, box y quién llamó.
create or replace function public.sala_registrar_llamado(
  p_appointment_id uuid,
  p_operatory_id uuid,
  p_user_id uuid,
  p_device_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_turno integer;
  v_box uuid;
  v_box_nombre text;
begin
  v_turno := public.sala_asignar_turno(p_appointment_id, 'recepcion');
  if v_turno is null then
    return jsonb_build_object('ok', false, 'motivo', 'invalida');
  end if;

  select coalesce(p_operatory_id, ap.operatory_id, pr.default_operatory_id) into v_box
    from public.appointments ap
    left join public.professionals pr on pr.id = ap.professional_id
   where ap.id = p_appointment_id;
  select o.name into v_box_nombre from public.operatories o where o.id = v_box;

  update public.waiting_room_turns
     set called_at = now(),
         call_count = call_count + 1,
         called_operatory_id = v_box,
         called_by = p_user_id,
         called_by_device_id = p_device_id
   where appointment_id = p_appointment_id;

  return jsonb_build_object('ok', true, 'turno', v_turno, 'box', v_box_nombre);
end;
$$;

revoke all on function public.sala_registrar_llamado(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.sala_registrar_llamado(uuid, uuid, uuid, uuid) to service_role;

-- "Llamar" desde la agenda o el panel: roles de agenda (los que pueden mover
-- una cita a 'en-sala'), sin el permiso de agenda quitado, fuera de la demo.
create or replace function public.llamar_a_sala(p_appointment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a record;
begin
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  if not public.sesion_cumple_mfa() then
    raise exception 'Se requiere verificación en dos pasos.' using errcode = '42501';
  end if;

  select ap.id, ap.clinic_id, ap.status into a
    from public.appointments ap where ap.id = p_appointment_id;
  if not found
     or not public.has_clinic_role(a.clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
     or public.permiso_quitado(a.clinic_id, 'agenda:manage') then
    raise exception 'No tienes permisos para llamar pacientes.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinics c where c.id = a.clinic_id and c.is_demo) then
    raise exception 'Esta es la clínica demo, de solo lectura. Crea tu clínica real para guardar cambios.';
  end if;
  if a.status <> 'en-sala' then
    return jsonb_build_object('ok', false, 'motivo', 'no_en_sala');
  end if;
  return public.sala_registrar_llamado(a.id, null, auth.uid(), null);
end;
$$;

revoke all on function public.llamar_a_sala(uuid) from public, anon;
grant execute on function public.llamar_a_sala(uuid) to authenticated, service_role;

-- ─── 3. Gestión de dispositivos (owner/admin) ─────────────────────────────

create or replace function public.dispositivos_puede_gestionar(p_clinic_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_clinic_id is null or not public.can_manage_clinic(p_clinic_id) then
    raise exception 'No tienes permisos para administrar los dispositivos.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinics c where c.id = p_clinic_id and c.is_demo) then
    raise exception 'Esta es la clínica demo, de solo lectura. Crea tu clínica real para guardar cambios.';
  end if;
end;
$$;

revoke all on function public.dispositivos_puede_gestionar(uuid) from public, anon, authenticated;

create or replace function public.dispositivo_crear(
  p_clinic_id uuid,
  p_branch_id uuid,
  p_kind text,
  p_name text,
  p_operatory_id uuid,
  p_privacy_mode text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.dispositivos_puede_gestionar(p_clinic_id);
  insert into public.clinic_devices
    (clinic_id, branch_id, kind, name, operatory_id, privacy_mode, created_by)
  values
    (p_clinic_id, p_branch_id, p_kind, btrim(p_name), p_operatory_id,
     coalesce(p_privacy_mode, 'iniciales'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.dispositivo_editar(
  p_device_id uuid,
  p_name text,
  p_operatory_id uuid,
  p_privacy_mode text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.clinic_devices where id = p_device_id;
  perform public.dispositivos_puede_gestionar(v_clinic);
  update public.clinic_devices
     set name = btrim(p_name),
         operatory_id = p_operatory_id,
         privacy_mode = coalesce(p_privacy_mode, privacy_mode)
   where id = p_device_id and clinic_id = v_clinic and revoked_at is null;
  if not found then
    raise exception 'El dispositivo no existe o está revocado.';
  end if;
end;
$$;

-- Código de vinculación: el servidor genera el código, acá llega su huella.
-- Vence en 10 minutos y sirve una sola vez. Emitir otro reemplaza al anterior.
create or replace function public.dispositivo_emitir_codigo(p_device_id uuid, p_code_hash text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_vence timestamptz := now() + interval '10 minutes';
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Código inválido.';
  end if;
  select clinic_id into v_clinic from public.clinic_devices where id = p_device_id;
  perform public.dispositivos_puede_gestionar(v_clinic);
  update public.clinic_devices
     set pairing_code_hash = p_code_hash, pairing_expires_at = v_vence
   where id = p_device_id and clinic_id = v_clinic and revoked_at is null;
  if not found then
    raise exception 'El dispositivo no existe o está revocado.';
  end if;
  return v_vence;
end;
$$;

-- Revocar: el token deja de servir en la próxima llamada. No se deshace.
create or replace function public.dispositivo_revocar(p_device_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.clinic_devices where id = p_device_id;
  perform public.dispositivos_puede_gestionar(v_clinic);
  update public.clinic_devices
     set revoked_at = now(),
         revoked_by = auth.uid(),
         token_hash = null,
         pairing_code_hash = null,
         pairing_expires_at = null
   where id = p_device_id and clinic_id = v_clinic and revoked_at is null;
end;
$$;

revoke all on function public.dispositivo_crear(uuid, uuid, text, text, uuid, text) from public, anon;
revoke all on function public.dispositivo_editar(uuid, text, uuid, text) from public, anon;
revoke all on function public.dispositivo_emitir_codigo(uuid, text) from public, anon;
revoke all on function public.dispositivo_revocar(uuid) from public, anon;
grant execute on function public.dispositivo_crear(uuid, uuid, text, text, uuid, text) to authenticated, service_role;
grant execute on function public.dispositivo_editar(uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.dispositivo_emitir_codigo(uuid, text) to authenticated, service_role;
grant execute on function public.dispositivo_revocar(uuid) to authenticated, service_role;

commit;

-- ─── Reversa (no se corre sola) ────────────────────────────────────────────
-- drop function if exists public.dispositivo_revocar(uuid);
-- drop function if exists public.dispositivo_emitir_codigo(uuid, text);
-- drop function if exists public.dispositivo_editar(uuid, text, uuid, text);
-- drop function if exists public.dispositivo_crear(uuid, uuid, text, text, uuid, text);
-- drop function if exists public.dispositivos_puede_gestionar(uuid);
-- drop function if exists public.llamar_a_sala(uuid);
-- drop function if exists public.sala_registrar_llamado(uuid, uuid, uuid, uuid);
-- drop trigger if exists appointments_turno_de_sala on public.appointments;
-- drop function if exists public.sala_turno_al_pasar_a_sala();
-- drop function if exists public.sala_asignar_turno(uuid, text);
-- drop policy if exists mfa_exige_aal2 on public.waiting_room_turns;
-- drop table if exists public.waiting_room_turns;
-- drop table if exists public.clinic_devices;
-- drop function if exists public.clinic_devices_validar();
