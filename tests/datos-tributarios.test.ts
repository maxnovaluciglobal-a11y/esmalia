import { describe, expect, it } from "vitest";

import { camposDatosClinica, errorRutEmpresa } from "@/lib/clinic-operations/datos-clinica";

// FIN-16: datos tributarios de la clínica. Puro.

describe("RUT de la empresa", () => {
  it("en Chile valida el dígito verificador", () => {
    expect(errorRutEmpresa("76.123.456-0", "CL")).toBeNull();
    expect(errorRutEmpresa("761234560", "cl")).toBeNull();
    expect(errorRutEmpresa("76.123.456-1", "CL")).toMatch(/no es válido/);
  });

  it("vacío no es error, y fuera de Chile es texto libre", () => {
    expect(errorRutEmpresa("  ", "CL")).toBeNull();
    expect(errorRutEmpresa("XAXX010101000", "MX")).toBeNull();
  });
});

describe("campos de datos de la clínica", () => {
  const base = { name: "Clínica", legalName: "", taxId: "", timezone: "America/Santiago" };

  it("los datos tributarios son opcionales (compatibles con el formulario anterior)", () => {
    const r = camposDatosClinica.parse(base);
    expect(r).toMatchObject({
      giro: "",
      direccionTributaria: "",
      comunaTributaria: "",
      tipoBoleta: "",
    });
  });

  it("el tipo de boleta solo es exenta o afecta", () => {
    expect(camposDatosClinica.safeParse({ ...base, tipoBoleta: "afecta" }).success).toBe(true);
    expect(camposDatosClinica.safeParse({ ...base, tipoBoleta: "factura" }).success).toBe(false);
  });
});
