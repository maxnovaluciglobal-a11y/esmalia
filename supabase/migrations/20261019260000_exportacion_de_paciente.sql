-- Exportación de UN paciente desde su ficha (derecho de acceso del paciente,
-- hallazgo CON-01, auditoría 360 del 18-oct-2026).
--
-- La exportación completa (20261019120000) es solo de owner/admin y deja una
-- fila en `clinic_data_exports`. Cuando un paciente pide una copia de su
-- ficha, quien la entrega suele ser su dentista: esta migración agrega la
-- exportación de una sola ficha, también registrada, y la abre a dentist.
--
--  * `patient_id` nullable en `clinic_data_exports`: null = exportación
--    completa de la clínica; con valor = exportación de esa ficha. SIN clave
--    foránea, por la lección de 20260907220000 (un registro de auditoría que
--    impide borrar un paciente pasa a ser un candado, y un ON DELETE SET NULL
--    sería editar el registro).
--  * La única puerta sigue siendo una función SECURITY DEFINER que estampa
--    el actor con auth.uid(): `registrar_exportacion_de_paciente()` exige
--    owner/admin/dentist en esa clínica y que el paciente sea de la clínica.
--  * Lectura: además de owner/admin (política existente), cada persona ve
--    SUS propias exportaciones. La app lo necesita para verificar, en cada
--    página que pide un dentista, que la exportación es suya y reciente.
--    Un dentista no ve las exportaciones de los demás.
--
-- La app falla cerrada: sin esta migración el botón de la ficha muestra un
-- error y no genera nada. La exportación completa no cambia.

begin;

ALTER TABLE public.clinic_data_exports
  ADD COLUMN IF NOT EXISTS patient_id uuid;

COMMENT ON COLUMN public.clinic_data_exports.patient_id IS
  'Null = exportación completa de la clínica. Con valor = exportación de la ficha de ese paciente (sin FK a propósito: el registro no impide borrar al paciente).';

CREATE INDEX IF NOT EXISTS clinic_data_exports_patient_idx
  ON public.clinic_data_exports (clinic_id, patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;

DROP POLICY IF EXISTS clinic_data_exports_select_own ON public.clinic_data_exports;
CREATE POLICY clinic_data_exports_select_own ON public.clinic_data_exports
  FOR SELECT TO authenticated
  USING (actor_id = (SELECT auth.uid()) AND public.is_clinic_member(clinic_id));

CREATE OR REPLACE FUNCTION public.registrar_exportacion_de_paciente(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_detalle jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_clinic_role(
    p_clinic_id, ARRAY['owner', 'admin', 'dentist']::public.app_role[]
  ) THEN
    RAISE EXCEPTION 'sin permiso para exportar fichas de esta clinica' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
     WHERE p.id = p_patient_id AND p.clinic_id = p_clinic_id
  ) THEN
    RAISE EXCEPTION 'el paciente no pertenece a esta clinica' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.clinic_data_exports (clinic_id, actor_id, formato, patient_id, detalle)
  VALUES (p_clinic_id, v_actor, 'paciente_zip', p_patient_id, coalesce(p_detalle, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- `REVOKE ... FROM PUBLIC` no alcanza en Supabase: anon recibe EXECUTE por
-- default privileges (ver 20261007000000 y tests/permisos-funciones-definer).
REVOKE ALL ON FUNCTION public.registrar_exportacion_de_paciente(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_exportacion_de_paciente(uuid, uuid, jsonb) TO authenticated;

commit;
