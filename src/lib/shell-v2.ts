import { hasPermission, type ClinicAccess } from "@/lib/access/access";

/**
 * Piezas puras del shell A+ (flag `shell-v2`, PR 4 del plan del 19-oct-2026):
 * sidebar en tinta, acciones del buscador ⌘K y la pastilla de conexión.
 * Viven acá y no en los componentes para poder probarlas sin navegador.
 */

/** Clases de un ítem del nav lateral de escritorio (Ajustes y Ayuda incluidos). */
export function claseItemNav(activo: boolean, shellV2: boolean): string {
  if (!shellV2) {
    // Tal cual estaba antes del flag: no tocar sin revisar el shell viejo.
    return activo
      ? "flex items-center gap-3 rounded-md border px-3 py-2 text-[15px] transition-colors border-brand/50 text-brand-800"
      : "flex items-center gap-3 rounded-md border px-3 py-2 text-[15px] transition-colors border-transparent text-foreground/80 hover:bg-sidebar-accent hover:text-foreground";
  }
  // Densidad tranquila: alto de fila fijo (`--row-h`) y, en el activo, un
  // filete ocre a la izquierda en vez de un borde completo.
  const base =
    "relative flex min-h-(--row-h) w-full items-center gap-3 rounded-md px-3 text-left text-[15px] transition-colors";
  return activo
    ? `${base} bg-night-3 text-on-night before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-on-night`
    : `${base} text-on-night-2 hover:bg-night-2 hover:text-on-night`;
}

/** Atributos del ítem del nav: `aria-current="page"` solo en el activo. */
export function propsItemNav(
  activo: boolean,
  shellV2: boolean,
): { "aria-current": "page" | undefined; className: string } {
  return {
    "aria-current": activo ? "page" : undefined,
    className: claseItemNav(activo, shellV2),
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
  id: "nueva-cita" | "abrir-caja";
  label: string;
  detalle: string;
  to: string;
  /** Destino con el pedido en la URL: la ruta lo lee, abre su diálogo y lo
   *  borra (ver `interpretarNuevaCita` y `decidirAbrirCaja`). */
  href: string;
};

/** Valor del parámetro que pide abrir un diálogo sin nada precargado. */
export const PEDIDO_ABRIR = "1";

const ACCIONES: (AccionRapida & { permiso: Parameters<typeof hasPermission>[1] })[] = [
  {
    id: "nueva-cita",
    label: "Nueva cita",
    detalle: "En la agenda",
    to: "/agenda",
    href: `/agenda?nueva=${PEDIDO_ABRIR}`,
    permiso: "agenda:manage",
  },
  {
    id: "abrir-caja",
    label: "Abrir caja",
    detalle: "Caja del día",
    to: "/cajas",
    href: `/cajas?abrir=${PEDIDO_ABRIR}`,
    permiso: "cash:manage",
  },
];

/**
 * Grupo "Acciones" del buscador. Solo las que el rol puede hacer: la ruta
 * destino tiene su propio `requirePermission`, esto solo evita ofrecer algo
 * que después rebota.
 */
export function accionesRapidas(role: ClinicAccess["role"], termino = ""): AccionRapida[] {
  const t = termino.trim().toLowerCase();
  return ACCIONES.filter((a) => hasPermission(role, a.permiso))
    .filter((a) => !t || a.label.toLowerCase().includes(t))
    .map(({ permiso: _permiso, ...a }) => a);
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
