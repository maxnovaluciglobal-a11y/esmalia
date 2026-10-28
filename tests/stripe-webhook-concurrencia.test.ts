import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  LEASE_RECLAMO_EVENTO_SEGUNDOS,
  procesarWebhookStripe,
  type AdminClient,
  type StripeWebhookDeps,
} from "@/lib/stripe-webhook.server";

/**
 * Reclamo atómico del evento (P1 de la transferencia, 28-oct-2026).
 *
 * Antes el handler hacía SELECT → aplicar → INSERT: dos entregas simultáneas del
 * mismo `event.id` pasaban las dos el SELECT y aplicaban los efectos dos veces.
 * Estos tests lanzan varias entregas a la vez contra una base falsa que imita la
 * semántica de `claim_stripe_event` (reclamo, marca, vencimiento del plazo) y
 * cuentan los efectos. La semántica real de la RPC en Postgres, con conexiones
 * concurrentes de verdad, la cubre `tests/stripe-claim-db.test.ts`.
 */

type Fila = { claimedAt: number; processed: boolean };

/** Base falsa con el estado de `stripe_events` y un reloj que se puede adelantar. */
function baseFalsa(opts: { demoraAplicarMs?: number; fallaAplicar?: () => boolean } = {}) {
  const filas = new Map<string, Fila>();
  const reloj = { ahora: 1_000_000 };
  const efectos: string[] = [];
  const reclamos: string[] = [];

  const rpc = async (_fn: string, args: { p_id: string; p_lease_seconds: number }) => {
    // Sin ningún `await` entre leer y escribir: igual de atómico que el INSERT … ON CONFLICT.
    const fila = filas.get(args.p_id);
    if (!fila) {
      filas.set(args.p_id, { claimedAt: reloj.ahora, processed: false });
      reclamos.push("claimed");
      return { data: "claimed", error: null };
    }
    if (!fila.processed && fila.claimedAt < reloj.ahora - args.p_lease_seconds * 1000) {
      fila.claimedAt = reloj.ahora;
      reclamos.push("claimed");
      return { data: "claimed", error: null };
    }
    const r = fila.processed ? "duplicate" : "in_progress";
    reclamos.push(r);
    return { data: r, error: null };
  };

  const from = (tabla: string) => {
    let op = "select";
    let valores: Record<string, unknown> = {};
    const filtros: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.upsert = (v: Record<string, unknown>) => {
      op = "upsert";
      valores = v;
      return builder;
    };
    builder.update = (v: Record<string, unknown>) => {
      op = "update";
      valores = v;
      return builder;
    };
    builder.delete = () => {
      op = "delete";
      return builder;
    };
    builder.eq = (c: string, v: unknown) => {
      filtros[c] = v;
      return builder;
    };
    builder.is = (c: string, v: unknown) => {
      filtros[`is:${c}`] = v;
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    builder.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      (async () => {
        if (tabla === "subscriptions" && op === "upsert") {
          // El efecto del evento. Tarda, para que las entregas se intercalen.
          await new Promise((r) => setTimeout(r, opts.demoraAplicarMs ?? 5));
          if (opts.fallaAplicar?.()) return { error: { message: "pooler down" } };
          efectos.push(String(valores.clinic_id));
          return { error: null };
        }
        if (tabla === "stripe_events" && op === "update") {
          const f = filas.get(String(filtros.id));
          if (f) f.processed = valores.processed_at != null;
          return { error: null };
        }
        if (tabla === "stripe_events" && op === "delete") {
          const f = filas.get(String(filtros.id));
          // Igual que `.is("processed_at", null)`: nunca borra lo ya procesado.
          if (f && !f.processed) filas.delete(String(filtros.id));
          return { error: null };
        }
        return { data: null, error: null };
      })().then(ok, ko);
    return builder;
  };

  return { admin: { from, rpc } as unknown as AdminClient, filas, reloj, efectos, reclamos };
}

const sub = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  metadata: { clinic_id: "clinic-1" },
  trial_end: null,
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_1" } }] },
} as unknown as Stripe.Subscription;

const evento = (id = "evt_1") =>
  ({
    id,
    object: "event",
    type: "customer.subscription.updated",
    livemode: true,
    created: 1,
    api_version: "2026-07-29.dahlia",
    pending_webhooks: 1,
    request: null,
    data: { object: sub },
  }) as unknown as Stripe.Event;

function deps(ev: Stripe.Event, admin: AdminClient): StripeWebhookDeps {
  return {
    stripe: {
      webhooks: { constructEvent: () => ev },
      subscriptions: {
        retrieve: vi.fn(async () => sub),
        list: vi.fn(async () => ({ data: [sub] })),
      },
      charges: { retrieve: vi.fn(async () => ({ customer: "cus_1" })) },
    } as unknown as StripeWebhookDeps["stripe"],
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
  } as unknown as StripeWebhookDeps;
}

const entrada = { rawBody: "{}", signature: "t=1,v1=x" };
const entregar = (ev: Stripe.Event, admin: AdminClient) =>
  procesarWebhookStripe(entrada, deps(ev, admin));

