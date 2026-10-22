// /presupuestos (UX-13 de la Ola 0, UX-16 de la Ola 3): estado, pestañas,
// montos, embudo, seguimiento y filtro por profesional. Lógica pura.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  contarPorFiltro,
  embudo,
  estadoDe,
  filtrarPresupuestos,
  leerFiltroEstado,
  montoDe,
  resumenPorFiltro,
  seguimientoAtrasado,
  ultimoContacto,
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
    acceptedTotalCents: null,
    createdAt: "2026-10-01T12:00:00Z",
    sentAt: null,
    validUntil: null,
    acceptedAt: null,
    rejectedAt: null,
    patientId: "pac",
    patientName: "Isidora Fuentes León",
    professionalId: null,
    professionalName: null,
    planStatus: null,
    ultimoContactoAt: null,
    proximaAccion: null,
    proximaAccionOn: null,
    ...over,
  };
}

describe("estado del presupuesto en la lista", () => {
  it("emitido o borrador con validez vencida se ve como vencido", () => {
    expect(estadoDe(p({ status: "sent", validUntil: "2026-10-20" }), HOY)).toBe("vencido");
    expect(estadoDe(p({ status: "draft", validUntil: "2026-10-01" }), HOY)).toBe("vencido");
  });

  it("el día de vencimiento todavía vale", () => {
    expect(estadoDe(p({ status: "sent", validUntil: HOY }), HOY)).toBe("emitido");
  });

  it("convertido se ve aceptado, y finalizado si el plan terminó", () => {
    expect(estadoDe(p({ status: "converted" }), HOY)).toBe("aceptado");
    expect(estadoDe(p({ status: "converted", planStatus: "completed" }), HOY)).toBe("finalizado");
    expect(estadoDe(p({ status: "partially_accepted" }), HOY)).toBe("aceptado_parcial");
  });
});

describe("pestañas y montos", () => {
  const lista = [
    p({ id: "1", status: "draft" }),
    p({ id: "2", status: "sent", validUntil: "2026-12-01", patientName: "Agustín Morales" }),
    p({ id: "3", status: "sent", validUntil: "2026-09-01" }),
    p({ id: "4", status: "accepted", acceptedTotalCents: 100_000 }),
    p({ id: "5", status: "converted", number: "P-2026-0099", acceptedTotalCents: 100_000 }),
    p({ id: "6", status: "rejected" }),
    p({ id: "7", status: "sent", validUntil: "2026-10-25", professionalId: "dra" }),
    p({ id: "8", status: "partially_accepted", totalCents: 300_000, acceptedTotalCents: 120_000 }),
  ];

  it("cuenta cada pestaña; por vencer es un subconjunto de pendientes", () => {
    expect(contarPorFiltro(lista, HOY)).toEqual({
      pendientes: 3,
      por_vencer: 1,
      aceptados: 3,
      rechazados: 1,
      vencidos: 1,
      todos: 8,
    });
  });

  it("en aceptados suma lo aceptado, no el total del presupuesto", () => {
    const r = resumenPorFiltro(lista, HOY);
    expect(r.aceptados.montoCents).toBe(100_000 + 100_000 + 120_000);
    expect(montoDe(lista[7])).toBe(120_000);
    expect(montoDe(lista[1])).toBe(100_000);
  });

  it("filtra por estado, profesional y busca por paciente o número, sin tildes", () => {
    const ids = (
      estado: Parameters<typeof filtrarPresupuestos>[1]["estado"],
      termino = "",
      profesional = "todos",
    ) => filtrarPresupuestos(lista, { estado, termino, hoy: HOY, profesional }).map((x) => x.id);
    expect(ids("pendientes")).toEqual(["1", "2", "7"]);
    expect(ids("por_vencer")).toEqual(["7"]);
    expect(ids("vencidos")).toEqual(["3"]);
    expect(ids("todos", "agustin")).toEqual(["2"]);
    expect(ids("aceptados", "0099")).toEqual(["5"]);
    expect(ids("pendientes", "", "dra")).toEqual(["7"]);
    expect(ids("pendientes", "", "sin_asignar")).toEqual(["1", "2"]);
  });

  it("sin nada en la URL abre la lista de trabajo (pendientes)", () => {
    expect(leerFiltroEstado("por_vencer")).toBe("por_vencer");
    expect(leerFiltroEstado("nada")).toBe("pendientes");
    expect(leerFiltroEstado(undefined)).toBe("pendientes");
  });
});

describe("embudo", () => {
  it("creados → emitidos → aceptados, con la tasa sobre lo emitido", () => {
    const f = embudo([
      p({ id: "1", status: "draft" }),
      p({ id: "2", status: "sent", sentAt: "2026-10-02T10:00:00Z" }),
      p({ id: "3", status: "converted", acceptedTotalCents: 100_000 }),
      p({ id: "4", status: "partially_accepted", acceptedTotalCents: 40_000 }),
      p({ id: "5", status: "rejected" }),
    ]);
    expect(f.creados).toEqual({ cantidad: 5, montoCents: 500_000 });
    expect(f.emitidos.cantidad).toBe(4);
    expect(f.aceptados).toEqual({ cantidad: 2, montoCents: 140_000 });
    expect(f.tasaAceptacion).toBe(50);
  });

  it("sin nada emitido la tasa es null, no 0 % (regla 11)", () => {
    expect(embudo([p({ status: "draft" })]).tasaAceptacion).toBeNull();
    expect(embudo([]).tasaAceptacion).toBeNull();
  });
});

describe("seguimiento", () => {
  it("la próxima acción está atrasada si su fecha ya pasó", () => {
    expect(seguimientoAtrasado(p({ proximaAccionOn: "2026-10-20" }), HOY)).toBe(true);
    expect(seguimientoAtrasado(p({ proximaAccionOn: HOY }), HOY)).toBe(false);
    expect(seguimientoAtrasado(p({}), HOY)).toBe(false);
  });

  it("el último contacto es el más reciente entre el manual y los mensajes", () => {
    expect(ultimoContacto("2026-10-01T10:00:00+00:00", "2026-10-05T10:00:00+00:00")).toBe(
      "2026-10-05T10:00:00+00:00",
    );
    expect(ultimoContacto(null, undefined)).toBeNull();
  });
});

describe("par de permiso en el servidor (regla 15)", () => {
  it("la lista exige finance:view en la ruta y en la server function", () => {
    const ruta = readFileSync("src/routes/_authenticated/_clinic/presupuestos.index.tsx", "utf8");
    const fn = readFileSync("src/lib/finance/presupuestos.functions.ts", "utf8");
    expect(ruta).toContain('beforeLoad: requirePermission("finance:view")');
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain("await requireFinanceViewRole(");
  });

  it("el detalle exige finance:view o patients:manage en la ruta y en el servidor", () => {
    const ruta = readFileSync(
      "src/routes/_authenticated/_clinic/presupuestos.$presupuestoId.tsx",
      "utf8",
    );
    const fn = readFileSync("src/lib/finance/presupuestos.functions.ts", "utf8");
    expect(ruta).toContain('requireAnyPermission("finance:view", "patients:manage")');
    expect(fn).toMatch(
      /requireAlgunPermiso\(supabase, data\.clinicId, userId, \[\s*"finance:view",\s*"patients:manage",?\s*\]/,
    );
  });
});
