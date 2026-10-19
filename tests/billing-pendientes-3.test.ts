import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  procesarWebhookStripe,
  type AdminClient,
  type StripeWebhookDeps,
} from "@/lib/stripe-webhook.server";
import { estadoCobroStaff, type CobroStaffFila } from "@/lib/admin/estado-cobro";
import { correoPagoFallido } from "@/lib/email/plantillas";

/**
 * Billing pendientes 3 (auditoría 360, BIL-01/BIL-02, lo que quedó afuera de
 * #69 y #75). Puro: Stripe y Supabase falsos, sin red ni base.
 *
 * 1. Reembolso total y disputa perdida cancelan la suscripción EN STRIPE.
 * 2. Correo de pago fallido: gracia de 7 días, la ficha nunca se bloquea.
 * 3. `/admin/clinicas`: mora con días de gracia y marca de disputa.
 */

type Resultado = { data?: unknown; error: { message: string; code?: string } | null };
type Llamada = { tabla: string; op: string; args: unknown[] };

/** Cliente Supabase falso, encadenable y "thenable" como supabase-js. */
function adminFalso(respuestas: Record<string, Resultado> = {}) {
  const llamadas: Llamada[] = [];
  const from = (tabla: string) => {
    let op = "select";
    const builder: Record<string, unknown> = {};
    const registrar =
      (nombre: string, esOp = false) =>
      (...args: unknown[]) => {
        if (esOp && !(nombre === "select" && op !== "select")) op = nombre;
        llamadas.push({ tabla, op: nombre, args });
        return builder;
      };
    builder.select = registrar("select", true);
    builder.insert = registrar("insert", true);
    builder.upsert = registrar("upsert", true);
    builder.update = registrar("update", true);
    for (const f of ["eq", "is", "or", "in"]) builder[f] = registrar(f);
    const resolver = () => respuestas[`${tabla}.${op}`] ?? { data: null, error: null };
    builder.maybeSingle = () => Promise.resolve(resolver());
    builder.then = (ok: (v: Resultado) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(resolver()).then(ok, ko);
    return builder;
  };
  return { admin: { from } as unknown as AdminClient, llamadas };
}

function evento(type: string, object: unknown): Stripe.Event {
  return {
    id: "evt_1",
    object: "event",
    livemode: true,
    created: 1_800_000_000,
    api_version: "2026-07-29.dahlia",
    pending_webhooks: 1,
    request: null,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

function sub(parcial: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { clinic_id: "clinic-1" },
    trial_end: null,
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_1" } }] },
    ...parcial,
  } as unknown as Stripe.Subscription;
}

const facturaDe = (subId: string) => ({
  id: "in_1",
  parent: { subscription_details: { subscription: subId } },
});

function deps(
  ev: Stripe.Event,
  admin: AdminClient,
  opciones: {
    actual?: Stripe.Subscription;
    subDelCobro?: string | null;
    invoicePaymentsFalla?: boolean;
    cancelFalla?: boolean;
  } = {},
) {
  const actual = opciones.actual ?? sub();
  const subDelCobro = opciones.subDelCobro === undefined ? "sub_1" : opciones.subDelCobro;
  const d = {
    stripe: {
      webhooks: { constructEvent: () => ev },
      subscriptions: {
        retrieve: vi.fn(async (id: string) => ({ ...actual, id })),
        list: vi.fn(async () => ({ data: [] })),
        cancel: vi.fn(async (id: string) => {
          if (opciones.cancelFalla) throw new Error("stripe 503");
          return { ...actual, id, status: "canceled" };
        }),
      },
      charges: {
        retrieve: vi.fn(async () => ({ id: "ch_1", customer: "cus_1", payment_intent: "pi_1" })),
      },
      invoicePayments: {
        list: vi.fn(async () => {
          if (opciones.invoicePaymentsFalla) throw new Error("permission denied");
          return { data: subDelCobro ? [{ invoice: facturaDe(subDelCobro) }] : [] };
        }),
      },
    },
    admin,
    webhookSecret: "whsec_x",
    secretKey: "sk_live_x",
    reportarError: vi.fn(async () => {}),
    avisos: {
      suscripcionActiva: vi.fn(async () => {}),
      pagoFallido: vi.fn(async () => {}),
      finDePrueba: vi.fn(async () => {}),
      staff: vi.fn(async () => {}),
    },
    medicion: { suscripcionActivada: vi.fn(async () => {}) },
  };
  return d as typeof d & StripeWebhookDeps;
}

const entrada = { rawBody: "{}", signature: "t=1,v1=x" };
const filaClinica = {
  data: { clinic_id: "clinic-1", stripe_subscription_id: "sub_1" },
  error: null,
};
const marcoEvento = (ll: Llamada[]) =>
  ll.some((l) => l.tabla === "stripe_events" && l.op === "insert");
const upserts = (ll: Llamada[]) =>
  ll
    .filter((l) => l.tabla === "subscriptions" && l.op === "upsert")
    .map((l) => l.args[0] as { status: string; stripe_subscription_id: string });
const updates = (ll: Llamada[]) =>
  ll.filter((l) => l.tabla === "subscriptions" && l.op === "update").map((l) => l.args[0]);

const cobroReembolsado = {
  id: "ch_1",
  refunded: true,
  amount_refunded: 6900,
  currency: "usd",
  customer: "cus_1",
  payment_intent: "pi_1",
};

// ─── 1. Reembolso total y disputa perdida ────────────────────────────────

describe("charge.refunded total: cancela la suscripción en Stripe", () => {
  it("cancela de inmediato, sin prorrateo, con clave de idempotencia, y guarda lo que dice Stripe", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(evento("charge.refunded", cobroReembolsado), admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.invoicePayments.list).toHaveBeenCalledWith(
      expect.objectContaining({ payment: { type: "payment_intent", payment_intent: "pi_1" } }),
    );
    expect(d.stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
    const [id, params, opciones] = d.stripe.subscriptions.cancel.mock.calls[0] as unknown as [
      string,
      Stripe.SubscriptionCancelParams,
      Stripe.RequestOptions,
    ];
    expect(id).toBe("sub_1");
    expect(params).toMatchObject({ invoice_now: false, prorate: false });
    expect(opciones.idempotencyKey).toBe("cancelar-reembolso-total-ch_1");
    // Estado desde Stripe (upsert), nunca un `update({status})` fijo en la base.
    expect(upserts(llamadas)).toEqual([
      expect.objectContaining({ status: "canceled", stripe_subscription_id: "sub_1" }),
    ]);
    expect(updates(llamadas)).toEqual([]);
    expect(d.avisos.staff).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        clave: "cancelar-reembolso-total-ch_1",
        asunto: "Reembolso total: suscripción cancelada en Stripe",
      }),
    );
    expect(marcoEvento(llamadas)).toBe(true);
  });

  it("idempotente: si ya está cancelada no vuelve a llamar a cancel, pero avisa", async () => {
    const { admin } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(evento("charge.refunded", cobroReembolsado), admin, {
      actual: sub({ status: "canceled" }),
    });

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(d.avisos.staff).toHaveBeenCalledWith(
      expect.objectContaining({ asunto: "Reembolso total: la suscripción ya estaba cancelada" }),
    );
  });

  it("un reintento usa la misma clave de idempotencia (Stripe devuelve la misma respuesta)", async () => {
    const claves: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { admin } = adminFalso({ "subscriptions.select": filaClinica });
      const d = deps(evento("charge.refunded", cobroReembolsado), admin);
      await procesarWebhookStripe(entrada, d);
      const opciones = d.stripe.subscriptions.cancel.mock.calls[0]?.[2] as
        Stripe.RequestOptions | undefined;
      claves.push(String(opciones?.idempotencyKey));
    }
    expect(claves).toEqual(["cancelar-reembolso-total-ch_1", "cancelar-reembolso-total-ch_1"]);
  });

  it("reembolso parcial: no toca nada", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(evento("charge.refunded", { ...cobroReembolsado, refunded: false }), admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(upserts(llamadas)).toEqual([]);
    expect(d.avisos.staff).not.toHaveBeenCalled();
  });

  it("si Stripe falla al cancelar: 500 sin marcar el evento, para que reintente", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.select": filaClinica });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const d = deps(evento("charge.refunded", cobroReembolsado), admin, { cancelFalla: true });

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(500);
    expect(marcoEvento(llamadas)).toBe(false);
    expect(d.avisos.staff).not.toHaveBeenCalled();
  });

  it("cobro de otra suscripción (duplicada): cancela esa y no pisa la fila de la clínica", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(evento("charge.refunded", cobroReembolsado), admin, {
      subDelCobro: "sub_duplicada",
    });

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.cancel.mock.calls[0]?.[0]).toBe("sub_duplicada");
    expect(upserts(llamadas)).toEqual([]);
    const aviso = d.avisos.staff.mock.calls[0]?.[0] as unknown as { lineas: string[] };
    expect(aviso.lineas.join(" ")).toContain("sub_1");
  });

  it("si no se puede leer la factura del cobro: usa la de la fila, reporta y lo dice en el aviso", async () => {
    const { admin } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(evento("charge.refunded", cobroReembolsado), admin, {
      invoicePaymentsFalla: true,
    });

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.reportarError).toHaveBeenCalled();
    expect(d.stripe.subscriptions.cancel.mock.calls[0]?.[0]).toBe("sub_1");
    const aviso = d.avisos.staff.mock.calls[0]?.[0] as unknown as { lineas: string[] };
    expect(aviso.lineas.join(" ")).toContain("Confirmar en Stripe");
  });

  it("sin clínica para el customer: no cancela nada y avisa para revisar a mano", async () => {
    const { admin } = adminFalso({ "subscriptions.select": { data: null, error: null } });
    const d = deps(evento("charge.refunded", cobroReembolsado), admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(d.avisos.staff).toHaveBeenCalledWith(
      expect.objectContaining({ asunto: "Reembolso total: revisar a mano", clinicId: null }),
    );
  });
});

