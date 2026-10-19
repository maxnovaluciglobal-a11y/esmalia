import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

import { getStripe, stripeWebhookSecret } from "@/lib/stripe.server";
import {
  extractCurrentPeriodEndIso,
  procesarWebhookStripe,
  tieneMedioDePago,
  type AvisoStaff,
} from "@/lib/stripe-webhook.server";

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
 * Manejados en el código desde el 19-oct-2026 pero HAY QUE HABILITARLOS en
 * el endpoint de Stripe (si no, no llegan):
 *   - customer.subscription.trial_will_end (correo a la clínica 3 días antes)
 *   - charge.dispute.closed (quita la marca de revisión de la disputa y, si
 *     se perdió, cancela la suscripción en Stripe)
 *
 * `charge.refunded` total cancela la suscripción en Stripe (no solo en la
 * base) desde el 19-oct-2026.
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

/**
 * Correo "Quedan 3 días de prueba" de una suscripción de Stripe. Una vez por
 * suscripción y fecha de fin (`lifecycle_emails`). Nunca lanza.
 */
async function avisarFinDePrueba(clinicId: string, sub: Stripe.Subscription) {
  try {
    if (!sub.trial_end) return;
    let customer: Stripe.Customer | null = null;
    if (!tieneMedioDePago(sub) && typeof sub.customer === "string") {
      const c = await getStripe().customers.retrieve(sub.customer);
      customer = c.deleted ? null : c;
    }
    const { enviarFinDePruebaStripe, conTope } = await import("@/lib/email/ciclo-de-vida.server");
    const item = sub.items.data[0];
    const unit = item?.price?.unit_amount ?? null;
    await conTope(
      enviarFinDePruebaStripe({
        clinicId,
        subscriptionId: sub.id,
        trialEndIso: new Date(sub.trial_end * 1000).toISOString(),
        tieneMedioDePago: tieneMedioDePago(sub, customer),
        priceId: item?.price?.id ?? null,
        montoCents: unit === null ? null : unit * (item?.quantity ?? 1),
        currency: item?.price?.currency ? item.price.currency.toUpperCase() : null,
      }),
    );
  } catch (err) {
    console.warn("[lifecycle-email] fin de prueba", err instanceof Error ? err.message : err);
  }
}

/** Aviso al equipo de Esmalia (disputas, suscripción duplicada). Nunca lanza. */
async function avisarAlStaff(aviso: AvisoStaff) {
  try {
    const { enviarAvisoStaff } = await import("@/lib/admin/aviso-staff.server");
    let clinica: string | null = null;
    if (aviso.clinicId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("clinics")
        .select("name")
        .eq("id", aviso.clinicId)
        .maybeSingle();
      clinica = data?.name ?? null;
    }
    const { SITE_URL } = await import("@/lib/seo");
    await enviarAvisoStaff({
      asunto: aviso.asunto,
      lineas: aviso.clinicId ? [`Clínica: ${aviso.clinicId}.`, ...aviso.lineas] : aviso.lineas,
      clave: aviso.clave,
      clinica,
      enlaceAdmin: aviso.clinicId ? `${SITE_URL.replace(/\/+$/, "")}/admin/clinicas` : null,
    });
  } catch (err) {
    console.warn("[aviso-staff]", err instanceof Error ? err.message : err);
  }
}

/** `suscripcion_activada` desde la fuente confiable, una vez por suscripción. Nunca lanza. */
async function medirSuscripcionActivada(clinicId: string, sub: Stripe.Subscription) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registrarSuscripcionActivadaUnaVez, clinicaEsInterna } =
      await import("@/lib/marketing/suscripcion-activada.server");
    const { datosDelUsuario } = await import("@/lib/marketing/eventos-servidor.server");
    const interno = await clinicaEsInterna(
      supabaseAdmin,
      clinicId,
      async (userId) => (await datosDelUsuario(userId)).interno,
    );
    await registrarSuscripcionActivadaUnaVez({
      admin: supabaseAdmin,
      clinicId,
      subscriptionId: sub.id,
      estado: sub.status,
      fuente: "webhook",
      interno,
    });
  } catch (err) {
    console.warn("[ev] suscripcion_activada (webhook)", err instanceof Error ? err.message : err);
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
              finDePrueba: avisarFinDePrueba,
              staff: avisarAlStaff,
            },
            medicion: { suscripcionActivada: medirSuscripcionActivada },
          },
        );
      },
    },
  },
});
