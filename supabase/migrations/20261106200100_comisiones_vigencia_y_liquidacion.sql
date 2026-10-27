-- Ola 10 · frente B · Comisiones (COM-02 a COM-05).
--
--   commission_rule_versions   COM-02/03: regla de comisión de cada profesional
--                              con "rige desde". Una regla general por fecha
--                              (porcentaje o monto fijo, sobre lo realizado o lo
--                              cobrado) y, opcionalmente, reglas por prestación
--                              que reemplazan a la general para esa prestación.
--                              Cambiar la regla = agregar una versión nueva; la
--                              de antes sigue aplicando a las fechas anteriores.
--   commission_settlements     COM-04: la liquidación cerrada guarda además la
--                              base, lo cobrado, la fecha desde la que regía la
--                              regla y el detalle línea por línea (jsonb). Queda
--                              inmutable: solo se marca pagada.
--   commission_rules.base      espejo de la regla general vigente (la pantalla
--                              de Profesionales y la caja del día la leen).
--
-- Invariantes que cuida la base:
--  - Una versión no puede regir desde una fecha que ya está en un período
--    liquidado del profesional (ni crearse, ni cambiarse, ni borrarse): un
--    cambio de regla nunca reescribe lo ya liquidado.
--  - Una liquidación cerrada no cambia sus montos, su regla ni su detalle
--    (regla 10). Solo `paid_at`/`paid_by` y el registro del aviso por correo.
--  - Dos liquidaciones del mismo profesional no se pisan en fechas (antes solo
--    se impedía el mismo rango exacto).
--
-- Datos: copia cada regla actual de `commission_rules` como versión general que
-- rige desde el 2000-01-01 (lo mismo que se calculaba hasta hoy). Solo INSERT en
-- la tabla nueva; no modifica filas existentes.
--
-- Compatibilidad con el código en producción: `commission_rules` y
-- `commission_settlements` solo ganan columnas nullable o con default; el código
-- viejo sigue leyendo y escribiendo igual. Un profesional sin versiones se
-- calcula con su fila de `commission_rules` (así se cubre lo que el código viejo
-- edite en la ventana y la regla que siembra la demo).

-- ═══ 1. Versiones de la regla ═══════════════════════════════════════════════

create table if not exists public.commission_rule_versions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  scope text not null default 'general',
  procedure_id uuid references public.procedures(id) on delete set null,
  procedure_name_snapshot text,
  kind text not null,
  percent_bps integer not null default 0,
  fixed_cents bigint not null default 0,
  base text not null default 'realizado',
  effective_from date not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint commission_rule_versions_scope_check check (scope in ('general', 'prestacion')),
  constraint commission_rule_versions_kind_check check (kind in ('percent', 'fixed', 'none')),
  constraint commission_rule_versions_percent_check check (percent_bps between 0 and 10000),
  constraint commission_rule_versions_fixed_check check (fixed_cents >= 0),
  constraint commission_rule_versions_base_check check (base in ('realizado', 'cobrado')),
  constraint commission_rule_versions_note_check check (note is null or char_length(note) <= 300),
  constraint commission_rule_versions_prestacion_check check (
    (scope = 'general' and procedure_id is null and procedure_name_snapshot is null)
    or (scope = 'prestacion' and procedure_name_snapshot is not null)
  )
);

-- Una versión por profesional, alcance y fecha. La de una prestación cuyo
-- catálogo se borró (procedure_id NULL) queda como historia y no aplica.
create unique index if not exists commission_rule_versions_unica
  on public.commission_rule_versions (
    clinic_id, professional_id, scope,
    coalesce(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from
  )
  where scope = 'general' or procedure_id is not null;
create index if not exists commission_rule_versions_pro_idx
  on public.commission_rule_versions (clinic_id, professional_id, effective_from);

comment on table public.commission_rule_versions is
  'COM-02/03: regla de comisión con "rige desde". Una general por fecha y reglas por prestación opcionales. Cambiar la regla agrega una versión; las anteriores siguen valiendo para sus fechas.';

revoke all on public.commission_rule_versions from anon, authenticated;
grant select, insert, update, delete on public.commission_rule_versions to authenticated;
grant all on public.commission_rule_versions to service_role;
alter table public.commission_rule_versions enable row level security;

-- Igual que commission_rules: owner/admin/accounting ven todas; el profesional, las suyas.
drop policy if exists commission_rule_versions_select on public.commission_rule_versions;
create policy commission_rule_versions_select on public.commission_rule_versions
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[])
    or professional_id in (
      select professionals.id from public.professionals
       where professionals.user_id = (select auth.uid())
    )
  );

