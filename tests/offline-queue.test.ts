import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `offline-queue.ts` usa idb-keyval (IndexedDB real en el browser). Acá no
 * hay browser, así que se reemplaza por un mapa en memoria con la misma
 * forma de API (get/set/del/createStore) — el módulo bajo test no sabe la
 * diferencia.
 */
vi.mock("idb-keyval", () => {
  const memoria = new Map<string, unknown>();
  return {
    createStore: () => "store-fake",
    get: vi.fn(async (key: string) => memoria.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      memoria.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      memoria.delete(key);
    }),
    // Expuesto solo para que los tests puedan inspeccionar/limpiar entre casos.
    __memoria: memoria,
  };
});

import {
  agregarACola,
  conflictos,
  descartarConflicto,
  descartarFallido,
  descartarTodoDe,
  encolar,
  fallidos,
  leerCola,
  marcarConflicto,
  marcarFallido,
  pendientes,
  quitarDeCola,
  registrarConflicto,
  suscribirCola,
  contarIntento,
  mismoPayload,
  type ItemCola,
} from "@/lib/offline/offline-queue";

async function limpiarCola() {
  const { __memoria } = (await import("idb-keyval")) as unknown as {
    __memoria: Map<string, unknown>;
  };
  __memoria.clear();
}

function itemBase(overrides: Partial<Omit<ItemCola, "intentos" | "estado">> = {}) {
  return {
    localId: overrides.localId ?? crypto.randomUUID(),
    userId: "user-1",
    kind: "crear-cita" as const,
    payload: { foo: "bar" },
    capturedAt: new Date().toISOString(),
    resumen: "Cita nueva",
    ...overrides,
  };
}

