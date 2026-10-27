/**
 * Server functions de la firma a distancia (Ola 5 · DOC-05).
 *
 * Staff (con sesión, RLS del usuario):
 *   getPedidoDeFirma            quién firma, por qué canales se puede mandar
 *                               el link y si hay algo que lo impida
 *   pedirFirmaADistancia        crea la solicitud (o la reenvía) y manda el
 *                               link: wa.me asistido, correo o copiar
 *   listFirmasADistancia        solicitudes de un paciente, documento o
 *                               presupuesto
 *   getEvidenciaDeFirma         evidencia completa, bitácora y copia firmada
 *   cancelarFirmaADistancia     corta un link abierto
 *
 * Página pública `/firmar/$token` (sin login; exentas del modo solo lectura
 * en `ESCRITURA_EXENTA`, validan el token en el servidor):
 *   abrirFirmaADistancia        estado mínimo (sin datos clínicos)
 *   verificarRutParaFirmar      RUT → sesión + documento
 *   enviarCodigoParaFirmar      código de 6 dígitos por correo
 *   firmarDocumentoADistancia   firma, guarda la evidencia y la copia en PDF
 *
 * Permisos (regla 15, par de los gates de la UI y de la RLS): un documento
 * emitido lo manda a firmar quien emite (`clinical:write`); un presupuesto,
 * quien escribe presupuestos (`patients:manage`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Permission } from "@/lib/access/access";
import {
  assertNotDemoClinic,
  requireClinicPermission,
  permisosEnClinica,
} from "@/lib/access/clinic-guards.server";
import { appOrigin } from "@/lib/app-origin.server";
import { mensajeDb } from "@/lib/db-errors";
import { leerBloques } from "@/lib/documentos/esquemas";
import { hojaDeDocumento } from "@/lib/documentos/pdf";
import type { Bloque } from "@/lib/documentos/tipos";
import { bajaDisponible, firmarTokenDeBaja, urlPaginaDeBaja } from "@/lib/email/baja-token.server";
import {
  estadoDeSolicitud,
  textoDeAceptacion,
  type CanalDelLink,
  type EstadoSolicitud,
  type Firmante,
  type TipoSolicitud,
} from "@/lib/firma-distancia/estado";
import {
  leerHojaGuardada,
  type Constancia,
  type HojaGuardada,
} from "@/lib/firma-distancia/evidencia";
import {
  BUCKET_DOCUMENTOS,
  BUCKET_FIRMAS_PROFESIONALES,
  base64DeBytes,
  constanciaDeSolicitud,
  exigirLimiteDeFirma,
  ipYNavegador,
  pdfDeCopiaFirmada,
} from "@/lib/firma-distancia/firma.server";
import {
  correoCodigoDeFirma,
  correoLinkDeFirma,
  textoWhatsAppDeFirma,
} from "@/lib/firma-distancia/mensajes";
import {
  esTokenValido,
  generarCodigo,
  generarSecreto,
  huellaDeCodigo,
  huellaDeSecreto,
  normalizarCodigo,
} from "@/lib/firma-distancia/token";
import { diaISO, fechaHora } from "@/lib/formato-fecha";
import { motivoParaNoEnviarWhatsApp } from "@/lib/messaging/baja-whatsapp";
import { resolveEmailRecipient } from "@/lib/messaging/email-sandbox";
import { sendEmail } from "@/lib/messaging/email.server";
import { buildWaMeUrl, normalizeToWaMe } from "@/lib/messaging/messaging";
import { resolverDestinatario } from "@/lib/patients/destinatario.server";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

type Cliente = SupabaseClient<Database>;

const SIN_PERMISO_DOCUMENTO = "No tienes permisos para pedir la firma de este documento.";
const SIN_PERMISO_PRESUPUESTO = "No tienes permisos para pedir la firma de este presupuesto.";
const TTL_URL = 60 * 10;

const clinica = z.object({ clinicId: z.string().uuid() });
const Objetivo = z.object({
  tipo: z.enum(["documento", "presupuesto"]),
  objetivoId: z.string().uuid(),
});

function permisoPara(tipo: TipoSolicitud): Permission {
  return tipo === "documento" ? "clinical:write" : "patients:manage";
}

async function exigirPermiso(
  supabase: Cliente,
  clinicId: string,
  userId: string,
  tipo: TipoSolicitud,
) {
  // Con los ajustes por persona (EQU-01).
  const acceso = await permisosEnClinica(supabase, clinicId, userId);
  if (!acceso || !acceso.permisos.includes(permisoPara(tipo))) {
    throw new Error(tipo === "documento" ? SIN_PERMISO_DOCUMENTO : SIN_PERMISO_PRESUPUESTO);
  }
}

// ─── Lo que se va a firmar ───────────────────────────────────────────────────

interface ContenidoAFirmar {
  patientId: string;
  title: string;
  hoja: HojaGuardada;
  bloques: Bloque[];
  html: string;
  firmaProfesional: { path: string; sha256: string } | null;
}

async function contenidoAFirmar(
  supabase: Cliente,
  args: { clinicId: string; userId: string; tipo: TipoSolicitud; objetivoId: string },
): Promise<ContenidoAFirmar> {
  if (args.tipo === "documento") {
    const { data: d, error } = await supabase
      .from("issued_documents")
      .select(
        "id, patient_id, title, year, number, issued_at, clinic_name_snapshot, clinic_legal_name_snapshot, clinic_tax_id_snapshot, clinic_address_snapshot, clinic_phone_snapshot, content_blocks, content_html, content_sha256, voided_at, void_reason",
      )
      .eq("id", args.objetivoId)
      .eq("clinic_id", args.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_DOCUMENTO));
    if (!d) throw new Error(SIN_PERMISO_DOCUMENTO);
    if (d.voided_at) throw new Error("Este documento está anulado: no se manda a firmar.");
    const bloques = leerBloques(d.content_blocks);
    if (!bloques) throw new Error("El documento no tiene la forma esperada: no se puede firmar.");
    const { data: c } = await supabase
      .from("clinics")
      .select("timezone")
      .eq("id", args.clinicId)
      .maybeSingle();
    const h = hojaDeDocumento({
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
      voidedAt: null,
      voidReason: null,
      signatureUrl: null,
    });
    return {
      patientId: d.patient_id,
      title: d.title,
      hoja: {
        clinicName: h.clinicName,
        lineasEncabezado: h.lineasEncabezado,
        referencia: h.referencia,
        pie: h.pie,
      },
      bloques,
      // La base vuelve a copiar el contenido desde el documento emitido.
      html: d.content_html,
      firmaProfesional: null,
    };
  }
  const { armarPresupuestoParaPdf } = await import("@/lib/documentos/presupuesto.server");
  const { bloquesAHtml } = await import("@/lib/documentos/motor");
  const p = await armarPresupuestoParaPdf(supabase, {
    clinicId: args.clinicId,
    quoteId: args.objetivoId,
    userId: args.userId,
  });
  return {
    patientId: p.patientId,
    title: `Presupuesto ${p.numero}`,
    hoja: {
      clinicName: p.hoja.clinicName,
      lineasEncabezado: p.hoja.lineasEncabezado,
      referencia: p.hoja.referencia,
      pie: p.hoja.pie,
    },
    bloques: p.hoja.bloques,
    html: bloquesAHtml(p.hoja.bloques),
    firmaProfesional: p.firmaProfesional,
  };
}

/** Paciente (o tutor) que firma, y sus canales. */
async function destinoDelPaciente(supabase: Cliente, clinicId: string, patientId: string) {
  const [{ data: p, error }, { data: c }] = await Promise.all([
    supabase
      .from("patients")
      .select(
        "id, full_name, phone, email, birth_date, document_id, wa_opt_out_at, email_opt_out_at",
      )
      .eq("id", patientId)
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase.from("clinics").select("name, country, timezone").eq("id", clinicId).maybeSingle(),
  ]);
  if (error || !p) throw new Error(mensajeDb(error, "No tienes permisos para ver este paciente."));
  const d = await resolverDestinatario(supabase, {
    clinicId,
    patientId,
    fechaNacimiento: p.birth_date,
    telefono: p.phone,
    email: p.email,
    timezone: c?.timezone ?? null,
  });
  return { paciente: p, clinica: c, destino: d };
}

