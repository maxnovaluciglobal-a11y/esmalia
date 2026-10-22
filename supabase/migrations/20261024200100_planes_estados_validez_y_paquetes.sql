-- Ola 3 · Frente Planes: estados, historial, validez, seguimiento y paquetes.
--
-- IDs del plan maestro que cubre esta migración:
--   PLA-02  seis estados con transiciones claras y quién/cuándo
--           (usa 'partially_accepted', que agrega 20261024200000: aplicar esa
--           primero).
--   PLA-03  pestaña Historial del detalle del plan → `quote_events`.
--   PLA-06  validez: días por defecto por clínica, vencimiento automático.
--   PLA-12  paquetes de prestaciones del arancel.
--   UX-16   seguimiento (último contacto, próxima acción) y profesional del
--           presupuesto, para la vista global /presupuestos.
-- PLA-04 (secciones) y PLA-05 (descuento en %) ya tenían columnas desde
-- 20260903120000 (`phase_label`, `phase_position`, `discount_pct`,
-- `commercial_discount_pct`): esta migración no las toca.
--
-- ── Compatibilidad con el código en producción (RUNBOOK regla 3) ─────────
-- Todo es aditivo: columnas nullable (o con default), tablas nuevas, triggers
-- y funciones nuevas. El código viejo:
--   * no lee ni escribe las columnas nuevas;
--   * solo cambia estados por caminos que el guard de transiciones permite
--     (borrador/enviado → aceptado/rechazado, ver `validar_transicion_de_
--     presupuesto` más abajo);
--   * acepta presupuestos igual que siempre: el trigger de conversión
--     mantiene el comportamiento de la aceptación total (plan con todas las
--     líneas y estado final 'converted').
-- Ningún presupuesto existente cambia de estado al aplicar: los que tienen
-- `valid_until` vencido recién pasan a 'expired' cuando corre
-- `vencer_presupuestos()` (la llama la app al listar y el cron horario).
--
-- ── Punto de enganche para el frente Cobros (PLA-07) ─────────────────────
-- El paso a "aceptado" ocurre en UN solo lugar: el trigger BEFORE UPDATE
-- `quote_accept_creates_plan` → `convert_accepted_quote_to_plan()`, para la
-- aceptación total ('accepted', que termina en 'converted') y la parcial
-- ('partially_accepted'). Ahí se crea el `treatment_plans` con las líneas
-- aceptadas y se fija `quotes.accepted_total_cents`. Después, el trigger
-- AFTER de esta migración deja la fila en `quote_events` (kind 'estado',
-- to_status 'converted' o 'partially_accepted'). Para crear la cuenta por
-- cobrar alcanza con un trigger AFTER INSERT en `treatment_plans` con
-- `quote_id IS NOT NULL` (o en `quote_events` con esos dos to_status), sin
-- redefinir esta función.

-- ═══ 1 · Validez por defecto por clínica (PLA-06) ═══════════════════════════
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS quote_validity_days smallint NOT NULL DEFAULT 30
    CHECK (quote_validity_days BETWEEN 1 AND 365);

COMMENT ON COLUMN public.clinics.quote_validity_days IS
  'Días de validez por defecto de un presupuesto nuevo (valid_until = hoy de la clínica + N).';

-- ═══ 2 · Columnas nuevas de quotes ══════════════════════════════════════════
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS professional_id uuid
    REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_total_cents bigint
    CHECK (accepted_total_cents IS NULL OR accepted_total_cents >= 0),
  ADD COLUMN IF NOT EXISTS rejection_reason text
    CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_note text
    CHECK (last_contact_note IS NULL OR char_length(last_contact_note) <= 500),
  ADD COLUMN IF NOT EXISTS next_action text
    CHECK (next_action IS NULL OR char_length(next_action) <= 200),
  ADD COLUMN IF NOT EXISTS next_action_on date;

COMMENT ON COLUMN public.quotes.professional_id IS
  'Profesional a cargo del presupuesto (filtro de /presupuestos). NULL = sin asignar.';
COMMENT ON COLUMN public.quotes.accepted_total_cents IS
  'Monto aceptado: el total en una aceptación total, la suma de las líneas aceptadas en una parcial. NULL = no aceptado.';
