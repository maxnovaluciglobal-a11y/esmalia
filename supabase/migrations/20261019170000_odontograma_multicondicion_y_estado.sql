-- Odontograma multi-condición, estado existente/planificado y catálogo
-- completo (auditoría 360 del 18-oct-2026: CLI-01, CLI-02, CLI-03).
--
-- Hasta acá `close_previous_odontogram_mark` cerraba la marca vigente por
-- (paciente, pieza, superficie): en la pieza completa cabía UNA sola
-- condición, y registrar una corona borraba la endodoncia. Además no había
-- forma de decir "esto está por hacer" ni "esta obturación está en mal
-- estado", que es la lectura que exige la NTS N° 188-MINSA de Perú
-- (azul = buen estado, rojo = mal estado / patológico) y la que espera
-- cualquier odontólogo de la región (rojo = por hacer).
--
-- Qué cambia:
--   1. 19 condiciones nuevas en `tooth_condition` (al final del enum).
--   2. `odontogram_marks.status` ('existente' | 'planificado') y
--      `odontogram_marks.conservation` ('bueno' | 'malo' | NULL).
--   3. `odontogram_condition_catalog`: alcance (pieza / superficie / ambos),
--      grupo de reemplazo y categoría de cada condición. Es la misma tabla
--      que `CONDITION_CATALOG` en src/lib/clinical/odontogram.ts;
--      tests/odontograma-reglas.test.ts compara las dos.
--   4. `validate_odontogram_mark` (BEFORE INSERT): alcance, superficies
--      admitidas, "por realizar" solo para tratamientos y bueno/malo solo para
--      tratamientos existentes.
--   5. `close_previous_odontogram_mark` (AFTER INSERT) con la regla nueva,
--      igual a `marcasQueReemplaza` en src/lib/clinical/odontograma-reglas.ts:
--        a. mismo grupo + misma zona + mismo estado → se reemplaza;
--        b. una existente cierra la planificada de la misma condición y zona;
--        c. "sano" limpia su zona, y cualquier otra marca cierra el "sano"
--           vigente de su superficie o de la pieza completa;
--        d. ausente (existente) cierra todo lo de la pieza, salvo puente,
--           prótesis e implante planificado.
--   6. Las marcas que ya existen (12 en prod el 18-oct) se mapean al modelo
--      nuevo SIN UPDATE de ninguna marca (regla 9 del CLAUDE.md): las
--      columnas nuevas toman 'existente' / NULL por defecto, y lo que la regla
--      vieja dejó mal se corrige insertando una marca nueva (ver sección 6).
--
-- Se aplica con psql en autocommit (CLAUDE.md, regla 5). Los valores nuevos
-- del enum NO se usan como literal de enum en este archivo: todo compara
-- `condition::text`, para no caer en "unsafe use of new enum value" si se
-- corre dentro de una transacción.

-- ─── 1. Condiciones nuevas (CLI-03) ─────────────────────────────────────────
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'restos_radiculares';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'extraccion_indicada';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'en_erupcion';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'retenida';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'supernumeraria';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'diastema';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'giroversion';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'migracion';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'transposicion';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'perno_munon';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'carilla';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'incrustacion';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'puente';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'aparato_ortodoncia';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'desgaste';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'fluorosis';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'hipoplasia';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'mancha_blanca';
ALTER TYPE public.tooth_condition ADD VALUE IF NOT EXISTS 'fosas_fisuras_profundas';

-- ─── 2. Estado del registro y conservación (CLI-02) ─────────────────────────
-- Texto + CHECK y no enum: no hace falta tocar `Enums` en types.ts y el
-- vocabulario es chico y cerrado. Las marcas existentes quedan 'existente'
-- (es lo que eran: hallazgos registrados) y conservación NULL = "sin
-- especificar" (regla 11: placeholder nullable en vez de inventar "bueno").
ALTER TABLE public.odontogram_marks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'existente',
  ADD COLUMN IF NOT EXISTS conservation text;

