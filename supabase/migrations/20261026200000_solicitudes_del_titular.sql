-- Ola 5 · Frente Derechos del titular y brechas (1/2): SEG-09, solicitudes
-- del titular de los datos (Ley 21.719, Chile).
--
-- El paciente ejerce desde su portal (o por otro canal que la clínica
-- registra) sus derechos de acceso, rectificación, supresión, oposición,
-- portabilidad y bloqueo. La clínica los ve en una bandeja con el plazo
-- legal y responde por escrito; la respuesta puede salir por correo y queda
-- la evidencia.
--
--   1. data_subject_requests: una fila por solicitud. Tres canales:
--      * 'portal': el paciente la pidió desde su portal y espera respuesta.
--        La inserta el servidor con el rol de servicio (el portal no tiene
--        sesión de Supabase: link firmado, ver portal.functions.ts).
--      * 'portal_automatico': el portal la resolvió en el acto (descarga de
--        sus datos, baja de comunicaciones). Entra ya respondida, con el
--        texto de lo que se entregó o se hizo. También la escribe solo el
--        rol de servicio.
--      * 'clinica': la recibió la clínica por otro canal (correo, en
--        persona) y la registra un owner/admin. La fecha de recepción puede
--        ser de hasta 90 días atrás: el plazo corre desde que llegó.
--   2. Plazo: 30 días corridos desde la recepción, contados en el huso de
--      la clínica (`clinics.timezone`), prorrogable UNA vez por otros 30 con
--      motivo (BORRADOR para el abogado). La base fija `due_date` al
--      insertar y `extended_due_date` al prorrogar: nadie lo escribe a mano.
--   3. Estados: recibida → en_revision → respondida | rechazada (rechazada =
--      se responde fundadamente que no procede, p. ej. la supresión de la
--      ficha clínica, que el Decreto 41 obliga a conservar 15 años). Cerrar
--      exige una respuesta escrita; la base estampa quién y cuándo. Una
--      solicitud cerrada no se edita: solo se le anota el correo con que se
--      envió la respuesta (`response_message_id`), que tiene que ser un
--      correo de esa clínica, a ese paciente y enviado por quien lo anota.
--   4. data_subject_request_events: bitácora de cada solicitud (recibida,
--      en revisión, prorrogada, respondida, rechazada, correo enviado). La
--      escribe un trigger, nadie más; no se edita ni se borra.
--   5. Nada se borra: sin política ni permiso de DELETE, y un trigger lo
--      impide también al rol de servicio (salvo la cascada al borrar la
--      clínica entera).
--
-- Solo owner/admin leen y gestionan (can_manage_clinic). Las dos tablas
-- identifican a un paciente: llevan la política `mfa_exige_aal2`
-- (TABLAS_CON_AAL2 en src/lib/auth/mfa-rls.ts). La clínica demo no escribe
-- (block_demo_writes).
--
-- Compatible con el código en producción (RUNBOOK regla 3): dos tablas y
-- funciones nuevas; no toca nada existente. Reversa al pie.

begin;

-- ─── 1. Solicitudes ────────────────────────────────────────────────────────

create table if not exists public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- Sin ON DELETE: los pacientes no se borran (se archivan, #79).
  patient_id uuid not null references public.patients(id),
  kind text not null,
  channel text not null,
  -- Lo que pide el titular, en sus palabras (rectificación: qué dato y cómo
  -- debería quedar).
  detail text,
  status text not null default 'recibida',
  received_at timestamptz not null default now(),
  -- Último día para responder (fecha civil en el huso de la clínica). Lo
  -- fija el trigger; prorrogar escribe extended_due_date.
  due_date date not null,
  extended_due_date date,
  extension_reason text,
  extended_at timestamptz,
  extended_by uuid,
  response text,
  responded_at timestamptz,
  -- Sin clave foránea a auth.users, igual que los otros registros de
  -- auditoría (20260907220000): el registro no impide borrar un usuario.
  responded_by uuid,
  -- Correo con que se envió la respuesta (messages.id). Sin clave foránea
  -- por la misma razón; el trigger valida que exista y sea de esta clínica.
  response_message_id uuid,
  registered_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_subject_requests_kind_check check (kind in (
    'acceso', 'rectificacion', 'supresion', 'oposicion', 'portabilidad', 'bloqueo'
  )),
  constraint data_subject_requests_channel_check check (channel in (
    'portal', 'portal_automatico', 'clinica'
  )),
  constraint data_subject_requests_status_check check (status in (
    'recibida', 'en_revision', 'respondida', 'rechazada'
  )),
  constraint data_subject_requests_detail_check
    check (detail is null or char_length(detail) <= 2000),
  constraint data_subject_requests_response_check
    check (response is null or char_length(response) <= 8000),
  constraint data_subject_requests_extension_reason_check
    check (extension_reason is null or char_length(extension_reason) <= 1000),
  -- Cerrada ⇔ tiene fecha de respuesta y un texto de respuesta.
  constraint data_subject_requests_cierre_check check (
    (status in ('respondida', 'rechazada')) = (responded_at is not null)
    and (status not in ('respondida', 'rechazada') or char_length(btrim(coalesce(response, ''))) >= 10)
  ),
  constraint data_subject_requests_prorroga_check check (
    (extended_due_date is null) = (extended_at is null)
    and (extended_due_date is null or char_length(btrim(coalesce(extension_reason, ''))) >= 10)
  )
);

