import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { hasPermission } from "@/lib/access/access";
import {
  CLAVES_EXPORTACION,
  CLAVES_EXPORTACION_PACIENTE,
  tablaPorClave,
} from "@/lib/exportacion/exportacion-clinica";
import {
  MENSAJE_SIN_PERMISO_FINANZAS_EXPORTACION,
  exigirExportacionRegistrada,
  exigirPermisoExportacion,
  exigirPermisoExportacionPaciente,
  leerPaginaDePaciente,
  leerPaginaDeTabla,
  type PaginaExportacion,
} from "@/lib/exportacion/exportacion-clinica.server";
import { idsDeLaFicha } from "@/lib/patients/fusion";

/**
 * Exportación completa de la clínica (CS-04/CON-01).
 *
 * El ZIP se arma en el navegador y el servidor solo entrega páginas de cada
 * tabla. Así ninguna llamada pasa del límite de tiempo ni del tope de 4,5 MB
 * de respuesta de Vercel, sin cola ni almacenamiento temporal: con el volumen
 * actual (clínicas de cientos o pocos miles de pacientes) una exportación son
 * unas decenas de llamadas cortas, y la pantalla muestra el avance.
 *
 * Tres pasos: `iniciar` anota la exportación (si no se puede anotar, no hay
 * exportación), `leer` devuelve páginas colgadas de ese registro y `firmar`
 * entrega enlaces de 10 minutos para bajar los archivos de Storage.
 */

const BUCKET = "clinical-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export const iniciarExportacionClinica = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ exportId: string }> => {
    const { supabase, userId } = context;
    await exigirPermisoExportacion(supabase, data.clinicId, userId);
    // La demo pública es owner de su clínica: sin este freno cada visitante
    // sumaría filas al registro de exportaciones.
    await assertNotDemoClinic(supabase, data.clinicId);

    // La función de la base vuelve a exigir owner/admin y estampa el actor.
    const { data: exportId, error } = await supabase.rpc("registrar_exportacion_de_clinica", {
      p_clinic_id: data.clinicId,
      p_detalle: { formato: "zip_csv", tablas: CLAVES_EXPORTACION },
    });
    if (error || !exportId) {
      console.error("[exportacion] no se pudo registrar:", error?.message);
      throw new Error(
        "No pudimos registrar la exportación en el historial de la clínica, así que no la generamos. Intenta de nuevo en unos minutos o escríbenos a soporte@esmalia.com.",
      );
    }
    return { exportId };
  });

export const leerTablaExportacion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        exportId: z.string().uuid(),
        clave: z.enum(CLAVES_EXPORTACION),
        offset: z.number().int().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PaginaExportacion> => {
    const { supabase, userId } = context;
    await exigirPermisoExportacion(supabase, data.clinicId, userId);
    await exigirExportacionRegistrada(supabase, data.clinicId, userId, data.exportId);

    const tabla = tablaPorClave(data.clave);
    if (!tabla) throw new Error("Tabla de exportación desconocida.");
    return leerPaginaDeTabla(supabase, tabla, data.clinicId, data.offset);
  });

export const firmarArchivosExportacion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        exportId: z.string().uuid(),
        rutas: z.array(z.string().min(1).max(512)).min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Array<{ ruta: string; url: string | null }>> => {
    const { supabase, userId } = context;
    await exigirPermisoExportacion(supabase, data.clinicId, userId);
    await exigirExportacionRegistrada(supabase, data.clinicId, userId, data.exportId);

    return firmarRutas(supabase, data.clinicId, data.rutas);
  });

/**
 * Enlaces de 10 minutos para bajar archivos de Storage al ZIP. Solo rutas de
 * esta clínica: la política de Storage ya lo exige (has_clinic_role sobre la
 * primera carpeta), esto es el cinturón.
 */
async function firmarRutas(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  rutasPedidas: string[],
): Promise<Array<{ ruta: string; url: string | null }>> {
  const prefijo = `${clinicId}/`;
  const rutas = rutasPedidas.filter((r) => r.startsWith(prefijo) && !r.includes(".."));
  if (!rutas.length) return [];

  const { data: firmadas, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rutas, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("[exportacion] firmar archivos:", error.message);
    return rutas.map((ruta) => ({ ruta, url: null }));
  }
  return rutas.map((ruta) => {
    const f = (firmadas ?? []).find((x) => x.path === ruta);
    return { ruta, url: f && !f.error ? f.signedUrl : null };
  });
}

// ── Exportación de una ficha (derecho de acceso del paciente, CON-01) ─────
//
// Misma idea que la completa: `iniciar` anota en `clinic_data_exports` (con
// el paciente) y cada página exige ese registro, del mismo usuario, del
// mismo paciente y reciente. Pueden owner, admin y dentist; presupuestos y
// pagos solo quien tiene `finance:view` (regla 15).

export const iniciarExportacionPaciente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ exportId: string }> => {
    const { supabase, userId } = context;
    await exigirPermisoExportacionPaciente(supabase, data.clinicId, userId);
    await assertNotDemoClinic(supabase, data.clinicId);

    // La función de la base vuelve a exigir el rol, verifica que el paciente
    // sea de la clínica y estampa el actor.
    const { data: exportId, error } = await supabase.rpc("registrar_exportacion_de_paciente", {
      p_clinic_id: data.clinicId,
      p_patient_id: data.patientId,
      p_detalle: { formato: "paciente_zip" },
    });
    if (error || !exportId) {
      console.error("[exportacion] no se pudo registrar (paciente):", error?.message);
      throw new Error(
        "No pudimos registrar la exportación en el historial de la clínica, así que no la generamos. Intenta de nuevo en unos minutos o escríbenos a soporte@esmalia.com.",
      );
    }
    return { exportId };
  });

const ExportacionPacienteSchema = z.object({
  clinicId: z.string().uuid(),
  exportId: z.string().uuid(),
  patientId: z.string().uuid(),
});

export const leerTablaExportacionPaciente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    ExportacionPacienteSchema.extend({
      clave: z.enum(CLAVES_EXPORTACION_PACIENTE),
      offset: z.number().int().min(0),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PaginaExportacion> => {
    const { supabase, userId } = context;
    const rol = await exigirPermisoExportacionPaciente(supabase, data.clinicId, userId);
    await exigirExportacionRegistrada(
      supabase,
      data.clinicId,
      userId,
      data.exportId,
      new Date(),
      data.patientId,
    );

    const tabla = tablaPorClave(data.clave);
    if (!tabla?.paciente) throw new Error("Tabla de exportación desconocida.");
    if (tabla.finanzas && !hasPermission(rol, "finance:view")) {
      throw new Error(MENSAJE_SIN_PERMISO_FINANZAS_EXPORTACION);
    }
    const ids = await idsDeLaFicha(supabase, data.clinicId, data.patientId);
    return leerPaginaDePaciente(supabase, tabla, data.clinicId, ids, data.offset);
  });

export const firmarArchivosExportacionPaciente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    ExportacionPacienteSchema.extend({
      rutas: z.array(z.string().min(1).max(512)).min(1).max(100),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<Array<{ ruta: string; url: string | null }>> => {
    const { supabase, userId } = context;
    await exigirPermisoExportacionPaciente(supabase, data.clinicId, userId);
    await exigirExportacionRegistrada(
      supabase,
      data.clinicId,
      userId,
      data.exportId,
      new Date(),
      data.patientId,
    );
    return firmarRutas(supabase, data.clinicId, data.rutas);
  });
