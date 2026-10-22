/**
 * Server functions del motor de documentos (Ola 4): plantillas (DOC-09),
 * emisión desde la ficha (DOC-01), anulación (DOC-08) y firma del
 * profesional (DOC-06).
 *
 * Permisos: la RLS decide (roles clínicos leen; owner/admin/dentist emiten;
 * owner/admin editan plantillas). Las pantallas repiten los gates de la
 * matriz (`clinical:view`, `settings:manage`) y acá se repite el de editar
 * plantillas con `requireClinicPermission` (regla 15).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { decodeDataUrl, sha256Hex } from "@/lib/clinical/clinical-documents.functions";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import {
  cargarDatosParaDocumento,
  profesionalDelUsuario,
  registroParaDocumentos,
} from "@/lib/documentos/contexto.server";
import { emitirDocumento } from "@/lib/documentos/emitir.server";
import { CamposSchema, leerBloques } from "@/lib/documentos/esquemas";
import { analizarPlantilla } from "@/lib/documentos/motor";
import {
  esTipoDeDocumento,
  TIPOS_DE_DOCUMENTO,
  type Bloque,
  type TipoDeDocumento,
} from "@/lib/documentos/tipos";
import type { DatosParaDocumento } from "@/lib/documentos/variables";
import { mensajeDb } from "@/lib/db-errors";
import { idsDeLaFicha } from "@/lib/patients/fusion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const BUCKET_FIRMAS = "professional-signatures";
const TTL_URL_FIRMADA = 60 * 10;
const SIN_PERMISO_PLANTILLAS = "No tienes permisos para editar las plantillas de documentos.";

const clinica = z.object({ clinicId: z.string().uuid() });
const fechaCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ─── Plantillas ──────────────────────────────────────────────────────────────

export interface PlantillaDocumento {
  id: string;
  kind: TipoDeDocumento;
  title: string;
  description: string | null;
  active: boolean;
  source: "clinic" | "esmalia_model";
  /** Versión vigente (null si la plantilla todavía no tiene texto). */
  version: { id: string; numero: number; body: string; createdAt: string } | null;
  updatedAt: string;
}

export const listPlantillasDocumento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.parse(input))
  .handler(async ({ data, context }): Promise<PlantillaDocumento[]> => {
    const { supabase } = context;
    const { data: filas, error } = await supabase
      .from("document_templates")
      .select("id, kind, title, description, active, source, current_version_id, updated_at")
      .eq("clinic_id", data.clinicId)
      .order("title", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las plantillas de documentos."));
    const ids = (filas ?? []).map((f) => f.current_version_id).filter((x): x is string => !!x);
    const versiones = new Map<
      string,
      { id: string; version: number; body: string; created_at: string }
    >();
    if (ids.length) {
      const { data: vs, error: errV } = await supabase
        .from("document_template_versions")
        .select("id, version, body, created_at")
        .in("id", ids);
      if (errV) throw new Error(mensajeDb(errV, "No pudimos cargar las plantillas de documentos."));
      for (const v of vs ?? []) versiones.set(v.id, v);
    }
    return (filas ?? []).map((f) => {
      const v = f.current_version_id ? versiones.get(f.current_version_id) : undefined;
      return {
        id: f.id,
        kind: esTipoDeDocumento(f.kind) ? f.kind : "otro",
        title: f.title,
        description: f.description,
        active: f.active,
        source: f.source === "esmalia_model" ? "esmalia_model" : "clinic",
        version: v ? { id: v.id, numero: v.version, body: v.body, createdAt: v.created_at } : null,
        updatedAt: f.updated_at,
      };
    });
  });

export interface VersionDePlantillaResumen {
  id: string;
  numero: number;
  title: string;
  body: string;
  createdAt: string;
  /** null = la sembró Esmalia. */
  autor: string | null;
  /** Documentos emitidos con esta versión. */
  usos: number;
}

export const listVersionesPlantilla = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ templateId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<VersionDePlantillaResumen[]> => {
    const { supabase } = context;
    const { data: vs, error } = await supabase
      .from("document_template_versions")
      .select("id, version, title, body, created_at, created_by")
      .eq("clinic_id", data.clinicId)
      .eq("template_id", data.templateId)
      .order("version", { ascending: false });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las versiones."));
    const autores = [
      ...new Set((vs ?? []).map((v) => v.created_by).filter((x): x is string => !!x)),
    ];
    const nombres = new Map<string, string>();
    if (autores.length) {
      const { data: perfiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", autores);
      for (const p of perfiles ?? []) if (p.full_name) nombres.set(p.id, p.full_name);
    }
    const usos = new Map<string, number>();
    const versionIds = (vs ?? []).map((v) => v.id);
    if (versionIds.length) {
      const { data: docs } = await supabase
        .from("issued_documents")
        .select("template_version_id")
        .eq("clinic_id", data.clinicId)
        .in("template_version_id", versionIds);
      for (const d of docs ?? []) {
        usos.set(d.template_version_id, (usos.get(d.template_version_id) ?? 0) + 1);
      }
    }
    return (vs ?? []).map((v) => ({
      id: v.id,
      numero: v.version,
      title: v.title,
      body: v.body,
      createdAt: v.created_at,
      autor: v.created_by ? (nombres.get(v.created_by) ?? "Alguien del equipo") : null,
      usos: usos.get(v.id) ?? 0,
    }));
  });

const TextoPlantilla = z.object({
  title: z.string().trim().min(2, "El título necesita al menos 2 letras.").max(120),
  body: z.string().max(20_000),
  description: z.string().trim().max(300).optional().or(z.literal("")),
});

/** Rechaza una plantilla con variables desconocidas o mal escritas. */
function exigirPlantillaValida(body: string) {
  const { problemas } = analizarPlantilla(body);
  if (problemas.length) throw new Error(problemas[0].mensaje);
}

export const crearPlantillaDocumento = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica
      .merge(TextoPlantilla)
      .extend({ kind: z.enum(TIPOS_DE_DOCUMENTO) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "settings:manage",
      SIN_PERMISO_PLANTILLAS,
    );
    exigirPlantillaValida(data.body);
    const { data: t, error } = await supabase
      .from("document_templates")
      .insert({
        clinic_id: data.clinicId,
        kind: data.kind,
        title: data.title,
        description: data.description?.trim() || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_PLANTILLAS));
    const { error: errV } = await supabase.from("document_template_versions").insert({
      clinic_id: data.clinicId,
      template_id: t.id,
      title: data.title,
      body: data.body,
    });
    if (errV) throw new Error(mensajeDb(errV, SIN_PERMISO_PLANTILLAS));
    return { id: t.id };
  });

