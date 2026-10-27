-- Ola 10 · frente A (1/4): gastos fijos recurrentes (FIN-09).
--
-- Arriendo, sueldos y servicios se cargaban a mano cada mes en /gastos. Esta
-- migración agrega la plantilla del gasto que se repite y el vínculo del gasto
-- de cada mes con su plantilla, sin cambiar cómo se lee ni se suma un gasto:
--
--   - `recurring_expenses`: qué se paga, cuánto (monto de referencia), qué día
--     del mes, desde qué mes y hasta cuándo. No genera nada sola: no hay cron.
--   - `expenses.recurring_expense_id` + `expenses.recurring_period`: el gasto
--     del mes que nació de una plantilla, con el mes al que corresponde (día 1).
--     La restricción única (plantilla, mes) hace imposible cargar dos veces el
--     arriendo de octubre, aunque dos personas confirmen a la vez.
--   - `confirmar_gastos_fijos`: una persona confirma los gastos del mes (con el
--     monto real si cambió, p. ej. la luz) y se crean en `expenses`. SECURITY
--     INVOKER: la RLS de `expenses` decide quién puede (owner, admin,
--     accounting) y `created_by = auth.uid()` queda estampado.
--
-- Permisos: los mismos de `expenses` (owner, admin, accounting). Política
-- RESTRICTIVE `mfa_exige_aal2` (src/lib/auth/mfa-rls.ts).
--
-- Compatible con el código en producción: tabla nueva y dos columnas nullable
-- en `expenses`; ningún INSERT actual las informa.

begin;

-- ─── 1. Plantilla del gasto fijo ────────────────────────────────────────────

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- NULL = gasto de la clínica entera (mismo criterio que `expenses`).
  branch_id uuid references public.branches(id) on delete set null,
  category text not null check (char_length(btrim(category)) between 1 and 80),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  supplier text check (supplier is null or char_length(supplier) <= 120),
  -- Monto de referencia: al confirmar el mes se puede cambiar (cuentas que
  -- varían, como la luz o el agua).
  amount_cents bigint not null check (amount_cents > 0),
  -- La fija `moneda_desde_la_clinica` (regla 14): sin default a propósito.
  currency text not null,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  -- Día del mes en que vence. Hasta 28 para que exista en todos los meses.
  day_of_month smallint not null default 1 check (day_of_month between 1 and 28),
  -- Primer y último mes en que corre (siempre día 1). NULL = sin término.
  starts_on date not null check (extract(day from starts_on) = 1),
  ends_on date check (ends_on is null or extract(day from ends_on) = 1),
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_expenses_rango check (ends_on is null or ends_on >= starts_on)
);

comment on table public.recurring_expenses is
  'Gasto fijo que se repite cada mes (FIN-09). No genera gastos solo: una persona confirma los del mes con confirmar_gastos_fijos.';

create index recurring_expenses_clinic_idx on public.recurring_expenses (clinic_id, active);

create trigger recurring_expenses_updated_at before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

create trigger moneda_desde_la_clinica
  before insert on public.recurring_expenses
  for each row execute function public.aplicar_moneda_de_la_clinica();

create trigger block_demo_writes
  before insert or update or delete on public.recurring_expenses
  for each row execute function public.block_demo_writes();

grant select, insert, update, delete on public.recurring_expenses to authenticated;
revoke truncate on public.recurring_expenses from anon, authenticated;
grant all on public.recurring_expenses to service_role;
alter table public.recurring_expenses enable row level security;

create policy recurring_expenses_select_finance_roles on public.recurring_expenses
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]));
create policy recurring_expenses_insert_finance_roles on public.recurring_expenses
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[])
    and created_by = (select auth.uid())
  );
create policy recurring_expenses_update_finance_roles on public.recurring_expenses
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]));
create policy recurring_expenses_delete_finance_roles on public.recurring_expenses
  for delete to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.recurring_expenses;
create policy mfa_exige_aal2 on public.recurring_expenses
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 2. El gasto del mes recuerda su plantilla ─────────────────────────────

alter table public.expenses
  add column recurring_expense_id uuid references public.recurring_expenses(id) on delete set null,
  add column recurring_period date;

alter table public.expenses
  add constraint expenses_recurring_period_dia_1
    check (recurring_period is null or extract(day from recurring_period) = 1),
  -- Un gasto fijo se carga una sola vez por mes. NULL no choca con NULL: los
  -- gastos sueltos no se ven afectados.
  add constraint expenses_recurring_unico unique (recurring_expense_id, recurring_period);

