/**
 * Piezas de servidor de las páginas públicas del paciente (Ola 7 · frente B):
 * `/formulario/:token` (MKT-07) y `/encuesta/:token` (MKT-08).
 */
import { getRequest } from "@tanstack/react-start/server";

import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit.server";

/**
 * Límite por IP en memoria para las páginas públicas: 30 llamadas por minuto
 * alcanzan de sobra para una persona completando un formulario. La base
 * además exige la huella exacta del token (256 bits).
 */
export function exigirLimitePublico(): void {
  const req = getRequest();
  const ip = req ? clientIpFromRequest(req) : "unknown";
  const r = checkRateLimit(ip, { scope: "correos-paciente", windowMs: 60_000, max: 30 });
  if (r.limited) {
    throw new Error(
      `Demasiados intentos seguidos. Espera ${r.retryAfterSeconds} segundos y vuelve a intentarlo.`,
    );
  }
}

export function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

export function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}
