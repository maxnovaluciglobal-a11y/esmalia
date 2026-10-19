import { describe, expect, it } from "vitest";
import {
  accesoPorSuscripcion,
  GRACIA_PAGO_FALLIDO_DIAS,
  informesBloqueados,
  isSubscriptionActive,
  requiereLlamadaOSuscripcion,
  trialDaysLeft,
  trialInformesBloqueados,
  TRIAL_DAYS,
  type Subscription,
} from "@/lib/billing";

const base: Subscription = {
  clinicId: "c1",
  status: "trialing",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

const enDias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe("isSubscriptionActive", () => {
  it("un trial vigente está activo", () => {
    expect(isSubscriptionActive({ ...base, trialEnd: enDias(5) })).toBe(true);
  });

  it("un trial VENCIDO ya no está activo aunque no haya currentPeriodEnd", () => {
    // Bug original: la función sólo miraba currentPeriodEnd, así que un trial
    // con trial_end pasado y current_period_end null nunca vencía.
    expect(isSubscriptionActive({ ...base, trialEnd: enDias(-1) })).toBe(false);
  });

  it("sin suscripción no está activa", () => {
    expect(isSubscriptionActive(null)).toBe(false);
  });

  it("una suscripción activa con período vigente sigue activa", () => {
    expect(isSubscriptionActive({ ...base, status: "active", currentPeriodEnd: enDias(20) })).toBe(
      true,
    );
  });

  it("una cancelada no está activa", () => {
    expect(isSubscriptionActive({ ...base, status: "canceled" })).toBe(false);
  });
});

/**
 * Auditoría 360 (FN-04): un webhook de renovación atrasado no puede dejar
 * afuera a un cliente al día. 72 h de margen sobre las fechas que mueve Stripe.
 */
describe("isSubscriptionActive: tolerancia de 72 h", () => {
  const ahora = new Date("2026-10-19T12:00:00Z");
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();

  it("renovación atrasada dentro de las 72 h: sigue activa", () => {
    expect(
      isSubscriptionActive({ ...base, status: "active", currentPeriodEnd: hace(1) }, ahora),
    ).toBe(true);
    expect(
      isSubscriptionActive({ ...base, status: "active", currentPeriodEnd: hace(71) }, ahora),
    ).toBe(true);
  });

  it("pasadas las 72 h sin renovación: ya no está activa", () => {
    expect(
      isSubscriptionActive({ ...base, status: "active", currentPeriodEnd: hace(72) }, ahora),
    ).toBe(false);
    expect(
      isSubscriptionActive({ ...base, status: "active", currentPeriodEnd: hace(100) }, ahora),
    ).toBe(false);
  });

  it("trial gestionado por Stripe: misma tolerancia (el paso a active llega por webhook)", () => {
    const conStripe = { ...base, stripeSubscriptionId: "sub_1" };
    expect(isSubscriptionActive({ ...conStripe, trialEnd: hace(10) }, ahora)).toBe(true);
    expect(isSubscriptionActive({ ...conStripe, trialEnd: hace(73) }, ahora)).toBe(false);
  });

  it("trial de la base (sin Stripe): vence en punto, no hay webhook que esperar", () => {
    expect(isSubscriptionActive({ ...base, trialEnd: hace(1) }, ahora)).toBe(false);
  });
});

describe("trialInformesBloqueados", () => {
  it("no bloquea a las clínicas sin fila de suscripción", () => {
    // Las clínicas piloto existentes tienen sub === null y no se tocan.
    expect(trialInformesBloqueados(null)).toBe(false);
  });

  it("no bloquea durante el trial", () => {
    expect(trialInformesBloqueados({ ...base, trialEnd: enDias(3) })).toBe(false);
  });

  it("bloquea cuando el trial venció y no hay tarjeta", () => {
    expect(trialInformesBloqueados({ ...base, trialEnd: enDias(-1) })).toBe(true);
  });

  it("no bloquea si ya puso tarjeta, aunque el trial haya vencido", () => {
    expect(
      trialInformesBloqueados({
        ...base,
        trialEnd: enDias(-1),
        stripeSubscriptionId: "sub_123",
      }),
    ).toBe(false);
  });

  it("no bloquea a una suscripción activa", () => {
    expect(trialInformesBloqueados({ ...base, status: "active" })).toBe(false);
  });
});

describe("trialDaysLeft", () => {
  it("cuenta los días que faltan", () => {
    expect(trialDaysLeft({ ...base, trialEnd: enDias(7) })).toBe(7);
  });

  it("nunca devuelve negativo", () => {
    expect(trialDaysLeft({ ...base, trialEnd: enDias(-5) })).toBe(0);
  });
});

describe("TRIAL_DAYS", () => {
  it("es la única fuente de verdad de la duración", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});

/**
 * Auditoría 360 (18-oct-2026), BIL-01. Reemplaza a `debeExpulsarDeLaApp`:
 * ningún estado de la suscripción expulsa de la app ni cierra la ficha
 * clínica. Lo que cambia es si los informes quedan pausados y qué aviso se ve.
 */
describe("accesoPorSuscripcion", () => {
  const ahora = new Date("2026-10-19T12:00:00Z");
  const haceDias = (d: number) => new Date(ahora.getTime() - d * 86_400_000).toISOString();
  const acceso = (sub: Subscription | null) => accesoPorSuscripcion(sub, ahora);

  it("sub === null: completo (clínicas piloto sin fila no se tocan)", () => {
    expect(acceso(null)).toEqual({ nivel: "completo" });
  });

  it("trial vigente y suscripción activa: completo", () => {
    expect(acceso({ ...base, trialEnd: haceDias(-5) })).toEqual({ nivel: "completo" });
    expect(acceso({ ...base, status: "active", currentPeriodEnd: haceDias(-20) })).toEqual({
      nivel: "completo",
    });
  });

  it("past_due recién empezado: gracia con los 7 días por delante", () => {
    expect(acceso({ ...base, status: "past_due", pastDueSince: haceDias(0) })).toEqual({
      nivel: "gracia",
      diasRestantes: GRACIA_PAGO_FALLIDO_DIAS,
    });
  });

  it("past_due hace 6 días: sigue en gracia, queda 1 día", () => {
    expect(acceso({ ...base, status: "past_due", pastDueSince: haceDias(6) })).toEqual({
      nivel: "gracia",
      diasRestantes: 1,
    });
  });

  it("past_due hace 7 días o más: restringido por pago (informes pausados)", () => {
    expect(acceso({ ...base, status: "past_due", pastDueSince: haceDias(7) })).toEqual({
      nivel: "restringido",
      motivo: "pago",
    });
    expect(acceso({ ...base, status: "past_due", pastDueSince: haceDias(30) })).toEqual({
      nivel: "restringido",
      motivo: "pago",
    });
  });

  it("past_due sin fecha (migración sin aplicar): gracia sin cuenta regresiva", () => {
    expect(acceso({ ...base, status: "past_due" })).toEqual({
      nivel: "gracia",
      diasRestantes: null,
    });
  });

  it("cancelada (reembolso, disputa, fin de reintentos) o impaga: restringido, nunca expulsión", () => {
    for (const status of ["canceled", "unpaid", "paused", "incomplete"] as const) {
      expect(acceso({ ...base, status })).toEqual({ nivel: "restringido", motivo: "pago" });
    }
  });

  it("trial de la base vencido sin tarjeta: restringido por trial", () => {
    expect(acceso({ ...base, trialEnd: haceDias(1) })).toEqual({
      nivel: "restringido",
      motivo: "trial_vencido",
    });
  });

  it("renovación atrasada dentro de las 72 h: completo", () => {
    expect(acceso({ ...base, status: "active", currentPeriodEnd: haceDias(2) })).toEqual({
      nivel: "completo",
    });
  });

  it("período vencido hace más de 72 h: restringido", () => {
    expect(acceso({ ...base, status: "active", currentPeriodEnd: haceDias(4) }).nivel).toBe(
      "restringido",
    );
  });
});

describe("informesBloqueados", () => {
  const ahora = new Date("2026-10-19T12:00:00Z");
  const haceDias = (d: number) => new Date(ahora.getTime() - d * 86_400_000).toISOString();

  it("durante la gracia los informes siguen abiertos", () => {
    expect(
      informesBloqueados({ ...base, status: "past_due", pastDueSince: haceDias(3) }, ahora),
    ).toBe(false);
  });

  it("agotada la gracia se pausan", () => {
    expect(
      informesBloqueados({ ...base, status: "past_due", pastDueSince: haceDias(8) }, ahora),
    ).toBe(true);
  });

  it("cubre el caso de siempre: trial vencido sin tarjeta", () => {
    expect(informesBloqueados({ ...base, trialEnd: haceDias(1) }, ahora)).toBe(true);
  });

  it("nunca bloquea a quien no tiene fila", () => {
    expect(informesBloqueados(null, ahora)).toBe(false);
  });
});

/**
 * Gate de WhatsApp automático / portal del paciente / efectividad — Walter,
 * 09-sep-2026: "forzar la llamada". A diferencia de `trialInformesBloqueados`
 * (por tiempo, día 15+), este aplica desde el día 1: bloqueado mientras esté
 * en trial y no haya agendado la llamada. Dos salidas reales, nunca las dos
 * a la vez (OR): agendar (`onboardingCallAt` seteado) o suscribirse
 * (`status` deja de ser "trialing").
 */
describe("requiereLlamadaOSuscripcion", () => {
  it("bloquea en trial sin llamada agendada", () => {
    expect(requiereLlamadaOSuscripcion({ ...base, trialEnd: enDias(10) }, null)).toBe(true);
  });

  it("no bloquea en trial con llamada agendada", () => {
    expect(requiereLlamadaOSuscripcion({ ...base, trialEnd: enDias(10) }, enDias(-1))).toBe(false);
  });

  it("no bloquea a una suscripción activa, aunque no haya agendado nunca", () => {
    expect(requiereLlamadaOSuscripcion({ ...base, status: "active" }, null)).toBe(false);
  });

  it("no bloquea a una suscripción vencida/impaga — eso lo maneja accesoPorSuscripcion, no este gate", () => {
    expect(requiereLlamadaOSuscripcion({ ...base, status: "past_due" }, null)).toBe(false);
    expect(requiereLlamadaOSuscripcion({ ...base, status: "canceled" }, null)).toBe(false);
  });

  it("un trial vencido sin agendar sigue bloqueado (no se abre solo por pasar el tiempo, a diferencia de trialInformesBloqueados)", () => {
    expect(requiereLlamadaOSuscripcion({ ...base, trialEnd: enDias(-1) }, null)).toBe(true);
  });

  it("sub === null no bloquea — las clínicas piloto sin fila de suscripción no se tocan", () => {
    expect(requiereLlamadaOSuscripcion(null, null)).toBe(false);
  });
});

/**
 * BIL-04 (auditoría 360): antes, `trialInformesBloqueados` devolvía false con
 * `stripeSubscriptionId` (billing.ts) y la clínica que había apretado
 * "Activar" sin tarjeta terminaba EXPULSADA al vencer la prueba, mientras que
 * la que nunca tocó el botón solo perdía los informes. Ahora las dos quedan
 * igual.
 */
describe("activar sin tarjeta no deja peor que no activar (BIL-04)", () => {
  const ahora = new Date("2026-10-19T12:00:00Z");
  const haceDias = (d: number) => new Date(ahora.getTime() - d * 86_400_000).toISOString();
  const nivel = (sub: Subscription) => accesoPorSuscripcion(sub, ahora).nivel;

  it("trial vencido sin activar, con Stripe todavía en trialing, o cancelado por Stripe: mismo nivel", () => {
    const nuncaActivo = nivel({ ...base, trialEnd: haceDias(5) });
    const activoSinTarjetaWebhookAtrasado = nivel({
      ...base,
      trialEnd: haceDias(5),
      stripeSubscriptionId: "sub_1",
    });
    const canceladoAlFinDeLaPrueba = nivel({
      ...base,
      status: "canceled",
      trialEnd: haceDias(5),
      stripeSubscriptionId: "sub_1",
    });
    expect(nuncaActivo).toBe("restringido");
    expect(activoSinTarjetaWebhookAtrasado).toBe(nuncaActivo);
    expect(canceladoAlFinDeLaPrueba).toBe(nuncaActivo);
  });
});
