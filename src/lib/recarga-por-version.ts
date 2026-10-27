/**
 * Tras un deploy, una pestaña abierta con la versión anterior pide un chunk
 * que ya no existe ("Failed to fetch dynamically imported module", el error
 * que Sentry mostraba en `eventos-cuenta-*.js`). Vite avisa con el evento
 * `vite:preloadError`: se recarga la página una vez para traer la versión
 * nueva. El sello en sessionStorage evita un bucle si el problema es otro.
 */
const CLAVE = "esmalia:recarga-por-version";
const VENTANA_MS = 30_000;

/** ¿Se puede recargar? No si ya se recargó hace menos de `VENTANA_MS`. */
export function puedeRecargar(ultima: string | null, ahora: number): boolean {
  const t = Number(ultima);
  return !Number.isFinite(t) || ahora - t > VENTANA_MS;
}

export function recargarSiLaVersionCambio(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (evento) => {
    let ultima: string | null = null;
    try {
      ultima = window.sessionStorage.getItem(CLAVE);
    } catch {
      // sin sessionStorage (modo privado): se recarga igual una vez por evento
    }
    const ahora = Date.now();
    if (!puedeRecargar(ultima, ahora)) return;
    try {
      window.sessionStorage.setItem(CLAVE, String(ahora));
    } catch {
      // idem
    }
    evento.preventDefault();
    window.location.reload();
  });
}
