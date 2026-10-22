import { SignJWT, jwtVerify } from "jose";

/**
 * Token firmado del enlace "Dejar de recibir este resumen".
 *
 * Mismo patrón que `portal-token.server.ts` (JWT HS256 con `jose`), con su
 * propio secreto, emisor y audiencia: un token del portal nunca sirve como
 * baja ni al revés. Lleva el usuario y el grupo de correos ("reporte
 * semanal"), así que la baja no necesita iniciar sesión.
 *
 * Desde la Ola 4 también firma la baja de un PACIENTE de los correos que su
 * clínica le manda (presupuesto, copia de documentos): grupo
 * `correos_paciente`, y el sujeto es el id del paciente (no un usuario).
 *
 * Secreto: `EMAIL_UNSUBSCRIBE_SECRET` (32+ bytes al azar). Sin él:
 *  - en desarrollo se usa uno al azar por proceso (los enlaces no sobreviven
 *    un reinicio, no importa en local);
 *  - en producción `bajaDisponible()` es false y los correos NO
 *    transaccionales no se mandan. Un correo opcional sin baja funcional
 *    incumple la Ley 21.719, así que se prefiere no enviarlo.
 */

const ISSUER = "esmalia:correo";
const AUDIENCE = "esmalia:baja";
/** Un año: un enlace de baja viejo tiene que seguir funcionando. */
const TTL = "365d";

export const GRUPOS_DE_BAJA = ["reporte_semanal", "correos_paciente"] as const;
export type GrupoDeBaja = (typeof GRUPOS_DE_BAJA)[number];

let devSecret: Uint8Array | null = null;

function secreto(): Uint8Array | null {
  const raw = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (raw) return new TextEncoder().encode(raw);
  if (process.env.NODE_ENV !== "production") {
    if (!devSecret) devSecret = crypto.getRandomValues(new Uint8Array(32));
    return devSecret;
  }
  return null;
}

export function bajaDisponible(): boolean {
  return secreto() !== null;
}

/** `userId`: el usuario, o el paciente en el grupo `correos_paciente`. */
export async function firmarTokenDeBaja(userId: string, grupo: GrupoDeBaja): Promise<string> {
  const s = secreto();
  if (!s) throw new Error("EMAIL_UNSUBSCRIBE_SECRET no configurada.");
  return await new SignJWT({ grp: grupo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(s);
}

/** `null` si el token es inválido, está vencido o no hay secreto. Nunca lanza. */
export async function verificarTokenDeBaja(
  token: string,
): Promise<{ userId: string; grupo: GrupoDeBaja } | null> {
  const s = secreto();
  if (!s || !token) return null;
  try {
    const { payload } = await jwtVerify(token, s, { issuer: ISSUER, audience: AUDIENCE });
    const grupo = payload.grp;
    if (!payload.sub || !(GRUPOS_DE_BAJA as readonly unknown[]).includes(grupo)) return null;
    return { userId: payload.sub, grupo: grupo as GrupoDeBaja };
  } catch {
    return null;
  }
}

/** Página con la confirmación (la ve una persona). */
export function urlPaginaDeBaja(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/correos/baja?token=${encodeURIComponent(token)}`;
}

/** Endpoint de un clic (RFC 8058): lo llama el cliente de correo con POST. */
export function urlBajaUnClic(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/correos/baja?token=${encodeURIComponent(token)}`;
}
