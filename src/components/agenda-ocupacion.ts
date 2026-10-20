import { horarioDelDia, type BloqueHorario, type Tramo } from "@/components/agenda-arrastre";
import type { Cita } from "@/lib/clinic-operations/clinic-data";

/**
 * Ocupación por día de la vista semana (PR 10b del plan A+, flag `agenda-v2`).
 *
 * Lógica pura, sin huso ni reloj: todo en minutos desde HORA_INICIO, en hora
 * de pared de la sucursal (la misma unidad que `Cita.inicio`).
 *
 * Definición:
 *   ocupación = minutos agendados DENTRO del horario declarado
 *               ÷ minutos del horario declarado
 * sumando los profesionales de los carriles visibles.
 *
 *  - La colación no cuenta como disponible: el horario declarado ya la deja
 *    afuera (son dos tramos con un hueco en el medio).
 *  - Una cita fuera del horario declarado no suma (no hay capacidad contra
 *    la cual medirla); así el número nunca pasa de 100 %.
 *  - Dos citas que se pisan en el mismo profesional cuentan una sola vez.
 *  - Un profesional que no declaró horario no entra en la cuenta: no hay
 *    con qué comparar, y fabricar un 0 % sería mentir (regla 11).
 *  - Las canceladas ya no llegan (`listAppointments` las excluye); las
 *    "ausente" sí cuentan: el sillón estuvo reservado.
 */

export type CitaOcupacion = Pick<Cita, "fecha" | "inicio" | "duracion" | "profesionalId">;

export interface OcupacionDia {
  fecha: string;
  /** Minutos agendados dentro del horario declarado. */
  ocupados: number;
  /** Minutos del horario declarado (sin colación). */
  disponibles: number;
  /** 0-100 redondeado, o null si no hay con qué medirlo. */
  porcentaje: number | null;
  /** Por qué no hay porcentaje. */
  motivo: "sin-horario" | "sin-datos" | null;
}

/** Une intervalos que se pisan o se tocan. */
export function unirIntervalos(intervalos: Tramo[]): Tramo[] {
  const ordenados = intervalos
    .filter((t) => t.fin > t.inicio)
    .map((t) => ({ ...t }))
    .sort((a, b) => a.inicio - b.inicio);
  const unidos: Tramo[] = [];
  for (const t of ordenados) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && t.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, t.fin);
    else unidos.push(t);
  }
  return unidos;
}

/** Minutos de los tramos (ya unidos). */
export function minutosDeTramos(tramos: Tramo[]): number {
  return unirIntervalos(tramos).reduce((suma, t) => suma + (t.fin - t.inicio), 0);
}

/** Minutos de `citas` que caen dentro de `tramos`, sin contar dos veces un solape. */
export function minutosOcupados(
  citas: Pick<Cita, "inicio" | "duracion">[],
  tramos: Tramo[],
): number {
  const ocupadas = unirIntervalos(
    citas.map((c) => ({ inicio: c.inicio, fin: c.inicio + Math.max(0, c.duracion) })),
  );
  const horario = unirIntervalos(tramos);
  let total = 0;
  for (const c of ocupadas) {
    for (const t of horario) {
      const inicio = Math.max(c.inicio, t.inicio);
      const fin = Math.min(c.fin, t.fin);
      if (fin > inicio) total += fin - inicio;
    }
  }
  return total;
}

function porcentajeDe(ocupados: number, disponibles: number): number | null {
  if (disponibles <= 0) return null;
  return Math.round((Math.min(ocupados, disponibles) / disponibles) * 100);
}

export function ocupacionDelDia({
  fecha,
  citas,
  profesionalIds,
  horarios,
}: {
  fecha: string;
  /** Puede traer citas de otros días o profesionales: se filtran acá. */
  citas: CitaOcupacion[];
  profesionalIds: string[];
  /** Horario declarado por profesional (`listProfessionalSchedules`). */
  horarios: Record<string, BloqueHorario[]> | undefined;
}): OcupacionDia {
  let ocupados = 0;
  let disponibles = 0;
  for (const id of profesionalIds) {
    const horario = horarioDelDia(horarios?.[id], fecha);
    if (!horario.declarado) continue;
    disponibles += minutosDeTramos(horario.tramos);
    ocupados += minutosOcupados(
      citas.filter((c) => c.fecha === fecha && c.profesionalId === id),
      horario.tramos,
    );
  }
  const porcentaje = porcentajeDe(ocupados, disponibles);
  return {
    fecha,
    ocupados,
    disponibles,
    porcentaje,
    motivo: porcentaje === null ? "sin-horario" : null,
  };
}

/**
 * Ocupación de cada día de la semana.
 *
 * `datosDesde`: si la lista de citas vino cortada por el tope de filas
 * (`truncated`), es la fecha de la cita más vieja que llegó. Los días
 * anteriores pueden tener citas que no vinieron, así que quedan "sin datos"
 * en vez de mostrar un porcentaje falso. `listAppointments` ordena
 * descendente: lo que se pierde es el historial viejo, nunca la agenda futura.
 */
export function ocupacionDeLaSemana({
  dias,
  citas,
  profesionalIds,
  horarios,
  datosDesde = null,
}: {
  dias: string[];
  citas: CitaOcupacion[];
  profesionalIds: string[];
  horarios: Record<string, BloqueHorario[]> | undefined;
  datosDesde?: string | null;
}): Map<string, OcupacionDia> {
  const ids = new Set(profesionalIds);
  const delRango = citas.filter((c) => dias.includes(c.fecha) && ids.has(c.profesionalId));
  const resultado = new Map<string, OcupacionDia>();
  for (const fecha of dias) {
    if (datosDesde && fecha < datosDesde) {
      resultado.set(fecha, {
        fecha,
        ocupados: 0,
        disponibles: 0,
        porcentaje: null,
        motivo: "sin-datos",
      });
      continue;
    }
    resultado.set(fecha, ocupacionDelDia({ fecha, citas: delRango, profesionalIds, horarios }));
  }
  return resultado;
}

/** Fecha de la cita más vieja de la lista (para `datosDesde`), o null si está vacía. */
export function fechaMasAntigua(citas: Pick<Cita, "fecha">[]): string | null {
  let min: string | null = null;
  for (const c of citas) if (min === null || c.fecha < min) min = c.fecha;
  return min;
}

/** Texto accesible de la ocupación de un día. */
export function etiquetaOcupacion(o: OcupacionDia): string {
  if (o.porcentaje === null) {
    return o.motivo === "sin-datos"
      ? "Ocupación sin datos: hay citas antiguas que no se cargaron"
      : "Ocupación sin horario declarado";
  }
  return `Ocupación ${o.porcentaje} %: ${o.ocupados} de ${o.disponibles} minutos agendados`;
}
