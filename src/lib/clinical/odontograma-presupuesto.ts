/**
 * Odontograma y presupuesto (Ola 9, ODO-06 y ODO-07). Lógica pura.
 *
 * - `presupuestoPorPieza`: lo presupuestado sobre cada pieza, según el estado
 *   del presupuesto (aceptado, por aceptar, borrador), para la vista
 *   "Presupuesto" del odontograma.
 * - `hallazgosPorTratar`: lo que el odontograma dice que hay que tratar y
 *   todavía no está en ningún presupuesto vigente ni se hizo.
 *
 * Sin red ni React. Los presupuestos llegan de `listQuotes` (misma caché que
 * la pestaña de Finanzas).
 */
import type { OdontogramMark, ToothSurface } from "@/lib/clinical/odontogram";
import { CONDITION_CATALOG } from "@/lib/clinical/odontogram";
import { estadoDelPlan } from "@/lib/finance/estados-presupuesto";
import type { Quote, QuoteItem } from "@/lib/finance/finance";

export const ESTADOS_PRESUPUESTARIOS = ["aceptado", "por_aceptar", "borrador"] as const;
export type EstadoPresupuestario = (typeof ESTADOS_PRESUPUESTARIOS)[number];

export const ETIQUETA_ESTADO_PRESUPUESTARIO: Record<EstadoPresupuestario, string> = {
  aceptado: "Aceptado",
  por_aceptar: "Por aceptar",
  borrador: "Borrador",
};

/** Letra de la pieza en la vista Presupuesto: el estado nunca va solo por color. */
export const LETRA_ESTADO_PRESUPUESTARIO: Record<EstadoPresupuestario, string> = {
  aceptado: "A",
  por_aceptar: "E",
  borrador: "B",
};

/**
 * Estado con el que una línea cuenta sobre la pieza, o `null` si no cuenta:
 * presupuesto rechazado o vencido, o línea que el paciente no aceptó en una
 * aceptación parcial. Usa los mismos estados que ve el usuario en la lista de
 * presupuestos (`estadoDelPlan`): un borrador con la validez pasada ya es
 * "vencido".
 */
export function estadoDeLinea(
  quote: Pick<Quote, "status" | "validUntil">,
  item: Pick<QuoteItem, "accepted">,
  hoy: string,
): EstadoPresupuestario | null {
  switch (estadoDelPlan({ status: quote.status, validUntil: quote.validUntil }, hoy)) {
    case "aceptado":
    case "finalizado":
      return "aceptado";
    case "aceptado_parcial":
      return item.accepted === false ? null : "aceptado";
    case "emitido":
      return "por_aceptar";
    case "borrador":
      return "borrador";
    default:
      return null;
  }
}

export interface LineaEnPieza {
  quoteId: string;
  quoteNumber: string;
  itemId: string;
  nombre: string;
  surface: ToothSurface | null;
  estado: EstadoPresupuestario;
  totalCents: number;
  /** Marca del odontograma de la que salió (sugerencia de la ficha), si la hay. */
  markId: string | null;
}

export interface PresupuestoPorPieza {
  porPieza: Map<number, LineaEnPieza[]>;
  /** Líneas de presupuestos vigentes sin pieza (limpieza, radiografía…). */
  sinPieza: LineaEnPieza[];
}

/** Lo presupuestado en cada pieza, solo de líneas que cuentan (ver `estadoDeLinea`). */
export function presupuestoPorPieza(quotes: readonly Quote[], hoy: string): PresupuestoPorPieza {
  const porPieza = new Map<number, LineaEnPieza[]>();
  const sinPieza: LineaEnPieza[] = [];
  for (const q of quotes) {
    for (const it of q.items) {
      const estado = estadoDeLinea(q, it, hoy);
      if (!estado) continue;
      const linea: LineaEnPieza = {
        quoteId: q.id,
        quoteNumber: q.number,
        itemId: it.id,
        nombre: it.nameSnapshot,
        surface: it.surface,
        estado,
        totalCents: it.totalCents,
        markId: it.odontogramMarkId,
      };
      if (it.toothNumber === null) {
        sinPieza.push(linea);
        continue;
      }
      const lista = porPieza.get(it.toothNumber) ?? [];
      lista.push(linea);
      porPieza.set(it.toothNumber, lista);
    }
  }
  return { porPieza, sinPieza };
}

const PRIORIDAD: Record<EstadoPresupuestario, number> = {
  aceptado: 3,
  por_aceptar: 2,
  borrador: 1,
};

