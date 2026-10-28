import { describe, expect, it } from "vitest";

import {
  diaEnLaZona,
  estadoDeLaDemo,
  reseteoEsDeHoy,
  sumarDiasCiviles,
  ZONA_DE_LA_DEMO,
} from "@/lib/demo/dia-de-la-clinica";

/**
 * El día de la clínica demo no es el día UTC. Santiago va 3 horas (verano) o
 * 4 (invierno) detrás de UTC: entre las 21:00 de Chile y la medianoche UTC los
 * dos días difieren, y pasada la medianoche de Santiago "hoy" cambia aunque
 * nadie haya vuelto a sembrar la demo. De ahí salía el "Cobrado hoy: $0" de la
 * Caja (hallazgo del 28-oct-2026).
 */
describe("día de la clínica demo (Santiago) frente a UTC", () => {
  it("a las 22:30 de Santiago (verano) ya es el día siguiente en UTC, pero no en la clínica", () => {
    const ahora = new Date("2026-10-29T01:30:00Z"); // 28-oct 22:30 en Santiago (UTC-3)
    expect(ahora.toISOString().slice(0, 10)).toBe("2026-10-29");
    expect(diaEnLaZona(ZONA_DE_LA_DEMO, ahora)).toBe("2026-10-28");
  });

  it("a las 22:30 de Santiago (invierno) pasa lo mismo, con 4 horas de diferencia", () => {
    const ahora = new Date("2026-07-16T02:30:00Z"); // 15-jul 22:30 en Santiago (UTC-4)
    expect(ahora.toISOString().slice(0, 10)).toBe("2026-07-16");
    expect(diaEnLaZona(ZONA_DE_LA_DEMO, ahora)).toBe("2026-07-15");
  });

  it("a las 00:30 de Santiago ya es otro día de la clínica, aunque en UTC sea el mismo", () => {
    const ahora = new Date("2026-10-29T03:30:00Z"); // 29-oct 00:30 en Santiago
    expect(diaEnLaZona(ZONA_DE_LA_DEMO, ahora)).toBe("2026-10-29");
    expect(diaEnLaZona("UTC", new Date("2026-10-29T03:30:00Z"))).toBe("2026-10-29");
  });

  it("sumar días es aritmética de calendario y cruza meses y años", () => {
    expect(sumarDiasCiviles("2026-10-28", -40)).toBe("2026-09-18");
    expect(sumarDiasCiviles("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDiasCiviles("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("estado de la demo según el reseteo y las áreas", () => {
  const reseteo = "2026-10-28T05:05:00Z"; // 28-oct 02:05 en Santiago

  it("reseteada hoy y con todas las áreas: al día", () => {
    const ahora = new Date("2026-10-28T20:00:00Z");
    expect(reseteoEsDeHoy(reseteo, ZONA_DE_LA_DEMO, ahora)).toBe(true);
    expect(estadoDeLaDemo({ reseteadaEn: reseteo, areasVacias: [], ahora })).toBe("al-dia");
  });

  it("reseteada hoy pero con áreas vacías (reseteo a medias): completar, sin rehacerla", () => {
    const ahora = new Date("2026-10-28T20:00:00Z");
    expect(estadoDeLaDemo({ reseteadaEn: reseteo, areasVacias: ["caja"], ahora })).toBe(
      "completar",
    );
  });

  it("a las 22:30 de Santiago el reseteo de la madrugada sigue siendo de hoy aunque UTC ya cambió", () => {
    const ahora = new Date("2026-10-29T01:30:00Z");
    expect(estadoDeLaDemo({ reseteadaEn: reseteo, areasVacias: [], ahora })).toBe("al-dia");
  });

  it("pasada la medianoche de Santiago el reseteo de ayer ya no sirve: reiniciar", () => {
    const ahora = new Date("2026-10-29T03:30:00Z"); // 00:30 del 29 en Santiago
    expect(estadoDeLaDemo({ reseteadaEn: reseteo, areasVacias: [], ahora })).toBe("reiniciar");
  });

  it("sin clínica no hay reseteo de hoy", () => {
    expect(estadoDeLaDemo({ reseteadaEn: null, areasVacias: [] })).toBe("reiniciar");
  });
});
