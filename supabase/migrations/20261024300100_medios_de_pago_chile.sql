-- Ola 3 · Frente Cobros (2/3): medios de pago de Chile (FIN-07).
--
-- `payment_methods` ya es configurable por clínica (G-6, 20260904120000), pero
-- solo sabe de los cinco valores del enum viejo: un cheque, un pago con
-- Redcompra o un bono Fonasa terminaban como "Otro" y nadie podía filtrar por
-- ellos. Esta migración agrega el TIPO de medio (`kind`) y siembra los medios
-- habituales en Chile:
--
--   efectivo, débito, crédito, transferencia (ya existían) + cheque,
--   Redcompra, convenio y "Bono Fonasa / isapre".
--
-- `kind` no reemplaza a `legacy_key`: `legacy_key` sigue siendo el puente 1 a
-- 1 con uno de los cinco medios originales (la demo y el histórico lo usan
-- para unir pagos con su medio). Los medios nuevos quedan con `legacy_key`
-- NULL a propósito: si Redcompra tuviera `legacy_key = 'debit_card'`, habría
-- dos medios para el mismo valor del enum y cualquier join por esa columna
-- duplicaría filas. El valor del enum que se guarda en `payments.method` para
-- un medio nuevo sale de `kind` (src/lib/finance/medios-de-pago.ts): Redcompra
-- cuenta como débito, cheque/convenio/bono como "otro". Solo el efectivo entra
-- al arqueo del cajón, como hasta ahora.
--
-- Bono: el registro del bono (folio, prestación, monto bonificado) lo hace el
-- frente Arancel. Acá solo existe el medio genérico "Bono Fonasa / isapre"
-- (`kind = 'voucher'`) para que lo cobrado con un bono se pueda registrar y
-- reconciliar ya; el frente Arancel puede enlazar su registro al pago o
-- crear medios más específicos con el mismo `kind`.
--
-- Compatible con el código en producción: columna nullable, backfill que no
-- toca `legacy_key` ni ningún pago, y la función de siembra con la misma
-- firma. Sin integración con Webpay ni MercadoPago (dependencia externa).

begin;

alter table public.payment_methods
  add column kind text
    check (kind is null or kind in (
      'cash', 'debit', 'credit', 'transfer', 'check', 'redcompra', 'agreement', 'voucher', 'other'
    ));

comment on column public.payment_methods.kind is
  'Tipo de medio (FIN-07): cash, debit, credit, transfer, check, redcompra, agreement, voucher (bono), other. NULL = medio propio sin tipo (cuenta como otro).';

-- Los cinco medios sembrados por clínica: su tipo sale del enum que ya tienen.
update public.payment_methods
   set kind = case legacy_key
                when 'cash' then 'cash'
                when 'debit_card' then 'debit'
                when 'credit_card' then 'credit'
                when 'transfer' then 'transfer'
                else 'other'
              end
 where kind is null
   and legacy_key is not null;

-- Siembra de cada clínica nueva: los cinco de siempre (con su tipo) y, en
-- Chile, los cuatro propios del país. Misma firma y mismo trigger que antes.
CREATE OR REPLACE FUNCTION public.seed_clinic_payment_methods()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.payment_methods
    (clinic_id, name, retention_pct, allows_refund, position, legacy_key, kind)
  VALUES
    (NEW.id, 'Efectivo',            0,    true,  0, 'cash',        'cash'),
    (NEW.id, 'Transferencia',       0,    true,  1, 'transfer',    'transfer'),
    (NEW.id, 'Tarjeta de débito',   0,    false, 2, 'debit_card',  'debit'),
    (NEW.id, 'Tarjeta de crédito',  0,    false, 3, 'credit_card', 'credit'),
    (NEW.id, 'Otro',                0,    false, 4, 'other',       'other')
  ON CONFLICT (clinic_id, name) DO NOTHING;

  IF upper(coalesce(NEW.country, '')) = 'CL' THEN
    INSERT INTO public.payment_methods
      (clinic_id, name, retention_pct, allows_refund, position, legacy_key, kind)
    VALUES
      (NEW.id, 'Cheque',               0, false, 5, NULL, 'check'),
      (NEW.id, 'Redcompra',            0, false, 6, NULL, 'redcompra'),
      (NEW.id, 'Convenio',             0, false, 7, NULL, 'agreement'),
      (NEW.id, 'Bono Fonasa / isapre', 0, false, 8, NULL, 'voucher')
    ON CONFLICT (clinic_id, name) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

revoke execute on function public.seed_clinic_payment_methods() from public, anon;

-- Clínicas de Chile que ya existen. ON CONFLICT: si la clínica ya había
-- creado un "Cheque" propio, se respeta el suyo.
insert into public.payment_methods
  (clinic_id, name, retention_pct, allows_refund, position, legacy_key, kind)
select c.id, m.name, 0, false, m.position, null, m.kind
  from public.clinics c
 cross join (values
   ('Cheque',               5::smallint, 'check'),
   ('Redcompra',            6::smallint, 'redcompra'),
   ('Convenio',             7::smallint, 'agreement'),
   ('Bono Fonasa / isapre', 8::smallint, 'voucher')
 ) as m(name, position, kind)
 where upper(coalesce(c.country, '')) = 'CL'
on conflict (clinic_id, name) do nothing;

commit;

-- Cómo revertir (los medios sembrados no tienen pagos al momento de aplicar;
-- si ya se usaron, NO borrarlos: basta con deshabilitarlos, is_active = false):
--
-- begin;
-- delete from public.payment_methods pm
--  where pm.legacy_key is null
--    and pm.name in ('Cheque', 'Redcompra', 'Convenio', 'Bono Fonasa / isapre')
--    and not exists (select 1 from public.payments p where p.payment_method_id = pm.id)
--    and not exists (select 1 from public.expenses e where e.payment_method_id = pm.id);
-- (seed_clinic_payment_methods: volver a aplicar su definición de 20260904120000_arancel_medios_pago_y_gastos.sql)
-- alter table public.payment_methods drop column if exists kind;
-- commit;
