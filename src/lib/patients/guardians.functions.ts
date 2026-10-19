import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { isUndefinedTableError, mensajeDb } from "@/lib/db-errors";
import { toE164 } from "@/lib/messaging/telefonos";
import { tutorSchema, type Parentesco, type Tutor } from "@/lib/patients/tutor";

/**
 * Tutor o representante legal del paciente (CLI-11). Es un dato de contacto,
 * como el teléfono de la ficha: lo ve todo miembro de la clínica y lo edita
 * todo rol salvo contabilidad (RLS de `patient_guardians`, migración
 * 20261019180000). Nunca se borra: se archiva, porque puede haber firmado
 * un consentimiento.
 */

const COLUMNAS =
  "id, full_name, document_id, relationship, relationship_detail, phone, email, is_primary, archived_at";

type FilaTutor = {
  id: string;
  full_name: string;
  document_id: string;
  relationship: string;
  relationship_detail: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  archived_at: string | null;
};

function mapTutor(r: FilaTutor): Tutor {
  return {
    id: r.id,
    fullName: r.full_name,
    documentId: r.document_id,
    relationship: r.relationship as Parentesco,
    relationshipDetail: r.relationship_detail,
    phone: r.phone,
    email: r.email,
    isPrimary: r.is_primary,
    archivedAt: r.archived_at,
  };
}

/**
 * Tutores vigentes del paciente. `disponible: false` mientras la migración
 * no esté aplicada: la ficha esconde la sección en vez de romperse.
 */
export const listGuardians = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ disponible: boolean; items: Tutor[] }> => {
    const { data: rows, error } = await context.supabase
      .from("patient_guardians")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .is("archived_at", null)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (error && isUndefinedTableError(error)) return { disponible: false, items: [] };
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los tutores del paciente."));
    return { disponible: true, items: (rows ?? []).map((r) => mapTutor(r as FilaTutor)) };
  });

async function paisDeLaClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("clinics")
    .select("country")
    .eq("id", clinicId)
    .maybeSingle();
  return data?.country ?? null;
}

/** Crea o edita un tutor. Marcarlo principal le quita la marca al anterior. */
export const saveGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        guardianId: z.string().uuid().optional(),
        tutor: tutorSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const t = data.tutor;
    const pais = t.phone?.trim() ? await paisDeLaClinica(supabase, data.clinicId) : null;
    const telefono = t.phone?.trim() ? (toE164(t.phone.trim(), pais) ?? t.phone.trim()) : null;
    const campos = {
      full_name: t.fullName,
      document_id: t.documentId,
      relationship: t.relationship,
      relationship_detail: t.relationshipDetail?.trim() || null,
      phone: telefono,
      email: t.email?.trim() || null,
      is_primary: t.isPrimary,
    };

    if (t.isPrimary) {
      // El índice único admite un solo principal vigente por paciente.
      let quitar = supabase
        .from("patient_guardians")
        .update({ is_primary: false })
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .eq("is_primary", true)
        .is("archived_at", null);
      if (data.guardianId) quitar = quitar.neq("id", data.guardianId);
      const { error } = await quitar;
      if (error) throw new Error("No tienes permisos para editar los tutores del paciente.");
    }

    if (data.guardianId) {
      const { error } = await supabase
        .from("patient_guardians")
        .update(campos)
        .eq("id", data.guardianId)
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .is("archived_at", null);
      if (error) throw new Error("No tienes permisos para editar los tutores del paciente.");
    } else {
      const { error } = await supabase.from("patient_guardians").insert({
        ...campos,
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        created_by: userId,
      });
      if (error && isUndefinedTableError(error))
        throw new Error("El registro de tutores todavía no está habilitado.");
      if (error) throw new Error(mensajeDb(error, "No tienes permisos para agregar tutores."));
    }
    return { ok: true };
  });

/** Archiva un tutor (deja de ser vigente; su historia y sus firmas quedan). */
export const archiveGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), guardianId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patient_guardians")
      .update({ archived_at: new Date().toISOString(), archived_by: context.userId })
      .eq("id", data.guardianId)
      .eq("clinic_id", data.clinicId)
      .is("archived_at", null);
    if (error) throw new Error("No tienes permisos para quitar este tutor.");
    return { ok: true };
  });
