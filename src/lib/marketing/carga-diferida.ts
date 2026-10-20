// src/lib/marketing/carga-diferida.ts
//
// En la landing, el SDK de Sentry (~155 KB comprimido) y supabase-js
// (~50 KB) no hacen nada para quien llega sin sesión, pero se pedían junto
// con la hidratación y competían por la red con el CSS, las fuentes y el
// titular. Lighthouse los contaba dentro del primer pintado (auditoría de
// rendimiento de /v2, 20-oct-2026). Acá se piden cuando la página terminó
// de cargar y el navegador queda libre.
//
// Solo las rutas de esta lista: la app y el resto del sitio siguen igual.
// La landing vive en "/" desde el PR 8 (20-oct-2026); /v2 redirige con 308.

const RUTAS_CARGA_DIFERIDA: ReadonlySet<string> = new Set(["/"]);

/** true si en esta ruta lo no esencial se carga después del primer pintado. */
export function esRutaDeCargaDiferida(pathname: string): boolean {
  const limpia = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return RUTAS_CARGA_DIFERIDA.has(limpia);
}

/** Tope de espera: aunque el navegador no quede libre, se carga igual. */
const ESPERA_MAXIMA_MS = 3000;

/**
 * Corre `tarea` después del evento `load`, en el primer momento libre del
 * navegador (o a los 3 s como mucho). Devuelve una función que la cancela.
 * En el servidor no hace nada.
 */
export function cuandoQuedeLibre(tarea: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelada = false;
  let idleId: number | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const correr = () => {
    if (!cancelada) tarea();
  };
  const programar = () => {
    if (cancelada) return;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(correr, { timeout: ESPERA_MAXIMA_MS });
    } else {
      timeoutId = setTimeout(correr, 1);
    }
  };

  if (document.readyState === "complete") programar();
  else window.addEventListener("load", programar, { once: true });

  return () => {
    cancelada = true;
    window.removeEventListener("load", programar);
    if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };
}
