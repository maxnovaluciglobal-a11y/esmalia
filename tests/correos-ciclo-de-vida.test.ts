import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  avisoDeTrialQueCorresponde,
  contarPresupuestosSinSeguimiento,
  elegirAccionSugerida,
  esDestinatarioReservado,
  esLunesLocal,
  normalizarDestinatario,
  semanaAnterior,
  semanaTuvoActividad,
  variacion,
  type DatosSemana,
} from "@/lib/email/ciclo-de-vida";
import {
  correoBienvenida,
  correoFinDePrueba,
  correoPagoFallido,
  correoSemana,
  correoSuscripcionActiva,
} from "@/lib/email/plantillas";

// Correos de ciclo de vida para la clínica (09-oct-2026). Todo puro: estos
// tests no tocan Postgres ni Resend (el CI corre contra la base de producción
// y la tabla lifecycle_emails puede no existir todavía).

const APP = "https://app.esmalia.test";

const semanaBase: DatosSemana = {
  clinicName: "Clínica Sonrisa",
  currency: "CLP",
  semana: { desde: "2026-09-28", hasta: "2026-10-04" },
  cobradoCents: 1_250_000,
  cobradoPrevioCents: 1_000_000,
  citasAgendadas: 40,
  citasAtendidas: 34,
  tasaAsistencia: 85,
  ausencias: 3,
  ausenciasPrevias: 3,
  pacientesNuevos: 5,
  presupuestosCreados: 6,
  presupuestosAceptados: 2,
  conversion: 50,
  morosidad90Cents: 0,
  morosidad90Pacientes: 0,
  presupuestosSinSeguimiento: 0,
};

describe("destinatarios", () => {
  it("descarta dominios reservados y de prueba", () => {
    for (const email of [
      "a@example.com",
      "a@example.org",
      "a@sub.example.net",
      "a@clinica.test",
      "a@x.invalid",
      "a@localhost",
    ]) {
      expect(esDestinatarioReservado(email), email).toBe(true);
      expect(normalizarDestinatario(email), email).toBeNull();
    }
  });

  it("normaliza mayúsculas y espacios", () => {
    expect(normalizarDestinatario("  Dueña@Clinica.CL ")).toBe("dueña@clinica.cl");
    expect(normalizarDestinatario("sin-arroba")).toBeNull();
    expect(normalizarDestinatario(null)).toBeNull();
  });
});

describe("calendario de la clínica", () => {
  it("la semana reportada es el lunes-domingo anterior, en hora local", () => {
    // Lunes 12-oct-2026 09:30 en Santiago (UTC-3) = 12:30 UTC.
    const lunes = new Date("2026-10-12T12:30:00Z");
    expect(esLunesLocal(lunes, "America/Santiago")).toBe(true);
    expect(semanaAnterior(lunes, "America/Santiago")).toEqual({
      desde: "2026-10-05",
      hasta: "2026-10-11",
    });
  });

  it("usa la fecha local, no la del servidor (UTC)", () => {
    // Lunes 01:00 UTC = domingo 22:00 en Santiago: todavía no es lunes allá.
    const momento = new Date("2026-10-12T01:00:00Z");
    expect(esLunesLocal(momento, "UTC")).toBe(true);
    expect(esLunesLocal(momento, "America/Santiago")).toBe(false);
    expect(semanaAnterior(momento, "America/Santiago")).toEqual({
      desde: "2026-09-28",
      hasta: "2026-10-04",
    });
  });

  it("aviso de fin de prueba: T-3 y T-0 por fecha local", () => {
    const sub = {
      status: "trialing",
      trialEnd: "2026-10-15T14:00:00Z",
      stripeSubscriptionId: null,
    };
    expect(
      avisoDeTrialQueCorresponde(sub, new Date("2026-10-12T13:00:00Z"), "America/Santiago"),
    ).toEqual({ kind: "trial_t3", fechaFin: "2026-10-15" });
    expect(
      avisoDeTrialQueCorresponde(sub, new Date("2026-10-15T12:00:00Z"), "America/Santiago"),
    ).toEqual({ kind: "trial_t0", fechaFin: "2026-10-15" });
    expect(
      avisoDeTrialQueCorresponde(sub, new Date("2026-10-13T13:00:00Z"), "America/Santiago"),
    ).toBeNull();
  });

  it("no avisa si ya hay suscripción de Stripe o si no está en prueba", () => {
    const ahora = new Date("2026-10-12T13:00:00Z");
    const trialEnd = "2026-10-15T14:00:00Z";
    expect(
      avisoDeTrialQueCorresponde(
        { status: "trialing", trialEnd, stripeSubscriptionId: "sub_123" },
        ahora,
        "America/Santiago",
      ),
    ).toBeNull();
    expect(
      avisoDeTrialQueCorresponde(
        { status: "active", trialEnd, stripeSubscriptionId: null },
        ahora,
        "America/Santiago",
      ),
    ).toBeNull();
  });
});

