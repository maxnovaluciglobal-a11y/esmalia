// Permisos efectivos (rol + ajustes por persona, EQU-01) del usuario en una
// clínica, leídos con el cliente de Supabase que se pasa (RLS del usuario).
//
// Vive en un módulo SIN el sufijo `.server` a propósito: lo usan funciones de
// servidor que lo llaman desde ayudantes a nivel de módulo (no solo desde el
// `handler`), y el bloqueo de importaciones de TanStack Start rechaza un
// `*.server.*` ahí. No tiene nada exclusivo del servidor: no usa claves ni la
// service role. `clinic-guards.server.ts` lo re-exporta.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  ajustesDesdeFilas,
  isClinicRole,
  permisosEfectivos,
  type AjustePermiso,
  type ClinicRole,
  type Permission,
} from "@/lib/access/access";

export type PermisosEnClinica = {
  rol: ClinicRole;
  memberId: string;
  ajustes: AjustePermiso[];
  permisos: Permission[];
};

/**
 * Rol, ajustes por persona (EQU-01) y permisos efectivos del usuario en la
 * clínica, o null si no es miembro. Falla cerrada: si los ajustes no se
 * pueden leer, no se inventan permisos (se lanza el error).
 */
export async function permisosEnClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
): Promise<PermisosEnClinica | null> {
  const { data: miembro } = await supabase
    .from("clinic_members")
    .select("id, role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!miembro || !isClinicRole(miembro.role)) return null;
  const { data: filas, error } = await supabase
    .from("clinic_member_permission_overrides")
    .select("permission, effect")
    .eq("clinic_id", clinicId)
    .eq("member_id", miembro.id);
  if (error) throw new Error("No pudimos verificar tus permisos en esta clínica.");
  const ajustes = ajustesDesdeFilas(filas);
  return {
    rol: miembro.role,
    memberId: miembro.id,
    ajustes,
    permisos: permisosEfectivos(miembro.role, ajustes),
  };
}

/**
 * Permisos efectivos (rol + ajustes por persona) del usuario en la clínica.
 * Para decidir QUÉ se le muestra (costos, saldos, montos): si no se pueden
 * leer los ajustes o no es miembro, falla cerrado y devuelve `[]` — nunca
 * inventa un permiso.
 */
export async function permisosEfectivosEnClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
): Promise<Permission[]> {
  try {
    return (await permisosEnClinica(supabase, clinicId, userId))?.permisos ?? [];
  } catch {
    return [];
  }
}

/** ¿Tiene este permiso (rol + ajustes por persona)? Falla cerrado: `false`. */
export async function tienePermisoEnClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
  permission: Permission,
): Promise<boolean> {
  return (await permisosEfectivosEnClinica(supabase, clinicId, userId)).includes(permission);
}

