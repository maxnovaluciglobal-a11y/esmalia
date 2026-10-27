-- Ola 8 · frente A · PAC-08: valor histórico (LTV) por paciente.
--
-- Cuánto le ha pagado cada paciente a la clínica en total: suma de
-- `payments.amount_cents` no reversados (en cents, la moneda de la clínica),
-- con la cantidad de pagos y las fechas del primero y del último.
--
-- Por qué SECURITY DEFINER y no INVOKER como `patient_balances`: la RLS de
-- `payments` deja leer a dentist y reception (cobran en la caja), pero el
-- valor histórico es un dato financiero de `finance:view` (owner, admin y
-- accounting; regla 15). La función revisa el rol y, si no corresponde,
-- falla con 42501 en vez de devolver cifras. También exige aal2 a quien
-- activó MFA (la política `mfa_exige_aal2` de `payments` no corre dentro de
-- una función DEFINER). Sin EXECUTE para PUBLIC ni anon.
--
-- Solo lectura: no escribe datos ni redefine funciones existentes.

create or replace function public.patient_lifetime_values(
  p_clinic_id uuid,
  p_patient_ids uuid[] default null
)
returns table (
  patient_id uuid,
  paid_cents bigint,
  payments_count integer,
  first_paid_at timestamptz,
  last_paid_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  if not public.sesion_cumple_mfa() then
    raise exception 'Necesitas verificar tu segundo factor para ver esto.' using errcode = '42501';
  end if;
  if not public.has_clinic_role(
    p_clinic_id, array['owner','admin','accounting']::public.app_role[]
  ) then
    raise exception 'No tienes permisos para ver el valor histórico de los pacientes.'
      using errcode = '42501';
  end if;

  return query
    select pa.patient_id,
           sum(coalesce(pa.amount_cents, 0))::bigint,
           count(*)::integer,
           min(pa.paid_at),
           max(pa.paid_at)
      from public.payments pa
     where pa.clinic_id = p_clinic_id
       and pa.reversed_at is null
       and pa.patient_id is not null
       and (p_patient_ids is null or pa.patient_id = any (p_patient_ids))
     group by pa.patient_id;
end;
$$;

comment on function public.patient_lifetime_values(uuid, uuid[]) is
  'PAC-08: total pagado (no reversado) por paciente. Solo owner/admin/accounting (finance:view); aal2 si hay MFA.';

revoke all on function public.patient_lifetime_values(uuid, uuid[]) from public, anon;
grant execute on function public.patient_lifetime_values(uuid, uuid[]) to authenticated, service_role;


-- ── Reversa ───────────────────────────────────────────────────────────────
-- drop function if exists public.patient_lifetime_values(uuid, uuid[]);
