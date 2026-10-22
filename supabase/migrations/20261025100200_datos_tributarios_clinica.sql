-- Ola 4 · Frente Motor de plantillas y documentos (3/3): FIN-16, datos
-- tributarios de la clínica.
--
-- Razón social (`legal_name`) y RUT de la empresa (`tax_id`) ya existían. Se
-- suman giro, dirección y comuna tributarias y el tipo de boleta que emite
-- (exenta o afecta). Son solo datos para los documentos (variables
-- {{clinica.razon_social}}, {{clinica.rut}}, {{clinica.giro}}…): no hay
-- integración con el SII ni se emite ningún documento tributario.
--
-- El RUT de una clínica de Chile se valida con `rut_es_valido` (migración
-- 20261022100000) por trigger y SOLO cuando se edita: un CHECK, aunque fuera
-- NOT VALID, se revisaría en cualquier UPDATE de la fila, y una clínica que ya
-- tiene un RUT mal escrito no podría ni cambiar su nombre. El alta de una
-- clínica (onboarding) no pasa por acá: el código en producción no valida el
-- RUT al crearla, y rechazar ese INSERT rompería el alta.
--
-- Compatible con el código en producción: columnas nullable y un trigger que
-- solo actúa cuando tax_id cambia en una clínica de Chile. Reversa al pie.

begin;

alter table public.clinics
  add column if not exists business_activity text,
  add column if not exists tax_address text,
  add column if not exists tax_commune text,
  add column if not exists tax_receipt_kind text;

alter table public.clinics drop constraint if exists clinics_business_activity_check;
alter table public.clinics
  add constraint clinics_business_activity_check
  check (business_activity is null or char_length(business_activity) <= 160);
alter table public.clinics drop constraint if exists clinics_tax_address_check;
alter table public.clinics
  add constraint clinics_tax_address_check
  check (tax_address is null or char_length(tax_address) <= 200);
alter table public.clinics drop constraint if exists clinics_tax_commune_check;
alter table public.clinics
  add constraint clinics_tax_commune_check
  check (tax_commune is null or char_length(tax_commune) <= 80);
alter table public.clinics drop constraint if exists clinics_tax_receipt_kind_check;
alter table public.clinics
  add constraint clinics_tax_receipt_kind_check
  check (tax_receipt_kind is null or tax_receipt_kind in ('exenta', 'afecta'));

comment on column public.clinics.business_activity is 'FIN-16: giro de la empresa (texto libre). Solo para documentos.';
comment on column public.clinics.tax_address is 'FIN-16: dirección tributaria (casa matriz).';
comment on column public.clinics.tax_commune is 'FIN-16: comuna de la dirección tributaria.';
comment on column public.clinics.tax_receipt_kind is 'FIN-16: boleta que emite la clínica: exenta o afecta. Sin integración con el SII.';

create or replace function public.clinics_validar_rut_empresa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tax_id is not null
     and new.tax_id is distinct from old.tax_id
     and upper(coalesce(new.country, '')) = 'CL'
     and not public.rut_es_valido(new.tax_id)
  then
    raise exception 'El RUT de la empresa no es válido: revisa los números y el dígito verificador.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.clinics_validar_rut_empresa() from public, anon, authenticated;

drop trigger if exists clinics_validar_rut_empresa on public.clinics;
create trigger clinics_validar_rut_empresa
  before update of tax_id on public.clinics
  for each row execute function public.clinics_validar_rut_empresa();

commit;

-- Cómo revertir:
--
-- begin;
-- drop trigger if exists clinics_validar_rut_empresa on public.clinics;
-- drop function if exists public.clinics_validar_rut_empresa();
-- alter table public.clinics
--   drop constraint if exists clinics_tax_receipt_kind_check,
--   drop constraint if exists clinics_tax_commune_check,
--   drop constraint if exists clinics_tax_address_check,
--   drop constraint if exists clinics_business_activity_check,
--   drop column if exists tax_receipt_kind,
--   drop column if exists tax_commune,
--   drop column if exists tax_address,
--   drop column if exists business_activity;
-- commit;
