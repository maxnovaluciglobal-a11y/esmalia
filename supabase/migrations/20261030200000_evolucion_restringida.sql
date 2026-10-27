-- Ola 9 · frente B · FIC-11: evolución (nota clínica) restringida.
--
-- Una nota marcada como restringida solo la ven su autor y el owner/admin de
-- la clínica. Otro dentista, el asistente y (como siempre) recepción y
-- contabilidad no la ven: ni la nota, ni sus versiones, ni su bitácora, ni
-- sus entidades, ni sus revisiones. Las adendas de una nota restringida
-- quedan restringidas igual que ella.
--
-- Cómo, sin redefinir nada de lo existente:
--   1. Columnas nuevas en `clinical_notes`: `restricted` (default false, así
--      que toda nota existente sigue igual), `restricted_at` y
--      `restricted_by`, que estampa la base.
--   2. `puede_ver_nota_clinica(note_id)`: SECURITY DEFINER (lee la nota sin
--      RLS, así las políticas de las tablas hijas no se llaman en círculo).
--   3. Políticas RESTRICTIVE nuevas (`nota_restringida`) en las cinco tablas
--      de notas. Se suman a las permisivas existentes (regla 2: solo
--      owner/admin/dentist/assistant), que NO se tocan: una RESTRICTIVE solo
--      puede quitar filas, nunca agregar.
--   4. Trigger `proteger_restriccion_de_nota`: solo el autor o owner/admin
--      cambian la restricción; la base estampa quién y cuándo; una adenda
--      hereda la restricción de su nota.
--   5. Regla 16: la bitácora la escribe la base. Restringir y quitar la
--      restricción quedan en `clinical_note_audit` por trigger; cada vez que
--      alguien autorizado abre una nota restringida queda `restricted_view`
--      por la RPC `registrar_acceso_a_notas_restringidas` (las lecturas no
--      disparan triggers: mismo patrón que `registrar_lectura_ficha`).
--   6. `contar_notas_restringidas_ocultas`: solo un número, para que la ficha
--      avise "hay 1 evolución restringida" sin mostrar nada de ella.
--
-- Segura con datos existentes: ADD COLUMN con default constante, políticas,
-- funciones y triggers nuevos. El CHECK de acciones de la bitácora se amplía
-- (mismas acciones + tres nuevas); ninguna fila existente queda afuera.

-- ── 1. Columnas ───────────────────────────────────────────────────────────
alter table public.clinical_notes
  add column if not exists restricted boolean not null default false,
  add column if not exists restricted_at timestamptz,
  add column if not exists restricted_by uuid;

comment on column public.clinical_notes.restricted is
  'FIC-11: solo la ven su autor y owner/admin. La aplican políticas RESTRICTIVE.';

-- ── 2. Quién puede ver una nota ───────────────────────────────────────────
-- true si la nota (y su nota original, si es una adenda) no está restringida
-- o si quien pregunta es su autor u owner/admin. Una nota que no existe
-- devuelve true: las demás políticas deciden (no es esta la que da acceso).
create or replace function public.puede_ver_nota_clinica(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from public.clinical_notes n
      left join public.clinical_notes p on p.id = n.addendum_of
     where n.id = p_note_id
       and (
         (n.restricted
           and n.created_by is distinct from auth.uid()
           and not public.has_clinic_role(n.clinic_id, array['owner','admin']::public.app_role[]))
         or
         (coalesce(p.restricted, false)
           and p.created_by is distinct from auth.uid()
           and not public.has_clinic_role(p.clinic_id, array['owner','admin']::public.app_role[]))
       )
  );
$$;

comment on function public.puede_ver_nota_clinica(uuid) is
  'FIC-11: false si la nota (o la nota que corrige su adenda) está restringida y quien pregunta no es su autor ni owner/admin.';

revoke all on function public.puede_ver_nota_clinica(uuid) from public, anon;
grant execute on function public.puede_ver_nota_clinica(uuid) to authenticated, service_role;

-- ── 3. Políticas RESTRICTIVE ──────────────────────────────────────────────
drop policy if exists nota_restringida on public.clinical_notes;
create policy nota_restringida on public.clinical_notes
  as restrictive
  for all
  to authenticated
  using (public.puede_ver_nota_clinica(id))
  with check (
    not restricted
    or created_by = (select auth.uid())
    or public.has_clinic_role(clinic_id, array['owner','admin']::public.app_role[])
  );

