import type { MessageTemplateKind } from "@/lib/messaging/messaging";

/**
 * Plantillas de email que el código trae de fábrica para los avisos que no
 * tienen fila propia en `message_templates`. Si la clínica carga la suya
 * (canal email, mismo kind, activa), manda la de la clínica.
 *
 * Existe para que "Presupuestos sin respuesta" pueda ofrecer email sin una
 * migración que siembre la plantilla en cada clínica. `body` es HTML: se
 * renderiza con `renderTemplateHtml`, que escapa los valores.
 */
export const PLANTILLAS_EMAIL_DE_RESPALDO: Partial<
  Record<MessageTemplateKind, { subject: string; body: string }>
> = {
  quote_follow_up: {
    subject: "Tu presupuesto {numero_presupuesto} en {clinica}",
    body:
      "<p>Hola {paciente},</p>" +
      "<p>Te escribimos de {clinica} por el presupuesto {numero_presupuesto} por {total}. " +
      "Sigue disponible y queremos saber si pudiste revisarlo.</p>" +
      "<p>Si tienes dudas sobre el tratamiento, los plazos o las formas de pago, " +
      "responde este correo y lo vemos contigo. Si prefieres agendar directamente, " +
      "también puedes hacerlo respondiendo aquí.</p>" +
      "<p>Saludos,<br>{clinica}</p>",
  },
};
