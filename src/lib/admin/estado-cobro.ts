// src/lib/admin/estado-cobro.ts
//
// Qué ve el staff de Esmalia en `/admin/clinicas` sobre el cobro de cada
// clínica: mora con los días de gracia que quedan y la marca de disputa
// abierta. Puro (sin red ni base) para poder testearlo; la regla de acceso
// es la misma que ve la clínica (`accesoPorSuscripcion` en billing.ts).

import {
  accesoPorSuscripcion,
  SUBSCRIPTION_STATUSES,
  type Subscription,
  type SubscriptionStatus,
} from "@/lib/billing";

/** Lo que `listClinicsForStaff` lee de `subscriptions` para cada clínica. */
export type CobroStaffFila = {
  clinicId: string;
  status: string;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  pastDueSince: string | null;
  disputedAt: string | null;
  disputeId: string | null;
};

export type EstadoCobroStaff = {
  /**
   * `gracia`: cobro fallido, todo abierto todavía (`diasRestantes` null si
   * falta la fecha de inicio). `informes_pausados`: gracia agotada,
   * cancelada, impaga o trial vencido. `null`: al día.
   */
  mora:
    | { tipo: "gracia"; diasRestantes: number | null }
    | { tipo: "informes_pausados"; motivo: "trial_vencido" | "pago" }
    | null;
  disputa: { id: string | null; desde: string } | null;
};

export function estadoComoSubscription(fila: CobroStaffFila): Subscription {
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(fila.status)
    ? (fila.status as SubscriptionStatus)
    : "incomplete";
  return {
    clinicId: fila.clinicId,
    status,
    stripeCustomerId: null,
    stripeSubscriptionId: fila.stripeSubscriptionId,
    stripePriceId: null,
    trialEnd: fila.trialEnd,
    currentPeriodEnd: fila.currentPeriodEnd,
    cancelAtPeriodEnd: false,
    pastDueSince: fila.pastDueSince,
  };
}

export function estadoCobroStaff(
  fila: CobroStaffFila | null,
  ahora: Date = new Date(),
): EstadoCobroStaff {
  if (!fila) return { mora: null, disputa: null };
  const acceso = accesoPorSuscripcion(estadoComoSubscription(fila), ahora);
  const mora: EstadoCobroStaff["mora"] =
    acceso.nivel === "gracia"
      ? { tipo: "gracia", diasRestantes: acceso.diasRestantes }
      : acceso.nivel === "restringido"
        ? { tipo: "informes_pausados", motivo: acceso.motivo }
        : null;
  const disputa = fila.disputedAt ? { id: fila.disputeId, desde: fila.disputedAt } : null;
  return { mora, disputa };
}
