// Parser DICOM mínimo para el visor de CBCT y radiografías (IMG-04, Ola 13).
//
// Por qué propio y no una librería: lo que el visor necesita del archivo es
// poco (tamaño, espaciado, posición, ventana, fecha, modalidad y los
// píxeles sin comprimir). dicom-parser (Cornerstone) resuelve lo mismo pero
// trae un diccionario y utilidades que no usamos, y daikon o dcmjs pesan
// cientos de KB por los decodificadores JPEG. Este parser son ~300 líneas,
// sin dependencias, y se prueba con fixtures generados en los tests.
//
// Privacidad: solo se decodifican los tags de la lista blanca `TAGS`. El
// grupo 0010 (nombre, RUT, fecha de nacimiento y sexo del paciente) y los
// datos de la institución o del médico ni siquiera se leen: se saltan por
// su largo, igual que cualquier tag que no está en la lista.

import { fecha } from "@/lib/formato-fecha";

import { ErrorDeVisor, formatoPropietario } from "./malla";

export type Vec3 = [number, number, number];

export type CorteDicom = {
  filas: number;
  columnas: number;
  /** mm entre columnas (horizontal) y entre filas (vertical). */
  espaciadoPixel: [number, number] | null;
  /** true si el espaciado viene del detector (radiografía), no del paciente. */
  espaciadoAproximado: boolean;
  grosorCorte: number | null;
  espacioEntreCortes: number | null;
  posicion: Vec3 | null;
  /** Posición de cada cuadro en un DICOM multicuadro mejorado. */
  posicionesPorCuadro: Vec3[];
  orientacion: number[] | null;
  instancia: number | null;
  cuadros: number;
  bitsAsignados: number;
  bitsAlmacenados: number;
  conSigno: boolean;
  muestrasPorPixel: number;
  configuracionPlanar: number;
  fotometrica: string;
  pendiente: number;
  intercepto: number;
  ventana: { centro: number; ancho: number } | null;
  modalidad: string | null;
  /** AAAAMMDD tal como viene en el encabezado. */
  fechaEstudio: string | null;
  serieUid: string | null;
  sintaxis: string;
  littleEndian: boolean;
  pixeles: Uint8Array | null;
  /**
   * Los píxeles de un cuadro que viene dentro de un ZIP no se guardan todos
   * a la vez: se vuelven a sacar del ZIP justo cuando se necesitan, así un
   * estudio de 300 cortes no ocupa su tamaño completo en memoria.
   */
  cargarPixeles?: () => Uint8Array;
};

/** Sintaxis de transferencia sin compresión que se pueden leer. */
const SINTAXIS = {
  implicitaLE: "1.2.840.10008.1.2",
  explicitaLE: "1.2.840.10008.1.2.1",
  explicitaBE: "1.2.840.10008.1.2.2",
} as const;

export function nombreDeSintaxis(uid: string): string {
  if (uid.startsWith("1.2.840.10008.1.2.4.9")) return "JPEG 2000";
  if (uid.startsWith("1.2.840.10008.1.2.4.8")) return "JPEG-LS";
  if (uid.startsWith("1.2.840.10008.1.2.4.20")) return "HTJ2K";
  if (uid.startsWith("1.2.840.10008.1.2.4.10")) return "MPEG";
  if (uid.startsWith("1.2.840.10008.1.2.4")) return "JPEG";
  if (uid === "1.2.840.10008.1.2.5") return "RLE";
  if (uid === "1.2.840.10008.1.2.1.99") return "comprimido con Deflate";
  return uid;
}

// VR con largo de 4 bytes en sintaxis explícita.
const VR_LARGOS = new Set([
  "OB",
  "OD",
  "OF",
  "OL",
  "OV",
  "OW",
  "SQ",
  "UC",
  "UN",
  "UR",
  "UT",
  "SV",
  "UV",
]);

type Vr = "US" | "DS" | "IS" | "UI" | "CS" | "DA" | "SQ" | "OX";

