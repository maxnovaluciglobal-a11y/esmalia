-- SEG-01 (MFA), revisión del PR #65: la cuenta de la demo pública
-- (demo@esmalia.com) es compartida y su contraseña está publicada en /demo.
-- La UI no deja activarle la verificación en dos pasos, pero cualquiera con
-- la clave pública puede llamar `supabase.auth.mfa.enroll` +
-- `challengeAndVerify` desde la consola. Un factor ahí le pediría un código
-- que solo tiene esa persona a todos los demás visitantes.
--
-- Mismo patrón que `bloquear_cambios_cuenta_demo` (20261013000200): un
-- trigger en el esquema auth que solo frena lo que llega por GoTrue (rol
-- supabase_auth_admin). Además se borran los factores que ya existan. Borrar
-- no se bloquea: así el reset (`/api/demo-reset`) también puede limpiarlos.
--
-- ⚠️ NO APLICADA. Requiere OK de Walter (regla 5 del CLAUDE.md del repo).

create or replace function public.bloquear_mfa_cuenta_demo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from auth.users u
     where u.id = new.user_id
       and lower(coalesce(u.email, '')) = 'demo@esmalia.com'
  ) then
    raise exception 'La cuenta de la demo no admite verificación en dos pasos.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.bloquear_mfa_cuenta_demo() from public, anon, authenticated;

drop trigger if exists bloquear_mfa_cuenta_demo on auth.mfa_factors;
create trigger bloquear_mfa_cuenta_demo
  before insert on auth.mfa_factors
  for each row
  execute function public.bloquear_mfa_cuenta_demo();

-- Limpieza de lo que ya exista (los challenges caen en cascada).
delete from auth.mfa_factors f
 using auth.users u
 where f.user_id = u.id
   and lower(coalesce(u.email, '')) = 'demo@esmalia.com';
