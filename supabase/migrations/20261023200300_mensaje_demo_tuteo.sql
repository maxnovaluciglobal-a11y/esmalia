-- Texto de la demo en tuteo neutro (regla 17), visto en la validación de la
-- Ola 2: al guardar una cita en la demo salía "Creá tu clínica real…".
-- Misma función que la de producción (pg_get_functiondef del 23-oct-2026),
-- solo cambia el mensaje. No toca datos ni permisos.

CREATE OR REPLACE FUNCTION public.block_demo_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic_id uuid;
BEGIN
  IF current_user IN ('service_role', 'postgres') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_clinic_id := COALESCE(NEW.clinic_id, OLD.clinic_id);
  IF EXISTS (SELECT 1 FROM public.clinics WHERE id = v_clinic_id AND is_demo) THEN
    RAISE EXCEPTION 'Esta es la clínica demo, de solo lectura. Crea tu clínica real para guardar cambios.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Cómo revertir: volver a crear la función con el texto anterior
-- (migración 20260815180000_cecaa56e-…).
