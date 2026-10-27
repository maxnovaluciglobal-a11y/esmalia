import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/** Dirección fija del link de reserva de la clínica demo. */
export const SLUG_DEMO = "clinica-demo";

/**
 * Paso de `/api/demo-reset`: deja la reserva en línea encendida en la
 * clínica demo (`/reservar/clinica-demo`) con sus tipos de cita y hasta 6
 * procedimientos favoritos del arancel. Idempotente (upsert). Nunca lanza:
 * un error no tumba el reset.
 */
export async function prepararReservaDeLaDemo(admin: SupabaseClient<Database>): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id")
      .eq("is_demo", true)
      .limit(1)
      .maybeSingle();
    if (!clinica) return;
    const [tipos, procs] = await Promise.all([
      admin
        .from("appointment_types")
        .select("id")
        .eq("clinic_id", clinica.id)
        .eq("is_active", true)
        .limit(30),
      admin
        .from("procedures")
        .select("id")
        .eq("clinic_id", clinica.id)
        .eq("is_active", true)
        .order("is_favorite", { ascending: false })
        .order("position", { ascending: true, nullsFirst: false })
        .limit(6),
    ]);
    const { error } = await admin.from("online_booking_settings").upsert(
      {
        clinic_id: clinica.id,
        enabled: true,
        slug: SLUG_DEMO,
        min_notice_hours: 2,
        max_days_ahead: 30,
        bookable_appointment_type_ids: (tipos.data ?? []).map((t) => t.id),
        bookable_procedure_ids: (procs.data ?? []).map((p) => p.id),
        welcome_note: "Clínica de demostración: las reservas no llegan a ninguna clínica real.",
      },
      { onConflict: "clinic_id" },
    );
    if (error) throw error;
  } catch (e) {
    console.error("[demo-reset] no se pudo preparar la reserva en línea de la demo", e);
  }
}
