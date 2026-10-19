import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLAVES_PREGUNTA,
  PREGUNTAS_RIESGO,
  alertasDeAnamnesis,
  citaDeLaAtencion,
  conciliarAlergias,
  cuestionarioSchema,
  leerCuestionario,
  leerDetallesDeAlergias,
  leerSignosDelFormulario,
  nombresDeAlergias,
  preguntasRespondidas,
  signosVitalesSchema,
} from "@/lib/clinical/anamnesis";

/**
 * Anamnesis estructurada (CLI-10, auditoría 360 del 18-oct-2026). Todo puro:
 * sin red ni base. La migración se lee como texto para fijar que los rangos
 * de la app y los CHECK de la base dicen lo mismo.
 */

describe("alergias con severidad", () => {
  it("la lista canónica manda: orden, sin duplicados y sin detalles huérfanos", () => {
    const r = conciliarAlergias(
      ["Penicilina", "Látex", "penicilina "],
      [
        { name: "látex", severity: "severe", reaction: "Anafilaxia" },
        { name: "Ibuprofeno", severity: "mild" },
      ],
    );
    expect(r).toEqual([
      { name: "Penicilina", severity: "unknown" },
      { name: "Látex", severity: "severe", reaction: "Anafilaxia" },
    ]);
  });

  it("una alergia sin detalle es 'sin especificar', nunca 'leve'", () => {
    expect(conciliarAlergias(["AINE"], [])).toEqual([{ name: "AINE", severity: "unknown" }]);
  });

  it("los nombres para la columna vieja salen únicos y en orden", () => {
    expect(
      nombresDeAlergias([
        { name: "Látex", severity: "severe" },
        { name: " látex", severity: "mild" },
        { name: "Yodo", severity: "moderate" },
      ]),
    ).toEqual(["Látex", "Yodo"]);
  });

  it("lee el jsonb de la base sin confiar en su forma", () => {
    expect(leerDetallesDeAlergias(null)).toEqual([]);
    expect(leerDetallesDeAlergias({ name: "x" })).toEqual([]);
    expect(
      leerDetallesDeAlergias([
        { name: "Penicilina", severity: "severe" },
        { name: "Otra", severity: "fatal" },
        "basura",
      ]),
    ).toEqual([{ name: "Penicilina", severity: "severe" }]);
  });
});

describe("cuestionario de riesgo", () => {
  it("cubre lo que pide el hallazgo", () => {
    for (const k of [
      "anticoagulants",
      "diabetes",
      "hypertension",
      "heart_disease",
      "pregnancy",
      "breastfeeding",
      "infectious_disease",
      "tobacco",
      "surgeries",
      "other",
    ]) {
      expect(CLAVES_PREGUNTA).toContain(k);
    }
    const criticas = PREGUNTAS_RIESGO.filter((p) => p.critica).map((p) => p.key);
    expect(criticas.sort()).toEqual(["anticoagulants", "pregnancy"]);
  });

  it("sin responder es clave ausente, no un 'no' fabricado", () => {
    const c = cuestionarioSchema.parse({ diabetes: { answer: "no" } });
    expect(c).toEqual({ diabetes: { answer: "no" } });
    expect(c.pregnancy).toBeUndefined();
    expect(preguntasRespondidas(c)).toBe(1);
  });

  it("limpia detalles vacíos y rechaza claves desconocidas", () => {
    expect(cuestionarioSchema.parse({ tobacco: { answer: "yes", detail: "  " } })).toEqual({
      tobacco: { answer: "yes" },
    });
    expect(() => cuestionarioSchema.parse({ asa: { answer: "yes" } })).toThrow();
    expect(() => cuestionarioSchema.parse({ diabetes: { answer: "tal vez" } })).toThrow();
  });

  it("al leer de la base descarta lo que no reconoce", () => {
    expect(leerCuestionario(null)).toEqual({});
    expect(leerCuestionario([])).toEqual({});
    expect(
      leerCuestionario({
        diabetes: { answer: "yes", detail: "Tipo 2" },
        asa: { answer: "yes" },
        hypertension: { answer: 1 },
      }),
    ).toEqual({ diabetes: { answer: "yes", detail: "Tipo 2" } });
  });
});