describe("reporte semanal: reglas", () => {
  it("variación contra la semana anterior", () => {
    expect(variacion(125, 100)).toEqual({ sentido: "sube", porcentaje: 25 });
    expect(variacion(75, 100)).toEqual({ sentido: "baja", porcentaje: 25 });
    expect(variacion(0, 0)).toEqual({ sentido: "igual", porcentaje: 0 });
    expect(variacion(50, 0)).toEqual({ sentido: "sin_base", porcentaje: null });
  });

  it("sin actividad no hay correo", () => {
    expect(semanaTuvoActividad(semanaBase)).toBe(true);
    expect(
      semanaTuvoActividad({
        ...semanaBase,
        cobradoCents: null,
        citasAgendadas: 0,
        pacientesNuevos: 0,
        presupuestosCreados: 0,
      }),
    ).toBe(false);
  });

  it("una sola acción sugerida, en orden fijo", () => {
    expect(elegirAccionSugerida(semanaBase)).toBeNull();
    const todas = {
      ...semanaBase,
      presupuestosSinSeguimiento: 3,
      ausencias: 6,
      ausenciasPrevias: 2,
      morosidad90Pacientes: 4,
    };
    expect(elegirAccionSugerida(todas)?.regla).toBe("presupuestos_sin_seguimiento");
    expect(elegirAccionSugerida({ ...todas, presupuestosSinSeguimiento: 0 })?.regla).toBe(
      "ausencias_en_alza",
    );
    expect(
      elegirAccionSugerida({ ...todas, presupuestosSinSeguimiento: 0, ausencias: 2 })?.regla,
    ).toBe("morosidad_90");
    // Una sola ausencia más no es "alza".
    expect(elegirAccionSugerida({ ...semanaBase, ausencias: 1, ausenciasPrevias: 0 })).toBeNull();
  });

  it("presupuestos sin seguimiento: mismo criterio que /recordatorios (7 y 14 días)", () => {
    const ahora = new Date("2026-10-12T12:00:00Z");
    const presupuestos = [
      { id: "viejo", sentAt: "2026-09-30T12:00:00Z" },
      { id: "reciente", sentAt: "2026-10-09T12:00:00Z" },
      { id: "con-seguimiento", sentAt: "2026-09-20T12:00:00Z" },
      { id: "seguimiento-viejo", sentAt: "2026-09-01T12:00:00Z" },
      { id: "sin-envio", sentAt: null },
    ];
    const seguimientos = new Map([
      ["con-seguimiento", "2026-10-05T12:00:00Z"],
      ["seguimiento-viejo", "2026-09-15T12:00:00Z"],
    ]);
    expect(contarPresupuestosSinSeguimiento(presupuestos, seguimientos, ahora)).toBe(2);
  });
});

