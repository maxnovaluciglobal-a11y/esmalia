import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { alertasDeAlergia, grupoDe } from "@/lib/clinical/recetas";
import {
  estructurarItem,
  interpretarDosis,
  interpretarDuracion,
  interpretarFrecuencia,
  leerItemsGuardados,
} from "@/lib/clinical/receta-estructurada";
import {
  buscarEnVademecum,
  esGrupoFarmacologico,
  esVia,
  etiquetaMedicamento,
  GRUPOS_FARMACOLOGICOS,
  medicamentoBase,
  presentacionDe,
  VADEMECUM_BASE,
  VIAS,
} from "@/lib/clinical/vademecum";

/**
 * MKT-05 · vademécum odontológico y receta estructurada. Puro: sin red ni
 * base. Las dosis del catálogo son sugerencias (las revisa el profesional);
 * acá se vigila que el catálogo esté bien formado y que la posología se
 * interprete igual en el navegador y en el servidor.
 */

const MIGRACION_VADEMECUM = readFileSync(
  new URL("../supabase/migrations/20261025300000_vademecum_de_la_clinica.sql", import.meta.url),
  "utf8",
);
const MIGRACION_RECETA = readFileSync(
  new URL(
    "../supabase/migrations/20261025300100_receta_con_motor_de_documentos.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("vademécum base", () => {
  it("cubre las familias de uso dental y tiene códigos únicos", () => {
    const codigos = VADEMECUM_BASE.map((m) => m.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(VADEMECUM_BASE.length).toBeGreaterThanOrEqual(35);
    const familias = new Set(VADEMECUM_BASE.map((m) => m.grupo));
    for (const g of [
      "penicilinas",
      "cefalosporinas",
      "macrolidos",
      "lincosamidas",
      "nitroimidazoles",
      "aine",
      "analgesicos",
      "corticoides",
      "antisepticos",
      "antifungicos",
      "anestesicos_locales",
    ] as const) {
      expect(familias.has(g), g).toBe(true);
    }
  });

  it("cada ítem tiene vía y familia válidas, ATC bien formado y posología completa", () => {
    for (const m of VADEMECUM_BASE) {
      expect(esVia(m.via), m.codigo).toBe(true);
      expect(m.grupo === null || esGrupoFarmacologico(m.grupo), m.codigo).toBe(true);
      if (m.atc) expect(m.atc, m.codigo).toMatch(/^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$/);
      expect(m.frecuencia.trim(), m.codigo).not.toBe("");
      expect(m.duracion.trim(), m.codigo).not.toBe("");
      expect(m.codigo).toMatch(/^esmalia:[a-z0-9-]+$/);
    }
  });

  it("en pediatría la dosis queda vacía (depende del peso)", () => {
    const pediatricos = VADEMECUM_BASE.filter((m) => /susp|gotas/.test(m.codigo));
    expect(pediatricos.length).toBeGreaterThan(0);
    for (const m of pediatricos.filter((x) => x.codigo !== "esmalia:nistatina-100000-susp")) {
      expect(m.dosis, m.codigo).toBe("");
    }
  });

  it("la posología sugerida de adulto se interpreta entera", () => {
    for (const m of VADEMECUM_BASE.filter((x) => x.via === "oral" && x.dosis)) {
      expect(interpretarDosis(m.dosis), m.codigo).not.toBeNull();
      expect(interpretarFrecuencia(m.frecuencia).timing, m.codigo).not.toBeNull();
    }
    for (const m of VADEMECUM_BASE.filter((x) => x.codigo !== "esmalia:omeprazol-20-caps")) {
      expect(interpretarDuracion(m.duracion), m.codigo).not.toBeNull();
    }
  });

  it("vías y familias coinciden con los CHECK de la base", () => {
    for (const v of VIAS) {
      expect(MIGRACION_VADEMECUM).toContain(`'${v}'`);
      expect(MIGRACION_RECETA).toContain(`'${v}'`);
    }
    for (const g of GRUPOS_FARMACOLOGICOS) expect(MIGRACION_VADEMECUM).toContain(`'${g}'`);
  });

  it("arma nombre y presentación", () => {
    const amox = medicamentoBase("esmalia:amoxicilina-500-caps");
    expect(amox).not.toBeNull();
    expect(presentacionDe(amox!)).toBe("500 mg cápsulas");
    expect(etiquetaMedicamento(amox!)).toBe("Amoxicilina 500 mg cápsulas");
    expect(medicamentoBase("esmalia:no-existe")).toBeNull();
    expect(medicamentoBase(null)).toBeNull();
  });
});

describe("búsqueda del autocompletado", () => {
  it("encuentra sin tildes ni mayúsculas, primero lo que empieza igual", () => {
    const r = buscarEnVademecum(VADEMECUM_BASE, "amox");
    expect(r.length).toBeGreaterThan(2);
    expect(r.every((m) => m.principioActivo.startsWith("Amoxicilina"))).toBe(true);
    expect(buscarEnVademecum(VADEMECUM_BASE, "BENZOCAINA")[0]?.principioActivo).toBe("Benzocaína");
    expect(buscarEnVademecum(VADEMECUM_BASE, "clavul")[0]?.principioActivo).toBe(
      "Amoxicilina con ácido clavulánico",
    );
    expect(buscarEnVademecum(VADEMECUM_BASE, "   ")).toEqual([]);
    expect(buscarEnVademecum(VADEMECUM_BASE, "a", 3)).toHaveLength(3);
  });

  it("los de la clínica van antes que los base", () => {
    const propio = {
      ...medicamentoBase("esmalia:ibuprofeno-400-comp")!,
      codigo: "clinica:00000000-0000-0000-0000-000000000001",
      origen: "clinica" as const,
    };
    const r = buscarEnVademecum([...VADEMECUM_BASE, propio], "ibup");
    expect(r[0].codigo).toBe(propio.codigo);
  });
});

describe("posología escrita → estructura", () => {
  it("dosis", () => {
    expect(interpretarDosis("1 cápsula")).toEqual({ value: 1, unit: "cápsula" });
    expect(interpretarDosis("2,5 mL")).toEqual({ value: 2.5, unit: "mL" });
    expect(interpretarDosis("1/2 comprimido")).toEqual({ value: 0.5, unit: "comprimido" });
    expect(interpretarDosis("dos comprimidos")).toEqual({ value: 2, unit: "comprimidos" });
    expect(interpretarDosis("Aplicar en la zona")).toBeNull();
    expect(interpretarDosis("15")).toBeNull();
  });

  it("frecuencia", () => {
    expect(interpretarFrecuencia("cada 8 horas")).toEqual({
      timing: { frequency: 1, period: 8, period_unit: "h" },
      asNeeded: false,
    });
    expect(interpretarFrecuencia("Cada 12 hrs").timing).toEqual({
      frequency: 1,
      period: 12,
      period_unit: "h",
    });
    expect(interpretarFrecuencia("2 veces al día").timing).toEqual({
      frequency: 2,
      period: 1,
      period_unit: "d",
    });
    expect(interpretarFrecuencia("una vez al día").timing).toEqual({
      frequency: 1,
      period: 1,
      period_unit: "d",
    });
    expect(interpretarFrecuencia("cada 8 horas si hay dolor")).toEqual({
      timing: { frequency: 1, period: 8, period_unit: "h" },
      asNeeded: true,
    });
    // "hasta" es un máximo, no un horario.
    expect(interpretarFrecuencia("hasta 4 veces al día").timing).toBeNull();
    expect(interpretarFrecuencia("en la noche").timing).toBeNull();
  });

  it("duración", () => {
    expect(interpretarDuracion("por 7 días")).toEqual({ value: 7, unit: "d" });
    expect(interpretarDuracion("durante 2 semanas")).toEqual({ value: 2, unit: "wk" });
    expect(interpretarDuracion("3 meses")).toEqual({ value: 3, unit: "mo" });
    expect(interpretarDuracion("por un día")).toEqual({ value: 1, unit: "d" });
    expect(interpretarDuracion("mientras dure el dolor")).toBeNull();
  });
});

describe("medicamento que se guarda", () => {
  const amox = medicamentoBase("esmalia:amoxicilina-500-caps")!;
  const entrada = {
    medication: "Amoxicilina",
    presentation: "500 mg cápsulas",
    route: "oral" as const,
    dose: "1 cápsula",
    frequency: "cada 8 horas",
    duration: "por 7 días",
    instructions: "",
    catalog: amox.codigo,
  };

  it("suma lo del vademécum y la posología estructurada, sin vacíos", () => {
    expect(estructurarItem(entrada, amox, grupoDe)).toEqual({
      medication: "Amoxicilina",
      presentation: "500 mg cápsulas",
      route: "oral",
      dose: "1 cápsula",
      frequency: "cada 8 horas",
      duration: "por 7 días",
      catalog: "esmalia:amoxicilina-500-caps",
      ingredient: "Amoxicilina",
      concentration: "500 mg",
      form: "cápsulas",
      atc: "J01CA04",
      group: "penicilinas",
      dose_quantity: { value: 1, unit: "cápsula" },
      timing: { frequency: 1, period: 8, period_unit: "h" },
      duration_value: 7,
      duration_unit: "d",
    });
  });

  it("si el nombre cambió, no usa el ítem del vademécum (pero deduce la familia)", () => {
    const item = estructurarItem({ ...entrada, medication: "Cefadroxilo" }, amox, grupoDe);
    expect(item.catalog).toBeUndefined();
    expect(item.atc).toBeUndefined();
    expect(item.group).toBe("cefalosporinas");
  });

  it("lee lo guardado tolerando claves raras y recetas anteriores", () => {
    const guardado = estructurarItem(entrada, amox, grupoDe);
    expect(leerItemsGuardados([guardado])).toEqual([guardado]);
    expect(
      leerItemsGuardados([
        {
          medication: "Ibuprofeno",
          dose: "1 comprimido",
          frequency: "cada 8 horas",
          duration: "por 3 días",
          route: "intravenosa",
          group: "inventado",
        },
      ]),
    ).toEqual([
      {
        medication: "Ibuprofeno",
        dose: "1 comprimido",
        frequency: "cada 8 horas",
        duration: "por 3 días",
      },
    ]);
    expect(leerItemsGuardados("no es un arreglo")).toEqual([]);
  });
});

describe("aviso de alergias por familia (MKT-05)", () => {
  it("usa la familia del vademécum cuando viene", () => {
    expect(alertasDeAlergia("Mi colutorio", ["clorhexidina"], "antisepticos")).toHaveLength(1);
    expect(alertasDeAlergia("Benzocaína", ["anestesia local"])[0]).toContain("anestésicos locales");
    expect(alertasDeAlergia("Tramadol", ["codeína"])[0]).toContain("opioides");
    expect(alertasDeAlergia("Omeprazol", ["lansoprazol"])[0]).toContain("gastroprotectores");
  });

  it("no confunde sales ni formas farmacéuticas con el principio activo", () => {
    expect(alertasDeAlergia("Metamizol sódico", ["Diclofenaco sódico"])).toEqual([]);
    expect(alertasDeAlergia("Nistatina suspensión", ["Ibuprofeno suspensión"])).toEqual([]);
    expect(alertasDeAlergia("Paracetamol", ["tramadol"])).toEqual([]);
    expect(alertasDeAlergia("Fluoruro de sodio", ["fluoroquinolonas"])).toEqual([]);
  });

  it("el látex no choca con ningún medicamento del vademécum", () => {
    for (const m of VADEMECUM_BASE) {
      expect(alertasDeAlergia(m.principioActivo, ["Látex"], m.grupo), m.codigo).toEqual([]);
    }
  });

  it("penicilinas: toda la familia y la reacción cruzada con cefalosporinas", () => {
    for (const m of VADEMECUM_BASE.filter((x) => x.grupo === "penicilinas")) {
      expect(alertasDeAlergia(m.principioActivo, ["Penicilina"], m.grupo), m.codigo).toHaveLength(
        1,
      );
    }
    expect(
      alertasDeAlergia("Cefalexina", ["alergia a la penicilina"], "cefalosporinas")[0],
    ).toContain("reacción cruzada");
  });

  it("AINE: toda la familia avisa ante 'AINEs' o 'aspirina'", () => {
    for (const m of VADEMECUM_BASE.filter((x) => x.grupo === "aine")) {
      expect(alertasDeAlergia(m.principioActivo, ["AINEs"], m.grupo), m.codigo).toHaveLength(1);
      expect(alertasDeAlergia(m.principioActivo, ["aspirina"], m.grupo), m.codigo).toHaveLength(1);
    }
  });
});
