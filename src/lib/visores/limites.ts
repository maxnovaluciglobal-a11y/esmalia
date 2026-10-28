// Límites de los visores y el error que se muestra en la interfaz.
// Archivo chico a propósito: lo importa el diálogo, que no es diferido.

/** Error con un mensaje que se puede mostrar tal cual en la interfaz. */
export class ErrorDeVisor extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeVisor";
  }
}

/** Tamaño máximo de un archivo 3D. Un escaneo de arcada completa pesa 20-80 MB. */
export const MAX_BYTES_MALLA = 200 * 1024 * 1024;
/**
 * Formatos de texto (STL ASCII, PLY ASCII, OBJ): el lector recorre los bytes
 * sin armar un texto gigante, así que el tope es el mismo que el del archivo.
 */
export const MAX_BYTES_MALLA_TEXTO = 200 * 1024 * 1024;
/** Sobre esto el navegador de un teléfono deja de girar fluido. */
export const MAX_TRIANGULOS = 6_000_000;
/** Sobre esto no se sueldan los vértices del STL (mantiene la carga ágil). */
export const MAX_TRIANGULOS_SOLDAR = 2_500_000;

/** Lo máximo que se descarga para un estudio DICOM (un archivo o el ZIP). */
export const MAX_BYTES_DICOM = 400 * 1024 * 1024;
/**
 * Vóxeles que se guardan en memoria (2 bytes cada uno, 200 MB en total). Un
 * CBCT de 512 × 512 × 380 (100 M) se ve a resolución completa; uno de
 * 536 × 536 × 440 (126 M) se muestra a media resolución (31 M).
 */
export const MAX_VOXELES = 100_000_000;
/** En equipos con poca memoria o táctiles (teléfonos, tablets), menos. */
export const MAX_VOXELES_EQUIPO_CHICO = 24_000_000;

/**
 * Topes en equipos con poca memoria o táctiles (teléfonos y tablets). Se
 * eligen de forma conservadora: el navegador de un teléfono mata la pestaña
 * al pasar de ~1 GB, y un modelo ocupa varias veces su tamaño mientras se
 * prepara. No se midieron en un teléfono real (ver la auditoría de imágenes).
 */
export const LIMITES_EQUIPO_CHICO = {
  bytesMalla: 120 * 1024 * 1024,
  bytesMallaTexto: 50 * 1024 * 1024,
  triangulos: 3_000_000,
  bytesDicom: 250 * 1024 * 1024,
} as const;

export type LimitesDelEquipo = {
  bytesMalla: number;
  bytesMallaTexto: number;
  triangulos: number;
  bytesDicom: number;
  voxeles: number;
  chico: boolean;
};

export function limitesDelEquipo(chico: boolean): LimitesDelEquipo {
  return chico
    ? { ...LIMITES_EQUIPO_CHICO, voxeles: MAX_VOXELES_EQUIPO_CHICO, chico }
    : {
        bytesMalla: MAX_BYTES_MALLA,
        bytesMallaTexto: MAX_BYTES_MALLA_TEXTO,
        triangulos: MAX_TRIANGULOS,
        bytesDicom: MAX_BYTES_DICOM,
        voxeles: MAX_VOXELES,
        chico,
      };
}

/** ¿Equipo con poca memoria o táctil? Funciona en la página y en un worker. */
export function esEquipoChico(): boolean {
  if (typeof navigator === "undefined") return false;
  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const tactil =
    typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
  return (memoria !== undefined && memoria <= 4) || tactil;
}
