-- Ola 5 · Frente Firma a distancia (1/2): DOC-05, el paciente firma en su
-- celular con un código.
--
-- El staff pide la firma de un documento emitido (un consentimiento o
-- cualquier documento cuya plantilla diga "requiere firma del paciente") o
-- la aceptación de un presupuesto. Se genera un link de un solo uso que vence
-- a las 72 horas; el paciente confirma su identidad con su RUT y con un
-- código de 6 dígitos que le llega por correo, y firma. Firma electrónica
-- SIMPLE (Ley 19.799, art. 2 letra f), no avanzada.
--
--   1. document_templates.requires_patient_signature: la clínica marca qué
--      plantillas se firman por el paciente (los consentimientos lo requieren
--      siempre, sin migrar datos: lo decide `documento_requiere_firma`).
--   2. patient_signature_requests: la solicitud con la copia del documento
--      tal como lo ve el paciente (bloques del motor, HTML canónico y su
--      huella SHA-256, que calcula la base), el estado de la verificación y,
--      al firmar, la evidencia completa. El link es un token aleatorio de 256
--      bits: la base guarda SOLO su sha256. Firmada, la fila no se edita ni
--      se borra (Decreto 41: se conserva con la ficha); lo único que se le
--      agrega después es la ruta de la copia firmada en PDF, una vez.
--   3. patient_signature_events: bitácora de cada solicitud (abrir, RUT
--      correcto o fallido, código enviado, firma, cancelación). La escribe la
--      base; sirve de evidencia y de contador para el límite por IP.
--   4. Staff: crear (INSERT con RLS + trigger que completa y valida),
--      reenviar (INSERT con `replaces_request_id`: el link anterior queda
--      reemplazado) y cancelar (`firma_remota_cancelar`). Sin UPDATE ni
--      DELETE desde la API.
--
-- Las funciones que usa la página pública (sin login) van en la migración
-- siguiente (20261026100100): solo las ejecuta el rol de servicio.
--
-- Permisos (regla 2 y regla 15): un documento emitido es clínico, así que su
-- solicitud la leen los roles clínicos (owner, admin, dentist, assistant) y
-- la crean los que emiten documentos (owner, admin, dentist). Un presupuesto
-- lo lee cualquier miembro (igual que `quotes`) y lo crean los que escriben
-- presupuestos (owner, admin, dentist, reception). Política RESTRICTIVE
-- `mfa_exige_aal2` en las dos tablas nuevas (src/lib/auth/mfa-rls.ts).
--
-- Compatible con el código en producción (RUNBOOK regla 3): una columna con
-- default, tablas, funciones y triggers nuevos. No cambia nada existente.
--
-- Reversa al pie.

begin;

-- ─── 1. Plantillas que requieren la firma del paciente ─────────────────────

alter table public.document_templates
  add column if not exists requires_patient_signature boolean not null default false;

comment on column public.document_templates.requires_patient_signature is
  'DOC-05: los documentos emitidos con esta plantilla se pueden mandar a firmar a distancia al paciente. Los de tipo consentimiento lo requieren siempre.';

-- ¿Se le puede pedir la firma al paciente para este documento emitido?
create or replace function public.documento_requiere_firma(p_issued_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.issued_documents d
      left join public.document_templates t on t.id = d.template_id
     where d.id = p_issued_document_id
       and (d.kind = 'consentimiento' or coalesce(t.requires_patient_signature, false))
  );
$$;

revoke all on function public.documento_requiere_firma(uuid) from public, anon, authenticated;
grant execute on function public.documento_requiere_firma(uuid) to service_role;

-- ─── 2. Utilidades internas ────────────────────────────────────────────────

