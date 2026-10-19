/**
 * Tipos y constantes de billing compartidos entre cliente y servidor.
 * No importa `stripe` acá — es puramente estructural.
 */

export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  incomplete: "Incompleto",
  incomplete_expired: "Expirado",
  trialing: "Prueba gratis",
  active: "Activo",
  past_due: "Pago vencido",
  canceled: "Cancelado",
  unpaid: "No pagado",
  paused: "Pausado",
};

export interface Subscription {
  clinicId: string;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** Duración del trial. Única fuente de verdad: la migración que crea la fila
 *  y este valor tienen que decir lo mismo. DypOS lo tiene hardcodeado en dos
 *  INSERT distintos. */
export const TRIAL_DAYS = 14;

/**
 * Margen sobre las fechas que mueve Stripe (`currentPeriodEnd`, y `trialEnd`
 * cuando el trial lo gestiona Stripe). Auditoría 360 (FN-04): si el webhook
 * de renovación se atrasa o falla (firma, deploy, base caída → 500 y Stripe
 * reintenta durante horas), la fecha local vence aunque el cliente esté al
 * día. Durante estas 72 h la fila se considera vigente; si de verdad no
 * pagó, Stripe manda `past_due`/`canceled` mucho antes.
 */
export const TOLERANCIA_RENOVACION_MS = 72 * 60 * 60 * 1000;

function vencidaConTolerancia(iso: string, ahora: Date): boolean {
  return new Date(iso).getTime() + TOLERANCIA_RENOVACION_MS <= ahora.getTime();
}

/** Considerada operativa: el usuario tiene acceso completo al panel. */
export function isSubscriptionActive(sub: Subscription | null, ahora: Date = new Date()): boolean {
  if (!sub) return false;
  if (sub.status !== "trialing" && sub.status !== "active") return false;
  // Un trial con trial_end pasado está vencido aunque currentPeriodEnd sea
  // null: sin esta línea, la fila que crea el trigger nunca expiraría.
  // El trial de la base (sin suscripción en Stripe) vence en punto: no hay
  // webhook que esperar. El de Stripe tiene la misma tolerancia que la
  // renovación, porque el paso a `active` también llega por webhook.
  if (sub.status === "trialing" && sub.trialEnd) {
    const vencido = sub.stripeSubscriptionId
      ? vencidaConTolerancia(sub.trialEnd, ahora)
      : new Date(sub.trialEnd) <= ahora;
    if (vencido) return false;
  }
  if (sub.currentPeriodEnd && vencidaConTolerancia(sub.currentPeriodEnd, ahora)) return false;
  return true;
}

/** ¿Se bloquean los INFORMES (finanzas, comisiones, panel, inventario)?
 *  La operación diaria —agenda, pacientes, ficha clínica— nunca se bloquea.
 *  Devuelve false para sub === null: las clínicas piloto anteriores al trigger
 *  siguen con acceso libre y no se tocan. */
export function trialInformesBloqueados(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status !== "trialing") return false;
  if (sub.stripeSubscriptionId) return false;
  return !!sub.trialEnd && new Date(sub.trialEnd) <= new Date();
}

/** Días restantes de trial (o null si no está en trial). */
export function trialDaysLeft(sub: Subscription | null): number | null {
  if (!sub || sub.status !== "trialing" || !sub.trialEnd) return null;
  const diffMs = new Date(sub.trialEnd).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * ¿Corresponde expulsar al owner de TODA la app hacia `/suscripcion`?
 *
 * Task 11, fix round 1: extraída de `_clinic/route.tsx::beforeLoad`, donde
 * vivía como expresión inline sin ningún test — la única línea que separa
 * "el trial venció y se activan los informes" de "el trial venció y se
 * cierra la app entera". `trialInformesBloqueados(sub) === true` implica
 * siempre `isSubscriptionActive(sub) === false` (un trial vencido sin
 * tarjeta nunca está "activo"), así que restar ese caso de
 * `!isSubscriptionActive(sub)` deja pasar exactamente "trial recién vencido,
 * sin tarjeta" y sigue expulsando en todos los demás casos de post-trial:
 * `past_due`/`canceled`/`unpaid`, o una suscripción `active` cuyo período ya
 * venció.
 */
export function debeExpulsarDeLaApp(sub: Subscription | null): boolean {
  return !!sub && !isSubscriptionActive(sub) && !trialInformesBloqueados(sub);
}

/**
 * ¿Hace falta agendar la llamada o suscribirse para esta feature avanzada?
 *
 * A diferencia de `trialInformesBloqueados` (por tiempo, día 15+), este gate
 * aplica desde el día 1 del trial — no es "seguís gratis 2 semanas", es
 * "todavía no diste señal de intención de compra". Dos salidas, las dos
 * reales: agendar la llamada (`onboardingCallAt` se setea), o suscribirse
 * (`sub.status` pasa a `"active"`). Nunca ambas condiciones a la vez son
 * necesarias — OR entre salidas, no AND.
 *
 * Features afectadas: WhatsApp automático real, portal del paciente,
 * /efectividad. Las tres desde el día 1.
 */
export function requiereLlamadaOSuscripcion(
  sub: Subscription | null,
  onboardingCallAt: string | null,
): boolean {
  // Sin suscripción = clínica piloto anterior al trigger, no se toca.
  if (!sub) return false;
  // Ya se suscribió (active, past_due en gracia, etc.): nunca bloquea.
  if (sub.status !== "trialing") return false;
  // Está en trial pero ya agendó: desbloqueado.
  if (onboardingCallAt) return false;
  // En trial sin agendar: bloqueado.
  return true;
}

/**
 * Si el banner tiene algo que decir. La usa `StatusStrip` para decidir la
 * prioridad sin renderizar el banner: mismas condiciones que `TrialBanner`.
 */
export function trialBannerVisible(sub: Subscription | null | undefined): boolean {
  if (sub === undefined) return false;
  if (sub === null) return true;
  return !(isSubscriptionActive(sub) && sub.status === "active");
}
