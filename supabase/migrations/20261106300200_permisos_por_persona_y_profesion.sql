-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 10 · frente C · EQU-01 permisos por persona y EQU-03 profesión.
-- Requiere 20261106300000 (valores del enum) ya confirmada.
--
-- EQU-01: además del rol, a un integrante se le puede DAR o QUITAR un permiso
-- puntual de la matriz de `src/lib/access/access.ts`.
--   · DAR solo abre en la pantalla lo que las políticas ya le permiten a su
--     rol: la base no consulta los "dar" para autorizar nada. Nunca amplía.
--   · QUITAR sí se cumple en la base: políticas RESTRICTIVAS nuevas en las
--     tablas que protege cada permiso (historia clínica, agenda, pacientes).
--     Una restrictiva solo puede achicar el acceso, nunca agrandarlo, y no se
--     redefine ninguna política existente.
--   · Reglas duras (CLAUDE.md, regla 2), validadas por el trigger
--     `validar_ajuste_de_permiso` antes del catálogo: la historia clínica nunca
--     se da a quien no es owner/admin/dentist/assistant, y los pagos nunca a
--     assistant.
--   · El catálogo `ajuste_de_permiso_admitido` es espejo de `ajusteAdmitido`
--     (access.ts); `tests/permisos-por-persona-db.test.ts` los compara
--     combinación por combinación.
--
-- EQU-03: `clinic_members.profession` (nullable, lista cerrada) y una RPC
-- para cargarla (la política de update de clinic_members no deja editarse a
-- uno mismo, y la profesión sí la puede cargar cada uno).
--
-- Aditiva: una tabla nueva, una columna nullable nueva, funciones nuevas y
-- políticas nuevas. No escribe datos. Reversa al pie.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. EQU-03 · Profesión ─────────────────────────────────────────────────

alter table public.clinic_members
  add column if not exists profession text;

alter table public.clinic_members
  drop constraint if exists clinic_members_profession_check;
alter table public.clinic_members
  add constraint clinic_members_profession_check check (
    profession is null or profession in (
      'odontologo_general',
      'odontologo_especialista',
      'asistente_dental',
      'tecnico_dental',
      'recepcion',
      'coordinacion',
      'administracion',
      'contabilidad',
      'otra'
    )
  );

comment on column public.clinic_members.profession is
  'EQU-03: profesión del integrante (lista en PROFESIONES de access.ts). Descriptiva: no da permisos.';

create or replace function public.definir_profesion_de_integrante(
  p_member_id uuid,
  p_profession text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_member public.clinic_members%rowtype;
  v_demo boolean;
begin
  if v_uid is null then
    raise exception 'No tienes permisos para cambiar la profesión.' using errcode = '42501';
  end if;

  select * into v_member from public.clinic_members where id = p_member_id;
  if not found then
    raise exception 'No encontramos a ese integrante.' using errcode = 'P0002';
  end if;

  -- Cada uno carga la suya; la de los demás, solo propietario o administración.
  if v_member.user_id <> v_uid and not public.can_manage_clinic(v_member.clinic_id) then
    raise exception 'No tienes permisos para cambiar la profesión.' using errcode = '42501';
  end if;

  select is_demo into v_demo from public.clinics where id = v_member.clinic_id;
  if coalesce(v_demo, false) then
    raise exception 'Esta es la clínica demo: es de solo lectura.' using errcode = '42501';
  end if;

  update public.clinic_members
     set profession = nullif(btrim(coalesce(p_profession, '')), '')
   where id = p_member_id;
end;
$function$;

revoke all on function public.definir_profesion_de_integrante(uuid, text) from public, anon;
grant execute on function public.definir_profesion_de_integrante(uuid, text) to authenticated;

-- ─── 2. EQU-01 · Catálogo de ajustes admitidos ─────────────────────────────
-- Espejo de AJUSTES_POR_PERMISO / ajusteAdmitido (access.ts). Pura.

create or replace function public.ajuste_de_permiso_admitido(
  _role public.app_role,
  _permission text,
  _effect text
) returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when _role is null or _role = 'owner'::public.app_role then false
    -- Regla 2: la historia clínica nunca a quien no es owner/admin/dentist/assistant…
    when _effect = 'grant'
         and _permission in ('clinical:view', 'clinical:write')
         and _role not in ('owner', 'admin', 'dentist', 'assistant') then false
    -- …y los pagos nunca a assistant.
    when _effect = 'grant'
         and _permission in ('finance:view', 'cash:manage', 'payments:reverse')
         and _role = 'assistant'::public.app_role then false
    when _effect = 'grant' then
      case _permission
        when 'clinical:view' then _role in ('assistant')
        when 'clinical:write' then _role in ('assistant')
        when 'agenda:view' then _role in ('accounting')
        when 'team:view' then _role in ('assistant', 'lab_technician')
        else false
      end
    when _effect = 'revoke' then
      case _permission
        when 'clinical:view' then _role in ('admin', 'dentist')
        when 'clinical:write' then _role in ('admin', 'dentist')
        when 'agenda:manage' then _role in ('admin', 'coordinator', 'dentist', 'reception')
        when 'patients:manage' then _role in ('admin', 'coordinator', 'dentist', 'reception')
        else false
      end
    else false
  end;
$function$;

revoke all on function public.ajuste_de_permiso_admitido(public.app_role, text, text) from public, anon;
grant execute on function public.ajuste_de_permiso_admitido(public.app_role, text, text)
  to authenticated, service_role;

-- ─── 3. EQU-01 · Tabla de ajustes ──────────────────────────────────────────

create table if not exists public.clinic_member_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  member_id uuid not null references public.clinic_members (id) on delete cascade,
  permission text not null,
  effect text not null,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_member_permission_overrides_unico unique (member_id, permission),
  constraint clinic_member_permission_overrides_effect_check check (effect in ('grant', 'revoke')),
  constraint clinic_member_permission_overrides_permission_check check (
    permission ~ '^[a-z]+:[a-z-]+$' and char_length(permission) <= 40
  ),
  constraint clinic_member_permission_overrides_reason_check check (
    reason is null or char_length(reason) <= 300
  )
);

