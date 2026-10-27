import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  citasPorIds,
  inscripcionesVigentesDe,
} from "@/lib/clinic-operations/inscripciones-grupales";
import { fechaCortaHora } from "@/lib/formato-fecha";
import { esConfirmacionDePaciente } from "@/lib/messaging/patient-confirmation";

/**
 * El «sí» de un paciente por WhatsApp (webhook de Meta), atribuido a su
 * próxima cita. Vive acá y no en la ruta para poder probarlo contra la base.
 * Solo escribe el eje del paciente; el estado de la cita es del profesional.
 */
type SupabaseAdminClient = SupabaseClient<Database>;

/** Ventana en la que un "sí" suelto se puede atribuir a una cita concreta. */
const DIAS_ATRIBUIBLES = 30;

/**
 * Anota que el paciente avisó que viene a su próxima cita.
 *
 * Escribe SOLO `patient_confirmed_at`/`patient_confirmed_via`. `status`,
 * `confirmed_at` y `confirmed_by` no se tocan: son el visto bueno del
 * profesional y el paciente no tiene por qué poder moverlos. Ese es
 * exactamente el error que llevó a remover la confirmación automática.
 *
 * Devuelve la fecha legible de la cita anotada, o null si no había ninguna a
 * la que atribuir el mensaje (y entonces el aviso al equipo es el genérico).
 */
export async function anotarConfirmacionDelPaciente(
  supabaseAdmin: SupabaseAdminClient,
  clinicId: string,
  patientId: string,
  bodyText: string,
): Promise<string | null> {
  if (!esConfirmacionDePaciente(bodyText)) return null;

  const ahora = new Date();
  const limite = new Date(ahora.getTime() + DIAS_ATRIBUIBLES * 24 * 60 * 60 * 1000);

  // Citas grupales (AGE-22): la cita cuelga del titular, pero el aviso es de
  // cada inscrito. Un «sí» de quien está inscrito marca SU inscripción, no la
  // cita entera (que es también la del resto del grupo).
  const inscripciones = await inscripcionesVigentesDe(supabaseAdmin, clinicId, [patientId]);
  const idsGrupales = new Set(inscripciones.map((i) => i.appointment_id));

  const { data: individuales } = await supabaseAdmin
    .from("appointments")
    .select("id, starts_at, patient_confirmed_at")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .gt("starts_at", ahora.toISOString())
    .lt("starts_at", limite.toISOString())
    .not("status", "in", "(cancelada,ausente,finalizada)")
    .order("starts_at", { ascending: true })
    .limit(10);
  const cita = (individuales ?? []).find((c) => !idsGrupales.has(c.id)) ?? null;

  const grupales = await citasPorIds(
    [...idsGrupales],
    (tanda) =>
      supabaseAdmin
        .from("appointments")
        .select("id, starts_at")
        .eq("clinic_id", clinicId)
        .in("id", tanda)
        .gt("starts_at", ahora.toISOString())
        .lt("starts_at", limite.toISOString())
        .not("status", "in", "(cancelada,ausente,finalizada)"),
    "No pudimos leer las citas grupales.",
  ).catch(() => []);
  const grupal = [...grupales].sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;

  // Sin cita próxima el "sí" no se puede atribuir a nada. No se inventa.
  if (!cita && !grupal) return null;
  const esGrupal = Boolean(grupal && (!cita || grupal.starts_at < cita.starts_at));

  let inicio: string;
  if (esGrupal && grupal) {
    const inscripcion = inscripciones.find((i) => i.appointment_id === grupal.id);
    if (!inscripcion) return null;
    // Ya estaba anotado: no se pisa la marca original ni se re-avisa al equipo.
    if (inscripcion.patient_confirmed_at) return null;
    const { error } = await supabaseAdmin
      .from("appointment_group_participants")
      .update({ patient_confirmed_at: ahora.toISOString(), patient_confirmed_via: "whatsapp" })
      .eq("id", inscripcion.id)
      .eq("clinic_id", clinicId);
    if (error) {
      console.error("[whatsapp-webhook] no se pudo anotar la confirmación:", error.message);
      return null;
    }
    inicio = grupal.starts_at;
  } else if (cita) {
    // Ya estaba anotado: no se pisa la marca original ni se re-avisa al equipo.
    if (cita.patient_confirmed_at) return null;
    const { error } = await supabaseAdmin
      .from("appointments")
      .update({ patient_confirmed_at: ahora.toISOString(), patient_confirmed_via: "whatsapp" })
      .eq("id", cita.id);
    if (error) {
      console.error("[whatsapp-webhook] no se pudo anotar la confirmación:", error.message);
      return null;
    }
    inicio = cita.starts_at;
  } else {
    return null;
  }

  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("timezone")
    .eq("id", clinicId)
    .maybeSingle();
  return fechaCortaHora(inicio, clinica?.timezone);
}
