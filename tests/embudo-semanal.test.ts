import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  armarReporte,
  calcularMetricas,
  etiquetaDeSemana,
  leadsPorOrigen,
  rangoDeLaSemana,
  semanaReportada,
  tocaEnviar,
  variacion,
  type DatosDelReporte,
  type EventoDeMedicion,
  type EventoDeStripe,
} from "@/lib/marketing/embudo-semanal";

const RANGO = rangoDeLaSemana("2026-10-26");
const DENTRO = "2026-10-28T15:00:00Z";
const FUERA = "2026-10-20T15:00:00Z";

const evento = (
  name: string,
  props: Record<string, unknown> = {},
  session_hash: string | null = "s1",
  created_at = DENTRO,
): EventoDeMedicion => ({ name, props, session_hash, created_at });

const stripe = (
  type: string,
  object: Record<string, unknown>,
  previous_attributes: Record<string, unknown> = {},
  extra: Partial<EventoDeStripe> & { livemode?: boolean } = {},
): EventoDeStripe => ({
  type,
  clinic_id: extra.clinic_id === undefined ? "c1" : extra.clinic_id,
  received_at: extra.received_at ?? DENTRO,
  raw: { livemode: extra.livemode ?? true, data: { object, previous_attributes } },
});

const base = { eventos: [], stripe: [], clinicasActivas: 0, clinicasInternas: new Set<string>() };

describe("semana del reporte", () => {
  it("el lunes reporta la semana que terminó el domingo", () => {
    expect(semanaReportada(new Date("2026-11-02T15:12:00Z"))).toBe("2026-10-26");
  });

  it("usa el día de Chile, no el de UTC", () => {
    // Lunes 01:00 UTC = domingo en Chile: todavía no terminó la semana del 26-oct.
    expect(semanaReportada(new Date("2026-11-02T01:00:00Z"))).toBe("2026-10-19");
  });

  it("el rango va de medianoche a medianoche en Chile, con horario de verano", () => {
    expect(rangoDeLaSemana("2026-10-26")).toEqual({
      desde: "2026-10-26T03:00:00.000Z",
      hasta: "2026-11-02T03:00:00.000Z",
    });
    expect(rangoDeLaSemana("2026-07-06").desde).toBe("2026-07-06T04:00:00.000Z");
  });

  it("solo envía los lunes de 12:00 a 16:59 en Chile", () => {
    expect(tocaEnviar(new Date("2026-11-02T14:59:00Z"))).toBe(false);
    expect(tocaEnviar(new Date("2026-11-02T15:12:00Z"))).toBe(true);
    expect(tocaEnviar(new Date("2026-11-02T19:59:00Z"))).toBe(true);
    expect(tocaEnviar(new Date("2026-11-02T20:00:00Z"))).toBe(false);
    expect(tocaEnviar(new Date("2026-11-03T15:12:00Z"))).toBe(false);
  });

  it("cruza el mes en la etiqueta, como el correo de MOY IQ", () => {
    expect(etiquetaDeSemana("2026-10-26")).toBe("26 oct al 1 nov de 2026");
  });
});

describe("variacion", () => {
  it("formatea subidas, bajadas y sin cambio", () => {
    expect(variacion(3, 2)).toBe("+1 (+50 %)");
    expect(variacion(3, 5)).toBe("−2 (−40 %)");
    expect(variacion(0, 0)).toBe("sin cambio");
    expect(variacion(4, 0)).toBe("+4");
  });
});

