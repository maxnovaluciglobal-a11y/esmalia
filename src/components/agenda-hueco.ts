import { HORA_INICIO, HORAS_VISIBLES } from "@/lib/clinic-operations/clinic-data";

/**
 * Lógica pura de la grilla de día: huecos libres, la semilla de "Nueva cita"
 * al hacer clic en uno, y la línea "ahora".
 *
 * Todo trabaja en "minutos desde HORA_INICIO", la misma unidad que
 * `Cita.inicio`, y en hora de pared (wall-clock) de la sucursal: el
 * `<input type="datetime-local">` de Nueva cita viaja crudo y el servidor lo
 * interpreta en el huso de la sucursal (`wallTimeInTzToUtc`). Acá NO se
 * convierte ningún huso, a propósito.
 */

/** Granularidad de los huecos clicables y del redondeo de la semilla. */
export const PASO_HUECO_MIN = 15;

/** Minutos que muestra la grilla (de HORA_INICIO a HORA_INICIO + HORAS_VISIBLES). */
export const MINUTOS_VISIBLES = HORAS_VISIBLES * 60;

/** Tramo que dibuja la grilla, en minutos desde HORA_INICIO y en horas en punto. */
export interface RangoGrilla {
  desde: number;
  hasta: number;
}

/**
 * La jornada base (HORA_INICIO a HORA_INICIO + HORAS_VISIBLES), estirada hasta
 * la hora en punto que cubre la cita más temprana y la más tardía. Antes la
 * grilla era fija de 08:00 a 15:00: las citas de la tarde quedaban colgando
 * debajo de la última línea y las de antes de las 08:00 tapadas por el
 * encabezado (revisión en producción, 08-oct-2026). Nunca sale del día.
 */
export function rangoDeGrilla(citas: { inicio: number; duracion: number }[]): RangoGrilla {
  let desde = 0;
  let hasta = HORAS_VISIBLES * 60;
  for (const c of citas) {
    desde = Math.min(desde, c.inicio);
    hasta = Math.max(hasta, c.inicio + c.duracion);
  }
  return {
    desde: Math.max(-HORA_INICIO * 60, Math.floor(desde / 60) * 60),
    hasta: Math.min((24 - HORA_INICIO) * 60, Math.ceil(hasta / 60) * 60),
  };
}

/**
 * Redondea hacia abajo al cuarto de hora: un clic en 10:38 agenda a las 10:30,
 * el inicio de la franja donde cayó el clic (nunca la siguiente, que podría
 * estar ocupada). Puede ser negativo (antes de HORA_INICIO, si la grilla se
 * estiró hacia arriba), pero nunca antes de las 00:00.
 */
export function redondearACuarto(minutos: number, paso: number = PASO_HUECO_MIN): number {
  if (!Number.isFinite(minutos)) return 0;
  // El paso sale de la configuración de la agenda (AGE-10: 10, 15, 20 o 30).
  return Math.max(-HORA_INICIO * 60, Math.floor(minutos / paso) * paso);
}

/** Minutos desde HORA_INICIO → "HH:mm" (hora de pared). */
export function horaDeMinutos(minutos: number): string {
  const total = HORA_INICIO * 60 + minutos;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface SemillaCita {
  /** "YYYY-MM-DDTHH:mm", listo para un `<input type="datetime-local">`. */
  startsAt: string;
  profesionalId: string;
  /** "" si el profesional no tiene sucursal asignada: el diálogo la pide. */
  sucursalId: string;
}

/** Lo que precarga "Nueva cita" al hacer clic en un hueco de la grilla. */
export function semillaDeHueco({
  fecha,
  minutos,
  profesional,
  paso = PASO_HUECO_MIN,
}: {
  /** ISO yyyy-mm-dd de la vista. */
  fecha: string;
  /** Minutos desde HORA_INICIO donde cayó el clic (se redondean). */
  minutos: number;
  profesional: { id: string; sucursalId?: string | null };
  /** Intervalo de la grilla (AGE-10). */
  paso?: number;
}): SemillaCita {
  return {
    startsAt: `${fecha}T${horaDeMinutos(redondearACuarto(minutos, paso))}`,
    profesionalId: profesional.id,
    sucursalId: profesional.sucursalId ?? "",
  };
}

/**
 * Inicios (en minutos desde HORA_INICIO) de las franjas de PASO_HUECO_MIN que
 * no se pisan con ninguna cita. Una franja parcialmente ocupada NO es libre:
 * el bloque de la cita la tapa y el clic caería sobre la cita.
 */
export function huecosLibres(
  citas: { inicio: number; duracion: number }[],
  hasta = MINUTOS_VISIBLES,
  desde = 0,
  paso: number = PASO_HUECO_MIN,
): number[] {
  const libres: number[] = [];
  for (let s = desde; s + paso <= hasta; s += paso) {
    const fin = s + paso;
    const ocupado = citas.some((c) => c.inicio < fin && c.inicio + c.duracion > s);
    if (!ocupado) libres.push(s);
  }
  return libres;
}

export function etiquetaHueco(nombreProfesional: string, minutos: number): string {
  return `Agendar con ${nombreProfesional} a las ${horaDeMinutos(minutos)}`;
}

/**
 * Minutos desde HORA_INICIO de `ahora` en el huso de la clínica. Puede dar
 * negativo (antes de abrir) o pasarse de MINUTOS_VISIBLES: quien dibuja
 * decide si la línea entra en la grilla.
 */
export function minutosAhoraEnZona(timeZone: string | undefined, ahora: Date): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(partes.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m - HORA_INICIO * 60;
}

/** "Dra. Paz Rojas" → "PR". Sin títulos (Dr., Dra.). */
export function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter((w) => w && !/^(dr|dra|od|lic)\.?$/i.test(w));
  const letras = palabras.length > 1 ? [palabras[0], palabras[palabras.length - 1]] : palabras;
  return letras.map((w) => w[0]?.toUpperCase() ?? "").join("") || "·";
}
