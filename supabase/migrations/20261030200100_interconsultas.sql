-- Ola 9 · frente B · FIC-14: interconsultas y derivaciones.
--
-- Pedir y registrar una interconsulta a otro especialista: especialidad,
-- destino (profesional o centro), motivo, lo que se solicita, urgencia,
-- estado y la respuesta. El documento de derivación sale del motor de
-- plantillas de la Ola 4 (plantilla "derivacion") y queda enlazado.
--
-- Estados: pedida → enviada → respondida → cerrada, o cancelada antes de
-- responderse. Lo valida un trigger (no la app): las transiciones, que la
-- respuesta tenga texto, quién la registró y cuándo, y que el documento sea
-- de la misma clínica y del mismo paciente.
--
-- Permisos (regla 2): es historia clínica, así que solo owner/admin/dentist/
-- assistant leen, crean y actualizan. Nadie borra: una interconsulta que no
-- va se cancela (con motivo).
--
-- Tabla nueva, sin datos que migrar.

create table if not exists public.patient_referrals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- RESTRICT como toda FK clínica hacia patients (20261019220000).
  patient_id uuid not null references public.patients(id) on delete restrict,
  specialty text not null,
  destination text,
  destination_contact text,
  reason text not null,
  request text,
  urgency text not null default 'normal',
  status text not null default 'pedida',
  requested_by uuid,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  response text,
  responded_at timestamptz,
  response_recorded_by uuid,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  issued_document_id uuid references public.issued_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_referrals_specialty_check check (char_length(btrim(specialty)) between 2 and 80),
  constraint patient_referrals_destination_check check (destination is null or char_length(destination) <= 160),
  constraint patient_referrals_contact_check check (
    destination_contact is null or char_length(destination_contact) <= 160
  ),
  constraint patient_referrals_reason_check check (char_length(btrim(reason)) between 3 and 2000),
  constraint patient_referrals_request_check check (request is null or char_length(request) <= 2000),
  constraint patient_referrals_urgency_check check (urgency in ('normal', 'preferente', 'urgente')),
  constraint patient_referrals_status_check check (
    status in ('pedida', 'enviada', 'respondida', 'cerrada', 'cancelada')
  ),
  constraint patient_referrals_response_check check (response is null or char_length(response) <= 4000),
  constraint patient_referrals_cancel_check check (
    cancel_reason is null or char_length(cancel_reason) <= 500
  )
);

create index if not exists patient_referrals_patient_idx
  on public.patient_referrals (clinic_id, patient_id, requested_at desc);
create index if not exists patient_referrals_abiertas_idx
  on public.patient_referrals (clinic_id, status)
  where status in ('pedida', 'enviada');

comment on table public.patient_referrals is
  'FIC-14: interconsultas y derivaciones a otro especialista, con su respuesta y el documento de derivación.';

revoke all on public.patient_referrals from anon, authenticated;
grant select, insert, update on public.patient_referrals to authenticated;
grant all on public.patient_referrals to service_role;
alter table public.patient_referrals enable row level security;

drop policy if exists patient_referrals_select on public.patient_referrals;
create policy patient_referrals_select on public.patient_referrals
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists patient_referrals_insert on public.patient_referrals;
create policy patient_referrals_insert on public.patient_referrals
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
    and requested_by = (select auth.uid())
    and exists (
      select 1 from public.patients p
       where p.id = patient_referrals.patient_id and p.clinic_id = patient_referrals.clinic_id
    )
  );

drop policy if exists patient_referrals_update on public.patient_referrals;
create policy patient_referrals_update on public.patient_referrals
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
  );

