/**
 * CRM-02 · Bandeja de tareas (Ola 8). Lógica pura: agrupar por urgencia
 * (vencidas, hoy, próximas) y por persona, y calcular la fecha al posponer.
 */
import { sumarDias } from "@/lib/seguimiento/controles";

export const TIPOS_DE_TAREA = ["llamada", "presupuesto", "control", "mensaje", "otra"] as const;
export type TipoDeTarea = (typeof TIPOS_DE_TAREA)[number];

export const ETIQUETA_TIPO_TAREA: Record<TipoDeTarea, string> = {
  llamada: "Llamada",
  presupuesto: "Presupuesto",
  control: "Control",
  mensaje: "Mensaje",
  otra: "Otra",
};

export type EstadoDeTarea = "pendiente" | "hecha" | "descartada";

export interface Tarea {
  id: string;
  title: string;
  notes: string | null;
  kind: TipoDeTarea;
  patientId: string | null;
  patientName: string | null;
  patientPhone: string | null;
  quoteId: string | null;
  controlId: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  dueOn: string;
  status: EstadoDeTarea;
  postponedCount: number;
  completedAt: string | null;
  createdAt: string;
}

export type FiltroPersona = "mias" | "todas" | "sin_asignar";

export type CambioDeTarea =
  | { accion: "completar" }
  | { accion: "descartar" }
  | { accion: "reabrir" }
  | { accion: "posponer"; fecha: string }
  | { accion: "asignar"; userId: string | null };

export interface BandejaAgrupada {
  vencidas: Tarea[];
  hoy: Tarea[];
  proximas: Tarea[];
}

export function filtrarPorPersona(
  tareas: readonly Tarea[],
  filtro: FiltroPersona,
  userId: string,
): Tarea[] {
  if (filtro === "todas") return [...tareas];
  if (filtro === "sin_asignar") return tareas.filter((t) => t.assignedTo === null);
  return tareas.filter((t) => t.assignedTo === userId);
}

/** Solo las pendientes, en tres grupos; dentro de cada uno, la más antigua primero. */
export function agruparBandeja(tareas: readonly Tarea[], hoy: string): BandejaAgrupada {
  const pendientes = tareas
    .filter((t) => t.status === "pendiente")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.createdAt.localeCompare(b.createdAt));
  return {
    vencidas: pendientes.filter((t) => t.dueOn < hoy),
    hoy: pendientes.filter((t) => t.dueOn === hoy),
    proximas: pendientes.filter((t) => t.dueOn > hoy),
  };
}

export const OPCIONES_POSPONER = [
  { id: "1d", label: "Mañana", dias: 1 },
  { id: "3d", label: "En 3 días", dias: 3 },
  { id: "1s", label: "En una semana", dias: 7 },
] as const;
export type OpcionPosponer = (typeof OPCIONES_POSPONER)[number]["id"];

/**
 * Nueva fecha al posponer: se cuenta desde hoy si la tarea ya venció (posponer
 * una tarea de hace un mes "a mañana" es mañana, no el mes pasado + 1).
 */
export function fechaAlPosponer(dueOn: string, hoy: string, opcion: OpcionPosponer): string {
  const dias = OPCIONES_POSPONER.find((o) => o.id === opcion)?.dias ?? 1;
  const base = dueOn < hoy ? hoy : dueOn;
  return sumarDias(base, dias);
}

/** Cuenta para el resumen en tinta. */
export function conteoDeBandeja(b: BandejaAgrupada): {
  vencidas: number;
  hoy: number;
  proximas: number;
} {
  return { vencidas: b.vencidas.length, hoy: b.hoy.length, proximas: b.proximas.length };
}
