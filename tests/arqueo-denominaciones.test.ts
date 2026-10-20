import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { motivoFaltante, MOTIVO_MINIMO } from "@/lib/finance/cash-registers";
import {
  ajustarCantidad,
  claveDenominacion,
  denominacionesDe,
  detalleDeConteo,
  leerDetalle,
  MAX_PIEZAS_POR_DENOMINACION,
  MONEDAS_CON_DENOMINACIONES,
  totalDeConteo,
  validarConteo,
} from "@/lib/finance/denominaciones";
import { TABLAS_EXPORTACION } from "@/lib/exportacion/exportacion-clinica";

const clave = (valorCents: number, tipo: "billete" | "moneda" = "billete") =>
  claveDenominacion({ valorCents, tipo });

describe("denominaciones por moneda", () => {
  it("cubre las monedas del mercado de Esmalia", () => {
    expect([...MONEDAS_CON_DENOMINACIONES].sort()).toEqual(
      ["ARS", "CLP", "COP", "MXN", "PEN", "USD"].sort(),
    );
  });

  it.each(MONEDAS_CON_DENOMINACIONES)("%s: cents enteros, de mayor a menor, sin repetir", (m) => {
    const tabla = denominacionesDe(m)!;
    expect(tabla.length).toBeGreaterThan(3);
    const claves = tabla.map(claveDenominacion);
    expect(new Set(claves).size).toBe(claves.length);
    for (const [i, d] of tabla.entries()) {
      expect(Number.isInteger(d.valorCents)).toBe(true);
      expect(d.valorCents).toBeGreaterThan(0);
      if (i > 0) expect(d.valorCents).toBeLessThanOrEqual(tabla[i - 1].valorCents);
    }
    // Los billetes van antes que las monedas.
    const primeraMoneda = tabla.findIndex((d) => d.tipo === "moneda");
    if (primeraMoneda >= 0) {
      expect(tabla.slice(primeraMoneda).every((d) => d.tipo === "moneda")).toBe(true);
    }
  });

  it("respeta las monedas sin decimales (regla 6)", () => {
    // CLP y COP: el cent es el peso.
    expect(denominacionesDe("CLP")![0]).toEqual({ valorCents: 20000, tipo: "billete" });
    expect(denominacionesDe("COP")![0]).toEqual({ valorCents: 100000, tipo: "billete" });
    // MXN, PEN y USD tienen centavos: factor 100.
    expect(denominacionesDe("MXN")![0].valorCents).toBe(100000);
    expect(denominacionesDe("MXN")!.at(-1)!.valorCents).toBe(50);
    expect(denominacionesDe("PEN")!.at(-1)!.valorCents).toBe(10);
    expect(denominacionesDe("USD")!.at(-1)!.valorCents).toBe(1);
  });

  it("acepta la moneda en minúsculas y devuelve null si no hay tabla", () => {
    expect(denominacionesDe("clp")).toEqual(denominacionesDe("CLP"));
    expect(denominacionesDe("EUR")).toBeNull();
  });

  it("MXN distingue el 20 en billete del 20 en moneda", () => {
    const veinte = denominacionesDe("MXN")!.filter((d) => d.valorCents === 2000);
    expect(veinte.map((d) => d.tipo)).toEqual(["billete", "moneda"]);
  });
});

describe("conteo", () => {
  it("suma como el prototipo de caja (CLP)", () => {
    const conteo = {
      [clave(20000)]: 8,
      [clave(10000)]: 4,
      [clave(5000)]: 3,
      [clave(2000)]: 5,
      [clave(1000)]: 4,
      [clave(500, "moneda")]: 2,
      [clave(100, "moneda")]: 10,
    };
    expect(totalDeConteo(conteo, "CLP")).toBe(231000);
  });

  it("ignora claves de otra moneda y cantidades inválidas", () => {
    expect(totalDeConteo({ [clave(20000)]: 1, [clave(999)]: 5 }, "CLP")).toBe(20000);
    expect(totalDeConteo({ [clave(20000)]: -1 }, "CLP")).toBe(0);
    expect(totalDeConteo({ [clave(20000)]: 1.5 }, "CLP")).toBe(0);
  });

  it("los botones no bajan de cero ni pasan el tope", () => {
    expect(ajustarCantidad(0, -1)).toBe(0);
    expect(ajustarCantidad(3, 1)).toBe(4);
    expect(ajustarCantidad(MAX_PIEZAS_POR_DENOMINACION, 1)).toBe(MAX_PIEZAS_POR_DENOMINACION);
  });

  it("el detalle guarda todas las filas, también las que quedaron en cero", () => {
    const detalle = detalleDeConteo({ [clave(5000, "billete")]: 2 }, "PEN")!;
    expect(detalle.version).toBe(1);
    expect(detalle.currency).toBe("PEN");
    expect(detalle.filas).toHaveLength(denominacionesDe("PEN")!.length);
    expect(detalle.totalCents).toBe(10000);
  });
});

