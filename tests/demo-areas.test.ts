import { describe, expect, it } from "vitest";

import { AREAS_DE_LA_DEMO } from "@/lib/demo/areas";

describe("áreas de la clínica demo", () => {
  it("cada área tiene clave única, tabla y un mínimo mayor que cero", () => {
    const claves = AREAS_DE_LA_DEMO.map((a) => a.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const a of AREAS_DE_LA_DEMO) {
      expect(a.tabla, a.clave).toMatch(/^[a-z_]+$/);
      expect(a.minimo, a.clave).toBeGreaterThan(0);
      expect(a.etiqueta.length, a.clave).toBeGreaterThan(3);
    }
  });

  it("cubre la caja de hoy, la agenda de hoy y la configuración básica", () => {
    const claves = AREAS_DE_LA_DEMO.map((a) => a.clave);
    for (const esperada of [
      "caja-cobros-de-hoy",
      "caja-abierta",
      "agenda-de-hoy",
      "horarios-de-sucursal",
      "cuentas-por-cobrar",
    ]) {
      expect(claves).toContain(esperada);
    }
  });

  it("las áreas del día usan el día de la clínica, no un filtro por texto", () => {
    const caja = AREAS_DE_LA_DEMO.find((a) => a.clave === "caja-cobros-de-hoy");
    expect(caja?.filtros?.some((f) => f.op === "hoy")).toBe(true);
  });
});
