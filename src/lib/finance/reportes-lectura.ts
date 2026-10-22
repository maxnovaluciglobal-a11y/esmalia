/**
 * Lógica pura de los reportes de finanzas (sin Supabase), para probarla sin
 * base: cómo se agrupan los cobros por medio de pago y cómo se lee la
 * diferencia entre lo producido y lo cobrado.
 */

import { formatMoney } from "@/lib/finance/finance";

/**
 * Nombre con que se siembra cada medio de pago al crear la clínica
 * (`seed_clinic_payment_methods`). Un pago viejo sin `method_name_snapshot`
 * se agrupa bajo este nombre, el mismo que trae un pago nuevo hecho con el
 * medio por defecto: si no, "Transferencia" aparecía dos veces (UX, 21-oct).
 */
export const NOMBRE_SEMBRADO_POR_METODO: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  debit_card: "Tarjeta de débito",
  credit_card: "Tarjeta de crédito",
  other: "Otro",
};

/** "  Tarjeta  de Crédito " → "tarjeta de credito": sin tildes, minúsculas, espacios simples. */
export function claveDeMetodo(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface PagoParaAgrupar {
  amount_cents: number;
  method: string;
  method_name_snapshot: string | null;
}

export interface FilaPorMetodo {
  /** Nombre visible del medio (el primero que apareció con esa clave). */
  method: string;
  totalCents: number;
  count: number;
}

/**
 * Agrupa por el nombre del medio normalizado: el nombre configurado cuando el
 * pago lo tiene (G-6) y, si no, el nombre sembrado del enum. Así
 * "Transferencia", "transferencia " y un pago viejo con `transfer` son una
 * sola fila, y un medio propio ("Klap - Crédito") sigue con su nombre.
 */
export function agruparPorMetodo(pagos: readonly PagoParaAgrupar[]): FilaPorMetodo[] {
  const porClave = new Map<string, FilaPorMetodo>();
  for (const p of pagos) {
    const nombre =
      p.method_name_snapshot?.trim() || NOMBRE_SEMBRADO_POR_METODO[p.method] || p.method;
    const clave = claveDeMetodo(nombre);
    const fila = porClave.get(clave) ?? { method: nombre, totalCents: 0, count: 0 };
    fila.totalCents += p.amount_cents;
    fila.count += 1;
    porClave.set(clave, fila);
  }
  return [...porClave.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export interface LecturaCobradoVsProducido {
  etiqueta: string;
  /** Monto siempre positivo: el sentido lo dice el texto, no el signo. */
  valor: string;
  nota: string;
}

/**
 * Lectura de "producido − cobrado" sin signos que haya que interpretar.
 * Antes decía "Diferencia -$5.000 · Cobrado por sobre lo producido".
 */
export function lecturaCobradoVsProducido(
  producidoCents: number,
  cobradoCents: number,
  currency: string,
): LecturaCobradoVsProducido {
  const diferencia = producidoCents - cobradoCents;
  if (diferencia === 0) {
    return {
      etiqueta: "Producido y cobrado",
      valor: formatMoney(0, currency),
      nota: "Cobraste exactamente lo producido.",
    };
  }
  if (diferencia > 0) {
    return {
      etiqueta: "Por cobrar",
      valor: formatMoney(diferencia, currency),
      nota: `Falta cobrar ${formatMoney(diferencia, currency)} de trabajo ya hecho.`,
    };
  }
  return {
    etiqueta: "Cobrado de más",
    valor: formatMoney(-diferencia, currency),
    nota: `Cobraste ${formatMoney(-diferencia, currency)} más de lo producido (abonos o pagos adelantados).`,
  };
}

export interface MesDeSerie {
  /** `YYYY-MM`. */
  mes: string;
  ventasCents: number;
  recaudacionCents: number;
}

/** Meses que se muestran como mínimo, aunque la clínica tenga menos historia. */
export const MESES_MINIMOS_EN_SERIE = 3;

/**
 * Saca los meses vacíos del principio de la serie (antes de que la clínica
 * tuviera producción o cobros) y deja el resto, que termina en el mes en
 * curso. Siempre quedan al menos `minimo` meses al final para dar contexto:
 * una clínica con datos solo en octubre ve agosto, septiembre y octubre, no
 * doce barras de las que once están vacías.
 */
export function recortarSerieMensual<T extends MesDeSerie>(
  serie: readonly T[],
  minimo: number = MESES_MINIMOS_EN_SERIE,
): T[] {
  const primero = serie.findIndex((m) => m.ventasCents !== 0 || m.recaudacionCents !== 0);
  if (primero === -1) return [...serie];
  const desde = Math.min(primero, Math.max(0, serie.length - minimo));
  return serie.slice(desde);
}
