import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { esPiezaFdi, type OrigenPlantilla } from "@/lib/clinical/consentimientos";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { isUndefinedColumnError, mensajeDb } from "@/lib/db-errors";
import { idsDeLaFicha } from "@/lib/patients/fusion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const BUCKET = "clinical-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Archivo inválido: formato de datos no reconocido.");
  const [, mimeType, base64] = match;
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  return { bytes, mimeType };
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

// PNG 1x1 transparente — placeholder de `signature_storage_path` cuando el
// consentimiento se firma electrónicamente (nombre tipeado) en vez de con
// trazo manuscrito, ver `signPatientConsent`. `signed_by_name` es la
// evidencia real en ese caso; esta imagen solo cumple el NOT NULL de la
// columna sin fingir un trazo que nunca existió.
const ELECTRONIC_SIGNATURE_PLACEHOLDER = {
  bytes: Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  ),
  mimeType: "image/png",
};

// ---------------------------------------------------------------
// Documentos: imágenes y radiografías
// ---------------------------------------------------------------

export type PatientDocument = {
  id: string;
  kind: "image" | "radiograph" | "other";
  filename: string;
  notes: string | null;
  createdAt: string;
  uploadedBy: string;
  archivedAt: string | null;
  url: string | null;
};

export const listPatientDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PatientDocument[]> => {
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(context.supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "documentos",
    });
    // CLI-06: un documento o consentimiento firmado no se reescribe al
    // fusionar fichas: se lee también desde las fichas fusionadas en esta.
    const fichas = await idsDeLaFicha(context.supabase, data.clinicId, data.patientId);
    const { data: rows, error } = await context.supabase
      .from("patient_documents")
      .select("id, kind, storage_path, filename, notes, created_at, uploaded_by, archived_at")
      .eq("clinic_id", data.clinicId)
      .in("patient_id", fichas)
      .order("created_at", { ascending: false });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los documentos del paciente."));

    const documents: PatientDocument[] = [];
    for (const row of rows ?? []) {
      let url: string | null = null;
      if (!row.archived_at) {
        const { data: signed } = await context.supabase.storage
          .from(BUCKET)
          .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
        url = signed?.signedUrl ?? null;
      }
      documents.push({
        id: row.id,
        kind: row.kind,
        filename: row.filename,
        notes: row.notes,
        createdAt: row.created_at,
        uploadedBy: row.uploaded_by,
        archivedAt: row.archived_at,
        url,
      });
    }
    await lectura;
    return documents;
  });

export const uploadPatientDocument = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        kind: z.enum(["image", "radiograph", "other"]),
        filename: z.string().trim().min(1).max(150),
        notes: z.string().trim().max(500).optional().or(z.literal("")),
        // data URL: "data:<mime>;base64,<contenido>" — tope 15MB decodificado.
        dataUrl: z.string().min(1).max(21_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { bytes, mimeType } = decodeDataUrl(data.dataUrl);
    if (bytes.byteLength > 15 * 1024 * 1024) {
      throw new Error("El archivo supera el máximo de 15MB.");
    }
    const path = `${data.clinicId}/${data.patientId}/${crypto.randomUUID()}-${safeFilename(data.filename)}`;

    const { error: uploadError } = await context.supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (uploadError)
      throw new Error(mensajeDb(uploadError, "No pudimos subir el documento clínico."));

    const { error: insertError } = await context.supabase.from("patient_documents").insert({
      clinic_id: data.clinicId,
      patient_id: data.patientId,
      kind: data.kind,
      storage_path: path,
      filename: data.filename,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      notes: data.notes?.trim() || null,
      uploaded_by: context.userId,
    });
    if (insertError) {
      await context.supabase.storage.from(BUCKET).remove([path]);
      throw new Error("No tienes permisos para subir documentos clínicos.");
    }
    return { ok: true };
  });

