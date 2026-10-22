/**
 * Envío por correo al paciente de un PDF (Ola 4 · PLA-09 y DOC-07). Una sola
 * puerta para el presupuesto y para la copia de un documento emitido, con
 * los mismos frenos que cualquier correo de la clínica a un paciente:
 *
 *  1. Nunca desde la clínica demo (es de solo lectura).
 *  2. Baja del paciente (`patients.email_opt_out_at`): no se envía.
 *  3. Destinatario: el correo del paciente o, si es menor con tutor vigente,
 *     el del tutor (CLI-11, `resolverDestinatario`).
 *  4. Modo de prueba del correo de la clínica (`email_sandbox_config`): en
 *     sandbox el correo se bloquea o se desvía a la dirección de pruebas;
 *     nunca llega a un paciente real (`sendEmail` + `resolveEmailRecipient`).
 *  5. Todo intento queda en `messages` (enviado o fallido, con el motivo),
 *     con `sent_by` = quien envió.
 *
 * Corre con el cliente de Supabase del usuario (su RLS): quien no puede leer
 * al paciente o escribir mensajes no envía nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import { appOrigin } from "@/lib/app-origin.server";
import { correoAlPaciente } from "@/lib/documentos/correo";
import { mensajeDb } from "@/lib/db-errors";
import { bajaDisponible, firmarTokenDeBaja, urlPaginaDeBaja } from "@/lib/email/baja-token.server";
import { fecha } from "@/lib/formato-fecha";
import { sendEmail } from "@/lib/messaging/email.server";
import { resolverDestinatario } from "@/lib/patients/destinatario.server";

type Cliente = SupabaseClient<Database>;

export interface ResultadoEnvioAlPaciente {
  messageId: string;
  enviado: boolean;
  /** Motivo si no salió (sandbox bloqueando, Resend sin configurar, error). */
  motivo: string | null;
  /** A quién se le escribió (paciente o tutor). */
  destinatario: string;
  /** En modo de prueba: la casilla a la que llegó de verdad. */
  redirigidoA: string | null;
}

export interface DestinatarioDeCorreo {
  email: string | null;
  para: "paciente" | "tutor";
  nombre: string | null;
  /** Fecha de la baja de correos del paciente, o null. */
  bajaEn: string | null;
  pacienteNombre: string;
}

/** A quién le llegaría un correo al paciente (para mostrarlo antes de enviar). */
export async function destinatarioDelPaciente(
  supabase: Cliente,
  args: { clinicId: string; patientId: string },
): Promise<DestinatarioDeCorreo> {
  const [paciente, clinica] = await Promise.all([
    supabase
      .from("patients")
      .select("full_name, email, birth_date, email_opt_out_at")
      .eq("id", args.patientId)
      .eq("clinic_id", args.clinicId)
      .maybeSingle(),
    supabase.from("clinics").select("timezone").eq("id", args.clinicId).maybeSingle(),
  ]);
  if (paciente.error || !paciente.data) {
    throw new Error(mensajeDb(paciente.error, "No tienes permisos para ver este paciente."));
  }
  const p = paciente.data;
  const d = await resolverDestinatario(supabase, {
    clinicId: args.clinicId,
    patientId: args.patientId,
    fechaNacimiento: p.birth_date,
    telefono: null,
    email: p.email,
    timezone: clinica.data?.timezone ?? null,
  });
  return {
    email: d.email?.trim() || null,
    para: d.para,
    nombre: d.para === "tutor" ? (d.tutor?.fullName ?? null) : p.full_name,
    bajaEn: p.email_opt_out_at ?? null,
    pacienteNombre: p.full_name,
  };
}

/** Motivo para no enviar (baja o sin correo), o null si se puede. */
export function motivoParaNoEnviarCorreo(
  d: Pick<DestinatarioDeCorreo, "email" | "para" | "bajaEn">,
  zona: string,
): string | null {
  if (d.bajaEn) {
    return `El paciente se dio de baja de los correos de la clínica el ${fecha(d.bajaEn, zona)}: no se le envía nada por correo.`;
  }
  if (!d.email) {
    return d.para === "tutor"
      ? "Ni el tutor ni el paciente tienen un correo cargado."
      : "El paciente no tiene un correo cargado en su ficha.";
  }
  return null;
}

export async function enviarPdfAlPaciente(
  supabase: Cliente,
  args: {
    clinicId: string;
    patientId: string;
    userId: string;
    asunto: string;
    mensaje: string;
    pdf: { filename: string; bytes: Uint8Array };
    templateKind: "quote_sent" | "custom";
    quoteId?: string;
    issuedDocumentId?: string;
  },
): Promise<ResultadoEnvioAlPaciente> {
  await assertNotDemoClinic(supabase, args.clinicId);

  const { data: clinica, error: errClinica } = await supabase
    .from("clinics")
    .select("name, timezone")
    .eq("id", args.clinicId)
    .maybeSingle();
  if (errClinica || !clinica) {
    throw new Error(mensajeDb(errClinica, "No pudimos cargar los datos de la clínica."));
  }

  const destino = await destinatarioDelPaciente(supabase, args);
  const motivo = motivoParaNoEnviarCorreo(destino, clinica.timezone || "America/Santiago");
  if (motivo || !destino.email) throw new Error(motivo ?? "Sin correo.");

  let bajaUrl: string | null = null;
  if (bajaDisponible()) {
    const token = await firmarTokenDeBaja(args.patientId, "correos_paciente");
    bajaUrl = urlPaginaDeBaja(appOrigin(), token);
  }

  const correo = correoAlPaciente({
    appUrl: appOrigin(),
    asunto: args.asunto,
    mensaje: args.mensaje,
    clinica: clinica.name,
    adjunto: args.pdf.filename,
    bajaUrl,
  });

  const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
  const sandbox = await loadEmailSandboxConfig(supabase, args.clinicId);
  const resultado = await sendEmail(
    {
      to: destino.email,
      subject: correo.subject,
      html: correo.html,
      text: correo.text,
      attachments: [{ filename: args.pdf.filename, content: args.pdf.bytes }],
    },
    sandbox,
  );

  const ahora = new Date().toISOString();
  const { data: fila, error } = await supabase
    .from("messages")
    .insert({
      clinic_id: args.clinicId,
      patient_id: args.patientId,
      quote_id: args.quoteId ?? null,
      issued_document_id: args.issuedDocumentId ?? null,
      template_kind: args.templateKind,
      channel: "email",
      direction: "outbound",
      status: resultado.ok ? "sent" : "failed",
      recipient: destino.email,
      body: correo.html,
      external_id: resultado.ok ? resultado.externalId : null,
      error: resultado.ok ? null : resultado.reason,
      sent_at: resultado.ok ? ahora : null,
      sent_by: args.userId,
    })
    .select("id")
    .single();
  if (error) {
    // El correo pudo haber salido: se avisa sin esconderlo.
    throw new Error(
      mensajeDb(
        error,
        resultado.ok
          ? "El correo salió, pero no pudimos registrarlo en el historial."
          : "No pudimos registrar el intento de envío.",
      ),
    );
  }

  return {
    messageId: fila.id,
    enviado: resultado.ok,
    motivo: resultado.ok ? null : resultado.reason,
    destinatario: destino.email,
    redirigidoA: resultado.ok && resultado.redirected ? resultado.recipient : null,
  };
}