-- "ana.perez@correo.cl" → "a•••@correo.cl". Para mostrar a dónde llegó el
-- código sin exponer el correo completo.
create or replace function public.mascara_correo(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(btrim(p_email), 1) || '•••' || substr(btrim(p_email), position('@' in btrim(p_email)))
  end
$$;

revoke all on function public.mascara_correo(text) from public, anon;

-- Huella de lo que el paciente acepta en un presupuesto: las líneas y los
-- totales. Si la clínica cambia el presupuesto después de pedir la firma, la
-- huella cambia y la firma se rechaza (hay que pedir un link nuevo).
create or replace function public.huella_de_presupuesto(p_quote_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(sha256(convert_to(
    coalesce((
      select string_agg(
               concat_ws('|', qi.id, qi.name_snapshot, qi.tooth_number, qi.quantity,
                         qi.unit_price_cents, qi.discount_cents, qi.discount_pct,
                         qi.total_cents, qi.phase_label),
               ';' order by qi.id)
        from public.quote_items qi
       where qi.quote_id = p_quote_id
    ), '')
    || '#'
    || coalesce((
      select concat_ws('|', q.currency, q.subtotal_cents, q.discount_cents,
                       q.commercial_discount_pct, q.total_cents, q.coverage_total_cents,
                       q.valid_until)
        from public.quotes q
       where q.id = p_quote_id
    ), ''),
    'UTF8')), 'hex');
$$;

revoke all on function public.huella_de_presupuesto(uuid) from public, anon, authenticated;
grant execute on function public.huella_de_presupuesto(uuid) to service_role;

-- ─── 3. Solicitudes de firma ───────────────────────────────────────────────

create table if not exists public.patient_signature_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- RESTRICT como el resto de las FKs clínicas: los pacientes se archivan.
  patient_id uuid not null references public.patients(id) on delete restrict,
  kind text not null,
  issued_document_id uuid references public.issued_documents(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete restrict,
  -- Reenvío: la solicitud que esta reemplaza (su link deja de servir).
  replaces_request_id uuid references public.patient_signature_requests(id) on delete set null,

  -- Lo que ve y firma el paciente (copia, no referencia).
  title text not null,
  -- Encabezado y pie de la hoja (src/lib/documentos/pdf.ts, HojaParaPdf sin
  -- imágenes): nombre de la clínica, líneas de datos, referencia y pie.
  sheet jsonb not null,
  content_blocks jsonb not null,
  content_html text not null,
  -- Firma del profesional que va en la hoja (ruta en professional-signatures y su sha256).
  professional_signature_path text,
  professional_signature_sha256 text,
  -- sha256(content_html || U+001F || coalesce(professional_signature_sha256, '')):
  -- la calcula la base. En un documento emitido es su `content_sha256`.
  document_sha256 text not null,
  -- Presupuesto: huella de líneas y totales al pedir la firma.
  quote_fingerprint text,

  -- Quién firma: el paciente, o su tutor si es menor (CLI-11).
  signer_role text not null,
  guardian_id uuid references public.patient_guardians(id) on delete set null,
  signer_expected_name text not null,
  -- Canal por el que salió el link y canal del código (decisión: siempre
  -- correo, ver docs/FIRMA_A_DISTANCIA.md).
  link_channel text not null,
  code_channel text not null default 'correo',
  code_recipient_masked text,

  token_hash text not null,
  status text not null default 'enviada',
  expires_at timestamptz not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,

  -- Verificación (la escribe la página pública vía funciones de la base).
  rut_attempts integer not null default 0,
  rut_verified_at timestamptz,
  session_hash text,
  session_expires_at timestamptz,
  code_hash text,
  code_sent_at timestamptz,
  code_expires_at timestamptz,
  codes_sent integer not null default 0,
  code_attempts integer not null default 0,
  locked_until timestamptz,

  -- Evidencia (Ley 19.799): se completa al firmar y no cambia más.
  signer_rut_masked text,
  -- sha256(id || U+001F || documento normalizado): prueba el RUT sin guardarlo.
  signer_rut_sha256 text,
  signed_at timestamptz,
  signer_name text,
  accepted_text text,
  signed_ip text,
  signed_user_agent text,
  signature_storage_path text,
  signature_sha256 text,
  clinic_timezone text,
  signed_at_local text,
  evidence_sha256 text,
  -- Copia firmada (PDF con el bloque de evidencia) en clinical-documents.
  signed_copy_path text,
  signed_copy_sha256 text,
  signed_copy_at timestamptz,

  constraint patient_signature_requests_kind_check check (kind in ('documento', 'presupuesto')),
  constraint patient_signature_requests_target_check check (
    (kind = 'documento' and issued_document_id is not null and quote_id is null)
    or (kind = 'presupuesto' and quote_id is not null and issued_document_id is null)
  ),
  constraint patient_signature_requests_status_check check (
    status in ('enviada', 'abierta', 'firmada', 'cancelada', 'reemplazada')
  ),
  constraint patient_signature_requests_signer_check check (signer_role in ('paciente', 'tutor')),
  constraint patient_signature_requests_link_channel_check check (
    link_channel in ('whatsapp', 'correo', 'copiado')
  ),
  constraint patient_signature_requests_code_channel_check check (code_channel in ('correo')),
  constraint patient_signature_requests_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint patient_signature_requests_token_hash_uniq unique (token_hash),
  constraint patient_signature_requests_title_check check (char_length(btrim(title)) between 2 and 200),
  constraint patient_signature_requests_blocks_check check (jsonb_typeof(content_blocks) = 'array'),
  constraint patient_signature_requests_sheet_check check (jsonb_typeof(sheet) = 'object'),
  constraint patient_signature_requests_html_check check (char_length(content_html) between 1 and 200000),
  constraint patient_signature_requests_firmada_check check (
    status <> 'firmada'
    or (signed_at is not null and signer_name is not null and evidence_sha256 is not null)
  ),
  constraint patient_signature_requests_cancel_reason_check check (
    cancel_reason is null or char_length(cancel_reason) <= 300
  )
);

comment on table public.patient_signature_requests is
  'DOC-05: firma a distancia de un documento o presupuesto por el paciente (firma electrónica simple, Ley 19.799). Guarda la copia de lo firmado y la evidencia; firmada, no se edita ni se borra.';
comment on column public.patient_signature_requests.token_hash is
  'sha256 del token del link (/firmar/<token>). El token no se guarda.';

create index if not exists patient_signature_requests_patient_idx
  on public.patient_signature_requests (clinic_id, patient_id, created_at desc);
create index if not exists patient_signature_requests_patient_id_idx
  on public.patient_signature_requests (patient_id);
create index if not exists patient_signature_requests_document_idx
  on public.patient_signature_requests (issued_document_id) where issued_document_id is not null;
create index if not exists patient_signature_requests_quote_idx
  on public.patient_signature_requests (quote_id) where quote_id is not null;
create index if not exists patient_signature_requests_replaces_idx
  on public.patient_signature_requests (replaces_request_id) where replaces_request_id is not null;
create index if not exists patient_signature_requests_guardian_idx
  on public.patient_signature_requests (guardian_id) where guardian_id is not null;

-- ─── 4. Bitácora ───────────────────────────────────────────────────────────

create table if not exists public.patient_signature_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  request_id uuid not null references public.patient_signature_requests(id) on delete cascade,
  kind text not null,
  -- Staff que hizo la acción (crear, cancelar); NULL = el paciente.
  actor_id uuid,
  ip_hint text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint patient_signature_events_kind_check check (kind in (
    'creada', 'abierta', 'rut_correcto', 'rut_incorrecto', 'bloqueada', 'codigo_enviado',
    'codigo_incorrecto', 'firmada', 'copia_guardada', 'cancelada', 'reemplazada', 'limitada'
  )),
  constraint patient_signature_events_ip_check check (ip_hint is null or char_length(ip_hint) <= 64),
  constraint patient_signature_events_ua_check check (user_agent is null or char_length(user_agent) <= 400)
);

comment on table public.patient_signature_events is
  'DOC-05: bitácora de cada solicitud de firma a distancia. La escribe la base (funciones SECURITY DEFINER); nadie la edita desde la API.';

create index if not exists patient_signature_events_request_idx
  on public.patient_signature_events (request_id, created_at);
create index if not exists patient_signature_events_clinic_idx
  on public.patient_signature_events (clinic_id);
create index if not exists patient_signature_events_ip_idx
  on public.patient_signature_events (ip_hint, created_at) where ip_hint is not null;

-- ─── 5. Crear una solicitud: lo que la base sabe mejor que el cliente ──────

create or replace function public.patient_signature_requests_preparar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc record;
  v_quote record;
  v_patient record;
  v_clinic record;
  v_guardian record;
  v_old record;
  v_email text;
  v_hoy date;
begin
  if v_uid is null then
    raise exception 'La firma a distancia la pide alguien del equipo con su cuenta.' using errcode = '42501';
  end if;

  select id, name, timezone, is_demo into v_clinic from public.clinics where id = new.clinic_id;
  if v_clinic.id is null then
    raise exception 'La clínica no existe.' using errcode = '23503';
  end if;
  if v_clinic.is_demo then
    raise exception 'Esta es la clínica demo, de solo lectura. Crea tu clínica real para pedir firmas.';
  end if;

  -- Lo que pone la base, no el cliente.
  new.created_by := v_uid;
  new.created_at := now();
  new.expires_at := now() + interval '72 hours';
  new.status := 'enviada';
  new.code_channel := 'correo';
  new.opened_at := null;
  new.cancelled_at := null;
  new.cancelled_by := null;
  new.cancel_reason := null;
  new.rut_attempts := 0;
  new.rut_verified_at := null;
  new.session_hash := null;
  new.session_expires_at := null;
  new.code_hash := null;
  new.code_sent_at := null;
  new.code_expires_at := null;
  new.codes_sent := 0;
  new.code_attempts := 0;
  new.locked_until := null;
  new.signer_rut_masked := null;
  new.signer_rut_sha256 := null;
  new.signed_at := null;
  new.signer_name := null;
  new.accepted_text := null;
  new.signed_ip := null;
  new.signed_user_agent := null;
  new.signature_storage_path := null;
  new.signature_sha256 := null;
  new.clinic_timezone := coalesce(v_clinic.timezone, 'America/Santiago');
  new.signed_at_local := null;
  new.evidence_sha256 := null;
  new.signed_copy_path := null;
  new.signed_copy_sha256 := null;
  new.signed_copy_at := null;
  new.quote_fingerprint := null;

  if new.kind = 'documento' then
    select d.id, d.patient_id, d.title, d.content_blocks, d.content_html, d.content_sha256,
           d.signature_storage_path, d.signature_sha256, d.voided_at
      into v_doc
      from public.issued_documents d
     where d.id = new.issued_document_id and d.clinic_id = new.clinic_id
     for share;
    if v_doc.id is null then
      raise exception 'El documento no existe en esta clínica.' using errcode = '23503';
    end if;
    if v_doc.voided_at is not null then
      raise exception 'Este documento está anulado: no se manda a firmar.' using errcode = '23514';
    end if;
    if not public.documento_requiere_firma(v_doc.id) then
      raise exception 'Este documento no requiere la firma del paciente. Márcalo en su plantilla si la necesita.'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from public.patient_signature_requests r
       where r.issued_document_id = v_doc.id and r.status = 'firmada'
    ) then
      raise exception 'El paciente ya firmó este documento.' using errcode = '23514';
    end if;
    -- El contenido sale del documento emitido, no del cliente.
    new.patient_id := v_doc.patient_id;
    new.title := v_doc.title;
    new.content_blocks := v_doc.content_blocks;
    new.content_html := v_doc.content_html;
    new.professional_signature_path := v_doc.signature_storage_path;
    new.professional_signature_sha256 := v_doc.signature_sha256;
    new.document_sha256 := v_doc.content_sha256;
  else
    select q.id, q.patient_id, q.status, q.number
      into v_quote
      from public.quotes q
     where q.id = new.quote_id and q.clinic_id = new.clinic_id
     for update;
    if v_quote.id is null then
      raise exception 'El presupuesto no existe en esta clínica.' using errcode = '23503';
    end if;
    if v_quote.status not in ('draft', 'sent') then
      raise exception 'Solo se manda a firmar un presupuesto en borrador o enviado.' using errcode = '23514';
    end if;
    new.patient_id := v_quote.patient_id;
    if new.professional_signature_sha256 is not null
       and new.professional_signature_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'Huella de la firma del profesional inválida.' using errcode = '22023';
    end if;
    -- El contenido lo arma el servidor con el motor (la RLS del usuario ya
    -- dejó leer el presupuesto); la huella la calcula la base.
    new.document_sha256 := encode(sha256(convert_to(
      new.content_html || chr(31) || coalesce(new.professional_signature_sha256, ''),
      'UTF8'
    )), 'hex');
    new.quote_fingerprint := public.huella_de_presupuesto(v_quote.id);
    -- Mandarlo a firmar es enviarlo: un borrador pasa a enviado (como el correo).
    if v_quote.status = 'draft' then
      update public.quotes
         set status = 'sent', sent_at = coalesce(sent_at, now())
       where id = v_quote.id;
    end if;
  end if;

  -- Paciente y quién firma.
  select id, full_name, document_id, email, birth_date, archived_at
    into v_patient
    from public.patients
   where id = new.patient_id and clinic_id = new.clinic_id;
  if v_patient.id is null then
    raise exception 'El paciente no pertenece a esta clínica.' using errcode = '23503';
  end if;
  if v_patient.archived_at is not null then
    raise exception 'La ficha del paciente está archivada.' using errcode = '23514';
  end if;

  v_hoy := (now() at time zone coalesce(v_clinic.timezone, 'America/Santiago'))::date;
  if v_patient.birth_date is not null and v_patient.birth_date > (v_hoy - interval '18 years')::date then
    select id, full_name, document_id, email
      into v_guardian
      from public.patient_guardians
     where patient_id = new.patient_id and clinic_id = new.clinic_id and archived_at is null
     order by is_primary desc, created_at
     limit 1;
    if v_guardian.id is null then
      raise exception 'El paciente es menor de edad: agrega a su tutor en la ficha para pedirle la firma.'
        using errcode = '23514';
    end if;
    new.signer_role := 'tutor';
    new.guardian_id := v_guardian.id;
    new.signer_expected_name := v_guardian.full_name;
    v_email := coalesce(nullif(btrim(v_guardian.email), ''), nullif(btrim(v_patient.email), ''));
  else
    if public.normalizar_documento(v_patient.document_id) is null then
      raise exception 'Carga el RUT del paciente en su ficha: se lo pedimos para confirmar que es él quien firma.'
        using errcode = '23514';
    end if;
    new.signer_role := 'paciente';
    new.guardian_id := null;
    new.signer_expected_name := v_patient.full_name;
    v_email := nullif(btrim(v_patient.email), '');
  end if;

  if v_email is null then
    raise exception 'Agrega el correo del paciente en su ficha: el código para firmar le llega por correo.'
      using errcode = '23514';
  end if;
  new.code_recipient_masked := public.mascara_correo(v_email);

  -- Una sola solicitud abierta por documento o presupuesto. Reenviar es
  -- reemplazar la anterior (su link deja de servir).
  if new.replaces_request_id is not null then
    select id, status, issued_document_id, quote_id, clinic_id
      into v_old
      from public.patient_signature_requests
     where id = new.replaces_request_id
     for update;
    if v_old.id is null or v_old.clinic_id <> new.clinic_id
       or v_old.issued_document_id is distinct from new.issued_document_id
       or v_old.quote_id is distinct from new.quote_id then
      raise exception 'La solicitud a reenviar no es de este documento.' using errcode = '23514';
    end if;
    if v_old.status not in ('enviada', 'abierta') then
      raise exception 'Esa solicitud ya no está abierta: pide una firma nueva.' using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1 from public.patient_signature_requests r
     where r.clinic_id = new.clinic_id
       and r.status in ('enviada', 'abierta')
       and r.expires_at > now()
       and r.id is distinct from new.replaces_request_id
       and (r.issued_document_id = new.issued_document_id or r.quote_id = new.quote_id)
  ) then
    raise exception 'Ya hay una firma pedida para este documento: reenvíala o cancélala.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke execute on function public.patient_signature_requests_preparar() from public, anon, authenticated;

