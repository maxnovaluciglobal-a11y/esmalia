import { afterEach, describe, expect, it, vi } from "vitest";

import { correoBienvenida } from "@/lib/email/plantillas";
import {
  calendlyValido,
  enlacePuestaEnMarcha,
  MINUTOS_PUESTA_EN_MARCHA,
} from "@/lib/marketing/puesta-en-marcha";

// Enlace de la llamada de puesta en marcha (CS-01). Nunca un evento que no
// existe: Calendly solo si está configurado; si no, WhatsApp; si no, correo.

afterEach(() => vi.unstubAllEnvs());

describe("calendlyValido", () => {
  it("acepta solo https://calendly.com/<algo>", () => {
    expect(calendlyValido("https://calendly.com/esmalia/puesta-en-marcha")).toBe(
      "https://calendly.com/esmalia/puesta-en-marcha",
    );
    expect(calendlyValido("  https://calendly.com/esmalia/20min  ")).toContain("calendly.com");
  });

  it("rechaza vacío, http, otros dominios y basura", () => {
    for (const malo of [
      "",
      "   ",
      null,
      undefined,
      "http://calendly.com/esmalia/x",
      "https://calendly.com/",
      "https://calendly.com.evil.com/esmalia/x",
      "https://evil.com/calendly.com/esmalia",
      "no es una url",
    ]) {
      expect(calendlyValido(malo as string | null | undefined), String(malo)).toBeNull();
    }
  });
});

describe("enlacePuestaEnMarcha", () => {
  const calendly = "https://calendly.com/esmalia/puesta-en-marcha";

  it("con Calendly configurado lo usa y le prellena nombre y correo", () => {
    const r = enlacePuestaEnMarcha(
      { clinicName: "Clínica Sur", clinicEmail: "a@b.cl" },
      { calendly, whatsapp: "+56912345678" },
    );
    expect(r.canal).toBe("calendly");
    expect(r.href.startsWith(calendly)).toBe(true);
    expect(r.href).toContain("name=Cl%C3%ADnica+Sur");
    expect(r.href).toContain("email=a%40b.cl");
  });

  it("sin Calendly, abre WhatsApp con el mensaje y el nombre de la clínica", () => {
    const r = enlacePuestaEnMarcha({ clinicName: "Clínica Sur" }, { whatsapp: "+56 9 1234 5678" });
    expect(r.canal).toBe("whatsapp");
    expect(r.href).toMatch(/^https:\/\/wa\.me\/56912345678\?text=/);
    expect(decodeURIComponent(r.href)).toContain(
      "puesta en marcha de Esmalia para mi clínica Clínica Sur",
    );
  });

  it("un Calendly inválido no se usa: cae a WhatsApp", () => {
    const r = enlacePuestaEnMarcha(
      {},
      { calendly: "https://evil.com/x", whatsapp: "+56912345678" },
    );
    expect(r.canal).toBe("whatsapp");
  });

  it("sin nada configurado cae a un correo, nunca a un enlace muerto", () => {
    const r = enlacePuestaEnMarcha({ clinicName: "Clínica Sur" }, {});
    expect(r.canal).toBe("correo");
    expect(r.href.startsWith("mailto:hola@esmalia.com?subject=")).toBe(true);
  });

  it("lee la configuración del entorno cuando no se le pasa", () => {
    vi.stubEnv("VITE_CALENDLY_PUESTA_EN_MARCHA", calendly);
    expect(enlacePuestaEnMarcha().canal).toBe("calendly");
    vi.stubEnv("VITE_CALENDLY_PUESTA_EN_MARCHA", "");
    vi.stubEnv("VITE_SALES_WHATSAPP", "+56912345678");
    expect(enlacePuestaEnMarcha().canal).toBe("whatsapp");
  });
});

describe("bienvenida", () => {
  it("usa el mismo enlace y la misma duración, y no el Calendly viejo ni uno inexistente", () => {
    vi.stubEnv("VITE_CALENDLY_PUESTA_EN_MARCHA", "");
    vi.stubEnv("VITE_SALES_WHATSAPP", "+56912345678");
    const { html, text } = correoBienvenida({
      nombre: "Ana",
      clinicName: "Clínica Sur",
      diasDePrueba: 14,
      finDePrueba: null,
      appUrl: "https://esmalia.com",
    } as Parameters<typeof correoBienvenida>[0]);
    expect(html).toContain("https://wa.me/56912345678");
    expect(html).not.toContain("calendly.com/maxnovaluciglobal");
    expect(text).toContain(`${MINUTOS_PUESTA_EN_MARCHA} minutos`);
  });
});
