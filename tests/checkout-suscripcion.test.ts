import { describe, expect, it, vi } from "vitest";

import {
  claveIdempotenciaCheckout,
  crearCheckoutOPortal,
  esSuscripcionViva,
  type FilaSuscripcionLocal,
} from "@/lib/checkout-suscripcion.server";

/**
 * Auditoría 360 (18-oct-2026), BIL-03: el checkout no puede crear una segunda
 * suscripción si ya hay una viva. Test puro: Stripe es falso, sin red ni base.
 */

/** Stripe falso con estado: `checkout.sessions.create` agrega una suscripción viva. */
function stripeFalso(subsIniciales: { status: string }[] = []) {
  const subs = [...subsIniciales];
  const sesionesPorClave = new Map<string, { url: string }>();
  const stripe = {
    subscriptions: {
      list: vi.fn(async () => ({ data: subs })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async (_params: unknown, opts?: { idempotencyKey?: string }) => {
          const clave = opts?.idempotencyKey ?? `sin-clave-${sesionesPorClave.size}`;
          const previa = sesionesPorClave.get(clave);
          if (previa) return previa;
          const sesion = { url: `https://checkout.stripe.test/${sesionesPorClave.size + 1}` };
          sesionesPorClave.set(clave, sesion);
          return sesion;
        }),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({ url: "https://billing.stripe.test/portal" })),
      },
    },
  };
  /** Simula que el cliente completó el checkout y Stripe creó la suscripción. */
  const completar = () => subs.push({ status: "trialing" });
  return { stripe, completar, subs };
}

const ahora = new Date("2026-10-19T12:34:00Z");

function params(fila: FilaSuscripcionLocal) {
  return {
    clinicId: "clinic-1",
    clinicName: "Clínica Uno",
    plan: "clinica",
    priceId: "price_clinica",
    email: "owner@example.test",
    fila,
    ahora,
    diasTrialPorDefecto: 14,
    successUrl: "https://esmalia.test/suscripcion?checkout=success",
    cancelUrl: "https://esmalia.test/suscripcion?checkout=cancel",
    portalReturnUrl: "https://esmalia.test/suscripcion",
  };
}

const conCustomer: FilaSuscripcionLocal = {
  status: "trialing",
  trial_end: "2026-10-25T00:00:00Z",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: null,
};

describe("esSuscripcionViva", () => {
  it("solo canceled e incomplete_expired son terminales", () => {
    for (const s of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
      expect(esSuscripcionViva(s)).toBe(true);
    }
    expect(esSuscripcionViva("canceled")).toBe(false);
    expect(esSuscripcionViva("incomplete_expired")).toBe(false);
  });
});

describe("crearCheckoutOPortal (BIL-03)", () => {
  it("dos checkouts seguidos no generan dos suscripciones: el segundo va al portal", async () => {
    const { stripe, completar, subs } = stripeFalso();

    const primero = await crearCheckoutOPortal(stripe, params(conCustomer));
    expect(primero.destino).toBe("checkout");
    completar();

    const segundo = await crearCheckoutOPortal(stripe, params(conCustomer));
    expect(segundo).toEqual({ url: "https://billing.stripe.test/portal", destino: "portal" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(subs).toHaveLength(1);
  });

  it("un past_due que aprieta 'Reactivar' va al portal a cambiar la tarjeta, no a otro checkout", async () => {
    const { stripe } = stripeFalso([{ status: "past_due" }]);
    const res = await crearCheckoutOPortal(stripe, params({ ...conCustomer, status: "past_due" }));
    expect(res.destino).toBe("portal");
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://esmalia.test/suscripcion",
    });
  });

  it("detecta una suscripción viva aunque la fila local no la tenga (webhook perdido)", async () => {
    const { stripe } = stripeFalso([{ status: "active" }]);
    const res = await crearCheckoutOPortal(stripe, params(conCustomer));
    expect(res.destino).toBe("portal");
  });

  it("con todas las suscripciones anteriores canceladas sí abre checkout", async () => {
    const { stripe } = stripeFalso([{ status: "canceled" }, { status: "incomplete_expired" }]);
    const res = await crearCheckoutOPortal(stripe, params({ ...conCustomer, status: "canceled" }));
    expect(res.destino).toBe("checkout");
  });

  it("sin customer no consulta Stripe y abre checkout con el email del owner", async () => {
    const { stripe } = stripeFalso();
    const res = await crearCheckoutOPortal(stripe, params(null));
    expect(res.destino).toBe("checkout");
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    const [payload] = stripe.checkout.sessions.create.mock.calls[0] as [
      { customer_email?: string },
    ];
    expect(payload.customer_email).toBe("owner@example.test");
  });

  it("un doble click en la misma hora usa la misma clave de idempotencia y devuelve la misma sesión", async () => {
    const { stripe } = stripeFalso();
    const a = await crearCheckoutOPortal(stripe, params(null));
    const b = await crearCheckoutOPortal(stripe, params(null));
    expect(a.url).toBe(b.url);
    const claves = stripe.checkout.sessions.create.mock.calls.map(
      (c) => (c[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(claves).toEqual([
      "checkout-clinic-1-clinica-2026101912",
      "checkout-clinic-1-clinica-2026101912",
    ]);
  });
});

describe("claveIdempotenciaCheckout", () => {
  it("cambia con la hora, el plan y la clínica", () => {
    const base = claveIdempotenciaCheckout("c1", "solo", ahora);
    expect(base).toBe("checkout-c1-solo-2026101912");
    expect(claveIdempotenciaCheckout("c1", "solo", new Date("2026-10-19T13:00:00Z"))).not.toBe(
      base,
    );
    expect(claveIdempotenciaCheckout("c1", "clinica", ahora)).not.toBe(base);
    expect(claveIdempotenciaCheckout("c2", "solo", ahora)).not.toBe(base);
  });
});
