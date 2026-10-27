-- Ola 8 · frente B · Seguimiento de pacientes (FIC-13, REC-08, CRM-02, CRM-03, CRM-04).
--
--   patient_controls               FIC-13: control manual programado desde la ficha
--                                  ("volver en N meses por X"). Alimenta la lista de
--                                  controles pendientes (REC-08) junto con el recall
--                                  automático que ya calcula /recordatorios.
--   followup_tasks                 CRM-02: bandeja de tareas por persona (llamadas,
--                                  seguimiento de presupuestos, controles, otras).
--   outreach_templates             CRM-03: plantillas de mensajes de la clínica, por
--                                  correo o WhatsApp, con variables en español.
--   outreach_campaigns             CRM-04: campaña a un grupo de pacientes, por correo
--                                  o por WhatsApp asistido.
--   outreach_campaign_recipients   CRM-04: un destinatario por paciente y campaña
--                                  (clave única: la campaña nunca le escribe dos veces
--                                  al mismo paciente).
--
-- Invariantes que cuida la base (no solo la app):
--  - WhatsApp: nada sale solo. Un destinatario de una campaña por WhatsApp no puede
--    pasar a "enviando"/"enviado" (eso es del correo) y solo queda "abierto" cuando
--    una persona abre el link wa.me (`auth.uid()` presente): un cron o un proceso
--    sin usuario no puede despachar la cola.
--  - Correo: el envío reclama destinatarios con `reclamar_envios_de_campana`
--    (UPDATE … FOR UPDATE SKIP LOCKED, pendiente → enviando). Dos envíos en
--    paralelo nunca toman el mismo destinatario y un destinatario ya reclamado no
--    vuelve a salir.
--  - Una campaña confirmada ya no cambia de canal, texto ni grupo de pacientes.
--
-- Permisos:
--  - Controles y tareas: owner, admin, dentist y reception (los que manejan la
--    agenda, `agenda:manage`).
--  - Plantillas: las leen esos mismos roles; las escriben owner y admin.
--  - Campañas y destinatarios: solo owner y admin (acción masiva).
-- Nadie borra: una tarea se completa o se descarta, un control se descarta, una
-- plantilla se desactiva y una campaña se cancela.
--
-- Tablas nuevas, sin datos que migrar. Las funciones de lectura son SECURITY
-- INVOKER (aplican la RLS de quien consulta).

-- ═══ 1. Controles programados (FIC-13) ══════════════════════════════════════