export const archivePatientDocument = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), documentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patient_documents")
      .update({ archived_at: new Date().toISOString(), archived_by: context.userId })
      .eq("id", data.documentId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para archivar este documento.");
    return { ok: true };
  });

// ---------------------------------------------------------------
// Consentimientos informados
// ---------------------------------------------------------------

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Buffer.from(digest).toString("hex");
}

export type ConsentTemplate = {
  id: string;
  title: string;
  procedure: string | null;
  body: string;
  risks: string | null;
  alternatives: string | null;
  active: boolean;
  source: OrigenPlantilla;
  reviewedAt: string | null;
};

const COLUMNAS_PLANTILLA =
  "id, title, procedure, body, risks, alternatives, active, source, reviewed_at";

export const listConsentTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ConsentTemplate[]> => {
    const { data: rows, error } = await context.supabase
      .from("consent_templates")
      .select(COLUMNAS_PLANTILLA)
      .eq("clinic_id", data.clinicId)
      .order("title", { ascending: true });
    if (error && isUndefinedColumnError(error)) {
      // Antes de aplicar la migración 20261019190000: solo título y texto.
      const { data: viejas, error: errorViejo } = await context.supabase
        .from("consent_templates")
        .select("id, title, body, active")
        .eq("clinic_id", data.clinicId)
        .order("title", { ascending: true });
      if (errorViejo)
        throw new Error(
          mensajeDb(errorViejo, "No pudimos cargar las plantillas de consentimiento."),
        );
      return (viejas ?? []).map((t) => ({
        ...t,
        procedure: null,
        risks: null,
        alternatives: null,
        source: "clinic" as const,
        reviewedAt: null,
      }));
    }
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar las plantillas de consentimiento."));
    return (rows ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      procedure: t.procedure,
      body: t.body,
      risks: t.risks,
      alternatives: t.alternatives,
      active: t.active,
      source: t.source === "esmalia_model" ? "esmalia_model" : "clinic",
      reviewedAt: t.reviewed_at,
    }));
  });

const PlantillaSchema = z.object({
  clinicId: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  procedure: z.string().trim().min(2).max(200),
  body: z.string().trim().min(10).max(8000),
  risks: z.string().trim().max(4000).optional().or(z.literal("")),
  alternatives: z.string().trim().max(4000).optional().or(z.literal("")),
});

export const createConsentTemplate = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => PlantillaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("consent_templates").insert({
      clinic_id: data.clinicId,
      title: data.title,
      procedure: data.procedure,
      body: data.body,
      risks: data.risks?.trim() || null,
      alternatives: data.alternatives?.trim() || null,
      created_by: context.userId,
    });
    if (error) throw new Error("No tienes permisos para crear plantillas de consentimiento.");
    return { ok: true };
  });

/**
 * Editar una plantilla no toca lo ya firmado: cada consentimiento guarda su
 * propio snapshot del texto.
 */
export const updateConsentTemplate = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    PlantillaSchema.extend({ templateId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("consent_templates")
      .update({
        title: data.title,
        procedure: data.procedure,
        body: data.body,
        risks: data.risks?.trim() || null,
        alternatives: data.alternatives?.trim() || null,
      })
      .eq("id", data.templateId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para editar plantillas de consentimiento.");
    return { ok: true };
  });

/** Marca (o desmarca) un modelo como revisado. Quién y cuándo lo estampa la base. */
export const setConsentTemplateReviewed = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), templateId: z.string().uuid(), reviewed: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("consent_templates")
      .update({ reviewed_at: data.reviewed ? new Date().toISOString() : null })
      .eq("id", data.templateId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para editar plantillas de consentimiento.");
    return { ok: true };
  });

export const setConsentTemplateActive = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), templateId: z.string().uuid(), active: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("consent_templates")
      .update({ active: data.active })
      .eq("id", data.templateId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para editar plantillas de consentimiento.");
    return { ok: true };
  });

