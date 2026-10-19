import { describe, expect, it } from "vitest";

import {
  alertasDeAlergia,
  contenidoReceta,
  edadEnAnios,
  folioReceta,
  grupoDe,
  lineaDePosologia,
  nombreConPresentacion,
  normalizarItem,
  normalizarTexto,
  RecetaItemsSchema,
  type RecetaEmitida,
} from "@/lib/clinical/recetas";

// Puro: sin red ni base (CLI-13, auditoría 360 del 18-oct-2026).

const ibuprofeno = {
  medication: "Ibuprofeno",
  presentation: "400 mg comprimidos",
  dose: "1 comprimido",
  frequency: "cada 8 horas",
  duration: "por 3 días",
  instructions: "después de las comidas",
};

describe("validación de medicamentos", () => {
  it("exige al menos uno y como máximo diez", () => {
    expect(RecetaItemsSchema.safeParse([]).success).toBe(false);
    expect(RecetaItemsSchema.safeParse([ibuprofeno]).success).toBe(true);
    expect(RecetaItemsSchema.safeParse(Array(11).fill(ibuprofeno)).success).toBe(false);
  });

  it("exige medicamento, dosis, frecuencia y duración; presentación e indicaciones son opcionales", () => {
    expect(RecetaItemsSchema.safeParse([{ ...ibuprofeno, dose: " " }]).success).toBe(false);
    expect(RecetaItemsSchema.safeParse([{ ...ibuprofeno, duration: "" }]).success).toBe(false);
    expect(
      RecetaItemsSchema.safeParse([{ ...ibuprofeno, presentation: "", instructions: "" }]).success,
    ).toBe(true);
  });

  it("normaliza: recorta y no guarda opcionales vacíos", () => {
    expect(
      normalizarItem({
        ...ibuprofeno,
        medication: "  Ibuprofeno ",
        presentation: " ",
        instructions: "",
      }),
    ).toEqual({
      medication: "Ibuprofeno",
      dose: "1 comprimido",
      frequency: "cada 8 horas",
      duration: "por 3 días",
    });
  });
});

describe("textos de la receta", () => {
  it("arma nombre y posología legibles", () => {
    expect(nombreConPresentacion(ibuprofeno)).toBe("Ibuprofeno 400 mg comprimidos");
    expect(nombreConPresentacion({ medication: "Paracetamol" })).toBe("Paracetamol");
    expect(lineaDePosologia(ibuprofeno)).toBe("1 comprimido, cada 8 horas, por 3 días");
  });

  it("folio con año y número de 4 cifras", () => {
    expect(folioReceta(2026, 7)).toBe("N.º 2026-0007");
    expect(folioReceta(2026, 12345)).toBe("N.º 2026-12345");
  });

  it("edad en años cumplidos", () => {
    expect(edadEnAnios("2010-10-20", "2026-10-19")).toBe(15);
    expect(edadEnAnios("2010-10-19", "2026-10-19")).toBe(16);
    expect(edadEnAnios(null, "2026-10-19")).toBeNull();
    expect(edadEnAnios("no-es-fecha", "2026-10-19")).toBeNull();
  });
});

describe("aviso de alergias", () => {
  it("normaliza tildes y signos", () => {
    expect(normalizarTexto("Ácido Acetil-salicílico")).toBe("acido acetil salicilico");
  });

  it("reconoce el grupo del medicamento", () => {
    expect(grupoDe("Amoxicilina 500 mg")).toBe("penicilinas");
    expect(grupoDe("amoxicilina con ácido clavulánico")).toBe("penicilinas");
    expect(grupoDe("Ketorolaco")).toBe("aine");
    expect(grupoDe("Ácido tranexámico")).toBeNull();
    expect(grupoDe("")).toBeNull();
  });

  it("avisa por nombre y por grupo", () => {
    expect(alertasDeAlergia("Ibuprofeno", ["ibuprofeno"])).toHaveLength(1);
    expect(alertasDeAlergia("Amoxicilina", ["Penicilina"])[0]).toContain("penicilinas");
    expect(alertasDeAlergia("Naproxeno", ["AINEs"])).toHaveLength(1);
    expect(alertasDeAlergia("Ketoprofeno", ["aspirina"])).toHaveLength(1);
  });

  it("avisa la reacción cruzada entre penicilinas y cefalosporinas", () => {
    const [aviso] = alertasDeAlergia("Cefadroxilo", ["penicilina"]);
    expect(aviso).toContain("reacción cruzada");
  });

  it("no inventa avisos", () => {
    expect(alertasDeAlergia("Paracetamol", ["penicilina", "látex"])).toEqual([]);
    expect(
      alertasDeAlergia("Amoxicilina con ácido clavulánico", ["ácido acetilsalicílico"]),
    ).toEqual([]);
    expect(alertasDeAlergia("Ibuprofeno", ["cocaína"])).toEqual([]);
    expect(alertasDeAlergia("", ["penicilina"])).toEqual([]);
  });
});

describe("contenido imprimible", () => {
  const receta: RecetaEmitida = {
    id: "r1",
    year: 2026,
    number: 42,
    issuedAt: "2026-10-19T15:00:00Z",
    professionalName: "Dra. Ana Pérez",
    professionalLicense: "123456",
    professionalSpecialty: "Cirugía oral",
    clinicName: "Clínica Sonrisa",
    clinicLegalName: "Sonrisa SpA",
    clinicTaxId: "76.123.456-7",
    clinicAddress: "Av. Siempre Viva 123, Santiago",
    clinicPhone: "+56 2 2222 2222",
    patientName: "Juan Soto",
    patientBirthDate: "1990-01-01",
    items: [ibuprofeno],
    instructions: "Dieta blanda.",
    contentSha256: "abcdef0123456789abcdef",
    voidedAt: null,
    voidReason: null,
  };

  it("lleva profesional con registro, clínica, paciente y medicamentos", () => {
    const c = contenidoReceta(receta, { fecha: "19-10-2026", edad: 36, documentoPaciente: "1-9" });
    expect(c.titulo).toBe("Receta N.º 2026-0042");
    expect(c.encabezado[0]).toBe("Clínica Sonrisa · Sonrisa SpA");
    expect(c.encabezado).toContain("Av. Siempre Viva 123, Santiago · Tel. +56 2 2222 2222");
    expect(c.paciente).toEqual([
      "Paciente: Juan Soto",
      "Documento: 1-9 · Edad: 36 años · Fecha: 19-10-2026",
    ]);
    expect(c.medicamentos[0]).toEqual({
      titulo: "1. Ibuprofeno 400 mg comprimidos",
      posologia: "1 comprimido, cada 8 horas, por 3 días",
      indicaciones: "después de las comidas",
    });
    expect(c.profesional).toContain("Registro profesional: 123456");
    expect(c.indicacionesGenerales).toBe("Dieta blanda.");
    expect(c.anulada).toBeNull();
    expect(c.pie).toContain("abcdef0123456789");
  });

  it("una receta anulada lo dice con el motivo", () => {
    const c = contenidoReceta(
      { ...receta, voidedAt: "2026-10-19T16:00:00Z", voidReason: "Error en la dosis" },
      { fecha: "19-10-2026", edad: null },
    );
    expect(c.anulada).toBe("ANULADA: Error en la dosis");
    expect(c.paciente[1]).toBe("Fecha: 19-10-2026");
  });
});
