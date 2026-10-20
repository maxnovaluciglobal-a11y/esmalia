import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { puedeMostrarMolar3D, type CapacidadesEquipo } from "@/lib/marketing/molar-3d-elegible";

// Molar 3D del hero de /v2: three.js nunca entra en el JS inicial y solo se
// pide en equipos que pueden, sin movimiento reducido ni ahorro de datos.
const BASE: CapacidadesEquipo = {
  reducido: false,
  ahorroDeDatos: false,
  nucleos: 8,
  memoriaGb: 8,
  webgl2: true,
};

describe("molar 3D de /v2", () => {
  it("se muestra solo en equipos capaces y sin pedidos de menos movimiento o datos", () => {
    expect(puedeMostrarMolar3D(BASE)).toBe(true);
    expect(puedeMostrarMolar3D({ ...BASE, reducido: true })).toBe(false);
    expect(puedeMostrarMolar3D({ ...BASE, ahorroDeDatos: true })).toBe(false);
    expect(puedeMostrarMolar3D({ ...BASE, webgl2: false })).toBe(false);
    expect(puedeMostrarMolar3D({ ...BASE, nucleos: 4 })).toBe(false);
    expect(puedeMostrarMolar3D({ ...BASE, nucleos: undefined })).toBe(false);
    expect(puedeMostrarMolar3D({ ...BASE, memoriaGb: 2 })).toBe(false);
    expect(puedeMostrarMolar3D({ ...BASE, memoriaGb: undefined })).toBe(true);
  });

  it("three.js solo se importa desde molar-3d.ts, y ese módulo solo con import()", () => {
    const v2 = path.resolve(__dirname, "../src/components/marketing/v2");
    const hero = readFileSync(path.join(v2, "hero-dia.tsx"), "utf8");
    expect(hero).toMatch(/import\("\.\/molar-3d"\)/);
    // Fuera del import() dinámico, solo tipos.
    const estaticos = [...hero.matchAll(/^import\s+(type\s+)?[^;]*from\s+"\.\/molar-3d";/gm)];
    for (const m of estaticos) expect(m[1]).toBe("type ");
    expect(hero).not.toMatch(/from\s+"three"/);
  });
});
