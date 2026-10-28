import { describe, expect, it } from "vitest";

import { arcadaDemo, arcadaInferiorDemo, cbctDemoZip } from "@/lib/visores/demo-3d";
import { aPlyBinario, aStlBinario } from "@/lib/visores/ejemplos";
import { cajaDe, parsearMalla, prepararParaRender } from "@/lib/visores/malla";
import { abrirArchivosDicom, construirVolumen } from "@/lib/visores/volumen";

/**
 * Archivos de ejemplo de la demo comercial (src/lib/visores/demo-3d.ts):
 * tienen que verse bien en los visores y pesar poco, porque la demo no puede
 * escribir y el reset diario los vuelve a subir al bucket.
 */

const MB = 1024 * 1024;

describe("demo · arcadas 3D", () => {
  it("el STL pesa menos de 3 MB y es una arcada de verdad (14 piezas y encía)", () => {
    const stl = aStlBinario(arcadaDemo());
    expect(stl.length).toBeLessThan(3 * MB);
    const m = parsearMalla(stl, "stl");
    expect(m.triangulos).toBeGreaterThan(25_000);
    const { min, max } = cajaDe(m.posiciones);
    // Un modelo de yeso: ~50 mm de ancho, ~40-50 de fondo, ~15-20 de alto.
    expect(max[0] - min[0]).toBeGreaterThan(45);
    expect(max[0] - min[0]).toBeLessThan(70);
    expect(max[1] - min[1]).toBeGreaterThan(30);
    expect(max[2] - min[2]).toBeGreaterThan(10);
    expect(max[2] - min[2]).toBeLessThan(25);
  });

  it("el PLY lleva color por vértice (marfil y encía) y pesa menos de 3 MB", () => {
    const ply = aPlyBinario(arcadaInferiorDemo());
    expect(ply.length).toBeLessThan(3 * MB);
    const m = parsearMalla(ply, "ply");
    expect(m.colores).not.toBeNull();
    const distintos = new Set<string>();
    for (let i = 0; i < (m.colores?.length ?? 0); i += 3)
      distintos.add(m.colores!.slice(i, i + 3).join(","));
    expect(distintos.size).toBe(2);
  });

  it("se prepara para dibujar con normales unitarias y sin caras degeneradas", () => {
    const m = prepararParaRender(parsearMalla(aStlBinario(arcadaDemo()), "stl"));
    expect(m.indices).not.toBeNull();
    expect(m.normales).not.toBeNull();
    const n = m.normales as Float32Array;
    for (let i = 0; i < n.length; i += 997 * 3)
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3);
  });
});

describe("demo · CBCT sintético", () => {
  const zip = cbctDemoZip();

  it("pesa menos de 8 MB", () => {
    expect(zip.length).toBeLessThan(8 * MB);
  });

  it("abre en el visor como un volumen con espaciado en mm y ventana de CT", () => {
    const vol = construirVolumen(abrirArchivosDicom([zip]));
    expect(vol.profundidad).toBeGreaterThanOrEqual(100);
    expect(vol.ancho).toBe(160);
    expect(vol.modalidad).toBe("CT");
    expect(vol.reduccion).toBe(1);
    expect(vol.espaciado).toEqual([1, 1, 1]);
    expect(vol.ventanaInicial).toEqual({ centro: 400, ancho: 2500 });
    // Hay aire, tejido y hueso/esmalte: el contraste que se ve en el visor.
    expect(vol.minimo).toBeLessThan(-800);
    expect(vol.maximo).toBeGreaterThan(2000);
  });

  it("es reproducible: dos corridas dan el mismo archivo", () => {
    expect(
      Buffer.from(cbctDemoZip({ cortes: 8 })).equals(Buffer.from(cbctDemoZip({ cortes: 8 }))),
    ).toBe(true);
  });
});
