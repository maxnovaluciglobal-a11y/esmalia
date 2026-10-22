-- Ola 4 · Frente Presupuesto PDF y correo (1/3): PLA-08, PLA-09, DOC-07.
--
--   1. document_templates.kind suma 'presupuesto' (la plantilla del PDF del
--      presupuesto vive en el mismo motor de documentos). El CHECK se
--      reescribe a partir de su definición ACTUAL, agregando el valor: el
--      frente Receta suma 'receta' en paralelo y, apliquen en el orden que
--      apliquen, ninguno pisa el valor del otro.
--   2. patients.email_opt_out_at: baja de correos del paciente (el enlace del
--      pie de los correos que la clínica le manda; el mismo token firmado de
--      /correos/baja). NULL = recibe correos. La baja de WhatsApp
--      (`wa_opt_out_at`) sigue siendo aparte.
--   3. messages.issued_document_id: el correo con la copia de un documento
--      emitido (DOC-07) queda en `messages` como cualquier envío, apuntando al
--      documento. Un trigger exige que el documento sea de la misma clínica.
--   4. quote_events: kind 'envio' + message_id. El envío del presupuesto por
--      correo (PLA-09) deja un evento en el historial con quién, cuándo y a
--      qué correo, y marca el presupuesto como enviado (`sent_at`; un
--      borrador pasa a 'sent'). Lo escribe `registrar_envio_de_presupuesto`
--      a partir de la fila de `messages` del envío: nadie puede fabricar un
--      evento de envío sin un correo enviado por él mismo.
--
-- Compatible con el código en producción (RUNBOOK regla 3): columnas
-- nullable, un valor más en dos CHECK, un trigger y una función nuevos. El
-- código actual no lee ninguna de estas columnas; un evento 'envio' en el
-- historial lo muestra sin texto hasta que llegue el código nuevo.
--
-- Reversa al pie.

begin;

