// Ola 3 · Frente Planes: cálculo del presupuesto (PLA-04 secciones, PLA-05
// descuentos en % y dinero, PLA-12 paquetes). Lógica pura: no toca Postgres.
import { describe, expect, it } from "vitest";

import {
  calcularTotalesDePresupuesto,
  lineasDePaquete,
  moverSeccion,
  multiplicarYDividir,
  ordenDeSecciones,
  porcentajeDe,
  posicionesDeSecciones,
  precioDeListaDelPaquete,
  repartirProporcional,
  resolverDescuentoDeLinea,
  resumenDeSecciones,
  totalDeLinea,
  type LineaBase,
} from "@/lib/finance/calculo-presupuesto";

const linea = (over: Partial<LineaBase> & { id?: string } = {}) => ({
  quantity: 1,
  unitPriceCents: 100_000,
  discountCents: 0,
  discountPct: null,
  phaseLabel: null,
  phasePosition: 0,
  ...over,
});

describe("aritmética entera (regla 6)", () => {
  it("redondea half-up sin pasar por floats", () => {
    expect(multiplicarYDividir(1, 1, 2)).toBe(1); // 0,5 → 1
    expect(multiplicarYDividir(1, 1, 3)).toBe(0); // 0,33 → 0
    expect(multiplicarYDividir(2, 1, 3)).toBe(1); // 0,66 → 1
  });

  it("no pierde precisión con montos grandes (más allá de 2^53 en el producto)", () => {
    // 90.000.000.000 × 9.999 ≈ 9e14 y 9.007.199.254.740 × 3.333 ≈ 3e16 (> 2^53):
    // en BigInt el resultado es exacto.
    expect(multiplicarYDividir(90_000_000_000, 9_999, 10_000)).toBe(89_991_000_000);
    expect(porcentajeDe(9_007_199_254_740, 33.33)).toBe(3_002_099_511_605);
  });

  it("un porcentaje con decimales no se corre por el float (1,005 %)", () => {
    // 1,005 × 100 en float es 100,4999…: tiene que contar como 1,01 % (101),
    // que es lo que guarda numeric(5,2), y no como 1,00 %.
    expect(porcentajeDe(200_000, 1.005)).toBe(2_020);
    expect(porcentajeDe(333, 12.5)).toBe(42); // 41,625 → 42
  });

  it("el porcentaje nunca supera el monto ni da negativo", () => {
    expect(porcentajeDe(1_000, 100)).toBe(1_000);
    expect(porcentajeDe(1_000, 0)).toBe(0);
    expect(porcentajeDe(0, 50)).toBe(0);
  });
});

describe("descuento por línea (PLA-05)", () => {
  it("en porcentaje manda sobre los cents y los deriva", () => {
    expect(
      resolverDescuentoDeLinea(linea({ quantity: 2, unitPriceCents: 45_000, discountPct: 10 })),
    ).toEqual({ discountCents: 9_000, discountPct: 10 });
  });

  it("en dinero queda con pct null y nunca supera la línea", () => {
    expect(resolverDescuentoDeLinea(linea({ discountCents: 150_000 }))).toEqual({
      discountCents: 100_000,
      discountPct: null,
    });
    expect(totalDeLinea(linea({ discountCents: 150_000 }))).toBe(0);
  });
});

