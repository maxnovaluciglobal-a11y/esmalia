-- "Exportar CSV" desde cada lista (EXP-04, Ola 6).
--
-- Bajar la lista de pacientes con sus teléfonos y correos, o la de cuentas
-- por cobrar, es sacar datos personales de la clínica igual que la
-- exportación completa, solo que más chico. Hasta ahora eso no dejaba rastro.
-- Esta migración agrega la puerta para anotarlo en el mismo registro,
-- `clinic_data_exports`, con formato `lista_csv`.
--
-- Mismo diseño que `registrar_exportacion_de_clinica` (20261019120000) y
-- `registrar_exportacion_de_paciente` (20261019260000):
--  * Nadie inserta directo en la tabla (sigue sin política de INSERT). La
--    única puerta es esta función SECURITY DEFINER, que exige ser miembro de
--    la clínica y la sesión en dos pasos si la persona activó MFA, y ESTAMPA
--    el actor con auth.uid(): no se puede anotar a nombre de otro ni en una
--    clínica ajena.
--  * El permiso por lista (patients:view, finance:view…) vive en la matriz de
--    la app (`src/lib/access/access.ts`) y lo verifica la server function
--    antes de llamar acá; la base solo garantiza membresía, actor y forma.
--    La función no entrega datos: solo anota. Los datos de la lista ya
--    vinieron por sus propias consultas, con RLS y sus gates.
--  * Lectura: sin cambios. Owner/admin ven todo el registro; cada persona,
--    sus propias exportaciones (`clinic_data_exports_select_own`).
--
-- Aditiva: no toca la tabla ni las funciones existentes. Sin esta migración
-- el botón muestra un error y no descarga nada (la app falla cerrada).

begin;

CREATE OR REPLACE FUNCTION public.registrar_exportacion_de_lista(
  p_clinic_id uuid,
  p_lista text,
  p_filas integer,
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
  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).
  IF NOT public.sesion_cumple_mfa() THEN
    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL OR NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'sin permiso para exportar listas de esta clinica' USING ERRCODE = '42501';
  END IF;
  IF p_lista IS NULL OR p_lista !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'lista invalida' USING ERRCODE = '22023';
  END IF;
  IF p_filas IS NULL OR p_filas < 0 THEN
    RAISE EXCEPTION 'cantidad de filas invalida' USING ERRCODE = '22023';
  END IF;
  -- El detalle lo arma la app (filtros aplicados, columnas): se acota para
  -- que el registro no sirva para guardar cualquier cosa.
  IF p_detalle IS NOT NULL AND (
    jsonb_typeof(p_detalle) <> 'object' OR octet_length(p_detalle::text) > 8192
  ) THEN
    RAISE EXCEPTION 'detalle invalido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clinic_data_exports (clinic_id, actor_id, formato, detalle)
  VALUES (
    p_clinic_id,
    v_actor,
    'lista_csv',
    coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object('lista', p_lista, 'filas', p_filas)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- `REVOKE ... FROM PUBLIC` no alcanza en Supabase: anon recibe EXECUTE por
-- default privileges (ver 20261007000000 y tests/permisos-funciones-definer).
REVOKE ALL ON FUNCTION public.registrar_exportacion_de_lista(uuid, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_exportacion_de_lista(uuid, text, integer, jsonb) TO authenticated;

COMMENT ON FUNCTION public.registrar_exportacion_de_lista(uuid, text, integer, jsonb) IS
  'EXP-04: anota en clinic_data_exports (formato lista_csv) cada CSV bajado desde una lista. Exige membresía y MFA si corresponde; estampa el actor. El permiso por lista lo verifica la app en el servidor.';

commit;