COMMENT ON COLUMN public.quotes.rejection_reason IS
  'Motivo del rechazo que dio el paciente. NULL = sin motivo o no rechazado.';
COMMENT ON COLUMN public.quotes.last_contact_at IS
  'Último contacto registrado a mano en el seguimiento. Los mensajes con quote_id cuentan aparte.';
COMMENT ON COLUMN public.quotes.next_action IS
  'Próxima acción del seguimiento ("Llamar", "Esperar confirmación de la isapre").';

CREATE INDEX IF NOT EXISTS quotes_clinic_professional_idx
  ON public.quotes (clinic_id, professional_id)
  WHERE professional_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quotes_clinic_valid_until_idx
  ON public.quotes (clinic_id, valid_until)
  WHERE status IN ('draft', 'sent') AND valid_until IS NOT NULL;

-- El profesional tiene que ser de la misma clínica. La FK sola no alcanza:
-- su verificación ignora RLS, así que se podría colgar un presupuesto de un
-- profesional de otra clínica conociendo su id. Sin SECURITY DEFINER: todo
-- miembro puede leer `professionals` de su clínica.
CREATE OR REPLACE FUNCTION public.validar_profesional_de_presupuesto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.professional_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.professionals p
     WHERE p.id = NEW.professional_id AND p.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'El profesional no corresponde a esta clínica.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_validar_profesional ON public.quotes;
CREATE TRIGGER quotes_validar_profesional
  BEFORE INSERT OR UPDATE OF professional_id, clinic_id ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_profesional_de_presupuesto();

REVOKE EXECUTE ON FUNCTION public.validar_profesional_de_presupuesto()
  FROM PUBLIC, anon, authenticated;

-- ═══ 3 · Paquetes de prestaciones (PLA-12) ══════════════════════════════════
-- Un paquete es un combo de prestaciones del arancel con un precio cerrado.
-- Al sumarlo a un presupuesto se copian sus líneas (snapshot, regla 10): lo
-- que se cotizó no cambia si después se edita o se borra el paquete.
CREATE TABLE IF NOT EXISTS public.procedure_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  -- Sin default: la fija `moneda_desde_la_clinica` (regla 14).
  currency text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procedure_packages_clinic_idx
  ON public.procedure_packages (clinic_id, is_active, position);

DROP TRIGGER IF EXISTS procedure_packages_updated_at ON public.procedure_packages;
CREATE TRIGGER procedure_packages_updated_at BEFORE UPDATE ON public.procedure_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS moneda_desde_la_clinica ON public.procedure_packages;
CREATE TRIGGER moneda_desde_la_clinica BEFORE INSERT ON public.procedure_packages
  FOR EACH ROW EXECUTE FUNCTION public.aplicar_moneda_de_la_clinica();

CREATE TABLE IF NOT EXISTS public.procedure_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.procedure_packages(id) ON DELETE CASCADE,
  procedure_id uuid REFERENCES public.procedures(id) ON DELETE SET NULL,
  name_snapshot text NOT NULL CHECK (char_length(btrim(name_snapshot)) BETWEEN 1 AND 200),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procedure_package_items_package_idx
  ON public.procedure_package_items (package_id, position);
CREATE INDEX IF NOT EXISTS procedure_package_items_clinic_idx
  ON public.procedure_package_items (clinic_id);
CREATE INDEX IF NOT EXISTS procedure_package_items_procedure_idx
  ON public.procedure_package_items (procedure_id)
  WHERE procedure_id IS NOT NULL;

-- Paquete y prestación de la misma clínica que la línea (misma razón que el
-- profesional: la FK ignora RLS).
CREATE OR REPLACE FUNCTION public.validar_linea_de_paquete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.procedure_packages pk
     WHERE pk.id = NEW.package_id AND pk.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'El paquete no corresponde a esta clínica.' USING ERRCODE = '23514';
  END IF;
  IF NEW.procedure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.procedures pr
     WHERE pr.id = NEW.procedure_id AND pr.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'La prestación no corresponde a esta clínica.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS procedure_package_items_validar ON public.procedure_package_items;
