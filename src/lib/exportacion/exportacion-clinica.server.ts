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
  ROLES_EXPORTACION_PACIENTE,
  tablaPorClave,
  type FilaExportacion,
  type TablaExportacion,
} from "@/lib/exportacion/exportacion-clinica";

export const MENSAJE_SIN_PERMISO_EXPORTACION =
  "Solo el propietario o un administrador de la clínica puede exportar todos sus datos.";

export const MENSAJE_SIN_PERMISO_EXPORTACION_PACIENTE =
  "Solo el propietario, un administrador o un dentista de la clínica puede exportar la ficha de un paciente.";

export const MENSAJE_SIN_PERMISO_FINANZAS_EXPORTACION =
  "Los presupuestos y pagos del paciente los exporta el propietario o un administrador de la clínica.";

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

/** Exportación de una ficha: owner/admin/dentist, rol leído igual que arriba. */
export function exigirPermisoExportacionPaciente(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
): Promise<ClinicRole> {
  return requireClinicRole(
    supabase,
    clinicId,
    userId,
    ROLES_EXPORTACION_PACIENTE,
    MENSAJE_SIN_PERMISO_EXPORTACION_PACIENTE,
  );
}

/** Formato con que la base anota cada tipo de exportación. */
export const FORMATO_EXPORTACION_CLINICA = "zip_csv";
export const FORMATO_EXPORTACION_PACIENTE = "paciente_zip";

/**
 * Cada lectura tiene que colgar de una exportación ya anotada en
 * `clinic_data_exports` por este mismo usuario y hace poco. Sin esto, las
 * llamadas de lectura servirían para sacar todo sin dejar rastro.
 *
 * El registro además tiene que ser del MISMO tipo: una exportación anotada
 * como "la ficha de este paciente" no sirve para leer la clínica entera ni
 * la ficha de otro paciente (el registro diría algo distinto de lo que se
 * sacó).
 */
export async function exigirExportacionRegistrada(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
  exportId: string,
  ahora: Date = new Date(),
  patientId: string | null = null,
): Promise<void> {
  // La exportación completa no lee `patient_id`: así sigue andando aunque la
  // migración de la exportación por paciente todavía no esté aplicada.
  const { data, error } = await supabase
    .from("clinic_data_exports")
    .select(
      patientId
        ? "id, actor_id, created_at, formato, patient_id"
        : "id, actor_id, created_at, formato",
    )
    .eq("id", exportId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  const fila = data as {
    actor_id: string | null;
    created_at: string;
    formato: string;
    patient_id?: string | null;
  } | null;
  if (error || !fila || fila.actor_id !== userId) {
    throw new Error(MENSAJE_EXPORTACION_NO_REGISTRADA);
  }
  const tipoCorrecto = patientId
    ? fila.formato === FORMATO_EXPORTACION_PACIENTE && fila.patient_id === patientId
    : fila.formato === FORMATO_EXPORTACION_CLINICA;
  if (!tipoCorrecto) throw new Error(MENSAJE_EXPORTACION_NO_REGISTRADA);
  const creada = Date.parse(fila.created_at);
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

/**
 * Las tablas que cuelgan de otra (versiones de una nota, ítems de un
 * presupuesto) se filtran por los ids del padre con `.in()`. Van de a
 * BLOQUE_PADRES ids para que la URL de PostgREST no crezca sin techo con un
 * paciente de cientos de notas. El offset que viaja al cliente codifica el
 * bloque y la posición dentro del bloque: bloque * SALTO_BLOQUE + posición.
 */
export const BLOQUE_PADRES = 100;
const SALTO_BLOQUE = 1_000_000;

type ClienteSinTipos = SupabaseClient;

async function idsDelPadre(
  cliente: ClienteSinTipos,
  padre: TablaExportacion,
  clinicId: string,
  idsFicha: readonly string[],
): Promise<string[]> {
  const filtro = padre.paciente;
  if (!filtro || filtro.por === "padre") {
    throw new Error(`La tabla ${padre.tabla} no se puede filtrar por paciente.`);
  }
  const ids: string[] = [];
  for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
    const { data, error } = await cliente
      .from(padre.tabla)
      .select("id")
      .eq("clinic_id", clinicId)
      .in(filtro.por, [...idsFicha])
      .order("id", { ascending: true })
      .range(desde, desde + FILAS_POR_PAGINA - 1);
    if (error) {
      console.error(`[exportacion] ${padre.tabla} (padre):`, error.message);
      throw new Error(`No pudimos leer ${padre.archivo}. Intenta de nuevo en unos minutos.`);
    }
    const filas = (data ?? []) as unknown as Array<{ id: string }>;
    if (!filas.length) break;
    ids.push(...filas.map((f) => f.id));
  }
  return ids;
}

/**
 * Una página de una tabla, solo con las filas de un paciente (y de las
 * fichas fusionadas en la suya, `idsFicha`). Mismo criterio que
 * `leerPaginaDeTabla`: filtro por clínica además de la RLS, orden estable y
 * fin cuando una página vuelve vacía.
 */
export async function leerPaginaDePaciente(
  supabase: SupabaseClient<Database>,
  tabla: TablaExportacion,
  clinicId: string,
  idsFicha: readonly string[],
  offset: number,
  limite: number = FILAS_POR_PAGINA,
): Promise<PaginaExportacion> {
  const filtro = tabla.paciente;
  if (!filtro || !idsFicha.length) throw new Error("Esta tabla no sale en la ficha del paciente.");
  const cliente = supabase as unknown as ClienteSinTipos;

  const pagina = async (columna: string, valores: readonly string[], desde: number) => {
    let consulta = cliente
      .from(tabla.tabla)
      .select(tabla.columnas.join(","))
      .eq("clinic_id", clinicId)
      .in(columna, [...valores]);
    for (const c of tabla.orden) consulta = consulta.order(c, { ascending: true });
    const { data, error } = await consulta.range(desde, desde + limite - 1);
    if (error) {
      console.error(`[exportacion] ${tabla.tabla} (paciente):`, error.message);
      throw new Error(`No pudimos leer ${tabla.archivo}. Intenta de nuevo en unos minutos.`);
    }
    return (data ?? []) as unknown as FilaExportacion[];
  };

  if (filtro.por !== "padre") {
    const filas = await pagina(filtro.por, idsFicha, offset);
    return { filas, siguiente: filas.length === 0 ? null : offset + filas.length };
  }

  const padre = tablaPorClave(filtro.padre);
  if (!padre) throw new Error("Tabla de exportación desconocida.");
  const padres = await idsDelPadre(cliente, padre, clinicId, idsFicha);
  const bloque = Math.floor(offset / SALTO_BLOQUE);
  const desde = offset % SALTO_BLOQUE;
  const ids = padres.slice(bloque * BLOQUE_PADRES, (bloque + 1) * BLOQUE_PADRES);
  if (!ids.length) return { filas: [], siguiente: null };
  const filas = await pagina(filtro.columna, ids, desde);
  if (filas.length) return { filas, siguiente: offset + filas.length };
  // Bloque terminado: el siguiente, si hay.
  const hayOtro = padres.length > (bloque + 1) * BLOQUE_PADRES;
  return { filas: [], siguiente: hayOtro ? (bloque + 1) * SALTO_BLOQUE : null };
}
