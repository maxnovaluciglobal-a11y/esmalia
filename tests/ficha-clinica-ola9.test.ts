import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLAVES_PREGUNTA,
  GRUPOS_ANTECEDENTES,
  PREGUNTAS_RIESGO,
  alertasDeAnamnesis,
  conciliarCuestionario,
  cuestionarioSchema,
  leerCuestionario,
  preguntasPorGrupo,
  riesgosDesdeAntecedentes,
} from "@/lib/clinical/anamnesis";
import { AUDIT_LABELS, puedeCambiarRestriccion } from "@/lib/clinical/clinical-notes";
import {
  ESTADOS_IMPLANTE,
  controlImplanteSchema,
  esPiezaFdiPermanente,
  estaEnBoca,
  formatearMedidas,
  implanteSchema,
  leerMedida,
  normalizarLote,
  patronDeLote,
} from "@/lib/clinical/implantes";
import {
  ESTADOS_INTERCONSULTA,
  TRANSICIONES_INTERCONSULTA,
  cambioDeEstadoSchema,
  camposDeDerivacion,
  estaAbierta,
  nuevaInterconsultaSchema,
  puedePasarA,
} from "@/lib/clinical/interconsultas";
import {
  agregarProtocoloANota,
  leerPasos,
  pasosDesdeTexto,
  protocoloSchema,
  textoDeProtocolo,
} from "@/lib/clinical/protocolos";

/**
 * Ola 9 · frente B (ficha clínica), todo puro: FIC-09 antecedentes por
 * grupo, FIC-11 quién cambia la restricción, FIC-14 transiciones (las mismas
 * que el trigger), FIC-15 texto del protocolo en la nota y MKT-09 pieza,
 * medidas y lote. Las migraciones se leen como texto para fijar que la app y
 * la base dicen lo mismo.
 */

const migracion = (archivo: string) =>
  readFileSync(new URL(`../supabase/migrations/${archivo}`, import.meta.url), "utf8");

describe("FIC-09 antecedentes completos", () => {
  it("cada pregunta tiene un grupo conocido y ningún grupo queda vacío", () => {
    const grupos = new Set(GRUPOS_ANTECEDENTES.map((g) => g.key));
    for (const p of PREGUNTAS_RIESGO) expect(grupos.has(p.grupo), p.key).toBe(true);
    const porGrupo = preguntasPorGrupo();
    expect(porGrupo.map((g) => g.key)).toEqual([
      "morbidos",
      "quirurgicos",
      "medicamentos",
      "habitos",
      "familiares",
      "gineco",
      "odontologicos",
      "otros",
    ]);
    expect(porGrupo.flatMap((g) => g.preguntas)).toHaveLength(PREGUNTAS_RIESGO.length);
  });

  it("cubre los antecedentes de una ficha completa sin perder las claves de antes", () => {
    for (const k of [
      // las de la anamnesis estructurada (CLI-10): siguen igual
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
      // FIC-09
      "bleeding_disorder",
      "bisphosphonates",
      "immunosuppressants",
      "alcohol",
      "bruxism",
      "family_history",
      "gum_bleeding",
      "tmj_pain",
      "anesthesia_reaction",
      "cancer",
    ]) {
      expect(CLAVES_PREGUNTA).toContain(k);
    }
    expect(new Set(CLAVES_PREGUNTA).size).toBe(CLAVES_PREGUNTA.length);
  });

  it("las críticas no cambian: solo anticoagulantes y embarazo (hasta el revisor)", () => {
    expect(
      PREGUNTAS_RIESGO.filter((p) => p.critica)
        .map((p) => p.key)
        .sort(),
    ).toEqual(["anticoagulants", "pregnancy"]);
  });

  it("una ficha guardada antes sigue leyéndose igual; lo nuevo queda sin responder", () => {
    const viejo = { diabetes: { answer: "yes", detail: "tipo 2" }, tobacco: { answer: "no" } };
    expect(leerCuestionario(viejo)).toEqual(viejo);
    expect(cuestionarioSchema.parse({ bruxism: { answer: "yes" } })).toEqual({
      bruxism: { answer: "yes" },
    });
  });

  it("los antecedentes nuevos también salen de lo escrito y de la medicación", () => {
    const r = riesgosDesdeAntecedentes({
      antecedentes: ["Asma bronquial", "Hipotiroidismo", "sin epilepsia", "Bruxismo nocturno"],
      medicacion: ["Alendronato 70 mg semanal", "Prednisona 5 mg"],
    });
    expect(r.respiratory_disease).toEqual(["Asma bronquial"]);
    expect(r.thyroid_disease).toEqual(["Hipotiroidismo"]);
    expect(r.neurological_disease).toBeUndefined();
    expect(r.bruxism).toEqual(["Bruxismo nocturno"]);
    expect(r.bisphosphonates).toEqual(["Alendronato 70 mg semanal"]);
    expect(r.immunosuppressants).toEqual(["Prednisona 5 mg"]);
    const { efectivo } = conciliarCuestionario({}, r);
    const alertas = alertasDeAnamnesis({ alergias: [], cuestionario: efectivo });
    expect(alertas.find((a) => a.clave === "bisphosphonates")?.nivel).toBe("precaucion");
  });

  it("el formulario antes de la cita usa el mismo catálogo agrupado", () => {
    const fuente = readFileSync(
      new URL("../src/routes/formulario.$token.tsx", import.meta.url),
      "utf8",
    );
    expect(fuente).toContain("preguntasPorGrupo()");
  });
});