create index if not exists clinic_member_permission_overrides_clinic_idx
  on public.clinic_member_permission_overrides (clinic_id);

comment on table public.clinic_member_permission_overrides is
  'EQU-01: permisos dados (grant) o quitados (revoke) a un integrante además de su rol. Los revoke de historia clínica, agenda y pacientes los cumple la base con políticas restrictivas (permiso_quitado).';

revoke all on public.clinic_member_permission_overrides from anon, authenticated;
grant select, insert, update, delete on public.clinic_member_permission_overrides to authenticated;
grant all on public.clinic_member_permission_overrides to service_role;
alter table public.clinic_member_permission_overrides enable row level security;

-- Ve los ajustes quien gestiona la clínica, y cada uno los suyos.
drop policy if exists permission_overrides_select on public.clinic_member_permission_overrides;
create policy permission_overrides_select on public.clinic_member_permission_overrides
  for select to authenticated
  using (
    public.can_manage_clinic(clinic_id)
    or exists (
      select 1 from public.clinic_members m
       where m.id = member_id
         and m.clinic_id = clinic_member_permission_overrides.clinic_id
         and m.user_id = (select auth.uid())
    )
  );

drop policy if exists permission_overrides_insert on public.clinic_member_permission_overrides;
create policy permission_overrides_insert on public.clinic_member_permission_overrides
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists permission_overrides_update on public.clinic_member_permission_overrides;
create policy permission_overrides_update on public.clinic_member_permission_overrides
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists permission_overrides_delete on public.clinic_member_permission_overrides;
create policy permission_overrides_delete on public.clinic_member_permission_overrides
  for delete to authenticated
  using (public.can_manage_clinic(clinic_id));

-- MFA (SEG-01): quien activó MFA necesita aal2 para ver o cambiar permisos.
drop policy if exists mfa_exige_aal2 on public.clinic_member_permission_overrides;
create policy mfa_exige_aal2 on public.clinic_member_permission_overrides
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- Validación de negocio: lo que ninguna política expresa sola.
create or replace function public.validar_ajuste_de_permiso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member public.clinic_members%rowtype;
begin
  if tg_op = 'UPDATE' and (new.member_id <> old.member_id or new.clinic_id <> old.clinic_id) then
    raise exception 'Un ajuste no se puede mover a otro integrante.' using errcode = '42501';
  end if;

  select * into v_member from public.clinic_members where id = new.member_id;
  if not found then
    raise exception 'No encontramos a ese integrante.' using errcode = 'P0002';
  end if;
  -- Aislamiento: el ajuste y el integrante son de la misma clínica.
  if v_member.clinic_id <> new.clinic_id then
    raise exception 'Ese integrante no es de esta clínica.' using errcode = '42501';
  end if;
  if auth.uid() is not null and v_member.user_id = auth.uid() then
    raise exception 'No puedes ajustar tus propios permisos.' using errcode = '42501';
  end if;
  if v_member.role = 'owner'::public.app_role then
    raise exception 'El propietario tiene acceso completo: no se ajusta por persona.'
      using errcode = '42501';
  end if;

  -- Regla 2 (explícita, aunque el catálogo ya la cubre).
  if new.effect = 'grant'
     and new.permission in ('clinical:view', 'clinical:write')
     and v_member.role not in ('owner', 'admin', 'dentist', 'assistant') then
    raise exception 'La historia clínica solo la ven propietario, administración, profesionales y asistentes.'
      using errcode = '42501';
  end if;
  if new.effect = 'grant'
     and new.permission in ('finance:view', 'cash:manage', 'payments:reverse')
     and v_member.role = 'assistant'::public.app_role then
    raise exception 'Asistente dental no maneja pagos ni finanzas.' using errcode = '42501';
  end if;

  if not public.ajuste_de_permiso_admitido(v_member.role, new.permission, new.effect) then
    raise exception 'Ese ajuste no está permitido para el rol de esta persona.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.validar_ajuste_de_permiso() from public, anon;

