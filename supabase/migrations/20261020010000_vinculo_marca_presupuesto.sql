-- PR 11b del rediseño A+ (plan del 19-oct-2026): vínculo entre la marca del
-- odontograma y el ítem del presupuesto.
--
-- Para qué: la ficha nueva sugiere sumar al presupuesto cada marca "por
-- realizar" (PR 11). Sin el vínculo no hay forma de saber si esa marca ya se
-- presupuestó, y la sugerencia volvería a aparecer cada vez que se abre la
-- pieza. Con el vínculo, una marca ya presupuestada no se sugiere de nuevo y
-- el odontograma puede decir "ya presupuestada".
--
-- Qué cambia:
--   1. `quote_items.odontogram_mark_id uuid NULL` con FK a
--      `odontogram_marks(id) ON DELETE SET NULL`. Nullable: todo ítem que ya
--      existe queda en NULL (regla 11) y sigue igual. Si la marca se borra (no
--      hay política de DELETE para usuarios, pero sí el CASCADE del paciente
--      o un borrado de soporte), el ítem queda en NULL sin error.
--   2. Índice parcial por la columna: lo usan la consulta "¿esta marca ya
--      está en un presupuesto?" y el ON DELETE SET NULL.
--   3. `validar_vinculo_marca_presupuesto` (BEFORE INSERT/UPDATE): la marca
--      tiene que ser de la misma clínica y del mismo paciente que el
--      presupuesto. La FK sola no alcanza: la verificación de una FK ignora
--      RLS, así que sin esto se podría colgar un ítem de una marca de otra
--      clínica conociendo su id.
--
-- No toca `odontogram_marks` (regla 9: la marca se lee, nunca se edita) ni
-- las políticas de `quote_items`: la columna nueva queda bajo las mismas
-- políticas de escritura por rol y la restrictiva `mfa_exige_aal2`
-- (20261019230000). No hay tabla nueva, así que `scripts/backup-tables.mjs`
-- no cambia.
--
-- Se aplica con psql en autocommit o con `npx supabase db query --linked -f`
-- (docs/RUNBOOK_MIGRACIONES.md). Es idempotente.

-- ─── 1. Columna ─────────────────────────────────────────────────────────────
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS odontogram_mark_id uuid
    REFERENCES public.odontogram_marks(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quote_items.odontogram_mark_id IS
  'Marca del odontograma que originó el ítem (sugerencia "por realizar" de la ficha). NULL = ítem cargado a mano o marca borrada.';

-- ─── 2. Índice ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS quote_items_odontogram_mark_idx
  ON public.quote_items (odontogram_mark_id)
  WHERE odontogram_mark_id IS NOT NULL;

-- ─── 3. Misma clínica y mismo paciente ──────────────────────────────────────
-- SECURITY DEFINER porque recepción puede escribir `quote_items` pero no lee
-- `odontogram_marks` (RLS clínica): la validación tiene que ver la marca
-- igual. El mensaje no dice de quién es la marca: solo que no corresponde.
CREATE OR REPLACE FUNCTION public.validar_vinculo_marca_presupuesto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.odontogram_mark_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.odontogram_marks m
      JOIN public.quotes q ON q.id = NEW.quote_id
     WHERE m.id = NEW.odontogram_mark_id
       AND m.clinic_id = NEW.clinic_id
       AND q.clinic_id = NEW.clinic_id
       AND m.patient_id = q.patient_id
  ) THEN
    RAISE EXCEPTION 'La marca del odontograma no corresponde a este presupuesto.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_items_validar_vinculo_marca ON public.quote_items;
CREATE TRIGGER quote_items_validar_vinculo_marca
  BEFORE INSERT OR UPDATE OF odontogram_mark_id, quote_id, clinic_id ON public.quote_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_vinculo_marca_presupuesto();

-- Función de trigger: nadie la llama por RPC (regla 1, 20261013000100).
REVOKE EXECUTE ON FUNCTION public.validar_vinculo_marca_presupuesto()
  FROM PUBLIC, anon, authenticated;

-- Verificación después de aplicar (solo lectura):
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_name = 'quote_items' AND column_name = 'odontogram_mark_id';
--   SELECT count(*) FROM public.quote_items WHERE odontogram_mark_id IS NOT NULL;  -- 0
