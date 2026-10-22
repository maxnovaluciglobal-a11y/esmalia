import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  agruparPorPaciente,
  agruparRecordatorios,
  cubrirPorPacienteYDia,
  despacharEnSerie,
  unirConY,
  variablesDeRecordatorio,
  visitaPendienteDeResena,
  type RecordatorioDeCita,
} from "@/lib/messaging/recordatorios-agrupados";
import { calcularPresupuestosSinRespuesta } from "@/lib/messaging/presupuestos-sin-respuesta";

let n = 0;
function cita(cambios: Partial<RecordatorioDeCita> = {}): RecordatorioDeCita {
  n += 1;
  return {
    appointmentId: `a${n}`,
    patientId: "p1",
    patientName: "Ana Pérez",
    patientPhone: "+56911111111",
    patientEmail: "ana@example.com",
    treatmentLabel: "Limpieza",
    professionalName: "Dra. Rojas",
    startsAt: "2026-10-23T13:00:00Z",
    fechaLarga: "jueves, 23 de octubre",
    hora: "10:00",
    diaLocal: "2026-10-23",
    reminderKind: "appointment_reminder",
    whatsappSent: false,
    emailSent: false,
    ...cambios,
  };
}

describe("unirConY", () => {
  it("une sin repetir", () => {
    expect(unirConY(["a"])).toBe("a");
    expect(unirConY(["a", "b"])).toBe("a y b");
    expect(unirConY(["a", "b", "a", "c"])).toBe("a, b y c");
    expect(unirConY([])).toBe("");
  });
});

describe("agruparRecordatorios: una fila por paciente, un mensaje por día", () => {
  it("dos citas el mismo día van en un solo envío con las horas juntas", () => {
    const { recordatorio48h, aviso3h } = agruparRecordatorios([
      cita({ startsAt: "2026-10-23T18:30:00Z", hora: "15:30", treatmentLabel: "Control" }),
      cita(),
    ]);
    expect(aviso3h).toEqual([]);
    expect(recordatorio48h).toHaveLength(1);
    const [envio] = recordatorio48h[0].envios;
    expect(envio.citas).toHaveLength(2);
    // La principal es la primera del día.
    expect(envio.principal.hora).toBe("10:00");
    expect(variablesDeRecordatorio(envio, "Clínica Sol")).toEqual({
      tratamiento: "Limpieza y Control",
      fecha_larga: "jueves, 23 de octubre",
      hora: "10:00 y 15:30",
      profesional: "Dra. Rojas",
      clinica: "Clínica Sol",
    });
  });

  it("un paciente con aviso de 3h y recordatorio de 48h aparece una vez, en la sección más urgente", () => {
    const { aviso3h, recordatorio48h } = agruparRecordatorios([
      cita({ diaLocal: "2026-10-23", startsAt: "2026-10-23T13:00:00Z" }),
      cita({
        diaLocal: "2026-10-21",
        startsAt: "2026-10-21T15:00:00Z",
        reminderKind: "appointment_checkin",
      }),
    ]);
    expect(recordatorio48h).toEqual([]);
    expect(aviso3h).toHaveLength(1);
    expect(aviso3h[0].envios.map((e) => e.kind)).toEqual([
      "appointment_checkin",
      "appointment_reminder",
    ]);
  });

  it("pacientes distintos son filas distintas; el canal ya enviado o sin dato no queda pendiente", () => {
    const { recordatorio48h } = agruparRecordatorios([
      cita({ patientId: "p1", whatsappSent: true }),
      cita({ patientId: "p2", patientName: "Beto", patientEmail: null }),
    ]);
    expect(recordatorio48h.map((f) => f.patientId)).toEqual(["p1", "p2"]);
    expect(recordatorio48h[0].envios[0]).toMatchObject({
      whatsappPendiente: false,
      emailPendiente: true,
    });
    expect(recordatorio48h[1].envios[0]).toMatchObject({
      whatsappPendiente: true,
      emailPendiente: false,
    });
  });

  it("sin teléfono (baja de WhatsApp) no hay WhatsApp pendiente aunque otra cita lo tenga", () => {
    const { recordatorio48h } = agruparRecordatorios([
      cita({ patientPhone: null }),
      cita({ startsAt: "2026-10-23T19:00:00Z", hora: "16:00" }),
    ]);
    expect(recordatorio48h[0].patientPhone).toBeNull();
    expect(recordatorio48h[0].envios[0].whatsappPendiente).toBe(false);
  });
});

