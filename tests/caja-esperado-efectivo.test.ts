import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  diferenciaDeArqueo,
  esCobroEnEfectivo,
  esperadoEnCaja,
  separarCobrosDelTurno,
  type CashRegisterMethodBreakdown,
} from "@/lib/finance/cash-registers";
import { claveDenominacion, totalDeConteo } from "@/lib/finance/denominaciones";

/**
 * El esperado del arqueo es apertura + cobros EN EFECTIVO del turno.
 * Débito, crédito y transferencia se concilian con el banco y no entran a la
 * diferencia (fix del 20-oct-2026: antes se sumaban todos los medios y un
 * arqueo de billetes no cuadraba nunca si la clínica cobraba con tarjeta).
 */
const turnoConTarjetas: CashRegisterMethodBreakdown[] = [
  { method: "cash", amountCents: 186000, count: 5, enEfectivo: true },
  { method: "debit_card", amountCents: 412000, count: 4, enEfectivo: false },
  { method: "credit_card", amountCents: 338000, count: 3, enEfectivo: false },
  { method: "transfer", amountCents: 348000, count: 2, enEfectivo: false },
];

describe("esperado en caja: solo efectivo", () => {
  it("solo `cash` es efectivo", () => {
    expect(esCobroEnEfectivo("cash")).toBe(true);
    for (const m of ["debit_card", "credit_card", "transfer", "other", null, undefined]) {
      expect(esCobroEnEfectivo(m)).toBe(false);
    }
  });

  it("separa lo del cajón de lo que se concilia con el banco", () => {
    expect(separarCobrosDelTurno(turnoConTarjetas)).toEqual({
      efectivoCents: 186000,
      efectivoCantidad: 5,
      aConciliarCents: 1098000,
      aConciliarCantidad: 9,
    });
  });

  it("pagos con débito con la caja abierta: el arqueo de billetes cuadra", () => {
    const { efectivoCents } = separarCobrosDelTurno(turnoConTarjetas);
    const esperado = esperadoEnCaja(50000, efectivoCents);
    expect(esperado).toBe(236000);

    // El cajón: apertura $50.000 + $186.000 cobrados en efectivo.
    const conteo = {
      [claveDenominacion({ valorCents: 20000, tipo: "billete" })]: 8,
      [claveDenominacion({ valorCents: 10000, tipo: "billete" })]: 4,
      [claveDenominacion({ valorCents: 5000, tipo: "billete" })]: 4,
      [claveDenominacion({ valorCents: 2000, tipo: "billete" })]: 5,
      [claveDenominacion({ valorCents: 1000, tipo: "billete" })]: 4,
      [claveDenominacion({ valorCents: 500, tipo: "moneda" })]: 2,
      [claveDenominacion({ valorCents: 100, tipo: "moneda" })]: 10,
    };
    const contado = totalDeConteo(conteo, "CLP");
    expect(diferenciaDeArqueo(contado, esperado)).toBe(0);
  });

  it("un turno solo con tarjetas espera exactamente la apertura", () => {
    const soloTarjetas = turnoConTarjetas.filter((f) => !f.enEfectivo);
    expect(esperadoEnCaja(50000, separarCobrosDelTurno(soloTarjetas).efectivoCents)).toBe(50000);
  });

  it("el servidor calcula el esperado del cierre solo con efectivo", () => {
    const fuente = readFileSync(
      new URL("../src/lib/finance/cash-registers.functions.ts", import.meta.url),
      "utf8",
    );
    const cierre = fuente.slice(
      fuente.indexOf("export const closeCashRegister"),
      fuente.indexOf("export const getCashRegisterBreakdown"),
    );
    expect(cierre).toMatch(/\.select\("amount_cents, method"\)/);
    expect(cierre).toMatch(/\.filter\(\(p\) => esCobroEnEfectivo\(p\.method\)\)/);
    expect(cierre).toMatch(
      /esperadoEnCaja\(register\.opening_amount_cents, cobradoEnEfectivoCents\)/,
    );
    // El desglose marca cada fila para que la UI use el mismo criterio.
    expect(fuente).toMatch(/enEfectivo = esCobroEnEfectivo\(row\.method\)/);
  });
});
