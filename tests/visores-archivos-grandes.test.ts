import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";

import { descargar } from "@/lib/visores/descarga";
import {
  arcadaDeEjemplo,
  aObj,
  aPlyAscii,
  aPlyBinario,
  aStlAscii,
  aStlBinario,
  escribirDicom,
  fantomaCbct,
  fantomaCbctZip,
  tetraedro,
} from "@/lib/visores/ejemplos";
import {
  LIMITES_EQUIPO_CHICO,
  MAX_BYTES_MALLA,
  MAX_BYTES_MALLA_TEXTO,
  MAX_TRIANGULOS_SOLDAR,
  MAX_VOXELES,
  ErrorDeVisor,
  limitesDelEquipo,
} from "@/lib/visores/limites";
import {
  calcularNormales,
  parsearMalla,
  parsearObj,
  parsearPly,
  parsearStl,
  prepararParaRender,
  soldarVertices,
} from "@/lib/visores/malla";
import { bufferesDe, ejecutarTarea } from "@/lib/visores/tareas";
import { abrirArchivosDicom, construirVolumen } from "@/lib/visores/volumen";

/**
 * Archivos grandes (CBCT de 100-200 MB, escaneos de 20-200 MB): los límites,
 * los lectores que no arman un texto gigante, la soldadura de vértices y las
 * normales que se calculan fuera del hilo de la interfaz, el ZIP que se
 * descomprime de a un corte y la descarga que se retoma si se corta.
 */

const MB = 1024 * 1024;

describe("límites", () => {
  it("un archivo de 200 MB entra en el visor de un computador", () => {
    expect(MAX_BYTES_MALLA).toBe(200 * MB);
    expect(MAX_BYTES_MALLA_TEXTO).toBe(200 * MB);
    expect(limitesDelEquipo(false).bytesDicom).toBeGreaterThanOrEqual(200 * MB);
  });
  it("el teléfono tiene topes más bajos, siempre", () => {
    const pc = limitesDelEquipo(false);
    const tel = limitesDelEquipo(true);
    expect(tel.chico).toBe(true);
    expect(tel.bytesMalla).toBeLessThan(pc.bytesMalla);
    expect(tel.bytesMallaTexto).toBeLessThan(pc.bytesMallaTexto);
    expect(tel.triangulos).toBeLessThan(pc.triangulos);
    expect(tel.voxeles).toBeLessThan(pc.voxeles);
    expect(tel.bytesDicom).toBe(LIMITES_EQUIPO_CHICO.bytesDicom);
  });
  it("un CBCT típico de 512 × 512 × 380 se ve a resolución completa en el computador", () => {
    expect(512 * 512 * 380).toBeLessThanOrEqual(MAX_VOXELES);
  });
  it("el tope del equipo se informa en el mensaje", () => {
    const m = parsearStl(aStlBinario(tetraedro()));
    expect(m.triangulos).toBe(4);
    expect(() => parsearMalla(aStlBinario(tetraedro()), "stl", { triangulos: 3 })).toThrow(
      /máximo para este equipo es 3/,
    );
    const grande = new Uint8Array(2 * MB);
    grande.set(new TextEncoder().encode("solid x"));
    expect(() => parsearMalla(grande, "stl", { bytes: 1 * MB })).toThrow(/pesa más de 1 MB/);
  });
});

