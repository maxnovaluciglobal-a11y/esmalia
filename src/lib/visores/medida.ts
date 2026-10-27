// Medidas en milímetros para los visores (IMG-03 y IMG-04).

import { numero } from "@/lib/formato-fecha";

export type Punto3 = readonly [number, number, number];
export type Punto2 = readonly [number, number];

/**
 * Distancia entre dos puntos de una malla. Los escáneres intraorales y
 * Exocad exportan en milímetros, así que una unidad del modelo es 1 mm.
 */
export function distancia3d(a: Punto3, b: Punto3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/**
 * Distancia en mm entre dos puntos de un corte, en coordenadas de píxel
 * (columna, fila), usando el espaciado del DICOM: `espaciado` es
 * [mm entre columnas, mm entre filas] del plano que se mide.
 */
export function distanciaEnCorte(a: Punto2, b: Punto2, espaciado: Punto2): number {
  return Math.hypot((b[0] - a[0]) * espaciado[0], (b[1] - a[1]) * espaciado[1]);
}

/** "12,4 mm" con la coma decimal de la región; menos de 10 mm lleva dos decimales. */
export function formatoMm(mm: number): string {
  const decimales = mm < 10 ? 2 : 1;
  return `${numero(mm, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} mm`;
}
