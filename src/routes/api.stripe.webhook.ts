import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

import { getStripe, stripeWebhookSecret } from "@/lib/stripe.server";
import { extractCurrentPeriodEndIso, procesarWebhookStripe } from "@/lib/stripe-webhook.server";

/**
 * Webhook de Stripe. Endpoint real creado en Stripe el 01-sep-2026; hoy
 * apunta a `esmalia.com/api/stripe/webhook`. Eventos habilitados:
 *   - checkout.session.completed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_failed
 *   - charge.refunded
 *   - charge.dispute.created
 *
 * La lógica vive en `src/lib/stripe-webhook.server.ts` (testeable con
 * dependencias falsas): rechazo de eventos de otro modo (live/test),
 * idempotencia por `event.id` y 500 sin marcar el evento si falla cualquier
 * escritura, para que Stripe reintente.
 */

// Se re-exporta por compatibilidad con `tests/stripe-current-period-end.test.ts`.
export { extractCurrentPeriodEndIso };

/**
 * Correo "Tu suscripción está activa" (src/lib/email). Solo cuando la
 * suscripción QUEDA activa en este evento — no en cada renovación — y una
 * sola vez por suscripción (la clave de idempotencia es su id). Nunca lanza:
 * un correo no puede hacer que Stripe reintente el webhook.
 */
async function avisarSuscripcionActiva(clinicId: string, sub: Stripe.Subscription) {
  try {
    const { enviarSuscripcionActiva, conTope } = await import("@/lib/email/ciclo-de-vida.server");
    const item = sub.items.data[0];
    const price = item?.price;
    const unit = price?.unit_amount ?? null;
    const intervalo =
      price?.recurring?.interval === "month"
        ? "mes"
        : price?.recurring?.interval === "year"
          ? "año"
          : null;
    await conTope(
      enviarSuscripcionActiva({
        clinicId,
        subscriptionId: sub.id,
        priceId: price?.id ?? null,
        montoCents: unit === null ? null : unit * (item?.quantity ?? 1),
        currency: price?.currency ? price.currency.toUpperCase() : null,
        intervalo,
        proximoCobroIso: extractCurrentPeriodEndIso(sub),
      }),
    );
  } catch (err) {
    console.warn("[lifecycle-email] suscripción activa", err instanceof Error ? err.message : err);
  }
}

/** Correo "No pudimos cobrar": una vez por factura (clave: su id). Nunca lanza. */
async function avisarPagoFallido(clinicId: string, invoiceId: string, invoice: Stripe.Invoice) {
  try {
    const { enviarPagoFallido, conTope } = await import("@/lib/email/ciclo-de-vida.server");
    await conTope(
      enviarPagoFallido({
        clinicId,
        invoiceId,
        // Stripe habla en la unidad mínima de la moneda, igual que `formatMoney`.
        montoCents: invoice.amount_due ?? null,
        currency: invoice.currency ? invoice.currency.toUpperCase() : null,
        proximoIntentoIso: invoice.next_payment_attempt
          ? new Date(invoice.next_payment_attempt * 1000).toISOString()
          : null,
      }),
    );
  } catch (err) {
    console.warn("[lifecycle-email] pago fallido", err instanceof Error ? err.message : err);
  }
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("stripe-signature");
        const rawBody = await request.text();

        // Cargamos el admin client y Sentry dinámicamente para mantener este
        // archivo seguro de importar desde el cliente.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { capturarErrorDelServidor } = await import("@/lib/sentry.server");

        return procesarWebhookStripe(
          { rawBody, signature },
          {
            stripe: getStripe(),
            admin: supabaseAdmin,
            webhookSecret: stripeWebhookSecret(),
            secretKey: process.env.STRIPE_SECRET_KEY ?? "",
            reportarError: capturarErrorDelServidor,
            avisos: {
              suscripcionActiva: avisarSuscripcionActiva,
              pagoFallido: avisarPagoFallido,
            },
          },
        );
      },
    },
  },
});
