// Ola 3 · Frente Planes: estados del plan (PLA-02) y validez (PLA-06).
// Lógica pura: no toca Postgres. El espejo en la base lo prueba
// presupuestos-estados-db.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/finance/finance";
import {
  ESTADOS_PLAN,
  TRANSICIONES,
  accionesDisponibles,
  diasParaVencer,
  estaPorVencer,
  estadoDelPlan,
  motivoTransicionInvalida,
  puedeTransicionar,
  sumarDias,
  textoDeValidez,
  validezPorDefecto,
} from "@/lib/finance/estados-presupuesto";

const HOY = "2026-10-22";

describe("estado visible del plan", () => {
  it("mapea cada valor de la base a uno de los siete estados", () => {
    const casos: [QuoteStatus, string][] = [
      ["draft", "borrador"],
      ["sent", "emitido"],
      ["accepted", "aceptado"],
      ["converted", "aceptado"],
      ["partially_accepted", "aceptado_parcial"],
      ["rejected", "rechazado"],
      ["expired", "vencido"],
    ];
    for (const [status, esperado] of casos) {
      expect(estadoDelPlan({ status, validUntil: null }, HOY)).toBe(esperado);
    }
    expect(ESTADOS_PLAN).toHaveLength(7);
  });

  it("un pendiente con la validez pasada se ve vencido aunque la base no lo marcó", () => {
    expect(estadoDelPlan({ status: "sent", validUntil: "2026-10-21" }, HOY)).toBe("vencido");
    expect(estadoDelPlan({ status: "draft", validUntil: "2026-10-01" }, HOY)).toBe("vencido");
    expect(estadoDelPlan({ status: "sent", validUntil: HOY }, HOY)).toBe("emitido");
  });

  it("aceptado (total o parcial) con el plan terminado es finalizado", () => {
    expect(
      estadoDelPlan({ status: "converted", validUntil: null, planStatus: "completed" }, HOY),
    ).toBe("finalizado");
    expect(
      estadoDelPlan(
        { status: "partially_accepted", validUntil: null, planStatus: "completed" },
        HOY,
      ),
    ).toBe("finalizado");
    expect(
      estadoDelPlan({ status: "converted", validUntil: null, planStatus: "active" }, HOY),
    ).toBe("aceptado");
  });

  it("aceptados y rechazados no vencen", () => {
    expect(estadoDelPlan({ status: "converted", validUntil: "2026-01-01" }, HOY)).toBe("aceptado");
    expect(estadoDelPlan({ status: "rejected", validUntil: "2026-01-01" }, HOY)).toBe("rechazado");
  });
});

describe("transiciones", () => {
  it("cubre todos los valores del enum", () => {
    expect(Object.keys(TRANSICIONES).sort()).toEqual([...QUOTE_STATUSES].sort());
  });

  it("los estados finales no se mueven", () => {
    for (const s of ["accepted", "partially_accepted", "converted", "rejected"] as const) {
      expect(TRANSICIONES[s]).toEqual([]);
      expect(puedeTransicionar(s, "sent")).toBe(false);
      expect(motivoTransicionInvalida(s, "sent")).toMatch(/cerrado/);
    }
  });

  it("borrador y emitido se aceptan (total o parcial), se rechazan o vencen", () => {
    for (const s of ["draft", "sent"] as const) {
      for (const h of ["accepted", "partially_accepted", "rejected", "expired"] as const) {
        expect(puedeTransicionar(s, h)).toBe(true);
      }
    }
    expect(puedeTransicionar("draft", "sent")).toBe(true);
    expect(puedeTransicionar("sent", "draft")).toBe(false);
  });

  it("un vencido solo se renueva (a emitido o borrador)", () => {
    expect(TRANSICIONES.expired).toEqual(["sent", "draft"]);
    expect(puedeTransicionar("expired", "accepted")).toBe(false);
  });

  it("la app nunca pide 'converted': lo pone el trigger", () => {
    for (const s of QUOTE_STATUSES) expect(TRANSICIONES[s]).not.toContain("converted");
  });

  it("el guard de la base tiene exactamente las mismas transiciones", () => {
    const sql = readFileSync(
      "supabase/migrations/20261024200100_planes_estados_validez_y_paquetes.sql",
      "utf8",
    );
    const cuerpo = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.validar_transicion_de_presupuesto()"),
    );
    for (const [desde, hacia] of Object.entries(TRANSICIONES)) {
      if (!hacia.length) continue;
      const lista = hacia.map((h) => `'${h}'`).join(", ");
      expect(cuerpo).toContain(`WHEN '${desde}' THEN NEW.status IN (${lista})`);
    }
  });
});