drop trigger if exists patient_signature_requests_preparar on public.patient_signature_requests;
create trigger patient_signature_requests_preparar
  before insert on public.patient_signature_requests
  for each row execute function public.patient_signature_requests_preparar();

-- Después de crear: el evento y, si es un reenvío, la anterior queda reemplazada.
create or replace function public.patient_signature_requests_creada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.replaces_request_id is not null then
    update public.patient_signature_requests
       set status = 'reemplazada', session_hash = null, code_hash = null
     where id = new.replaces_request_id and status in ('enviada', 'abierta');
    insert into public.patient_signature_events (clinic_id, request_id, kind, actor_id)
    values (new.clinic_id, new.replaces_request_id, 'reemplazada', new.created_by);
  end if;
  insert into public.patient_signature_events (clinic_id, request_id, kind, actor_id)
  values (new.clinic_id, new.id, 'creada', new.created_by);
  return null;
end;
$$;

revoke execute on function public.patient_signature_requests_creada() from public, anon, authenticated;

drop trigger if exists patient_signature_requests_creada on public.patient_signature_requests;
create trigger patient_signature_requests_creada
  after insert on public.patient_signature_requests
  for each row execute function public.patient_signature_requests_creada();

-- ─── 6. Inmutabilidad ──────────────────────────────────────────────────────
-- Corre para TODOS (también el rol de servicio y las funciones de la base):
-- lo que se pidió firmar no cambia nunca; una firma no se edita; lo único
-- que se le agrega a una firmada es la copia en PDF, una vez.
create or replace function public.patient_signature_requests_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_fijas text[] := array[
    'id', 'clinic_id', 'patient_id', 'kind', 'issued_document_id', 'quote_id', 'title',
    'sheet', 'content_blocks', 'content_html', 'professional_signature_path',
    'professional_signature_sha256', 'document_sha256', 'quote_fingerprint', 'signer_role',
    'signer_expected_name', 'link_channel', 'code_channel', 'code_recipient_masked',
    'token_hash', 'expires_at', 'created_by', 'created_at', 'clinic_timezone'
  ];
  v_copia text[] := array['signed_copy_path', 'signed_copy_sha256', 'signed_copy_at'];
  v_fk text[] := array['guardian_id', 'replaces_request_id'];
