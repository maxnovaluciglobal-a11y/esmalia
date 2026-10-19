import { describe, expect, it } from "vitest";

import {
  MAX_DIAS_EXTENSION,
  mensajeDeExtensionFallida,
  puedeExtenderPrueba,
} from "@/lib/admin/clinicas.functions";
import type { CobroStaffFila } from "@/lib/admin/estado-cobro";
import {
  CALENDLY_PUESTA_EN_MARCHA,
  MINUTOS_PUESTA_EN_MARCHA,
  urlPuestaEnMarcha,
} from "@/lib/marketing/calendly";
import { correoBienvenida } from "@/lib/email/plantillas";

/**
 * Extender la prueba (clínicas fundadoras) y el enlace de la llamada de puesta
 * en marcha. Puro: la regla que manda está en la función SQL
 * `extender_prueba_de_la_clinica`; acá se vigila lo que decide la pantalla.
 */

const base: CobroStaffFila = {
  clinicId: "c1",
  status: "trialing",
  trialEnd: "2026-11-01T12:00:00Z",
  currentPeriodEnd: null,
  stripeSubscriptionId: null,
  pastDueSince: null,
  disputedAt: null,
  disputeId: null,
};

describe("puedeExtenderPrueba", () => {
  it("sí: prueba de la base, vigente o vencida", () => {
    expect(puedeExtenderPrueba(base)).toBe(true);
    expect(puedeExtenderPrueba({ ...base, trialEnd: "2020-01-01T00:00:00Z" })).toBe(true);
  });

  it("no: sin fila, sin fecha de fin o ya suscrita en Stripe", () => {
    expect(puedeExtenderPrueba(null)).toBe(false);
    expect(puedeExtenderPrueba({ ...base, trialEnd: null })).toBe(false);
    expect(puedeExtenderPrueba({ ...base, stripeSubscriptionId: "sub_1" })).toBe(false);
  });

  it("no: cualquier estado distinto de trialing", () => {
    for (const status of ["active", "past_due", "canceled", "unpaid", "paused"]) {
      expect(puedeExtenderPrueba({ ...base, status }), status).toBe(false);
    }
  });
});

describe("mensajeDeExtensionFallida", () => {
  it("traduce cada código de la función SQL a un texto seguro", () => {
    for (const codigo of [
      "sin_prueba",
      "no_es_prueba_de_la_base",
      "no_extiende",
      "dias_invalidos",
    ]) {
      const msg = mensajeDeExtensionFallida(codigo);
      expect(msg, codigo).not.toBe(mensajeDeExtensionFallida(undefined));
      expect(msg).not.toContain("_");
    }
  });

  it("un error desconocido no filtra el texto de la base", () => {
    expect(mensajeDeExtensionFallida('relation "x" does not exist')).toBe(
      "No pudimos extender la prueba.",
    );
  });

  it("la cota de días coincide con el CHECK de la tabla", () => {
    expect(MAX_DIAS_EXTENSION).toBe(120);
  });
});

describe("llamada de puesta en marcha", () => {
  it("el enlace es de Esmalia, no de DypOS ni el viejo 30min", () => {
    expect(CALENDLY_PUESTA_EN_MARCHA).toContain("esmalia");
    expect(CALENDLY_PUESTA_EN_MARCHA).not.toContain("30min");
  });

  it("prellena nombre y correo si los hay", () => {
    const url = urlPuestaEnMarcha({ clinicName: "Clínica Sur", clinicEmail: "a@b.cl" });
    expect(url.startsWith(`${CALENDLY_PUESTA_EN_MARCHA}?`)).toBe(true);
    expect(url).toContain("name=Cl%C3%ADnica+Sur");
    expect(url).toContain("email=a%40b.cl");
    expect(urlPuestaEnMarcha()).toBe(CALENDLY_PUESTA_EN_MARCHA);
  });

  it("la bienvenida usa el mismo enlace y la misma duración", () => {
    const { html, text } = correoBienvenida({
      nombre: "Ana",
      clinicName: "Clínica Sur",
      diasDePrueba: 14,
      finDePrueba: null,
      appUrl: "https://esmalia.com",
    } as Parameters<typeof correoBienvenida>[0]);
    expect(html).toContain(CALENDLY_PUESTA_EN_MARCHA);
    expect(text).toContain(`${MINUTOS_PUESTA_EN_MARCHA} minutos`);
    expect(html).not.toContain("30min");
  });
});
