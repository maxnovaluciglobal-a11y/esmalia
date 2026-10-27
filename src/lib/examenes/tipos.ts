/**
 * Ola 13 · IMG-01: tipos de examen, qué archivos acepta cada uno y cuánto
 * puede pesar. Puro (sin red ni base): lo usan la pantalla, el servidor y los
 * tests. La base repite el límite por archivo en
 * `limite_por_archivo_de_examen()` (migración 20261109100100) y
 * `tests/examenes-cupo.test.ts` los compara.
 */
import { esPiezaFdi } from "@/lib/clinical/consentimientos";

export const TIPOS_EXAMEN = [
  "periapical",
  "bite_wing",
  "panoramica",
  "telerradiografia",
  "cbct_dicom",
  "escaneo_intraoral",
  "foto_clinica",
  "documento",
  "otro",
] as const;

export type TipoExamen = (typeof TIPOS_EXAMEN)[number];

export const MB = 1024 * 1024;

/** Tipos que pueden pesar mucho (volúmenes y mallas 3D). */
const TIPOS_PESADOS: readonly TipoExamen[] = ["cbct_dicom", "escaneo_intraoral"];

/** Máximo por archivo, en bytes. */
export const LIMITE_PESADO = 50 * MB;
export const LIMITE_LIVIANO = 20 * MB;

export function limitePorArchivo(tipo: TipoExamen): number {
  return TIPOS_PESADOS.includes(tipo) ? LIMITE_PESADO : LIMITE_LIVIANO;
}

/** Familia del tipo, para agrupar y filtrar en la ficha. */
export type FamiliaExamen = "radiografia" | "volumen" | "escaneo" | "foto" | "documento";

export const FAMILIAS: readonly { id: FamiliaExamen; etiqueta: string }[] = [
  { id: "radiografia", etiqueta: "Radiografías" },
  { id: "volumen", etiqueta: "CBCT" },
  { id: "escaneo", etiqueta: "Escaneos" },
  { id: "foto", etiqueta: "Fotos" },
  { id: "documento", etiqueta: "Documentos" },
];

interface InfoTipo {
  etiqueta: string;
  /** Texto corto para chips y listas. */
  corta: string;
  familia: FamiliaExamen;
  /** Extensiones aceptadas, en minúscula y sin punto. */
  extensiones: readonly string[];
}

const IMAGEN = ["jpg", "jpeg", "png", "webp"] as const;
const RADIOGRAFIA = [...IMAGEN, "dcm", "dicom", "pdf"] as const;

export const INFO_TIPO: Record<TipoExamen, InfoTipo> = {
  periapical: {
    etiqueta: "Radiografía periapical",
    corta: "Periapical",
    familia: "radiografia",
    extensiones: RADIOGRAFIA,
  },
  bite_wing: {
    etiqueta: "Radiografía bite-wing",
    corta: "Bite-wing",
    familia: "radiografia",
    extensiones: RADIOGRAFIA,
  },
  panoramica: {
    etiqueta: "Radiografía panorámica",
    corta: "Panorámica",
    familia: "radiografia",
    extensiones: RADIOGRAFIA,
  },
  telerradiografia: {
    etiqueta: "Telerradiografía",
    corta: "Telerradiografía",
    familia: "radiografia",
    extensiones: RADIOGRAFIA,
  },
  cbct_dicom: {
    etiqueta: "CBCT (DICOM)",
    corta: "CBCT",
    familia: "volumen",
    extensiones: ["dcm", "dicom", "zip", "pdf", ...IMAGEN],
  },
  escaneo_intraoral: {
    etiqueta: "Escaneo intraoral",
    corta: "Escaneo",
    familia: "escaneo",
    extensiones: ["stl", "ply", "obj", "zip"],
  },
  foto_clinica: {
    etiqueta: "Foto clínica",
    corta: "Foto",
    familia: "foto",
    extensiones: IMAGEN,
  },
  documento: {
    etiqueta: "Documento o PDF",
    corta: "Documento",
    familia: "documento",
    extensiones: ["pdf", ...IMAGEN],
  },
  otro: {
    etiqueta: "Otro",
    corta: "Otro",
    familia: "documento",
    extensiones: ["pdf", ...IMAGEN, "dcm", "zip", "stl", "ply", "obj"],
  },
};

export function esTipoExamen(v: unknown): v is TipoExamen {
  return typeof v === "string" && (TIPOS_EXAMEN as readonly string[]).includes(v);
}

