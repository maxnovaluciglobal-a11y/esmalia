/**
 * Server functions del PDF del presupuesto y de los envíos por correo al
 * paciente (Ola 4):
 *
 *   PLA-08  getPresupuestoParaPdf          la hoja del presupuesto (el
 *                                          navegador arma y descarga el PDF)
 *   PLA-09  getCorreoDePresupuesto         a quién y con qué texto se enviaría
 *           enviarPresupuestoPorCorreo     envío con el PDF adjunto + historial
 *   DOC-07  getCorreoDeDocumento           ídem, copia de un documento emitido
 *           enviarDocumentoPorCorreo
 *           listEnviosDelDocumento         quién lo envió, cuándo y a qué correo
 *           reactivarCorreosDelPaciente    deshace la baja de correos (a pedido
 *                                          del paciente)
 *
 * Permisos (regla 15, par de los gates de la UI):
 *   - Presupuesto: el mismo público del detalle `/presupuestos/:id`
 *     (`finance:view` o `patients:manage`) lo descarga; lo envía quien
 *     escribe presupuestos (`patients:manage`, igual que la RLS de quotes y
 *     de messages: owner, admin, dentist, reception).
 *   - Documento emitido: lo envía quien puede emitir (`clinical:write`:
 *     owner, admin, dentist). La lectura del documento ya pasa por la RLS de
 *     `issued_documents` (roles clínicos).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Permission } from "@/lib/access/access";
import { permisosEnClinica } from "@/lib/access/clinic-guards.server";
import {
  LARGO_MAXIMO_ASUNTO,
  LARGO_MAXIMO_MENSAJE,
  textoCorreoDocumento,
  textoCorreoPresupuesto,
  type TextoDeCorreo,
} from "@/lib/documentos/correo";
import {
  destinatarioDelPaciente,
  enviarPdfAlPaciente,
  motivoParaNoEnviarCorreo,
} from "@/lib/documentos/correo.server";
import { leerBloques } from "@/lib/documentos/esquemas";
import { folioDocumento } from "@/lib/documentos/motor";
import type { DocumentoParaPdf, HojaParaPdf } from "@/lib/documentos/pdf";
import { armarPresupuestoParaPdf } from "@/lib/documentos/presupuesto.server";
import { mensajeDb } from "@/lib/db-errors";
import { resolveEmailRecipient } from "@/lib/messaging/email-sandbox";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

type Cliente = SupabaseClient<Database>;

const clinica = z.object({ clinicId: z.string().uuid() });
const TextoCorreo = z.object({
  asunto: z.string().trim().min(3, "Escribe el asunto.").max(LARGO_MAXIMO_ASUNTO),
  mensaje: z.string().trim().min(3, "Escribe el mensaje.").max(LARGO_MAXIMO_MENSAJE),
});

const SIN_PERMISO_PRESUPUESTO = "No tienes permisos para ver este presupuesto.";
const SIN_PERMISO_ENVIAR_PRESUPUESTO = "No tienes permisos para enviar presupuestos.";
const SIN_PERMISO_DOCUMENTO = "No tienes permisos para enviar este documento.";

async function requireAlgunPermiso(
  supabase: Cliente,
  clinicId: string,
  userId: string,
  permisos: readonly Permission[],
  mensaje: string,
) {
  // Con los ajustes por persona (EQU-01).
  const acceso = await permisosEnClinica(supabase, clinicId, userId);
  const tiene = acceso?.permisos ?? [];
  if (!permisos.some((p) => tiene.includes(p))) throw new Error(mensaje);
}

/** PDF en el servidor (para adjuntar): la misma hoja que se descarga. */
async function pdfDeHoja(hoja: HojaParaPdf): Promise<Uint8Array> {
  const { construirHojaPdf } = await import("@/lib/documentos/pdf");
  const doc = await construirHojaPdf(hoja);
  return new Uint8Array(doc.output("arraybuffer"));
}

// ─── Vista previa del envío ──────────────────────────────────────────────────

export interface VistaDeEnvio {
  /** A quién se le escribe (paciente o tutor). null si no hay correo. */
  destinatario: string | null;
  para: "paciente" | "tutor";
  nombreDestinatario: string | null;
  /** Motivo por el que no se puede enviar (baja, sin correo). */
  bloqueo: string | null;
  /** El paciente se dio de baja (para ofrecer reactivar). */
  bajaEn: string | null;
  /** Qué pasa con el modo de prueba del correo de la clínica. */
  modo:
    | { tipo: "real" }
    | { tipo: "prueba_desvio"; llegaA: string }
    | { tipo: "prueba_permitida" }
    | { tipo: "prueba_bloqueo"; motivo: string };
  texto: TextoDeCorreo;
}

