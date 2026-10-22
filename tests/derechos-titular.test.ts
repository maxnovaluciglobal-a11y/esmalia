// Derechos del titular (SEG-09, Ley 21.719): plazos, estados y la descarga
// de "mis datos". Puro: sin base ni red.
import { describe, expect, it } from "vitest";

import {
  DIAS_AVISO_POR_VENCER,
  MAX_SOLICITUDES_PORTAL_24H,
  accionesPermitidas,
  diasEntre,
  fechaCivilEn,
  mensajeRespuesta,
  ordenarBandeja,
  puedeProrrogar,
  semaforoDePlazo,
  sumarDias,
  superaTopeDiario,
  textoDiasRestantes,
  venceEl,
  vencimientoVigente,
  type EstadoSolicitud,
} from "@/lib/derechos/derechos";
import {
  armarMisDatos,
  contenidoPdfMisDatos,
  misDatosACsv,
  misDatosAJson,
  type FilasDelTitular,
} from "@/lib/derechos/mis-datos";
import { correoRespuestaTitular } from "@/lib/derechos/correo-respuesta";

describe("plazo legal de 30 días corridos, en el huso de la clínica", () => {
  it("cuenta desde la fecha civil de recepción en la clínica, no en UTC", () => {
    // 1 de octubre a las 23:30 en Santiago = 2 de octubre en UTC.
    const recibida = new Date("2026-10-02T02:30:00Z");
    expect(fechaCivilEn(recibida, "America/Santiago")).toBe("2026-10-01");
    expect(venceEl(recibida, "America/Santiago")).toBe("2026-10-31");
    // La misma recepción en una clínica de Madrid ya es el 2 de octubre.
    expect(venceEl(recibida, "Europe/Madrid")).toBe("2026-11-01");
  });

  it("cruza meses y años sin correrse un día", () => {
    expect(sumarDias("2026-12-15", 30)).toBe("2027-01-14");
    expect(sumarDias("2028-02-10", 30)).toBe("2028-03-11"); // año bisiesto
    expect(diasEntre("2026-10-01", "2026-10-31")).toBe(30);
  });

  it("un huso inválido cae a Chile en vez de romper", () => {
    expect(fechaCivilEn(new Date("2026-10-02T02:30:00Z"), "Nada/Nada")).toBe("2026-10-01");
  });

  it("la prórroga manda sobre el vencimiento original", () => {
    expect(vencimientoVigente({ due_date: "2026-10-31", extended_due_date: null })).toBe(
      "2026-10-31",
    );
    expect(vencimientoVigente({ due_date: "2026-10-31", extended_due_date: "2026-11-30" })).toBe(
      "2026-11-30",
    );
  });
});

describe("semáforo del plazo", () => {
  const abierta = (
    due: string,
    extended: string | null = null,
    status: EstadoSolicitud = "recibida",
  ) => ({
    status,
    due_date: due,
    extended_due_date: extended,
  });

  it("en plazo, por vencer, vence hoy y vencida", () => {
    expect(semaforoDePlazo(abierta("2026-10-31"), "2026-10-01")).toEqual({
      semaforo: "en_plazo",
      diasRestantes: 30,
    });
    expect(semaforoDePlazo(abierta("2026-10-31"), "2026-10-26").semaforo).toBe("por_vencer");
    expect(
      semaforoDePlazo(abierta("2026-10-31"), sumarDias("2026-10-31", -DIAS_AVISO_POR_VENCER))
        .semaforo,
    ).toBe("por_vencer");
    expect(
      semaforoDePlazo(abierta("2026-10-31"), sumarDias("2026-10-31", -DIAS_AVISO_POR_VENCER - 1))
        .semaforo,
    ).toBe("en_plazo");
    expect(semaforoDePlazo(abierta("2026-10-31"), "2026-10-31")).toEqual({
      semaforo: "vence_hoy",
      diasRestantes: 0,
    });
    expect(semaforoDePlazo(abierta("2026-10-31"), "2026-11-03")).toEqual({
      semaforo: "vencida",
      diasRestantes: -3,
    });
  });

  it("una prorrogada se mide contra el nuevo vencimiento", () => {
    expect(semaforoDePlazo(abierta("2026-10-31", "2026-11-30"), "2026-11-03").semaforo).toBe(
      "en_plazo",
    );
  });

  it("cerrada no tiene plazo, aunque haya vencido", () => {
    for (const status of ["respondida", "rechazada"] as const) {
      expect(semaforoDePlazo(abierta("2026-10-31", null, status), "2027-01-01")).toEqual({
        semaforo: "cerrada",
        diasRestantes: null,
      });
    }
  });

  it("textos de días restantes", () => {
    expect(textoDiasRestantes(0)).toBe("Vence hoy");
    expect(textoDiasRestantes(1)).toBe("Queda 1 día");
    expect(textoDiasRestantes(12)).toBe("Quedan 12 días");
    expect(textoDiasRestantes(-1)).toBe("Venció ayer");
    expect(textoDiasRestantes(-4)).toBe("Venció hace 4 días");
    expect(textoDiasRestantes(null)).toBe("");
  });
});

