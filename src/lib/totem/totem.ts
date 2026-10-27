import { z } from "zod";

/**
 * Tótem de la sala de espera (Ola 14 · AUT-01 a AUT-03, AUT-05): lógica pura.
 *
 * El tótem es un dispositivo público. Tras cada uso vuelve solo a la pantalla
 * inicial: por inactividad (`SEGUNDOS_INACTIVIDAD`) o al terminar
 * (`SEGUNDOS_PANTALLA_FINAL`). La sesión del paciente vive en la memoria de la
 * página (nunca en el navegador) y en la base dura 3 minutos.
 */

export const SEGUNDOS_INACTIVIDAD = 45;
export const SEGUNDOS_PANTALLA_FINAL = 12;
/** Cada cuánto la TV y el box piden el estado. */
export const SEGUNDOS_REFRESCO_SALA = 5;
export const SEGUNDOS_REFRESCO_BOX = 10;

export const TIPOS_VERIFICACION = ["telefono", "nacimiento"] as const;
export type TipoVerificacion = (typeof TIPOS_VERIFICACION)[number];

export const ETIQUETA_VERIFICACION: Record<
  TipoVerificacion,
  { titulo: string; ayuda: string; marcador: string }
> = {
  telefono: {
    titulo: "Últimos 4 dígitos de tu teléfono",
    ayuda: "El teléfono que dejaste en la clínica.",
    marcador: "0000",
  },
  nacimiento: {
    titulo: "Día y mes de tu nacimiento",
    ayuda: "Dos dígitos para el día y dos para el mes. Ejemplo: 0703 es 7 de marzo.",
    marcador: "DDMM",
  },
};

/** Solo dígitos; 4 exactos o null. */
export function normalizarVerificacion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "");
  return d.length === 4 ? d : null;
}

/** DDMM con día 1-31 y mes 1-12 (el resto lo decide la base). */
export function esDiaYMesPosible(ddmm: string): boolean {
  if (!/^\d{4}$/.test(ddmm)) return false;
  const dia = Number(ddmm.slice(0, 2));
  const mes = Number(ddmm.slice(2));
  return dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12;
}

export const IdentificacionSchema = z.object({
  rut: z.string().trim().min(3).max(20),
  tipo: z.enum(TIPOS_VERIFICACION),
  valor: z.string().max(12),
});

/** Mensajes que ve el paciente. Nunca dicen si el RUT existe o no. */
export function mensajeDeTotem(motivo: string | null, restantes?: number | null): string {
  switch (motivo) {
    case "datos":
      return restantes != null && restantes > 0
        ? `No pudimos encontrarte con esos datos. Revisa e intenta de nuevo (te quedan ${restantes} ${restantes === 1 ? "intento" : "intentos"}).`
        : "No pudimos encontrarte con esos datos. Revisa e intenta de nuevo.";
    case "bloqueado_rut":
      return "Por seguridad pausamos los intentos con este RUT. Acércate a recepción y te ayudamos.";
    case "bloqueado_dispositivo":
      return "Hubo muchos intentos seguidos en este tótem. Espera unos minutos o acércate a recepción.";
    case "sesion":
      return "Tu sesión terminó. Vuelve a identificarte.";
    case "fuera_de_horario":
      return "Tu cita no está dentro del horario para marcar llegada. Acércate a recepción.";
    case "ocupado":
      return "Esa hora acaba de ocuparse. Elige otra.";
    case "fuera_de_plazo":
      return "Esa hora ya no se puede agendar desde aquí. Elige otra.";
    case "demasiadas_reservas":
      return "Ya tienes varias horas pendientes de aceptar. Acércate a recepción para agendar otra.";
    case "apagada":
      return "Agendar desde el tótem no está disponible. Acércate a recepción.";
    case "dispositivo":
      return "Este tótem no está habilitado. Avisa en recepción.";
    default:
      return "No pudimos completar la acción. Acércate a recepción y te ayudamos.";
  }
}

// ─── Pantalla del box ────────────────────────────────────────────────────

export type EstadoCitaBox =
  "tentativa" | "confirmada" | "en-sala" | "ausente" | "finalizada" | "cancelada";

export interface CitaDeBox {
  id: string;
  inicio: string;
  fin: string;
  estado: EstadoCitaBox;
  llamadoEn: string | null;
  llamadoAqui: boolean;
}

const PENDIENTE: ReadonlySet<EstadoCitaBox> = new Set(["tentativa", "confirmada", "en-sala"]);

/**
 * Cita actual del box (la última llamada a este box que sigue en sala), la
 * siguiente (primero quien ya llegó; si no, la próxima de la agenda), sin
 * contar a quien ya fue llamado, y a quién se puede llamar (solo alguien que
 * ya está en sala).
 */
export function actualYSiguiente<T extends CitaDeBox>(
  citas: readonly T[],
  ahora: Date = new Date(),
): { actual: T | null; siguiente: T | null; llamable: T | null } {
  const porInicio = [...citas].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const actual =
    porInicio
      .filter((c) => c.estado === "en-sala" && c.llamadoAqui && c.llamadoEn)
      .sort((a, b) => (b.llamadoEn ?? "").localeCompare(a.llamadoEn ?? ""))[0] ?? null;
  // Quien ya fue llamado (y sigue en sala: se está atendiendo o espera
  // terminar) no vuelve a ser "el siguiente"; se llama otra vez desde la agenda.
  const pendientes = porInicio.filter(
    (c) => c.id !== actual?.id && PENDIENTE.has(c.estado) && !c.llamadoEn,
  );
  const llamable = pendientes.find((c) => c.estado === "en-sala") ?? null;
  const siguiente =
    llamable ?? pendientes.find((c) => new Date(c.fin).getTime() > ahora.getTime()) ?? null;
  return { actual, siguiente, llamable };
}
