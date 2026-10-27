-- Ola 10 · frente A (2/4): empresas con convenio y membresías (FIN-11, FIN-12,
-- FIC-05, FIC-06).
--
-- Dos maneras en que un paciente llega con una condición comercial que no es
-- un seguro (los seguros siguen en `agreements`, /convenios):
--
--   - Empresa con convenio (FIN-11): la empresa donde trabaja el paciente le da
--     un descuento (% o monto) y, si hay descuento por planilla, la empresa le
--     paga a la clínica y se lo descuenta del sueldo. `partner_companies` es la
--     empresa; `partner_company_patients`, quién está afiliado (una empresa por
--     paciente). El estado de cuenta de la empresa se calcula en la migración
--     4/4 (`estado_cuenta_empresa`), con la misma fórmula de saldo de siempre.
--   - Membresía (FIN-12): plan de la clínica con beneficios y una cuota
--     (`membership_plans`), el paciente inscrito (`patient_memberships`) y cada
--     cuota del período (`membership_charges`). **Sin cobro automático**: una
--     persona genera las cuotas del mes (`generar_cuotas_de_membresia`, con
--     vista previa) y otra la cobra a mano. La cuota cobrada NO es un `payment`:
--     un pago resta del saldo de tratamientos del paciente (`patient_balances`)
--     y la cuota no es un tratamiento.
--
-- Permisos (regla 2: assistant no ve dinero):
--   - Catálogos (empresas y planes): leen owner, admin, dentist, reception y
--     accounting (los muestra la ficha); escriben owner, admin y accounting.
--   - Afiliación, inscripción y cuotas: leen y escriben owner, admin, dentist,
--     reception y accounting (el mismo público que `receivables`). Las cuotas
--     no se borran: se anulan. Generarlas exige finance:view en el servidor.
-- Política RESTRICTIVE `mfa_exige_aal2` en las cinco tablas.
--
-- Compatible con el código en producción: solo tablas, funciones y triggers
-- nuevos.

begin;

-- ─── 0. Paciente de la misma clínica (compartida por las tablas nuevas) ────

create or replace function public.validar_paciente_de_la_clinica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- SECURITY DEFINER para poder leer el paciente aunque la ficha esté
  -- restringida; solo compara clínicas, no expone nada.
  if not exists (
    select 1 from public.patients p
     where p.id = new.patient_id and p.clinic_id = new.clinic_id
  ) then
    raise exception 'El paciente no es de esta clínica.' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke execute on function public.validar_paciente_de_la_clinica() from public, anon;

-- ─── 1. Empresas con convenio ──────────────────────────────────────────────

create table public.partner_companies (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  tax_id text check (tax_id is null or char_length(tax_id) <= 20),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 200),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  -- percent: % sobre lo que paga el paciente · amount: monto fijo por
  -- atención · none: solo descuento por planilla, sin rebaja.
  discount_kind text not null default 'percent'
    check (discount_kind in ('percent', 'amount', 'none')),
  discount_percent numeric(5,2) check (discount_percent is null or discount_percent between 0 and 100),
  discount_cents bigint check (discount_cents is null or discount_cents >= 0),
  -- La fija `moneda_desde_la_clinica` (regla 14).
  currency text not null,
  -- La empresa le paga a la clínica y lo descuenta del sueldo del paciente.
  payroll_deduction boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  constraint partner_companies_descuento_consistente check (
    (discount_kind = 'percent' and discount_percent is not null and discount_cents is null)
    or (discount_kind = 'amount' and discount_cents is not null and discount_percent is null)
    or (discount_kind = 'none' and discount_percent is null and discount_cents is null)
  )
);

comment on table public.partner_companies is
  'Empresa con convenio (FIN-11): descuento para sus trabajadores y, si aplica, descuento por planilla. Los seguros siguen en agreements.';

create unique index partner_companies_nombre_unico
  on public.partner_companies (clinic_id, lower(btrim(name)));

create trigger partner_companies_updated_at before update on public.partner_companies
  for each row execute function public.set_updated_at();
create trigger moneda_desde_la_clinica
  before insert on public.partner_companies
  for each row execute function public.aplicar_moneda_de_la_clinica();
create trigger block_demo_writes
  before insert or update or delete on public.partner_companies
  for each row execute function public.block_demo_writes();

