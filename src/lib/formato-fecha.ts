/**
 * Un solo sistema para mostrar fechas y horas (UX-09, Ola 0).
 *
 * Antes convivían seis formatos ("21 oct 2026", "2026-10-21", "21-10-2026",
 * "10-10-2026, 9:30:00 a. m.", "Jue, 15 Oct", "21-oct, 02:04 a. m."), cada
 * pantalla con su `toLocaleString`. Ahora todo pasa por acá:
 *
 * | variante      | ejemplo                    |
 * | ------------- | -------------------------- |
 * | `fecha`       | 21 oct 2026                |
 * | `fechaCorta`  | 21 oct                     |
 * | `fechaHora`   | 21 oct 2026, 09:30         |
 * | `fechaCortaHora` | 21 oct, 09:30           |
 * | `hora`        | 09:30 (24 h, sin segundos) |
 * | `diaSemana`   | mié 21 oct                 |
 * | `fechaLarga`  | miércoles 21 de octubre    |
 * | `fechaDocumento` | 22 de octubre de 2026   |
 * | `mesAnio`     | octubre 2026               |
 * | `relativa`    | hoy · ayer · mañana · hace 3 días |
 *
 * Reglas:
 * - Siempre en el huso de la clínica (`access.clinic?.timezone`). Sin huso,
 *   el de Chile, que es el mismo default que `hoyISO`.
 * - Una fecha civil ("2026-10-21", sin hora) no tiene huso: se muestra tal
 *   cual, sin correrla un día por el reloj del navegador.
 * - Reloj de 24 h y nunca segundos.
 * - El texto se arma pieza por pieza (`formatToParts`) para que no dependa
 *   de cómo cada versión de ICU junta "21-oct" o "21 oct.": el resultado es
 *   el mismo en el servidor, en Chrome y en Safari.
 *
 * `tests/formato-fecha.test.ts` vigila que nadie vuelva a usar
 * `toLocaleDateString`/`toLocaleString` fuera de este archivo.
 */

export const ZONA_POR_DEFECTO = "America/Santiago";
const LOCALE = "es-CL";

export type EntradaFecha = string | number | Date | null | undefined;
type Zona = string | null | undefined;