/** La lista blanca: lo único que se decodifica. */
const TAGS: Record<string, { vr: Vr; campo: string }> = {
  "00020010": { vr: "UI", campo: "sintaxis" },
  "00080020": { vr: "DA", campo: "fechaEstudio" },
  "00080060": { vr: "CS", campo: "modalidad" },
  "00180050": { vr: "DS", campo: "grosorCorte" },
  "00180088": { vr: "DS", campo: "espacioEntreCortes" },
  "00181164": { vr: "DS", campo: "espaciadoDetector" },
  "0020000E": { vr: "UI", campo: "serieUid" },
  "00200013": { vr: "IS", campo: "instancia" },
  "00200032": { vr: "DS", campo: "posicion" },
  "00200037": { vr: "DS", campo: "orientacion" },
  "00280002": { vr: "US", campo: "muestrasPorPixel" },
  "00280004": { vr: "CS", campo: "fotometrica" },
  "00280006": { vr: "US", campo: "configuracionPlanar" },
  "00280008": { vr: "IS", campo: "cuadros" },
  "00280010": { vr: "US", campo: "filas" },
  "00280011": { vr: "US", campo: "columnas" },
  "00280030": { vr: "DS", campo: "espaciadoPixel" },
  "00280100": { vr: "US", campo: "bitsAsignados" },
  "00280101": { vr: "US", campo: "bitsAlmacenados" },
  "00280103": { vr: "US", campo: "representacion" },
  "00281050": { vr: "DS", campo: "centroVentana" },
  "00281051": { vr: "DS", campo: "anchoVentana" },
  "00281052": { vr: "DS", campo: "intercepto" },
  "00281053": { vr: "DS", campo: "pendiente" },
  // Secuencias del DICOM multicuadro mejorado (CBCT de varios equipos).
  "52009229": { vr: "SQ", campo: "gruposCompartidos" },
  "52009230": { vr: "SQ", campo: "gruposPorCuadro" },
  "00289110": { vr: "SQ", campo: "medidasPixel" },
  "00209113": { vr: "SQ", campo: "posicionPlano" },
  "00209116": { vr: "SQ", campo: "orientacionPlano" },
  "7FE00010": { vr: "OX", campo: "pixeles" },
};

const INDEFINIDO = 0xffffffff;

type Valor = number[] | string | Uint8Array;

type Lector = {
  vista: DataView;
  bytes: Uint8Array;
  explicita: boolean;
  le: boolean;
  /** Primer valor de cada campo, a cualquier profundidad (el nivel superior manda). */
  valores: Map<string, { valor: Valor; profundidad: number }>;
  posicionesPorCuadro: Vec3[];
};

function textoAscii(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s.replace(/[\0\s]+$/g, "").trim();
}

function tagDe(grupo: number, elemento: number): string {
  return (
    grupo.toString(16).toUpperCase().padStart(4, "0") +
    elemento.toString(16).toUpperCase().padStart(4, "0")
  );
}

function decodificar(l: Lector, vr: Vr, o: number, largo: number): Valor {
  const crudo = l.bytes.subarray(o, o + largo);
  if (vr === "US") {
    const out: number[] = [];
    for (let i = 0; i + 1 < largo; i += 2) out.push(l.vista.getUint16(o + i, l.le));
    return out;
  }
  if (vr === "DS" || vr === "IS") {
    return textoAscii(crudo)
      .split("\\")
      .map((t) => Number(t.trim()))
      .filter((n) => Number.isFinite(n));
  }
  if (vr === "OX") return crudo;
  return textoAscii(crudo);
}

function guardar(
  l: Lector,
  campo: string,
  valor: Valor,
  profundidad: number,
  enPorCuadro: boolean,
) {
  if (enPorCuadro && campo === "posicion" && Array.isArray(valor) && valor.length >= 3) {
    l.posicionesPorCuadro.push([valor[0], valor[1], valor[2]]);
    return;
  }
  const previo = l.valores.get(campo);
  if (!previo || profundidad < previo.profundidad) l.valores.set(campo, { valor, profundidad });
}

/**
 * Recorre elementos desde `o` hasta `fin` (o hasta un delimitador si
 * `fin` es null). Devuelve el offset donde terminó.
 */
