-- Tipos de cita por clínica (AGE-11, Ola 1 · frente cita).
--
-- Recepción necesita decir QUÉ es la cita además de con quién y a qué hora:
-- primera evaluación, control, urgencia… Hasta hoy eso se escribía a mano en
-- "Tratamiento / motivo" y no se podía filtrar ni contar. Ahora cada clínica
-- tiene su propia lista (editable en Ajustes → Estados y tipos de cita) y la
-- cita guarda el tipo elegido.
--
-- Compatible con el código en producción (RUNBOOK_MIGRACIONES, regla 3):
-- una tabla nueva y dos columnas NULLABLE en `appointments`. El código viejo
-- no las lee ni las escribe.
--
-- Regla 10 (snapshots inmutables de catálogo): la cita guarda el id del tipo
-- (FK con ON DELETE SET NULL) y además el nombre que tenía al agendarse. Si
-- la clínica renombra o borra un tipo, las citas viejas siguen diciendo lo que
-- decían.

CREATE TABLE IF NOT EXISTS public.appointment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  position smallint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Un nombre por clínica, sin importar mayúsculas ni espacios de más.
CREATE UNIQUE INDEX IF NOT EXISTS appointment_types_clinic_name_key
  ON public.appointment_types (clinic_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS appointment_types_clinic_idx
  ON public.appointment_types (clinic_id, is_active, position);

CREATE TRIGGER appointment_types_updated_at BEFORE UPDATE ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointment_types TO authenticated;
GRANT ALL ON public.appointment_types TO service_role;
ALTER TABLE public.appointment_types ENABLE ROW LEVEL SECURITY;

-- Leer: cualquier miembro (lo usa el formulario de cita). Escribir: owner y
-- admin (`can_manage_clinic`), igual que los estados de cita. Una política
-- por comando (ver 20261020120000_rls_politicas_por_comando.sql).
CREATE POLICY "appointment_types_select_members" ON public.appointment_types
  FOR SELECT TO authenticated USING (public.is_clinic_member(clinic_id));
CREATE POLICY "appointment_types_insert_managers" ON public.appointment_types
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "appointment_types_update_managers" ON public.appointment_types
  FOR UPDATE TO authenticated
  USING (public.can_manage_clinic(clinic_id))
  WITH CHECK (public.can_manage_clinic(clinic_id));
CREATE POLICY "appointment_types_delete_managers" ON public.appointment_types
  FOR DELETE TO authenticated
  USING (public.can_manage_clinic(clinic_id));

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS appointment_type_id uuid
    REFERENCES public.appointment_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_type_name text
    CHECK (appointment_type_name IS NULL OR char_length(appointment_type_name) <= 60);

CREATE INDEX IF NOT EXISTS appointments_appointment_type_idx
  ON public.appointments (clinic_id, appointment_type_id)
  WHERE appointment_type_id IS NOT NULL;

-- El tipo de una cita tiene que ser de la misma clínica que la cita: sin esto,
-- alguien con el id de un tipo ajeno podría colgarlo de su cita (la FK sola no
-- mira la clínica). El nombre se copia del catálogo y no viaja desde el
-- cliente, así el snapshot no se puede falsear.
CREATE OR REPLACE FUNCTION public.appointments_tipo_de_cita()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_nombre text;
BEGIN
  IF NEW.appointment_type_id IS NULL THEN
    -- Al crear, sin tipo no hay nombre. Al editar se respeta lo que llega:
    -- cuando se borra un tipo del catálogo, el ON DELETE SET NULL pasa por
    -- acá y la cita tiene que conservar el nombre con el que se agendó.
    -- Quitar el tipo a mano (la app) manda también el nombre en NULL.
    IF TG_OP = 'INSERT' THEN
      NEW.appointment_type_name := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.appointment_type_id IS NOT DISTINCT FROM OLD.appointment_type_id
     AND NEW.clinic_id IS NOT DISTINCT FROM OLD.clinic_id THEN
    -- Mismo tipo: se conserva el nombre con el que se agendó (snapshot).
    NEW.appointment_type_name := OLD.appointment_type_name;
    RETURN NEW;
  END IF;
  SELECT t.name INTO v_nombre
  FROM public.appointment_types t
  WHERE t.id = NEW.appointment_type_id
    AND t.clinic_id = NEW.clinic_id;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'El tipo de cita no existe o no es de esta clínica.'
      USING ERRCODE = '23503';
  END IF;
  NEW.appointment_type_name := v_nombre;
  RETURN NEW;
END;
$$;

-- En todo UPDATE (no solo `OF appointment_type_id`): así tampoco se puede
-- reescribir el nombre guardado mandando solo `appointment_type_name`.
CREATE TRIGGER appointments_tipo_de_cita
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_tipo_de_cita();

-- Lista inicial. La función es SECURITY DEFINER porque corre en el INSERT de
-- la clínica, antes de que quien la crea sea miembro (la RLS de
-- appointment_types todavía no lo dejaría insertar). Mismo patrón que
-- seed_clinic_appointment_statuses.
CREATE OR REPLACE FUNCTION public.seed_clinic_appointment_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.appointment_types (clinic_id, name, position)
  VALUES
    (NEW.id, '1ª evaluación', 0),
    (NEW.id, 'Control', 1),
    (NEW.id, 'Urgencia', 2),
    (NEW.id, 'Presupuesto', 3),
    (NEW.id, 'Tratamiento', 4),
    (NEW.id, 'Retiro de puntos', 5),
    (NEW.id, 'Otro', 6)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_clinic_appointment_types() FROM PUBLIC, anon;

CREATE TRIGGER on_clinic_created_appointment_types
  AFTER INSERT ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.seed_clinic_appointment_types();

-- Clínicas que ya existen.
INSERT INTO public.appointment_types (clinic_id, name, position)
SELECT c.id, v.name, v.position
FROM public.clinics c
CROSS JOIN (VALUES
  ('1ª evaluación', 0::smallint),
  ('Control', 1::smallint),
  ('Urgencia', 2::smallint),
  ('Presupuesto', 3::smallint),
  ('Tratamiento', 4::smallint),
  ('Retiro de puntos', 5::smallint),
  ('Otro', 6::smallint)
) AS v(name, position)
ON CONFLICT DO NOTHING;
