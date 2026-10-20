import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `offline-sync.ts` importa las server functions reales (createAppointment,
 * registerPayment, etc.) para despachar la cola. Acá se mockean todas: lo
 * que se prueba es que sincronizarCola llama al despachador correcto por
 * `kind`, respeta el orden FIFO, corta ante fallo de red, distingue
 * fallo-de-negocio de fallo-de-red, y detecta conflicto. No se prueba la
 * lógica interna de esas server functions (esa es responsabilidad de otro
 * test / de RLS).
 */
vi.mock("@/lib/clinic-operations/appointments.functions", () => ({
  createAppointment: vi.fn(),
  moveAppointment: vi.fn(),
  setAppointmentStatus: vi.fn(),
}));
vi.mock("@/lib/finance/finance.functions", () => ({
  registerPayment: vi.fn(),
}));
vi.mock("@/lib/clinical/clinical-notes.functions", () => ({
  saveClinicalNote: vi.fn(),
  restoreNoteVersion: vi.fn(),
}));
vi.mock("@/lib/clinical/odontogram.functions", () => ({
  setOdontogramMark: vi.fn(),
}));

import {
  createAppointment,
  moveAppointment,
  setAppointmentStatus,
} from "@/lib/clinic-operations/appointments.functions";
import { registerPayment } from "@/lib/finance/finance.functions";
import { saveClinicalNote, restoreNoteVersion } from "@/lib/clinical/clinical-notes.functions";
import { setOdontogramMark } from "@/lib/clinical/odontogram.functions";
import { encolar, leerCola, type ItemCola } from "@/lib/offline/offline-queue";
import { describirItem, resolverConflicto, sincronizarCola } from "@/lib/offline/offline-sync";

// Mismo truco que en offline-queue.test.ts: reemplaza idb-keyval por un
// mapa en memoria para que offline-queue (usado internamente por
// offline-sync) funcione sin IndexedDB real.
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
    __memoria: memoria,
  };
});

