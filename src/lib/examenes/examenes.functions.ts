/**
 * Ola 13 · IMG-01, IMG-02, FIC-17: exámenes y sesiones de fotos del paciente.
 *
 * Subida en tres pasos (el archivo nunca pasa por el servidor de la app, que
 * en Vercel corta en 4,5 MB):
 *   1. `prepararSubidaExamen`: valida tipo y tamaño, reserva la fila con la
 *      sesión del usuario (RLS de rol clínico + trigger de cupo: el bloqueo al
 *      100 % vive en la base) y firma una URL de subida con el service role.
 *   2. El navegador sube el archivo directo a Storage con esa URL.
 *   3. `confirmarSubidaExamen`: lee el tamaño real del archivo y lo fija en la
 *      fila (el trigger vuelve a mirar el cupo con el tamaño real). Si la
 *      subida falló, `cancelarSubidaExamen` borra la reserva.
 *
 * Leer: URLs firmadas de 5 minutos, firmadas con la sesión del usuario (la
 * política de storage vuelve a exigir rol clínico) y registro de lectura de
 * la ficha (sección "examenes").
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { mensajeDb } from "@/lib/db-errors";
import { CODIGO_ARCHIVO_GRANDE, CODIGO_CUPO_LLENO } from "@/lib/examenes/cupo";
import {
  ETAPAS_SESION,
  TIPOS_EXAMEN,
  esImagen,
  limitePorArchivo,
  mimeDeArchivo,
  nombreSeguro,
  normalizarPiezas,
  problemaDeArchivo,
  type EtapaSesion,
  type TipoExamen,
} from "@/lib/examenes/tipos";
import { idsDeLaFicha } from "@/lib/patients/fusion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export const BUCKET_EXAMENES = "clinical-exams";
/** Duración de las URLs firmadas de lectura (corta: datos clínicos). */
export const SEGUNDOS_URL_FIRMADA = 5 * 60;

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const piezas = z.array(z.number().int()).max(32).default([]);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export interface ExamenDeFicha {
  id: string;
  patientId: string;
  kind: TipoExamen;
  takenOn: string;
  teeth: number[];
  professionalId: string | null;
  professionalName: string | null;
  notes: string | null;
  photoSessionId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "pendiente" | "listo";
  createdAt: string;
  archivedAt: string | null;
  archiveReason: string | null;
  /** Miniatura firmada (imágenes); null si no hay o está archivado. */
  thumbUrl: string | null;
}

export interface SesionDeFotos {
  id: string;
  sessionDate: string;
  reason: string;
  stage: EtapaSesion | null;
  treatmentPlanId: string | null;
  treatmentPlanName: string | null;
  notes: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
}

export interface ExamenesDelPaciente {
  examenes: ExamenDeFicha[];
  sesiones: SesionDeFotos[];
  planes: { id: string; name: string }[];
}

type Cliente = SupabaseClient<Database>;

/** Mensaje para el staff a partir de un error de la base. */
function mensajeExamen(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
): string {
  if (error?.code === CODIGO_CUPO_LLENO || error?.code === CODIGO_ARCHIVO_GRANDE) {
    return error.message ?? fallback;
  }
  return mensajeDb(error, fallback);
}

async function firmarVarias(supabase: Cliente, rutas: string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  if (rutas.length === 0) return salida;
  const { data } = await supabase.storage
    .from(BUCKET_EXAMENES)
    .createSignedUrls(rutas, SEGUNDOS_URL_FIRMADA);
  for (const f of data ?? []) {
    if (f.path && f.signedUrl) salida.set(f.path, f.signedUrl);
  }
  return salida;
}