const VOSEO =
  /(?<!\p{L})(?:revisá|volvé|tenés|podés|querés|necesitás|elegí|escribí|cargá|confirmá|mirá|hacé|agregá|respondé|entrá|invitá|importá|agendá|actualizá)(?!\p{L})/iu;
const EMOJI = /\p{Extended_Pictographic}/u;

function revisarTono(nombre: string, correo: { subject: string; html: string; text: string }) {
  for (const parte of [correo.subject, correo.text]) {
    expect(parte, `${nombre}: sin signos de exclamación`).not.toMatch(/[!¡]/);
    expect(parte, `${nombre}: sin voseo`).not.toMatch(VOSEO);
    expect(parte, `${nombre}: sin emoji`).not.toMatch(EMOJI);
  }
}

function revisarLayout(nombre: string, correo: { html: string; text: string }) {
  expect(correo.html, nombre).toContain(
    `<img src="${APP}/brand/esmalia-wordmark-email.png" width="150" height="42" alt="Esmalia"`,
  );
  expect(correo.html, nombre).toContain("Esmalia · software para clínicas dentales");
  expect(correo.html, nombre).toContain("MAXNOVA &amp; LUCI Global LLC");
  expect(correo.text, nombre).toContain("MAXNOVA & LUCI Global LLC");
  expect(correo.html, nombre).not.toContain("<svg");
}

