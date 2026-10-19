import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isUndefinedColumnError, mensajeDb } from "@/lib/db-errors";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";

const BUCKET = "clinical-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
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
    const { data: rows, error } = await context.supabase
      .from("patient_documents")
      .select("id, kind, storage_path, filename, notes, created_at, uploaded_by, archived_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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

export type ConsentTemplate = {
  id: string;
  title: string;
  body: string;
  active: boolean;
};

export const listConsentTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ConsentTemplate[]> => {
    const { data: rows, error } = await context.supabase
      .from("consent_templates")
      .select("id, title, body, active")
      .eq("clinic_id", data.clinicId)
      .order("title", { ascending: true });
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar las plantillas de consentimiento."));
    return rows ?? [];
  });

export const createConsentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        title: z.string().trim().min(2).max(120),
        body: z.string().trim().min(10).max(8000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("consent_templates").insert({
      clinic_id: data.clinicId,
      title: data.title,
      body: data.body,
      created_by: context.userId,
    });
    if (error) throw new Error("No tienes permisos para crear plantillas de consentimiento.");
    return { ok: true };
  });

export const setConsentTemplateActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  bodySnapshot: string;
  signedByName: string;
  /** "tutor" si firmó el tutor o representante legal; null en firmas anteriores al dato. */
  signerRole: "paciente" | "tutor" | null;
  signerDocument: string | null;
  signerRelationship: string | null;
  signedAt: string;
  revokedAt: string | null;
  signatureUrl: string | null;
};

type FilaConsentimiento = {
  id: string;
  title_snapshot: string;
  body_snapshot: string;
  signature_storage_path: string;
  signed_by_name: string;
  signed_at: string;
  revoked_at: string | null;
  signer_role?: string | null;
  signer_document_snapshot?: string | null;
  signer_relationship_snapshot?: string | null;
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
    const columnas =
      "id, title_snapshot, body_snapshot, signature_storage_path, signed_by_name, signed_at, revoked_at";
    const consulta = (cols: string) =>
      context.supabase
        .from("patient_consents")
        .select(cols)
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .order("signed_at", { ascending: false });
    // Columnas del firmante (migración 20261019180000); sin ella, se listan
    // igual sin ese dato.
    let { data: rows, error } = await consulta(
      `${columnas}, signer_role, signer_document_snapshot, signer_relationship_snapshot`,
    );
    if (error && isUndefinedColumnError(error)) ({ data: rows, error } = await consulta(columnas));
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los consentimientos del paciente."));

    const consents: PatientConsent[] = [];
    for (const row of (rows ?? []) as unknown as FilaConsentimiento[]) {
      const { data: signed } = await context.supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.signature_storage_path, SIGNED_URL_TTL_SECONDS);
      consents.push({
        id: row.id,
        titleSnapshot: row.title_snapshot,
        bodySnapshot: row.body_snapshot,
        signedByName: row.signed_by_name,
        signerRole:
          row.signer_role === "paciente" || row.signer_role === "tutor" ? row.signer_role : null,
        signerDocument: row.signer_document_snapshot ?? null,
        signerRelationship: row.signer_relationship_snapshot ?? null,
        signedAt: row.signed_at,
        revokedAt: row.revoked_at,
        signatureUrl: signed?.signedUrl ?? null,
      });
    }
    await lectura;
    return consents;
  });

export const signPatientConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        templateId: z.string().uuid().optional(),
        titleSnapshot: z.string().trim().min(2).max(120),
        bodySnapshot: z.string().trim().min(10).max(8000),
        signedByName: z.string().trim().min(2).max(120),
        // Tutor o representante legal que firma (CLI-11). Obligatorio si el
        // paciente es menor: lo exige el trigger `stamp_patient_consent_signer`,
        // que además copia el nombre, documento y parentesco del tutor al
        // registro (lo que mande el cliente en `signedByName` se pisa).
        guardianId: z.string().uuid().optional(),
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
      body_snapshot: data.bodySnapshot,
      signature_storage_path: path,
      signed_by_name: data.signedByName,
      ...(data.guardianId ? { guardian_id: data.guardianId } : {}),
      recorded_by: context.userId,
    });
    if (insertError) {
      await context.supabase.storage.from(BUCKET).remove([path]);
      // El trigger del firmante responde en español ("El paciente es menor
      // de edad…", "El tutor elegido no corresponde…"): ese sí se muestra.
      throw new Error(
        insertError.code === "23514" && /menor de edad|tutor/i.test(insertError.message)
          ? insertError.message
          : "No tienes permisos para registrar consentimientos firmados.",
      );
    }
    return { ok: true };
  });

export const revokePatientConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