async function vistaDeEnvio(
  supabase: Cliente,
  args: { clinicId: string; patientId: string },
  armarTexto: (d: { paciente: string; destinatario: string | null }) => TextoDeCorreo,
): Promise<VistaDeEnvio> {
  const [destino, { data: c }] = await Promise.all([
    destinatarioDelPaciente(supabase, args),
    supabase.from("clinics").select("timezone").eq("id", args.clinicId).maybeSingle(),
  ]);
  const bloqueo = motivoParaNoEnviarCorreo(destino, c?.timezone || "America/Santiago");
  let modo: VistaDeEnvio["modo"] = { tipo: "real" };
  if (destino.email) {
    const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
    const decision = resolveEmailRecipient(
      destino.email,
      await loadEmailSandboxConfig(supabase, args.clinicId),
    );
    modo =
      decision.action === "redirect"
        ? { tipo: "prueba_desvio", llegaA: decision.recipient }
        : decision.action === "block"
          ? { tipo: "prueba_bloqueo", motivo: decision.reason }
          : decision.subjectPrefix
            ? { tipo: "prueba_permitida" }
            : { tipo: "real" };
  }
  return {
    destinatario: destino.email,
    para: destino.para,
    nombreDestinatario: destino.nombre,
    bloqueo,
    bajaEn: destino.bajaEn,
    modo,
    texto: armarTexto({
      paciente: destino.pacienteNombre,
      destinatario: destino.para === "tutor" ? destino.nombre : null,
    }),
  };
}

// ─── Presupuesto (PLA-08, PLA-09, PLA-11) ────────────────────────────────────

export const getPresupuestoParaPdf = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ quoteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ hoja: HojaParaPdf; nombreArchivo: string }> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["finance:view", "patients:manage"],
      SIN_PERMISO_PRESUPUESTO,
    );
    const p = await armarPresupuestoParaPdf(supabase, { ...data, userId });
    return { hoja: p.hoja, nombreArchivo: p.nombreArchivo };
  });

export const getCorreoDePresupuesto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ quoteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<VistaDeEnvio> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["patients:manage"],
      SIN_PERMISO_ENVIAR_PRESUPUESTO,
    );
    const [{ data: q }, { data: c }] = await Promise.all([
      supabase
        .from("quotes")
        .select("number, patient_id")
        .eq("id", data.quoteId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
      supabase.from("clinics").select("name").eq("id", data.clinicId).maybeSingle(),
    ]);
    if (!q) throw new Error("No encontramos ese presupuesto.");
    return vistaDeEnvio(supabase, { clinicId: data.clinicId, patientId: q.patient_id }, (d) =>
      textoCorreoPresupuesto({ ...d, clinica: c?.name ?? "La clínica", numero: q.number }),
    );
  });

export interface ResultadoDeEnvio {
  enviado: boolean;
  motivo: string | null;
  destinatario: string;
  redirigidoA: string | null;
}

export const enviarPresupuestoPorCorreo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica.extend({ quoteId: z.string().uuid() }).merge(TextoCorreo).parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoDeEnvio> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["patients:manage"],
      SIN_PERMISO_ENVIAR_PRESUPUESTO,
    );
    const p = await armarPresupuestoParaPdf(supabase, {
      clinicId: data.clinicId,
      quoteId: data.quoteId,
      userId,
    });
    const r = await enviarPdfAlPaciente(supabase, {
      clinicId: data.clinicId,
      patientId: p.patientId,
      userId,
      asunto: data.asunto,
      mensaje: data.mensaje,
      pdf: { filename: p.nombreArchivo, bytes: await pdfDeHoja(p.hoja) },
      templateKind: "quote_sent",
      quoteId: data.quoteId,
    });
    if (r.enviado) {
      // Historial (quién, cuándo, a qué correo) y marca de enviado. Lo
      // escribe la base a partir del mensaje recién registrado.
      const { error } = await supabase.rpc("registrar_envio_de_presupuesto", {
        p_message_id: r.messageId,
        ...(r.redirigidoA ? { p_redirigido_a: r.redirigidoA } : {}),
      });
      if (error) {
        throw new Error(
          mensajeDb(
            error,
            "El correo salió, pero no pudimos marcar el presupuesto como enviado. Recarga la página.",
          ),
        );
      }
    }
    return {
      enviado: r.enviado,
      motivo: r.motivo,
      destinatario: r.destinatario,
      redirigidoA: r.redirigidoA,
    };
  });

// ─── Documento emitido (DOC-07) ──────────────────────────────────────────────

const BUCKET_FIRMAS = "professional-signatures";

