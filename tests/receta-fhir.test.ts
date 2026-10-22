import { describe, expect, it } from "vitest";

import { grupoDe } from "@/lib/clinical/recetas";
import { estructurarItem } from "@/lib/clinical/receta-estructurada";
import { recetaAFhir, SISTEMAS_FHIR, type RecetaParaFhir } from "@/lib/clinical/receta-fhir";
import { medicamentoBase } from "@/lib/clinical/vademecum";

/**
 * MKT-05 · receta → FHIR R4. Puro: arma el JSON (no se manda a ningún lado,
 * no hay integración con el Minsal todavía). El mapeo está en
 * docs/RECETA_FHIR.md; si cambia uno, cambia el otro.
 */

const amox = medicamentoBase("esmalia:amoxicilina-500-caps")!;
const clorhex = medicamentoBase("esmalia:clorhexidina-012-colutorio")!;

const receta: RecetaParaFhir = {
  id: "8f6c2a1e-3b4d-4c5e-9f00-112233445566",
  folio: "2026-0012",
  issuedAt: "2026-10-22T15:04:05.000Z",
  voidedAt: null,
  voidReason: null,
  paciente: {
    id: "0b9d7c6e-5f4a-4b3c-8d2e-aabbccddeeff",
    nombre: "Ana Pérez Soto",
    tipoDocumento: "rut",
    documento: "12.345.678-5",
    fechaNacimiento: "1990-03-04",
  },
  profesional: {
    id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    nombre: "Dra. Carolina Rodríguez",
    registroSis: "123456",
    registroProfesional: "123456",
  },
  items: [
    estructurarItem(
      {
        medication: "Amoxicilina",
        presentation: "500 mg cápsulas",
        route: "oral",
        dose: "1 cápsula",
        frequency: "cada 8 horas",
        duration: "por 7 días",
        instructions: "Completar el tratamiento.",
        catalog: amox.codigo,
      },
      amox,
      grupoDe,
    ),
    estructurarItem(
      {
        medication: "Clorhexidina",
        presentation: "0,12 % colutorio",
        route: "enjuague_bucal",
        dose: "15 mL",
        frequency: "cada 12 horas",
        duration: "por 7 días",
        catalog: clorhex.codigo,
      },
      clorhex,
      grupoDe,
    ),
    estructurarItem(
      {
        medication: "Paracetamol",
        presentation: "500 mg",
        route: "oral",
        dose: "2 comprimidos",
        frequency: "cada 8 horas si hay dolor",
        duration: "mientras dure el dolor",
      },
      null,
      grupoDe,
    ),
  ],
  indicacionesGenerales: "Dieta blanda las primeras 24 horas.",
};

type Recurso = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function recursos(bundle: Recurso): Recurso[] {
  return (bundle.entry as { resource: Recurso }[]).map((e) => e.resource);
}

