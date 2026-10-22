/**
 * Receta estructurada (MKT-05): cómo se guarda cada medicamento de una
 * receta para poder mapearla a FHIR R4 `MedicationRequest`
 * (src/lib/clinical/receta-fhir.ts, docs/RECETA_FHIR.md) sin perder lo que
 * escribió el profesional.
 *
 * El profesional escribe la posología en palabras ("1 cápsula", "cada 8
 * horas", "por 7 días"): es lo que se imprime y lo que manda. Al emitir, el
 * servidor la interpreta (`interpretar*`) y guarda al lado la versión
 * estructurada (cantidad, intervalo, duración). Si una frase no se entiende
 * ("mientras dure el antiinflamatorio"), esa parte queda solo como texto, que
 * en FHIR también es válido (`dosageInstruction.text`).
 *
 * Lógica pura: sin red ni base.
 */
import { z } from "zod";

import { normalizarTexto, RecetaItemSchema, type RecetaItem } from "@/lib/clinical/recetas";
import {
  esGrupoFarmacologico,
  esVia,
  VIA_EN_POSOLOGIA,
  VIAS,
  type GrupoFarmacologico,
  type MedicamentoVademecum,
  type ViaAdministracion,
} from "@/lib/clinical/vademecum";

// ─── Lo que manda el diálogo ────────────────────────────────────────────────

export const RecetaMedicamentoEntradaSchema = RecetaItemSchema.extend({
  route: z.enum(VIAS, { message: "Indica la vía de administración." }),
  /** Ítem del vademécum que se usó para completar la fila (si se usó). */
  catalog: z
    .string()
    .trim()
    .max(80)
    .regex(/^(esmalia:[a-z0-9-]+|clinica:[0-9a-f-]{36})$/, "Medicamento del vademécum inválido.")
    .optional()
    .or(z.literal("")),
});
export type RecetaMedicamentoEntrada = z.infer<typeof RecetaMedicamentoEntradaSchema>;

// ─── Cómo se guarda (prescriptions.items) ───────────────────────────────────

export type UnidadDuracion = "d" | "wk" | "mo";
export type UnidadPeriodo = "h" | "d" | "wk";

export interface CantidadDosis {
  value: number;
  unit: string;
}

export interface IntervaloDosis {
  /** Veces por período: 1 cada 8 h → frequency 1, period 8, unit "h". */
  frequency: number;
  period: number;
  period_unit: UnidadPeriodo;
}

/**
 * Un medicamento tal como queda en `prescriptions.items`. Las claves de la
 * receta anterior (medication, presentation, dose, frequency, duration,
 * instructions) se mantienen: el PDF viejo y la lista las siguen leyendo.
 */
export type RecetaItemGuardado = RecetaItem & {
  route?: ViaAdministracion;
  /** Principio activo, si se conoce (del vademécum). */
  ingredient?: string;
  concentration?: string;
  form?: string;
  group?: GrupoFarmacologico;
  atc?: string;
  catalog?: string;
  dose_quantity?: CantidadDosis;
  timing?: IntervaloDosis;
  as_needed?: boolean;
  duration_value?: number;
  duration_unit?: UnidadDuracion;
};

/** Lectura tolerante de una fila guardada: lo que no tiene la forma esperada se descarta. */
export const RecetaItemGuardadoSchema = RecetaItemSchema.extend({
  route: z
    .string()
    .optional()
    .transform((v) => (esVia(v) ? v : undefined)),
  ingredient: z.string().max(120).optional(),
  concentration: z.string().max(60).optional(),
  form: z.string().max(60).optional(),
  group: z
    .string()
    .optional()
    .transform((v) => (esGrupoFarmacologico(v) ? v : undefined)),
  atc: z.string().max(10).optional(),
  catalog: z.string().max(80).optional(),
  dose_quantity: z.object({ value: z.number().positive(), unit: z.string().max(40) }).optional(),
  timing: z
    .object({
      frequency: z.number().int().positive(),
      period: z.number().positive(),
      period_unit: z.enum(["h", "d", "wk"]),
    })
    .optional(),
  as_needed: z.boolean().optional(),
  duration_value: z.number().positive().optional(),
  duration_unit: z.enum(["d", "wk", "mo"]).optional(),
});