describe("totales con descuento comercial global", () => {
  it("en % baja a las líneas y la suma cierra exacto con el total", () => {
    const t = calcularTotalesDePresupuesto(
      [
        linea({ unitPriceCents: 33_333 }),
        linea({ unitPriceCents: 33_333 }),
        linea({ unitPriceCents: 33_334 }),
      ],
      0,
      20,
    );
    expect(t.subtotal).toBe(100_000);
    expect(t.discountCents).toBe(20_000);
    expect(t.total).toBe(80_000);
    expect(t.items.reduce((s, it) => s + it.total, 0)).toBe(t.total);
  });

  it("en dinero también se prorratea y respeta el tope del subtotal", () => {
    const t = calcularTotalesDePresupuesto(
      [linea({ unitPriceCents: 20_000 }), linea({ unitPriceCents: 80_000 })],
      10_000,
      null,
    );
    expect(t.items.map((i) => i.total)).toEqual([18_000, 72_000]);
    expect(t.commercialDiscountPct).toBeNull();

    const tope = calcularTotalesDePresupuesto([linea({ unitPriceCents: 5_000 })], 9_000, null);
    expect(tope.discountCents).toBe(5_000);
    expect(tope.total).toBe(0);
  });

  it("combina descuento de línea en % con descuento global en %", () => {
    const t = calcularTotalesDePresupuesto(
      [linea({ unitPriceCents: 50_000, discountPct: 10 }), linea({ unitPriceCents: 55_000 })],
      0,
      5,
    );
    // Subtotal 45.000 + 55.000 = 100.000; global 5 % = 5.000.
    expect(t.subtotal).toBe(100_000);
    expect(t.total).toBe(95_000);
    expect(t.items[0].discountPct).toBe(10);
    expect(t.items[0].discountCents).toBe(5_000);
  });

  it("el resto del prorrateo nunca deja una línea por encima de lo que valía ni en negativo", () => {
    // Antes: el resto iba a la última línea y una línea de $1 podía absorber
    // más de lo que valía y quedar recortada, rompiendo la suma.
    const lineas = [
      linea({ unitPriceCents: 1 }),
      linea({ unitPriceCents: 1 }),
      linea({ unitPriceCents: 1 }),
    ];
    const t = calcularTotalesDePresupuesto(lineas, 2, null);
    expect(t.total).toBe(1);
    expect(t.items.every((i) => i.total >= 0 && i.total <= 1)).toBe(true);
  });

  it("con convenio, la cobertura se calcula sobre la línea ya descontada", () => {
    const cobertura = new Map([["proc-1", { coveragePct: 50, coverageFixedCents: null }]]);
    const t = calcularTotalesDePresupuesto([linea({ procedureId: "proc-1" })], 0, 20, cobertura);
    expect(t.items[0].total).toBe(80_000);
    expect(t.items[0].coverageCents).toBe(40_000);
    expect(t.items[0].patientCents).toBe(40_000);
    expect(t.coverageTotalCents).toBe(40_000);
  });

  it("sin convenio la cobertura es null, no cero (regla 11)", () => {
    const t = calcularTotalesDePresupuesto([linea()], 0, null);
    expect(t.coverageTotalCents).toBeNull();
    expect(t.items[0].coverageCents).toBeNull();
  });
});

