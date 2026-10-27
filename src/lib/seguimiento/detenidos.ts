/**
 * CRM-06 · Casos detenidos (Ola 8). Lógica pura sobre los planes de
 * tratamiento activos: cuáles no avanzan (sin cita futura ni atención en N
 * días) y si quedaron sin empezar o a medias.
 */
import { DIA_MS } from "@/lib/seguimiento/riesgo";

export interface PlanActivo {
  planId: string;
  patientId: string;
  patientName: string;
  planName: string;
  creadoEl: string;
  iniciadoEl: string | null;
  quoteId: string | null;
  itemsPendientes: number;
  itemsCompletados: number;
  ultimoItemCompletadoEl: string | null;
  ultimaVisitaEl: string | null;
  tieneCitaFutura: boolean;
}

export type TipoDeDetencion = "sin_empezar" | "a_medias";

export interface CasoDetenido extends PlanActivo {
  tipo: TipoDeDetencion;
  /** Fecha de lo último que pasó con el plan o el paciente. */
  ultimaActividadEl: string;
  diasSinAvance: number;
}

export const OPCIONES_DIAS_DETENIDO = [30, 60, 90] as const;
export const DIAS_DETENIDO_POR_DEFECTO = 30;

export const ETIQUETA_DETENCION: Record<TipoDeDetencion, string> = {
  sin_empezar: "Aceptado sin empezar",
  a_medias: "Tratamiento a medias",
};

function masReciente(fechas: (string | null)[]): string | null {
  let mejor: string | null = null;
  let mejorMs = -Infinity;
  for (const f of fechas) {
    if (!f) continue;
    const t = new Date(f).getTime();
    if (Number.isFinite(t) && t > mejorMs) {
      mejor = f;
      mejorMs = t;
    }
  }
  return mejor;
}

export function casosDetenidos(
  planes: readonly PlanActivo[],
  diasSinAvance: number,
  ahora: number,
): CasoDetenido[] {
  const casos: CasoDetenido[] = [];
  for (const plan of planes) {
    if (plan.itemsPendientes <= 0) continue; // ya no le falta nada
    if (plan.tieneCitaFutura) continue; // viene en camino
    const ultima = masReciente([
      plan.ultimoItemCompletadoEl,
      plan.ultimaVisitaEl,
      plan.iniciadoEl,
      plan.creadoEl,
    ]);
    if (!ultima) continue;
    const dias = Math.floor((ahora - new Date(ultima).getTime()) / DIA_MS);
    if (dias < diasSinAvance) continue;
    casos.push({
      ...plan,
      tipo: plan.itemsCompletados > 0 ? "a_medias" : "sin_empezar",
      ultimaActividadEl: ultima,
      diasSinAvance: dias,
    });
  }
  return casos.sort((a, b) => b.diasSinAvance - a.diasSinAvance);
}

/** Pacientes con al menos un plan detenido (para el riesgo de abandono). */
export function pacientesConPlanDetenido(casos: readonly CasoDetenido[]): Set<string> {
  return new Set(casos.map((c) => c.patientId));
}
