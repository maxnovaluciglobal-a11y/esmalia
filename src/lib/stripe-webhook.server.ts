import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";

/**
 * Núcleo del webhook de Stripe (`/api/stripe/webhook`), separado de la ruta
 * para poder testearlo con dependencias falsas (auditoría 360, 18-oct-2026:
 * COD-02 y FN-01).
 *
 * Tres reglas que no se negocian:
 *
 * 1. **El modo del evento tiene que coincidir con el de la clave.** En prod
 *    llegaron eventos `livemode=false` (de la cuenta de pruebas) mezclados con
 *    los reales: un `checkout.session.completed` de prueba podía activar o
 *    cancelar la suscripción de una clínica real. Si no coinciden → 400 sin
 *    procesar ni marcar.
 * 2. **supabase-js nunca lanza**: devuelve `{ error }`. Cada lectura y
 *    escritura se revisa; si algo falla se reporta y se responde 500 SIN
 *    insertar en `stripe_events`, para que Stripe reintente. Antes el flujo
 *    seguía, marcaba el evento y respondía 200: un cobro podía quedar sin
 *    registrar sin que nadie se enterara.
 * 3. **Idempotencia por `event.id`**: si ya está en `stripe_events`, 200 sin
 *    reprocesar. Todo lo que hace cada caso es idempotente (upsert por
 *    clínica, update a un estado fijo), así que un reintento tras un 500 es
 *    seguro.
 */

export type AdminClient = SupabaseClient<Database>;

export interface StripeWebhookDeps {
  stripe: {
    webhooks: Pick<Stripe["webhooks"], "constructEvent">;
    subscriptions: Pick<Stripe["subscriptions"], "retrieve">;
    charges: Pick<Stripe["charges"], "retrieve">;
  };
  admin: AdminClient;
  webhookSecret: string;
  /** `STRIPE_SECRET_KEY`: define si este deploy es live o test. */
  secretKey: string;
  reportarError: (err: unknown, contexto: { ruta: string; metodo?: string }) => Promise<void>;
  avisos: {
    suscripcionActiva: (clinicId: string, sub: Stripe.Subscription) => Promise<void>;
    pagoFallido: (clinicId: string, invoiceId: string, invoice: Stripe.Invoice) => Promise<void>;
  };
}

const RUTA = "/api/stripe/webhook";

/** Error de escritura/lectura en la base: el evento NO se marca y Stripe reintenta. */
export class ErrorDeBaseEnWebhook extends Error {
  constructor(operacion: string, causa: { message?: string } | null) {
    super(`${operacion}: ${causa?.message ?? "error desconocido"}`);
    this.name = "ErrorDeBaseEnWebhook";
  }
}

/** `sk_live_…` o `rk_live_…` (clave restringida) ⇒ el deploy procesa eventos live. */
export function esClaveLive(secretKey: string): boolean {
  return secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
}

