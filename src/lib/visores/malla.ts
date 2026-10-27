// Mallas 3D de escaneos intraorales y modelos (IMG-03, Ola 13).
//
// Parseo puro, sin three.js: STL (binario y ASCII), PLY (ASCII y binario) y
// OBJ quedan en un formato común que el visor carga en un BufferGeometry.
// Así se prueban sin navegador y three entra solo en el chunk diferido.

/** Error con un mensaje que se puede mostrar tal cual en la interfaz. */
export class ErrorDeVisor extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeVisor";
  }
}

export type Malla = {
  /** x, y, z por vértice. */
  posiciones: Float32Array;
  /** Tres índices por triángulo; null si los vértices ya vienen de a tres (STL). */
  indices: Uint32Array | null;
  /** r, g, b entre 0 y 1 por vértice, si el archivo trae color (PLY). */
  colores: Float32Array | null;
  triangulos: number;
  vertices: number;
};

export type FormatoMalla = "stl" | "ply" | "obj";

export type Caja = { min: [number, number, number]; max: [number, number, number] };

// ─── Límites ─────────────────────────────────────────────────────────────

/** Tamaño máximo de un archivo 3D. Un escaneo de arcada completa pesa 20-60 MB. */
export const MAX_BYTES_MALLA = 200 * 1024 * 1024;
/** Los formatos de texto ocupan ~5 veces más memoria al parsear. */
export const MAX_BYTES_MALLA_TEXTO = 80 * 1024 * 1024;
/** Sobre esto el navegador de un teléfono deja de girar fluido. */
export const MAX_TRIANGULOS = 6_000_000;

// ─── Utilidades ──────────────────────────────────────────────────────────

const decodificador = new TextDecoder("latin1");

function textoDe(bytes: Uint8Array): string {
  return decodificador.decode(bytes);
}

export function cajaDe(posiciones: Float32Array): Caja {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posiciones.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = posiciones[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

function controlarTriangulos(n: number) {
  if (n === 0) throw new ErrorDeVisor("El archivo no tiene triángulos para mostrar.");
  if (n > MAX_TRIANGULOS) {
    throw new ErrorDeVisor(
      `El modelo tiene ${n.toLocaleString("es")} triángulos y el máximo es ${MAX_TRIANGULOS.toLocaleString("es")}. Exporta una versión reducida (decimada) desde el programa del escáner.`,
    );
  }
}

// ─── Formatos que no se pueden abrir ─────────────────────────────────────

/**
 * Reconoce formatos propietarios que llegan con extensión de malla o de
 * DICOM y explica qué hacer. Devuelve null si no es uno de ellos.
 *
 * - 3Shape guarda sus escaneos como `.dcm` (XML con la malla cifrada, raíz
 *   `<HPS`). No es DICOM y no se puede abrir fuera de 3Shape.
 * - Exocad guarda el proyecto en `.dentalProject`, `.constructionInfo`
 *   (XML) y escenas propias; la malla se exporta aparte como STL o PLY.
 */
export function formatoPropietario(bytes: Uint8Array): string | null {
  const cabeza = textoDe(bytes.subarray(0, Math.min(bytes.length, 512)))
    .replace(/^\xEF\xBB\xBF/, "") // BOM de UTF-8 leído como latin1
    .trimStart();
  if (/^<\?xml[^>]*>\s*<HPS\b/i.test(cabeza) || /^<HPS\b/i.test(cabeza)) {
    return "Es un escaneo de 3Shape (.dcm cifrado), no un DICOM. Ábrelo en 3Shape y expórtalo como STL o PLY para verlo aquí.";
  }
  if (/<(?:DentalProject|ConstructionInfo|ExocadProject)\b/i.test(cabeza)) {
    return "Es un archivo de proyecto de Exocad, que solo abre Exocad. Exporta la malla como STL o PLY desde Exocad para verla aquí.";
  }
  return null;
}

// ─── STL ─────────────────────────────────────────────────────────────────

/** Binario si el tamaño calza exacto con la cantidad de triángulos declarada. */
export function esStlBinario(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = vista.getUint32(80, true);
  if (84 + n * 50 === bytes.byteLength) return true;
  // Algunos exportadores dejan bytes de más al final; si empieza con
  // "solid" y trae "facet" en el texto, es ASCII.
  const cabeza = textoDe(bytes.subarray(0, Math.min(bytes.length, 1024))).trimStart();
  if (/^solid/i.test(cabeza) && /facet/i.test(cabeza)) return false;
  return 84 + n * 50 <= bytes.byteLength && n > 0;
}

export function parsearStl(bytes: Uint8Array): Malla {
  return esStlBinario(bytes) ? parsearStlBinario(bytes) : parsearStlAscii(bytes);
}

function parsearStlBinario(bytes: Uint8Array): Malla {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = vista.getUint32(80, true);
  controlarTriangulos(n);
  const posiciones = new Float32Array(n * 9);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12; // normal: se recalcula en el visor
    for (let k = 0; k < 9; k++) {
      posiciones[t * 9 + k] = vista.getFloat32(o, true);
      o += 4;
    }
    o += 2; // atributo
  }
  return { posiciones, indices: null, colores: null, triangulos: n, vertices: n * 3 };
}

function parsearStlAscii(bytes: Uint8Array): Malla {
  if (bytes.byteLength > MAX_BYTES_MALLA_TEXTO) {
    throw new ErrorDeVisor(
      "El STL en texto es demasiado grande para el navegador. Expórtalo como STL binario.",
    );
  }
  const texto = textoDe(bytes);
  const valores: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    valores.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (valores.some((v) => !Number.isFinite(v))) {
    throw new ErrorDeVisor("El STL tiene coordenadas que no son números.");
  }
  const triangulos = Math.floor(valores.length / 9);
  if (valores.length === 0 && !/^\s*solid/i.test(texto.slice(0, 200))) {
    throw new ErrorDeVisor("El archivo no parece un STL válido.");
  }
  controlarTriangulos(triangulos);
  const posiciones = new Float32Array(valores.slice(0, triangulos * 9));
  return { posiciones, indices: null, colores: null, triangulos, vertices: triangulos * 3 };
}

// ─── PLY ─────────────────────────────────────────────────────────────────

type TipoPly = "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "float32" | "float64";

const TIPOS_PLY: Record<string, TipoPly> = {
  char: "int8",
  int8: "int8",
  uchar: "uint8",
  uint8: "uint8",
  short: "int16",
  int16: "int16",
  ushort: "uint16",
  uint16: "uint16",
  int: "int32",
  int32: "int32",
  uint: "uint32",
  uint32: "uint32",
  float: "float32",
  float32: "float32",
  double: "float64",
  float64: "float64",
};

const BYTES_PLY: Record<TipoPly, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};

