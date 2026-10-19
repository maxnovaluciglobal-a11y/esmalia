import { describe, expect, it } from "vitest";

import { armarAvisoAlta } from "@/lib/marketing/aviso-alta";

// Aviso interno de alta de clínica (CS-10). Puro: no envía nada.
const base = {
  clinicName: "Clínica Sonrisa",
  countryCode: "CL",
  userEmail: "dra@sonrisa.cl",
  profesionales: 2,
  interno: false,
};

describe("armarAvisoAlta", () => {
  it("el asunto dice qué clínica y de qué país, y el cuerpo lleva el contacto y el enlace", () => {
    const a = armarAvisoAlta(base, "https://esmalia.com/");
    expect(a.asunto).toBe("Nueva clínica en Esmalia: Clínica Sonrisa (CL)");
    expect(a.html).toContain("dra@sonrisa.cl");
    expect(a.html).toContain('href="https://esmalia.com/admin/clinicas"');
    expect(a.texto).toContain("https://esmalia.com/admin/clinicas");
    expect(a.texto).toContain("Profesionales cargados: 2");
  });

  it("marca las altas internas (equipo o demo) en el asunto", () => {
    expect(armarAvisoAlta({ ...base, interno: true }, "https://esmalia.com").asunto).toMatch(
      /^\[interno\] /,
    );
  });

  it("escapa el texto libre de la clínica y del correo", () => {
    const a = armarAvisoAlta(
      { ...base, clinicName: '<img src=x onerror="alert(1)">', userEmail: "a<b>@x.cl" },
      "https://esmalia.com",
    );
    expect(a.html).not.toContain("<img");
    expect(a.html).not.toContain("<b>");
    expect(a.html).toContain("&lt;img");
  });

  it("sin correo muestra un guion en vez de 'null'", () => {
    const a = armarAvisoAlta({ ...base, userEmail: null }, "https://esmalia.com");
    expect(a.html).not.toContain("null");
    expect(a.texto).toContain("Correo de quien la creó: —");
  });
});
