import { describe, expect, it } from "vitest";

import { calcularTotalesDePresupuesto } from "@/lib/finance/calculo-presupuesto";
import {
  candidatoDeEmpresa,
  candidatoDeMembresia,
  descuentoComercialDe,
  elegirMejor,
  estadoDelRastro,
  valorDelCandidato,
  type EmpresaParaDescuento,
  type MembresiaParaDescuento,
} from "@/lib/finance/descuento-afiliacion";

/**
 * Cierre · ítem 2: el descuento de empresa con convenio o de membresía se
 * propone al presupuestar como descuento comercial, visible, editable y con
 * su origen guardado. Lógica pura.
 */

const empresa = (parcial: Partial<EmpresaParaDescuento> = {}): EmpresaParaDescuento => ({
  id: "emp-1",
  name: "Constructora Andes",
  active: true,
  discountKind: "percent",
  discountPercent: 15,
  discountCents: null,
  currency: "CLP",
  ...parcial,
});

const membresia = (parcial: Partial<MembresiaParaDescuento> = {}): MembresiaParaDescuento => ({
  planId: "plan-1",
  planName: "Plan Sonrisa",
  status: "active",
  startsOn: "2026-08-01",
  endsOn: null,
  treatmentDiscountPercent: 10,
  ...parcial,
});

const HOY = "2026-10-27";

describe("candidatos de descuento", () => {
  it("la empresa activa con porcentaje o monto propone su descuento", () => {
    expect(candidatoDeEmpresa(empresa())).toMatchObject({
      source: "empresa",
      sourceId: "emp-1",
      kind: "percent",
      percent: 15,
      rule: "15 % de descuento",
    });
    const monto = candidatoDeEmpresa(
      empresa({ discountKind: "amount", discountPercent: null, discountCents: 500000 }),
    );
    expect(monto).toMatchObject({ kind: "amount", cents: 500000 });
    expect(monto?.rule).toMatch(/de descuento por atención/);
  });

  it("una empresa inactiva, sin descuento o en cero no propone nada", () => {
    expect(candidatoDeEmpresa(empresa({ active: false }))).toBeNull();
    expect(candidatoDeEmpresa(empresa({ discountKind: "none" }))).toBeNull();
    expect(candidatoDeEmpresa(empresa({ discountPercent: 0 }))).toBeNull();
    expect(candidatoDeEmpresa(null)).toBeNull();
  });

  it("la membresía solo descuenta si está activa hoy", () => {
    expect(candidatoDeMembresia(membresia(), HOY)).toMatchObject({
      source: "membresia",
      sourceId: "plan-1",
      percent: 10,
    });
    expect(candidatoDeMembresia(membresia({ status: "paused" }), HOY)).toBeNull();
    expect(candidatoDeMembresia(membresia({ status: "cancelled" }), HOY)).toBeNull();
    expect(candidatoDeMembresia(membresia({ startsOn: "2026-11-01" }), HOY)).toBeNull();
    expect(candidatoDeMembresia(membresia({ endsOn: "2026-09-30" }), HOY)).toBeNull();
    expect(candidatoDeMembresia(membresia({ endsOn: "2026-12-31" }), HOY)).not.toBeNull();
    expect(candidatoDeMembresia(membresia({ treatmentDiscountPercent: null }), HOY)).toBeNull();
    expect(candidatoDeMembresia(membresia({ treatmentDiscountPercent: 0 }), HOY)).toBeNull();
    // Inscripción cuyo plan se borró: no hay de dónde sacar el descuento.
    expect(candidatoDeMembresia(membresia({ planId: null }), HOY)).toBeNull();
  });
});

