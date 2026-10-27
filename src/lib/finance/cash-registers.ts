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
   * Conteo por billete y moneda del cierre. `null` si se ingresó
   * solo el total o si la caja se cerró antes de que existiera el conteo.
   */
  closingDenominations: DetalleDenominaciones | null;
  /**
   * CAJ-02: persona dueña de la caja. `null` = caja general (las de antes de
   * la Ola 10, o la que abra el código viejo): la puede cerrar cualquiera que
   * opere caja, como siempre.
   */
  operatorId: string | null;
  /** Nombre de la persona al abrir (snapshot). */
  operatorName: string | null;
  /** Snapshots del cierre (Ola 10). `null` en cajas abiertas y en cierres anteriores. */
  cashCollectedCents: number | null;
  movementsInCents: number | null;
  movementsOutCents: number | null;
}

/** Cómo se llama una caja en pantalla: "Caja de Javiera" o "Caja general". */
export function nombreDeCaja(
  caja: Pick<CashRegister, "operatorId" | "operatorName">,
  miUserId?: string | null,
): string {
  if (!caja.operatorId) return "Caja general";
  if (miUserId && caja.operatorId === miUserId) return "Mi caja";
  const nombre = caja.operatorName?.trim().split(/\s+/)[0];
  return nombre ? `Caja de ${nombre}` : "Caja de otra persona";
}

/**
 * La caja que una persona ve como "la suya" al entrar a /cajas: su caja
 * abierta; si no tiene, la general abierta (la de antes, para poder
 * cerrarla); si tampoco, ninguna.
 */
export function cajaDeLaPersona<T extends Pick<CashRegister, "operatorId" | "status">>(
  abiertas: readonly T[],
  userId: string,
): T | null {
  return (
    abiertas.find((c) => c.status === "open" && c.operatorId === userId) ??
    abiertas.find((c) => c.status === "open" && c.operatorId === null) ??
    null
  );
}

/** Quién puede cerrar una caja (CAJ-03): su dueña, owner/admin, o cualquiera que opere caja si es general. */
export function puedeCerrarCaja(
  caja: Pick<CashRegister, "operatorId">,
  userId: string,
  esGestor: boolean,
): boolean {
  return caja.operatorId === null || caja.operatorId === userId || esGestor;
}

// ─── Movimientos entre cajas (CAJ-04) ────────────────────────────────────

export const CASH_MOVEMENT_KINDS = ["traspaso", "retiro", "deposito"] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

export const CASH_MOVEMENT_LABELS: Record<CashMovementKind, string> = {
  traspaso: "Traspaso a otra caja",
  retiro: "Retiro de efectivo",
  deposito: "Depósito al banco",
};

export interface CashMovement {
  id: string;
  kind: CashMovementKind;
  fromRegisterId: string;
  toRegisterId: string | null;
  amountCents: number;
  currency: string;
  reason: string;
  reference: string | null;
  createdBy: string;
  createdAt: string;
}

export interface MovimientosDeCaja {
  entradasCents: number;
  salidasCents: number;
}

/** Suma lo que entró (traspasos recibidos) y lo que salió de una caja. */
export function sumarMovimientos(
  movimientos: readonly Pick<CashMovement, "fromRegisterId" | "toRegisterId" | "amountCents">[],
  cajaId: string,
): MovimientosDeCaja {
  let entradasCents = 0;
  let salidasCents = 0;
  for (const m of movimientos) {
    if (m.toRegisterId === cajaId) entradasCents += m.amountCents;
    if (m.fromRegisterId === cajaId) salidasCents += m.amountCents;
  }
  return { entradasCents, salidasCents };
}

/**
 * Esperado en el cajón con movimientos (CAJ-04): apertura + efectivo cobrado
 * + traspasos recibidos − traspasos, retiros y depósitos. Es el mismo cálculo
 * que `public.efectivo_en_caja` y que la base vuelve a hacer al cerrar.
 */
export function esperadoConMovimientos(
  openingAmountCents: number,
  cobradoEnEfectivoCents: number,
  movimientos: MovimientosDeCaja,
): number {
  return (
    esperadoEnCaja(openingAmountCents, cobradoEnEfectivoCents) +
    movimientos.entradasCents -
    movimientos.salidasCents
  );
}

/** Desglose de lo cobrado durante una sesión de caja, por medio de pago. */
export interface CashRegisterMethodBreakdown {
  method: string;
  amountCents: number;
  count: number;
  /**
   * `true` si es efectivo (`payments.method = 'cash'`): entra al cajón y al
   * arqueo. Débito, crédito, transferencia y "otro" no pasan por el cajón:
   * se concilian con el banco y no entran a la diferencia.
   */
  enEfectivo: boolean;
}

/** Solo el efectivo pasa por el cajón. Un medio propio de la clínica cuenta por su `method`. */
export function esCobroEnEfectivo(method: string | null | undefined): boolean {
  return method === "cash";
}

export interface CobrosDelTurno {
  efectivoCents: number;
  efectivoCantidad: number;
  /** Débito, crédito, transferencia y otros: a conciliar con el banco. */
  aConciliarCents: number;
  aConciliarCantidad: number;
}

/** Separa lo cobrado en el turno entre lo que está en el cajón y lo que no. */
export function separarCobrosDelTurno(
  filas: readonly Pick<CashRegisterMethodBreakdown, "amountCents" | "count" | "enEfectivo">[],
): CobrosDelTurno {
  const r: CobrosDelTurno = {
    efectivoCents: 0,
    efectivoCantidad: 0,
    aConciliarCents: 0,
    aConciliarCantidad: 0,
  };
  for (const f of filas) {
    if (f.enEfectivo) {
      r.efectivoCents += f.amountCents;
      r.efectivoCantidad += f.count;
    } else {
      r.aConciliarCents += f.amountCents;
      r.aConciliarCantidad += f.count;
    }
  }
  return r;
}

/**
 * Lo esperado en el cajón al cerrar: monto de apertura + lo cobrado EN
 * EFECTIVO durante la sesión. Los cobros con tarjeta o transferencia no
 * están en el cajón, así que no entran (si entraran, un arqueo de billetes
 * no cuadraría nunca en una clínica que cobra con débito).
 *
 * Hasta el 20-oct-2026 el servidor sumaba todos los medios. Los cierres
 * guardados antes de ese cambio tienen `expected_closing_cents` y
 * `difference_cents` calculados con todos los medios; no se recalculan
 * (snapshot, regla 10). No había clínicas reales cobrando con caja.
 */
export function esperadoEnCaja(openingAmountCents: number, cobradoEnEfectivoCents: number): number {
  return openingAmountCents + cobradoEnEfectivoCents;
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
 * así que vale con o sin conteo por denominación.
 */
export function motivoFaltante(differenceCents: number, notes: string | null | undefined): boolean {
  if (differenceCents === 0) return false;
  return (notes ?? "").trim().length < MOTIVO_MINIMO;
}
