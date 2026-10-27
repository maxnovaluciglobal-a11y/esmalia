// src/lib/auth/mfa-sesion.ts
//
// ¿La sesión del navegador ya pasó el segundo paso? (cliente)
//
// Con la app autenticadora alcanza con mirar el `aal` de la sesión local
// (sin red). Con el código por correo no: la verificación vive en la base
// (`mi_estado_mfa().sesion_cumple`, la misma función que usan las políticas
// RLS), así que hay que preguntarle. Para no hacerlo en cada navegación, un
// `true` queda en memoria por `session_id`: una sesión que cumplió sigue
// cumpliendo hasta que se cierra (y entonces cambia el `session_id`).
//
// Es una guarda de interfaz: la frontera real es la RLS.

import type { Session } from "@supabase/supabase-js";

import { sessionIdDeToken } from "@/lib/auth/mfa-correo";

type ClienteRpc = {
  rpc: (fn: "mi_estado_mfa") => PromiseLike<{ data: unknown; error: unknown }>;
};

const sesionesQueCumplen = new Set<string>();

export function marcarSesionQueCumple(session: Pick<Session, "access_token"> | null | undefined) {
  const id = sessionIdDeToken(session?.access_token);
  if (id) sesionesQueCumplen.add(id);
}

/**
 * `true` si la sesión pasó el segundo paso (o la cuenta no tiene ninguno),
 * `false` si falta, `null` si no se pudo saber (sin conexión): el llamador
 * decide con lo que sepa de la sesión local.
 */
export async function sesionCumpleSegundoPaso(
  supabase: ClienteRpc,
  session: Pick<Session, "access_token">,
): Promise<boolean | null> {
  const id = sessionIdDeToken(session.access_token);
  if (id && sesionesQueCumplen.has(id)) return true;
  try {
    const { data, error } = await supabase.rpc("mi_estado_mfa");
    if (error || !data || typeof data !== "object") return null;
    const cumple = (data as { sesion_cumple?: unknown }).sesion_cumple === true;
    if (cumple && id) sesionesQueCumplen.add(id);
    return cumple;
  } catch {
    return null;
  }
}
