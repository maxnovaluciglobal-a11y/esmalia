-- Registro de LECTURAS de la ficha clínica (hallazgo SEG-02, auditoría 360
-- del 18-oct-2026).
--
-- Hasta hoy la base registraba quién ESCRIBE una nota (clinical_note_audit),
-- quién cambia la anamnesis (patient_medical_history_audit) y quién abre el
-- portal (portal_access_log), pero no quién del equipo LEE una ficha. Ante
-- una sospecha de acceso indebido ("alguien de recepción curioseó la ficha
-- de un conocido") la clínica no podía mostrar quién la abrió.
--
-- Diseño, el mismo que la auditoría de notas (20260907200000) y el registro
-- de exportaciones (20261019120000):
--
--  * Nadie inserta directo. La única puerta es registrar_lectura_ficha(),
--    SECURITY DEFINER, que ESTAMPA el actor con auth.uid(), deriva la clínica
--    del paciente y exige que quien lee sea miembro de esa clínica. Lo peor
--    que puede fabricar un usuario llamando el RPC a mano es una lectura
--    SUYA de un paciente de SU clínica: se autoincrimina, no inculpa a otro.
--  * La llaman las server functions que cargan cada sección de la ficha
--    (src/lib/clinical/lecturas-ficha.ts), no el navegador.
--  * Deduplicación: una fila por usuario + paciente + sección cada 15
--    minutos. Abrir y cerrar pestañas de la ficha diez veces seguidas no
--    llena la tabla de ruido, y una lectura de otro día sí queda.
--  * Solo la leen owner/admin de la clínica (can_manage_clinic). Nadie
--    edita ni borra: no hay políticas de UPDATE/DELETE y, además, un trigger
--    lo impide también al rol de servicio. La única excepción es la cascada
--    al borrar la CLÍNICA entera (cuando la clínica deja Esmalia).
--  * patient_id y actor_id SIN clave foránea, a propósito: la lección de
--    20260907220000 es que un registro de auditoría que impide borrar un
--    paciente o un usuario deja de ser registro y pasa a ser un candado, y un
--    ON DELETE SET NULL sería una edición del registro. El id queda como
--    referencia aunque el paciente o el usuario ya no existan.
--
-- Retención: sin purga automática por ahora. El plazo (la recomendación es
-- 5 años, igual que la ficha) lo valida el abogado; cuando esté, va en una
-- migración aparte con su función de purga.
--
-- La app falla ABIERTA: si esta migración todavía no se aplicó, o el RPC
-- falla, la ficha se muestra igual y el error va a Sentry. Un registro de
-- auditoría que no anda no puede dejar a un dentista sin ver la alergia de
-- su paciente.

begin;

CREATE TABLE IF NOT EXISTS public.clinical_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  section text NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_access_log_section_check CHECK (
    section IN ('datos', 'notas', 'odontograma', 'periodontograma', 'anamnesis', 'documentos')
  )
);

-- Pantalla de Compliance: lecturas de la clínica por fecha.
CREATE INDEX IF NOT EXISTS clinical_access_log_clinic_accessed_idx
  ON public.clinical_access_log (clinic_id, accessed_at DESC);
-- "Quién abrió la ficha de este paciente".
CREATE INDEX IF NOT EXISTS clinical_access_log_patient_accessed_idx
  ON public.clinical_access_log (clinic_id, patient_id, accessed_at DESC);
-- Deduplicación dentro de registrar_lectura_ficha().
CREATE INDEX IF NOT EXISTS clinical_access_log_dedup_idx
  ON public.clinical_access_log (actor_id, patient_id, section, accessed_at DESC);

ALTER TABLE public.clinical_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinical_access_log_select_managers ON public.clinical_access_log;
CREATE POLICY clinical_access_log_select_managers ON public.clinical_access_log
  FOR SELECT TO authenticated
  USING (public.can_manage_clinic(clinic_id));

-- Sin políticas de INSERT/UPDATE/DELETE a propósito. Se parte de cero y se
-- concede solo SELECT a la app (filtrado por la RLS de arriba) y todo al rol
-- de servicio (backup diario). El trigger de abajo frena UPDATE/DELETE
-- también para el rol de servicio.
REVOKE ALL ON public.clinical_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clinical_access_log TO authenticated;
GRANT ALL ON public.clinical_access_log TO service_role;

COMMENT ON TABLE public.clinical_access_log IS
  'Lecturas de la ficha clínica por el equipo (SEG-02). Solo inserción vía registrar_lectura_ficha(), que estampa el actor; una fila por usuario/paciente/sección cada 15 min. La leen owner/admin. Inmutable: solo se borra en cascada con la clínica.';

-- Inmutabilidad. La cascada de ON DELETE CASCADE corre después de borrar la
-- clínica, así que en ese momento la clínica ya no existe: ese es el único
-- DELETE que se deja pasar.
CREATE OR REPLACE FUNCTION public.clinical_access_log_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.id = OLD.clinic_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'El registro de lecturas de la ficha no se edita ni se borra.'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.clinical_access_log_inmutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clinical_access_log_inmutable ON public.clinical_access_log;
CREATE TRIGGER clinical_access_log_inmutable
  BEFORE UPDATE OR DELETE ON public.clinical_access_log
  FOR EACH ROW EXECUTE FUNCTION public.clinical_access_log_inmutable();

-- La puerta de entrada. Devuelve true si anotó la lectura y false si ya
-- había una del mismo usuario, paciente y sección en los últimos 15 minutos.
CREATE OR REPLACE FUNCTION public.registrar_lectura_ficha(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_seccion text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'sin permiso para leer fichas de esta clinica' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
     WHERE p.id = p_patient_id AND p.clinic_id = p_clinic_id
  ) THEN
    RAISE EXCEPTION 'el paciente no pertenece a esta clinica' USING ERRCODE = '42501';
  END IF;

  -- Las pestañas de la ficha cargan en paralelo y a veces dos veces la misma
  -- sección (odontograma vigente + historial): sin este candado, dos
  -- llamadas simultáneas pasan las dos el chequeo de abajo y anotan doble.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':' || p_patient_id::text || ':' || coalesce(p_seccion, ''), 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.clinical_access_log l
     WHERE l.actor_id = v_actor
       AND l.patient_id = p_patient_id
       AND l.section = p_seccion
       AND l.accessed_at > now() - interval '15 minutes'
  ) THEN
    RETURN false;
  END IF;

  -- Una sección fuera del vocabulario la rechaza el CHECK de la tabla.
  INSERT INTO public.clinical_access_log (clinic_id, patient_id, actor_id, section)
  VALUES (p_clinic_id, p_patient_id, v_actor, p_seccion);

  RETURN true;
END;
$$;

-- `REVOKE ... FROM PUBLIC` no alcanza en Supabase: anon recibe EXECUTE por
-- default privileges (ver 20261007000000 y tests/permisos-funciones-definer).
REVOKE ALL ON FUNCTION public.registrar_lectura_ficha(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_lectura_ficha(uuid, uuid, text) TO authenticated, service_role;

commit;
