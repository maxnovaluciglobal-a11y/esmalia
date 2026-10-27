import { describe, expect, it } from "vitest";

import {
  cambiosDeContacto,
  EnvioFormularioSchema,
  fusionarAnamnesis,
  listaDesdeTexto,
} from "@/lib/notificaciones-pacientes/formulario";
import {
  correoConfirmacion,
  correoEncuesta,
  correoRecordatorio,
  type DatosDeLaCita,
} from "@/lib/notificaciones-pacientes/plantillas";
import {
  CONFIG_APAGADA,
  categoriaNps,
  correspondeConfirmacion,
  correspondeEncuesta,
  franjaDeRecordatorio,
  GuardarConfigSchema,
  leerConfig,
  llevaFormulario,
  normalizarHoras,
  resumenNps,
  type CitaParaCorreo,
  type ConfigNotificaciones,
} from "@/lib/notificaciones-pacientes/reglas";

/**
 * Ola 7 · frente B: correos automáticos al paciente, reglas puras (no tocan
 * Postgres ni Resend). Los frenos contra la base (idempotencia, sandbox,
 * baja, tutor, aislamiento) están en `correos-pacientes-db.test.ts`.
 */

const H = 3_600_000;
const AHORA = new Date("2026-10-28T15:00:00Z"); // 12:00 en Santiago

function cita(over: Partial<CitaParaCorreo> = {}): CitaParaCorreo {
  return {
    id: "c1",
    status: "tentativa",
    starts_at: new Date(AHORA.getTime() + 20 * H).toISOString(),
    ends_at: new Date(AHORA.getTime() + 20.5 * H).toISOString(),
    created_at: new Date(AHORA.getTime() - 10 * 24 * H).toISOString(),
    reminders_muted: false,
    ...over,
  };
}

const ENCENDIDA: ConfigNotificaciones = {
  ...CONFIG_APAGADA,
  confirmacion: true,
  confirmacionDesde: new Date(AHORA.getTime() - 30 * 24 * H).toISOString(),
  recordatorio: true,
  horasRecordatorio: [24, 2],
  encuesta: true,
  encuestaDesde: new Date(AHORA.getTime() - 30 * 24 * H).toISOString(),
  horasEncuesta: 3,
};

