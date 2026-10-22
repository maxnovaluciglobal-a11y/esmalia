-- Configuración de la agenda (Ola 2 · frente Disponibilidad, AGE-10).
--
-- Dos tablas nuevas:
--
-- 1. `clinic_agenda_settings`: una fila por clínica con el intervalo de la
--    grilla (10, 15, 20 o 30 minutos), la duración por defecto de una cita
--    nueva y si se permiten sobrecupos (dos citas del mismo profesional a la
--    vez). Sin fila = los valores de siempre (15 min, 30 min, sí se permiten),
--    así que ninguna clínica cambia hasta que alguien guarde la pantalla.
--
-- 2. `branch_hours`: horario de atención por día de la semana de cada
--    sucursal (puede haber más de un tramo por día). Una sucursal sin filas no
--    tiene horario declarado y la grilla no sombrea nada, como hasta hoy
--    (`branches.opens_at/closes_at` se sigue usando solo para sugerir los
--    valores iniciales en la pantalla).
--
-- Compatible con el código en producción (RUNBOOK_MIGRACIONES, regla 3): dos
-- tablas nuevas que el código actual no lee.

CREATE TABLE IF NOT EXISTS public.clinic_agenda_settings (
  clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  slot_minutes smallint NOT NULL DEFAULT 15 CHECK (slot_minutes IN (10, 15, 20, 30)),
  default_duration_min smallint NOT NULL DEFAULT 30
    CHECK (default_duration_min BETWEEN 5 AND 480),
  allow_overbooking boolean NOT NULL DEFAULT true,
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER clinic_agenda_settings_updated_at BEFORE UPDATE ON public.clinic_agenda_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_agenda_settings TO authenticated;
GRANT ALL ON public.clinic_agenda_settings TO service_role;
ALTER TABLE public.clinic_agenda_settings ENABLE ROW LEVEL SECURITY;

-- Leer: cualquier miembro (la grilla y el formulario de cita la usan).
-- Escribir: owner y admin. Una política por comando (20261020120000).
CREATE POLICY "clinic_agenda_settings_select_members" ON public.clinic_agenda_settings
  FOR SELECT TO authenticated USING (public.is_clinic_member(clinic_id));
CREATE POLICY "clinic_agenda_settings_insert_managers" ON public.clinic_agenda_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "clinic_agenda_settings_update_managers" ON public.clinic_agenda_settings
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "clinic_agenda_settings_delete_managers" ON public.clinic_agenda_settings
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

CREATE TABLE IF NOT EXISTS public.branch_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  -- 0 = domingo … 6 = sábado, igual que Date.getDay() y professional_schedules.
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_hours_rango_chk CHECK (opens_at < closes_at),
  CONSTRAINT branch_hours_tramo_key UNIQUE (branch_id, day_of_week, opens_at)
);

CREATE INDEX IF NOT EXISTS branch_hours_clinic_idx ON public.branch_hours (clinic_id);

-- La sucursal tiene que ser de la misma clínica que la fila.
CREATE OR REPLACE FUNCTION public.branch_hours_misma_clinica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = NEW.branch_id AND b.clinic_id = NEW.clinic_id
  ) THEN
    RAISE EXCEPTION 'La sucursal no es de esta clínica.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER branch_hours_misma_clinica
  BEFORE INSERT OR UPDATE ON public.branch_hours
  FOR EACH ROW EXECUTE FUNCTION public.branch_hours_misma_clinica();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_hours TO authenticated;
GRANT ALL ON public.branch_hours TO service_role;
ALTER TABLE public.branch_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_hours_select_members" ON public.branch_hours
  FOR SELECT TO authenticated USING (public.is_clinic_member(clinic_id));
CREATE POLICY "branch_hours_insert_managers" ON public.branch_hours
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "branch_hours_update_managers" ON public.branch_hours
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "branch_hours_delete_managers" ON public.branch_hours
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- Cómo revertir (en una migración correctiva, ver el PR):
--   DROP TABLE IF EXISTS public.branch_hours;
--   DROP FUNCTION IF EXISTS public.branch_hours_misma_clinica();
--   DROP TABLE IF EXISTS public.clinic_agenda_settings;
