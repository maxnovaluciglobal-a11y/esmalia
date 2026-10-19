import type Stripe from "stripe";

/**
 * Decisiones del checkout de suscripción, separadas de la server function
 * para poder testearlas con un Stripe falso (auditoría 360, BIL-03).
 */

/** Estados de Stripe en los que la suscripción ya no cobra ni puede volver. */
export const ESTADOS_TERMINALES: readonly Stripe.Subscription.Status[] = [
  "canceled",
  "incomplete_expired",
];

export function esSuscripcionViva(status: string): boolean {
  return !(ESTADOS_TERMINALES as readonly string[]).includes(status);
}

type StripeParaCheckout = {
  subscriptions: Pick<Stripe["subscriptions"], "list">;
  checkout: { sessions: Pick<Stripe["checkout"]["sessions"], "create"> };
  billingPortal: { sessions: Pick<Stripe["billingPortal"]["sessions"], "create"> };
};

/**
 * ¿El cliente ya tiene una suscripción que sigue viva en Stripe?
 *
 * Se pregunta a Stripe y no a la fila local: la fila guarda una sola
 * suscripción (`onConflict: clinic_id`) y puede estar atrasada si un webhook
 * falló, justo el caso en que crear otra deja una huérfana cobrando.
 */
export async function tieneSuscripcionViva(
  stripe: Pick<StripeParaCheckout, "subscriptions">,
  customerId: string,
): Promise<boolean> {
  const { data } = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  });
  return data.some((s) => esSuscripcionViva(s.status));
}

/**
 * Clave de idempotencia del checkout: una por clínica, plan y hora (UTC).
 * Un doble click o un reintento dentro de la misma hora devuelve la MISMA
 * sesión en vez de abrir otra.
 */
export function claveIdempotenciaCheckout(clinicId: string, plan: string, ahora: Date): string {
  const hora = ahora.toISOString().slice(0, 13).replace(/[-T]/g, ""); // yyyymmddhh
  return `checkout-${clinicId}-${plan}-${hora}`;
}

export type FilaSuscripcionLocal = {
  status: string;
  trial_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
} | null;

export type ResultadoCheckout = { url: string; destino: "checkout" | "portal" };

/**
 * Abre el checkout, salvo que el cliente ya tenga una suscripción viva: en
 * ese caso devuelve el Portal de facturación (cambiar tarjeta o plan). Antes
 * el botón "Reactivar suscripción" de un `past_due` creaba una SEGUNDA
 * suscripción en el mismo customer y la primera seguía cobrando, fuera del
 * radar de la app (el upsert por `clinic_id` pisaba su id).
 */
export async function crearCheckoutOPortal(
  stripe: StripeParaCheckout,
  p: {
    clinicId: string;
    clinicName: string;
    plan: string;
    priceId: string;
    email: string | null;
    fila: FilaSuscripcionLocal;
    ahora: Date;
    diasTrialPorDefecto: number;
    successUrl: string;
    cancelUrl: string;
    portalReturnUrl: string;
  },
): Promise<ResultadoCheckout> {
  const customerId = p.fila?.stripe_customer_id ?? null;

  if (customerId && (await tieneSuscripcionViva(stripe, customerId))) {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: p.portalReturnUrl,
    });
    return { url: portal.url, destino: "portal" };
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [{ price: p.priceId, quantity: 1 }],
      customer: customerId ?? undefined,
      customer_email: customerId ? undefined : (p.email ?? undefined),
      client_reference_id: p.clinicId,
      // No exigir tarjeta de entrada durante el trial: con trial el total
      // del checkout es 0 y Stripe omite la recolección con este flag.
      payment_method_collection: "if_required",
      metadata: { clinic_id: p.clinicId, clinic_name: p.clinicName },
      subscription_data: {
        trial_period_days: p.diasTrialPorDefecto,
        metadata: { clinic_id: p.clinicId },
      },
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
    },
    { idempotencyKey: claveIdempotenciaCheckout(p.clinicId, p.plan, p.ahora) },
  );

  if (!session.url) throw new Error("Stripe no devolvió URL de checkout.");
  return { url: session.url, destino: "checkout" };
}