describe("estados y acciones", () => {
  it("transiciones permitidas", () => {
    expect(accionesPermitidas("recibida")).toEqual(["en_revision", "responder", "rechazar"]);
    expect(accionesPermitidas("en_revision")).toEqual(["responder", "rechazar"]);
    expect(accionesPermitidas("respondida")).toEqual([]);
    expect(accionesPermitidas("rechazada")).toEqual([]);
  });

  it("prórroga: una vez, abierta y antes de vencer", () => {
    const s = { status: "recibida" as const, due_date: "2026-10-31", extended_due_date: null };
    expect(puedeProrrogar(s, "2026-10-31")).toBe(true);
    expect(puedeProrrogar(s, "2026-11-01")).toBe(false);
    expect(puedeProrrogar({ ...s, extended_due_date: "2026-11-30" }, "2026-10-10")).toBe(false);
    expect(puedeProrrogar({ ...s, status: "respondida" }, "2026-10-10")).toBe(false);
  });

  it("la bandeja muestra primero las abiertas que vencen antes", () => {
    const fila = (
      id: string,
      status: EstadoSolicitud,
      due: string,
      received: string,
      extended: string | null = null,
    ) => ({ id, status, due_date: due, extended_due_date: extended, received_at: received });
    const orden = ordenarBandeja([
      fila("cerrada-nueva", "respondida", "2026-10-05", "2026-10-20T10:00:00Z"),
      fila("vence-tarde", "recibida", "2026-11-20", "2026-10-21T10:00:00Z"),
      fila("vence-pronto", "en_revision", "2026-10-25", "2026-09-25T10:00:00Z"),
      fila("prorrogada", "recibida", "2026-10-24", "2026-09-24T10:00:00Z", "2026-11-23"),
      fila("cerrada-vieja", "rechazada", "2026-10-01", "2026-09-01T10:00:00Z"),
    ]).map((f) => f.id);
    expect(orden).toEqual([
      "vence-pronto",
      "vence-tarde",
      "prorrogada",
      "cerrada-nueva",
      "cerrada-vieja",
    ]);
  });

  it("tope antiabuso del portal (el mismo de los pedidos de hora)", () => {
    expect(MAX_SOLICITUDES_PORTAL_24H).toBe(3);
    expect(superaTopeDiario(2, 3)).toBe(false);
    expect(superaTopeDiario(3, 3)).toBe(true);
    expect(superaTopeDiario(null, 3)).toBe(false);
  });
});

describe("correo de la respuesta", () => {
  it("escapa el texto escrito por la clínica y no lleva enlace de baja", () => {
    const mensaje = mensajeRespuesta({
      paciente: "Ana Pérez",
      clinica: "Clínica Sonrisa",
      tipo: "supresion",
      recibidaEl: "1 oct 2026",
      estado: "rechazada",
      respuesta: "Tu ficha clínica se conserva 15 años <script>alert(1)</script>",
    });
    expect(mensaje.startsWith("Hola, Ana:")).toBe(true);
    const correo = correoRespuestaTitular({
      appUrl: "https://esmalia.com",
      asunto: "Respuesta",
      mensaje,
      clinica: "Clínica Sonrisa",
    });
    expect(correo.html).not.toContain("<script>");
    expect(correo.html).toContain("&lt;script&gt;");
    expect(correo.html).not.toMatch(/baja/i);
    expect(correo.text).toContain("se conserva 15 años");
  });
});