grant select, insert, update on public.partner_companies to authenticated;
-- Una empresa se desactiva, no se borra (tiene afiliados e historia).
revoke delete, truncate on public.partner_companies from anon, authenticated;
grant all on public.partner_companies to service_role;
alter table public.partner_companies enable row level security;

create policy partner_companies_select_staff on public.partner_companies
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy partner_companies_insert_finance_roles on public.partner_companies
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[])
    and created_by = (select auth.uid())
  );
create policy partner_companies_update_finance_roles on public.partner_companies
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.partner_companies;
create policy mfa_exige_aal2 on public.partner_companies
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 2. Pacientes afiliados a una empresa ──────────────────────────────────

create table public.partner_company_patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  company_id uuid not null,
  -- RESTRICT como el resto de las FKs clínicas: los pacientes se archivan.
  patient_id uuid not null references public.patients(id) on delete restrict,
  -- Código o RUT de trabajador que pide la empresa para la planilla.
  employee_code text check (employee_code is null or char_length(employee_code) <= 40),
  since date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Una empresa por paciente: el descuento y la planilla no se combinan.
  unique (patient_id),
  foreign key (company_id, clinic_id)
    references public.partner_companies (id, clinic_id) on delete cascade
);

comment on table public.partner_company_patients is
  'Paciente afiliado a una empresa con convenio (FIC-05). Una empresa por paciente.';

create index partner_company_patients_company_idx
  on public.partner_company_patients (clinic_id, company_id);

create trigger partner_company_patients_updated_at before update on public.partner_company_patients
  for each row execute function public.set_updated_at();
create trigger partner_company_patients_paciente
  before insert or update of patient_id, clinic_id on public.partner_company_patients
  for each row execute function public.validar_paciente_de_la_clinica();
create trigger block_demo_writes
  before insert or update or delete on public.partner_company_patients
  for each row execute function public.block_demo_writes();

grant select, insert, update, delete on public.partner_company_patients to authenticated;
revoke truncate on public.partner_company_patients from anon, authenticated;
grant all on public.partner_company_patients to service_role;
alter table public.partner_company_patients enable row level security;

create policy partner_company_patients_select_staff on public.partner_company_patients
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy partner_company_patients_insert_staff on public.partner_company_patients
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[])
    and created_by = (select auth.uid())
  );
create policy partner_company_patients_update_staff on public.partner_company_patients
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy partner_company_patients_delete_staff on public.partner_company_patients
  for delete to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.partner_company_patients;
create policy mfa_exige_aal2 on public.partner_company_patients
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 3. Planes de membresía ────────────────────────────────────────────────

create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  -- Un beneficio por elemento ("2 limpiezas al año", "Urgencias sin costo").
  benefits text[] not null default '{}' check (cardinality(benefits) <= 20),
  fee_cents bigint not null check (fee_cents > 0),
  -- La fija `moneda_desde_la_clinica` (regla 14).
  currency text not null,
  -- Cada cuánto se cobra la cuota.
  billing_period text not null default 'monthly'
    check (billing_period in ('monthly', 'quarterly', 'semiannual', 'yearly')),
  -- Descuento en tratamientos para los inscritos (informativo en la ficha).
  treatment_discount_percent numeric(5,2)
    check (treatment_discount_percent is null or treatment_discount_percent between 0 and 100),
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id)
);

comment on table public.membership_plans is
  'Plan de membresía de la clínica (FIN-12): beneficios y cuota. Sin cobro automático.';

create unique index membership_plans_nombre_unico
  on public.membership_plans (clinic_id, lower(btrim(name)));

create trigger membership_plans_updated_at before update on public.membership_plans
  for each row execute function public.set_updated_at();
create trigger moneda_desde_la_clinica
  before insert on public.membership_plans
  for each row execute function public.aplicar_moneda_de_la_clinica();
create trigger block_demo_writes
  before insert or update or delete on public.membership_plans
  for each row execute function public.block_demo_writes();

grant select, insert, update on public.membership_plans to authenticated;
revoke delete, truncate on public.membership_plans from anon, authenticated;
grant all on public.membership_plans to service_role;
alter table public.membership_plans enable row level security;

create policy membership_plans_select_staff on public.membership_plans
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy membership_plans_insert_finance_roles on public.membership_plans
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[])
    and created_by = (select auth.uid())
  );
