import { describe, expect, it } from "vitest";

import { esRutaDeCargaDiferida } from "@/lib/marketing/carga-diferida";

describe("esRutaDeCargaDiferida", () => {
  it("difiere Sentry y Supabase solo en la landing", () => {
    expect(esRutaDeCargaDiferida("/v2")).toBe(true);
    expect(esRutaDeCargaDiferida("/v2/")).toBe(true);
  });

  it("deja igual la app y el resto del sitio", () => {
    for (const ruta of ["/", "/auth", "/precios", "/hoy", "/v2x", "/portal/abc"]) {
      expect(esRutaDeCargaDiferida(ruta)).toBe(false);
    }
  });
});
