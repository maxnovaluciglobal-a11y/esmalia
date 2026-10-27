-- Ola 14 · frente B (1/2): citas grupales (AGE-22).
--
-- Una cita con varios pacientes (charla de higiene, control escolar,
-- ortodoncia grupal…) SIN cambiar el modelo de citas: la cita grupal es una
-- fila normal de `appointments` (un profesional, un box, un horario) más
--
--   appointment_groups              la marca de "grupal": nombre de la
--                                   actividad y cupo máximo (1 a 1 con la cita).
--   appointment_group_participants  los pacientes inscritos, cada uno con su
--                                   asistencia (pendiente/asistió/ausente) y su
--                                   retiro (no se borran: se retiran).
--
-- Por qué así: todo lo que lee `appointments` (agenda, choques UX-04, reserva
-- en línea, correos automáticos, panel, informes, comisiones) sigue viendo UNA
-- cita, así que las horas del profesional y del box no se duplican. La columna
-- `appointments.patient_id` (NOT NULL) queda como "titular": el primer
-- inscrito vigente, sincronizado por trigger. Lo que asume un paciente por
-- cita y cómo se adaptó está en el cuerpo del PR.
--
-- Reglas en la base (todo gate de la UI tiene su par acá):
--   · cupo: no se inscribe (ni se reincorpora) a nadie con la cita llena;
--     el cupo no baja de los inscritos vigentes. Candado por fila del grupo.
--   · al menos un inscrito vigente: para vaciarla, se cancela la cita.
--   · asistencia individual solo de inscritos vigentes y desde que empezó la
--     cita; un retiro vuelve la asistencia a pendiente.
--   · una cita grupal no se marca "ausente" entera (cada paciente tiene la
--     suya) y no se inscribe a nadie en una cita cancelada.
--
-- Permisos: ver, quien ve la agenda (como `appointments`); escribir, los roles
-- que agendan (owner/admin/dentist/reception, y coordinación vía
-- `has_clinic_role`), respetando "quitar agendar" por persona (EQU-01) y la
-- verificación en dos pasos (mfa_exige_aal2).
--
-- Contadores de la ficha (FIC-12): `patient_appointment_counters` se redefine
-- (partiendo de su definición en prod del 27-oct-2026, misma firma y mismo
-- resultado para las citas individuales) para contar la asistencia propia de
-- cada participante en vez del estado de la cita grupal.
--
-- No escribe datos. Redefine `patient_appointment_counters`. Agrega un
-- trigger a `appointments` que solo actúa en citas grupales. Reversa al pie.

begin;

-- ── Tablas ─────────────────────────────────────────────────────────────────
create table if not exists public.appointment_groups (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null,
  capacity integer not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_groups_title_check check (char_length(btrim(title)) between 2 and 120),
  constraint appointment_groups_capacity_check check (capacity between 2 and 200)
);

create index if not exists appointment_groups_clinic_idx
  on public.appointment_groups (clinic_id);

comment on table public.appointment_groups is
  'AGE-22: marca una cita como grupal (nombre de la actividad y cupo). La cita sigue siendo una fila de appointments: profesional y box una sola vez.';