begin
  -- Las FKs con ON DELETE SET NULL pueden pasar a NULL; nada más.
  if (new.guardian_id is distinct from old.guardian_id and new.guardian_id is not null)
     or (new.replaces_request_id is distinct from old.replaces_request_id
         and new.replaces_request_id is not null) then
    raise exception 'Una solicitud de firma no cambia de firmante ni de origen.' using errcode = '23514';
  end if;

  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_fijas) k)
     is distinct from
     (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_fijas) k) then
    raise exception 'Lo que se pidió firmar no se edita: cancela la solicitud y pide una nueva.'
      using errcode = '23514';
  end if;

  if old.status = 'firmada' then
    if (to_jsonb(new) - v_fk - v_copia) is distinct from (to_jsonb(old) - v_fk - v_copia) then
      raise exception 'Una firma no se edita.' using errcode = '23514';
    end if;
    if old.signed_copy_path is not null
       and (new.signed_copy_path, new.signed_copy_sha256, new.signed_copy_at)
           is distinct from (old.signed_copy_path, old.signed_copy_sha256, old.signed_copy_at) then
      raise exception 'La copia firmada ya está guardada.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status in ('cancelada', 'reemplazada')
     and (to_jsonb(new) - v_fk) is distinct from (to_jsonb(old) - v_fk) then
    raise exception 'Esta solicitud ya no está abierta.' using errcode = '23514';
  end if;

  if new.signed_copy_path is not null and new.status <> 'firmada' then
    raise exception 'Solo una firma tiene copia firmada.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.patient_signature_requests_proteger() from public, anon, authenticated;