// ─── Staff: vista previa del pedido ──────────────────────────────────────────

export interface PedidoDeFirma {
  firmante: Firmante;
  nombreFirmante: string;
  pacienteNombre: string;
  /** Lo que impide pedir la firma (falta RUT, correo o tutor). */
  bloqueo: string | null;
  /** A dónde llegaría el código (correo completo: lo ve el staff). */
  correoDelCodigo: string | null;
  /** Modo de prueba del correo de la clínica para el código. */
  avisoModoPrueba: string | null;
  canales: Record<CanalDelLink, { disponible: boolean; motivo: string | null }>;
  /** Solicitud abierta del mismo documento (para reenviar en vez de duplicar). */
  abierta: { id: string; estado: EstadoSolicitud; venceEl: string } | null;
}

export const getPedidoDeFirma = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.merge(Objetivo).parse(input))
  .handler(async ({ data, context }): Promise<PedidoDeFirma> => {
    const { supabase, userId } = context;
    await exigirPermiso(supabase, data.clinicId, userId, data.tipo);

    let patientId: string;
    if (data.tipo === "documento") {
      const { data: d } = await supabase
        .from("issued_documents")
        .select("patient_id")
        .eq("id", data.objetivoId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      if (!d) throw new Error(SIN_PERMISO_DOCUMENTO);
      patientId = d.patient_id;
    } else {
      const { data: q } = await supabase
        .from("quotes")
        .select("patient_id")
        .eq("id", data.objetivoId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      if (!q) throw new Error(SIN_PERMISO_PRESUPUESTO);
      patientId = q.patient_id;
    }

    const {
      paciente,
      clinica: c,
      destino,
    } = await destinoDelPaciente(supabase, data.clinicId, patientId);
    const firmante: Firmante = destino.para === "tutor" ? "tutor" : "paciente";
    const nombreFirmante =
      firmante === "tutor" ? (destino.tutor?.fullName ?? "Tutor") : paciente.full_name;

    // Mismos requisitos que exige la base al crear (patient_signature_requests_preparar).
    let bloqueo: string | null = null;
    const hoy = diaISO(new Date(), c?.timezone ?? "America/Santiago") ?? "";
    const { esMenorDeEdad } = await import("@/lib/patients/tutor");
    if (esMenorDeEdad(paciente.birth_date, hoy) === true && firmante !== "tutor") {
      bloqueo =
        "El paciente es menor de edad: agrega a su tutor en la ficha para pedirle la firma.";
    } else if (firmante === "paciente" && !paciente.document_id?.trim()) {
      bloqueo =
        "Carga el RUT del paciente en su ficha: se lo pedimos para confirmar que es él quien firma.";
    } else if (!destino.email) {
      bloqueo =
        "Agrega el correo del paciente en su ficha: el código para firmar le llega por correo.";
    }

    let avisoModoPrueba: string | null = null;
    if (destino.email) {
      const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
      const decision = resolveEmailRecipient(
        destino.email,
        await loadEmailSandboxConfig(supabase, data.clinicId),
      );
      if (decision.action === "block") {
        avisoModoPrueba = `El correo de la clínica está en modo de prueba: el código no le llegaría al paciente (${decision.reason}). Cámbialo en Clínica → Modo de prueba del correo.`;
      } else if (decision.action === "redirect") {
        avisoModoPrueba = `El correo de la clínica está en modo de prueba: el código llegaría a ${decision.recipient}, no al paciente.`;
      }
    }

    const telefonoOk = Boolean(destino.telefono && normalizeToWaMe(destino.telefono, c?.country));
    const bajaWa = motivoParaNoEnviarWhatsApp({
      waOptOutAt: paciente.wa_opt_out_at,
      tipo: "proactivo",
    });
    const canales: PedidoDeFirma["canales"] = {
      whatsapp: bajaWa
        ? { disponible: false, motivo: bajaWa }
        : telefonoOk
          ? { disponible: true, motivo: null }
          : { disponible: false, motivo: "Sin un teléfono válido en la ficha." },
      correo: paciente.email_opt_out_at
        ? {
            disponible: false,
            motivo: `Se dio de baja de los correos el ${fechaHora(paciente.email_opt_out_at, c?.timezone ?? undefined)}.`,
          }
        : destino.email
          ? { disponible: true, motivo: null }
          : { disponible: false, motivo: "Sin correo en la ficha." },
      copiado: { disponible: true, motivo: null },
    };

    const filtro = data.tipo === "documento" ? "issued_document_id" : "quote_id";
    const { data: abiertas } = await supabase
      .from("patient_signature_requests")
      .select("id, status, expires_at")
      .eq("clinic_id", data.clinicId)
      .eq(filtro, data.objetivoId)
      .in("status", ["enviada", "abierta"])
      .order("created_at", { ascending: false })
      .limit(1);
    const a = abiertas?.[0];
    const estadoAbierta = a
      ? estadoDeSolicitud({ status: a.status, expiresAt: a.expires_at })
      : null;

    return {
      firmante,
      nombreFirmante,
      pacienteNombre: paciente.full_name,
      bloqueo,
      correoDelCodigo: destino.email,
      avisoModoPrueba,
      canales,
      abierta:
        a && estadoAbierta ? { id: a.id, estado: estadoAbierta, venceEl: a.expires_at } : null,
    };
  });

// ─── Staff: pedir (o reenviar) ───────────────────────────────────────────────

export interface ResultadoDelPedido {
  id: string;
  url: string;
  venceEl: string;
  /** wa.me listo para abrir (canal WhatsApp). */
  waUrl: string | null;
  correo: { enviado: boolean; motivo: string | null; redirigidoA: string | null } | null;
}

export const pedirFirmaADistancia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica
      .merge(Objetivo)
      .extend({
        canal: z.enum(["whatsapp", "correo", "copiado"]),
        reemplazaA: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoDelPedido> => {
    const { supabase, userId } = context;
    await exigirPermiso(supabase, data.clinicId, userId, data.tipo);
    await assertNotDemoClinic(supabase, data.clinicId);

    const contenido = await contenidoAFirmar(supabase, { ...data, userId });
    const {
      paciente,
      clinica: c,
      destino,
    } = await destinoDelPaciente(supabase, data.clinicId, contenido.patientId);
    const nombreDestino =
      destino.para === "tutor" ? (destino.tutor?.fullName ?? null) : paciente.full_name;

    // El canal se valida ANTES de crear: un pedido que no puede salir no se crea.
    if (data.canal === "whatsapp") {
      const baja = motivoParaNoEnviarWhatsApp({
        waOptOutAt: paciente.wa_opt_out_at,
        tipo: "proactivo",
      });
      if (baja) throw new Error(baja);
      if (!destino.telefono || !normalizeToWaMe(destino.telefono, c?.country)) {
        throw new Error("El paciente no tiene un teléfono válido para WhatsApp. Copia el link.");
      }
    }
    if (data.canal === "correo") {
      if (paciente.email_opt_out_at) {
        throw new Error(
          "El paciente se dio de baja de los correos de la clínica. Usa WhatsApp o copia el link.",
        );
      }
      if (!destino.email) throw new Error("El paciente no tiene correo en su ficha.");
    }

    const token = generarSecreto();
    const tokenHash = await huellaDeSecreto(token);
    const { data: fila, error } = await supabase
      .from("patient_signature_requests")
      .insert({
        clinic_id: data.clinicId,
        patient_id: contenido.patientId,
        kind: data.tipo,
        issued_document_id: data.tipo === "documento" ? data.objetivoId : null,
        quote_id: data.tipo === "presupuesto" ? data.objetivoId : null,
        replaces_request_id: data.reemplazaA ?? null,
        title: contenido.title,
        sheet: contenido.hoja as unknown as Json,
        content_blocks: contenido.bloques as unknown as Json,
        content_html: contenido.html,
        professional_signature_path: contenido.firmaProfesional?.path ?? null,
        professional_signature_sha256: contenido.firmaProfesional?.sha256 ?? null,
        // La base los pone (huella, firmante, vencimiento): se mandan de relleno.
        document_sha256: "la-calcula-la-base",
        signer_role: "paciente",
        signer_expected_name: "la-pone-la-base",
        expires_at: new Date().toISOString(),
        link_channel: data.canal,
        token_hash: tokenHash,
        created_by: userId,
      })
      .select("id, expires_at")
      .single();
    if (error || !fila) {
      throw new Error(
        mensajeDb(error, "No pudimos pedir la firma. Revisa los datos del paciente."),
      );
    }

    const url = `${appOrigin()}/firmar/${token}`;
    const zona = c?.timezone ?? "America/Santiago";
    // Historial del paciente: sin el link (lleva el token) y sin el nombre
    // del documento (puede ser clínico).
    const historial = `Link para firmar a distancia enviado (vence el ${fechaHora(fila.expires_at, zona)}).`;

    if (data.canal === "whatsapp") {
      const texto = textoWhatsAppDeFirma({
        nombre: nombreDestino,
        clinica: c?.name ?? "Tu clínica",
        url,
      });
      const waUrl = buildWaMeUrl(destino.telefono, texto, c?.country);
      const { error: errMsg } = await supabase.from("messages").insert({
        clinic_id: data.clinicId,
        patient_id: contenido.patientId,
        quote_id: data.tipo === "presupuesto" ? data.objetivoId : null,
        channel: "whatsapp",
        direction: "outbound",
        status: "queued",
        template_kind: "custom",
        recipient: destino.telefono ?? "",
        body: historial,
        sent_by: userId,
      });
      if (errMsg) console.error("[firma-distancia] no se pudo registrar el envío", errMsg.message);
      return { id: fila.id, url, venceEl: fila.expires_at, waUrl, correo: null };
    }

    if (data.canal === "correo" && destino.email) {
      let bajaUrl: string | null = null;
      if (bajaDisponible()) {
        bajaUrl = urlPaginaDeBaja(
          appOrigin(),
          await firmarTokenDeBaja(contenido.patientId, "correos_paciente"),
        );
      }
      const correo = correoLinkDeFirma({
        appUrl: appOrigin(),
        clinica: c?.name ?? "Tu clínica",
        nombre: nombreDestino,
        url,
        bajaUrl,
      });
      const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
      const r = await sendEmail(
        { to: destino.email, subject: correo.subject, html: correo.html, text: correo.text },
        await loadEmailSandboxConfig(supabase, data.clinicId),
      );
      const { error: errMsg } = await supabase.from("messages").insert({
        clinic_id: data.clinicId,
        patient_id: contenido.patientId,
        quote_id: data.tipo === "presupuesto" ? data.objetivoId : null,
        channel: "email",
        direction: "outbound",
        status: r.ok ? "sent" : "failed",
        template_kind: "custom",
        recipient: destino.email,
        body: historial,
        external_id: r.ok ? r.externalId : null,
        error: r.ok ? null : r.reason,
        sent_at: r.ok ? new Date().toISOString() : null,
        sent_by: userId,
      });
      if (errMsg) console.error("[firma-distancia] no se pudo registrar el envío", errMsg.message);
      return {
        id: fila.id,
        url,
        venceEl: fila.expires_at,
        waUrl: null,
        correo: {
          enviado: r.ok,
          motivo: r.ok ? null : r.reason,
          redirigidoA: r.ok && r.redirected ? r.recipient : null,
        },
      };
    }

    return { id: fila.id, url, venceEl: fila.expires_at, waUrl: null, correo: null };
  });

// ─── Staff: listar, ver la evidencia, cancelar ───────────────────────────────

export interface SolicitudDeFirma {
  id: string;
  tipo: TipoSolicitud;
  issuedDocumentId: string | null;
  quoteId: string | null;
  titulo: string;
  estado: EstadoSolicitud;
  canal: CanalDelLink;
  firmante: Firmante;
  nombreFirmante: string;
  creadaEl: string;
  venceEl: string;
  abiertaEl: string | null;
  firmadaEl: string | null;
  firmadoPor: string | null;
  canceladaEl: string | null;
  bloqueadaHasta: string | null;
  tieneCopia: boolean;
}

const COLUMNAS_LISTA =
  "id, kind, issued_document_id, quote_id, title, status, link_channel, signer_role, signer_expected_name, created_at, expires_at, opened_at, signed_at, signer_name, cancelled_at, locked_until, signed_copy_path";

export const listFirmasADistancia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    clinica
      .extend({
        patientId: z.string().uuid().optional(),
        issuedDocumentId: z.string().uuid().optional(),
        quoteId: z.string().uuid().optional(),
      })
      .refine((d) => d.patientId || d.issuedDocumentId || d.quoteId, "Falta el filtro.")
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SolicitudDeFirma[]> => {
    let q = context.supabase
      .from("patient_signature_requests")
      .select(COLUMNAS_LISTA)
      .eq("clinic_id", data.clinicId);
    if (data.patientId) q = q.eq("patient_id", data.patientId);
    if (data.issuedDocumentId) q = q.eq("issued_document_id", data.issuedDocumentId);
    if (data.quoteId) q = q.eq("quote_id", data.quoteId);
    const { data: filas, error } = await q.order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las firmas a distancia."));
    const ahora = new Date();
    return (filas ?? []).map((f) => ({
      id: f.id,
      tipo: f.kind as TipoSolicitud,
      issuedDocumentId: f.issued_document_id,
      quoteId: f.quote_id,
      titulo: f.title,
      estado: estadoDeSolicitud({ status: f.status, expiresAt: f.expires_at }, ahora),
      canal: f.link_channel as CanalDelLink,
      firmante: f.signer_role as Firmante,
      nombreFirmante: f.signer_expected_name,
      creadaEl: f.created_at,
      venceEl: f.expires_at,
      abiertaEl: f.opened_at,
      firmadaEl: f.signed_at,
      firmadoPor: f.signer_name,
      canceladaEl: f.cancelled_at,
      bloqueadaHasta: f.locked_until && new Date(f.locked_until) > ahora ? f.locked_until : null,
      tieneCopia: Boolean(f.signed_copy_path),
    }));
  });

export interface EventoDeFirma {
  tipo: string;
  creadoEl: string;
  ip: string | null;
  dispositivo: string | null;
  porStaff: boolean;
}

export interface EvidenciaDeFirma {
  solicitud: SolicitudDeFirma;
  zona: string;
  pacienteNombre: string;
  constancia: Constancia | null;
  /** Para recalcular la huella en el navegador ("Evidencia íntegra"). */
  bloques: Bloque[] | null;
  hoja: HojaGuardada | null;
  firmaPacienteUrl: string | null;
  copiaUrl: string | null;
  copiaSha256: string | null;
  codigoA: string | null;
  canceladaPor: string | null;
  motivoCancelacion: string | null;
  eventos: EventoDeFirma[];
}

export const getEvidenciaDeFirma = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinica.extend({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<EvidenciaDeFirma> => {
    const { supabase } = context;
    const { data: s, error } = await supabase
      .from("patient_signature_requests")
      .select(
        `${COLUMNAS_LISTA}, patient_id, sheet, content_blocks, document_sha256, signer_rut_sha256, signer_rut_masked, code_channel, code_recipient_masked, signed_ip, signed_user_agent, accepted_text, signature_storage_path, signature_sha256, signed_at_local, evidence_sha256, clinic_timezone, signed_copy_sha256, cancelled_by, cancel_reason`,
      )
      .eq("id", data.requestId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la firma."));
    if (!s) throw new Error("No tienes permisos para ver esta firma.");

    const [{ data: p }, { data: evs }] = await Promise.all([
      supabase.from("patients").select("full_name").eq("id", s.patient_id).maybeSingle(),
      supabase
        .from("patient_signature_events")
        .select("kind, created_at, ip_hint, user_agent, actor_id")
        .eq("request_id", s.id)
        .order("created_at", { ascending: true })
        .limit(200),
    ]);
    const pacienteNombre = p?.full_name ?? "Paciente";

    // Las imágenes y el PDF están en clinical-documents, que solo leen los
    // roles clínicos. La RLS de la solicitud ya dejó leer la fila (recepción
    // ve las de presupuestos): la URL (10 min, de ESA ruta) la firma el rol
    // de servicio, igual que la firma del profesional en el presupuesto.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const firmar = async (ruta: string | null) => {
      if (!ruta) return null;
      const { data: u } = await supabaseAdmin.storage
        .from(BUCKET_DOCUMENTOS)
        .createSignedUrl(ruta, TTL_URL);
      return u?.signedUrl ?? null;
    };
    const [firmaPacienteUrl, copiaUrl] = await Promise.all([
      firmar(s.signature_storage_path),
      firmar(s.signed_copy_path),
    ]);

    let canceladaPor: string | null = null;
    if (s.cancelled_by) {
      const { data: perfil } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", s.cancelled_by)
        .maybeSingle();
      canceladaPor = perfil?.full_name ?? "Alguien del equipo";
    }

    const ahora = new Date();
    return {
      solicitud: {
        id: s.id,
        tipo: s.kind as TipoSolicitud,
        issuedDocumentId: s.issued_document_id,
        quoteId: s.quote_id,
        titulo: s.title,
        estado: estadoDeSolicitud({ status: s.status, expiresAt: s.expires_at }, ahora),
        canal: s.link_channel as CanalDelLink,
        firmante: s.signer_role as Firmante,
        nombreFirmante: s.signer_expected_name,
        creadaEl: s.created_at,
        venceEl: s.expires_at,
        abiertaEl: s.opened_at,
        firmadaEl: s.signed_at,
        firmadoPor: s.signer_name,
        canceladaEl: s.cancelled_at,
        bloqueadaHasta: s.locked_until && new Date(s.locked_until) > ahora ? s.locked_until : null,
        tieneCopia: Boolean(s.signed_copy_path),
      },
      zona: s.clinic_timezone ?? "America/Santiago",
      pacienteNombre,
      constancia: s.signed_at ? constanciaDeSolicitud(s, pacienteNombre) : null,
      bloques: leerBloques(s.content_blocks),
      hoja: leerHojaGuardada(s.sheet),
      firmaPacienteUrl,
      copiaUrl,
      copiaSha256: s.signed_copy_sha256,
      codigoA: s.code_recipient_masked,
      canceladaPor,
      motivoCancelacion: s.cancel_reason,
      eventos: (evs ?? []).map((e) => ({
        tipo: e.kind,
        creadoEl: e.created_at,
        ip: e.ip_hint,
        dispositivo: e.user_agent,
        porStaff: Boolean(e.actor_id),
      })),
    };
  });

export const cancelarFirmaADistancia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica
      .extend({
        requestId: z.string().uuid(),
        motivo: z.string().trim().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;
    const { error } = await supabase.rpc("firma_remota_cancelar", {
      p_request_id: data.requestId,
      ...(data.motivo ? { p_motivo: data.motivo } : {}),
    });
    if (error)
      throw new Error(mensajeDb(error, "No tienes permisos para cancelar esta solicitud."));
    return { ok: true };
  });

// ─── Staff: plantilla que requiere la firma del paciente ─────────────────────

/**
 * Marca (o desmarca) una plantilla de documento como "el paciente la firma":
 * sus documentos emitidos se pueden mandar a firmar a distancia. Los
 * consentimientos lo requieren siempre. Quien edita plantillas
 * (`settings:manage`, par de la RLS `can_manage_clinic`).
 */
export const setPlantillaRequiereFirma = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    clinica.extend({ templateId: z.string().uuid(), requiere: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const mensaje = "No tienes permisos para editar las plantillas de documentos.";
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", mensaje);
    const { data: fila, error } = await supabase
      .from("document_templates")
      .update({ requires_patient_signature: data.requiere })
      .eq("id", data.templateId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, mensaje));
    if (!fila) throw new Error(mensaje);
    return { ok: true };
  });

// ─── Página pública ──────────────────────────────────────────────────────────

const TokenSchema = z.string().refine(esTokenValido, "Link inválido.");
const SesionSchema = z.string().refine(esTokenValido, "Sesión inválida.");

type JsonObj = Record<string, unknown>;

function obj(valor: unknown): JsonObj {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as JsonObj) : {};
}
function texto(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

export type EstadoPublico = EstadoSolicitud | "invalida" | "limitada";

export interface FirmaAbierta {
  estado: EstadoPublico;
  tipo: TipoSolicitud | null;
  clinica: string | null;
  firmante: Firmante | null;
  codigoA: string | null;
  venceEl: string | null;
  bloqueadaHasta: string | null;
  firmadaEl: string | null;
  zona: string;
}

export const abrirFirmaADistancia = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<FirmaAbierta> => {
    const { ip, ua } = ipYNavegador();
    exigirLimiteDeFirma(ip);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("firma_remota_abrir", {
      p_token_hash: await huellaDeSecreto(data.token),
      p_ip: ip ?? "",
      p_user_agent: ua ?? "",
    });
    if (error) throw new Error("No pudimos abrir el documento. Vuelve a intentarlo.");
    const j = obj(r);
    return {
      estado: (texto(j.estado) ?? "invalida") as EstadoPublico,
      tipo: (texto(j.tipo) as TipoSolicitud | null) ?? null,
      clinica: texto(j.clinica),
      firmante: (texto(j.firmante) as Firmante | null) ?? null,
      codigoA: texto(j.codigo_a),
      venceEl: texto(j.vence),
      bloqueadaHasta: texto(j.bloqueada_hasta),
      firmadaEl: texto(j.firmada_el),
      zona: texto(j.zona) ?? "America/Santiago",
    };
  });

export type VerificacionDeRut =
  | {
      ok: true;
      sesion: string;
      tipo: TipoSolicitud;
      titulo: string;
      hoja: HojaGuardada | null;
      bloques: Bloque[] | null;
      documentoSha256: string;
      firmante: Firmante;
      nombreFirmante: string;
      codigoA: string | null;
      firmaProfesionalUrl: string | null;
      textoAceptacion: string;
    }
  | {
      ok: false;
      estado: EstadoPublico;
      restantes: number | null;
      bloqueadaHasta: string | null;
    };

export const verificarRutParaFirmar = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: TokenSchema,
        rut: z.string().trim().min(3, "Escribe tu RUT.").max(20),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<VerificacionDeRut> => {
    const { ip, ua } = ipYNavegador();
    exigirLimiteDeFirma(ip);
    const sesion = generarSecreto();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("firma_remota_verificar_rut", {
      p_token_hash: await huellaDeSecreto(data.token),
      p_documento: data.rut,
      p_session_hash: await huellaDeSecreto(sesion),
      p_ip: ip ?? "",
      p_user_agent: ua ?? "",
    });
    if (error) throw new Error("No pudimos verificar tu RUT. Vuelve a intentarlo.");
    const j = obj(r);
    if (j.ok !== true) {
      return {
        ok: false,
        estado: (texto(j.estado) ?? "invalida") as EstadoPublico,
        restantes: typeof j.restantes === "number" ? j.restantes : null,
        bloqueadaHasta: texto(j.bloqueada_hasta),
      };
    }
    let firmaProfesionalUrl: string | null = null;
    const ruta = texto(j.firma_profesional_path);
    if (ruta) {
      const { data: u } = await supabaseAdmin.storage
        .from(BUCKET_FIRMAS_PROFESIONALES)
        .createSignedUrl(ruta, TTL_URL);
      firmaProfesionalUrl = u?.signedUrl ?? null;
    }
    const tipo = (texto(j.tipo) ?? "documento") as TipoSolicitud;
    const titulo = texto(j.titulo) ?? "Documento";
    return {
      ok: true,
      sesion,
      tipo,
      titulo,
      hoja: leerHojaGuardada(j.hoja),
      bloques: leerBloques(j.bloques),
      documentoSha256: texto(j.documento_sha256) ?? "",
      firmante: (texto(j.firmante) ?? "paciente") as Firmante,
      nombreFirmante: texto(j.firmante_nombre) ?? "",
      codigoA: texto(j.codigo_a),
      firmaProfesionalUrl,
      textoAceptacion: textoDeAceptacion({ tipo, titulo }),
    };
  });