export type PatientConsent = {
  id: string;
  titleSnapshot: string;
  procedureSnapshot: string | null;
  bodySnapshot: string;
  risksSnapshot: string | null;
  alternativesSnapshot: string | null;
  toothNumbers: number[];
  informedByName: string | null;
  informedByLicense: string | null;
  /** "tutor" si firmó el tutor o representante legal; null en firmas anteriores al dato. */
  signerRole: "paciente" | "tutor" | null;
  signerDocument: string | null;
  signerRelationship: string | null;
  signedByName: string;
  signedAt: string;
  contentSha256: string | null;
  revokedAt: string | null;
  signatureUrl: string | null;
};

export const listPatientConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PatientConsent[]> => {
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(context.supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "documentos",
    });
    // CLI-06: un documento o consentimiento firmado no se reescribe al
    // fusionar fichas: se lee también desde las fichas fusionadas en esta.
    const fichas = await idsDeLaFicha(context.supabase, data.clinicId, data.patientId);
    const nuevas = await context.supabase
      .from("patient_consents")
      .select(
        "id, title_snapshot, procedure_snapshot, body_snapshot, risks_snapshot, alternatives_snapshot, tooth_numbers, informed_by_name_snapshot, informed_by_license_snapshot, signer_role, signer_document_snapshot, signer_relationship_snapshot, signature_storage_path, signed_by_name, signed_at, content_sha256, revoked_at",
      )
      .eq("clinic_id", data.clinicId)
      .in("patient_id", fichas)
      .order("signed_at", { ascending: false });

    let rows: Array<Record<string, unknown>> | null = nuevas.data;
    if (nuevas.error && isUndefinedColumnError(nuevas.error)) {
      // Antes de aplicar la migración 20261019190000.
      const viejas = await context.supabase
        .from("patient_consents")
        .select(
          "id, title_snapshot, body_snapshot, signature_storage_path, signed_by_name, signed_at, revoked_at",
        )
        .eq("clinic_id", data.clinicId)
        .in("patient_id", fichas)
        .order("signed_at", { ascending: false });
      if (viejas.error)
        throw new Error(
          mensajeDb(viejas.error, "No pudimos cargar los consentimientos del paciente."),
        );
      rows = viejas.data;
    } else if (nuevas.error) {
      throw new Error(
        mensajeDb(nuevas.error, "No pudimos cargar los consentimientos del paciente."),
      );
    }

    const texto = (v: unknown) => (typeof v === "string" ? v : null);
    const consents: PatientConsent[] = [];
    for (const row of rows ?? []) {
      const { data: signed } = await context.supabase.storage
        .from(BUCKET)
        .createSignedUrl(String(row.signature_storage_path), SIGNED_URL_TTL_SECONDS);
      consents.push({
        id: String(row.id),
        titleSnapshot: String(row.title_snapshot),
        procedureSnapshot: texto(row.procedure_snapshot),
        bodySnapshot: String(row.body_snapshot),
        risksSnapshot: texto(row.risks_snapshot),
        alternativesSnapshot: texto(row.alternatives_snapshot),
        toothNumbers: Array.isArray(row.tooth_numbers) ? (row.tooth_numbers as number[]) : [],
        informedByName: texto(row.informed_by_name_snapshot),
        informedByLicense: texto(row.informed_by_license_snapshot),
        signerRole:
          row.signer_role === "paciente" || row.signer_role === "tutor" ? row.signer_role : null,
        signerDocument: texto(row.signer_document_snapshot),
        signerRelationship: texto(row.signer_relationship_snapshot),
        signedByName: String(row.signed_by_name),
        signedAt: String(row.signed_at),
        contentSha256: texto(row.content_sha256),
        revokedAt: texto(row.revoked_at),
        signatureUrl: signed?.signedUrl ?? null,
      });
    }
    await lectura;
    return consents;
  });