create table if not exists public.patient_controls (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  reason text not null,
  due_on date not null,
  months smallint,
  status text not null default 'pendiente',
  appointment_id uuid references public.appointments(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_controls_reason_check check (char_length(btrim(reason)) between 2 and 200),
  constraint patient_controls_months_check check (months is null or months between 1 and 60),
  constraint patient_controls_status_check check (
    status in ('pendiente', 'agendado', 'cumplido', 'descartado')
  )
);

create index if not exists patient_controls_pendientes_idx
  on public.patient_controls (clinic_id, status, due_on);
create index if not exists patient_controls_patient_idx
  on public.patient_controls (clinic_id, patient_id, due_on desc);

comment on table public.patient_controls is
  'FIC-13: control programado a mano desde la ficha ("volver en N meses por X"). Aparece en los controles pendientes (REC-08).';

-- ═══ 2. Tareas de seguimiento (CRM-02) ══════════════════════════════════════

create table if not exists public.followup_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  title text not null,
  notes text,
  kind text not null default 'otra',
  patient_id uuid references public.patients(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  control_id uuid references public.patient_controls(id) on delete set null,
  assigned_to uuid,
  due_on date not null,
  status text not null default 'pendiente',
  postponed_count integer not null default 0,
  completed_at timestamptz,
  completed_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followup_tasks_title_check check (char_length(btrim(title)) between 2 and 160),
  constraint followup_tasks_notes_check check (notes is null or char_length(notes) <= 1000),
  constraint followup_tasks_kind_check check (
    kind in ('llamada', 'presupuesto', 'control', 'mensaje', 'otra')
  ),
  constraint followup_tasks_status_check check (status in ('pendiente', 'hecha', 'descartada'))
);

create index if not exists followup_tasks_bandeja_idx
  on public.followup_tasks (clinic_id, status, due_on);
create index if not exists followup_tasks_asignada_idx
  on public.followup_tasks (clinic_id, assigned_to, status);
-- Un presupuesto o un control tiene a lo más una tarea abierta: crear la tarea
-- dos veces (doble clic, dos personas) no la duplica.
create unique index if not exists followup_tasks_presupuesto_abierto_uidx
  on public.followup_tasks (quote_id) where status = 'pendiente' and quote_id is not null;
create unique index if not exists followup_tasks_control_abierto_uidx
  on public.followup_tasks (control_id) where status = 'pendiente' and control_id is not null;

comment on table public.followup_tasks is
  'CRM-02: tareas de seguimiento por persona (llamadas, presupuestos sin respuesta, controles). Se completan, posponen o descartan; no se borran.';

-- ═══ 3. Plantillas de mensajes (CRM-03) ═════════════════════════════════════

create table if not exists public.outreach_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  channel text not null,
  subject text,
  body text not null,
  active boolean not null default true,
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_templates_name_check check (char_length(btrim(name)) between 2 and 80),
  constraint outreach_templates_channel_check check (channel in ('whatsapp', 'correo')),
  constraint outreach_templates_subject_check check (
    (channel = 'correo' and subject is not null and char_length(btrim(subject)) between 2 and 150)
    or (channel = 'whatsapp' and subject is null)
  ),
  constraint outreach_templates_body_check check (char_length(btrim(body)) between 2 and 2000)
);

create index if not exists outreach_templates_clinic_idx
  on public.outreach_templates (clinic_id, channel, active);

comment on table public.outreach_templates is
  'CRM-03: plantillas de mensajes de la clínica (correo o WhatsApp) con variables en español como {{paciente.nombre}}.';

-- ═══ 4. Campañas (CRM-04) ═══════════════════════════════════════════════════

create table if not exists public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  channel text not null,
  template_id uuid references public.outreach_templates(id) on delete set null,
  subject text,
  body text not null,
  -- Definición del grupo de pacientes (filtro propio o segmento guardado).
  segment jsonb not null default '{}'::jsonb,
  segment_label text,
  status text not null default 'borrador',
  recipients_count integer not null default 0,
  confirmed_at timestamptz,
  confirmed_by uuid,
  finished_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_campaigns_name_check check (char_length(btrim(name)) between 2 and 120),
  constraint outreach_campaigns_channel_check check (channel in ('whatsapp', 'correo')),
  constraint outreach_campaigns_subject_check check (
    (channel = 'correo' and subject is not null and char_length(btrim(subject)) between 2 and 150)
    or (channel = 'whatsapp' and subject is null)
  ),
  constraint outreach_campaigns_body_check check (char_length(btrim(body)) between 2 and 2000),
  constraint outreach_campaigns_segment_label_check check (
    segment_label is null or char_length(segment_label) <= 300
  ),
  constraint outreach_campaigns_status_check check (
    status in ('borrador', 'confirmada', 'terminada', 'cancelada')
  )
);

create index if not exists outreach_campaigns_clinic_idx
  on public.outreach_campaigns (clinic_id, created_at desc);

comment on table public.outreach_campaigns is
  'CRM-04: campañas a un grupo de pacientes, por correo (sale desde el servidor respetando modo de prueba, baja y tutor) o por WhatsApp asistido (cola que despacha una persona, nada sale solo).';