create table if not exists public.appointment_group_participants (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  appointment_id uuid not null references public.appointment_groups(appointment_id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  attendance text not null default 'pendiente',
  attendance_marked_at timestamptz,
  attendance_marked_by uuid,
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid default auth.uid(),
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdraw_reason text,
  updated_at timestamptz not null default now(),
  constraint appointment_group_participants_unique unique (appointment_id, patient_id),
  constraint appointment_group_participants_attendance_check check (
    attendance in ('pendiente', 'asistio', 'ausente')
  ),
  constraint appointment_group_participants_retiro_check check (
    withdrawn_at is null or attendance = 'pendiente'
  ),
  constraint appointment_group_participants_reason_check check (
    withdraw_reason is null or char_length(withdraw_reason) <= 300
  )
);

create index if not exists appointment_group_participants_patient_idx
  on public.appointment_group_participants (clinic_id, patient_id);
create index if not exists appointment_group_participants_appointment_idx
  on public.appointment_group_participants (appointment_id);

comment on table public.appointment_group_participants is
  'AGE-22: pacientes inscritos en una cita grupal, con asistencia individual. No se borran: se retiran.';

-- ── Permisos de tabla ─────────────────────────────────────────────────────
revoke all on public.appointment_groups from anon, authenticated;
grant select, insert, update, delete on public.appointment_groups to authenticated;
grant all on public.appointment_groups to service_role;
alter table public.appointment_groups enable row level security;

-- Sin DELETE para authenticated: un inscrito se retira (queda el registro).
revoke all on public.appointment_group_participants from anon, authenticated;
grant select, insert, update on public.appointment_group_participants to authenticated;
grant all on public.appointment_group_participants to service_role;
alter table public.appointment_group_participants enable row level security;

-- Grupos
drop policy if exists appointment_groups_select on public.appointment_groups;
create policy appointment_groups_select on public.appointment_groups
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists appointment_groups_insert on public.appointment_groups;
create policy appointment_groups_insert on public.appointment_groups
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists appointment_groups_update on public.appointment_groups;
create policy appointment_groups_update on public.appointment_groups
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[]));

drop policy if exists appointment_groups_delete on public.appointment_groups;
create policy appointment_groups_delete on public.appointment_groups
  for delete to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[]));

-- Participantes
drop policy if exists appointment_group_participants_select on public.appointment_group_participants;
create policy appointment_group_participants_select on public.appointment_group_participants
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

drop policy if exists appointment_group_participants_insert on public.appointment_group_participants;
create policy appointment_group_participants_insert on public.appointment_group_participants
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists appointment_group_participants_update on public.appointment_group_participants;
create policy appointment_group_participants_update on public.appointment_group_participants
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[]));

-- EQU-01: "quitar agendar y mover citas" a una persona también vale acá.
drop policy if exists ajuste_quita_agendar_insert on public.appointment_groups;
create policy ajuste_quita_agendar_insert on public.appointment_groups
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_update on public.appointment_groups;
create policy ajuste_quita_agendar_update on public.appointment_groups
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'))
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_delete on public.appointment_groups;
create policy ajuste_quita_agendar_delete on public.appointment_groups
  as restrictive for delete to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_insert on public.appointment_group_participants;
create policy ajuste_quita_agendar_insert on public.appointment_group_participants
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_update on public.appointment_group_participants;
create policy ajuste_quita_agendar_update on public.appointment_group_participants
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'))
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists mfa_exige_aal2 on public.appointment_groups;
create policy mfa_exige_aal2 on public.appointment_groups
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.appointment_group_participants;
create policy mfa_exige_aal2 on public.appointment_group_participants
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ── Reglas del grupo ──────────────────────────────────────────────────────
create or replace function public.validar_grupo_de_cita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cita record;
  v_vigentes integer;
begin
  if tg_op = 'INSERT' then
    select clinic_id, status into v_cita
      from public.appointments
     where id = new.appointment_id;
    if not found then
      raise exception 'La cita no existe.' using errcode = '23503';
    end if;
    -- La clínica la pone la cita, no el cliente.
    if new.clinic_id is distinct from v_cita.clinic_id then
      raise exception 'La cita no es de esta clínica.' using errcode = '42501';
    end if;
    if v_cita.status in ('cancelada', 'ausente') then
      raise exception 'Una cita cancelada o marcada como ausente no se convierte en grupal.'
        using errcode = '23514';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.created_at := now();
  else
    if new.appointment_id is distinct from old.appointment_id
       or new.clinic_id is distinct from old.clinic_id then
      raise exception 'La cita y la clínica de un grupo no se cambian.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if new.capacity < old.capacity then
      select count(*) into v_vigentes
        from public.appointment_group_participants
       where appointment_id = new.appointment_id and withdrawn_at is null;
      if new.capacity < v_vigentes then
        raise exception 'El cupo no puede quedar por debajo de los % pacientes inscritos.', v_vigentes
          using errcode = '23514';
      end if;
    end if;
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validar_grupo_de_cita() from public, anon, authenticated;