describe("FIC-11 evolución restringida", () => {
  it("la cambian su autor y owner/admin, como el trigger de la base", () => {
    expect(puedeCambiarRestriccion({ rol: "dentist", userId: "a", autorId: "a" })).toBe(true);
    expect(puedeCambiarRestriccion({ rol: "assistant", userId: "a", autorId: "a" })).toBe(true);
    expect(puedeCambiarRestriccion({ rol: "dentist", userId: "b", autorId: "a" })).toBe(false);
    expect(puedeCambiarRestriccion({ rol: "owner", userId: "b", autorId: "a" })).toBe(true);
    expect(puedeCambiarRestriccion({ rol: "admin", userId: "b", autorId: "a" })).toBe(true);
    expect(puedeCambiarRestriccion({ rol: "reception", userId: "b", autorId: "a" })).toBe(false);
  });

  it("la bitácora tiene texto para las acciones nuevas", () => {
    expect(AUDIT_LABELS.restrict).toMatch(/Restringió/);
    expect(AUDIT_LABELS.unrestrict).toMatch(/Quitó/);
    expect(AUDIT_LABELS.restricted_view).toMatch(/Abrió/);
  });

  it("la migración solo suma políticas RESTRICTIVE y no redefine las de la regla 2", () => {
    const sql = migracion("20261030200000_evolucion_restringida.sql");
    const politicas = [
      ...sql.matchAll(/^create policy (\w+) on public\.(\w+)\n\s+as restrictive/gm),
    ];
    expect(politicas.map((m) => m[2]).sort()).toEqual([
      "clinical_note_audit",
      "clinical_note_entities",
      "clinical_note_reviews",
      "clinical_note_versions",
      "clinical_notes",
    ]);
    expect(sql).not.toMatch(/drop policy if exists notes_(select|insert|update)_clinical/);
    expect(sql).not.toMatch(/create or replace function public\.guardar_nota_clinica/);
    expect(sql).not.toMatch(/create or replace function public\.enforce_clinical_note_update/);
    // El CHECK de la bitácora conserva todas las acciones anteriores.
    for (const a of ["create", "edit", "revert", "sign", "addendum", "conflict", "ai_structure"]) {
      expect(sql).toContain(`'${a}'`);
    }
  });
});

describe("FIC-14 interconsultas", () => {
  it("las transiciones son las mismas que valida el trigger", () => {
    const sql = migracion("20261030200100_interconsultas.sql");
    expect(sql).toContain(
      "(old.status = 'pedida' and new.status in ('enviada', 'respondida', 'cancelada'))",
    );
    expect(sql).toContain("(old.status = 'enviada' and new.status in ('respondida', 'cancelada'))");
    expect(sql).toContain("(old.status = 'respondida' and new.status = 'cerrada')");
    expect(TRANSICIONES_INTERCONSULTA).toEqual({
      pedida: ["enviada", "respondida", "cancelada"],
      enviada: ["respondida", "cancelada"],
      respondida: ["cerrada"],
      cerrada: [],
      cancelada: [],
    });
    for (const e of ESTADOS_INTERCONSULTA) expect(sql).toContain(`'${e}'`);
    expect(puedePasarA("cerrada", "enviada")).toBe(false);
    expect(estaAbierta("enviada")).toBe(true);
    expect(estaAbierta("respondida")).toBe(false);
  });

  it("valida lo que se pide y la respuesta", () => {
    expect(nuevaInterconsultaSchema.safeParse({ specialty: "E", reason: "Dolor" }).success).toBe(
      false,
    );
    const ok = nuevaInterconsultaSchema.parse({
      specialty: "Endodoncia",
      reason: "Lesión periapical en 36",
      destination: "  ",
    });
    expect(ok).toMatchObject({ urgency: "normal", destination: undefined });
    expect(cambioDeEstadoSchema.safeParse({ estado: "respondida", response: "" }).success).toBe(
      false,
    );
    expect(
      cambioDeEstadoSchema.safeParse({ estado: "cancelada", cancelReason: "no" }).success,
    ).toBe(false);
  });

  it("arma los campos de la plantilla de derivación (Ola 4) sin dejar ninguno vacío", () => {
    const campos = camposDeDerivacion(
      {
        specialty: "Cirugía maxilofacial",
        destination: "Dr. Soto",
        reason: "Tercer molar incluido",
        request: null,
        urgency: "preferente",
      },
      ["Alergia: Penicilina (grave)", "Anticoagulantes o antiagregantes (aspirina)"],
    );
    expect(campos).toEqual({
      derivado_a: "Cirugía maxilofacial · Dr. Soto",
      motivo: "Tercer molar incluido (preferente)",
      antecedentes: "Alergia: Penicilina (grave); Anticoagulantes o antiagregantes (aspirina)",
      solicitud: "Evaluación y tratamiento según corresponda.",
    });
    expect(
      camposDeDerivacion(
        {
          specialty: "Endodoncia",
          destination: null,
          reason: "x",
          request: "y",
          urgency: "normal",
        },
        [],
      ).antecedentes,
    ).toMatch(/Sin antecedentes/);
    // Son exactamente los campos que usa la plantilla sembrada.
    const plantilla = migracion("20261025100100_plantillas_de_documentos_base.sql");
    for (const c of Object.keys(campos)) expect(plantilla).toContain(`{{campo.${c}}}`);
  });
});

