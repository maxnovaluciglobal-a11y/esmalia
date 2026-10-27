import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";

import { planDeLaSuscripcion } from "../src/lib/stripe-webhook.server";

// El plan de la suscripción se guarda en `subscriptions.plan` para que el
// cupo de almacenamiento no dependa de un ID de precio concreto. Si Walter
// crea precios nuevos en Stripe (US$19,99 / US$49,99), el plan se sigue
// deduciendo por el metadata del checkout, por las variables de Vercel o por
// el propio precio (metadata `plan` o lookup_key).

function suscripcion(partes: {
  metadata?: Record<string, string>;
  priceId?: string;
  priceMetadata?: Record<string, string>;
  lookupKey?: string | null;
}): Stripe.Subscription {
  return {
    metadata: partes.metadata ?? {},
    items: {
      data: [
        {
          price: {
            id: partes.priceId ?? "price_x",
            metadata: partes.priceMetadata ?? {},
            lookup_key: partes.lookupKey ?? null,
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

describe("planDeLaSuscripcion", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("usa el metadata `plan` que pone el checkout", () => {
    expect(planDeLaSuscripcion(suscripcion({ metadata: { plan: "solo" } }))).toBe("solo");
    expect(planDeLaSuscripcion(suscripcion({ metadata: { plan: "clinica" } }))).toBe("clinica");
  });

  it("reconoce el precio por las variables de Vercel", () => {
    process.env.STRIPE_PRICE_ID_SOLO_MONTHLY = "price_solo_nuevo";
    process.env.STRIPE_PRICE_ID_CLINIC_MONTHLY = "price_clinica_nuevo";
    expect(planDeLaSuscripcion(suscripcion({ priceId: "price_solo_nuevo" }))).toBe("solo");
    expect(planDeLaSuscripcion(suscripcion({ priceId: "price_clinica_nuevo" }))).toBe("clinica");
  });

  it("cae al metadata o a la lookup_key del precio", () => {
    expect(planDeLaSuscripcion(suscripcion({ priceMetadata: { plan: "clinica" } }))).toBe(
      "clinica",
    );
    expect(planDeLaSuscripcion(suscripcion({ lookupKey: "esmalia_solo_monthly" }))).toBe("solo");
    expect(planDeLaSuscripcion(suscripcion({ lookupKey: "esmalia_clinic_monthly" }))).toBe(
      "clinica",
    );
  });

  it("devuelve null si no hay forma de saberlo (no borra el plan guardado)", () => {
    delete process.env.STRIPE_PRICE_ID_SOLO_MONTHLY;
    delete process.env.STRIPE_PRICE_ID_CLINIC_MONTHLY;
    expect(planDeLaSuscripcion(suscripcion({ metadata: { plan: "otro" } }))).toBeNull();
    expect(planDeLaSuscripcion(suscripcion({}))).toBeNull();
  });
});