drop trigger if exists validar_ajuste_de_permiso on public.clinic_member_permission_overrides;
create trigger validar_ajuste_de_permiso
  before insert or update on public.clinic_member_permission_overrides
  for each row execute function public.validar_ajuste_de_permiso();

drop trigger if exists block_demo_writes on public.clinic_member_permission_overrides;
create trigger block_demo_writes
  before insert or update or delete on public.clinic_member_permission_overrides
  for each row execute function public.block_demo_writes();

-- ─── 4. EQU-01 · ¿Le quitaron este permiso al usuario actual? ──────────────
-- Solo cuentan los "quitar" vigentes para su rol actual (si cambió de rol y
-- el ajuste ya no corresponde, deja de aplicar, igual que en access.ts).

create or replace function public.permiso_quitado(_clinic_id uuid, _permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.clinic_member_permission_overrides o
      join public.clinic_members m on m.id = o.member_id
     where m.clinic_id = _clinic_id
       and o.clinic_id = _clinic_id
       and m.user_id = auth.uid()
       and o.permission = _permission
       and o.effect = 'revoke'
       and public.ajuste_de_permiso_admitido(m.role, o.permission, o.effect)
  );
$function$;

revoke all on function public.permiso_quitado(uuid, text) from public, anon;
grant execute on function public.permiso_quitado(uuid, text) to authenticated, service_role;

-- ─── 5. EQU-01 · Políticas restrictivas: lo quitado se cumple en la base ───
-- Nombres `ajuste_quita_*`. RESTRICTIVE: se combinan con AND con las
-- permisivas existentes, así que solo pueden negar.

-- 5.a "Ver historia clínica" (clinical:view): lectura de notas y anamnesis.
drop policy if exists ajuste_quita_ver_historia on public.clinical_notes;
create policy ajuste_quita_ver_historia on public.clinical_notes
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_ver_historia on public.clinical_note_versions;
create policy ajuste_quita_ver_historia on public.clinical_note_versions
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_ver_historia on public.clinical_note_entities;
create policy ajuste_quita_ver_historia on public.clinical_note_entities
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_ver_historia on public.clinical_note_reviews;
create policy ajuste_quita_ver_historia on public.clinical_note_reviews
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_ver_historia on public.clinical_note_audit;
create policy ajuste_quita_ver_historia on public.clinical_note_audit
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_ver_historia on public.patient_medical_history;
create policy ajuste_quita_ver_historia on public.patient_medical_history
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

drop policy if exists ajuste_quita_ver_historia on public.patient_medical_history_audit;
create policy ajuste_quita_ver_historia on public.patient_medical_history_audit
  as restrictive for select to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:view'));

-- 5.b "Escribir historia clínica" (clinical:write).
drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_notes;
create policy ajuste_quita_escribir_historia_insert on public.clinical_notes
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_update on public.clinical_notes;
create policy ajuste_quita_escribir_historia_update on public.clinical_notes
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:write'))
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_note_versions;
create policy ajuste_quita_escribir_historia_insert on public.clinical_note_versions
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_note_entities;
create policy ajuste_quita_escribir_historia_insert on public.clinical_note_entities
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_update on public.clinical_note_entities;
create policy ajuste_quita_escribir_historia_update on public.clinical_note_entities
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:write'))
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_delete on public.clinical_note_entities;
create policy ajuste_quita_escribir_historia_delete on public.clinical_note_entities
  as restrictive for delete to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_note_reviews;
create policy ajuste_quita_escribir_historia_insert on public.clinical_note_reviews
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_insert on public.patient_medical_history;
create policy ajuste_quita_escribir_historia_insert on public.patient_medical_history
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

drop policy if exists ajuste_quita_escribir_historia_update on public.patient_medical_history;
create policy ajuste_quita_escribir_historia_update on public.patient_medical_history
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'clinical:write'))
  with check (not public.permiso_quitado(clinic_id, 'clinical:write'));

-- 5.c "Agendar y mover citas" (agenda:manage).
drop policy if exists ajuste_quita_agendar_insert on public.appointments;
create policy ajuste_quita_agendar_insert on public.appointments
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_update on public.appointments;
create policy ajuste_quita_agendar_update on public.appointments
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'))
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_delete on public.appointments;
create policy ajuste_quita_agendar_delete on public.appointments
  as restrictive for delete to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_insert on public.waitlist_entries;
