// Reglas del odontograma multi-condición (auditoría 360: CLI-01, CLI-02,
// CLI-03, CLI-04). Lógica pura: no toca Postgres. La última sección lee el
// archivo de la migración como texto para comprobar que la base y la app
// usan el mismo catálogo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CONDITION_CATALOG,
  TOOTH_CONDITIONS,
  WHOLE_TOOTH_CONDITIONS,
  type MarkStatus,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  REHABILITA_AUSENCIA,
  colorDeMarca,
  condicionesDisponibles,
  denticionPorEdad,
  marcaParaPintar,
  marcasQueReemplaza,
  superficiesPermitidas,
  validarMarca,
  type MarcaRegla,
} from "@/lib/clinical/odontograma-reglas";

let secuencia = 0;
function vigente(
  condition: ToothCondition,
  surface: ToothSurface = "whole",
  status: MarkStatus = "existente",
  toothNumber = 46,
): MarcaRegla {
  secuencia += 1;
  return {
    id: `m${secuencia}-${condition}-${surface}-${status}`,
    toothNumber,
    surface,
    condition,
    status,
  };
}

function nueva(
  condition: ToothCondition,
  surface: ToothSurface = "whole",
  status: MarkStatus = "existente",
  toothNumber = 46,
) {
  return { toothNumber, surface, condition, status };
}

