import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rolEnClinica } from "@/lib/access/clinic-guards.server";
import {
  CLAVES_LISTAS_CSV,
  puedeExportarLista,
  puedeVerDineroEnLista,
} from "@/lib/exportacion/listas-csv";

/**
 * Registro de cada "Exportar CSV" de una lista (EXP-04). Es el par en el
 * servidor del botón (regla 15): vuelve a exigir el permiso de la lista y,
 * si el archivo lleva montos, el de ver dinero; después lo anota en
 * `clinic_data_exports` vía `registrar_exportacion_de_lista`, que estampa el
 * actor. El navegador descarga solo si esto responde bien (falla cerrada).
 *
 * La demo pública no anota nada: sus datos son ficticios y cada visitante
 * sumaría filas a un registro que nadie revisa.
 */
export const MENSAJE_SIN_PERMISO_LISTA = "No tienes permisos para exportar esta lista.";
export const MENSAJE_EXPORTACION_LISTA_NO_REGISTRADA =
  "No pudimos registrar la exportación en el historial de la clínica, así que no descargamos el archivo. Intenta de nuevo en unos minutos.";

const Entrada = z.object({
  clinicId: z.string().uuid(),
  lista: z.enum(CLAVES_LISTAS_CSV),
  filas: z.number().int().min(0).max(1_000_000),
  conDinero: z.boolean(),
  /** Filtros aplicados en la pantalla (texto corto), para el registro. */
  filtros: z
    .record(z.string().max(40), z.string().max(200))
    .refine((f) => Object.keys(f).length <= 12, "Demasiados filtros")
    .optional(),
  columnas: z.array(z.string().max(60)).max(60),
});

export const registrarExportacionDeLista = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Entrada.parse(input))
  .handler(async ({ data, context }): Promise<{ exportId: string | null }> => {
    const { supabase, userId } = context;
    const rol = await rolEnClinica(supabase, data.clinicId, userId);
    if (!puedeExportarLista(rol, data.lista)) throw new Error(MENSAJE_SIN_PERMISO_LISTA);
    if (data.conDinero && !puedeVerDineroEnLista(rol, data.lista)) {
      throw new Error(MENSAJE_SIN_PERMISO_LISTA);
    }

    const { data: clinica } = await supabase
      .from("clinics")
      .select("is_demo")
      .eq("id", data.clinicId)
      .maybeSingle();
    if (clinica?.is_demo) return { exportId: null };

    const { data: exportId, error } = await supabase.rpc("registrar_exportacion_de_lista", {
      p_clinic_id: data.clinicId,
      p_lista: data.lista,
      p_filas: data.filas,
      p_detalle: {
        formato: "lista_csv",
        con_dinero: data.conDinero,
        columnas: data.columnas,
        filtros: data.filtros ?? {},
      },
    });
    if (error || !exportId) {
      console.error("[exportacion-lista] no se pudo registrar:", error?.message);
      throw new Error(MENSAJE_EXPORTACION_LISTA_NO_REGISTRADA);
    }
    return { exportId };
  });
