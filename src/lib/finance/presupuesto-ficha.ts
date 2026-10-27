/**
 * "Presupuesto por fases" de la ficha (A+, 26-oct-2026): la tarjeta que el
 * prototipo pone junto a la nota SOAP. Muestra el plan vigente (o, si no
 * hay, el presupuesto abierto) agrupado por fase, con lo pagado y el saldo.
 * Lógica pura; los datos los trae `getPresupuestoDeLaFicha`, que exige
 * `finance:view` en el servidor (regla 15).
 */
import { groupByPhase } from "@/lib/finance/finance";

export type EstadoFase = "completada" | "en_curso" | "pendiente" | "por_aceptar";

export interface LineaFase {
  id: string;
  pieza: number | null;
  nombre: string;
  montoCents: number;
  pagadoCents: number;
}

export interface FasePresupuesto {
  /** `null` = líneas sin fase. */
  label: string | null;
  lineas: LineaFase[];
  subtotalCents: number;
  pagadoCents: number;
  estado: EstadoFase;
}

export interface PresupuestoFicha {
  origen: "plan" | "presupuesto";
  /** Número del presupuesto (P-0412, DEMO-0005). `null` si el plan no viene de uno. */
  numero: string | null;
  nombre: string;
  currency: string;
  /** Fecha de aceptación (plan) o de creación (presupuesto abierto), ISO. */
  fecha: string | null;
  /** Estado del presupuesto abierto (draft/sent); `null` en un plan. */
  estadoPresupuesto: string | null;
  fases: FasePresupuesto[];
  totalCents: number;
  pagadoCents: number;
  saldoCents: number;
}

/** Ítem de un plan de tratamiento (lo justo para la tarjeta). */
export interface ItemPlanFicha {
  id: string;
  toothNumber: number | null;
  nameSnapshot: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  priceCents: number;
  patientCents: number | null;
  phaseLabel: string | null;
  phasePosition: number;
  position: number;
}

export interface ItemPresupuestoFicha {
  id: string;
  toothNumber: number | null;
  nameSnapshot: string;
  totalCents: number;
  patientCents: number | null;
  phaseLabel: string | null;
  phasePosition: number;
  position: number;
  /** Aceptación parcial: `false` = el paciente no la aceptó. */
  accepted: boolean | null;
}

export interface PagoFicha {
  amountCents: number;
  treatmentItemId: string | null;
  treatmentPlanId: string | null;
  reversed: boolean;
}

/** Lo que paga el paciente por la línea (con convenio, no es el precio). */
function montoPaciente(it: { patientCents: number | null }, precio: number): number {
  return it.patientCents ?? precio;
}

function estadoDeFase(items: ItemPlanFicha[]): EstadoFase {
  const activos = items.filter((i) => i.status !== "skipped");
  if (activos.length > 0 && activos.every((i) => i.status === "completed")) return "completada";
  if (activos.some((i) => i.status === "completed" || i.status === "in_progress"))
    return "en_curso";
  return "pendiente";
}

/**
 * Plan vigente agrupado por fase. Lo pagado de cada línea es lo que se le
 * imputó (sin pasarse de su monto); lo pagado del plan suma además los pagos
 * imputados al plan sin línea. Los pagos reversados no cuentan, igual que en
 * el saldo del encabezado.
 *
 * Un pago "a cuenta" (sin plan ni línea) solo se puede atribuir sin dudas
 * cuando el paciente tiene un único plan: con `pagosACuentaDelPlan`, suma.
 * Así el saldo de la tarjeta coincide con el del encabezado en el caso común.
 */
export function presupuestoDesdePlan(args: {
  plan: { id: string; name: string; currency: string; startedAt: string | null };
  numero: string | null;
  items: ItemPlanFicha[];
  pagos: PagoFicha[];
  pagosACuentaDelPlan?: boolean;
}): PresupuestoFicha {
  const vigentes = args.pagos.filter((p) => !p.reversed);
  const pagadoPorItem = new Map<string, number>();
  let sueltoDelPlan = 0;
  for (const p of vigentes) {
    if (p.treatmentItemId) {
      pagadoPorItem.set(
        p.treatmentItemId,
        (pagadoPorItem.get(p.treatmentItemId) ?? 0) + p.amountCents,
      );
    } else if (
      p.treatmentPlanId === args.plan.id ||
      (p.treatmentPlanId === null && args.pagosACuentaDelPlan === true)
    ) {
      sueltoDelPlan += p.amountCents;
    }
  }
  const items = args.items.filter((i) => i.status !== "skipped");
  const grupos = groupByPhase(items, (i) => montoPaciente(i, i.priceCents));
  const fases: FasePresupuesto[] = grupos.map((g) => {
    const lineas = g.items.map((i) => {
      const monto = montoPaciente(i, i.priceCents);
      return {
        id: i.id,
        pieza: i.toothNumber,
        nombre: i.nameSnapshot,
        montoCents: monto,
        pagadoCents: Math.min(pagadoPorItem.get(i.id) ?? 0, monto),
      };
    });
    return {
      label: g.label,
      lineas,
      subtotalCents: g.subtotalCents,
      pagadoCents: lineas.reduce((s, l) => s + l.pagadoCents, 0),
      estado: estadoDeFase(g.items),
    };
  });
  const totalCents = fases.reduce((s, f) => s + f.subtotalCents, 0);
  const pagadoCents = Math.min(
    totalCents,
    fases.reduce((s, f) => s + f.pagadoCents, 0) + sueltoDelPlan,
  );
  return {
    origen: "plan",
    numero: args.numero,
    nombre: args.plan.name,
    currency: args.plan.currency,
    fecha: args.plan.startedAt,
    estadoPresupuesto: null,
    fases,
    totalCents,
    pagadoCents,
    saldoCents: totalCents - pagadoCents,
  };
}

/** Presupuesto abierto (borrador o emitido): todavía no hay pagos ni avance. */
export function presupuestoAbierto(args: {
  quote: {
    number: string;
    status: string;
    currency: string;
    createdAt: string;
  };
  items: ItemPresupuestoFicha[];
}): PresupuestoFicha {
  const items = args.items.filter((i) => i.accepted !== false);
  const grupos = groupByPhase(items, (i) => montoPaciente(i, i.totalCents));
  const fases: FasePresupuesto[] = grupos.map((g) => ({
    label: g.label,
    lineas: g.items.map((i) => ({
      id: i.id,
      pieza: i.toothNumber,
      nombre: i.nameSnapshot,
      montoCents: montoPaciente(i, i.totalCents),
      pagadoCents: 0,
    })),
    subtotalCents: g.subtotalCents,
    pagadoCents: 0,
    estado: "por_aceptar",
  }));
  const totalCents = fases.reduce((s, f) => s + f.subtotalCents, 0);
  return {
    origen: "presupuesto",
    numero: args.quote.number,
    nombre: args.quote.number,
    currency: args.quote.currency,
    fecha: args.quote.createdAt,
    estadoPresupuesto: args.quote.status,
    fases,
    totalCents,
    pagadoCents: 0,
    saldoCents: totalCents,
  };
}

/** Porcentaje pagado (0-100, entero) para la barra de cada fase. */
export function porcentajePagado(pagadoCents: number, totalCents: number): number {
  if (totalCents <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((pagadoCents / totalCents) * 100)));
}