describe("reemplazo de marcas (CLI-01)", () => {
  it("endodoncia y corona conviven en la misma pieza", () => {
    const endo = vigente("endodoncia");
    expect(marcasQueReemplaza([endo], nueva("corona"))).toEqual([]);
  });

  it("caries en dos superficies y una obturación en otra conviven", () => {
    const marcas = [vigente("caries", "oclusal"), vigente("caries", "distal")];
    expect(marcasQueReemplaza(marcas, nueva("obturacion", "mesial"))).toEqual([]);
  });

  it("la misma condición en la misma zona se reemplaza (retratamiento)", () => {
    const endo = vigente("endodoncia");
    expect(marcasQueReemplaza([endo], nueva("endodoncia"))).toEqual([endo.id]);
  });

  it("la obturación de una cara reemplaza a la caries de esa cara, no a las otras", () => {
    const o = vigente("caries", "oclusal");
    const d = vigente("caries", "distal");
    expect(marcasQueReemplaza([o, d], nueva("obturacion", "oclusal"))).toEqual([o.id]);
  });

  it("solo toca la pieza de la marca nueva", () => {
    const otra = vigente("endodoncia", "whole", "existente", 36);
    expect(marcasQueReemplaza([otra], nueva("endodoncia"))).toEqual([]);
  });

  it("ignora marcas ya reemplazadas y a la propia marca", () => {
    const vieja = { ...vigente("corona"), supersededAt: "2026-10-01T00:00:00Z" };
    const propia = vigente("corona");
    expect(marcasQueReemplaza([vieja, propia], { ...nueva("corona"), id: propia.id })).toEqual([]);
  });

  it("lo existente y lo planificado del mismo grupo conviven", () => {
    const caries = vigente("caries", "oclusal");
    expect(marcasQueReemplaza([caries], nueva("obturacion", "oclusal", "planificado"))).toEqual([]);
  });

  it("al hacerse lo planificado se cierra el plan y lo que trató", () => {
    const caries = vigente("caries", "oclusal");
    const plan = vigente("obturacion", "oclusal", "planificado");
    expect(marcasQueReemplaza([caries, plan], nueva("obturacion", "oclusal"))).toEqual(
      [caries.id, plan.id].sort(),
    );
  });

  it("un plan nuevo del mismo grupo reemplaza al plan anterior", () => {
    const plan = vigente("obturacion", "oclusal", "planificado");
    expect(marcasQueReemplaza([plan], nueva("incrustacion", "oclusal", "planificado"))).toEqual([
      plan.id,
    ]);
  });

  it("una corona existente no cierra una corona planificada de otra condición", () => {
    const planEndo = vigente("endodoncia", "whole", "planificado");
    expect(marcasQueReemplaza([planEndo], nueva("corona"))).toEqual([]);
  });

  it("implante reemplaza a ausente (mismo grupo presencia) y un implante planificado convive con ausente", () => {
    const aus = vigente("ausente");
    expect(marcasQueReemplaza([aus], nueva("implante"))).toEqual([aus.id]);
    expect(marcasQueReemplaza([aus], nueva("implante", "whole", "planificado"))).toEqual([]);
  });

  it("restos radiculares → extracción indicada → ausente se van reemplazando", () => {
    const rr = vigente("restos_radiculares");
    expect(marcasQueReemplaza([rr], nueva("extraccion_indicada"))).toEqual([rr.id]);
    const ex = vigente("extraccion_indicada");
    expect(marcasQueReemplaza([ex], nueva("ausente"))).toEqual([ex.id]);
  });

  it("ausente cierra todo lo de la pieza salvo lo que rehabilita la ausencia", () => {
    const endo = vigente("endodoncia");
    const corona = vigente("corona");
    const caries = vigente("caries", "mesial");
    const planObt = vigente("obturacion", "oclusal", "planificado");
    const implanteExistente = vigente("implante");
    const planImplante = vigente("implante", "whole", "planificado");
    const puente = vigente("puente");
    const protesis = vigente("protesis");
    const res = marcasQueReemplaza(
      [endo, corona, caries, planObt, implanteExistente, planImplante, puente, protesis],
      nueva("ausente"),
    );
    expect(res).toEqual([endo.id, corona.id, caries.id, planObt.id, implanteExistente.id].sort());
  });

  it("sano en una superficie limpia solo esa superficie", () => {
    const o = vigente("caries", "oclusal");
    const m = vigente("caries", "mesial");
    const endo = vigente("endodoncia");
    expect(marcasQueReemplaza([o, m, endo], nueva("sano", "oclusal"))).toEqual([o.id]);
  });

  it("sano en la pieza completa limpia toda la pieza", () => {
    const marcas = [
      vigente("caries", "oclusal"),
      vigente("endodoncia"),
      vigente("corona", "whole", "planificado"),
    ];
    expect(marcasQueReemplaza(marcas, nueva("sano"))).toEqual(marcas.map((m) => m.id).sort());
  });

  it("cualquier marca cierra el sano de su superficie o de la pieza, no el de otra cara", () => {
    const sanoO = vigente("sano", "oclusal");
    const sanoV = vigente("sano", "vestibular");
    const sanoPieza = vigente("sano");
    expect(marcasQueReemplaza([sanoO, sanoV, sanoPieza], nueva("caries", "oclusal"))).toEqual(
      [sanoO.id, sanoPieza.id].sort(),
    );
  });

  it("una endodoncia de pieza cierra la que la regla vieja dejó en una superficie", () => {
    const legado = vigente("endodoncia", "mesial");
    expect(marcasQueReemplaza([legado], nueva("endodoncia"))).toEqual([legado.id]);
  });

  it("una fractura de la pieza no cierra la fractura de una cara", () => {
    const cara = vigente("fractura", "mesial");
    expect(marcasQueReemplaza([cara], nueva("fractura"))).toEqual([]);
  });
});

