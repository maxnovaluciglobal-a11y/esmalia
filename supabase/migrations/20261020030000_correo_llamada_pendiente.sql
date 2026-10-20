-- Correo "llamada de puesta en marcha pendiente" (20-oct-2026).
--
-- Suma el kind 'onboarding_call_pending' a `lifecycle_emails`: un aviso a la
-- CLÍNICA (dueños y administradores, nunca pacientes) cuando pasaron 24 h
-- desde el alta y sigue en prueba sin la llamada de puesta en marcha. Sale
-- una sola vez por destinatario (period_key = 'once'). Regla y texto en
-- `docs/CORREOS.md`.
--
-- Solo cambia el CHECK de `kind`: se conservan los seis valores que ya
-- existían y se agrega el nuevo. Es compatible con el código en producción
-- (que nunca escribe el valor nuevo) y no toca datos. Sin tabla nueva:
-- `scripts/backup-tables.mjs` no cambia.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT dentro de una sola
-- transacción, así que correrla dos veces deja lo mismo y un error a mitad no
-- deja la tabla sin CHECK.
--
-- Cómo revertir (solo si no hay filas con el kind nuevo; si las hay, borrarlas
-- antes o el ADD falla):
--   BEGIN;
--   ALTER TABLE public.lifecycle_emails DROP CONSTRAINT IF EXISTS lifecycle_emails_kind_check;
--   ALTER TABLE public.lifecycle_emails ADD CONSTRAINT lifecycle_emails_kind_check CHECK (
--     kind IN ('welcome','trial_t3','trial_t0','subscription_active','payment_failed','weekly_report')
--   );
--   COMMIT;

BEGIN;

ALTER TABLE public.lifecycle_emails
  DROP CONSTRAINT IF EXISTS lifecycle_emails_kind_check;

ALTER TABLE public.lifecycle_emails
  ADD CONSTRAINT lifecycle_emails_kind_check CHECK (
    kind IN (
      'welcome',
      'trial_t3',
      'trial_t0',
      'subscription_active',
      'payment_failed',
      'weekly_report',
      'onboarding_call_pending'
    )
  );

COMMIT;