describe("plantillas", () => {
  it("bienvenida: 14 días sin tarjeta, primeros pasos con enlaces y CTA", () => {
    const c = correoBienvenida({
      appUrl: APP,
      clinicName: "Clínica <Sonrisa>",
      nombre: "Ana María Pérez",
      finDePrueba: "2026-10-23",
      diasDePrueba: 14,
    });
    expect(c.subject).toBe("Tu clínica ya está en Esmalia");
    expect(c.text).toContain("Hola, Ana.");
    expect(c.text).toContain("14 días");
    expect(c.text).toContain("sin ingresar una tarjeta");
    expect(c.text).toContain("23 de octubre");
    // No promete "usarlo completo": 3 funciones se activan con la llamada (CS-02).
    expect(c.text).not.toMatch(/completo/i);
    expect(c.text).toContain("llamada de puesta en marcha");
    expect(c.html).toContain(`${APP}/profesionales`);
    expect(c.html).toContain(`${APP}/pacientes`);
    expect(c.html).toContain(`${APP}/equipo`);
    expect(c.html).toContain(`${APP}/agenda`);
    expect(c.text).toContain("Entrar a Esmalia");
    expect(c.text).toContain("responde este correo");
    // El nombre de la clínica se escapa: nada de HTML inyectado.
    expect(c.html).toContain("Clínica &lt;Sonrisa&gt;");
    expect(c.html).not.toContain("<Sonrisa>");
    // Transaccional: sin enlace de baja.
    expect(c.text).not.toMatch(/baja/i);
    revisarTono("bienvenida", c);
    revisarLayout("bienvenida", c);
  });

  it("fin de prueba T-3 abre con un dato real y dice que no se cobra antes", () => {
    const c = correoFinDePrueba({
      appUrl: APP,
      clinicName: "Clínica Sonrisa",
      cuando: "t3",
      finDePrueba: "2026-10-15",
      citasAgendadas: 42,
      pacientesCargados: 120,
    });
    expect(c.subject).toBe("Tu prueba de Esmalia termina en 3 días");
    const cuerpo = c.text.split("\n").slice(2).join("\n");
    expect(cuerpo.indexOf("42 citas")).toBeLessThan(cuerpo.indexOf("Elegir un plan"));
    expect(c.text).toContain("No se cobra nada antes de esa fecha");
    expect(c.text).toContain("jueves 15 de octubre");
    expect(c.html).toContain(`${APP}/suscripcion`);
    revisarTono("t3", c);
    revisarLayout("t3", c);
  });

  it("fin de prueba T-0 dice qué sigue funcionando y qué queda en pausa", () => {
    const c = correoFinDePrueba({
      appUrl: APP,
      clinicName: "Clínica Sonrisa",
      cuando: "t0",
      finDePrueba: "2026-10-15",
      citasAgendadas: 0,
      pacientesCargados: 0,
    });
    expect(c.subject).toBe("Tu prueba de Esmalia termina hoy");
    expect(c.text).toContain("Todavía no hay citas ni pacientes");
    expect(c.text).toContain("siguen funcionando igual");
    expect(c.text).toContain("quedan en pausa");
    revisarTono("t0", c);
  });

  it("suscripción activa usa formatMoney con la moneda", () => {
    const c = correoSuscripcionActiva({
      appUrl: APP,
      clinicName: "Clínica Sonrisa",
      plan: "Clínica",
      montoCents: 6900,
      currency: "USD",
      intervalo: "mes",
      proximoCobro: "2026-11-09",
    });
    expect(c.text).toContain("$69.00 USD");
    expect(c.text).toContain("al mes");
    expect(c.text).toContain("9 de noviembre");
    revisarTono("activa", c);
    revisarLayout("activa", c);
  });

  it("pago fallido explica qué pasa mientras tanto y lleva a Suscripción", () => {
    const c = correoPagoFallido({
      appUrl: APP,
      clinicName: "Clínica Sonrisa",
      montoCents: 29000,
      currency: "CLP",
      proximoIntento: null,
    });
    expect(c.subject).toBe("No pudimos cobrar tu suscripción a Esmalia");
    expect(c.text).toContain("$29.000 CLP");
    expect(c.text).toContain("tu equipo sigue usando la agenda");
    expect(c.text).toContain("Gestionar facturación");
    expect(c.html).toContain(`${APP}/suscripcion`);
    expect(c.text).not.toContain("volverá a intentar");
    revisarTono("pago fallido", c);
  });

  it("reporte semanal: cifra principal con flecha, tabla y baja visible", () => {
    const c = correoSemana({
      appUrl: APP,
      datos: { ...semanaBase, presupuestosSinSeguimiento: 2 },
      bajaUrl: `${APP}/correos/baja?token=abc`,
    });
    expect(c.subject).toBe("Tu semana en Clínica Sonrisa: $1.250.000 cobrados");
    expect(c.text).toContain("↑ 25\u00a0% frente a la semana anterior ($1.000.000)");
    expect(c.text).toContain("lunes 28 de septiembre al domingo 4 de octubre");
    expect(c.text).toContain("2 presupuestos esperan seguimiento");
    expect(c.html).toContain(`${APP}/recordatorios`);
    expect(c.html).toContain(`${APP}/correos/baja?token=abc`);
    expect(c.text).toContain("Dejar de recibir este resumen");
    revisarTono("semana", c);
    revisarLayout("semana", c);
  });

  it("reporte semanal: sin pagos registrados dice Sin datos y explica, no inventa ceros", () => {
    const c = correoSemana({
      appUrl: APP,
      datos: {
        ...semanaBase,
        cobradoCents: null,
        cobradoPrevioCents: null,
        tasaAsistencia: null,
        conversion: null,
      },
      bajaUrl: `${APP}/correos/baja?token=abc`,
    });
    expect(c.text).toContain("Cobrado en la semana: Sin datos");
    expect(c.text).toContain("Todavía no registras pagos");
    expect(c.text).toContain("Asistencia: Sin datos");
    expect(c.text).toContain("conversión: sin datos");
    expect(c.text).not.toContain("$0");
    expect(c.subject).toBe("Tu semana en Clínica Sonrisa: 34 citas atendidas");
    revisarTono("semana sin pagos", c);
  });
});

