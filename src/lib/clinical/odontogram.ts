/** Superficies dentales estándar (patrón FDI simplificado). */
export const TOOTH_SURFACES = [
  "mesial",
  "distal",
  "oclusal",
  "vestibular",
  "lingual",
  "whole",
] as const;
export type ToothSurface = (typeof TOOTH_SURFACES)[number];

export const SURFACE_LABELS: Record<ToothSurface, string> = {
  mesial: "Mesial",
  distal: "Distal",
  oclusal: "Oclusal / Incisal",
  vestibular: "Vestibular",
  lingual: "Lingual / Palatino",
  whole: "Pieza completa",
};

/**
 * Condiciones del odontograma. El orden es el del enum `tooth_condition` en
 * Postgres: las diez primeras son las originales (ago-2026), las siguientes se
 * agregaron en la migración 20261019170000 (auditoría 360, CLI-03) y
 * `observacion` en la 20261030100000 (Ola 9, ODO-08). Un valor
 * nuevo va SIEMPRE al final: `ALTER TYPE ... ADD VALUE` agrega al final.
 */
export const TOOTH_CONDITIONS = [
  "sano",
  "caries",
  "obturacion",
  "endodoncia",
  "corona",
  "implante",
  "ausente",
  "sellante",
  "fractura",
  "protesis",
  "restos_radiculares",
  "extraccion_indicada",
  "en_erupcion",
  "retenida",
  "supernumeraria",
  "diastema",
  "giroversion",
  "migracion",
  "transposicion",
  "perno_munon",
  "carilla",
  "incrustacion",
  "puente",
  "aparato_ortodoncia",
  "desgaste",
  "fluorosis",
  "hipoplasia",
  "mancha_blanca",
  "fosas_fisuras_profundas",
  "observacion",
] as const;
export type ToothCondition = (typeof TOOTH_CONDITIONS)[number];

/**
 * Estado del registro (CLI-02): lo que ya está en la boca vs. lo que el
 * odontólogo indicó hacer. Cuando lo planificado se hace, se registra la
 * misma condición como `existente` y la planificada se cierra sola.
 */
export const MARK_STATUSES = ["existente", "planificado"] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

export const MARK_STATUS_LABELS: Record<MarkStatus, string> = {
  existente: "Existente",
  planificado: "Por realizar",
};

/** Estado de conservación de un tratamiento existente (CLI-02). */
export const MARK_CONSERVATIONS = ["bueno", "malo"] as const;
export type MarkConservation = (typeof MARK_CONSERVATIONS)[number];

export const MARK_CONSERVATION_LABELS: Record<MarkConservation, string> = {
  bueno: "Buen estado",
  malo: "Mal estado",
};

/**
 * Alcance de una condición: la pieza completa (`whole`), una superficie, o
 * cualquiera de las dos (la fractura puede ser de una cara o de la pieza).
 */
export type AlcanceCondicion = "pieza" | "superficie" | "ambos";

/**
 * Categoría clínica, que decide el color (ver `odontograma-reglas.ts`):
 * - `patologia`: siempre roja (caries, fractura, restos radiculares…).
 * - `tratamiento`: azul si existe en buen estado, roja si está en mal estado
 *   o por realizar. Es la única categoría que admite "por realizar" y
 *   "bueno/malo".
 * - `hallazgo`: anomalías y estados de la pieza (ausente, en erupción,
 *   giroversión…), azules.
 * - `sano`: sin color.
 */
export type CategoriaCondicion = "sano" | "patologia" | "tratamiento" | "hallazgo";

export interface DefinicionCondicion {
  label: string;
  /** Sigla corta para el recuadro de la pieza (inspirada en la NTS 188 de Perú). */
  sigla: string;
  alcance: AlcanceCondicion;
  /**
   * Grupo de reemplazo: una marca nueva cierra la vigente del MISMO grupo, en
   * el mismo alcance y con el mismo estado. Casi todas forman su propio grupo
   * (endodoncia y corona conviven). Dos grupos compartidos:
   * - `presencia`: qué hay en el alvéolo (ausente, implante, restos…), una
   *   sola respuesta por pieza.
   * - `superficie`: el estado de una cara (caries, obturación, sellante…),
   *   una sola respuesta por superficie; una restauración con caries
   *   recurrente se registra como obturación en mal estado, como en la NTS.
   */
  grupo: string;
  categoria: CategoriaCondicion;
  /** Superficies admitidas cuando no son las cinco (diastema, carilla…). */
  superficies?: readonly Exclude<ToothSurface, "whole">[];
}