drop policy if exists nota_restringida on public.clinical_note_versions;
create policy nota_restringida on public.clinical_note_versions
  as restrictive
  for all
  to authenticated
  using (public.puede_ver_nota_clinica(note_id))
  with check (public.puede_ver_nota_clinica(note_id));

drop policy if exists nota_restringida on public.clinical_note_entities;
create policy nota_restringida on public.clinical_note_entities
  as restrictive
  for all
  to authenticated
  using (public.puede_ver_nota_clinica(note_id))
  with check (public.puede_ver_nota_clinica(note_id));

drop policy if exists nota_restringida on public.clinical_note_reviews;
create policy nota_restringida on public.clinical_note_reviews
  as restrictive
  for all
  to authenticated
  using (public.puede_ver_nota_clinica(note_id))
  with check (public.puede_ver_nota_clinica(note_id));

drop policy if exists nota_restringida on public.clinical_note_audit;
create policy nota_restringida on public.clinical_note_audit
  as restrictive
  for all
  to authenticated
  using (note_id is null or public.puede_ver_nota_clinica(note_id))
  with check (note_id is null or public.puede_ver_nota_clinica(note_id));

-- ── 4. Quién cambia la restricción (y la herencia de las adendas) ─────────
create or replace function public.proteger_restriccion_de_nota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_padre_restringida boolean;
begin
  if tg_op = 'INSERT' then
    -- Una adenda de una nota restringida es tan sensible como ella.
    if new.addendum_of is not null then
      select restricted into v_padre_restringida
        from public.clinical_notes where id = new.addendum_of;
      if coalesce(v_padre_restringida, false) then
        new.restricted := true;
      end if;
    end if;
    if new.restricted then
      new.restricted_at := now();
      new.restricted_by := coalesce(v_uid, new.created_by);
    else
      new.restricted_at := null;
      new.restricted_by := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.restricted is not distinct from old.restricted then
    -- Quién y cuándo los estampa la base: no se editan a mano.
    new.restricted_at := old.restricted_at;
    new.restricted_by := old.restricted_by;
    return new;
  end if;

  if v_uid is not null
     and old.created_by is distinct from v_uid
     and not public.has_clinic_role(old.clinic_id, array['owner','admin']::public.app_role[]) then
    raise exception 'Solo quien escribió la nota o la administración de la clínica puede cambiar quién la ve.'
      using errcode = '42501';
  end if;

  if new.restricted then
    new.restricted_at := now();
    new.restricted_by := coalesce(v_uid, new.updated_by);
  else
    new.restricted_at := null;
    new.restricted_by := null;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_restriccion_de_nota() from public, anon, authenticated;

drop trigger if exists clinical_notes_proteger_restriccion on public.clinical_notes;
create trigger clinical_notes_proteger_restriccion
  before insert or update on public.clinical_notes
  for each row execute function public.proteger_restriccion_de_nota();

-- ── 5. Bitácora (regla 16) ────────────────────────────────────────────────
alter table public.clinical_note_audit
  drop constraint if exists clinical_note_audit_action_check;
alter table public.clinical_note_audit
  add constraint clinical_note_audit_action_check check (action = any (array[
    'create', 'edit', 'revert', 'sign', 'reopen', 'addendum', 'entity_confirm', 'entity_delete',
    'review_requested', 'review_approved', 'review_changes_requested', 'review_comment',
    'review_cancelled', 'conflict', 'ai_draft', 'ai_summary', 'ai_polish', 'ai_structure',
    -- FIC-11
    'restrict', 'unrestrict', 'restricted_view'
  ]::text[]));

create or replace function public.auditar_restriccion_de_nota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.restricted is not distinct from old.restricted then
    return null;
  end if;
  perform public.anotar_auditoria_de_nota(
    new.id, new.clinic_id, coalesce(new.patient_ref, ''),
    case when new.restricted then 'restrict' else 'unrestrict' end,
    null,
    coalesce(auth.uid(), new.updated_by));
  return null;
end;
$$;

revoke all on function public.auditar_restriccion_de_nota() from public, anon, authenticated;

drop trigger if exists clinical_notes_auditar_restriccion on public.clinical_notes;
create trigger clinical_notes_auditar_restriccion
  after update of restricted on public.clinical_notes
  for each row execute function public.auditar_restriccion_de_nota();