drop policy if exists mfa_exige_aal2 on public.patient_referrals;
create policy mfa_exige_aal2 on public.patient_referrals
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- Reglas del flujo: las escribe la base, no la app.
create or replace function public.validar_interconsulta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc record;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pedida' then
      raise exception 'Una interconsulta nueva empieza como pedida.' using errcode = '23514';
    end if;
    new.requested_at := now();
    new.sent_at := null;
    new.response := null;
    new.responded_at := null;
    new.response_recorded_by := null;
    new.closed_at := null;
    new.cancelled_at := null;
    new.cancel_reason := null;
  else
    if new.clinic_id is distinct from old.clinic_id
       or new.patient_id is distinct from old.patient_id
       or new.requested_by is distinct from old.requested_by
       or new.requested_at is distinct from old.requested_at then
      raise exception 'La clínica, el paciente y quién pidió la interconsulta no se cambian.'
        using errcode = '42501';
    end if;

    if old.status in ('cerrada', 'cancelada') and (
      new.status is distinct from old.status
      or new.response is distinct from old.response
      or new.reason is distinct from old.reason
      or new.specialty is distinct from old.specialty
    ) then
      raise exception 'Esta interconsulta ya está %: no se modifica.', old.status using errcode = '23514';
    end if;

    -- Lo que se pide solo se corrige antes de responderse.
    if old.status in ('respondida', 'cerrada', 'cancelada') and (
      new.reason is distinct from old.reason
      or new.request is distinct from old.request
      or new.specialty is distinct from old.specialty
      or new.destination is distinct from old.destination
      or new.urgency is distinct from old.urgency
    ) then
      raise exception 'La interconsulta ya fue respondida: lo que se pidió no se cambia.'
        using errcode = '23514';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'pedida' and new.status in ('enviada', 'respondida', 'cancelada'))
        or (old.status = 'enviada' and new.status in ('respondida', 'cancelada'))
        or (old.status = 'respondida' and new.status = 'cerrada')
      ) then
        raise exception 'No se puede pasar una interconsulta de % a %.', old.status, new.status
          using errcode = '23514';
      end if;
      if new.status = 'enviada' then
        new.sent_at := now();
      elsif new.status = 'respondida' then
        if new.response is null or char_length(btrim(new.response)) < 2 then
          raise exception 'Escribe la respuesta del especialista.' using errcode = '23514';
        end if;
        new.responded_at := now();
        new.response_recorded_by := coalesce(v_uid, new.response_recorded_by);
      elsif new.status = 'cerrada' then
        new.closed_at := now();
      elsif new.status = 'cancelada' then
        if new.cancel_reason is null or char_length(btrim(new.cancel_reason)) < 3 then
          raise exception 'Indica por qué se cancela la interconsulta.' using errcode = '23514';
        end if;
        new.cancelled_at := now();
      end if;
    else
      -- Sin cambio de estado: las marcas de tiempo no se editan a mano.
      new.sent_at := old.sent_at;
      new.responded_at := old.responded_at;
      new.response_recorded_by := old.response_recorded_by;
      new.closed_at := old.closed_at;
      new.cancelled_at := old.cancelled_at;
      if new.response is distinct from old.response and old.status <> 'respondida' then
        raise exception 'La respuesta se registra al marcar la interconsulta como respondida.'
          using errcode = '23514';
      end if;
    end if;
    new.updated_at := now();
  end if;

  -- El documento enlazado tiene que ser de esta clínica y de este paciente.
  if new.issued_document_id is not null
     and (tg_op = 'INSERT' or new.issued_document_id is distinct from old.issued_document_id) then
    select clinic_id, patient_id into v_doc
      from public.issued_documents where id = new.issued_document_id;
    if not found or v_doc.clinic_id <> new.clinic_id or v_doc.patient_id <> new.patient_id then
      raise exception 'El documento no es de este paciente.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.validar_interconsulta() from public, anon, authenticated;

drop trigger if exists patient_referrals_validar on public.patient_referrals;
create trigger patient_referrals_validar
  before insert or update on public.patient_referrals
  for each row execute function public.validar_interconsulta();

-- La clínica demo es de solo lectura (como el resto de sus tablas).
drop trigger if exists block_demo_writes on public.patient_referrals;
create trigger block_demo_writes
  before insert or update or delete on public.patient_referrals
  for each row execute function public.block_demo_writes();


-- ── Reversa (hacer antes un backup si ya hay interconsultas) ──────────────
-- drop trigger if exists block_demo_writes on public.patient_referrals;
-- drop trigger if exists patient_referrals_validar on public.patient_referrals;
-- drop function if exists public.validar_interconsulta();
-- drop policy if exists mfa_exige_aal2 on public.patient_referrals;
-- drop table if exists public.patient_referrals;
