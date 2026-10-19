import { describe, expect, it, vi } from "vitest";

import {
  claveIdempotenciaCheckout,
  crearCheckoutOPortal,
  esSuscripcionViva,
  trialDelCheckout,
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

/**
 * BIL-04: "activar sin tarjeta" no puede regalar 14 días extra ni dejar a la
 * clínica peor que si no hubiera activado.
 */
describe("trialDelCheckout (BIL-04)", () => {
  const enHoras = (h: number) => new Date(ahora.getTime() + h * 3_600_000).toISOString();
  const trialBase = (trialEnd: string): FilaSuscripcionLocal => ({
    status: "trialing",
    trial_end: trialEnd,
    stripe_customer_id: null,
    stripe_subscription_id: null,
  });
  const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  it("con el trial de la base vigente, termina cuando termina el de la base (no suma 14 días)", () => {
    const fin = enHoras(24 * 5);
    expect(trialDelCheckout(trialBase(fin), ahora, 14)).toEqual({ trial_end: unix(fin) });
  });

  it("si al trial de la base le quedan menos de 48 h, usa el mínimo de Stripe (≤ 2 días de regalo)", () => {
    const res = trialDelCheckout(trialBase(enHoras(10)), ahora, 14) as { trial_end: number };
    const minimoStripe = Math.floor(ahora.getTime() / 1000) + 48 * 3600;
    expect(res.trial_end).toBeGreaterThanOrEqual(minimoStripe);
    expect(res.trial_end).toBeLessThanOrEqual(minimoStripe + 3600);
  });

  it("el mínimo es estable dentro de la hora (misma clave de idempotencia ⇒ mismos parámetros)", () => {
    const fila = trialBase(enHoras(10));
    const a = trialDelCheckout(fila, new Date("2026-10-19T12:01:00Z"), 14);
    const b = trialDelCheckout(fila, new Date("2026-10-19T12:59:00Z"), 14);
    expect(a).toEqual(b);
  });

  it("con el trial de la base vencido: sin trial, cobro inmediato", () => {
    expect(trialDelCheckout(trialBase(enHoras(-1)), ahora, 14)).toBeNull();
  });

  it("si ya tuvo una suscripción en Stripe: sin trial (no se encadenan pruebas)", () => {
    expect(
      trialDelCheckout(
        {
          status: "canceled",
          trial_end: enHoras(-200),
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_old",
        },
        ahora,
        14,
      ),
    ).toBeNull();
  });

  it("clínica piloto sin fila: los 14 días de siempre", () => {
    expect(trialDelCheckout(null, ahora, 14)).toEqual({ trial_period_days: 14 });
  });
});

describe("crearCheckoutOPortal: parámetros del trial (BIL-04)", () => {
  type Payload = {
    payment_method_collection?: string;
    subscription_data?: {
      trial_end?: number;
      trial_period_days?: number;
      trial_settings?: { end_behavior: { missing_payment_method: string } };
    };
  };
  const payloadDe = (stripe: ReturnType<typeof stripeFalso>["stripe"]) =>
    stripe.checkout.sessions.create.mock.calls[0]![0] as Payload;

  it("con prueba: si termina sin tarjeta Stripe cancela (nunca una factura impaga → past_due)", async () => {
    const { stripe } = stripeFalso();
    await crearCheckoutOPortal(stripe, params(null));
    const sd = payloadDe(stripe).subscription_data!;
    expect(sd.trial_period_days).toBe(14);
    expect(sd.trial_settings).toEqual({ end_behavior: { missing_payment_method: "cancel" } });
  });

  it("sin prueba (trial vencido): ni trial ni trial_settings", async () => {
    const { stripe } = stripeFalso();
    await crearCheckoutOPortal(
      stripe,
      params({
        status: "trialing",
        trial_end: "2026-10-01T00:00:00Z",
        stripe_customer_id: null,
        stripe_subscription_id: null,
      }),
    );
    const sd = payloadDe(stripe).subscription_data!;
    expect(sd.trial_end).toBeUndefined();
    expect(sd.trial_period_days).toBeUndefined();
    expect(sd.trial_settings).toBeUndefined();
  });
});