drop trigger if exists patient_signature_requests_proteger on public.patient_signature_requests;
create trigger patient_signature_requests_proteger
  before update on public.patient_signature_requests
  for each row execute function public.patient_signature_requests_proteger();

-- La bitácora no se edita.
create or replace function public.patient_signature_events_inmutables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'La bitácora de la firma no se edita.' using errcode = '23514';
end;
$$;

revoke execute on function public.patient_signature_events_inmutables() from public, anon, authenticated;

drop trigger if exists patient_signature_events_inmutables on public.patient_signature_events;
create trigger patient_signature_events_inmutables
  before update on public.patient_signature_events
  for each row execute function public.patient_signature_events_inmutables();

drop trigger if exists block_demo_writes on public.patient_signature_requests;
create trigger block_demo_writes
  before insert or update or delete on public.patient_signature_requests
  for each row execute function public.block_demo_writes();

-- ─── 7. Cancelar (staff) ───────────────────────────────────────────────────

create or replace function public.firma_remota_cancelar(p_request_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión.' using errcode = '42501';
  end if;
  if not (select public.sesion_cumple_mfa()) then
    raise exception 'Confirma tu segundo factor para continuar.' using errcode = '42501';
  end if;
  if v_motivo is not null and char_length(v_motivo) > 300 then
    raise exception 'El motivo es demasiado largo.' using errcode = '22023';
  end if;

  select id, clinic_id, kind, status into v_req
    from public.patient_signature_requests
   where id = p_request_id
   for update;
  if v_req.id is null then
    raise exception 'No tienes permisos para cancelar esta solicitud.' using errcode = '42501';
  end if;
  if not public.has_clinic_role(
    v_req.clinic_id,
    case when v_req.kind = 'documento'
      then array['owner','admin','dentist']::public.app_role[]
      else array['owner','admin','dentist','reception']::public.app_role[]
    end
  ) then
    raise exception 'No tienes permisos para cancelar esta solicitud.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinics where id = v_req.clinic_id and is_demo) then
    raise exception 'Esta es la clínica demo, de solo lectura.';
  end if;
  if v_req.status not in ('enviada', 'abierta') then
    raise exception 'Esta solicitud ya no está abierta.' using errcode = '23514';
  end if;

  update public.patient_signature_requests
     set status = 'cancelada', cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = v_motivo, session_hash = null, code_hash = null
   where id = v_req.id;
  insert into public.patient_signature_events (clinic_id, request_id, kind, actor_id)
  values (v_req.clinic_id, v_req.id, 'cancelada', v_uid);
end;
$$;

comment on function public.firma_remota_cancelar(uuid, text) is
  'DOC-05: el staff cancela una solicitud de firma abierta (su link deja de servir).';

revoke all on function public.firma_remota_cancelar(uuid, text) from public, anon;
grant execute on function public.firma_remota_cancelar(uuid, text) to authenticated;

-- ─── 8. Permisos y RLS ─────────────────────────────────────────────────────

-- Sin UPDATE ni DELETE desde la API: cancelar va por la función de arriba y
-- una firma es parte de la ficha.
revoke all on public.patient_signature_requests from anon, authenticated;
grant insert on public.patient_signature_requests to authenticated;
-- SELECT por columna: el staff NO lee las huellas del token, de la sesión ni
-- del código. Con la huella del código (6 dígitos) se podría probar el
-- millón de combinaciones fuera de línea y firmar por el paciente.
grant select (
  id, clinic_id, patient_id, kind, issued_document_id, quote_id, replaces_request_id,
  title, sheet, content_blocks, content_html, professional_signature_path,
  professional_signature_sha256, document_sha256, quote_fingerprint, signer_role, guardian_id,
  signer_expected_name, link_channel, code_channel, code_recipient_masked, status, expires_at,
  created_by, created_at, opened_at, cancelled_at, cancelled_by, cancel_reason, rut_attempts,
  rut_verified_at, code_sent_at, codes_sent, code_attempts, locked_until, signer_rut_masked,
  signer_rut_sha256, signed_at, signer_name, accepted_text, signed_ip, signed_user_agent,
  signature_storage_path, signature_sha256, clinic_timezone, signed_at_local, evidence_sha256,
  signed_copy_path, signed_copy_sha256, signed_copy_at
) on public.patient_signature_requests to authenticated;
grant all on public.patient_signature_requests to service_role;
alter table public.patient_signature_requests enable row level security;

drop policy if exists patient_signature_requests_select on public.patient_signature_requests;
create policy patient_signature_requests_select on public.patient_signature_requests
  for select to authenticated
  using (
    case when kind = 'documento'
      then public.has_clinic_role(clinic_id, array['owner','admin','dentist','assistant']::public.app_role[])
      else public.is_clinic_member(clinic_id)
    end
  );

drop policy if exists patient_signature_requests_insert on public.patient_signature_requests;
create policy patient_signature_requests_insert on public.patient_signature_requests
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and case when kind = 'documento'
      then public.has_clinic_role(clinic_id, array['owner','admin','dentist']::public.app_role[])
      else public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception']::public.app_role[])
    end
  );

