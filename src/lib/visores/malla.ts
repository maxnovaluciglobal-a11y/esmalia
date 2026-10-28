// Mallas 3D de escaneos intraorales y modelos (IMG-03, Ola 13).
//
// Parseo puro, sin three.js: STL (binario y ASCII), PLY (ASCII y binario) y
// OBJ quedan en un formato común que el visor carga en un BufferGeometry.
// Así se prueban sin navegador y three entra solo en el chunk diferido.

import { numero } from "@/lib/formato-fecha";

import {
  ErrorDeVisor,
  MAX_BYTES_MALLA,
  MAX_BYTES_MALLA_TEXTO,
  MAX_TRIANGULOS,
  MAX_TRIANGULOS_SOLDAR,
} from "./limites";

export { ErrorDeVisor, MAX_BYTES_MALLA, MAX_BYTES_MALLA_TEXTO, MAX_TRIANGULOS };

/** Topes que dependen del equipo (un teléfono aguanta menos que un computador). */
export type TopesDeMalla = { bytes?: number; bytesTexto?: number; triangulos?: number };

export type Malla = {
  /** x, y, z por vértice. */
  posiciones: Float32Array;
  /** Tres índices por triángulo; null si los vértices ya vienen de a tres (STL). */
  indices: Uint32Array | null;
  /** r, g, b entre 0 y 1 por vértice, si el archivo trae color (PLY). */
  colores: Float32Array | null;
  /** Normales por vértice, calculadas fuera del hilo de la interfaz; null = el visor las deduce. */
  normales?: Float32Array | null;
  triangulos: number;
  vertices: number;
};

export type FormatoMalla = "stl" | "ply" | "obj";

export type Caja = { min: [number, number, number]; max: [number, number, number] };

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

function controlarTriangulos(n: number, max = MAX_TRIANGULOS) {
  if (n === 0) throw new ErrorDeVisor("El archivo no tiene triángulos para mostrar.");
  if (n > max) {
    throw new ErrorDeVisor(
      `El modelo tiene ${numero(n)} triángulos y el máximo para este equipo es ${numero(max)}. Exporta una versión reducida (decimada) desde el programa del escáner${max < MAX_TRIANGULOS ? " o ábrelo en un computador" : ""}.`,
    );
  }
}

// ─── Lectura de texto sin armar un texto gigante ─────────────────────────
// Un OBJ de 150 MB en un `string` y partido en líneas ocupa varios cientos de
// MB y tarda segundos. Aquí se recorren los bytes y los números se leen en el
// lugar, con memoria proporcional al resultado.

/** Vector que crece al doble: guarda los valores sin un `number[]`. */
class VectorF32 {
  datos: Float32Array;
  n = 0;
  constructor(capacidad = 1024) {
    this.datos = new Float32Array(capacidad);
  }
  push(v: number) {
    if (this.n === this.datos.length) {
      const nuevo = new Float32Array(this.datos.length * 2);
      nuevo.set(this.datos);
      this.datos = nuevo;
    }
    this.datos[this.n++] = v;
  }
  resultado(): Float32Array {
    return this.datos.slice(0, this.n);
  }
}

class VectorU32 {
  datos: Uint32Array;
  n = 0;
  constructor(capacidad = 1024) {
    this.datos = new Uint32Array(capacidad);
  }
  push(v: number) {
    if (this.n === this.datos.length) {
      const nuevo = new Uint32Array(this.datos.length * 2);
      nuevo.set(this.datos);
      this.datos = nuevo;
    }
    this.datos[this.n++] = v;
  }
  resultado(): Uint32Array {
    return this.datos.slice(0, this.n);
  }
}

