/**
 * Search params de la ficha del paciente (`/pacientes/$pacienteId`).
 *
 * Todos opcionales: hay links a la ficha en una docena de pantallas y ninguno
 * tiene por qué conocer estos parámetros.
 */
export const PESTANAS_FICHA = [
  "resumen",
  "periodontograma",
  "notas",
  "finanzas",
  "anamnesis",
  "documentos",
  "mensajes",
] as const;
export type PestanaFicha = (typeof PESTANAS_FICHA)[number];

/**
 * Pestañas anteriores al rediseño A+ (26-oct-2026) que siguen llegando por
 * links guardados. El odontograma ahora vive en la pestaña de entrada
 * ("resumen"), como en el prototipo: `?pestana=odontograma` abre ahí.
 */
const PESTANAS_ANTERIORES: Record<string, PestanaFicha> = { odontograma: "resumen" };

/** Pestañas con datos clínicos: solo con `clinical:view`. */
const PESTANAS_CLINICAS: readonly PestanaFicha[] = ["periodontograma", "notas", "documentos"];

export interface FichaSearch {
  /** Pestaña activa. Ausente = "resumen": así el default no ensucia la URL y
   * un link compartido a la ficha a secas abre donde siempre. */
  pestana?: PestanaFicha;
  /** `?cobrar=1`: abre el diálogo de pago (lo usa "Cobrar" del popover de la
   * agenda). Es un disparo de una vez: la ficha lo saca de la URL al usarlo. */
  cobrar?: 1;
}

/** Acepta `1`, `"1"` y `true` (lo que puede dejar el serializador o un link
 * escrito a mano); cualquier otra cosa es "no". */
export function parseCobrar(v: unknown): boolean {
  return v === 1 || v === "1" || v === true || v === "true";
}

/** Lo que no es una pestaña conocida cae a "resumen" (link viejo, typo). */
export function parsePestana(v: unknown): PestanaFicha {
  if (typeof v !== "string") return "resumen";
  if ((PESTANAS_FICHA as readonly string[]).includes(v)) return v as PestanaFicha;
  return PESTANAS_ANTERIORES[v] ?? "resumen";
}

/**
 * La pestaña que de verdad se muestra: un link compartido a `?pestana=notas`
 * abierto por un rol sin `clinical:view` cae a "resumen" en vez de dejar la
 * ficha sin ninguna pestaña activa (esas pestañas ni se renderizan).
 */
export function pestanaVisible(pestana: PestanaFicha, puedeVerClinico: boolean): PestanaFicha {
  return !puedeVerClinico && PESTANAS_CLINICAS.includes(pestana) ? "resumen" : pestana;
}

/**
 * Search de la ficha al cambiar de pestaña. Conserva lo demás, salvo `cobrar`
 * (disparo de una vez), y omite "resumen" por ser el default.
 */
export function busquedaConPestana(prev: FichaSearch, pestana: PestanaFicha): FichaSearch {
  const { pestana: _p, cobrar: _c, ...resto } = prev;
  return pestana === "resumen" ? resto : { ...resto, pestana };
}

export function validarBusquedaFicha(search: Record<string, unknown>): FichaSearch {
  const out: FichaSearch = {};
  const pestana = parsePestana(search.pestana);
  if (pestana !== "resumen") out.pestana = pestana;
  if (parseCobrar(search.cobrar)) out.cobrar = 1;
  return out;
}
