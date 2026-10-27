-- Cierre · Bloque 5 · ítem 2: el descuento de convenio (empresa) o de
-- membresía que se aplica al presupuesto de un paciente afiliado queda
-- trazado en el presupuesto.
--
-- El descuento en sí NO es un campo nuevo: se aplica como el descuento
-- comercial de siempre (`commercial_discount_pct` o `discount_cents`), visible
-- y editable en el diálogo. Lo que se guarda acá es de DÓNDE salió, con
-- snapshots (regla 10) para que el presupuesto siga diciendo lo mismo aunque
-- después cambien o se borren la empresa o el plan:
--
--   - affiliation_discount_source: 'empresa' o 'membresia'.
--   - affiliation_discount_name_snapshot: "Constructora Andes", "Plan Sonrisa".
--   - affiliation_discount_rule_snapshot: "15 % de descuento".
--   - affiliation_discount_percent / affiliation_discount_amount_cents: la regla
--     que se propuso (una u otra). Si el descuento final del presupuesto es
--     otro, la pantalla dice "ajustado".
--   - partner_company_id / membership_plan_id: vínculo vivo, ON DELETE SET NULL.
--
-- Todo nullable: los presupuestos existentes quedan igual (sin origen).
--
-- Sin tablas nuevas: no hay RLS ni GRANT que agregar. No escribe datos.
-- Compatible con el código en producción: solo columnas nuevas nullable.

begin;

alter table public.quotes
  add column if not exists affiliation_discount_source text,
  add column if not exists affiliation_discount_name_snapshot text,
  add column if not exists affiliation_discount_rule_snapshot text,
  add column if not exists affiliation_discount_percent numeric(5,2),
  add column if not exists affiliation_discount_amount_cents bigint,
  add column if not exists partner_company_id uuid references public.partner_companies(id) on delete set null,
  add column if not exists membership_plan_id uuid references public.membership_plans(id) on delete set null;

alter table public.quotes
  drop constraint if exists quotes_affiliation_discount_consistente;
alter table public.quotes
  add constraint quotes_affiliation_discount_consistente check (
    (affiliation_discount_source is null
      and affiliation_discount_name_snapshot is null
      and affiliation_discount_rule_snapshot is null
      and affiliation_discount_percent is null
      and affiliation_discount_amount_cents is null
      and partner_company_id is null
      and membership_plan_id is null)
    or (affiliation_discount_source is not null
      and affiliation_discount_source in ('empresa', 'membresia')
      and affiliation_discount_name_snapshot is not null
      and char_length(affiliation_discount_name_snapshot) <= 160
      and (affiliation_discount_rule_snapshot is null or char_length(affiliation_discount_rule_snapshot) <= 160)
      and (affiliation_discount_percent is null or affiliation_discount_percent between 0 and 100)
      and (affiliation_discount_amount_cents is null or affiliation_discount_amount_cents >= 0)
      and not (affiliation_discount_percent is not null and affiliation_discount_amount_cents is not null))
  );

create index if not exists quotes_partner_company_idx
  on public.quotes (partner_company_id) where partner_company_id is not null;
create index if not exists quotes_membership_plan_idx
  on public.quotes (membership_plan_id) where membership_plan_id is not null;

comment on column public.quotes.affiliation_discount_source is
  'Origen del descuento comercial propuesto al presupuestar a un afiliado: empresa con convenio o membresía. NULL = sin descuento de afiliación.';

commit;

-- Cómo revertir (los presupuestos conservan su descuento; solo se pierde el origen):
--
-- begin;
-- drop index if exists public.quotes_membership_plan_idx;
-- drop index if exists public.quotes_partner_company_idx;
-- alter table public.quotes drop constraint if exists quotes_affiliation_discount_consistente;
-- alter table public.quotes
--   drop column if exists membership_plan_id,
--   drop column if exists partner_company_id,
--   drop column if exists affiliation_discount_amount_cents,
--   drop column if exists affiliation_discount_percent,
--   drop column if exists affiliation_discount_rule_snapshot,
--   drop column if exists affiliation_discount_name_snapshot,
--   drop column if exists affiliation_discount_source;
-- commit;
