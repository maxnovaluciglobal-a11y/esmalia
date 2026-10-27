import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * Paso de `/api/demo-reset` para el panel de Hoy (Ola 11 · frente B):
 *
 * - Una reserva en línea `tentativa` para mañana, así Hoy muestra la alerta
 *   "reservas en línea por aceptar" y el bloque de recepción (PAN-07). Es una
 *   cita de la propia semilla (la última sin confirmar de mañana) marcada como
 *   reserva en línea: no inventa pacientes.
 * - El aviso de stock bajo (REC-10) en la campana y el centro de
 *   notificaciones: la semilla deja insumos bajo el mínimo pero escritos de
 *   una vez, sin cruce. Se hace pasar el primero por el cruce (mínimo a null y
 *   de vuelta) para que el trigger `avisar_stock_bajo` mande el aviso de
 *   verdad. El trigger no duplica si ya hay uno sin leer.
 *
 * Idempotente y nunca lanza: un error se registra y el reset sigue.
 */

type Admin = SupabaseClient<Database>;

function diaEn(zona: string, offset: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offset * 86_400_000));
}

export async function sembrarPanelDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id, timezone")
      .eq("is_demo", true)
      .limit(1)
      .maybeSingle();
    if (!clinica) return;
    const zona = clinica.timezone || "America/Santiago";

    // ── Reserva en línea por aceptar (mañana) ──────────────────────────────
    const { count: yaHay } = await admin
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinica.id)
      .eq("status", "tentativa")
      .eq("booking_source", "reserva_en_linea")
      .gte("starts_at", new Date().toISOString());
    if (!yaHay) {
      const manana = diaEn(zona, 1);
      const pasado = diaEn(zona, 2);
      const { data: candidata } = await admin
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinica.id)
        .eq("status", "tentativa")
        .is("patient_confirmed_at", null)
        .gte("starts_at", `${manana}T00:00:00Z`)
        .lt("starts_at", `${pasado}T12:00:00Z`)
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (candidata) {
        const { error } = await admin
          .from("appointments")
          .update({ booking_source: "reserva_en_linea" })
          .eq("id", candidata.id)
          .eq("clinic_id", clinica.id);
        if (error) throw error;
      }
    }

    // ── Aviso de stock bajo (REC-10) ───────────────────────────────────────
    const { data: insumos } = await admin
      .from("inventory_items")
      .select("id, current_stock, min_stock")
      .eq("clinic_id", clinica.id)
      .eq("is_active", true)
      .not("min_stock", "is", null)
      .order("name")
      .limit(50);
    const bajo = (insumos ?? []).find(
      (i) => i.min_stock !== null && Number(i.current_stock) <= Number(i.min_stock),
    );
    if (bajo) {
      const minimo = bajo.min_stock;
      const quitar = await admin
        .from("inventory_items")
        .update({ min_stock: null })
        .eq("id", bajo.id)
        .eq("clinic_id", clinica.id);
      if (quitar.error) throw quitar.error;
      const volver = await admin
        .from("inventory_items")
        .update({ min_stock: minimo })
        .eq("id", bajo.id)
        .eq("clinic_id", clinica.id);
      if (volver.error) throw volver.error;
    }
  } catch (e) {
    console.error("[demo-reset] no se pudo sembrar el panel de Hoy de la demo", e);
  }
}