/**
 * Editar = versión nueva. La anterior queda tal cual (los documentos ya
 * emitidos apuntan a ella).
 */
export const guardarVersionPlantilla = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica
      .merge(TextoPlantilla)
      .extend({ templateId: z.string().uuid(), kind: z.enum(TIPOS_DE_DOCUMENTO) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ versionId: string; numero: number }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "settings:manage",
      SIN_PERMISO_PLANTILLAS,
    );
    exigirPlantillaValida(data.body);
    const { data: fila, error: errT } = await supabase
      .from("document_templates")
      .update({ description: data.description?.trim() || null, kind: data.kind })
      .eq("id", data.templateId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (errT) throw new Error(mensajeDb(errT, SIN_PERMISO_PLANTILLAS));
    if (!fila) throw new Error(SIN_PERMISO_PLANTILLAS);
    const { data: v, error } = await supabase
      .from("document_template_versions")
      .insert({
        clinic_id: data.clinicId,
        template_id: data.templateId,
        title: data.title,
        body: data.body,
      })
      .select("id, version")
      .single();
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_PLANTILLAS));
    return { versionId: v.id, numero: v.version };
  });

export const setPlantillaDocumentoActiva = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica.extend({ templateId: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "settings:manage",
      SIN_PERMISO_PLANTILLAS,
    );
    const { data: fila, error } = await supabase
      .from("document_templates")
      .update({ active: data.active })
      .eq("id", data.templateId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_PLANTILLAS));
    if (!fila) throw new Error(SIN_PERMISO_PLANTILLAS);
    return { ok: true as const };
  });

// ─── Emisión ─────────────────────────────────────────────────────────────────

export interface DatosParaEmitir {
  datos: DatosParaDocumento;
  /** Quien emite: null si el usuario no tiene ficha de profesional en la clínica. */
  profesional: {
    id: string;
    nombre: string;
    registro: string | null;
    /** true si el registro sale del de la Superintendencia de Salud. */
    registroEsSis: boolean;
    tieneFirma: boolean;
    /** URL firmada (10 min) de la imagen de la firma, para la vista previa. */
    firmaUrl: string | null;
  } | null;
}

/**
 * Datos de la ficha para la vista previa en vivo del diálogo de emisión. El
 * período solo se usa para el formulario de reembolso.
 */
