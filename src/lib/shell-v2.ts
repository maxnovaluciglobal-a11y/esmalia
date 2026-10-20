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
};

const ACCIONES: (AccionRapida & { permiso: Parameters<typeof hasPermission>[1] })[] = [
  {
    id: "nueva-cita",
    label: "Nueva cita",
    detalle: "En la agenda",
    to: "/agenda",
    permiso: "agenda:manage",
  },
  {
    id: "abrir-caja",
    label: "Abrir caja",
    detalle: "Caja del día",
    to: "/cajas",
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
