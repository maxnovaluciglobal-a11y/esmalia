-- Ola 10 · frente B · Caja por operador (CAJ-02 a CAJ-05).
--
-- Hasta acá había UNA caja abierta por clínica+sucursal: todos los cobros de
-- todos los que cobran caían en el mismo cajón y el arqueo no decía de quién
-- era la diferencia. Ahora cada persona que cobra abre y cierra su propia
-- caja, y varias cajas pueden estar abiertas a la vez en la misma sucursal.
--
--   cash_registers.operator_id         dueño de la caja (auth.uid() de quien la
--                                      abrió). NULL = caja "general", la de antes:
--                                      todas las filas existentes quedan así y se
--                                      siguen leyendo igual (migración aditiva).
--   cash_registers.operator_name_snapshot  nombre de la persona al abrir (regla 10).
--   cash_registers.cash_collected_cents    snapshot al cerrar: efectivo cobrado.
--   cash_registers.movements_in_cents      snapshot al cerrar: traspasos recibidos.
--   cash_registers.movements_out_cents     snapshot al cerrar: traspasos, retiros y
--                                          depósitos que salieron.
--   cash_movements                      CAJ-04: traspaso entre cajas, retiro o
--                                      depósito, con motivo y quién lo hizo. Nunca
--                                      se edita ni se borra.
--
-- Invariantes que cuida la base:
--  - Una sola caja abierta por persona en la clínica; una sola caja general
--    abierta por sucursal (como antes).
--  - CAJ-02: el pago queda en la caja de quien cobra. Trigger BEFORE INSERT en
--    `payments`: si quien cobra tiene su caja abierta, el pago va ahí (pisa lo
--    que mande la app); si no, solo se respeta un vínculo a la caja general
--    abierta de la misma clínica (comportamiento anterior) y cualquier otro se
--    descarta. Sin usuario (service role, semillas) no toca nada.
--  - CAJ-03: la caja de una persona la cierra esa persona, o owner/admin.
--    Cerrada, ya no cambia (snapshot, regla 10). Al cerrar con el código nuevo
--    la base vuelve a calcular el esperado (apertura + efectivo + recibido −
--    salido) y rechaza el cierre si no coincide con el que mandó la app (un
--    cobro o un traspaso que entró mientras se contaba).
--  - CAJ-04: un movimiento sale de una caja abierta, entra (si es traspaso) a
--    otra caja abierta de la misma clínica, y no puede sacar más efectivo del
--    que hay en la caja de origen.
--
-- Compatibilidad con el código en producción durante los minutos entre aplicar
-- y mergear: el código viejo abre cajas generales (operator_id NULL), que siguen
-- permitidas con el mismo índice único por sucursal, y las cierra sin los
-- snapshots nuevos (la verificación del esperado solo corre cuando vienen).

-- ═══ 1. Columnas nuevas de cash_registers ═══════════════════════════════════

alter table public.cash_registers
  add column if not exists operator_id uuid,
  add column if not exists operator_name_snapshot text,
  add column if not exists cash_collected_cents bigint,
  add column if not exists movements_in_cents bigint,
  add column if not exists movements_out_cents bigint;

alter table public.cash_registers
  drop constraint if exists cash_registers_operator_name_snapshot_check;
alter table public.cash_registers
  add constraint cash_registers_operator_name_snapshot_check
  check (operator_name_snapshot is null or char_length(operator_name_snapshot) <= 120);

alter table public.cash_registers
  drop constraint if exists cash_registers_snapshots_movimientos_check;
alter table public.cash_registers
  add constraint cash_registers_snapshots_movimientos_check
  check (
    (cash_collected_cents is null or cash_collected_cents >= 0)
    and (movements_in_cents is null or movements_in_cents >= 0)
    and (movements_out_cents is null or movements_out_cents >= 0)
  );

comment on column public.cash_registers.operator_id is
  'CAJ-02: persona dueña de la caja (auth.uid() de quien la abrió). NULL = caja general (las de antes de la Ola 10).';
comment on column public.cash_registers.operator_name_snapshot is
  'Nombre de la persona al abrir la caja (snapshot, regla 10).';
comment on column public.cash_registers.cash_collected_cents is
  'Snapshot al cerrar: efectivo cobrado en la caja (NULL en cierres anteriores a la Ola 10).';
