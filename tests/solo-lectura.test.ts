import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sentry.server", () => ({ capturarErrorDelServidor: vi.fn(async () => {}) }));

import { informesBloqueados, type Subscription } from "@/lib/billing";
import {
  esCitaEnCurso,
  esErrorSoloLectura,
  MENSAJE_SOLO_LECTURA,
  soloLectura,
  SOLO_LECTURA_EN_PRUEBA_VENCIDA,
} from "@/lib/solo-lectura";
import {
  clinicaDeLaFila,
  exigirEscritura,
  exigirEscrituraDeNotaClinica,
  MENSAJE_SIN_CLINICA,
} from "@/lib/solo-lectura.server";

/**
 * Lógica del modo solo lectura (BIL-01). Pura: la base se simula con un
 * cliente falso que responde según la tabla, sin red ni Postgres.
 */

const AHORA = new Date("2026-10-19T15:00:00.000Z");
const CLINICA = "11111111-1111-4111-8111-111111111111";
const PACIENTE = "22222222-2222-4222-8222-222222222222";
const NOTA = "33333333-3333-4333-8333-333333333333";
const H = 60 * 60 * 1000;

function sub(parcial: Partial<Subscription>): Subscription {
  return {
    clinicId: CLINICA,
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_1",
    trialEnd: null,
    currentPeriodEnd: new Date(AHORA.getTime() + 20 * 24 * H).toISOString(),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    ...parcial,
  };
}

function filaSub(parcial: Record<string, unknown>) {
  return {
    clinic_id: CLINICA,
    status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    stripe_price_id: "price_1",
    trial_end: null,
    current_period_end: new Date(AHORA.getTime() + 20 * 24 * H).toISOString(),
    cancel_at_period_end: false,
    past_due_since: null,
    ...parcial,
  };
}

const FILA_MOROSA = filaSub({
  status: "past_due",
  past_due_since: new Date(AHORA.getTime() - 10 * 24 * H).toISOString(),
});

type Respuesta = { data: unknown; error: unknown };