create policy membership_plans_update_finance_roles on public.membership_plans
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.membership_plans;
create policy mfa_exige_aal2 on public.membership_plans
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 4. Paciente inscrito en un plan ───────────────────────────────────────

create table public.patient_memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  plan_id uuid,
  -- Snapshot del plan al inscribir (regla 10): si el plan cambia de nombre o
  -- de cuota, la inscripción conserva lo pactado.
  plan_name_snapshot text not null,
  fee_cents bigint not null check (fee_cents > 0),
  currency text not null,
  billing_period text not null
    check (billing_period in ('monthly', 'quarterly', 'semiannual', 'yearly')),
  -- Mes de inicio (día 1): de ahí se cuentan los períodos de la cuota.
  starts_on date not null check (extract(day from starts_on) = 1),
  ends_on date,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (plan_id, clinic_id)
    references public.membership_plans (id, clinic_id) on delete set null (plan_id),
  constraint patient_memberships_rango check (ends_on is null or ends_on >= starts_on)
);

comment on table public.patient_memberships is
  'Paciente inscrito en un plan de membresía (FIC-06), con la cuota pactada como snapshot.';

-- Una membresía vigente (activa o pausada) por paciente.
create unique index patient_memberships_vigente_unica
  on public.patient_memberships (patient_id) where status <> 'cancelled';
create index patient_memberships_clinic_idx on public.patient_memberships (clinic_id, status);

create trigger patient_memberships_updated_at before update on public.patient_memberships
  for each row execute function public.set_updated_at();
create trigger patient_memberships_paciente
  before insert or update of patient_id, clinic_id on public.patient_memberships
  for each row execute function public.validar_paciente_de_la_clinica();
create trigger block_demo_writes
  before insert or update or delete on public.patient_memberships
  for each row execute function public.block_demo_writes();

-- Al inscribir: la moneda la fija la clínica y el snapshot sale del plan, no
-- del cliente. Al cancelar, la base anota quién y cuándo.
create or replace function public.patient_memberships_preparar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_plan record;
begin
  if tg_op = 'INSERT' then
    select mp.name, mp.fee_cents, mp.billing_period, mp.active, c.currency
      into v_plan
      from public.membership_plans mp
      join public.clinics c on c.id = mp.clinic_id
     where mp.id = new.plan_id and mp.clinic_id = new.clinic_id;
    if not found then
      raise exception 'El plan de membresía no existe en esta clínica.' using errcode = '23503';
    end if;
    if not v_plan.active then
      raise exception 'El plan de membresía está desactivado.' using errcode = '23514';
    end if;
    new.plan_name_snapshot := v_plan.name;
    new.fee_cents := v_plan.fee_cents;
    new.billing_period := v_plan.billing_period;
    new.currency := v_plan.currency;
    return new;
  end if;

  if new.fee_cents is distinct from old.fee_cents
     or new.currency is distinct from old.currency
     or new.billing_period is distinct from old.billing_period
     or new.plan_name_snapshot is distinct from old.plan_name_snapshot
     or new.clinic_id is distinct from old.clinic_id then
    raise exception 'La cuota pactada no se edita: cancela la membresía e inscribe al paciente de nuevo.'
      using errcode = '23514';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'Una membresía cancelada no se reactiva: inscribe al paciente de nuevo.'
      using errcode = '23514';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.patient_memberships_preparar() from public, anon;

create trigger patient_memberships_preparar
  before insert or update on public.patient_memberships
  for each row execute function public.patient_memberships_preparar();

grant select, insert, update on public.patient_memberships to authenticated;
revoke delete, truncate on public.patient_memberships from anon, authenticated;
grant all on public.patient_memberships to service_role;
alter table public.patient_memberships enable row level security;

create policy patient_memberships_select_staff on public.patient_memberships
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy patient_memberships_insert_staff on public.patient_memberships
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[])
    and created_by = (select auth.uid())
  );
create policy patient_memberships_update_staff on public.patient_memberships
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.patient_memberships;
create policy mfa_exige_aal2 on public.patient_memberships
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 5. Cuotas de membresía ────────────────────────────────────────────────

