// Límites de los visores y el error que se muestra en la interfaz.
// Archivo chico a propósito: lo importa el diálogo, que no es diferido.

/** Error con un mensaje que se puede mostrar tal cual en la interfaz. */
export class ErrorDeVisor extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeVisor";
  }
}

/** Tamaño máximo de un archivo 3D. Un escaneo de arcada completa pesa 20-60 MB. */
export const MAX_BYTES_MALLA = 200 * 1024 * 1024;
/** Los formatos de texto (STL ASCII, PLY ASCII, OBJ) ocupan ~5 veces más memoria al parsear. */
export const MAX_BYTES_MALLA_TEXTO = 80 * 1024 * 1024;
/** Sobre esto el navegador de un teléfono deja de girar fluido. */
export const MAX_TRIANGULOS = 6_000_000;

/** Lo máximo que se descarga para un estudio DICOM (un archivo o el ZIP). */
export const MAX_BYTES_DICOM = 400 * 1024 * 1024;
/**
 * Vóxeles que se guardan en memoria (2 bytes cada uno). Un CBCT dental de
 * 536 × 536 × 440 son 126 M: se muestra a media resolución (31 M).
 */
export const MAX_VOXELES = 64_000_000;
/** En equipos con poca memoria o táctiles (teléfonos, tablets), menos. */
export const MAX_VOXELES_EQUIPO_CHICO = 24_000_000;
