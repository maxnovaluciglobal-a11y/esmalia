// Ficha A+ (26-oct-2026): encabezado editorial, lectura SOAP y presupuesto
// por fases. Lógica pura: no toca Postgres.
import { describe, expect, it } from "vitest";

import { separarSoap } from "@/lib/clinical/soap";
import {
  porcentajePagado,
  presupuestoAbierto,
  presupuestoDesdePlan,
  type ItemPlanFicha,
} from "@/lib/finance/presupuesto-ficha";
import { enmascararDocumento, partirNombre } from "@/lib/patients/encabezado-ficha";

describe("partirNombre", () => {
  it("primer nombre en redonda, el resto aparte", () => {
    expect(partirNombre("Martina Soto Pérez")).toEqual({ primero: "Martina", resto: "Soto Pérez" });
    expect(partirNombre("  Agustín   Morales Peña ")).toEqual({
      primero: "Agustín",
      resto: "Morales Peña",
    });
  });
  it("una sola palabra no tiene segunda parte", () => {
    expect(partirNombre("Cher")).toEqual({ primero: "Cher", resto: "" });
    expect(partirNombre("")).toEqual({ primero: "", resto: "" });
  });
});

describe("enmascararDocumento", () => {
  it("deja a la vista los tres últimos dígitos y el verificador", () => {
    expect(enmascararDocumento("15.789.012-3")).toBe("••.•••.012-3");
    expect(enmascararDocumento("16482412-K")).toBe("•••••412-K");
  });
  it("un documento corto o vacío no se enmascara", () => {
    expect(enmascararDocumento("1234")).toBe("1234");
    expect(enmascararDocumento("  ")).toBe("");
  });
});

describe("separarSoap", () => {
  it("lee S, O, A y P con dos puntos o paréntesis", () => {
    const nota = [
      "S: Dolor al frío en 36.",
      "O) Caries oclusal profunda.",
      "- Percusión (+).",
      "A: Pulpitis irreversible.",
      "P: Endodoncia en dos sesiones.",
    ].join("\n");
    expect(separarSoap(nota)).toEqual([
      { letra: "S", texto: "Dolor al frío en 36." },
      { letra: "O", texto: "Caries oclusal profunda.\n- Percusión (+)." },
      { letra: "A", texto: "Pulpitis irreversible." },
      { letra: "P", texto: "Endodoncia en dos sesiones." },
    ]);
  });
  it("una nota libre, incompleta o con texto antes de la S no se estructura", () => {
    expect(separarSoap("Control sin novedades.")).toBeNull();
    expect(separarSoap("S: algo\nO: algo\nA: algo")).toBeNull();
    expect(separarSoap("Motivo: control\nS: a\nO: b\nA: c\nP: d")).toBeNull();
  });
  it("una letra fuera de orden queda dentro de la sección anterior", () => {
    const res = separarSoap("S: a\nP: no es el plan todavía\nO: b\nA: c\nP: d");
    expect(res?.[0].texto).toBe("a\nP: no es el plan todavía");
    expect(res?.[3].texto).toBe("d");
  });
});

function item(id: string, extra: Partial<ItemPlanFicha> = {}): ItemPlanFicha {
  return {
    id,
    toothNumber: null,
    nameSnapshot: id,
    status: "pending",
    priceCents: 100,
    patientCents: null,
    phaseLabel: null,
    phasePosition: 0,
    position: 0,
    ...extra,
  };
}

