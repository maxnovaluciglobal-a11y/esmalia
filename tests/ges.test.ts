import { describe, expect, it } from "vitest";

import { edadCumplida, motivosGes, rangoDeNacimientoParaEdad } from "../src/lib/patients/ges";

/** MKT-01: aviso GES dental (embarazadas, 6 y 60 años). Puro. */

const HOY = "2026-10-22";

describe("edadCumplida", () => {
  it("cuenta el cumpleaños del día", () => {
    expect(edadCumplida("2020-10-22", HOY)).toBe(6);
    expect(edadCumplida("2020-10-23", HOY)).toBe(5);
    expect(edadCumplida("1966-10-21", HOY)).toBe(60);
  });
  it("sin fecha o con fecha futura no hay edad", () => {
    expect(edadCumplida(null, HOY)).toBeNull();
    expect(edadCumplida("2027-01-01", HOY)).toBeNull();
    expect(edadCumplida("no", HOY)).toBeNull();
  });
});

describe("motivosGes", () => {
  it("6 y 60 años cumplidos", () => {
    expect(motivosGes({ pais: "CL", fechaNacimiento: "2020-01-15", hoy: HOY })).toEqual([
      "seis_anios",
    ]);
    expect(motivosGes({ pais: "CL", fechaNacimiento: "1966-05-01", hoy: HOY })).toEqual([
      "sesenta_anios",
    ]);
  });
  it("5, 7, 59 y 61 años no", () => {
    for (const nac of ["2021-01-01", "2019-01-01", "1967-01-01", "1965-01-01"]) {
      expect(motivosGes({ pais: "CL", fechaNacimiento: nac, hoy: HOY })).toEqual([]);
    }
  });
  it("embarazo según la anamnesis", () => {
    expect(
      motivosGes({ pais: "CL", fechaNacimiento: "1995-03-03", hoy: HOY, embarazada: true }),
    ).toEqual(["embarazo"]);
    expect(
      motivosGes({ pais: "CL", fechaNacimiento: "1995-03-03", hoy: HOY, embarazada: null }),
    ).toEqual([]);
  });
  it("solo en clínicas de Chile", () => {
    expect(
      motivosGes({ pais: "AR", fechaNacimiento: "2020-01-15", hoy: HOY, embarazada: true }),
    ).toEqual([]);
    expect(motivosGes({ pais: null, fechaNacimiento: "2020-01-15", hoy: HOY })).toEqual([]);
  });
});

describe("rangoDeNacimientoParaEdad", () => {
  it("nacidos entre el día siguiente de hace edad+1 años y hoy hace edad años", () => {
    expect(rangoDeNacimientoParaEdad(6, HOY)).toEqual({ desde: "2019-10-23", hasta: "2020-10-22" });
    expect(rangoDeNacimientoParaEdad(60, HOY)).toEqual({
      desde: "1965-10-23",
      hasta: "1966-10-22",
    });
  });
  it("los extremos del rango tienen exactamente esa edad", () => {
    const { desde, hasta } = rangoDeNacimientoParaEdad(6, HOY);
    expect(edadCumplida(desde, HOY)).toBe(6);
    expect(edadCumplida(hasta, HOY)).toBe(6);
  });
  it("29 de febrero en un año no bisiesto", () => {
    expect(rangoDeNacimientoParaEdad(6, "2028-02-29")).toEqual({
      desde: "2021-03-01",
      hasta: "2022-02-28",
    });
  });
});
