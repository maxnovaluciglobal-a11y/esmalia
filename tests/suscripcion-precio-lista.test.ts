import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  etiquetaUsd,
  PRECIO_CLINICA_CENTS,
  PRECIO_FUNDADOR_CLINICA_CENTS,
  PRECIO_FUNDADOR_SOLO_CENTS,
  PRECIO_SOLO_CENTS,
} from "../src/lib/marketing/precio-lista";

// El precio de lista es US$19,99 (Solo) y US$49,99 (Clínica) (decisión de
// Walter, 27-oct-2026; antes US$29 y US$69). La pantalla Suscripción no puede
// mostrar un "precio regular" tachado ni rotular el precio como "de fundador":
// el fundador es un 50 % de descuento por 12 meses sobre este precio, no otro
// precio.
const fuente = readFileSync(
  path.resolve(__dirname, "../src/routes/_authenticated/_clinic/suscripcion.tsx"),
  "utf8",
);

describe("pantalla Suscripción: precio de lista", () => {
  it("toma el precio de la fuente única (US$19,99 y US$49,99)", () => {
    expect(PRECIO_SOLO_CENTS).toBe(1999);
    expect(PRECIO_CLINICA_CENTS).toBe(4999);
    expect(fuente).toContain("priceCents: PRECIO_SOLO_CENTS");
    expect(fuente).toContain("priceCents: PRECIO_CLINICA_CENTS");
    expect(fuente).not.toMatch(/2900|6900|4900|9900/);
  });

  it("el fundador es la mitad (redondeada hacia abajo) de la lista", () => {
    expect(PRECIO_FUNDADOR_SOLO_CENTS).toBe(Math.floor(PRECIO_SOLO_CENTS / 2));
    expect(PRECIO_FUNDADOR_CLINICA_CENTS).toBe(Math.floor(PRECIO_CLINICA_CENTS / 2));
  });

  it("etiquetaUsd usa coma decimal y omite los centavos en montos redondos", () => {
    expect(etiquetaUsd(1999)).toBe("US$19,99");
    expect(etiquetaUsd(999)).toBe("US$9,99");
    expect(etiquetaUsd(2000)).toBe("US$20");
    expect(etiquetaUsd(1905)).toBe("US$19,05");
  });

  it("no tacha ningún precio ni habla de precio de fundador", () => {
    expect(fuente).not.toContain("line-through");
    expect(fuente).not.toMatch(/regularCents|promoCents/);
    expect(fuente).not.toMatch(/fundador/i);
  });
});