function recorrer(
  l: Lector,
  o: number,
  fin: number | null,
  profundidad: number,
  enPorCuadro: boolean,
): number {
  const limite = fin ?? l.bytes.byteLength;
  while (o + 8 <= limite) {
    const grupo = l.vista.getUint16(o, l.le);
    const elemento = l.vista.getUint16(o + 2, l.le);
    // Delimitadores de ítem y de secuencia (siempre en forma implícita).
    if (grupo === 0xfffe) {
      const largo = l.vista.getUint32(o + 4, l.le);
      if (elemento === 0xe00d || elemento === 0xe0dd) return o + 8;
      // Ítem suelto fuera de una secuencia: se salta.
      o += 8 + (largo === INDEFINIDO ? 0 : largo);
      continue;
    }
    const tag = tagDe(grupo, elemento);
    const conocido = TAGS[tag];
    let vr: string;
    let largo: number;
    let datos: number;
    const explicita = l.explicita;
    if (explicita) {
      vr = String.fromCharCode(l.bytes[o + 4], l.bytes[o + 5]);
      if (!/^[A-Z]{2}$/.test(vr)) {
        throw new ErrorDeVisor("El archivo DICOM está dañado (VR ilegible).");
      }
      if (VR_LARGOS.has(vr)) {
        largo = l.vista.getUint32(o + 8, l.le);
        datos = o + 12;
      } else {
        largo = l.vista.getUint16(o + 6, l.le);
        datos = o + 8;
      }
    } else {
      vr = conocido?.vr === "SQ" ? "SQ" : "";
      largo = l.vista.getUint32(o + 4, l.le);
      datos = o + 8;
    }

    if (tag === "7FE00010" && largo === INDEFINIDO) {
      // Píxeles encapsulados: siempre es una sintaxis comprimida.
      throw new ErrorDeVisor("PIXELES_COMPRIMIDOS");
    }

    const esSecuencia = vr === "SQ" || largo === INDEFINIDO;
    if (esSecuencia) {
      const porCuadro = enPorCuadro || conocido?.campo === "gruposPorCuadro";
      o = recorrerSecuencia(
        l,
        datos,
        largo === INDEFINIDO ? null : datos + largo,
        profundidad + 1,
        porCuadro,
      );
      continue;
    }
    if (datos + largo > l.bytes.byteLength) {
      if (tag === "7FE00010")
        throw new ErrorDeVisor("El archivo DICOM está incompleto (faltan píxeles).");
      throw new ErrorDeVisor("El archivo DICOM está incompleto.");
    }
    if (conocido && conocido.vr !== "SQ") {
      guardar(
        l,
        conocido.campo,
        decodificar(l, conocido.vr, datos, largo),
        profundidad,
        enPorCuadro,
      );
    }
    o = datos + largo;
  }
  return o;
}

function recorrerSecuencia(
  l: Lector,
  o: number,
  fin: number | null,
  profundidad: number,
  enPorCuadro: boolean,
): number {
  const limite = fin ?? l.bytes.byteLength;
  while (o + 8 <= limite) {
    const grupo = l.vista.getUint16(o, l.le);
    const elemento = l.vista.getUint16(o + 2, l.le);
    const largo = l.vista.getUint32(o + 4, l.le);
    if (grupo !== 0xfffe) throw new ErrorDeVisor("El archivo DICOM está dañado (secuencia).");
    if (elemento === 0xe0dd) return o + 8; // fin de secuencia
    if (elemento === 0xe000) {
      if (largo === INDEFINIDO) o = recorrer(l, o + 8, null, profundidad, enPorCuadro);
      else {
        recorrer(l, o + 8, o + 8 + largo, profundidad, enPorCuadro);
        o = o + 8 + largo;
      }
      continue;
    }
    o += 8;
  }
  return fin ?? o;
}

/** true si los bytes parecen un DICOM (con preámbulo o sin él). */
export function pareceDicom(bytes: Uint8Array): boolean {
  if (bytes.byteLength >= 132 && textoAscii(bytes.subarray(128, 132)) === "DICM") return true;
  if (bytes.byteLength < 8) return false;
  const grupo = bytes[0] | (bytes[1] << 8);
  return grupo === 0x0002 || grupo === 0x0008;
}

function numero(v: Valor | undefined, i = 0): number | null {
  return Array.isArray(v) && v.length > i && Number.isFinite(v[i]) ? v[i] : null;
}

