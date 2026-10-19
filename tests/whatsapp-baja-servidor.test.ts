import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  MENSAJE_BAJA_VENTANA_CERRADA,
  MENSAJE_PACIENTE_DADO_DE_BAJA,
  esPalabraDeBaja,
  motivoParaNoEnviarWhatsApp,
} from "@/lib/messaging/baja-whatsapp";

/**
 * CON-09 (auditoría 360 del 18-oct-2026), segunda parte: la baja de WhatsApp
 * se respeta en el servidor y "CANCELAR" ya no da de baja. Puro: sin base ni
 * red (el envío a Meta y Supabase son falsos).
 */

describe("palabras de baja", () => {
  it("reconoce la baja escrita de distintas formas", () => {
    for (const t of [
      "BAJA",
      "baja",
      " Baja. ",
      "STOP",
      "stop!",
      "NO MAS",
      "No más",
      "¡no más!",
      "UNSUBSCRIBE",
      "darme de baja",
      "Dar de baja",
    ]) {
      expect(esPalabraDeBaja(t), t).toBe(true);
    }
  });

  it("'CANCELAR' no es una baja: el paciente quiere anular su cita", () => {
    for (const t of ["CANCELAR", "cancelar", "Cancelar.", "quiero cancelar mi hora"]) {
      expect(esPalabraDeBaja(t), t).toBe(false);
    }
  });

  it("solo el mensaje completo cuenta: una frase que menciona la baja no lo es", () => {
    for (const t of [
      "no más dolor desde la limpieza",
      "la baja de la muela",
      "stop a las caries",
      "",
      null,
      undefined,
    ]) {
      expect(esPalabraDeBaja(t), String(t)).toBe(false);
    }
  });
});

describe("motivoParaNoEnviarWhatsApp", () => {
  const baja = "2026-10-10T12:00:00.000Z";

  it("sin baja, se puede enviar siempre", () => {
    expect(motivoParaNoEnviarWhatsApp({ waOptOutAt: null, tipo: "proactivo" })).toBeNull();
    expect(motivoParaNoEnviarWhatsApp({ waOptOutAt: undefined, tipo: "respuesta" })).toBeNull();
  });

  it("con baja, nada proactivo (plantilla, recordatorio, link del portal)", () => {
    expect(motivoParaNoEnviarWhatsApp({ waOptOutAt: baja, tipo: "proactivo" })).toBe(
      MENSAJE_PACIENTE_DADO_DE_BAJA,
    );
    // La ventana abierta no habilita un envío proactivo.
    expect(
      motivoParaNoEnviarWhatsApp({ waOptOutAt: baja, tipo: "proactivo", ventanaAbierta: true }),
    ).toBe(MENSAJE_PACIENTE_DADO_DE_BAJA);
  });

  it("con baja, responder solo con la ventana de 24 h abierta por el paciente", () => {
    expect(
      motivoParaNoEnviarWhatsApp({ waOptOutAt: baja, tipo: "respuesta", ventanaAbierta: true }),
    ).toBeNull();
    expect(
      motivoParaNoEnviarWhatsApp({ waOptOutAt: baja, tipo: "respuesta", ventanaAbierta: false }),
    ).toBe(MENSAJE_BAJA_VENTANA_CERRADA);
  });

  it("los mensajes al equipo van en tuteo y sin voseo", () => {
    for (const m of [MENSAJE_PACIENTE_DADO_DE_BAJA, MENSAJE_BAJA_VENTANA_CERRADA]) {
      expect(m).not.toMatch(/\b(podés|tenés|querés|escribí)\b/i);
    }
  });
});

describe("tryMetaTemplateSend con un paciente dado de baja", () => {
  it("lanza antes de tocar la base o Meta (no cae a wa.me)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const from = vi.fn();
    const { tryMetaTemplateSend } = await import("@/lib/messaging/whatsapp.functions");

    await expect(
      tryMetaTemplateSend({
        supabase: { from } as never,
        clinicId: "clinic-1",
        templateKind: "appointment_reminder",
        metaTemplate: { name: "recordatorio", language: "es" },
        recipientRaw: "+56912345678",
        country: "CL",
        waOptOutAt: "2026-10-10T12:00:00.000Z",
        variables: {},
      }),
    ).rejects.toThrow(MENSAJE_PACIENTE_DADO_DE_BAJA);
    expect(from).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

/**
 * Cinturón contra regresiones: cada función de servidor que le escribe a un
 * paciente por WhatsApp lee `wa_opt_out_at` y corta con el helper. Si alguien
 * agrega otro camino de envío, este test no lo ve: por eso además
 * `tryMetaTemplateSend` exige `waOptOutAt` en su firma.
 */
describe("los envíos del servidor revisan la baja", () => {
  const fuente = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

  it.each([
    ["src/lib/messaging/messaging.functions.ts", "proactivo"],
    ["src/lib/patients/portal.functions.ts", "proactivo"],
    ["src/lib/messaging/conversations.functions.ts", "respuesta"],
  ])("%s", (ruta, tipo) => {
    const src = fuente(ruta);
    expect(src).toMatch(/wa_opt_out_at/);
    expect(src).toContain("motivoParaNoEnviarWhatsApp(");
    expect(src).toContain(`tipo: "${tipo}"`);
  });

  it("el webhook de Meta usa esPalabraDeBaja y ya no tiene su propia lista", () => {
    const src = fuente("src/routes/api.whatsapp-webhook.ts");
    expect(src).toContain("esPalabraDeBaja(bodyText)");
    expect(src).not.toMatch(/OPT_OUT_WORDS/);
    expect(src).not.toMatch(/new Set\(\[[^\]]*"CANCELAR"/);
  });
});
