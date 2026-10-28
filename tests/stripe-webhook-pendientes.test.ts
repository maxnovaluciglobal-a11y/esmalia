import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  otrasSuscripcionesVivas,
  procesarWebhookStripe,
  tieneMedioDePago,
  type AdminClient,
  type StripeWebhookDeps,
} from "@/lib/stripe-webhook.server";
import { armarCorreoStaff } from "@/lib/admin/aviso-staff.server";
import { claveFinDePruebaStripe } from "@/lib/email/ciclo-de-vida";
import { correoFinDePruebaStripe } from "@/lib/email/plantillas";

/**
 * Pendientes de billing que dejó #69 (auditoría 360 del 18-oct-2026):
 * `trial_will_end`, disputas, segunda suscripción viva y la medición de
 * `suscripcion_activada` desde el webhook. Puro: Stripe y Supabase falsos.
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
        // `.select()` después de un insert/update no cambia la operación.
        if (esOp && !(nombre === "select" && op !== "select")) op = nombre;
        llamadas.push({ tabla, op: nombre, args });
        return builder;
      };
    builder.select = registrar("select", true);
    builder.insert = registrar("insert", true);
    builder.upsert = registrar("upsert", true);
    builder.update = registrar("update", true);
    builder.delete = registrar("delete", true);
    for (const f of ["eq", "is", "or", "in"]) builder[f] = registrar(f);
    const resolver = () => respuestas[`${tabla}.${op}`] ?? { data: null, error: null };
    builder.maybeSingle = () => Promise.resolve(resolver());
    builder.then = (ok: (v: Resultado) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(resolver()).then(ok, ko);
    return builder;
  };
  // El reclamo atómico del evento (RPC `claim_stripe_event`); por defecto lo gana esta entrega.
  const rpc = (fn: string, args: unknown) => {
    llamadas.push({ tabla: "rpc", op: fn, args: [args] });
    return Promise.resolve(respuestas[`rpc.${fn}`] ?? { data: "claimed", error: null });
  };
  return { admin: { from, rpc } as unknown as AdminClient, llamadas };
}

function evento(parcial: { type: string; object: unknown; livemode?: boolean }): Stripe.Event {
  return {
    id: "evt_1",
    object: "event",
    livemode: parcial.livemode ?? true,
    created: 1_800_000_000,
    api_version: "2026-07-29.dahlia",
    pending_webhooks: 1,
    request: null,
    type: parcial.type,
    data: { object: parcial.object },
  } as unknown as Stripe.Event;
}

function sub(parcial: Partial<Stripe.Subscription> & { id?: string } = {}): Stripe.Subscription {
  return {
    id: "sub_nueva",
    customer: "cus_1",
    status: "active",
    metadata: { clinic_id: "clinic-1" },
    trial_end: null,
    cancel_at_period_end: false,
    default_payment_method: null,
    default_source: null,
    items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_1" } }] },
    ...parcial,
  } as unknown as Stripe.Subscription;
}

const dispute = {
  id: "dp_1",
  charge: "ch_1",
  amount: 6900,
  currency: "usd",
  reason: "fraudulent",
  status: "needs_response",
  evidence_details: { due_by: 1_800_500_000 },
} as unknown as Stripe.Dispute;

function deps(
  ev: Stripe.Event,
  admin: AdminClient,
  opciones: {
    retrieve?: (id: string) => Promise<Stripe.Subscription>;
    list?: () => Promise<{ data: Stripe.Subscription[] }>;
  } = {},
) {
  const d = {
    stripe: {
      webhooks: { constructEvent: () => ev },
      subscriptions: {
        retrieve: vi.fn(opciones.retrieve ?? (async () => sub())),
        list: vi.fn(opciones.list ?? (async () => ({ data: [sub()] }))),
      },
      charges: { retrieve: vi.fn(async () => ({ customer: "cus_1" })) },
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
const filaClinica = { data: { clinic_id: "clinic-1" }, error: null };
const marcoEvento = (ll: Llamada[]) =>
  ll.some((l) => l.tabla === "stripe_events" && l.op === "update");
const updatesDe = (ll: Llamada[], tabla: string) =>
  ll.filter((l) => l.tabla === tabla && l.op === "update").map((l) => l.args[0]);

// ─── 1. trial_will_end ───────────────────────────────────────────────────

describe("customer.subscription.trial_will_end", () => {
  const enTrial = sub({ status: "trialing", trial_end: 1_800_259_200 });

  it("re-consulta la suscripción y avisa a la clínica si sigue en prueba", async () => {
    const { admin, llamadas } = adminFalso();
    const ev = evento({ type: "customer.subscription.trial_will_end", object: enTrial });
    const d = deps(ev, admin, { retrieve: async () => enTrial });

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_nueva");
    expect(d.avisos.finDePrueba).toHaveBeenCalledTimes(1);
    expect(d.avisos.finDePrueba).toHaveBeenCalledWith("clinic-1", enTrial);
    expect(marcoEvento(llamadas)).toBe(true);
  });

  it("si ya no está en prueba (pagó antes o canceló), no avisa", async () => {
    const { admin } = adminFalso();
    const ev = evento({ type: "customer.subscription.trial_will_end", object: enTrial });
    const d = deps(ev, admin, { retrieve: async () => sub({ status: "active" }) });

    await procesarWebhookStripe(entrada, d);

    expect(d.avisos.finDePrueba).not.toHaveBeenCalled();
  });

  it("un evento repetido no vuelve a avisar (idempotencia por event.id)", async () => {
    const { admin } = adminFalso({
      "rpc.claim_stripe_event": { data: "duplicate", error: null },
    });
    const ev = evento({ type: "customer.subscription.trial_will_end", object: enTrial });
    const d = deps(ev, admin, { retrieve: async () => enTrial });

    await procesarWebhookStripe(entrada, d);

    expect(d.avisos.finDePrueba).not.toHaveBeenCalled();
  });

  it("la clave del correo es la misma para la misma prueba y cambia si se extiende", () => {
    const a = claveFinDePruebaStripe("sub_1", "2027-01-10T15:00:00.000Z");
    expect(a).toBe(claveFinDePruebaStripe("sub_1", "2027-01-10T15:00:00.000Z"));
    expect(a).not.toBe(claveFinDePruebaStripe("sub_1", "2027-01-20T15:00:00.000Z"));
    expect(a).not.toBe(claveFinDePruebaStripe("sub_2", "2027-01-10T15:00:00.000Z"));
    // No choca con la clave del trial de la base (una fecha YYYY-MM-DD a secas).
    expect(a).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("tieneMedioDePago mira la suscripción y, si no, el customer", () => {
    expect(tieneMedioDePago(sub({ default_payment_method: "pm_1" }))).toBe(true);
    expect(tieneMedioDePago(sub())).toBe(false);
    expect(tieneMedioDePago(sub(), { invoice_settings: { default_payment_method: "pm_2" } })).toBe(
      true,
    );
    expect(tieneMedioDePago(sub(), { invoice_settings: null })).toBe(false);
  });
});

describe("correo de fin de prueba de Stripe", () => {
  const base = {
    appUrl: "https://esmalia.com",
    clinicName: "Clínica Sonrisa",
    nombre: "Ana Pérez",
    finDePrueba: "2027-01-10",
    plan: "Clínica",
    montoCents: 6900,
    currency: "USD",
  };

  it("con tarjeta: avisa el primer cobro y no pide nada", () => {
    const c = correoFinDePruebaStripe({ ...base, tieneMedioDePago: true });
    expect(c.subject).toBe("Tu prueba de Esmalia termina en 3 días");
    expect(c.text).toContain("primer cobro");
    expect(c.text).toContain("USD");
    expect(c.text).toContain("No tienes que hacer nada");
    expect(c.text).not.toContain("Agregar una tarjeta");
  });

  it("sin tarjeta: pide agregarla y aclara que la ficha sigue disponible", () => {
    const c = correoFinDePruebaStripe({ ...base, tieneMedioDePago: false });
    expect(c.text).toContain("todavía no hay una tarjeta registrada");
    expect(c.text).toContain("las fichas siguen disponibles");
    expect(c.html).toContain("/suscripcion");
  });

  it("tuteo neutro, sin voseo ni signos de exclamación", () => {
    for (const tiene of [true, false]) {
      const c = correoFinDePruebaStripe({ ...base, tieneMedioDePago: tiene });
      expect(c.text).not.toMatch(/\b(tenés|querés|podés|agregá|entrá|usá)\b/i);
      expect(c.text).not.toMatch(/[!¡]/);
    }
  });
});

// ─── 2. Disputas ─────────────────────────────────────────────────────────

describe("charge.dispute.created", () => {
  it("marca la suscripción para revisión, avisa al staff y NO la cancela", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.select": filaClinica });
    const ev = evento({ type: "charge.dispute.created", object: dispute });
    const d = deps(ev, admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    const updates = updatesDe(llamadas, "subscriptions");
    expect(updates).toEqual([{ disputed_at: expect.any(String), dispute_id: "dp_1" }]);
    // Nada de `status: canceled`: el acceso de la clínica no cambia.
    expect(llamadas.some((l) => JSON.stringify(l.args).includes("canceled"))).toBe(false);
    expect(d.avisos.staff).toHaveBeenCalledTimes(1);
    const aviso = d.avisos.staff.mock.calls[0][0];
    expect(aviso.clave).toBe("disputa-abierta-dp_1");
    expect(aviso.clinicId).toBe("clinic-1");
    expect(aviso.lineas.join("\n")).toContain(
      new Date(1_800_500_000 * 1000).toISOString().slice(0, 10),
    );
    expect(marcoEvento(llamadas)).toBe(true);
  });

  it("sin la migración aplicada (columna faltante): avisa igual, reporta y responde 200", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.select": filaClinica,
      "subscriptions.update": {
        error: { code: "PGRST204", message: "Could not find the 'dispute_id' column" },
      },
    });
    const ev = evento({ type: "charge.dispute.created", object: dispute });
    const d = deps(ev, admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.reportarError).toHaveBeenCalledTimes(1);
    expect(d.avisos.staff).toHaveBeenCalledTimes(1);
    expect(marcoEvento(llamadas)).toBe(true);
  });

  it("otro error de base al marcar: 500 sin marcar el evento ni avisar (Stripe reintenta)", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const { admin, llamadas } = adminFalso({
      "subscriptions.select": filaClinica,
      "subscriptions.update": { error: { code: "57014", message: "timeout" } },
    });
    const ev = evento({ type: "charge.dispute.created", object: dispute });
    const d = deps(ev, admin);

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(500);
    expect(marcoEvento(llamadas)).toBe(false);
    expect(d.avisos.staff).not.toHaveBeenCalled();
  });

  it("si no encuentra la clínica, avisa al staff igual para revisar a mano", async () => {
    const { admin, llamadas } = adminFalso();
    const ev = evento({ type: "charge.dispute.created", object: dispute });
    const d = deps(ev, admin);

    await procesarWebhookStripe(entrada, d);

    expect(updatesDe(llamadas, "subscriptions")).toEqual([]);
    expect(d.avisos.staff).toHaveBeenCalledTimes(1);
    expect(d.avisos.staff.mock.calls[0][0].clinicId).toBeNull();
  });
});

describe("charge.dispute.closed", () => {
  it("quita la marca solo si es de esa disputa y avisa el resultado", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.select": filaClinica });
    const ev = evento({
      type: "charge.dispute.closed",
      object: { ...dispute, status: "won" },
    });
    const d = deps(ev, admin);

    await procesarWebhookStripe(entrada, d);

    expect(updatesDe(llamadas, "subscriptions")).toEqual([{ disputed_at: null, dispute_id: null }]);
    expect(llamadas).toContainEqual({
      tabla: "subscriptions",
      op: "eq",
      args: ["dispute_id", "dp_1"],
    });
    expect(d.avisos.staff.mock.calls[0][0].clave).toBe("disputa-cerrada-dp_1");
  });
});

// ─── 3. Segunda suscripción viva ─────────────────────────────────────────

describe("segunda suscripción viva para la misma clínica (BIL-03)", () => {
  const checkout = evento({
    type: "checkout.session.completed",
    object: { metadata: { clinic_id: "clinic-1" }, subscription: "sub_nueva" },
  });

  it("otrasSuscripcionesVivas ignora la nueva, las muertas y los repetidos", () => {
    const nueva = { id: "sub_n", status: "active" };
    expect(
      otrasSuscripcionesVivas(nueva, [
        { id: "sub_n", status: "active" },
        { id: "sub_a", status: "past_due" },
        { id: "sub_a", status: "past_due" },
        { id: "sub_b", status: "canceled" },
        { id: "sub_c", status: "incomplete_expired" },
        { id: "sub_d", status: "trialing" },
      ]).map((s) => s.id),
    ).toEqual(["sub_a", "sub_d"]);
    // Si la nueva no está viva, no hay duplicado.
    expect(
      otrasSuscripcionesVivas({ id: "sub_n", status: "incomplete_expired" }, [
        { id: "sub_a", status: "active" },
      ]),
    ).toEqual([]);
  });

  it("avisa al staff y no cancela nada", async () => {
    const { admin, llamadas } = adminFalso();
    const d = deps(checkout, admin, {
      list: async () => ({ data: [sub(), sub({ id: "sub_vieja", status: "active" })] }),
    });

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.avisos.staff).toHaveBeenCalledTimes(1);
    const aviso = d.avisos.staff.mock.calls[0][0];
    expect(aviso.clave).toBe("suscripcion-duplicada-clinic-1-sub_nueva-sub_vieja");
    expect(aviso.lineas.join(" ")).toContain("sub_vieja");
    // La nueva se guarda igual; nadie llama a cancel (el falso ni lo tiene).
    expect(llamadas.some((l) => l.tabla === "subscriptions" && l.op === "upsert")).toBe(true);
  });

  it("encuentra la anterior por la fila local aunque esté en otro customer", async () => {
    const { admin } = adminFalso({
      "subscriptions.select": {
        data: { stripe_subscription_id: "sub_otro_customer" },
        error: null,
      },
    });
    const d = deps(checkout, admin, {
      list: async () => ({ data: [sub()] }),
      retrieve: async (id) =>
        id === "sub_otro_customer" ? sub({ id, status: "past_due", customer: "cus_2" }) : sub(),
    });

    await procesarWebhookStripe(entrada, d);

    expect(d.avisos.staff).toHaveBeenCalledTimes(1);
    expect(d.avisos.staff.mock.calls[0][0].lineas.join(" ")).toContain("sub_otro_customer");
  });

  it("una sola suscripción viva: no avisa", async () => {
    const { admin } = adminFalso();
    const d = deps(checkout, admin, {
      list: async () => ({ data: [sub(), sub({ id: "sub_vieja", status: "canceled" })] }),
    });

    await procesarWebhookStripe(entrada, d);

    expect(d.avisos.staff).not.toHaveBeenCalled();
  });

  it("si Stripe falla al listar, se reporta y el webhook sigue", async () => {
    const { admin, llamadas } = adminFalso();
    const d = deps(checkout, admin, {
      list: async () => {
        throw new Error("Stripe caído");
      },
    });

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(d.reportarError).toHaveBeenCalledTimes(1);
    expect(marcoEvento(llamadas)).toBe(true);
  });
});

// ─── 4. Medición desde el webhook ────────────────────────────────────────

describe("suscripcion_activada desde el webhook", () => {
  it("checkout.session.completed y subscription.created la miden", async () => {
    for (const ev of [
      evento({
        type: "checkout.session.completed",
        object: { metadata: { clinic_id: "clinic-1" }, subscription: "sub_nueva" },
      }),
      evento({ type: "customer.subscription.created", object: sub() }),
    ]) {
      const { admin } = adminFalso();
      const d = deps(ev, admin);
      await procesarWebhookStripe(entrada, d);
      expect(d.medicion.suscripcionActivada, ev.type).toHaveBeenCalledTimes(1);
    }
  });

  it("subscription.updated no la mide (una renovación no es una activación)", async () => {
    const { admin } = adminFalso();
    const ev = evento({ type: "customer.subscription.updated", object: sub() });
    const d = deps(ev, admin);

    await procesarWebhookStripe(entrada, d);

    expect(d.medicion.suscripcionActivada).not.toHaveBeenCalled();
  });

  it("si la medición lanza, el webhook responde 200 igual", async () => {
    vi.spyOn(console, "warn").mockImplementationOnce(() => {});
    const { admin, llamadas } = adminFalso();
    const ev = evento({ type: "customer.subscription.created", object: sub() });
    const d = deps(ev, admin);
    d.medicion.suscripcionActivada.mockRejectedValueOnce(new Error("boom"));

    const res = await procesarWebhookStripe(entrada, d);

    expect(res.status).toBe(200);
    expect(marcoEvento(llamadas)).toBe(true);
  });
});

// ─── Aviso al staff ──────────────────────────────────────────────────────

describe("correo al staff", () => {
  it("escapa el HTML y pone la clínica en el asunto", () => {
    const c = armarCorreoStaff({
      asunto: "Disputa abierta en Stripe",
      lineas: ["Motivo: <script>x</script>"],
      clave: "k",
      clinica: "Clínica Sonrisa",
      enlaceAdmin: "https://esmalia.com/admin/clinicas",
    });
    expect(c.subject).toBe("[Esmalia] Disputa abierta en Stripe: Clínica Sonrisa");
    expect(c.html).not.toContain("<script>");
    expect(c.text).toContain("/admin/clinicas");
  });
});