// Auditoría de código 01-sep-2026: con apiVersion "2026-07-29.dahlia" (ver
// stripe.server.ts) Stripe ya no manda `current_period_end` en el objeto
// Subscription top-level — se movió a cada subscription item. Un solo item
// por sub (modelo v1, sin per-seat/add-ons).
export function extractCurrentPeriodEndIso(sub: Stripe.Subscription): string | null {
  const ts = sub.items.data[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

async function upsertSubscription(admin: AdminClient, clinicId: string, sub: Stripe.Subscription) {
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const { error } = await admin.from("subscriptions").upsert(
    {
      clinic_id: clinicId,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      status: sub.status,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_end: extractCurrentPeriodEndIso(sub),
      cancel_at_period_end: sub.cancel_at_period_end,
    },
    { onConflict: "clinic_id" },
  );
  if (error) throw new ErrorDeBaseEnWebhook("upsert subscriptions", error);
}

async function clinicaPorCustomer(admin: AdminClient, customerId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("clinic_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new ErrorDeBaseEnWebhook("buscar clínica por customer", error);
  return data?.clinic_id ?? null;
}

async function actualizarEstado(admin: AdminClient, clinicId: string, status: string) {
  const { error } = await admin.from("subscriptions").update({ status }).eq("clinic_id", clinicId);
  if (error) throw new ErrorDeBaseEnWebhook(`update subscriptions → ${status}`, error);
}

/** Aplica el evento. Devuelve la clínica afectada (para `stripe_events`). */
async function aplicarEvento(event: Stripe.Event, deps: StripeWebhookDeps): Promise<string | null> {
  const { admin, stripe, avisos } = deps;
  let clinicId: string | null = null;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      clinicId =
        (session.metadata?.clinic_id as string | undefined) ?? session.client_reference_id ?? null;
      if (clinicId && session.subscription) {
        const subId =
          typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        await upsertSubscription(admin, clinicId, sub);
        // Con trial, el checkout deja la suscripción en `trialing`: el
        // correo sale cuando pase a `active` (subscription.updated).
        if (sub.status === "active") await avisos.suscripcionActiva(clinicId, sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      clinicId = (sub.metadata?.clinic_id as string | undefined) ?? null;
      if (!clinicId && typeof sub.customer === "string") {
        clinicId = await clinicaPorCustomer(admin, sub.customer);
      }
      if (clinicId) {
        await upsertSubscription(admin, clinicId, sub);
        const previo = (event.data as { previous_attributes?: Partial<Stripe.Subscription> })
          .previous_attributes?.status;
        const recienActiva =
          sub.status === "active" &&
          (event.type === "customer.subscription.created" ||
            (event.type === "customer.subscription.updated" &&
              previo !== undefined &&
              previo !== "active"));
        if (recienActiva) await avisos.suscripcionActiva(clinicId, sub);
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId) {
        clinicId = await clinicaPorCustomer(admin, customerId);
        if (clinicId) {
          await actualizarEstado(admin, clinicId, "past_due");
          // Correo "No pudimos cobrar": una vez por factura. Nunca lanza.
          if (invoice.id) await avisos.pagoFallido(clinicId, invoice.id, invoice);
        }
      }
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      // `refunded` es true solo cuando el charge quedó reembolsado por
      // completo — un reembolso parcial no debe tocar el estado.
      if (charge.refunded) {
        const customerId =
          typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
        if (customerId) {
          clinicId = await clinicaPorCustomer(admin, customerId);
          if (clinicId) await actualizarEstado(admin, clinicId, "canceled");
        }
      }
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
      const disputedCharge = await stripe.charges.retrieve(chargeId);
      const customerId =
        typeof disputedCharge.customer === "string"
          ? disputedCharge.customer
          : disputedCharge.customer?.id;
      if (customerId) {
        clinicId = await clinicaPorCustomer(admin, customerId);
        if (clinicId) await actualizarEstado(admin, clinicId, "canceled");
      }
      break;
    }
    default:
      // Registramos y salimos — no procesamos eventos que no configuramos.
      break;
  }
  return clinicId;
}

/** Código de Postgres para unique_violation. */
const UNIQUE_VIOLATION = "23505";

export async function procesarWebhookStripe(
  input: { rawBody: string; signature: string | null },
  deps: StripeWebhookDeps,
): Promise<Response> {
  if (!input.signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = deps.stripe.webhooks.constructEvent(input.rawBody, input.signature, deps.webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid signature";
    return new Response(`webhook error: ${msg}`, { status: 400 });
  }

  // FN-01: un evento de modo prueba nunca toca datos de un deploy live (ni al revés).
  const deployLive = esClaveLive(deps.secretKey);
  if (event.livemode !== deployLive) {
    console.warn(
      "[stripe webhook] evento rechazado por modo",
      JSON.stringify({
        id: event.id,
        type: event.type,
        eventoLive: event.livemode,
        deployLive,
      }),
    );
    return new Response("livemode mismatch", { status: 400 });
  }

  const { admin } = deps;
  try {
    // Idempotencia
    const { data: exists, error: dupError } = await admin
      .from("stripe_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();
    if (dupError) throw new ErrorDeBaseEnWebhook("leer stripe_events", dupError);
    if (exists) return new Response("ok (dup)", { status: 200 });

    const clinicId = await aplicarEvento(event, deps);

    // Marcar procesado. Recién acá: si algo de arriba falló, no se llega.
    const { error: markError } = await admin.from("stripe_events").insert({
      id: event.id,
      type: event.type,
      clinic_id: clinicId,
      raw: event as unknown as Json,
    });
    // Otra entrega concurrente del mismo evento ganó la carrera: ya está
    // procesado (y lo que hicimos es idempotente), así que es un éxito.
    if (markError && markError.code !== UNIQUE_VIOLATION) {
      throw new ErrorDeBaseEnWebhook("insertar stripe_events", markError);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe webhook] failure", event.type, event.id, msg);
    await deps.reportarError(err, { ruta: `${RUTA} ${event.type}`, metodo: "POST" });
    // Sin insertar en stripe_events → Stripe reintenta.
    return new Response("processing error", { status: 500 });
  }
}