describe("charge.dispute.closed: perdida cancela en Stripe, ganada no", () => {
  const disputa = (status: string) =>
    ({ id: "dp_1", charge: "ch_1", status }) as unknown as Stripe.Dispute;

  it("perdida: cancela con la clave de la disputa y avisa además del cierre", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(evento("charge.dispute.closed", disputa("lost")), admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    const opciones = d.stripe.subscriptions.cancel.mock.calls[0]?.[2] as Stripe.RequestOptions;
    expect(opciones.idempotencyKey).toBe("cancelar-disputa-perdida-dp_1");
    expect(upserts(llamadas)).toEqual([expect.objectContaining({ status: "canceled" })]);
    const claves = d.avisos.staff.mock.calls.map(
      (c) => (c[0] as unknown as { clave: string }).clave,
    );
    expect(claves).toEqual(["cancelar-disputa-perdida-dp_1", "disputa-cerrada-dp_1"]);
  });

  it("ganada: solo quita la marca y avisa el cierre", async () => {
    const { admin } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(evento("charge.dispute.closed", disputa("won")), admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(d.avisos.staff).toHaveBeenCalledTimes(1);
  });

  it("disputa abierta: no pausa ni cancela el cobro (decisión pendiente de Walter)", async () => {
    const { admin } = adminFalso({ "subscriptions.select": filaClinica });
    const d = deps(
      evento("charge.dispute.created", {
        ...disputa("needs_response"),
        amount: 6900,
        currency: "usd",
        reason: "fraudulent",
        evidence_details: { due_by: 1_800_500_000 },
      }),
      admin,
    );

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(d.stripe.invoicePayments.list).not.toHaveBeenCalled();
  });
});

// ─── 2. Correo de pago fallido ───────────────────────────────────────────

describe("correo de pago fallido: gracia y nadie queda afuera", () => {
  const c = correoPagoFallido({
    appUrl: "https://esmalia.com",
    clinicName: "Clínica Sonrisa",
    montoCents: 6900,
    currency: "USD",
    proximoIntento: null,
  });

  it("explica los 7 días de gracia, la pausa de informes y que la ficha nunca se bloquea", () => {
    expect(c.text).toContain("7 días");
    expect(c.text).toContain("se pausan los informes");
    expect(c.text).toContain("fichas clínicas nunca se bloquean");
  });

  it("ya no describe la redirección del dueño a Suscripción (eliminada en #69)", () => {
    expect(c.text).not.toMatch(/te lleva a la página de Suscripción/);
    expect(c.text).not.toMatch(/cuenta de propietario/);
  });
});

// ─── 3. /admin/clinicas ──────────────────────────────────────────────────

describe("estadoCobroStaff (/admin/clinicas)", () => {
  const ahora = new Date("2026-10-19T12:00:00Z");
  const base: CobroStaffFila = {
    clinicId: "clinic-1",
    status: "active",
    trialEnd: null,
    currentPeriodEnd: "2026-11-19T12:00:00Z",
    stripeSubscriptionId: "sub_1",
    pastDueSince: null,
    disputedAt: null,
    disputeId: null,
  };

  it("al día y sin disputa: nada que mostrar", () => {
    expect(estadoCobroStaff(base, ahora)).toEqual({ mora: null, disputa: null });
  });

  it("en mora dentro de la gracia: días restantes", () => {
    const fila = { ...base, status: "past_due", pastDueSince: "2026-10-17T12:00:00Z" };
    expect(estadoCobroStaff(fila, ahora).mora).toEqual({ tipo: "gracia", diasRestantes: 5 });
  });

  it("en mora sin fecha de inicio: gracia sin cuenta regresiva", () => {
    const fila = { ...base, status: "past_due" };
    expect(estadoCobroStaff(fila, ahora).mora).toEqual({ tipo: "gracia", diasRestantes: null });
  });

  it("gracia agotada o cancelada: informes pausados por pago", () => {
    const agotada = { ...base, status: "past_due", pastDueSince: "2026-10-10T12:00:00Z" };
    expect(estadoCobroStaff(agotada, ahora).mora).toEqual({
      tipo: "informes_pausados",
      motivo: "pago",
    });
    expect(estadoCobroStaff({ ...base, status: "canceled" }, ahora).mora).toEqual({
      tipo: "informes_pausados",
      motivo: "pago",
    });
  });

  it("disputa abierta: la marca con id y fecha, sin cambiar la mora", () => {
    const fila = { ...base, disputedAt: "2026-10-18T09:00:00Z", disputeId: "dp_1" };
    expect(estadoCobroStaff(fila, ahora)).toEqual({
      mora: null,
      disputa: { id: "dp_1", desde: "2026-10-18T09:00:00Z" },
    });
  });

  it("sin fila (clínica piloto): nada", () => {
    expect(estadoCobroStaff(null, ahora)).toEqual({ mora: null, disputa: null });
  });
});