export const getDatosParaEmitir = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    clinica
      .extend({
        patientId: z.string().uuid(),
        periodoDesde: fechaCivil.optional(),
        periodoHasta: fechaCivil.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<DatosParaEmitir> => {
    const { supabase, userId } = context;
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "documentos",
    });
    const { datos, profesional } = await cargarDatosParaDocumento(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      userId,
      periodo:
        data.periodoDesde && data.periodoHasta
          ? { desde: data.periodoDesde, hasta: data.periodoHasta }
          : null,
    });
    let firmaUrl: string | null = null;
    if (profesional?.firmaPath) {
      const { data: firmada } = await supabase.storage
        .from(BUCKET_FIRMAS)
        .createSignedUrl(profesional.firmaPath, TTL_URL_FIRMADA);
      firmaUrl = firmada?.signedUrl ?? null;
    }
    await lectura;
    return {
      datos,
      profesional: profesional
        ? {
            id: profesional.id,
            nombre: profesional.nombre,
            registro: registroParaDocumentos(profesional),
            registroEsSis: profesional.registroSis !== null,
            tieneFirma: Boolean(profesional.firmaPath),
            firmaUrl,
          }
        : null,
    };
  });

export const emitirDocumentoDelPaciente = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica
      .extend({
        patientId: z.string().uuid(),
        templateId: z.string().uuid(),
        campos: CamposSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return emitirDocumento(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      userId,
      templateId: data.templateId,
      campos: data.campos,
    });
  });

// ─── Documentos emitidos ─────────────────────────────────────────────────────

export interface DocumentoEmitidoResumen {
  id: string;
  kind: TipoDeDocumento;
  title: string;
  year: number;
  number: number;
  issuedAt: string;
  professionalName: string;
  voidedAt: string | null;
  voidReason: string | null;
  /** Puede anularlo quien lo emitió; un administrador también (lo decide la base). */
  emitidoPorMi: boolean;
  /** Documento de una ficha fusionada en esta. */
  deOtraFicha: boolean;
}

export const listDocumentosDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ patientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<DocumentoEmitidoResumen[]> => {
    const { supabase, userId } = context;
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "documentos",
    });
    // CLI-06: un documento emitido no se mueve al fusionar fichas: se lee
    // también desde las fichas fusionadas en esta.
    const fichas = await idsDeLaFicha(supabase, data.clinicId, data.patientId);
    const { data: filas, error } = await supabase
      .from("issued_documents")
      .select(
        "id, kind, title, year, number, issued_at, issued_by, professional_name_snapshot, voided_at, void_reason, patient_id",
      )
      .eq("clinic_id", data.clinicId)
      .in("patient_id", fichas)
      .order("issued_at", { ascending: false });
    await lectura;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los documentos emitidos."));
    return (filas ?? []).map((f) => ({
      id: f.id,
      kind: esTipoDeDocumento(f.kind) ? f.kind : "otro",
      title: f.title,
      year: f.year,
      number: f.number,
      issuedAt: f.issued_at,
      professionalName: f.professional_name_snapshot,
      voidedAt: f.voided_at,
      voidReason: f.void_reason,
      emitidoPorMi: f.issued_by === userId,
      deOtraFicha: f.patient_id !== data.patientId,
    }));
  });

export interface DocumentoEmitidoCompleto extends DocumentoEmitidoResumen {
  patientId: string;
  patientName: string;
  templateVersionId: string;
  professionalRegistry: string | null;
  professionalSpecialty: string | null;
  clinicName: string;
  clinicLegalName: string | null;
  clinicTaxId: string | null;
  clinicAddress: string | null;
  clinicPhone: string | null;
  /** null si los bloques guardados no tienen la forma esperada. */
  bloques: Bloque[] | null;
  contentHtml: string;
  contentSha256: string;
  signatureSha256: string | null;
  /** URL firmada (10 min) de la imagen de la firma, o null. */
  signatureUrl: string | null;
  voidedByName: string | null;
  timezone: string;
}