export const CONDITION_CATALOG: Record<ToothCondition, DefinicionCondicion> = {
  sano: { label: "Sano", sigla: "", alcance: "ambos", grupo: "sano", categoria: "sano" },
  caries: {
    label: "Caries",
    sigla: "C",
    alcance: "superficie",
    grupo: "superficie",
    categoria: "patologia",
  },
  obturacion: {
    label: "Obturación",
    sigla: "OB",
    alcance: "superficie",
    grupo: "superficie",
    categoria: "tratamiento",
  },
  endodoncia: {
    label: "Endodoncia",
    sigla: "TC",
    alcance: "pieza",
    grupo: "endodoncia",
    categoria: "tratamiento",
  },
  corona: {
    label: "Corona",
    sigla: "CO",
    alcance: "pieza",
    grupo: "corona",
    categoria: "tratamiento",
  },
  implante: {
    label: "Implante",
    sigla: "IMP",
    alcance: "pieza",
    grupo: "presencia",
    categoria: "tratamiento",
  },
  ausente: {
    label: "Ausente",
    sigla: "AUS",
    alcance: "pieza",
    grupo: "presencia",
    categoria: "hallazgo",
  },
  sellante: {
    label: "Sellante",
    sigla: "SE",
    alcance: "superficie",
    grupo: "superficie",
    categoria: "tratamiento",
  },
  fractura: {
    label: "Fractura",
    sigla: "FX",
    alcance: "ambos",
    grupo: "fractura",
    categoria: "patologia",
  },
  protesis: {
    label: "Prótesis removible",
    sigla: "PR",
    alcance: "pieza",
    grupo: "protesis",
    categoria: "tratamiento",
  },
  restos_radiculares: {
    label: "Restos radiculares",
    sigla: "RR",
    alcance: "pieza",
    grupo: "presencia",
    categoria: "patologia",
  },
  extraccion_indicada: {
    label: "Extracción indicada",
    sigla: "EX",
    alcance: "pieza",
    grupo: "presencia",
    categoria: "patologia",
  },
  en_erupcion: {
    label: "En erupción",
    sigla: "ERU",
    alcance: "pieza",
    grupo: "presencia",
    categoria: "hallazgo",
  },
  retenida: {
    label: "Retenida / impactada",
    sigla: "RI",
    alcance: "pieza",
    grupo: "presencia",
    categoria: "hallazgo",
  },
  supernumeraria: {
    label: "Supernumeraria",
    sigla: "SN",
    alcance: "pieza",
    grupo: "supernumeraria",
    categoria: "hallazgo",
  },
  diastema: {
    label: "Diastema",
    sigla: "DIA",
    alcance: "superficie",
    grupo: "diastema",
    categoria: "hallazgo",
    superficies: ["mesial", "distal"],
  },
  giroversion: {
    label: "Giroversión",
    sigla: "GV",
    alcance: "pieza",
    grupo: "giroversion",
    categoria: "hallazgo",
  },
  migracion: {
    label: "Migración / extrusión / intrusión",
    sigla: "MIG",
    alcance: "pieza",
    grupo: "migracion",
    categoria: "hallazgo",
  },
  transposicion: {
    label: "Transposición",
    sigla: "TR",
    alcance: "pieza",
    grupo: "transposicion",
    categoria: "hallazgo",
  },
  perno_munon: {
    label: "Perno muñón",
    sigla: "PM",
    alcance: "pieza",
    grupo: "perno_munon",
    categoria: "tratamiento",
  },
  carilla: {
    label: "Carilla",
    sigla: "CV",
    alcance: "superficie",
    grupo: "superficie",
    categoria: "tratamiento",
    superficies: ["vestibular"],
  },
  incrustacion: {
    label: "Incrustación",
    sigla: "INC",
    alcance: "superficie",
    grupo: "superficie",
    categoria: "tratamiento",
  },
  puente: {
    label: "Prótesis fija (puente)",
    sigla: "PF",
    alcance: "pieza",
    grupo: "puente",
    categoria: "tratamiento",
  },
  aparato_ortodoncia: {
    label: "Aparato de ortodoncia",
    sigla: "AO",
    alcance: "pieza",
    grupo: "aparato_ortodoncia",
    categoria: "tratamiento",
  },
  desgaste: {
    label: "Desgaste",
    sigla: "DES",
    alcance: "superficie",
    grupo: "desgaste",
    categoria: "patologia",
  },
  fluorosis: {
    label: "Fluorosis",
    sigla: "FLU",
    alcance: "pieza",
    grupo: "fluorosis",
    categoria: "hallazgo",
  },
  hipoplasia: {
    label: "Hipoplasia del esmalte",
    sigla: "HP",
    alcance: "pieza",
    grupo: "hipoplasia",
    categoria: "hallazgo",
  },
  mancha_blanca: {
    label: "Mancha blanca",
    sigla: "MB",
    alcance: "superficie",
    grupo: "superficie",
    categoria: "patologia",
  },
  fosas_fisuras_profundas: {
    label: "Fosas y fisuras profundas",
    sigla: "FFP",
    alcance: "superficie",
    grupo: "superficie",
    categoria: "hallazgo",
    superficies: ["oclusal"],
  },
  // ODO-08: nota libre de la pieza. No es una condición clínica: no se pinta,
  // no se ofrece en la grilla de condiciones y solo la reemplaza otra
  // observación de la misma pieza (ver `marcasQueReemplaza`).
  observacion: {
    label: "Observación",
    sigla: "OBS",
    alcance: "pieza",
    grupo: "observacion",
    categoria: "hallazgo",
  },
};

