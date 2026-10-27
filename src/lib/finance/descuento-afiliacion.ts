// Descuento de afiliación en el presupuesto (cierre · ítem 2).
//
// Un paciente puede llegar con una condición comercial: la empresa con
// convenio donde trabaja (descuento en % o monto por atención) o una
// membresía de la clínica (descuento en % sobre los tratamientos). Hasta ahora
// el descuento solo se mostraba en la ficha; ahora se propone al presupuestar
// como el descuento comercial de siempre: visible, editable y con su origen
// guardado en el presupuesto.
//
// Reglas (documentadas también en el PR):
//   - Los descuentos de empresa y de membresía NO se acumulan: se propone el
//     que más le ahorra al paciente sobre el subtotal; el otro queda a la vista
//     para elegirlo. Sumar condiciones comerciales es decisión de la clínica,
//     no de un cálculo escondido.
//   - Se aplica como descuento comercial (global, prorrateado a las líneas por
//     el cálculo del presupuesto), nunca como línea aparte ni por detrás.
//   - Lo que se guarda es el descuento comercial final; el rastro dice de dónde
//     salió y cuánto era lo propuesto, para que "ajustado" se vea.
//
// Lógica pura: sin red ni base.

import {
  descuentoSobre,
  describirDescuento,
  type TipoDescuento,
} from "@/lib/finance/empresas-convenio";
import { porcentajeDe } from "@/lib/finance/calculo-presupuesto";
import type { AffiliationDiscountTrace } from "@/lib/finance/finance";

export type OrigenDescuento = "empresa" | "membresia";

export const ETIQUETA_ORIGEN: Record<OrigenDescuento, string> = {
  empresa: "Empresa con convenio",
  membresia: "Membresía",
};

/** Un descuento de afiliación que se le puede proponer al presupuesto. */
export interface CandidatoDescuento {
  source: OrigenDescuento;
  /** Id de la empresa o del plan de membresía. */
  sourceId: string;
  /** "Constructora Andes", "Plan Sonrisa". */
  name: string;
  /** "15 % de descuento" · "$5.000 de descuento por atención". */
  rule: string;
  kind: "percent" | "amount";
  percent: number | null;
  cents: number | null;
}

export interface EmpresaParaDescuento {
  id: string;
  name: string;
  active: boolean;
  discountKind: TipoDescuento;
  discountPercent: number | null;
  discountCents: number | null;
  currency: string;
}

export interface MembresiaParaDescuento {
  planId: string | null;
  planName: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
  treatmentDiscountPercent: number | null;
}

/** Descuento de la empresa del paciente, o null si no tiene (o está inactiva). */
export function candidatoDeEmpresa(e: EmpresaParaDescuento | null): CandidatoDescuento | null {
  if (!e || !e.active) return null;
  if (e.discountKind === "percent" && e.discountPercent !== null && e.discountPercent > 0) {
    return {
      source: "empresa",
      sourceId: e.id,
      name: e.name,
      rule: describirDescuento(e),
      kind: "percent",
      percent: e.discountPercent,
      cents: null,
    };
  }
  if (e.discountKind === "amount" && e.discountCents !== null && e.discountCents > 0) {
    return {
      source: "empresa",
      sourceId: e.id,
      name: e.name,
      rule: describirDescuento(e),
      kind: "amount",
      percent: null,
      cents: e.discountCents,
    };
  }
  return null;
}

/**
 * Descuento de la membresía del paciente. Solo si está activa hoy: pausada,
 * cancelada, que todavía no empezó o ya terminó, no descuenta. `hoy` es el día
 * de la clínica (YYYY-MM-DD, regla 7).
 */
export function candidatoDeMembresia(
  m: MembresiaParaDescuento | null,
  hoy: string,
): CandidatoDescuento | null {
  if (!m || !m.planId) return null;
  if (m.status !== "active") return null;
  if (m.startsOn > hoy) return null;
  if (m.endsOn !== null && m.endsOn < hoy) return null;
  const pct = m.treatmentDiscountPercent;
  if (pct === null || !(pct > 0)) return null;
  const texto = Number.isInteger(pct) ? String(pct) : pct.toFixed(1).replace(".", ",");
  return {
    source: "membresia",
    sourceId: m.planId,
    name: m.planName,
    rule: `${texto} % de descuento en tratamientos`,
    kind: "percent",
    percent: pct,
    cents: null,
  };
}

/** Cuánto descuenta el candidato sobre un subtotal (cents, nunca más que el subtotal). */
export function valorDelCandidato(c: CandidatoDescuento, subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  if (c.kind === "percent") return porcentajeDe(subtotalCents, c.percent ?? 0);
  return descuentoSobre(subtotalCents, {
    discountKind: "amount",
    discountPercent: null,
    discountCents: c.cents,
    currency: "",
  });
}

/**
 * El candidato que más le ahorra al paciente sobre el subtotal. Con el mismo
 * ahorro (o sin subtotal todavía) gana el porcentaje, que sigue al presupuesto
 * mientras se le agregan líneas; si siguen empatados, la empresa.
 */
export function elegirMejor(
  candidatos: readonly CandidatoDescuento[],
  subtotalCents: number,
): CandidatoDescuento | null {
  let mejor: CandidatoDescuento | null = null;
  let mejorValor = -1;
  for (const c of candidatos) {
    const v = valorDelCandidato(c, subtotalCents);
    const gana =
      v > mejorValor ||
      (v === mejorValor && mejor !== null && c.kind === "percent" && mejor.kind === "amount");
    if (gana) {
      mejor = c;
      mejorValor = v;
    }
  }
  return mejor;
}

/** Lo que el diálogo manda como descuento comercial para un candidato. */
export function descuentoComercialDe(c: CandidatoDescuento): {
  modo: "pct" | "amount";
  valor: number;
} {
  return c.kind === "percent"
    ? { modo: "pct", valor: c.percent ?? 0 }
    : { modo: "amount", valor: c.cents ?? 0 };
}

export interface EstadoDelRastro {
  tipo: "igual" | "menor" | "mayor" | "quitado";
  /** Para mostrar junto al origen; vacío si el descuento sigue como se propuso. */
  texto: string;
}

/**
 * Cómo está hoy el descuento del presupuesto frente a la regla que se propuso:
 * para que no sea sorpresivo ni se pierda la trazabilidad si alguien lo
 * cambió. Compara contra la regla aplicada al subtotal de hoy (no contra un
 * monto viejo), así agregar líneas al presupuesto no lo marca como "ajustado".
 */
export function estadoDelRastro(
  rastro: Pick<AffiliationDiscountTrace, "percent" | "amountCents">,
  presupuesto: {
    subtotalCents: number;
    discountCents: number;
  },
): EstadoDelRastro {
  const esperado =
    rastro.percent !== null
      ? porcentajeDe(presupuesto.subtotalCents, rastro.percent)
      : Math.min(presupuesto.subtotalCents, Math.max(0, rastro.amountCents ?? 0));
  if (presupuesto.discountCents <= 0 && esperado > 0) {
    return { tipo: "quitado", texto: "se quitó al editar el presupuesto" };
  }
  if (presupuesto.discountCents === esperado) return { tipo: "igual", texto: "" };
  return presupuesto.discountCents < esperado
    ? { tipo: "menor", texto: "ajustado a la baja" }
    : { tipo: "mayor", texto: "ajustado al alza" };
}
