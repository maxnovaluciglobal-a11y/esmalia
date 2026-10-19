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
  subscriptions: Pick<Stripe["subscriptions"], "list" | "search">;
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
 * Suscripción viva de la clínica buscada por `metadata.clinic_id` (que el
 * checkout siempre setea en `subscription_data.metadata`). Cubre el caso en
 * que la fila local no tiene `stripe_customer_id` porque el webhook falló:
 * sin esto se creaba otro customer y otra suscripción (revisión del PR #69).
 * Devuelve el customer de esa suscripción, para abrir su portal.
 *
 * Ojo: la Search API de Stripe es eventualmente consistente (hasta ~1 min);
 * la clave de idempotencia por hora cubre el doble click inmediato.
 */
export async function customerConSuscripcionVivaDeLaClinica(
  stripe: Pick<StripeParaCheckout, "subscriptions">,
  clinicId: string,
): Promise<string | null> {
  // clinicId llega validado como UUID (zod); igual se escapan las comillas.
  const valor = clinicId.replace(/'/g, "\\'");
  const { data } = await stripe.subscriptions.search({
    query: `metadata['clinic_id']:'${valor}'`,
    limit: 20,
  });
  const viva = data.find((s) => esSuscripcionViva(s.status));
  if (!viva) return null;
  return typeof viva.customer === "string" ? viva.customer : viva.customer.id;
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

const HORA_MS = 60 * 60 * 1000;
/** Stripe exige que `subscription_data.trial_end` esté al menos 48 h en el futuro. */
const MINIMO_TRIAL_END_MS = 48 * HORA_MS;

/**
 * Trial del checkout (auditoría 360, BIL-04). Antes era siempre
 * `trial_period_days: 14`: una clínica en el día 13 del trial de la base (o
 * con el trial ya vencido) recibía 14 días más, y volver a pasar por el
 * checkout encadenaba pruebas.
 *
 * - Sin fila (clínica piloto anterior al trigger): nunca tuvo prueba → 14 días.
 * - Ya tuvo una suscripción en Stripe: la prueba ya se usó → sin trial.
 * - Trial de la base vigente: termina cuando termina el de la base. Si faltan
 *   menos de 48 h (el mínimo de Stripe) se redondea a ese mínimo: como mucho
 *   2 días de regalo, en vez de 14.
 * - Trial de la base vencido, o cualquier otro estado: sin trial, cobro
 *   inmediato.
 *
 * El mínimo se calcula desde el inicio de la hora para que dos llamadas con
 * la misma clave de idempotencia manden exactamente los mismos parámetros
 * (Stripe rechaza una clave repetida con parámetros distintos).
 */
export function trialDelCheckout(
  fila: FilaSuscripcionLocal,
  ahora: Date,
  diasTrialPorDefecto: number,
): { trial_end: number } | { trial_period_days: number } | null {
  if (!fila) return { trial_period_days: diasTrialPorDefecto };
  if (fila.stripe_subscription_id) return null;
  if (fila.status !== "trialing" || !fila.trial_end) return null;

  const fin = new Date(fila.trial_end).getTime();
  if (fin <= ahora.getTime()) return null;

  const inicioDeHora = Math.floor(ahora.getTime() / HORA_MS) * HORA_MS;
  const minimo = inicioDeHora + MINIMO_TRIAL_END_MS + HORA_MS;
  return { trial_end: Math.floor(Math.max(fin, minimo) / 1000) };
}

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

  const customerConSuscripcion =
    customerId && (await tieneSuscripcionViva(stripe, customerId))
      ? customerId
      : await customerConSuscripcionVivaDeLaClinica(stripe, p.clinicId);
  if (customerConSuscripcion) {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerConSuscripcion,
      return_url: p.portalReturnUrl,
    });
    return { url: portal.url, destino: "portal" };
  }

  const trial = trialDelCheckout(p.fila, p.ahora, p.diasTrialPorDefecto);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [{ price: p.priceId, quantity: 1 }],
      customer: customerId ?? undefined,
      customer_email: customerId ? undefined : (p.email ?? undefined),
      client_reference_id: p.clinicId,
      // Con trial el total del checkout es 0 y Stripe no pide tarjeta; sin
      // trial (prueba ya usada o vencida) el cobro es inmediato y la pide.
      payment_method_collection: "if_required",
      metadata: { clinic_id: p.clinicId, clinic_name: p.clinicName },
      subscription_data: {
        ...(trial ?? {}),
        // BIL-04: si la prueba termina sin tarjeta, Stripe cancela en vez de
        // emitir una factura impaga (`create_invoice`, el default, deja la
        // suscripción en `past_due`). Cancelada queda igual que una clínica
        // que nunca activó: informes pausados, nunca fuera de la app.
        ...(trial
          ? { trial_settings: { end_behavior: { missing_payment_method: "cancel" } } }
          : {}),
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