drop trigger if exists appointment_groups_validar on public.appointment_groups;
create trigger appointment_groups_validar
  before insert or update on public.appointment_groups
  for each row execute function public.validar_grupo_de_cita();

-- Al convertir la cita en grupal, su paciente queda como primer inscrito.
create or replace function public.inscribir_titular_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.appointment_group_participants (clinic_id, appointment_id, patient_id, enrolled_by)
  select new.clinic_id, a.id, a.patient_id, auth.uid()
    from public.appointments a
   where a.id = new.appointment_id
  on conflict (appointment_id, patient_id) do nothing;
  return null;
end;
$$;

revoke all on function public.inscribir_titular_de_grupo() from public, anon, authenticated;

drop trigger if exists appointment_groups_inscribir_titular on public.appointment_groups;
create trigger appointment_groups_inscribir_titular
  after insert on public.appointment_groups
  for each row execute function public.inscribir_titular_de_grupo();

-- ── Reglas de cada inscrito ───────────────────────────────────────────────
-- "Sistema" = sin usuario (service role, cascadas, tests de semilla).
create or replace function public.validar_participante_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_grupo record;
  v_cita record;
  v_vigentes integer;
  v_reincorpora boolean := false;
begin
  -- Candado de la fila del grupo: dos inscripciones a la vez no pasan las dos
  -- el chequeo del cupo.
  select g.clinic_id, g.capacity into v_grupo
    from public.appointment_groups g
   where g.appointment_id = new.appointment_id
   for update;
  if not found then
    raise exception 'La cita no es grupal.' using errcode = '23503';
  end if;
  select a.status, a.starts_at into v_cita
    from public.appointments a
   where a.id = new.appointment_id;

  if tg_op = 'INSERT' then
    new.clinic_id := v_grupo.clinic_id;
    if not exists (
      select 1 from public.patients p
       where p.id = new.patient_id
         and p.clinic_id = new.clinic_id
         and p.archived_at is null
         and p.merged_into is null
    ) then
      raise exception 'El paciente no es de esta clínica o su ficha está archivada.'
        using errcode = '42501';
    end if;
    new.enrolled_at := clock_timestamp();
    new.enrolled_by := coalesce(v_uid, new.enrolled_by);
    new.withdrawn_at := null;
    new.withdrawn_by := null;
    new.withdraw_reason := null;
    new.attendance := 'pendiente';
    new.attendance_marked_at := null;
    new.attendance_marked_by := null;
    v_reincorpora := true;
  else
    if new.appointment_id is distinct from old.appointment_id
       or new.patient_id is distinct from old.patient_id
       or new.clinic_id is distinct from old.clinic_id then
      raise exception 'La cita, el paciente y la clínica de un inscrito no se cambian.'
        using errcode = '42501';
    end if;
    new.enrolled_by := old.enrolled_by;

    if old.withdrawn_at is not null and new.withdrawn_at is null then
      -- Reincorporación: vuelve a ocupar cupo.
      new.enrolled_at := clock_timestamp();
      new.enrolled_by := coalesce(v_uid, old.enrolled_by);
      new.withdrawn_by := null;
      new.withdraw_reason := null;
      new.attendance := 'pendiente';
      new.attendance_marked_at := null;
      new.attendance_marked_by := null;
      v_reincorpora := true;
    elsif old.withdrawn_at is null and new.withdrawn_at is not null then
      -- Retiro: queda el registro, libera el cupo.
      if not exists (
        select 1 from public.appointment_group_participants o
         where o.appointment_id = new.appointment_id
           and o.id <> new.id
           and o.withdrawn_at is null
      ) then
        raise exception 'Una cita grupal necesita al menos un paciente: para dejarla vacía, cancela la cita.'
          using errcode = '23514';
      end if;
      new.withdrawn_at := now();
      new.withdrawn_by := v_uid;
      new.enrolled_at := old.enrolled_at;
      new.attendance := 'pendiente';
      new.attendance_marked_at := null;
      new.attendance_marked_by := null;
    else
      new.enrolled_at := old.enrolled_at;
      new.withdrawn_at := old.withdrawn_at;
      new.withdrawn_by := old.withdrawn_by;
      if old.withdrawn_at is not null then
        -- Retirado: sin asistencia hasta que se reincorpore.
        if new.attendance is distinct from old.attendance then
          raise exception 'Un paciente retirado no tiene asistencia: reincorpóralo primero.'
            using errcode = '23514';
        end if;
        new.withdraw_reason := coalesce(new.withdraw_reason, old.withdraw_reason);
        new.attendance_marked_at := null;
        new.attendance_marked_by := null;
      elsif new.attendance is distinct from old.attendance then
        -- Asistencia individual, desde que empieza la cita.
        if new.attendance <> 'pendiente' and v_cita.starts_at > now() then
          raise exception 'La asistencia se marca desde que empieza la cita.'
            using errcode = '23514';
        end if;
        if new.attendance = 'pendiente' then
          new.attendance_marked_at := null;
          new.attendance_marked_by := null;
        else
          new.attendance_marked_at := now();
          new.attendance_marked_by := v_uid;
        end if;
      else
        new.attendance_marked_at := old.attendance_marked_at;
        new.attendance_marked_by := old.attendance_marked_by;
      end if;
    end if;
  end if;

  if v_reincorpora then
    if v_cita.status = 'cancelada' then
      raise exception 'La cita grupal está cancelada: no se inscriben pacientes.'
        using errcode = '23514';
    end if;
    select count(*) into v_vigentes
      from public.appointment_group_participants o
     where o.appointment_id = new.appointment_id
       and o.withdrawn_at is null
       and o.id <> new.id;
    if v_vigentes >= v_grupo.capacity then
      raise exception 'La cita grupal está llena: tiene % de % cupos ocupados.', v_vigentes, v_grupo.capacity
        using errcode = '23514';
    end if;
  end if;

  if new.withdraw_reason is not null then
    new.withdraw_reason := nullif(btrim(new.withdraw_reason), '');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validar_participante_de_grupo() from public, anon, authenticated;

