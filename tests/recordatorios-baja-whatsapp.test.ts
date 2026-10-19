// Test puro (sin base ni red): la baja de WhatsApp saca al paciente de la
// cola de recordatorios de WhatsApp (CON-09).
import { describe, expect, it } from "vitest";

import { quitarBajasDeWhatsApp, type FilaRecordatorio } from "@/lib/messaging/baja-whatsapp";

function fila(over: Partial<FilaRecordatorio> & { patientId: string }): FilaRecordatorio {
  return {
    patientPhone: "+56912345678",
    patientEmail: null,
    emailSent: false,
    ...over,
  };
}

describe("quitarBajasDeWhatsApp", () => {
  it("excluye al paciente con wa_opt_out_at si no le queda otro canal", () => {
    const filas = [fila({ patientId: "baja" }), fila({ patientId: "activo" })];
    const resultado = quitarBajasDeWhatsApp(filas, new Set(["baja"]));
    expect(resultado.map((f) => f.patientId)).toEqual(["activo"]);
  });

  it("deja intactos a los pacientes sin baja", () => {
    const filas = [fila({ patientId: "a" }), fila({ patientId: "b" })];
    expect(quitarBajasDeWhatsApp(filas, new Set())).toEqual(filas);
  });

  it("si falta el email, la fila queda solo con ese canal (sin teléfono)", () => {
    const filas = [fila({ patientId: "baja", patientEmail: "p@ejemplo.com" })];
    const [resultado] = quitarBajasDeWhatsApp(filas, new Set(["baja"]));
    expect(resultado.patientPhone).toBeNull();
    expect(resultado.patientEmail).toBe("p@ejemplo.com");
  });

  it("si el email ya salió, la fila se va entera", () => {
    const filas = [fila({ patientId: "baja", patientEmail: "p@ejemplo.com", emailSent: true })];
    expect(quitarBajasDeWhatsApp(filas, new Set(["baja"]))).toEqual([]);
  });

  it("conserva los campos extra de cada fila", () => {
    const filas = [{ ...fila({ patientId: "a" }), appointmentId: "cita-1" }];
    expect(quitarBajasDeWhatsApp(filas, new Set())[0].appointmentId).toBe("cita-1");
  });
});
