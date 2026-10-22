import { describe, expect, it } from "vitest";

import {
  alertasDeAnamnesis,
  conciliarCuestionario,
  preguntasRespondidas,
  riesgosDesdeAntecedentes,
} from "@/lib/clinical/anamnesis";

describe("riesgosDesdeAntecedentes (UX-14)", () => {
  it("Hipertensión en antecedentes contesta la pregunta de hipertensión", () => {
    const r = riesgosDesdeAntecedentes({ antecedentes: ["Hipertensión"], medicacion: [] });
    expect(r.hypertension).toEqual(["Hipertensión"]);
    expect(r.other).toBeUndefined();
  });

  it("reconoce términos sin tildes, en mayúsculas y abreviados", () => {
    const r = riesgosDesdeAntecedentes({
      antecedentes: ["HTA", "Diabetes tipo 2", "VIH", "Fibrilación auricular"],
      medicacion: [],
    });
    expect(r.hypertension).toEqual(["HTA"]);
    expect(r.diabetes).toEqual(["Diabetes tipo 2"]);
    expect(r.infectious_disease).toEqual(["VIH"]);
    expect(r.heart_disease).toEqual(["Fibrilación auricular"]);
  });

  it("no infiere lo que está negado", () => {
    const r = riesgosDesdeAntecedentes({
      antecedentes: ["Sin diabetes", "No es fumador", "Ex fumador", "Niega antecedentes de HTA"],
      medicacion: [],
    });
    expect(r).toEqual({});
  });

  it("no confunde palabras que contienen el término", () => {
    const r = riesgosDesdeAntecedentes({
      antecedentes: ["Hipotensión ortostática"],
      medicacion: [],
    });
    expect(r.hypertension).toBeUndefined();
    // No encaja en ninguna pregunta: va a "Otros antecedentes".
    expect(r.other).toEqual(["Hipotensión ortostática"]);
  });

  it("los anticoagulantes salen de la medicación", () => {
    const r = riesgosDesdeAntecedentes({
      antecedentes: [],
      medicacion: ["Losartán 50mg", "Aspirina 100 mg", "Xarelto 20mg"],
    });
    expect(r.anticoagulants).toEqual(["Aspirina 100 mg", "Xarelto 20mg"]);
    // Un antihipertensivo solo no alcanza para inferir hipertensión.
    expect(r.hypertension).toBeUndefined();
  });

  it("ignora entradas vacías", () => {
    expect(riesgosDesdeAntecedentes({ antecedentes: ["  "], medicacion: [""] })).toEqual({});
  });
});

describe("conciliarCuestionario", () => {
  it("completa las preguntas sin responder y no pisa las respondidas", () => {
    const inferidos = riesgosDesdeAntecedentes({
      antecedentes: ["Hipertensión", "Diabetes"],
      medicacion: [],
    });
    const c = conciliarCuestionario({ diabetes: { answer: "yes", detail: "Tipo 1" } }, inferidos);
    expect(c.efectivo.hypertension).toEqual({ answer: "yes", detail: "Hipertensión" });
    expect(c.efectivo.diabetes).toEqual({ answer: "yes", detail: "Tipo 1" });
    expect(c.desdeAntecedentes).toEqual(["hypertension"]);
    expect(c.contradicciones).toEqual([]);
    // Ya no dice "0 de 10" cuando hay antecedentes cargados.
    expect(preguntasRespondidas(c.efectivo)).toBe(2);
  });

  it("una respuesta explícita «No» manda, pero se marca la contradicción", () => {
    const inferidos = riesgosDesdeAntecedentes({ antecedentes: ["Hipertensión"], medicacion: [] });
    const c = conciliarCuestionario({ hypertension: { answer: "no" } }, inferidos);
    expect(c.efectivo.hypertension).toEqual({ answer: "no" });
    expect(c.contradicciones).toEqual(["hypertension"]);
    expect(c.desdeAntecedentes).toEqual([]);
  });

  it("sin antecedentes devuelve el cuestionario tal cual", () => {
    const c = conciliarCuestionario({ tobacco: { answer: "no" } }, {});
    expect(c.efectivo).toEqual({ tobacco: { answer: "no" } });
    expect(c.desdeAntecedentes).toEqual([]);
  });

  it("lo inferido genera la alerta en la cabecera (anticoagulantes es crítica)", () => {
    const inferidos = riesgosDesdeAntecedentes({
      antecedentes: ["Hipertensión"],
      medicacion: ["Acenocumarol 4 mg"],
    });
    const { efectivo } = conciliarCuestionario({}, inferidos);
    const alertas = alertasDeAnamnesis({ alergias: [], cuestionario: efectivo });
    expect(alertas).toEqual([
      {
        clave: "anticoagulants",
        nivel: "critica",
        texto: "Anticoagulantes o antiagregantes (Acenocumarol 4 mg)",
      },
      { clave: "hypertension", nivel: "precaucion", texto: "Hipertensión arterial (Hipertensión)" },
    ]);
  });
});
