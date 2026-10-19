import { META_TEMPLATE_PARAM_ORDER } from "@/lib/messaging/whatsapp";

// Plantillas que Esmalia registra en la cuenta de WhatsApp de cada clínica
// apenas conecta su número (POST /{waba_id}/message_templates). Fuera de la
// ventana de 24 h, Meta solo deja escribirle a un paciente con una plantilla
// aprobada; sin esto, todo envío caía a wa.me aunque el número estuviera
// conectado.
//
// Contrato: el {{n}} de cada texto es la posición n de
// META_TEMPLATE_PARAM_ORDER[kind]. El test meta-plantillas.test.ts lo
// verifica. Reglas de Meta que respeta cada texto: variables numeradas en
// orden, ninguna al principio ni al final del texto, y un ejemplo por
// variable.
//
// Tuteo neutro (Esmalia le escribe a pacientes de cinco países). Si se
// cambia un texto ya aprobado, subir el sufijo de versión del nombre: Meta no
// deja editar libremente una plantilla aprobada.

export type KindConPlantillaMeta = keyof typeof META_TEMPLATE_PARAM_ORDER;

export interface PlantillaMeta {
  /** Nombre en Meta: minúsculas, números y guion bajo. */
  nombre: string;
  categoria: "UTILITY" | "MARKETING";
  cuerpo: string;
  /** Un valor de ejemplo por variable, en el mismo orden. */
  ejemplos: string[];
}

export const IDIOMA_META = "es";

export const PLANTILLAS_META: Record<KindConPlantillaMeta, PlantillaMeta> = {
  appointment_reminder: {
    nombre: "esmalia_recordatorio_cita_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, te recordamos tu cita de {{2}} el {{3}} a las {{4}} en {{5}}. Si no puedes venir, responde este mensaje y la reprogramamos.",
    ejemplos: ["Valentina", "limpieza dental", "martes 14 de octubre", "10:30", "Clínica Sonrisa"],
  },
  appointment_checkin: {
    nombre: "esmalia_cita_hoy_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, hoy es tu cita de {{2}} a las {{3}} en {{4}}. Te esperamos. Si no puedes venir, avísanos respondiendo este mensaje.",
    ejemplos: ["Valentina", "control de ortodoncia", "16:00", "Clínica Sonrisa"],
  },
  appointment_rescheduled: {
    nombre: "esmalia_cita_reprogramada_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, tu cita en {{2}} cambió al {{3}} a las {{4}} con {{5}}. Si no te sirve, responde a este mensaje",
    ejemplos: ["Valentina", "Clínica Sonrisa", "jueves 16 de octubre", "11:00", "Dra. Rojas"],
  },
  hygiene_recall: {
    nombre: "esmalia_control_periodico_v1",
    categoria: "MARKETING",
    cuerpo:
      "Hola {{1}}, ya pasaron {{2}} meses desde tu última visita a {{3}}. ¿Te agendamos un control? Responde este mensaje y coordinamos el horario.",
    ejemplos: ["Benjamín", "6", "Clínica Sonrisa"],
  },
  review_request: {
    nombre: "esmalia_pedido_resena_v1",
    categoria: "MARKETING",
    cuerpo:
      "Hola {{1}}, gracias por tu visita a {{2}}. Si te sentiste bien atendido, ¿nos dejarías una reseña en Google? Nos ayuda mucho.",
    ejemplos: ["Isidora", "Clínica Sonrisa"],
  },
  payment_due: {
    nombre: "esmalia_saldo_pendiente_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, te recordamos que tienes un saldo pendiente de {{2}} en {{3}}. Responde este mensaje o acércate a la clínica para coordinar el pago.",
    ejemplos: ["Tomás", "$45.000", "Clínica Sonrisa"],
  },
  waitlist_opening: {
    nombre: "esmalia_hora_disponible_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, se liberó una hora para {{2}} en {{3}}. Como estás en la lista de espera, te la ofrecemos primero. Responde este mensaje si la quieres.",
    ejemplos: ["Josefina", "una evaluación", "Clínica Sonrisa"],
  },
  quote_follow_up: {
    nombre: "esmalia_presupuesto_pendiente_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, tu presupuesto {{2}} por {{3}} en {{4}} sigue disponible. Si quieres retomarlo o tienes dudas, responde este mensaje.",
    ejemplos: ["Agustín", "P-2026-0042", "$380.000", "Clínica Sonrisa"],
  },
  portal_invite: {
    nombre: "esmalia_acceso_portal_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}. Durante los próximos {{2}} días puedes ver tus citas y pedir hora en el portal de pacientes de {{3}}: {{4}} Si no pediste este enlace, ignora este mensaje.",
    ejemplos: ["Martina", "7", "Clínica Sonrisa", "https://esmalia.com/portal/abc123"],
  },
  birthday_greeting: {
    nombre: "esmalia_cumpleanos_v1",
    categoria: "MARKETING",
    cuerpo:
      "¡Feliz cumpleaños, {{1}}! Todo el equipo de {{2}} te manda un saludo. Que tengas un gran día.",
    ejemplos: ["Diego", "Clínica Sonrisa"],
  },
  treatment_followup: {
    nombre: "esmalia_seguimiento_tratamiento_v1",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, ¿cómo te has sentido después de tu visita a {{2}}? Si tienes cualquier duda o molestia, escríbenos por aquí.",
    ejemplos: ["Antonia", "Clínica Sonrisa"],
  },
  referral_invite: {
    nombre: "esmalia_invitacion_referido_v1",
    categoria: "MARKETING",
    cuerpo:
      "Hola {{1}}, si conoces a alguien que necesite dentista, puede escribirnos a {{2}} con tu código {{3}} y sabremos que llegó de tu parte. ¡Gracias por recomendarnos!",
    ejemplos: ["Sebastián", "Clínica Sonrisa", "A1B2C3"],
  },
  nps_survey: {
    nombre: "esmalia_encuesta_atencion_v1",
    categoria: "MARKETING",
    cuerpo:
      "Hola {{1}}, ¿cómo fue tu experiencia con {{2}} en {{3}}? Responde con un número del 0 al 10. Tu opinión nos ayuda a mejorar.",
    ejemplos: ["Valentina", "tu limpieza dental", "Clínica Sonrisa"],
  },
};

/** Cuerpo del POST /{waba_id}/message_templates para un kind. */
export function payloadPlantillaMeta(kind: KindConPlantillaMeta) {
  const p = PLANTILLAS_META[kind];
  return {
    name: p.nombre,
    language: IDIOMA_META,
    category: p.categoria,
    components: [{ type: "BODY", text: p.cuerpo, example: { body_text: [p.ejemplos] } }],
  };
}

/**
 * El mismo texto con variables con nombre ({paciente}, {clinica}…), para la
 * fila de message_templates que usa el envío manual por wa.me cuando la
 * clínica todavía no tiene la plantilla.
 */
export function cuerpoConVariables(kind: KindConPlantillaMeta): string {
  const orden = META_TEMPLATE_PARAM_ORDER[kind];
  return PLANTILLAS_META[kind].cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const nombre = orden[Number(n) - 1];
    return nombre ? `{${nombre}}` : `{{${n}}}`;
  });
}

/** Estados que informa Meta (webhook message_template_status_update) → los nuestros. */
export function estadoPlantillaDesdeMeta(evento: string): string {
  switch (evento.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    case "PENDING_DELETION":
    case "DELETED":
      return "deleted";
    default:
      return "pending";
  }
}
