import { describe, expect, it } from "vitest";

import { formatoFechaDicom, parsearDicom } from "@/lib/visores/dicom";
import {
  aObj,
  aPlyAscii,
  aPlyBinario,
  aStlAscii,
  aStlBinario,
  arcadaDeEjemplo,
  escribirDicom,
  fantomaCbct,
  fantomaCbctZip,
  tetraedro,
} from "@/lib/visores/ejemplos";
import {
  ErrorDeVisor,
  cajaDe,
  esStlBinario,
  formatoPropietario,
  parsearMalla,
  parsearObj,
  parsearPly,
  parsearStl,
} from "@/lib/visores/malla";
import { distancia3d, distanciaEnCorte, formatoMm } from "@/lib/visores/medida";
import {
  abrirArchivosDicom,
  aplicarVentana,
  construirVolumen,
  extraerCorte,
  factorDeReduccion,
} from "@/lib/visores/volumen";

// Fixtures chicos generados en el momento (src/lib/visores/ejemplos.ts):
// sin binarios versionados y sin datos de pacientes.

describe("STL", () => {
  it("lee un STL binario", () => {
    const bytes = aStlBinario(tetraedro());
    expect(esStlBinario(bytes)).toBe(true);
    const m = parsearStl(bytes);
    expect(m.triangulos).toBe(4);
    expect(m.indices).toBeNull();
    expect(Array.from(m.posiciones.slice(0, 9))).toEqual([0, 0, 0, 0, 10, 0, 10, 0, 0]);
  });

  it("lee un STL ASCII con el mismo resultado", () => {
    const bytes = aStlAscii(tetraedro());
    expect(esStlBinario(bytes)).toBe(false);
    const ascii = parsearStl(bytes);
    const binario = parsearStl(aStlBinario(tetraedro()));
    expect(ascii.triangulos).toBe(4);
    expect(Array.from(ascii.posiciones)).toEqual(Array.from(binario.posiciones));
  });

  it("un STL binario cuya cabecera empieza con 'solid' se reconoce igual", () => {
    const bytes = aStlBinario(tetraedro());
    bytes.set(new TextEncoder().encode("solid modelo"), 0);
    expect(parsearStl(bytes).triangulos).toBe(4);
  });

  it("la arcada de ejemplo mide lo que un modelo de yeso", () => {
    const m = parsearStl(aStlBinario(arcadaDeEjemplo()));
    const { min, max } = cajaDe(m.posiciones);
    expect(max[0] - min[0]).toBeGreaterThan(40);
    expect(max[0] - min[0]).toBeLessThan(70);
    expect(max[2] - min[2]).toBeGreaterThan(8);
  });

  it("un archivo vacío o sin triángulos da un error que se puede mostrar", () => {
    expect(() => parsearMalla(new Uint8Array(), "stl")).toThrow(ErrorDeVisor);
    expect(() => parsearStl(new TextEncoder().encode("solid vacio\nendsolid vacio\n"))).toThrow(
      /no tiene triángulos/,
    );
  });
});