export const listarExamenesDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ExamenesDelPaciente> => {
    const lectura = registrarLecturaDeFicha(context.supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "examenes",
    });
    // CLI-06: un examen no se mueve al fusionar fichas; se lee también desde
    // las fichas fusionadas en esta.
    const fichas = await idsDeLaFicha(context.supabase, data.clinicId, data.patientId);
    const [examenesRes, sesionesRes, planesRes] = await Promise.all([
      context.supabase
        .from("patient_exams")
        .select(
          "id, patient_id, kind, taken_on, teeth, professional_id, professional_name, notes, photo_session_id, filename, mime_type, size_bytes, status, created_at, archived_at, archive_reason, thumb_path, storage_path",
        )
        .eq("clinic_id", data.clinicId)
        .in("patient_id", fichas)
        .eq("status", "listo")
        .order("taken_on", { ascending: false })
        .order("created_at", { ascending: false }),
      context.supabase
        .from("clinical_photo_sessions")
        .select(
          "id, session_date, reason, stage, treatment_plan_id, notes, archived_at, archive_reason",
        )
        .eq("clinic_id", data.clinicId)
        .in("patient_id", fichas)
        .order("session_date", { ascending: false }),
      // El plan es opcional y lo ve quien ve presupuestos: si no, queda sin nombre.
      context.supabase
        .from("treatment_plans")
        .select("id, name")
        .eq("clinic_id", data.clinicId)
        .in("patient_id", fichas)
        .order("created_at", { ascending: false }),
    ]);
    if (examenesRes.error)
      throw new Error(mensajeDb(examenesRes.error, "No pudimos cargar los exámenes del paciente."));
    if (sesionesRes.error)
      throw new Error(mensajeDb(sesionesRes.error, "No pudimos cargar las sesiones de fotos."));

    const filas = examenesRes.data ?? [];
    const rutasMiniatura = filas
      .filter((f) => !f.archived_at && esImagen(f.mime_type))
      .map((f) => f.thumb_path ?? f.storage_path);
    const firmadas = await firmarVarias(context.supabase, rutasMiniatura);
    const planes = planesRes.error ? [] : (planesRes.data ?? []);
    const nombrePlan = new Map(planes.map((p) => [p.id, p.name]));

    const resultado: ExamenesDelPaciente = {
      examenes: filas.map((f) => ({
        id: f.id,
        patientId: f.patient_id,
        kind: f.kind as TipoExamen,
        takenOn: f.taken_on,
        teeth: f.teeth ?? [],
        professionalId: f.professional_id,
        professionalName: f.professional_name,
        notes: f.notes,
        photoSessionId: f.photo_session_id,
        filename: f.filename,
        mimeType: f.mime_type,
        sizeBytes: f.size_bytes,
        status: f.status as "pendiente" | "listo",
        createdAt: f.created_at,
        archivedAt: f.archived_at,
        archiveReason: f.archive_reason,
        thumbUrl:
          !f.archived_at && esImagen(f.mime_type)
            ? (firmadas.get(f.thumb_path ?? f.storage_path) ?? null)
            : null,
      })),
      sesiones: (sesionesRes.data ?? []).map((s) => ({
        id: s.id,
        sessionDate: s.session_date,
        reason: s.reason,
        stage: (s.stage as EtapaSesion | null) ?? null,
        treatmentPlanId: s.treatment_plan_id,
        treatmentPlanName: s.treatment_plan_id
          ? (nombrePlan.get(s.treatment_plan_id) ?? null)
          : null,
        notes: s.notes,
        archivedAt: s.archived_at,
        archiveReason: s.archive_reason,
      })),
      planes,
    };
    await lectura;
    return resultado;
  });

/** URL firmada (5 min) para ver, descargar o abrir en el visor un examen. */
export const urlDeExamen = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        examId: z.string().uuid(),
        descargar: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string; filename: string }> => {
    const { data: fila, error } = await context.supabase
      .from("patient_exams")
      .select("patient_id, storage_path, filename, status")
      .eq("id", data.examId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error || !fila || fila.status !== "listo") {
      throw new Error("No encontramos ese examen o tu rol no puede verlo.");
    }
    const lectura = registrarLecturaDeFicha(context.supabase, {
      clinicId: data.clinicId,
      patientId: fila.patient_id,
      seccion: "examenes",
    });
    const { data: firmada, error: errorFirma } = await context.supabase.storage
      .from(BUCKET_EXAMENES)
      .createSignedUrl(
        fila.storage_path,
        SEGUNDOS_URL_FIRMADA,
        data.descargar ? { download: fila.filename } : undefined,
      );
    await lectura;
    if (errorFirma || !firmada?.signedUrl) {
      throw new Error("No pudimos abrir el archivo. Intenta de nuevo en unos segundos.");
    }
    return { url: firmada.signedUrl, filename: fila.filename };
  });

const prepararSchema = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  kind: z.enum(TIPOS_EXAMEN),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().max(120).default(""),
  sizeBytes: z.number().int().positive(),
  takenOn: fechaIso,
  teeth: piezas,
  professionalId: z.string().uuid().nullable().optional(),
  notes: textoOpcional(1000),
  photoSessionId: z.string().uuid().nullable().optional(),
  conMiniatura: z.boolean().default(false),
});

export interface SubidaPreparada {
  examId: string;
  path: string;
  token: string;
  thumbPath: string | null;
  thumbToken: string | null;
}