function texto(v: Valor | undefined): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export function parsearDicom(bytes: Uint8Array): CorteDicom {
  const propietario = formatoPropietario(bytes);
  if (propietario) throw new ErrorDeVisor(propietario);
  if (!pareceDicom(bytes)) throw new ErrorDeVisor("El archivo no es un DICOM.");

  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const conPreambulo = bytes.byteLength >= 132 && textoAscii(bytes.subarray(128, 132)) === "DICM";
  let o = conPreambulo ? 132 : 0;

  const l: Lector = {
    vista,
    bytes,
    explicita: true,
    le: true,
    valores: new Map(),
    posicionesPorCuadro: [],
  };

  // Metainformación (grupo 0002): explícita little endian.
  let sintaxis: string = SINTAXIS.implicitaLE;
  if (o + 8 <= bytes.byteLength && vista.getUint16(o, true) === 0x0002) {
    while (o + 8 <= bytes.byteLength && vista.getUint16(o, true) === 0x0002) {
      const vr = String.fromCharCode(bytes[o + 4], bytes[o + 5]);
      const largoLargo = VR_LARGOS.has(vr);
      const largo = largoLargo ? vista.getUint32(o + 8, true) : vista.getUint16(o + 6, true);
      const datos = o + (largoLargo ? 12 : 8);
      if (vista.getUint16(o + 2, true) === 0x0010)
        sintaxis = textoAscii(bytes.subarray(datos, datos + largo));
      o = datos + largo;
    }
  } else if (!conPreambulo) {
    // Sin preámbulo ni metainformación: se adivina si el VR es explícito.
    const vr = String.fromCharCode(bytes[o + 4], bytes[o + 5]);
    sintaxis = /^[A-Z]{2}$/.test(vr) ? SINTAXIS.explicitaLE : SINTAXIS.implicitaLE;
  }

  if (sintaxis === SINTAXIS.implicitaLE) {
    l.explicita = false;
  } else if (sintaxis === SINTAXIS.explicitaBE) {
    l.le = false;
  } else if (sintaxis !== SINTAXIS.explicitaLE) {
    throw errorComprimido(sintaxis);
  }

  try {
    recorrer(l, o, null, 0, false);
  } catch (e) {
    if (e instanceof ErrorDeVisor && e.message === "PIXELES_COMPRIMIDOS")
      throw errorComprimido(sintaxis);
    if (e instanceof RangeError) throw new ErrorDeVisor("El archivo DICOM está incompleto.");
    throw e;
  }

  const v = (campo: string) => l.valores.get(campo)?.valor;
  const espaciado = v("espaciadoPixel");
  const detector = v("espaciadoDetector");
  const espaciadoPixel = numero(espaciado, 1) !== null ? espaciado : detector;
  const pos = v("posicion");
  const orient = v("orientacion");
  const centro = numero(v("centroVentana"));
  const ancho = numero(v("anchoVentana"));
  const pixeles = v("pixeles");

  return {
    filas: numero(v("filas")) ?? 0,
    columnas: numero(v("columnas")) ?? 0,
    // DICOM guarda [entre filas, entre columnas]; acá va [x, y].
    espaciadoPixel:
      Array.isArray(espaciadoPixel) &&
      espaciadoPixel.length >= 2 &&
      espaciadoPixel[0] > 0 &&
      espaciadoPixel[1] > 0
        ? [espaciadoPixel[1], espaciadoPixel[0]]
        : null,
    espaciadoAproximado: numero(espaciado, 1) === null && numero(detector, 1) !== null,
    grosorCorte: numero(v("grosorCorte")),
    espacioEntreCortes: numero(v("espacioEntreCortes")),
    posicion: Array.isArray(pos) && pos.length >= 3 ? [pos[0], pos[1], pos[2]] : null,
    posicionesPorCuadro: l.posicionesPorCuadro,
    orientacion: Array.isArray(orient) && orient.length >= 6 ? orient.slice(0, 6) : null,
    instancia: numero(v("instancia")),
    cuadros: Math.max(1, numero(v("cuadros")) ?? 1),
    bitsAsignados: numero(v("bitsAsignados")) ?? 16,
    bitsAlmacenados: numero(v("bitsAlmacenados")) ?? numero(v("bitsAsignados")) ?? 16,
    conSigno: numero(v("representacion")) === 1,
    muestrasPorPixel: numero(v("muestrasPorPixel")) ?? 1,
    configuracionPlanar: numero(v("configuracionPlanar")) ?? 0,
    fotometrica: texto(v("fotometrica")) ?? "MONOCHROME2",
    pendiente: numero(v("pendiente")) ?? 1,
    intercepto: numero(v("intercepto")) ?? 0,
    ventana: centro !== null && ancho !== null && ancho > 0 ? { centro, ancho } : null,
    modalidad: texto(v("modalidad")),
    fechaEstudio: texto(v("fechaEstudio")),
    serieUid: texto(v("serieUid")),
    sintaxis,
    littleEndian: l.le,
    pixeles: pixeles instanceof Uint8Array ? pixeles : null,
  };
}

function errorComprimido(sintaxis: string): ErrorDeVisor {
  return new ErrorDeVisor(
    `Este DICOM viene comprimido (${nombreDeSintaxis(sintaxis)}) y el visor del navegador solo abre DICOM sin compresión. Expórtalo desde el software del equipo como "DICOM sin comprimir" (Explicit VR Little Endian).`,
  );
}

/** "12 mar 2026" a partir de AAAAMMDD; null si no es una fecha. */
export function formatoFechaDicom(da: string | null): string | null {
  const m = da?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return null;
  // Fecha civil (sin hora): no se corre con el huso.
  return fecha(iso);
}

const MODALIDADES: Record<string, string> = {
  CT: "Tomografía (CT / CBCT)",
  IO: "Radiografía intraoral",
  PX: "Radiografía panorámica",
  DX: "Radiografía digital",
  CR: "Radiografía computarizada",
  MR: "Resonancia magnética",
  OT: "Otro",
};

export function nombreDeModalidad(m: string | null): string {
  if (!m) return "Sin dato";
  return MODALIDADES[m] ? `${MODALIDADES[m]} · ${m}` : m;
}
