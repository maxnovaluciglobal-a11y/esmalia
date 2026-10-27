import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { permisosEnClinica } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import { ConfigInforme } from "@/lib/reportes/informes";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Informes guardados del constructor libre (INF-04). Guardan la
 * configuración, no las cifras: al abrir uno se recalcula con los permisos
 * de quien lo abre. La RLS de `saved_reports` decide quién ve, edita y borra
 * (migración 20261107100100); acá se exige además ser miembro con acceso a
 * informes (`dashboard:view`) y se valida la configuración.
 */

export interface InformeGuardado {
  id: string;
  nombre: string;
  config: ConfigInforme;
  compartido: boolean;
  propio: boolean;
  creadoEl: string;
}

const MENSAJE = "No tienes permisos para guardar informes en esta clínica.";

async function exigirMiembro(
  supabase: Parameters<typeof permisosEnClinica>[0],
  clinicId: string,
  userId: string,
) {
  const acceso = await permisosEnClinica(supabase, clinicId, userId);
  if (!acceso || !acceso.permisos.includes("dashboard:view")) throw new Error(MENSAJE);
}

export const listInformesGuardados = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InformeGuardado[]> => {
    const { supabase, userId } = context;
    await exigirMiembro(supabase, data.clinicId, userId);
    const { data: filas, error } = await supabase
      .from("saved_reports")
      .select("id, name, config, shared, created_by, created_at")
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los informes guardados."));
    const salida: InformeGuardado[] = [];
    for (const f of filas ?? []) {
      // Una configuración vieja o rota no rompe la lista: se omite.
      const config = ConfigInforme.safeParse(f.config);
      if (!config.success) continue;
      salida.push({
        id: f.id,
        nombre: f.name,
        config: config.data,
        compartido: f.shared,
        propio: f.created_by === userId,
        creadoEl: f.created_at,
      });
    }
    return salida;
  });

export const guardarInforme = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        nombre: z.string().trim().min(1, "Ponle un nombre.").max(80),
        config: ConfigInforme,
        compartido: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await exigirMiembro(supabase, data.clinicId, userId);
    const { data: fila, error } = await supabase
      .from("saved_reports")
      .insert({
        clinic_id: data.clinicId,
        name: data.nombre,
        config: data.config as unknown as Json,
        shared: data.compartido,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !fila) throw new Error(mensajeDb(error, "No pudimos guardar el informe."));
    return { id: fila.id };
  });

export const actualizarInformeGuardado = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        id: z.string().uuid(),
        nombre: z.string().trim().min(1).max(80).optional(),
        compartido: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await exigirMiembro(supabase, data.clinicId, userId);
    const cambios: { name?: string; shared?: boolean } = {};
    if (data.nombre !== undefined) cambios.name = data.nombre;
    if (data.compartido !== undefined) cambios.shared = data.compartido;
    const { data: filas, error } = await supabase
      .from("saved_reports")
      .update(cambios)
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No pudimos actualizar el informe."));
    if (!filas?.length) throw new Error("Solo quien guardó el informe puede cambiarlo.");
    return { ok: true };
  });

export const borrarInformeGuardado = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await exigirMiembro(supabase, data.clinicId, userId);
    const { data: filas, error } = await supabase
      .from("saved_reports")
      .delete()
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No pudimos borrar el informe."));
    if (!filas?.length) throw new Error("No puedes borrar este informe.");
    return { ok: true };
  });