export const prepararSubidaExamen = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => prepararSchema.parse(input))
  .handler(async ({ data, context }): Promise<SubidaPreparada> => {
    const problema = problemaDeArchivo(data.kind, {
      name: data.filename,
      size: data.sizeBytes,
    });
    if (problema) throw new Error(problema.mensaje);
    if (data.photoSessionId && data.kind !== "foto_clinica") {
      throw new Error("Solo las fotos clínicas van en una sesión de fotos.");
    }

    const examId = crypto.randomUUID();
    const path = `${data.clinicId}/${data.patientId}/${examId}/${nombreSeguro(data.filename)}`;
    const mime = mimeDeArchivo(data.filename, data.mimeType);

    // Reserva con la sesión del usuario: RLS (rol clínico, paciente de la
    // clínica) y el trigger (cupo, límite por tipo, profesional, sesión).
    const { error } = await context.supabase.from("patient_exams").insert({
      id: examId,
      clinic_id: data.clinicId,
      patient_id: data.patientId,
      kind: data.kind,
      taken_on: data.takenOn,
      teeth: normalizarPiezas(data.teeth),
      professional_id: data.professionalId ?? null,
      notes: data.notes,
      photo_session_id: data.photoSessionId ?? null,
      storage_path: path,
      filename: data.filename,
      mime_type: mime,
      size_bytes: data.sizeBytes,
      uploaded_by: context.userId,
    });
    if (error) {
      throw new Error(
        mensajeExamen(error, "No tienes permisos para subir exámenes de este paciente."),
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const firma = await supabaseAdmin.storage.from(BUCKET_EXAMENES).createSignedUploadUrl(path);
    let thumbPath: string | null = null;
    let thumbToken: string | null = null;
    if (!firma.error && data.conMiniatura && esImagen(mime)) {
      const ruta = `${data.clinicId}/${data.patientId}/${examId}/miniatura.webp`;
      const t = await supabaseAdmin.storage.from(BUCKET_EXAMENES).createSignedUploadUrl(ruta);
      if (!t.error && t.data) {
        thumbPath = ruta;
        thumbToken = t.data.token;
      }
    }
    if (firma.error || !firma.data) {
      await supabaseAdmin.from("patient_exams").delete().eq("id", examId).eq("status", "pendiente");
      throw new Error("No pudimos preparar la subida. Intenta de nuevo.");
    }
    return { examId, path, token: firma.data.token, thumbPath, thumbToken };
  });

/** La reserva pendiente, leída con la sesión del usuario (RLS). */
async function reservaPendiente(
  supabase: Cliente,
  clinicId: string,
  examId: string,
  userId: string,
) {
  const { data: fila } = await supabase
    .from("patient_exams")
    .select("id, kind, storage_path, status, uploaded_by")
    .eq("id", examId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!fila || fila.status !== "pendiente" || fila.uploaded_by !== userId) return null;
  return fila;
}

export const confirmarSubidaExamen = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        examId: z.string().uuid(),
        thumbPath: z.string().max(400).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const fila = await reservaPendiente(
      context.supabase,
      data.clinicId,
      data.examId,
      context.userId,
    );
    if (!fila) throw new Error("No encontramos esa subida o ya se confirmó.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const almacen = supabaseAdmin.storage.from(BUCKET_EXAMENES);
    const { data: info, error: errorInfo } = await almacen.info(fila.storage_path);
    const real = typeof info?.size === "number" ? info.size : null;

    const descartar = async () => {
      const rutas = [fila.storage_path];
      if (data.thumbPath) rutas.push(data.thumbPath);
      await almacen.remove(rutas);
      await supabaseAdmin
        .from("patient_exams")
        .delete()
        .eq("id", fila.id)
        .eq("status", "pendiente");
    };

    if (errorInfo || real == null) {
      await descartar();
      throw new Error("El archivo no llegó completo. Vuelve a subirlo.");
    }
    if (real > limitePorArchivo(fila.kind as TipoExamen)) {
      await descartar();
      throw new Error("El archivo supera el máximo para este tipo de examen.");
    }

    // La miniatura solo se acepta si es de esta misma subida y existe.
    const prefijo = fila.storage_path.slice(0, fila.storage_path.lastIndexOf("/") + 1);
    let thumbPath: string | null = null;
    if (data.thumbPath && data.thumbPath === `${prefijo}miniatura.webp`) {
      const { data: hay } = await almacen.exists(data.thumbPath);
      if (hay) thumbPath = data.thumbPath;
    }

    const { error } = await supabaseAdmin
      .from("patient_exams")
      .update({
        size_bytes: real,
        status: "listo",
        confirmed_at: new Date().toISOString(),
        thumb_path: thumbPath,
      })
      .eq("id", fila.id)
      .eq("clinic_id", data.clinicId)
      .eq("status", "pendiente");
    if (error) {
      await descartar();
      throw new Error(mensajeExamen(error, "No pudimos guardar el examen."));
    }
    return { ok: true };
  });

export const cancelarSubidaExamen = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), examId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const fila = await reservaPendiente(
      context.supabase,
      data.clinicId,
      data.examId,
      context.userId,
    );
    if (!fila) return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const prefijo = fila.storage_path.slice(0, fila.storage_path.lastIndexOf("/") + 1);
    await supabaseAdmin.storage
      .from(BUCKET_EXAMENES)
      .remove([fila.storage_path, `${prefijo}miniatura.webp`]);
    // Solo una reserva que nunca se confirmó: un examen listo no se borra.
    await supabaseAdmin
      .from("patient_exams")
      .delete()
      .eq("id", fila.id)
      .eq("clinic_id", data.clinicId)
      .eq("status", "pendiente");
    return { ok: true };
  });

