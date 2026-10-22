import { describe, expect, it } from "vitest";

import { MENSAJE_PACIENTE_DADO_DE_BAJA } from "@/lib/messaging/baja-whatsapp";
import { renderTemplateHtml } from "@/lib/messaging/messaging";
import { PLANTILLAS_EMAIL_DE_RESPALDO } from "@/lib/messaging/plantillas-email-respaldo";
import {
  COOLDOWN_SEGUIMIENTO_MS,
  DIAS_SIN_RESPUESTA_MAXIMO,
  DIAS_SIN_RESPUESTA_POR_DEFECTO,
  MOTIVO_SIN_CONSENTIMIENTO,
  MOTIVO_SIN_TELEFONO,
  calcularPresupuestosSinRespuesta,
  normalizarDiasSinRespuesta,
  type PacienteContactable,
  type PresupuestoAbierto,
} from "@/lib/messaging/presupuestos-sin-respuesta";

/** Lógica pura, sin Postgres: corre igual en el CI. */

const DIA = 24 * 60 * 60 * 1000;
const AHORA = Date.parse("2026-10-21T15:00:00Z");
const HOY = "2026-10-21";
const haceDias = (d: number) => new Date(AHORA - d * DIA).toISOString();

function paciente(id: string, extra: Partial<PacienteContactable> = {}): PacienteContactable {
  return {
    id,
    fullName: `Paciente ${id}`,
    phone: "+56911112222",
    email: `${id}@ejemplo.cl`,
    waOptIn: true,
    waOptOutAt: null,
    ...extra,
  };
}

function presupuesto(id: string, extra: Partial<PresupuestoAbierto> = {}): PresupuestoAbierto {
  return {
    id,
    patientId: "p1",
    number: `P-${id}`,
    status: "sent",
    totalCents: 850000,
    currency: "CLP",
    sentAt: haceDias(9),
    createdAt: haceDias(10),
    validUntil: null,
    acceptedAt: null,
    ...extra,
  };
}

function calcular(
  presupuestos: PresupuestoAbierto[],
  opciones: {
    pacientes?: PacienteContactable[];
    seguimientos?: [string, string][];
    dias?: number;
  } = {},
) {
  return calcularPresupuestosSinRespuesta({
    presupuestos,
    pacientes: opciones.pacientes ?? [paciente("p1")],
    ultimoSeguimientoPorPresupuesto: new Map(opciones.seguimientos ?? []),
    ahora: AHORA,
    hoy: HOY,
    dias: opciones.dias ?? DIAS_SIN_RESPUESTA_POR_DEFECTO,
  });
}