create table if not exists public.outreach_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  channel text not null,
  destination text not null,
  recipient_for text not null default 'paciente',
  status text not null default 'pendiente',
  reason text,
  message_id uuid references public.messages(id) on delete set null,
  processed_at timestamptz,
  processed_by uuid,
  created_at timestamptz not null default now(),
  constraint outreach_campaign_recipients_unico unique (campaign_id, patient_id),
  constraint outreach_campaign_recipients_channel_check check (channel in ('whatsapp', 'correo')),
  constraint outreach_campaign_recipients_for_check check (recipient_for in ('paciente', 'tutor')),
  constraint outreach_campaign_recipients_destination_check check (
    char_length(btrim(destination)) between 3 and 320
  ),
  constraint outreach_campaign_recipients_status_check check (
    status in ('pendiente', 'enviando', 'enviado', 'fallido', 'omitido', 'abierto')
  ),
  constraint outreach_campaign_recipients_reason_check check (
    reason is null or char_length(reason) <= 500
  )
);

create index if not exists outreach_campaign_recipients_cola_idx
  on public.outreach_campaign_recipients (campaign_id, status);
create index if not exists outreach_campaign_recipients_patient_idx
  on public.outreach_campaign_recipients (clinic_id, patient_id);

comment on table public.outreach_campaign_recipients is
  'CRM-04: destinatarios de cada campaña (uno por paciente). Correo: pendiente → enviando → enviado/fallido. WhatsApp: pendiente → abierto, solo cuando una persona abre el link.';

-- ═══ Permisos ═══════════════════════════════════════════════════════════════

revoke all on public.patient_controls from anon, authenticated;
grant select, insert, update on public.patient_controls to authenticated;
grant all on public.patient_controls to service_role;
alter table public.patient_controls enable row level security;

revoke all on public.followup_tasks from anon, authenticated;
grant select, insert, update on public.followup_tasks to authenticated;
grant all on public.followup_tasks to service_role;
alter table public.followup_tasks enable row level security;

revoke all on public.outreach_templates from anon, authenticated;
grant select, insert, update on public.outreach_templates to authenticated;
grant all on public.outreach_templates to service_role;
alter table public.outreach_templates enable row level security;

revoke all on public.outreach_campaigns from anon, authenticated;
grant select, insert, update on public.outreach_campaigns to authenticated;
grant all on public.outreach_campaigns to service_role;
alter table public.outreach_campaigns enable row level security;

revoke all on public.outreach_campaign_recipients from anon, authenticated;
grant select, insert, update on public.outreach_campaign_recipients to authenticated;
grant all on public.outreach_campaign_recipients to service_role;
alter table public.outreach_campaign_recipients enable row level security;

-- Controles
drop policy if exists patient_controls_select on public.patient_controls;
create policy patient_controls_select on public.patient_controls
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists patient_controls_insert on public.patient_controls;
create policy patient_controls_insert on public.patient_controls
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.patients p
       where p.id = patient_controls.patient_id and p.clinic_id = patient_controls.clinic_id
    )
  );

drop policy if exists patient_controls_update on public.patient_controls;
create policy patient_controls_update on public.patient_controls
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

-- Tareas
drop policy if exists followup_tasks_select on public.followup_tasks;
create policy followup_tasks_select on public.followup_tasks
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists followup_tasks_insert on public.followup_tasks;
create policy followup_tasks_insert on public.followup_tasks
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
    and created_by = (select auth.uid())
  );

drop policy if exists followup_tasks_update on public.followup_tasks;
create policy followup_tasks_update on public.followup_tasks
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

-- Plantillas
drop policy if exists outreach_templates_select on public.outreach_templates;
create policy outreach_templates_select on public.outreach_templates
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
  );

drop policy if exists outreach_templates_insert on public.outreach_templates;
create policy outreach_templates_insert on public.outreach_templates
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id) and created_by = (select auth.uid()));

drop policy if exists outreach_templates_update on public.outreach_templates;
create policy outreach_templates_update on public.outreach_templates
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

-- Campañas
drop policy if exists outreach_campaigns_select on public.outreach_campaigns;
create policy outreach_campaigns_select on public.outreach_campaigns
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

drop policy if exists outreach_campaigns_insert on public.outreach_campaigns;
create policy outreach_campaigns_insert on public.outreach_campaigns
  for insert to authenticated
  with check (
    public.can_manage_clinic(clinic_id)
    and created_by = (select auth.uid())
    and status = 'borrador'
  );