ALTER TABLE public.odontogram_marks
  DROP CONSTRAINT IF EXISTS odontogram_marks_status_check,
  ADD CONSTRAINT odontogram_marks_status_check
    CHECK (status IN ('existente', 'planificado')),
  DROP CONSTRAINT IF EXISTS odontogram_marks_conservation_check,
  ADD CONSTRAINT odontogram_marks_conservation_check
    CHECK (conservation IS NULL OR (conservation IN ('bueno', 'malo') AND status = 'existente'));

COMMENT ON COLUMN public.odontogram_marks.status IS
  'existente = está en la boca; planificado = indicado, por realizar (CLI-02).';
COMMENT ON COLUMN public.odontogram_marks.conservation IS
  'bueno | malo para un tratamiento existente; NULL = sin especificar o no aplica (CLI-02).';

-- ─── 3. Catálogo de condiciones ─────────────────────────────────────────────
-- `condition` es text (no el enum) para poder sembrar los valores nuevos en
-- la misma corrida. alcance: pieza | superficie | ambos. grupo: grupo de
-- reemplazo. categoria: sano | patologia | tratamiento | hallazgo.
-- superficies: caras admitidas cuando no son las cinco.
CREATE TABLE IF NOT EXISTS public.odontogram_condition_catalog (
  condition text PRIMARY KEY,
  alcance text NOT NULL CHECK (alcance IN ('pieza', 'superficie', 'ambos')),
  grupo text NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('sano', 'patologia', 'tratamiento', 'hallazgo')),
  superficies text[]
);

COMMENT ON TABLE public.odontogram_condition_catalog IS
  'Alcance, grupo de reemplazo y categoría de cada tooth_condition. Espejo de CONDITION_CATALOG (src/lib/clinical/odontogram.ts). Solo lo leen los triggers.';

-- Fail-closed: RLS sin políticas. La app usa el catálogo de TypeScript; acá
-- solo lo leen los triggers SECURITY DEFINER.
ALTER TABLE public.odontogram_condition_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.odontogram_condition_catalog FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.odontogram_condition_catalog TO service_role;

INSERT INTO public.odontogram_condition_catalog (condition, alcance, grupo, categoria, superficies) VALUES
  ('sano',                    'ambos',      'sano',               'sano',        NULL),
  ('caries',                  'superficie', 'superficie',         'patologia',   NULL),
  ('obturacion',              'superficie', 'superficie',         'tratamiento', NULL),
  ('endodoncia',              'pieza',      'endodoncia',         'tratamiento', NULL),
  ('corona',                  'pieza',      'corona',             'tratamiento', NULL),
  ('implante',                'pieza',      'presencia',          'tratamiento', NULL),
  ('ausente',                 'pieza',      'presencia',          'hallazgo',    NULL),
  ('sellante',                'superficie', 'superficie',         'tratamiento', NULL),
  ('fractura',                'ambos',      'fractura',           'patologia',   NULL),
  ('protesis',                'pieza',      'protesis',           'tratamiento', NULL),
  ('restos_radiculares',      'pieza',      'presencia',          'patologia',   NULL),
  ('extraccion_indicada',     'pieza',      'presencia',          'patologia',   NULL),
  ('en_erupcion',             'pieza',      'presencia',          'hallazgo',    NULL),
  ('retenida',                'pieza',      'presencia',          'hallazgo',    NULL),
  ('supernumeraria',          'pieza',      'supernumeraria',     'hallazgo',    NULL),
  ('diastema',                'superficie', 'diastema',           'hallazgo',    ARRAY['mesial','distal']),
  ('giroversion',             'pieza',      'giroversion',        'hallazgo',    NULL),
  ('migracion',               'pieza',      'migracion',          'hallazgo',    NULL),
  ('transposicion',           'pieza',      'transposicion',      'hallazgo',    NULL),
  ('perno_munon',             'pieza',      'perno_munon',        'tratamiento', NULL),
  ('carilla',                 'superficie', 'superficie',         'tratamiento', ARRAY['vestibular']),
  ('incrustacion',            'superficie', 'superficie',         'tratamiento', NULL),
  ('puente',                  'pieza',      'puente',             'tratamiento', NULL),
  ('aparato_ortodoncia',      'pieza',      'aparato_ortodoncia', 'tratamiento', NULL),
  ('desgaste',                'superficie', 'desgaste',           'patologia',   NULL),
  ('fluorosis',               'pieza',      'fluorosis',          'hallazgo',    NULL),
  ('hipoplasia',              'pieza',      'hipoplasia',         'hallazgo',    NULL),
  ('mancha_blanca',           'superficie', 'superficie',         'patologia',   NULL),
  ('fosas_fisuras_profundas', 'superficie', 'superficie',         'hallazgo',    ARRAY['oclusal'])