describe("calcularMetricas", () => {
  it("cuenta sesiones únicas y excluye lo interno y lo de otra semana", () => {
    const m = calcularMetricas(
      {
        ...base,
        eventos: [
          evento("page_view", {}, "s1"),
          evento("page_view", {}, "s1"),
          evento("page_view", {}, "s2"),
          evento("page_view", { interno: true }, "s3"),
          evento("page_view", {}, "s4", FUERA),
          evento("registro_completado"),
          evento("registro_completado", { interno: true }),
        ],
      },
      RANGO,
    );
    expect(m.visitas).toBe(2);
    expect(m.altas).toBe(1);
  });

  it("una suscripción en prueba no es un pago", () => {
    const m = calcularMetricas(
      {
        ...base,
        eventos: [evento("suscripcion_activada", { estado: "trialing" })],
        stripe: [stripe("customer.subscription.created", { status: "trialing" })],
      },
      RANGO,
    );
    expect(m.pruebas).toBe(1);
    expect(m.pagos).toBe(0);
  });

  it("cuenta el paso de prueba a pago y la compra directa, una vez por clínica", () => {
    const m = calcularMetricas(
      {
        ...base,
        stripe: [
          stripe("customer.subscription.updated", { status: "active" }, { status: "trialing" }),
          stripe("customer.subscription.created", { status: "active" }),
          stripe("customer.subscription.created", { status: "active" }, {}, { clinic_id: "c2" }),
        ],
      },
      RANGO,
    );
    expect(m.pagos).toBe(2);
  });

  it("una renovación no es un pago nuevo", () => {
    const m = calcularMetricas(
      {
        ...base,
        stripe: [
          stripe("customer.subscription.updated", { status: "active" }, { current_period_end: 1 }),
        ],
      },
      RANGO,
    );
    expect(m.pagos).toBe(0);
  });

  it("ignora Stripe en modo de prueba y las clínicas internas", () => {
    const m = calcularMetricas(
      {
        ...base,
        clinicasInternas: new Set(["c9"]),
        stripe: [
          stripe("customer.subscription.created", { status: "active" }, {}, { livemode: false }),
          stripe("customer.subscription.created", { status: "active" }, {}, { clinic_id: "c9" }),
          stripe("customer.subscription.deleted", {}, {}, { clinic_id: "c9" }),
        ],
      },
      RANGO,
    );
    expect(m.pagos).toBe(0);
    expect(m.bajas).toBe(0);
  });

  it("una baja pedida y aplicada en la misma semana cuenta una vez", () => {
    const m = calcularMetricas(
      {
        ...base,
        stripe: [
          stripe(
            "customer.subscription.updated",
            { cancel_at_period_end: true },
            { cancel_at_period_end: false },
          ),
          stripe("customer.subscription.deleted", {}),
        ],
      },
      RANGO,
    );
    expect(m.bajas).toBe(1);
  });
});

describe("leadsPorOrigen", () => {
  it("cuenta contactos únicos y deja afuera los correos internos", () => {
    const filas = leadsPorOrigen(
      [
        { source: "demo", email: "A@clinica.cl", consent_at: DENTRO, created_at: DENTRO },
        { source: "demo", email: "a@clinica.cl", consent_at: null, created_at: DENTRO },
        { source: "demo", email: "b@clinica.cl", consent_at: null, created_at: DENTRO },
        { source: "demo", email: "interna@esmalia.com", consent_at: null, created_at: DENTRO },
        { source: "guia", email: "c@clinica.cl", consent_at: null, created_at: FUERA },
      ],
      RANGO,
      (email) => email.endsWith("@esmalia.com"),
    );
    expect(filas).toEqual([{ origen: "demo", emails: 2, conConsentimiento: 1 }]);
  });
});

describe("armarReporte", () => {
  const datos: DatosDelReporte = {
    semana: "2026-10-26",
    actual: { visitas: 74, altas: 1, activas: 0, pruebas: 1, pagos: 0, bajas: 1 },
    anterior: { visitas: 67, altas: 0, activas: 0, pruebas: 0, pagos: 0, bajas: 0 },
    leads: [{ origen: "<demo>", emails: 2, conConsentimiento: 1 }],
    leadsAnterior: [{ origen: "<demo>", emails: 1, conConsentimiento: 1 }],
  };

  it("tiene el asunto del de MOY IQ y las seis filas, en HTML y en texto", () => {
    const correo = armarReporte(datos, { appUrl: "https://esmalia.com" });
    expect(correo.subject).toBe("Esmalia · embudo semanal · 26 oct al 1 nov de 2026");
    for (const titulo of ["Visitas al sitio", "Altas", "Clínicas activas", "Pagos", "Bajas"]) {
      expect(correo.html).toContain(titulo);
      expect(correo.text).toContain(titulo);
    }
    expect(correo.text).toContain(
      "Visitas al sitio: Semana: 74 · Anterior: 67 · Variación: +7 (+10 %)",
    );
  });

  it("marca la vista previa y escapa el origen", () => {
    const correo = armarReporte(datos, { appUrl: "https://esmalia.com", vistaPrevia: true });
    expect(correo.subject.startsWith("[Vista previa] ")).toBe(true);
    expect(correo.html).toContain("&lt;demo&gt;");
    expect(correo.html).not.toContain("<demo>");
  });

  it("una baja que sube se pinta como mala y una visita que sube, como buena", () => {
    const { html } = armarReporte(datos, { appUrl: "https://esmalia.com" });
    expect(html).toMatch(/color:#3b6b3f;">\+7 \(\+10 %\)/);
    expect(html).toMatch(/color:#9c2c1c;">\+1</);
  });

  it("avisa cuando no hubo leads", () => {
    const correo = armarReporte(
      { ...datos, leads: [], leadsAnterior: [] },
      { appUrl: "https://esmalia.com" },
    );
    expect(correo.text).toContain("Sin leads nuevos esta semana.");
  });
});

describe("programación", () => {
  it("Vercel Cron cubre la ventana de Chile en verano y en invierno", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const cron = vercel.crons.find((c) => c.path === "/api/embudo-semanal");
    expect(cron?.schedule).toBe("12 15-20 * * 1");
  });
});