describe("calcularPresupuestosSinRespuesta", () => {
  it("lista el enviado hace más de N días con los datos para el mensaje", () => {
    const [fila] = calcular([presupuesto("q1")]);
    expect(fila).toMatchObject({
      quoteId: "q1",
      quoteNumber: "P-q1",
      quoteTotalCents: 850000,
      currency: "CLP",
      estado: "sent",
      diasSinRespuesta: 9,
      patientName: "Paciente p1",
      puedeWhatsApp: true,
      motivoSinWhatsApp: null,
      puedeEmail: true,
    });
  });

  it("respeta N: 7 días por defecto, y el que pide la pantalla", () => {
    const q = presupuesto("q1", { sentAt: haceDias(5) });
    expect(calcular([q])).toHaveLength(0);
    expect(calcular([q], { dias: 3 })).toHaveLength(1);
    expect(calcular([presupuesto("q2", { sentAt: haceDias(7) })])).toHaveLength(1);
  });

  it("incluye borradores, contando desde que se crearon", () => {
    const [fila] = calcular([
      presupuesto("q1", { status: "draft", sentAt: null, createdAt: haceDias(12) }),
    ]);
    expect(fila.estado).toBe("draft");
    expect(fila.diasSinRespuesta).toBe(12);
    expect(
      calcular([presupuesto("q2", { status: "draft", sentAt: null, createdAt: haceDias(2) })]),
    ).toHaveLength(0);
  });

  it("deja fuera aceptados, rechazados, convertidos, vencidos y en cero", () => {
    const filas = calcular([
      presupuesto("aceptado", { acceptedAt: haceDias(1) }),
      presupuesto("rechazado", { status: "rejected" as PresupuestoAbierto["status"] }),
      presupuesto("convertido", { status: "converted" as PresupuestoAbierto["status"] }),
      presupuesto("vencido", { validUntil: "2026-10-20" }),
      presupuesto("cero", { totalCents: 0 }),
      presupuesto("vigente", { validUntil: HOY }),
    ]);
    expect(filas.map((f) => f.quoteId)).toEqual(["vigente"]);
  });

  it("no repite el seguimiento del mismo presupuesto antes del cooldown", () => {
    const reciente = new Date(AHORA - COOLDOWN_SEGUIMIENTO_MS + DIA).toISOString();
    const viejo = new Date(AHORA - COOLDOWN_SEGUIMIENTO_MS - DIA).toISOString();
    expect(calcular([presupuesto("q1")], { seguimientos: [["q1", reciente]] })).toHaveLength(0);
    expect(calcular([presupuesto("q1")], { seguimientos: [["q1", viejo]] })).toHaveLength(1);
    // El seguimiento de otro presupuesto del mismo paciente no lo frena.
    expect(calcular([presupuesto("q1")], { seguimientos: [["q9", reciente]] })).toHaveLength(1);
  });

  it("omite pacientes que no vinieron en la lectura (archivados)", () => {
    expect(calcular([presupuesto("q1", { patientId: "archivado" })])).toHaveLength(0);
  });

  it("la baja de WhatsApp apaga el botón aunque haya teléfono y consentimiento viejo", () => {
    const [fila] = calcular([presupuesto("q1")], {
      pacientes: [paciente("p1", { waOptOutAt: haceDias(3) })],
    });
    expect(fila.puedeWhatsApp).toBe(false);
    expect(fila.motivoSinWhatsApp).toBe(MENSAJE_PACIENTE_DADO_DE_BAJA);
    // Sigue en la lista: el email es otro canal.
    expect(fila.puedeEmail).toBe(true);
  });

  it("sin consentimiento o sin teléfono, ofrece solo email y dice por qué", () => {
    const [sinOptIn] = calcular([presupuesto("q1")], {
      pacientes: [paciente("p1", { waOptIn: false })],
    });
    expect(sinOptIn.motivoSinWhatsApp).toBe(MOTIVO_SIN_CONSENTIMIENTO);
    const [sinTelefono] = calcular([presupuesto("q1")], {
      pacientes: [paciente("p1", { phone: "  " })],
    });
    expect(sinTelefono.motivoSinWhatsApp).toBe(MOTIVO_SIN_TELEFONO);
    expect(sinTelefono.puedeEmail).toBe(true);
  });

  it("sin ningún canal, la fila igual aparece para que el staff lo sepa", () => {
    const [fila] = calcular([presupuesto("q1")], {
      pacientes: [paciente("p1", { phone: null, email: null })],
    });
    expect(fila.puedeWhatsApp).toBe(false);
    expect(fila.puedeEmail).toBe(false);
  });

  it("ordena del que más espera al que menos", () => {
    const filas = calcular(
      [
        presupuesto("q1", { sentAt: haceDias(8) }),
        presupuesto("q2", { sentAt: haceDias(20) }),
        presupuesto("q3", { sentAt: haceDias(12) }),
      ],
      { pacientes: [paciente("p1")] },
    );
    expect(filas.map((f) => f.quoteId)).toEqual(["q2", "q3", "q1"]);
  });
});

describe("normalizarDiasSinRespuesta", () => {
  it("usa el valor por defecto si no llega nada usable y acota el resto", () => {
    expect(normalizarDiasSinRespuesta(undefined)).toBe(DIAS_SIN_RESPUESTA_POR_DEFECTO);
    expect(normalizarDiasSinRespuesta(Number.NaN)).toBe(DIAS_SIN_RESPUESTA_POR_DEFECTO);
    expect(normalizarDiasSinRespuesta(0)).toBe(1);
    expect(normalizarDiasSinRespuesta(14.7)).toBe(14);
    expect(normalizarDiasSinRespuesta(500)).toBe(DIAS_SIN_RESPUESTA_MAXIMO);
  });
});

describe("plantilla de email de respaldo del seguimiento de presupuesto", () => {
  it("usa las mismas variables que la de WhatsApp y escapa los valores", () => {
    const plantilla = PLANTILLAS_EMAIL_DE_RESPALDO.quote_follow_up!;
    const vars = {
      paciente: "Ana <b>",
      numero_presupuesto: "P-0003",
      total: "$850.000",
      clinica: "Clínica Sonrisa",
    };
    const html = renderTemplateHtml(plantilla.body, vars);
    expect(html).toContain("P-0003");
    expect(html).toContain("$850.000");
    expect(html).toContain("Ana &lt;b&gt;");
    expect(html).not.toMatch(/\{\w+\}/);
    expect(renderTemplateHtml(plantilla.subject, vars)).toBe(
      "Tu presupuesto P-0003 en Clínica Sonrisa",
    );
  });
});