ON CONFLICT (condition) DO UPDATE
  SET alcance = EXCLUDED.alcance,
      grupo = EXCLUDED.grupo,
      categoria = EXCLUDED.categoria,
      superficies = EXCLUDED.superficies;

-- ─── 4. Validación al insertar ──────────────────────────────────────────────
-- Misma regla que `validarMarca` (odontograma-reglas.ts). Solo aplica a
-- marcas NUEVAS: las viejas que quedaron fuera de regla (ej. una caries en
-- "pieza completa") siguen siendo historia válida.
CREATE OR REPLACE FUNCTION public.validate_odontogram_mark()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.odontogram_condition_catalog%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.odontogram_condition_catalog WHERE condition = NEW.condition::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La condición % no está en el catálogo del odontograma.', NEW.condition
      USING ERRCODE = '23514';
  END IF;

  IF c.alcance = 'pieza' AND NEW.surface <> 'whole' THEN
    RAISE EXCEPTION 'Esta condición se registra en la pieza completa.' USING ERRCODE = '23514';
  END IF;
  IF c.alcance = 'superficie' AND NEW.surface = 'whole' THEN
    RAISE EXCEPTION 'Esta condición se registra en una superficie, no en la pieza completa.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.surface <> 'whole' AND c.superficies IS NOT NULL
     AND NOT (NEW.surface::text = ANY (c.superficies)) THEN
    RAISE EXCEPTION 'Esta condición no se registra en esa superficie.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'planificado' AND c.categoria <> 'tratamiento' THEN
    RAISE EXCEPTION 'Solo un tratamiento puede quedar por realizar.' USING ERRCODE = '23514';
  END IF;
  IF NEW.conservation IS NOT NULL
     AND NOT (NEW.status = 'existente' AND c.categoria = 'tratamiento') THEN
    RAISE EXCEPTION 'El buen o mal estado solo aplica a un tratamiento existente.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS odontogram_validate ON public.odontogram_marks;
CREATE TRIGGER odontogram_validate
  BEFORE INSERT ON public.odontogram_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_odontogram_mark();

-- ─── 5. Regla de reemplazo (CLI-01) ─────────────────────────────────────────
-- Mismo nombre y mismo trigger AFTER INSERT de 20260812190000: solo cambia
-- QUÉ marcas cierra. Sigue sin haber UPDATE de usuario sobre una marca: solo
-- este trigger SECURITY DEFINER escribe superseded_at/superseded_by.
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

-- El trigger `odontogram_close_previous` ya apunta a esta función; se
-- recrea igual por si la migración se aplica sobre una base reconstruida.
DROP TRIGGER IF EXISTS odontogram_close_previous ON public.odontogram_marks;
CREATE TRIGGER odontogram_close_previous
  AFTER INSERT ON public.odontogram_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.close_previous_odontogram_mark();

-- Funciones de trigger: nadie las llama por RPC (ver 20261013000100).
REVOKE EXECUTE ON FUNCTION public.validate_odontogram_mark() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_previous_odontogram_mark() FROM PUBLIC, anon, authenticated;

-- ─── 6. Mapear las marcas existentes al modelo nuevo ────────────────────────
-- Nada se edita: se INSERTA una marca nueva que reemplaza (por el trigger de
-- arriba) o restituye. El historial queda completo y cada marca agregada
-- dice en `notes` por qué está. recorded_by = quien registró la original.

