export const MESSAGE_CHANNELS = ["whatsapp", "sms", "email"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_STATUSES = ["draft", "queued", "sent", "delivered", "read", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  draft: "Borrador",
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
};

export const MESSAGE_TEMPLATE_KINDS = [
  "appointment_reminder",
  "appointment_checkin",
  "appointment_confirmation",
  "quote_sent",
  "payment_receipt",
  "nps_survey",
  "custom",
  // Fase 1 WhatsApp API — agregados al enum de la DB en la migración
  // 20260816120000 pero faltaban acá: sin esto, `kind as MessageTemplateKind`
  // en el código de mapeo compila igual (es un cast) pero cualquier switch
  // exhaustivo o Record<MessageTemplateKind, T> se queda corto en silencio.
  "hygiene_recall",
  "review_request",
  "payment_due",
  // Fase 2 WhatsApp — migración 20260816150000.
  "waitlist_opening",
  "quote_follow_up",
  "portal_invite",
  // Fase 3 WhatsApp — migración 20260816160000 (whatsapp_leads, sin kind propio).
  // Fase 4 WhatsApp — migración 20260816170000.
  "birthday_greeting",
  "treatment_followup",
  "referral_invite",
  // F2 comunicaciones (auditoría 360 v2, 26-ago-2026) — migración
  // 20260827060000. Destinatario = professionals, no patients.
  "commission_settled",
  // Rediseño A+ (PR 9) — migración 20261020000100. Aviso al paciente cuando
  // se mueve su cita; lo usa el arrastre de la agenda (PR 10).
  "appointment_rescheduled",
] as const;
export type MessageTemplateKind = (typeof MESSAGE_TEMPLATE_KINDS)[number];

export const MESSAGE_TEMPLATE_KIND_LABELS: Record<MessageTemplateKind, string> = {
  appointment_reminder: "Recordatorio de cita (48h)",
  appointment_checkin: "Aviso previo (3h)",
  appointment_confirmation: "Confirmación de cita",
  quote_sent: "Envío de presupuesto",
  payment_receipt: "Recibo de pago",
  nps_survey: "Encuesta NPS",
  custom: "Personalizado",
  hygiene_recall: "Recall de higiene (6 meses)",
  review_request: "Pedido de reseña",
  payment_due: "Aviso de saldo pendiente",
  waitlist_opening: "Aviso de lista de espera",
  quote_follow_up: "Seguimiento de presupuesto",
  portal_invite: "Invitación al portal",
  birthday_greeting: "Saludo de cumpleaños",
  treatment_followup: "Seguimiento post-tratamiento",
  referral_invite: "Invitación a referir",
  commission_settled: "Comisión liquidada",
  appointment_rescheduled: "Aviso de reprogramación",
};

/**
 * Los kinds que dispara la cola de "outreach" (Fase 1+2): no son avisos
 * ligados 1:1 a una cita futura como appointment_reminder/checkin, sino
 * candidatos calculados sobre histórico (última visita, saldo, presupuesto
 * sin responder). Todos pasan por aprobación del staff en /recordatorios —
 * nunca se mandan solos desde un cron ciego (decisión de Walter: menos
 * riesgo de mandarle algo raro a un paciente sin que nadie lo vea antes).
 *
 * `waitlist_opening` y `portal_invite` NO están acá a propósito: no son
 * candidatos que se calculan solos, son acciones puntuales que el staff
 * dispara desde una fila concreta (la lista de espera, la ficha del
 * paciente) — mismo template kind, pero un flujo de UI distinto.
 */
export const OUTREACH_TEMPLATE_KINDS = [
  "hygiene_recall",
  "review_request",
  "payment_due",
  "quote_follow_up",
  "birthday_greeting",
  "treatment_followup",
  "referral_invite",
  "nps_survey",
] as const;
export type OutreachTemplateKind = (typeof OUTREACH_TEMPLATE_KINDS)[number];

export interface MessageTemplate {
  id: string;
  kind: MessageTemplateKind;
  name: string;
  channel: MessageChannel;
  body: string;
  isActive: boolean;
}

export interface Message {
  id: string;
  /** Quién lo escribió. Sin esto, un "gracias, ahí voy" del paciente se
   * renderizaba idéntico a un recordatorio de la clínica en la ficha. */
  direction: "inbound" | "outbound";
  appointmentId: string | null;
  quoteId: string | null;
  templateId: string | null;
  templateKind: MessageTemplateKind | null;
  channel: MessageChannel;
  status: MessageStatus;
  recipient: string;
  body: string;
  sentAt: string | null;
  createdAt: string;
}

/**
 * Renderiza un template sustituyendo `{variable}` por su valor.
 * Variables desconocidas se dejan como estaban — no rompen el envío ni
 * fingen un valor vacío que un humano no note.
 *
 * Nota: el caller es responsable del orden de las keys si hay reservadas
 * como `paciente` — hacer `{ ...vars, paciente: nombreReal }` (paciente al
 * final) para evitar que un cliente malicioso lo sobreescriba.
 */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key as keyof typeof vars];
    return v == null ? match : String(v);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * security-review 01-sep: variante de renderTemplate() para cuando `body` es
 * el HTML real de un email (Resend lo manda tal cual, sin sanitizar). Escapa
 * el VALOR sustituido, no el template — el `body` sigue siendo HTML de
 * verdad (`<p>`, `<br>`, etc.), solo lo que viene de `vars` (nombre de
 * paciente/clínica, editable por recepción) no puede inyectar markup.
 * `renderTemplate` (sin escapar) sigue siendo correcta para WhatsApp/SMS —
 * texto plano, nunca se interpreta como HTML.
 */
export function renderTemplateHtml(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key as keyof typeof vars];
    return v == null ? match : escapeHtml(String(v));
  });
}

// Teléfonos por país (BIL-11): la lógica vive en `telefonos.ts`. Se
// re-exporta acá porque es donde la importaban todos los callers.
export { buildWaMeUrl, normalizeToWaMe, toE164 } from "@/lib/messaging/telefonos";