create table public.membership_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  membership_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  -- Período que cubre la cuota: del día 1 de un mes al último día del mes en
  -- que termina el período del plan.
  period_start date not null check (extract(day from period_start) = 1),
  period_end date not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  paid_at timestamptz,
  paid_by uuid,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  method_name_snapshot text,
  reference text check (reference is null or char_length(reference) <= 120),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, period_start),
  foreign key (membership_id, clinic_id)
    references public.patient_memberships (id, clinic_id) on delete restrict,
  constraint membership_charges_periodo check (period_end >= period_start),
  constraint membership_charges_estado_consistente check (
    (status = 'pending' and paid_at is null and voided_at is null)
    or (status = 'paid' and paid_at is not null and voided_at is null)
    or (status = 'void' and voided_at is not null and void_reason is not null)
  )
);

comment on table public.membership_charges is
  'Cuota de membresía de un período (FIN-12): cuenta por cobrar que cobra una persona. No es un payment: no resta del saldo de tratamientos.';

create index membership_charges_clinic_status_idx
  on public.membership_charges (clinic_id, status, period_start desc);
create index membership_charges_patient_idx on public.membership_charges (patient_id);

create trigger membership_charges_updated_at before update on public.membership_charges
  for each row execute function public.set_updated_at();
create trigger membership_charges_paciente
  before insert or update of patient_id, clinic_id on public.membership_charges
  for each row execute function public.validar_paciente_de_la_clinica();
create trigger block_demo_writes
  before insert or update or delete on public.membership_charges
  for each row execute function public.block_demo_writes();

-- Lo que define la cuota no se edita; el estado solo avanza (pendiente →
-- cobrada o anulada; cobrada → anulada con motivo). La base anota quién cobró
-- o anuló, y la moneda viene de la inscripción.
create or replace function public.membership_charges_reglas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select pm.currency, pm.patient_id
      into new.currency, new.patient_id
      from public.patient_memberships pm
     where pm.id = new.membership_id and pm.clinic_id = new.clinic_id;
    if not found then
      raise exception 'La membresía no existe en esta clínica.' using errcode = '23503';
    end if;
    if new.status <> 'pending' then
      raise exception 'Una cuota nace pendiente.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.clinic_id is distinct from old.clinic_id
     or new.membership_id is distinct from old.membership_id
     or new.patient_id is distinct from old.patient_id
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.amount_cents is distinct from old.amount_cents
     or new.currency is distinct from old.currency then
    raise exception 'El monto y el período de una cuota no se editan: anúlala.' using errcode = '23514';
  end if;
  if old.status = 'void' then
    raise exception 'Una cuota anulada no cambia.' using errcode = '23514';
  end if;
  if old.status = 'paid' and new.status = 'pending' then
    raise exception 'Una cuota cobrada no vuelve a pendiente: anúlala con el motivo.' using errcode = '23514';
  end if;
  if new.status = 'paid' and old.status = 'pending' then
    new.paid_at := coalesce(new.paid_at, now());
    new.paid_by := auth.uid();
  end if;
  if new.status = 'void' and old.status <> 'void' then
    new.voided_at := now();
    new.voided_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.membership_charges_reglas() from public, anon;

create trigger membership_charges_reglas
  before insert or update on public.membership_charges
  for each row execute function public.membership_charges_reglas();

grant select, insert, update on public.membership_charges to authenticated;
revoke delete, truncate on public.membership_charges from anon, authenticated;
grant all on public.membership_charges to service_role;
alter table public.membership_charges enable row level security;

create policy membership_charges_select_staff on public.membership_charges
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy membership_charges_insert_staff on public.membership_charges
  for insert to authenticated
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy membership_charges_update_staff on public.membership_charges
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.membership_charges;
create policy mfa_exige_aal2 on public.membership_charges
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