-- 6a. Restituir lo que la regla vieja cerró sin motivo clínico: una marca
-- de tratamiento u hallazgo que se cerró solo porque en la misma superficie
-- se registró OTRA condición de otro grupo (el caso típico: endodoncia y
-- después corona en la pieza completa). No se restituye:
--   - una patología (una caries "reemplazada" por una obturación o una
--     corona se trató);
--   - lo cerrado por "sano" o "ausente";
--   - si después se registró algo del mismo grupo en esa zona, o la pieza
--     quedó ausente o "sana";
--   - si la zona de destino no es válida para la condición (ej. una
--     obturación marcada en la pieza completa: no se sabe en qué cara).
WITH candidatas AS (
  SELECT v.*,
         cv.grupo AS v_grupo,
         cv.alcance AS v_alcance,
         s.condition::text AS s_condition,
         CASE WHEN cv.alcance = 'pieza' THEN 'whole'::public.tooth_surface ELSE v.surface END
           AS destino
    FROM public.odontogram_marks v
    JOIN public.odontogram_condition_catalog cv ON cv.condition = v.condition::text
    JOIN public.odontogram_marks s ON s.id = v.superseded_by
    JOIN public.odontogram_condition_catalog cs ON cs.condition = s.condition::text
   WHERE v.superseded_at IS NOT NULL
     AND cv.categoria IN ('tratamiento', 'hallazgo')
     AND cs.grupo <> cv.grupo
     AND s.condition::text NOT IN ('sano', 'ausente')
     AND NOT (cv.alcance = 'superficie' AND v.surface = 'whole')
)
INSERT INTO public.odontogram_marks
  (clinic_id, patient_id, tooth_number, surface, condition, material, notes, recorded_by, status)
SELECT k.clinic_id, k.patient_id, k.tooth_number, k.destino, k.condition, k.material,
       concat_ws(' · ', k.notes,
         'Restituida por la migración 20261019170000: la regla anterior la cerró al registrar '
         || k.s_condition || ' en la misma superficie.'),
       k.recorded_by, 'existente'
  FROM candidatas k
 WHERE NOT EXISTS (
         -- Algo más nuevo del mismo grupo en la misma zona: esa es la vigente.
         SELECT 1
           FROM public.odontogram_marks x
           JOIN public.odontogram_condition_catalog cx ON cx.condition = x.condition::text
          WHERE x.patient_id = k.patient_id
            AND x.tooth_number = k.tooth_number
            AND x.id <> k.id
            AND x.recorded_at > k.recorded_at
            AND cx.grupo = k.v_grupo
            AND (x.surface = k.surface OR x.surface = k.destino OR k.v_alcance = 'pieza'))
   AND NOT EXISTS (
         -- La pieza quedó ausente, o alguien la marcó sana, después del cierre.
         SELECT 1
           FROM public.odontogram_marks x
          WHERE x.patient_id = k.patient_id
            AND x.tooth_number = k.tooth_number
            AND x.recorded_at >= k.superseded_at
            AND (x.condition::text = 'ausente'
                 OR (x.condition::text = 'sano' AND (x.surface = 'whole' OR x.surface = k.surface))));

-- 6b. Llevar a la pieza completa lo que hoy es de pieza y quedó en una
-- superficie (la UI vieja dejaba marcar "endodoncia en mesial"). Una sola
-- marca por pieza y condición; el trigger cierra las de superficie.
INSERT INTO public.odontogram_marks
  (clinic_id, patient_id, tooth_number, surface, condition, material, notes, recorded_by, status)
SELECT DISTINCT ON (m.patient_id, m.tooth_number, m.condition)
       m.clinic_id, m.patient_id, m.tooth_number, 'whole'::public.tooth_surface, m.condition,
       m.material,
       concat_ws(' · ', m.notes,
         'Llevada a pieza completa por la migración 20261019170000 (estaba en '
         || m.surface::text || ').'),
       m.recorded_by, 'existente'
  FROM public.odontogram_marks m
  JOIN public.odontogram_condition_catalog c ON c.condition = m.condition::text
 WHERE m.superseded_at IS NULL
   AND c.alcance = 'pieza'
   AND m.surface <> 'whole'
 ORDER BY m.patient_id, m.tooth_number, m.condition, m.recorded_at DESC;

-- Verificación después de aplicar (solo lectura):
--   SELECT condition, surface, status, conservation, count(*)
--     FROM public.odontogram_marks WHERE superseded_at IS NULL
--    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2;
--   SELECT count(*) FROM public.odontogram_marks
--    WHERE notes LIKE '%migración 20261019170000%';