-- ─── 1. Plantillas de tipo presupuesto ─────────────────────────────────────

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.document_templates'::regclass
     and c.conname = 'document_templates_kind_check';
  if v_def is null then
    raise exception 'No existe document_templates_kind_check: falta la migración 20261025100000.';
  end if;
  if position('''presupuesto''' in v_def) = 0 then
    if position('''otro''::text' in v_def) = 0 then
      raise exception 'document_templates_kind_check no tiene la forma esperada: %', v_def;
    end if;
    execute 'alter table public.document_templates drop constraint document_templates_kind_check';
    execute 'alter table public.document_templates add constraint document_templates_kind_check '
      || replace(v_def, '''otro''::text', '''otro''::text, ''presupuesto''::text');
  end if;
end;
$$;

-- ─── 2. Baja de correos del paciente ───────────────────────────────────────

alter table public.patients
  add column if not exists email_opt_out_at timestamptz;

comment on column public.patients.email_opt_out_at is
  'Ola 4: el paciente se dio de baja de los correos de la clínica (enlace del pie). NULL = recibe correos. Lo respeta el servidor en todo envío por correo al paciente.';

-- ─── 3. Copia de un documento emitido por correo ───────────────────────────

alter table public.messages
  add column if not exists issued_document_id uuid
    references public.issued_documents(id) on delete set null;

create index if not exists messages_issued_document_idx
  on public.messages (issued_document_id)
  where issued_document_id is not null;

comment on column public.messages.issued_document_id is
  'DOC-07: correo con la copia de este documento emitido al paciente.';

create or replace function public.messages_documento_de_la_clinica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.issued_document_id is not null
     and (tg_op = 'INSERT' or new.issued_document_id is distinct from old.issued_document_id)
     and not exists (
       select 1 from public.issued_documents d
        where d.id = new.issued_document_id and d.clinic_id = new.clinic_id
     )
  then
    raise exception 'El documento no pertenece a esta clínica.' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke execute on function public.messages_documento_de_la_clinica() from public, anon, authenticated;

drop trigger if exists messages_documento_de_la_clinica on public.messages;
create trigger messages_documento_de_la_clinica
  before insert or update of issued_document_id, clinic_id on public.messages
  for each row execute function public.messages_documento_de_la_clinica();

-- ─── 4. Envío del presupuesto en el historial ──────────────────────────────

alter table public.quote_events
  drop constraint if exists quote_events_kind_check;
alter table public.quote_events
  add constraint quote_events_kind_check
  check (kind in ('creado', 'estado', 'contacto', 'validez', 'envio'));

alter table public.quote_events
  add column if not exists message_id uuid references public.messages(id) on delete set null;

-- Un evento por envío: llamar dos veces con el mismo mensaje no duplica.
create unique index if not exists quote_events_message_uniq
  on public.quote_events (message_id)
  where message_id is not null;

comment on column public.quote_events.message_id is
  'PLA-09: el mensaje (correo) que originó el evento de envío.';

-- Registra el envío por correo de un presupuesto a partir de su mensaje.
-- SECURITY DEFINER porque quote_events no tiene políticas de escritura (la
-- base escribe el historial). Exige que el mensaje lo haya enviado quien
-- llama, por correo, con estado 'sent' y apuntando a un presupuesto de una
-- clínica donde tiene un rol que escribe presupuestos.
create or replace function public.registrar_envio_de_presupuesto(
  p_message_id uuid,
  p_redirigido_a text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg record;
  v_quote record;
  v_nota text;
  v_redirigido text := nullif(btrim(coalesce(p_redirigido_a, '')), '');
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión.' using errcode = '42501';
  end if;
  if not (select public.sesion_cumple_mfa()) then
    raise exception 'Confirma tu segundo factor para continuar.' using errcode = '42501';
  end if;

  select id, clinic_id, quote_id, recipient, channel, status, sent_by
    into v_msg
    from public.messages
   where id = p_message_id;
  if v_msg.id is null
     or v_msg.sent_by is distinct from v_uid
     or v_msg.channel <> 'email'
     or v_msg.status <> 'sent'
     or v_msg.quote_id is null
  then
    raise exception 'No encontramos ese envío.' using errcode = '22023';
  end if;

  if not public.has_clinic_role(
    v_msg.clinic_id, array['owner','admin','dentist','reception']::public.app_role[]
  ) then
    raise exception 'No tienes permisos para enviar presupuestos.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinics where id = v_msg.clinic_id and is_demo) then
    raise exception 'Esta es la clínica demo, de solo lectura. Crea tu clínica real para guardar cambios.';
  end if;

  select id, clinic_id, status into v_quote
    from public.quotes
   where id = v_msg.quote_id and clinic_id = v_msg.clinic_id
   for update;
  if v_quote.id is null then
    raise exception 'No encontramos ese presupuesto.' using errcode = '22023';
  end if;

  if v_redirigido is not null and char_length(v_redirigido) > 254 then
    v_redirigido := left(v_redirigido, 254);
  end if;
  v_nota := 'Por correo a ' || v_msg.recipient
    || case when v_redirigido is not null
            then ' (modo de prueba del correo: llegó a ' || v_redirigido || ')'
            else '' end;

  insert into public.quote_events (clinic_id, quote_id, kind, note, actor_id, message_id)
  values (v_msg.clinic_id, v_msg.quote_id, 'envio', v_nota, v_uid, v_msg.id)
  on conflict (message_id) where message_id is not null do nothing;
  if not found then
    return; -- ya registrado
  end if;

  -- Marca de enviado. Un borrador pasa a 'sent' (el trigger del historial
  -- deja además el cambio de estado, con quien envió como actor); en otro
  -- estado solo se completa la primera fecha de envío.
  update public.quotes
     set sent_at = coalesce(sent_at, now()),
         status = case when status = 'draft' then 'sent'::public.quote_status else status end
   where id = v_quote.id;
end;
$$;

comment on function public.registrar_envio_de_presupuesto(uuid, text) is
  'PLA-09: deja el envío por correo de un presupuesto en su historial (quote_events kind envio) y lo marca como enviado.';

revoke all on function public.registrar_envio_de_presupuesto(uuid, text) from public, anon;
grant execute on function public.registrar_envio_de_presupuesto(uuid, text) to authenticated;

commit;

-- Cómo revertir (los eventos 'envio' se borran; los correos quedan en messages):
--
-- begin;
-- drop function if exists public.registrar_envio_de_presupuesto(uuid, text);
-- drop index if exists public.quote_events_message_uniq;
-- alter table public.quote_events drop column if exists message_id;
-- delete from public.quote_events where kind = 'envio';
-- alter table public.quote_events drop constraint if exists quote_events_kind_check;
-- alter table public.quote_events add constraint quote_events_kind_check
--   check (kind in ('creado', 'estado', 'contacto', 'validez'));
-- drop trigger if exists messages_documento_de_la_clinica on public.messages;
-- drop function if exists public.messages_documento_de_la_clinica();
-- drop index if exists public.messages_issued_document_idx;
-- alter table public.messages drop column if exists issued_document_id;
-- alter table public.patients drop column if exists email_opt_out_at;
-- -- (la plantilla 'presupuesto' se revierte con la migración 20261025200100;
-- --  después, sacar 'presupuesto'::text del CHECK document_templates_kind_check
-- --  con el mismo replace de arriba, al revés)
-- commit;