CREATE TRIGGER procedure_package_items_validar
  BEFORE INSERT OR UPDATE OF package_id, procedure_id, clinic_id ON public.procedure_package_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_linea_de_paquete();

REVOKE EXECUTE ON FUNCTION public.validar_linea_de_paquete()
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedure_packages TO authenticated;
GRANT ALL ON public.procedure_packages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedure_package_items TO authenticated;
GRANT ALL ON public.procedure_package_items TO service_role;
ALTER TABLE public.procedure_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedure_package_items ENABLE ROW LEVEL SECURITY;

-- Mismas reglas que `procedures` (el arancel): leen los miembros, escriben
-- owner/admin/dentist. Una política por comando (20261020120000).
DROP POLICY IF EXISTS "procedure_packages_select" ON public.procedure_packages;
DROP POLICY IF EXISTS "procedure_packages_insert" ON public.procedure_packages;
DROP POLICY IF EXISTS "procedure_packages_update" ON public.procedure_packages;
DROP POLICY IF EXISTS "procedure_packages_delete" ON public.procedure_packages;
CREATE POLICY "procedure_packages_select" ON public.procedure_packages
  FOR SELECT TO authenticated
  USING (public.is_clinic_member(clinic_id));
CREATE POLICY "procedure_packages_insert" ON public.procedure_packages
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedure_packages_update" ON public.procedure_packages
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedure_packages_delete" ON public.procedure_packages
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));

DROP POLICY IF EXISTS "procedure_package_items_select" ON public.procedure_package_items;
DROP POLICY IF EXISTS "procedure_package_items_insert" ON public.procedure_package_items;
DROP POLICY IF EXISTS "procedure_package_items_update" ON public.procedure_package_items;
DROP POLICY IF EXISTS "procedure_package_items_delete" ON public.procedure_package_items;
CREATE POLICY "procedure_package_items_select" ON public.procedure_package_items
  FOR SELECT TO authenticated
  USING (public.is_clinic_member(clinic_id));
CREATE POLICY "procedure_package_items_insert" ON public.procedure_package_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedure_package_items_update" ON public.procedure_package_items
  FOR UPDATE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]))
  WITH CHECK (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));
CREATE POLICY "procedure_package_items_delete" ON public.procedure_package_items
  FOR DELETE TO authenticated
  USING (public.has_clinic_role(clinic_id, ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'dentist'::public.app_role]));

-- ═══ 4 · Columnas nuevas de quote_items ═════════════════════════════════════
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS accepted boolean,
  ADD COLUMN IF NOT EXISTS package_id uuid
    REFERENCES public.procedure_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_name_snapshot text;

COMMENT ON COLUMN public.quote_items.accepted IS
  'Aceptación parcial: false = el paciente no aceptó esta línea. NULL = sin decisión (en una aceptación total entran todas).';
COMMENT ON COLUMN public.quote_items.package_id IS
  'Paquete del que salió la línea (PLA-12). NULL = línea suelta o paquete borrado.';
COMMENT ON COLUMN public.quote_items.package_name_snapshot IS
  'Nombre del paquete al momento de sumarlo (regla 10).';

CREATE INDEX IF NOT EXISTS quote_items_package_idx
  ON public.quote_items (package_id)
  WHERE package_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validar_paquete_de_linea_de_presupuesto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.procedure_packages pk
     WHERE pk.id = NEW.package_id AND pk.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'El paquete no corresponde a este presupuesto.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_items_validar_paquete ON public.quote_items;
CREATE TRIGGER quote_items_validar_paquete
  BEFORE INSERT OR UPDATE OF package_id, clinic_id ON public.quote_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_paquete_de_linea_de_presupuesto();

REVOKE EXECUTE ON FUNCTION public.validar_paquete_de_linea_de_presupuesto()
  FROM PUBLIC, anon, authenticated;

