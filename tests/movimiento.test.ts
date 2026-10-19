import { describe, expect, it } from "vitest";

import {
  CLAVE_PAUSA_MOVIMIENTO,
  debeAnimar,
  guardarPausa,
  leerPausa,
} from "@/hooks/use-movimiento";

function almacenEnMemoria() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
}

const almacenQueFalla = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("movimiento (A+)", () => {
  it("solo se anima si el sistema no pide reducir y nadie pausó", () => {
    expect(debeAnimar({ reducido: false, pausado: false })).toBe(true);
    expect(debeAnimar({ reducido: true, pausado: false })).toBe(false);
    expect(debeAnimar({ reducido: false, pausado: true })).toBe(false);
    expect(debeAnimar({ reducido: true, pausado: true })).toBe(false);
  });

  it("la pausa se guarda y se lee", () => {
    const a = almacenEnMemoria();
    expect(leerPausa(a)).toBe(false);
    guardarPausa(a, true);
    expect(a.datos.get(CLAVE_PAUSA_MOVIMIENTO)).toBe("1");
    expect(leerPausa(a)).toBe(true);
    guardarPausa(a, false);
    expect(a.datos.has(CLAVE_PAUSA_MOVIMIENTO)).toBe(false);
    expect(leerPausa(a)).toBe(false);
  });

  it("si el almacenamiento falla no rompe nada", () => {
    expect(leerPausa(almacenQueFalla)).toBe(false);
    expect(() => guardarPausa(almacenQueFalla, true)).not.toThrow();
    expect(leerPausa(null)).toBe(false);
    expect(() => guardarPausa(undefined, true)).not.toThrow();
  });

  it("la clave sigue la convención esmalia:*", () => {
    expect(CLAVE_PAUSA_MOVIMIENTO).toMatch(/^esmalia:/);
  });
});
