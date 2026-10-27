import { describe, expect, it } from "vitest";

import { puedeRecargar } from "../src/lib/recarga-por-version";

describe("recarga por cambio de versión", () => {
  it("recarga la primera vez", () => {
    expect(puedeRecargar(null, 1_000_000)).toBe(true);
  });
  it("no recarga dos veces seguidas (evita el bucle)", () => {
    expect(puedeRecargar("1000000", 1_010_000)).toBe(false);
  });
  it("vuelve a permitirlo pasada la ventana de 30 s", () => {
    expect(puedeRecargar("1000000", 1_031_000)).toBe(true);
  });
  it("un sello inválido no bloquea", () => {
    expect(puedeRecargar("abc", 1_000_000)).toBe(true);
  });
});