-- ═══ 5 · Transiciones de estado (PLA-02) ════════════════════════════════════
-- Espejo en la base de `TRANSICIONES` (src/lib/finance/estados-presupuesto.ts;
-- `tests/presupuestos-estados-db.test.ts` verifica que coincidan):
--   draft    → sent, accepted, partially_accepted, rejected, expired
--   sent     → accepted, partially_accepted, rejected, expired
--   expired  → sent, draft            (renovar, con validez futura)
--   accepted, converted, partially_accepted, rejected → terminales
--
-- El nombre `quote_a_validar_transicion` no es casual: los triggers BEFORE se
-- disparan en orden alfabético y este tiene que correr ANTES de
-- `quote_accept_creates_plan`, que cambia NEW.status de 'accepted' a
-- 'converted'. Así el guard ve el estado que se pidió, no el que resulta.
CREATE OR REPLACE FUNCTION public.validar_transicion_de_presupuesto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  permitido boolean;
  hoy date;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  permitido := CASE OLD.status
    WHEN 'draft' THEN NEW.status IN ('sent', 'accepted', 'partially_accepted', 'rejected', 'expired')
    WHEN 'sent' THEN NEW.status IN ('accepted', 'partially_accepted', 'rejected', 'expired')
    WHEN 'expired' THEN NEW.status IN ('sent', 'draft')
    ELSE false
  END;

  IF NOT permitido THEN
    RAISE EXCEPTION 'Un presupuesto % no puede pasar a %.', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- Renovar un vencido exige una validez que todavía no pasó (en el huso de
  -- la clínica, regla 7): si no, volvería a vencer en la próxima pasada.
  IF OLD.status = 'expired' THEN
    SELECT (now() AT TIME ZONE COALESCE(c.timezone, 'America/Santiago'))::date
      INTO hoy
      FROM public.clinics c
     WHERE c.id = NEW.clinic_id;
    IF NEW.valid_until IS NULL OR NEW.valid_until < hoy THEN
      RAISE EXCEPTION 'Para renovar el presupuesto, pon una fecha de validez desde hoy.'
        USING ERRCODE = '23514';
    END IF;
    NEW.expired_at := NULL;
  END IF;

  IF NEW.status = 'expired' THEN
    NEW.expired_at := COALESCE(NEW.expired_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_a_validar_transicion ON public.quotes;
CREATE TRIGGER quote_a_validar_transicion
  BEFORE UPDATE OF status ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_transicion_de_presupuesto();

REVOKE EXECUTE ON FUNCTION public.validar_transicion_de_presupuesto()
  FROM PUBLIC, anon, authenticated;

-- ═══ 6 · Conversión: aceptación total y parcial ═════════════════════════════
-- Cuarta versión. Parte de la vigente (20260904180000_correcciones_auditoria)
-- sin cambiar la aceptación total: plan con TODAS las líneas, total del
-- presupuesto, estado final 'converted'. Lo nuevo:
--   * 'partially_accepted' crea el plan solo con las líneas que no están
--     marcadas `accepted = false`, con su suma como total, y queda en
--     'partially_accepted' (no pasa a 'converted': el estado dice qué aceptó
--     el paciente, y el plan único ya lo garantiza el índice
--     `treatment_plans_quote_unico`).
--   * `accepted_total_cents` queda con lo que se aceptó.
CREATE OR REPLACE FUNCTION public.convert_accepted_quote_to_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_plan_id uuid;
  plan_name text;
  parcial boolean;
  total_aceptado bigint;
  lineas_aceptadas integer;
BEGIN
  IF NEW.status NOT IN ('accepted', 'partially_accepted')
     OR OLD.status IN ('accepted', 'converted', 'partially_accepted') THEN
    RETURN NEW;
  END IF;

  parcial := NEW.status = 'partially_accepted';

  -- Cinturón: si por cualquier camino ya existe un plan para este
  -- presupuesto, no se crea otro.
  IF EXISTS (SELECT 1 FROM public.treatment_plans WHERE quote_id = NEW.id) THEN
    IF NOT parcial THEN
      NEW.status := 'converted';
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(qi.total_cents), 0), count(*)
    INTO total_aceptado, lineas_aceptadas
    FROM public.quote_items qi
   WHERE qi.quote_id = NEW.id
     AND (NOT parcial OR qi.accepted IS DISTINCT FROM false);

  IF parcial AND lineas_aceptadas = 0 THEN
    RAISE EXCEPTION 'Marca al menos una prestación como aceptada.' USING ERRCODE = '23514';
  END IF;

  -- Aceptación total: el total del presupuesto, como siempre.
  IF NOT parcial THEN
    total_aceptado := NEW.total_cents;
  END IF;

  plan_name := 'Plan de ' || COALESCE(NEW.number, 'presupuesto');

  INSERT INTO public.treatment_plans (
    clinic_id, patient_id, quote_id, name, status, total_cents, currency, created_by
  )
  VALUES (
    NEW.clinic_id, NEW.patient_id, NEW.id, plan_name, 'active',
    total_aceptado, NEW.currency, NEW.created_by
  )
  RETURNING id INTO new_plan_id;

  INSERT INTO public.treatment_items (
    clinic_id, plan_id, procedure_id, quote_item_id, name_snapshot,
    tooth_number, surface, status, price_cents, position, notes,
    phase_label, phase_position, coverage_cents, patient_cents
  )
  SELECT
    qi.clinic_id, new_plan_id, qi.procedure_id, qi.id, qi.name_snapshot,
    qi.tooth_number, qi.surface, 'pending'::public.treatment_item_status,
    qi.total_cents, qi.position, qi.notes,
    qi.phase_label, qi.phase_position, qi.coverage_cents, qi.patient_cents
  FROM public.quote_items qi
  WHERE qi.quote_id = NEW.id
    AND (NOT parcial OR qi.accepted IS DISTINCT FROM false)
  ORDER BY qi.phase_position, qi.position;

  NEW.accepted_total_cents := total_aceptado;
  IF NOT parcial THEN
    NEW.status := 'converted';
  END IF;
  NEW.accepted_at := COALESCE(NEW.accepted_at, now());
  RETURN NEW;