async function documentoParaPdf(
  supabase: Cliente,
  clinicId: string,
  documentId: string,
): Promise<DocumentoParaPdf & { patientId: string; patientName: string }> {
  const { data: d, error } = await supabase
    .from("issued_documents")
    .select(
      "id, patient_id, title, year, number, issued_at, clinic_name_snapshot, clinic_legal_name_snapshot, clinic_tax_id_snapshot, clinic_address_snapshot, clinic_phone_snapshot, patient_name_snapshot, content_blocks, content_sha256, voided_at, void_reason, signature_storage_path",
    )
    .eq("id", documentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, SIN_PERMISO_DOCUMENTO));
  if (!d) throw new Error(SIN_PERMISO_DOCUMENTO);
  const bloques = leerBloques(d.content_blocks);
  if (!bloques)
    throw new Error("No podemos enviar este documento: su contenido no tiene la forma esperada.");
  let signatureUrl: string | null = null;
  if (d.signature_storage_path) {
    const { data: firmada } = await supabase.storage
      .from(BUCKET_FIRMAS)
      .createSignedUrl(d.signature_storage_path, 600);
    signatureUrl = firmada?.signedUrl ?? null;
  }
  const { data: c } = await supabase
    .from("clinics")
    .select("timezone")
    .eq("id", clinicId)
    .maybeSingle();
  return {
    patientId: d.patient_id,
    patientName: d.patient_name_snapshot,
    title: d.title,
    year: d.year,
    number: d.number,
    issuedAt: d.issued_at,
    timezone: c?.timezone ?? "America/Santiago",
    clinicName: d.clinic_name_snapshot,
    clinicLegalName: d.clinic_legal_name_snapshot,
    clinicTaxId: d.clinic_tax_id_snapshot,
    clinicAddress: d.clinic_address_snapshot,
    clinicPhone: d.clinic_phone_snapshot,
    bloques,
    contentSha256: d.content_sha256,
    voidedAt: d.voided_at,
    voidReason: d.void_reason,
    signatureUrl,
  };
}

export const getCorreoDeDocumento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<VistaDeEnvio> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["clinical:write"],
      SIN_PERMISO_DOCUMENTO,
    );
    const { data: d } = await supabase
      .from("issued_documents")
      .select("patient_id, title, year, number, clinic_name_snapshot, voided_at")
      .eq("id", data.documentId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (!d) throw new Error(SIN_PERMISO_DOCUMENTO);
    const vista = await vistaDeEnvio(
      supabase,
      { clinicId: data.clinicId, patientId: d.patient_id },
      (x) =>
        textoCorreoDocumento({
          ...x,
          clinica: d.clinic_name_snapshot,
          titulo: d.title,
          folio: folioDocumento(d.year, d.number),
        }),
    );
    return d.voided_at
      ? { ...vista, bloqueo: "Este documento está anulado: no se envía al paciente." }
      : vista;
  });

export const enviarDocumentoPorCorreo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica.extend({ documentId: z.string().uuid() }).merge(TextoCorreo).parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoDeEnvio> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["clinical:write"],
      SIN_PERMISO_DOCUMENTO,
    );
    const d = await documentoParaPdf(supabase, data.clinicId, data.documentId);
    if (d.voidedAt) throw new Error("Este documento está anulado: no se envía al paciente.");
    const { hojaDeDocumento, nombreDeArchivoPdf } = await import("@/lib/documentos/pdf");
    const r = await enviarPdfAlPaciente(supabase, {
      clinicId: data.clinicId,
      patientId: d.patientId,
      userId,
      asunto: data.asunto,
      mensaje: data.mensaje,
      pdf: { filename: nombreDeArchivoPdf(d), bytes: await pdfDeHoja(hojaDeDocumento(d)) },
      templateKind: "custom",
      issuedDocumentId: data.documentId,
    });
    return {
      enviado: r.enviado,
      motivo: r.motivo,
      destinatario: r.destinatario,
      redirigidoA: r.redirigidoA,
    };
  });

export interface EnvioDeDocumento {
  id: string;
  destinatario: string;
  estado: "enviado" | "fallido";
  motivo: string | null;
  enviadoPor: string | null;
  createdAt: string;
}

export const listEnviosDelDocumento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<EnvioDeDocumento[]> => {
    const { supabase } = context;
    const { data: filas, error } = await supabase
      .from("messages")
      .select("id, recipient, status, error, sent_by, created_at")
      .eq("clinic_id", data.clinicId)
      .eq("issued_document_id", data.documentId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los envíos."));
    const autores = [
      ...new Set((filas ?? []).map((f) => f.sent_by).filter((x): x is string => !!x)),
    ];
    const nombres = new Map<string, string>();
    if (autores.length) {
      const { data: perfiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", autores);
      for (const p of perfiles ?? [])
        nombres.set(p.id, p.full_name || p.email || "Alguien del equipo");
    }
    return (filas ?? []).map((f) => ({
      id: f.id,
      destinatario: f.recipient,
      estado: f.status === "failed" ? "fallido" : "enviado",
      motivo: f.status === "failed" ? f.error : null,
      enviadoPor: f.sent_by ? (nombres.get(f.sent_by) ?? "Alguien del equipo") : null,
      createdAt: f.created_at,
    }));
  });

// ─── Baja de correos del paciente ────────────────────────────────────────────

/**
 * El paciente pidió volver a recibir correos (se había dado de baja con el
 * enlace del pie). Lo hace quien gestiona pacientes, a pedido del paciente.
 */
export const reactivarCorreosDelPaciente = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => clinica.extend({ patientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["patients:manage"],
      "No tienes permisos para cambiar los datos de este paciente.",
    );
    const { data: fila, error } = await supabase
      .from("patients")
      .update({ email_opt_out_at: null })
      .eq("id", data.patientId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos reactivar los correos."));
    if (!fila) throw new Error("No tienes permisos para cambiar los datos de este paciente.");
    return { ok: true };
  });