comment on column public.expenses.recurring_expense_id is
  'Gasto fijo del que nació este gasto (FIN-09). NULL = gasto suelto.';
comment on column public.expenses.recurring_period is
  'Mes (día 1) del gasto fijo al que corresponde. Único por plantilla.';

-- La plantilla tiene que ser de la misma clínica que el gasto.
create or replace function public.validar_gasto_fijo_de_la_clinica()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recurring_expense_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.recurring_expenses r
     where r.id = new.recurring_expense_id and r.clinic_id = new.clinic_id
  ) then
    raise exception 'El gasto fijo no existe en esta clínica.' using errcode = '23503';
  end if;
  if new.recurring_period is null then
    raise exception 'Falta el mes del gasto fijo.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.validar_gasto_fijo_de_la_clinica() from public, anon;

create trigger expenses_validar_gasto_fijo
  before insert or update of recurring_expense_id, recurring_period on public.expenses
  for each row execute function public.validar_gasto_fijo_de_la_clinica();

-- ─── 3. Confirmar los gastos fijos de un mes ───────────────────────────────
-- `p_items` = [{"recurring_expense_id": "…", "amount_cents": 123}] (el monto es
-- opcional: sin él va el de referencia). Solo crea los que corresponden al mes
-- (plantilla activa y el mes dentro de su rango) y los que no existían: es
-- idempotente. Devuelve cuántos creó.
create or replace function public.confirmar_gastos_fijos(
  p_clinic_id uuid,
  p_periodo date,
  p_items jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mes date := date_trunc('month', p_periodo)::date;
  v_ultimo smallint := extract(day from (date_trunc('month', p_periodo) + interval '1 month - 1 day'))::smallint;
  v_creados integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Los gastos a confirmar tienen que venir como una lista.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Se pueden confirmar hasta 200 gastos a la vez.' using errcode = '22023';
  end if;

  insert into public.expenses (
    clinic_id, branch_id, category, description, supplier, amount_cents, currency,
    payment_method_id, method_name_snapshot, incurred_on, notes,
    recurring_expense_id, recurring_period
  )
  select r.clinic_id, r.branch_id, r.category, r.description, r.supplier,
         coalesce(nullif(i.item ->> 'amount_cents', '')::bigint, r.amount_cents),
         r.currency,
         r.payment_method_id, pm.name,
         (v_mes + (least(r.day_of_month, v_ultimo) - 1))::date,
         r.notes,
         r.id, v_mes
    from jsonb_array_elements(p_items) as i(item)
    join public.recurring_expenses r
      on r.id = (i.item ->> 'recurring_expense_id')::uuid
     and r.clinic_id = p_clinic_id
     and r.active
     and r.starts_on <= v_mes
     and (r.ends_on is null or r.ends_on >= v_mes)
    left join public.payment_methods pm on pm.id = r.payment_method_id
  on conflict (recurring_expense_id, recurring_period) do nothing;

  get diagnostics v_creados = row_count;
  return v_creados;
end;
$$;

comment on function public.confirmar_gastos_fijos(uuid, date, jsonb) is
  'FIN-09: crea en expenses los gastos fijos confirmados de un mes. Idempotente. SECURITY INVOKER (RLS de expenses).';

revoke all on function public.confirmar_gastos_fijos(uuid, date, jsonb) from public, anon;
grant execute on function public.confirmar_gastos_fijos(uuid, date, jsonb) to authenticated, service_role;

commit;

-- Cómo revertir (los gastos ya creados quedan como gastos sueltos):
--
-- begin;
-- drop function if exists public.confirmar_gastos_fijos(uuid, date, jsonb);
-- drop trigger if exists expenses_validar_gasto_fijo on public.expenses;
-- drop function if exists public.validar_gasto_fijo_de_la_clinica();
-- alter table public.expenses drop constraint if exists expenses_recurring_unico,
--   drop constraint if exists expenses_recurring_period_dia_1;
-- alter table public.expenses drop column if exists recurring_period,
--   drop column if exists recurring_expense_id;
-- drop policy if exists mfa_exige_aal2 on public.recurring_expenses;
-- drop table if exists public.recurring_expenses;
-- commit;