comment on table public.data_subject_requests is
  'SEG-09 (Ley 21.719): solicitudes del titular (acceso, rectificación, supresión, oposición, portabilidad, bloqueo) con plazo legal. La leen y gestionan owner/admin; el portal inserta con el rol de servicio. No se borran.';

-- Bandeja: abiertas primero por vencimiento, y todas por fecha.
create index if not exists data_subject_requests_clinic_received_idx
  on public.data_subject_requests (clinic_id, received_at desc);
create index if not exists data_subject_requests_clinic_abiertas_idx
  on public.data_subject_requests (clinic_id, due_date)
  where status in ('recibida', 'en_revision');
-- Portal: las solicitudes del paciente y el tope diario.
create index if not exists data_subject_requests_patient_idx
  on public.data_subject_requests (clinic_id, patient_id, received_at desc);

-- Reglas de negocio. SECURITY INVOKER a propósito: `current_user` tiene que
-- ser el de quien escribe (authenticated o service_role) para distinguir el
-- portal (rol de servicio) del equipo. Lee clinics, patients y messages con
-- la RLS de quien escribe, que es owner/admin de esa clínica.
create or replace function public.data_subject_requests_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_servicio boolean := auth.uid() is null and current_user in ('service_role', 'postgres');
  v_tz text;
  v_hoy date;
  v_msg record;
