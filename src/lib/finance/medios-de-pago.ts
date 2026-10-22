// Tipos de medio de pago (FIN-07, Ola 3).
//
// `payment_methods.kind` dice QUÉ es un medio configurado por la clínica
// (efectivo, débito, Redcompra, cheque, bono…). `legacy_key` sigue siendo el
// puente 1 a 1 con los cinco valores del enum viejo `payments.method`, y los
// medios nuevos lo dejan en NULL (ver la migración 20261024300100). Lo que se
// guarda en `payments.method` para un cobro se decide acá, en un solo lugar,
// con el mismo criterio en el cliente (cola sin conexión) y en el servidor.
//
// Lógica pura: sin red ni base.

import type { PaymentMethod } from "@/lib/finance/finance";

export const TIPOS_MEDIO = [
  "cash",
  "debit",
  "credit",
  "transfer",
  "check",
  "redcompra",
  "agreement",
  "voucher",
  "other",
] as const;
export type TipoMedio = (typeof TIPOS_MEDIO)[number];

export const ETIQUETA_TIPO_MEDIO: Record<TipoMedio, string> = {
  cash: "Efectivo",
  debit: "Tarjeta de débito",
  credit: "Tarjeta de crédito",
  transfer: "Transferencia",
  check: "Cheque",
  redcompra: "Redcompra",
  agreement: "Convenio",
  voucher: "Bono (Fonasa, isapre)",
  other: "Otro",
};

/** Valor del enum `payment_method` que corresponde a cada tipo. */
const ENUM_DEL_TIPO: Record<TipoMedio, PaymentMethod> = {
  cash: "cash",
  debit: "debit_card",
  // Redcompra es la red de débito de Transbank: para la caja y los reportes
  // viejos cuenta como débito.
  redcompra: "debit_card",
  credit: "credit_card",
  transfer: "transfer",
  check: "other",
  agreement: "other",
  voucher: "other",
  other: "other",
};

export function esTipoMedio(valor: unknown): valor is TipoMedio {
  return typeof valor === "string" && (TIPOS_MEDIO as readonly string[]).includes(valor);
}

/**
 * Qué valor del enum se guarda en `payments.method` al cobrar con un medio.
 * `legacy_key` manda (es la equivalencia exacta de los cinco medios
 * originales); si no hay, sale del tipo; sin tipo, "other". Solo `cash` pasa
 * por el cajón (`esCobroEnEfectivo`).
 */
export function metodoDelMedio(
  kind: string | null | undefined,
  legacyKey: PaymentMethod | null | undefined,
): PaymentMethod {
  if (legacyKey) return legacyKey;
  if (esTipoMedio(kind)) return ENUM_DEL_TIPO[kind];
  return "other";
}
