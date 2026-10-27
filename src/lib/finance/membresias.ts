// Membresías de la clínica (Ola 10 · frente A: FIN-12, FIC-06).
//
// Plan con beneficios y una cuota; el paciente inscrito y sus cuotas por
// período. **Sin cobro automático**: una persona genera las cuotas del mes
// (vista previa con la cifra afectada y confirmación) y otra la cobra a mano.
// Qué cuota corresponde a qué mes lo decide la base
// (`generar_cuotas_de_membresia`); acá viven las etiquetas, los resúmenes y la
// validación del plan.
//
// Lógica pura: sin red ni base.

import { formatMoney } from "@/lib/finance/finance";
import { mesAnio } from "@/lib/formato-fecha";

export const PERIODOS_MEMBRESIA = ["monthly", "quarterly", "semiannual", "yearly"] as const;
export type PeriodoMembresia = (typeof PERIODOS_MEMBRESIA)[number];

export const ETIQUETA_PERIODO: Record<PeriodoMembresia, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  yearly: "Anual",
};

const SUFIJO_PERIODO: Record<PeriodoMembresia, string> = {
  monthly: "al mes",
  quarterly: "al trimestre",
  semiannual: "al semestre",
  yearly: "al año",
};

export const MESES_DEL_PERIODO: Record<PeriodoMembresia, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

export function esPeriodoMembresia(v: string): v is PeriodoMembresia {
  return (PERIODOS_MEMBRESIA as readonly string[]).includes(v);
}

/** "$15.000 al mes". */
export function etiquetaCuota(cents: number, periodo: string, currency: string): string {
  const sufijo = esPeriodoMembresia(periodo) ? SUFIJO_PERIODO[periodo] : "";
  return `${formatMoney(cents, currency)} ${sufijo}`.trim();
}

/** Cuota equivalente mensual, para comparar planes de distinto período. */
export function cuotaMensualEquivalente(cents: number, periodo: PeriodoMembresia): number {
  return Math.round(cents / MESES_DEL_PERIODO[periodo]);
}

export const ESTADOS_INSCRIPCION = ["active", "paused", "cancelled"] as const;
export type EstadoInscripcion = (typeof ESTADOS_INSCRIPCION)[number];
export const ETIQUETA_INSCRIPCION: Record<EstadoInscripcion, string> = {
  active: "Activa",
  paused: "Pausada",
  cancelled: "Cancelada",
};

export const ESTADOS_CUOTA = ["pending", "paid", "void"] as const;
export type EstadoCuota = (typeof ESTADOS_CUOTA)[number];
export const ETIQUETA_CUOTA: Record<EstadoCuota, string> = {
  pending: "Por cobrar",
  paid: "Cobrada",
  void: "Anulada",
};

/** "octubre 2026" o "octubre 2026 a diciembre 2026" si cubre varios meses. */
export function etiquetaPeriodoCuota(desde: string, hasta: string): string {
  const a = mesAnio(desde);
  const b = mesAnio(hasta);
  return a === b ? a : `${a} a ${b}`;
}

export interface CuotaResumible {
  status: string;
  amountCents: number;
}

export interface ResumenCuotas {
  porCobrar: number;
  porCobrarCents: number;
  cobradas: number;
  cobradasCents: number;
  anuladas: number;
}

export function resumirCuotas(cuotas: readonly CuotaResumible[]): ResumenCuotas {
  const r: ResumenCuotas = {
    porCobrar: 0,
    porCobrarCents: 0,
    cobradas: 0,
    cobradasCents: 0,
    anuladas: 0,
  };
  for (const c of cuotas) {
    if (c.status === "pending") {
      r.porCobrar += 1;
      r.porCobrarCents += c.amountCents;
    } else if (c.status === "paid") {
      r.cobradas += 1;
      r.cobradasCents += c.amountCents;
    } else if (c.status === "void") {
      r.anuladas += 1;
    }
  }
  return r;
}

/** Beneficios desde un texto con uno por línea: sin vacíos ni repetidos, hasta 20. */
export function beneficiosDesdeTexto(texto: string): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const b = linea.replace(/^[\s•\-*]+/, "").trim();
    if (!b) continue;
    const clave = b.toLocaleLowerCase("es");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(b.slice(0, 160));
    if (salida.length === 20) break;
  }
  return salida;
}

export interface EntradaPlan {
  name: string;
  feeCents: number;
  billingPeriod: string;
  treatmentDiscountPercent: number | null;
}

export function validarPlan(e: EntradaPlan): string[] {
  const errores: string[] = [];
  if (!e.name.trim()) errores.push("Indica el nombre del plan.");
  if (!Number.isInteger(e.feeCents) || e.feeCents <= 0)
    errores.push("La cuota tiene que ser mayor que cero.");
  if (!esPeriodoMembresia(e.billingPeriod)) errores.push("Elige cada cuánto se cobra la cuota.");
  if (
    e.treatmentDiscountPercent !== null &&
    (e.treatmentDiscountPercent < 0 || e.treatmentDiscountPercent > 100)
  )
    errores.push("El descuento en tratamientos va de 0 a 100 %.");
  return errores;
}