describe("token de baja", () => {
  it("firma y verifica; rechaza un token alterado o de otra audiencia", async () => {
    const { firmarTokenDeBaja, verificarTokenDeBaja } =
      await import("@/lib/email/baja-token.server");
    const token = await firmarTokenDeBaja(
      "11111111-1111-1111-1111-111111111111",
      "reporte_semanal",
    );
    expect(await verificarTokenDeBaja(token)).toEqual({
      userId: "11111111-1111-1111-1111-111111111111",
      grupo: "reporte_semanal",
    });
    expect(await verificarTokenDeBaja(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(await verificarTokenDeBaja("no-es-un-token")).toBeNull();

    // Un token del portal del paciente no sirve como baja.
    const { signPortalToken } = await import("@/lib/patients/portal-token.server");
    const portal = await signPortalToken({ patientId: "p", clinicId: "c" });
    expect(await verificarTokenDeBaja(portal)).toBeNull();
  });
});

describe("sendClinicEmail: frenos antes de tocar la base", () => {
  const original = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...original };
  });

  const correo = {
    clinicId: "c1",
    kind: "welcome" as const,
    periodKey: "once",
    to: "duena@clinica.cl",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
  };

  it("con el interruptor apagado no hace nada", async () => {
    delete process.env.LIFECYCLE_EMAILS_ENABLED;
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const admin = { from: vi.fn() };
    expect(await sendClinicEmail(correo, admin as never)).toEqual({ status: "disabled" });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("nunca intenta dominios reservados", async () => {
    process.env.LIFECYCLE_EMAILS_ENABLED = "true";
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const admin = { from: vi.fn() };
    const r = await sendClinicEmail({ ...correo, to: "demo@example.com" }, admin as never);
    expect(r.status).toBe("skipped");
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("un correo opcional sin enlace de baja no sale", async () => {
    process.env.LIFECYCLE_EMAILS_ENABLED = "true";
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Esmalia <hola@esmalia.com>";
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const admin = { from: vi.fn() };
    const r = await sendClinicEmail(
      { ...correo, kind: "weekly_report", userId: "u1" },
      admin as never,
    );
    expect(r).toEqual({ status: "skipped", reason: "correo opcional sin enlace de baja" });
    expect(admin.from).not.toHaveBeenCalled();
  });
});

describe("sendClinicEmail: idempotencia y modo de prueba", () => {
  const original = { ...process.env };
  const enviados: Record<string, unknown>[] = [];

  beforeEach(() => {
    vi.resetModules();
    enviados.length = 0;
    vi.doMock("resend", () => ({
      Resend: class {
        emails = {
          send: async (payload: Record<string, unknown>) => {
            enviados.push(payload);
            return { data: { id: "re_1" }, error: null };
          },
        };
      },
    }));
    process.env.LIFECYCLE_EMAILS_ENABLED = "true";
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Esmalia <hola@esmalia.com>";
  });
  afterEach(() => {
    vi.doUnmock("resend");
    process.env = { ...original };
  });

  /** Cliente falso mínimo: responde según la tabla y la operación. */
  function adminFalso(opciones: {
    isDemo?: boolean;
    insertError?: { code: string; message: string } | null;
    previa?: { id: string; status: string; attempts: number } | null;
    preferencias?: { email_enabled: boolean; unsubscribed_at: string | null } | null;
  }) {
    const updates: Record<string, unknown>[] = [];
    const inserts: Record<string, unknown>[] = [];
    const from = (tabla: string) => {
      let op = "select";
      const q: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        insert: (fila: Record<string, unknown>) => {
          op = "insert";
          inserts.push(fila);
          return chain;
        },
        update: (fila: Record<string, unknown>) => {
          op = "update";
          updates.push(fila);
          return chain;
        },
        maybeSingle: async () => {
          if (tabla === "clinics")
            return { data: { is_demo: opciones.isDemo ?? false }, error: null };
          if (tabla === "notification_preferences")
            return { data: opciones.preferencias ?? null, error: null };
          if (tabla === "lifecycle_emails" && op === "insert")
            return opciones.insertError
              ? { data: null, error: opciones.insertError }
              : { data: { id: "fila-1" }, error: null };
          if (tabla === "lifecycle_emails") return { data: opciones.previa ?? null, error: null };
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: op === "update" ? [{ id: "fila-1" }] : [], error: null }),
      };
      void q;
      return chain;
    };
    return { cliente: { from } as never, updates, inserts };
  }

  const correo = {
    clinicId: "c1",
    kind: "welcome" as const,
    periodKey: "once",
    to: "Duena@Clinica.cl",
    userId: "u1",
    subject: "Tu clínica ya está en Esmalia",
    html: "<p>h</p>",
    text: "t",
  };

  it("envía, reclama la fila antes y la marca como enviada", async () => {
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const a = adminFalso({});
    const r = await sendClinicEmail(correo, a.cliente);
    expect(r.status).toBe("sent");
    expect(a.inserts[0]).toMatchObject({ status: "pending", recipient: "duena@clinica.cl" });
    expect(a.updates.at(-1)).toMatchObject({ status: "sent", provider_id: "re_1" });
    expect(enviados[0]).toMatchObject({ to: "duena@clinica.cl", text: "t" });
    expect(enviados[0]).not.toHaveProperty("headers");
  });

  it("si la fila ya existe y no es un error reintentable, no envía de nuevo", async () => {
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const a = adminFalso({
      insertError: { code: "23505", message: "duplicate" },
      previa: { id: "fila-1", status: "sent", attempts: 1 },
    });
    expect(await sendClinicEmail(correo, a.cliente)).toEqual({ status: "duplicate" });
    expect(enviados).toHaveLength(0);
  });

  it("si la tabla no existe todavía, no envía (sin registro no hay garantía)", async () => {
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const a = adminFalso({
      insertError: { code: "PGRST205", message: "Could not find the table" },
    });
    const r = await sendClinicEmail(correo, a.cliente);
    expect(r.status).toBe("skipped");
    expect(enviados).toHaveLength(0);
  });

  it("la clínica demo nunca recibe", async () => {
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const r = await sendClinicEmail(correo, adminFalso({ isDemo: true }).cliente);
    expect(r).toEqual({ status: "skipped", reason: "clínica demo" });
    expect(enviados).toHaveLength(0);
  });

  it("modo de prueba: redirige y deja el destinatario original en el asunto", async () => {
    process.env.LIFECYCLE_EMAIL_REDIRECT_TO = "walter@esmalia.com";
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const r = await sendClinicEmail(correo, adminFalso({}).cliente);
    expect(r).toMatchObject({ status: "sent", redirectedTo: "walter@esmalia.com" });
    expect(enviados[0]).toMatchObject({
      to: "walter@esmalia.com",
      subject: "[PRUEBA → duena@clinica.cl] Tu clínica ya está en Esmalia",
    });
  });

  it("el reporte semanal respeta la baja y lleva List-Unsubscribe de un clic", async () => {
    const { sendClinicEmail } = await import("@/lib/email/envio.server");
    const semanal = {
      ...correo,
      kind: "weekly_report" as const,
      periodKey: "2026-10-05",
      unsubscribeUrl: "https://app.esmalia.test/api/correos/baja?token=abc",
    };
    const dadoDeBaja = await sendClinicEmail(
      semanal,
      adminFalso({ preferencias: { email_enabled: true, unsubscribed_at: "2026-10-01" } }).cliente,
    );
    expect(dadoDeBaja.status).toBe("skipped");
    expect(enviados).toHaveLength(0);

    const ok = await sendClinicEmail(semanal, adminFalso({}).cliente);
    expect(ok.status).toBe("sent");
    expect(enviados[0]).toMatchObject({
      headers: {
        "List-Unsubscribe": "<https://app.esmalia.test/api/correos/baja?token=abc>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  });
});
