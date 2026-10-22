-- Ola 4 · Frente Presupuesto PDF y correo (3/3): documento de ejemplo en la demo.
--
-- /api/demo-reset deja UN documento emitido de ejemplo (certificado de
-- atención) en la ficha de un paciente de la demo, firmado por la
-- profesional de la demo vinculada al usuario dueño. El reset corre con el
-- rol de servicio, sin sesión, y `issued_documents_emitir` exigía
-- `auth.uid()`: se le agrega UNA excepción, solo para el rol de servicio,
-- solo en la clínica demo y solo a nombre del usuario vinculado al
-- profesional (`issued_by` explícito, que tiene que ser el `user_id` de la
-- ficha del profesional). Todo lo demás (snapshots, correlativo, huella)
-- sigue igual; el correlativo, como `next_clinic_counter` exige una sesión
-- miembro de la clínica, se toma con el mismo upsert atómico de esa función.
--
-- Redefinida a partir de su definición actual (20261025100000), cambiando
-- solo quién emite. Compatible con el código en producción: para una sesión
-- normal la función hace exactamente lo mismo.
--
-- Reversa al pie: volver a crear la función con el texto de 20261025100000.

begin;

create or replace function public.issued_documents_emitir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof record;
  v_version record;
  v_clinic record;
  v_branch record;
  v_patient record;
  v_emisor uuid := auth.uid();
  v_servicio boolean := false;
begin
  if v_emisor is null then
    -- Única excepción: el rol de servicio sembrando el documento de ejemplo
    -- de la clínica demo (/api/demo-reset), a nombre del profesional de la
    -- demo vinculado al usuario dueño. Cualquier otro caso sin sesión se
    -- rechaza como antes.
    if coalesce(auth.role(), '') <> 'service_role'
       or new.issued_by is null
       or not exists (select 1 from public.clinics c where c.id = new.clinic_id and c.is_demo)
    then
      raise exception 'Un documento lo emite un profesional con su propia cuenta.';
    end if;
    v_emisor := new.issued_by;
    v_servicio := true;
  end if;
  new.issued_by := v_emisor;
  new.issued_at := now();
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;

  select p.full_name, p.license_number, p.sis_registry_number, p.user_id, p.branch_id,
         p.signature_storage_path, p.signature_sha256, s.name as specialty
    into v_prof
    from public.professionals p
    left join public.specialties s on s.id = p.specialty_id
   where p.id = new.professional_id and p.clinic_id = new.clinic_id;
  if not found then
    raise exception 'Elige un profesional de esta clínica.';
  end if;
  if v_prof.user_id is distinct from v_emisor then
    raise exception 'Solo puedes emitir documentos con tu propia ficha de profesional.';
  end if;
  if nullif(btrim(coalesce(v_prof.sis_registry_number, v_prof.license_number)), '') is null then
    raise exception 'Carga tu número de registro de la Superintendencia de Salud antes de emitir documentos.';
  end if;

  select v.id, v.template_id, v.title, t.kind, t.active
    into v_version
    from public.document_template_versions v
    join public.document_templates t on t.id = v.template_id
   where v.id = new.template_version_id and v.clinic_id = new.clinic_id;
  if not found then
    raise exception 'La plantilla no existe en esta clínica.';
  end if;

  select name, legal_name, tax_id, timezone into v_clinic
    from public.clinics where id = new.clinic_id;

  -- Dirección y teléfono: la sucursal del profesional, o la primera activa.
  select address, city, phone into v_branch
    from public.branches
   where clinic_id = new.clinic_id
   order by (id = v_prof.branch_id) desc, is_active desc, created_at
   limit 1;

  select full_name into v_patient
    from public.patients where id = new.patient_id and clinic_id = new.clinic_id;
  if not found then
    raise exception 'El paciente no pertenece a esta clínica.';
  end if;

  new.template_id := v_version.template_id;
  new.kind := v_version.kind;
  new.title := v_version.title;
  new.professional_name_snapshot := btrim(v_prof.full_name);
  new.professional_registry_snapshot := nullif(btrim(coalesce(v_prof.sis_registry_number, v_prof.license_number)), '');
  new.professional_specialty_snapshot := v_prof.specialty;
  new.signature_storage_path := v_prof.signature_storage_path;
  new.signature_sha256 := v_prof.signature_sha256;
  new.clinic_name_snapshot := v_clinic.name;
  new.clinic_legal_name_snapshot := v_clinic.legal_name;
  new.clinic_tax_id_snapshot := v_clinic.tax_id;
  new.clinic_address_snapshot := nullif(concat_ws(', ', nullif(btrim(v_branch.address), ''), nullif(btrim(v_branch.city), '')), '');
  new.clinic_phone_snapshot := nullif(btrim(v_branch.phone), '');
  new.patient_name_snapshot := v_patient.full_name;

  -- Año en la hora de la clínica, no en UTC.
  new.year := extract(year from now() at time zone coalesce(v_clinic.timezone, 'America/Santiago'))::integer;
  if v_servicio then
    -- next_clinic_counter exige una sesión miembro de la clínica: el rol de
    -- servicio no la tiene. Mismo upsert atómico que esa función (regla 8).
    insert into public.clinic_counters (clinic_id, kind, year, next_value)
    values (new.clinic_id, 'document', new.year, 2)
    on conflict (clinic_id, kind, year)
    do update set next_value = clinic_counters.next_value + 1, updated_at = now()
    returning next_value - 1 into new.number;
  else
    new.number := public.next_clinic_counter(new.clinic_id, 'document', new.year);
  end if;

  -- Par exacto de src/lib/documentos/huella.ts.
  new.content_sha256 := encode(sha256(convert_to(
    new.content_html || chr(31) || coalesce(new.signature_sha256, ''),
    'UTF8'
  )), 'hex');
  return new;
end;
$$;

revoke execute on function public.issued_documents_emitir() from public, anon, authenticated;

commit;

-- Cómo revertir: correr de nuevo el bloque `create or replace function
-- public.issued_documents_emitir()` de 20261025100000_motor_de_documentos.sql
-- (y su `revoke execute`). Los documentos de ejemplo de la demo se borran
-- solos en el próximo reset.
