import { describe, expect, it } from "vitest";

import {
  cajaDeLaPersona,
  esperadoConMovimientos,
  esperadoEnCaja,
  nombreDeCaja,
  puedeCerrarCaja,
  sumarMovimientos,
} from "../src/lib/finance/cash-registers";

/** Ola 10 · CAJ-02 a CAJ-04: lógica pura de la caja por operador. */

describe("caja de la persona", () => {
  const cajas = [
    { id: "g", operatorId: null, status: "open" as const },
    { id: "a", operatorId: "ana", status: "open" as const },
    { id: "b", operatorId: "beto", status: "open" as const },
  ];
  it("cada persona ve su caja; sin caja propia, la general", () => {
    expect(cajaDeLaPersona(cajas, "ana")?.id).toBe("a");
    expect(cajaDeLaPersona(cajas, "beto")?.id).toBe("b");
    expect(cajaDeLaPersona(cajas, "carla")?.id).toBe("g");
    expect(cajaDeLaPersona(cajas.slice(1), "carla")).toBeNull();
  });

  it("la caja de otra persona la cierra ella u owner/admin; la general, cualquiera", () => {
    expect(puedeCerrarCaja({ operatorId: "ana" }, "ana", false)).toBe(true);
    expect(puedeCerrarCaja({ operatorId: "ana" }, "beto", false)).toBe(false);
    expect(puedeCerrarCaja({ operatorId: "ana" }, "beto", true)).toBe(true);
    expect(puedeCerrarCaja({ operatorId: null }, "beto", false)).toBe(true);
  });

  it("nombre de la caja", () => {
    expect(nombreDeCaja({ operatorId: null, operatorName: null })).toBe("Caja general");
    expect(nombreDeCaja({ operatorId: "ana", operatorName: "Ana Pérez" }, "ana")).toBe("Mi caja");
    expect(nombreDeCaja({ operatorId: "ana", operatorName: "Ana Pérez" }, "beto")).toBe(
      "Caja de Ana",
    );
  });
});

describe("esperado con movimientos (CAJ-04)", () => {
  const movimientos = [
    { fromRegisterId: "a", toRegisterId: "b", amountCents: 10000 },
    { fromRegisterId: "a", toRegisterId: null, amountCents: 40000 },
    { fromRegisterId: "c", toRegisterId: "a", amountCents: 5000 },
  ];
  it("suma lo recibido y resta lo que salió", () => {
    expect(sumarMovimientos(movimientos, "a")).toEqual({
      entradasCents: 5000,
      salidasCents: 50000,
    });
    expect(sumarMovimientos(movimientos, "b")).toEqual({ entradasCents: 10000, salidasCents: 0 });
  });
  it("sin movimientos es igual al esperado de siempre (no rompe el arqueo actual)", () => {
    expect(esperadoConMovimientos(50000, 123000, { entradasCents: 0, salidasCents: 0 })).toBe(
      esperadoEnCaja(50000, 123000),
    );
  });
  it("apertura + efectivo + recibido − salidas", () => {
    expect(esperadoConMovimientos(50000, 100000, sumarMovimientos(movimientos, "a"))).toBe(
      50000 + 100000 + 5000 - 50000,
    );
  });
});