drop policy if exists outreach_campaigns_update on public.outreach_campaigns;
create policy outreach_campaigns_update on public.outreach_campaigns
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

-- Destinatarios: se agregan solo mientras la campaña está en borrador (al
-- confirmarla) y el paciente es de la misma clínica.
drop policy if exists outreach_campaign_recipients_select on public.outreach_campaign_recipients;
create policy outreach_campaign_recipients_select on public.outreach_campaign_recipients
  for select to authenticated
  using (public.can_manage_clinic(clinic_id));

drop policy if exists outreach_campaign_recipients_insert on public.outreach_campaign_recipients;
create policy outreach_campaign_recipients_insert on public.outreach_campaign_recipients
  for insert to authenticated
  with check (
    public.can_manage_clinic(clinic_id)
    and exists (
      select 1 from public.outreach_campaigns c
       where c.id = outreach_campaign_recipients.campaign_id
         and c.clinic_id = outreach_campaign_recipients.clinic_id
         and c.status = 'borrador'
    )
    and exists (
      select 1 from public.patients p
       where p.id = outreach_campaign_recipients.patient_id
         and p.clinic_id = outreach_campaign_recipients.clinic_id
    )
  );

drop policy if exists outreach_campaign_recipients_update on public.outreach_campaign_recipients;
create policy outreach_campaign_recipients_update on public.outreach_campaign_recipients
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

-- MFA (SEG-01): las tablas con datos de pacientes exigen aal2 a quien activó MFA.
drop policy if exists mfa_exige_aal2 on public.patient_controls;
create policy mfa_exige_aal2 on public.patient_controls
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.followup_tasks;
create policy mfa_exige_aal2 on public.followup_tasks
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

drop policy if exists mfa_exige_aal2 on public.outreach_campaign_recipients;
create policy mfa_exige_aal2 on public.outreach_campaign_recipients
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ═══ Reglas ═════════════════════════════════════════════════════════════════

-- Control: clínica, paciente y autor no cambian; la cita vinculada es del mismo
-- paciente; al resolverlo (agendado, cumplido, descartado) la base anota quién y
-- cuándo, y lo borra si vuelve a pendiente.
create or replace function public.validar_control_programado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id
       or new.patient_id is distinct from old.patient_id
       or new.created_by is distinct from old.created_by then
      raise exception 'La clínica, el paciente y quién programó el control no se cambian.'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;

  if new.appointment_id is not null
     and (tg_op = 'INSERT' or new.appointment_id is distinct from old.appointment_id) then
    if not exists (
      select 1 from public.appointments a
       where a.id = new.appointment_id
         and a.clinic_id = new.clinic_id
         and a.patient_id = new.patient_id
    ) then
      raise exception 'La cita no es de este paciente.' using errcode = '42501';
    end if;
  end if;

  new.reason := btrim(new.reason);
  if new.status = 'pendiente' then
    new.resolved_at := null;
    new.resolved_by := null;
  elsif tg_op = 'INSERT' or new.status is distinct from old.status then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  else
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists patient_controls_validar on public.patient_controls;
create trigger patient_controls_validar
  before insert or update on public.patient_controls
  for each row execute function public.validar_control_programado();