/** La observación por pieza (ODO-08) viaja como marca pero no es una condición. */
export const OBSERVACION: ToothCondition = "observacion";

export function esObservacion(m: { condition: ToothCondition }): boolean {
  return m.condition === OBSERVACION;
}

/**
 * Separa las observaciones (ODO-08) del resto de las marcas vigentes: el
 * dibujo, la tabla, los resúmenes y las reglas de color trabajan solo con
 * las condiciones clínicas. Por pieza queda la observación vigente con texto;
 * una observación vacía es la forma de borrarla sin editar nada (regla 9).
 */
export function separarObservaciones<
  M extends Pick<OdontogramMark, "condition" | "toothNumber" | "notes" | "supersededAt">,
>(marcas: readonly M[]): { clinicas: M[]; observaciones: Map<number, M> } {
  const clinicas: M[] = [];
  const observaciones = new Map<number, M>();
  for (const m of marcas) {
    if (!esObservacion(m)) {
      clinicas.push(m);
      continue;
    }
    if (m.supersededAt || !m.notes?.trim()) continue;
    observaciones.set(m.toothNumber, m);
  }
  return { clinicas, observaciones };
}

export const CONDITION_LABELS = Object.fromEntries(
  TOOTH_CONDITIONS.map((c) => [c, CONDITION_CATALOG[c].label]),
) as Record<ToothCondition, string>;

/**
 * Condiciones que solo tienen sentido a nivel de pieza completa (no por
 * superficie): endodoncia, corona, implante, ausente, extracción indicada…
 * Derivado del catálogo; la base lo valida con el mismo catálogo.
 */
export const WHOLE_TOOTH_CONDITIONS: readonly ToothCondition[] = TOOTH_CONDITIONS.filter(
  (c) => CONDITION_CATALOG[c].alcance === "pieza",
);

/**
 * Numeración FDI (ISO 3950). Cuadrantes 1-4 permanentes; 5-8 primarios.
 * Cada cuadrante va 1-8 desde el incisivo central hasta el tercer molar.
 * Devuelve los cuadrantes ordenados para renderizar el layout dental clásico:
 *  17 16 15 14 13 12 11 | 21 22 23 24 25 26 27 28    (arriba, vista frontal)
 *  47 46 45 44 43 42 41 | 31 32 33 34 35 36 37 38    (abajo)
 */
export const FDI_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11] as const;
export const FDI_UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28] as const;
export const FDI_LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38] as const;
export const FDI_LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41] as const;

export const FDI_ALL_ADULT = [
  ...FDI_UPPER_RIGHT,
  ...FDI_UPPER_LEFT,
  ...FDI_LOWER_RIGHT,
  ...FDI_LOWER_LEFT,
] as const;