describe("recetaAFhir", () => {
  const bundle = recetaAFhir(receta) as Recurso;
  const [paciente, profesional, ...solicitudes] = recursos(bundle);

  it("es un Bundle collection con Patient, Practitioner y un MedicationRequest por medicamento", () => {
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("collection");
    expect(bundle.identifier).toEqual({ system: SISTEMAS_FHIR.receta, value: "2026-0012" });
    expect(paciente.resourceType).toBe("Patient");
    expect(profesional.resourceType).toBe("Practitioner");
    expect(solicitudes.map((s) => s.resourceType)).toEqual([
      "MedicationRequest",
      "MedicationRequest",
      "MedicationRequest",
    ]);
    for (const e of bundle.entry as { fullUrl: string; resource: Recurso }[]) {
      expect(e.fullUrl).toBe(
        `https://esmalia.com/fhir/${e.resource.resourceType}/${e.resource.id}`,
      );
    }
  });

  it("el paciente lleva el RUT como identifier oficial, sin puntos", () => {
    expect(paciente).toEqual({
      resourceType: "Patient",
      id: receta.paciente.id,
      identifier: [
        {
          use: "official",
          type: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v2-0203",
                code: "NI",
                display: "National unique individual identifier",
              },
            ],
            text: "RUT",
          },
          system: SISTEMAS_FHIR.rut,
          value: "12345678-5",
        },
      ],
      name: [{ text: "Ana Pérez Soto" }],
      birthDate: "1990-03-04",
    });
  });

  it("el profesional lleva su registro de la Superintendencia de Salud (sin repetirlo)", () => {
    expect(profesional.identifier).toHaveLength(1);
    expect(profesional.identifier[0]).toMatchObject({
      system: SISTEMAS_FHIR.registroSis,
      value: "123456",
      type: { coding: [{ code: "PRN" }] },
    });
    expect(profesional.name).toEqual([{ text: "Dra. Carolina Rodríguez" }]);
  });

  it("MedicationRequest: medicamento con ATC, dosis, intervalo, duración y vía", () => {
    const [mr] = solicitudes;
    expect(mr).toEqual({
      resourceType: "MedicationRequest",
      id: `${receta.id}-1`,
      identifier: [{ system: SISTEMAS_FHIR.receta, value: "2026-0012-1" }],
      groupIdentifier: { system: SISTEMAS_FHIR.receta, value: "2026-0012" },
      status: "active",
      intent: "order",
      medicationCodeableConcept: {
        coding: [{ system: "http://www.whocc.no/atc", code: "J01CA04", display: "Amoxicilina" }],
        text: "Amoxicilina 500 mg cápsulas",
      },
      subject: { reference: `Patient/${receta.paciente.id}`, display: "Ana Pérez Soto" },
      authoredOn: "2026-10-22T15:04:05.000Z",
      requester: {
        reference: `Practitioner/${receta.profesional.id}`,
        display: "Dra. Carolina Rodríguez",
      },
      note: [{ text: "Dieta blanda las primeras 24 horas." }],
      dosageInstruction: [
        {
          sequence: 1,
          text: "1 cápsula, vía oral, cada 8 horas, por 7 días",
          patientInstruction: "Completar el tratamiento.",
          timing: {
            repeat: {
              frequency: 1,
              period: 8,
              periodUnit: "h",
              boundsDuration: {
                value: 7,
                unit: "días",
                system: "http://unitsofmeasure.org",
                code: "d",
              },
            },
          },
          route: {
            coding: [{ system: "http://snomed.info/sct", code: "26643006", display: "Oral route" }],
            text: "Oral",
          },
          doseAndRate: [{ doseQuantity: { value: 1, unit: "cápsula" } }],
        },
      ],
    });
  });

  it("enjuague bucal → vía oromucosa (SNOMED 372473007)", () => {
    expect(solicitudes[1].dosageInstruction[0].route.coding[0].code).toBe("372473007");
    expect(solicitudes[1].dosageInstruction[0].doseAndRate[0].doseQuantity).toEqual({
      value: 15,
      unit: "mL",
    });
  });

  it("lo que no se entiende queda como texto; 'si hay dolor' es asNeeded", () => {
    const d = solicitudes[2].dosageInstruction[0];
    expect(solicitudes[2].medicationCodeableConcept).toEqual({ text: "Paracetamol 500 mg" });
    expect(d.asNeededBoolean).toBe(true);
    expect(d.timing.repeat).toEqual({ frequency: 1, period: 8, periodUnit: "h" });
    expect(d.text).toContain("mientras dure el dolor");
  });

  it("una receta anulada sale cancelled con el motivo", () => {
    const anulada = recursos(
      recetaAFhir({
        ...receta,
        voidedAt: "2026-10-22T16:00:00Z",
        voidReason: "Error en la dosis",
      }) as Recurso,
    );
    expect(anulada[2].status).toBe("cancelled");
    expect(anulada[2].statusReason).toEqual({ text: "Error en la dosis" });
  });

  it("sin documento ni ficha del profesional, no inventa identificadores", () => {
    const r = recursos(
      recetaAFhir({
        ...receta,
        paciente: { ...receta.paciente, documento: null, fechaNacimiento: null },
        profesional: { id: null, nombre: "Dr. X", registroSis: null, registroProfesional: "L-9" },
      }) as Recurso,
    );
    expect(r[0]).toEqual({
      resourceType: "Patient",
      id: receta.paciente.id,
      name: [{ text: "Ana Pérez Soto" }],
    });
    expect(r[1].id).toBe(`${receta.id}-profesional`);
    expect(r[1].identifier).toEqual([
      expect.objectContaining({ system: SISTEMAS_FHIR.registroProfesional, value: "L-9" }),
    ]);
    expect(r[2].requester.reference).toBe(`Practitioner/${receta.id}-profesional`);
  });

  it("pasaporte: identifier PPN", () => {
    const r = recursos(
      recetaAFhir({
        ...receta,
        paciente: { ...receta.paciente, tipoDocumento: "pasaporte", documento: "AB123456" },
      }) as Recurso,
    );
    expect(r[0].identifier[0]).toMatchObject({
      system: SISTEMAS_FHIR.documento,
      value: "AB123456",
      type: { coding: [{ code: "PPN" }], text: "Pasaporte" },
    });
  });

  it("es JSON puro (se puede serializar y volver a leer igual)", () => {
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
  });
});
