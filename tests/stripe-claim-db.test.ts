import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import type { Database } from "@/integrations/supabase/types";
import { procesarWebhookStripe, type StripeWebhookDeps } from "@/lib/stripe-webhook.server";

import { conectar } from "./helpers/db";

/**
 * `claim_stripe_event` (migración 20261117100000) contra Postgres de verdad, con
 * conexiones distintas corriendo a la vez: es lo único que prueba que el
 * `INSERT … ON CONFLICT` es atómico (el test con base falsa solo prueba que el
 * handler usa bien el resultado).
 */

const CLAIM = "select public.claim_stripe_event($1, $2, $3::jsonb, $4) as r";

let admin: Client;
const ids: string[] = [];
const nuevoId = () => {
  const id = `evt_test_${randomUUID()}`;
  ids.push(id);
  return id;
};

async function reclamar(c: Client, id: string, lease = 300) {
  const { rows } = await c.query(CLAIM, [id, "customer.subscription.updated", "{}", lease]);
  return rows[0].r as string;
}

// A nivel de archivo: las dos suites comparten la conexión y la limpieza.
beforeAll(async () => {
  admin = await conectar();
});

afterAll(async () => {
  await admin.query("delete from public.stripe_events where id = any($1)", [ids]);
  await admin.end();
});

describe("claim_stripe_event (Postgres real)", () => {
  it("de 20 conexiones simultáneas por el mismo evento, exactamente una lo reclama", async () => {
    const id = nuevoId();
    const conexiones = await Promise.all(Array.from({ length: 20 }, () => conectar()));
    try {
      const r = await Promise.all(conexiones.map((c) => reclamar(c, id)));
      expect(r.filter((x) => x === "claimed")).toHaveLength(1);
      // Las otras 19 lo ven en curso: todavía no se marcó como procesado.
      expect(r.filter((x) => x === "in_progress")).toHaveLength(19);
    } finally {
      await Promise.all(conexiones.map((c) => c.end()));
    }
  });

  it("una vez marcado como procesado, el resto de las entregas ve 'duplicate'", async () => {
    const id = nuevoId();
    expect(await reclamar(admin, id)).toBe("claimed");
    await admin.query(
      "update public.stripe_events set processed_at = now(), clinic_id = null where id = $1",
      [id],
    );
    expect(await reclamar(admin, id)).toBe("duplicate");
    expect(await reclamar(admin, id, 0)).toBe("duplicate"); // ni con plazo 0 se retoma lo procesado
  });

  it("un reclamo sin marcar se retoma al vencer el plazo, y solo por una entrega", async () => {
    const id = nuevoId();
    expect(await reclamar(admin, id)).toBe("claimed");
    expect(await reclamar(admin, id, 300)).toBe("in_progress");

    // La entrega original murió hace 10 minutos.
    await admin.query(
      "update public.stripe_events set claimed_at = now() - interval '10 minutes' where id = $1",
      [id],
    );
    const conexiones = await Promise.all(Array.from({ length: 10 }, () => conectar()));
    try {
      const r = await Promise.all(conexiones.map((c) => reclamar(c, id, 300)));
      expect(r.filter((x) => x === "claimed")).toHaveLength(1);
      expect(r.filter((x) => x === "in_progress")).toHaveLength(9);
    } finally {
      await Promise.all(conexiones.map((c) => c.end()));
    }
  });

  it("liberar el reclamo (borrar la fila sin marcar) deja que el reintento lo reclame al instante", async () => {
    const id = nuevoId();
    expect(await reclamar(admin, id)).toBe("claimed");
    await admin.query("delete from public.stripe_events where id = $1 and processed_at is null", [
      id,
    ]);
    expect(await reclamar(admin, id)).toBe("claimed");
  });

  it("liberar nunca borra un evento ya procesado", async () => {
    const id = nuevoId();
    await reclamar(admin, id);
    await admin.query("update public.stripe_events set processed_at = now() where id = $1", [id]);
    const { rowCount } = await admin.query(
      "delete from public.stripe_events where id = $1 and processed_at is null",
      [id],
    );
    expect(rowCount).toBe(0);
  });

  it("las filas que ya existían al migrar quedan como procesadas (no se reaplican)", async () => {
    const id = nuevoId();
    // Una fila "histórica": insertada por el código anterior, después de aplicar.
    await admin.query(
      "insert into public.stripe_events (id, type, received_at, processed_at) values ($1, 'x', now() - interval '1 day', now() - interval '1 day')",
      [id],
    );
    expect(await reclamar(admin, id)).toBe("duplicate");
  });

  it("no la ejecutan ni anon ni authenticated: solo el webhook (service_role)", async () => {
    const { rows } = await admin.query(
      `select has_function_privilege('anon', 'public.claim_stripe_event(text,text,jsonb,integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.claim_stripe_event(text,text,jsonb,integer)', 'execute') as auth,
              has_function_privilege('service_role', 'public.claim_stripe_event(text,text,jsonb,integer)', 'execute') as svc`,
    );
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true });
  });
});

describe("procesarWebhookStripe contra PostgREST real", () => {
  it("10 entregas simultáneas del mismo evento: una responde 'ok', el resto 'ok (dup)' o 409, y queda marcado", async () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (ver docs/TESTS.md)");
    const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
    const id = nuevoId();
    // Un tipo de evento que el handler no procesa: ejercita el reclamo y la marca sin efectos de negocio.
    const ev = {
      id,
      object: "event",
      type: "ping.sin_efectos",
      livemode: true,
      data: { object: {} },
    } as unknown as Stripe.Event;
    const deps = {
      stripe: { webhooks: { constructEvent: () => ev } },
      admin: supabase,
      webhookSecret: "whsec_x",
      secretKey: "sk_live_x",
      reportarError: async () => {},
      avisos: {},
      medicion: {},
    } as unknown as StripeWebhookDeps;
    const entrada = { rawBody: "{}", signature: "t=1,v1=x" };

    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () => procesarWebhookStripe(entrada, deps)),
    );
    const cuerpos = await Promise.all(respuestas.map((r) => r.text()));

    expect(cuerpos.filter((c) => c === "ok")).toHaveLength(1);
    expect(cuerpos.every((c) => ["ok", "ok (dup)", "in progress"].includes(c))).toBe(true);
    const { rows } = await admin.query(
      "select processed_at is not null as procesado, claimed_at is not null as reclamado from public.stripe_events where id = $1",
      [id],
    );
    expect(rows).toEqual([{ procesado: true, reclamado: true }]);

    // El reintento de Stripe tras el 409 (o tras terminar) ya ve 'duplicate'.
    const reintento = await procesarWebhookStripe(entrada, deps);
    expect(await reintento.text()).toBe("ok (dup)");
  });
});
