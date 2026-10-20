// Datos y lógica de la reserva de ejemplo (sin React, para poder testearla).
import { minutos, type EstadoEjemplo } from "./datos-ejemplo";

export type Evento = {
  p: number;
  ini: string;
  fin: string;
  quien: string;
  que: string;
  e: EstadoEjemplo;
  nuevo?: boolean;
};

const ev = (
  p: number,
  ini: string,
  fin: string,
  quien: string,
  que: string,
  e: EstadoEjemplo,
): Evento => ({ p, ini, fin, quien, que, e });

export const AGENDA_BASE: Record<number, readonly Evento[]> = {
  0: [
    ev(0, "08:30", "09:30", "R. Fernández", "Control", "done"),
    ev(0, "09:30", "10:45", "M. Soto", "Endodoncia 36 · sesión 1", "done"),
    ev(0, "10:45", "12:00", "C. Muñoz", "Corona 26", "chair"),
    ev(0, "12:00", "12:45", "", "", "gap"),
    ev(0, "14:00", "15:00", "P. Lagos", "Evaluación", "ok"),
    ev(0, "15:00", "16:30", "V. Reyes", "Implante 46", "ok"),
    ev(0, "16:30", "17:15", "F. Castro", "Control", "pend"),
    ev(0, "17:30", "18:30", "D. Ortiz", "Blanqueamiento", "ok"),
    ev(1, "09:00", "09:30", "A. Rojas", "Control ortodoncia", "done"),
    ev(1, "09:30", "10:00", "B. Vera", "Control", "miss"),
    ev(1, "10:00", "11:00", "N. Silva", "Instalación brackets", "done"),
    ev(1, "11:30", "12:15", "I. Torres", "Control", "chair"),
    ev(1, "12:15", "13:00", "K. Díaz", "Control", "ok"),
    ev(1, "15:00", "16:00", "S. Morales", "Evaluación", "ok"),
    ev(1, "16:00", "17:30", "E. Navarro", "Brackets", "pend"),
    ev(1, "17:30", "18:15", "J. Araya", "Control", "ok"),
    ev(2, "09:00", "10:00", "T. Paredes", "Sellantes", "done"),
    ev(2, "10:30", "11:30", "G. Bravo", "Obturación 85", "done"),
    ev(2, "11:30", "12:30", "M. Henríquez", "Control", "chair"),
    ev(2, "14:30", "15:30", "A. Contreras", "Flúor", "ok"),
    ev(2, "15:30", "16:15", "", "", "gap"),
    ev(2, "16:15", "17:00", "L. Gómez", "Control", "pend"),
  ],
  1: [
    ev(0, "09:00", "10:00", "Á. Fuentes", "Evaluación", "ok"),
    ev(0, "10:00", "11:30", "C. Muñoz", "Corona 26 · prueba", "ok"),
    ev(0, "11:30", "12:15", "R. Pino", "Control", "pend"),
    ev(0, "14:00", "15:30", "L. Vargas", "Endodoncia 21", "ok"),
    ev(0, "15:30", "16:30", "H. León", "Limpieza", "ok"),
    ev(0, "17:00", "18:00", "S. Ruiz", "Evaluación", "pend"),
    ev(1, "09:00", "09:30", "F. Mella", "Control ortodoncia", "ok"),
    ev(1, "09:30", "10:00", "C. Rivas", "Control ortodoncia", "ok"),
    ev(1, "10:00", "11:00", "P. Soto", "Brackets", "ok"),
    ev(1, "11:00", "11:30", "J. Lara", "Control", "ok"),
    ev(1, "12:00", "12:45", "", "", "gap"),
    ev(1, "15:00", "16:30", "M. Pérez", "Brackets", "pend"),
    ev(1, "16:30", "17:00", "D. Cid", "Control", "ok"),
    ev(1, "17:00", "17:30", "V. Tapia", "Control", "ok"),
    ev(2, "09:30", "10:30", "B. Núñez", "Sellantes", "ok"),
    ev(2, "10:30", "11:15", "A. Vidal", "Control", "ok"),
    ev(2, "14:30", "15:30", "T. Rojas", "Obturación 74", "ok"),
    ev(2, "15:30", "16:30", "F. Leiva", "Flúor", "pend"),
    ev(2, "16:30", "17:30", "I. Mora", "Control", "ok"),
  ],
  2: [
    ev(0, "09:00", "10:15", "E. Salas", "Limpieza", "ok"),
    ev(0, "10:30", "12:00", "M. Soto", "Endodoncia 36 · sesión 2", "ok"),
    ev(0, "12:00", "13:00", "R. Díaz", "Evaluación", "pend"),
    ev(0, "14:00", "15:00", "", "", "gap"),
    ev(0, "15:00", "16:30", "G. Castro", "Corona 16", "ok"),
    ev(0, "16:30", "17:30", "N. Paz", "Control", "pend"),
    ev(1, "09:00", "10:00", "", "", "gap"),
    ev(1, "10:00", "11:00", "O. Ríos", "Brackets", "ok"),
    ev(1, "11:00", "11:30", "Y. Soto", "Control", "ok"),
    ev(1, "15:00", "16:00", "", "", "gap"),
    ev(1, "16:00", "17:00", "Z. Lillo", "Brackets", "pend"),
    ev(2, "09:00", "10:00", "M. Paredes", "Control", "ok"),
    ev(2, "10:00", "11:00", "J. Ortiz", "Obturación 84", "ok"),
    ev(2, "11:00", "12:00", "", "", "gap"),
    ev(2, "14:30", "15:30", "C. Bello", "Sellantes", "ok"),
    ev(2, "15:30", "16:15", "S. Rey", "Control", "pend"),
  ],
};

