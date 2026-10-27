import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { mapearPanelDeHoy, type PanelDeHoy } from "@/lib/panel/panel-por-rol";

/**
 * Panel de Hoy por rol (Ola 11 · PAN-03..08, REC-10). Par en el servidor de
 * los bloques y alertas de `/dashboard` (regla 15): la función de la base
 * `panel_de_hoy` corre con la RLS del usuario y arma cada sección solo si su
 * rol real (con los ajustes por persona) la puede ver; el dinero, solo con
 * finance:view. La pantalla además filtra por el rol simulado.
 */
export const getPanelDeHoy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PanelDeHoy> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "dashboard:view");
    const { data: raw, error } = await supabase.rpc("panel_de_hoy", {
      p_clinic_id: data.clinicId,
    });
    if (error) throw new Error("No pudimos cargar lo que requiere acción hoy.");
    return mapearPanelDeHoy(raw);
  });
