import { useCallback, useSyncExternalStore } from "react";

/**
 * Movimiento del rediseño A+: si algo se puede animar o no.
 *
 * Dos fuentes, y cualquiera de las dos frena todo:
 *  - `prefers-reduced-motion: reduce` del sistema.
 *  - El botón "Pausar movimiento" (WCAG 2.2.2), que se guarda en este
 *    navegador y se comparte entre todos los componentes de la página.
 *
 * SSR seguro: en el servidor y en la hidratación arranca en "reducido",
 * así el HTML inicial muestra cada cosa en su estado final y nada queda
 * esperando una animación para ser legible.
 */

export const CLAVE_PAUSA_MOVIMIENTO = "esmalia:movimiento-pausado";
const CONSULTA_REDUCIDO = "(prefers-reduced-motion: reduce)";

export type EstadoMovimiento = {
  /** El sistema pide movimiento reducido. */
  reducido: boolean;
  /** La persona tocó "Pausar movimiento". */
  pausado: boolean;
};

/** Se anima solo si el sistema no pide reducir y nadie pausó. */
export function debeAnimar(estado: EstadoMovimiento): boolean {
  return !estado.reducido && !estado.pausado;
}

type AlmacenMinimo = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Lee la pausa guardada. Si el almacenamiento falla, no hay pausa. */
export function leerPausa(almacen: AlmacenMinimo | null | undefined): boolean {
  try {
    return almacen?.getItem(CLAVE_PAUSA_MOVIMIENTO) === "1";
  } catch {
    return false;
  }
}

/** Guarda la pausa. Si falla (modo privado, cuota), la pausa vale igual en memoria. */
export function guardarPausa(almacen: AlmacenMinimo | null | undefined, pausado: boolean): void {
  try {
    if (pausado) almacen?.setItem(CLAVE_PAUSA_MOVIMIENTO, "1");
    else almacen?.removeItem(CLAVE_PAUSA_MOVIMIENTO);
  } catch {
    // Sin almacenamiento la pausa dura lo que dura la página.
  }
}

function almacenLocal(): AlmacenMinimo | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function sistemaPideReducir(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(CONSULTA_REDUCIDO).matches;
}

// --- Estado compartido del módulo ---

const ESTADO_SERVIDOR: EstadoMovimiento = { reducido: true, pausado: false };

let pausadoEnMemoria: boolean | null = null;
let ultimo: EstadoMovimiento = ESTADO_SERVIDOR;
const oyentes = new Set<() => void>();

function pausadoActual(): boolean {
  if (pausadoEnMemoria === null) pausadoEnMemoria = leerPausa(almacenLocal());
  return pausadoEnMemoria;
}

function leerEstado(): EstadoMovimiento {
  const reducido = sistemaPideReducir();
  const pausado = pausadoActual();
  // Misma referencia si nada cambió: useSyncExternalStore lo exige.
  if (ultimo.reducido !== reducido || ultimo.pausado !== pausado) {
    ultimo = { reducido, pausado };
  }
  return ultimo;
}

function avisar() {
  for (const o of oyentes) o();
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  if (typeof window === "undefined") return () => oyentes.delete(oyente);

  const consulta =
    typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA_REDUCIDO) : null;
  consulta?.addEventListener("change", oyente);

  // Otra pestaña pausó o reanudó.
  const alCambiarStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== CLAVE_PAUSA_MOVIMIENTO) return;
    pausadoEnMemoria = e.newValue === "1";
    oyente();
  };
  window.addEventListener("storage", alCambiarStorage);

  return () => {
    oyentes.delete(oyente);
    consulta?.removeEventListener("change", oyente);
    window.removeEventListener("storage", alCambiarStorage);
  };
}

/** Pausa o reanuda el movimiento en toda la página y lo recuerda. */
export function fijarPausaMovimiento(pausado: boolean): void {
  pausadoEnMemoria = pausado;
  guardarPausa(almacenLocal(), pausado);
  avisar();
}

export function useMovimiento() {
  const estado = useSyncExternalStore(suscribir, leerEstado, () => ESTADO_SERVIDOR);
  const alternarPausa = useCallback(() => fijarPausaMovimiento(!pausadoActual()), []);
  const pausar = useCallback(() => fijarPausaMovimiento(true), []);
  const reanudar = useCallback(() => fijarPausaMovimiento(false), []);
  return {
    ...estado,
    /** true solo si se puede animar (ni reducido ni pausado). */
    animar: debeAnimar(estado),
    pausar,
    reanudar,
    alternarPausa,
  };
}