END;
$$;

-- Ya revocada en 20261013000100; se repite por si esta migración corre en
-- una base donde la función se recrea con los privilegios por defecto.
REVOKE EXECUTE ON FUNCTION public.convert_accepted_quote_to_plan()
  FROM PUBLIC, anon, authenticated;

-- ═══ 7 · Historial del presupuesto (PLA-02 quién/cuándo, PLA-03) ════════════
-- Lo escribe la base (mismo principio que la regla 16): sin políticas de
-- INSERT/UPDATE/DELETE, nadie puede fabricar ni borrar un evento desde la API.
CREATE TABLE IF NOT EXISTS public.quote_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('creado', 'estado', 'contacto', 'validez')),
  from_status public.quote_status,
  to_status public.quote_status,
  valid_until date,
  note text,
  -- NULL = el sistema (vencimiento automático, cron o service role).
  actor_id uuid,
  -- clock_timestamp() y no now(): varios eventos de una misma transacción
  -- (aceptar y registrar el contacto, por ejemplo) quedan en orden.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quote_events_quote_idx
  ON public.quote_events (quote_id, created_at);
CREATE INDEX IF NOT EXISTS quote_events_clinic_idx
  ON public.quote_events (clinic_id, created_at DESC);

GRANT SELECT ON public.quote_events TO authenticated;
GRANT ALL ON public.quote_events TO service_role;
ALTER TABLE public.quote_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quote_events_select" ON public.quote_events;
CREATE POLICY "quote_events_select" ON public.quote_events
  FOR SELECT TO authenticated
  USING (public.is_clinic_member(clinic_id));

-- SEG-01: mismo criterio que `quotes` (src/lib/auth/mfa-rls.ts).
drop policy if exists mfa_exige_aal2 on public.quote_events;
create policy mfa_exige_aal2 on public.quote_events
  as restrictive
  for all
  to authenticated
  using ((select public.sesion_cumple_mfa()))
  with check ((select public.sesion_cumple_mfa()));

