// src/lib/admin/staff-gate.ts
//
// Gate compartido de las pantallas internas del equipo de Esmalia (no hay un
// rol "staff de la empresa" en el schema — todos los roles son de clínica).
// La única autorización real es esta allowlist de emails por env var,
// resuelta contra `auth.users` con el cliente admin.
//
// Extraído de `listMarketingLeads` (src/lib/marketing/leads.functions.ts),
// que era el único caller hasta que `admin.clinicas.tsx` necesitó el mismo
// chequeo — mismo criterio que `tryMetaTemplateSend` en whatsapp.functions.ts:
// la segunda pantalla que necesita el gate lo saca del bloque que antes vivía
// duplicado, en vez de copiarlo por segunda vez.

import {
  evaluarAccesoStaff,
  listaDeStaff,
  MENSAJE_SIN_PERMISOS,
  MENSAJE_STAFF_REQUIERE_MFA,
} from "@/lib/auth/mfa";

type SupabaseAdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

/**
 * Tira `Error("No tienes permisos.")` si el usuario autenticado no está en
 * `ESMALIA_STAFF_EMAILS`, y `Error(MENSAJE_STAFF_REQUIERE_MFA)` si sí está
 * pero la sesión no pasó por la verificación en dos pasos (`aal2`).
 * Devuelve el email (en minúsculas) cuando entra, por si el caller lo
 * necesita (ej. logging de quién hizo qué).
 *
 * SEG-01 (auditoría 360, 18-oct-2026): desde `/admin` se ven todas las
 * clínicas, así que una contraseña robada no alcanza. `claims` es el
 * `context.claims` de `requireSupabaseAuth`: el JWT ya verificado por
 * `getClaims`, no algo que mande el cliente. Es obligatorio a propósito: si
 * aparece un caller nuevo, el compilador lo obliga a pasarlo.
 */
export async function requireEsmaliaStaffEmail(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  claims: { aal?: unknown },
): Promise<string> {
  const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(userId);
  // Auditoría 10-oct-2026: el email solo prueba identidad si está
  // confirmado. Con el alta abierta, alguien podía registrarse con la
  // dirección de un integrante del equipo (sin poder confirmarla) y, si la
  // confirmación de email se desactivaba en Auth, entrar directo al panel.
  const resultado = evaluarAccesoStaff({
    email: usuario?.user?.email,
    emailConfirmado: Boolean(usuario?.user?.email_confirmed_at),
    permitidos: listaDeStaff(process.env.ESMALIA_STAFF_EMAILS),
    aal: claims.aal,
  });

  if (!resultado.ok) {
    throw new Error(
      resultado.motivo === "requiere_mfa" ? MENSAJE_STAFF_REQUIERE_MFA : MENSAJE_SIN_PERMISOS,
    );
  }
  return resultado.email;
}