export function leerItemsGuardados(valor: unknown): RecetaItemGuardado[] {
  const r = z.array(RecetaItemGuardadoSchema).safeParse(valor);
  if (!r.success) return [];
  return r.data.map((item) => {
    const limpio: RecetaItemGuardado = { ...item };
    for (const k of Object.keys(limpio) as (keyof RecetaItemGuardado)[]) {
      if (limpio[k] === undefined) delete limpio[k];
    }
    return limpio;
  });
}

// ─── Interpretar la posología escrita ───────────────────────────────────────

const PALABRAS_NUMERO: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  diez: 10,
  doce: 12,
  catorce: 14,
  quince: 15,
  veinte: 20,
  treinta: 30,
  media: 0.5,
  medio: 0.5,
};

/** "2,5" → 2.5, "1/2" → 0.5, "½" → 0.5, "dos" → 2. null si no es un número. */
function numeroDe(texto: string): number | null {
  const t = texto.trim().toLowerCase();
  if (t === "½") return 0.5;
  if (t === "¼") return 0.25;
  const fraccion = /^(\d+)\/(\d+)$/.exec(t);
  if (fraccion) {
    const d = Number(fraccion[2]);
    return d ? Number(fraccion[1]) / d : null;
  }
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  const palabra = normalizarTexto(t);
  return palabra in PALABRAS_NUMERO ? PALABRAS_NUMERO[palabra] : null;
}

const NUMERO = String.raw`(\d+(?:[.,]\d+)?|\d+\/\d+|½|¼|[a-záéíóú]+)`;

/** "1 cápsula" → { value: 1, unit: "cápsula" }; "15 mL" → { 15, "mL" }. */
export function interpretarDosis(texto: string): CantidadDosis | null {
  const m = new RegExp(`^\\s*${NUMERO}\\s+(.+?)\\s*$`, "i").exec(texto);
  if (!m) return null;
  const value = numeroDe(m[1]);
  const unit = m[2].trim();
  if (value === null || value <= 0 || !unit || unit.length > 40) return null;
  return { value, unit };
}

const UNIDAD_PERIODO: Record<string, UnidadPeriodo> = {
  h: "h",
  hr: "h",
  hrs: "h",
  hora: "h",
  horas: "h",
  dia: "d",
  dias: "d",
  semana: "wk",
  semanas: "wk",
};

/**
 * "cada 8 horas" → 1 vez cada 8 h; "2 veces al día" → 2 por día; "1 vez al
 * día" → 1 por día. Una frecuencia "si hay dolor" marca `asNeeded`.
 */
export function interpretarFrecuencia(texto: string): {
  timing: IntervaloDosis | null;
  asNeeded: boolean;
} {
  const t = normalizarTexto(texto);
  const asNeeded =
    /\b(sos|si (hay )?dolor|en caso de dolor|segun (necesidad|dolor)|si es necesario)\b/.test(t);
  // "hasta 4 veces al día" es un máximo, no un horario: queda como texto.
  if (/\bhasta\b/.test(t)) return { timing: null, asNeeded };
  const cada = /\bcada (\d+(?: \d+)?|[a-z]+) (h|hr|hrs|horas?|dias?|semanas?)\b/.exec(t);
  if (cada) {
    const period = numeroDe(cada[1].replace(" ", "."));
    const unidad = UNIDAD_PERIODO[cada[2]];
    if (period && unidad)
      return { timing: { frequency: 1, period, period_unit: unidad }, asNeeded };
  }
  const veces = /\b(\d+|[a-z]+) (?:vez|veces) (?:al|por) (dia|semana)\b/.exec(t);
  if (veces) {
    const n = numeroDe(veces[1]);
    if (n && Number.isInteger(n)) {
      return {
        timing: { frequency: n, period: 1, period_unit: veces[2] === "dia" ? "d" : "wk" },
        asNeeded,
      };
    }
  }
  if (/\b(diario|diaria|una vez al dia)\b/.test(t)) {
    return { timing: { frequency: 1, period: 1, period_unit: "d" }, asNeeded };
  }
  return { timing: null, asNeeded };
}