describe("cubrirPorPacienteYDia (servidor)", () => {
  it("un recordatorio de 48h ya enviado cubre las otras citas de ese día, por canal", () => {
    const filas = [cita({ appointmentId: "tarde" })];
    const resultado = cubrirPorPacienteYDia(filas, [
      {
        patientId: "p1",
        diaLocal: "2026-10-23",
        kind: "appointment_reminder",
        channel: "whatsapp",
      },
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({ whatsappSent: true, emailSent: false });
  });

  it("con los dos canales cubiertos la fila desaparece", () => {
    const filas = [cita()];
    expect(
      cubrirPorPacienteYDia(filas, [
        {
          patientId: "p1",
          diaLocal: "2026-10-23",
          kind: "appointment_reminder",
          channel: "whatsapp",
        },
        { patientId: "p1", diaLocal: "2026-10-23", kind: "appointment_reminder", channel: "email" },
      ]),
    ).toEqual([]);
  });

  it("un aviso de 3h cubre los recordatorios de 48h del mismo día, no al revés", () => {
    const recordatorio = cita();
    const aviso = cita({ reminderKind: "appointment_checkin" });
    const cubiertoPorAviso = cubrirPorPacienteYDia(
      [recordatorio],
      [{ patientId: "p1", diaLocal: "2026-10-23", kind: "appointment_checkin", channel: "email" }],
    );
    expect(cubiertoPorAviso[0].emailSent).toBe(true);
    const noCubierto = cubrirPorPacienteYDia(
      [aviso],
      [{ patientId: "p1", diaLocal: "2026-10-23", kind: "appointment_reminder", channel: "email" }],
    );
    expect(noCubierto[0].emailSent).toBe(false);
  });

  it("otro día u otro paciente no cubren nada", () => {
    const filas = [cita()];
    const enviados = [
      {
        patientId: "p1",
        diaLocal: "2026-10-24",
        kind: "appointment_reminder" as const,
        channel: "whatsapp" as const,
      },
      {
        patientId: "p2",
        diaLocal: "2026-10-23",
        kind: "appointment_reminder" as const,
        channel: "whatsapp" as const,
      },
    ];
    expect(cubrirPorPacienteYDia(filas, enviados)[0].whatsappSent).toBe(false);
  });
});

describe("agruparPorPaciente (outreach y presupuestos)", () => {
  it("39 pedidos de reseña con pacientes repetidos son una fila por paciente, en orden", () => {
    const items = Array.from({ length: 39 }, (_, i) => ({
      patientId: `p${i % 13}`,
      appointmentId: `a${i}`,
    }));
    const grupos = agruparPorPaciente(items);
    expect(grupos).toHaveLength(13);
    expect(grupos[0]).toMatchObject({ patientId: "p0", principal: { appointmentId: "a0" } });
    expect(grupos[0].items.map((i) => i.appointmentId)).toEqual(["a0", "a13", "a26"]);
  });
});

describe("visitaPendienteDeResena", () => {
  it("un pedido posterior a la visita la cubre; uno anterior no", () => {
    expect(visitaPendienteDeResena("2026-10-10T15:00:00Z", undefined)).toBe(true);
    expect(visitaPendienteDeResena("2026-10-10T15:00:00Z", "2026-10-12T12:00:00Z")).toBe(false);
    expect(visitaPendienteDeResena("2026-10-15T15:00:00Z", "2026-10-12T12:00:00Z")).toBe(true);
  });
});

describe("presupuestos: cooldown por paciente", () => {
  const DIA = 24 * 60 * 60 * 1000;
  const ahora = Date.parse("2026-10-21T12:00:00Z");
  const base = {
    patientId: "p1",
    status: "sent" as const,
    totalCents: 100_000,
    currency: "CLP",
    sentAt: new Date(ahora - 20 * DIA).toISOString(),
    createdAt: new Date(ahora - 20 * DIA).toISOString(),
    validUntil: null,
    acceptedAt: null,
  };
  const args = {
    presupuestos: [
      { ...base, id: "q1", number: "12" },
      { ...base, id: "q2", number: "15" },
    ],
    pacientes: [
      {
        id: "p1",
        fullName: "Ana",
        phone: "+56911111111",
        email: null,
        waOptIn: true,
        waOptOutAt: null,
      },
    ],
    ultimoSeguimientoPorPresupuesto: new Map([["q1", new Date(ahora - 2 * DIA).toISOString()]]),
    ahora,
    hoy: "2026-10-21",
    dias: 7,
  };

  it("sin el mapa por paciente, el otro presupuesto sigue apareciendo (comportamiento previo)", () => {
    expect(calcularPresupuestosSinRespuesta(args).map((q) => q.quoteId)).toEqual(["q2"]);
  });

  it("con un seguimiento reciente al paciente, ninguno de sus presupuestos vuelve", () => {
    expect(
      calcularPresupuestosSinRespuesta({
        ...args,
        ultimoSeguimientoPorPaciente: new Map([["p1", new Date(ahora - 2 * DIA).toISOString()]]),
      }),
    ).toEqual([]);
  });
});

describe("despacharEnSerie (tanda de emails)", () => {
  it("manda de a uno con pausa, sigue si uno falla y respeta la cancelación", async () => {
    const pausas: number[] = [];
    const enviados: string[] = [];
    const r = await despacharEnSerie(
      ["a", "b", "c"],
      async (x) => {
        if (x === "b") throw new Error("rebotó");
        enviados.push(x);
        return x;
      },
      { pausaMs: 600, esperar: async (ms) => void pausas.push(ms) },
    );
    expect(enviados).toEqual(["a", "c"]);
    expect(pausas).toEqual([600, 600]);
    expect(r).toMatchObject({ enviados: 2, cancelado: false });
    expect(r.fallidos).toEqual([{ item: "b", error: "rebotó" }]);

    let cancelar = false;
    const parcial = await despacharEnSerie(
      ["a", "b", "c"],
      async (x) => {
        cancelar = true;
        return x;
      },
      { pausaMs: 0, cancelado: () => cancelar },
    );
    expect(parcial).toMatchObject({ enviados: 1, cancelado: true });
  });
});

describe("invariantes de envío", () => {
  it("la tanda no envía por su cuenta: usa los mismos server functions que cortan baja y demo", () => {
    const fuente = readFileSync(
      new URL("../src/components/recordatorios/enviar-todos.tsx", import.meta.url),
      "utf8",
    );
    expect(fuente).toMatch(/sendWhatsAppFromTemplate/);
    expect(fuente).toMatch(/sendEmailFromTemplate/);
    expect(fuente).not.toMatch(/setInterval|cron/i);
    const servidor = readFileSync(
      new URL("../src/lib/messaging/messaging.functions.ts", import.meta.url),
      "utf8",
    );
    const envio = servidor.slice(servidor.indexOf("export const sendWhatsAppFromTemplate"));
    expect(envio).toMatch(/motivoParaNoEnviarWhatsApp/);
    expect(envio).toMatch(/assertNotDemoClinic/);
  });
});
