import { describe, expect, it } from "vitest";

import {
  columnasConDatos,
  normalizarPorPagina,
  pasaFiltrosRapidos,
  type FilaDeListado,
} from "@/lib/patients/lista-pacientes";
import { paginar, paginasVisibles } from "@/lib/search";

const fila = (cambios: Partial<FilaDeListado> = {}): FilaDeListado => ({
  sucursalId: "",
  ultimaVisitaISO: "",
  saldo: null,
  riesgoAusencia: null,
  proximoControl: null,
  ...cambios,
});

describe("listado de pacientes (UX-15)", () => {
  it("por página: 25 por defecto; solo 25, 50 o 100", () => {
    expect(normalizarPorPagina(undefined)).toBe(25);
    expect(normalizarPorPagina("50")).toBe(50);
    expect(normalizarPorPagina(100)).toBe(100);
    expect(normalizarPorPagina(5)).toBe(25);
    expect(normalizarPorPagina("mil")).toBe(25);
    expect(
      paginar(
        Array.from({ length: 60 }, (_, i) => i),
        1,
        25,
      ).items,
    ).toHaveLength(25);
  });

  it("filtro 'Con saldo': solo saldo > 0 (null y 0 quedan fuera)", () => {
    expect(pasaFiltrosRapidos(fila({ saldo: 1000 }), { conSaldo: true })).toBe(true);
    expect(pasaFiltrosRapidos(fila({ saldo: 0 }), { conSaldo: true })).toBe(false);
    expect(pasaFiltrosRapidos(fila({ saldo: null }), { conSaldo: true })).toBe(false);
  });

  it("filtro 'Sin cita futura': sin próximo control", () => {
    expect(pasaFiltrosRapidos(fila(), { sinCitaFutura: true })).toBe(true);
    expect(pasaFiltrosRapidos(fila({ proximoControl: "21 oct" }), { sinCitaFutura: true })).toBe(
      false,
    );
    expect(pasaFiltrosRapidos(fila({ proximoControl: "21 oct" }), {})).toBe(true);
  });

  it("oculta las columnas sin ningún dato en la página", () => {
    expect(columnasConDatos([fila(), fila()], 1)).toEqual({
      sucursal: false,
      ultimaVisita: false,
      saldo: false,
      riesgo: false,
    });
    expect(
      columnasConDatos([fila({ saldo: 0, sucursalId: "s1" }), fila({ riesgoAusencia: 12 })], 2),
    ).toEqual({ sucursal: true, ultimaVisita: false, saldo: true, riesgo: true });
  });

  it("la sucursal no se muestra si la clínica tiene una sola", () => {
    expect(columnasConDatos([fila({ sucursalId: "s1" })], 1).sucursal).toBe(false);
  });
});

describe("paginasVisibles", () => {
  it("pocas páginas: todas", () => {
    expect(paginasVisibles(1, 3)).toEqual([1, 2, 3]);
  });

  it("muchas páginas: extremos, vecinas y saltos", () => {
    expect(paginasVisibles(10, 40)).toEqual([1, "…", 9, 10, 11, "…", 40]);
    expect(paginasVisibles(1, 40)).toEqual([1, 2, "…", 40]);
    expect(paginasVisibles(40, 40)).toEqual([1, "…", 39, 40]);
  });
});
