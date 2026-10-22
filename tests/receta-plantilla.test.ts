import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analizarPlantilla, bloquesATexto, renderPlantilla } from "@/lib/documentos/motor";
import {
  contextoDeReceta,
  RECETA_DE_EJEMPLO,
  SIN_ALERGIAS_ANOTADAS,
  tablaDeReceta,
  textoDeAlergias,
  VARIABLES_RECETA,
} from "@/lib/documentos/receta";
import { leerBloques } from "@/lib/documentos/esquemas";
import { construirContexto, contextoDeEjemplo, VARIABLES } from "@/lib/documentos/variables";
import { esTipoDeDocumento, TIPOS_CON_FLUJO_PROPIO } from "@/lib/documentos/tipos";
import type { DatosParaDocumento } from "@/lib/documentos/variables";

/**
 * MKT-05 · la receta sale del motor de documentos: grupo `receta.*` y la
 * plantilla "Receta" que siembra la migración 20261025300200 (este test lee
 * el SQL, sin base, y valida que se pueda emitir tal cual).
 */

const SQL = readFileSync(
  new URL("../supabase/migrations/20261025300200_plantilla_receta.sql", import.meta.url),
  "utf8",
);
const CUERPO = /v_cuerpo constant text := \$t\$([\s\S]*?)\$t\$;/.exec(SQL)?.[1] ?? "";

const DATOS: DatosParaDocumento = {
  zona: "America/Santiago",
  ahora: "2026-10-22T15:00:00Z",
  moneda: "CLP",
  paciente: {
    nombre: "Ana Pérez Soto",
    tipoDocumento: "rut",
    documento: "123456785",
    fechaNacimiento: "1990-03-04",
    prevision: { plan: null, tramo: null, institucion: null },
    direccion: null,
    comuna: null,
    telefono: null,
    email: null,
  },
  clinica: {
    nombre: "Clínica Dental Sonrisa",
    razonSocial: null,
    rut: null,
    giro: null,
    direccionTributaria: null,
    comunaTributaria: null,
    direccion: null,
    telefono: null,
    tipoBoleta: null,
  },
  profesional: { nombre: "Dra. Carolina Rodríguez", registroSis: "123456", especialidad: null },
  campos: {},
  receta: RECETA_DE_EJEMPLO,
};

describe("variables receta.*", () => {
  it("están en el catálogo del motor, en su grupo", () => {
    for (const v of VARIABLES_RECETA) {
      expect(VARIABLES.find((x) => x.clave === v.clave)?.grupo).toBe("receta");
    }
    expect(VARIABLES.find((x) => x.clave === "receta.medicamentos")?.bloque).toBe(true);
  });

  it("la tabla lleva medicamento, dosis con vía, frecuencia, duración e indicaciones", () => {
    const t = tablaDeReceta(RECETA_DE_EJEMPLO.items);
    expect(t.columnas.map((c) => c.titulo)).toEqual([
      "Medicamento",
      "Dosis y vía",
      "Frecuencia",
      "Duración",
      "Indicaciones",
    ]);
    expect(t.filas[0]).toEqual([
      "Amoxicilina 500 mg cápsulas",
      "1 cápsula, vía oral",
      "cada 8 horas",
      "por 7 días",
      "Completar el tratamiento aunque el dolor pase antes.",
    ]);
    expect(tablaDeReceta([{ ...RECETA_DE_EJEMPLO.items[0], instructions: " " }]).filas[0][4]).toBe(
      "—",
    );
    // La forma de la tabla pasa la validación de lo guardado.
    expect(leerBloques([t])).not.toBeNull();
  });

  it("alergias: sin repetir y sin fabricar un 'no tiene'", () => {
    expect(textoDeAlergias(["Penicilina", "penicilina ", "Látex"])).toBe("Penicilina, Látex");
    expect(textoDeAlergias([])).toBe(SIN_ALERGIAS_ANOTADAS);
    expect(
      contextoDeReceta({ items: [], indicacionesGenerales: "  ", alergias: [] }).valores,
    ).toEqual({
      "receta.indicaciones_generales": "—",
      "receta.alergias": SIN_ALERGIAS_ANOTADAS,
    });
  });

  it("solo hay datos de receta cuando se emite una receta", () => {
    const sin = construirContexto({ ...DATOS, receta: undefined });
    expect(sin.tablas["receta.medicamentos"]).toBeUndefined();
    expect(sin.valores["receta.alergias"]).toBeUndefined();
    const con = construirContexto(DATOS);
    expect(con.tablas["receta.medicamentos"]?.filas).toHaveLength(2);
    expect(con.valores["receta.alergias"]).toBe("Látex");
  });

  it("la receta es un tipo con flujo propio", () => {
    expect(esTipoDeDocumento("receta")).toBe(true);
    expect(TIPOS_CON_FLUJO_PROPIO).toContain("receta");
  });
});

describe("plantilla 'Receta' sembrada", () => {
  it("se encuentra en la migración, con su kind y su clave de siembra", () => {
    expect(CUERPO.length).toBeGreaterThan(50);
    expect(SQL).toMatch(/'receta', 'esmalia_model', 'receta'/);
  });

  it("solo usa variables que el motor conoce y no pide campos al emitir", () => {
    const a = analizarPlantilla(CUERPO);
    expect(a.problemas).toEqual([]);
    expect(a.desconocidas).toEqual([]);
    expect(a.campos).toEqual([]);
    expect(a.variables).toEqual(
      expect.arrayContaining([
        "paciente.nombre",
        "paciente.rut",
        "paciente.edad",
        "receta.alergias",
        "receta.medicamentos",
        "receta.indicaciones_generales",
      ]),
    );
  });

  it("con datos completos no le falta nada: RUT, edad, alergias y la tabla", () => {
    const r = renderPlantilla(CUERPO, construirContexto(DATOS));
    expect(r.faltantes).toEqual([]);
    expect(r.bloques[0]).toMatchObject({ tipo: "titulo", nivel: 1 });
    const texto = bloquesATexto(r.bloques);
    expect(texto).toContain("RUT: 12.345.678-5");
    expect(texto).toContain("Edad: 36 años");
    expect(texto).toContain("Alergias registradas: Látex");
    expect(texto).toContain("Amoxicilina 500 mg cápsulas");
    expect(r.bloques.some((b) => b.tipo === "tabla")).toBe(true);
  });

  it("también se ve en la vista previa del editor (contexto de ejemplo)", () => {
    const r = renderPlantilla(CUERPO, contextoDeEjemplo());
    expect(r.faltantes).toEqual([]);
    const tabla = r.bloques.find((b) => b.tipo === "tabla");
    expect(tabla && tabla.tipo === "tabla" ? tabla.filas.length : 0).toBe(2);
  });
});
