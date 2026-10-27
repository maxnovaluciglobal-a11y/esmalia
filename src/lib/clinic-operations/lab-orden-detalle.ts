/**
 * Detalle técnico de una orden de laboratorio (Ola 9 · LAB-03 a LAB-07):
 * color VITA, material, margen, plazo y catálogo. Puro, sin base: lo usan la
 * pantalla de Laboratorios, el portal del laboratorio, el servidor (para
 * validar) y los tests.
 *
 * Los valores (claves) son los mismos que aceptan los CHECK de la migración
 * 20261030300000_laboratorio_detalle_y_catalogo.sql.
 */
import { sumarDias } from "@/lib/finance/periodos-reporte";

// ─── Color (LAB-03) ───────────────────────────────────────────────────────

export const GUIAS_COLOR = ["vita_classical", "vita_3d_master"] as const;
export type GuiaColor = (typeof GUIAS_COLOR)[number];

export const GUIA_COLOR_LABELS: Record<GuiaColor, string> = {
  vita_classical: "VITA classical",
  vita_3d_master: "VITA 3D-Master",
};

/** Guía VITA classical A1-D4: 16 colores, agrupados por tono (A, B, C, D). */
const VITA_CLASSICAL = [
  "A1",
  "A2",
  "A3",
  "A3.5",
  "A4",
  "B1",
  "B2",
  "B3",
  "B4",
  "C1",
  "C2",
  "C3",
  "C4",
  "D2",
  "D3",
  "D4",
] as const;

/**
 * Guía VITA Toothguide 3D-Master: 29 colores (6 grupos de luminosidad, 0 a
 * 5; tono L/M/R; croma). El grupo 0 son los colores de dientes blanqueados.
 */
const VITA_3D_MASTER = [
  "0M1",
  "0M2",
  "0M3",
  "1M1",
  "1M2",
  "2L1.5",
  "2L2.5",
  "2M1",
  "2M2",
  "2M3",
  "2R1.5",
  "2R2.5",
  "3L1.5",
  "3L2.5",
  "3M1",
  "3M2",
  "3M3",
  "3R1.5",
  "3R2.5",
  "4L1.5",
  "4L2.5",
  "4M1",
  "4M2",
  "4M3",
  "4R1.5",
  "4R2.5",
  "5M1",
  "5M2",
  "5M3",
] as const;

export const COLORES_POR_GUIA: Record<GuiaColor, readonly string[]> = {
  vita_classical: VITA_CLASSICAL,
  vita_3d_master: VITA_3D_MASTER,
};

/** El color tiene que existir en la guía elegida; sin guía no hay color. */
export function colorValido(guia: GuiaColor | null, color: string | null): boolean {
  if (!color) return true;
  if (!guia) return false;
  return COLORES_POR_GUIA[guia].includes(color);
}

// ─── Material (LAB-04) ────────────────────────────────────────────────────

export const MATERIALES = [
  "zirconia",
  "disilicato_litio",
  "metal_porcelana",
  "ceramica_feldespatica",
  "metal_colado",
  "cromo_cobalto",
  "titanio",
  "pmma",
  "resina",
  "acrilico",
  "otro",
] as const;
export type Material = (typeof MATERIALES)[number];

export const MATERIAL_LABELS: Record<Material, string> = {
  zirconia: "Zirconia",
  disilicato_litio: "Disilicato de litio",
  metal_porcelana: "Metal-porcelana",
  ceramica_feldespatica: "Cerámica feldespática",
  metal_colado: "Metal colado",
  cromo_cobalto: "Cromo-cobalto",
  titanio: "Titanio",
  pmma: "PMMA (provisorio)",
  resina: "Resina",
  acrilico: "Acrílico",
  otro: "Otro (ver notas)",
};

// ─── Margen (LAB-05) ──────────────────────────────────────────────────────

export const MARGENES = [
  "chaflan",
  "chaflan_profundo",
  "hombro",
  "hombro_biselado",
  "filo_de_cuchillo",
] as const;
export type Margen = (typeof MARGENES)[number];

