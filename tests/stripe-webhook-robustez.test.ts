import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  esClaveLive,
  procesarWebhookStripe,
  type AdminClient,
  type StripeWebhookDeps,
} from "@/lib/stripe-webhook.server";

/**
 * Auditoría 360 (18-oct-2026): COD-02 y FN-01. Test puro: Stripe y Supabase
 * son falsos, no hay red ni base.
 */

type Resultado = { data?: unknown; error: { message: string; code?: string } | null };
type Llamada = { tabla: string; op: string; args: unknown[] };

/**
 * Cliente Supabase falso: cada `from(tabla)` devuelve un builder encadenable
 * que es "thenable" (como el de supabase-js) y resuelve con lo que diga
 * `respuestas[`${tabla}.${op}`]`. Registra cada operación.
 */
function adminFalso(respuestas: Record<string, Resultado> = {}) {
  const llamadas: Llamada[] = [];
  const from = (tabla: string) => {
    let op = "select";
    const builder: Record<string, unknown> = {};
    const registrar =
      (nombre: string, esOp = false) =>
      (...args: unknown[]) => {
        if (esOp) op = nombre;
        llamadas.push({ tabla, op: nombre, args });
        return builder;
      };
    builder.select = registrar("select", true);
    builder.insert = registrar("insert", true);
    builder.upsert = registrar("upsert", true);
    builder.update = registrar("update", true);
    builder.eq = registrar("eq");
    const resolver = () => respuestas[`${tabla}.${op}`] ?? { data: null, error: null };
    builder.maybeSingle = () => Promise.resolve(resolver());
    builder.then = (ok: (v: Resultado) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(resolver()).then(ok, ko);
    return builder;
  };
  return { admin: { from } as unknown as AdminClient, llamadas };
}

function evento(parcial: Partial<Stripe.Event> & { type: string; object: unknown }): Stripe.Event {
  return {
    id: "evt_1",
    object: "event",
    livemode: true,
    created: 1,
    api_version: "2026-07-29.dahlia",
    pending_webhooks: 1,
    request: null,
    ...parcial,
    data: { object: parcial.object },
  } as unknown as Stripe.Event;
}

const subActiva = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  metadata: { clinic_id: "clinic-1" },
  trial_end: null,
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_1" } }] },
} as unknown as Stripe.Subscription;

function deps(
  ev: Stripe.Event,
  admin: AdminClient,
  extra: Partial<StripeWebhookDeps> = {},
): StripeWebhookDeps & { reportarError: ReturnType<typeof vi.fn> } {
  const reportarError = vi.fn(async () => {});
  return {
    stripe: {
      webhooks: { constructEvent: () => ev } as unknown as StripeWebhookDeps["stripe"]["webhooks"],
      subscriptions: {
        retrieve: vi.fn(async () => subActiva),
        list: vi.fn(async () => ({ data: [subActiva] })),
      } as unknown as StripeWebhookDeps["stripe"]["subscriptions"],
      charges: {
        retrieve: vi.fn(async () => ({ customer: "cus_1" })),
      } as unknown as StripeWebhookDeps["stripe"]["charges"],
    },
    admin,
    webhookSecret: "whsec_x",
    secretKey: "sk_live_x",
    reportarError,
    avisos: {
      suscripcionActiva: vi.fn(async () => {}),
      pagoFallido: vi.fn(async () => {}),
      finDePrueba: vi.fn(async () => {}),
      staff: vi.fn(async () => {}),
    },
    medicion: { suscripcionActivada: vi.fn(async () => {}) },
    ...extra,
  } as StripeWebhookDeps & { reportarError: ReturnType<typeof vi.fn> };
}

const entrada = { rawBody: "{}", signature: "t=1,v1=x" };
const insertoEvento = (ll: Llamada[]) =>
  ll.some((l) => l.tabla === "stripe_events" && l.op === "insert");

describe("esClaveLive", () => {
  it("reconoce claves secretas y restringidas live", () => {
    expect(esClaveLive("sk_live_abc")).toBe(true);
    expect(esClaveLive("rk_live_abc")).toBe(true);
    expect(esClaveLive("sk_test_abc")).toBe(false);
    expect(esClaveLive("")).toBe(false);
  });
});