const SIN_FECHA = "—";
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `Date` + si es una fecha civil (sin hora), que se formatea en UTC. */
function aInstante(valor: EntradaFecha): { date: Date; civil: boolean } | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string" && SOLO_FECHA.test(valor)) {
    const date = new Date(`${valor}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : { date, civil: true };
  }
  const date = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(date.getTime()) ? null : { date, civil: false };
}

const cache = new Map<string, Intl.DateTimeFormat>();
function formateador(zona: string, opciones: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const clave = `${zona}|${JSON.stringify(opciones)}`;
  let f = cache.get(clave);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(LOCALE, { ...opciones, timeZone: zona });
    } catch {
      // Huso inválido guardado en la clínica: mejor la hora de Chile que romper la pantalla.
      f = new Intl.DateTimeFormat(LOCALE, { ...opciones, timeZone: ZONA_POR_DEFECTO });
    }
    cache.set(clave, f);
  }
  return f;
}

type Piezas = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;
function piezas(valor: EntradaFecha, zona: Zona, opciones: Intl.DateTimeFormatOptions) {
  const i = aInstante(valor);
  if (!i) return null;
  const tz = i.civil ? "UTC" : zona || ZONA_POR_DEFECTO;
  const out: Piezas = {};
  for (const p of formateador(tz, opciones).formatToParts(i.date)) out[p.type] = p.value;
  // "oct." / "mié." según la versión de ICU: siempre sin punto.
  if (out.month) out.month = out.month.replace(/\.$/, "");
  if (out.weekday) out.weekday = out.weekday.replace(/\.$/, "");
  return out;
}

const OPC_FECHA: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const OPC_HORA: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

/** "21 oct 2026" */
export function fecha(valor: EntradaFecha, zona?: Zona): string {
  const p = piezas(valor, zona, OPC_FECHA);
  return p ? `${p.day} ${p.month} ${p.year}` : SIN_FECHA;
}

/** "21 oct" (sin año: para listas del año en curso). */
export function fechaCorta(valor: EntradaFecha, zona?: Zona): string {
  const p = piezas(valor, zona, { day: "numeric", month: "short" });
  return p ? `${p.day} ${p.month}` : SIN_FECHA;
}

/** "09:30" (24 h). Una fecha civil no tiene hora: devuelve "—". */
export function hora(valor: EntradaFecha, zona?: Zona): string {
  const i = aInstante(valor);
  if (!i || i.civil) return SIN_FECHA;
  const p = piezas(valor, zona, OPC_HORA);
  return p ? `${p.hour}:${p.minute}` : SIN_FECHA;
}

/** "21 oct 2026, 09:30" */
export function fechaHora(valor: EntradaFecha, zona?: Zona): string {
  const i = aInstante(valor);
  if (!i) return SIN_FECHA;
  if (i.civil) return fecha(valor, zona);
  const p = piezas(valor, zona, { ...OPC_FECHA, ...OPC_HORA });
  return p ? `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}` : SIN_FECHA;
}

/** "21 oct, 09:30" (sin año: movimientos del día o de la semana). */
export function fechaCortaHora(valor: EntradaFecha, zona?: Zona): string {
  const i = aInstante(valor);
  if (!i) return SIN_FECHA;
  if (i.civil) return fechaCorta(valor, zona);
  const p = piezas(valor, zona, { day: "numeric", month: "short", ...OPC_HORA });
  return p ? `${p.day} ${p.month}, ${p.hour}:${p.minute}` : SIN_FECHA;
}

/** "mié 21 oct" */
export function diaSemana(valor: EntradaFecha, zona?: Zona): string {
  const p = piezas(valor, zona, { weekday: "short", day: "numeric", month: "short" });
  return p ? `${p.weekday} ${p.day} ${p.month}` : SIN_FECHA;
}

/** "miércoles 21 de octubre" */
export function fechaLarga(valor: EntradaFecha, zona?: Zona): string {
  const p = piezas(valor, zona, { weekday: "long", day: "numeric", month: "long" });
  return p ? `${p.weekday} ${p.day} de ${p.month}` : SIN_FECHA;
}

/** "22 de octubre de 2026" (documentos emitidos: certificados, informes). */
export function fechaDocumento(valor: EntradaFecha, zona?: Zona): string {
  const p = piezas(valor, zona, { day: "numeric", month: "long", year: "numeric" });
  return p ? `${p.day} de ${p.month} de ${p.year}` : SIN_FECHA;
}

/** "octubre 2026" */
export function mesAnio(valor: EntradaFecha, zona?: Zona): string {
  const p = piezas(valor, zona, { month: "long", year: "numeric" });
  return p ? `${p.month} ${p.year}` : SIN_FECHA;
}

/** "YYYY-MM-DD" del instante en el huso de la clínica (para comparar días). */
export function diaISO(valor: EntradaFecha, zona?: Zona): string | null {
  const p = piezas(valor, zona, { year: "numeric", month: "2-digit", day: "2-digit" });
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

const MS_DIA = 86_400_000;

/**
 * "hoy", "ayer", "mañana", "hace 3 días", "en 2 días"; más allá de una
 * semana, la fecha corta (o con año si es de otro año). Se cuenta en días
 * del calendario de la clínica, no en horas.
 */
export function relativa(valor: EntradaFecha, zona?: Zona, ahora: Date = new Date()): string {
  const dia = diaISO(valor, zona);
  const hoy = diaISO(ahora, zona);
  if (!dia || !hoy) return SIN_FECHA;
  const dif = Math.round(
    (Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / MS_DIA,
  );
  if (dif === 0) return "hoy";
  if (dif === -1) return "ayer";
  if (dif === 1) return "mañana";
  if (dif < 0 && dif >= -6) return `hace ${-dif} días`;
  if (dif > 0 && dif <= 6) return `en ${dif} días`;
  return dia.slice(0, 4) === hoy.slice(0, 4) ? fechaCorta(valor, zona) : fecha(valor, zona);
}

/** Números con separador de miles de la región (sin moneda: para eso, `formatMoney`). */
export function numero(valor: number, opciones?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALE, opciones).format(valor);
}
