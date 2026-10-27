import { describe, expect, it } from "vitest";

import {
  nombreDelPeriodo,
  periodoActivo,
  rangoDePeriodo,
  serieDeCaja,
  sumarDias,
} from "@/lib/finance/periodos-reporte";
import {
  filtrarInsumos,
  ordenPorVencer,
  resumenInventario,
  resumenLaboratorio,
} from "@/lib/clinic-operations/operacion-resumen";
import { LAB_ORDER_STATUSES, type LabOrder } from "@/lib/finance/finance";

describe("periodos de los reportes", () => {
  it("suma días cruzando meses y años", () => {
    expect(sumarDias("2026-10-27", 5)).toBe("2026-11-01");
    expect(sumarDias("2026-01-01", -1)).toBe("2025-12-31");
    expect(sumarDias("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("arma los rangos de cada chip", () => {
    expect(rangoDePeriodo("mes", "2026-10-27")).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-27",
    });
    expect(rangoDePeriodo("mes-anterior", "2026-10-27")).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-30",
    });
    expect(rangoDePeriodo("mes-anterior", "2026-01-15")).toEqual({
      desde: "2025-12-01",
      hasta: "2025-12-31",
    });
    expect(rangoDePeriodo("90-dias", "2026-10-27")).toEqual({
      desde: "2026-07-30",
      hasta: "2026-10-27",
    });
    expect(rangoDePeriodo("personalizado", "2026-10-27")).toBeNull();
  });

  it("marca el chip que coincide o Personalizado", () => {
    expect(periodoActivo("2026-10-01", "2026-10-27", "2026-10-27")).toBe("mes");
    expect(periodoActivo("2026-09-01", "2026-09-30", "2026-10-27")).toBe("mes-anterior");
    expect(periodoActivo("2026-07-30", "2026-10-27", "2026-10-27")).toBe("90-dias");
    expect(periodoActivo("2026-10-03", "2026-10-27", "2026-10-27")).toBe("personalizado");
  });

  it("nombra el período para el título", () => {
    expect(nombreDelPeriodo("2026-10-01", "2026-10-27", "2026-10-27")).toBe("octubre");
    expect(nombreDelPeriodo("2026-09-01", "2026-09-30", "2026-10-27")).toBe("septiembre");
    expect(nombreDelPeriodo("2025-12-01", "2025-12-31", "2026-01-10")).toBe("diciembre 2025");
    expect(nombreDelPeriodo("2026-07-30", "2026-10-27", "2026-10-27")).toBe("los últimos 90 días");
    expect(nombreDelPeriodo("2026-10-03", "2026-10-10", "2026-10-27")).toBe("3 oct — 10 oct");
  });
});

function orden(p: Partial<LabOrder>): LabOrder {
  return {
    id: Math.random().toString(36),
    patientId: "p",
    patientName: "Paciente",
    labId: null,
    labNameSnapshot: null,
    description: "Corona",
    toothNumbers: null,
    status: "enviado",
    sentOn: "2026-10-01",
    dueOn: null,
    receivedOn: null,
    costCents: null,
    currency: "CLP",
    notes: null,
    ...p,
  } as LabOrder;
}

describe("resumen de laboratorio", () => {
  const hoy = "2026-10-27";
  it("separa atrasadas y por vencer, sin contar recibidas ni sin plazo", () => {
    const ordenes = [
      orden({ dueOn: "2026-10-20" }), // atrasada
      orden({ dueOn: "2026-10-25", status: "recibido" }), // llegó: no cuenta
      orden({ dueOn: "2026-10-27", status: "en_proceso" }), // vence hoy
      orden({ dueOn: "2026-11-03" }), // dentro de 7 días
      orden({ dueOn: "2026-11-04" }), // fuera
      orden({ dueOn: null }), // sin plazo pactado
      orden({ dueOn: "2026-10-28", status: "cancelado" }),
    ];
    const r = resumenLaboratorio(ordenes, hoy, LAB_ORDER_STATUSES);
    expect(r.atrasadas.map((o) => o.dueOn)).toEqual(["2026-10-20"]);
    expect(r.porVencer.map((o) => o.dueOn)).toEqual(["2026-10-27", "2026-11-03"]);
    expect(r.enCurso).toBe(5);
    expect(r.porEstado.find((e) => e.status === "recibido")?.cantidad).toBe(1);
    expect(r.porEstado.reduce((s, e) => s + e.cantidad, 0)).toBe(ordenes.length);
    expect(ordenPorVencer(orden({ dueOn: "2026-10-26" }), hoy)).toBe(false);
  });
});

describe("resumen de inventario", () => {
  const base = { unit: "u", isActive: true };
  const items = [
    { ...base, id: "a", name: "Guantes", currentStock: 4, minStock: 10, belowMinStock: true },
    { ...base, id: "b", name: "Resina", currentStock: 1, minStock: 5, belowMinStock: true },
    { ...base, id: "c", name: "Anestesia", currentStock: 30, minStock: 10, belowMinStock: false },
    { ...base, id: "d", name: "Gasa", currentStock: 8, minStock: null, belowMinStock: false },
    {
      ...base,
      id: "e",
      name: "Viejo",
      currentStock: 0,
      minStock: 3,
      belowMinStock: true,
      isActive: false,
    },
  ];
  it("ordena lo que se acaba primero y no cuenta los dados de baja", () => {
    const r = resumenInventario(
      items,
      [{ expirationDate: "2026-10-01" }, { expirationDate: "2026-11-15" }],
      "2026-10-27",
    );
    expect(r.bajoMinimo.map((i) => i.id)).toEqual(["b", "a"]);
    expect(r.sinAlerta).toBe(1);
    expect(r.enOrden).toBe(1);
    expect(r.lotesVencidos).toBe(1);
    expect(r.lotesPorVencer).toBe(1);
  });
  it("filtra por los chips", () => {
    expect(filtrarInsumos(items, "bajo-minimo").map((i) => i.id)).toEqual(["a", "b", "e"]);
    expect(filtrarInsumos(items, "sin-alerta").map((i) => i.id)).toEqual(["d"]);
    expect(filtrarInsumos(items, "todos")).toHaveLength(5);
  });
});

describe("serie de caja", () => {
  it("rellena los días sin cobros hasta 31 días", () => {
    const { porSemana, puntos } = serieDeCaja(
      [{ date: "2026-10-03", totalCents: 500 }],
      "2026-10-01",
      "2026-10-05",
    );
    expect(porSemana).toBe(false);
    expect(puntos.map((p) => p.totalCents)).toEqual([0, 0, 500, 0, 0]);
  });
  it("agrupa por semana (lunes) en rangos largos sin perder plata", () => {
    const byDay = [
      { date: "2026-08-03", totalCents: 100 }, // lunes
      { date: "2026-08-09", totalCents: 50 }, // domingo, misma semana
      { date: "2026-10-27", totalCents: 7 },
    ];
    const { porSemana, puntos } = serieDeCaja(byDay, "2026-07-30", "2026-10-27");
    expect(porSemana).toBe(true);
    expect(puntos[0].date).toBe("2026-07-27");
    expect(puntos.find((p) => p.date === "2026-08-03")?.totalCents).toBe(150);
    expect(puntos.reduce((s, p) => s + p.totalCents, 0)).toBe(157);
  });
});