// ── Descarga de "mis datos" ───────────────────────────────────────────────

const YO = "11111111-1111-4111-8111-111111111111";
const FUSIONADA = "22222222-2222-4222-8222-222222222222";
const OTRO = "33333333-3333-4333-8333-333333333333";

function filas(): FilasDelTitular {
  return {
    paciente: {
      id: YO,
      full_name: "Ana Pérez Soto",
      birth_date: "1990-05-04",
      email: "ana@ejemplo.com",
      phone: "+56911111111",
      address: "Av. Siempre Viva 123",
      commune: "Providencia",
      health_plan: "Isapre",
      health_plan_institution: "Colmena",
      emergency_contact_name: "Luis Pérez",
      emergency_contact_phone: "+56922222222",
      emergency_contact_relationship: "Hermano",
      tiene_documento: true,
      wa_opt_out_at: "2026-10-10T12:00:00Z",
      email_opt_out_at: null,
      created_at: "2025-01-10T12:00:00Z",
    },
    anamnesis: [
      {
        patient_id: YO,
        allergies: ["Penicilina"],
        conditions: ["Hipertensión"],
        chronic_medications: [],
      },
      {
        patient_id: FUSIONADA,
        allergies: ["Látex", "Penicilina"],
        conditions: null,
        chronic_medications: null,
      },
      {
        patient_id: OTRO,
        allergies: ["Ibuprofeno de OTRO"],
        conditions: [],
        chronic_medications: [],
      },
    ],
    notas: [
      {
        patient_ref: YO,
        title: "Limpieza",
        signed_at: "2026-09-01T15:00:00Z",
        created_at: "2026-09-01T14:00:00Z",
        signer_name: "Dra. Rojas",
        status: "signed",
      },
      {
        patient_ref: YO,
        title: "Borrador sin firmar",
        signed_at: null,
        created_at: "2026-09-02T14:00:00Z",
        signer_name: null,
        status: "draft",
      },
      {
        patient_ref: OTRO,
        title: "Nota de OTRO",
        signed_at: "2026-09-01T15:00:00Z",
        created_at: "2026-09-01T14:00:00Z",
        signer_name: "Dr. X",
        status: "signed",
      },
    ],
    citas: [
      {
        patient_id: YO,
        starts_at: "2026-11-01T13:00:00Z",
        treatment_label: "Control",
        status: "confirmada",
      },
      {
        patient_id: FUSIONADA,
        starts_at: "2025-03-01T13:00:00Z",
        treatment_label: "Evaluación",
        status: "finalizada",
      },
      {
        patient_id: OTRO,
        starts_at: "2026-11-02T13:00:00Z",
        treatment_label: "Cita de OTRO",
        status: "confirmada",
      },
    ],
    presupuestos: [
      {
        patient_id: YO,
        number: "P-0001",
        created_at: "2026-08-01T12:00:00Z",
        status: "accepted",
        total_cents: 150000,
        currency: "CLP",
      },
      {
        patient_id: OTRO,
        number: "P-9999",
        created_at: "2026-08-01T12:00:00Z",
        status: "sent",
        total_cents: 1,
        currency: "CLP",
      },
    ],
    planes: [
      {
        patient_id: YO,
        name: "Plan de ortodoncia",
        created_at: "2026-08-02T12:00:00Z",
        status: "active",
        total_cents: 150000,
        currency: "CLP",
      },
    ],
    pagos: [
      {
        patient_id: YO,
        paid_at: "2026-08-03T12:00:00Z",
        amount_cents: 50000,
        currency: "CLP",
        method: "transfer",
        method_name_snapshot: null,
        reversed_at: null,
      },
      {
        patient_id: OTRO,
        paid_at: "2026-08-03T12:00:00Z",
        amount_cents: 777,
        currency: "CLP",
        method: "cash",
        method_name_snapshot: null,
        reversed_at: null,
      },
    ],
    documentos: [
      {
        patient_id: YO,
        title: "Certificado de atención",
        year: 2026,
        number: 7,
        issued_at: "2026-09-01T16:00:00Z",
        professional_name_snapshot: "Dra. Rojas",
        voided_at: null,
      },
      {
        patient_id: OTRO,
        title: "Documento de OTRO",
        year: 2026,
        number: 8,
        issued_at: "2026-09-01T16:00:00Z",
        professional_name_snapshot: "Dr. X",
        voided_at: null,
      },
    ],
    consentimientos: [
      {
        patient_id: FUSIONADA,
        title_snapshot: "Consentimiento de extracción",
        signed_at: "2025-03-01T13:30:00Z",
        signed_by_name: "Ana Pérez",
        revoked_at: null,
      },
      {
        patient_id: OTRO,
        title_snapshot: "Consentimiento de OTRO",
        signed_at: "2025-03-01T13:30:00Z",
        signed_by_name: "Otro",
        revoked_at: null,
      },
    ],
    solicitudes: [
      {
        patient_id: YO,
        kind: "rectificacion",
        status: "recibida",
        received_at: "2026-10-20T12:00:00Z",
        responded_at: null,
      },
      {
        patient_id: OTRO,
        kind: "supresion",
        status: "recibida",
        received_at: "2026-10-20T12:00:00Z",
        responded_at: null,
      },
    ],
  };
}