comment on column public.cash_registers.movements_in_cents is
  'Snapshot al cerrar: traspasos recibidos de otras cajas (NULL en cierres anteriores a la Ola 10).';
comment on column public.cash_registers.movements_out_cents is
  'Snapshot al cerrar: traspasos, retiros y depósitos que salieron (NULL en cierres anteriores a la Ola 10).';

-- Una caja abierta por persona (en toda la clínica: así un cobro sabe sin
-- ambigüedad a qué caja va) y, para las generales, una por sucursal como antes.
drop index if exists public.cash_registers_one_open_per_branch;
create unique index if not exists cash_registers_one_open_general_per_branch
  on public.cash_registers (clinic_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open' and operator_id is null;
create unique index if not exists cash_registers_one_open_per_operator
  on public.cash_registers (clinic_id, operator_id)
  where status = 'open' and operator_id is not null;
create index if not exists cash_registers_operator_idx
  on public.cash_registers (clinic_id, operator_id, opened_at desc)
  where operator_id is not null;

-- ═══ 2. Políticas de cash_registers ═════════════════════════════════════════
-- SELECT no cambia (cash_registers_select_members: cualquier miembro ve el
-- estado de caja). Abrir: la propia caja o una general. Cerrar/editar: la
-- propia, una general, u owner/admin cualquiera.

drop policy if exists cash_registers_insert_cashiers on public.cash_registers;
create policy cash_registers_insert_cashiers on public.cash_registers
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[])
    and opened_by = (select auth.uid())
    and (operator_id is null or operator_id = (select auth.uid()))
  );

drop policy if exists cash_registers_update_cashiers on public.cash_registers;
create policy cash_registers_update_cashiers on public.cash_registers
  for update to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[])
    and (
      operator_id is null
      or operator_id = (select auth.uid())
      or public.can_manage_clinic(clinic_id)
    )
  )
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[])
    and (
      operator_id is null
      or operator_id = (select auth.uid())
      or public.can_manage_clinic(clinic_id)
    )
  );

-- ═══ 3. Movimientos entre cajas (CAJ-04) ════════════════════════════════════

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  kind text not null,
  from_register_id uuid not null references public.cash_registers(id) on delete restrict,
  to_register_id uuid references public.cash_registers(id) on delete restrict,
  amount_cents bigint not null,
  currency text not null,
  reason text not null,
  reference text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint cash_movements_kind_check check (kind in ('traspaso', 'retiro', 'deposito')),
  constraint cash_movements_amount_check check (amount_cents > 0),
  constraint cash_movements_reason_check check (char_length(btrim(reason)) between 4 and 300),
  constraint cash_movements_reference_check check (reference is null or char_length(reference) <= 80),
  constraint cash_movements_destino_check check (
    (kind = 'traspaso' and to_register_id is not null and to_register_id <> from_register_id)
    or (kind in ('retiro', 'deposito') and to_register_id is null)
  )
);

create index if not exists cash_movements_from_idx on public.cash_movements (from_register_id);
create index if not exists cash_movements_to_idx
  on public.cash_movements (to_register_id) where to_register_id is not null;
create index if not exists cash_movements_clinic_created_idx
  on public.cash_movements (clinic_id, created_at desc);

comment on table public.cash_movements is
  'CAJ-04: traspaso de efectivo entre cajas, retiro o depósito al banco, con motivo y quién lo hizo. Ajusta el esperado del arqueo. No se edita ni se borra.';

revoke all on public.cash_movements from anon, authenticated;
grant select, insert on public.cash_movements to authenticated;
grant all on public.cash_movements to service_role;
alter table public.cash_movements enable row level security;

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (
    public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[])
  );

-- Sacar plata de una caja: de la propia, de una general, u owner/admin de cualquiera.
drop policy if exists cash_movements_insert on public.cash_movements;
create policy cash_movements_insert on public.cash_movements
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[])
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.cash_registers r
       where r.id = cash_movements.from_register_id
         and r.clinic_id = cash_movements.clinic_id
         and (
           r.operator_id is null
           or r.operator_id = (select auth.uid())
           or public.can_manage_clinic(r.clinic_id)
         )
    )
  );

