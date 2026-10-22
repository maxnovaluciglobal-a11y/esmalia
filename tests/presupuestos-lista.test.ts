// /presupuestos (UX-13, Ola 0): estado visible, filtros y búsqueda.
// Lógica pura: no toca Postgres.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  contarPorFiltro,
  estadoVisible,
  filtrarPresupuestos,
  leerFiltroEstado,
  type PresupuestoDeClinica,
} from "@/lib/finance/presupuestos";

const HOY = "2026-10-21";

function p(over: Partial<PresupuestoDeClinica>): PresupuestoDeClinica {
  return {
    id: over.id ?? "q",
    number: "P-2026-0001",
    status: "sent",
    currency: "CLP",
    totalCents: 100_000,
    createdAt: "2026-10-01T12:00:00Z",
    sentAt: null,
    validUntil: null,
    acceptedAt: null,
    rejectedAt: null,
    patientId: "pac",
    patientName: "Isidora Fuentes León",
    ...over,
  };
}

describe("estado visible del presupuesto", () => {
  it("enviado o borrador con validez vencida se ve como vencido", () => {
    expect(estadoVisible(p({ status: "sent", validUntil: "2026-10-20" }), HOY)).toBe("vencido");
    expect(estadoVisible(p({ status: "draft", validUntil: "2026-10-01" }), HOY)).toBe("vencido");
  });

  it("el día de vencimiento todavía vale", () => {
    expect(estadoVisible(p({ status: "sent", validUntil: HOY }), HOY)).toBe("enviado");
  });

  it("aceptado, convertido y rechazado no vencen", () => {
    expect(estadoVisible(p({ status: "accepted", validUntil: "2026-01-01" }), HOY)).toBe(
      "aceptado",
    );
    expect(estadoVisible(p({ status: "converted" }), HOY)).toBe("convertido");
    expect(estadoVisible(p({ status: "rejected" }), HOY)).toBe("rechazado");
    expect(estadoVisible(p({ status: "expired" }), HOY)).toBe("vencido");
  });
});

describe("filtros de la lista", () => {
  const lista = [
    p({ id: "1", status: "draft" }),
    p({ id: "2", status: "sent", validUntil: "2026-12-01", patientName: "Agustín Morales" }),
    p({ id: "3", status: "sent", validUntil: "2026-09-01" }),
    p({ id: "4", status: "accepted" }),
    p({ id: "5", status: "converted", number: "P-2026-0099" }),
    p({ id: "6", status: "rejected" }),
  ];

  it("cuenta cada filtro", () => {
    expect(contarPorFiltro(lista, HOY)).toEqual({
      todos: 6,
      pendientes: 2,
      aceptados: 2,
      rechazados: 1,
      vencidos: 1,
    });
  });

  it("filtra por estado y busca por paciente o número, sin tildes", () => {
    const ids = (estado: Parameters<typeof filtrarPresupuestos>[1]["estado"], termino = "") =>
      filtrarPresupuestos(lista, { estado, termino, hoy: HOY }).map((x) => x.id);
    expect(ids("pendientes")).toEqual(["1", "2"]);
    expect(ids("vencidos")).toEqual(["3"]);
    expect(ids("todos", "agustin")).toEqual(["2"]);
    expect(ids("aceptados", "0099")).toEqual(["5"]);
  });

  it("un estado desconocido en la URL cae a todos", () => {
    expect(leerFiltroEstado("pendientes")).toBe("pendientes");
    expect(leerFiltroEstado("nada")).toBe("todos");
    expect(leerFiltroEstado(3)).toBe("todos");
  });
});

describe("par de permiso en el servidor (regla 15)", () => {
  it("la lista exige finance:view en la ruta y en la server function", () => {
    const ruta = readFileSync("src/routes/_authenticated/_clinic/presupuestos.tsx", "utf8");
    const fn = readFileSync("src/lib/finance/presupuestos.functions.ts", "utf8");
    expect(ruta).toContain('beforeLoad: requirePermission("finance:view")');
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain("await requireFinanceViewRole(");
  });
});