const OPC = {
  clinicaNombre: "Clínica Sonrisa",
  zonaHoraria: "America/Santiago",
  generadoEn: new Date("2026-10-22T15:00:00Z"),
};

describe("descarga de mis datos", () => {
  const datos = armarMisDatos(filas(), [YO, FUSIONADA], OPC);
  const todo = [
    misDatosAJson(datos),
    misDatosACsv(datos),
    JSON.stringify(contenidoPdfMisDatos(datos)),
  ];

  it("nunca trae datos de otro paciente, aunque una consulta los devolviera", () => {
    for (const texto of todo) {
      expect(texto).not.toContain("OTRO");
      expect(texto).not.toContain("P-9999");
      expect(texto).not.toContain("777");
    }
  });

  it("incluye las fichas fusionadas en la suya", () => {
    expect(datos.salud.alergias).toEqual(["Penicilina", "Látex"]);
    expect(datos.citas.map((c) => c.tratamiento)).toEqual(["Control", "Evaluación"]);
    expect(datos.consentimientos).toHaveLength(1);
  });

  it("solo atenciones firmadas, sin el texto de las notas", () => {
    expect(datos.atenciones).toEqual([
      { fecha: "2026-09-01T15:00:00Z", titulo: "Limpieza", profesional: "Dra. Rojas" },
    ]);
  });

  it("no expone el documento de identidad, solo si está registrado", () => {
    expect(datos.paciente.documento_de_identidad).toBe("registrado");
    expect(misDatosAJson(datos)).not.toMatch(/document_id/);
  });

  it("JSON legible por máquina: montos en unidad mínima con su moneda y fechas ISO", () => {
    const json = JSON.parse(misDatosAJson(datos));
    expect(json.formato).toBe("esmalia.mis-datos");
    expect(json.pagos[0]).toEqual({
      fecha: "2026-08-03T12:00:00Z",
      monto_cents: 50000,
      moneda: "CLP",
      medio: "Transferencia",
      anulado: false,
    });
    expect(json.comunicaciones.whatsapp).toEqual({
      recibe: false,
      baja_el: "2026-10-10T12:00:00Z",
    });
  });

  it("CSV con una fila por dato y el monto formateado", () => {
    const csv = misDatosACsv(datos);
    const lineas = csv.trim().split(/\r?\n/);
    expect(lineas[0]).toContain("Sección;Fecha;Descripción;Detalle;Monto");
    expect(csv).toContain("Presupuesto P-0001");
    expect(csv).toContain("Dado de baja");
  });

  it("PDF: el contenido nombra al paciente y explica lo que no trae", () => {
    const pdf = contenidoPdfMisDatos(datos);
    expect(pdf.pacienteNombre).toBe("Ana Pérez Soto");
    expect(pdf.subtitulo).toBe("Tus datos personales");
    expect(pdf.secciones.map((s) => s.titulo)).toContain("Qué no incluye esta copia");
    const alergias = pdf.secciones.find((s) => s.titulo === "Salud (resumen)")!.lineas[0];
    expect(alergias.estilo).toBe("alerta");
  });

  it("rechaza armar la descarga si la ficha no es del paciente del portal", () => {
    expect(() => armarMisDatos(filas(), [OTRO], OPC)).toThrow();
  });
});
