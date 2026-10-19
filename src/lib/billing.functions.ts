import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { assertNotDemoClinic, requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { urlDeLaApp } from "@/lib/app-origin.server";
import {
  requiereLlamadaOSuscripcion,
  SUBSCRIPTION_STATUSES,
  type Subscription,
} from "@/lib/billing";
import { mensajeDb } from "@/lib/db-errors";
import { planPriceId, getStripe, type BillingPlan } from "@/lib/stripe.server";

type SubscriptionRow = {
  clinic_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** Opcional: no existe hasta aplicar `20261019120000_subscriptions_past_due_since.sql`. */
  past_due_since?: string | null;
};

export function mapSubscription(row: SubscriptionRow): Subscription {
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as Subscription["status"])
    : "incomplete";
  return {
    clinicId: row.clinic_id,
    status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    trialEnd: row.trial_end,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    pastDueSince: row.past_due_since ?? null,
  };
}

/**
 * `*` y no una lista de columnas: `past_due_since` llega con una migración
 * que se aplica a mano (con OK de Walter). Pedirla por nombre antes de eso
 * haría fallar la consulta entera (42703) y con ella el estado de la
 * suscripción en toda la app. Con `*`, si la columna no está, simplemente no
 * viene y `mapSubscription` la trata como `null`.
 */
export const SUBSCRIPTION_SELECT = "*";

const SIN_PERMISOS_FACTURACION = "No tienes permisos para gestionar la suscripción de la clínica.";

/** Suscripción de la clínica activa. `null` si aún no se creó ninguna. */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Subscription | null> => {
    const { data: row, error } = await context.supabase
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la suscripción de la clínica."));
    if (!row) return null;
    return mapSubscription(row as SubscriptionRow);
  });

/**
 * Defensa en profundidad compartida de `requiereLlamadaOSuscripcion` (ver
 * billing.ts): el gate del cliente (`LlamadaDesbloqueo`) es solo UI — el JWT
 * vive en localStorage (regla 15 de la casa), así que cualquier miembro
 * puede llamar la server function directo. Un solo lugar en vez de repetir
 * el mapeo de `subscriptions` en cada caller (whatsapp/efectividad/portal
 * empezaron repitiéndolo — consolidado acá, mismo criterio que
 * `requireEsmaliaStaffEmail` en `lib/admin/staff-gate.ts`).
 */
export async function throwIfRequiresLlamadaOSuscripcion(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  mensaje: string,
) {
  const [{ data: subRow }, { data: clinicRow }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase.from("clinics").select("onboarding_call_at").eq("id", clinicId).maybeSingle(),
  ]);

  const sub = subRow ? mapSubscription(subRow as SubscriptionRow) : null;
  if (requiereLlamadaOSuscripcion(sub, clinicRow?.onboarding_call_at ?? null)) {
    throw new Error(mensaje);
  }
}

/**
 * Crea (o reutiliza) una sesión de Stripe Checkout para que la clínica
 * arranque su trial + suscripción. Devuelve la URL a la que hay que
 * redirigir. Guarda customer_id en la tabla local cuando lo obtiene.
 *
 * ⚠️ Requiere que Walter haya:
 *   1) Creado el producto + price en Stripe.
 *   2) Seteado STRIPE_SECRET_KEY y STRIPE_PRICE_ID_CLINIC_MONTHLY en env.
 *   3) Configurado el webhook a /api/stripe/webhook con STRIPE_WEBHOOK_SECRET.
 */
export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        plan: z.enum(["solo", "clinica"]).default("clinica"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { supabase, userId } = context;
    // Auditoría 10-oct-2026: la pantalla /suscripcion exige `settings:manage`,
    // pero el server fn no — cualquier miembro (recepción, asistente) podía
    // abrir un checkout a nombre de la clínica. Regla 15.
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "settings:manage",
      SIN_PERMISOS_FACTURACION,
    );
    await assertNotDemoClinic(supabase, data.clinicId);
    const stripe = getStripe();
    const priceId = planPriceId(data.plan as BillingPlan);

    // Traer datos de la clínica + email del owner para pre-poblar Stripe.
    const { data: clinic, error: clinicErr } = await supabase
      .from("clinics")
      .select("id, name")
      .eq("id", data.clinicId)
      .maybeSingle();
    if (clinicErr)
      throw new Error(
        mensajeDb(
          clinicErr,
          "No pudimos cargar los datos de la clínica para iniciar la suscripción.",
        ),
      );
    if (!clinic) throw new Error("Clínica no encontrada o no tienes permisos.");

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();

    const { data: existing } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("clinic_id", data.clinicId)
      .maybeSingle();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: existing?.stripe_customer_id ?? undefined,
      customer_email: existing?.stripe_customer_id ? undefined : (profile?.email ?? undefined),
      client_reference_id: data.clinicId,
      // No exigir tarjeta de entrada durante el trial (coherente con el copy
      // de suscripcion.tsx: "no cobramos hasta que termine" el trial). Con
      // trial_period_days > 0 el total del checkout es 0, así que Stripe
      // omite la recolección de método de pago con este flag.
      payment_method_collection: "if_required",
      metadata: {
        clinic_id: data.clinicId,
        clinic_name: clinic.name ?? "",
      },
      subscription_data: {
        trial_period_days: 14,
        metadata: { clinic_id: data.clinicId },
      },
      // El origen lo arma el servidor (PUBLIC_APP_URL): antes venía del
      // cliente y se podía mandar el retorno de Stripe a cualquier dominio.
      success_url: urlDeLaApp("/suscripcion?checkout=success"),
      cancel_url: urlDeLaApp("/suscripcion?checkout=cancel"),
    });

    if (!session.url) throw new Error("Stripe no devolvió URL de checkout.");
    return { url: session.url };
  });

/**
 * Portal de facturación de Stripe para que la clínica gestione método de
 * pago, cancele, descargue facturas. Devuelve URL para redirigir.
 */
export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await requireClinicPermission(
      context.supabase,
      data.clinicId,
      context.userId,
      "settings:manage",
      SIN_PERMISOS_FACTURACION,
    );
    await assertNotDemoClinic(context.supabase, data.clinicId);
    const stripe = getStripe();
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error)
      throw new Error(
        mensajeDb(error, "No pudimos acceder al portal de facturación de la clínica."),
      );
    if (!sub?.stripe_customer_id) {
      throw new Error("La clínica aún no tiene una suscripción activa.");
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: urlDeLaApp("/suscripcion"),
    });
    return { url: portal.url };
  });
