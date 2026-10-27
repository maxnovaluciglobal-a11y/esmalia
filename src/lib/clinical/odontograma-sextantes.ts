/**
 * Sextantes del odontograma (Ola 9, ODO-04). Lógica pura.
 *
 * División clásica de la boca en seis bloques (la del índice periodontal
 * comunitario de la OMS, que es como se lee una boca en la región):
 *
 *   S1 · 18–14   S2 · 13–23   S3 · 24–28
 *   S6 · 48–44   S5 · 43–33   S4 · 34–38
 *
 * En la dentición temporal el bloque anterior va de canino a canino (53–63,
 * 83–73) y los posteriores son los dos molares temporales (55–54, 64–65,
 * 75–74, 84–85).
 */
import type { OdontogramMark } from "@/lib/clinical/odontogram";
import { colorDeMarca } from "@/lib/clinical/odontograma-reglas";

export const SEXTANTES = [1, 2, 3, 4, 5, 6] as const;
export type Sextante = (typeof SEXTANTES)[number];

export const NOMBRE_SEXTANTE: Record<Sextante, string> = {
  1: "Posterior superior derecho",
  2: "Anterior superior",
  3: "Posterior superior izquierdo",
  4: "Posterior inferior izquierdo",
  5: "Anterior inferior",
  6: "Posterior inferior derecho",
};

/** Orden en pantalla, como se ve la boca de frente: arriba S1 S2 S3, abajo S6 S5 S4. */
export const SEXTANTES_EN_BOCA: readonly Sextante[] = [1, 2, 3, 6, 5, 4];

/**
 * Sextante de una pieza FDI, o `null` si el número no es válido. Las
 * posiciones 1-3 (incisivos y canino) son anteriores; el resto, posteriores.
 */
export function sextanteDePieza(tooth: number): Sextante | null {
  const cuadrante = Math.floor(tooth / 10);
  const posicion = tooth % 10;
  if (cuadrante < 1 || cuadrante > 8 || posicion < 1) return null;
  const temporal = cuadrante >= 5;
  if (posicion > (temporal ? 5 : 8)) return null;
  const superior = [1, 2, 5, 6].includes(cuadrante);
  if (posicion <= 3) return superior ? 2 : 5;
  switch (cuadrante) {
    case 1:
    case 5:
      return 1;
    case 2:
    case 6:
      return 3;
    case 3:
    case 7:
      return 4;
    default:
      return 6;
  }
}

/** Piezas de `visibles` (la dentición en pantalla) que caen en el sextante, en el mismo orden. */
export function piezasDelSextante(sextante: Sextante, visibles: readonly number[]): number[] {
  return visibles.filter((t) => sextanteDePieza(t) === sextante);
}

/** "18–14" con las piezas de los extremos tal como se ven en pantalla. */
export function rangoDelSextante(sextante: Sextante, visibles: readonly number[]): string {
  const piezas = piezasDelSextante(sextante, visibles);
  if (!piezas.length) return "—";
  return piezas.length === 1 ? String(piezas[0]) : `${piezas[0]}–${piezas[piezas.length - 1]}`;
}

export interface ResumenSextante {
  sextante: Sextante;
  /** Piezas del sextante en la dentición en pantalla. */
  piezas: number;
  /** Piezas con al menos una condición distinta de "sano". */
  conHallazgos: number;
  /** Piezas con algo patológico o en mal estado (lo rojo existente). */
  patologicas: number;
  /** Piezas con algún tratamiento por realizar. */
  porRealizar: number;
  /** Piezas registradas como ausentes. */
  ausentes: number;
}

type MarcaResumen = Pick<
  OdontogramMark,
  "toothNumber" | "condition" | "status" | "conservation" | "supersededAt"
>;

/**
 * Resumen por sextante de las marcas vigentes: cuántas piezas tienen algo,
 * algo rojo, algo por realizar o están ausentes. Cuenta piezas, no marcas:
 * una muela con caries en dos caras es una pieza patológica.
 */
export function resumenPorSextante(
  marcas: readonly MarcaResumen[],
  visibles: readonly number[],
): ResumenSextante[] {
  const enPantalla = new Set(visibles);
  const porPieza = new Map<number, MarcaResumen[]>();
  for (const m of marcas) {
    if (m.supersededAt || m.condition === "sano" || !enPantalla.has(m.toothNumber)) continue;
    const lista = porPieza.get(m.toothNumber) ?? [];
    lista.push(m);
    porPieza.set(m.toothNumber, lista);
  }
  return SEXTANTES.map((sextante) => {
    const piezas = piezasDelSextante(sextante, visibles);
    let conHallazgos = 0;
    let patologicas = 0;
    let porRealizar = 0;
    let ausentes = 0;
    for (const t of piezas) {
      const lista = porPieza.get(t);
      if (!lista?.length) continue;
      conHallazgos += 1;
      if (lista.some((m) => m.status === "existente" && colorDeMarca(m) === "rojo")) {
        patologicas += 1;
      }
      if (lista.some((m) => m.status === "planificado")) porRealizar += 1;
      if (lista.some((m) => m.condition === "ausente" && m.status === "existente")) ausentes += 1;
    }
    return { sextante, piezas: piezas.length, conHallazgos, patologicas, porRealizar, ausentes };
  });
}
