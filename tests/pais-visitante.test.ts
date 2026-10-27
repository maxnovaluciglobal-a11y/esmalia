// Lógica pura: no toca la base.
import { describe, expect, it } from "vitest";

import {
  PAIS_POR_DEFECTO,
  monedaPorPais,
  paisPorZonaHoraria,
} from "@/lib/marketing/pais-visitante";
import { MONEDAS_PRECIO, precioEnMoneda } from "@/lib/pricing-display";

describe("paisPorZonaHoraria", () => {
  it.each([
    ["America/Lima", "PE"],
    ["America/Santiago", "CL"],
    ["America/Punta_Arenas", "CL"],
    ["America/Bogota", "CO"],
    ["America/Mexico_City", "MX"],
    ["America/Cancun", "MX"],
    ["America/Tijuana", "MX"],
    ["America/Buenos_Aires", "AR"],
    ["America/Argentina/Buenos_Aires", "AR"],
    ["America/Argentina/Cordoba", "AR"],
    ["America/Cordoba", "AR"],
  ])("%s → %s", (zona, pais) => {
    expect(paisPorZonaHoraria(zona)).toBe(pais);
  });

  it("cae a Chile si la zona no es de un mercado objetivo o falta", () => {
    expect(paisPorZonaHoraria("Europe/Madrid")).toBe(PAIS_POR_DEFECTO);
    expect(paisPorZonaHoraria("America/New_York")).toBe("CL");
    expect(paisPorZonaHoraria("")).toBe("CL");
    expect(paisPorZonaHoraria(undefined)).toBe("CL");
  });
});

describe("monedaPorPais", () => {
  it("mapea cada país a una moneda que el selector de precios ofrece", () => {
    for (const pais of ["CL", "PE", "MX", "CO", "AR"] as const) {
      expect(MONEDAS_PRECIO).toContain(monedaPorPais(pais));
    }
    expect(monedaPorPais("CO")).toBe("COP");
    expect(monedaPorPais("AR")).toBe("USD");
  });

  it("COP se muestra como referencia redondeada", () => {
    expect(precioEnMoneda(19.99, "COP")).toBe("$61.600");
  });
});