-- Tarea: la persona asignada es del equipo de la clínica; paciente, presupuesto
-- y control son de la misma clínica (y el presupuesto, del mismo paciente);
-- clínica y autor no cambian; completar y posponer los anota la base.
create or replace function public.validar_tarea_de_seguimiento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id
       or new.created_by is distinct from old.created_by then
      raise exception 'La clínica y quién creó la tarea no se cambian.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;

  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (
      select 1 from public.clinic_members m
       where m.clinic_id = new.clinic_id and m.user_id = new.assigned_to
    ) then
      raise exception 'La persona asignada no es del equipo de esta clínica.'
        using errcode = '42501';
    end if;
  end if;

  if new.patient_id is not null
     and (tg_op = 'INSERT' or new.patient_id is distinct from old.patient_id) then
    if not exists (
      select 1 from public.patients p where p.id = new.patient_id and p.clinic_id = new.clinic_id
    ) then
      raise exception 'El paciente no es de esta clínica.' using errcode = '42501';
    end if;
  end if;

  if new.quote_id is not null
     and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) then
    if not exists (
      select 1 from public.quotes q
       where q.id = new.quote_id
         and q.clinic_id = new.clinic_id
         and (new.patient_id is null or q.patient_id = new.patient_id)
    ) then
      raise exception 'El presupuesto no es de este paciente ni de esta clínica.'
        using errcode = '42501';
    end if;
  end if;

  if new.control_id is not null
     and (tg_op = 'INSERT' or new.control_id is distinct from old.control_id) then
    if not exists (
      select 1 from public.patient_controls c
       where c.id = new.control_id
         and c.clinic_id = new.clinic_id
         and (new.patient_id is null or c.patient_id = new.patient_id)
    ) then
      raise exception 'El control no es de este paciente ni de esta clínica.'
        using errcode = '42501';
    end if;
  end if;

  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    new.postponed_count := 0;
  elsif new.status = 'pendiente' and old.status = 'pendiente' and new.due_on > old.due_on then
    new.postponed_count := old.postponed_count + 1;
  else
    new.postponed_count := old.postponed_count;
  end if;

  if new.status = 'pendiente' then
    new.completed_at := null;
    new.completed_by := null;
  elsif tg_op = 'INSERT' or new.status is distinct from old.status then
    new.completed_at := now();
    new.completed_by := auth.uid();
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists followup_tasks_validar on public.followup_tasks;
create trigger followup_tasks_validar
  before insert or update on public.followup_tasks
  for each row execute function public.validar_tarea_de_seguimiento();

-- Plantilla: clínica y autor no cambian; quién y cuándo la editó lo pone la base.
create or replace function public.validar_plantilla_de_mensaje()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id
       or new.created_by is distinct from old.created_by then
      raise exception 'La clínica y quién creó la plantilla no se cambian.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(new.name);
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists outreach_templates_validar on public.outreach_templates;
create trigger outreach_templates_validar
  before insert or update on public.outreach_templates
  for each row execute function public.validar_plantilla_de_mensaje();

-- Campaña: borrador → confirmada | cancelada; confirmada → terminada | cancelada.
-- Confirmada, ya no cambian canal, texto ni grupo. Confirmar exige una persona.
create or replace function public.validar_campana()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'borrador' then
      raise exception 'Una campaña nace como borrador.' using errcode = '42501';
    end if;
    new.recipients_count := 0;
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.finished_at := null;
    new.cancelled_at := null;
  else
    if new.clinic_id is distinct from old.clinic_id
       or new.created_by is distinct from old.created_by then
      raise exception 'La clínica y quién creó la campaña no se cambian.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;

    if old.status <> 'borrador'
       and (new.channel is distinct from old.channel
            or new.subject is distinct from old.subject
            or new.body is distinct from old.body
            or new.segment is distinct from old.segment
            or new.template_id is distinct from old.template_id) then
      raise exception 'Una campaña confirmada ya no cambia de canal, texto ni grupo de pacientes.'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'borrador' and new.status in ('confirmada', 'cancelada'))
        or (old.status = 'confirmada' and new.status in ('terminada', 'cancelada'))
      ) then
        raise exception 'La campaña no puede pasar de % a %.', old.status, new.status
          using errcode = '42501';
      end if;
      if new.status = 'confirmada' then
        if auth.uid() is null then
          raise exception 'Una campaña la confirma una persona del equipo.' using errcode = '42501';
        end if;
        new.confirmed_at := now();
        new.confirmed_by := auth.uid();
      elsif new.status = 'terminada' then
        new.finished_at := now();
      elsif new.status = 'cancelada' then
        new.cancelled_at := now();
      end if;
    else
      new.confirmed_at := old.confirmed_at;
      new.confirmed_by := old.confirmed_by;
      new.finished_at := old.finished_at;
      new.cancelled_at := old.cancelled_at;
    end if;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists outreach_campaigns_validar on public.outreach_campaigns;