drop policy if exists commission_rule_versions_insert on public.commission_rule_versions;
create policy commission_rule_versions_insert on public.commission_rule_versions
  for insert to authenticated
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists commission_rule_versions_update on public.commission_rule_versions;
create policy commission_rule_versions_update on public.commission_rule_versions
  for update to authenticated
  using (public.can_manage_clinic(clinic_id))
  with check (public.can_manage_clinic(clinic_id));

drop policy if exists commission_rule_versions_delete on public.commission_rule_versions;
create policy commission_rule_versions_delete on public.commission_rule_versions
  for delete to authenticated
  using (public.can_manage_clinic(clinic_id));

drop trigger if exists block_demo_writes on public.commission_rule_versions;
create trigger block_demo_writes
  before insert or update or delete on public.commission_rule_versions
  for each row execute function public.block_demo_writes();

-- ═══ 2. Columnas nuevas ═════════════════════════════════════════════════════

alter table public.commission_rules
  add column if not exists base text not null default 'realizado';
alter table public.commission_rules
  drop constraint if exists commission_rules_base_check;
alter table public.commission_rules
  add constraint commission_rules_base_check check (base in ('realizado', 'cobrado'));

alter table public.commission_settlements
  add column if not exists base text,
  add column if not exists cobrado_cents bigint,
  add column if not exists rule_effective_from date,
  add column if not exists detail jsonb;
alter table public.commission_settlements
  drop constraint if exists commission_settlements_base_check;
alter table public.commission_settlements
  add constraint commission_settlements_base_check
  check (base is null or base in ('realizado', 'cobrado'));
alter table public.commission_settlements
  drop constraint if exists commission_settlements_detail_check;
alter table public.commission_settlements
  add constraint commission_settlements_detail_check
  check (detail is null or jsonb_typeof(detail) = 'object');

comment on column public.commission_settlements.base is
  'Base de la regla al cerrar: realizado (producción) o cobrado. NULL en liquidaciones anteriores a la Ola 10 (eran sobre lo realizado).';
comment on column public.commission_settlements.cobrado_cents is
  'Cobrado atribuido al profesional en el período al cerrar. NULL en liquidaciones anteriores a la Ola 10.';
comment on column public.commission_settlements.rule_effective_from is
  'Fecha desde la que regía la última regla aplicada en el período.';
comment on column public.commission_settlements.detail is
  'Foto inmutable de la liquidación: tramos de regla y líneas (fecha, concepto, monto, comisión). NULL en liquidaciones anteriores a la Ola 10.';

-- ═══ 3. Datos: la regla actual pasa a ser la primera versión ════════════════

insert into public.commission_rule_versions
  (clinic_id, professional_id, scope, kind, percent_bps, fixed_cents, base, effective_from, note, created_by, created_at)
select r.clinic_id, r.professional_id, 'general', r.kind, r.percent_bps, r.fixed_cents, 'realizado',
       date '2000-01-01', 'Regla vigente al activar la vigencia de comisiones', r.updated_by, r.updated_at
  from public.commission_rules r
 where not exists (
   select 1 from public.commission_rule_versions v
    where v.clinic_id = r.clinic_id and v.professional_id = r.professional_id
 );

-- ═══ 4. Un cambio de regla no reescribe lo liquidado ════════════════════════
-- SECURITY INVOKER: quien escribe versiones es owner/admin, que lee todas las
-- liquidaciones. service_role y postgres pasan (semillas de la demo).

create or replace function public.proteger_version_de_comision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pro uuid := coalesce(new.professional_id, old.professional_id);
  v_clinica uuid := coalesce(new.clinic_id, old.clinic_id);
  v_ultimo date;
