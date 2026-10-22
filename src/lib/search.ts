export const PER_PAGE = 5;

export function normaliza(valor: string) {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.\-\s]/g, "");
}

export function coincide(termino: string, ...campos: (string | null | undefined)[]) {
  const t = normaliza(termino);
  if (!t) return true;
  return campos.some((c) => (c ? normaliza(c).includes(t) : false));
}

export interface Pagina<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
  desde: number;
  hasta: number;
}

export function paginar<T>(items: T[], page: number, perPage = PER_PAGE): Pagina<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const actual = Math.min(Math.max(1, page), totalPages);
  const inicio = (actual - 1) * perPage;
  return {
    items: items.slice(inicio, inicio + perPage),
    page: actual,
    totalPages,
    total,
    desde: total === 0 ? 0 : inicio + 1,
    hasta: Math.min(inicio + perPage, total),
  };
}

/**
 * Números de página a mostrar: todos si son pocos; si no, la primera, la
 * última y las vecinas de la actual, con "…" en los saltos. Con 40 páginas
 * no se pintan 40 botones.
 */
export function paginasVisibles(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const set = new Set([1, totalPages, page - 1, page, page + 1]);
  const nums = [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const salida: (number | "…")[] = [];
  for (const [i, n] of nums.entries()) {
    if (i > 0 && n - nums[i - 1] > 1) salida.push("…");
    salida.push(n);
  }
  return salida;
}

export type GrupoResultado = "Pacientes" | "Citas" | "Tratamientos";

export interface ResultadoGlobal {
  id: string;
  grupo: GrupoResultado;
  titulo: string;
  detalle: string;
  pacienteId: string;
  destino: "pacientes" | "agenda" | "tratamientos";
}

// `busquedaGlobal` se sacó de acá (auditoría architecture-3, 2026-08-21):
// leía de los arrays MOCK de `clinic-data.ts` en vez de datos reales.
// `GlobalSearch` (src/components/global-search.tsx) quedó deshabilitado
// hasta que haya una fuente de datos real que reemplace esta función.

/** Helpers de validación de search params (sin dependencias externas). */
export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function num(v: unknown, fallback = 1): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
