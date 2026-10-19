//
// Lógica pura de captación. Sin React, sin Supabase: se puede testear sin
// levantar nada y se importa tanto desde la UI pública como desde la server fn.

import { CODIGO_PAIS, normalizeToWaMe, type PaisTelefono } from "@/lib/messaging/telefonos";

export type PaisCaptacion = PaisTelefono;

/** Prefijo telefónico por país (el mismo mapa que usa la normalización). */
export const CODIGO_PAIS_TELEFONO: Record<PaisCaptacion, string> = CODIGO_PAIS;

/** El número se lee con las reglas del país que el visitante eligió. */
export function normalizarTelefonoPorPais(phone: string, country: PaisCaptacion): string | null {
  const limpio = (phone ?? "").trim();
  if (!limpio) return null;
  return normalizeToWaMe(limpio, country);
}

/** SHA-256 hex de la IP con sal. Guardamos el hash y no la IP: para el rate
 *  limit alcanza, y así no persistimos un dato personal identificable. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const datos = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const TEXTO_CONSENTIMIENTO =
  "Autorizo a Esmalia a usar estos datos para lo que pedí acá y " +
  "comunicarse conmigo. Puedo pedir la baja en cualquier momento.";

export type MetaLead = {
  margen_bucket: "perdida" | "bajo" | "medio" | "alto" | "na";
  ausencias_bucket: "bajo" | "medio" | "alto" | "na";
  conversion_bucket: "baja" | "media" | "alta" | "na";
  retencion_declarada: boolean;
  pais: PaisCaptacion;
};
