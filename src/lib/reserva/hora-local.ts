import { HORA_INICIO } from "@/lib/clinic-operations/clinic-data";
import { hhmmDeMinutos } from "@/lib/clinic-operations/disponibilidad";

/**
 * Conversión entre instantes (UTC) y la hora de pared de la sucursal, en las
 * unidades del motor de disponibilidad (fecha + minutos desde HORA_INICIO).
 * Sin luxon: Intl.DateTimeFormat (respeta el horario de verano).
 */

export interface MomentoLocal {
  fecha: string;
  /** Minutos desde HORA_INICIO (puede ser negativo antes de las 8:00). */
  minutos: number;
}

export function momentoLocal(instante: Date | string, zona: string): MomentoLocal {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const h = Number(partes.hour) % 24;
  const m = Number(partes.minute);
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    minutos: (h - HORA_INICIO) * 60 + m,
  };
}

/** "YYYY-MM-DDTHH:mm" de una fecha y minutos desde HORA_INICIO. */
export function horaLocalTexto(fecha: string, minutos: number): string {
  return `${fecha}T${hhmmDeMinutos(minutos)}`;
}

/** "YYYY-MM-DDTHH:mm" → { fecha, minutos desde HORA_INICIO } o null. */
export function partirHoraLocal(local: string): MomentoLocal | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  return { fecha: m[1], minutos: (Number(m[2]) - HORA_INICIO) * 60 + Number(m[3]) };
}

/** Minutos desde HORA_INICIO → "9:30" (sin cero adelante, como en la agenda). */
export function horaCorta(minutos: number): string {
  return hhmmDeMinutos(minutos).replace(/^0/, "");
}
