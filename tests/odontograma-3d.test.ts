import { describe, expect, it } from "vitest";

import {
  FDI_ALL_ADULT,
  FDI_ALL_PRIMARY,
  type OdontogramMark,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  carasDeLaCorona,
  colocarPieza,
  describirPieza,
  describirVista3D,
  esLadoDerecho,
  pinturaDePieza,
  tipoDePieza,
} from "@/lib/clinical/odontograma-3d";
import { COLORES_SIMBOLOGIA, OPACIDAD_PLANIFICADO } from "@/lib/clinical/odontograma-reglas";

/** ODO-10: mapeo puro de hallazgos a la vista 3D (sin three.js ni WebGL). */

let n = 0;
function marca(
  toothNumber: number,
  surface: ToothSurface,
  condition: ToothCondition,
  extra: Partial<OdontogramMark> = {},
): OdontogramMark {
  return {
    id: `m-${++n}`,
    toothNumber,
    surface,
    condition,
    status: "existente",
    conservation: null,
    material: null,
    notes: null,
    supersededAt: null,
    recordedAt: "2026-10-27T10:00:00Z",
    recordedById: "u",
    recordedByName: null,
    ...extra,
  };
}

describe("tipo y lado de cada pieza", () => {
  it("clasifica permanentes y temporales", () => {
    expect([11, 13, 14, 16, 18].map(tipoDePieza)).toEqual([
      "incisivo",
      "canino",
      "premolar",
      "molar",
      "molar",
    ]);
    expect([51, 53, 54, 85].map(tipoDePieza)).toEqual(["incisivo", "canino", "molar", "molar"]);
  });

  it("el lado derecho del paciente son los cuadrantes 1, 4, 5 y 8", () => {
    expect([18, 41, 55, 85].every(esLadoDerecho)).toBe(true);
    expect([21, 38, 61, 71].some(esLadoDerecho)).toBe(false);
  });
});

describe("colocarPieza", () => {
  it("pone el lado derecho del paciente a la izquierda de quien mira y es simétrica", () => {
    const d = colocarPieza(16);
    const i = colocarPieza(26);
    expect(d.x).toBeLessThan(0);
    expect(i.x).toBeCloseTo(-d.x, 6);
    expect(i.z).toBeCloseTo(d.z, 6);
    expect(i.rotY).toBeCloseTo(-d.rotY, 6);
  });

  it("los incisivos van adelante y los molares atrás; superior arriba, inferior abajo", () => {
    expect(colocarPieza(11).z).toBeGreaterThan(colocarPieza(17).z);
    expect(colocarPieza(11).y).toBeGreaterThan(0);
    expect(colocarPieza(41).y).toBeLessThan(0);
  });

  it("las 32 permanentes no se pisan entre sí dentro de cada arcada", () => {
    const pos = FDI_ALL_ADULT.map((t) => ({ t, ...colocarPieza(t) }));
    for (const a of pos)
      for (const b of pos) {
        if (a.t >= b.t || a.superior !== b.superior) continue;
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        expect(dist, `${a.t} y ${b.t}`).toBeGreaterThan((a.ancho + b.ancho) / 2 - 0.05);
      }
  });

  it("las temporales van en una arcada interior y más chica", () => {
    for (const t of FDI_ALL_PRIMARY) {
      const temporal = colocarPieza(t);
      expect(Math.hypot(temporal.x, temporal.z)).toBeLessThan(3.6);
    }
    expect(colocarPieza(54).ancho).toBeLessThan(colocarPieza(14).ancho + 0.3);
    expect(colocarPieza(51).alto).toBeLessThan(colocarPieza(11).alto);
  });

  it("la cara vestibular (+Z local) mira hacia afuera de la arcada", () => {
    for (const t of FDI_ALL_ADULT) {
      const c = colocarPieza(t);
      const afuera = { x: Math.sin(c.rotY), z: Math.cos(c.rotY) };
      // Producto con la posición (el centro de la arcada está cerca del origen).
      expect(afuera.x * c.x + afuera.z * c.z, String(t)).toBeGreaterThan(0);
    }
  });
});

