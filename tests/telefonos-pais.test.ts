// Test puro (sin base ni red): normalización de teléfonos por país (BIL-11).
import { describe, expect, it } from "vitest";

import { buildWaMeUrl, normalizeToWaMe, toE164 } from "@/lib/messaging/telefonos";

describe("normalizeToWaMe — Chile", () => {
  it.each([
    ["+56 9 1234 5678", "56912345678"],
    ["9 1234 5678", "56912345678"],
    ["09 1234 5678", "56912345678"],
    ["2 2345 6789", "56223456789"], // fijo de Santiago
    ["56912345678", "56912345678"], // con código y sin "+"
  ])("%s → %s", (raw, esperado) => {
    expect(normalizeToWaMe(raw, "CL")).toBe(esperado);
  });

  it("rechaza un número corto", () => {
    expect(normalizeToWaMe("1234 5678", "CL")).toBeNull();
  });
});

describe("normalizeToWaMe — México", () => {
  it.each([
    ["55 1234 5678", "525512345678"], // CDMX
    ["(81) 1234-5678", "528112345678"], // Monterrey
    ["044 55 1234 5678", "525512345678"], // prefijo de celular viejo
    ["045 33 1234 5678", "523312345678"],
    ["01 55 1234 5678", "525512345678"], // larga distancia vieja
    ["+52 1 55 1234 5678", "525512345678"], // "1" de celular
    ["+52 55 1234 5678", "525512345678"],
    ["525512345678", "525512345678"],
  ])("%s → %s", (raw, esperado) => {
    expect(normalizeToWaMe(raw, "MX")).toBe(esperado);
  });

  it("rechaza un número que no tiene 10 dígitos", () => {
    expect(normalizeToWaMe("55 1234 567", "MX")).toBeNull();
  });
});

describe("normalizeToWaMe — Colombia", () => {
  it.each([
    ["300 123 4567", "573001234567"], // celular
    ["601 234 5678", "576012345678"], // fijo de Bogotá (plan 2021)
    ["+57 300 123 4567", "573001234567"],
    ["573001234567", "573001234567"],
  ])("%s → %s", (raw, esperado) => {
    expect(normalizeToWaMe(raw, "CO")).toBe(esperado);
  });

  it("rechaza un fijo con el formato viejo de 7 dígitos", () => {
    expect(normalizeToWaMe("234 5678", "CO")).toBeNull();
  });
});

describe("normalizeToWaMe — Perú", () => {
  it.each([
    ["987 654 321", "51987654321"], // celular
    ["(01) 234-5678", "5112345678"], // fijo de Lima
    ["044 123456", "5144123456"], // fijo de Trujillo
    ["+51 987 654 321", "51987654321"],
    ["51987654321", "51987654321"],
  ])("%s → %s", (raw, esperado) => {
    expect(normalizeToWaMe(raw, "PE")).toBe(esperado);
  });

  it("rechaza un celular al que le falta un dígito", () => {
    // 8 dígitos que empiezan con 9 no son ni celular (9) ni fijo (área 1-8).
    expect(normalizeToWaMe("98 765 432", "PE")).toBeNull();
    expect(normalizeToWaMe("9876 54", "PE")).toBeNull();
  });
});

describe("normalizeToWaMe — Argentina (WhatsApp necesita 54 9)", () => {
  it.each([
    ["11 2345-6789", "5491123456789"], // AMBA sin 15
    ["11 15 2345-6789", "5491123456789"], // con 15 de celular
    ["011 15 2345-6789", "5491123456789"], // con 0 y 15
    ["351 15 123-4567", "5493511234567"], // Córdoba, área de 3
    ["294 15 412-3456", "5492944123456"], // Bariloche, área de 3
    ["2255 15 12-3456", "5492255123456"], // Villa Gesell, área de 4
    ["9 11 2345 6789", "5491123456789"],
    ["+54 9 11 2345-6789", "5491123456789"],
    ["+54 11 2345-6789", "5491123456789"],
    ["+54 11 15 2345 6789", "5491123456789"],
    ["5491123456789", "5491123456789"],
  ])("%s → %s", (raw, esperado) => {
    expect(normalizeToWaMe(raw, "AR")).toBe(esperado);
  });

  it("rechaza un celular sin código de área", () => {
    expect(normalizeToWaMe("15 2345 6789", "AR")).toBeNull();
  });
});