describe("alertas de la cabecera", () => {
  it("críticas primero: alergias (grave marcada), anticoagulantes y embarazo", () => {
    const alertas = alertasDeAnamnesis({
      alergias: [
        { name: "Látex", severity: "mild" },
        { name: "Penicilina", severity: "severe" },
      ],
      cuestionario: {
        diabetes: { answer: "yes", detail: "Tipo 2" },
        anticoagulants: { answer: "yes", detail: "Acenocumarol" },
        pregnancy: { answer: "yes" },
        tobacco: { answer: "no" },
      },
    });
    expect(alertas.map((a) => [a.clave, a.nivel])).toEqual([
      ["allergies", "critica"],
      ["anticoagulants", "critica"],
      ["pregnancy", "critica"],
      ["diabetes", "precaucion"],
    ]);
    expect(alertas[0].texto).toBe("Alergia: Penicilina (grave), Látex");
    expect(alertas[1].texto).toBe("Anticoagulantes o antiagregantes (Acenocumarol)");
  });

  it("un 'no' o una pregunta sin responder no genera alerta", () => {
    expect(
      alertasDeAnamnesis({ alergias: [], cuestionario: { pregnancy: { answer: "no" } } }),
    ).toEqual([]);
  });
});

describe("signos vitales", () => {
  const ok = { systolicMmhg: 120, diastolicMmhg: 80, heartRateBpm: 72 };

  it("presión y pulso obligatorios, temperatura opcional", () => {
    expect(signosVitalesSchema.safeParse(ok).success).toBe(true);
    expect(signosVitalesSchema.safeParse({ ...ok, temperatureC: 36.55 }).data?.temperatureC).toBe(
      36.6,
    );
    expect(signosVitalesSchema.safeParse({ systolicMmhg: 120, diastolicMmhg: 80 }).success).toBe(
      false,
    );
  });

  it("rechaza valores imposibles y una diastólica mayor que la sistólica", () => {
    expect(signosVitalesSchema.safeParse({ ...ok, systolicMmhg: 400 }).success).toBe(false);
    expect(signosVitalesSchema.safeParse({ ...ok, heartRateBpm: 10 }).success).toBe(false);
    expect(signosVitalesSchema.safeParse({ ...ok, temperatureC: 50 }).success).toBe(false);
    const invertida = signosVitalesSchema.safeParse({
      ...ok,
      systolicMmhg: 80,
      diastolicMmhg: 120,
    });
    expect(invertida.success).toBe(false);
    expect(invertida.error?.issues[0].message).toMatch(/sistólica/);
  });

  it("lee el formulario: enteros, coma decimal y vacío", () => {
    expect(
      leerSignosDelFormulario({
        sistolica: "130",
        diastolica: " 85",
        pulso: "70",
        temperatura: "36,5",
      }),
    ).toEqual({ systolicMmhg: 130, diastolicMmhg: 85, heartRateBpm: 70, temperatureC: 36.5 });
    expect(
      leerSignosDelFormulario({ sistolica: "13o", diastolica: "", pulso: "7.5", temperatura: "" }),
    ).toEqual({
      systolicMmhg: null,
      diastolicMmhg: null,
      heartRateBpm: null,
      temperatureC: undefined,
    });
    expect(
      leerSignosDelFormulario({ sistolica: "1", diastolica: "1", pulso: "1", temperatura: "36,55" })
        .temperatureC,
    ).toBeNull();
  });

  it("los rangos de la app son los mismos CHECK de la migración", () => {
    const sql = readFileSync(
      new URL(
        "../supabase/migrations/20261019180000_anamnesis_estructurada_y_tutor.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("systolic_mmhg BETWEEN 50 AND 300");
    expect(sql).toContain("diastolic_mmhg BETWEEN 20 AND 200");
    expect(sql).toContain("heart_rate_bpm BETWEEN 20 AND 250");
    expect(sql).toContain("temperature_c BETWEEN 30 AND 45");
    expect(sql).toContain("systolic_mmhg > diastolic_mmhg");
  });

  it("asocia la medición a la cita en curso, sin canceladas ni ausentes", () => {
    const ahora = new Date("2026-10-19T15:00:00Z");
    const citas = [
      { id: "lejos", starts_at: "2026-10-19T01:00:00Z", status: "finalizada" },
      { id: "cancelada", starts_at: "2026-10-19T15:00:00Z", status: "cancelada" },
      { id: "ausente", starts_at: "2026-10-19T15:05:00Z", status: "ausente" },
      { id: "en-sala", starts_at: "2026-10-19T14:30:00Z", status: "en-sala" },
      { id: "despues", starts_at: "2026-10-19T17:00:00Z", status: "confirmada" },
    ];
    expect(citaDeLaAtencion(citas, ahora)).toBe("en-sala");
    expect(citaDeLaAtencion([citas[0]], ahora)).toBeNull();
    expect(citaDeLaAtencion([], ahora)).toBeNull();
  });
});
