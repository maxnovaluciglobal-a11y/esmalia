/**
 * Citas grupales (AGE-22, Ola 14): lógica pura del cupo y la asistencia.
 *
 * Una cita grupal es una cita normal de la agenda (un profesional, un box, un
 * horario) con varios pacientes inscritos. La base repite cada regla
 * (migración 20261110200000): esto es lo que la pantalla usa para avisar
 * antes de intentar, y lo prueba `tests/citas-grupales.test.ts`.
 */

export const CUPO_MINIMO = 2;
export const CUPO_MAXIMO = 200;
export const TITULO_MAXIMO = 120;

export type Asistencia = "pendiente" | "asistio" | "ausente";

export const ETIQUETA_ASISTENCIA: Record<Asistencia, string> = {
  pendiente: "Sin marcar",
  asistio: "Asistió",
  ausente: "Ausente",
};

/** Lo que la agenda necesita de una cita grupal para dibujarla. */
export interface InfoGrupal {
  titulo: string;
  cupo: number;
  /** Inscritos vigentes (sin los retirados). */
  inscritos: number;
  /** Pacientes vigentes: los choques de "mismo paciente" miran a todos. */
  pacienteIds: string[];
}

export interface ParticipanteGrupal {
  id: string;
  pacienteId: string;
  paciente: string;
  asistencia: Asistencia;
  inscritoEn: string;
  retiradoEn: string | null;
  motivoRetiro: string | null;
}

/** Cupos libres (nunca negativo, aunque los datos vengan desordenados). */
export function cuposLibres(cupo: number, inscritos: number): number {
  return Math.max(0, cupo - inscritos);
}

export function estaLlena(cupo: number, inscritos: number): boolean {
  return cuposLibres(cupo, inscritos) === 0;
}

/** "4 de 10" para el cajón; "4/10" para la caja angosta de la grilla. */
export function etiquetaCupo(info: Pick<InfoGrupal, "cupo" | "inscritos">, corta = false): string {
  return corta ? `${info.inscritos}/${info.cupo}` : `${info.inscritos} de ${info.cupo}`;
}

/** Error del formulario de la cita grupal, o null si está bien. */
export function validarGrupo(titulo: string, cupo: number, inscritos = 1): string | null {
  const t = titulo.trim();
  if (t.length < 2) return "Ponle un nombre a la actividad (por ejemplo, «Charla de higiene»).";
  if (t.length > TITULO_MAXIMO) return `El nombre admite hasta ${TITULO_MAXIMO} caracteres.`;
  if (!Number.isInteger(cupo)) return "El cupo es un número entero de pacientes.";
  if (cupo < CUPO_MINIMO) return `El cupo mínimo de una cita grupal es ${CUPO_MINIMO}.`;
  if (cupo > CUPO_MAXIMO) return `El cupo máximo es ${CUPO_MAXIMO} pacientes.`;
  if (cupo < inscritos) {
    return `Ya hay ${inscritos} pacientes inscritos: el cupo no puede quedar por debajo.`;
  }
  return null;
}

export type MotivoSinInscripcion = "llena" | "cancelada" | "ya_inscrito" | null;

/** ¿Se puede inscribir a este paciente? El motivo va escrito al lado del botón. */
export function motivoParaNoInscribir(input: {
  cupo: number;
  inscritos: number;
  estadoCita: string;
  pacienteId?: string;
  vigentes?: readonly string[];
}): MotivoSinInscripcion {
  if (input.estadoCita === "cancelada") return "cancelada";
  if (input.pacienteId && input.vigentes?.includes(input.pacienteId)) return "ya_inscrito";
  if (estaLlena(input.cupo, input.inscritos)) return "llena";
  return null;
}

export const TEXTO_SIN_INSCRIPCION: Record<Exclude<MotivoSinInscripcion, null>, string> = {
  llena: "La cita está llena: sube el cupo o retira a alguien para inscribir.",
  cancelada: "La cita está cancelada: no se inscriben pacientes.",
  ya_inscrito: "Ese paciente ya está inscrito.",
};

/** La asistencia se marca desde que empieza la cita (igual que la base). */
export function puedeMarcarAsistencia(inicioIso: string, ahora: Date = new Date()): boolean {
  return Date.parse(inicioIso) <= ahora.getTime();
}

export interface ResumenAsistencia {
  vigentes: number;
  asistieron: number;
  ausentes: number;
  sinMarcar: number;
  retirados: number;
}

export function resumenAsistencia(
  participantes: readonly Pick<ParticipanteGrupal, "asistencia" | "retiradoEn">[],
): ResumenAsistencia {
  const r: ResumenAsistencia = {
    vigentes: 0,
    asistieron: 0,
    ausentes: 0,
    sinMarcar: 0,
    retirados: 0,
  };
  for (const p of participantes) {
    if (p.retiradoEn) {
      r.retirados++;
      continue;
    }
    r.vigentes++;
    if (p.asistencia === "asistio") r.asistieron++;
    else if (p.asistencia === "ausente") r.ausentes++;
    else r.sinMarcar++;
  }
  return r;
}

/** Vigentes primero (en orden de inscripción) y los retirados al final. */
export function ordenarParticipantes<
  T extends Pick<ParticipanteGrupal, "inscritoEn" | "retiradoEn">,
>(participantes: readonly T[]): T[] {
  return [...participantes].sort((a, b) => {
    if (!a.retiradoEn !== !b.retiradoEn) return a.retiradoEn ? 1 : -1;
    return a.inscritoEn.localeCompare(b.inscritoEn);
  });
}

/** Pacientes de una cita para los choques: todos los inscritos o el único. */
export function pacientesDeCita(c: {
  pacienteId: string;
  grupal?: Pick<InfoGrupal, "pacienteIds">;
}): string[] {
  return c.grupal?.pacienteIds.length ? c.grupal.pacienteIds : [c.pacienteId];
}