-- Registro de accesos: la app la llama cada vez que entrega una nota
-- restringida a quien puede verla. Solo anota las notas que de verdad son
-- restringidas, de esta clínica y visibles para quien llama; una misma
-- persona sobre la misma nota se anota una vez cada 15 minutos (como
-- `registrar_lectura_ficha`). Devuelve cuántas anotó.
create or replace function public.registrar_acceso_a_notas_restringidas(
  p_clinic_id uuid,
  p_note_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  n record;
  v_total integer := 0;
begin
  if not public.sesion_cumple_mfa() then
    raise exception 'Se requiere verificación en dos pasos.' using errcode = '42501';
  end if;
  if v_uid is null
     or not public.has_clinic_role(p_clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]) then
    raise exception 'No tienes permisos para ver notas clínicas.' using errcode = '42501';
  end if;
  if p_note_ids is null or cardinality(p_note_ids) = 0 then
    return 0;
  end if;

  for n in
    select c.id, c.clinic_id, c.patient_ref
      from public.clinical_notes c
      left join public.clinical_notes p on p.id = c.addendum_of
     where c.id = any (p_note_ids[1:200])
       and c.clinic_id = p_clinic_id
       and (c.restricted or coalesce(p.restricted, false))
       and public.puede_ver_nota_clinica(c.id)
  loop
    if not exists (
      select 1 from public.clinical_note_audit a
       where a.note_id = n.id
         and a.actor_id = v_uid
         and a.action = 'restricted_view'
         and a.created_at > now() - interval '15 minutes'
    ) then
      perform public.anotar_auditoria_de_nota(
        n.id, n.clinic_id, coalesce(n.patient_ref, ''), 'restricted_view', null, v_uid);
      v_total := v_total + 1;
    end if;
  end loop;
  return v_total;
end;
$$;

comment on function public.registrar_acceso_a_notas_restringidas(uuid, uuid[]) is
  'FIC-11: anota en la bitácora cada acceso de una persona autorizada a una nota restringida (una vez cada 15 min).';

revoke all on function public.registrar_acceso_a_notas_restringidas(uuid, uuid[]) from public, anon;
grant execute on function public.registrar_acceso_a_notas_restringidas(uuid, uuid[]) to authenticated;

-- ── 6. Cuántas no ve quien pregunta ───────────────────────────────────────
create or replace function public.contar_notas_restringidas_ocultas(
  p_clinic_id uuid,
  p_patient_refs text[]
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  if not public.sesion_cumple_mfa() then
    raise exception 'Se requiere verificación en dos pasos.' using errcode = '42501';
  end if;
  -- Recepción y contabilidad no ven notas: para ellas no hay nada que contar.
  if auth.uid() is null
     or not public.has_clinic_role(p_clinic_id, array['owner','admin','dentist','assistant']::public.app_role[]) then
    return 0;
  end if;
  select count(*)::integer into v_total
    from public.clinical_notes c
   where c.clinic_id = p_clinic_id
     and c.patient_ref = any (coalesce(p_patient_refs, '{}'::text[]))
     and not public.puede_ver_nota_clinica(c.id);
  return v_total;
end;
$$;

comment on function public.contar_notas_restringidas_ocultas(uuid, text[]) is
  'FIC-11: cuántas notas del paciente están restringidas para quien pregunta (solo el número).';

revoke all on function public.contar_notas_restringidas_ocultas(uuid, text[]) from public, anon;
grant execute on function public.contar_notas_restringidas_ocultas(uuid, text[]) to authenticated;

-- ── Reversa (hacer antes un backup; no borra notas) ───────────────────────
-- drop function if exists public.contar_notas_restringidas_ocultas(uuid, text[]);
-- drop function if exists public.registrar_acceso_a_notas_restringidas(uuid, uuid[]);
-- drop trigger if exists clinical_notes_auditar_restriccion on public.clinical_notes;
-- drop function if exists public.auditar_restriccion_de_nota();
-- drop trigger if exists clinical_notes_proteger_restriccion on public.clinical_notes;
-- drop function if exists public.proteger_restriccion_de_nota();
-- drop policy if exists nota_restringida on public.clinical_note_audit;
-- drop policy if exists nota_restringida on public.clinical_note_reviews;
-- drop policy if exists nota_restringida on public.clinical_note_entities;
-- drop policy if exists nota_restringida on public.clinical_note_versions;
-- drop policy if exists nota_restringida on public.clinical_notes;
-- drop function if exists public.puede_ver_nota_clinica(uuid);
-- (Las columnas restricted/restricted_at/restricted_by y las acciones nuevas
-- del CHECK pueden quedar: sin las políticas no restringen nada. Si se
-- quitan, antes borrar las filas 'restrict', 'unrestrict' y 'restricted_view'
-- de clinical_note_audit o el CHECK viejo no se puede volver a crear.)
