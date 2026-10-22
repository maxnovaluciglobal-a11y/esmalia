-- Box de la cita (AGE-04 / ADM-06, Ola 2 · frente boxes y grilla).
--
-- `appointments.operatory_id` existe desde la creación de la tabla
-- (FK a `operatories` con ON DELETE SET NULL) y el formulario de cita lo
-- escribe desde la Ola 1, pero la base no garantizaba nada: la FK sola
-- acepta un box de otra sucursal o de otra clínica. Esta migración:
--
-- 1. Agrega `operatory_name`, el nombre del box al agendarse (regla 10,
--    snapshot de catálogo): si la clínica renombra o borra el box, la cita
--    sigue diciendo dónde fue.
-- 2. Valida en un trigger que el box sea de la misma clínica y de la misma
--    sucursal que la cita, y que esté activo al elegirlo (mismo patrón que
--    `appointments_tipo_de_cita`, 20261022200000).
-- 3. Si la cita cambia de sucursal sin cambiar de box (arrastre a un
--    profesional de otra sede), el box viejo se suelta solo: un box es una
--    sala física y no viaja con la cita. Así el código en producción, que
--    no conoce esta regla, sigue funcionando (RUNBOOK_MIGRACIONES, regla 3).
-- 4. Índice para buscar choques por box.
--
-- Compatible con el código en producción: una columna NULLABLE nueva que el
-- código viejo no lee ni escribe, y un trigger que solo rechaza lo que ya
-- rechazaba el servidor (`validarBox` en appointments.functions.ts).

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS operatory_name text
    CHECK (operatory_name IS NULL OR char_length(operatory_name) <= 120);

CREATE INDEX IF NOT EXISTS appointments_clinic_operatory_idx
  ON public.appointments (clinic_id, operatory_id, starts_at)
  WHERE operatory_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.appointments_box_de_la_cita()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_box record;
BEGIN
  IF NEW.operatory_id IS NULL THEN
    -- Al crear, sin box no hay nombre. Al editar se respeta lo que llega:
    -- cuando se borra un box del catálogo, el ON DELETE SET NULL pasa por
    -- acá y la cita tiene que conservar el nombre con el que se agendó.
    -- Quitar el box a mano (la app) manda también el nombre en NULL.
    IF TG_OP = 'INSERT' THEN
      NEW.operatory_name := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.operatory_id IS NOT DISTINCT FROM OLD.operatory_id
     AND NEW.clinic_id IS NOT DISTINCT FROM OLD.clinic_id THEN
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      -- Cambió de sucursal y el box quedó en la otra: se suelta.
      PERFORM 1 FROM public.operatories o
        WHERE o.id = NEW.operatory_id
          AND o.clinic_id = NEW.clinic_id
          AND o.branch_id = NEW.branch_id;
      IF NOT FOUND THEN
        NEW.operatory_id := NULL;
        NEW.operatory_name := NULL;
        RETURN NEW;
      END IF;
    END IF;
    -- Mismo box: se conserva el nombre con el que se agendó (snapshot). Un
    -- box que se desactivó después sigue valiendo para sus citas.
    -- Lo que mande el cliente en `operatory_name` no cuenta.
    NEW.operatory_name := OLD.operatory_name;
    IF NEW.operatory_name IS NULL THEN
      SELECT o.name INTO NEW.operatory_name
        FROM public.operatories o
       WHERE o.id = NEW.operatory_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Box nuevo (al crear o al cambiarlo): de esta clínica, de esta sucursal
  -- y activo.
  SELECT o.name, o.branch_id, o.is_active INTO v_box
    FROM public.operatories o
   WHERE o.id = NEW.operatory_id
     AND o.clinic_id = NEW.clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El box no existe o no es de esta clínica.'
      USING ERRCODE = '23503';
  END IF;
  IF v_box.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'El box no es de la sucursal de la cita.'
      USING ERRCODE = '23503';
  END IF;
  IF NOT v_box.is_active THEN
    RAISE EXCEPTION 'El box está desactivado.'
      USING ERRCODE = '23514';
  END IF;
  NEW.operatory_name := v_box.name;
  RETURN NEW;
END;
$$;

-- Citas que ya tienen box (cargadas desde la Ola 1): copia del nombre,
-- antes de crear el trigger.
UPDATE public.appointments a
   SET operatory_name = o.name
  FROM public.operatories o
 WHERE a.operatory_id = o.id
   AND a.operatory_name IS NULL;

-- En todo UPDATE (no solo `OF operatory_id`): también corre cuando cambia la
-- sucursal, y así no se puede reescribir el nombre guardado mandando solo
-- `operatory_name`.
DROP TRIGGER IF EXISTS appointments_box_de_la_cita ON public.appointments;
CREATE TRIGGER appointments_box_de_la_cita
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_box_de_la_cita();

-- Cómo revertir:
--   DROP TRIGGER IF EXISTS appointments_box_de_la_cita ON public.appointments;
--   DROP FUNCTION IF EXISTS public.appointments_box_de_la_cita();
--   DROP INDEX IF EXISTS public.appointments_clinic_operatory_idx;
--   ALTER TABLE public.appointments DROP COLUMN IF EXISTS operatory_name;
