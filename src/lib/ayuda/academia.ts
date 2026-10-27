// src/lib/ayuda/academia.ts
//
// Qué ve cada rol en la Academia (ONB-04). Puro, para testearlo.
//
// - Cada rol de la app cae en una pista: dueño (owner/admin), profesional
//   (dentist), recepción y coordinación (reception, coordinator, accounting),
//   asistente (assistant) y técnico/a (lab_technician).
// - Todos ven las lecciones básicas ("todas") y las de su pista.
// - Dueño y administración pueden mirar además las pistas del resto, para
//   preparar a su equipo; nadie más ve lecciones de otra pista (una lección
//   de caja no le sirve a quien no tiene caja).
import type { ClinicRole } from "@/lib/access/access";
import type { Leccion, PistaAcademia } from "@/content/ayuda/tipos";

export const NOMBRE_PISTA: Record<PistaAcademia, string> = {
  dueno: "Dueño o administración",
  profesional: "Profesional",
  recepcion: "Recepción y coordinación",
  asistente: "Asistente dental",
  tecnico: "Técnico/a dental",
};

export const ORDEN_PISTAS: readonly PistaAcademia[] = [
  "dueno",
  "profesional",
  "recepcion",
  "asistente",
  "tecnico",
];

const PISTA_DEL_ROL: Record<ClinicRole, PistaAcademia> = {
  owner: "dueno",
  admin: "dueno",
  dentist: "profesional",
  reception: "recepcion",
  coordinator: "recepcion",
  accounting: "recepcion",
  assistant: "asistente",
  lab_technician: "tecnico",
};

/** La pista propia del rol (sin rol: ninguna). */
export function pistaDelRol(role: ClinicRole | null | undefined): PistaAcademia | null {
  return role ? PISTA_DEL_ROL[role] : null;
}

/** Pistas que el rol puede abrir: la suya, y todas si es dueño o admin. */
export function pistasVisibles(role: ClinicRole | null | undefined): PistaAcademia[] {
  const propia = pistaDelRol(role);
  if (!propia) return [];
  return propia === "dueno" ? [...ORDEN_PISTAS] : [propia];
}

/** ¿La lección es de la pista (o básica)? */
export function leccionDeLaPista(leccion: Leccion, pista: PistaAcademia): boolean {
  return leccion.pistas === "todas" || leccion.pistas.includes(pista);
}

/** Lecciones básicas: las de todo el equipo. */
export function leccionesBasicas(lecciones: readonly Leccion[]): Leccion[] {
  return lecciones.filter((l) => l.pistas === "todas");
}

/** Lecciones propias de una pista (sin las básicas). */
export function leccionesDeLaPista(lecciones: readonly Leccion[], pista: PistaAcademia): Leccion[] {
  return lecciones.filter((l) => l.pistas !== "todas" && l.pistas.includes(pista));
}

/** Todo lo que el rol puede ver en la Academia, sin repetir. */
export function leccionesVisibles(
  lecciones: readonly Leccion[],
  role: ClinicRole | null | undefined,
): Leccion[] {
  const pistas = pistasVisibles(role);
  if (pistas.length === 0) return [];
  return lecciones.filter((l) => l.pistas === "todas" || pistas.some((p) => l.pistas.includes(p)));
}

/** Avance: cuántas de `lecciones` están vistas. */
export function avance(
  lecciones: readonly Leccion[],
  vistas: ReadonlySet<string>,
): { vistas: number; total: number } {
  return { vistas: lecciones.filter((l) => vistas.has(l.id)).length, total: lecciones.length };
}
