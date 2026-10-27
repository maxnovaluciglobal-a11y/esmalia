import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  esNuevaDelMes,
  mesEnZona,
  resumenCartera,
  type FilaDeCartera,
} from "@/lib/patients/cartera";

const ZONA = "America/Santiago";
const HOY = "2026-10-27";

function fila(f: Partial<FilaDeCartera>): FilaDeCartera {
  return { estado: "activo", saldo: null, proximoControl: null, ...f };
}

describe("franja de la cartera en /pacientes (A+)", () => {
  it("el mes se toma en el huso de la clínica, no en UTC", () => {
    // 1-nov 02:00 UTC es todavía 31-oct en Santiago (UTC-3).
    expect(mesEnZona("2026-11-01T02:00:00Z", ZONA)).toBe("2026-10");
    expect(esNuevaDelMes({ creadaEl: "2026-11-01T02:00:00Z" }, HOY, ZONA)).toBe(true);
    expect(esNuevaDelMes({ creadaEl: "2026-09-30T12:00:00Z" }, HOY, ZONA)).toBe(false);
    expect(esNuevaDelMes({ creadaEl: null }, HOY, ZONA)).toBe(false);
  });

  it("cuenta activos, nuevos, sin cita futura e incompletas", () => {
    const r = resumenCartera(
      [
        fila({ creadaEl: "2026-10-05T12:00:00Z", proximoControl: "3 nov 2026" }),
        fila({ estado: "inactivo", faltantes: ["prevision"] }),
        fila({ estado: "nuevo", archivadaEl: "2026-10-01" }),
        fila({ estado: "nuevo", faltantes: [] }),
      ],
      HOY,
      ZONA,
    );
    expect(r).toMatchObject({
      total: 4,
      activos: 2,
      nuevosDelMes: 1,
      sinCitaFutura: 3,
      incompletas: 1,
    });
  });

  it("sin ningún saldo (sin finance:view) no fabrica cero (regla 11)", () => {
    expect(resumenCartera([fila({}), fila({})], HOY, ZONA).conSaldo).toBeNull();
    const r = resumenCartera(
      [fila({ saldo: 0 }), fila({ saldo: 1500 }), fila({ saldo: 500 })],
      HOY,
      ZONA,
    );
    expect(r.conSaldo).toEqual({ cantidad: 2, montoCents: 2000 });
  });

  it("la franja filtra por URL y el saldo se muestra solo con finance:view", () => {
    const ruta = readFileSync("src/routes/_authenticated/_clinic/pacientes.index.tsx", "utf8");
    expect(ruta).toContain('toggle("nuevos")');
    expect(ruta).toContain('toggle("activos")');
    expect(ruta).toMatch(/\{veFinanzas && \(\s*<Indicador\s+etiqueta="Con saldo"/);
    // El RUT de la lista va enmascarado, como en la ficha.
    expect(ruta).toContain("enmascararDocumento(doc)");
  });
});
