/**
 * Estado público de Patty (la IA de Esmalia). Archivo sin dependencias de
 * servidor: lo importan la UI, las páginas públicas y el gateway.
 *
 * Patty está pausada desde el 19-oct-2026 (auditoría 360: IA-01, IA-03,
 * LEG-01). El interruptor real es la variable de servidor `AI_ENABLED`
 * (ver `ai-gateway.server.ts` y `docs/IA.md`); este texto es lo que ve la
 * gente mientras tanto.
 */
export const MENSAJE_IA_PAUSADA =
  "Patty está en habilitación: por ahora no redacta, no resume ni estructura notas. Puedes escribir y guardar la nota igual que siempre.";

/** Frase corta para badges y textos de marketing. */
export const ESTADO_PATTY_CORTO = "Patty está en habilitación";

/** Código del error tipado que lanza el gateway con la IA apagada. */
export const CODIGO_IA_PAUSADA = "AI_DISABLED";

/** Reconoce el error de IA pausada aunque llegue serializado desde una server function. */
export function esErrorIaPausada(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  return e.code === CODIGO_IA_PAUSADA || e.message === MENSAJE_IA_PAUSADA;
}
