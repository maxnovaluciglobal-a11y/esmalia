-- Ola 3 · Frente Arancel: bono Fonasa / isapre con copago (MKT-03).
--
-- En Chile, una prestación pagada con bono se cobra en dos partes: el bono
-- (Fonasa Modalidad Libre Elección, un PAD dental de Fonasa o una isapre),
-- que la clínica después cobra al asegurador, y el copago que paga el
-- paciente en el momento. Es registro manual: no hay integración con IMED
-- ni con Fonasa.
--
-- Cada parte es un pago normal en `payments` (así el saldo del paciente, la
-- caja y los reportes los suman sin cambiar nada): la del bono con medio
-- "otro" y el nombre del bono como snapshot, y la del copago con el medio
-- que use el paciente. Las dos comparten `coverage_group_id` y llevan el
-- desglose congelado: precio de la prestación, monto del bono y copago.
-- copago = precio - bono; en un PAD, precio y copago son fijos del paquete.
--
-- Por qué columnas y no una tabla aparte: `payments` ya tiene la RLS que
-- excluye a assistant (regla 2) y la política aal2 de MFA. Una tabla nueva
-- de dinero tendría que repetir ambas.
--
-- Compatible con el código en producción (RUNBOOK regla 3): solo columnas
-- nullable con CHECK. Los pagos existentes quedan con todo en NULL. Reversa
-- al pie.

begin;

alter table public.payments
  add column if not exists coverage_group_id uuid,
  add column if not exists coverage_kind text
    check (coverage_kind in ('fonasa_mle', 'fonasa_pad', 'isapre')),
  add column if not exists coverage_role text
    check (coverage_role in ('bono', 'copago')),
  add column if not exists voucher_number text
    check (voucher_number is null or char_length(voucher_number) between 1 and 40),
  add column if not exists coverage_insurer text
    check (coverage_insurer is null or char_length(coverage_insurer) between 1 and 80),
  add column if not exists coverage_tier text
    check (coverage_tier in ('A', 'B', 'C', 'D')),
  add column if not exists coverage_price_cents bigint
    check (coverage_price_cents is null or coverage_price_cents > 0),
  add column if not exists voucher_cents bigint
    check (voucher_cents is null or voucher_cents > 0);

-- Coherencia del desglose: o el pago no es de un bono (todo NULL), o trae
-- tipo, rol, grupo, precio y bono, con bono <= precio. El copago no se
-- guarda: es precio - bono, y en la fila del copago es su propio monto.
alter table public.payments drop constraint if exists payments_bono_coherente;
alter table public.payments
  add constraint payments_bono_coherente check (
    (
      coverage_kind is null and coverage_role is null and coverage_group_id is null
      and coverage_price_cents is null and voucher_cents is null
    )
    or (
      coverage_kind is not null and coverage_role is not null
      and coverage_group_id is not null
      and coverage_price_cents is not null and voucher_cents is not null
      and voucher_cents <= coverage_price_cents
      and (coverage_role <> 'bono' or amount_cents = voucher_cents)
      and (coverage_role <> 'copago' or amount_cents = coverage_price_cents - voucher_cents)
    )
  );

comment on column public.payments.coverage_group_id is
  'MKT-03: une la fila del bono y la del copago de un mismo cobro. NULL = pago sin bono.';
comment on column public.payments.coverage_kind is
  'MKT-03: fonasa_mle (bono Modalidad Libre Elección), fonasa_pad (PAD dental) o isapre.';
comment on column public.payments.coverage_role is
  'MKT-03: bono = parte que paga el asegurador; copago = parte que paga el paciente.';
comment on column public.payments.voucher_number is
  'MKT-03: número del bono, tal como lo emite Fonasa o la isapre.';
comment on column public.payments.coverage_insurer is
  'MKT-03: nombre de la isapre (o Fonasa) que emitió el bono.';
comment on column public.payments.coverage_tier is
  'MKT-03: tramo Fonasa del paciente al cobrar (A-D).';
comment on column public.payments.coverage_price_cents is
  'MKT-03: precio de la prestación al cobrar, congelado. copago = precio - bono.';
comment on column public.payments.voucher_cents is
  'MKT-03: monto que cubre el bono, congelado.';

create index if not exists payments_coverage_group_idx
  on public.payments (clinic_id, coverage_group_id)
  where coverage_group_id is not null;

commit;

-- Cómo revertir:
-- drop index if exists public.payments_coverage_group_idx;
-- alter table public.payments drop constraint if exists payments_bono_coherente;
-- alter table public.payments
--   drop column if exists voucher_cents, drop column if exists coverage_price_cents,
--   drop column if exists coverage_tier, drop column if exists coverage_insurer,
--   drop column if exists voucher_number, drop column if exists coverage_role,
--   drop column if exists coverage_kind, drop column if exists coverage_group_id;
-- (Los pagos de bonos ya registrados siguen siendo pagos válidos: solo se
-- pierde el desglose.)
