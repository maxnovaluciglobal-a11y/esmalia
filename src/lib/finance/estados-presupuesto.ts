import type { QuoteStatus, TreatmentPlanStatus } from "@/lib/finance/finance";

/**
 * Estados del plan de tratamiento / presupuesto (PLA-02). Lógica pura.
 *
 * La base guarda el enum `quote_status` de siempre más 'partially_accepted'
 * (20261024200000). La app muestra siete estados:
 *
 *   borrador         ← draft
 *   emitido          ← sent
 *   aceptado         ← accepted / converted (la base pasa a 'converted' al crear el plan)
 *   aceptado parcial ← partially_accepted
 *   rechazado        ← rejected
 *   vencido          ← expired, o draft/sent con la validez ya pasada (antes de
 *                      que `vencer_presupuestos()` lo marque)
 *   finalizado       ← aceptado (total o parcial) cuyo plan está 'completed'
 */
export const ESTADOS_PLAN = [
  "borrador",
  "emitido",
  "aceptado",
  "aceptado_parcial",
  "rechazado",
  "vencido",
  "finalizado",
] as const;
export type EstadoPlan = (typeof ESTADOS_PLAN)[number];

export const ETIQUETA_ESTADO_PLAN: Record<EstadoPlan, string> = {
  borrador: "Borrador",
  emitido: "Emitido",
  aceptado: "Aceptado",
  aceptado_parcial: "Aceptado parcial",
  rechazado: "Rechazado",
  vencido: "Vencido",
  finalizado: "Finalizado",
};

/** Clases con tokens del sistema de color (regla 17). */
export const TONO_ESTADO_PLAN: Record<EstadoPlan, string> = {
  borrador: "border-border bg-muted text-muted-foreground",
  emitido: "border-info-border bg-info-soft text-info",
  aceptado: "border-success-border bg-success-soft text-success",
  aceptado_parcial: "border-success-border bg-success-soft text-success",
  rechazado: "border-destructive-border bg-destructive-soft text-destructive",
  vencido: "border-warning-border bg-warning-soft text-warning",
  finalizado: "border-brand bg-brand-soft text-brand-800",
};

/** Días de validez si la clínica no configuró otro (columna con default 30). */
export const DIAS_VALIDEZ_POR_DEFECTO = 30;
/** Desde cuántos días antes de vencer se avisa "por vencer". */
export const DIAS_AVISO_POR_VENCER = 7;

export function estadoDelPlan(
  p: { status: QuoteStatus; validUntil: string | null; planStatus?: TreatmentPlanStatus | null },
  hoy: string,
): EstadoPlan {
  switch (p.status) {
    case "accepted":
    case "converted":
      return p.planStatus === "completed" ? "finalizado" : "aceptado";
    case "partially_accepted":
      return p.planStatus === "completed" ? "finalizado" : "aceptado_parcial";
    case "rejected":
      return "rechazado";
    case "expired":
      return "vencido";
    case "draft":
    case "sent":
      if (p.validUntil && p.validUntil < hoy) return "vencido";
      return p.status === "draft" ? "borrador" : "emitido";
  }
}

/**
 * Transiciones permitidas, espejo exacto del guard de la base
 * (`validar_transicion_de_presupuesto`, migración 20261024200100). El paso de
 * 'accepted' a 'converted' no figura: lo hace el trigger de conversión en la
 * misma sentencia, nunca la app.
 */
export const TRANSICIONES: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ["sent", "accepted", "partially_accepted", "rejected", "expired"],
  sent: ["accepted", "partially_accepted", "rejected", "expired"],
  expired: ["sent", "draft"],
  accepted: [],
  partially_accepted: [],
  converted: [],
  rejected: [],
};

export function puedeTransicionar(desde: QuoteStatus, hacia: QuoteStatus): boolean {
  return desde === hacia || TRANSICIONES[desde].includes(hacia);
}

export function motivoTransicionInvalida(desde: QuoteStatus, hacia: QuoteStatus): string | null {
  if (puedeTransicionar(desde, hacia)) return null;
  if (TRANSICIONES[desde].length === 0) {
    return "Este presupuesto ya está cerrado: no cambia de estado.";
  }
  return "Ese cambio de estado no está permitido para este presupuesto.";
}

export type AccionDePresupuesto =
  "emitir" | "editar" | "aceptar" | "aceptar_parcial" | "rechazar" | "renovar";

/**
 * Qué se puede hacer con el presupuesto en su estado actual. Un borrador o
 * emitido con la validez ya pasada se trata como vencido aunque la base
 * todavía no lo haya marcado: se renueva antes de aceptarlo.
 */
export function accionesDisponibles(
  p: { status: QuoteStatus; validUntil: string | null },
  hoy: string,
): AccionDePresupuesto[] {
  const estado = estadoDelPlan(p, hoy);
  if (estado === "vencido") return ["renovar"];
  if (p.status === "draft") return ["emitir", "editar", "aceptar", "aceptar_parcial", "rechazar"];
  if (p.status === "sent") return ["editar", "aceptar", "aceptar_parcial", "rechazar"];
  return [];
}

/** `YYYY-MM-DD` + n días, en aritmética de calendario (sin husos). */
export function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d + n));
  return fecha.toISOString().slice(0, 10);
}

/** Validez por defecto de un presupuesto nuevo: hoy de la clínica + N días. */
export function validezPorDefecto(hoy: string, dias: number | null | undefined): string {
  const n = dias && dias > 0 ? Math.min(dias, 365) : DIAS_VALIDEZ_POR_DEFECTO;
  return sumarDias(hoy, n);
}

/** Días que le quedan (0 = vence hoy, negativo = vencido). `null` = sin validez. */
export function diasParaVencer(validUntil: string | null, hoy: string): number | null {
  if (!validUntil) return null;
  const [a1, m1, d1] = hoy.split("-").map(Number);
  const [a2, m2, d2] = validUntil.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/** Pendiente (borrador o emitido) que vence dentro del aviso. */
export function estaPorVencer(
  p: { status: QuoteStatus; validUntil: string | null },
  hoy: string,
  umbral = DIAS_AVISO_POR_VENCER,
): boolean {
  if (p.status !== "draft" && p.status !== "sent") return false;
  const dias = diasParaVencer(p.validUntil, hoy);
  return dias !== null && dias >= 0 && dias <= umbral;
}

/** Texto del aviso de validez ("Vence hoy", "Vence en 3 días", "Venció hace 2 días"). */
export function textoDeValidez(validUntil: string | null, hoy: string): string | null {
  const dias = diasParaVencer(validUntil, hoy);
  if (dias === null) return null;
  if (dias === 0) return "Vence hoy";
  if (dias === 1) return "Vence mañana";
  if (dias > 1) return `Vence en ${dias} días`;
  if (dias === -1) return "Venció ayer";
  return `Venció hace ${-dias} días`;
}
