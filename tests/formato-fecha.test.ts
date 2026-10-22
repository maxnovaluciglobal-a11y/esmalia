import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  diaSemana,
  fecha,
  fechaCorta,
  fechaCortaHora,
  fechaHora,
  fechaLarga,
  hora,
  mesAnio,
  relativa,
} from "@/lib/formato-fecha";

// UX-09 (Ola 0): un solo sistema de fechas. Antes había seis formatos en la
// app; ahora todo pasa por `src/lib/formato-fecha.ts`, en el huso de la
// clínica, 24 h y sin segundos.

const SANTIAGO = "America/Santiago";
const MEXICO = "America/Mexico_City";
// 21 oct 2026, 12:30 UTC = 09:30 en Santiago (UTC-3 con horario de verano).
const INSTANTE = "2026-10-21T12:30:00Z";

describe("formato-fecha: variantes", () => {
  it("fecha, fechaCorta, fechaHora y hora", () => {
    expect(fecha(INSTANTE, SANTIAGO)).toBe("21 oct 2026");
    expect(fechaCorta(INSTANTE, SANTIAGO)).toBe("21 oct");
    expect(fechaHora(INSTANTE, SANTIAGO)).toBe("21 oct 2026, 09:30");
    expect(fechaCortaHora(INSTANTE, SANTIAGO)).toBe("21 oct, 09:30");
    expect(hora(INSTANTE, SANTIAGO)).toBe("09:30");
  });

  it("día de semana, fecha larga y mes", () => {
    expect(diaSemana("2026-10-21")).toBe("mié 21 oct");
    expect(fechaLarga("2026-10-21")).toBe("miércoles 21 de octubre");
    expect(mesAnio("2026-10-21")).toBe("octubre 2026");
  });

  it("reloj de 24 h, sin a. m./p. m. ni segundos", () => {
    const tarde = "2026-10-21T20:05:09Z"; // 17:05:09 en Santiago
    expect(hora(tarde, SANTIAGO)).toBe("17:05");
    expect(fechaHora(tarde, SANTIAGO)).not.toMatch(/a\.\s?m\.|p\.\s?m\.|:09/);
  });

  it("respeta el huso de la clínica", () => {
    // 02:30 UTC del 22 = 23:30 del 21 en Santiago y 20:30 del 21 en México.
    const noche = "2026-10-22T02:30:00Z";
    expect(fechaHora(noche, SANTIAGO)).toBe("21 oct 2026, 23:30");
    expect(fechaHora(noche, MEXICO)).toBe("21 oct 2026, 20:30");
  });

  it("una fecha civil no se corre de día con el huso", () => {
    expect(fecha("2026-01-01", "Pacific/Kiritimati")).toBe("1 ene 2026");
    expect(fecha("2026-01-01", "Pacific/Pago_Pago")).toBe("1 ene 2026");
    expect(hora("2026-01-01", SANTIAGO)).toBe("—");
  });

  it("vacío o inválido muestra un guion, no explota", () => {
    expect(fecha(null)).toBe("—");
    expect(fecha("")).toBe("—");
    expect(fechaHora("no es fecha")).toBe("—");
    expect(fecha(INSTANTE, "Zona/Inexistente")).toBe("21 oct 2026");
  });

  it("relativa cuenta días del calendario de la clínica", () => {
    const ahora = new Date("2026-10-21T15:00:00Z");
    expect(relativa("2026-10-21T22:00:00Z", SANTIAGO, ahora)).toBe("hoy");
    expect(relativa("2026-10-20T15:00:00Z", SANTIAGO, ahora)).toBe("ayer");
    expect(relativa("2026-10-22T15:00:00Z", SANTIAGO, ahora)).toBe("mañana");
    expect(relativa("2026-10-18T15:00:00Z", SANTIAGO, ahora)).toBe("hace 3 días");
    expect(relativa("2026-09-01T15:00:00Z", SANTIAGO, ahora)).toBe("1 sept");
    expect(relativa("2025-09-01T15:00:00Z", SANTIAGO, ahora)).toBe("1 sept 2025");
  });
});

// ── Guardia estática ─────────────────────────────────────────────────────

const SRC = path.resolve(__dirname, "../src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(nombre) && nombre !== "routeTree.gen.ts" ? [ruta] : [];
  });
}

// Único lugar donde se formatea una fecha para mostrarla.
const PERMITIDOS = new Set(["lib/formato-fecha.ts"]);

// `toLocaleString` también cubre números: para eso está `numero()` del mismo
// módulo (o `formatMoney` si es dinero). `Intl.DateTimeFormat("es…")` es
// formatear a mano para mostrar; el `en-CA`/`en-US` de los cálculos de huso
// sigue permitido.
const PROHIBIDO =
  /\.toLocale(?:Date|Time)?String\(|Intl\.DateTimeFormat\(\s*["']es(?:-[A-Z0-9]+)?["']/;

describe("formato-fecha: guardia", () => {
  it("nadie formatea fechas fuera de src/lib/formato-fecha.ts", () => {
    const hallazgos = archivos(SRC).flatMap((ruta) => {
      const relativa = path.relative(SRC, ruta).split(path.sep).join("/");
      if (PERMITIDOS.has(relativa)) return [];
      return readFileSync(ruta, "utf8")
        .split("\n")
        .flatMap((linea, i) => (PROHIBIDO.test(linea) ? [`${relativa}:${i + 1}`] : []));
    });
    expect(hallazgos).toEqual([]);
  });
});