create policy ajuste_quita_agendar_insert on public.waitlist_entries
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_update on public.waitlist_entries;
create policy ajuste_quita_agendar_update on public.waitlist_entries
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'))
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_delete on public.waitlist_entries;
create policy ajuste_quita_agendar_delete on public.waitlist_entries
  as restrictive for delete to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'));

drop policy if exists ajuste_quita_agendar_update on public.appointment_requests;
create policy ajuste_quita_agendar_update on public.appointment_requests
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'agenda:manage'))
  with check (not public.permiso_quitado(clinic_id, 'agenda:manage'));

-- 5.d "Crear y editar pacientes" (patients:manage).
drop policy if exists ajuste_quita_editar_pacientes_insert on public.patients;
create policy ajuste_quita_editar_pacientes_insert on public.patients
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'patients:manage'));

drop policy if exists ajuste_quita_editar_pacientes_update on public.patients;
create policy ajuste_quita_editar_pacientes_update on public.patients
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'patients:manage'))
  with check (not public.permiso_quitado(clinic_id, 'patients:manage'));

drop policy if exists ajuste_quita_editar_pacientes_insert on public.patient_guardians;
create policy ajuste_quita_editar_pacientes_insert on public.patient_guardians
  as restrictive for insert to authenticated
  with check (not public.permiso_quitado(clinic_id, 'patients:manage'));

drop policy if exists ajuste_quita_editar_pacientes_update on public.patient_guardians;
create policy ajuste_quita_editar_pacientes_update on public.patient_guardians
  as restrictive for update to authenticated
  using (not public.permiso_quitado(clinic_id, 'patients:manage'))
  with check (not public.permiso_quitado(clinic_id, 'patients:manage'));

-- ═══ Reversa (no se ejecuta) ════════════════════════════════════════════════
-- Borra los ajustes por persona (la tabla entera) y la profesión cargada:
-- avisar a las clínicas antes. Las políticas existentes no se tocaron.
-- drop policy if exists ajuste_quita_editar_pacientes_update on public.patient_guardians;
-- drop policy if exists ajuste_quita_editar_pacientes_insert on public.patient_guardians;
-- drop policy if exists ajuste_quita_editar_pacientes_update on public.patients;
-- drop policy if exists ajuste_quita_editar_pacientes_insert on public.patients;
-- drop policy if exists ajuste_quita_agendar_update on public.appointment_requests;
-- drop policy if exists ajuste_quita_agendar_delete on public.waitlist_entries;
-- drop policy if exists ajuste_quita_agendar_update on public.waitlist_entries;
-- drop policy if exists ajuste_quita_agendar_insert on public.waitlist_entries;
-- drop policy if exists ajuste_quita_agendar_delete on public.appointments;
-- drop policy if exists ajuste_quita_agendar_update on public.appointments;
-- drop policy if exists ajuste_quita_agendar_insert on public.appointments;
-- drop policy if exists ajuste_quita_escribir_historia_update on public.patient_medical_history;
-- drop policy if exists ajuste_quita_escribir_historia_insert on public.patient_medical_history;
-- drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_note_reviews;
-- drop policy if exists ajuste_quita_escribir_historia_delete on public.clinical_note_entities;
-- drop policy if exists ajuste_quita_escribir_historia_update on public.clinical_note_entities;
-- drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_note_entities;
-- drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_note_versions;
-- drop policy if exists ajuste_quita_escribir_historia_update on public.clinical_notes;
-- drop policy if exists ajuste_quita_escribir_historia_insert on public.clinical_notes;
-- drop policy if exists ajuste_quita_ver_historia on public.patient_medical_history_audit;
-- drop policy if exists ajuste_quita_ver_historia on public.patient_medical_history;
-- drop policy if exists ajuste_quita_ver_historia on public.clinical_note_audit;
-- drop policy if exists ajuste_quita_ver_historia on public.clinical_note_reviews;
-- drop policy if exists ajuste_quita_ver_historia on public.clinical_note_entities;
-- drop policy if exists ajuste_quita_ver_historia on public.clinical_note_versions;
-- drop policy if exists ajuste_quita_ver_historia on public.clinical_notes;
-- drop policy if exists mfa_exige_aal2 on public.clinic_member_permission_overrides;
-- drop function if exists public.permiso_quitado(uuid, text);
-- drop table if exists public.clinic_member_permission_overrides;
-- drop function if exists public.validar_ajuste_de_permiso();
-- drop function if exists public.ajuste_de_permiso_admitido(public.app_role, text, text);
-- drop function if exists public.definir_profesion_de_integrante(uuid, text);
-- alter table public.clinic_members drop constraint if exists clinic_members_profession_check;
-- alter table public.clinic_members drop column if exists profession;