describe("webhook de Stripe: modo del evento (FN-01)", () => {
  it("un evento de modo prueba en un deploy live se ignora (200 + log + Sentry) sin tocar la base", async () => {
    const { admin, llamadas } = adminFalso();
    const ev = evento({
      type: "customer.subscription.updated",
      livemode: false,
      object: subActiva,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const d = deps(ev, admin);
    const res = await procesarWebhookStripe(entrada, d);

    // 200 para que Stripe no reintente días ni desactive el endpoint.
    expect(res.status).toBe(200);
    expect(llamadas).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    expect(d.reportarError).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("un evento live en un deploy de prueba también se ignora", async () => {
    const { admin, llamadas } = adminFalso();
    const ev = evento({ type: "customer.subscription.updated", livemode: true, object: subActiva });
    vi.spyOn(console, "warn").mockImplementationOnce(() => {});

    const res = await procesarWebhookStripe(entrada, deps(ev, admin, { secretKey: "sk_test_x" }));

    expect(res.status).toBe(200);
    expect(llamadas).toHaveLength(0);
  });

  it("un evento del mismo modo se procesa y se marca", async () => {
    const { admin, llamadas } = adminFalso();
    const ev = evento({ type: "customer.subscription.updated", object: subActiva });

    const res = await procesarWebhookStripe(entrada, deps(ev, admin));

    expect(res.status).toBe(200);
    expect(llamadas.some((l) => l.tabla === "subscriptions" && l.op === "upsert")).toBe(true);
    expect(insertoEvento(llamadas)).toBe(true);
  });
});

describe("webhook de Stripe: errores de escritura (COD-02)", () => {
  it("si falla el upsert de la suscripción: 500, reporta y NO marca el evento", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.upsert": { error: { message: "connection reset" } },
    });
    const ev = evento({ type: "customer.subscription.updated", object: subActiva });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const d = deps(ev, admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(500);
    expect(insertoEvento(llamadas)).toBe(false);
    expect(d.reportarError).toHaveBeenCalledTimes(1);
  });

  it("si falla la escritura tras un pago fallido: 500 sin marcar y sin mandar el correo", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.select": {
        data: { clinic_id: "clinic-1", stripe_subscription_id: "sub_1" },
        error: null,
      },
      "subscriptions.upsert": { error: { message: "timeout" } },
    });
    const ev = evento({
      type: "invoice.payment_failed",
      object: { id: "in_1", customer: "cus_1" },
    });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const d = deps(ev, admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(500);
    expect(insertoEvento(llamadas)).toBe(false);
    expect(d.avisos.pagoFallido).not.toHaveBeenCalled();
  });

  it("si falla la búsqueda de la clínica por customer: 500 (antes se saltaba el evento en silencio)", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.select": { data: null, error: { message: "pooler down" } },
    });
    const ev = evento({ type: "charge.refunded", object: { refunded: true, customer: "cus_1" } });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const res = await procesarWebhookStripe(entrada, deps(ev, admin));

    expect(res.status).toBe(500);
    expect(insertoEvento(llamadas)).toBe(false);
  });

  it("si falla marcar el evento (no por duplicado): 500 para que Stripe reintente", async () => {
    const { admin } = adminFalso({
      "stripe_events.insert": { error: { message: "disk full", code: "53100" } },
    });
    const ev = evento({ type: "customer.subscription.updated", object: subActiva });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const res = await procesarWebhookStripe(entrada, deps(ev, admin));

    expect(res.status).toBe(500);
  });

  it("si el evento ya lo marcó otra entrega concurrente (unique_violation): 200", async () => {
    const { admin } = adminFalso({
      "stripe_events.insert": { error: { message: "duplicate key", code: "23505" } },
    });
    const ev = evento({ type: "customer.subscription.updated", object: subActiva });

    const res = await procesarWebhookStripe(entrada, deps(ev, admin));

    expect(res.status).toBe(200);
  });
});

describe("webhook de Stripe: idempotencia", () => {
  it("un evento ya procesado responde 200 sin volver a escribir", async () => {
    const { admin, llamadas } = adminFalso({
      "stripe_events.select": { data: { id: "evt_1" }, error: null },
    });
    const ev = evento({ type: "customer.subscription.updated", object: subActiva });

    const res = await procesarWebhookStripe(entrada, deps(ev, admin));

    expect(res.status).toBe(200);
    expect(llamadas.some((l) => l.tabla === "subscriptions")).toBe(false);
    expect(insertoEvento(llamadas)).toBe(false);
  });

  it("sin firma: 400", async () => {
    const { admin } = adminFalso();
    const ev = evento({ type: "customer.subscription.updated", object: subActiva });
    const res = await procesarWebhookStripe({ rawBody: "{}", signature: null }, deps(ev, admin));
    expect(res.status).toBe(400);
  });
});

/**
 * Revisión del PR #69: los eventos llegan repetidos y fuera de orden. Se
 * guarda el estado ACTUAL de Stripe, nunca la foto del evento ni un
 * `past_due` fijo.
 */
describe("webhook de Stripe: eventos fuera de orden", () => {
  const upserts = (ll: Llamada[]) =>
    ll
      .filter((l) => l.tabla === "subscriptions" && l.op === "upsert")
      .map((l) => (l.args[0] as { status: string }).status);

  it("un invoice.payment_failed tardío, llegado después de que el cliente pagó, deja active y no avisa", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.select": {
        data: { clinic_id: "clinic-1", stripe_subscription_id: "sub_1" },
        error: null,
      },
    });
    const ev = evento({
      type: "invoice.payment_failed",
      object: { id: "in_viejo", customer: "cus_1", parent: null },
    });
    const d = deps(ev, admin); // retrieve devuelve la suscripción active

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(upserts(llamadas)).toEqual(["active"]);
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
    expect(d.avisos.pagoFallido).not.toHaveBeenCalled();
  });

  it("un payment_failed vigente guarda past_due y avisa una vez", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.select": {
        data: { clinic_id: "clinic-1", stripe_subscription_id: null },
        error: null,
      },
    });
    const ev = evento({
      type: "invoice.payment_failed",
      object: {
        id: "in_1",
        customer: "cus_1",
        parent: { subscription_details: { subscription: "sub_1" } },
      },
    });
    const d = deps(ev, admin);
    d.stripe.subscriptions.retrieve = vi.fn(async () => ({
      ...subActiva,
      status: "past_due",
    })) as unknown as StripeWebhookDeps["stripe"]["subscriptions"]["retrieve"];

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(upserts(llamadas)).toEqual(["past_due"]);
    expect(d.avisos.pagoFallido).toHaveBeenCalledTimes(1);
  });

  it("un customer.subscription.updated viejo (past_due) no pisa el estado actual (active)", async () => {
    const { admin, llamadas } = adminFalso();
    const ev = evento({
      type: "customer.subscription.updated",
      object: { ...subActiva, status: "past_due" },
    });
    const d = deps(ev, admin);

    await procesarWebhookStripe(entrada, d);

    expect(d.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(upserts(llamadas)).toEqual(["active"]);
  });
});