/**
 * Dentición temporal (odontopediatría): cuadrantes 5-8, 5 piezas cada uno
 * (sin molares permanentes). Mismo patrón FDI, mismas condiciones y misma
 * tabla odontogram_marks — el CHECK de rango ya lo permite desde que se creó
 * el odontograma, solo faltaba exponerlo en la UI.
 */
export const FDI_UPPER_RIGHT_PRIMARY = [55, 54, 53, 52, 51] as const;
export const FDI_UPPER_LEFT_PRIMARY = [61, 62, 63, 64, 65] as const;
export const FDI_LOWER_LEFT_PRIMARY = [71, 72, 73, 74, 75] as const;
export const FDI_LOWER_RIGHT_PRIMARY = [85, 84, 83, 82, 81] as const;

export const FDI_ALL_PRIMARY = [
  ...FDI_UPPER_RIGHT_PRIMARY,
  ...FDI_UPPER_LEFT_PRIMARY,
  ...FDI_LOWER_RIGHT_PRIMARY,
  ...FDI_LOWER_LEFT_PRIMARY,
] as const;

/**
 * Nombre común de la pieza a partir de su número FDI — la notación FDI
 * ("18→11", "26→28") nunca se traducía a algo que un paciente reconozca,
 * y se usa en vivo delante suyo durante la consulta (riesgo clínico-legal,
 * auditoría de UI, 30-ago). El último dígito da la posición en el
 * cuadrante (1-8 en dentición permanente, 1-5 en temporal); el primer
 * dígito da cuadrante → arcada + lado.
 */
const POSICION_PERMANENTE: Record<number, string> = {
  1: "incisivo central",
  2: "incisivo lateral",
  3: "canino",
  4: "primer premolar",
  5: "segundo premolar",
  6: "primer molar",
  7: "segundo molar",
  8: "tercer molar (muela del juicio)",
};

const POSICION_TEMPORAL: Record<number, string> = {
  1: "incisivo central temporal",
  2: "incisivo lateral temporal",
  3: "canino temporal",
  4: "primer molar temporal",
  5: "segundo molar temporal",
};

const CUADRANTE_ARCADA_LADO: Record<number, string> = {
  1: "superior derecho",
  2: "superior izquierdo",
  3: "inferior izquierdo",
  4: "inferior derecho",
  5: "superior derecho",
  6: "superior izquierdo",
  7: "inferior izquierdo",
  8: "inferior derecho",
};

/** "16" → "primer molar superior derecho". Devuelve `null` si no es un número FDI válido (2 dígitos, cuadrante 1-8, posición 1-8/1-5 según dentición). */
export function toothCommonName(tooth: number): string | null {
  if (tooth < 11 || tooth > 85) return null;
  const cuadrante = Math.floor(tooth / 10);
  const posicion = tooth % 10;
  const lado = CUADRANTE_ARCADA_LADO[cuadrante];
  if (!lado) return null;
  const nombre = cuadrante <= 4 ? POSICION_PERMANENTE[posicion] : POSICION_TEMPORAL[posicion];
  if (!nombre) return null;
  return `${nombre} ${lado}`;
}

export interface OdontogramMark {
  id: string;
  toothNumber: number;
  surface: ToothSurface;
  condition: ToothCondition;
  status: MarkStatus;
  /** Solo en tratamientos existentes; `null` = sin especificar (marcas anteriores a CLI-02). */
  conservation: MarkConservation | null;
  material: string | null;
  notes: string | null;
  supersededAt: string | null;
  recordedAt: string;
  recordedById: string;
  recordedByName: string | null;
}

/** Marcas vigentes de una pieza: todas, sin perder ninguna (CLI-01). */
export type ToothState = OdontogramMark[];

/** Agrupa las marcas vigentes por número de pieza. Una pieza puede tener varias. */
export function marksByTooth(marks: OdontogramMark[]): Map<number, ToothState> {
  const map = new Map<number, ToothState>();
  for (const mark of marks) {
    if (mark.supersededAt) continue;
    const tooth = map.get(mark.toothNumber) ?? [];
    tooth.push(mark);
    map.set(mark.toothNumber, tooth);
  }
  return map;
}
