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
  /**
   * Desde cuándo está en `past_due` (columna `past_due_since`, la mantiene un
   * trigger). Opcional: hasta que se aplique la migración
   * `20261019130000_subscriptions_past_due_since.sql` no viene, y una
   * `past_due` sin fecha se trata como dentro de la gracia.
   */
  pastDueSince?: string | null;
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

/** ¿Venció el trial de la base sin que la clínica activara nada? Es uno de
 *  los casos de `informesBloqueados` (el gate que usan las pantallas).
 *  La operación diaria —agenda, pacientes, ficha clínica— nunca se bloquea.
 *  Devuelve false para sub === null: las clínicas piloto anteriores al trigger
 *  siguen con acceso libre y no se tocan. */
export function trialInformesBloqueados(
  sub: Subscription | null,
  ahora: Date = new Date(),
): boolean {
  if (!sub) return false;
  if (sub.status !== "trialing") return false;
  if (sub.stripeSubscriptionId) return false;
  return !!sub.trialEnd && new Date(sub.trialEnd) <= ahora;
}

/** Días restantes de trial (o null si no está en trial). */
export function trialDaysLeft(sub: Subscription | null): number | null {
  if (!sub || sub.status !== "trialing" || !sub.trialEnd) return null;
  const diffMs = new Date(sub.trialEnd).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Días de acceso completo después de un cobro fallido (BIL-01). Stripe sigue
 * reintentando durante ese tiempo y la mayoría de los `past_due` se
 * recuperan solos: cortar al primer intento castiga a quien no hizo nada.
 */
export const GRACIA_PAGO_FALLIDO_DIAS = 7;

/**
 * Qué puede hacer la clínica según su suscripción (auditoría 360, BIL-01).
 *
 * - `completo`: todo abierto.
 * - `gracia`: cobro fallido hace menos de `GRACIA_PAGO_FALLIDO_DIAS`. Todo
 *   abierto, con un banner que avisa los días que quedan.
 * - `restringido`: trial vencido sin tarjeta, gracia agotada, cancelada,
 *   impaga, pausada o período vencido (pasada la tolerancia). Se bloquean
 *   los INFORMES (finanzas, comisiones, panel, inventario…), igual que con el
 *   trial vencido.
 *
 * ⚠️ Ningún estado expulsa de la app ni bloquea agenda, pacientes, ficha
 * clínica ni la exportación: la clínica es la custodia legal de la historia
 * clínica (CL Ley 20.584, MX NOM-004, CO Res. 1995) y los Términos dicen que
 * los datos no se pierden por un pago fallido. Antes, el owner con
 * `past_due`/`canceled` quedaba encerrado en `/suscripcion` desde el primer
 * intento fallido. El modo "solo lectura" completo (ver y exportar sí,
 * crear/editar no) queda como siguiente paso: hoy `restringido` reutiliza el
 * bloqueo de informes que ya existe y está probado.
 */
export type AccesoPorSuscripcion =
  | { nivel: "completo" }
  | { nivel: "gracia"; diasRestantes: number | null }
  | { nivel: "restringido"; motivo: "trial_vencido" | "pago" };

const DIA_MS = 24 * 60 * 60 * 1000;

export function accesoPorSuscripcion(
  sub: Subscription | null,
  ahora: Date = new Date(),
): AccesoPorSuscripcion {
  // Sin fila: clínicas piloto anteriores al trigger, no se tocan.
  if (!sub) return { nivel: "completo" };
  if (isSubscriptionActive(sub, ahora)) return { nivel: "completo" };

  if (sub.status === "past_due") {
    // Sin fecha (migración sin aplicar o fila vieja): no sabemos cuándo
    // empezó, así que se da la gracia. Cuando Stripe agote los reintentos la
    // suscripción pasa a `canceled`/`unpaid` y ahí sí se restringe.
    if (!sub.pastDueSince) return { nivel: "gracia", diasRestantes: null };
    const fin = new Date(sub.pastDueSince).getTime() + GRACIA_PAGO_FALLIDO_DIAS * DIA_MS;
    const restante = fin - ahora.getTime();
    if (restante > 0) return { nivel: "gracia", diasRestantes: Math.ceil(restante / DIA_MS) };
    return { nivel: "restringido", motivo: "pago" };
  }

  if (trialInformesBloqueados(sub, ahora)) return { nivel: "restringido", motivo: "trial_vencido" };
  return { nivel: "restringido", motivo: "pago" };
}

/** ¿Se bloquean los informes? Gate único para las rutas de informes y su par
 *  en el servidor (`requireFinanceView`). Agenda, pacientes y ficha nunca. */
export function informesBloqueados(sub: Subscription | null, ahora: Date = new Date()): boolean {
  return accesoPorSuscripcion(sub, ahora).nivel === "restringido";
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
