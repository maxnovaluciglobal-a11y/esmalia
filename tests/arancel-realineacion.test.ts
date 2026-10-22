import { describe, expect, it } from "vitest";

import {
  calcularRealineacion,
  errorDeParametros,
  nuevoPrecio,
  redondearA,
  resumenRealineacion,
} from "../src/lib/arancel/realineacion";
import { toCents } from "../src/lib/finance/finance";

/**
 * ADM-04: realinear precios del arancel en lote. Lo mismo que dibuja la vista
 * previa es lo que el servidor manda a `realinear_precios`, así que estas
 * pruebas cubren las dos cosas.
 */

const precios = [
  { id: "a", name: "Resina una cara", priceCents: 45_000 },
  { id: "b", name: "Endodoncia molar", priceCents: 210_000 },
  { id: "c", name: "Control", priceCents: 0 },
];

describe("redondeo", () => {
  it("al múltiplo más cercano, mitad hacia arriba", () => {
    expect(redondearA(47_249, 100)).toBe(47_200);
    expect(redondearA(47_250, 100)).toBe(47_300);
    expect(redondearA(47_251, 1000)).toBe(47_000);
  });
  it("sin paso (o paso 1) solo redondea a entero", () => {
    expect(redondearA(47_250.6, null)).toBe(47_251);
    expect(redondearA(47_250.4, 1)).toBe(47_250);
  });
});

describe("nuevo precio", () => {
  it("porcentaje: +5 % en CLP", () => {
    expect(nuevoPrecio(45_000, { modo: "percent", porcentaje: 5 })).toBe(47_250);
  });
  it("porcentaje negativo baja", () => {
    expect(nuevoPrecio(45_000, { modo: "percent", porcentaje: -10 })).toBe(40_500);
  });
  it("porcentaje con redondeo a la centena", () => {
    expect(nuevoPrecio(45_000, { modo: "percent", porcentaje: 3.3, redondeoCents: 100 })).toBe(
      46_500,
    );
  });
  it("monto fijo suma o resta en cents", () => {
    expect(nuevoPrecio(45_000, { modo: "amount", montoCents: 2_000 })).toBe(47_000);
    expect(nuevoPrecio(45_000, { modo: "amount", montoCents: -2_000 })).toBe(43_000);
  });
  it("nunca queda negativo", () => {
    expect(nuevoPrecio(1_000, { modo: "amount", montoCents: -5_000 })).toBe(0);
  });
  it("MXN: el monto llega en cents (100× lo tipeado) y el redondeo también", () => {
    const monto = toCents(25.5, "MXN"); // $25,50
    expect(nuevoPrecio(toCents(450, "MXN"), { modo: "amount", montoCents: monto })).toBe(47_550);
    const alPeso = toCents(1, "MXN");
    expect(
      nuevoPrecio(toCents(450, "MXN"), { modo: "percent", porcentaje: 3, redondeoCents: alPeso }),
    ).toBe(46_400);
  });
});

describe("validación de parámetros", () => {
  it("pide un valor y rechaza el cero", () => {
    expect(errorDeParametros({ modo: "percent", porcentaje: null })).toMatch(/porcentaje/);
    expect(errorDeParametros({ modo: "percent", porcentaje: 0 })).toMatch(/no cambia/);
    expect(errorDeParametros({ modo: "amount", montoCents: undefined })).toMatch(/monto/);
    expect(errorDeParametros({ modo: "amount", montoCents: 0 })).toMatch(/no cambia/);
  });
  it("acota el porcentaje y exige monto entero", () => {
    expect(errorDeParametros({ modo: "percent", porcentaje: -100 })).not.toBeNull();
    expect(errorDeParametros({ modo: "percent", porcentaje: 1001 })).not.toBeNull();
    expect(errorDeParametros({ modo: "amount", montoCents: 10.5 })).not.toBeNull();
    expect(errorDeParametros({ modo: "percent", porcentaje: 7.5 })).toBeNull();
  });
});

describe("calcularRealineacion", () => {
  it("devuelve el antes y el después de las que cambian", () => {
    const cambios = calcularRealineacion(precios, { modo: "percent", porcentaje: 10 });
    expect(cambios).toEqual([
      { procedureId: "a", name: "Resina una cara", oldCents: 45_000, newCents: 49_500 },
      { procedureId: "b", name: "Endodoncia molar", oldCents: 210_000, newCents: 231_000 },
    ]);
  });
  it("deja afuera las que no cambian (precio 0 con porcentaje) y las repetidas", () => {
    const cambios = calcularRealineacion([...precios, precios[0]], {
      modo: "percent",
      porcentaje: 10,
    });
    expect(cambios.map((c) => c.procedureId)).toEqual(["a", "b"]);
  });
  it("un monto fijo sí mueve las que estaban en cero", () => {
    const cambios = calcularRealineacion(precios, { modo: "amount", montoCents: 1_000 });
    expect(cambios.find((c) => c.procedureId === "c")?.newCents).toBe(1_000);
  });
  it("con parámetros inválidos no calcula nada", () => {
    expect(calcularRealineacion(precios, { modo: "percent", porcentaje: 0 })).toEqual([]);
  });
  it("resumen: totales y cuántas quedan en cero", () => {
    const cambios = calcularRealineacion(precios, { modo: "amount", montoCents: -50_000 });
    expect(resumenRealineacion(cambios)).toEqual({
      cantidad: 2,
      totalAntes: 255_000,
      totalDespues: 160_000,
      bajanACero: 1,
    });
  });
});