CREATE OR REPLACE FUNCTION public.registrar_evento_de_presupuesto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
BEGIN
  -- `vencer_presupuestos()` marca la transacción: el vencimiento lo hace el
  -- sistema aunque lo haya disparado la vista de un usuario.
  IF current_setting('esmalia.actor_sistema', true) = 'on' THEN
    actor := NULL;
  ELSE
    actor := auth.uid();
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.quote_events (clinic_id, quote_id, kind, to_status, valid_until, actor_id)
    VALUES (NEW.clinic_id, NEW.id, 'creado', NEW.status, NEW.valid_until, actor);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.quote_events (
      clinic_id, quote_id, kind, from_status, to_status, valid_until, note, actor_id
    )
    VALUES (
      NEW.clinic_id, NEW.id, 'estado', OLD.status, NEW.status, NEW.valid_until,
      CASE WHEN NEW.status = 'rejected' THEN NEW.rejection_reason END,
      actor
    );
  ELSIF NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
    INSERT INTO public.quote_events (clinic_id, quote_id, kind, valid_until, actor_id)
    VALUES (NEW.clinic_id, NEW.id, 'validez', NEW.valid_until, actor);
  END IF;

  IF NEW.last_contact_at IS DISTINCT FROM OLD.last_contact_at AND NEW.last_contact_at IS NOT NULL THEN
    INSERT INTO public.quote_events (clinic_id, quote_id, kind, note, actor_id)
    VALUES (
      NEW.clinic_id, NEW.id, 'contacto',
      concat_ws(' · ', NULLIF(btrim(NEW.last_contact_note), ''),
                CASE WHEN NEW.next_action IS NOT NULL
                     THEN 'Próxima acción: ' || NEW.next_action END),
      actor
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_registrar_evento ON public.quotes;
CREATE TRIGGER quotes_registrar_evento
  AFTER INSERT OR UPDATE OF status, valid_until, last_contact_at ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.registrar_evento_de_presupuesto();

REVOKE EXECUTE ON FUNCTION public.registrar_evento_de_presupuesto()
  FROM PUBLIC, anon, authenticated;

-- Historial previo: un evento "creado" por presupuesto que ya existe, con su
-- fecha real, y los cambios de estado que se pueden reconstruir de las
-- columnas *_at. Sin actor (NULL = no se sabe quién), regla 11. Idempotente:
-- solo para presupuestos que todavía no tienen eventos.
INSERT INTO public.quote_events (clinic_id, quote_id, kind, to_status, created_at)
SELECT q.clinic_id, q.id, 'creado', 'draft', q.created_at
  FROM public.quotes q
 WHERE NOT EXISTS (SELECT 1 FROM public.quote_events e WHERE e.quote_id = q.id);

INSERT INTO public.quote_events (clinic_id, quote_id, kind, from_status, to_status, created_at)
SELECT q.clinic_id, q.id, 'estado', 'draft', 'sent', q.sent_at
  FROM public.quotes q
 WHERE q.sent_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.quote_events e
                    WHERE e.quote_id = q.id AND e.kind = 'estado');

INSERT INTO public.quote_events (clinic_id, quote_id, kind, from_status, to_status, created_at)
SELECT q.clinic_id, q.id, 'estado',
       CASE WHEN q.sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END::public.quote_status,
       q.status, COALESCE(q.accepted_at, q.rejected_at, q.updated_at)
  FROM public.quotes q
 WHERE q.status IN ('accepted', 'converted', 'rejected', 'expired')
   AND NOT EXISTS (SELECT 1 FROM public.quote_events e
                    WHERE e.quote_id = q.id AND e.kind = 'estado'
                      AND e.to_status = q.status);

-- Monto aceptado de los que ya se aceptaron (todos fueron totales).
UPDATE public.quotes
   SET accepted_total_cents = total_cents
 WHERE status IN ('accepted', 'converted')
   AND accepted_total_cents IS NULL;

