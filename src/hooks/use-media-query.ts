import { useSyncExternalStore } from "react";

/**
 * `true` si la media query se cumple. En el servidor (y en la primera pasada
 * de hidratación) devuelve `false`: quien la usa tiene que verse bien con
 * ese valor y ajustarse después en el cliente.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", avisar);
      return () => mql.removeEventListener("change", avisar);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  );
}

/** Celular: por debajo del breakpoint `md` de Tailwind (768px). */
export const QUERY_MOVIL = "(max-width: 767.98px)";
/** Puntero grueso (dedo): pantallas táctiles sin mouse. */
export const QUERY_TACTIL = "(pointer: coarse)";
