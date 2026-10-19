// Guardas y lectura paginada de la exportación completa (CS-04/CON-01).
//
// Vive aparte de `exportacion-clinica.functions.ts` para poder probarse con un
// cliente de Supabase falso, sin levantar TanStack Start ni tocar la base.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { ClinicRole } from "@/lib/access/access";
import { requireClinicRole } from "@/lib/access/clinic-guards.server";
import {
  FILAS_POR_PAGINA,
  ROLES_EXPORTACION,
  type FilaExportacion,
  type TablaExportacion,
} from "@/lib/exportacion/exportacion-clinica";

export const MENSAJE_SIN_PERMISO_EXPORTACION =
  "Solo el propietario o un administrador de la clínica puede exportar todos sus datos.";

export const MENSAJE_EXPORTACION_NO_REGISTRADA =
  "La exportación no está registrada o ya venció. Vuelve a empezarla desde Ajustes.";

/**
 * Una exportación registrada sirve para leer durante este tiempo. Alcanza
 * para una clínica grande con conexión lenta y evita que un id viejo quede
 * como llave permanente para leer todo sin dejar un registro nuevo.
 */
export const VIGENCIA_EXPORTACION_MS = 2 * 60 * 60 * 1000;

/**
 * Regla 15: el botón solo aparece para owner/admin, pero el JWT vive en
 * localStorage y cualquier miembro puede llamar la server function directo.
 * El rol se lee de `clinic_members` con el cliente del propio usuario (RLS).
 */
export function exigirPermisoExportacion(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
): Promise<ClinicRole> {
  return requireClinicRole(
    supabase,
    clinicId,
    userId,
    ROLES_EXPORTACION,
    MENSAJE_SIN_PERMISO_EXPORTACION,
  );
}

/**
 * Cada lectura tiene que colgar de una exportación ya anotada en
 * `clinic_data_exports` por este mismo usuario y hace poco. Sin esto, las
 * llamadas de lectura servirían para sacar todo sin dejar rastro.
 */
export async function exigirExportacionRegistrada(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
  exportId: string,
  ahora: Date = new Date(),
): Promise<void> {
  const { data, error } = await supabase
    .from("clinic_data_exports")
    .select("id, actor_id, created_at")
    .eq("id", exportId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error || !data || data.actor_id !== userId) {
    throw new Error(MENSAJE_EXPORTACION_NO_REGISTRADA);
  }
  const creada = Date.parse(data.created_at);
  if (!Number.isFinite(creada) || ahora.getTime() - creada > VIGENCIA_EXPORTACION_MS) {
    throw new Error(MENSAJE_EXPORTACION_NO_REGISTRADA);
  }
}

export interface PaginaExportacion {
  filas: FilaExportacion[];
  /** Offset de la próxima página, o null si la tabla terminó. */
  siguiente: number | null;
}

/**
 * Una página de una tabla, filtrada por clínica (además de la RLS) y en un
 * orden estable. La tabla termina cuando una página vuelve vacía, no cuando
 * vuelve "incompleta": si PostgREST tuviera un `max-rows` menor que
 * FILAS_POR_PAGINA, cortar en la primera página corta perdería filas en
 * silencio. Cuesta una llamada vacía extra por tabla.
 */
export async function leerPaginaDeTabla(
  supabase: SupabaseClient<Database>,
  tabla: TablaExportacion,
  clinicId: string,
  offset: number,
  limite: number = FILAS_POR_PAGINA,
): Promise<PaginaExportacion> {
  // La tabla llega por nombre desde una lista fija (TABLAS_EXPORTACION), así
  // que el cliente sin tipos no abre nada: el input del usuario es la clave,
  // que se valida contra esa lista antes de llegar acá.
  const cliente = supabase as unknown as SupabaseClient;
  let consulta = cliente
    .from(tabla.tabla)
    .select(tabla.columnas.join(","))
    .eq("clinic_id", clinicId);
  for (const columna of tabla.orden) consulta = consulta.order(columna, { ascending: true });
  const { data, error } = await consulta.range(offset, offset + limite - 1);
  if (error) {
    console.error(`[exportacion] ${tabla.tabla}:`, error.message);
    throw new Error(`No pudimos leer ${tabla.archivo}. Intenta de nuevo en unos minutos.`);
  }
  const filas = (data ?? []) as unknown as FilaExportacion[];
  return { filas, siguiente: filas.length === 0 ? null : offset + filas.length };
}