describe("secciones (PLA-04)", () => {
  const items = [
    linea({ id: "a", phaseLabel: "Urgencia", unitPriceCents: 10_000 }),
    linea({ id: "b", phaseLabel: null, unitPriceCents: 1_000 }),
    linea({ id: "c", phaseLabel: "Rehabilitación", unitPriceCents: 50_000 }),
    linea({ id: "d", phaseLabel: "Urgencia", unitPriceCents: 5_000, discountPct: 20 }),
  ];

  it("el orden es el de primera aparición, no el alfabético", () => {
    expect(ordenDeSecciones(items)).toEqual(["Urgencia", "Rehabilitación"]);
    expect(posicionesDeSecciones(items).map((i) => i.phasePosition)).toEqual([1, 0, 2, 1]);
  });

  it("subtotal por sección con los descuentos de cada línea", () => {
    expect(resumenDeSecciones(items)).toEqual([
      { label: null, lineas: 1, subtotalCents: 1_000 },
      { label: "Urgencia", lineas: 2, subtotalCents: 14_000 },
      { label: "Rehabilitación", lineas: 1, subtotalCents: 50_000 },
    ]);
  });

  it("mover una sección mueve su bloque entero y deja juntas sus líneas", () => {
    const movidas = moverSeccion(items, "Rehabilitación", -1);
    expect(movidas.map((i) => i.id)).toEqual(["b", "c", "a", "d"]);
    expect(ordenDeSecciones(movidas)).toEqual(["Rehabilitación", "Urgencia"]);
    // En el borde no hace nada.
    expect(moverSeccion(items, "Urgencia", -1).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("la posición dentro de cada sección se numera aparte", () => {
    const t = calcularTotalesDePresupuesto(posicionesDeSecciones(items), 0, null);
    expect(t.items.map((i) => [i.phaseLabel, i.phasePosition, i.position])).toEqual([
      ["Urgencia", 1, 0],
      [null, 0, 0],
      ["Rehabilitación", 2, 0],
      ["Urgencia", 1, 1],
    ]);
  });
});

describe("reparto proporcional", () => {
  it("suma exacto y respeta los pesos", () => {
    expect(repartirProporcional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(repartirProporcional(10, [0, 5, 5])).toEqual([0, 5, 5]);
    expect(repartirProporcional(0, [3, 4])).toEqual([0, 0]);
  });
});

describe("paquetes (PLA-12)", () => {
  const precios = new Map([
    ["limpieza", 30_000],
    ["blanqueamiento", 120_000],
    ["control", 0],
  ]);
  const precioDe = (id: string | null) => (id ? (precios.get(id) ?? 0) : 0);

  it("las líneas suman exactamente el precio del paquete y muestran el ahorro como descuento", () => {
    const paquete = {
      id: "pk",
      name: "Blanqueamiento completo",
      priceCents: 130_000,
      items: [
        { procedureId: "limpieza", nameSnapshot: "Limpieza", quantity: 1 },
        { procedureId: "blanqueamiento", nameSnapshot: "Blanqueamiento", quantity: 1 },
      ],
    };
    const lineas = lineasDePaquete(paquete, precioDe);
    const total = calcularTotalesDePresupuesto(lineas, 0, null).total;
    expect(total).toBe(130_000);
    expect(lineas.map((l) => l.unitPriceCents)).toEqual([30_000, 120_000]);
    expect(lineas.reduce((s, l) => s + l.discountCents, 0)).toBe(20_000);
    expect(lineas.every((l) => l.packageId === "pk")).toBe(true);
    expect(lineas[0].packageNameSnapshot).toBe("Blanqueamiento completo");
    expect(precioDeListaDelPaquete(paquete.items, precioDe)).toBe(150_000);
  });

  it("con cantidades y un precio que no divide redondo, igual cierra exacto", () => {
    const lineas = lineasDePaquete(
      {
        id: "pk",
        name: "Tres coronas",
        priceCents: 1_000_001,
        items: [
          { procedureId: "blanqueamiento", nameSnapshot: "Corona", quantity: 3 },
          { procedureId: "limpieza", nameSnapshot: "Limpieza", quantity: 2 },
        ],
      },
      precioDe,
    );
    expect(calcularTotalesDePresupuesto(lineas, 0, null).total).toBe(1_000_001);
  });

  it("si el arancel bajó y el paquete quedó más caro, sube el precio unitario y cierra exacto", () => {
    const lineas = lineasDePaquete(
      {
        id: "pk",
        name: "Combo",
        priceCents: 100_001,
        items: [{ procedureId: "limpieza", nameSnapshot: "Limpieza", quantity: 3 }],
      },
      precioDe,
    );
    expect(lineas[0].unitPriceCents).toBe(33_334);
    expect(lineas[0].discountCents).toBe(1);
    expect(calcularTotalesDePresupuesto(lineas, 0, null).total).toBe(100_001);
  });

  it("sin precio de lista reparte por cantidad", () => {
    const lineas = lineasDePaquete(
      {
        id: "pk",
        name: "Controles",
        priceCents: 10_000,
        items: [
          { procedureId: "control", nameSnapshot: "Control", quantity: 1 },
          { procedureId: null, nameSnapshot: "Radiografía", quantity: 1 },
        ],
      },
      precioDe,
    );
    expect(lineas.map((l) => totalDeLinea(l))).toEqual([5_000, 5_000]);
  });
});
