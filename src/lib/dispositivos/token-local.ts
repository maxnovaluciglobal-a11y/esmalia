/**
 * Lo ÚNICO que un dispositivo guarda en el navegador: su token (AUT-06).
 * Ningún dato de pacientes, ni la sesión del tótem (vive en memoria).
 * Cada acceso va en try/catch: en modo privado o con el almacenamiento
 * bloqueado, el dispositivo simplemente pide vincularse de nuevo.
 */

export const CLAVE_TOKEN_DISPOSITIVO = "esmalia:dispositivo";

export function leerTokenDispositivo(): string | null {
  try {
    const t = globalThis.localStorage?.getItem(CLAVE_TOKEN_DISPOSITIVO) ?? null;
    return t && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function guardarTokenDispositivo(token: string): void {
  try {
    globalThis.localStorage?.setItem(CLAVE_TOKEN_DISPOSITIVO, token);
  } catch {
    // Sin almacenamiento: funciona hasta recargar la página.
  }
}

export function borrarTokenDispositivo(): void {
  try {
    globalThis.localStorage?.removeItem(CLAVE_TOKEN_DISPOSITIVO);
  } catch {
    // Nada que borrar.
  }
}
