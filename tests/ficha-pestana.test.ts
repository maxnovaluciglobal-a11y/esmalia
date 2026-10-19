// Pestaña de la ficha en la URL + resumen del odontograma. Lógica pura: no toca Postgres.
import { describe, expect, it } from "vitest";

import {
  busquedaConPestana,
  parsePestana,
  PESTANAS_FICHA,
  pestanaVisible,
  validarBusquedaFicha,
} from "@/components/ficha-busqueda";
import { piezasConHallazgos } from "@/components/odontograma-hallazgos";
import type { OdontogramMark } from "@/lib/clinical/odontogram";

describe("parsePestana", () => {
  it("acepta las seis pestañas", () => {
    for (const p of PESTANAS_FICHA) expect(parsePestana(p)).toBe(p);
  });

  it("cae a resumen con lo desconocido", () => {
    for (const v of [undefined, null, "", "Finanzas", "pagos", 3, ["notas"]]) {
      expect(parsePestana(v)).toBe("resumen");
    }
  });
});

describe("validarBusquedaFicha", () => {
  it("resumen (default) no aparece en el search", () => {
    expect(validarBusquedaFicha({ pestana: "resumen" })).toEqual({});
    expect(validarBusquedaFicha({ pestana: "cualquiera" })).toEqual({});
  });

  it("conserva la pestaña válida junto a cobrar", () => {
    expect(validarBusquedaFicha({ pestana: "mensajes", cobrar: 1 })).toEqual({
      pestana: "mensajes",
      cobrar: 1,
    });
  });
});

describe("pestanaVisible", () => {
  it("sin clinical:view las pestañas clínicas caen a resumen", () => {
    expect(pestanaVisible("odontograma", false)).toBe("resumen");
    expect(pestanaVisible("notas", false)).toBe("resumen");
    expect(pestanaVisible("documentos", false)).toBe("resumen");
  });

  it("las no clínicas se respetan para cualquier rol", () => {
    expect(pestanaVisible("finanzas", false)).toBe("finanzas");
    expect(pestanaVisible("mensajes", false)).toBe("mensajes");
    expect(pestanaVisible("notas", true)).toBe("notas");
  });
});

describe("busquedaConPestana", () => {
  it("pone la pestaña y descarta cobrar", () => {
    expect(busquedaConPestana({ cobrar: 1 }, "finanzas")).toEqual({ pestana: "finanzas" });
  });

  it("volver a resumen limpia la clave", () => {
    expect(busquedaConPestana({ pestana: "notas" }, "resumen")).toEqual({});
  });
});

function marca(
  toothNumber: number,
  condition: OdontogramMark["condition"],
  extra: Partial<OdontogramMark> = {},
): OdontogramMark {
  return {
    id: `${toothNumber}-${condition}-${extra.surface ?? "whole"}`,
    toothNumber,
    surface: "whole",
    condition,
    status: "existente",
    conservation: null,
    material: null,
    notes: null,
    supersededAt: null,
    recordedAt: "2026-10-01T12:00:00Z",
    recordedById: "u1",
    recordedByName: null,
    ...extra,
  };
}

describe("piezasConHallazgos", () => {
  it("ignora sano y marcas reemplazadas, agrupa por pieza y ordena por FDI", () => {
    const res = piezasConHallazgos([
      marca(36, "caries", { surface: "oclusal" }),
      marca(11, "sano"),
      marca(16, "obturacion", { surface: "mesial" }),
      marca(36, "caries", { surface: "distal" }),
      marca(36, "obturacion", { surface: "mesial" }),
      marca(21, "fractura", { supersededAt: "2026-10-02T00:00:00Z" }),
    ]);
    const existente = (condition: OdontogramMark["condition"]) => ({
      condition,
      status: "existente",
      conservation: null,
    });
    expect(res).toEqual([
      { tooth: 16, condiciones: [existente("obturacion")] },
      { tooth: 36, condiciones: [existente("caries"), existente("obturacion")] },
    ]);
  });

  it("separa lo existente de lo por realizar y avisa el mal estado", () => {
    const res = piezasConHallazgos([
      marca(46, "endodoncia"),
      marca(46, "corona", { conservation: "malo" }),
      marca(46, "corona", { id: "plan", status: "planificado" }),
    ]);
    expect(res).toEqual([
      {
        tooth: 46,
        condiciones: [
          { condition: "endodoncia", status: "existente", conservation: null },
          { condition: "corona", status: "existente", conservation: "malo" },
          { condition: "corona", status: "planificado", conservation: null },
        ],
      },
    ]);
  });

  it("sin marcas no hay hallazgos", () => {
    expect(piezasConHallazgos([])).toEqual([]);
  });
});
