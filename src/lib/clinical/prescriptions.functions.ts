import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decodeDataUrl, sha256Hex } from "@/lib/clinical/clinical-documents.functions";
import {
  normalizarItem,
  RecetaItemSchema,
  RecetaItemsSchema,
  type RecetaEmitida,
} from "@/lib/clinical/recetas";
import { isUndefinedTableError, mensajeDb } from "@/lib/db-errors";

const BUCKET = "clinical-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

/** Profesionales activos con lo que hace falta para consentimientos y recetas. */
export type ProfesionalClinico = {
  id: string;
  fullName: string;
  licenseNumber: string | null;
  userId: string | null;
};

export const listProfesionalesClinicos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProfesionalClinico[]> => {
    const { data: rows, error } = await context.supabase
      .from("professionals")
      .select("id, full_name, license_number, user_id")
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los profesionales de la clínica."));
    return (rows ?? []).map((p) => ({
      id: p.id,
      fullName: p.full_name,
      licenseNumber: p.license_number?.trim() || null,
      userId: p.user_id,
    }));
  });

export type RecetaDeFicha = RecetaEmitida & { signatureUrl: string | null };

export type RecetasDelPaciente = {
  /** false = la migración 20261019190000 todavía no se aplicó. */
  disponible: boolean;
  recetas: RecetaDeFicha[];
};

const COLUMNAS =
  "id, year, number, issued_at, professional_name_snapshot, professional_license_snapshot, professional_specialty_snapshot, clinic_name_snapshot, clinic_legal_name_snapshot, clinic_tax_id_snapshot, clinic_address_snapshot, clinic_phone_snapshot, patient_name_snapshot, patient_birth_date_snapshot, items, instructions, signature_storage_path, content_sha256, voided_at, void_reason";

function itemsDesdeJson(valor: unknown) {
  const parsed = z.array(RecetaItemSchema).safeParse(valor);
  return parsed.success ? parsed.data : [];
}

export const listPatientPrescriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RecetasDelPaciente> => {
    const { data: rows, error } = await context.supabase
      .from("prescriptions")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("issued_at", { ascending: false });
    if (error && isUndefinedTableError(error)) return { disponible: false, recetas: [] };
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las recetas del paciente."));

    const recetas: RecetaDeFicha[] = [];
    for (const r of rows ?? []) {
      let signatureUrl: string | null = null;
      if (r.signature_storage_path) {
        const { data: signed } = await context.supabase.storage
          .from(BUCKET)
          .createSignedUrl(r.signature_storage_path, SIGNED_URL_TTL_SECONDS);
        signatureUrl = signed?.signedUrl ?? null;
      }
      recetas.push({
        id: r.id,
        year: r.year,
        number: r.number,
        issuedAt: r.issued_at,
        professionalName: r.professional_name_snapshot,
        professionalLicense: r.professional_license_snapshot,
        professionalSpecialty: r.professional_specialty_snapshot,
        clinicName: r.clinic_name_snapshot,
        clinicLegalName: r.clinic_legal_name_snapshot,
        clinicTaxId: r.clinic_tax_id_snapshot,
        clinicAddress: r.clinic_address_snapshot,
        clinicPhone: r.clinic_phone_snapshot,
        patientName: r.patient_name_snapshot,
        patientBirthDate: r.patient_birth_date_snapshot,
        items: itemsDesdeJson(r.items),
        instructions: r.instructions,
        contentSha256: r.content_sha256,
        voidedAt: r.voided_at,
        voidReason: r.void_reason,
        signatureUrl,
      });
    }
    return { disponible: true, recetas };
  });

/**
 * Emite una receta. Los datos del profesional, de la clínica y del paciente,
 * el correlativo, la fecha y el hash los pone la base (trigger
 * `prescriptions_emitir`): acá solo viaja lo que decide el profesional.
 */
export const issuePrescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        professionalId: z.string().uuid(),
        items: RecetaItemsSchema,
        instructions: z.string().trim().max(2000).optional().or(z.literal("")),
        // Firma manuscrita opcional: sin trazo, el PDF deja la línea para
        // firmar y timbrar a mano al imprimir.
        signatureDataUrl: z.string().max(2_000_000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let path: string | null = null;
    let signatureSha256: string | null = null;
    if (data.signatureDataUrl) {
      const { bytes, mimeType } = decodeDataUrl(data.signatureDataUrl);
      if (!mimeType.startsWith("image/")) throw new Error("La firma debe ser una imagen.");
      path = `${data.clinicId}/${data.patientId}/prescription-signatures/${crypto.randomUUID()}.png`;
      const { error: uploadError } = await context.supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: mimeType, upsert: false });
      if (uploadError)
        throw new Error(mensajeDb(uploadError, "No pudimos subir la firma de la receta."));
      signatureSha256 = await sha256Hex(bytes);
    }

    // Snapshots, correlativo, fecha y hash no viajan: los completa el trigger.
    const { data: fila, error } = await context.supabase
      .from("prescriptions")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        professional_id: data.professionalId,
        items: data.items.map(normalizarItem),
        instructions: data.instructions?.trim() || null,
        signature_storage_path: path,
        signature_sha256: signatureSha256,
        issued_by: context.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (path) await context.supabase.storage.from(BUCKET).remove([path]);
      if (isUndefinedTableError(error))
        throw new Error("Las recetas todavía no están activas en tu clínica.");
      throw new Error(mensajeDb(error, "No tienes permisos para emitir recetas."));
    }
    return { id: fila.id };
  });

export const voidPrescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        prescriptionId: z.string().uuid(),
        reason: z.string().trim().min(3, "Escribe el motivo de la anulación.").max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await context.supabase
      .from("prescriptions")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: context.userId,
        void_reason: data.reason,
      })
      .eq("id", data.prescriptionId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para anular esta receta."));
    if (!filas?.length) throw new Error("No tienes permisos para anular esta receta.");
    return { ok: true };
  });
