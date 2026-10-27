-- Ola 10 · frente A (3/4): folio de la boleta o factura emitida afuera (FIN-15).
--
-- Esmalia no emite documentos tributarios (la emisión por API depende de un
-- proveedor SII, plan maestro "Con dependencia externa"). Mientras tanto la
-- clínica emite la boleta en el portal del SII u otro sistema y acá anota el
-- tipo y el número contra el pago, para cuadrar con el contador.
--
--   - `payment_receipts`: un documento por pago (tipo, folio, fecha de emisión,
--     quién lo emitió). Se puede corregir o borrar si se anotó mal: es una
--     anotación, no el documento tributario.
--
-- Permisos: el mismo público que lee y cobra (`receivables`): owner, admin,
-- dentist, reception y accounting. Assistant no ve dinero (regla 2). Política
-- RESTRICTIVE `mfa_exige_aal2`.
--
-- Compatible con el código en producción: tabla y trigger nuevos.

begin;

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  doc_type text not null check (doc_type in (
    'boleta', 'boleta_exenta', 'factura', 'factura_exenta', 'boleta_honorarios', 'otro'
  )),
  folio text not null check (char_length(btrim(folio)) between 1 and 40),
  issued_on date not null,
  -- Dónde se emitió: "SII", el nombre del sistema de facturación, etc.
  issuer text not null default 'SII' check (char_length(btrim(issuer)) between 1 and 60),
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un documento por pago. Un cobro con varios medios (payment_group_id) se
  -- anota en cada fila con el mismo folio.
  unique (payment_id)
);

comment on table public.payment_receipts is
  'Folio de la boleta o factura emitida fuera de Esmalia (SII u otro sistema) para un pago (FIN-15). No integra con el SII.';

create index payment_receipts_clinic_folio_idx on public.payment_receipts (clinic_id, folio);

create trigger payment_receipts_updated_at before update on public.payment_receipts
  for each row execute function public.set_updated_at();
create trigger block_demo_writes
  before insert or update or delete on public.payment_receipts
  for each row execute function public.block_demo_writes();

-- El pago tiene que ser de la misma clínica; el pago no cambia después.
create or replace function public.validar_pago_del_folio()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.payment_id is distinct from old.payment_id
                           or new.clinic_id is distinct from old.clinic_id) then
    raise exception 'El folio no se mueve a otro pago: bórralo y anótalo en el correcto.'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.payments p
     where p.id = new.payment_id and p.clinic_id = new.clinic_id
  ) then
    raise exception 'El pago no existe en esta clínica.' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke execute on function public.validar_pago_del_folio() from public, anon;

create trigger payment_receipts_validar_pago
  before insert or update on public.payment_receipts
  for each row execute function public.validar_pago_del_folio();

grant select, insert, update, delete on public.payment_receipts to authenticated;
revoke truncate on public.payment_receipts from anon, authenticated;
grant all on public.payment_receipts to service_role;
alter table public.payment_receipts enable row level security;

create policy payment_receipts_select_staff on public.payment_receipts
  for select to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy payment_receipts_insert_staff on public.payment_receipts
  for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[])
    and created_by = (select auth.uid())
  );
create policy payment_receipts_update_staff on public.payment_receipts
  for update to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]))
  with check (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));
create policy payment_receipts_delete_staff on public.payment_receipts
  for delete to authenticated
  using (public.has_clinic_role(clinic_id, array['owner','admin','dentist','reception','accounting']::public.app_role[]));

drop policy if exists mfa_exige_aal2 on public.payment_receipts;
create policy mfa_exige_aal2 on public.payment_receipts
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

commit;

-- Cómo revertir (se pierden los folios anotados; los pagos no cambian):
--
-- begin;
-- drop policy if exists mfa_exige_aal2 on public.payment_receipts;
-- drop table if exists public.payment_receipts;
-- drop function if exists public.validar_pago_del_folio();
-- commit;
