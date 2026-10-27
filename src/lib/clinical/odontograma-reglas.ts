/**
 * Reglas clínicas del odontograma (auditoría 360, CLI-01/02/04), en funciones
 * puras para poder probarlas sin base.
 *
 * La fuente de verdad de lo que se guarda es la base: el trigger
 * `close_previous_odontogram_mark` (migración 20261019170000) aplica las
 * mismas reglas de reemplazo y `validate_odontogram_mark` las mismas
 * validaciones. Este archivo las repite para que la UI muestre lo mismo que
 * va a pasar y para detectar conflictos antes de insertar.
 * `tests/odontograma-reglas.test.ts` compara el catálogo de acá con el de la
 * migración: si alguien cambia uno sin el otro, el test falla.
 */
import {
  CONDITION_CATALOG,
  TOOTH_CONDITIONS,
  type MarkConservation,
  type MarkStatus,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";

export const SUPERFICIES_DE_CARA = [
  "mesial",
  "distal",
  "oclusal",
  "vestibular",
  "lingual",
] as const satisfies readonly ToothSurface[];

/**
 * Condiciones que se hacen sobre un espacio sin diente: registrar la pieza
 * como ausente NO las cierra (un implante o un puente planificados siguen en
 * pie después de la extracción).
 */
export const REHABILITA_AUSENCIA: readonly ToothCondition[] = ["implante", "puente", "protesis"];

/** Lo mínimo de una marca que hace falta para aplicar las reglas. */
export interface MarcaRegla {
  id: string;
  toothNumber: number;
  surface: ToothSurface;
  condition: ToothCondition;
  status: MarkStatus;
  supersededAt?: string | null;
}

export interface MarcaNueva {
  id?: string;
  toothNumber: number;
  surface: ToothSurface;
  condition: ToothCondition;
  status: MarkStatus;
  conservation?: MarkConservation | null;
}

/** Superficies en las que se puede registrar una condición. */
export function superficiesPermitidas(condition: ToothCondition): readonly ToothSurface[] {
  const def = CONDITION_CATALOG[condition];
  if (def.alcance === "pieza") return ["whole"];
  const caras = def.superficies ?? SUPERFICIES_DE_CARA;
  return def.alcance === "ambos" ? [...caras, "whole"] : caras;
}

/** Solo un tratamiento puede quedar "por realizar". */
export function admitePlanificado(condition: ToothCondition): boolean {
  return CONDITION_CATALOG[condition].categoria === "tratamiento";
}

/** Bueno/malo solo aplica a un tratamiento que ya existe en la boca. */
export function aplicaConservacion(condition: ToothCondition, status: MarkStatus): boolean {
  return status === "existente" && CONDITION_CATALOG[condition].categoria === "tratamiento";
}

/** Condiciones que se ofrecen al tocar una zona, según la zona y el estado elegido. */
export function condicionesDisponibles(
  surface: ToothSurface,
  status: MarkStatus,
): ToothCondition[] {
  return TOOTH_CONDITIONS.filter(
    (c) =>
      c !== "observacion" &&
      superficiesPermitidas(c).includes(surface) &&
      (status === "existente" || admitePlanificado(c)),
  );
}

/** Mensaje de error si la marca no es válida; `null` si lo es. Mismo criterio que la base. */
export function validarMarca(m: MarcaNueva): string | null {
  const def = CONDITION_CATALOG[m.condition];
  if (!superficiesPermitidas(m.condition).includes(m.surface)) {
    if (def.alcance === "pieza") return `${def.label} se registra en la pieza completa.`;
    if (m.surface === "whole")
      return `${def.label} se registra en una superficie, no en la pieza completa.`;
    return `${def.label} no se registra en esa superficie.`;
  }
  if (m.status === "planificado" && !admitePlanificado(m.condition)) {
    return `${def.label} es un hallazgo: no se puede dejar "por realizar".`;
  }
  if (m.conservation && !aplicaConservacion(m.condition, m.status)) {
    return "El buen o mal estado solo aplica a un tratamiento existente.";
  }
  return null;
}

/**
 * ¿La marca vigente `v` está en la misma zona que la nueva `n`?
 * - Nueva en una superficie: solo esa superficie.
 * - Nueva en la pieza completa: lo marcado en la pieza completa y, si la
 *   condición es de pieza, también lo que quedó en una superficie por la
 *   regla anterior (ej. una endodoncia "en mesial" de antes de esta versión).
 */
function mismaZona(v: MarcaRegla, n: MarcaNueva): boolean {
  if (n.surface !== "whole") return v.surface === n.surface;
  return v.surface === "whole" || CONDITION_CATALOG[n.condition].alcance === "pieza";
}

/**
 * Ids de las marcas vigentes que la marca nueva cierra (CLI-01). Antes se
 * cerraba todo lo de la misma (pieza, superficie), y una corona borraba la
 * endodoncia. Ahora:
 *
 * 1. Mismo grupo + misma zona + mismo estado → se reemplaza. Endodoncia y
 *    corona son grupos distintos y conviven; caries y obturación en la misma
 *    cara son el mismo grupo ("superficie") y la obturación reemplaza a la
 *    caries que trató.
 * 2. Una existente cierra la planificada de la misma condición y zona: el
 *    plan se cumplió.
 * 3. "Sano" limpia la zona (la superficie, o toda la pieza si es la pieza
 *    completa). Y cualquier otra marca cierra el "sano" vigente de su
 *    superficie o de la pieza completa.
 * 4. Ausente (existente) cierra todo lo de la pieza: lo que estaba en un
 *    diente que ya no está deja de ser vigente. Salvo implante, puente o
 *    prótesis, que se hacen justamente sobre la ausencia.
 * 5. La observación de la pieza (ODO-08) va aparte: solo la reemplaza otra
 *    observación de la misma pieza, y ella no cierra nada más (migración
 *    20261030100000).
 */
export function marcasQueReemplaza(vigentes: readonly MarcaRegla[], n: MarcaNueva): string[] {
  const grupoNuevo = CONDITION_CATALOG[n.condition].grupo;
  const ids: string[] = [];
  for (const v of vigentes) {
    if (v.supersededAt || v.toothNumber !== n.toothNumber || (n.id && v.id === n.id)) continue;

    const obsNueva = n.condition === "observacion";
    const obsVigente = v.condition === "observacion";
    if (obsNueva || obsVigente) {
      if (obsNueva && obsVigente) ids.push(v.id);
      continue;
    }

    let cierra = false;
    if (n.condition === "sano") {
      cierra = n.surface === "whole" || v.surface === n.surface;
    } else if (v.condition === "sano") {
      cierra = v.surface === n.surface || v.surface === "whole" || n.surface === "whole";
    } else if (n.condition === "ausente" && n.status === "existente") {
      // Un implante existente sí se cierra (el implante se perdió); uno
      // planificado sobrevive: es el plan para esa ausencia.
      cierra =
        !REHABILITA_AUSENCIA.includes(v.condition) ||
        (v.condition === "implante" && v.status === "existente");
    }

    if (!cierra && v.condition !== "sano" && n.condition !== "sano" && mismaZona(v, n)) {
      const mismoGrupo = CONDITION_CATALOG[v.condition].grupo === grupoNuevo;
      if (mismoGrupo && v.status === n.status) cierra = true;
      if (n.status === "existente" && v.status === "planificado" && v.condition === n.condition) {
        cierra = true;
      }
    }

    if (cierra) ids.push(v.id);
  }
  return ids.sort();
}

// ─── Simbología (CLI-02) ─────────────────────────────────────────────────

export type ColorSimbologia = "azul" | "rojo" | "neutro";

/**
 * Convención de la NTS N° 188-MINSA (Perú) y de uso general en LatAm:
 * azul = lo que existe en buen estado; rojo = lo patológico, lo que está en
 * mal estado y lo que hay que hacer. Un tratamiento existente sin estado
 * informado (marcas anteriores a esta versión) se lee como existente: azul.
 */
export function colorDeMarca(m: {
  condition: ToothCondition;
  status: MarkStatus;
  conservation?: MarkConservation | null;
}): ColorSimbologia {
  const { categoria } = CONDITION_CATALOG[m.condition];
  if (categoria === "sano") return "neutro";
  if (m.status === "planificado") return "rojo";
  if (categoria === "patologia") return "rojo";
  if (categoria === "tratamiento" && m.conservation === "malo") return "rojo";
  return "azul";
}

/**
 * Hex explícitos y no tokens del tema: se pintan sobre el diente (marfil en
 * claro y en oscuro), no sobre la tarjeta. Contraste contra el marfil
 * #f4f0e7 y el gris del esquema #e4e1dc: ~5:1 los dos (WCAG 1.4.11 pide 3:1).
 */
export const COLORES_SIMBOLOGIA: Record<ColorSimbologia, string> = {
  azul: "#1f5fbf",
  rojo: "#c62828",
  neutro: "#e4e1dc",
};

/** Lo "por realizar" se pinta en rojo más claro para distinguirlo de lo patológico. */
export const OPACIDAD_PLANIFICADO = 0.45;

export function hexDeMarca(m: Parameters<typeof colorDeMarca>[0]): string {
  return COLORES_SIMBOLOGIA[colorDeMarca(m)];
}

/** Leyenda visible del odontograma. */
export const LEYENDA_SIMBOLOGIA: {
  clave: string;
  color: ColorSimbologia;
  planificado: boolean;
  texto: string;
}[] = [
  { clave: "existente", color: "azul", planificado: false, texto: "Existente en buen estado" },
  { clave: "patologico", color: "rojo", planificado: false, texto: "Patológico o en mal estado" },
  { clave: "planificado", color: "rojo", planificado: true, texto: "Por realizar" },
];

/**
 * Qué marca pinta cada zona del dibujo cuando hay varias. Lo existente manda
 * sobre lo planificado (el plan se ve en la lista y en las siglas), y dentro
 * de lo existente gana lo rojo: el ojo tiene que ir a lo que hay que tratar.
 */
export function marcaParaPintar<
  M extends {
    condition: ToothCondition;
    status: MarkStatus;
    conservation?: MarkConservation | null;
  },
>(marcas: readonly M[]): M | undefined {
  const candidatas = marcas.filter((m) => m.condition !== "sano");
  const peso = (m: M) => (m.status === "existente" ? 2 : 0) + (colorDeMarca(m) === "rojo" ? 1 : 0);
  return [...candidatas].sort((a, b) => peso(b) - peso(a))[0];
}

// ─── Dentición (CLI-04) ──────────────────────────────────────────────────

export type Denticion = "permanente" | "mixta" | "temporal";

/**
 * Vista por defecto según la edad: hasta los 5 años temporal, de 6 a 12
 * mixta (las dos denticiones a la vez, 52 piezas), desde los 13 permanente.
 * Sin edad conocida, permanente.
 */
export function denticionPorEdad(edad: number | null | undefined): Denticion {
  if (edad === null || edad === undefined || !Number.isFinite(edad) || edad < 0)
    return "permanente";
  if (edad < 6) return "temporal";
  if (edad <= 12) return "mixta";
  return "permanente";
}
