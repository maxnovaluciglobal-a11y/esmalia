import { describe, expect, it } from "vitest";

import {
  agruparPorMetodo,
  claveDeMetodo,
  lecturaCobradoVsProducido,
  recortarSerieMensual,
} from "@/lib/finance/reportes-lectura";

describe("agruparPorMetodo", () => {
  it("un pago viejo con `transfer` y uno nuevo con 'Transferencia' son una sola fila", () => {
    const filas = agruparPorMetodo([
      { amount_cents: 90_000, method: "transfer", method_name_snapshot: null },
      { amount_cents: 30_000, method: "transfer", method_name_snapshot: "Transferencia" },
      { amount_cents: 20_000, method: "other", method_name_snapshot: " transferencia " },
    ]);
    expect(filas).toEqual([{ method: "Transferencia", totalCents: 140_000, count: 3 }]);
  });

  it("une variantes con tildes y espacios, y respeta un medio propio", () => {
    const filas = agruparPorMetodo([
      { amount_cents: 48_000, method: "credit_card", method_name_snapshot: null },
      { amount_cents: 12_000, method: "credit_card", method_name_snapshot: "Tarjeta de  credito" },
      { amount_cents: 70_000, method: "credit_card", method_name_snapshot: "Klap - Crédito" },
      { amount_cents: 125_000, method: "cash", method_name_snapshot: "Efectivo" },
    ]);
    expect(filas).toEqual([
      { method: "Efectivo", totalCents: 125_000, count: 1 },
      { method: "Klap - Crédito", totalCents: 70_000, count: 1 },
      { method: "Tarjeta de crédito", totalCents: 60_000, count: 2 },
    ]);
  });

  it("un método desconocido sin nombre queda con su clave", () => {
    expect(
      agruparPorMetodo([{ amount_cents: 1, method: "cripto", method_name_snapshot: null }]),
    ).toEqual([{ method: "cripto", totalCents: 1, count: 1 }]);
  });

  it("claveDeMetodo normaliza tildes, mayúsculas y espacios", () => {
    expect(claveDeMetodo("  Tarjeta  de Crédito ")).toBe("tarjeta de credito");
  });
});

describe("lecturaCobradoVsProducido", () => {
  it("cobrado de más: monto positivo y texto que dice el sentido", () => {
    const l = lecturaCobradoVsProducido(100_000, 105_000, "CLP");
    expect(l.etiqueta).toBe("Cobrado de más");
    expect(l.valor).not.toContain("-");
    expect(l.nota).toMatch(/^Cobraste \$5\.000 más de lo producido/);
  });

  it("falta cobrar", () => {
    const l = lecturaCobradoVsProducido(80_000, 50_000, "CLP");
    expect(l.etiqueta).toBe("Por cobrar");
    expect(l.nota).toMatch(/^Falta cobrar \$30\.000/);
  });

  it("iguales", () => {
    expect(lecturaCobradoVsProducido(1, 1, "CLP").nota).toBe("Cobraste exactamente lo producido.");
  });
});

describe("recortarSerieMensual", () => {
  const mes = (m: string, v = 0, r = 0) => ({ mes: m, ventasCents: v, recaudacionCents: r });
  const anio = [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
  ];

  it("solo octubre con datos: quedan los últimos 3 meses", () => {
    const serie = anio.map((m) => mes(m, m === "2026-10" ? 100 : 0));
    expect(recortarSerieMensual(serie).map((m) => m.mes)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  it("desde el primer mes con datos, aunque haya huecos después", () => {
    const serie = anio.map((m) => mes(m, 0, m === "2026-04" ? 5 : 0));
    expect(recortarSerieMensual(serie)[0].mes).toBe("2026-04");
    expect(recortarSerieMensual(serie)).toHaveLength(7);
  });

  it("sin datos o con datos desde el principio, la serie entera", () => {
    expect(recortarSerieMensual(anio.map((m) => mes(m)))).toHaveLength(12);
    expect(recortarSerieMensual(anio.map((m) => mes(m, 1)))).toHaveLength(12);
  });
});
