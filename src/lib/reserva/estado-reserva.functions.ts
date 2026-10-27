import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";

/**
 * ¿La reserva en línea está encendida? Lo usa Recordatorios (A+) para decir,
 * en la lista de controles periódicos, que el mensaje sale con el link de
 * reserva (MKT-06, `lineaDeRecallConReserva`). Devuelve solo el booleano: ni
 * el slug ni el resto de la configuración, que sigue siendo de owner/admin.
 *
 * Mismo permiso que la pantalla que lo muestra (`agenda:manage`). La lectura
 * va con el cliente del usuario: la RLS de `online_booking_settings` deja leer
 * a los miembros de la clínica, igual que al armar el mensaje de recall.
 */
export const getReservaEncendida = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ encendida: boolean }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "agenda:manage");
    const { data: fila, error } = await supabase
      .from("online_booking_settings")
      .select("enabled")
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error("No pudimos revisar la reserva en línea.");
    return { encendida: fila?.enabled ?? false };
  });