/** Cliente falso: cada tabla responde lo configurado, a `maybeSingle` o al `await` de la lista. */
function clienteFalso(tablas: Record<string, Respuesta>) {
  const consultas: Array<{ tabla: string; filtros: unknown[][] }> = [];
  const cliente = {
    from(tabla: string) {
      const registro = { tabla, filtros: [] as unknown[][] };
      consultas.push(registro);
      const resp = tablas[tabla] ?? { data: null, error: null };
      const builder = {
        select: () => builder,
        eq: (...a: unknown[]) => (registro.filtros.push(["eq", ...a]), builder),
        lte: (...a: unknown[]) => (registro.filtros.push(["lte", ...a]), builder),
        gte: (...a: unknown[]) => (registro.filtros.push(["gte", ...a]), builder),
        limit: () => builder,
        maybeSingle: async () => resp,
        then: (ok: (r: Respuesta) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(resp).then(ok, ko),
      };
      return builder;
    },
  };
  return { cliente: cliente as never, consultas };
}

describe("soloLectura (qué estados bloquean la escritura)", () => {
  it("al día, en prueba vigente o sin fila (piloto): se escribe", () => {
    expect(soloLectura(sub({}), AHORA)).toBe(false);
    expect(soloLectura(null, AHORA)).toBe(false);
    expect(soloLectura(undefined, AHORA)).toBe(false);
    expect(
      soloLectura(
        sub({
          status: "trialing",
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          trialEnd: new Date(AHORA.getTime() + 3 * 24 * H).toISOString(),
        }),
        AHORA,
      ),
    ).toBe(false);
  });

  it("durante la gracia de cobro fallido (7 días) todo sigue abierto", () => {
    const pastDueSince = new Date(AHORA.getTime() - 6 * 24 * H).toISOString();
    expect(soloLectura(sub({ status: "past_due", pastDueSince }), AHORA)).toBe(false);
    // Sin fecha (migración sin aplicar): gracia.
    expect(soloLectura(sub({ status: "past_due", pastDueSince: null }), AHORA)).toBe(false);
  });

  it("gracia agotada, cancelada, impaga o vencida tras haber pagado: solo lectura", () => {
    const pastDueSince = new Date(AHORA.getTime() - 8 * 24 * H).toISOString();
    expect(soloLectura(sub({ status: "past_due", pastDueSince }), AHORA)).toBe(true);
    expect(soloLectura(sub({ status: "canceled" }), AHORA)).toBe(true);
    expect(soloLectura(sub({ status: "unpaid" }), AHORA)).toBe(true);
    expect(soloLectura(sub({ status: "paused" }), AHORA)).toBe(true);
    // Período pagado vencido sin renovar (pasada la tolerancia de 72 h).
    const vencido = new Date(AHORA.getTime() - 4 * 24 * H).toISOString();
    expect(soloLectura(sub({ currentPeriodEnd: vencido }), AHORA)).toBe(true);
  });

  it("la prueba gratis vencida sin pago NO entra (interruptor apagado): solo se pausan los informes", () => {
    expect(SOLO_LECTURA_EN_PRUEBA_VENCIDA).toBe(false);
    const pruebaVencida = sub({
      status: "trialing",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      trialEnd: new Date(AHORA.getTime() - H).toISOString(),
    });
    expect(soloLectura(pruebaVencida, AHORA)).toBe(false);
    expect(informesBloqueados(pruebaVencida, AHORA)).toBe(true);
  });
});

describe("esCitaEnCurso (criterio de urgencia clínica)", () => {
  const cita = (inicioH: number, finH: number, status = "confirmada") => ({
    starts_at: new Date(AHORA.getTime() + inicioH * H).toISOString(),
    ends_at: new Date(AHORA.getTime() + finH * H).toISOString(),
    status,
  });

  it("dentro de la cita, 30 min antes y hasta 2 h después: sí", () => {
    expect(esCitaEnCurso(cita(-0.5, 0.5), AHORA)).toBe(true);
    expect(esCitaEnCurso(cita(0.5, 1), AHORA)).toBe(true);
    expect(esCitaEnCurso(cita(-3, -1), AHORA)).toBe(true);
    expect(esCitaEnCurso(cita(-1, 0, "en-sala"), AHORA)).toBe(true);
    expect(esCitaEnCurso(cita(-2, -1, "finalizada"), AHORA)).toBe(true);
  });

  it("muy temprano, muy tarde, cancelada o ausente: no", () => {
    expect(esCitaEnCurso(cita(1, 2), AHORA)).toBe(false);
    expect(esCitaEnCurso(cita(-4, -2.5), AHORA)).toBe(false);
    expect(esCitaEnCurso(cita(-0.5, 0.5, "cancelada"), AHORA)).toBe(false);
    expect(esCitaEnCurso(cita(-0.5, 0.5, "ausente"), AHORA)).toBe(false);
  });
});

describe("exigirEscritura (el chequeo central del servidor)", () => {
  it("deja pasar a una clínica al día", async () => {
    const { cliente } = clienteFalso({ subscriptions: { data: filaSub({}), error: null } });
    await expect(exigirEscritura(cliente, CLINICA, { ahora: AHORA })).resolves.toBeUndefined();
  });

  it("rechaza a una clínica en solo lectura con el mensaje que explica qué hacer", async () => {
    const { cliente, consultas } = clienteFalso({
      subscriptions: { data: FILA_MOROSA, error: null },
    });
    const intento = exigirEscritura(cliente, CLINICA, { ahora: AHORA });
    await expect(intento).rejects.toThrow(MENSAJE_SOLO_LECTURA);
    await intento.catch((e) => expect(esErrorSoloLectura(e)).toBe(true));
    expect(consultas[0]).toMatchObject({
      tabla: "subscriptions",
      filtros: [["eq", "clinic_id", CLINICA]],
    });
  });

  it("sin fila de suscripción (piloto) o si la lectura falla, no bloquea", async () => {
    const sinFila = clienteFalso({ subscriptions: { data: null, error: null } });
    await expect(exigirEscritura(sinFila.cliente, CLINICA, { ahora: AHORA })).resolves.toBe(
      undefined,
    );
    const conError = clienteFalso({ subscriptions: { data: null, error: { message: "boom" } } });
    await expect(exigirEscritura(conError.cliente, CLINICA, { ahora: AHORA })).resolves.toBe(
      undefined,
    );
  });

  it("la excepción solo se consulta en solo lectura y, si aplica, deja pasar", async () => {
    const excepcion = vi.fn(async () => true);
    const alDia = clienteFalso({ subscriptions: { data: filaSub({}), error: null } });
    await exigirEscritura(alDia.cliente, CLINICA, { ahora: AHORA, excepcion });
    expect(excepcion).not.toHaveBeenCalled();

    const morosa = clienteFalso({ subscriptions: { data: FILA_MOROSA, error: null } });
    await expect(
      exigirEscritura(morosa.cliente, CLINICA, { ahora: AHORA, excepcion }),
    ).resolves.toBeUndefined();
    expect(excepcion).toHaveBeenCalledOnce();
  });
});

describe("exigirEscrituraDeNotaClinica (urgencia: nota de una cita en curso)", () => {
  const citaAhora = {
    starts_at: new Date(AHORA.getTime() - 0.5 * H).toISOString(),
    ends_at: new Date(AHORA.getTime() + 0.5 * H).toISOString(),
    status: "confirmada",
  };

  it("en solo lectura, con cita en curso del paciente: se puede escribir la nota", async () => {
    const { cliente, consultas } = clienteFalso({
      subscriptions: { data: FILA_MOROSA, error: null },
      appointments: { data: [citaAhora], error: null },
    });
    await expect(
      exigirEscrituraDeNotaClinica(cliente, { clinicId: CLINICA, patientRef: PACIENTE }, AHORA),
    ).resolves.toBeUndefined();
    const citas = consultas.find((c) => c.tabla === "appointments");
    expect(citas?.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "clinic_id", CLINICA],
        ["eq", "patient_id", PACIENTE],
      ]),
    );
  });

  it("en solo lectura, sin cita en curso: se rechaza", async () => {
    const { cliente } = clienteFalso({
      subscriptions: { data: FILA_MOROSA, error: null },
      appointments: { data: [], error: null },
    });
    await expect(
      exigirEscrituraDeNotaClinica(cliente, { clinicId: CLINICA, patientRef: PACIENTE }, AHORA),
    ).rejects.toThrow(MENSAJE_SOLO_LECTURA);
  });

  it("con una nota existente manda la nota, no el patientRef que diga el input", async () => {
    const OTRO = "44444444-4444-4444-8444-444444444444";
    const { cliente, consultas } = clienteFalso({
      clinical_notes: { data: { clinic_id: CLINICA, patient_ref: OTRO }, error: null },
      subscriptions: { data: FILA_MOROSA, error: null },
      appointments: { data: [], error: null },
    });
    await expect(
      exigirEscrituraDeNotaClinica(
        cliente,
        { clinicId: CLINICA, patientRef: PACIENTE, noteId: NOTA },
        AHORA,
      ),
    ).rejects.toThrow(MENSAJE_SOLO_LECTURA);
    const citas = consultas.find((c) => c.tabla === "appointments");
    expect(citas?.filtros).toContainEqual(["eq", "patient_id", OTRO]);
  });

  it("firmar (solo noteId) resuelve clínica y paciente desde la nota", async () => {
    const { cliente } = clienteFalso({
      clinical_notes: { data: { clinic_id: CLINICA, patient_ref: PACIENTE }, error: null },
      subscriptions: { data: FILA_MOROSA, error: null },
      appointments: { data: [citaAhora], error: null },
    });
    await expect(exigirEscrituraDeNotaClinica(cliente, { noteId: NOTA }, AHORA)).resolves.toBe(
      undefined,
    );
  });

  it("sin clínica identificable, falla cerrada", async () => {
    const { cliente } = clienteFalso({});
    await expect(exigirEscrituraDeNotaClinica(cliente, { noteId: NOTA }, AHORA)).rejects.toThrow(
      MENSAJE_SIN_CLINICA,
    );
  });
});

describe("clinicaDeLaFila", () => {
  it("lee clinic_id de la fila por id", async () => {
    const { cliente, consultas } = clienteFalso({
      appointments: { data: { clinic_id: CLINICA }, error: null },
    });
    await expect(clinicaDeLaFila(cliente, "appointments", PACIENTE)).resolves.toBe(CLINICA);
    expect(consultas[0].filtros).toEqual([["eq", "id", PACIENTE]]);
  });
});
