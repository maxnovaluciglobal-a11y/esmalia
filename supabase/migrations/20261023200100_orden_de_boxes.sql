-- Orden de los boxes por sucursal (ADM-06, Ola 2 · frente boxes y grilla).
--
-- La pantalla de Sucursales ahora administra los boxes (crear, renombrar,
-- desactivar, reactivar y ordenar) y la agenda dibuja un carril por box en
-- ese orden. Hasta hoy el único orden era el alfabético, que pone "Box 10"
-- antes que "Box 2".
--
-- Compatible con el código en producción (RUNBOOK_MIGRACIONES, regla 3):
-- una columna NOT NULL con DEFAULT (el código viejo inserta sin ella y toma
-- 0) y un índice. La RLS de `operatories` no cambia: escribir sigue siendo
-- de owner/admin (`can_manage_clinic`, una política por comando desde
-- 20261020120000).

ALTER TABLE public.operatories
  ADD COLUMN IF NOT EXISTS position smallint NOT NULL DEFAULT 0;

-- Orden inicial: el alfabético "natural" que ya se veía (Box 2 antes que
-- Box 10), por sucursal.
WITH ordenados AS (
  SELECT id,
         (row_number() OVER (
            PARTITION BY branch_id
            ORDER BY
              substring(name FROM '\d{1,9}')::integer NULLS LAST,
              lower(name),
              created_at
          ) - 1)::smallint AS pos
    FROM public.operatories
)
UPDATE public.operatories o
   SET position = ordenados.pos
  FROM ordenados
 WHERE o.id = ordenados.id
   AND o.position = 0;

CREATE INDEX IF NOT EXISTS operatories_branch_position_idx
  ON public.operatories (branch_id, position);

-- Cómo revertir:
--   DROP INDEX IF EXISTS public.operatories_branch_position_idx;
--   ALTER TABLE public.operatories DROP COLUMN IF EXISTS position;