async function conteo(respuestas: Response[]) {
  const cuerpos = await Promise.all(respuestas.map((r) => r.text()));
  const por = (t: string) => cuerpos.filter((c) => c === t).length;
  return {
    ok: por("ok"),
    dup: por("ok (dup)"),
    enCurso: por("in progress"),
    error: por("processing error"),
    estados: respuestas.map((r) => r.status),
  };
}

describe("webhook de Stripe: reclamo atómico del evento", () => {
  it("20 entregas simultáneas del mismo evento: los efectos se aplican UNA vez", async () => {
    const { admin, efectos, reclamos } = baseFalsa({ demoraAplicarMs: 10 });
    const ev = evento();

    const respuestas = await Promise.all(Array.from({ length: 20 }, () => entregar(ev, admin)));
    const c = await conteo(respuestas);

    expect(efectos).toEqual(["clinic-1"]); // antes del reclamo, hasta 20
    expect(reclamos.filter((r) => r === "claimed")).toHaveLength(1);
    expect(c.ok).toBe(1);
    expect(c.error).toBe(0);
    // Las otras 19 o ven el evento en curso (409: Stripe reintenta) o ya terminado (200).
    expect(c.dup + c.enCurso).toBe(19);
    expect(c.estados.every((s) => s === 200 || s === 409)).toBe(true);
  });

  it("tras terminar, el reintento de Stripe de las que quedaron en 409 responde 200 sin reaplicar", async () => {
    const { admin, efectos } = baseFalsa({ demoraAplicarMs: 10 });
    const ev = evento();
    await Promise.all(Array.from({ length: 5 }, () => entregar(ev, admin)));

    const reintento = await entregar(ev, admin);

    expect(reintento.status).toBe(200);
    expect(await reintento.text()).toBe("ok (dup)");
    expect(efectos).toHaveLength(1);
  });

  it("eventos distintos a la vez no se bloquean entre sí", async () => {
    const { admin, efectos } = baseFalsa();

    const respuestas = await Promise.all(
      ["evt_a", "evt_b", "evt_c"].map((id) => entregar(evento(id), admin)),
    );

    expect((await conteo(respuestas)).ok).toBe(3);
    expect(efectos).toHaveLength(3);
  });

  it("si la entrega ganadora falla, libera el reclamo: el reintento aplica el evento y queda marcado", async () => {
    let falla = true;
    const { admin, efectos, filas } = baseFalsa({ fallaAplicar: () => falla });
    const ev = evento();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const primera = await entregar(ev, admin);
    expect(primera.status).toBe(500);
    expect(filas.has("evt_1")).toBe(false); // reclamo liberado, sin marca

    falla = false;
    const reintento = await entregar(ev, admin);
    expect(reintento.status).toBe(200);
    expect(efectos).toEqual(["clinic-1"]);
    expect(filas.get("evt_1")?.processed).toBe(true);
  });

  it("si la función se corta con el evento reclamado y sin marcar: 409 mientras dura el plazo y se retoma al vencer", async () => {
    const { admin, filas, reloj, efectos } = baseFalsa();
    // Un reclamo huérfano: la entrega anterior murió antes de marcar ni liberar.
    filas.set("evt_1", { claimedAt: reloj.ahora, processed: false });
    const ev = evento();

    const dentroDelPlazo = await entregar(ev, admin);
    expect(dentroDelPlazo.status).toBe(409);
    expect(efectos).toHaveLength(0);

    reloj.ahora += (LEASE_RECLAMO_EVENTO_SEGUNDOS + 1) * 1000;
    const vencido = await entregar(ev, admin);
    expect(vencido.status).toBe(200);
    expect(await vencido.text()).toBe("ok");
    expect(efectos).toHaveLength(1);
    expect(filas.get("evt_1")?.processed).toBe(true);
  });

  it("con el plazo vencido, dos entregas simultáneas siguen sin duplicar (solo una retoma)", async () => {
    const { admin, filas, reloj, efectos } = baseFalsa({ demoraAplicarMs: 10 });
    filas.set("evt_1", { claimedAt: reloj.ahora, processed: false });
    reloj.ahora += (LEASE_RECLAMO_EVENTO_SEGUNDOS + 1) * 1000;
    const ev = evento();

    const respuestas = await Promise.all(Array.from({ length: 10 }, () => entregar(ev, admin)));

    expect(efectos).toHaveLength(1);
    expect((await conteo(respuestas)).ok).toBe(1);
  });

  it("una entrega que falla no borra un evento que otra ya procesó", async () => {
    // El borrado del reclamo solo alcanza filas sin marcar (`processed_at is null`).
    const { admin, filas } = baseFalsa({ fallaAplicar: () => true });
    filas.set("evt_1", { claimedAt: 0, processed: true });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await entregar(evento(), admin);

    expect(await res.text()).toBe("ok (dup)");
    expect(filas.get("evt_1")?.processed).toBe(true);
  });
});
