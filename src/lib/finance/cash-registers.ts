import type { DetalleDenominaciones } from "@/lib/finance/denominaciones";

export const CASH_REGISTER_STATUSES = ["open", "closed"] as const;
export type CashRegisterStatus = (typeof CASH_REGISTER_STATUSES)[number];

export const CASH_REGISTER_STATUS_LABELS: Record<CashRegisterStatus, string> = {
  open: "Abierta",
  closed: "Cerrada",
};

/**
 * Sesión de caja por turno. `expectedClosingCents`/`declaredClosingCents`/
 * `differenceCents` son `null` mientras está abierta — se llenan una sola
 * vez al cerrar y no se recalculan después (snapshot, regla 10 de CLAUDE.md).
 */
export interface CashRegister {
  id: string;
  clinicId: string;
  branchId: string | null;
  status: CashRegisterStatus;
  currency: string;
  openingAmountCents: number;
  openedById: string;
  openedAt: string;
  openingNotes: string | null;
  expectedClosingCents: number | null;
  declaredClosingCents: number | null;
  differenceCents: number | null;
  closedById: string | null;
  closedAt: string | null;
  closingNotes: string | null;
  /**
   * Conteo por billete y moneda del cierre (arqueo v2). `null` si se ingresó
   * solo el total o si la caja se cerró antes de que existiera el conteo.
   */
  closingDenominations: DetalleDenominaciones | null;
}

/** Desglose de lo cobrado durante una sesión de caja, por medio de pago. */
export interface CashRegisterMethodBreakdown {
  method: string;
  amountCents: number;
  count: number;
}

/**
 * Lo esperado en caja al momento de cerrar: monto de apertura + lo cobrado
 * durante la sesión. Pura para poder testearla sin pegarle a la base.
 */
export function esperadoEnCaja(openingAmountCents: number, cobradoCents: number): number {
  return openingAmountCents + cobradoCents;
}

/** Diferencia entre lo contado por el cajero y lo esperado. Positivo = sobra. */
export function diferenciaDeArqueo(declaredCents: number, expectedCents: number): number {
  return declaredCents - expectedCents;
}

/** Largo mínimo del motivo: "x" o "." no explican una diferencia de caja. */
export const MOTIVO_MINIMO = 4;

export const MENSAJE_MOTIVO_OBLIGATORIO =
  "La caja no cuadra: escribe el motivo de la diferencia antes de cerrar.";

/**
 * Si la caja no cuadra, el cierre tiene que decir por qué. Lo valida el
 * servidor con la diferencia que calcula él (no la que muestra la pantalla),
 * así que vale con el flag del arqueo encendido o apagado.
 */
export function motivoFaltante(differenceCents: number, notes: string | null | undefined): boolean {
  if (differenceCents === 0) return false;
  return (notes ?? "").trim().length < MOTIVO_MINIMO;
}
