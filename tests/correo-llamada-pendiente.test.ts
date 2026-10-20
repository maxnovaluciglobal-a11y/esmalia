import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DIAS_MAX_AVISO_LLAMADA,
  ES_TRANSACCIONAL,
  LIFECYCLE_KINDS,
  correspondeAvisoLlamada,
  type InsumosAvisoLlamada,
} from "@/lib/email/ciclo-de-vida";
import { correoBienvenida, correoLlamadaPendiente } from "@/lib/email/plantillas";

// Aviso "llamada de puesta en marcha pendiente" (20-oct-2026). Todo puro:
// regla de selección, plantilla y el archivo de migración, sin base ni Resend.

const APP = "https://app.esmalia.test";
const AHORA = new Date("2026-10-20T15:00:00Z");
const HORA = 3_600_000;
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * HORA).toISOString();

const base: InsumosAvisoLlamada = {
  createdAt: haceHoras(30),
  onboardingCallAt: null,
  subscriptionStatus: "trialing",
  isDemo: false,
};

describe("correspondeAvisoLlamada: a quién le toca", () => {
  it("borde de 24 h: 23 h no, 24 h sí", () => {
    expect(correspondeAvisoLlamada({ ...base, createdAt: haceHoras(23.99) }, AHORA)).toBe(false);
    expect(correspondeAvisoLlamada({ ...base, createdAt: haceHoras(24) }, AHORA)).toBe(true);
    expect(correspondeAvisoLlamada(base, AHORA)).toBe(true);
  });

  it("con la llamada hecha, no", () => {
    expect(correspondeAvisoLlamada({ ...base, onboardingCallAt: haceHoras(2) }, AHORA)).toBe(false);
  });

  it("suscrita o sin estar en prueba, no: la llamada ya no destraba nada", () => {
    for (const status of ["active", "past_due", "canceled", "incomplete"]) {
      expect(correspondeAvisoLlamada({ ...base, subscriptionStatus: status }, AHORA), status).toBe(
        false,
      );
    }
    // Sin fila de suscripción: piloto anterior al trigger, no se toca.
    expect(correspondeAvisoLlamada({ ...base, subscriptionStatus: null }, AHORA)).toBe(false);
  });

  it("la demo nunca", () => {
    expect(correspondeAvisoLlamada({ ...base, isDemo: true }, AHORA)).toBe(false);
  });

  it(`edad máxima de ${DIAS_MAX_AVISO_LLAMADA} días: las clínicas viejas no reciben un aviso tardío`, () => {
    expect(DIAS_MAX_AVISO_LLAMADA).toBe(7);
    const limite = DIAS_MAX_AVISO_LLAMADA * 24;
    expect(correspondeAvisoLlamada({ ...base, createdAt: haceHoras(limite - 1) }, AHORA)).toBe(
      true,
    );
    expect(correspondeAvisoLlamada({ ...base, createdAt: haceHoras(limite) }, AHORA)).toBe(false);
    expect(correspondeAvisoLlamada({ ...base, createdAt: haceHoras(24 * 30) }, AHORA)).toBe(false);
  });

  it("es un kind conocido y transaccional (sin baja)", () => {
    expect(LIFECYCLE_KINDS).toContain("onboarding_call_pending");
    expect(ES_TRANSACCIONAL.onboarding_call_pending).toBe(true);
  });
});

// Mismas guardas de tono que `tests/correos-ciclo-de-vida.test.ts`.
const VOSEO =
  /(?<!\p{L})(?:agendá|agendala|revisá|tenés|podés|querés|necesitás|respondé|escribí|probá|mirá|hacé|elegí|usá|entrá)(?!\p{L})/iu;
const EMOJI = /\p{Extended_Pictographic}/u;

describe("correoLlamadaPendiente: plantilla", () => {
  const c = correoLlamadaPendiente({
    appUrl: APP,
    clinicName: "Clínica <Sonrisa>",
    nombre: "Ana María Pérez",
    agendarHref: "https://calendly.com/esmalia/puesta-en-marcha",
  });

  it("asunto en español, saludo y CTA para agendar", () => {
    expect(c.subject).toBe("Falta tu llamada de puesta en marcha en Esmalia");
    expect(c.text).toContain("Hola, Ana.");
    expect(c.text).toContain("Agendar la llamada");
    expect(c.html).toContain('href="https://calendly.com/esmalia/puesta-en-marcha"');
  });

  it("dice lo mismo que la bienvenida sobre lo que activa la llamada", () => {
    const frase =
      "El WhatsApp de la clínica, el portal del paciente y la página de efectividad se activan en una llamada de puesta en marcha de 20 minutos, o al suscribirte.";
    expect(c.text).toContain(frase);
    const bienvenida = correoBienvenida({
      appUrl: APP,
      clinicName: "Clínica Sonrisa",
      diasDePrueba: 14,
    });
    expect(bienvenida.text).toContain(frase);
  });

  it("no promete de más", () => {
    expect(c.text).not.toMatch(/gratis para siempre|garantiza|autom[aá]tico/i);
    expect(c.text).toContain("la agenda, los pacientes y las fichas clínicas funcionan");
  });

  it("tuteo neutro, sin exclamaciones ni emoji", () => {
    for (const parte of [c.subject, c.text]) {
      expect(parte).not.toMatch(VOSEO);
      expect(parte).not.toMatch(/[!¡]/);
      expect(parte).not.toMatch(EMOJI);
    }
    expect(c.text).toMatch(/\btienes\b/);
  });

  it("escapa el nombre de la clínica y no lleva baja (transaccional)", () => {
    expect(c.html).toContain("Clínica &lt;Sonrisa&gt;");
    expect(c.html).not.toContain("<Sonrisa>");
    expect(c.text).not.toMatch(/baja/i);
    expect(c.html).toContain(`${APP}/brand/esmalia-wordmark-email.png`);
  });

  it("sin enlace explícito, el botón usa enlacePuestaEnMarcha (nunca queda muerto)", () => {
    const sinHref = correoLlamadaPendiente({ appUrl: APP, clinicName: "Clínica Sonrisa" });
    expect(sinHref.html).toMatch(/href="(https:\/\/calendly\.com|https:\/\/wa\.me|mailto:)/);
  });
});

describe("migración 20261020030000_correo_llamada_pendiente", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261020030000_correo_llamada_pendiente.sql", import.meta.url),
    "utf8",
  );
  // Sin los comentarios (el bloque "Cómo revertir" repite los kinds viejos).
  const codigo = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("recrea el CHECK con todos los kinds del código, incluido el nuevo", () => {
    expect(codigo).toMatch(/DROP CONSTRAINT IF EXISTS lifecycle_emails_kind_check/);
    expect(codigo).toMatch(/ADD CONSTRAINT lifecycle_emails_kind_check CHECK/);
    for (const kind of LIFECYCLE_KINDS) expect(codigo).toContain(`'${kind}'`);
    for (const previo of [
      "welcome",
      "trial_t3",
      "trial_t0",
      "subscription_active",
      "payment_failed",
      "weekly_report",
    ]) {
      expect(codigo).toContain(`'${previo}'`);
    }
    expect(codigo).toContain("'onboarding_call_pending'");
  });

  it("todo en una transacción y sin tocar datos", () => {
    expect(codigo).toMatch(/^BEGIN;/m);
    expect(codigo).toMatch(/^COMMIT;/m);
    expect(codigo).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE|CREATE TABLE)\b/i);
  });
});
