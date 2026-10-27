import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { appOrigin } from "@/lib/app-origin.server";
import { tokenRecallReserva } from "@/lib/reserva/enlace-cita.server";
import { lineaDeReserva } from "@/lib/reserva/mensajes";

/**
 * MKT-06: línea con el link de reserva para el mensaje de recall, o null si
 * la clínica no tiene la reserva en línea encendida. El link lleva un token
 * de recall (propósito propio) que solo precarga el nombre del paciente.
 * Se lee con el cliente del usuario (RLS: miembro de la clínica).
 */
export async function lineaDeRecallConReserva(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  patientId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("online_booking_settings")
    .select("slug, enabled")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error || !data?.enabled) return null;
  const token = tokenRecallReserva({ patientId, clinicId });
  return lineaDeReserva(`${appOrigin()}/reservar/${data.slug}?r=${token}`);
}