function queryClientFake() {
  return { invalidateQueries: vi.fn() } as unknown as import("@tanstack/react-query").QueryClient;
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

describe("offline-sync", () => {
  beforeEach(async () => {
    const { __memoria } = (await import("idb-keyval")) as unknown as {
      __memoria: Map<string, unknown>;
    };
    __memoria.clear();
    vi.mocked(createAppointment).mockReset();
    vi.mocked(setAppointmentStatus).mockReset();
    vi.mocked(moveAppointment).mockReset();
    vi.mocked(registerPayment).mockReset();
    vi.mocked(saveClinicalNote).mockReset();
    vi.mocked(restoreNoteVersion).mockReset();
    vi.mocked(setOdontogramMark).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("despacha cada kind contra su server function real, con el payload capturado tal cual", async () => {
    vi.mocked(createAppointment).mockResolvedValue({ id: "cita-1" });
    await encolar(
      itemBase({ localId: "a", kind: "crear-cita", payload: { tratamiento: "Limpieza" } }),
    );

    const resultado = await sincronizarCola(queryClientFake(), "user-1");

    expect(createAppointment).toHaveBeenCalledWith({ data: { tratamiento: "Limpieza" } });
    expect(resultado).toEqual({ sincronizados: 1, conflictos: 0, corte: false, avisos: [] });
    expect(await leerCola()).toEqual([]);
  });

  it("procesa la cola en orden FIFO (orden de captura)", async () => {
    const orden: string[] = [];
    vi.mocked(createAppointment).mockImplementation(async (args: unknown) => {
      orden.push((args as { data: { marca: string } }).data.marca);
      return { id: "x" };
    });
    await encolar(itemBase({ localId: "1", kind: "crear-cita", payload: { marca: "primero" } }));
    await encolar(itemBase({ localId: "2", kind: "crear-cita", payload: { marca: "segundo" } }));
    await encolar(itemBase({ localId: "3", kind: "crear-cita", payload: { marca: "tercero" } }));

    await sincronizarCola(queryClientFake(), "user-1");

    expect(orden).toEqual(["primero", "segundo", "tercero"]);
  });

  it("un fallo de red corta el resto de la cola y no la vacía (el corte deja lo pendiente para el próximo intento)", async () => {
    vi.mocked(createAppointment)
      .mockResolvedValueOnce({ id: "ok-1" })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await encolar(itemBase({ localId: "1" }));
    await encolar(itemBase({ localId: "2" })); // este falla por red
    await encolar(itemBase({ localId: "3" })); // no debería ni intentarse

    const resultado = await sincronizarCola(queryClientFake(), "user-1");

    expect(resultado).toEqual({ sincronizados: 1, conflictos: 0, corte: true, avisos: [] });
    expect(createAppointment).toHaveBeenCalledTimes(2); // nunca llega al 3ro
    const cola = await leerCola();
    expect(cola.map((i) => i.localId)).toEqual(["2", "3"]);
    expect(cola[0].estado).toBe("pendiente"); // sigue pendiente, no "fallido"
  });

  it("un rechazo de negocio (no de red) se marca fallido y NO corta la cola", async () => {
    vi.mocked(createAppointment)
      .mockRejectedValueOnce(new Error("El horario ya está ocupado"))
      .mockResolvedValueOnce({ id: "ok-2" });
    await encolar(itemBase({ localId: "1" }));
    await encolar(itemBase({ localId: "2" }));

    const resultado = await sincronizarCola(queryClientFake(), "user-1");

    expect(resultado).toEqual({ sincronizados: 1, conflictos: 0, corte: false, avisos: [] });
    const cola = await leerCola();
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({
      localId: "1",
      estado: "fallido",
      error: "El horario ya está ocupado",
    });
  });

  it("reconoce distintas formas de error de red (TypeError y mensajes conocidos)", async () => {
    for (const error of [
      new TypeError("fetch failed"),
      new Error("NetworkError when attempting to fetch resource"),
      new Error("Load failed"),
      new Error("network request failed"),
    ]) {
      vi.mocked(createAppointment).mockReset();
      vi.mocked(createAppointment).mockRejectedValueOnce(error);
      await encolar(itemBase({ localId: `net-${error.message}` }));
      const resultado = await sincronizarCola(queryClientFake(), "user-1");
      expect(resultado.corte).toBe(true);
    }
  });

  it("guardar-nota con {conflict:true} se marca en conflicto, no se descarta ni se cuenta como sincronizado", async () => {
    vi.mocked(saveClinicalNote).mockResolvedValue({ conflict: true, versionId: "v-5" });
    await encolar(itemBase({ localId: "n1", kind: "guardar-nota", payload: { noteId: "nota-1" } }));

    const resultado = await sincronizarCola(queryClientFake(), "user-1");

    expect(resultado).toEqual({ sincronizados: 0, conflictos: 1, corte: false, avisos: [] });
    const cola = await leerCola();
    expect(cola[0]).toMatchObject({
      estado: "conflicto",
      detalleConflicto: { conflict: true, versionId: "v-5" },
    });
  });

  it("marcar-odontograma con {conflict:true} también cuenta como conflicto", async () => {
    vi.mocked(setOdontogramMark).mockResolvedValue({ conflict: true });
    await encolar(itemBase({ localId: "o1", kind: "marcar-odontograma" }));
    const resultado = await sincronizarCola(queryClientFake(), "user-1");
    expect(resultado.conflictos).toBe(1);
  });

  it("un resultado {conflict:true} en un kind que NO lo soporta (ej. crear-cita) no cuenta como conflicto", async () => {
    vi.mocked(createAppointment).mockResolvedValue({ conflict: true } as never);
    await encolar(itemBase({ localId: "a", kind: "crear-cita" }));
    const resultado = await sincronizarCola(queryClientFake(), "user-1");
    expect(resultado).toEqual({ sincronizados: 1, conflictos: 0, corte: false, avisos: [] });
  });

  it("solo procesa los ítems del userId indicado (turno compartido en la misma PC)", async () => {
    vi.mocked(createAppointment).mockResolvedValue({ id: "x" });
    await encolar(itemBase({ localId: "mio", userId: "user-1" }));
    await encolar(itemBase({ localId: "de-otro-turno", userId: "user-2" }));

    await sincronizarCola(queryClientFake(), "user-1");

    expect(createAppointment).toHaveBeenCalledTimes(1);
    const cola = await leerCola();
    expect(cola.map((i) => i.localId)).toEqual(["de-otro-turno"]);
  });

  it("invalida las query keys correspondientes a los kinds efectivamente sincronizados", async () => {
    vi.mocked(registerPayment).mockResolvedValue({ id: "pago-1" });
    await encolar(itemBase({ localId: "p1", kind: "registrar-pago" }));
    const qc = queryClientFake();

    await sincronizarCola(qc, "user-1");

    const claves = vi.mocked(qc.invalidateQueries).mock.calls.map((c) => c[0].queryKey[0]);
    expect(claves.sort()).toEqual(["finance-summary", "patient", "patients", "payments"].sort());
  });

  describe("resolverConflicto", () => {
    it("'usar-mio' sobre guardar-nota restaura la versión en conflicto y quita el ítem de la cola", async () => {
      vi.mocked(restoreNoteVersion).mockResolvedValue(undefined as never);
      const item = {
        ...itemBase({ kind: "guardar-nota" }),
        intentos: 1,
        estado: "conflicto" as const,
        detalleConflicto: { versionId: "v-9" },
      };
      await encolar(item);
      const qc = queryClientFake();

      await resolverConflicto(qc, item, "usar-mio");

      expect(restoreNoteVersion).toHaveBeenCalledWith({ data: { versionId: "v-9" } });
      expect(await leerCola()).toEqual([]);
    });

    it("'descartar' no llama a ninguna server function, solo quita el ítem", async () => {
      const item = {
        ...itemBase({ kind: "guardar-nota" }),
        intentos: 1,
        estado: "conflicto" as const,
        detalleConflicto: { versionId: "v-9" },
      };
      await encolar(item);

      await resolverConflicto(queryClientFake(), item, "descartar");

      expect(restoreNoteVersion).not.toHaveBeenCalled();
      expect(await leerCola()).toEqual([]);
    });

    it("'usar-mio' sobre marcar-odontograma reenvía la marca con force:true", async () => {
      vi.mocked(setOdontogramMark).mockResolvedValue(undefined as never);
      const item = {
        ...itemBase({ kind: "marcar-odontograma", payload: { pieza: "11", superficie: "O" } }),
        intentos: 1,
        estado: "conflicto" as const,
        detalleConflicto: {},
      };
      await encolar(item);

      await resolverConflicto(queryClientFake(), item, "usar-mio");

      expect(setOdontogramMark).toHaveBeenCalledWith({
        data: { pieza: "11", superficie: "O", force: true },
      });
    });
  });

  describe("reprogramar-cita (arrastre de la agenda, PR 10)", () => {
    const mover = (startsAt: string, localId = crypto.randomUUID()) =>
      itemBase({
        localId,
        kind: "reprogramar-cita",
        identidad: "cita-7",
        payload: {
          appointmentId: "cita-7",
          clinicId: "clinica-1",
          professionalId: "prof-1",
          startsAt,
        },
        original: {
          appointmentId: "cita-7",
          clinicId: "clinica-1",
          professionalId: "prof-1",
          startsAt: "2026-10-21T10:00",
        },
        resumen: "Martina Soto: cita movida",
      });

    it("dos movimientos sin conexión de la misma cita llegan como UNO solo, con el último destino", async () => {
      vi.mocked(moveAppointment).mockResolvedValue({ ok: true });
      await encolar(mover("2026-10-21T11:00", "primero"));
      await encolar(mover("2026-10-21T12:30", "segundo"));
      expect(await leerCola()).toHaveLength(1);

      const resultado = await sincronizarCola(queryClientFake(), "user-1");

      expect(moveAppointment).toHaveBeenCalledTimes(1);
      expect(moveAppointment).toHaveBeenCalledWith({
        data: {
          appointmentId: "cita-7",
          clinicId: "clinica-1",
          professionalId: "prof-1",
          startsAt: "2026-10-21T12:30",
        },
      });
      expect(resultado.sincronizados).toBe(1);
      expect(await leerCola()).toEqual([]);
    });

    it("si el horario ya no es válido al sincronizar, queda en 'fallido' con el motivo (y no corta la cola)", async () => {
      vi.mocked(moveAppointment).mockRejectedValueOnce(
        new Error("El profesional no atiende los domingos."),
      );
      vi.mocked(createAppointment).mockResolvedValueOnce({ id: "otra" });
      await encolar(mover("2026-10-25T10:00", "mov"));
      await encolar(itemBase({ localId: "nueva", kind: "crear-cita" }));

      const resultado = await sincronizarCola(queryClientFake(), "user-1");

      expect(resultado).toEqual({ sincronizados: 1, conflictos: 0, corte: false, avisos: [] });
      const cola = await leerCola();
      expect(cola).toHaveLength(1);
      expect(cola[0]).toMatchObject({
        localId: "mov",
        estado: "fallido",
        error: "El profesional no atiende los domingos.",
      });
    });

    it("un corte de red al reprogramar deja el movimiento pendiente", async () => {
      vi.mocked(moveAppointment).mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await encolar(mover("2026-10-21T11:00", "mov"));

      const resultado = await sincronizarCola(queryClientFake(), "user-1");

      expect(resultado.corte).toBe(true);
      expect((await leerCola())[0].estado).toBe("pendiente");
    });

    it("avisa el solapamiento que devuelve el servidor y refresca la agenda", async () => {
      vi.mocked(moveAppointment).mockResolvedValue({
        ok: true,
        solapamiento: { treatmentLabel: "Control", startsAt: "", endsAt: "" },
      });
      const qc = queryClientFake();
      await encolar(mover("2026-10-21T11:00"));

      const resultado = await sincronizarCola(qc, "user-1");

      expect(resultado.avisos).toEqual([
        'Martina Soto: cita movida: se solapa con "Control" del mismo profesional.',
      ]);
      expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["appointments"] });
    });
  });

  describe("describirItem", () => {
    it("da un texto legible por kind", () => {
      expect(describirItem(itemBase({ kind: "crear-cita" }) as ItemCola)).toBe("Cita nueva");
      expect(describirItem(itemBase({ kind: "registrar-pago" }) as ItemCola)).toBe(
        "Cobro registrado",
      );
      expect(describirItem(itemBase({ kind: "guardar-nota" }) as ItemCola)).toBe("Nota clínica");
      expect(describirItem(itemBase({ kind: "reprogramar-cita" }) as ItemCola)).toBe(
        "Cita reprogramada",
      );
    });
  });
});
