import Stripe from "stripe";

/**
 * Cliente Stripe server-only. Se instancia lazy — sin STRIPE_SECRET_KEY
 * el helper `getStripe()` tira un error claro. En dev local se puede
 * dejar sin key y todo el flujo de billing queda inactivo (sin crashear).
 *
 * Este archivo NO debe importarse desde componentes React del cliente
 * ni desde archivos que se bundlean para el navegador. El sufijo
 * `.server.ts` sirve de guardarraíl visual + Vite lo excluye del client.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY no está configurada. Setear en Vercel Env Vars y en .env local.",
    );
  }
  cached = new Stripe(key, {
    // Fijar apiVersion evita sorpresas cuando Stripe rota su default. Actualizar
    // manualmente después de leer el changelog.
    apiVersion: "2026-07-29.dahlia",
  });
  return cached;
}

export function stripeWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s) throw new Error("STRIPE_WEBHOOK_SECRET no configurada.");
  return s;
}

/**
 * Precios de lista (2026-08-22): dos tiers en vez de un flat único. El precio
 * fundador es un descuento del 50 % por 12 meses sobre estos precios (cupón de
 * Stripe), no un precio distinto.
 * "solo" = 1 profesional/sillón, "clinica" = hasta 3. Ambos con trial de
 * 14 días. Se crean en el dashboard de Stripe (o vía API), el ID va por
 * env var para poder rotarlos sin redeploy.
 */
export type BillingPlan = "solo" | "clinica";

export function planPriceId(plan: BillingPlan): string {
  const envVar =
    plan === "solo" ? "STRIPE_PRICE_ID_SOLO_MONTHLY" : "STRIPE_PRICE_ID_CLINIC_MONTHLY";
  const p = process.env[envVar];
  if (!p) throw new Error(`${envVar} no configurada.`);
  return p;
}
