// Guardas de servidor compartidas por las server functions que hacen algo
// que la RLS no ve: llamar a la Admin API de Supabase (service_role), a
// Stripe, a Meta o firmar un link sin login.
//
// Regla 15 de CLAUDE.md: el JWT vive en localStorage, así que cualquier
// miembro (o el visitante anónimo de la demo pública) puede llamar la server
// function directo, sin pasar por la pantalla.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { isClinicRole, type ClinicRole, type Permission } from "@/lib/access/access";

export const MENSAJE_CLINICA_DEMO =
  "Esta es la clínica demo: es de solo lectura. Crea tu clínica para usar esta función.";

/**
 * Auditoría 10-oct-2026: la demo pública (`demo@esmalia.com`, credenciales en el
 * código a propósito) es owner de su clínica. El trigger `block_demo_writes`
 * frena las escrituras en la base, pero NO lo que pasa antes de escribir:
 * `inviteUserByEmail` mandaba correos de invitación a cualquier dirección,
 * Stripe creaba sesiones y Meta recibía mensajes. Esta guarda corta antes de
 * cualquier efecto externo.
 *
 * Falla cerrada: si no se puede leer la clínica (no es miembro, error de red)
 * tampoco se sigue — quien llama a esto está por hablar con un tercero.
 */
export async function assertNotDemoClinic(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clinics")
    .select("is_demo")
    .eq("id", clinicId)
    .maybeSingle();
  if (error || !data) throw new Error("No tienes permisos para esta clínica.");
  if (data.is_demo) throw new Error(MENSAJE_CLINICA_DEMO);
}

/** Rol del usuario en la clínica, o null si no es miembro. */
export async function rolEnClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
): Promise<ClinicRole | null> {
  const { data } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as ClinicRole | undefined) ?? null;
}

export { permisosEnClinica, type PermisosEnClinica } from "@/lib/access/permisos-en-clinica";
import { permisosEnClinica } from "@/lib/access/permisos-en-clinica";

/**
 * Par en el servidor de `requirePermission(...)` de las rutas — mismo
 * criterio que `requireFinanceViewRole` (finance-reports.functions.ts), pero
 * para cualquier permiso de la matriz de `access.ts`, con los ajustes por
 * persona (EQU-01): un permiso quitado acá también se niega.
 */
export async function requireClinicPermission(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
  permission: Permission,
  mensaje = "No tienes permisos para hacer esto en esta clínica.",
): Promise<ClinicRole> {
  const acceso = await permisosEnClinica(supabase, clinicId, userId);
  if (!acceso || !acceso.permisos.includes(permission)) throw new Error(mensaje);
  return acceso.rol;
}

/** Igual que `requireClinicPermission`, pero contra una lista de roles. */
export async function requireClinicRole(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
  roles: readonly ClinicRole[],
  mensaje = "No tienes permisos para hacer esto en esta clínica.",
): Promise<ClinicRole> {
  const rol = await rolEnClinica(supabase, clinicId, userId);
  if (!rol || !roles.includes(rol)) throw new Error(mensaje);
  return rol;
}
