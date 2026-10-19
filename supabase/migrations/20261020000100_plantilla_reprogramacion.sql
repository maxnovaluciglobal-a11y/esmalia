-- Plantilla de reprogramación de cita (rediseño A+, PR 9), parte 1 de 2.
--
-- La agenda va a permitir mover una cita arrastrándola (PR 10) y ofrecer
-- "¿Avisar al paciente?". No había plantilla para ese aviso: hace falta el
-- kind `appointment_rescheduled`.
--
-- Solo el valor del enum. Postgres no deja usar un valor agregado con
-- `ALTER TYPE ... ADD VALUE` en la misma transacción ("unsafe use of new enum
-- value"), así que la siembra va en 20261020000200. Mismo criterio que
-- 20260827060000 / 20260827060100.
--
-- Versión: la asignada era 20261020000000, pero esa ya la usa
-- 20261020000000_extender_prueba.sql (#86) y dos archivos con la misma
-- versión rompen schema_migrations.

ALTER TYPE public.message_template_kind ADD VALUE IF NOT EXISTS 'appointment_rescheduled';