drop trigger if exists appointment_group_participants_validar on public.appointment_group_participants;
create trigger appointment_group_participants_validar
  before insert or update on public.appointment_group_participants
  for each row execute function public.validar_participante_de_grupo();

-- Titular de la cita = primer inscrito vigente. Así `appointments.patient_id`
-- (NOT NULL) siempre nombra a alguien que de verdad está en la cita.
create or replace function public.sincronizar_titular_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titular uuid;
begin
  select p.patient_id into v_titular
    from public.appointment_group_participants p
   where p.appointment_id = new.appointment_id
     and p.withdrawn_at is null
   order by p.enrolled_at, p.id
   limit 1;
  if v_titular is not null then
    update public.appointments
       set patient_id = v_titular
     where id = new.appointment_id
       and patient_id is distinct from v_titular;
  end if;
  return null;
end;
$$;

revoke all on function public.sincronizar_titular_de_grupo() from public, anon, authenticated;

drop trigger if exists appointment_group_participants_titular on public.appointment_group_participants;
create trigger appointment_group_participants_titular
  after insert or update of withdrawn_at on public.appointment_group_participants
  for each row execute function public.sincronizar_titular_de_grupo();

-- Una cita grupal no se marca "ausente" entera: cada paciente tiene la suya.
create or replace function public.cita_grupal_sin_ausente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ausente'
     and new.status is distinct from old.status
     and exists (select 1 from public.appointment_groups g where g.appointment_id = new.id) then
    raise exception 'En una cita grupal la asistencia se marca por paciente, no para toda la cita.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.cita_grupal_sin_ausente() from public, anon, authenticated;

