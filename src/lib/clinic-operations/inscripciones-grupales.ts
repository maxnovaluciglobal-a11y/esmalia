import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { unirCitasDelPaciente, type Asistencia } from "@/lib/clinic-operations/citas-grupales";
import { mensajeDb } from "@/lib/db-errors";
import { enBloques, mapConLimite } from "@/lib/paginacion";

/**
 * Citas grupales para TODOS los inscritos (cierre de la fase, ítem 4).
 *
 * `appointments.patient_id` de una cita grupal es solo el titular (el primer
 * inscrito vigente). Cualquier lugar que busca «las citas de este paciente»
 * por esa columna se pierde a los demás inscritos. Este módulo trae, para una
 * lista de pacientes, las inscripciones VIGENTES, para que cada consulta
 * sume las citas grupales de cada uno (portal, «mis datos», recordatorios,
 * campañas, confirmación). Recibe el cliente: el portal y el webhook van con
 * service_role y el staff con su sesión (la RLS decide).
 *
 * Nada de esto envía mensajes: solo lee.
 */

type Db = SupabaseClient<Database>;

export interface InscripcionVigente {
  /** id de la fila del inscrito (`appointment_group_participants.id`). */
  id: string;
  appointment_id: string;
  patient_id: string;
  attendance: Asistencia;
  enrolled_at: string;
  patient_confirmed_at: string | null;
}

/** Inscripciones vigentes (sin los retirados) de los pacientes dados, en esa clínica. */
export async function inscripcionesVigentesDe(
  supabase: Db,
  clinicId: string,
  patientIds: readonly string[],
): Promise<InscripcionVigente[]> {
  const ids = [...new Set(patientIds)];
  if (ids.length === 0) return [];
  const bloques = await mapConLimite(enBloques(ids), 4, (tanda) =>
    supabase
      .from("appointment_group_participants")
      .select("id, appointment_id, patient_id, attendance, enrolled_at, patient_confirmed_at")
      .eq("clinic_id", clinicId)
      .is("withdrawn_at", null)
      .in("patient_id", tanda),
  );
  const error = bloques.find((b) => b.error)?.error;
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar las citas grupales."));
  return bloques.flatMap((b) => (b.data ?? []) as InscripcionVigente[]);
}

/**
 * Citas (por id) de a bloques: un `.in("id", …)` con cientos de ids no entra
 * en la URL. `consulta` arma la lectura con los filtros propios del caso.
 */
export async function citasPorIds<T>(
  ids: readonly string[],
  consulta: (
    tanda: string[],
  ) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  mensajeError: string,
): Promise<T[]> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return [];
  const bloques = await mapConLimite(enBloques(unicos), 4, consulta);
  const error = bloques.find((b) => b.error)?.error;
  if (error) throw new Error(mensajeDb(error, mensajeError));
  return bloques.flatMap((b) => b.data ?? []);
}

export interface CitaProxima {
  id: string;
  treatment_label: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  branch_id: string;
  professional_id: string;
}

/**
 * Próximas citas (no canceladas) de un paciente para su portal: las suyas y
 * las grupales donde está inscrito, de la más próxima a la más lejana. De una
 * grupal muestra el nombre de la actividad, nunca nada de los demás inscritos.
 * `individuales` son las que ya leyó el portal por `patient_id`; el titular de
 * una grupal aparece ahí y por su inscripción, y se cuenta una vez.
 */
export async function proximasCitasConGrupales(
  supabase: Db,
  clinicId: string,
  patientId: string,
  individuales: readonly CitaProxima[],
  ahoraIso: string,
  limite = 10,
): Promise<CitaProxima[]> {
  const inscripciones = await inscripcionesVigentesDe(supabase, clinicId, [patientId]);
  const ids = inscripciones.map((i) => i.appointment_id);
  const [grupales, titulos] = await Promise.all([
    citasPorIds(
      ids,
      (tanda) =>
        supabase
          .from("appointments")
          .select("id, treatment_label, starts_at, ends_at, status, branch_id, professional_id")
          .eq("clinic_id", clinicId)
          .in("id", tanda)
          .gte("starts_at", ahoraIso)
          .neq("status", "cancelada"),
      "No pudimos cargar tus próximas citas.",
    ),
    citasPorIds(
      ids,
      (tanda) =>
        supabase
          .from("appointment_groups")
          .select("appointment_id, title")
          .eq("clinic_id", clinicId)
          .in("appointment_id", tanda),
      "No pudimos cargar tus próximas citas.",
    ),
  ]);
  const tituloDe = new Map(titulos.map((t) => [t.appointment_id, t.title]));
  const esGrupal = new Set(grupales.map((g) => g.id));
  return unirCitasDelPaciente(
    individuales.filter((c) => !esGrupal.has(c.id)),
    grupales.map((g) => ({ ...g, treatment_label: tituloDe.get(g.id) ?? g.treatment_label })),
  ).slice(0, limite);
}