export function extensionDe(nombre: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(nombre.trim());
  return m ? m[1].toLowerCase() : "";
}

/** `accept` del input de archivo para un tipo. */
export function acceptDe(tipo: TipoExamen): string {
  return INFO_TIPO[tipo].extensiones.map((e) => `.${e}`).join(",");
}

const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  dcm: "application/dicom",
  dicom: "application/dicom",
  zip: "application/zip",
  stl: "model/stl",
  ply: "model/ply",
  obj: "model/obj",
};

/** Tipos MIME que acepta el bucket `clinical-exams` (espejo de la migración). */
export const MIME_ADMITIDOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/dicom",
  "application/zip",
  "application/x-zip-compressed",
  "model/stl",
  "model/obj",
  "model/ply",
  "application/sla",
  "application/vnd.ms-pki.stl",
  "text/plain",
  "application/octet-stream",
] as const;

/**
 * Tipo MIME con el que se guarda el archivo. Se decide por la extensión (el
 * navegador manda `""` o `application/octet-stream` para un STL o un DICOM);
 * si la extensión no dice nada, el que trajo el navegador si está admitido.
 */
export function mimeDeArchivo(nombre: string, mimeNavegador = ""): string {
  const porExtension = MIME_POR_EXTENSION[extensionDe(nombre)];
  if (porExtension) return porExtension;
  return (MIME_ADMITIDOS as readonly string[]).includes(mimeNavegador)
    ? mimeNavegador
    : "application/octet-stream";
}

/** ¿Se muestra con miniatura? Solo imágenes que el navegador dibuja. */
export function esImagen(mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
}

export type ProblemaArchivo =
  | { tipo: "extension"; mensaje: string }
  | { tipo: "tamano"; mensaje: string }
  | { tipo: "vacio"; mensaje: string };

/** Valida un archivo para un tipo de examen. null = se puede subir. */
export function problemaDeArchivo(
  tipo: TipoExamen,
  archivo: { name: string; size: number },
): ProblemaArchivo | null {
  if (archivo.size <= 0) return { tipo: "vacio", mensaje: "El archivo está vacío." };
  const ext = extensionDe(archivo.name);
  const info = INFO_TIPO[tipo];
  if (!info.extensiones.includes(ext)) {
    return {
      tipo: "extension",
      mensaje: `${info.etiqueta} admite ${info.extensiones.map((e) => e.toUpperCase()).join(", ")}.`,
    };
  }
  const limite = limitePorArchivo(tipo);
  if (archivo.size > limite) {
    return {
      tipo: "tamano",
      mensaje: `El archivo pesa ${formatearBytes(archivo.size)}; el máximo para ${info.etiqueta.toLowerCase()} es ${formatearBytes(limite)}.`,
    };
  }
  return null;
}

/** Formato de visor que corresponde al archivo (contrato con el frente B). */
export type FormatoVisor = "stl" | "ply" | "obj" | "dicom";

export function formatoVisor(nombre: string, mime: string): FormatoVisor | null {
  const ext = extensionDe(nombre);
  if (ext === "stl" || ext === "ply" || ext === "obj") return ext;
  if (ext === "dcm" || ext === "dicom" || mime === "application/dicom") return "dicom";
  return null;
}

/** Bytes legibles: "820 KB", "12,4 MB", "5 GB". Coma decimal. */
export function formatearBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Sin datos";
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  const texto =
    i === 0 || valor >= 100 || Number.isInteger(valor)
      ? String(Math.round(valor))
      : valor.toFixed(1).replace(".", ",").replace(/,0$/, "");
  return `${texto} ${unidades[i]}`;
}

/** Nombre seguro para la ruta en Storage (conserva la extensión). */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._]+/, "");
  return (limpio || "archivo").slice(-100);
}

/** Piezas FDI únicas y ordenadas; descarta lo que no es FDI. */
export function normalizarPiezas(piezas: readonly number[]): number[] {
  return [...new Set(piezas.filter((p) => esPiezaFdi(p)))].sort((a, b) => a - b);
}

export const ETAPAS_SESION = ["antes", "durante", "despues", "control"] as const;
export type EtapaSesion = (typeof ETAPAS_SESION)[number];

export const ETIQUETA_ETAPA: Record<EtapaSesion, string> = {
  antes: "Antes",
  durante: "Durante",
  despues: "Después",
  control: "Control",
};