-- ═══ 8 · Vencimiento automático (PLA-06) ════════════════════════════════════
-- Pasa a 'expired' los borradores y enviados cuya validez ya pasó en el huso
-- de cada clínica. Idempotente. La llaman:
--   * la app al listar presupuestos (con su clínica: solo un miembro);
--   * el cron horario /api/daily-digest con service role (todas).
-- Devuelve cuántos venció.
CREATE OR REPLACE FUNCTION public.vencer_presupuestos(p_clinic_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vencidos integer;
BEGIN
  IF p_clinic_id IS NULL THEN
    -- Todas las clínicas: solo el backend (service role o postgres).
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'No tienes permisos.' USING ERRCODE = '42501';
    END IF;
  ELSIF auth.uid() IS NOT NULL AND NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'No tienes permisos.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('esmalia.actor_sistema', 'on', true);

  UPDATE public.quotes q
     SET status = 'expired'
    FROM public.clinics c
   WHERE c.id = q.clinic_id
     AND q.status IN ('draft', 'sent')
     AND q.valid_until IS NOT NULL
     AND q.valid_until < (now() AT TIME ZONE COALESCE(c.timezone, 'America/Santiago'))::date
     AND (p_clinic_id IS NULL OR q.clinic_id = p_clinic_id);
  GET DIAGNOSTICS vencidos = ROW_COUNT;

  PERFORM set_config('esmalia.actor_sistema', 'off', true);
  RETURN vencidos;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vencer_presupuestos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vencer_presupuestos(uuid) TO authenticated, service_role;

-- ─── Verificación después de aplicar (solo lectura) ─────────────────────────
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE oid IN ('public.quote_events'::regclass, 'public.procedure_packages'::regclass,
--                  'public.procedure_package_items'::regclass);
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('quote_events', 'procedure_packages', 'procedure_package_items');
--   SELECT has_function_privilege('anon', 'public.vencer_presupuestos(uuid)', 'execute');  -- false
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.quotes'::regclass AND NOT tgisinternal;
--   SELECT count(*) FROM public.quote_events;  -- ≥ cantidad de presupuestos

-- ─── Cómo revertir ──────────────────────────────────────────────────────────
-- (el código de este PR tiene que salir antes: lee las columnas nuevas)
-- DROP TRIGGER IF EXISTS quotes_registrar_evento ON public.quotes;
-- DROP FUNCTION IF EXISTS public.registrar_evento_de_presupuesto();
-- DROP TRIGGER IF EXISTS quote_a_validar_transicion ON public.quotes;
-- DROP FUNCTION IF EXISTS public.validar_transicion_de_presupuesto();
-- DROP TRIGGER IF EXISTS quotes_validar_profesional ON public.quotes;
-- DROP FUNCTION IF EXISTS public.validar_profesional_de_presupuesto();
-- DROP TRIGGER IF EXISTS quote_items_validar_paquete ON public.quote_items;
-- DROP FUNCTION IF EXISTS public.validar_paquete_de_linea_de_presupuesto();
-- DROP FUNCTION IF EXISTS public.vencer_presupuestos(uuid);
-- drop policy if exists mfa_exige_aal2 on public.quote_events;
-- DROP TABLE IF EXISTS public.quote_events;
-- ALTER TABLE public.quote_items DROP COLUMN IF EXISTS accepted,
--   DROP COLUMN IF EXISTS package_id, DROP COLUMN IF EXISTS package_name_snapshot;
-- DROP TABLE IF EXISTS public.procedure_package_items;
-- DROP TABLE IF EXISTS public.procedure_packages;
-- DROP FUNCTION IF EXISTS public.validar_linea_de_paquete();
-- ALTER TABLE public.quotes DROP COLUMN IF EXISTS professional_id,
--   DROP COLUMN IF EXISTS accepted_total_cents, DROP COLUMN IF EXISTS rejection_reason,
--   DROP COLUMN IF EXISTS expired_at, DROP COLUMN IF EXISTS last_contact_at,
--   DROP COLUMN IF EXISTS last_contact_note, DROP COLUMN IF EXISTS next_action,
--   DROP COLUMN IF EXISTS next_action_on;
-- ALTER TABLE public.clinics DROP COLUMN IF EXISTS quote_validity_days;
-- Y volver a crear convert_accepted_quote_to_plan() con el cuerpo de
-- 20260904180000_correcciones_auditoria.sql (antes, pasar a 'sent' o
-- 'rejected' los 'partially_accepted' que hubiera, o dejarlos: el cuerpo viejo
-- los ignora). Los planes ya creados no se tocan.
