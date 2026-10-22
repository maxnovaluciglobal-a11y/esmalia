-- Bloqueos y aperturas excepcionales de la agenda (Ola 2 · frente
-- Disponibilidad, AGE-07 y AGE-08).
--
-- Una sola tabla para las dos cosas, porque son el mismo dato con signo
-- distinto: un rango de la agenda que se aparta del horario habitual.
--
-- - `bloqueo`: el rango NO se agenda (almuerzo, capacitación, vacaciones,
--   ausencia, otro). Puede ser de un profesional, de un box, de una sucursal
--   entera o de toda la clínica (las tres columnas en NULL). Agendar encima
--   no se impide: el servidor avisa, igual que con los choques de horario.
-- - `apertura`: el rango SÍ se agenda aunque caiga fuera del horario semanal
--   declarado del profesional (ej. un sábado). Siempre es de un profesional.
--
-- Las horas son de PARED, en el huso de la sucursal (o de la clínica si no
-- hay sucursal): `timestamp` sin zona, igual que el `<input
-- type="datetime-local">` del formulario y que `Cita.fecha`/`Cita.inicio` en
-- la agenda. Así un bloqueo semanal de 13:00 a 14:00 sigue siendo de 13:00 a
-- 14:00 después del cambio de horario de verano.
--
-- Repetición semanal: el mismo tramo, el mismo día de la semana, desde
-- `starts_local` hasta `repeat_until` (inclusive, o sin fin). Un tramo que se
-- repite no cruza la medianoche.
--
-- Compatible con el código en producción (RUNBOOK_MIGRACIONES, regla 3): es
-- una tabla nueva que el código actual no lee.

CREATE TABLE IF NOT EXISTS public.agenda_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bloqueo', 'apertura')),
  professional_id uuid REFERENCES public.professionals(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  operatory_id uuid REFERENCES public.operatories(id) ON DELETE CASCADE,
  reason text CHECK (
    reason IS NULL OR reason IN ('almuerzo', 'capacitacion', 'vacaciones', 'ausencia', 'otro')
  ),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  starts_local timestamp NOT NULL,
  ends_local timestamp NOT NULL,
  repeat_weekly boolean NOT NULL DEFAULT false,
  repeat_until date,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_exceptions_rango_chk CHECK (starts_local < ends_local),
  -- Un bloqueo dice por qué; una apertura es de un profesional.
  CONSTRAINT agenda_exceptions_bloqueo_motivo_chk CHECK (kind <> 'bloqueo' OR reason IS NOT NULL),
  CONSTRAINT agenda_exceptions_apertura_profesional_chk
    CHECK (kind <> 'apertura' OR professional_id IS NOT NULL),
  -- Tope razonable: unas vacaciones largas entran, un error de tipeo de años no.
  CONSTRAINT agenda_exceptions_largo_chk CHECK (ends_local - starts_local <= interval '120 days'),
  -- Lo que se repite es un tramo del día, no un rango de varios días.
  CONSTRAINT agenda_exceptions_repeticion_chk CHECK (
    NOT repeat_weekly
    OR (ends_local::date = starts_local::date
        OR ends_local = (starts_local::date + 1)::timestamp)
  ),
  CONSTRAINT agenda_exceptions_repeat_until_chk CHECK (
    repeat_until IS NULL OR (repeat_weekly AND repeat_until >= starts_local::date)
  )
);

CREATE INDEX IF NOT EXISTS agenda_exceptions_clinic_rango_idx
  ON public.agenda_exceptions (clinic_id, starts_local, ends_local);
CREATE INDEX IF NOT EXISTS agenda_exceptions_profesional_idx
  ON public.agenda_exceptions (professional_id) WHERE professional_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_exceptions_branch_idx
  ON public.agenda_exceptions (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_exceptions_operatory_idx
  ON public.agenda_exceptions (operatory_id) WHERE operatory_id IS NOT NULL;

CREATE TRIGGER agenda_exceptions_updated_at BEFORE UPDATE ON public.agenda_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Profesional, sucursal y box tienen que ser de la misma clínica que el
-- bloqueo (la FK sola no mira la clínica), y el box de la sucursal elegida.
-- SECURITY INVOKER: quien escribe ya pasó la RLS de escritura y puede leer
-- esas tablas de su clínica.
CREATE OR REPLACE FUNCTION public.agenda_exceptions_misma_clinica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF NEW.professional_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.professionals p
    WHERE p.id = NEW.professional_id AND p.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'El profesional no es de esta clínica.' USING ERRCODE = '23503';
  END IF;
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = NEW.branch_id AND b.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'La sucursal no es de esta clínica.' USING ERRCODE = '23503';
  END IF;
  IF NEW.operatory_id IS NOT NULL THEN
    SELECT o.branch_id INTO v_branch
    FROM public.operatories o
    WHERE o.id = NEW.operatory_id AND o.clinic_id = NEW.clinic_id;
    IF v_branch IS NULL THEN
      RAISE EXCEPTION 'El box no es de esta clínica.' USING ERRCODE = '23503';
    END IF;
    IF NEW.branch_id IS NOT NULL AND NEW.branch_id <> v_branch THEN
      RAISE EXCEPTION 'El box no es de la sucursal elegida.' USING ERRCODE = '23503';
    END IF;
    -- El box define la sucursal: se completa para poder filtrar por ella.
    NEW.branch_id := v_branch;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agenda_exceptions_misma_clinica
  BEFORE INSERT OR UPDATE ON public.agenda_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.agenda_exceptions_misma_clinica();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_exceptions TO authenticated;
GRANT ALL ON public.agenda_exceptions TO service_role;
ALTER TABLE public.agenda_exceptions ENABLE ROW LEVEL SECURITY;

-- Leer: cualquier miembro (la agenda dibuja los bloqueos para todos).
-- Escribir: owner y admin (`can_manage_clinic`), igual que los horarios de
-- los profesionales. Una política por comando (20261020120000).
CREATE POLICY "agenda_exceptions_select_members" ON public.agenda_exceptions
  FOR SELECT TO authenticated USING (public.is_clinic_member(clinic_id));
CREATE POLICY "agenda_exceptions_insert_managers" ON public.agenda_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "agenda_exceptions_update_managers" ON public.agenda_exceptions
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "agenda_exceptions_delete_managers" ON public.agenda_exceptions
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- Cómo revertir (en una migración correctiva, ver el PR):
--   DROP TABLE IF EXISTS public.agenda_exceptions;
--   DROP FUNCTION IF EXISTS public.agenda_exceptions_misma_clinica();
