import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * Paso de `/api/demo-reset` para el cierre de la fase (frente pacientes y
 * grupales), para que la demo muestre lo nuevo:
 *
 * - Mapa de calor con disponibilidad neta: un almuerzo de toda la clínica de
 *   lunes a viernes de 13:00 a 14:00 (se repite cada semana). Sin bloqueos el
 *   mapa de Informes → Agenda no tiene nada que descontar.
 * - Citas grupales para todos los inscritos: dos de los inscritos de la
 *   charla de hoy ya «avisaron que vienen» (cada uno por su inscripción).
 *
 * El sexo de las fichas de la demo lo completa `informes.server.ts` junto a
 * los demás datos demográficos. Idempotente y nunca lanza: un error se
 * registra y el reset sigue.
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

/** Día de la semana (0 = domingo) de una fecha de calendario YYYY-MM-DD. */
function diaDeLaSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export async function sembrarCierrePacientesGrupalesDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id, timezone")
      .eq("is_demo", true)
      .limit(1)
      .maybeSingle();
    if (!clinica) return;
    const zona = clinica.timezone || "America/Santiago";
    await sembrarAlmuerzo(admin, clinica.id, zona);
    await sembrarAvisosDeInscritos(admin, clinica.id, zona);
  } catch (e) {
    console.error("[demo-reset] cierre pacientes y grupales:", e instanceof Error ? e.message : e);
  }
}

async function sembrarAlmuerzo(admin: Admin, clinicId: string, zona: string) {
  const { count } = await admin
    .from("agenda_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("kind", "bloqueo")
    .eq("reason", "almuerzo");
  if (count) return;
  // Para cada día hábil de la semana, el primer día que cae así hace ~4 semanas.
  const filas: Database["public"]["Tables"]["agenda_exceptions"]["Insert"][] = [];
  for (let i = 0; i < 7 && filas.length < 5; i++) {
    const dia = diaEn(zona, -28 + i);
    const dow = diaDeLaSemana(dia);
    if (dow === 0 || dow === 6) continue;
    filas.push({
      clinic_id: clinicId,
      kind: "bloqueo",
      reason: "almuerzo",
      note: "Almuerzo del equipo",
      starts_local: `${dia}T13:00:00`,
      ends_local: `${dia}T14:00:00`,
      repeat_weekly: true,
    });
  }
  const { error } = await admin.from("agenda_exceptions").insert(filas);
  if (error) throw new Error(`almuerzo: ${error.message}`);
}

async function sembrarAvisosDeInscritos(admin: Admin, clinicId: string, zona: string) {
  const hoy = diaEn(zona, 0);
  const { data: grupos } = await admin
    .from("appointment_groups")
    .select("appointment_id, title")
    .eq("clinic_id", clinicId);
  if (!grupos?.length) return;
  const { data: citas } = await admin
    .from("appointments")
    .select("id, starts_at")
    .eq("clinic_id", clinicId)
    .in(
      "id",
      grupos.map((g) => g.appointment_id),
    )
    .gte("starts_at", `${hoy}T00:00:00Z`)
    .order("starts_at", { ascending: true })
    .limit(1);
  const cita = citas?.[0];
  if (!cita) return;
  // Idempotente: si alguien ya avisó en esa cita, no se siembra de nuevo.
  const { count } = await admin
    .from("appointment_group_participants")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("appointment_id", cita.id)
    .not("patient_confirmed_at", "is", null);
  if (count) return;
  const { data: inscritos } = await admin
    .from("appointment_group_participants")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("appointment_id", cita.id)
    .is("withdrawn_at", null)
    .is("patient_confirmed_at", null)
    .order("enrolled_at", { ascending: true })
    .limit(2);
  for (const p of inscritos ?? []) {
    await admin
      .from("appointment_group_participants")
      .update({ patient_confirmed_at: new Date().toISOString(), patient_confirmed_via: "whatsapp" })
      .eq("id", p.id)
      .eq("clinic_id", clinicId);
  }
}