export const PROFESIONALES = [
  { sillon: "Sillón 1", nombre: "Dra. Paz Rojas", corto: "Rojas" },
  { sillon: "Sillón 2", nombre: "Dr. Tomás Vidal", corto: "Vidal" },
  { sillon: "Sillón 3", nombre: "Dra. Camila Fuentes", corto: "Fuentes" },
] as const;

export const TRATAMIENTOS = [
  { nombre: "Evaluación", min: 30 },
  { nombre: "Limpieza", min: 45 },
  { nombre: "Control", min: 30 },
] as const;

export const DIAS = [
  { n: 19, corto: "lun · hoy", largo: "Lunes 19", texto: "lun 19" },
  { n: 20, corto: "mar", largo: "Martes 20", texto: "mar 20" },
  { n: 21, corto: "mié", largo: "Miércoles 21", texto: "mié 21" },
] as const;

export const H0 = 9 * 60;
export const SPAN = 10 * 60;
export const HORAS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
// En el ejemplo "ahora" son las 11:40 del lunes: ese día solo se ofrece
// desde las 12:00.
const DESDE_HOY = 12 * 60;

/** ¿Está libre el profesional `p` el día `d` desde `s` por `dur` minutos? */
export function libre(agenda: readonly Evento[], d: number, p: number, dur: number, s: number) {
  if (d === 0 && s < DESDE_HOY) return false;
  if (s < 9 * 60 || s + dur > 18 * 60 + 30) return false;
  if (s < 14 * 60 && s + dur > 13 * 60) return false; // colación
  return !agenda
    .filter((e) => e.p === p && e.e !== "gap")
    .some((e) => s < minutos(e.fin) && s + dur > minutos(e.ini));
}

/** Horas libres: [inicio, profesional], máximo 12, sin amontonar. */
export function horasLibres(agenda: readonly Evento[], d: number, pro: number, dur: number) {
  const out: [number, number][] = [];
  for (let s = 9 * 60; s <= 18 * 60; s += 15) {
    const candidatos = pro < 0 ? [0, 1, 2] : [pro];
    const p = candidatos.find((k) => libre(agenda, d, k, dur, s));
    if (p !== undefined) out.push([s, p]);
  }
  return out
    .filter((x, i, a) => i === 0 || x[0] - a[i - 1][0] >= 30 || x[1] !== a[i - 1][1])
    .slice(0, 12);
}