begin
  if current_user in ('service_role', 'postgres') then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and (
       new.clinic_id is distinct from old.clinic_id
       or new.professional_id is distinct from old.professional_id
       or new.scope is distinct from old.scope
       or new.procedure_id is distinct from old.procedure_id) then
    raise exception 'Una regla de comisión no cambia de profesional ni de prestación: crea una nueva.';
  end if;

  select max(s.period_to) into v_ultimo
    from public.commission_settlements s
   where s.clinic_id = v_clinica and s.professional_id = v_pro;

  if v_ultimo is not null then
    if tg_op in ('UPDATE', 'DELETE') and old.effective_from <= v_ultimo then
      raise exception 'Esa regla ya se usó en un período liquidado (hasta el %): no se cambia ni se borra. Crea una regla nueva que rija desde el %.',
        to_char(v_ultimo, 'DD-MM-YYYY'), to_char(v_ultimo + 1, 'DD-MM-YYYY');
    end if;
    if tg_op in ('INSERT', 'UPDATE') and new.effective_from <= v_ultimo then
      raise exception 'Ese período ya está liquidado (hasta el %): la regla nueva tiene que regir desde el % o después.',
        to_char(v_ultimo, 'DD-MM-YYYY'), to_char(v_ultimo + 1, 'DD-MM-YYYY');
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if auth.uid() is not null and tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists commission_rule_versions_proteger on public.commission_rule_versions;
create trigger commission_rule_versions_proteger
  before insert or update or delete on public.commission_rule_versions
  for each row execute function public.proteger_version_de_comision();

-- ═══ 5. Liquidación congelada (COM-04, regla 10) ════════════════════════════

create or replace function public.proteger_liquidacion_de_comision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.period_to < new.period_from then
      raise exception 'El período de la liquidación termina antes de empezar.';
    end if;
    if exists (
      select 1 from public.commission_settlements s
       where s.clinic_id = new.clinic_id
         and s.professional_id = new.professional_id
         and s.period_from <= new.period_to
         and s.period_to >= new.period_from
    ) then
      raise exception 'Este período se cruza con una liquidación ya cerrada del mismo profesional.';
    end if;
    return new;
  end if;

  -- UPDATE: solo marcar pagada y registrar el aviso por correo.
  if new.clinic_id is distinct from old.clinic_id
     or new.professional_id is distinct from old.professional_id
     or new.period_from is distinct from old.period_from
     or new.period_to is distinct from old.period_to
     or new.rule_kind is distinct from old.rule_kind
     or new.rule_percent_bps is distinct from old.rule_percent_bps
     or new.rule_fixed_cents is distinct from old.rule_fixed_cents
     or new.production_cents is distinct from old.production_cents
     or new.procedure_count is distinct from old.procedure_count
     or new.commission_cents is distinct from old.commission_cents
     or new.closed_at is distinct from old.closed_at
     or new.closed_by is distinct from old.closed_by
     or new.base is distinct from old.base
     or new.cobrado_cents is distinct from old.cobrado_cents
     or new.rule_effective_from is distinct from old.rule_effective_from
     or new.detail is distinct from old.detail then
    raise exception 'Una liquidación cerrada no se modifica: solo se marca como pagada.';
  end if;
  return new;
end;
$$;

drop trigger if exists commission_settlements_proteger on public.commission_settlements;
create trigger commission_settlements_proteger
  before insert or update on public.commission_settlements
  for each row execute function public.proteger_liquidacion_de_comision();

-- ── Cómo revertir (respaldar antes commission_rule_versions) ────────────────
-- drop trigger if exists commission_settlements_proteger on public.commission_settlements;
-- drop function if exists public.proteger_liquidacion_de_comision();
-- drop trigger if exists commission_rule_versions_proteger on public.commission_rule_versions;
-- drop function if exists public.proteger_version_de_comision();
-- alter table public.commission_settlements drop constraint if exists commission_settlements_detail_check;
-- alter table public.commission_settlements drop constraint if exists commission_settlements_base_check;
-- alter table public.commission_settlements drop column if exists detail,
--   drop column if exists rule_effective_from, drop column if exists cobrado_cents, drop column if exists base;
-- alter table public.commission_rules drop constraint if exists commission_rules_base_check;
-- alter table public.commission_rules drop column if exists base;
-- drop table if exists public.commission_rule_versions;