export const actualizarExamen = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        examId: z.string().uuid(),
        kind: z.enum(TIPOS_EXAMEN),
        takenOn: fechaIso,
        teeth: piezas,
        professionalId: z.string().uuid().nullable().optional(),
        notes: textoOpcional(1000),
        photoSessionId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patient_exams")
      .update({
        kind: data.kind,
        taken_on: data.takenOn,
        teeth: normalizarPiezas(data.teeth),
        professional_id: data.professionalId ?? null,
        notes: data.notes,
        photo_session_id: data.kind === "foto_clinica" ? (data.photoSessionId ?? null) : null,
      })
      .eq("id", data.examId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeExamen(error, "No tienes permisos para editar este examen."));
    return { ok: true };
  });

export const archivarExamen = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        examId: z.string().uuid(),
        motivo: z.string().trim().min(3, "Escribe el motivo (al menos 3 letras).").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patient_exams")
      .update({
        archived_at: new Date().toISOString(),
        archived_by: context.userId,
        archive_reason: data.motivo,
      })
      .eq("id", data.examId)
      .eq("clinic_id", data.clinicId)
      .is("archived_at", null);
    if (error)
      throw new Error(mensajeExamen(error, "No tienes permisos para archivar este examen."));
    return { ok: true };
  });

export const restaurarExamen = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), examId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patient_exams")
      .update({ archived_at: null, archived_by: null, archive_reason: null })
      .eq("id", data.examId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(mensajeExamen(error, "Solo owner o admin restauran un examen archivado."));
    return { ok: true };
  });

const sesionSchema = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  sessionDate: fechaIso,
  reason: z.string().trim().min(2, "Escribe el motivo de la sesión.").max(200),
  stage: z.enum(ETAPAS_SESION).nullable().optional(),
  treatmentPlanId: z.string().uuid().nullable().optional(),
  notes: textoOpcional(1000),
});

export const guardarSesionDeFotos = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    sesionSchema.extend({ sessionId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const campos = {
      session_date: data.sessionDate,
      reason: data.reason,
      stage: data.stage ?? null,
      treatment_plan_id: data.treatmentPlanId ?? null,
      notes: data.notes,
    };
    if (data.sessionId) {
      const { error } = await context.supabase
        .from("clinical_photo_sessions")
        .update(campos)
        .eq("id", data.sessionId)
        .eq("clinic_id", data.clinicId);
      if (error) throw new Error(mensajeDb(error, "No tienes permisos para editar esta sesión."));
      return { id: data.sessionId };
    }
    const { data: fila, error } = await context.supabase
      .from("clinical_photo_sessions")
      .insert({
        ...campos,
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !fila)
      throw new Error(mensajeDb(error, "No tienes permisos para crear sesiones de fotos."));
    return { id: fila.id };
  });

export const archivarSesionDeFotos = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        sessionId: z.string().uuid(),
        motivo: z.string().trim().min(3, "Escribe el motivo (al menos 3 letras).").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clinical_photo_sessions")
      .update({
        archived_at: new Date().toISOString(),
        archived_by: context.userId,
        archive_reason: data.motivo,
      })
      .eq("id", data.sessionId)
      .eq("clinic_id", data.clinicId)
      .is("archived_at", null);
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para archivar esta sesión."));
    return { ok: true };
  });

export interface UsoDeAlmacenamiento {
  usadoBytes: number;
  cupoBytes: number;
  plan: "solo" | "clinica";
  examenesBytes: number;
  documentosBytes: number;
  examenes: number;
}

export const usoDeAlmacenamiento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<UsoDeAlmacenamiento | null> => {
    const { data: filas, error } = await context.supabase.rpc("uso_de_almacenamiento", {
      p_clinic_id: data.clinicId,
    });
    // Antes de aplicar la migración: sin datos (la pantalla dice "Sin datos").
    if (error) return null;
    const f = filas?.[0];
    if (!f) return null;
    return {
      usadoBytes: Number(f.usado_bytes),
      cupoBytes: Number(f.cupo_bytes),
      plan: f.plan === "solo" ? "solo" : "clinica",
      examenesBytes: Number(f.examenes_bytes),
      documentosBytes: Number(f.documentos_bytes),
      examenes: Number(f.examenes),
    };
  });