/** Estado con el que se pinta la pieza cuando tiene líneas de varios presupuestos: el más firme. */
export function estadoDominante(lineas: readonly LineaEnPieza[]): EstadoPresupuestario | null {
  let mejor: EstadoPresupuestario | null = null;
  for (const l of lineas) if (!mejor || PRIORIDAD[l.estado] > PRIORIDAD[mejor]) mejor = l.estado;
  return mejor;
}

export interface ResumenEstadoPresupuestario {
  estado: EstadoPresupuestario;
  piezas: number;
  lineas: number;
  totalCents: number;
}

/**
 * Totales por estado para los chips de la vista. Una pieza cuenta en cada
 * estado en el que tenga líneas; el total suma todas las líneas del estado,
 * con y sin pieza.
 */
export function resumenPorEstado(p: PresupuestoPorPieza): ResumenEstadoPresupuestario[] {
  return ESTADOS_PRESUPUESTARIOS.map((estado) => {
    let piezas = 0;
    let lineas = 0;
    let totalCents = 0;
    for (const lista of p.porPieza.values()) {
      const delEstado = lista.filter((l) => l.estado === estado);
      if (!delEstado.length) continue;
      piezas += 1;
      lineas += delEstado.length;
      totalCents += delEstado.reduce((s, l) => s + l.totalCents, 0);
    }
    for (const l of p.sinPieza) {
      if (l.estado !== estado) continue;
      lineas += 1;
      totalCents += l.totalCents;
    }
    return { estado, piezas, lineas, totalCents };
  });
}

// ─── Hallazgos por tratar (ODO-07) ───────────────────────────────────────

export type MotivoPorTratar = "patologia" | "mal_estado" | "por_realizar";

export const ETIQUETA_MOTIVO: Record<MotivoPorTratar, string> = {
  patologia: "Patológico",
  mal_estado: "En mal estado",
  por_realizar: "Por realizar",
};

export interface HallazgoPorTratar<M> {
  marca: M;
  motivo: MotivoPorTratar;
}

type MarcaHallazgo = Pick<
  OdontogramMark,
  "id" | "toothNumber" | "surface" | "condition" | "status" | "conservation" | "supersededAt"
>;

/** Motivo por el que la marca pide tratamiento, o `null` si no lo pide. */
export function motivoPorTratar(m: MarcaHallazgo): MotivoPorTratar | null {
  if (m.supersededAt || m.condition === "observacion") return null;
  const { categoria } = CONDITION_CATALOG[m.condition];
  if (m.status === "planificado") return categoria === "tratamiento" ? "por_realizar" : null;
  if (categoria === "patologia") return "patologia";
  if (categoria === "tratamiento" && m.conservation === "malo") return "mal_estado";
  // Lo que queda (hallazgos azules, tratamientos en buen estado) no se trata.
  return null;
}

/** ¿La línea cubre la zona de la marca? Sin superficie, la línea es de la pieza entera. */
function cubre(linea: LineaEnPieza, surface: ToothSurface): boolean {
  return linea.surface === null || surface === "whole" || linea.surface === surface;
}

/**
 * Hallazgos que piden tratamiento y no tienen nada presupuestado: ni una
 * línea vinculada a la marca, ni una línea vigente (borrador, por aceptar o
 * aceptada) en la misma pieza y zona. Lo realizado no aparece porque ya no
 * está vigente: una caries obturada quedó cerrada por la obturación.
 *
 * Criterio por pieza y zona, no por prestación: una línea "corona" en la 36
 * cubre la caries de la 36. Es lo que hace el odontólogo al leer la ficha, y
 * evita sugerir dos veces lo que ya se conversó con el paciente.
 */
export function hallazgosPorTratar<M extends MarcaHallazgo>(
  marcas: readonly M[],
  presupuesto: PresupuestoPorPieza,
): HallazgoPorTratar<M>[] {
  const vinculadas = new Set<string>();
  for (const lista of presupuesto.porPieza.values()) {
    for (const l of lista) if (l.markId) vinculadas.add(l.markId);
  }
  const salida: HallazgoPorTratar<M>[] = [];
  for (const m of marcas) {
    const motivo = motivoPorTratar(m);
    if (!motivo || vinculadas.has(m.id)) continue;
    const lineas = presupuesto.porPieza.get(m.toothNumber) ?? [];
    if (lineas.some((l) => cubre(l, m.surface))) continue;
    salida.push({ marca: m, motivo });
  }
  return salida.sort(
    (a, b) =>
      a.marca.toothNumber - b.marca.toothNumber ||
      (a.marca.surface === "whole" ? -1 : 0) - (b.marca.surface === "whole" ? -1 : 0),
  );
}
