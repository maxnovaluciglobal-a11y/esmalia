import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  destinatarioDeComunicaciones,
  esMenorDeEdad,
  type Destinatario,
  type Parentesco,
  type Tutor,
} from "@/lib/patients/tutor";

/**
 * Destinatario real de un mensaje al paciente (CLI-11): si es menor y tiene
 * tutor vigente, el tutor. Solo consulta los tutores cuando el paciente es
 * menor, así que a un adulto no le agrega ninguna lectura.
 *
 * Si la tabla de tutores todavía no existe (migración sin aplicar) o la
 * lectura falla, cae al paciente: un recordatorio de cita no se puede
 * quedar sin salir por esto.
 */
export async function resolverDestinatario(
  supabase: SupabaseClient<Database>,
  datos: {
    clinicId: string;
    patientId: string;
    fechaNacimiento: string | null;
    telefono: string | null;
    email: string | null;
    timezone: string | null;
  },
): Promise<Destinatario> {
  const hoy = hoyISO(datos.timezone ?? undefined);
  let tutores: Tutor[] = [];
  if (esMenorDeEdad(datos.fechaNacimiento, hoy) === true) {
    const { data, error } = await supabase
      .from("patient_guardians")
      .select(
        "id, full_name, document_id, relationship, relationship_detail, phone, email, is_primary, archived_at",
      )
      .eq("clinic_id", datos.clinicId)
      .eq("patient_id", datos.patientId)
      .is("archived_at", null);
    if (!error) {
      tutores = (data ?? []).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        documentId: r.document_id,
        relationship: r.relationship as Parentesco,
        relationshipDetail: r.relationship_detail,
        phone: r.phone,
        email: r.email,
        isPrimary: r.is_primary,
        archivedAt: r.archived_at,
      }));
    }
  }
  return destinatarioDeComunicaciones({
    fechaNacimiento: datos.fechaNacimiento,
    hoy,
    telefonoPaciente: datos.telefono,
    emailPaciente: datos.email,
    tutores,
  });
}
