-- Plantilla de reprogramación de cita (rediseño A+, PR 9), parte 2 de 2.
--
-- Siembra la plantilla de WhatsApp `appointment_rescheduled` en todas las
-- clínicas (también la demo: el backfill recorre `clinics` completa y corre
-- como postgres, así que `block_demo_writes` no la frena) y en cada clínica
-- nueva vía handle_new_clinic().
--
-- Texto aprobado por Walter (19-oct-2026), en tuteo. Variables con los
-- nombres que ya usa renderTemplate: {paciente}, {clinica}, {fecha_larga}
-- (el "día" del brief, ej. "martes 14 de octubre"), {hora} y {profesional}.
-- Es el mismo texto que la plantilla de Meta esmalia_cita_reprogramada_v1
-- (meta-plantillas.ts), así que al conectar WhatsApp oficial la fila se
-- reutiliza en vez de duplicarse.
--
-- handle_new_clinic() se redefine copiando exactamente 20260901120200 (la
-- última versión) más la fila nueva, para no perder ninguna plantilla.

CREATE OR REPLACE FUNCTION public.handle_new_clinic()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.clinic_members (clinic_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.message_templates (clinic_id, kind, name, channel, subject, body, created_by)
  VALUES
    (NEW.id, 'appointment_reminder', 'Recordatorio 48h antes', 'whatsapp', NULL,
     'Hola {paciente}, te recordamos tu cita de {tratamiento} el {fecha_larga} a las {hora}. Para confirmar responde SÍ, o RE para reagendar. Nos vemos en {clinica}. 🦷',
     NEW.created_by),
    (NEW.id, 'appointment_checkin', 'Aviso 3h antes', 'whatsapp', NULL,
     'Hola {paciente}, en unas horas es tu cita de {tratamiento} a las {hora} en {clinica}. ¡Te esperamos! Si no puedes venir, avísanos por acá.',
     NEW.created_by),
    (NEW.id, 'appointment_confirmation', 'Confirmación de cita nueva', 'whatsapp', NULL,
     'Hola {paciente}, tu cita quedó agendada: {tratamiento} el {fecha_larga} a las {hora} con {profesional}. Cualquier cambio, avísanos por acá. — {clinica}',
     NEW.created_by),
    (NEW.id, 'quote_sent', 'Envío de presupuesto', 'whatsapp', NULL,
     'Hola {paciente}, te compartimos el presupuesto {numero_presupuesto} por {total}. Cualquier duda, dinos y coordinamos cuando quieras arrancar. — {clinica}',
     NEW.created_by),
    (NEW.id, 'payment_receipt', 'Recibo de pago', 'whatsapp', NULL,
     'Hola {paciente}, recibimos tu pago de {monto} el {fecha}. Saldo pendiente: {saldo}. ¡Gracias! — {clinica}',
     NEW.created_by),
    (NEW.id, 'appointment_confirmation', 'Confirmación de cita (email)', 'email',
     'Tu cita en {clinica} quedó confirmada',
     '<p>Hola {paciente},</p><p>Tu cita quedó agendada:</p><ul><li><strong>Tratamiento:</strong> {tratamiento}</li><li><strong>Fecha:</strong> {fecha_larga}</li><li><strong>Hora:</strong> {hora}</li><li><strong>Profesional:</strong> {profesional}</li></ul><p>Cualquier cambio, responde este correo o escríbenos por WhatsApp.</p><p>— {clinica}</p>',
     NEW.created_by),
    (NEW.id, 'appointment_reminder', 'Recordatorio de cita (email)', 'email',
     'Recordatorio: tu cita en {clinica} es el {fecha_larga}',
     '<p>Hola {paciente},</p><p>Te recordamos tu cita:</p><ul><li><strong>Tratamiento:</strong> {tratamiento}</li><li><strong>Fecha:</strong> {fecha_larga}</li><li><strong>Hora:</strong> {hora}</li></ul><p>Si necesitas reagendar, escríbenos por WhatsApp o responde este correo.</p><p>— {clinica}</p>',
     NEW.created_by),
    (NEW.id, 'nps_survey', 'Encuesta de satisfacción', 'whatsapp', NULL,
     'Hola {paciente}, ¿cómo fue tu experiencia con {tratamiento} en {clinica}? Responde con una nota del 1 al 10 (10 = excelente) y cuéntanos qué mejorarías. ¡Gracias por ayudarnos a mejorar! 🙏',
     NEW.created_by),
    (NEW.id, 'nps_survey', 'Encuesta de satisfacción (email)', 'email',
     '¿Cómo fue tu experiencia en {clinica}?',
     '<p>Hola {paciente},</p><p>Queremos saber cómo fue tu experiencia con <strong>{tratamiento}</strong> en {clinica}.</p><p>Responde este correo con una nota del <strong>1 al 10</strong> (10 = excelente) y, si quieres, cuéntanos qué mejorarías.</p><p>¡Gracias por ayudarnos a mejorar!</p><p>— {clinica}</p>',
     NEW.created_by),
    (NEW.id, 'appointment_checkin', 'Aviso 3h antes (email)', 'email',
     'En unas horas es tu cita en {clinica}',
     '<p>Hola {paciente},</p><p>En unas horas es tu cita de {tratamiento} a las {hora} en {clinica}. ¡Te esperamos!</p><p>Si no puedes venir, escríbenos por WhatsApp o responde este correo.</p><p>— {clinica}</p>',
     NEW.created_by),
    (NEW.id, 'quote_sent', 'Envío de presupuesto (email)', 'email',
     'Tu presupuesto de {clinica}',
     '<p>Hola {paciente},</p><p>Te compartimos el presupuesto <strong>{numero_presupuesto}</strong> por <strong>{total}</strong>.</p><p>Cualquier duda, responde este correo o escríbenos por WhatsApp y coordinamos cuando quieras arrancar.</p><p>— {clinica}</p>',
     NEW.created_by),
    (NEW.id, 'payment_receipt', 'Recibo de pago (email)', 'email',
     'Recibimos tu pago — {clinica}',
     '<p>Hola {paciente},</p><p>Recibimos tu pago de <strong>{monto}</strong> el {fecha}.</p><p>Saldo pendiente: {saldo}.</p><p>¡Gracias!</p><p>— {clinica}</p>',
     NEW.created_by),
    (NEW.id, 'commission_settled', 'Comisión liquidada (email)', 'email',
     'Tu comisión de {periodo} quedó liquidada',
     '<p>Hola {profesional},</p><p>Se cerró tu liquidación de comisiones del período <strong>{periodo}</strong>.</p><p>Monto liquidado: <strong>{monto}</strong>.</p><p>Cualquier duda sobre el cálculo, escríbenos.</p><p>— {clinica}</p>',
     NEW.created_by),
    -- PR 9 (A+): aviso al paciente cuando se mueve su cita.
    (NEW.id, 'appointment_rescheduled', 'Aviso de reprogramación', 'whatsapp', NULL,
     'Hola {paciente}, tu cita en {clinica} cambió al {fecha_larga} a las {hora} con {profesional}. Si no te sirve, responde a este mensaje',
     NEW.created_by)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

-- Backfill idempotente para las clínicas que ya existen. ON CONFLICT contra
-- UNIQUE(clinic_id, kind, name).
INSERT INTO public.message_templates (clinic_id, kind, name, channel, subject, body, created_by)
SELECT c.id, 'appointment_rescheduled', 'Aviso de reprogramación', 'whatsapp', NULL,
       'Hola {paciente}, tu cita en {clinica} cambió al {fecha_larga} a las {hora} con {profesional}. Si no te sirve, responde a este mensaje',
       c.created_by
FROM public.clinics c
ON CONFLICT DO NOTHING;
