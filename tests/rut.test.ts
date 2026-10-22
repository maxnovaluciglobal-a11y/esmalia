import { describe, expect, it } from "vitest";

import {
  digitoVerificador,
  errorDeDocumento,
  formatearRut,
  normalizarDocumento,
  pareceDocumento,
  rutEsValido,
  tipoDocumentoPorDefecto,
} from "../src/lib/patients/rut";

/**
 * FIC-01 y PAC-03: RUT con dígito verificador (módulo 11) y normalización
 * del documento para el índice ciego. Puro, sin base. Los mismos casos se
 * comparan contra public.rut_es_valido y public.normalizar_documento en
 * tests/pacientes-chile-db.test.ts.
 */

const RUTS_VALIDOS = [
  "12.345.678-5",
  "123456785",
  "12345678-5",
  "11.111.111-1",
  "7.654.321-6",
  "15.444.226-K",
  "15444226-k",
  " 9.999.999-3 ",
];

const RUTS_INVALIDOS = [
  "12.345.678-6",
  "12.345.678-K",
  "11.111.111-2",
  "123",
  "",
  "abc",
  "12.345.678-5x",
  "K2.345.678-5",
  "1234567890123",
];

describe("digitoVerificador", () => {
  it("calcula el módulo 11, con 0 y K", () => {
    expect(digitoVerificador("12345678")).toBe("5");
    expect(digitoVerificador("11111111")).toBe("1");
    expect(digitoVerificador("15444226")).toBe("K");
    expect(digitoVerificador("15444220")).toBe("0");
    expect(digitoVerificador("7654321")).toBe("6");
  });
});

describe("rutEsValido", () => {
  it.each(RUTS_VALIDOS)("acepta %s", (rut) => {
    expect(rutEsValido(rut)).toBe(true);
  });
  it.each(RUTS_INVALIDOS)("rechaza %j", (rut) => {
    expect(rutEsValido(rut)).toBe(false);
  });
  it("rechaza null y undefined", () => {
    expect(rutEsValido(null)).toBe(false);
    expect(rutEsValido(undefined)).toBe(false);
  });
});

describe("formatearRut", () => {
  it("pone puntos y guion al salir del campo", () => {
    expect(formatearRut("123456785")).toBe("12.345.678-5");
    expect(formatearRut("12345678-5")).toBe("12.345.678-5");
    expect(formatearRut("15444226k")).toBe("15.444.226-K");
    expect(formatearRut("76543216")).toBe("7.654.321-6");
  });
  it("deja tal cual lo que no tiene forma de RUT", () => {
    expect(formatearRut(" AB123 ")).toBe("AB123");
  });
});

describe("errorDeDocumento", () => {
  it("un RUT inválido bloquea con un mensaje claro", () => {
    expect(errorDeDocumento("12.345.678-6", "rut")).toMatch(/RUT no es válido/);
    expect(errorDeDocumento("12.345.678-5", "rut")).toBeNull();
  });
  it("otros tipos solo controlan el largo; vacío no es error", () => {
    expect(errorDeDocumento("X1234567", "pasaporte")).toBeNull();
    expect(errorDeDocumento("", "rut")).toBeNull();
    expect(errorDeDocumento("1".repeat(41), "otro")).toMatch(/largo/);
  });
});

describe("normalizarDocumento (índice ciego)", () => {
  it("deja letras y dígitos en mayúscula", () => {
    expect(normalizarDocumento("12.345.678-5")).toBe("123456785");
    expect(normalizarDocumento("123456785")).toBe("123456785");
    expect(normalizarDocumento("15.444.226-k")).toBe("15444226K");
    expect(normalizarDocumento(" ab 12-3 ")).toBe("AB123");
  });
  it("los dos formatos del mismo RUT dan lo mismo", () => {
    expect(normalizarDocumento("12.345.678-5")).toBe(normalizarDocumento("123456785"));
  });
  it("vacío es null", () => {
    expect(normalizarDocumento("")).toBeNull();
    expect(normalizarDocumento(" .-")).toBeNull();
    expect(normalizarDocumento(null)).toBeNull();
  });
});

describe("pareceDocumento", () => {
  it("reconoce un RUT escrito de cualquier forma", () => {
    expect(pareceDocumento("12.345.678-5")).toBe(true);
    expect(pareceDocumento("123456785")).toBe(true);
    expect(pareceDocumento("15444226-k")).toBe(true);
  });
  it("no confunde nombres ni números cortos", () => {
    expect(pareceDocumento("jose")).toBe(false);
    expect(pareceDocumento("1234")).toBe(false);
    expect(pareceDocumento("")).toBe(false);
  });
});

describe("tipoDocumentoPorDefecto", () => {
  it("RUT en Chile, DNI en el resto", () => {
    expect(tipoDocumentoPorDefecto("CL")).toBe("rut");
    expect(tipoDocumentoPorDefecto("cl")).toBe("rut");
    expect(tipoDocumentoPorDefecto("AR")).toBe("dni");
    expect(tipoDocumentoPorDefecto(null)).toBe("dni");
  });
});