describe("offline-queue", () => {
  beforeEach(async () => {
    await limpiarCola();
  });

  it("empieza vacía", async () => {
    expect(await leerCola()).toEqual([]);
  });

  it("encolar agrega un ítem pendiente con intentos en 0", async () => {
    await encolar(itemBase({ localId: "a" }));
    const cola = await leerCola();
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({ localId: "a", estado: "pendiente", intentos: 0 });
  });

  it("encolar acumula ítems distintos", async () => {
    await encolar(itemBase({ localId: "a" }));
    await encolar(itemBase({ localId: "b", kind: "registrar-pago" }));
    const cola = await leerCola();
    expect(cola.map((i) => i.localId).sort()).toEqual(["a", "b"]);
  });

  it("vaciar la cola (quitarDeCola del último ítem) borra la entrada de idb-keyval, no deja un array vacío colgado", async () => {
    await encolar(itemBase({ localId: "a" }));
    await quitarDeCola("a");
    expect(await leerCola()).toEqual([]);
    const { __memoria } = (await import("idb-keyval")) as unknown as {
      __memoria: Map<string, unknown>;
    };
    expect(__memoria.has("items")).toBe(false);
  });

  it("quitarDeCola solo saca el ítem indicado, deja el resto", async () => {
    await encolar(itemBase({ localId: "a" }));
    await encolar(itemBase({ localId: "b" }));
    await quitarDeCola("a");
    const cola = await leerCola();
    expect(cola.map((i) => i.localId)).toEqual(["b"]);
  });

  describe("ítems con `identidad` (edición puntual de la misma entidad)", () => {
    it("una segunda captura pendiente con la misma identidad REEMPLAZA a la anterior, no acumula", async () => {
      await encolar(
        itemBase({ localId: "a", kind: "guardar-nota", identidad: "nota-1", payload: { v: 1 } }),
      );
      await encolar(
        itemBase({ localId: "b", kind: "guardar-nota", identidad: "nota-1", payload: { v: 2 } }),
      );
      const cola = await leerCola();
      expect(cola).toHaveLength(1);
      // El spread de `item` va después del ítem viejo: la captura nueva gana
      // también en localId, no solo en payload.
      expect(cola[0]).toMatchObject({ localId: "b", payload: { v: 2 } });
    });

    it("no reemplaza entre usuarios distintos (misma identidad, otro userId)", async () => {
      await encolar(
        itemBase({ localId: "a", userId: "user-1", kind: "guardar-nota", identidad: "nota-1" }),
      );
      await encolar(
        itemBase({ localId: "b", userId: "user-2", kind: "guardar-nota", identidad: "nota-1" }),
      );
      const cola = await leerCola();
      expect(cola).toHaveLength(2);
    });

    it("no reemplaza si la pendiente previa ya está en conflicto (no en 'pendiente')", async () => {
      await encolar(itemBase({ localId: "a", kind: "guardar-nota", identidad: "nota-1" }));
      await registrarConflicto({
        ...itemBase({ localId: "z", kind: "guardar-nota", identidad: "nota-1" }),
        detalleConflicto: { versionId: "v9" },
      });
      // La "a" pendiente sigue sola en su identidad para 'a'; encolar otra con
      // la misma identidad solo debe pisar la pendiente, no la de conflicto.
      await encolar(itemBase({ localId: "c", kind: "guardar-nota", identidad: "nota-1" }));
      const cola = await leerCola();
      const conflictosCola = cola.filter((i) => i.estado === "conflicto");
      const pendientesCola = cola.filter((i) => i.estado === "pendiente");
      expect(conflictosCola).toHaveLength(1);
      expect(pendientesCola).toHaveLength(1);
    });

    it("crear-cita y registrar-pago (sin identidad) siempre acumulan, nunca reemplazan", async () => {
      await encolar(itemBase({ localId: "a", kind: "crear-cita" }));
      await encolar(itemBase({ localId: "b", kind: "crear-cita" }));
      expect(await leerCola()).toHaveLength(2);
    });
  });

  describe("escrituras concurrentes (mutex de la cola)", () => {
    it("dos encolar() disparados casi al mismo tiempo no se pisan entre sí", async () => {
      await Promise.all([
        encolar(itemBase({ localId: "concurrente-1" })),
        encolar(itemBase({ localId: "concurrente-2" })),
      ]);
      const cola = await leerCola();
      expect(cola.map((i) => i.localId).sort()).toEqual(["concurrente-1", "concurrente-2"]);
    });

    it("un rechazo en una operación de la cola no traba el mutex para las siguientes", async () => {
      const { get } = (await import("idb-keyval")) as unknown as {
        get: ReturnType<typeof vi.fn>;
      };
      get.mockRejectedValueOnce(new Error("fallo simulado de idb"));
      // leerColaInterna atrapa el error y devuelve [] igual, así que encolar
      // no debería lanzar ni dejar el lock trabado.
      await encolar(itemBase({ localId: "despues-del-fallo" }));
      await encolar(itemBase({ localId: "siguiente" }));
      const cola = await leerCola();
      expect(cola.map((i) => i.localId)).toContain("siguiente");
    });
  });

  it("marcarFallido pasa el ítem a estado fallido, suma un intento y guarda el error", async () => {
    await encolar(itemBase({ localId: "a" }));
    await marcarFallido("a", "Regla de negocio rechazada");
    const [item] = await leerCola();
    expect(item).toMatchObject({
      estado: "fallido",
      error: "Regla de negocio rechazada",
      intentos: 1,
    });
  });

  it("marcarConflicto pasa el ítem a conflicto con el detalle del servidor", async () => {
    await encolar(itemBase({ localId: "a", kind: "guardar-nota" }));
    await marcarConflicto("a", { versionId: "v-42" });
    const [item] = await leerCola();
    expect(item).toMatchObject({ estado: "conflicto", detalleConflicto: { versionId: "v-42" } });
  });

  it("contarIntento suma un intento sin cambiar el estado", async () => {
    await encolar(itemBase({ localId: "a" }));
    await contarIntento("a");
    await contarIntento("a");
    const [item] = await leerCola();
    expect(item).toMatchObject({ estado: "pendiente", intentos: 2 });
  });

  it("descartarFallido y descartarConflicto quitan el ítem de la cola", async () => {
    await encolar(itemBase({ localId: "a" }));
    await marcarFallido("a", "x");
    await descartarFallido("a");
    expect(await leerCola()).toEqual([]);

    await encolar(itemBase({ localId: "b", kind: "marcar-odontograma" }));
    await marcarConflicto("b", { pieza: "11" });
    await descartarConflicto("b");
    expect(await leerCola()).toEqual([]);
  });

  it("descartarTodoDe solo borra los ítems del userId indicado", async () => {
    await encolar(itemBase({ localId: "a", userId: "user-1" }));
    await encolar(itemBase({ localId: "b", userId: "user-2" }));
    await descartarTodoDe("user-1");
    const cola = await leerCola();
    expect(cola.map((i) => i.localId)).toEqual(["b"]);
  });

  describe("filtros por estado", () => {
    it("pendientes/fallidos/conflictos separan correctamente", async () => {
      await encolar(itemBase({ localId: "p" }));
      await encolar(itemBase({ localId: "f" }));
      await marcarFallido("f", "err");
      await registrarConflicto({
        ...itemBase({ localId: "c" }),
        detalleConflicto: { x: 1 },
      });
      const cola = await leerCola();
      expect(pendientes(cola).map((i) => i.localId)).toEqual(["p"]);
      expect(fallidos(cola).map((i) => i.localId)).toEqual(["f"]);
      expect(conflictos(cola).map((i) => i.localId)).toEqual(["c"]);
    });
  });

  describe("suscribirCola", () => {
    it("notifica a los suscriptores en cada mutación y deja de notificar tras desuscribirse", async () => {
      const recibidos: ItemCola[][] = [];
      const desuscribir = suscribirCola((items) => recibidos.push(items));
      // La suscripción inicial dispara una notificación async con el estado actual.
      await vi.waitFor(() => expect(recibidos.length).toBeGreaterThanOrEqual(1));

      await encolar(itemBase({ localId: "a" }));
      await vi.waitFor(() => expect(recibidos.at(-1)).toHaveLength(1));

      desuscribir();
      const notificacionesPrevias = recibidos.length;
      await encolar(itemBase({ localId: "b" }));
      // Nada nuevo debería llegar tras desuscribirse.
      await new Promise((r) => setTimeout(r, 10));
      expect(recibidos.length).toBe(notificacionesPrevias);
    });
  });
  describe("reprogramar-cita: fusión y vuelta al original (arrastre sin conexión, PR 10)", () => {
    const original = {
      appointmentId: "c1",
      clinicId: "k",
      professionalId: "p1",
      startsAt: "2026-10-21T10:00",
    };
    const mov = (startsAt: string, professionalId = "p1", localId = crypto.randomUUID()) => ({
      localId,
      userId: "user-1",
      kind: "reprogramar-cita" as const,
      identidad: "c1",
      payload: { ...original, startsAt, professionalId },
      original: { ...original },
      capturedAt: new Date().toISOString(),
      resumen: "Cita movida",
    });

    it("dos movimientos de la misma cita se fusionan: queda el último destino y el original del primero", async () => {
      await encolar(mov("2026-10-21T11:00", "p1", "a"));
      // El segundo arrastre parte de la posición ya movida: su "original" sería 11:00.
      await encolar({
        ...mov("2026-10-21T12:00", "p2", "b"),
        original: { ...original, startsAt: "2026-10-21T11:00" },
      });

      const cola = await leerCola();
      expect(cola).toHaveLength(1);
      expect(cola[0].payload).toMatchObject({ startsAt: "2026-10-21T12:00", professionalId: "p2" });
      expect(cola[0].original).toEqual(original);
    });

    it("deshacer hasta la posición del servidor saca el movimiento de la cola", async () => {
      await encolar(mov("2026-10-21T11:00"));
      await encolar({
        ...mov("2026-10-21T10:00"),
        original: { ...original, startsAt: "2026-10-21T11:00" },
      });
      expect(await leerCola()).toEqual([]);
    });

    it("no fusiona con un movimiento ya fallido (ese queda para revisar)", async () => {
      await encolar(mov("2026-10-21T11:00", "p1", "a"));
      await marcarFallido("a", "Fuera del horario");
      await encolar(mov("2026-10-21T12:00", "p1", "b"));
      const cola = await leerCola();
      expect(cola.map((i) => [i.localId, i.estado])).toEqual([
        ["a", "fallido"],
        ["b", "pendiente"],
      ]);
    });

    it("agregarACola es pura: no muta la lista recibida", () => {
      const antes: ItemCola[] = [];
      const despues = agregarACola(antes, mov("2026-10-21T11:00"));
      expect(antes).toEqual([]);
      expect(despues).toHaveLength(1);
    });

    it("una captura nueva que no cambia nada no se encola", () => {
      expect(agregarACola([], mov("2026-10-21T10:00"))).toEqual([]);
    });

    it("mismoPayload ignora el orden de las claves", () => {
      expect(mismoPayload({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
      expect(mismoPayload({ a: 1 }, { a: 1, b: undefined })).toBe(true);
      expect(mismoPayload({ a: 1 }, { a: 2 })).toBe(false);
    });
  });
});
