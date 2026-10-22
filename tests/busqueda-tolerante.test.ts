import { describe, expect, it } from "vitest";

import { coincideNombre, distanciaDeEdicion } from "../src/lib/patients/busqueda-tolerante";

/** PAC-02: búsqueda local tolerante a tildes y errores de tipeo. Puro. */

describe("distanciaDeEdicion", () => {
  it("cuenta inserciones, borrados y cambios", () => {
    expect(distanciaDeEdicion("peres", "perez")).toBe(1);
    expect(distanciaDeEdicion("jose", "jose")).toBe(0);
    expect(distanciaDeEdicion("ana", "anna")).toBe(1);
  });
  it("corta apenas supera el máximo", () => {
    expect(distanciaDeEdicion("abc", "xyzxyz", 2)).toBe(3);
  });
});

describe("coincideNombre", () => {
  it("'jose peres' encuentra a 'José Pérez'", () => {
    expect(coincideNombre("jose peres", "José Pérez")).toBe(true);
  });
  it("ignora tildes, mayúsculas y el orden de las palabras", () => {
    expect(coincideNombre("PEREZ jose", "José Pérez González")).toBe(true);
    expect(coincideNombre("maria", "María Ñúñez")).toBe(true);
    expect(coincideNombre("nunez", "María Ñúñez")).toBe(true);
  });
  it("encuentra por el comienzo de una palabra", () => {
    expect(coincideNombre("gonz", "José Pérez González")).toBe(true);
    expect(coincideNombre("gonsal", "José Pérez González")).toBe(true);
  });
  it("no trae cualquier cosa", () => {
    expect(coincideNombre("jose peres", "Juan Soto")).toBe(false);
    expect(coincideNombre("ana", "Juana Soto")).toBe(true); // subcadena exacta
    expect(coincideNombre("rez", "José Pérez")).toBe(true); // subcadena exacta
    expect(coincideNombre("rodrigo", "José Pérez")).toBe(false);
  });
  it("sin término todo coincide; sin nombre, nada", () => {
    expect(coincideNombre("", "José")).toBe(true);
    expect(coincideNombre("jose", null)).toBe(false);
  });
});