describe("acciones según el estado", () => {
  it("borrador: emitir, editar, aceptar, aceptar parcial, rechazar", () => {
    expect(accionesDisponibles({ status: "draft", validUntil: null }, HOY)).toEqual([
      "emitir",
      "editar",
      "aceptar",
      "aceptar_parcial",
      "rechazar",
    ]);
  });

  it("un pendiente vencido solo se renueva", () => {
    expect(accionesDisponibles({ status: "sent", validUntil: "2026-10-01" }, HOY)).toEqual([
      "renovar",
    ]);
    expect(accionesDisponibles({ status: "expired", validUntil: "2026-10-01" }, HOY)).toEqual([
      "renovar",
    ]);
  });

  it("cerrados no tienen acciones de estado", () => {
    expect(accionesDisponibles({ status: "converted", validUntil: null }, HOY)).toEqual([]);
    expect(accionesDisponibles({ status: "rejected", validUntil: null }, HOY)).toEqual([]);
  });
});

describe("validez (PLA-06)", () => {
  it("suma días de calendario cruzando meses y años", () => {
    expect(sumarDias("2026-10-22", 30)).toBe("2026-11-21");
    expect(sumarDias("2026-12-15", 30)).toBe("2027-01-14");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("la validez por defecto usa los días de la clínica, o 30", () => {
    expect(validezPorDefecto(HOY, 15)).toBe("2026-11-06");
    expect(validezPorDefecto(HOY, null)).toBe("2026-11-21");
    expect(validezPorDefecto(HOY, 0)).toBe("2026-11-21");
  });

  it("cuenta los días que quedan", () => {
    expect(diasParaVencer("2026-10-22", HOY)).toBe(0);
    expect(diasParaVencer("2026-10-29", HOY)).toBe(7);
    expect(diasParaVencer("2026-10-20", HOY)).toBe(-2);
    expect(diasParaVencer(null, HOY)).toBeNull();
  });

  it("por vencer: pendiente que vence dentro de 7 días, hoy incluido", () => {
    expect(estaPorVencer({ status: "sent", validUntil: "2026-10-29" }, HOY)).toBe(true);
    expect(estaPorVencer({ status: "draft", validUntil: HOY }, HOY)).toBe(true);
    expect(estaPorVencer({ status: "sent", validUntil: "2026-10-30" }, HOY)).toBe(false);
    expect(estaPorVencer({ status: "sent", validUntil: "2026-10-21" }, HOY)).toBe(false);
    expect(estaPorVencer({ status: "converted", validUntil: "2026-10-25" }, HOY)).toBe(false);
    expect(estaPorVencer({ status: "sent", validUntil: null }, HOY)).toBe(false);
  });

  it("textos del aviso en tuteo neutro", () => {
    expect(textoDeValidez(HOY, HOY)).toBe("Vence hoy");
    expect(textoDeValidez("2026-10-23", HOY)).toBe("Vence mañana");
    expect(textoDeValidez("2026-10-25", HOY)).toBe("Vence en 3 días");
    expect(textoDeValidez("2026-10-21", HOY)).toBe("Venció ayer");
    expect(textoDeValidez("2026-10-12", HOY)).toBe("Venció hace 10 días");
    expect(textoDeValidez(null, HOY)).toBeNull();
  });
});