describe("validación por alcance y estado (CLI-01, CLI-02)", () => {
  it("endodoncia, corona, implante, ausente y extracción indicada son de pieza completa", () => {
    for (const c of [
      "endodoncia",
      "corona",
      "implante",
      "ausente",
      "extraccion_indicada",
    ] as const) {
      expect(WHOLE_TOOTH_CONDITIONS).toContain(c);
      expect(superficiesPermitidas(c)).toEqual(["whole"]);
      expect(validarMarca(nueva(c, "mesial"))).toMatch(/pieza completa/);
      expect(validarMarca(nueva(c, "whole"))).toBeNull();
    }
  });

  it("la caries va en una superficie, no en la pieza completa", () => {
    expect(validarMarca(nueva("caries", "whole"))).toMatch(/superficie/);
    expect(validarMarca(nueva("caries", "oclusal"))).toBeNull();
  });

  it("superficies restringidas: diastema mesial/distal, carilla vestibular, fosas y fisuras oclusal", () => {
    expect(validarMarca(nueva("diastema", "mesial"))).toBeNull();
    expect(validarMarca(nueva("diastema", "oclusal"))).not.toBeNull();
    expect(validarMarca(nueva("carilla", "vestibular"))).toBeNull();
    expect(validarMarca(nueva("carilla", "lingual"))).not.toBeNull();
    expect(validarMarca(nueva("fosas_fisuras_profundas", "oclusal"))).toBeNull();
    expect(validarMarca(nueva("fosas_fisuras_profundas", "mesial"))).not.toBeNull();
  });

  it("la fractura vale en una cara o en la pieza completa", () => {
    expect(validarMarca(nueva("fractura", "mesial"))).toBeNull();
    expect(validarMarca(nueva("fractura", "whole"))).toBeNull();
  });

  it("solo un tratamiento puede quedar por realizar", () => {
    expect(validarMarca(nueva("corona", "whole", "planificado"))).toBeNull();
    expect(validarMarca(nueva("caries", "oclusal", "planificado"))).toMatch(/por realizar/);
    expect(validarMarca(nueva("ausente", "whole", "planificado"))).toMatch(/por realizar/);
  });

  it("bueno/malo solo en un tratamiento existente", () => {
    expect(validarMarca({ ...nueva("corona"), conservation: "malo" })).toBeNull();
    expect(validarMarca({ ...nueva("caries", "oclusal"), conservation: "malo" })).not.toBeNull();
    expect(
      validarMarca({ ...nueva("corona", "whole", "planificado"), conservation: "bueno" }),
    ).not.toBeNull();
  });

  it("el popover ofrece solo lo que se puede guardar", () => {
    const pieza = condicionesDisponibles("whole", "existente");
    expect(pieza).toContain("endodoncia");
    expect(pieza).toContain("fractura");
    expect(pieza).not.toContain("caries");
    const cara = condicionesDisponibles("oclusal", "existente");
    expect(cara).toContain("caries");
    expect(cara).not.toContain("corona");
    expect(cara).not.toContain("diastema");
    const plan = condicionesDisponibles("whole", "planificado");
    expect(plan.every((c) => CONDITION_CATALOG[c].categoria === "tratamiento")).toBe(true);
    for (const surface of ["whole", "mesial", "oclusal", "vestibular"] as const) {
      for (const status of ["existente", "planificado"] as const) {
        for (const c of condicionesDisponibles(surface, status)) {
          expect(validarMarca(nueva(c, surface, status)), `${c}/${surface}/${status}`).toBeNull();
        }
      }
    }
  });
});

describe("simbología rojo/azul (CLI-02)", () => {
  it("existente en buen estado o sin dato: azul", () => {
    expect(colorDeMarca({ condition: "corona", status: "existente", conservation: "bueno" })).toBe(
      "azul",
    );
    expect(colorDeMarca({ condition: "corona", status: "existente", conservation: null })).toBe(
      "azul",
    );
    expect(colorDeMarca({ condition: "ausente", status: "existente" })).toBe("azul");
  });

  it("mal estado, patológico o por realizar: rojo", () => {
    expect(colorDeMarca({ condition: "corona", status: "existente", conservation: "malo" })).toBe(
      "rojo",
    );
    expect(colorDeMarca({ condition: "caries", status: "existente" })).toBe("rojo");
    expect(colorDeMarca({ condition: "extraccion_indicada", status: "existente" })).toBe("rojo");
    expect(colorDeMarca({ condition: "obturacion", status: "planificado" })).toBe("rojo");
  });

  it("sano no tiene color", () => {
    expect(colorDeMarca({ condition: "sano", status: "existente" })).toBe("neutro");
  });

  it("toda condición tiene un color definido y una sigla, salvo sano", () => {
    for (const c of TOOTH_CONDITIONS) {
      expect(["azul", "rojo", "neutro"]).toContain(
        colorDeMarca({ condition: c, status: "existente" }),
      );
      if (c !== "sano") expect(CONDITION_CATALOG[c].sigla, c).not.toBe("");
    }
  });

  it("pinta primero lo existente y, dentro de eso, lo rojo", () => {
    const plan = { condition: "obturacion" as const, status: "planificado" as const };
    const sellante = { condition: "sellante" as const, status: "existente" as const };
    const caries = { condition: "caries" as const, status: "existente" as const };
    expect(marcaParaPintar([plan])).toBe(plan);
    expect(marcaParaPintar([plan, sellante])).toBe(sellante);
    expect(marcaParaPintar([sellante, caries, plan])).toBe(caries);
    expect(
      marcaParaPintar([{ condition: "sano" as const, status: "existente" as const }]),
    ).toBeUndefined();
  });
});

