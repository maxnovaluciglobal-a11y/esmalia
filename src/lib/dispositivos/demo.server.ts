import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * Paso de `/api/demo-reset` (Ola 14 · AUT-06): la clínica demo muestra en
 * Ajustes → Dispositivos un tótem, una TV de sala y una pantalla de box de
 * ejemplo. SIN vincular: no tienen token ni código, así que no hay ningún
 * token usable público (la demo además no puede emitir códigos: lo frena la
 * base). Idempotente y nunca lanza.
 */
export async function sembrarDispositivosDeLaDemo(admin: SupabaseClient<Database>): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id")
      .eq("is_demo", true)
      .limit(1)
      .maybeSingle();
    if (!clinica) return;
    const { count } = await admin
      .from("clinic_devices")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id);
    if (count) return;
    const { data: sucursal } = await admin
      .from("branches")
      .select("id")
      .eq("clinic_id", clinica.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!sucursal) return;
    const { data: box } = await admin
      .from("operatories")
      .select("id")
      .eq("clinic_id", clinica.id)
      .eq("branch_id", sucursal.id)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();
    const filas: Database["public"]["Tables"]["clinic_devices"]["Insert"][] = [
      { clinic_id: clinica.id, branch_id: sucursal.id, kind: "totem", name: "Tótem de recepción" },
      { clinic_id: clinica.id, branch_id: sucursal.id, kind: "sala", name: "TV sala de espera" },
    ];
    if (box) {
      filas.push({
        clinic_id: clinica.id,
        branch_id: sucursal.id,
        kind: "box",
        name: "Pantalla del box 1",
        operatory_id: box.id,
      });
    }
    const { error } = await admin.from("clinic_devices").insert(filas);
    if (error) throw error;
  } catch (e) {
    console.error("[demo-reset] no se pudieron sembrar los dispositivos de la demo", e);
  }
}
