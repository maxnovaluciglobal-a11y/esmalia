-- Arqueo de caja por denominación (PR 12 del rediseño A+, flag de UI
-- `caja-arqueo-v2`). Decisión de Walter del 19-oct-2026: además del total
-- contado, se guarda el detalle por billete y moneda del cierre.
--
-- Columna nueva y nullable (regla 11): un cierre con "Ingresar total", o
-- cualquier cierre anterior a esta migración, queda en NULL. No se inventa
-- un detalle para la historia.
--
-- Forma (la arma y valida el servidor, `src/lib/finance/denominaciones.ts`):
--   { "version": 1, "currency": "CLP", "totalCents": 231000,
--     "filas": [ { "valorCents": 20000, "tipo": "billete", "cantidad": 8 }, ... ] }
-- La suma de las filas es igual a `declared_closing_cents` (lo exige el
-- servidor antes de cerrar).
--
-- Es una columna de una tabla que ya existe: `scripts/backup-tables.mjs` ya
-- respalda `cash_registers` entera y la RLS de la tabla la cubre sin cambios.

ALTER TABLE public.cash_registers
  ADD COLUMN closing_denominations jsonb NULL;

-- Solo una caja cerrada lleva detalle, y el detalle es un objeto JSON.
ALTER TABLE public.cash_registers
  ADD CONSTRAINT cash_registers_closing_denominations_check
  CHECK (
    closing_denominations IS NULL
    OR (status = 'closed' AND jsonb_typeof(closing_denominations) = 'object')
  );

COMMENT ON COLUMN public.cash_registers.closing_denominations IS
  'Conteo del arqueo por billete y moneda (version, currency, totalCents, filas[valorCents, tipo, cantidad]). NULL si se ingresó solo el total.';