describe("cuánto descuenta y cuál se propone", () => {
  const pct15 = candidatoDeEmpresa(empresa())!;
  const pct10 = candidatoDeMembresia(membresia(), HOY)!;
  const monto = candidatoDeEmpresa(
    empresa({ discountKind: "amount", discountPercent: null, discountCents: 30000 }),
  )!;

  it("el porcentaje va sobre el subtotal y el monto nunca pasa del subtotal", () => {
    expect(valorDelCandidato(pct15, 100000)).toBe(15000);
    expect(valorDelCandidato(monto, 100000)).toBe(30000);
    expect(valorDelCandidato(monto, 20000)).toBe(20000);
    expect(valorDelCandidato(pct15, 0)).toBe(0);
  });

  it("no se acumulan: se propone el que más le ahorra al paciente", () => {
    expect(elegirMejor([pct15, pct10], 100000)).toBe(pct15);
    expect(elegirMejor([pct10, pct15], 100000)).toBe(pct15);
    // Con un subtotal chico el monto fijo rinde más que el porcentaje.
    expect(elegirMejor([pct15, monto], 100000)).toBe(monto);
    expect(elegirMejor([pct15, monto], 150000)).toBe(monto);
    expect(elegirMejor([pct15, monto], 300000)).toBe(pct15);
    expect(elegirMejor([], 100000)).toBeNull();
  });

  it("sin subtotal todavía (presupuesto vacío) gana el porcentaje, que sigue a las líneas", () => {
    expect(elegirMejor([monto, pct10], 0)).toBe(pct10);
  });

  it("el descuento comercial del diálogo sale del candidato", () => {
    expect(descuentoComercialDe(pct15)).toEqual({ modo: "pct", valor: 15 });
    expect(descuentoComercialDe(monto)).toEqual({ modo: "amount", valor: 30000 });
  });

  it("aplicado al cálculo del presupuesto baja las líneas (no queda solo en el total)", () => {
    const lineas = [
      { quantity: 1, unitPriceCents: 60000, discountCents: 0 },
      { quantity: 2, unitPriceCents: 20000, discountCents: 0 },
    ];
    const d = descuentoComercialDe(pct15);
    const t = calcularTotalesDePresupuesto(lineas, 0, d.valor);
    expect(t.subtotal).toBe(100000);
    expect(t.discountCents).toBe(15000);
    expect(t.total).toBe(85000);
    expect(t.items.reduce((s, it) => s + it.total, 0)).toBe(85000);
  });
});

describe("rastro: ajustado frente a lo propuesto", () => {
  const rastroPct = { percent: 15, amountCents: null };
  const rastroMonto = { percent: null, amountCents: 30000 };

  it("igual a la regla, aunque se le agreguen líneas al presupuesto", () => {
    expect(estadoDelRastro(rastroPct, { subtotalCents: 100000, discountCents: 15000 }).tipo).toBe(
      "igual",
    );
    expect(estadoDelRastro(rastroPct, { subtotalCents: 250000, discountCents: 37500 }).tipo).toBe(
      "igual",
    );
    expect(estadoDelRastro(rastroMonto, { subtotalCents: 100000, discountCents: 30000 }).tipo).toBe(
      "igual",
    );
    // El monto fijo se topa en el subtotal.
    expect(estadoDelRastro(rastroMonto, { subtotalCents: 20000, discountCents: 20000 }).tipo).toBe(
      "igual",
    );
  });

  it("dice 'ajustado' si alguien cambió el descuento y 'quitado' si lo sacó", () => {
    const menor = estadoDelRastro(rastroPct, { subtotalCents: 100000, discountCents: 10000 });
    expect(menor).toMatchObject({ tipo: "menor", texto: "ajustado a la baja" });
    const mayor = estadoDelRastro(rastroPct, { subtotalCents: 100000, discountCents: 20000 });
    expect(mayor).toMatchObject({ tipo: "mayor", texto: "ajustado al alza" });
    const quitado = estadoDelRastro(rastroPct, { subtotalCents: 100000, discountCents: 0 });
    expect(quitado).toMatchObject({ tipo: "quitado" });
  });
});