/** Cursor de lectura de números sobre bytes. */
class Lector {
  i = 0;
  constructor(
    readonly b: Uint8Array,
    desde = 0,
    readonly fin = b.length,
  ) {
    this.i = desde;
  }
  /** Salta espacios, tabs y saltos de línea. */
  saltarBlancos() {
    const { b, fin } = this;
    while (this.i < fin && b[this.i] <= 32) this.i++;
  }
  /** Salta espacios y tabs, sin pasar de la línea. */
  saltarEspacios() {
    const { b, fin } = this;
    while (this.i < fin && (b[this.i] === 32 || b[this.i] === 9)) this.i++;
  }
  finDeLinea(): boolean {
    this.saltarEspacios();
    return this.i >= this.fin || this.b[this.i] === 10 || this.b[this.i] === 13;
  }
  irAlSiguienteRenglon() {
    const { b, fin } = this;
    while (this.i < fin && b[this.i] !== 10) this.i++;
    if (this.i < fin) this.i++;
  }
  /** Lee un decimal en el cursor (con signo, punto y exponente); NaN si no hay número. */
  numero(): number {
    const { b, fin } = this;
    let i = this.i;
    let negativo = false;
    if (b[i] === 45) {
      negativo = true;
      i++;
    } else if (b[i] === 43) i++;
    let mant = 0;
    let digitos = 0;
    let decimales = 0;
    let c = b[i];
    while (i < fin && c >= 48 && c <= 57) {
      mant = mant * 10 + (c - 48);
      digitos++;
      c = b[++i];
    }
    if (c === 46) {
      c = b[++i];
      while (i < fin && c >= 48 && c <= 57) {
        mant = mant * 10 + (c - 48);
        digitos++;
        decimales++;
        c = b[++i];
      }
    }
    if (digitos === 0) {
      // "nan", "inf" y basura: se salta la palabra y se avisa con NaN.
      while (i < fin && b[i] > 32) i++;
      this.i = i;
      return NaN;
    }
    let exp = 0;
    if (c === 101 || c === 69) {
      let j = i + 1;
      let neg = false;
      if (b[j] === 45) {
        neg = true;
        j++;
      } else if (b[j] === 43) j++;
      let e = 0;
      let hay = false;
      while (j < fin && b[j] >= 48 && b[j] <= 57) {
        e = e * 10 + (b[j] - 48);
        hay = true;
        j++;
      }
      if (hay) {
        exp = neg ? -e : e;
        i = j;
      }
    }
    this.i = i;
    const k = exp - decimales;
    const v = k === 0 ? mant : k < 0 ? mant / 10 ** -k : mant * 10 ** k;
    return negativo ? -v : v;
  }
  /** ¿La línea actual empieza (tras blancos) con esta palabra seguida de un blanco? */
  empiezaCon(palabra: string): boolean {
    this.saltarEspacios();
    const { b } = this;
    for (let k = 0; k < palabra.length; k++) {
      if ((b[this.i + k] | 32) !== palabra.charCodeAt(k)) return false;
    }
    const sig = b[this.i + palabra.length];
    return sig === 32 || sig === 9;
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

export function parsearStl(bytes: Uint8Array, topes: TopesDeMalla = {}): Malla {
  return esStlBinario(bytes) ? parsearStlBinario(bytes, topes) : parsearStlAscii(bytes, topes);
}

function parsearStlBinario(bytes: Uint8Array, topes: TopesDeMalla): Malla {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = vista.getUint32(80, true);
  controlarTriangulos(n, topes.triangulos);
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

function parsearStlAscii(bytes: Uint8Array, topes: TopesDeMalla): Malla {
  if (bytes.byteLength > (topes.bytesTexto ?? MAX_BYTES_MALLA_TEXTO)) {
    throw new ErrorDeVisor(
      "El STL en texto es demasiado grande para este equipo. Expórtalo como STL binario.",
    );
  }
  const l = new Lector(bytes);
  const valores = new VectorF32(9 * 1024);
  let invalido = false;
  while (l.i < l.fin) {
    if (l.empiezaCon("vertex")) {
      l.i += 6;
      for (let k = 0; k < 3; k++) {
        l.saltarEspacios();
        const v = l.numero();
        if (!Number.isFinite(v)) invalido = true;
        valores.push(v);
      }
    }
    l.irAlSiguienteRenglon();
  }
  if (invalido) throw new ErrorDeVisor("El STL tiene coordenadas que no son números.");
  const triangulos = Math.floor(valores.n / 9);
  if (valores.n === 0 && !/^\s*solid/i.test(textoDe(bytes.subarray(0, 200)))) {
    throw new ErrorDeVisor("El archivo no parece un STL válido.");
  }
  controlarTriangulos(triangulos, topes.triangulos);
  const posiciones = valores.datos.slice(0, triangulos * 9);
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

export function parsearPly(bytes: Uint8Array, topes: TopesDeMalla = {}): Malla {
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
  const escR = conColor ? escalaColor(ir) : 1;
  const escG = conColor ? escalaColor(ig) : 1;
  const escB = conColor ? escalaColor(ib) : 1;

  if (!Number.isInteger(vertice.cuenta) || vertice.cuenta <= 0) {
    throw new ErrorDeVisor("El PLY no tiene vértices.");
  }
  const posiciones = new Float32Array(vertice.cuenta * 3);
  const colores = conColor ? new Float32Array(vertice.cuenta * 3) : null;
  const caras = new VectorU32(1024);
  const maxTri = topes.triangulos ?? MAX_TRIANGULOS;
  const agregarCara = (idx: number[]) => {
    // Abanico: un polígono de n lados son n - 2 triángulos.
    for (let k = 1; k + 1 < idx.length; k++) {
      caras.push(idx[0]);
      caras.push(idx[k]);
      caras.push(idx[k + 1]);
    }
    // Se corta antes de llenar la memoria con un modelo que de todos modos no se abre.
    if (caras.n / 3 > maxTri) controlarTriangulos(caras.n / 3, maxTri);
  };
  const guardarVertice = (v: number, valores: number[]) => {
    posiciones[v * 3] = valores[ix];
    posiciones[v * 3 + 1] = valores[iy];
    posiciones[v * 3 + 2] = valores[iz];
    if (colores) {
      colores[v * 3] = valores[ir] / escR;
      colores[v * 3 + 1] = valores[ig] / escG;
      colores[v * 3 + 2] = valores[ib] / escB;
    }
  };
  const esCara = (el: ElementoPly) => el.nombre === "face";
  const propIndices = (el: ElementoPly) =>
    el.propiedades.findIndex(
      (p) => p.lista && (p.nombre === "vertex_indices" || p.nombre === "vertex_index"),
    );
  const valores: number[] = new Array(vertice.propiedades.length).fill(0);
  const idx: number[] = [];

  if (formato === "ascii") {
    if (bytes.byteLength > (topes.bytesTexto ?? MAX_BYTES_MALLA_TEXTO)) {
      throw new ErrorDeVisor(
        "El PLY en texto es demasiado grande para este equipo. Expórtalo como PLY binario.",
      );
    }
    const lec = new Lector(bytes, finLinea);
    const siguiente = () => {
      lec.saltarBlancos();
      return lec.numero();
    };
    for (const el of elementos) {
      const iCara = esCara(el) ? propIndices(el) : -1;
      for (let n = 0; n < el.cuenta; n++) {
        if (lec.i >= lec.fin) throw new ErrorDeVisor("El PLY está incompleto.");
        if (el === vertice) {
          for (let k = 0; k < el.propiedades.length; k++) {
            const p = el.propiedades[k];
            if (p.lista) {
              const c = siguiente();
              for (let j = 0; j < c; j++) siguiente();
              valores[k] = NaN;
            } else valores[k] = siguiente();
          }
          if (!Number.isFinite(valores[ix] + valores[iy] + valores[iz])) {
            throw new ErrorDeVisor("El PLY tiene coordenadas que no son números.");
          }
          guardarVertice(n, valores);
        } else {
          for (let k = 0; k < el.propiedades.length; k++) {
            const p = el.propiedades[k];
            if (p.lista) {
              const c = siguiente();
              if (k === iCara) {
                idx.length = 0;
                for (let j = 0; j < c; j++) idx.push(siguiente());
                agregarCara(idx);
              } else for (let j = 0; j < c; j++) siguiente();
            } else siguiente();
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
          for (let k = 0; k < el.propiedades.length; k++) {
            const p = el.propiedades[k];
            if (p.lista) {
              const c = leer(p.tipoCuenta);
              for (let j = 0; j < c; j++) leer(p.tipo);
              valores[k] = NaN;
            } else valores[k] = leer(p.tipo);
          }
          guardarVertice(n, valores);
        } else {
          for (let k = 0; k < el.propiedades.length; k++) {
            const p = el.propiedades[k];
            if (p.lista) {
              const c = leer(p.tipoCuenta);
              if (k === iCara) {
                idx.length = 0;
                for (let j = 0; j < c; j++) idx.push(leer(p.tipo));
                agregarCara(idx);
              } else for (let j = 0; j < c; j++) leer(p.tipo);
            } else leer(p.tipo);
          }
        }
      }
    }
  }

  const triangulos = caras.n / 3;
  if (triangulos === 0) {
    throw new ErrorDeVisor(
      "El PLY solo trae una nube de puntos, sin caras. Exporta la malla con caras (triángulos).",
    );
  }
  controlarTriangulos(triangulos, topes.triangulos);
  const indices = caras.resultado();
  for (let k = 0; k < indices.length; k++) {
    if (indices[k] >= vertice.cuenta)
      throw new ErrorDeVisor("El PLY tiene caras con índices inválidos.");
  }
  return { posiciones, indices, colores, triangulos, vertices: vertice.cuenta };
}

// ─── OBJ ─────────────────────────────────────────────────────────────────

export function parsearObj(bytes: Uint8Array, topes: TopesDeMalla = {}): Malla {
  if (bytes.byteLength > (topes.bytesTexto ?? MAX_BYTES_MALLA_TEXTO)) {
    throw new ErrorDeVisor(
      "El OBJ es demasiado grande para este equipo. Expórtalo como STL binario.",
    );
  }
  const l = new Lector(bytes);
  const pos = new VectorF32(3 * 1024);
  const col = new VectorF32(3 * 1024);
  const caras = new VectorU32(3 * 1024);
  const maxTri = topes.triangulos ?? MAX_TRIANGULOS;
  const idx: number[] = [];
  let nVert = 0;
  let conColor = true;
  let invalido = false;
  const blanco = (c: number) => c === 32 || c === 9;
  while (l.i < l.fin) {
    l.saltarEspacios();
    const c0 = bytes[l.i];
    if (c0 === 118 && blanco(bytes[l.i + 1])) {
      // v x y z [r g b]
      l.i += 2;
      for (let k = 0; k < 3; k++) {
        l.saltarEspacios();
        const v = l.numero();
        if (!Number.isFinite(v)) invalido = true;
        pos.push(v);
      }
      nVert++;
      if (conColor) {
        if (l.finDeLinea()) conColor = false;
        else {
          const r = l.numero();
          l.saltarEspacios();
          const g = l.numero();
          l.saltarEspacios();
          const b = l.numero();
          if (Number.isFinite(r + g + b)) {
            col.push(r);
            col.push(g);
            col.push(b);
          } else conColor = false;
        }
      }
    } else if (c0 === 102 && blanco(bytes[l.i + 1])) {
      // f a/b/c d/e/f …
      l.i += 2;
      idx.length = 0;
      for (;;) {
        if (l.finDeLinea()) break;
        const t = l.numero();
        while (l.i < l.fin && bytes[l.i] > 32) l.i++; // "/vt/vn"
        const i = t < 0 ? nVert + t : t - 1; // OBJ cuenta desde 1; negativos, desde el final
        if (!Number.isInteger(i) || i < 0 || i >= nVert) {
          throw new ErrorDeVisor("El OBJ tiene caras con índices inválidos.");
        }
        idx.push(i);
      }
      for (let k = 1; k + 1 < idx.length; k++) {
        caras.push(idx[0]);
        caras.push(idx[k]);
        caras.push(idx[k + 1]);
      }
      if (caras.n / 3 > maxTri) controlarTriangulos(caras.n / 3, maxTri);
    }
    l.irAlSiguienteRenglon();
  }
  if (pos.n === 0) throw new ErrorDeVisor("El archivo no parece un OBJ válido.");
  if (invalido) throw new ErrorDeVisor("El OBJ tiene coordenadas que no son números.");
  const triangulos = caras.n / 3;
  controlarTriangulos(triangulos, topes.triangulos);
  const colores = conColor && col.n === pos.n ? col.resultado() : null;
  if (colores && colores.some((c) => c > 1))
    for (let i = 0; i < colores.length; i++) colores[i] /= 255;
  return {
    posiciones: pos.resultado(),
    indices: caras.resultado(),
    colores,
    triangulos,
    vertices: pos.n / 3,
  };
}

// ─── Entrada común ───────────────────────────────────────────────────────

export function parsearMalla(
  bytes: Uint8Array,
  formato: FormatoMalla,
  topes: TopesDeMalla = {},
): Malla {
  if (bytes.byteLength === 0) throw new ErrorDeVisor("El archivo está vacío.");
  const maxBytes = topes.bytes ?? MAX_BYTES_MALLA;
  if (bytes.byteLength > maxBytes) {
    throw new ErrorDeVisor(
      `El archivo pesa más de ${Math.round(maxBytes / 1024 / 1024)} MB, el máximo para verlo en este equipo. Ábrelo en un computador o en el programa del escáner.`,
    );
  }
  const propietario = formatoPropietario(bytes);
  if (propietario) throw new ErrorDeVisor(propietario);
  // La extensión manda, pero un PLY o un OBJ mal nombrado se reconoce igual.
  const cabeza = textoDe(bytes.subarray(0, 4));
  if (cabeza === "ply\n" || cabeza === "ply\r") return parsearPly(bytes, topes);
  if (formato === "ply") return parsearPly(bytes, topes);
  if (formato === "obj") return parsearObj(bytes, topes);
  return parsearStl(bytes, topes);
}

// ─── Preparación para dibujar ────────────────────────────────────────────
// Se hace junto con el parseo, fuera del hilo de la interfaz (ver
// `trabajador.ts`): soldar los vértices repetidos del STL y calcular las
// normales tarda segundos con un modelo grande y congelaba la pantalla.

/**
 * Une los vértices que coinciden (tolerancia 1e-4, la misma que usaba
 * three.js) para que la luz sea suave y no se vean facetas, y de paso el
 * modelo ocupa 5-6 veces menos memoria. Solo para mallas sin índices (STL).
 */
export function soldarVertices(m: Malla): Malla {
  if (m.indices || m.triangulos > MAX_TRIANGULOS_SOLDAR) return m;
  const total = m.posiciones.length / 3;
  const pos = m.posiciones;
  let tam = 1;
  while (tam < total * 2) tam <<= 1;
  const mascara = tam - 1;
  const tabla = new Int32Array(tam); // 0 = vacío; si no, índice único + 1
  const unicos = new Float32Array(pos.length);
  const indices = new Uint32Array(total);
  let n = 0;
  const K = 1e4;
  for (let v = 0; v < total; v++) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    const qx = Math.round(x * K);
    const qy = Math.round(y * K);
    const qz = Math.round(z * K);
    let h =
      (Math.imul(qx | 0, 73856093) ^ Math.imul(qy | 0, 19349663) ^ Math.imul(qz | 0, 83492791)) &
      mascara;
    for (;;) {
      const e = tabla[h];
      if (e === 0) {
        unicos[n * 3] = x;
        unicos[n * 3 + 1] = y;
        unicos[n * 3 + 2] = z;
        tabla[h] = n + 1;
        indices[v] = n;
        n++;
        break;
      }
      const u = e - 1;
      if (
        Math.round(unicos[u * 3] * K) === qx &&
        Math.round(unicos[u * 3 + 1] * K) === qy &&
        Math.round(unicos[u * 3 + 2] * K) === qz
      ) {
        indices[v] = u;
        break;
      }
      h = (h + 1) & mascara;
    }
  }
  return {
    posiciones: unicos.slice(0, n * 3),
    indices,
    colores: null,
    normales: null,
    triangulos: m.triangulos,
    vertices: n,
  };
}

/** Normales suaves por vértice (promedio ponderado por el área de cada cara). */
export function calcularNormales(posiciones: Float32Array, indices: Uint32Array): Float32Array {
  const nor = new Float32Array(posiciones.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const e1x = posiciones[b] - posiciones[a];
    const e1y = posiciones[b + 1] - posiciones[a + 1];
    const e1z = posiciones[b + 2] - posiciones[a + 2];
    const e2x = posiciones[c] - posiciones[a];
    const e2y = posiciones[c + 1] - posiciones[a + 1];
    const e2z = posiciones[c + 2] - posiciones[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    nor[a] += nx;
    nor[a + 1] += ny;
    nor[a + 2] += nz;
    nor[b] += nx;
    nor[b + 1] += ny;
    nor[b + 2] += nz;
    nor[c] += nx;
    nor[c + 1] += ny;
    nor[c + 2] += nz;
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l;
    nor[i + 1] /= l;
    nor[i + 2] /= l;
  }
  return nor;
}

/** Suelda (STL) y calcula las normales, dejando la malla lista para dibujar. */
export function prepararParaRender(m: Malla): Malla {
  const soldada = soldarVertices(m);
  if (!soldada.indices) return soldada; // muy grande: el visor usa sombreado plano
  return { ...soldada, normales: calcularNormales(soldada.posiciones, soldada.indices) };
}