export const getDocumentoEmitido = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<DocumentoEmitidoCompleto> => {
    const { supabase, userId } = context;
    const { data: d, error } = await supabase
      .from("issued_documents")
      .select("*")
      .eq("id", data.documentId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el documento."));
    if (!d) throw new Error("No tienes permisos para ver este documento.");
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: d.patient_id,
      seccion: "documentos",
    });

    let signatureUrl: string | null = null;
    if (d.signature_storage_path) {
      const { data: firmada } = await supabase.storage
        .from(BUCKET_FIRMAS)
        .createSignedUrl(d.signature_storage_path, TTL_URL_FIRMADA);
      signatureUrl = firmada?.signedUrl ?? null;
    }
    let voidedByName: string | null = null;
    if (d.voided_by) {
      const { data: perfil } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", d.voided_by)
        .maybeSingle();
      voidedByName = perfil?.full_name ?? "Alguien del equipo";
    }
    const { data: c } = await supabase
      .from("clinics")
      .select("timezone")
      .eq("id", data.clinicId)
      .maybeSingle();
    await lectura;
    return {
      id: d.id,
      kind: esTipoDeDocumento(d.kind) ? d.kind : "otro",
      title: d.title,
      year: d.year,
      number: d.number,
      issuedAt: d.issued_at,
      professionalName: d.professional_name_snapshot,
      voidedAt: d.voided_at,
      voidReason: d.void_reason,
      emitidoPorMi: d.issued_by === userId,
      deOtraFicha: false,
      patientId: d.patient_id,
      patientName: d.patient_name_snapshot,
      templateVersionId: d.template_version_id,
      professionalRegistry: d.professional_registry_snapshot,
      professionalSpecialty: d.professional_specialty_snapshot,
      clinicName: d.clinic_name_snapshot,
      clinicLegalName: d.clinic_legal_name_snapshot,
      clinicTaxId: d.clinic_tax_id_snapshot,
      clinicAddress: d.clinic_address_snapshot,
      clinicPhone: d.clinic_phone_snapshot,
      bloques: leerBloques(d.content_blocks),
      contentHtml: d.content_html,
      contentSha256: d.content_sha256,
      signatureSha256: d.signature_sha256,
      signatureUrl,
      voidedByName,
      timezone: c?.timezone ?? "America/Santiago",
    };
  });

/** DOC-08: un documento emitido no se edita ni se borra; se anula con motivo. */
export const anularDocumentoEmitido = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica
      .extend({
        documentId: z.string().uuid(),
        motivo: z.string().trim().min(3, "Escribe el motivo de la anulación.").max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await context.supabase
      .from("issued_documents")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: context.userId,
        void_reason: data.motivo,
      })
      .eq("id", data.documentId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para anular este documento."));
    if (!filas?.length) throw new Error("No tienes permisos para anular este documento.");
    return { ok: true as const };
  });

// ─── Firma del profesional (DOC-06) ──────────────────────────────────────────

export interface MiFirma {
  /** null = el usuario no tiene ficha de profesional en esta clínica. */
  profesional: {
    id: string;
    nombre: string;
    registroSis: string | null;
    registroGeneral: string | null;
    firmaUrl: string | null;
  } | null;
}

export const getMiFirma = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.parse(input))
  .handler(async ({ data, context }): Promise<MiFirma> => {
    const { supabase, userId } = context;
    const p = await profesionalDelUsuario(supabase, data.clinicId, userId);
    if (!p) return { profesional: null };
    let firmaUrl: string | null = null;
    if (p.firmaPath) {
      const { data: firmada } = await supabase.storage
        .from(BUCKET_FIRMAS)
        .createSignedUrl(p.firmaPath, TTL_URL_FIRMADA);
      firmaUrl = firmada?.signedUrl ?? null;
    }
    return {
      profesional: {
        id: p.id,
        nombre: p.nombre,
        registroSis: p.registroSis,
        registroGeneral: p.registroGeneral,
        firmaUrl,
      },
    };
  });

/**
 * Guarda la imagen de la firma (dibujada o subida) y/o el número de la
 * Superintendencia de Salud del propio profesional. Una firma nueva es un
 * archivo nuevo: la anterior queda para los documentos que ya la usaron.
 */
export const guardarMiFirma = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica
      .extend({
        // PNG/JPEG/WebP como data URL, tope 1 MB decodificado.
        firmaDataUrl: z.string().max(1_500_000).optional(),
        registroSis: z.string().trim().max(40).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const p = await profesionalDelUsuario(supabase, data.clinicId, userId);
    if (!p) {
      throw new Error(
        "Tu usuario no tiene una ficha de profesional en esta clínica. Pídele a un administrador que la vincule en Profesionales.",
      );
    }
    let path = "";
    let sha = "";
    if (data.firmaDataUrl) {
      const { bytes, mimeType } = decodeDataUrl(data.firmaDataUrl);
      if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
        throw new Error("La firma tiene que ser una imagen PNG, JPG o WebP.");
      }
      if (bytes.byteLength > 1024 * 1024) throw new Error("La imagen de la firma supera 1 MB.");
      const extension =
        mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      path = `${data.clinicId}/${p.id}/${crypto.randomUUID()}.${extension}`;
      const { error: errSubida } = await supabase.storage
        .from(BUCKET_FIRMAS)
        .upload(path, bytes, { contentType: mimeType, upsert: false });
      if (errSubida)
        throw new Error(mensajeDb(errSubida, "No pudimos subir la imagen de la firma."));
      sha = await sha256Hex(bytes);
    }
    const { error } = await supabase.rpc("registrar_mi_firma", {
      p_clinic_id: data.clinicId,
      p_storage_path: path,
      p_sha256: sha,
      p_registro_sis: data.registroSis ?? "",
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar tu firma."));
    return { ok: true as const };
  });