const MOTIVOS_CODIGO: Record<string, string> = {
  limitada: "Demasiados intentos desde esta conexión. Espera unos minutos.",
  invalida: "Este link no es válido.",
  sesion: "Tu sesión venció. Vuelve a escribir tu RUT.",
  bloqueada: "Por seguridad, la firma quedó bloqueada unos minutos.",
  demasiados: "Ya pediste varios códigos. Pídele a la clínica un link nuevo.",
  sin_correo: "No tenemos un correo para mandarte el código. Avísale a la clínica.",
  vencida: "Este link venció. Pídele a la clínica uno nuevo.",
  firmada: "Este documento ya está firmado.",
  cancelada: "La clínica canceló este pedido de firma.",
  reemplazada: "La clínica te mandó un link más nuevo: usa ese.",
};

export type EnvioDeCodigo =
  | { ok: true; codigoA: string | null; venceEl: string | null; redirigido: boolean }
  | { ok: false; motivo: string; esperarSegundos: number | null };

export const enviarCodigoParaFirmar = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: TokenSchema, sesion: SesionSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<EnvioDeCodigo> => {
    const { ip, ua } = ipYNavegador();
    exigirLimiteDeFirma(ip);
    const tokenHash = await huellaDeSecreto(data.token);
    const codigo = generarCodigo();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("firma_remota_preparar_codigo", {
      p_token_hash: tokenHash,
      p_session_hash: await huellaDeSecreto(data.sesion),
      p_code_hash: await huellaDeCodigo(tokenHash, codigo),
      p_ip: ip ?? "",
      p_user_agent: ua ?? "",
    });
    if (error) throw new Error("No pudimos preparar el código. Vuelve a intentarlo.");
    const j = obj(r);
    if (j.ok !== true) {
      const motivo = texto(j.motivo) ?? "invalida";
      const esperar = typeof j.esperar === "number" ? j.esperar : null;
      return {
        ok: false,
        motivo:
          motivo === "espera"
            ? `Ya te mandamos un código. Puedes pedir otro en ${esperar ?? 60} segundos.`
            : (MOTIVOS_CODIGO[motivo] ?? "No pudimos enviar el código."),
        esperarSegundos: esperar,
      };
    }

    const email = texto(j.email);
    const clinicId = texto(j.clinic_id);
    if (!email || !clinicId) {
      return { ok: false, motivo: MOTIVOS_CODIGO.sin_correo, esperarSegundos: null };
    }
    const correo = correoCodigoDeFirma({
      appUrl: appOrigin(),
      clinica: texto(j.clinica) ?? "Tu clínica",
      nombre: texto(j.nombre),
      codigo,
    });
    const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
    const envio = await sendEmail(
      { to: email, subject: correo.subject, html: correo.html, text: correo.text },
      await loadEmailSandboxConfig(supabaseAdmin, clinicId),
    );
    if (!envio.ok) {
      console.error("[firma-distancia] no salió el correo del código:", envio.reason);
      return {
        ok: false,
        motivo:
          "No pudimos enviarte el código por correo. Intenta de nuevo en un minuto o avísale a la clínica.",
        esperarSegundos: 60,
      };
    }
    return {
      ok: true,
      codigoA: texto(j.codigo_a),
      venceEl: texto(j.vence),
      redirigido: envio.redirected,
    };
  });

