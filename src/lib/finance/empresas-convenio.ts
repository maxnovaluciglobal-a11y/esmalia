// Empresas con convenio y descuento por planilla (Ola 10 · frente A: FIN-11,
// FIC-05).
//
// Una empresa con convenio no es un seguro (esos siguen en /convenios, con su
// cobertura prestación por prestación): es el empleador del paciente, que le
// da un descuento y, con descuento por planilla, le paga a la clínica y se lo
// descuenta del sueldo. El estado de cuenta lo arma la base
// (`estado_cuenta_empresa`); acá se resume y se describe.
//
// Lógica pura: sin red ni base.

import type { ClinicRole } from "@/lib/access/access";
import { formatMoney } from "@/lib/finance/finance";

/**
 * Quién ve y edita la empresa y la membresía de un paciente: el equipo que
 * atiende y cobra. Mismo público que la RLS de `partner_company_patients`,
 * `patient_memberships` y `membership_charges` (assistant no: regla 2).
 */
export const ROLES_AFILIACION: readonly ClinicRole[] = [
  "owner",
  "admin",
  "dentist",
  "reception",
  "accounting",
];

export const TIPOS_DESCUENTO = ["percent", "amount", "none"] as const;
export type TipoDescuento = (typeof TIPOS_DESCUENTO)[number];

export const ETIQUETA_TIPO_DESCUENTO: Record<TipoDescuento, string> = {
  percent: "Porcentaje",
  amount: "Monto fijo por atención",
  none: "Sin descuento",
};

export interface EmpresaConvenio {
  id: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  discountKind: TipoDescuento;
  discountPercent: number | null;
  discountCents: number | null;
  currency: string;
  payrollDeduction: boolean;
  notes: string | null;
  active: boolean;
  affiliates: number;
}

type Descuento = Pick<
  EmpresaConvenio,
  "discountKind" | "discountPercent" | "discountCents" | "currency"
>;

/** "15 % de descuento" · "$5.000 de descuento por atención" · "Sin descuento". */
export function describirDescuento(e: Descuento): string {
  if (e.discountKind === "percent" && e.discountPercent !== null) {
    const pct = Number.isInteger(e.discountPercent)
      ? String(e.discountPercent)
      : e.discountPercent.toFixed(1).replace(".", ",");
    return `${pct} % de descuento`;
  }
  if (e.discountKind === "amount" && e.discountCents !== null) {
    return `${formatMoney(e.discountCents, e.currency)} de descuento por atención`;
  }
  return "Sin descuento";
}

/**
 * Descuento que corresponde sobre un monto (lo que paga el paciente). Nunca
 * más que el monto ni negativo; el porcentaje se redondea al peso (o centavo).
 */
export function descuentoSobre(montoCents: number, e: Descuento): number {
  if (montoCents <= 0) return 0;
  if (e.discountKind === "percent" && e.discountPercent !== null) {
    return Math.min(montoCents, Math.max(0, Math.round((montoCents * e.discountPercent) / 100)));
  }
  if (e.discountKind === "amount" && e.discountCents !== null) {
    return Math.min(montoCents, Math.max(0, e.discountCents));
  }
  return 0;
}

export interface FilaEstadoDeCuenta {
  patientId: string;
  fullName: string;
  employeeCode: string | null;
  realizadoCents: number;
  pagadoCents: number;
  saldoCents: number;
}

export interface ResumenEstadoDeCuenta {
  afiliados: number;
  /** Afiliados con algo realizado o pagado en el período. */
  conMovimiento: number;
  realizadoCents: number;
  pagadoCents: number;
  /** Suma de los saldos a cobrar (los saldos a favor no compensan otras deudas). */
  saldoCents: number;
  /** Lo que la empresa debería descontar por planilla y pagar; null sin planilla. */
  aDescontarCents: number | null;
}

export function resumirEstadoDeCuenta(
  filas: readonly FilaEstadoDeCuenta[],
  descuentoPorPlanilla: boolean,
): ResumenEstadoDeCuenta {
  let realizadoCents = 0;
  let pagadoCents = 0;
  let saldoCents = 0;
  let conMovimiento = 0;
  for (const f of filas) {
    realizadoCents += f.realizadoCents;
    pagadoCents += f.pagadoCents;
    if (f.saldoCents > 0) saldoCents += f.saldoCents;
    if (f.realizadoCents !== 0 || f.pagadoCents !== 0) conMovimiento += 1;
  }
  return {
    afiliados: filas.length,
    conMovimiento,
    realizadoCents,
    pagadoCents,
    saldoCents,
    aDescontarCents: descuentoPorPlanilla ? saldoCents : null,
  };
}

export interface EntradaEmpresa {
  name: string;
  discountKind: TipoDescuento;
  discountPercent: number | null;
  discountCents: number | null;
  contactEmail: string | null;
}

/** Errores en palabras de la clínica; lista vacía = válido. */
export function validarEmpresa(e: EntradaEmpresa): string[] {
  const errores: string[] = [];
  if (!e.name.trim()) errores.push("Indica el nombre de la empresa.");
  if (e.discountKind === "percent") {
    if (e.discountPercent === null || !(e.discountPercent > 0) || e.discountPercent > 100)
      errores.push("El porcentaje de descuento va de 0,1 a 100.");
  }
  if (e.discountKind === "amount") {
    if (e.discountCents === null || !Number.isInteger(e.discountCents) || e.discountCents <= 0)
      errores.push("El monto de descuento tiene que ser mayor que cero.");
  }
  if (e.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.contactEmail.trim()))
    errores.push("El correo de contacto no parece válido.");
  return errores;
}
