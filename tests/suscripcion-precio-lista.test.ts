import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// El precio de lista es US$29 (Solo) y US$69 (Clínica) (decisión de Walter,
// 20-oct-2026). La pantalla Suscripción no puede mostrar un "precio regular"
// tachado ni rotular el precio como "de fundador": el fundador es un 50 % de
// descuento por 12 meses sobre este precio, no otro precio.
const fuente = readFileSync(
  path.resolve(__dirname, "../src/routes/_authenticated/_clinic/suscripcion.tsx"),
  "utf8",
);

describe("pantalla Suscripción: precio de lista", () => {
  it("muestra US$29 y US$69 y nada de US$49 ni US$99", () => {
    expect(fuente).toContain("priceCents: 2900");
    expect(fuente).toContain("priceCents: 6900");
    expect(fuente).not.toMatch(/4900|9900/);
  });

  it("no tacha ningún precio ni habla de precio de fundador", () => {
    expect(fuente).not.toContain("line-through");
    expect(fuente).not.toMatch(/regularCents|promoCents/);
    expect(fuente).not.toMatch(/fundador/i);
  });
});