describe("presupuestoDesdePlan", () => {
  const plan = { id: "plan", name: "Plan", currency: "CLP", startedAt: "2026-10-02" };

  it("agrupa por fase, suma lo pagado por línea y calcula el saldo", () => {
    const res = presupuestoDesdePlan({
      plan,
      numero: "P-0412",
      items: [
        item("endo", {
          phaseLabel: "Fase 1",
          phasePosition: 1,
          priceCents: 240000,
          status: "in_progress",
        }),
        item("obt", { phaseLabel: "Fase 1", phasePosition: 1, priceCents: 45000, position: 1 }),
        item("corona", { phaseLabel: "Fase 2", phasePosition: 2, priceCents: 380000 }),
      ],
      pagos: [
        { amountCents: 190000, treatmentItemId: "endo", treatmentPlanId: "plan", reversed: false },
        { amountCents: 50000, treatmentItemId: "obt", treatmentPlanId: "plan", reversed: true },
      ],
    });
    expect(res.numero).toBe("P-0412");
    expect(res.fases.map((f) => [f.label, f.subtotalCents, f.pagadoCents, f.estado])).toEqual([
      ["Fase 1", 285000, 190000, "en_curso"],
      ["Fase 2", 380000, 0, "pendiente"],
    ]);
    expect(res.totalCents).toBe(665000);
    expect(res.pagadoCents).toBe(190000);
    expect(res.saldoCents).toBe(475000);
  });

  it("con convenio cuenta lo que paga el paciente y omite lo saltado", () => {
    const res = presupuestoDesdePlan({
      plan,
      numero: null,
      items: [
        item("a", { priceCents: 1000, patientCents: 300, status: "completed" }),
        item("b", { priceCents: 500, status: "skipped" }),
      ],
      pagos: [{ amountCents: 900, treatmentItemId: "a", treatmentPlanId: "plan", reversed: false }],
    });
    expect(res.totalCents).toBe(300);
    // Lo imputado de más a una línea no infla lo pagado del plan.
    expect(res.pagadoCents).toBe(300);
    expect(res.saldoCents).toBe(0);
    expect(res.fases[0].estado).toBe("completada");
  });

  it("los pagos al plan sin línea suman al total pagado", () => {
    const res = presupuestoDesdePlan({
      plan,
      numero: null,
      items: [item("a", { priceCents: 1000 })],
      pagos: [
        { amountCents: 400, treatmentItemId: null, treatmentPlanId: "plan", reversed: false },
        { amountCents: 999, treatmentItemId: null, treatmentPlanId: "otro", reversed: false },
      ],
    });
    expect(res.pagadoCents).toBe(400);
    expect(res.saldoCents).toBe(600);
  });

  it("los pagos a cuenta suman solo si el paciente tiene un único plan", () => {
    const base = {
      plan,
      numero: null,
      items: [item("a", { priceCents: 1000 })],
      pagos: [{ amountCents: 300, treatmentItemId: null, treatmentPlanId: null, reversed: false }],
    };
    expect(presupuestoDesdePlan(base).pagadoCents).toBe(0);
    expect(presupuestoDesdePlan({ ...base, pagosACuentaDelPlan: true }).pagadoCents).toBe(300);
  });
});

describe("presupuestoAbierto", () => {
  it("las líneas rechazadas no suman y todo queda por aceptar", () => {
    const res = presupuestoAbierto({
      quote: { number: "DEMO-0005", status: "sent", currency: "CLP", createdAt: "2026-10-26" },
      items: [
        {
          id: "x",
          toothNumber: 36,
          nameSnapshot: "Corona",
          totalCents: 250000,
          patientCents: null,
          phaseLabel: null,
          phasePosition: 0,
          position: 0,
          accepted: null,
        },
        {
          id: "y",
          toothNumber: 14,
          nameSnapshot: "Resina",
          totalCents: 48000,
          patientCents: null,
          phaseLabel: null,
          phasePosition: 0,
          position: 1,
          accepted: false,
        },
      ],
    });
    expect(res.totalCents).toBe(250000);
    expect(res.saldoCents).toBe(250000);
    expect(res.fases[0].estado).toBe("por_aceptar");
  });
});

describe("porcentajePagado", () => {
  it("se acota entre 0 y 100", () => {
    expect(porcentajePagado(190000, 380000)).toBe(50);
    expect(porcentajePagado(5, 0)).toBe(0);
    expect(porcentajePagado(500, 100)).toBe(100);
  });
});
