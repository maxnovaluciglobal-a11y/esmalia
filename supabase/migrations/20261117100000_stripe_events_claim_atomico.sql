-- Webhook de Stripe: reclamo atómico del evento ANTES de aplicarlo (P1 de la
-- transferencia, 28-oct-2026).
--
-- Antes el handler hacía SELECT en `stripe_events`, aplicaba el evento y recién
-- después insertaba la marca. Dos entregas simultáneas del mismo `event.id`
-- pasaban las dos el SELECT y aplicaban los efectos dos veces (hoy seguro por
-- diseño, porque cada efecto es idempotente, pero es una condición de carrera
-- en la ruta del dinero).
--
-- Ahora `claim_stripe_event` hace `INSERT … ON CONFLICT` en un solo
-- statement: de N llamadas simultáneas exactamente una recibe `claimed`.
--   · 'claimed'     → esta entrega aplica el evento y luego marca `processed_at`.
--   · 'duplicate'   → ya se procesó (processed_at no es null): 200 sin tocar nada.
--   · 'in_progress' → otra entrega lo tiene reclamado y el plazo no venció: 409
--                     (Stripe reintenta).
-- Si la función de Vercel se corta con el evento reclamado y sin marcar, el
-- reclamo vence a los `p_lease_seconds` y otra entrega lo retoma.
--
-- Compatible hacia atrás: solo agrega dos columnas nulas y una función. Las filas
-- existentes se marcan como procesadas (hasta hoy una fila solo existía si el
-- evento se había aplicado bien).
--
-- ORDEN DE DESPLIEGUE: aplicar esta migración ANTES de mergear el código que
-- llama a `claim_stripe_event`. Si el código llega primero, el webhook responde
-- 500 (Stripe reintenta durante días) hasta que se aplique.
--
-- Reversa al pie.

begin;

alter table public.stripe_events
  add column if not exists claimed_at timestamptz,
  add column if not exists processed_at timestamptz;

update public.stripe_events
   set processed_at = received_at
 where processed_at is null;

create or replace function public.claim_stripe_event(
  p_id text,
  p_type text,
  p_raw jsonb,
  p_lease_seconds integer default 300
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  insert into public.stripe_events (id, type, raw, claimed_at)
  values (p_id, p_type, p_raw, now())
  on conflict (id) do nothing;
  if found then
    return 'claimed';
  end if;

  -- Ya existía. Si quedó reclamado y sin marcar más allá del plazo (la entrega
  -- anterior se cortó), se retoma. El UPDATE toma el candado de la fila: de dos
  -- que lo intenten a la vez, el segundo reevalúa el WHERE ya con el claimed_at
  -- nuevo y no actualiza nada.
  update public.stripe_events
     set claimed_at = now()
   where id = p_id
     and processed_at is null
     and coalesce(claimed_at, received_at) < now() - make_interval(secs => p_lease_seconds);
  if found then
    return 'claimed';
  end if;

  if exists (select 1 from public.stripe_events where id = p_id and processed_at is not null) then
    return 'duplicate';
  end if;
  return 'in_progress';
end;
$$;

-- Solo el webhook (service_role). `security invoker`: no eleva privilegios.
revoke all on function public.claim_stripe_event(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text, jsonb, integer) to service_role;

commit;

-- Reversa:
--   begin;
--   drop function if exists public.claim_stripe_event(text, text, jsonb, integer);
--   alter table public.stripe_events drop column if exists claimed_at, drop column if exists processed_at;
--   commit;
-- (Con el código nuevo desplegado, revertir primero el código.)
