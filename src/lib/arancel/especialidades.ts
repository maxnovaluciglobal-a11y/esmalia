/**
 * Especialidades del arancel (ADM-02, Ola 3).
 *
 * La lista estándar que siembra Esmalia en cada clínica. La fuente de verdad
 * de la siembra es la base (`sembrar_especialidades` en la migración
 * 20261024100000); esta copia sirve para el catálogo semilla y la interfaz,
 * y `tests/arancel-catalogo.test.ts` exige que coincidan.
 */

export const SLUGS_ESPECIALIDAD = [
  "general",
  "operatoria",
  "endodoncia",
  "periodoncia",
  "ortodoncia",
  "implantologia",
  "odontopediatria",
  "rehabilitacion",
  "cirugia",
  "estetica",
  "radiologia",
  "otra",
] as const;

export type SlugEspecialidad = (typeof SLUGS_ESPECIALIDAD)[number];

/** Nombre con que se siembra cada especialidad (la clínica puede cambiarlo). */
export const NOMBRE_ESPECIALIDAD: Record<SlugEspecialidad, string> = {
  general: "Odontología general",
  operatoria: "Operatoria",
  endodoncia: "Endodoncia",
  periodoncia: "Periodoncia",
  ortodoncia: "Ortodoncia",
  implantologia: "Implantología",
  odontopediatria: "Odontopediatría",
  rehabilitacion: "Rehabilitación oral",
  cirugia: "Cirugía",
  estetica: "Estética",
  radiologia: "Radiología",
  otra: "Otra",
};

export function esSlugEspecialidad(v: unknown): v is SlugEspecialidad {
  return typeof v === "string" && (SLUGS_ESPECIALIDAD as readonly string[]).includes(v);
}

/** Especialidad tal como la usa el arancel. */
export interface Especialidad {
  id: string;
  name: string;
  slug: SlugEspecialidad | null;
  isActive: boolean;
  position: number;
  defaultDurationMin: number;
}

/** Etiqueta del grupo de las prestaciones sin especialidad. */
export const SIN_ESPECIALIDAD = "Sin especialidad";

/**
 * Agrupa prestaciones por especialidad, en el orden de la lista de la
 * clínica (posición y nombre), con "Sin especialidad" al final. Una
 * prestación que apunta a una especialidad que ya no está en la lista cae en
 * "Sin especialidad" en vez de perderse.
 */
export function agruparPorEspecialidad<T extends { specialtyId?: string | null }>(
  prestaciones: T[],
  especialidades: Especialidad[],
): { especialidad: Especialidad | null; titulo: string; items: T[] }[] {
  const orden = [...especialidades].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"),
  );
  const porId = new Map<string, T[]>();
  const sin: T[] = [];
  const ids = new Set(orden.map((e) => e.id));
  for (const p of prestaciones) {
    const id = p.specialtyId ?? null;
    if (id && ids.has(id)) porId.set(id, [...(porId.get(id) ?? []), p]);
    else sin.push(p);
  }
  const grupos: { especialidad: Especialidad | null; titulo: string; items: T[] }[] = orden
    .filter((e) => porId.has(e.id))
    .map((e) => ({ especialidad: e, titulo: e.name, items: porId.get(e.id)! }));
  if (sin.length) grupos.push({ especialidad: null, titulo: SIN_ESPECIALIDAD, items: sin });
  return grupos;
}