export const MARGEN_LABELS: Record<Margen, string> = {
  chaflan: "Chaflán",
  chaflan_profundo: "Chaflán profundo",
  hombro: "Hombro recto",
  hombro_biselado: "Hombro biselado",
  filo_de_cuchillo: "Filo de cuchillo",
};

// ─── Plazo (LAB-06) ───────────────────────────────────────────────────────

/**
 * Fecha comprometida que propone el catálogo: envío + días típicos del
 * laboratorio, en días de calendario. Sin plazo típico no se inventa uno.
 */
export function fechaComprometidaSugerida(
  enviadoEl: string,
  diasTipicos: number | null,
): string | null {
  if (diasTipicos === null || !/^\d{4}-\d{2}-\d{2}$/.test(enviadoEl)) return null;
  return sumarDias(enviadoEl, diasTipicos);
}

/**
 * "Hoy" (YYYY-MM-DD) en la zona de la clínica para un instante dado. Es lo
 * que hace `hoyISO(timezone)`, pero con el reloj inyectable para probar el
 * borde: a las 22:00 en Santiago ya es mañana en UTC.
 */
export function hoyEnZona(timezone: string | null | undefined, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

// ─── Resumen para la fila y el portal ─────────────────────────────────────

export interface DetalleTecnico {
  shadeGuide: GuiaColor | null;
  shade: string | null;
  material: Material | null;
  marginType: Margen | null;
}

/** Chips de la fila: "A2 · VITA classical", "Zirconia", "Chaflán". */
export function chipsDetalle(d: DetalleTecnico): string[] {
  const chips: string[] = [];
  if (d.shade && d.shadeGuide) chips.push(`${d.shade} · ${GUIA_COLOR_LABELS[d.shadeGuide]}`);
  if (d.material) chips.push(MATERIAL_LABELS[d.material]);
  if (d.marginType) chips.push(`Margen ${MARGEN_LABELS[d.marginType].toLowerCase()}`);
  return chips;
}

/** Normaliza lo que llega de la base (texto libre) a los tipos de arriba. */
export function detalleDesdeFila(r: {
  shade_guide: string | null;
  shade: string | null;
  material: string | null;
  margin_type: string | null;
}): DetalleTecnico {
  const guia = (GUIAS_COLOR as readonly string[]).includes(r.shade_guide ?? "")
    ? (r.shade_guide as GuiaColor)
    : null;
  return {
    shadeGuide: guia,
    shade: guia ? r.shade : null,
    material: (MATERIALES as readonly string[]).includes(r.material ?? "")
      ? (r.material as Material)
      : null,
    marginType: (MARGENES as readonly string[]).includes(r.margin_type ?? "")
      ? (r.margin_type as Margen)
      : null,
  };
}

/** Igual que `detalleDesdeFila`, desde una orden ya mapeada (camelCase). */
export function detalleDeOrden(o: {
  shadeGuide?: string | null;
  shade?: string | null;
  material?: string | null;
  marginType?: string | null;
}): DetalleTecnico {
  return detalleDesdeFila({
    shade_guide: o.shadeGuide ?? null,
    shade: o.shade ?? null,
    material: o.material ?? null,
    margin_type: o.marginType ?? null,
  });
}

// ─── Catálogo (LAB-07) ────────────────────────────────────────────────────

export interface ItemCatalogoLab {
  id: string;
  labId: string;
  name: string;
  /** `null` = sin precio cargado, o quien mira no tiene `finance:view`. */
  costCents: number | null;
  currency: string;
  typicalDays: number | null;
  material: Material | null;
  notes: string | null;
  isActive: boolean;
}

/** Lo que el ítem del catálogo precarga en la orden nueva. */
export function precargaDesdeCatalogo(
  item: Pick<ItemCatalogoLab, "name" | "costCents" | "typicalDays" | "material">,
  enviadoEl: string,
): {
  descripcion: string;
  costoCents: number | null;
  material: Material | null;
  comprometido: string | null;
} {
  return {
    descripcion: item.name,
    costoCents: item.costCents,
    material: item.material,
    comprometido: fechaComprometidaSugerida(enviadoEl, item.typicalDays),
  };
}
