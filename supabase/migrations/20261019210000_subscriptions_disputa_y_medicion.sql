-- Auditoría 360 (18-oct-2026), pendientes de billing que dejó #69:
--
-- 1. Disputa (BIL-01 punto 4, BIL-02): `charge.dispute.created` ya no escribe
--    un `canceled` falso en la fila (no cancelaba nada en Stripe y el
--    siguiente `subscription.updated` lo volvía a pisar). Ahora la deja
--    MARCADA para revisión manual y avisa al staff. La marca no bloquea nada:
--    ni la ficha ni la agenda. `charge.dispute.closed` la limpia.
--
-- 2. Medición (`suscripcion_activada`, TODO de #68): el evento sale del
--    webhook (fuente confiable) y también de la vuelta del checkout (trae la
--    atribución de la visita). Para no contarlo dos veces, el primero que
--    llega reclama la suscripción en `activation_tracked_sub_id` con un
--    UPDATE condicional; el otro ve que ya está reclamada. Si el webhook ganó,
--    la vuelta del checkout le agrega su `session_hash` al evento que ya
--    existe (`activation_event_id`). `marketing_events` sigue sin ids de
--    clínica ni de suscripción en sus propiedades: el vínculo vive acá, en
--    una tabla que el staff ya puede leer.
--
-- Solo columnas nuevas, todas NULL. La tabla ya es de solo lectura para
-- `authenticated` (GRANT SELECT + policy de miembros): escribe solo el rol
-- de servicio. El código tolera que el archivo no esté aplicado: la marca de
-- disputa se reporta a Sentry y el aviso al staff sale igual; la medición
-- sigue como antes (solo desde la vuelta del checkout).

alter table public.subscriptions
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_id text,
  add column if not exists activation_tracked_sub_id text,
  add column if not exists activation_event_id bigint;

comment on column public.subscriptions.disputed_at is
  'Disputa (contracargo) abierta en Stripe: cuándo llegó charge.dispute.created. NULL si no hay disputa abierta. Solo marca para revisión manual; no bloquea el acceso.';
comment on column public.subscriptions.dispute_id is
  'Id de la disputa abierta en Stripe (dp_…). Lo limpia charge.dispute.closed.';
comment on column public.subscriptions.activation_tracked_sub_id is
  'Suscripción de Stripe por la que ya se registró el evento suscripcion_activada (dedupe entre el webhook y la vuelta del checkout).';
comment on column public.subscriptions.activation_event_id is
  'marketing_events.id del evento suscripcion_activada de esa suscripción (para sumarle la atribución de la vuelta del checkout).';
