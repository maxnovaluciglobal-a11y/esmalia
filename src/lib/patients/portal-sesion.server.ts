/**
 * Sesión del portal del paciente: la cookie HttpOnly con el link firmado que
 * deja `openPortalSession`. Vive en un módulo de servidor para que la usen
 * las server functions del portal (`portal.functions.ts`) y las de los
 * derechos del titular (`derechos/portal-derechos.functions.ts`) sin que
 * `@tanstack/react-start/server` termine en el bundle del navegador.
 */
import { getRequest } from "@tanstack/react-start/server";

import { leerCookieConAnterior } from "@/lib/compat/nombres-anteriores";
import {
  PORTAL_COOKIE_NAME,
  verifyPortalToken,
  type PortalTokenPayload,
} from "@/lib/patients/portal-token.server";

export function readPortalCookie(): string | null {
  const req = getRequest();
  const cookieHeader = req?.headers.get("cookie") ?? "";
  return leerCookieConAnterior(cookieHeader, PORTAL_COOKIE_NAME);
}

/** true si el token es de antes de la última revocación del paciente. */
export async function isPortalTokenRevoked(payload: PortalTokenPayload): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("patients")
    .select("portal_revoked_at")
    .eq("id", payload.patientId)
    .eq("clinic_id", payload.clinicId)
    .maybeSingle();
  if (!data?.portal_revoked_at) return false;
  return payload.issuedAt <= new Date(data.portal_revoked_at);
}

/** Paciente y clínica de la sesión del portal (link firmado, vigente y no revocado). */
export async function requirePortalSession(): Promise<PortalTokenPayload> {
  const token = readPortalCookie();
  if (!token) throw new Error("Portal no autorizado.");
  let payload: PortalTokenPayload;
  try {
    payload = await verifyPortalToken(token);
  } catch {
    throw new Error("Sesión del portal vencida.");
  }
  if (await isPortalTokenRevoked(payload)) {
    throw new Error("Este link ya no es válido. Pídele a tu clínica uno nuevo.");
  }
  return payload;
}
