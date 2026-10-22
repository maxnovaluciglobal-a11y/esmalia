/**
 * Realinear precios del arancel en lote (ADM-04, Ola 3).
 *
 * Cálculo puro: la vista previa y lo que se manda a la base salen de la misma
 * función. La base (`realinear_precios`) recibe la lista explícita de
 * cambios con el precio de antes y rechaza todo si alguno ya no coincide.
 *
 * Todo en cents (regla 6). El redondeo es a un paso en cents: en CLP, 100 =
 * a la centena; en MXN, 100 = al peso entero.
 */

export type ModoRealineacion = "percent" | "amount";

export interface ParametrosRealineacion {
  modo: ModoRealineacion;
  /** Porcentaje (5 = +5 %, -3.5 = -3,5 %). Se usa en modo "percent". */
  porcentaje?: number | null;
  /** Monto en cents a sumar (negativo = restar). Se usa en modo "amount". */
  montoCents?: number | null;
  /** Paso de redondeo en cents (100, 1000…). null = sin redondeo. */
  redondeoCents?: number | null;
}

export interface PrecioActual {
  id: string;
  name: string;
  priceCents: number;
}

export interface CambioDePrecio {
  procedureId: string;
  name: string;
  oldCents: number;
  newCents: number;
}

export const PORCENTAJE_MIN = -99;
export const PORCENTAJE_MAX = 1000;
export const MAX_PRESTACIONES_POR_REALINEACION = 2000;

/** Redondea al múltiplo más cercano de `paso` (mitad hacia arriba). */
export function redondearA(cents: number, paso: number | null | undefined): number {
  if (!paso || paso <= 1) return Math.round(cents);
  return Math.round(cents / paso) * paso;
}

/** Nuevo precio de UNA prestación. Nunca negativo. */
export function nuevoPrecio(precioCents: number, p: ParametrosRealineacion): number {
  let bruto: number;
  if (p.modo === "percent") {
    bruto = precioCents * (1 + (p.porcentaje ?? 0) / 100);
  } else {
    bruto = precioCents + (p.montoCents ?? 0);
  }
  return Math.max(0, redondearA(bruto, p.redondeoCents));
}

/** Motivo por el que no se puede calcular, o null si los parámetros sirven. */
export function errorDeParametros(p: ParametrosRealineacion): string | null {
  if (p.modo === "percent") {
    const v = p.porcentaje;
    if (v === null || v === undefined || !Number.isFinite(v)) return "Ingresa un porcentaje.";
    if (v === 0) return "Un porcentaje de 0 no cambia ningún precio.";
    if (v < PORCENTAJE_MIN || v > PORCENTAJE_MAX)
      return `El porcentaje tiene que estar entre ${PORCENTAJE_MIN} % y ${PORCENTAJE_MAX} %.`;
    return null;
  }
  const m = p.montoCents;
  if (m === null || m === undefined || !Number.isFinite(m)) return "Ingresa un monto.";
  if (!Number.isInteger(m)) return "El monto tiene que ser un entero en cents.";
  if (m === 0) return "Un monto de 0 no cambia ningún precio.";
  return null;
}

/**
 * Antes y después de cada prestación elegida. Deja afuera las que no
 * cambian (precio igual después de redondear) y las repetidas.
 */
export function calcularRealineacion(
  precios: PrecioActual[],
  p: ParametrosRealineacion,
): CambioDePrecio[] {
  if (errorDeParametros(p)) return [];
  const vistos = new Set<string>();
  const cambios: CambioDePrecio[] = [];
  for (const pr of precios) {
    if (vistos.has(pr.id)) continue;
    vistos.add(pr.id);
    const nuevo = nuevoPrecio(pr.priceCents, p);
    if (nuevo === pr.priceCents) continue;
    cambios.push({ procedureId: pr.id, name: pr.name, oldCents: pr.priceCents, newCents: nuevo });
  }
  return cambios;
}

/** Totales para el resumen de la vista previa. */
export function resumenRealineacion(cambios: CambioDePrecio[]): {
  cantidad: number;
  totalAntes: number;
  totalDespues: number;
  bajanACero: number;
} {
  return {
    cantidad: cambios.length,
    totalAntes: cambios.reduce((s, c) => s + c.oldCents, 0),
    totalDespues: cambios.reduce((s, c) => s + c.newCents, 0),
    bajanACero: cambios.filter((c) => c.newCents === 0).length,
  };
}
