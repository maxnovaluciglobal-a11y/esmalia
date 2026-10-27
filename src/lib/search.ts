import { EVENTO_ABRIR_ATAJOS } from "@/lib/atajos";

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

/** Sin mayúsculas ni tildes, para comparar lo escrito con etiquetas. */
export function normalizarTexto(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Lo escrito coincide con alguno de los textos? Solo desde el comienzo de
 * una palabra: "isi" no trae "Comisiones" (sí "Isidora") y "caja" trae
 * "Abrir caja". Sin término, todo coincide.
 */
export function coincideTermino(termino: string, ...textos: readonly string[]): boolean {
  const t = normalizarTexto(termino);
  if (!t) return true;
  return textos.some((texto) => ` ${normalizarTexto(texto)}`.includes(` ${t}`));
}

// ── NAV-04: sinónimos del buscador ⌘K ──────────────────────────────────────

/**
 * Cómo se dice lo mismo en recepción: a la izquierda, el texto con que se
 * llama la acción o la pantalla en la app; a la derecha, las palabras con
 * que alguien la busca ("abono" → Registrar pago, "hora" → Nueva cita).
 * Complementa los sinónimos propios de cada acción y página (`shell.ts`,
 * `navegacion.ts`): esto agrega los coloquiales de Chile y LatAm.
 */
export const SINONIMOS_DEL_BUSCADOR: Readonly<Record<string, readonly string[]>> = {
  "Registrar pago": ["cobrar", "cobro", "pagar", "pago", "abono", "abonar", "cancelar cuenta"],
  "Nueva cita": ["turno", "hora", "pedir hora", "dar hora", "agendar", "reservar", "sobrecupo"],
  "Crear paciente": ["alta", "ficha nueva", "registrar paciente", "inscribir"],
  "Abrir caja": ["apertura", "abrir el turno"],
  Caja: ["arqueo", "cierre de caja", "cuadrar"],
  Presupuestos: ["cotizar", "cotización", "presupuestar"],
  Ajustes: ["configuración", "configurar", "preferencias", "opciones"],
  Equipo: ["usuarios", "personal", "colaboradores", "doctores"],
  Pacientes: ["fichas", "clientes", "cartera"],
  Agenda: ["calendario", "citas", "horario"],
  Morosidad: ["deudores", "deuda", "saldo pendiente"],
  Etiquetas: ["etiquetar", "marcar", "categoría", "categorías"],
  Segmentos: ["segmento", "grupo de pacientes", "lista de pacientes", "audiencia"],
};

/**
 * Lo escrito y los textos canónicos que significa: "abono" →
 * ["abono", "Registrar pago"]. El buscador busca con cada uno y junta los
 * resultados. Sin término, solo el término (vacío).
 */
export function expandirConSinonimos(
  termino: string,
  sinonimos: Readonly<Record<string, readonly string[]>> = SINONIMOS_DEL_BUSCADOR,
): string[] {
  const t = termino.trim();
  if (!normalizarTexto(t)) return [t];
  const salida = [t];
  for (const [canonico, palabras] of Object.entries(sinonimos)) {
    if (palabras.some((p) => coincideTermino(t, p)) && !salida.includes(canonico))
      salida.push(canonico);
  }
  return salida;
}

/** Une listas sin repetir (por la clave dada), en el orden de llegada. */
export function unirSinRepetir<T>(listas: readonly (readonly T[])[], clave: (x: T) => string): T[] {
  const vistos = new Set<string>();
  const salida: T[] = [];
  for (const lista of listas)
    for (const x of lista) {
      const k = clave(x);
      if (vistos.has(k)) continue;
      vistos.add(k);
      salida.push(x);
    }
  return salida;
}

/**
 * Atajos de pantalla del ⌘K: llevan a una vista ya filtrada o abren algo
 * dentro de una pantalla ("Pacientes con saldo", "Ver atajos de teclado").
 * `permiso` es el de la pantalla destino (el filtro de dinero, `finance:view`).
 * `evento` = no navega: dispara ese evento de ventana.
 */
export interface AtajoDePantalla {
  id: string;
  label: string;
  detalle: string;
  href?: string;
  evento?: string;
  permiso: string | null;
  sinonimos: readonly string[];
}

export const ATAJOS_DE_PANTALLA: readonly AtajoDePantalla[] = [
  {
    id: "pacientes-con-saldo",
    label: "Pacientes con saldo",
    detalle: "Pacientes",
    href: "/pacientes?conSaldo=1",
    permiso: "finance:view",
    sinonimos: ["deben", "deudores", "saldo", "cobranza", "por cobrar"],
  },
  {
    id: "pacientes-sin-cita",
    label: "Pacientes sin próxima cita",
    detalle: "Pacientes",
    href: "/pacientes?sinCita=1",
    permiso: "patients:view",
    sinonimos: ["sin cita", "sin hora", "recall", "volver a citar", "sin turno"],
  },
  {
    id: "pacientes-sin-visita",
    label: "Pacientes sin visita hace 6 meses",
    detalle: "Pacientes",
    href: "/pacientes?sinVisitaMeses=6",
    permiso: "patients:view",
    sinonimos: ["no vienen", "inactivos", "recall", "control", "abandono"],
  },
  {
    id: "pacientes-cumpleanos",
    label: "Cumpleaños del mes",
    detalle: "Pacientes",
    href: "/pacientes?cumpleMes=1",
    permiso: "patients:view",
    sinonimos: ["cumpleaños", "cumple", "saludo"],
  },
  {
    id: "pacientes-incompletos",
    label: "Fichas incompletas",
    detalle: "Pacientes",
    href: "/pacientes?incompletas=1",
    permiso: "patients:view",
    sinonimos: ["faltan datos", "completar ficha", "decreto 41"],
  },
  {
    id: "pacientes-menores",
    label: "Pacientes menores de edad",
    detalle: "Pacientes",
    href: "/pacientes?menores=1",
    permiso: "patients:view",
    sinonimos: ["menores", "niños", "niñas", "tutor", "odontopediatría"],
  },
  {
    id: "gestionar-etiquetas",
    label: "Etiquetas de pacientes",
    detalle: "Crear, renombrar o borrar",
    href: "/pacientes?etiquetas=1",
    permiso: "patients:manage",
    sinonimos: ["etiquetas", "etiquetar", "categorías"],
  },
  {
    id: "segmentos",
    label: "Segmentos de pacientes",
    detalle: "Filtros guardados",
    href: "/pacientes?segmentos=1",
    permiso: "patients:view",
    sinonimos: ["segmentos", "grupos", "audiencias", "listas"],
  },
  {
    id: "ver-atajos",
    label: "Ver atajos de teclado",
    detalle: "Tecla ?",
    evento: EVENTO_ABRIR_ATAJOS,
    permiso: null,
    sinonimos: ["atajos", "teclado", "teclas", "ayuda"],
  },
];

/**
 * Atajos de pantalla que coinciden con alguno de los términos (ya
 * expandidos con sinónimos) y que el rol puede abrir. Sin término no se
 * muestran (el buscador vacío no se llena de atajos).
 */
export function atajosQueCoinciden(
  terminos: readonly string[],
  puede: (permiso: string) => boolean,
  atajos: readonly AtajoDePantalla[] = ATAJOS_DE_PANTALLA,
): AtajoDePantalla[] {
  const reales = terminos.filter((t) => normalizarTexto(t));
  if (reales.length === 0) return [];
  return atajos.filter(
    (a) =>
      (a.permiso === null || puede(a.permiso)) &&
      reales.some((t) => coincideTermino(t, a.label, ...a.sinonimos)),
  );
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
