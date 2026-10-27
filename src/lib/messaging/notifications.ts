export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  noteId: string | null;
  patientRef: string | null;
  readAt: string | null;
  createdAt: string;
}

export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  review_requested: "Revisión solicitada",
  review_approved: "Nota aprobada",
  review_changes_requested: "Cambios solicitados",
  review_comment: "Nuevo comentario",
  review_cancelled: "Revisión cancelada",
  inbound_message: "Mensaje de un paciente",
  patient_opt_out: "Un paciente pidió la baja",
  whatsapp_lead: "Contacto nuevo por WhatsApp",
  patient_confirmed_appointment: "Un paciente avisó que viene",
  daily_digest: "Resumen del día",
  appointment_request: "Un paciente pide hora",
  stock_low: "Stock bajo",
};

/**
 * Filtros por tipo del centro de notificaciones (NAV-11). Cada grupo junta
 * los `kind` que se leen igual para quien los recibe. Un tipo nuevo que no
 * esté acá cae en "Operación" (nunca se pierde de la bandeja).
 */
export const GRUPOS_DE_NOTIFICACION = [
  {
    id: "clinico",
    label: "Notas clínicas",
    kinds: [
      "review_requested",
      "review_approved",
      "review_changes_requested",
      "review_comment",
      "review_cancelled",
    ],
  },
  {
    id: "pacientes",
    label: "Pacientes",
    kinds: [
      "inbound_message",
      "patient_opt_out",
      "whatsapp_lead",
      "patient_confirmed_appointment",
      "appointment_request",
    ],
  },
  { id: "operacion", label: "Operación", kinds: ["stock_low", "daily_digest"] },
] as const;

export type GrupoDeNotificacion = (typeof GRUPOS_DE_NOTIFICACION)[number]["id"];

export function esGrupoDeNotificacion(v: unknown): v is GrupoDeNotificacion {
  return GRUPOS_DE_NOTIFICACION.some((g) => g.id === v);
}

/** Grupo al que pertenece un `kind` (los desconocidos van a "operacion"). */
export function grupoDeNotificacion(kind: string): GrupoDeNotificacion {
  for (const g of GRUPOS_DE_NOTIFICACION) {
    if ((g.kinds as readonly string[]).includes(kind)) return g.id;
  }
  return "operacion";
}

/** Kinds conocidos de los demás grupos (para filtrar "operacion" por exclusión). */
export function kindsFueraDe(grupo: GrupoDeNotificacion): string[] {
  return GRUPOS_DE_NOTIFICACION.filter((g) => g.id !== grupo).flatMap((g) => [...g.kinds]);
}

/**
 * Destino de una notificación dentro de la app: la ficha del paciente si la
 * trae, si no el `link` guardado, solo si es una ruta interna (empieza con
 * "/" y no con "//"). Nunca un enlace externo desde un aviso.
 */
export function destinoDeNotificacion(
  n: Pick<AppNotification, "patientRef" | "link">,
): { tipo: "paciente"; pacienteId: string } | { tipo: "ruta"; href: string } | null {
  if (n.patientRef) return { tipo: "paciente", pacienteId: n.patientRef };
  const link = n.link?.trim();
  if (link && link.startsWith("/") && !link.startsWith("//") && !link.includes("\\")) {
    return { tipo: "ruta", href: link };
  }
  return null;
}

/** Formatea la antigüedad de una notificación en lenguaje natural. */
export function tiempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} d`;
}
