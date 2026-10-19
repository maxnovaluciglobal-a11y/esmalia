import { afterEach, describe, expect, it, vi } from "vitest";

import { enlaceWhatsAppSoporte, mensajeSoporte } from "@/lib/marketing/contacto";

// Ayuda dentro de la app (CS-06): el WhatsApp de soporte lleva el nombre de la
// clínica y, sin número cargado, no se ofrece (nunca un chat que no abre).

afterEach(() => vi.unstubAllEnvs());

describe("mensajeSoporte", () => {
  it("incluye el nombre de la clínica para que se sepa de quién es", () => {
    expect(mensajeSoporte("Clínica Sonrisa")).toBe(
      "Hola, necesito ayuda con Esmalia. Mi clínica es Clínica Sonrisa.",
    );
  });

  it("sin nombre (o vacío) no deja un hueco", () => {
    expect(mensajeSoporte()).toBe("Hola, necesito ayuda con Esmalia.");
    expect(mensajeSoporte("   ")).toBe("Hola, necesito ayuda con Esmalia.");
  });
});

describe("enlaceWhatsAppSoporte", () => {
  it("con número cargado arma un wa.me con el mensaje codificado", () => {
    vi.stubEnv("VITE_SALES_WHATSAPP", "+56 9 1234 5678");
    const url = enlaceWhatsAppSoporte("Clínica Sonrisa");
    expect(url).toMatch(/^https:\/\/wa\.me\/56912345678\?text=/);
    expect(decodeURIComponent(url ?? "")).toContain("Mi clínica es Clínica Sonrisa");
  });

  it("sin número cargado devuelve null", () => {
    vi.stubEnv("VITE_SALES_WHATSAPP", "");
    expect(enlaceWhatsAppSoporte("Clínica Sonrisa")).toBeNull();
  });
});