create trigger outreach_campaigns_validar
  before insert or update on public.outreach_campaigns
  for each row execute function public.validar_campana();

-- Destinatario: el canal sale de la campaña; transiciones según el canal.
--   correo:   pendiente → enviando → enviado | fallido; pendiente → omitido
--   whatsapp: pendiente → abierto (solo una persona) → abierto; pendiente → omitido
create or replace function public.validar_destinatario_de_campana()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_canal text;
  v_estado_campana text;
begin
  select c.channel, c.status into v_canal, v_estado_campana
    from public.outreach_campaigns c
   where c.id = new.campaign_id and c.clinic_id = new.clinic_id;
  if not found then
    raise exception 'La campaña no es de esta clínica.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pendiente' and new.status <> 'omitido' then
      raise exception 'Un destinatario entra pendiente u omitido.' using errcode = '42501';
    end if;
    new.channel := v_canal;
    new.message_id := null;
    new.processed_at := case when new.status = 'omitido' then now() else null end;
    new.processed_by := case when new.status = 'omitido' then auth.uid() else null end;
    return new;
  end if;

  if new.clinic_id is distinct from old.clinic_id
     or new.campaign_id is distinct from old.campaign_id
     or new.patient_id is distinct from old.patient_id
     or new.channel is distinct from old.channel
     or new.destination is distinct from old.destination
     or new.recipient_for is distinct from old.recipient_for then
    raise exception 'El destinatario de una campaña no se cambia.' using errcode = '42501';
  end if;
  new.created_at := old.created_at;

  if new.status is distinct from old.status then
    if v_estado_campana <> 'confirmada' then
      raise exception 'La campaña no está en curso (está %).', v_estado_campana
        using errcode = '42501';
    end if;
    if v_canal = 'whatsapp' then
      -- Nada sale solo: WhatsApp no tiene "enviando" ni "enviado", y "abierto"
      -- solo lo marca una persona que abrió el link.
      if not (
        (old.status = 'pendiente' and new.status in ('abierto', 'omitido'))
      ) then
        raise exception 'En una campaña por WhatsApp un destinatario pasa de pendiente a abierto u omitido.'
          using errcode = '42501';
      end if;
      if new.status = 'abierto' and auth.uid() is null then
        raise exception 'Un mensaje de WhatsApp lo despacha una persona del equipo, nunca un proceso automático.'
          using errcode = '42501';
      end if;
    else
      if not (
        (old.status = 'pendiente' and new.status in ('enviando', 'omitido'))
        or (old.status = 'enviando' and new.status in ('enviado', 'fallido'))
      ) then
        raise exception 'El destinatario no puede pasar de % a %.', old.status, new.status
          using errcode = '42501';
      end if;
    end if;
    new.processed_at := now();
    new.processed_by := coalesce(auth.uid(), old.processed_by);
  elsif new.status = 'abierto' then
    -- Volver a abrir el link (se cerró la pestaña): solo una persona.
    if auth.uid() is null then
      raise exception 'Un mensaje de WhatsApp lo despacha una persona del equipo, nunca un proceso automático.'
        using errcode = '42501';
    end if;
    new.processed_at := now();
    new.processed_by := auth.uid();
  else
    new.processed_at := old.processed_at;
    new.processed_by := old.processed_by;
  end if;
  return new;
end;
$$;

drop trigger if exists outreach_campaign_recipients_validar on public.outreach_campaign_recipients;
create trigger outreach_campaign_recipients_validar
  before insert or update on public.outreach_campaign_recipients
  for each row execute function public.validar_destinatario_de_campana();