describe("dentición por edad (CLI-04)", () => {
  it("temporal hasta los 5, mixta de 6 a 12, permanente desde los 13", () => {
    expect(denticionPorEdad(3)).toBe("temporal");
    expect(denticionPorEdad(5)).toBe("temporal");
    expect(denticionPorEdad(6)).toBe("mixta");
    expect(denticionPorEdad(12)).toBe("mixta");
    expect(denticionPorEdad(13)).toBe("permanente");
    expect(denticionPorEdad(40)).toBe("permanente");
  });

  it("sin edad conocida abre en permanente", () => {
    expect(denticionPorEdad(null)).toBe("permanente");
    expect(denticionPorEdad(undefined)).toBe("permanente");
    expect(denticionPorEdad(Number.NaN)).toBe("permanente");
  });
});

// ── La base y la app con el mismo catálogo ─────────────────────────────────

const MIGRACION = readFileSync(
  new URL(
    "../supabase/migrations/20261019170000_odontograma_multicondicion_y_estado.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("catálogo de la migración = catálogo de la app", () => {
  it("cada fila del INSERT coincide con CONDITION_CATALOG", () => {
    const filas = [
      ...MIGRACION.matchAll(
        /^\s*\('([a-z_]+)',\s*'([a-z]+)',\s*'([a-z_]+)',\s*'([a-z]+)',\s*(NULL|ARRAY\[[^\]]*\])\)/gm,
      ),
    ];
    expect(filas.map((f) => f[1])).toEqual([...TOOTH_CONDITIONS]);
    for (const [, condition, alcance, grupo, categoria, superficies] of filas) {
      const def = CONDITION_CATALOG[condition as ToothCondition];
      expect({ alcance, grupo, categoria }, condition).toEqual({
        alcance: def.alcance,
        grupo: def.grupo,
        categoria: def.categoria,
      });
      const sql =
        superficies === "NULL"
          ? undefined
          : [...superficies.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
      expect(sql, condition).toEqual(def.superficies);
    }
  });

  it("el enum agrega exactamente las condiciones nuevas, en orden", () => {
    const agregadas = [...MIGRACION.matchAll(/ADD VALUE IF NOT EXISTS '([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(agregadas).toEqual(TOOTH_CONDITIONS.slice(10));
  });

  it("las excepciones de 'ausente' son las mismas en SQL y en TypeScript", () => {
    const m = MIGRACION.match(/m\.condition::text NOT IN \(([^)]+)\)/);
    expect(m).not.toBeNull();
    const sql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(sql).toEqual([...REHABILITA_AUSENCIA].sort());
  });

  it("types.ts lista las mismas condiciones que la app", () => {
    const types = readFileSync(
      new URL("../src/integrations/supabase/types.ts", import.meta.url),
      "utf8",
    );
    const bloque = types.slice(
      types.indexOf("      tooth_condition: ["),
      types.indexOf('      tooth_surface: ["'),
    );
    const enTypes = [...bloque.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(enTypes).toEqual([...TOOTH_CONDITIONS]);
  });
});