const MOTIVOS_FIRMA: Record<string, string> = {
  ...MOTIVOS_CODIGO,
  codigo_vencido: "El código venció. Pide uno nuevo.",
  codigo_incorrecto: "El código no coincide.",
  presupuesto_no_disponible: "Este presupuesto ya no se puede aceptar. Habla con la clínica.",
  presupuesto_vencido: "Este presupuesto venció. Pídele a la clínica uno actualizado.",
  presupuesto_cambio:
    "La clínica cambió el presupuesto después de enviártelo. Pídele un link nuevo para firmar la versión vigente.",
};

export type ResultadoDeFirma =
  | {
      ok: true;
      firmadaEl: string;
      evidenciaSha256: string;
      documentoSha256: string;
      pdf: { base64: string; nombre: string } | null;
    }
  | { ok: false; motivo: string; restantes: number | null; bloqueadaHasta: string | null };

/** Imagen PNG de la firma (data URL), hasta ~300 KB. */
const FirmaDataUrl = z
  .string()
  .max(420_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "La firma no es una imagen válida.");

export const firmarDocumentoADistancia = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: TokenSchema,
        sesion: SesionSchema,
        codigo: z.string().max(20),
        nombre: z.string().trim().min(3, "Escribe tu nombre completo.").max(120),
        acepto: z.literal(true, { message: "Marca que leíste y aceptas el documento." }),
        firma: FirmaDataUrl.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ResultadoDeFirma> => {
    const { ip, ua } = ipYNavegador();
    exigirLimiteDeFirma(ip);
    const codigo = normalizarCodigo(data.codigo);
    if (!codigo) {
      return {
        ok: false,
        motivo: "El código tiene 6 dígitos.",
        restantes: null,
        bloqueadaHasta: null,
      };
    }
    const tokenHash = await huellaDeSecreto(data.token);
    const sesionHash = await huellaDeSecreto(data.sesion);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: u, error: errU } = await supabaseAdmin.rpc("firma_remota_ubicacion", {
      p_token_hash: tokenHash,
      p_session_hash: sesionHash,
    });
    if (errU) throw new Error("No pudimos registrar tu firma. Vuelve a intentarlo.");
    const ubicacion = obj(u);
    const clinicId = texto(ubicacion.clinic_id);
    const patientId = texto(ubicacion.patient_id);
    const tipo = (texto(ubicacion.kind) ?? "documento") as TipoSolicitud;
    const titulo = texto(ubicacion.title) ?? "Documento";
    if (!clinicId || !patientId) {
      return { ok: false, motivo: MOTIVOS_FIRMA.sesion, restantes: null, bloqueadaHasta: null };
    }

    // La imagen de la firma (opcional) se guarda antes: la base exige que el
    // archivo exista. Si la firma no pasa, se borra.
    let firmaPath: string | null = null;
    let firmaSha: string | null = null;
    if (data.firma) {
      const firmaBytes = new Uint8Array(Buffer.from(data.firma.split(",")[1] ?? "", "base64"));
      if (firmaBytes.length < 100) {
        return {
          ok: false,
          motivo: "La firma dibujada está vacía.",
          restantes: null,
          bloqueadaHasta: null,
        };
      }
      const digest = await globalThis.crypto.subtle.digest("SHA-256", firmaBytes);
      firmaSha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      firmaPath = `${clinicId}/${patientId}/firmas-a-distancia/${crypto.randomUUID()}.png`;
      const { error: up } = await supabaseAdmin.storage
        .from(BUCKET_DOCUMENTOS)
        .upload(firmaPath, firmaBytes, { contentType: "image/png", upsert: false });
      if (up) throw new Error("No pudimos guardar tu firma dibujada. Vuelve a intentarlo.");
    }
    const borrarImagen = async () => {
      if (firmaPath) await supabaseAdmin.storage.from(BUCKET_DOCUMENTOS).remove([firmaPath]);
    };

    const { data: r, error } = await supabaseAdmin.rpc("firma_remota_firmar", {
      p_token_hash: tokenHash,
      p_session_hash: sesionHash,
      p_code_hash: await huellaDeCodigo(tokenHash, codigo),
      p_nombre: data.nombre,
      p_texto_aceptado: textoDeAceptacion({ tipo, titulo }),
      p_firma_path: firmaPath ?? "",
      p_firma_sha256: firmaSha ?? "",
      p_ip: ip ?? "",
      p_user_agent: ua ?? "",
    });
    if (error) {
      await borrarImagen();
      throw new Error(mensajeDb(error, "No pudimos registrar tu firma. Vuelve a intentarlo."));
    }
    const j = obj(r);
    if (j.ok !== true) {
      await borrarImagen();
      const motivo = texto(j.motivo) ?? "invalida";
      return {
        ok: false,
        motivo: MOTIVOS_FIRMA[motivo] ?? "No pudimos registrar tu firma.",
        restantes: typeof j.restantes === "number" ? j.restantes : null,
        bloqueadaHasta: texto(j.bloqueada_hasta),
      };
    }

    // Copia firmada: el PDF con la constancia, guardado en la ficha y
    // devuelto al paciente en esta misma respuesta. Si falla, la firma
    // igual vale (la clínica la ve y puede descargar la copia).
    const { data: s } = await supabaseAdmin
      .from("patient_signature_requests")
      .select("*")
      .eq("id", texto(j.id) ?? "")
      .maybeSingle();
    let pdf: { base64: string; nombre: string } | null = null;
    if (s) {
      try {
        const { data: paciente } = await supabaseAdmin
          .from("patients")
          .select("full_name")
          .eq("id", s.patient_id)
          .maybeSingle();
        let firmaProfesionalUrl: string | null = null;
        if (s.professional_signature_path) {
          const { data: fu } = await supabaseAdmin.storage
            .from(BUCKET_FIRMAS_PROFESIONALES)
            .createSignedUrl(s.professional_signature_path, TTL_URL);
          firmaProfesionalUrl = fu?.signedUrl ?? null;
        }
        const constancia = constanciaDeSolicitud(s, paciente?.full_name ?? null);
        const copia = await pdfDeCopiaFirmada(s, constancia, {
          firmaProfesionalUrl,
          firmaPacienteUrl: data.firma ?? null,
        });
        const ruta = `${s.clinic_id}/${s.patient_id}/firmas-a-distancia/${s.id}.pdf`;
        const { error: up } = await supabaseAdmin.storage
          .from(BUCKET_DOCUMENTOS)
          .upload(ruta, copia.bytes, { contentType: "application/pdf", upsert: false });
        if (up) throw up;
        const { error: reg } = await supabaseAdmin.rpc("firma_remota_guardar_copia", {
          p_token_hash: tokenHash,
          p_path: ruta,
          p_sha256: copia.sha256,
        });
        if (reg) throw reg;
        pdf = { base64: base64DeBytes(copia.bytes), nombre: copia.nombre };
      } catch (e) {
        console.error("[firma-distancia] la copia firmada no se pudo guardar", e);
      }
    }

    return {
      ok: true,
      firmadaEl: texto(j.firmada_el) ?? new Date().toISOString(),
      evidenciaSha256: texto(j.evidencia_sha256) ?? "",
      documentoSha256: s?.document_sha256 ?? "",
      pdf,
    };
  });
