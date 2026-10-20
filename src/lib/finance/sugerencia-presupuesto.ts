/**
 * Sugerencia "por realizar → presupuesto" de la ficha (PR 11 del rediseño A+).
 *
 * Al guardar una marca del odontograma con estado "por realizar", la ficha
 * ofrece sumarla a una fase del presupuesto en borrador. Este módulo es la
 * lógica pura de esa sugerencia: cuándo se ofrece, qué prestación del arancel
 * corresponde a la condición, a qué presupuesto y fase va. Sin red ni React,
 * para poder testearla entera.
 *
 * Nada se suma solo: la sugerencia se muestra y el profesional decide (misma
 * regla que Patty: propone, no ejecuta). El servidor valida todo de nuevo.
 */
import {
  CONDITION_CATALOG,
  CONDITION_LABELS,
  type MarkStatus,
  type ToothCondition,
} from "@/lib/clinical/odontogram";
import { groupByPhase, type Procedure, type Quote, type QuoteStatus } from "@/lib/finance/finance";

/**
 * Palabras con las que se reconoce, en el nombre o el código de una
 * prestación del arancel, el tratamiento de cada condición. Solo tratamientos:
 * la base rechaza un "por realizar" que no lo sea (`validate_odontogram_mark`).
 * Se compara sin tildes y en minúsculas.
 */
export const PALABRAS_POR_CONDICION: Partial<Record<ToothCondition, readonly string[]>> = {
  obturacion: ["obturacion", "resina", "amalgama", "restauracion"],
  endodoncia: ["endodoncia", "tratamiento de conducto", "conducto"],
  corona: ["corona"],
  implante: ["implante"],
  sellante: ["sellante", "sellado"],
  protesis: ["protesis"],
  perno_munon: ["perno", "munon"],
  carilla: ["carilla"],
  incrustacion: ["incrustacion", "inlay", "onlay"],
  puente: ["puente"],
  aparato_ortodoncia: ["ortodoncia", "bracket", "aparato"],
};

/** Quita tildes y pasa a minúsculas: "Obturación" → "obturacion". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Prestación del arancel que corresponde a la condición, o `null` si la
 * clínica no tiene ninguna que la nombre. Gana la primera en el orden del
 * arancel; entre las que coinciden, la que dice la palabra principal de la
 * condición (ej. "Endodoncia molar" antes que "Control post conducto").
 */
export function procedimientoSugerido(
  condition: ToothCondition,
  procedures: readonly Procedure[],
): Procedure | null {
  const palabras = PALABRAS_POR_CONDICION[condition];
  if (!palabras?.length) return null;
  const activas = procedures.filter((p) => p.isActive);
  for (const palabra of palabras) {
    const hallada = activas.find((p) =>
      normalizar(`${p.name} ${p.code ?? ""}`).includes(normalizar(palabra)),
    );
    if (hallada) return hallada;
  }
  return null;
}

/** Estados en los que un presupuesto todavía cuenta: el ítem sigue vivo. */
const ESTADOS_VIGENTES: readonly QuoteStatus[] = ["draft", "sent", "accepted", "converted"];

/**
 * Ids de las marcas que ya están en un presupuesto vigente (PR 11b,
 * `quote_items.odontogram_mark_id`). Un presupuesto rechazado o vencido no
 * cuenta: esa marca se puede volver a presupuestar.
 */
export function marcasYaPresupuestadas(quotes: readonly Quote[]): Set<string> {
  const ids = new Set<string>();
  for (const q of quotes) {
    if (!ESTADOS_VIGENTES.includes(q.status)) continue;
    for (const it of q.items) if (it.odontogramMarkId) ids.add(it.odontogramMarkId);
  }
  return ids;
}

export interface ContextoSugerencia {
  /** Flag `ficha-sugerencia-presupuesto`. */
  flag: boolean;
  /** `patients:manage`: el mismo permiso que el botón "Presupuestar" de G-1. */
  puedeFacturar: boolean;
  /** Modo solo lectura (BIL-01): no se ofrece lo que el servidor va a rechazar. */
  soloLectura: boolean;
  marca: { id: string; condition: ToothCondition; status: MarkStatus };
  /** Resultado de `marcasYaPresupuestadas`. */
  yaPresupuestadas: ReadonlySet<string>;
  /**
   * Marcas vigentes que la nueva cierra (`marcasQueReemplaza`). Volver a
   * guardar la misma indicación (ej. otra vez "endodoncia por realizar" en la
   * 36) crea una marca con id nuevo; si la que reemplaza, de la misma
   * condición, ya estaba presupuestada, no se vuelve a sugerir.
   */
  reemplaza?: readonly { id: string; condition: ToothCondition }[];
}

/**
 * ¿Se ofrece sumar esta marca al presupuesto? Solo un tratamiento "por
 * realizar", con permiso de facturar, fuera de solo lectura, con el flag y
 * si la marca (o la misma indicación que reemplaza) no está ya en un
 * presupuesto. Lo existente nunca sugiere nada.
 */
export function debeSugerir(ctx: ContextoSugerencia): boolean {
  if (!ctx.flag || !ctx.puedeFacturar || ctx.soloLectura) return false;
  if (ctx.marca.status !== "planificado") return false;
  if (CONDITION_CATALOG[ctx.marca.condition]?.categoria !== "tratamiento") return false;
  if (ctx.yaPresupuestadas.has(ctx.marca.id)) return false;
  return !(ctx.reemplaza ?? []).some(
    (m) => m.condition === ctx.marca.condition && ctx.yaPresupuestadas.has(m.id),
  );
}

/**
 * Presupuesto en borrador al que se suma la marca: el más reciente. `null` =
 * no hay, y el servidor crea uno nuevo. Uno enviado no se toca: ya lo vio el
 * paciente, y agregarle líneas en silencio cambiaría lo que aceptó leer.
 */
export function presupuestoBorrador(quotes: readonly Quote[]): Quote | null {
  const borradores = quotes.filter((q) => q.status === "draft");
  if (!borradores.length) return null;
  return [...borradores].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export const FASE_INICIAL = "Fase 1";

/**
 * Fases que ofrece el selector, en el orden del presupuesto, y la sugerida
 * (la primera, como en el prototipo: "Sumar al presupuesto · Fase 1"). La
 * última opción es siempre una fase nueva ("Fase N+1"), para empezar otro
 * bloque sin salir de la ficha. Sin presupuesto o sin fases: "Fase 1".
 */
export function fasesParaSugerir(quote: Quote | null): {
  opciones: string[];
  sugerida: string;
  nueva: string;
} {
  const existentes = quote
    ? groupByPhase(quote.items, (it) => it.totalCents)
        .map((g) => g.label)
        .filter((l): l is string => l !== null && l.trim() !== "")
    : [];
  if (!existentes.length) {
    return { opciones: [FASE_INICIAL], sugerida: FASE_INICIAL, nueva: FASE_INICIAL };
  }
  const usadas = new Set(existentes.map(normalizar));
  let n = existentes.length + 1;
  while (usadas.has(normalizar(`Fase ${n}`))) n += 1;
  const nueva = `Fase ${n}`;
  return { opciones: [...existentes, nueva], sugerida: existentes[0], nueva };
}

/**
 * Nombre del ítem: el de la prestación del arancel (es lo que se cobra), o
 * el de la condición si la clínica todavía no la tiene en el arancel.
 */
export function nombreDelItem(procedure: Procedure | null, condition: ToothCondition): string {
  return procedure?.name ?? CONDITION_LABELS[condition];
}