-- ─── 6. Generar las cuotas de un mes (con vista previa) ────────────────────
-- Corresponde cuota en el mes M a una membresía activa cuando M está entre su
-- inicio y su término y la distancia en meses desde el inicio es múltiplo del
-- período del plan (1, 3, 6 o 12). Con `p_confirmar = false` solo devuelve lo
-- que crearía (vista previa con la cifra afectada); con `true` las crea y
-- devuelve las creadas. Idempotente: una cuota por membresía y período.
-- SECURITY INVOKER: la RLS decide; el servidor exige además finance:view.
create or replace function public.generar_cuotas_de_membresia(
  p_clinic_id uuid,
  p_periodo date,
  p_confirmar boolean default false
)
returns table (membership_id uuid, patient_id uuid, amount_cents bigint, period_start date, period_end date)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_mes date := date_trunc('month', p_periodo)::date;
begin
  if p_confirmar then
    return query
    with corresponden as (
      select pm.id, pm.patient_id, pm.fee_cents,
             (v_mes + (case pm.billing_period
                         when 'monthly' then interval '1 month'
                         when 'quarterly' then interval '3 months'
                         when 'semiannual' then interval '6 months'
                         else interval '12 months' end) - interval '1 day')::date as fin
        from public.patient_memberships pm
       where pm.clinic_id = p_clinic_id
         and pm.status = 'active'
         and pm.starts_on <= v_mes
         and (pm.ends_on is null or pm.ends_on >= v_mes)
         and mod(
               (extract(year from v_mes)::int * 12 + extract(month from v_mes)::int)
               - (extract(year from pm.starts_on)::int * 12 + extract(month from pm.starts_on)::int),
               case pm.billing_period
                 when 'monthly' then 1 when 'quarterly' then 3
                 when 'semiannual' then 6 else 12 end
             ) = 0
    ),
    creadas as (
      insert into public.membership_charges as mc
        (clinic_id, membership_id, patient_id, period_start, period_end, amount_cents, currency)
      select p_clinic_id, c.id, c.patient_id, v_mes, c.fin, c.fee_cents, ''
        from corresponden c
      on conflict on constraint membership_charges_membership_id_period_start_key do nothing
      returning mc.membership_id, mc.patient_id, mc.amount_cents, mc.period_start, mc.period_end
    )
    select * from creadas;
  else
    return query
    select pm.id, pm.patient_id, pm.fee_cents, v_mes,
           (v_mes + (case pm.billing_period
                       when 'monthly' then interval '1 month'
                       when 'quarterly' then interval '3 months'
                       when 'semiannual' then interval '6 months'
                       else interval '12 months' end) - interval '1 day')::date
      from public.patient_memberships pm
     where pm.clinic_id = p_clinic_id
       and pm.status = 'active'
       and pm.starts_on <= v_mes
       and (pm.ends_on is null or pm.ends_on >= v_mes)
       and mod(
             (extract(year from v_mes)::int * 12 + extract(month from v_mes)::int)
             - (extract(year from pm.starts_on)::int * 12 + extract(month from pm.starts_on)::int),
             case pm.billing_period
               when 'monthly' then 1 when 'quarterly' then 3
               when 'semiannual' then 6 else 12 end
           ) = 0
       and not exists (
         select 1 from public.membership_charges mc
          where mc.membership_id = pm.id and mc.period_start = v_mes
       );
  end if;
end;
$$;

comment on function public.generar_cuotas_de_membresia(uuid, date, boolean) is
  'FIN-12: cuotas de membresía que corresponden a un mes. p_confirmar=false es la vista previa; true las crea (idempotente). SECURITY INVOKER.';

revoke all on function public.generar_cuotas_de_membresia(uuid, date, boolean) from public, anon;
grant execute on function public.generar_cuotas_de_membresia(uuid, date, boolean) to authenticated, service_role;

commit;

-- Cómo revertir (no hay datos que migrar de vuelta: nada de lo existente se
-- tocó; las cuotas cobradas no están en payments):
--
-- begin;
-- drop function if exists public.generar_cuotas_de_membresia(uuid, date, boolean);
-- drop policy if exists mfa_exige_aal2 on public.membership_charges;
-- drop table if exists public.membership_charges;
-- drop function if exists public.membership_charges_reglas();
-- drop policy if exists mfa_exige_aal2 on public.patient_memberships;
-- drop table if exists public.patient_memberships;
-- drop function if exists public.patient_memberships_preparar();
-- drop policy if exists mfa_exige_aal2 on public.membership_plans;
-- drop table if exists public.membership_plans;
-- drop policy if exists mfa_exige_aal2 on public.partner_company_patients;
-- drop table if exists public.partner_company_patients;
-- drop policy if exists mfa_exige_aal2 on public.partner_companies;
-- drop table if exists public.partner_companies;
-- drop function if exists public.validar_paciente_de_la_clinica();
-- commit;
