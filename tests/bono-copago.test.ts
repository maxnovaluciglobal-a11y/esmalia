import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  avisoDeTramo,
  calcularCopago,
  partesDelCobro,
  TIPOS_DE_BONO,
  tipoSugerido,
} from "../src/lib/finance/bono-copago";

/**
 * MKT-03: bono Fonasa / isapre con copago y PAD dental. Registro manual: la
 * cuenta es precio − bono (MLE, isapre) o, en un PAD, precio y copago fijos
 * del paquete. Todo en cents (regla 6).
 */

describe("bono Fonasa MLE e isapre", () => {
  it("copago = precio − bono", () => {
    expect(calcularCopago({ tipo: "fonasa_mle", precioCents: 45_000, bonoCents: 12_350 })).toEqual({
      ok: true,
      precioCents: 45_000,
      bonoCents: 12_350,
      copagoCents: 32_650,
    });
    expect(calcularCopago({ tipo: "isapre", precioCents: 80_000, bonoCents: 56_000 })).toEqual({
      ok: true,
      precioCents: 80_000,
      bonoCents: 56_000,
      copagoCents: 24_000,
    });
  });
  it("un bono que cubre todo deja copago 0", () => {
    const r = calcularCopago({ tipo: "isapre", precioCents: 30_000, bonoCents: 30_000 });
    expect(r).toMatchObject({ ok: true, copagoCents: 0 });
  });
  it("rechaza bono mayor que el precio, bono vacío o cero y precio vacío", () => {
    expect(calcularCopago({ tipo: "fonasa_mle", precioCents: 10_000, bonoCents: 10_001 }).ok).toBe(
      false,
    );
    expect(calcularCopago({ tipo: "fonasa_mle", precioCents: 10_000, bonoCents: null }).ok).toBe(
      false,
    );
    expect(calcularCopago({ tipo: "fonasa_mle", precioCents: 10_000, bonoCents: 0 }).ok).toBe(
      false,
    );
    expect(calcularCopago({ tipo: "isapre", precioCents: null, bonoCents: 100 }).ok).toBe(false);
  });
  it("no acepta montos con decimales (los cents son enteros)", () => {
    expect(calcularCopago({ tipo: "isapre", precioCents: 100.5, bonoCents: 50 }).ok).toBe(false);
  });
});

describe("PAD dental", () => {
  it("precio y copago fijos: el bono es la diferencia", () => {
    expect(
      calcularCopago({ tipo: "fonasa_pad", precioCents: 120_000, copagoCents: 36_000 }),
    ).toEqual({ ok: true, precioCents: 120_000, bonoCents: 84_000, copagoCents: 36_000 });
  });
  it("copago 0: el PAD lo cubre entero", () => {
    expect(
      calcularCopago({ tipo: "fonasa_pad", precioCents: 120_000, copagoCents: 0 }),
    ).toMatchObject({ ok: true, bonoCents: 120_000, copagoCents: 0 });
  });
  it("el copago tiene que ser menor que el precio y no vacío", () => {
    expect(calcularCopago({ tipo: "fonasa_pad", precioCents: 1_000, copagoCents: 1_000 }).ok).toBe(
      false,
    );
    expect(calcularCopago({ tipo: "fonasa_pad", precioCents: 1_000, copagoCents: null }).ok).toBe(
      false,
    );
  });
});

describe("partes del cobro", () => {
  it("bono + copago son dos pagos que suman el precio", () => {
    const r = calcularCopago({ tipo: "fonasa_mle", precioCents: 45_000, bonoCents: 12_350 });
    if (!r.ok) throw new Error("debía calcular");
    const partes = partesDelCobro(r);
    expect(partes).toEqual([
      { rol: "bono", montoCents: 12_350 },
      { rol: "copago", montoCents: 32_650 },
    ]);
    expect(partes.reduce((s, p) => s + p.montoCents, 0)).toBe(45_000);
  });
  it("sin copago, solo el pago del bono (nunca un pago de 0)", () => {
    const r = calcularCopago({ tipo: "isapre", precioCents: 30_000, bonoCents: 30_000 });
    if (!r.ok) throw new Error("debía calcular");
    expect(partesDelCobro(r)).toEqual([{ rol: "bono", montoCents: 30_000 }]);
  });
});

describe("previsión y tramo", () => {
  it("propone isapre a quien tiene isapre y Fonasa al resto", () => {
    expect(tipoSugerido("isapre")).toBe("isapre");
    expect(tipoSugerido("fonasa")).toBe("fonasa_mle");
    expect(tipoSugerido(null)).toBe("fonasa_mle");
  });
  it("avisa (sin bloquear) un bono Fonasa en tramo A", () => {
    expect(avisoDeTramo("fonasa_mle", "A")).not.toBeNull();
    expect(avisoDeTramo("fonasa_pad", "A")).not.toBeNull();
    expect(avisoDeTramo("fonasa_mle", "B")).toBeNull();
    expect(avisoDeTramo("isapre", "A")).toBeNull();
  });
});

describe("la base acepta los mismos valores que el código", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261024100200_bono_y_copago.sql", import.meta.url),
    "utf8",
  );
  it("tipos de bono", () => {
    expect(sql).toContain(
      `check (coverage_kind in (${TIPOS_DE_BONO.map((t) => `'${t}'`).join(", ")}))`,
    );
  });
  it("el CHECK exige que bono + copago cuadren con el precio", () => {
    expect(sql).toContain("amount_cents = voucher_cents");
    expect(sql).toContain("amount_cents = coverage_price_cents - voucher_cents");
  });
});