export const signPatientConsent = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        templateId: z.string().uuid().optional(),
        titleSnapshot: z.string().trim().min(2).max(120),
        procedureSnapshot: z.string().trim().min(2).max(200),
        bodySnapshot: z.string().trim().min(10).max(8000),
        risksSnapshot: z.string().trim().max(4000).optional().or(z.literal("")),
        alternativesSnapshot: z.string().trim().max(4000).optional().or(z.literal("")),
        // Quién explicó el procedimiento. La base copia su nombre y registro.
        informedByProfessionalId: z.string().uuid(),
        toothNumbers: z
          .array(z.number().int().refine(esPiezaFdi, "Pieza fuera de la notación FDI."))
          .max(32)
          .optional(),
        treatmentItemId: z.string().uuid().optional(),
        // Tutor o representante legal que firma (CLI-11). Obligatorio si el
        // paciente es menor: lo exige el trigger `stamp_patient_consent_signer`,
        // que además copia el nombre, documento y parentesco del tutor al
        // registro (lo que mande el cliente en `signedByName` se pisa).
        guardianId: z.string().uuid().optional(),
        signedByName: z.string().trim().min(2).max(120),
        // PNG del canvas de firma, data URL. Opcional a propósito: el canvas
        // es un widget de puntero puro (no hay forma significativa de
        // "dibujar" por teclado), así que un paciente/staff que usa teclado o
        // lector de pantalla no puede completarlo — sin esta alternativa el
        // flujo entero de consentimiento quedaba inalcanzable para esos
        // usuarios (auditoría de accesibilidad, 30-ago). Sin trazo, se sube
        // un placeholder y `signedByName` (ya obligatorio) queda como la
        // evidencia de quién firmó — mismo criterio que ya usa
        // `setQuoteStatus` al aceptar un presupuesto sin firma.
        signatureDataUrl: z.string().max(2_000_000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let bytes: Uint8Array;
    let mimeType: string;
    if (data.signatureDataUrl) {
      ({ bytes, mimeType } = decodeDataUrl(data.signatureDataUrl));
      if (!mimeType.startsWith("image/")) {
        throw new Error("La firma debe ser una imagen.");
      }
    } else {
      ({ bytes, mimeType } = ELECTRONIC_SIGNATURE_PLACEHOLDER);
    }
    const path = `${data.clinicId}/${data.patientId}/consent-signatures/${crypto.randomUUID()}.png`;

    const { error: uploadError } = await context.supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (uploadError)
      throw new Error(mensajeDb(uploadError, "No pudimos subir la firma del consentimiento."));

    const { error: insertError } = await context.supabase.from("patient_consents").insert({
      clinic_id: data.clinicId,
      patient_id: data.patientId,
      template_id: data.templateId ?? null,
      title_snapshot: data.titleSnapshot,
      procedure_snapshot: data.procedureSnapshot,
      body_snapshot: data.bodySnapshot,
      risks_snapshot: data.risksSnapshot?.trim() || null,
      alternatives_snapshot: data.alternativesSnapshot?.trim() || null,
      informed_by_professional_id: data.informedByProfessionalId,
      tooth_numbers: data.toothNumbers?.length ? data.toothNumbers : null,
      treatment_item_id: data.treatmentItemId ?? null,
      ...(data.guardianId ? { guardian_id: data.guardianId } : {}),
      signature_storage_path: path,
      signature_sha256: await sha256Hex(bytes),
      signed_by_name: data.signedByName,
      recorded_by: context.userId,
    });
    if (insertError) {
      await context.supabase.storage.from(BUCKET).remove([path]);
      // Los triggers responden en español ("El paciente es menor de edad…",
      // "Indica el procedimiento…") y mensajeDb los deja pasar.
      throw new Error(
        mensajeDb(insertError, "No tienes permisos para registrar consentimientos firmados."),
      );
    }
    return { ok: true };
  });

export const revokePatientConsent = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), consentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patient_consents")
      .update({ revoked_at: new Date().toISOString(), revoked_by: context.userId })
      .eq("id", data.consentId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para revocar este consentimiento.");
    return { ok: true };
  });
