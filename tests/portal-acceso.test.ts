import { describe, expect, it } from "vitest";

import { TTL_MAXIMO_PORTAL_DIAS, portalAccesoVigente } from "@/lib/patients/portal-acceso";

const ahora = new Date("2026-10-21T15:00:00Z");
const haceDias = (d: number) => new Date(ahora.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe("portalAccesoVigente", () => {
  it("sin envíos ni aperturas no hay acceso que revocar", () => {
    expect(portalAccesoVigente({ revocadoEl: null, actividad: [], ahora })).toBe(false);
  });

  it("un envío reciente deja el acceso vigente", () => {
    expect(portalAccesoVigente({ revocadoEl: null, actividad: [haceDias(2)], ahora })).toBe(true);
  });

  it("pasado el tope de vigencia de un link ya no hay acceso", () => {
    expect(
      portalAccesoVigente({
        revocadoEl: null,
        actividad: [haceDias(TTL_MAXIMO_PORTAL_DIAS + 1)],
        ahora,
      }),
    ).toBe(false);
  });

  it("una revocación posterior corta lo anterior", () => {
    expect(portalAccesoVigente({ revocadoEl: haceDias(1), actividad: [haceDias(3)], ahora })).toBe(
      false,
    );
  });

  it("un link nuevo después de revocar vuelve a dejarlo vigente", () => {
    expect(
      portalAccesoVigente({
        revocadoEl: haceDias(3),
        actividad: [haceDias(5), haceDias(1)],
        ahora,
      }),
    ).toBe(true);
  });

  it("ignora fechas vacías o inválidas", () => {
    expect(
      portalAccesoVigente({ revocadoEl: null, actividad: [null, undefined, "x"], ahora }),
    ).toBe(false);
  });
});