drop policy if exists mfa_exige_aal2 on public.patient_signature_requests;
create policy mfa_exige_aal2 on public.patient_signature_requests
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

grant select on public.patient_signature_events to authenticated;
revoke insert, update, delete, truncate on public.patient_signature_events from anon, authenticated;
revoke all on public.patient_signature_events from anon;
grant all on public.patient_signature_events to service_role;
alter table public.patient_signature_events enable row level security;

-- Ve la bitácora quien ve la solicitud (la subconsulta corre con su RLS).
drop policy if exists patient_signature_events_select on public.patient_signature_events;
create policy patient_signature_events_select on public.patient_signature_events
  for select to authenticated
  using (
    exists (select 1 from public.patient_signature_requests r where r.id = request_id)
  );

drop policy if exists mfa_exige_aal2 on public.patient_signature_events;
create policy mfa_exige_aal2 on public.patient_signature_events
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- Cómo revertir (las firmas se pierden con la tabla: hacer un backup antes
-- si ya se firmó alguna; las imágenes y PDFs quedan en clinical-documents
-- bajo <clinic>/<patient>/firmas-a-distancia/):
--
-- begin;
-- drop policy if exists mfa_exige_aal2 on public.patient_signature_events;
-- drop policy if exists mfa_exige_aal2 on public.patient_signature_requests;
-- drop table if exists public.patient_signature_events;
-- drop table if exists public.patient_signature_requests;
-- drop function if exists public.firma_remota_cancelar(uuid, text);
-- drop function if exists public.patient_signature_events_inmutables();
-- drop function if exists public.patient_signature_requests_proteger();
-- drop function if exists public.patient_signature_requests_creada();
-- drop function if exists public.patient_signature_requests_preparar();
-- drop function if exists public.huella_de_presupuesto(uuid);
-- drop function if exists public.mascara_correo(text);
-- drop function if exists public.documento_requiere_firma(uuid);
-- alter table public.document_templates drop column if exists requires_patient_signature;
-- commit;