describe("PLY", () => {
  it("lee un PLY ASCII con color", () => {
    const m = parsearPly(aPlyAscii(tetraedro()));
    expect(m.vertices).toBe(4);
    expect(m.triangulos).toBe(4);
    expect(Array.from(m.indices ?? [])).toEqual(tetraedro().indices);
    expect(m.colores?.[0]).toBeCloseTo(1);
    expect(m.colores?.[1]).toBeCloseTo(0);
  });

  it("lee un PLY binario little endian igual que el ASCII", () => {
    const a = parsearPly(aPlyAscii(tetraedro()));
    const b = parsearPly(aPlyBinario(tetraedro()));
    expect(Array.from(b.posiciones)).toEqual(Array.from(a.posiciones));
    expect(Array.from(b.indices ?? [])).toEqual(Array.from(a.indices ?? []));
  });

  it("triangula un cuadrilátero en abanico", () => {
    const ply = `ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n`;
    const m = parsearPly(new TextEncoder().encode(ply));
    expect(Array.from(m.indices ?? [])).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("una nube de puntos sin caras se explica", () => {
    const ply = `ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n`;
    expect(() => parsearPly(new TextEncoder().encode(ply))).toThrow(/nube de puntos/);
  });
});

describe("OBJ", () => {
  it("lee vértices y caras con normales (v//vn) desde 1", () => {
    const m = parsearObj(aObj(tetraedro()));
    expect(m.vertices).toBe(4);
    expect(Array.from(m.indices ?? [])).toEqual(tetraedro().indices);
  });

  it("acepta índices negativos y polígonos", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1\n";
    const m = parsearObj(new TextEncoder().encode(obj));
    expect(Array.from(m.indices ?? [])).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("un índice fuera de rango no pasa", () => {
    expect(() => parsearObj(new TextEncoder().encode("v 0 0 0\nf 1 2 3\n"))).toThrow(
      /índices inválidos/,
    );
  });
});

describe("formatos propietarios", () => {
  it("un .dcm de 3Shape no se confunde con DICOM", () => {
    const hps = new TextEncoder().encode(
      '<?xml version="1.0"?>\n<HPS version="1.1"><Packed_geometry>…',
    );
    expect(formatoPropietario(hps)).toMatch(/3Shape/);
    expect(() => parsearDicom(hps)).toThrow(/3Shape/);
    expect(() => parsearMalla(hps, "stl")).toThrow(/3Shape/);
    // Abierto como estudio DICOM (lo que hace el visor) explica lo mismo.
    expect(() => abrirArchivosDicom([hps])).toThrow(/3Shape/);
  });

  it("un archivo que no es DICOM se explica", () => {
    expect(() => abrirArchivosDicom([new TextEncoder().encode("hola")])).toThrow(
      /ninguna imagen DICOM/,
    );
  });

  it("un proyecto de Exocad pide exportar a STL o PLY", () => {
    const xml = new TextEncoder().encode(
      '<?xml version="1.0"?><DentalProject><Teeth/></DentalProject>',
    );
    expect(formatoPropietario(xml)).toMatch(/Exocad/);
  });
});

describe("encabezado DICOM", () => {
  it("lee tamaño, espaciado, posición, ventana, fecha y modalidad", () => {
    const [archivo] = fantomaCbct({ lado: 8, cortes: 2, espaciado: 0.25, espesor: 0.3 });
    const c = parsearDicom(archivo);
    expect(c.filas).toBe(8);
    expect(c.columnas).toBe(8);
    expect(c.espaciadoPixel).toEqual([0.25, 0.25]);
    expect(c.grosorCorte).toBeCloseTo(0.3);
    expect(c.posicion?.slice(0, 2)).toEqual([-16, -16]);
    expect(c.orientacion).toEqual([1, 0, 0, 0, 1, 0]);
    expect(c.ventana).toEqual({ centro: 500, ancho: 2500 });
    expect(c.intercepto).toBe(-1024);
    expect(c.modalidad).toBe("CT");
    expect(c.fechaEstudio).toBe("20260312");
    expect(c.pixeles?.byteLength).toBe(8 * 8 * 2);
  });

  it("el espaciado DICOM [filas, columnas] queda como [x, y]", () => {
    const px = new Uint8Array(4 * 2 * 2);
    const archivo = escribirDicom([
      { tag: 0x00280010, vr: "US", valor: [2] },
      { tag: 0x00280011, vr: "US", valor: [4] },
      { tag: 0x00280030, vr: "DS", valor: [0.2, 0.1] },
      { tag: 0x00280100, vr: "US", valor: [16] },
      { tag: 0x7fe00010, vr: "OW", valor: px },
    ]);
    expect(parsearDicom(archivo).espaciadoPixel).toEqual([0.1, 0.2]);
  });

  it("lee la sintaxis implícita little endian", () => {
    const [archivo] = fantomaCbct({ lado: 8, cortes: 2, sintaxis: "implicita" });
    const c = parsearDicom(archivo);
    expect(c.sintaxis).toBe("1.2.840.10008.1.2");
    expect(c.espaciadoPixel).toEqual([0.5, 0.5]);
    expect(c.filas).toBe(8);
  });

  it("no lee los datos del paciente (grupo 0010)", () => {
    const [archivo] = fantomaCbct({ lado: 8, cortes: 2, conNombreFalso: true });
    const c = parsearDicom(archivo);
    const todo = JSON.stringify({ ...c, pixeles: null });
    expect(todo).not.toMatch(/PRUEBA|NO MOSTRAR|11\.111|19800101/);
  });

  it("un DICOM comprimido explica cómo exportarlo", () => {
    const archivo = escribirDicom([{ tag: 0x00280010, vr: "US", valor: [2] }]);
    // Cambia la sintaxis por JPEG 2000 (mismo largo de UID no importa: se reescribe).
    const jpeg = escribirConSintaxis(archivo, "1.2.840.10008.1.2.4.90");
    expect(() => parsearDicom(jpeg)).toThrow(/JPEG 2000/);
  });

  it("formatea la fecha del estudio", () => {
    expect(formatoFechaDicom("20260312")).toMatch(/12.*mar.*2026/);
    expect(formatoFechaDicom("2026")).toBeNull();
  });
});

function escribirConSintaxis(_base: Uint8Array, uid: string): Uint8Array {
  // Metainformación con otra sintaxis + un elemento cualquiera.
  const enc = new TextEncoder();
  const valor = uid.length % 2 ? uid + "\0" : uid;
  const meta = new Uint8Array(8 + valor.length);
  const v = new DataView(meta.buffer);
  v.setUint16(0, 0x0002, true);
  v.setUint16(2, 0x0010, true);
  meta[4] = 85; // U
  meta[5] = 73; // I
  v.setUint16(6, valor.length, true);
  meta.set(enc.encode(valor), 8);
  const out = new Uint8Array(132 + meta.length + 8);
  out.set(enc.encode("DICM"), 128);
  out.set(meta, 132);
  return out;
}

describe("volumen", () => {
  it("ordena los cortes por posición y toma el espaciado entre cortes de las posiciones", () => {
    const archivos = fantomaCbct({ lado: 16, cortes: 10, espaciado: 0.4, espesor: 0.6 });
    const vol = construirVolumen(abrirArchivosDicom(archivos));
    expect([vol.ancho, vol.alto, vol.profundidad]).toEqual([16, 16, 10]);
    expect(vol.espaciado[0]).toBeCloseTo(0.4);
    expect(vol.espaciado[2]).toBeCloseTo(0.6);
    expect(vol.espesorSupuesto).toBe(false);
    // Reescalado: aire = −1000 HU en la esquina.
    expect(vol.datos[0]).toBe(-1000);
    expect(vol.minimo).toBe(-1000);
    expect(vol.maximo).toBe(2200);
  });

  it("abre el estudio desde un ZIP", () => {
    const vol = construirVolumen(abrirArchivosDicom([fantomaCbctZip({ lado: 16, cortes: 6 })]));
    expect(vol.profundidad).toBe(6);
    expect(vol.modalidad).toBe("CT");
  });

  it("reduce la resolución cuando el volumen excede el presupuesto", () => {
    expect(factorDeReduccion(536, 536, 440, 64_000_000)).toBe(2);
    const vol = construirVolumen(
      abrirArchivosDicom(fantomaCbct({ lado: 16, cortes: 8, espaciado: 0.5 })),
      {
        maxVoxeles: 600,
      },
    );
    expect(vol.reduccion).toBe(2);
    expect([vol.ancho, vol.alto, vol.profundidad]).toEqual([8, 8, 4]);
    expect(vol.espaciado[0]).toBeCloseTo(1);
  });

  it("extrae cortes coronal y sagital con el espaciado de cada plano", () => {
    const vol = construirVolumen(
      abrirArchivosDicom(fantomaCbct({ lado: 12, cortes: 5, espaciado: 0.3, espesor: 0.9 })),
    );
    const axial = extraerCorte(vol, "axial", 2);
    expect([axial.ancho, axial.alto]).toEqual([12, 12]);
    expect(axial.espaciado).toEqual([0.3, 0.3]);
    const coronal = extraerCorte(vol, "coronal", 6);
    expect([coronal.ancho, coronal.alto]).toEqual([12, 5]);
    expect(coronal.espaciado[1]).toBeCloseTo(0.9);
    // La fila de arriba del coronal es el corte más alto (z = 4).
    expect(coronal.valores[3]).toBe(vol.datos[4 * 144 + 6 * 12 + 3]);
    const sagital = extraerCorte(vol, "sagital", 3);
    expect([sagital.ancho, sagital.alto]).toEqual([12, 5]);
    expect(sagital.valores[(5 - 1 - 0) * 12 + 7]).toBe(vol.datos[0 * 144 + 7 * 12 + 3]);
  });

  it("la ventana lleva el nivel a gris medio y satura fuera del ancho", () => {
    const corte = {
      ancho: 3,
      alto: 1,
      valores: Int16Array.from([-1000, 500, 3000]),
      espaciado: [1, 1] as [number, number],
    };
    const rgba = new Uint8ClampedArray(12);
    aplicarVentana(corte, 500, 2000, false, rgba);
    expect([rgba[0], rgba[4], rgba[8]]).toEqual([0, 128, 255]);
    aplicarVentana(corte, 500, 2000, true, rgba);
    expect(rgba[0]).toBe(255);
  });
});

describe("medidas en mm", () => {
  it("distancia entre dos puntos de la malla", () => {
    expect(distancia3d([0, 0, 0], [3, 4, 12])).toBeCloseTo(13);
  });

  it("distancia en un corte usa el espaciado de cada eje", () => {
    // 10 columnas a 0,3 mm y 4 filas a 0,9 mm.
    expect(distanciaEnCorte([0, 0], [10, 0], [0.3, 0.9])).toBeCloseTo(3);
    expect(distanciaEnCorte([0, 0], [0, 4], [0.3, 0.9])).toBeCloseTo(3.6);
    expect(distanciaEnCorte([2, 1], [6, 4], [0.5, 0.5])).toBeCloseTo(2.5);
  });

  it("formatea con coma decimal", () => {
    expect(formatoMm(2.5)).toBe("2,50 mm");
    expect(formatoMm(12.345)).toBe("12,3 mm");
  });
});
