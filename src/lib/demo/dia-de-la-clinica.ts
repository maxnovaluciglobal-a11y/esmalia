/**
 * Días de la clínica demo, en su huso y no en UTC (regla 7 de `CLAUDE.md`).
 *
 * Lógica pura, sin base de datos: la usan los pasos de siembra
 * (`reseteo.server.ts`), la comprobación "¿la demo está al día?" y los tests
 * que simulan el cambio de día entre UTC y Santiago. Reproduce el origen del
 * "Cobrado hoy: $0" de la Caja: entre las 21:00 de Chile y la medianoche UTC
 * ya es otro día en UTC pero no en la clínica, y pasada la medianoche de la
 * clínica "hoy" es un día sin ningún dato sembrado hasta el próximo reseteo.
 */

export const ZONA_DE_LA_DEMO = "America/Santiago";

/** Día civil (AAAA-MM-DD) de un instante en el huso dado. */
export function diaEnLaZona(zona: string, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona || ZONA_DE_LA_DEMO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Suma días a una fecha civil AAAA-MM-DD (aritmética de calendario, sin huso). */
export function sumarDiasCiviles(dia: string, dias: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d + dias));
  return fecha.toISOString().slice(0, 10);
}

/**
 * ¿El reseteo de la demo es del día de hoy de la clínica? `reseteadaEn` es el
 * `created_at` de la fila de `clinics` (la función de reseteo la borra y la
 * vuelve a crear, así que su fecha es la del último reseteo).
 */
export function reseteoEsDeHoy(
  reseteadaEn: string | null | undefined,
  zona: string = ZONA_DE_LA_DEMO,
  ahora: Date = new Date(),
): boolean {
  if (!reseteadaEn) return false;
  return diaEnLaZona(zona, new Date(reseteadaEn)) === diaEnLaZona(zona, ahora);
}

export type EstadoDeLaDemo =
  /** Reseteo de hoy y todas las áreas con datos: no hay nada que hacer. */
  | "al-dia"
  /** Reseteo de hoy pero faltan áreas (por ejemplo un reseteo a medias): basta volver a sembrar. */
  | "completar"
  /** El reseteo es de otro día de la clínica (o no hay clínica): hay que rehacerla entera. */
  | "reiniciar";

/** Decide qué hace falta a partir de la fecha del reseteo y de las áreas que quedaron vacías. */
export function estadoDeLaDemo(params: {
  reseteadaEn: string | null | undefined;
  areasVacias: readonly string[];
  zona?: string;
  ahora?: Date;
}): EstadoDeLaDemo {
  if (!reseteoEsDeHoy(params.reseteadaEn, params.zona, params.ahora)) return "reiniciar";
  return params.areasVacias.length > 0 ? "completar" : "al-dia";
}