describe("FIC-15 protocolos clínicos", () => {
  it("el texto que entra en la nota numera los pasos y suma las indicaciones", () => {
    const bloque = textoDeProtocolo({
      name: "Exodoncia simple",
      procedureLabel: "Exodoncia",
      steps: ["Anestesia infiltrativa", "Luxación y extracción", "Hemostasia"],
      indications: "No enjuagar por 24 horas.",
    });
    expect(bloque).toBe(
      [
        "Protocolo aplicado: Exodoncia simple (Exodoncia)",
        "1. Anestesia infiltrativa",
        "2. Luxación y extracción",
        "3. Hemostasia",
        "",
        "Indicaciones al paciente:",
        "No enjuagar por 24 horas.",
      ].join("\n"),
    );
    expect(agregarProtocoloANota("", bloque)).toBe(bloque);
    expect(agregarProtocoloANota("S: dolor 36\n\n", bloque)).toBe(`S: dolor 36\n\n${bloque}`);
  });

  it("separa los pasos pegados y lee el jsonb sin confiar en su forma", () => {
    expect(pasosDesdeTexto("1. Anestesia\n- Extracción\n\n• Sutura\n2) Control")).toEqual([
      "Anestesia",
      "Extracción",
      "Sutura",
      "Control",
    ]);
    expect(leerPasos(["a", 3, " b ", ""])).toEqual(["a", "b"]);
    expect(leerPasos({})).toEqual([]);
  });

  it("valida nombre y pasos con los mismos límites que la base", () => {
    expect(protocoloSchema.safeParse({ name: "A", steps: ["x"] }).success).toBe(false);
    expect(protocoloSchema.safeParse({ name: "Ok", steps: [] }).success).toBe(false);
    expect(
      protocoloSchema.safeParse({ name: "Ok", steps: Array.from({ length: 41 }, () => "p") })
        .success,
    ).toBe(false);
    const sql = migracion("20261030200200_protocolos_clinicos.sql");
    expect(sql).toContain("jsonb_array_length(steps) between 1 and 40");
  });
});

describe("MKT-09 seguimiento de implantes", () => {
  it("pieza permanente en FDI, igual que el CHECK de la base", () => {
    for (const n of [11, 18, 21, 36, 48]) expect(esPiezaFdiPermanente(n), String(n)).toBe(true);
    for (const n of [10, 19, 51, 55, 49, 9, 36.5])
      expect(esPiezaFdiPermanente(n), String(n)).toBe(false);
    const sql = migracion("20261030200300_seguimiento_de_implantes.sql");
    expect(sql).toContain("tooth between 11 and 48 and tooth % 10 between 1 and 8");
    for (const e of ESTADOS_IMPLANTE) expect(sql).toContain(`'${e}'`);
  });

  it("el lote se compara sin espacios ni mayúsculas y el patrón escapa comodines", () => {
    expect(normalizarLote("  LOT-AB123 ")).toBe("lot-ab123");
    expect(patronDeLote(" ab_1%2 ")).toBe("%ab\\_1\\%2%");
  });

  it("medidas: coma o punto, y un texto legible", () => {
    expect(leerMedida("4,1")).toBe(4.1);
    expect(leerMedida("10")).toBe(10);
    expect(leerMedida("")).toBeUndefined();
    expect(leerMedida("cuatro")).toBeNull();
    expect(formatearMedidas(4.1, 10)).toBe("4,1 × 10 mm");
    expect(formatearMedidas(null, 10)).toBe("10 mm de largo");
    expect(formatearMedidas(null, null)).toBeNull();
  });

  it("el lote es obligatorio (es lo que se busca en un retiro) y las medidas tienen rango", () => {
    const base = { tooth: 36, brand: "Straumann", lot: "L1", placedOn: "2026-10-20" };
    expect(implanteSchema.parse(base)).toMatchObject({ status: "colocado" });
    expect(implanteSchema.safeParse({ ...base, lot: " " }).success).toBe(false);
    expect(implanteSchema.safeParse({ ...base, diameterMm: 9 }).success).toBe(false);
    expect(implanteSchema.safeParse({ ...base, tooth: 55 }).success).toBe(false);
    expect(
      controlImplanteSchema.safeParse({ controlledOn: "2026-10-20", finding: "ok" }).success,
    ).toBe(true);
    expect(estaEnBoca("cargado")).toBe(true);
    expect(estaEnBoca("retirado")).toBe(false);
  });
});
