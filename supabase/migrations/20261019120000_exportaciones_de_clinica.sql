-- Exportación completa de los datos de la clínica (hallazgos CS-04 y CON-01,
-- auditoría 360 del 18-oct-2026).
--
-- Los Términos, el DPA y la home prometen que la clínica puede llevarse sus
-- datos. La exportación la arma la app (src/lib/exportacion/); esta migración
-- solo agrega el REGISTRO de cada exportación: quién sacó todos los datos de
-- salud de la clínica y cuándo. No había un log general de la clínica donde
-- anotarlo — `clinical_note_audit` es por nota y su vocabulario está cerrado
-- con un CHECK, y `patient_medical_history_audit` es por paciente.
--
-- Mismo diseño que la auditoría de notas (20260907200000): nadie inserta
-- directo. La única puerta es `registrar_exportacion_de_clinica()`, que
-- verifica el rol con `can_manage_clinic` (owner/admin) y ESTAMPA el actor
-- con auth.uid(): no se puede registrar una exportación a nombre de otro ni
-- en una clínica ajena. Sin UPDATE ni DELETE: un registro de auditoría que se
-- puede editar no sirve como registro.
--
-- `actor_id` es nullable y con ON DELETE SET NULL por la misma lección de
-- 20260907220000: si se borra el usuario, el registro queda ("lo hizo alguien
-- que ya no existe") en vez de impedir el borrado o desaparecer.
--
-- La app falla cerrada: si esta función no existe todavía (migración sin
-- aplicar), el botón muestra un error y NO genera el ZIP.

CREATE TABLE IF NOT EXISTS public.clinic_data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  formato text NOT NULL DEFAULT 'zip_csv',
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinic_data_exports_clinic_created_idx
  ON public.clinic_data_exports (clinic_id, created_at DESC);

ALTER TABLE public.clinic_data_exports ENABLE ROW LEVEL SECURITY;

-- Lectura: solo quien administra la clínica (el mismo rol que puede exportar).
DROP POLICY IF EXISTS clinic_data_exports_select_managers ON public.clinic_data_exports;
CREATE POLICY clinic_data_exports_select_managers ON public.clinic_data_exports
  FOR SELECT TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- Sin políticas de INSERT/UPDATE/DELETE a propósito (ver arriba).
REVOKE ALL ON public.clinic_data_exports FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.clinic_data_exports FROM authenticated;
GRANT SELECT ON public.clinic_data_exports TO authenticated;

COMMENT ON TABLE public.clinic_data_exports IS
  'Registro de exportaciones completas de datos de la clínica (CS-04/CON-01). Sin política de INSERT: se escribe solo vía registrar_exportacion_de_clinica(), que exige owner/admin y estampa el actor.';

CREATE OR REPLACE FUNCTION public.registrar_exportacion_de_clinica(
  p_clinic_id uuid,
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
  IF v_actor IS NULL OR NOT public.can_manage_clinic(p_clinic_id) THEN
    RAISE EXCEPTION 'sin permiso para exportar los datos de esta clinica' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.clinic_data_exports (clinic_id, actor_id, formato, detalle)
  VALUES (p_clinic_id, v_actor, 'zip_csv', coalesce(p_detalle, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- `REVOKE ... FROM PUBLIC` no alcanza en Supabase: anon recibe EXECUTE por
-- default privileges (ver 20261007000000 y tests/permisos-funciones-definer).
REVOKE ALL ON FUNCTION public.registrar_exportacion_de_clinica(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_exportacion_de_clinica(uuid, jsonb) TO authenticated;