describe("lectores de texto por bytes", () => {
  it("OBJ: decimales, notación científica, colores y comentarios", () => {
    const obj = [
      "# comentario",
      "mtllib x.mtl",
      "v 1.5 -2.25e1 +3 0.5 0.25 0",
      "v 0 0 0 1 1 1",
      "v .5 5. -0.001 0 0 1",
      "vt 0 0",
      "vn 0 0 1",
      "f 1/1/1 2/1/1 3/1/1",
      "",
    ].join("\r\n");
    const m = parsearObj(new TextEncoder().encode(obj));
    expect(Array.from(m.posiciones)).toEqual(
      [1.5, -22.5, 3, 0, 0, 0, 0.5, 5, -0.001].map(Math.fround),
    );
    expect(m.colores).not.toBeNull();
    expect(m.triangulos).toBe(1);
  });

  it("OBJ: un polígono se triangula y una cara con índice malo falla", () => {
    const quad = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
    expect(Array.from(parsearObj(new TextEncoder().encode(quad)).indices ?? [])).toEqual([
      0, 1, 2, 0, 2, 3,
    ]);
    expect(() => parsearObj(new TextEncoder().encode("v 0 0 0\nf 1 2 9\n"))).toThrow(
      /índices inválidos/,
    );
    expect(() => parsearObj(new TextEncoder().encode("v 0 0 x\nf 1 1 1\n"))).toThrow(
      /no son números/,
    );
  });

  it("OBJ: sin color en alguna línea, no hay colores", () => {
    const obj = "v 0 0 0 1 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    expect(parsearObj(new TextEncoder().encode(obj)).colores).toBeNull();
  });

  it("STL ASCII con mayúsculas, sangrías y saltos de Windows", () => {
    const stl =
      "SOLID x\r\n  FACET NORMAL 0 0 1\r\n    OUTER LOOP\r\n      VERTEX 0 0 0\r\n\tVERTEX 1e0 0 0\r\n      VERTEX 0 1 0\r\n    ENDLOOP\r\n  ENDFACET\r\nENDSOLID x\r\n";
    const m = parsearStl(new TextEncoder().encode(stl));
    expect(m.triangulos).toBe(1);
    expect(Array.from(m.posiciones)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("PLY ASCII y binario dan lo mismo, con y sin color", () => {
    for (const conColor of [true, false]) {
      const base = tetraedro();
      const malla = conColor ? base : { ...base, colores: undefined };
      const a = parsearPly(aPlyAscii(malla));
      const b = parsearPly(aPlyBinario(malla));
      expect(Array.from(a.indices ?? [])).toEqual(Array.from(b.indices ?? []));
      expect(Array.from(a.posiciones)).toEqual(Array.from(b.posiciones));
      expect(a.colores === null).toBe(b.colores === null);
    }
  });

  it("un PLY ASCII con valores que no son números se rechaza", () => {
    const ply =
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 nan\n0 1 0\n3 0 1 2\n";
    expect(() => parsearPly(new TextEncoder().encode(ply))).toThrow(/no son números/);
  });

  it("un PLY truncado dice que está incompleto", () => {
    const bin = aPlyBinario(tetraedro());
    expect(() => parsearPly(bin.slice(0, bin.length - 20))).toThrow(/incompleto/);
  });

  it("el tope de triángulos corta antes de llenar la memoria", () => {
    const arcada = arcadaDeEjemplo();
    const total = arcada.indices.length / 3;
    expect(() => parsearPly(aPlyBinario(arcada), { triangulos: Math.floor(total / 2) })).toThrow(
      /triángulos/,
    );
    expect(() => parsearObj(aObj(arcada), { triangulos: 100 })).toThrow(/triángulos/);
  });

  it("el tope de texto es independiente del binario", () => {
    expect(() => parsearObj(aObj(tetraedro()), { bytesTexto: 10 })).toThrow(/demasiado grande/);
    expect(() => parsearStl(aStlAscii(tetraedro()), { bytesTexto: 10 })).toThrow(
      /demasiado grande/,
    );
    expect(parsearPly(aPlyBinario(tetraedro()), { bytesTexto: 10 }).triangulos).toBe(4);
  });
});

describe("soldar vértices y normales", () => {
  it("el STL de la arcada baja a una fracción de los vértices y conserva los triángulos", () => {
    const stl = parsearStl(aStlBinario(arcadaDeEjemplo()));
    const soldada = soldarVertices(stl);
    expect(soldada.indices).not.toBeNull();
    expect(soldada.triangulos).toBe(stl.triangulos);
    expect(soldada.vertices).toBeLessThan(stl.vertices / 2);
    expect(soldada.indices?.length).toBe(stl.triangulos * 3);
    // Cada triángulo apunta a las mismas coordenadas que antes.
    const idx = soldada.indices as Uint32Array;
    for (let v = 0; v < idx.length; v += 97) {
      for (let k = 0; k < 3; k++) {
        expect(soldada.posiciones[idx[v] * 3 + k]).toBe(stl.posiciones[v * 3 + k]);
      }
    }
  });

  it("un modelo con índices no se toca; uno enorme no se suelda", () => {
    const ply = parsearPly(aPlyBinario(tetraedro()));
    expect(soldarVertices(ply)).toBe(ply);
    const falso = {
      ...parsearStl(aStlBinario(tetraedro())),
      triangulos: MAX_TRIANGULOS_SOLDAR + 1,
    };
    expect(soldarVertices(falso)).toBe(falso);
  });

  it("las normales son unitarias y apuntan hacia afuera en un tetraedro", () => {
    const m = parsearPly(aPlyBinario(tetraedro()));
    const n = calcularNormales(m.posiciones, m.indices as Uint32Array);
    for (let i = 0; i < n.length; i += 3)
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 5);
    // El vértice 0 (origen) del tetraedro mira hacia -x, -y, -z.
    expect(n[0]).toBeLessThan(0);
    expect(n[1]).toBeLessThan(0);
    expect(n[2]).toBeLessThan(0);
  });

  it("prepararParaRender deja normales; sin soldar (muy grande) no inventa", () => {
    const m = prepararParaRender(parsearStl(aStlBinario(arcadaDeEjemplo())));
    expect(m.normales?.length).toBe(m.posiciones.length);
    const enorme = {
      ...parsearStl(aStlBinario(tetraedro())),
      triangulos: MAX_TRIANGULOS_SOLDAR + 1,
    };
    expect(prepararParaRender(enorme).normales ?? null).toBeNull();
  });
});

describe("tarea del worker", () => {
  it("modelo: parsea, prepara y lista los búferes a transferir", () => {
    const r = ejecutarTarea({
      tipo: "malla",
      formato: "stl",
      bytes: aStlBinario(arcadaDeEjemplo()),
      topes: {},
    });
    expect(r.tipo).toBe("malla");
    if (r.tipo !== "malla") return;
    const buferes = bufferesDe(r);
    expect(buferes.length).toBeGreaterThanOrEqual(3); // posiciones, índices, normales
    expect(new Set(buferes).size).toBe(buferes.length);
  });

  it("CBCT: abre el ZIP, arma el volumen y avisa el avance sin retroceder", () => {
    const avance: number[] = [];
    const r = ejecutarTarea(
      {
        tipo: "dicom",
        archivos: [fantomaCbctZip({ lado: 24, cortes: 12 })],
        maxVoxeles: 1e6,
        maxBytes: 50 * MB,
      },
      (f) => avance.push(f),
    );
    expect(r.tipo).toBe("dicom");
    if (r.tipo !== "dicom") return;
    expect(r.volumen.profundidad).toBe(12);
    expect(bufferesDe(r)).toHaveLength(1);
    expect(avance.at(-1)).toBe(1);
    expect([...avance].sort((a, b) => a - b)).toEqual(avance);
  });

  it("un error de visor llega con su mensaje", () => {
    expect(() =>
      ejecutarTarea({ tipo: "malla", formato: "stl", bytes: new Uint8Array(), topes: {} }),
    ).toThrow(ErrorDeVisor);
  });
});

describe("CBCT en ZIP: se descomprime de a un corte", () => {
  it("da el mismo volumen que con los archivos sueltos", () => {
    const opciones = { lado: 20, cortes: 9, espaciado: 0.4 };
    const suelto = construirVolumen(abrirArchivosDicom(fantomaCbct(opciones)));
    const zip = construirVolumen(abrirArchivosDicom([fantomaCbctZip(opciones)]));
    expect(zip.profundidad).toBe(suelto.profundidad);
    expect(zip.espaciado).toEqual(suelto.espaciado);
    expect(Array.from(zip.datos)).toEqual(Array.from(suelto.datos));
  });

  it("los cortes del ZIP no guardan sus píxeles hasta que se piden", () => {
    const cortes = abrirArchivosDicom([fantomaCbctZip({ lado: 16, cortes: 6 })]);
    expect(cortes).toHaveLength(6);
    for (const c of cortes) {
      expect(c.pixeles).toBeNull();
      expect(typeof c.cargarPixeles).toBe("function");
      expect(c.cargarPixeles?.().byteLength).toBe(16 * 16 * 2);
    }
  });

  it("reducido por el presupuesto, solo lee los cortes que usa", () => {
    const cortes = abrirArchivosDicom([fantomaCbctZip({ lado: 16, cortes: 8 })]);
    const pedidos = new Set<number>();
    cortes.forEach((c, i) => {
      const original = c.cargarPixeles as () => Uint8Array;
      c.cargarPixeles = () => (pedidos.add(i), original());
    });
    const vol = construirVolumen(cortes, { maxVoxeles: 16 * 16 * 8 * 0.4 });
    expect(vol.reduccion).toBe(2);
    expect(pedidos.size).toBe(vol.profundidad);
    expect(pedidos.size).toBeLessThan(8);
  });

  it("el tope de tamaño descomprimido se revisa con el índice, antes de descomprimir nada", () => {
    const zip = zipSync({ "a.dcm": new Uint8Array(3 * MB), "b.dcm": new Uint8Array(3 * MB) });
    expect(() => abrirArchivosDicom([zip], { maxBytes: 2 * MB })).toThrow(
      /descomprimido pasa de 3 MB/,
    );
  });

  it("un ZIP sin DICOM dice que no encontró imágenes; DICOMDIR y __MACOSX se ignoran", () => {
    const zip = zipSync({
      DICOMDIR: new Uint8Array(100),
      "__MACOSX/._x": new Uint8Array(100),
      "nota.txt": new TextEncoder().encode("hola"),
    });
    expect(() => abrirArchivosDicom([zip])).toThrow(/No se encontró ninguna imagen DICOM/);
  });

  it("un DICOM suelto sigue funcionando", () => {
    const uno = escribirDicom([
      { tag: 0x00280010, vr: "US", valor: [2] },
      { tag: 0x00280011, vr: "US", valor: [2] },
      { tag: 0x00280100, vr: "US", valor: [16] },
      { tag: 0x7fe00010, vr: "OW", valor: new Uint8Array(8) },
    ]);
    const cortes = abrirArchivosDicom([uno]);
    expect(cortes[0].pixeles).not.toBeNull();
  });
});

describe("descarga que se retoma", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function respuestaCortada(
    cuerpo: Uint8Array,
    hasta: number,
    estado = 200,
    total = cuerpo.length,
  ) {
    let enviado = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!enviado) {
          enviado = true;
          c.enqueue(cuerpo.slice(0, hasta));
        } else if (hasta < cuerpo.length) c.error(new TypeError("network error"));
        else c.close();
      },
    });
    return new Response(stream, { status: estado, headers: { "content-length": String(total) } });
  }

  it("si se corta a mitad, pide el resto con Range y entrega el archivo completo", async () => {
    vi.useFakeTimers();
    const archivo = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
    const rangos: (string | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        const r = (init?.headers as Record<string, string> | undefined)?.Range;
        rangos.push(r);
        if (!r) return respuestaCortada(archivo, 400);
        const desde = Number(/bytes=(\d+)-/.exec(r)?.[1]);
        const resto = archivo.slice(desde);
        return new Response(resto, {
          status: 206,
          headers: { "content-length": String(resto.length) },
        });
      }),
    );
    const avances: number[] = [];
    const p = descargar("http://x/y", 10_000, (n) => avances.push(n), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    const bytes = await p;
    expect(bytes.length).toBe(1000);
    expect(Array.from(bytes)).toEqual(Array.from(archivo));
    expect(rangos).toEqual([undefined, "bytes=400-"]);
    expect([...avances].sort((a, b) => a - b)).toEqual(avances);
  });

  it("si el servidor ignora el rango, vuelve a bajar todo", async () => {
    vi.useFakeTimers();
    const archivo = Uint8Array.from({ length: 600 }, (_, i) => (i * 7) % 256);
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++llamadas === 1 ? respuestaCortada(archivo, 200) : respuestaCortada(archivo, 600),
      ),
    );
    const p = descargar("http://x/y", 10_000, () => {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(Array.from(await p)).toEqual(Array.from(archivo));
  });

  it("se rinde con un mensaje claro tras varios cortes seguidos", async () => {
    vi.useFakeTimers();
    const archivo = new Uint8Array(500);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaCortada(archivo, 100)),
    );
    const p = descargar("http://x/y", 10_000, () => {}, new AbortController().signal);
    const resultado = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const e = await resultado;
    expect(e).toBeInstanceOf(ErrorDeVisor);
    expect((e as Error).message).toMatch(/Revisa la conexión/);
  });

  it("si falla la primera petición (sin red un instante), la reintenta sola", async () => {
    vi.useFakeTimers();
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (++llamadas === 1) throw new TypeError("Failed to fetch");
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } });
      }),
    );
    const p = descargar("http://x/y", 10_000, () => {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(Array.from(await p)).toEqual([1, 2, 3]);
    expect(llamadas).toBe(2);
  });

  it("un enlace vencido (403) no se reintenta y lo explica", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 403 })),
    );
    await expect(
      descargar("http://x/y", 10_000, () => {}, new AbortController().signal),
    ).rejects.toThrow(/venció/);
  });

  it("el tope se respeta con el tamaño declarado, antes de bajar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(10), { headers: { "content-length": String(300 * MB) } }),
      ),
    );
    await expect(
      descargar("http://x/y", 200 * MB, () => {}, new AbortController().signal),
    ).rejects.toThrow(/pesa más de 200 MB/);
  });
});
