-- Extender la prueba de una clínica (clínicas fundadoras / pilotos, 20-oct-2026).
--
-- Hasta hoy la prueba eran 14 días fijos (trigger `crear_trial_de_la_clinica`) y
-- no había forma de dar más sin editar la base a mano y sin dejar rastro. La
-- oferta de clínicas fundadoras promete 3 meses gratis desde la puesta en
-- marcha: esta migración da el mecanismo y el registro de quién lo hizo y cuándo.
--
-- Qué hace `extender_prueba_de_la_clinica`:
--   * Solo extiende una prueba de la base: `status = 'trialing'` y SIN
--     suscripción en Stripe (si ya pasó por el checkout, el calendario lo lleva
--     Stripe y tocar la fila local lo desincronizaría).
--   * El nuevo fin es `now() + p_dias` y tiene que ser POSTERIOR al actual: acá
--     solo se extiende, nunca se acorta.
--   * Registra el cambio en `trial_extensions` en la misma transacción que el
--     UPDATE: no puede quedar una extensión sin registro ni un registro falso.
--   * Bloquea la fila (`FOR UPDATE`) para que dos clics seguidos no se pisen.
--
-- Efectos conocidos, ya cubiertos por el código:
--   * Los avisos T-3 y T-0 de `lifecycle_emails` usan la fecha local de fin de
--     prueba como `period_key`: al cambiar la fecha salen en la fecha nueva.
--   * El checkout de Stripe toma el `trial_end` de esta fila (`trialDelCheckout`):
--     si la clínica se suscribe antes, no se le cobra hasta que termine.
--
-- Acceso: solo el rol de servicio (la pantalla /admin/clinicas, ya filtrada por
-- la allowlist de staff y MFA). RLS activa y SIN políticas en la tabla; la
-- función no es ejecutable ni por `anon` ni por `authenticated`.

CREATE TABLE IF NOT EXISTS public.trial_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  previous_trial_end timestamptz NOT NULL,
  new_trial_end timestamptz NOT NULL,
  days integer NOT NULL CHECK (days BETWEEN 1 AND 120),
  reason text CHECK (reason IS NULL OR length(reason) <= 200),
  -- Quién la dio. NULL si la cuenta se borró después: el registro sobrevive a
  -- la persona, por eso también se guarda el correo.
  extended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extended_by_email text NOT NULL CHECK (extended_by_email = lower(extended_by_email)),
  extended_at timestamptz NOT NULL DEFAULT now(),
  CHECK (new_trial_end > previous_trial_end)
);

CREATE INDEX IF NOT EXISTS trial_extensions_clinic_idx
  ON public.trial_extensions (clinic_id, extended_at DESC);

ALTER TABLE public.trial_extensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_extensions FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.trial_extensions IS
  'Cada vez que el staff de Esmalia extiende la prueba de una clínica: fin anterior y nuevo, quién y cuándo. Solo rol de servicio.';

CREATE OR REPLACE FUNCTION public.extender_prueba_de_la_clinica(
  p_clinic_id uuid,
  p_dias integer,
  p_actor_id uuid,
  p_actor_email text,
  p_motivo text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_nuevo timestamptz;
BEGIN
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 120 THEN
    RAISE EXCEPTION 'dias_invalidos';
  END IF;

  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE clinic_id = p_clinic_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin_prueba';
  END IF;
  IF v_sub.status <> 'trialing' OR v_sub.stripe_subscription_id IS NOT NULL OR v_sub.trial_end IS NULL THEN
    RAISE EXCEPTION 'no_es_prueba_de_la_base';
  END IF;

  v_nuevo := now() + make_interval(days => p_dias);
  IF v_nuevo <= v_sub.trial_end THEN
    RAISE EXCEPTION 'no_extiende';
  END IF;

  INSERT INTO public.trial_extensions (
    clinic_id, previous_trial_end, new_trial_end, days, reason, extended_by, extended_by_email
  ) VALUES (
    p_clinic_id, v_sub.trial_end, v_nuevo, p_dias, nullif(btrim(p_motivo), ''), p_actor_id, lower(p_actor_email)
  );

  UPDATE public.subscriptions
  SET trial_end = v_nuevo
  WHERE clinic_id = p_clinic_id;

  RETURN v_nuevo;
END;
$$;

REVOKE ALL ON FUNCTION public.extender_prueba_de_la_clinica(uuid, integer, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extender_prueba_de_la_clinica(uuid, integer, uuid, text, text)
  TO service_role;

-- Cómo revertir:
--   DROP FUNCTION public.extender_prueba_de_la_clinica(uuid, integer, uuid, text, text);
--   DROP TABLE public.trial_extensions;
-- (Las fechas de `subscriptions.trial_end` ya extendidas quedan como están; para
-- devolver una, UPDATE manual con el `previous_trial_end` de la tabla antes de borrarla.)