-- Reclamo atómico de destinatarios de una campaña por correo (idempotencia del
-- envío): los marca "enviando" y los devuelve. SKIP LOCKED: dos envíos a la vez
-- se reparten la cola sin pisarse. Una campaña por WhatsApp no devuelve nada.
create or replace function public.reclamar_envios_de_campana(
  p_campaign_id uuid,
  p_limite integer default 25
)
returns setof public.outreach_campaign_recipients
language sql
security invoker
set search_path = public
as $$
  update public.outreach_campaign_recipients r
     set status = 'enviando'
   where r.id in (
     select r2.id
       from public.outreach_campaign_recipients r2
       join public.outreach_campaigns c on c.id = r2.campaign_id
      where r2.campaign_id = p_campaign_id
        and r2.status = 'pendiente'
        and c.channel = 'correo'
        and c.status = 'confirmada'
      order by r2.created_at, r2.id
      limit least(greatest(coalesce(p_limite, 25), 1), 50)
      for update of r2 skip locked
   )
  returning r.*;
$$;

revoke all on function public.reclamar_envios_de_campana(uuid, integer) from public, anon;
grant execute on function public.reclamar_envios_de_campana(uuid, integer) to authenticated;

-- ═══ Lecturas agregadas (SECURITY INVOKER: RLS de quien consulta) ════════════