describe("configuración (REC-07)", () => {
  it("sin fila, todo apagado", () => {
    expect(leerConfig(null)).toEqual(CONFIG_APAGADA);
  });

  it("las horas se ordenan de mayor a menor, sin repetir y hasta dos", () => {
    expect(normalizarHoras([2, 24, 24, 48])).toEqual([48, 24]);
    expect(normalizarHoras([0, 80, 3])).toEqual([3]);
  });

  it("valida el link de reseña y la coherencia del formulario", () => {
    const base = {
      clinicId: "00000000-0000-4000-8000-000000000001",
      confirmacion: true,
      recordatorio: false,
      horasRecordatorio: [24],
      formulario: "confirmation" as const,
      encuesta: true,
      horasEncuesta: 3,
      resenaGoogleUrl: "",
    };
    expect(GuardarConfigSchema.safeParse(base).success).toBe(true);
    expect(GuardarConfigSchema.parse(base).resenaGoogleUrl).toBeNull();
    expect(
      GuardarConfigSchema.safeParse({ ...base, resenaGoogleUrl: "http://g.page/x" }).success,
    ).toBe(false);
    expect(
      GuardarConfigSchema.safeParse({ ...base, resenaGoogleUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    // Formulario en el recordatorio con el recordatorio apagado: no.
    expect(GuardarConfigSchema.safeParse({ ...base, formulario: "reminder" }).success).toBe(false);
    expect(GuardarConfigSchema.safeParse({ ...base, horasRecordatorio: [] }).success).toBe(false);
    expect(GuardarConfigSchema.safeParse({ ...base, horasRecordatorio: [1, 2, 3] }).success).toBe(
      false,
    );
  });
});

describe("confirmación al agendar (REC-03)", () => {
  const nueva = cita({ created_at: new Date(AHORA.getTime() - H).toISOString() });

  it("sale para una cita futura recién creada", () => {
    expect(correspondeConfirmacion(nueva, ENCENDIDA, AHORA)).toBe(true);
  });

  it("no sale apagada, ni para una cita creada antes de encenderla", () => {
    expect(correspondeConfirmacion(nueva, CONFIG_APAGADA, AHORA)).toBe(false);
    const recien = { ...ENCENDIDA, confirmacionDesde: AHORA.toISOString() };
    expect(correspondeConfirmacion(nueva, recien, AHORA)).toBe(false);
  });

  it("no le escribe a una cita vieja ni a una que empieza en menos de una hora", () => {
    expect(correspondeConfirmacion(cita(), ENCENDIDA, AHORA)).toBe(false);
    const yaMismo = { ...nueva, starts_at: new Date(AHORA.getTime() + 0.5 * H).toISOString() };
    expect(correspondeConfirmacion(yaMismo, ENCENDIDA, AHORA)).toBe(false);
  });

  it("no confirma citas importadas en silencio ni canceladas", () => {
    expect(correspondeConfirmacion({ ...nueva, reminders_muted: true }, ENCENDIDA, AHORA)).toBe(
      false,
    );
    expect(correspondeConfirmacion({ ...nueva, status: "cancelada" }, ENCENDIDA, AHORA)).toBe(
      false,
    );
  });
});

describe("recordatorio (REC-02)", () => {
  const faltan = (h: number) =>
    cita({ starts_at: new Date(AHORA.getTime() + h * H).toISOString() });

  it("cada franja tiene su ventana y no se pisan", () => {
    expect(franjaDeRecordatorio(faltan(30), ENCENDIDA, AHORA)).toBeNull();
    expect(franjaDeRecordatorio(faltan(24), ENCENDIDA, AHORA)).toBe(24);
    expect(franjaDeRecordatorio(faltan(10), ENCENDIDA, AHORA)).toBe(24);
    expect(franjaDeRecordatorio(faltan(2), ENCENDIDA, AHORA)).toBe(2);
    expect(franjaDeRecordatorio(faltan(1), ENCENDIDA, AHORA)).toBe(2);
    // Menos de 30 min (la cuarta parte de 2 h): ya no sirve.
    expect(franjaDeRecordatorio(faltan(0.4), ENCENDIDA, AHORA)).toBeNull();
  });

  it("una cita creada adentro de la ventana no recibe ese recordatorio", () => {
    const c = cita({
      starts_at: new Date(AHORA.getTime() + 10 * H).toISOString(),
      created_at: new Date(AHORA.getTime() - 1 * H).toISOString(),
    });
    expect(franjaDeRecordatorio(c, ENCENDIDA, AHORA)).toBeNull();
  });

  it("apagado, importada sin recordatorios o cancelada: nada", () => {
    expect(franjaDeRecordatorio(faltan(10), CONFIG_APAGADA, AHORA)).toBeNull();
    expect(
      franjaDeRecordatorio({ ...faltan(10), reminders_muted: true }, ENCENDIDA, AHORA),
    ).toBeNull();
    expect(
      franjaDeRecordatorio({ ...faltan(10), status: "cancelada" }, ENCENDIDA, AHORA),
    ).toBeNull();
  });
});

describe("encuesta (MKT-08)", () => {
  const terminada = (horasAtras: number) =>
    cita({
      status: "finalizada",
      starts_at: new Date(AHORA.getTime() - (horasAtras + 0.5) * H).toISOString(),
      ends_at: new Date(AHORA.getTime() - horasAtras * H).toISOString(),
    });

  it("sale pasadas las horas configuradas y hasta 72 h después", () => {
    expect(correspondeEncuesta(terminada(2), ENCENDIDA, AHORA)).toBe(false);
    expect(correspondeEncuesta(terminada(3), ENCENDIDA, AHORA)).toBe(true);
    expect(correspondeEncuesta(terminada(70), ENCENDIDA, AHORA)).toBe(true);
    expect(correspondeEncuesta(terminada(80), ENCENDIDA, AHORA)).toBe(false);
  });

  it("solo citas finalizadas y terminadas después de encenderla", () => {
    expect(correspondeEncuesta({ ...terminada(5), status: "ausente" }, ENCENDIDA, AHORA)).toBe(
      false,
    );
    const recien = { ...ENCENDIDA, encuestaDesde: AHORA.toISOString() };
    expect(correspondeEncuesta(terminada(5), recien, AHORA)).toBe(false);
  });

  it("promotores, pasivos y detractores", () => {
    expect(categoriaNps(10)).toBe("promotor");
    expect(categoriaNps(9)).toBe("promotor");
    expect(categoriaNps(8)).toBe("pasivo");
    expect(categoriaNps(7)).toBe("pasivo");
    expect(categoriaNps(6)).toBe("detractor");
    expect(categoriaNps(0)).toBe("detractor");
  });

  it("el NPS sin respuestas es null, nunca un cero inventado", () => {
    expect(resumenNps([]).nps).toBeNull();
    expect(resumenNps([{ score: null }]).nps).toBeNull();
    const r = resumenNps([
      { score: 10 },
      { score: 9 },
      { score: 8 },
      { score: 3 },
      { score: null },
    ]);
    expect(r).toMatchObject({
      enviadas: 5,
      respuestas: 4,
      promotores: 2,
      pasivos: 1,
      detractores: 1,
      nps: 25,
      tasaRespuesta: 80,
    });
  });
});

describe("formulario antes de la cita (MKT-07)", () => {
  it("va en el correo configurado", () => {
    const c = { ...ENCENDIDA, formulario: "reminder" as const };
    expect(llevaFormulario("reminder", c)).toBe(true);
    expect(llevaFormulario("confirmation", c)).toBe(false);
    expect(llevaFormulario("reminder", { ...c, formulario: "off" })).toBe(false);
  });

  it("solo propone los datos de contacto que cambian", () => {
    const cambios = cambiosDeContacto(
      { email: "ana@correo.cl", phone: "+56 9 1111 1111", address: null },
      { email: "ANA@correo.cl", phone: "+56 9 2222 2222", address: "Av. Siempre Viva 742", x: 1 },
    );
    expect(cambios.map((c) => c.campo)).toEqual(["phone", "address"]);
    expect(cambios[0]).toMatchObject({ antes: "+56 9 1111 1111", despues: "+56 9 2222 2222" });
  });

  it("suma a la anamnesis sin borrar lo que ya estaba", () => {
    const f = fusionarAnamnesis(
      {
        allergies: ["Penicilina"],
        allergy_details: [{ name: "Penicilina", severity: "severe" }],
        chronic_medications: ["Losartán 50 mg"],
        risk_questionnaire: { diabetes: { answer: "no" }, tobacco: { answer: "yes" } },
      },
      {
        cuestionario: { diabetes: { answer: "yes", detail: "tipo 2" }, clave_rara: {} },
        alergias: ["penicilina", "Látex"],
        medicacion: ["Metformina"],
      },
    );
    expect(f.allergies).toEqual(["Penicilina", "Látex"]);
    // La severidad que ya estaba se conserva; la nueva entra sin especificar.
    expect(f.allergy_details).toEqual([
      { name: "Penicilina", severity: "severe" },
      { name: "Látex", severity: "unknown" },
    ]);
    expect(f.chronic_medications).toEqual(["Losartán 50 mg", "Metformina"]);
    expect(f.risk_questionnaire).toEqual({
      diabetes: { answer: "yes", detail: "tipo 2" },
      tobacco: { answer: "yes" },
    });
  });

  it("lee listas escritas a mano y valida el envío", () => {
    expect(listaDesdeTexto("penicilina, látex\nLátex;  ibuprofeno ")).toEqual([
      "penicilina",
      "látex",
      "ibuprofeno",
    ]);
    const token = "a".repeat(43);
    const ok = EnvioFormularioSchema.safeParse({
      token,
      contacto: { email: "Ana@Correo.cl", phone: "" },
      cuestionario: { diabetes: { answer: "yes" } },
      alergias: [],
      medicacion: [],
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.contacto).toEqual({ email: "ana@correo.cl" });
    expect(
      EnvioFormularioSchema.safeParse({
        token: "corto",
        contacto: {},
        cuestionario: {},
        alergias: [],
        medicacion: [],
      }).success,
    ).toBe(false);
    expect(
      EnvioFormularioSchema.safeParse({
        token,
        contacto: { email: "no-es-correo" },
        cuestionario: {},
        alergias: [],
        medicacion: [],
      }).success,
    ).toBe(false);
  });
});

describe("plantillas", () => {
  const base: DatosDeLaCita = {
    appUrl: "https://esmalia.com",
    clinica: "Clínica Sonrisa",
    zona: "America/Santiago",
    startsAt: "2026-10-29T13:30:00Z",
    profesional: "Dra. Paula Rojas",
    sucursal: "Providencia",
    direccion: "Av. Providencia 1234",
    paciente: "Ana Pérez Soto",
    para: "paciente",
    nombreTutor: null,
    enlaceGestion: "https://esmalia.com/mi-cita/abc",
    enlaceFormulario: null,
    bajaUrl: "https://esmalia.com/correos/baja?token=x",
  };

  it("la confirmación lleva fecha local, botones y baja; nunca el tratamiento", () => {
    const c = correoConfirmacion(base);
    expect(c.subject).toBe("Tu cita en Clínica Sonrisa está agendada");
    expect(c.text).toContain("10:30"); // 13:30 UTC en Santiago (UTC-3)
    expect(c.html).toContain("Confirmar asistencia");
    expect(c.html).toContain("Cancelar o reagendar");
    expect(c.html).toContain("https://esmalia.com/mi-cita/abc");
    expect(c.html).toContain("correos/baja");
    expect(c.text).toContain("No quiero recibir más correos de Clínica Sonrisa");
  });

  it("sin el enlace del frente A, sale sin botones y con la indicación de siempre", () => {
    const c = correoConfirmacion({ ...base, enlaceGestion: null });
    expect(c.html).not.toContain("Confirmar asistencia");
    expect(c.text).toContain("avísale a la clínica");
  });

  it("al tutor: saluda al tutor y dice de quién es la cita", () => {
    const c = correoRecordatorio({
      ...base,
      para: "tutor",
      nombreTutor: "Carla Soto",
      horasAntes: 24,
      enlaceFormulario: "https://esmalia.com/formulario/tok",
    });
    expect(c.text).toContain("Hola, Carla:");
    expect(c.subject).toContain("la cita de Ana");
    expect(c.html).toContain("https://esmalia.com/formulario/tok");
    expect(c.text).toContain("como tutor");
  });

  it("la encuesta lleva su link y escapa el nombre de la clínica", () => {
    const c = correoEncuesta({
      appUrl: "https://esmalia.com",
      clinica: "Dental <b>Uno</b>",
      zona: "America/Santiago",
      startsAt: "2026-10-27T13:30:00Z",
      paciente: "Ana",
      para: "paciente",
      nombreTutor: null,
      enlaceEncuesta: "https://esmalia.com/encuesta/tok",
      bajaUrl: "https://esmalia.com/correos/baja?token=x",
    });
    expect(c.html).toContain("https://esmalia.com/encuesta/tok");
    expect(c.html).not.toContain("<b>Uno</b>");
    expect(c.html).toContain("&lt;b&gt;Uno&lt;/b&gt;");
  });
});
