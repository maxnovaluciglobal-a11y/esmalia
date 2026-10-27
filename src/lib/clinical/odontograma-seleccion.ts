/**
 * Marcar varias piezas a la vez (Ola 9, ODO-05). Lógica pura: cómo crece la
 * selección con clic + Ctrl/Cmd (alternar) o Shift (rango) y qué marcas
 * resultan de aplicar un mismo hallazgo a todas.
 *
 * El servidor recibe la lista que arma `planDeMarcas` y la vuelve a validar
 * con las mismas reglas (`validarMarca`, `marcasQueReemplaza`).
 */
import {
  CONDITION_CATALOG,
  SURFACE_LABELS,
  type MarkConservation,
  type MarkStatus,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  aplicaConservacion,
  marcasQueReemplaza,
  validarMarca,
  type MarcaRegla,
} from "@/lib/clinical/odontograma-reglas";

/** Tope de piezas por aplicación: una boca permanente más la temporal completa. */
export const MAX_PIEZAS_POR_LOTE = 52;

export interface Modificadores {
  /** Ctrl o Cmd: suma o quita una pieza. */
  alternar?: boolean;
  /** Shift: suma el rango desde la última pieza elegida, en la misma fila. */
  rango?: boolean;
}

/** Suma la pieza si no estaba y la quita si estaba. Devuelve un Set nuevo. */
export function alternarPieza(seleccion: ReadonlySet<number>, tooth: number): Set<number> {
  const nueva = new Set(seleccion);
  if (nueva.has(tooth)) nueva.delete(tooth);
  else nueva.add(tooth);
  return nueva;
}

/**
 * Piezas entre `desde` y `hasta` (las dos incluidas) en el orden de la fila
 * en pantalla. Si alguna no está en la fila (el rango cruzaría de arcada),
 * solo `hasta`: un rango entre arcadas no tiene un sentido clínico claro.
 */
export function rangoEnFila(fila: readonly number[], desde: number, hasta: number): number[] {
  const i = fila.indexOf(desde);
  const j = fila.indexOf(hasta);
  if (i < 0 || j < 0) return [hasta];
  const [a, b] = i <= j ? [i, j] : [j, i];
  return fila.slice(a, b + 1);
}

/**
 * Selección que resulta de un clic con modificadores. `ancla` es la última
 * pieza elegida (para Shift); `filas`, las filas del diagrama en pantalla.
 */
export function seleccionConClic({
  seleccion,
  tooth,
  mods,
  ancla,
  filas,
}: {
  seleccion: ReadonlySet<number>;
  tooth: number;
  mods: Modificadores;
  ancla: number | null;
  filas: readonly (readonly number[])[];
}): Set<number> {
  if (mods.rango && ancla !== null) {
    const fila = filas.find((f) => f.includes(ancla) && f.includes(tooth));
    const nueva = new Set(seleccion);
    for (const t of fila ? rangoEnFila(fila, ancla, tooth) : [tooth]) nueva.add(t);
    return nueva;
  }
  return alternarPieza(seleccion, tooth);
}

export interface MarcaDelLote {
  id: string;
  toothNumber: number;
  surface: ToothSurface;
  condition: ToothCondition;
  status: MarkStatus;
  conservation: MarkConservation | null;
  /** Lo que esta marca cierra según lo que se ve en pantalla (control de conflictos). */
  baseMarkIds: string[];
}

export interface PlanDeLote {
  marcas: MarcaDelLote[];
  /** Piezas que no se tocan y por qué ("ya la tiene", "ausente"). */
  omitidas: { tooth: number; motivo: string }[];
  /** Error que impide aplicar el lote entero (la condición no va en esa zona). */
  error: string | null;
}

/**
 * Marcas que crea aplicar `condition` a cada pieza elegida. Se omiten las
 * piezas que ya tienen exactamente esa marca vigente (no se duplica nada) y,
 * salvo que la condición rehabilite una ausencia, las piezas ausentes.
 */
export function planDeMarcas({
  piezas,
  surface,
  condition,
  status,
  conservation,
  vigentesPorPieza,
  nuevoId = () => crypto.randomUUID(),
}: {
  piezas: readonly number[];
  surface: ToothSurface;
  condition: ToothCondition;
  status: MarkStatus;
  conservation: MarkConservation | null;
  vigentesPorPieza: ReadonlyMap<
    number,
    readonly (MarcaRegla & { conservation?: MarkConservation | null })[]
  >;
  nuevoId?: () => string;
}): PlanDeLote {
  const cons = aplicaConservacion(condition, status) ? conservation : null;
  const error = validarMarca({ toothNumber: 0, surface, condition, status, conservation: cons });
  if (error) return { marcas: [], omitidas: [], error };
  if (piezas.length > MAX_PIEZAS_POR_LOTE) {
    return {
      marcas: [],
      omitidas: [],
      error: `Elige como máximo ${MAX_PIEZAS_POR_LOTE} piezas por vez.`,
    };
  }

  const rehabilita = ["implante", "puente", "protesis"].includes(condition);
  const marcas: MarcaDelLote[] = [];
  const omitidas: PlanDeLote["omitidas"] = [];
  for (const tooth of [...new Set(piezas)].sort((a, b) => a - b)) {
    const vigentes = (vigentesPorPieza.get(tooth) ?? []).filter((m) => !m.supersededAt);
    const igual = vigentes.some(
      (m) =>
        m.condition === condition &&
        m.surface === surface &&
        m.status === status &&
        (m.conservation ?? null) === cons,
    );
    if (igual) {
      omitidas.push({ tooth, motivo: "ya la tiene" });
      continue;
    }
    const ausente = vigentes.some((m) => m.condition === "ausente" && m.status === "existente");
    if (ausente && !rehabilita && condition !== "ausente") {
      omitidas.push({ tooth, motivo: "está ausente" });
      continue;
    }
    const nueva = { id: nuevoId(), toothNumber: tooth, surface, condition, status };
    marcas.push({
      ...nueva,
      conservation: cons,
      baseMarkIds: marcasQueReemplaza(vigentes, nueva),
    });
  }
  return { marcas, omitidas, error: null };
}

/** "Caries en oclusal" / "Corona por realizar" para la confirmación. */
export function describirAplicacion({
  condition,
  surface,
  status,
}: {
  condition: ToothCondition;
  surface: ToothSurface;
  status: MarkStatus;
}): string {
  const label = CONDITION_CATALOG[condition].label;
  const estado = status === "planificado" ? " por realizar" : "";
  if (surface === "whole") return `${label}${estado}`;
  return `${label}${estado} en ${SURFACE_LABELS[surface].toLowerCase()}`;
}