type PropiedadPly =
  | { nombre: string; lista: false; tipo: TipoPly }
  | { nombre: string; lista: true; tipoCuenta: TipoPly; tipo: TipoPly };

type ElementoPly = { nombre: string; cuenta: number; propiedades: PropiedadPly[] };

function tipoPly(nombre: string): TipoPly {
  const t = TIPOS_PLY[nombre];
  if (!t) throw new ErrorDeVisor(`El PLY usa un tipo de dato desconocido (${nombre}).`);
  return t;
}

function leerPly(vista: DataView, o: number, tipo: TipoPly, le: boolean): number {
  switch (tipo) {
    case "int8":
      return vista.getInt8(o);
    case "uint8":
      return vista.getUint8(o);
    case "int16":
      return vista.getInt16(o, le);
    case "uint16":
      return vista.getUint16(o, le);
    case "int32":
      return vista.getInt32(o, le);
    case "uint32":
      return vista.getUint32(o, le);
    case "float32":
      return vista.getFloat32(o, le);
    case "float64":
      return vista.getFloat64(o, le);
  }
}

export function parsearPly(bytes: Uint8Array): Malla {
  // El encabezado es texto y termina en "end_header\n".
  const inicio = textoDe(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  if (!/^ply\r?\n/.test(inicio)) throw new ErrorDeVisor("El archivo no parece un PLY válido.");
  const fin = inicio.search(/end_header\r?\n/);
  if (fin < 0) throw new ErrorDeVisor("El PLY no tiene el encabezado completo.");
  const finLinea = inicio.indexOf("\n", fin) + 1;
  const lineas = inicio.slice(0, fin).split(/\r?\n/);

  let formato = "";
  const elementos: ElementoPly[] = [];
  for (const linea of lineas) {
    const p = linea.trim().split(/\s+/);
    if (p[0] === "format") formato = p[1];
    else if (p[0] === "element")
      elementos.push({ nombre: p[1], cuenta: Number(p[2]), propiedades: [] });
    else if (p[0] === "property") {
      const el = elementos[elementos.length - 1];
      if (!el) continue;
      if (p[1] === "list") {
        el.propiedades.push({
          nombre: p[4],
          lista: true,
          tipoCuenta: tipoPly(p[2]),
          tipo: tipoPly(p[3]),
        });
      } else {
        el.propiedades.push({ nombre: p[2], lista: false, tipo: tipoPly(p[1]) });
      }
    }
  }
  if (!["ascii", "binary_little_endian", "binary_big_endian"].includes(formato)) {
    throw new ErrorDeVisor("El PLY tiene un formato que no se reconoce.");
  }
  const vertice = elementos.find((e) => e.nombre === "vertex");
  if (!vertice) throw new ErrorDeVisor("El PLY no tiene vértices.");
  const iProp = (n: string) => vertice.propiedades.findIndex((p) => p.nombre === n);
  const ix = iProp("x");
  const iy = iProp("y");
  const iz = iProp("z");
  if (ix < 0 || iy < 0 || iz < 0) throw new ErrorDeVisor("El PLY no trae coordenadas x, y, z.");
  const ir = Math.max(iProp("red"), iProp("r"));
  const ig = Math.max(iProp("green"), iProp("g"));
  const ib = Math.max(iProp("blue"), iProp("b"));
  const conColor = ir >= 0 && ig >= 0 && ib >= 0;
  const escalaColor = (i: number) => {
    const p = vertice.propiedades[i];
    return p.tipo === "float32" || p.tipo === "float64" ? 1 : p.tipo === "uint16" ? 65535 : 255;
  };

  const posiciones = new Float32Array(vertice.cuenta * 3);
  const colores = conColor ? new Float32Array(vertice.cuenta * 3) : null;
  const caras: number[] = [];
  const agregarCara = (idx: number[]) => {
    // Abanico: un polígono de n lados son n - 2 triángulos.
    for (let k = 1; k + 1 < idx.length; k++) caras.push(idx[0], idx[k], idx[k + 1]);
  };
  const guardarVertice = (v: number, valores: number[]) => {
    posiciones[v * 3] = valores[ix];
    posiciones[v * 3 + 1] = valores[iy];
    posiciones[v * 3 + 2] = valores[iz];
    if (colores) {
      colores[v * 3] = valores[ir] / escalaColor(ir);
      colores[v * 3 + 1] = valores[ig] / escalaColor(ig);
      colores[v * 3 + 2] = valores[ib] / escalaColor(ib);
    }
  };
  const esCara = (el: ElementoPly) => el.nombre === "face";
  const propIndices = (el: ElementoPly) =>
    el.propiedades.findIndex(
      (p) => p.lista && (p.nombre === "vertex_indices" || p.nombre === "vertex_index"),
    );

  if (formato === "ascii") {
    if (bytes.byteLength > MAX_BYTES_MALLA_TEXTO) {
      throw new ErrorDeVisor("El PLY en texto es demasiado grande. Expórtalo como PLY binario.");
    }
    const cuerpo = textoDe(bytes.subarray(finLinea)).split(/\r?\n/);
    let l = 0;
    for (const el of elementos) {
      const iCara = esCara(el) ? propIndices(el) : -1;
      for (let n = 0; n < el.cuenta; n++) {
        while (l < cuerpo.length && cuerpo[l].trim() === "") l++;
        const tokens = (cuerpo[l++] ?? "").trim().split(/\s+/).map(Number);
        if (el === vertice) {
          const valores: number[] = [];
          let t = 0;
          for (const p of el.propiedades) {
            if (p.lista) t += tokens[t] + 1;
            else valores.push(tokens[t++]);
          }
          guardarVertice(n, valores);
        } else if (iCara >= 0) {
          let t = 0;
          for (let k = 0; k < el.propiedades.length; k++) {
            const p = el.propiedades[k];
            if (p.lista) {
              const c = tokens[t];
              if (k === iCara) agregarCara(tokens.slice(t + 1, t + 1 + c));
              t += c + 1;
            } else t++;
          }
        }
      }
    }
  } else {
    const le = formato === "binary_little_endian";
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = finLinea;
    const leer = (tipo: TipoPly) => {
      if (o + BYTES_PLY[tipo] > bytes.byteLength) throw new ErrorDeVisor("El PLY está incompleto.");
      const v = leerPly(vista, o, tipo, le);
      o += BYTES_PLY[tipo];
      return v;
    };
    for (const el of elementos) {
      const iCara = esCara(el) ? propIndices(el) : -1;
      for (let n = 0; n < el.cuenta; n++) {
        if (el === vertice) {
          const valores: number[] = [];
          for (const p of el.propiedades) {
            if (p.lista) {
              const c = leer(p.tipoCuenta);
              for (let k = 0; k < c; k++) leer(p.tipo);
              valores.push(NaN);
            } else valores.push(leer(p.tipo));
          }
          guardarVertice(n, valores);
        } else {
          for (let k = 0; k < el.propiedades.length; k++) {
            const p = el.propiedades[k];
            if (p.lista) {
              const c = leer(p.tipoCuenta);
              const idx: number[] = [];
              for (let j = 0; j < c; j++) idx.push(leer(p.tipo));
              if (k === iCara) agregarCara(idx);
            } else leer(p.tipo);
          }
        }
      }
    }
  }

  const triangulos = caras.length / 3;
  if (triangulos === 0) {
    throw new ErrorDeVisor(
      "El PLY solo trae una nube de puntos, sin caras. Exporta la malla con caras (triángulos).",
    );
  }
  controlarTriangulos(triangulos);
  for (const i of caras) {
    if (i < 0 || i >= vertice.cuenta)
      throw new ErrorDeVisor("El PLY tiene caras con índices inválidos.");
  }
  return {
    posiciones,
    indices: Uint32Array.from(caras),
    colores,
    triangulos,
    vertices: vertice.cuenta,
  };
}

// ─── OBJ ─────────────────────────────────────────────────────────────────

export function parsearObj(bytes: Uint8Array): Malla {
  if (bytes.byteLength > MAX_BYTES_MALLA_TEXTO) {
    throw new ErrorDeVisor(
      "El OBJ es demasiado grande para el navegador. Expórtalo como STL binario.",
    );
  }
  const texto = textoDe(bytes);
  const pos: number[] = [];
  const col: number[] = [];
  const caras: number[] = [];
  let conColor = true;
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (linea.startsWith("v ")) {
      const p = linea.split(/\s+/);
      pos.push(Number(p[1]), Number(p[2]), Number(p[3]));
      // Extensión común: "v x y z r g b".
      if (p.length >= 7) col.push(Number(p[4]), Number(p[5]), Number(p[6]));
      else conColor = false;
    } else if (linea.startsWith("f ")) {
      const nVert = pos.length / 3;
      const idx = linea
        .split(/\s+/)
        .slice(1)
        .map((t) => {
          const i = parseInt(t.split("/")[0], 10);
          return i < 0 ? nVert + i : i - 1; // OBJ cuenta desde 1; negativos, desde el final
        });
      if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= nVert)) {
        throw new ErrorDeVisor("El OBJ tiene caras con índices inválidos.");
      }
      for (let k = 1; k + 1 < idx.length; k++) caras.push(idx[0], idx[k], idx[k + 1]);
    }
  }
  if (pos.length === 0) throw new ErrorDeVisor("El archivo no parece un OBJ válido.");
  if (pos.some((v) => !Number.isFinite(v))) {
    throw new ErrorDeVisor("El OBJ tiene coordenadas que no son números.");
  }
  const triangulos = caras.length / 3;
  controlarTriangulos(triangulos);
  const colores = conColor && col.length === pos.length ? new Float32Array(col) : null;
  if (colores && colores.some((c) => c > 1))
    for (let i = 0; i < colores.length; i++) colores[i] /= 255;
  return {
    posiciones: new Float32Array(pos),
    indices: Uint32Array.from(caras),
    colores,
    triangulos,
    vertices: pos.length / 3,
  };
}

// ─── Entrada común ───────────────────────────────────────────────────────

export function parsearMalla(bytes: Uint8Array, formato: FormatoMalla): Malla {
  if (bytes.byteLength === 0) throw new ErrorDeVisor("El archivo está vacío.");
  if (bytes.byteLength > MAX_BYTES_MALLA) {
    throw new ErrorDeVisor(
      `El archivo pesa más de ${MAX_BYTES_MALLA / 1024 / 1024} MB, el máximo para verlo en el navegador.`,
    );
  }
  const propietario = formatoPropietario(bytes);
  if (propietario) throw new ErrorDeVisor(propietario);
  // La extensión manda, pero un PLY o un OBJ mal nombrado se reconoce igual.
  const cabeza = textoDe(bytes.subarray(0, 4));
  if (cabeza === "ply\n" || cabeza === "ply\r") return parsearPly(bytes);
  if (formato === "ply") return parsearPly(bytes);
  if (formato === "obj") return parsearObj(bytes);
  return parsearStl(bytes);
}