begin
  select coalesce(nullif(c.timezone, ''), 'America/Santiago') into v_tz
    from public.clinics c where c.id = new.clinic_id;
  if v_tz is null then
    raise exception 'La clínica no existe.' using errcode = '23503';
  end if;
  v_hoy := (now() at time zone v_tz)::date;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.patients p where p.id = new.patient_id and p.clinic_id = new.clinic_id
    ) then
      raise exception 'El paciente no pertenece a esta clínica.' using errcode = '23503';
    end if;

    new.created_at := now();
    new.updated_at := now();
    new.extended_due_date := null;
    new.extension_reason := null;
    new.extended_at := null;
    new.extended_by := null;
    new.response_message_id := null;

    if new.channel = 'clinica' then
      if v_uid is null or not public.can_manage_clinic(new.clinic_id) then
        raise exception 'Solo el propietario o un administrador registra solicitudes.' using errcode = '42501';
      end if;
      -- Llegó por otro canal: el plazo corre desde que llegó, no desde que
      -- se anotó. Hasta 90 días atrás; nunca en el futuro.
      if new.received_at is null or new.received_at > now() then
        new.received_at := now();
      elsif new.received_at < now() - interval '90 days' then
        raise exception 'La fecha de recepción no puede ser de hace más de 90 días.' using errcode = '23514';
      end if;
      new.registered_by := v_uid;
      new.status := 'recibida';
      new.response := null;
      new.responded_at := null;
      new.responded_by := null;
    else
      -- 'portal' y 'portal_automatico' los escribe solo el servidor del
      -- portal, con el rol de servicio.
      if not v_servicio then
        raise exception 'Las solicitudes del portal las registra solo el portal.' using errcode = '42501';
      end if;
      new.received_at := now();
      new.registered_by := null;
      new.responded_by := null;
      if new.channel = 'portal_automatico' then
        if char_length(btrim(coalesce(new.response, ''))) < 10 then
          raise exception 'Una solicitud resuelta por el portal lleva el detalle de lo entregado.' using errcode = '23514';
        end if;
        new.status := 'respondida';
        new.responded_at := now();
      else
        new.status := 'recibida';
        new.response := null;
        new.responded_at := null;
      end if;
    end if;

    new.due_date := (new.received_at at time zone v_tz)::date + 30;
    return new;
  end if;

  -- UPDATE ─────────────────────────────────────────────────────────────────
  if new.clinic_id is distinct from old.clinic_id
     or new.patient_id is distinct from old.patient_id
     or new.kind is distinct from old.kind
     or new.channel is distinct from old.channel
     or new.detail is distinct from old.detail
     or new.received_at is distinct from old.received_at
     or new.due_date is distinct from old.due_date
     or new.registered_by is distinct from old.registered_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Lo que pidió el paciente y cuándo llegó no se edita.' using errcode = '23514';
  end if;

  if old.status in ('respondida', 'rechazada') then
    if new.status is distinct from old.status
       or new.response is distinct from old.response
       or new.responded_at is distinct from old.responded_at
       or new.responded_by is distinct from old.responded_by
       or new.extended_due_date is distinct from old.extended_due_date
       or new.extension_reason is distinct from old.extension_reason
       or new.extended_at is distinct from old.extended_at
       or new.extended_by is distinct from old.extended_by
    then
      raise exception 'Una solicitud ya respondida no se edita.' using errcode = '23514';
    end if;
  else
    -- Transiciones: recibida → en_revision; abierta → respondida | rechazada.
    if new.status is distinct from old.status then
      if not (
        (old.status = 'recibida' and new.status = 'en_revision')
        or new.status in ('respondida', 'rechazada')
      ) then
        raise exception 'Cambio de estado no permitido.' using errcode = '23514';
      end if;
    end if;

    if new.status in ('respondida', 'rechazada') then
      if char_length(btrim(coalesce(new.response, ''))) < 10 then
        raise exception 'Escribe la respuesta al paciente (al menos 10 caracteres).' using errcode = '23514';
      end if;
      new.response := btrim(new.response);
      new.responded_at := now();
      new.responded_by := v_uid;
    else
      new.response := old.response;
      new.responded_at := old.responded_at;
      new.responded_by := old.responded_by;
    end if;

    -- Prórroga: una sola vez, antes de que venza, con motivo.
    if new.extended_due_date is distinct from old.extended_due_date
       or new.extension_reason is distinct from old.extension_reason
    then
      if old.extended_due_date is not null then
        raise exception 'El plazo ya se prorrogó una vez.' using errcode = '23514';
      end if;
      if new.extended_due_date is null then
        raise exception 'Prórroga incompleta.' using errcode = '23514';
      end if;
      if v_hoy > old.due_date then
        raise exception 'El plazo ya venció: no se puede prorrogar.' using errcode = '23514';
      end if;
      if char_length(btrim(coalesce(new.extension_reason, ''))) < 10 then
        raise exception 'Explica el motivo de la prórroga (al menos 10 caracteres).' using errcode = '23514';
      end if;
      new.extended_due_date := old.due_date + 30;
      new.extension_reason := btrim(new.extension_reason);
      new.extended_at := now();
      new.extended_by := v_uid;
    else
      new.extended_at := old.extended_at;
      new.extended_by := old.extended_by;
    end if;
  end if;

  -- Correo de la respuesta: se anota una vez, ya cerrada, y tiene que ser
  -- un correo de esta clínica a este paciente, enviado por quien lo anota.
  if new.response_message_id is distinct from old.response_message_id then
    if old.response_message_id is not null or new.response_message_id is null then
      raise exception 'El correo de la respuesta ya quedó registrado.' using errcode = '23514';
    end if;
    if new.status not in ('respondida', 'rechazada') then
      raise exception 'Primero registra la respuesta.' using errcode = '23514';
    end if;
    select m.clinic_id, m.patient_id, m.channel, m.sent_by into v_msg
      from public.messages m where m.id = new.response_message_id;
    if not found
       or v_msg.clinic_id <> new.clinic_id
       or v_msg.patient_id <> new.patient_id
       or v_msg.channel <> 'email'
       or (v_uid is not null and v_msg.sent_by is distinct from v_uid)
    then
      raise exception 'El correo no corresponde a esta solicitud.' using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.data_subject_requests_proteger() from public, anon, authenticated;

drop trigger if exists data_subject_requests_proteger on public.data_subject_requests;
create trigger data_subject_requests_proteger
  before insert or update on public.data_subject_requests
  for each row execute function public.data_subject_requests_proteger();

-- No se borra: ni la app ni el rol de servicio. Solo la cascada al borrar
-- la clínica entera (en ese momento la clínica ya no existe).
create or replace function public.registro_titular_inmutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.clinics c where c.id = old.clinic_id) then
    return old;
  end if;
  raise exception 'Este registro no se borra ni se edita.' using errcode = '42501';
end;
$$;

revoke execute on function public.registro_titular_inmutable() from public, anon, authenticated;

drop trigger if exists data_subject_requests_sin_borrar on public.data_subject_requests;
create trigger data_subject_requests_sin_borrar
  before delete on public.data_subject_requests
  for each row execute function public.registro_titular_inmutable();

drop trigger if exists block_demo_writes on public.data_subject_requests;
create trigger block_demo_writes
  before insert or update or delete on public.data_subject_requests
  for each row execute function public.block_demo_writes();

-- ─── 2. Bitácora de cada solicitud ─────────────────────────────────────────