const UNIDAD_DURACION: Record<string, UnidadDuracion> = {
  dia: "d",
  dias: "d",
  semana: "wk",
  semanas: "wk",
  mes: "mo",
  meses: "mo",
};

/** "por 7 días" → { 7, "d" }; "durante 2 semanas" → { 2, "wk" }; "3 meses" → { 3, "mo" }. */
export function interpretarDuracion(texto: string): { value: number; unit: UnidadDuracion } | null {
  const t = normalizarTexto(texto);
  const m = /^(?:por |durante |x )?(\d+|[a-z]+) (dias?|semanas?|mes|meses)$/.exec(t);
  if (!m) return null;
  const value = numeroDe(m[1]);
  const unit = UNIDAD_DURACION[m[2]];
  if (!value || value <= 0 || !unit) return null;
  return { value, unit };
}

// ─── Armar la fila que se guarda ────────────────────────────────────────────

/**
 * Del medicamento que mandó el diálogo (+ el ítem del vademécum, si el
 * nombre sigue siendo el de ese ítem) a la fila que se guarda. El servidor
 * es quien decide el ítem del vademécum: lo busca él por el código.
 */
export function estructurarItem(
  entrada: RecetaMedicamentoEntrada,
  catalogo: MedicamentoVademecum | null,
  grupoPorNombre: (medicamento: string) => GrupoFarmacologico | null,
): RecetaItemGuardado {
  const medication = entrada.medication.trim();
  const item: RecetaItemGuardado = {
    medication,
    dose: entrada.dose.trim(),
    frequency: entrada.frequency.trim(),
    duration: entrada.duration.trim(),
    route: entrada.route,
  };
  const presentacion = entrada.presentation?.trim();
  const indicaciones = entrada.instructions?.trim();
  if (presentacion) item.presentation = presentacion;
  if (indicaciones) item.instructions = indicaciones;

  // El ítem del vademécum solo cuenta si el nombre no cambió.
  const usaCatalogo =
    catalogo !== null && normalizarTexto(catalogo.principioActivo) === normalizarTexto(medication);
  if (usaCatalogo) {
    item.catalog = catalogo.codigo;
    item.ingredient = catalogo.principioActivo;
    if (catalogo.concentracion) item.concentration = catalogo.concentracion;
    if (catalogo.forma) item.form = catalogo.forma;
    if (catalogo.atc) item.atc = catalogo.atc;
  }
  const grupo = (usaCatalogo ? catalogo.grupo : null) ?? grupoPorNombre(medication);
  if (grupo) item.group = grupo;

  const dosis = interpretarDosis(item.dose);
  if (dosis) item.dose_quantity = dosis;
  const { timing, asNeeded } = interpretarFrecuencia(item.frequency);
  if (timing) item.timing = timing;
  if (asNeeded) item.as_needed = true;
  const duracion = interpretarDuracion(item.duration);
  if (duracion) {
    item.duration_value = duracion.value;
    item.duration_unit = duracion.unit;
  }
  return item;
}

/** "1 cápsula, vía oral" (la dosis con la vía, para la tabla de la receta). */
export function dosisConVia(item: Pick<RecetaItemGuardado, "dose" | "route">): string {
  const via = item.route ? VIA_EN_POSOLOGIA[item.route] : null;
  return [item.dose.trim(), via].filter(Boolean).join(", ");
}
