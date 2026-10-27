-- Ola 9 · ODO-08: observación libre por pieza en el odontograma.
--
-- La observación es una marca más de `odontogram_marks` con la condición
-- nueva `observacion` (pieza completa, texto en `notes`). Así hereda todo lo
-- que ya tiene la tabla: RLS clínica, `mfa_exige_aal2`, exportación, backup,
-- fusión de fichas y lectura registrada. Versionada como evento (regla 9 del
-- CLAUDE.md): cambiar la observación es INSERTAR una nueva, y el trigger
-- cierra la anterior. Borrarla es insertar una observación vacía.
--
-- Qué cambia:
--   1. `tooth_condition` suma 'observacion' (al final del enum).
--   2. `odontogram_condition_catalog`: fila de la condición (pieza, grupo
--      propio, categoría hallazgo). La validación existente
--      (`validate_odontogram_mark`) ya exige pieza completa, sin "por
--      realizar" ni buen/mal estado.
--   3. `close_previous_odontogram_mark` (redefinida a partir de su definición
--      en producción, leída el 27-oct-2026, idéntica a la de 20261019170000):
--      una observación solo cierra la observación vigente de la misma pieza,
--      y ninguna otra marca la cierra. Sin esto, anotar algo en la pieza
--      cerraba el "sano" vigente, y registrar "sano" o "ausente" borraba la
--      nota. El resto de la regla queda igual, carácter por carácter.
--
-- Aditiva y compatible con el código en producción: el código actual nunca
-- envía 'observacion' y no lee la fila nueva del catálogo.
--
-- Se aplica con `npx supabase db query --linked -f "<ruta absoluta>"` o con
-- psql en autocommit (docs/RUNBOOK_MIGRACIONES.md). El valor nuevo del enum
-- NO se usa como literal de enum en este archivo (todo compara
-- `condition::text`), así que corre también dentro de una transacción.
--
-- Cómo revertir (no borra datos; las observaciones guardadas quedan como
-- historia y la app vieja no las muestra):
--   -- 1) volver a la regla anterior: re-ejecutar la sección 5 de
--   --    20261019170000_odontograma_multicondicion_y_estado.sql
--   --    (CREATE OR REPLACE FUNCTION public.close_previous_odontogram_mark).
--   -- 2) DELETE FROM public.odontogram_condition_catalog WHERE condition = 'observacion';
--   --    (con eso `validate_odontogram_mark` rechaza observaciones nuevas)
--   -- El valor del enum no se quita (Postgres no permite DROP VALUE); queda sin uso.

-- ─── 1. Condición nueva ────────────────────────────────────────────────────
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'observacion';

-- ─── 2. Catálogo ───────────────────────────────────────────────────────────
-- Mismo formato que el INSERT de 20261019170000: tests/odontograma-reglas.test.ts
-- lee las dos migraciones y compara con CONDITION_CATALOG.
INSERT INTO public.odontogram_condition_catalog (condition, alcance, grupo, categoria, superficies) VALUES
  ('observacion',             'pieza',      'observacion',        'hallazgo',    NULL)
ON CONFLICT (condition) DO UPDATE
  SET alcance = EXCLUDED.alcance,
      grupo = EXCLUDED.grupo,
      categoria = EXCLUDED.categoria,
      superficies = EXCLUDED.superficies;

-- ─── 3. Regla de reemplazo con la observación aparte ──────────────────────
CREATE OR REPLACE FUNCTION public.close_previous_odontogram_mark()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cond text := NEW.condition::text;
  v_grupo text;
  v_alcance text;
BEGIN
  -- ODO-08: la observación de la pieza solo reemplaza a la observación
  -- vigente de esa misma pieza, y no toca ninguna otra marca.
  IF v_cond = 'observacion' THEN
    UPDATE public.odontogram_marks m
       SET superseded_at = NEW.recorded_at,
           superseded_by = NEW.id
     WHERE m.clinic_id = NEW.clinic_id
       AND m.patient_id = NEW.patient_id
       AND m.tooth_number = NEW.tooth_number
       AND m.superseded_at IS NULL
       AND m.id <> NEW.id
       AND m.condition::text = 'observacion';
    RETURN NEW;
  END IF;

  SELECT grupo, alcance INTO v_grupo, v_alcance
    FROM public.odontogram_condition_catalog
   WHERE condition = v_cond;

  UPDATE public.odontogram_marks m
     SET superseded_at = NEW.recorded_at,
         superseded_by = NEW.id
    FROM public.odontogram_condition_catalog c
   WHERE c.condition = m.condition::text
     AND m.clinic_id = NEW.clinic_id
     AND m.patient_id = NEW.patient_id
     AND m.tooth_number = NEW.tooth_number
     AND m.superseded_at IS NULL
     AND m.id <> NEW.id
     -- ODO-08: ninguna condición clínica cierra la observación de la pieza.
     AND m.condition::text <> 'observacion'
     AND (
       -- c. "sano" limpia su zona (la superficie, o toda la pieza).
       (v_cond = 'sano' AND (NEW.surface = 'whole' OR m.surface = NEW.surface))
       -- c. cualquier otra marca cierra el "sano" de su superficie o de la pieza.
       OR (v_cond <> 'sano' AND m.condition::text = 'sano'
           AND (m.surface = NEW.surface OR m.surface = 'whole' OR NEW.surface = 'whole'))
       -- d. ausente existente cierra todo, salvo lo que rehabilita la ausencia.
       OR (v_cond = 'ausente' AND NEW.status = 'existente'
           AND (m.condition::text NOT IN ('implante', 'puente', 'protesis')
                OR (m.condition::text = 'implante' AND m.status = 'existente')))
       -- a/b. misma zona: mismo grupo y estado, o el plan que se cumplió.
       OR (v_cond <> 'sano' AND m.condition::text <> 'sano'
           AND CASE
                 WHEN NEW.surface <> 'whole' THEN m.surface = NEW.surface
                 ELSE m.surface = 'whole' OR v_alcance = 'pieza'
               END
           AND ((c.grupo = v_grupo AND m.status = NEW.status)
                OR (NEW.status = 'existente' AND m.status = 'planificado'
                    AND m.condition = NEW.condition)))
     );
  RETURN NEW;
END;
$$;

-- Función de trigger: nadie la llama por RPC (regla 1, 20261013000100).
REVOKE EXECUTE ON FUNCTION public.close_previous_odontogram_mark() FROM PUBLIC, anon, authenticated;

-- Verificación después de aplicar (solo lectura):
--   SELECT * FROM public.odontogram_condition_catalog WHERE condition = 'observacion';
--   SELECT 'observacion' = ANY (enum_range(NULL::public.tooth_condition)::text[]);
--   SELECT has_function_privilege('anon', 'public.close_previous_odontogram_mark()', 'execute'); -- false
