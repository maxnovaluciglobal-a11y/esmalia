import { hasPermission, type ClinicAccess } from "@/lib/access/access";
import { coincideTermino } from "@/lib/search";

/**
 * Piezas puras del shell de la app (rediseño A+, PR 4 del plan del
 * 19-oct-2026): sidebar en tinta, acciones del buscador ⌘K y la pastilla de
 * conexión. Viven acá y no en los componentes para poder probarlas sin
 * navegador.
 */

/** Clases de un ítem del nav lateral de escritorio (Ajustes y Ayuda incluidos).
 *  Densidad tranquila: alto de fila fijo (`--row-h`) y, en el activo, un
 *  filete ocre a la izquierda en vez de un borde completo. */
export function claseItemNav(activo: boolean): string {
  const base =
    "relative flex min-h-(--row-h) w-full items-center gap-3 rounded-md px-3 text-left text-[15px] transition-colors";
  return activo
    ? `${base} bg-night-3 text-on-night before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-on-night`
    : `${base} text-on-night-2 hover:bg-night-2 hover:text-on-night`;
}

/** Atributos del ítem del nav: `aria-current="page"` solo en el activo. */
export function propsItemNav(activo: boolean): {
  "aria-current": "page" | undefined;
  className: string;
} {
  return {
    "aria-current": activo ? "page" : undefined,
    className: claseItemNav(activo),
  };
}

export type EstadoConexion = {
  online: boolean;
  /** Operaciones guardadas en este equipo esperando subir. */
  pendientes: number;
};

/** "En línea" / "Sin conexión · 2 pendientes". */
export function textoConexion({ online, pendientes }: EstadoConexion): string {
  const base = online ? "En línea" : "Sin conexión";
  if (pendientes <= 0) return base;
  return `${base} · ${pendientes} ${pendientes === 1 ? "pendiente" : "pendientes"}`;
}

export type AccionRapida = {
  id: "nueva-cita" | "abrir-caja" | "registrar-pago" | "crear-paciente";
  label: string;
  detalle: string;
  to: string;
  /** Parámetro de búsqueda que lleva el pedido (`nueva`, `abrir`). null = la
   *  acción solo lleva a la pantalla donde se hace (no abre un diálogo). */
  parametro: string | null;
  /** Destino con el pedido en la URL: la ruta lo lee, abre su diálogo y lo
   *  borra (ver `interpretarNuevaCita` y `decidirAbrirCaja`). */
  href: string;
  /** Palabras con las que alguien busca la acción ("cobrar" → Registrar pago). */
  sinonimos: readonly string[];
};

/** Valor del parámetro que pide abrir un diálogo sin nada precargado. */
export const PEDIDO_ABRIR = "1";

const ACCIONES: (AccionRapida & { permiso: Parameters<typeof hasPermission>[1] })[] = [
  {
    id: "nueva-cita",
    label: "Nueva cita",
    detalle: "En la agenda",
    to: "/agenda",
    parametro: "nueva",
    href: `/agenda?nueva=${PEDIDO_ABRIR}`,
    sinonimos: ["agendar", "cita", "turno", "reservar hora"],
    permiso: "agenda:manage",
  },
  {
    id: "abrir-caja",
    label: "Abrir caja",
    detalle: "Caja del día",
    to: "/cajas",
    parametro: "abrir",
    href: `/cajas?abrir=${PEDIDO_ABRIR}`,
    sinonimos: ["caja", "turno de caja", "arqueo"],
    permiso: "cash:manage",
  },
  {
    // El cobro se registra desde la ficha (o desde la cita en la agenda):
    // esto lleva a la caja del día, donde se ve qué falta cobrar.
    id: "registrar-pago",
    label: "Registrar pago",
    detalle: "Caja del día",
    to: "/cajas",
    parametro: null,
    href: "/cajas",
    sinonimos: ["cobrar", "cobro", "pago", "pagar", "abono"],
    permiso: "cash:manage",
  },
  {
    id: "crear-paciente",
    label: "Crear paciente",
    detalle: "En Pacientes",
    to: "/pacientes",
    parametro: null,
    href: "/pacientes",
    sinonimos: ["paciente nuevo", "nuevo paciente", "agregar paciente", "alta de paciente"],
    permiso: "patients:manage",
  },
];

/**
 * Grupo "Acciones" del buscador. Solo las que el rol puede hacer: la ruta
 * destino tiene su propio `requirePermission`, esto solo evita ofrecer algo
 * que después rebota. Lo escrito se busca en el nombre y en los sinónimos,
 * desde el comienzo de una palabra (`coincideTermino`).
 */