-- CRM-07 y REC-08: una fila por paciente activo con lo que hace falta para el
-- riesgo de abandono. Los conteos son de los últimos 12 meses.
create or replace function public.seguimiento_datos_de_pacientes(p_clinic_id uuid)
returns table (
  patient_id uuid,
  full_name text,
  phone text,
  created_at timestamptz,
  last_visit_at timestamptz,
  visits integer,
  has_future boolean,
  no_shows_12m integer,
  cancelled_12m integer,
  rejected_quotes_12m integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with citas as (
    select a.patient_id,
           max(a.starts_at) filter (where a.status = 'finalizada') as last_visit_at,
           count(*) filter (where a.status = 'finalizada') as visits,
           coalesce(bool_or(a.starts_at > now() and a.status in ('tentativa', 'confirmada', 'en-sala')), false) as has_future,
           count(*) filter (where a.status = 'ausente' and a.starts_at > now() - interval '12 months') as no_shows,
           count(*) filter (
             where a.status = 'cancelada'
               and a.patient_cancelled_at is not null
               and a.starts_at > now() - interval '12 months'
           ) as cancelled
      from public.appointments a
     where a.clinic_id = p_clinic_id
     group by a.patient_id
  ),
  presupuestos as (
    select q.patient_id,
           count(*) filter (
             where q.status in ('rejected', 'expired') and q.updated_at > now() - interval '12 months'
           ) as rejected
      from public.quotes q
     where q.clinic_id = p_clinic_id
     group by q.patient_id
  )
  select p.id,
         p.full_name,
         p.phone,
         p.created_at,
         c.last_visit_at,
         coalesce(c.visits, 0)::integer,
         coalesce(c.has_future, false),
         coalesce(c.no_shows, 0)::integer,
         coalesce(c.cancelled, 0)::integer,
         coalesce(pr.rejected, 0)::integer
    from public.patients p
    left join citas c on c.patient_id = p.id
    left join presupuestos pr on pr.patient_id = p.id
   where p.clinic_id = p_clinic_id
     and p.archived_at is null;
$$;

revoke all on function public.seguimiento_datos_de_pacientes(uuid) from public, anon;
grant execute on function public.seguimiento_datos_de_pacientes(uuid) to authenticated;

-- CRM-06: planes de tratamiento activos con su avance, para detectar los
-- detenidos (sin cita ni atención en N días) y los que quedaron a medias.
create or replace function public.seguimiento_planes_activos(p_clinic_id uuid)
returns table (
  plan_id uuid,
  patient_id uuid,
  patient_name text,
  plan_name text,
  plan_created_at timestamptz,
  plan_started_at timestamptz,
  quote_id uuid,
  pending_items integer,
  completed_items integer,
  last_item_completed_at timestamptz,
  last_visit_at timestamptz,
  has_future boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with items as (
    select i.plan_id,
           count(*) filter (where i.status in ('pending', 'in_progress')) as pendientes,
           count(*) filter (where i.status = 'completed') as completados,
           max(i.completed_at) as ultimo
      from public.treatment_items i
     where i.clinic_id = p_clinic_id
     group by i.plan_id
  ),
  citas as (
    select a.patient_id,
           max(a.starts_at) filter (where a.status = 'finalizada') as last_visit_at,
           coalesce(bool_or(a.starts_at > now() and a.status in ('tentativa', 'confirmada', 'en-sala')), false) as has_future
      from public.appointments a
     where a.clinic_id = p_clinic_id
     group by a.patient_id
  )
  select tp.id,
         tp.patient_id,
         p.full_name,
         tp.name,
         tp.created_at,
         tp.started_at,
         tp.quote_id,
         coalesce(it.pendientes, 0)::integer,
         coalesce(it.completados, 0)::integer,
         it.ultimo,
         c.last_visit_at,
         coalesce(c.has_future, false)
    from public.treatment_plans tp
    join public.patients p on p.id = tp.patient_id and p.archived_at is null
    left join items it on it.plan_id = tp.id
    left join citas c on c.patient_id = tp.patient_id
   where tp.clinic_id = p_clinic_id
     and tp.status = 'active';
$$;

revoke all on function public.seguimiento_planes_activos(uuid) from public, anon;
grant execute on function public.seguimiento_planes_activos(uuid) to authenticated;

-- ═══ Clínica demo: solo lectura ═════════════════════════════════════════════

drop trigger if exists block_demo_writes on public.patient_controls;
create trigger block_demo_writes
  before insert or update or delete on public.patient_controls
  for each row execute function public.block_demo_writes();

drop trigger if exists block_demo_writes on public.followup_tasks;
create trigger block_demo_writes
  before insert or update or delete on public.followup_tasks
  for each row execute function public.block_demo_writes();

drop trigger if exists block_demo_writes on public.outreach_templates;
create trigger block_demo_writes
  before insert or update or delete on public.outreach_templates
  for each row execute function public.block_demo_writes();

drop trigger if exists block_demo_writes on public.outreach_campaigns;
create trigger block_demo_writes
  before insert or update or delete on public.outreach_campaigns
  for each row execute function public.block_demo_writes();

drop trigger if exists block_demo_writes on public.outreach_campaign_recipients;
create trigger block_demo_writes
  before insert or update or delete on public.outreach_campaign_recipients
  for each row execute function public.block_demo_writes();

-- ── Reversa (hacer antes un backup si ya hay datos) ───────────────────────
-- drop trigger if exists block_demo_writes on public.outreach_campaign_recipients;
-- drop trigger if exists block_demo_writes on public.outreach_campaigns;
-- drop trigger if exists block_demo_writes on public.outreach_templates;
-- drop trigger if exists block_demo_writes on public.followup_tasks;
-- drop trigger if exists block_demo_writes on public.patient_controls;
-- drop function if exists public.seguimiento_planes_activos(uuid);
-- drop function if exists public.seguimiento_datos_de_pacientes(uuid);
-- drop function if exists public.reclamar_envios_de_campana(uuid, integer);
-- drop trigger if exists outreach_campaign_recipients_validar on public.outreach_campaign_recipients;
-- drop function if exists public.validar_destinatario_de_campana();
-- drop trigger if exists outreach_campaigns_validar on public.outreach_campaigns;
-- drop function if exists public.validar_campana();
-- drop trigger if exists outreach_templates_validar on public.outreach_templates;
-- drop function if exists public.validar_plantilla_de_mensaje();
-- drop trigger if exists followup_tasks_validar on public.followup_tasks;
-- drop function if exists public.validar_tarea_de_seguimiento();
-- drop trigger if exists patient_controls_validar on public.patient_controls;
-- drop function if exists public.validar_control_programado();
-- drop policy if exists mfa_exige_aal2 on public.outreach_campaign_recipients;
-- drop policy if exists mfa_exige_aal2 on public.followup_tasks;
-- drop policy if exists mfa_exige_aal2 on public.patient_controls;
-- drop table if exists public.outreach_campaign_recipients;
-- drop table if exists public.outreach_campaigns;
-- drop table if exists public.outreach_templates;
-- drop table if exists public.followup_tasks;
-- drop table if exists public.patient_controls;