drop trigger if exists appointments_grupal_sin_ausente on public.appointments;
create trigger appointments_grupal_sin_ausente
  before update of status on public.appointments
  for each row execute function public.cita_grupal_sin_ausente();

-- ── Contadores de la ficha (FIC-12) con la asistencia propia ──────────────
-- Misma firma y mismas reglas para las citas individuales. En una cita
-- grupal cuenta lo del participante (retirados afuera):
--   asistió → atendida · ausente → inasistencia · cita cancelada → anulada ·
--   pendiente → el estado de la cita (próxima, sin cerrar o atendida si la
--   sesión se finalizó sin pasar lista).
create or replace function public.patient_appointment_counters(
  p_clinic_id uuid,
  p_patient_id uuid
)
returns table (
  attended integer,
  no_show integer,
  cancelled integer,
  upcoming integer,
  past_open integer,
  last_visit_at timestamptz,
  next_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with citas as (
    select a.starts_at, a.ends_at, a.status::text as status
      from public.appointments a
     where a.clinic_id = p_clinic_id
       and a.patient_id = p_patient_id
       and not exists (
         select 1 from public.appointment_groups g where g.appointment_id = a.id
       )
    union all
    select a.starts_at,
           a.ends_at,
           case
             when a.status = 'cancelada' then 'cancelada'
             when gp.attendance = 'asistio' then 'finalizada'
             when gp.attendance = 'ausente' then 'ausente'
             else a.status::text
           end as status
      from public.appointment_group_participants gp
      join public.appointments a on a.id = gp.appointment_id
     where gp.clinic_id = p_clinic_id
       and gp.patient_id = p_patient_id
       and gp.withdrawn_at is null
  )
  select
    count(*) filter (where c.status = 'finalizada')::integer as attended,
    count(*) filter (where c.status = 'ausente')::integer as no_show,
    count(*) filter (where c.status = 'cancelada')::integer as cancelled,
    count(*) filter (
      where c.starts_at > now()
        and c.status in ('tentativa', 'confirmada', 'en-sala')
    )::integer as upcoming,
    count(*) filter (
      where c.ends_at < now()
        and c.status in ('tentativa', 'confirmada', 'en-sala')
    )::integer as past_open,
    max(c.starts_at) filter (where c.status = 'finalizada') as last_visit_at,
    min(c.starts_at) filter (
      where c.starts_at > now()
        and c.status in ('tentativa', 'confirmada', 'en-sala')
    ) as next_at
  from citas c;
$$;

comment on function public.patient_appointment_counters(uuid, uuid) is
  'Contadores de citas de un paciente (FIC-12; AGE-22: en citas grupales cuenta la asistencia propia). SECURITY INVOKER: respeta la RLS de appointments.';

revoke all on function public.patient_appointment_counters(uuid, uuid) from public, anon;
grant execute on function public.patient_appointment_counters(uuid, uuid) to authenticated, service_role;

commit;

-- ── Reversa ────────────────────────────────────────────────────────────────
-- begin;
-- drop trigger if exists appointments_grupal_sin_ausente on public.appointments;
-- drop function if exists public.cita_grupal_sin_ausente();
-- -- patient_appointment_counters: volver a la definición de 20261023300000_contadores_de_citas.sql
-- drop table if exists public.appointment_group_participants;
-- drop table if exists public.appointment_groups;
-- drop function if exists public.sincronizar_titular_de_grupo();
-- drop function if exists public.validar_participante_de_grupo();
-- drop function if exists public.inscribir_titular_de_grupo();
-- drop function if exists public.validar_grupo_de_cita();
-- -- drop policy if exists mfa_exige_aal2 on public.appointment_group_participants;
-- -- drop policy if exists mfa_exige_aal2 on public.appointment_groups;
-- commit;