export function accionesRapidas(role: ClinicAccess["role"], termino = ""): AccionRapida[] {
  return ACCIONES.filter((a) => hasPermission(role, a.permiso))
    .filter((a) => coincideTermino(termino, a.label, ...a.sinonimos))
    .map(({ permiso: _permiso, ...a }) => a);
}

/**
 * Destino de una acción rápida. Si ya se está en la ruta de la acción, se
 * conserva la búsqueda actual (vista, fecha, filtros de la agenda) y solo se
 * agrega el pedido; si no, se va al `href` limpio de la acción.
 */
export function hrefDeAccion(
  accion: Pick<AccionRapida, "to" | "href" | "parametro">,
  actual: { pathname: string; searchStr: string },
): string {
  const ruta = actual.pathname.replace(/\/+$/, "") || "/";
  if (!accion.parametro) return ruta === accion.to ? `${ruta}${actual.searchStr}` : accion.href;
  if (ruta !== accion.to) return accion.href;
  // Se arma a mano y no con `URLSearchParams` para no recodificar los
  // valores que el router ya serializó (lo que vuelve se lee igual).
  const parametro = accion.parametro;
  const pares = actual.searchStr
    .replace(/^\?/, "")
    .split("&")
    .filter((par) => par && !par.startsWith(`${parametro}=`));
  pares.push(`${parametro}=${PEDIDO_ABRIR}`);
  return `${accion.to}?${pares.join("&")}`;
}

/** Una entrada de "Ir a" del buscador. */
export type PaginaBuscable = { to: string; label: string; sinonimos?: readonly string[] };

/**
 * Páginas que coinciden con lo escrito: por nombre o sinónimo, desde el
 * comienzo de una palabra. Sin término, las primeras `tope`.
 */
export function paginasQueCoinciden(
  paginas: readonly PaginaBuscable[],
  termino: string,
  tope = 8,
): PaginaBuscable[] {
  if (!termino.trim()) return paginas.slice(0, tope);
  return paginas.filter((p) => coincideTermino(termino, p.label, ...(p.sinonimos ?? [])));
}

/**
 * `/agenda?nueva=…`: con `1` abre "Nueva cita" vacía (acción del ⌘K); con
 * cualquier otro valor lo toma como id de paciente (botón "Agendar" de la
 * ficha). Un id de paciente es un uuid, así que nunca choca con `1`.
 */
export function interpretarNuevaCita(nueva: string | undefined): {
  abrir: boolean;
  pacienteId: string | null;
} {
  const v = (nueva ?? "").trim();
  if (!v) return { abrir: false, pacienteId: null };
  if (v === PEDIDO_ABRIR) return { abrir: true, pacienteId: null };
  return { abrir: true, pacienteId: v };
}

/**
 * `nueva` de `/agenda` tal como llega de `validateSearch`. El parser de
 * búsqueda de TanStack lee `?nueva=1` como el NÚMERO 1 (parsea JSON), así
 * que se acepta número o texto; cualquier otra cosa se descarta.
 */
export function leerNuevaCita(valor: unknown): string | undefined {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== "string") return undefined;
  const v = valor.trim();
  return v || undefined;
}

/** `abrir` de `/cajas`: solo `1` (número o texto) cuenta como pedido. */
export function leerPedidoAbrirCaja(valor: unknown): typeof PEDIDO_ABRIR | undefined {
  if (typeof valor !== "string" && typeof valor !== "number") return undefined;
  return String(valor).trim() === PEDIDO_ABRIR ? PEDIDO_ABRIR : undefined;
}

export type DecisionAbrirCaja = "nada" | "esperar" | "abrir" | "ya-abierta" | "descartar";

/**
 * Qué hace `/cajas` con `?abrir=1`. Espera a saber si ya hay un turno
 * abierto; si lo hay, no abre un segundo diálogo (el servidor igual lo
 * rechazaría) y avisa. Con error de carga solo descarta el pedido. En todos
 * los casos menos "nada" y "esperar" la ruta borra el parámetro.
 */
export function decidirAbrirCaja(estado: {
  pedido: boolean;
  cargando: boolean;
  conError: boolean;
  cajaAbierta: boolean;
}): DecisionAbrirCaja {
  if (!estado.pedido) return "nada";
  if (estado.cargando) return "esperar";
  if (estado.conError) return "descartar";
  return estado.cajaAbierta ? "ya-abierta" : "abrir";
}
