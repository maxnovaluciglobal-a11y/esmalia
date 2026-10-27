-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 10 · frente C · EQU-02: dos roles nuevos en `app_role`.
--
--   coordinator    → "Coordinación": operación diaria (agenda, pacientes, caja
--                    y finanzas), sin historia clínica ni gestión del equipo.
--   lab_technician → "Técnico/a dental": órdenes de laboratorio e inventario,
--                    sin historia clínica ni pagos.
--
-- Solo agrega valores al enum (aditivo, no toca filas). Va SOLO en este
-- archivo porque Postgres no deja usar un valor nuevo de un enum en la misma
-- transacción que lo crea (`unsafe use of new enum value`): las políticas y
-- funciones que los usan están en 20261106300100 y 20261106300200.
--
-- Cómo aplicarla: camino A del runbook sirve (este archivo no usa los valores
-- nuevos), pero tiene que quedar CONFIRMADA antes de aplicar 20261106300100.
-- Con el camino B, sin `--single-transaction` para este archivo.
--
-- Reversa: Postgres no permite quitar valores de un enum. Si hiciera falta,
-- basta con no asignar estos roles (ningún integrante los tiene al aplicar
-- esta migración) y revertir 20261106300100/300200, que son las que les dan
-- acceso a algo.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.app_role add value if not exists 'coordinator';
alter type public.app_role add value if not exists 'lab_technician';