describe("validación del servidor", () => {
  it("rehace el total con su propia tabla", () => {
    const r = validarConteo(
      [
        { valorCents: 10000, tipo: "billete", cantidad: 3 },
        { valorCents: 50, tipo: "moneda", cantidad: 1 },
      ],
      "MXN",
    );
    expect(r.ok && r.detalle.totalCents).toBe(30050);
  });

  it("rechaza una denominación que no es de la moneda de la caja", () => {
    const r = validarConteo([{ valorCents: 20000, tipo: "billete", cantidad: 1 }], "USD");
    expect(r.ok).toBe(false);
  });

  it("rechaza cantidades negativas, decimales o repetidas", () => {
    expect(validarConteo([{ valorCents: 20000, tipo: "billete", cantidad: -2 }], "CLP").ok).toBe(
      false,
    );
    expect(validarConteo([{ valorCents: 20000, tipo: "billete", cantidad: 1.5 }], "CLP").ok).toBe(
      false,
    );
    expect(
      validarConteo(
        [
          { valorCents: 20000, tipo: "billete", cantidad: 1 },
          { valorCents: 20000, tipo: "billete", cantidad: 1 },
        ],
        "CLP",
      ).ok,
    ).toBe(false);
  });

  it("rechaza el conteo si la moneda no tiene tabla", () => {
    expect(validarConteo([], "EUR").ok).toBe(false);
  });

  it("leerDetalle devuelve lo guardado y descarta formas raras", () => {
    const detalle = detalleDeConteo({ [clave(1000)]: 3 }, "CLP");
    expect(leerDetalle(JSON.parse(JSON.stringify(detalle)))).toEqual(detalle);
    expect(leerDetalle(null)).toBeNull();
    expect(leerDetalle({ version: 2 })).toBeNull();
    expect(
      leerDetalle({ ...detalle, filas: [{ valorCents: 1, tipo: "x", cantidad: 1 }] }),
    ).toBeNull();
  });
});

describe("motivo obligatorio", () => {
  it("solo si no cuadra", () => {
    expect(motivoFaltante(0, undefined)).toBe(false);
    expect(motivoFaltante(-5000, undefined)).toBe(true);
    expect(motivoFaltante(300, "   ")).toBe(true);
    expect(motivoFaltante(-5000, "x".repeat(MOTIVO_MINIMO - 1))).toBe(true);
    expect(motivoFaltante(-5000, "vuelto mal dado")).toBe(false);
  });

  it("lo exige el servidor al cerrar, con la diferencia que calcula él", () => {
    const fuente = readFileSync(
      new URL("../src/lib/finance/cash-registers.functions.ts", import.meta.url),
      "utf8",
    );
    const cierre = fuente.slice(fuente.indexOf("export const closeCashRegister"));
    expect(cierre).toMatch(/requireEscritura/);
    expect(cierre).toMatch(/motivoFaltante\(differenceCents, data\.notes\)/);
    expect(cierre).toMatch(/validarConteo\(data\.denominations, register\.currency\)/);
    expect(cierre).toMatch(/closing_denominations: detalle/);
  });
});

describe("migración y exportación", () => {
  it("la columna es jsonb nullable", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/20261020020000_arqueo_denominaciones.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toMatch(/ADD COLUMN closing_denominations jsonb NULL/);
  });

  it("el detalle sale en la exportación de la clínica", () => {
    const cajas = TABLAS_EXPORTACION.find((t) => t.tabla === "cash_registers")!;
    expect(cajas.columnas).toContain("closing_denominations");
  });
});
