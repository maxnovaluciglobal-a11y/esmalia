-- Ola 3 · Frente Cobros (3/3): cuenta por cobrar automática al aceptar un
-- presupuesto (PLA-07).
--
-- Cuando un presupuesto pasa a aceptado (total o parcial), la base ya crea su
-- plan de tratamiento con las líneas aceptadas (`convert_accepted_quote_to_plan`,
-- BEFORE UPDATE, frente Planes 20261024200100): la aceptación total queda en
-- 'converted' y la parcial en 'partially_accepted'. Este trigger AFTER UPDATE
-- crea además la cuenta por cobrar por lo aceptado, en la misma transacción:
--
--   - Monto = parte del paciente de lo ACEPTADO: Σ coalesce(patient_cents,
--     price_cents) de los ítems del plan creado, que en una aceptación parcial
--     solo tiene las líneas aceptadas. Es la misma fórmula de
--     `patient_balances`. No se usa `quotes.accepted_total_cents` porque es el
--     total bruto de lo aceptado: con convenio, lo que cubre el convenio no es
--     deuda del paciente. Sin plan (no debería pasar), se suman las líneas de
--     quote_items no marcadas `accepted = false`. Si el paciente no paga nada
--     (todo cubierto), no se crea cuenta.
--   - Idempotente: `receivables_quote_unica` (un presupuesto, una cuenta) +
--     ON CONFLICT DO NOTHING, y además solo actúa en la transición desde un
--     estado no aceptado. Re-aceptar, o el UPDATE converted → converted, no
--     duplica. Tampoco crea otra si el plan ya tiene una cuenta vigente.
--   - Fecha de emisión = día de la aceptación en la zona horaria de la
--     clínica (regla 7), no el día UTC.
--
-- Aceptación parcial: si después el paciente acepta el resto, Planes no
-- permite volver a aceptar el mismo presupuesto (estado terminal); lo nuevo se
-- presupuesta aparte y genera su propia cuenta. El monto de una cuenta no se
-- edita (trigger `receivables_campos_inmutables`).
--
-- Plan cancelado → su cuenta vigente se anula sola (deja de ser deuda en el
-- saldo del paciente, que no suma planes cancelados; la cuenta tiene que
-- decir lo mismo).
--
-- SECURITY DEFINER: lo dispara quien acepta el presupuesto o cancela el plan
-- (owner, admin, dentist, reception), y la cuenta tiene que crearse igual
-- aunque la RLS de `receivables` cambie. Sin EXECUTE para nadie: solo la
-- llaman los triggers.

begin;

create or replace function public.crear_cuenta_por_cobrar_de_presupuesto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Estados que cuentan como "aceptado". El BEFORE UPDATE deja la aceptación
  -- total en 'converted' en la misma sentencia; la parcial queda como está.
  v_aceptados constant text[] := array['accepted', 'converted', 'partially_accepted'];
  v_plan uuid;
  v_monto bigint;
  v_zona text;
begin
  if not (new.status::text = any (v_aceptados)) then
    return null;
  end if;
  if old.status::text = any (v_aceptados) then
    return null;
  end if;

  select tp.id into v_plan
    from public.treatment_plans tp
   where tp.quote_id = new.id;

  if v_plan is not null then
    select coalesce(sum(coalesce(ti.patient_cents, ti.price_cents, 0)), 0)::bigint
      into v_monto
      from public.treatment_items ti
     where ti.plan_id = v_plan;
    -- El plan ya tiene una cuenta vigente (creada a mano): no se duplica.
    if exists (
      select 1 from public.receivables r
       where r.treatment_plan_id = v_plan and r.voided_at is null
    ) then
      return null;
    end if;
  else
    select coalesce(sum(coalesce(qi.patient_cents, qi.total_cents, 0)), 0)::bigint
      into v_monto
      from public.quote_items qi
     where qi.quote_id = new.id
       and (new.status::text <> 'partially_accepted' or qi.accepted is distinct from false);
  end if;

  if v_monto <= 0 then
    return null;
  end if;

  select coalesce(nullif(c.timezone, ''), 'America/Santiago') into v_zona
    from public.clinics c
   where c.id = new.clinic_id;

  insert into public.receivables (
    clinic_id, patient_id, quote_id, treatment_plan_id, description,
    amount_cents, currency, issued_on, created_by
  )
  values (
    new.clinic_id, new.patient_id, new.id, v_plan,
    'Presupuesto ' || coalesce(nullif(new.number, ''), 'aceptado'),
    v_monto, new.currency,
    (coalesce(new.accepted_at, now()) at time zone coalesce(v_zona, 'America/Santiago'))::date,
    coalesce(auth.uid(), new.created_by)
  )
  on conflict (quote_id) where quote_id is not null do nothing;

  return null;
end;
$$;

comment on function public.crear_cuenta_por_cobrar_de_presupuesto() is
  'PLA-07: AFTER UPDATE OF status en quotes. Crea la cuenta por cobrar del presupuesto aceptado (idempotente).';

revoke execute on function public.crear_cuenta_por_cobrar_de_presupuesto() from public, anon, authenticated;

drop trigger if exists quotes_cuenta_por_cobrar on public.quotes;
create trigger quotes_cuenta_por_cobrar
  after update of status on public.quotes
  for each row execute function public.crear_cuenta_por_cobrar_de_presupuesto();

create or replace function public.anular_cuenta_de_plan_cancelado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = 'cancelled' and old.status::text <> 'cancelled' then
    update public.receivables
       set voided_at = now(),
           voided_by = auth.uid(),
           void_reason = 'Plan de tratamiento cancelado'
     where treatment_plan_id = new.id
       and clinic_id = new.clinic_id
       and voided_at is null;
  end if;
  return null;
end;
$$;

comment on function public.anular_cuenta_de_plan_cancelado() is
  'AFTER UPDATE OF status en treatment_plans: al cancelar el plan, anula su cuenta por cobrar vigente.';

revoke execute on function public.anular_cuenta_de_plan_cancelado() from public, anon, authenticated;

drop trigger if exists treatment_plans_anular_cuenta on public.treatment_plans;
create trigger treatment_plans_anular_cuenta
  after update of status on public.treatment_plans
  for each row execute function public.anular_cuenta_de_plan_cancelado();

commit;

-- Cómo revertir (las cuentas ya creadas quedan; no son destructivas):
--
-- begin;
-- drop trigger if exists treatment_plans_anular_cuenta on public.treatment_plans;
-- drop function if exists public.anular_cuenta_de_plan_cancelado();
-- drop trigger if exists quotes_cuenta_por_cobrar on public.quotes;
-- drop function if exists public.crear_cuenta_por_cobrar_de_presupuesto();
-- commit;
