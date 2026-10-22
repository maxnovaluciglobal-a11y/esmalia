-- Procedimientos frecuentes en el formulario de cita (AGE-12, Ola 1).
--
-- Arriba del campo "Tratamiento" aparecen de 8 a 12 botones con lo que la
-- clínica más agenda; el resto se sigue buscando en el autocompletado.
-- Salen de dos lados:
--   1. Los que la clínica marca como favoritos en el arancel (`is_favorite`).
--   2. Los más agendados en los últimos 90 días (`procedimientos_frecuentes`).
--
-- Compatible con el código en producción: una columna con default y una
-- función nueva. La duración por procedimiento (AGE-09) ya existe
-- (`procedures.duration_min`), no se toca.

ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

-- Cuántas citas (no canceladas) usaron cada procedimiento desde `p_desde`.
-- SECURITY INVOKER: corre con los permisos de quien llama, así que la RLS de
-- `appointments` (incluida la de MFA) se aplica igual que en un SELECT por
-- REST. Agrega en la base para no traer miles de citas a JS (PostgREST corta
-- en 1000 filas sin avisar).
CREATE OR REPLACE FUNCTION public.procedimientos_frecuentes(
  p_clinic_id uuid,
  p_desde timestamptz,
  p_limite integer DEFAULT 12
)
RETURNS TABLE (procedure_id uuid, usos bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT a.procedure_id, count(*)::bigint AS usos
  FROM public.appointments a
  WHERE a.clinic_id = p_clinic_id
    AND a.procedure_id IS NOT NULL
    AND a.status <> 'cancelada'
    AND a.starts_at >= p_desde
  GROUP BY a.procedure_id
  ORDER BY usos DESC, a.procedure_id
  LIMIT least(greatest(coalesce(p_limite, 12), 1), 50);
$$;

COMMENT ON FUNCTION public.procedimientos_frecuentes(uuid, timestamptz, integer) IS
  'Procedimientos más agendados de la clínica desde una fecha. SECURITY INVOKER: respeta la RLS de appointments.';

REVOKE ALL ON FUNCTION public.procedimientos_frecuentes(uuid, timestamptz, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.procedimientos_frecuentes(uuid, timestamptz, integer)
  TO authenticated, service_role;
