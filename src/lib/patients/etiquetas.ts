/**
 * Etiquetas de pacientes (PAC-07): paleta cerrada y validación, sin
 * Supabase. El color se guarda como nombre (`patient_labels.color`, con su
 * CHECK en la base) y la app lo traduce a tokens del sistema visual: nunca
 * un hex libre, así la etiqueta se lee bien en claro y en oscuro.
 */

export const COLORES_ETIQUETA = [
  "ocre",
  "azul",
  "verde",
  "ambar",
  "rojo",
  "violeta",
  "gris",
] as const;
export type ColorEtiqueta = (typeof COLORES_ETIQUETA)[number];

export const NOMBRE_COLOR_ETIQUETA: Record<ColorEtiqueta, string> = {
  ocre: "Ocre",
  azul: "Azul",
  verde: "Verde",
  ambar: "Ámbar",
  rojo: "Rojo",
  violeta: "Violeta",
  gris: "Gris",
};

/** Clases (solo tokens) de la pastilla de cada color. */
export const CLASES_COLOR_ETIQUETA: Record<ColorEtiqueta, string> = {
  ocre: "border-brand-300 bg-brand-soft text-brand-700",
  azul: "border-info-border bg-info-soft text-info",
  verde: "border-success-border bg-success-soft text-success",
  ambar: "border-warning-border bg-warning-soft text-warning",
  rojo: "border-destructive-border bg-destructive-soft text-destructive",
  violeta: "border-ai-border bg-ai-soft text-ai",
  gris: "border-neutral-border bg-neutral-soft text-neutral",
};

/** Punto de color (selector de color, leyenda). */
export const CLASES_PUNTO_ETIQUETA: Record<ColorEtiqueta, string> = {
  ocre: "bg-brand-600",
  azul: "bg-info",
  verde: "bg-success",
  ambar: "bg-warning",
  rojo: "bg-destructive",
  violeta: "bg-ai",
  gris: "bg-neutral",
};

export function esColorEtiqueta(v: unknown): v is ColorEtiqueta {
  return typeof v === "string" && (COLORES_ETIQUETA as readonly string[]).includes(v);
}

/** Un color guardado desconocido (dato viejo) se muestra en gris. */
export function colorEtiqueta(v: unknown): ColorEtiqueta {
  return esColorEtiqueta(v) ? v : "gris";
}

export const LARGO_MAXIMO_ETIQUETA = 40;

/** Nombre limpio: sin espacios de más. */
export function limpiarNombreEtiqueta(nombre: string): string {
  return nombre.replace(/\s+/g, " ").trim();
}

/** Error del nombre, o null si sirve. `existentes` = nombres del catálogo (sin la propia). */
export function errorDeNombreEtiqueta(
  nombre: string,
  existentes: readonly string[] = [],
): string | null {
  const limpio = limpiarNombreEtiqueta(nombre);
  if (!limpio) return "Escribe el nombre de la etiqueta.";
  if (limpio.length > LARGO_MAXIMO_ETIQUETA)
    return `Usa hasta ${LARGO_MAXIMO_ETIQUETA} caracteres.`;
  const clave = limpio.toLocaleLowerCase("es");
  if (existentes.some((e) => limpiarNombreEtiqueta(e).toLocaleLowerCase("es") === clave))
    return "Ya existe una etiqueta con ese nombre.";
  return null;
}

export interface Etiqueta {
  id: string;
  nombre: string;
  color: ColorEtiqueta;
}

/** Ordena el catálogo por nombre (español, sin distinguir tildes). */
export function ordenarEtiquetas<T extends Pick<Etiqueta, "nombre">>(etiquetas: readonly T[]): T[] {
  return [...etiquetas].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
  );
}

/**
 * Qué cambia al aplicar etiquetas a varias fichas: `estado` por etiqueta es
 * "todas" (ya la tienen todas), "algunas" o "ninguna". Sirve para el diálogo
 * de etiquetar (casilla marcada, indeterminada o vacía).
 */
export function estadoDeEtiquetas(
  idsEtiquetas: readonly string[],
  asignadas: readonly (readonly string[])[],
): Record<string, "todas" | "algunas" | "ninguna"> {
  const salida: Record<string, "todas" | "algunas" | "ninguna"> = {};
  for (const id of idsEtiquetas) {
    const con = asignadas.filter((a) => a.includes(id)).length;
    salida[id] =
      asignadas.length > 0 && con === asignadas.length ? "todas" : con > 0 ? "algunas" : "ninguna";
  }
  return salida;
}