describe("normalizeToWaMe — sin país no se adivina", () => {
  it("un número local sin país conocido devuelve null", () => {
    expect(normalizeToWaMe("9 1234 5678", null)).toBeNull();
    expect(normalizeToWaMe("9 1234 5678", undefined)).toBeNull();
    expect(normalizeToWaMe("9 1234 5678", "BR")).toBeNull();
    expect(normalizeToWaMe("9 1234 5678", "")).toBeNull();
  });

  it("un número internacional no necesita país", () => {
    expect(normalizeToWaMe("+56 9 1234 5678", null)).toBe("56912345678");
    expect(normalizeToWaMe("0056 9 1234 5678", null)).toBe("56912345678");
    expect(normalizeToWaMe("+1 415 555 2671", null)).toBe("14155552671");
  });

  it("un número internacional se respeta aunque sea de otro país que la clínica", () => {
    expect(normalizeToWaMe("+52 55 1234 5678", "CL")).toBe("525512345678");
  });

  it("vacío o sin dígitos devuelve null", () => {
    expect(normalizeToWaMe("", "CL")).toBeNull();
    expect(normalizeToWaMe(null, "CL")).toBeNull();
    expect(normalizeToWaMe("abc", "CL")).toBeNull();
  });
});

describe("regresiones de la auditoría (BIL-11)", () => {
  // Antes todo número local se leía como de Chile y los demás caían en
  // otros países: MX → Brasil, CO → Grecia, AR → EE. UU., PE → Chile.
  it("ningún número local termina en otro país", () => {
    expect(normalizeToWaMe("55 1234 5678", "MX")).toBe("525512345678");
    expect(normalizeToWaMe("300 123 4567", "CO")).toBe("573001234567");
    expect(normalizeToWaMe("11 2345-6789", "AR")).toBe("5491123456789");
    expect(normalizeToWaMe("987 654 321", "PE")).toBe("51987654321");
    expect(normalizeToWaMe("81 1234 5678", "MX")).toBe("528112345678");
  });
});

describe("el wa_id de Meta coincide con la ficha (webhook)", () => {
  it.each([
    ["5215512345678", "55 1234 5678", "MX"],
    ["525512345678", "044 55 1234 5678", "MX"],
    ["5491123456789", "11 15 2345-6789", "AR"],
    ["56912345678", "9 1234 5678", "CL"],
    ["573001234567", "300 123 4567", "CO"],
    ["51987654321", "987 654 321", "PE"],
  ])("wa_id %s ↔ ficha %s (%s)", (waId, ficha, pais) => {
    const desdeMeta = normalizeToWaMe(`+${waId}`, pais);
    expect(desdeMeta).not.toBeNull();
    expect(normalizeToWaMe(ficha, pais)).toBe(desdeMeta);
  });
});

describe("toE164 y buildWaMeUrl", () => {
  it("toE164 agrega el +", () => {
    expect(toE164("55 1234 5678", "MX")).toBe("+525512345678");
    expect(toE164("55 1234 5678", null)).toBeNull();
  });

  it("buildWaMeUrl arma el link con el país de la clínica", () => {
    expect(buildWaMeUrl("300 123 4567", "Hola", "CO")).toBe("https://wa.me/573001234567?text=Hola");
  });

  it("buildWaMeUrl no arma link sin país para un número local", () => {
    expect(buildWaMeUrl("300 123 4567", "Hola", null)).toBeNull();
  });
});