describe("carasDeLaCorona", () => {
  it("mapea las caras de la caja a superficies según cuadrante", () => {
    // Orden de BoxGeometry: +X, −X, +Y, −Y, +Z, −Z.
    expect(carasDeLaCorona(16)).toEqual([
      "mesial",
      "distal",
      null,
      "oclusal",
      "vestibular",
      "lingual",
    ]);
    expect(carasDeLaCorona(26)).toEqual([
      "distal",
      "mesial",
      null,
      "oclusal",
      "vestibular",
      "lingual",
    ]);
    expect(carasDeLaCorona(36)).toEqual([
      "distal",
      "mesial",
      "oclusal",
      null,
      "vestibular",
      "lingual",
    ]);
    expect(carasDeLaCorona(46)).toEqual([
      "mesial",
      "distal",
      "oclusal",
      null,
      "vestibular",
      "lingual",
    ]);
  });

  it("+X local apunta a la línea media en el lado derecho (mesial) y lejos en el izquierdo", () => {
    for (const t of [11, 14, 16, 41, 44, 21, 24, 26, 31, 34]) {
      const c = colocarPieza(t);
      // +X local en el mundo: (cos rotY, 0, −sin rotY). La línea media está hacia el incisivo central.
      const masX = { x: Math.cos(c.rotY), z: -Math.sin(c.rotY) };
      const central = colocarPieza(Math.floor(t / 10) * 10 + 1);
      const haciaCentral = { x: central.x - c.x, z: central.z - c.z };
      const hacia = masX.x * haciaCentral.x + masX.z * haciaCentral.z;
      if (t % 10 === 1) continue; // el central es el propio punto de referencia
      const mesialEsMasX = carasDeLaCorona(t)[0] === "mesial";
      expect(hacia > 0, String(t)).toBe(mesialEsMasX);
    }
  });
});

describe("pinturaDePieza", () => {
  it("pinta cada superficie con el mismo color y regla que el 2D", () => {
    const p = pinturaDePieza([
      marca(16, "oclusal", "caries"),
      marca(16, "mesial", "obturacion", { conservation: "bueno" }),
      marca(16, "distal", "obturacion", { status: "planificado" }),
    ]);
    expect(p.caras.oclusal?.color).toBe(COLORES_SIMBOLOGIA.rojo);
    expect(p.caras.mesial?.color).toBe(COLORES_SIMBOLOGIA.azul);
    expect(p.caras.distal).toMatchObject({
      color: COLORES_SIMBOLOGIA.rojo,
      opacidad: OPACIDAD_PLANIFICADO,
    });
    expect(p.caras.vestibular).toBeNull();
    expect(p.pieza).toBeNull();
    expect(p.conHallazgos).toBe(true);
  });

  it("si una superficie tiene dos marcas, gana la existente y roja (marcaParaPintar)", () => {
    const p = pinturaDePieza([
      marca(16, "oclusal", "obturacion", { status: "planificado" }),
      marca(16, "oclusal", "caries"),
    ]);
    expect(p.caras.oclusal?.marca.condition).toBe("caries");
  });

  it("una corona existente tapa la corona entera; una endodoncia va al cuello", () => {
    const p = pinturaDePieza([
      marca(11, "whole", "corona", { conservation: "bueno" }),
      marca(11, "whole", "endodoncia", { conservation: "malo" }),
    ]);
    expect(p.pieza?.marca.condition).toBe("corona");
    expect(p.pieza?.color).toBe(COLORES_SIMBOLOGIA.azul);
    expect(p.cuello?.marca.condition).toBe("endodoncia");
    expect(p.cuello?.color).toBe(COLORES_SIMBOLOGIA.rojo);
    expect(p.sinCorona).toBe(false);
  });

  it("ausente deja la pieza fantasma; una corona por realizar no tapa", () => {
    expect(pinturaDePieza([marca(18, "whole", "ausente")]).sinCorona).toBe(true);
    const plan = pinturaDePieza([marca(11, "whole", "corona", { status: "planificado" })]);
    expect(plan.pieza).toBeNull();
    expect(plan.cuello?.opacidad).toBe(OPACIDAD_PLANIFICADO);
  });

  it("ignora sano y observaciones", () => {
    const p = pinturaDePieza([
      marca(21, "oclusal", "sano"),
      marca(21, "whole", "observacion", { notes: "texto" }),
    ]);
    expect(p.conHallazgos).toBe(false);
    expect(p.cuello).toBeNull();
    expect(p.caras.oclusal).toBeNull();
  });
});

describe("descripción textual (alternativa accesible)", () => {
  it("describe cada pieza con hallazgos en palabras", () => {
    expect(describirPieza(16, [marca(16, "oclusal", "caries")])).toBe(
      "16 primer molar superior derecho: Caries en oclusal / incisal",
    );
    expect(describirPieza(11, [marca(11, "oclusal", "sano")])).toBeNull();
  });

  it("resume la vista y lista solo las piezas con hallazgos", () => {
    const porPieza = new Map<number, OdontogramMark[]>([
      [16, [marca(16, "oclusal", "caries")]],
      [18, [marca(18, "whole", "ausente")]],
      [11, [marca(11, "vestibular", "sano")]],
    ]);
    const d = describirVista3D([...FDI_ALL_ADULT], porPieza, "permanente");
    expect(d.resumen).toBe(
      "Modelo 3D de la dentición permanente: 32 piezas. 2 con hallazgos registrados, 1 ausente.",
    );
    expect(d.piezas.map((p) => p.tooth)).toEqual([18, 16]);
  });

  it("lo dice cuando no hay nada registrado", () => {
    const d = describirVista3D([55, 54], new Map(), "temporal");
    expect(d.resumen).toBe(
      "Modelo 3D de la dentición temporal: 2 piezas. Ninguna tiene hallazgos registrados.",
    );
  });
});
