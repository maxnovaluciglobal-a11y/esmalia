import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { COLORES_SIMBOLOGIA } from "@/lib/clinical/odontograma-reglas";
import { AGENDA_BASE, horasLibres, libre } from "@/components/marketing/v2/reserva-datos";
import { SILLONES_HOY, resumenDelDia } from "@/components/marketing/v2/datos-ejemplo";

const CSS = readFileSync(
  path.resolve(__dirname, "../src/components/marketing/v2/landing-v2.css"),
  "utf8",
);

describe("landing A+ (/v2)", () => {
  it("usa la misma convención clínica que el odontograma (azul existente, rojo por realizar)", () => {
    expect(CSS).toContain(`--lv-clin-ex: ${COLORES_SIMBOLOGIA.azul}`);
    expect(CSS).toContain(`--lv-clin-pl: ${COLORES_SIMBOLOGIA.rojo}`);
  });

  it("lo continuo solo se mueve con data-mov=on (el HTML del servidor llega quieto)", () => {
    const infinitas = CSS.split("}").filter((b) => /animation:[^;]*infinite/.test(b));
    for (const b of infinitas) expect(b).toContain('[data-mov="on"]');
  });

  it("las cifras del hero salen de los mismos datos que se dibujan", () => {
    const r = resumenDelDia(SILLONES_HOY, "11:40");
    expect(r.citas).toBe(20);
    expect(r.huecos).toBe(2);
    expect(r.ausentes).toBe(1);
    expect(r.proxima?.[2]).toBe("K. Díaz");
  });

  it("la reserva solo ofrece horas libres de verdad", () => {
    const lunes = AGENDA_BASE[0];
    // 10:00 del Sillón 1 está ocupado por M. Soto y antes de las 12:00 ya pasó.
    expect(libre(lunes, 0, 0, 30, 10 * 60)).toBe(false);
    // El hueco de las 12:00 del Sillón 1 está libre.
    expect(libre(lunes, 0, 0, 30, 12 * 60)).toBe(true);
    // La colación (13:00-14:00) no se ofrece.
    expect(libre(lunes, 1, 2, 30, 13 * 60)).toBe(false);
    for (const [s, p] of horasLibres(AGENDA_BASE[1], 1, -1, 45)) {
      expect(libre(AGENDA_BASE[1], 1, p, 45, s)).toBe(true);
    }
  });
});
