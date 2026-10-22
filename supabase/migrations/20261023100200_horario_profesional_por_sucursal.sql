-- Profesional en varias sucursales (Ola 2 · frente Disponibilidad, AGE-23).
--
-- `professional_schedules` (20260826170000) guarda el horario semanal del
-- profesional pero no dice DÓNDE atiende. Una dentista que va lunes y
-- miércoles a Providencia y martes a Ñuñoa no tenía cómo declararlo, y el
-- selector de la cita la mostraba solo en la sucursal de su ficha.
--
-- Columna nueva NULLABLE: NULL = "en cualquier sucursal", que es exactamente
-- lo que significaban las filas que ya existen. El código en producción no
-- la lee ni la escribe (RUNBOOK_MIGRACIONES, regla 3), y el `setProfessional
-- Schedule` actual (delete + insert sin la columna) sigue funcionando: deja
-- las filas en NULL, como siempre.

ALTER TABLE public.professional_schedules
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS professional_schedules_branch_idx
  ON public.professional_schedules (branch_id) WHERE branch_id IS NOT NULL;

-- La sucursal tiene que ser de la misma clínica que el horario (la FK sola
-- no mira la clínica). SECURITY INVOKER: quien escribe ya pasó la RLS.
CREATE OR REPLACE FUNCTION public.professional_schedules_sucursal_misma_clinica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = NEW.branch_id AND b.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'La sucursal no es de esta clínica.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER professional_schedules_sucursal_misma_clinica
  BEFORE INSERT OR UPDATE OF branch_id, clinic_id ON public.professional_schedules
  FOR EACH ROW EXECUTE FUNCTION public.professional_schedules_sucursal_misma_clinica();

-- Cómo revertir (en una migración correctiva, ver el PR):
--   DROP TRIGGER IF EXISTS professional_schedules_sucursal_misma_clinica
--     ON public.professional_schedules;
--   DROP FUNCTION IF EXISTS public.professional_schedules_sucursal_misma_clinica();
--   ALTER TABLE public.professional_schedules DROP COLUMN IF EXISTS branch_id;
-- (Antes de borrar la columna, el código que la usa tiene que estar fuera de
-- producción: ver la regla 3 del runbook.)
