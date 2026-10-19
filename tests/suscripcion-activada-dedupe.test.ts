import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  clinicaEsInterna,
  registrarSuscripcionActivadaUnaVez,
} from "@/lib/marketing/suscripcion-activada.server";

/**
 * `suscripcion_activada` una sola vez por suscripción entre el webhook de
 * Stripe y la vuelta del checkout (TODO de #68). Puro: Supabase falso.
 */

type Resultado = { data?: unknown; error: { message: string; code?: string } | null };
type Llamada = { tabla: string; op: string; args: unknown[] };

/**
 * Cliente falso. `respuestas[tabla.op]` puede ser una lista: cada operación
 * de ese tipo consume la siguiente (la última se repite).
 */
function adminFalso(respuestas: Record<string, Resultado | Resultado[]> = {}) {
  const llamadas: Llamada[] = [];
  const usadas: Record<string, number> = {};
  const from = (tabla: string) => {
    let op = "select";
    let resuelto: Resultado | null = null;
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
    builder.update = registrar("update", true);
    for (const f of ["eq", "is", "or", "in"]) builder[f] = registrar(f);
    const resolver = () => {
      if (resuelto) return resuelto;
      const clave = `${tabla}.${op}`;
      const r = respuestas[clave];
      if (Array.isArray(r)) {
        const i = usadas[clave] ?? 0;
        usadas[clave] = i + 1;
        resuelto = r[Math.min(i, r.length - 1)];
      } else {
        resuelto = r ?? { data: null, error: null };
      }
      return resuelto;
    };
    builder.maybeSingle = () => Promise.resolve(resolver());
    builder.then = (ok: (v: Resultado) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(resolver()).then(ok, ko);
    return builder;
  };
  return { admin: { from } as unknown as SupabaseClient<Database>, llamadas };
}

const base = {
  clinicId: "clinic-1",
  subscriptionId: "sub_123",
  estado: "active",
  interno: false,
};
const inserts = (ll: Llamada[]) =>
  ll.filter((l) => l.tabla === "marketing_events" && l.op === "insert").map((l) => l.args[0]);
const columnaFaltante = { error: { code: "PGRST204", message: "Could not find the column" } };

describe("registrarSuscripcionActivadaUnaVez", () => {
  it("el primero que reclama escribe el evento y anota su id", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.update": [{ data: [{ clinic_id: "clinic-1" }], error: null }],
      "marketing_events.insert": { data: { id: 42 }, error: null },
    });

    const r = await registrarSuscripcionActivadaUnaVez({ ...base, admin, fuente: "webhook" });

    expect(r).toBe("registrado");
    expect(inserts(llamadas)).toEqual([
      {
        name: "suscripcion_activada",
        props: { estado: "active", fuente: "webhook" },
        session_hash: null,
      },
    ]);
    // Reclamo condicional y después el id del evento.
    expect(llamadas).toContainEqual({
      tabla: "subscriptions",
      op: "or",
      args: ["activation_tracked_sub_id.is.null,activation_tracked_sub_id.neq.sub_123"],
    });
    expect(llamadas).toContainEqual({
      tabla: "subscriptions",
      op: "update",
      args: [{ activation_event_id: 42 }],
    });
  });

  it("sin ids en las propiedades del evento; `interno` solo cuando lo es", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.update": [{ data: [{ clinic_id: "clinic-1" }], error: null }],
      "marketing_events.insert": { data: { id: 1 }, error: null },
    });

    await registrarSuscripcionActivadaUnaVez({ ...base, admin, fuente: "webhook", interno: true });

    const props = (inserts(llamadas)[0] as { props: Record<string, unknown> }).props;
    expect(props).toEqual({ estado: "active", fuente: "webhook", interno: true });
    expect(JSON.stringify(props)).not.toMatch(/clinic|sub_/);
  });

  it("si ya estaba reclamada, no escribe otro evento", async () => {
    const { admin, llamadas } = adminFalso({ "subscriptions.update": { data: [], error: null } });

    const r = await registrarSuscripcionActivadaUnaVez({ ...base, admin, fuente: "webhook" });

    expect(r).toBe("duplicado");
    expect(inserts(llamadas)).toEqual([]);
  });

  it("la vuelta del checkout después del webhook le suma la atribución al evento existente", async () => {
    const { admin, llamadas } = adminFalso({
      "subscriptions.update": { data: [], error: null },
      "subscriptions.select": {
        data: { activation_event_id: 42, activation_tracked_sub_id: "sub_123" },
        error: null,
      },
      "marketing_events.update": { data: [{ id: 42 }], error: null },
    });

    const r = await registrarSuscripcionActivadaUnaVez({
      ...base,
      admin,
      fuente: "retorno_checkout",
      sessionHash: "a".repeat(32),
    });

    expect(r).toBe("atribuido");
    expect(inserts(llamadas)).toEqual([]);
    expect(llamadas).toContainEqual({
      tabla: "marketing_events",
      op: "update",
      args: [{ session_hash: "a".repeat(32) }],
    });
    // Nunca pisa una atribución que ya estaba.
    expect(llamadas).toContainEqual({
      tabla: "marketing_events",
      op: "is",
      args: ["session_hash", null],
    });
  });

  it("migración sin aplicar: el webhook no emite y la vuelta del checkout emite como antes", async () => {
    const web = adminFalso({ "subscriptions.update": columnaFaltante });
    expect(
      await registrarSuscripcionActivadaUnaVez({ ...base, admin: web.admin, fuente: "webhook" }),
    ).toBe("omitido");
    expect(inserts(web.llamadas)).toEqual([]);

    const vuelta = adminFalso({
      "subscriptions.update": columnaFaltante,
      "marketing_events.insert": { data: { id: 7 }, error: null },
    });
    expect(
      await registrarSuscripcionActivadaUnaVez({
        ...base,
        admin: vuelta.admin,
        fuente: "retorno_checkout",
        sessionHash: "b".repeat(32),
      }),
    ).toBe("sin_dedupe");
    expect(inserts(vuelta.llamadas)).toHaveLength(1);
  });

  it("si el evento no se puede escribir, libera el reclamo para que otro lo cuente", async () => {
    vi.spyOn(console, "warn").mockImplementationOnce(() => {});
    const { admin, llamadas } = adminFalso({
      "subscriptions.update": [
        { data: [{ clinic_id: "clinic-1" }], error: null },
        { data: null, error: null },
      ],
      "marketing_events.insert": { error: { message: "check violation" } },
    });

    const r = await registrarSuscripcionActivadaUnaVez({ ...base, admin, fuente: "webhook" });

    expect(r).toBe("error");
    expect(llamadas).toContainEqual({
      tabla: "subscriptions",
      op: "update",
      args: [{ activation_tracked_sub_id: null }],
    });
  });

  it("un id de suscripción raro no llega al filtro", async () => {
    const { admin, llamadas } = adminFalso();
    const r = await registrarSuscripcionActivadaUnaVez({
      ...base,
      subscriptionId: "sub_1,activation_tracked_sub_id.is.null",
      admin,
      fuente: "webhook",
    });
    expect(r).toBe("error");
    expect(llamadas).toEqual([]);
  });
});

describe("helpers", () => {
  it("clinicaEsInterna: demo o dueño del equipo", async () => {
    const demo = adminFalso({ "clinics.select": { data: { is_demo: true }, error: null } });
    expect(await clinicaEsInterna(demo.admin, "c", async () => false)).toBe(true);

    const staff = adminFalso({
      "clinics.select": { data: { is_demo: false }, error: null },
      "clinic_members.select": { data: [{ user_id: "u1" }], error: null },
    });
    expect(await clinicaEsInterna(staff.admin, "c", async (id) => id === "u1")).toBe(true);
    expect(await clinicaEsInterna(staff.admin, "c", async () => false)).toBe(false);
  });
});