create table if not exists public.data_subject_request_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  request_id uuid not null references public.data_subject_requests(id) on delete cascade,
  event text not null,
  -- NULL = el portal o el sistema.
  actor_id uuid,
  note text,
  created_at timestamptz not null default now(),
  constraint data_subject_request_events_event_check check (event in (
    'recibida', 'en_revision', 'prorrogada', 'respondida', 'rechazada', 'correo_enviado'
  ))
);

comment on table public.data_subject_request_events IS
  'SEG-09: bitácora de cada solicitud del titular. La escribe solo el trigger de data_subject_requests; no se edita ni se borra.';

create index if not exists data_subject_request_events_request_idx
  on public.data_subject_request_events (request_id, created_at);
create index if not exists data_subject_request_events_clinic_idx
  on public.data_subject_request_events (clinic_id, created_at desc);

drop trigger if exists data_subject_request_events_inmutable on public.data_subject_request_events;
create trigger data_subject_request_events_inmutable
  before update or delete on public.data_subject_request_events
  for each row execute function public.registro_titular_inmutable();

-- Escribe la bitácora. SECURITY DEFINER: la tabla no tiene permiso de
-- escritura para nadie más.
create or replace function public.data_subject_requests_bitacora()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.data_subject_request_events (clinic_id, request_id, event, actor_id, note)
    values (new.clinic_id, new.id, 'recibida', v_uid,
            case new.channel
              when 'clinica' then 'Registrada por la clínica'
              when 'portal_automatico' then 'Pedida y resuelta en el portal'
              else 'Pedida desde el portal'
            end);
    if new.status = 'respondida' then
      insert into public.data_subject_request_events (clinic_id, request_id, event, actor_id, note)
      values (new.clinic_id, new.id, 'respondida', v_uid, new.response);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.data_subject_request_events (clinic_id, request_id, event, actor_id, note)
    values (new.clinic_id, new.id, new.status, v_uid,
            case when new.status in ('respondida', 'rechazada') then new.response end);
  end if;
  if new.extended_due_date is distinct from old.extended_due_date then
    insert into public.data_subject_request_events (clinic_id, request_id, event, actor_id, note)
    values (new.clinic_id, new.id, 'prorrogada', v_uid, new.extension_reason);
  end if;
  if new.response_message_id is distinct from old.response_message_id then
    insert into public.data_subject_request_events (clinic_id, request_id, event, actor_id, note)
    values (new.clinic_id, new.id, 'correo_enviado', v_uid, null);
  end if;
  return new;
end;
$$;

revoke execute on function public.data_subject_requests_bitacora() from public, anon, authenticated;

drop trigger if exists data_subject_requests_bitacora on public.data_subject_requests;
create trigger data_subject_requests_bitacora
  after insert or update on public.data_subject_requests
  for each row execute function public.data_subject_requests_bitacora();

-- ─── 3. Permisos y RLS ─────────────────────────────────────────────────────

revoke all on public.data_subject_requests from public, anon, authenticated;
grant select, insert, update on public.data_subject_requests to authenticated;
grant all on public.data_subject_requests to service_role;
alter table public.data_subject_requests enable row level security;

drop policy if exists data_subject_requests_select_gestion on public.data_subject_requests;
create policy data_subject_requests_select_gestion on public.data_subject_requests
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

drop policy if exists data_subject_requests_insert_gestion on public.data_subject_requests;
create policy data_subject_requests_insert_gestion on public.data_subject_requests
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id) and channel = 'clinica');

drop policy if exists data_subject_requests_update_gestion on public.data_subject_requests;
create policy data_subject_requests_update_gestion on public.data_subject_requests
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

revoke all on public.data_subject_request_events from public, anon, authenticated;
grant select on public.data_subject_request_events to authenticated;
grant all on public.data_subject_request_events to service_role;
alter table public.data_subject_request_events enable row level security;

drop policy if exists data_subject_request_events_select_gestion on public.data_subject_request_events;
create policy data_subject_request_events_select_gestion on public.data_subject_request_events
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

-- SEG-01: quien activó MFA necesita una sesión aal2 (docs/MFA.md).
drop policy if exists mfa_exige_aal2 on public.data_subject_request_events;
create policy mfa_exige_aal2 on public.data_subject_request_events
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.data_subject_requests;
create policy mfa_exige_aal2 on public.data_subject_requests
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- Cómo revertir (se pierden las solicitudes registradas y su bitácora;
-- exportarlas antes desde la bandeja si hay alguna):
--
-- begin;
-- drop policy if exists mfa_exige_aal2 on public.data_subject_request_events;
-- drop policy if exists mfa_exige_aal2 on public.data_subject_requests;
-- drop table if exists public.data_subject_request_events;
-- drop table if exists public.data_subject_requests;
-- drop function if exists public.data_subject_requests_bitacora();
-- drop function if exists public.data_subject_requests_proteger();
-- -- registro_titular_inmutable() la usa también 20261026200100: revertir esa antes.
-- drop function if exists public.registro_titular_inmutable();
-- commit;
