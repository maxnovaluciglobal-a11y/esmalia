/**
 * Lo que pide acción en Operación (A+, segundo pase): la tarjeta en tinta de
 * Inventario y de Laboratorios. Puro, para probarlo sin base.
 *
 * "Hoy" lo pone quien llama con `hoyISO(clinic.timezone)` (regla 7).
 */
import { ordenAtrasada, type LabOrder, type LabOrderStatus } from "@/lib/finance/finance";
import { sumarDias } from "@/lib/finance/periodos-reporte";

/** Días hacia adelante en que una orden pendiente cuenta como "por vencer". */
export const DIAS_POR_VENCER = 7;

const PENDIENTES: readonly LabOrderStatus[] = ["enviado", "en_proceso", "reprocesar"];

export function ordenPendiente(o: Pick<LabOrder, "status">): boolean {
  return PENDIENTES.includes(o.status);
}

/** Pendiente con fecha comprometida entre hoy y hoy + 7 (incluidos). */
export function ordenPorVencer(o: LabOrder, hoy: string): boolean {
  if (!o.dueOn || !ordenPendiente(o)) return false;
  return o.dueOn >= hoy && o.dueOn <= sumarDias(hoy, DIAS_POR_VENCER);
}

export type ResumenLaboratorio = {
  atrasadas: LabOrder[];
  porVencer: LabOrder[];
  /** Pendientes (enviado, en proceso, reprocesar). */
  enCurso: number;
  /** Cantidad por estado, en el orden de `LAB_ORDER_STATUSES`. */
  porEstado: { status: LabOrderStatus; cantidad: number }[];
};

export function resumenLaboratorio(
  ordenes: LabOrder[],
  hoy: string,
  estados: readonly LabOrderStatus[],
): ResumenLaboratorio {
  const atrasadas = ordenes
    .filter((o) => ordenAtrasada(o, hoy))
    .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  const porVencer = ordenes
    .filter((o) => ordenPorVencer(o, hoy))
    .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  const conteo = new Map<LabOrderStatus, number>();
  for (const o of ordenes) conteo.set(o.status, (conteo.get(o.status) ?? 0) + 1);
  return {
    atrasadas,
    porVencer,
    enCurso: ordenes.filter(ordenPendiente).length,
    porEstado: estados.map((status) => ({ status, cantidad: conteo.get(status) ?? 0 })),
  };
}

/** Días entre dos fechas civiles (b − a). */
export function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export type InsumoParaResumen = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minStock: number | null;
  belowMinStock: boolean;
  isActive: boolean;
};

export type LoteParaResumen = { expirationDate: string };

export type ResumenInventario<T extends InsumoParaResumen> = {
  bajoMinimo: T[];
  sinAlerta: number;
  enOrden: number;
  lotesVencidos: number;
  lotesPorVencer: number;
};

/**
 * Bajo el mínimo primero lo más lejos del mínimo (stock / mínimo más bajo):
 * lo que se acaba antes va arriba.
 */
export function resumenInventario<T extends InsumoParaResumen>(
  items: T[],
  lotes: LoteParaResumen[],
  hoy: string,
): ResumenInventario<T> {
  const activos = items.filter((i) => i.isActive);
  const proporcion = (i: T) =>
    i.minStock && i.minStock > 0 ? i.currentStock / i.minStock : i.currentStock;
  const bajoMinimo = activos
    .filter((i) => i.belowMinStock)
    .sort((a, b) => proporcion(a) - proporcion(b));
  const sinAlerta = activos.filter((i) => i.minStock == null).length;
  return {
    bajoMinimo,
    sinAlerta,
    enOrden: activos.length - bajoMinimo.length - sinAlerta,
    lotesVencidos: lotes.filter((l) => l.expirationDate < hoy).length,
    lotesPorVencer: lotes.filter((l) => l.expirationDate >= hoy).length,
  };
}

/** Filtro por estado de los chips de Inventario. */
export type FiltroInsumo = "todos" | "bajo-minimo" | "sin-alerta";

export function filtrarInsumos<T extends InsumoParaResumen>(items: T[], filtro: FiltroInsumo): T[] {
  if (filtro === "bajo-minimo") return items.filter((i) => i.belowMinStock);
  if (filtro === "sin-alerta") return items.filter((i) => i.minStock == null);
  return items;
}