-- MFA (SEG-01): movimientos de dinero exigen aal2 a quien activó MFA.
drop policy if exists mfa_exige_aal2 on public.cash_movements;
create policy mfa_exige_aal2 on public.cash_movements
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- Moneda desde la clínica (regla 14).
drop trigger if exists moneda_desde_la_clinica on public.cash_movements;
create trigger moneda_desde_la_clinica
  before insert on public.cash_movements
  for each row execute function public.aplicar_moneda_de_la_clinica();

drop trigger if exists block_demo_writes on public.cash_movements;
create trigger block_demo_writes
  before insert or update or delete on public.cash_movements
  for each row execute function public.block_demo_writes();

-- Efectivo disponible en una caja ahora: apertura + cobros en efectivo no
-- reversados + traspasos recibidos − lo que salió. Lo usan la validación del
-- movimiento y la del cierre (un solo cálculo, el mismo que `esperadoConMovimientos`).
create or replace function public.efectivo_en_caja(p_register_id uuid)
returns table (
  apertura_cents bigint,
  efectivo_cents bigint,
  entradas_cents bigint,
  salidas_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.opening_amount_cents,
    coalesce((select sum(p.amount_cents) from public.payments p
               where p.cash_register_id = r.id and p.reversed_at is null and p.method = 'cash'), 0)::bigint,
    coalesce((select sum(m.amount_cents) from public.cash_movements m
               where m.to_register_id = r.id), 0)::bigint,
    coalesce((select sum(m.amount_cents) from public.cash_movements m
               where m.from_register_id = r.id), 0)::bigint
  from public.cash_registers r
  where r.id = p_register_id;
$$;

revoke execute on function public.efectivo_en_caja(uuid) from public, anon;
grant execute on function public.efectivo_en_caja(uuid) to authenticated, service_role;

-- Validación del movimiento. SECURITY DEFINER: bloquea las dos cajas (FOR
-- UPDATE) aunque la de destino sea de otra persona; la autorización ya la
-- decidió la política de INSERT.
create or replace function public.validar_movimiento_de_caja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen record;
  v_destino record;
  v_saldo record;
  v_disponible bigint;
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  select id, clinic_id, status into v_origen
    from public.cash_registers where id = new.from_register_id for update;
  if v_origen.id is null or v_origen.clinic_id <> new.clinic_id then
    raise exception 'La caja de origen no existe.';
  end if;
  if v_origen.status <> 'open' then
    raise exception 'La caja de origen ya está cerrada.';
  end if;

  if new.to_register_id is not null then
    select id, clinic_id, status into v_destino
      from public.cash_registers where id = new.to_register_id for update;
    if v_destino.id is null or v_destino.clinic_id <> new.clinic_id then
      raise exception 'La caja de destino no existe.';
    end if;
    if v_destino.status <> 'open' then
      raise exception 'La caja de destino ya está cerrada.';
    end if;
  end if;

  select * into v_saldo from public.efectivo_en_caja(new.from_register_id);
  v_disponible := v_saldo.apertura_cents + v_saldo.efectivo_cents
                  + v_saldo.entradas_cents - v_saldo.salidas_cents;
  if new.amount_cents > v_disponible then
    raise exception 'No hay tanto efectivo en la caja de origen: quedan % en el cajón.', v_disponible;
  end if;

  new.reason := btrim(new.reason);
  return new;
end;
$$;

revoke execute on function public.validar_movimiento_de_caja() from public, anon;

drop trigger if exists cash_movements_validar on public.cash_movements;
create trigger cash_movements_validar
  before insert on public.cash_movements
  for each row execute function public.validar_movimiento_de_caja();

-- ═══ 4. Protección de la caja (CAJ-03) ══════════════════════════════════════
-- SECURITY INVOKER a propósito: service_role y postgres (semillas de la demo,
-- `reset_demo_clinic`) pasan sin control, igual que `block_demo_writes`.

create or replace function public.proteger_caja()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saldo record;
  v_esperado bigint;
begin
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.operator_id is not null and new.operator_id <> new.opened_by then
      raise exception 'Cada persona abre su propia caja.';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'closed' then
    raise exception 'Esa caja ya está cerrada: el arqueo no se modifica.';
  end if;
  if new.clinic_id is distinct from old.clinic_id
     or new.operator_id is distinct from old.operator_id
     or new.opened_by is distinct from old.opened_by
     or new.opened_at is distinct from old.opened_at
     or new.opening_amount_cents is distinct from old.opening_amount_cents
     or new.currency is distinct from old.currency then
    raise exception 'La apertura de la caja no se modifica.';
  end if;

  -- Cierre con el código de la Ola 10: la base vuelve a calcular el esperado.
  if new.status = 'closed' and new.movements_in_cents is not null then
    select * into v_saldo from public.efectivo_en_caja(new.id);
    v_esperado := v_saldo.apertura_cents + v_saldo.efectivo_cents
                  + v_saldo.entradas_cents - v_saldo.salidas_cents;
    if new.expected_closing_cents is distinct from v_esperado
       or new.cash_collected_cents is distinct from v_saldo.efectivo_cents
       or new.movements_in_cents is distinct from v_saldo.entradas_cents
       or new.movements_out_cents is distinct from v_saldo.salidas_cents then
      raise exception 'Entró un cobro o un movimiento mientras contabas. Vuelve a revisar el esperado y cuenta de nuevo.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cash_registers_proteger on public.cash_registers;
create trigger cash_registers_proteger
  before insert or update on public.cash_registers
  for each row execute function public.proteger_caja();

-- ═══ 5. El pago queda en la caja de quien cobra (CAJ-02) ════════════════════

create or replace function public.asignar_caja_del_cobrador()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caja uuid;
begin
  if v_uid is null then
    return new;
  end if;

  select r.id into v_caja
    from public.cash_registers r
   where r.clinic_id = new.clinic_id
     and r.status = 'open'
     and r.operator_id = v_uid
   limit 1;
  if v_caja is not null then
    new.cash_register_id := v_caja;
    return new;
  end if;

  -- Sin caja propia: solo vale el vínculo a la caja general abierta de esta
  -- clínica (lo que hacía la app hasta la Ola 10). Un vínculo a la caja de
  -- otra persona descuadraría su arqueo.
  if new.cash_register_id is not null and not exists (
    select 1 from public.cash_registers r
     where r.id = new.cash_register_id
       and r.clinic_id = new.clinic_id
       and r.status = 'open'
       and r.operator_id is null
  ) then
    new.cash_register_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_caja_del_cobrador on public.payments;
create trigger payments_caja_del_cobrador
  before insert on public.payments
  for each row execute function public.asignar_caja_del_cobrador();

-- ── Cómo revertir (no borra datos de pagos; cash_movements sí, respaldar antes) ──
-- drop trigger if exists payments_caja_del_cobrador on public.payments;
-- drop function if exists public.asignar_caja_del_cobrador();
-- drop trigger if exists cash_registers_proteger on public.cash_registers;
-- drop function if exists public.proteger_caja();
-- drop trigger if exists cash_movements_validar on public.cash_movements;
-- drop function if exists public.validar_movimiento_de_caja();
-- drop function if exists public.efectivo_en_caja(uuid);
-- drop policy if exists mfa_exige_aal2 on public.cash_movements;
-- drop table if exists public.cash_movements;
-- drop policy if exists cash_registers_update_cashiers on public.cash_registers;
-- create policy cash_registers_update_cashiers on public.cash_registers for update
--   using (public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[]))
--   with check (public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[]));
-- drop policy if exists cash_registers_insert_cashiers on public.cash_registers;
-- create policy cash_registers_insert_cashiers on public.cash_registers for insert
--   with check (public.has_clinic_role(clinic_id, array['owner','admin','reception','accounting']::public.app_role[])
--     and opened_by = (select auth.uid()));
-- (antes de recrear el índice viejo, cerrar las cajas por persona que sigan abiertas)
-- drop index if exists public.cash_registers_operator_idx;
-- drop index if exists public.cash_registers_one_open_per_operator;
-- drop index if exists public.cash_registers_one_open_general_per_branch;
-- create unique index cash_registers_one_open_per_branch on public.cash_registers
--   (clinic_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';
-- alter table public.cash_registers drop constraint if exists cash_registers_snapshots_movimientos_check;
-- alter table public.cash_registers drop constraint if exists cash_registers_operator_name_snapshot_check;
-- alter table public.cash_registers drop column if exists movements_out_cents,
--   drop column if exists movements_in_cents, drop column if exists cash_collected_cents,
--   drop column if exists operator_name_snapshot, drop column if exists operator_id;
