import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import { fetchPatientBalances } from "@/lib/patients/patients.functions";
import { resolverDestinatario } from "@/lib/patients/destinatario.server";
import {
  MESSAGE_CHANNELS,
  MESSAGE_TEMPLATE_KINDS,
  OUTREACH_TEMPLATE_KINDS,
  buildWaMeUrl,
  renderTemplate,
  renderTemplateHtml,
  type Message,
  type MessageTemplate,
  type OutreachTemplateKind,
} from "@/lib/messaging/messaging";
import { tryMetaTemplateSend } from "@/lib/messaging/whatsapp.functions";
import { mensajeTelefonoInvalido, normalizeToWaMe } from "@/lib/messaging/telefonos";
import { motivoParaNoEnviarWhatsApp, quitarBajasDeWhatsApp } from "@/lib/messaging/baja-whatsapp";
import { sendEmail } from "@/lib/messaging/email.server";
import { DEFAULT_EMAIL_SANDBOX, clampMinEntregas } from "@/lib/messaging/email-sandbox";
import type { EmailSandboxConfig } from "@/lib/messaging/email-sandbox";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/** Lee la config de sandbox de email de la clínica desde la DB (fuente de
 * verdad única, compartida con /sandbox-email). Sin fila = default seguro.
 * Exportada: `closeCommissionPeriod` (commissions.functions.ts) la reusa
 * para avisar a profesionales, un destinatario que no encaja en
 * `sendEmailFromTemplate` (exige patientId) pero debe respetar el mismo
 * gate de sandbox que cualquier otro email de la clínica. */
export async function loadEmailSandboxConfig(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<EmailSandboxConfig> {
  const { data: row } = await supabase
    .from("email_sandbox_config")
    .select(
      "mode, redirect_to, allowlist, redirect_enabled, prefix_subject, min_entregas_produccion",
    )
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!row) return DEFAULT_EMAIL_SANDBOX;
  return {
    mode: row.mode === "production" ? "production" : "sandbox",
    redirectTo: row.redirect_to ?? "",
    allowlist: Array.isArray(row.allowlist) ? row.allowlist : [],
    redirectEnabled: row.redirect_enabled,
    prefixSubject: row.prefix_subject,
    minEntregasProduccion: clampMinEntregas(row.min_entregas_produccion),
  };
}

const MESSAGE_COLUMNS =
  "id, direction, appointment_id, quote_id, template_id, template_kind, channel, status, recipient, body, sent_at, created_at";
const TEMPLATE_COLUMNS = "id, kind, name, channel, body, is_active";

type MessageRow = {
  id: string;
  direction: string;
  appointment_id: string | null;
  quote_id: string | null;
  template_id: string | null;
  template_kind: string | null;
  channel: string;
  status: string;
  recipient: string;
  body: string;
  sent_at: string | null;
  created_at: string;
};

type TemplateRow = {
  id: string;
  kind: string;
  name: string;
  channel: string;
  body: string;
  is_active: boolean;
};

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    direction: row.direction === "inbound" ? "inbound" : "outbound",
    appointmentId: row.appointment_id,
    quoteId: row.quote_id,
    templateId: row.template_id,
    templateKind: row.template_kind as Message["templateKind"],
    channel: row.channel as Message["channel"],
    status: row.status as Message["status"],
    recipient: row.recipient,
    body: row.body,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

function mapTemplate(row: TemplateRow): MessageTemplate {
  return {
    id: row.id,
    kind: row.kind as MessageTemplate["kind"],
    name: row.name,
    channel: row.channel as MessageTemplate["channel"],
    body: row.body,
    isActive: row.is_active,
  };
}

/** Templates activos de la clínica. */
export const listMessageTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<MessageTemplate[]> => {
    const { data: rows, error } = await context.supabase
      .from("message_templates")
      .select(TEMPLATE_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("kind", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las plantillas de mensajes."));
    return (rows ?? []).map((r) => mapTemplate(r as TemplateRow));
  });

/** Historial de mensajes del paciente (más reciente primero). */
export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<Message[]> => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el historial de mensajes."));
    return (rows ?? []).map((r) => mapMessage(r as MessageRow));
  });

/**
 * Envío por WhatsApp usando link wa.me — sin proveedor externo, cero costo.
 * Renderiza el template con las variables provistas, guarda el mensaje en la
 * DB con status='sent' (asumimos que si el usuario abrió el link lo mandó),
 * y devuelve la URL de wa.me para que el cliente la abra en una tab nueva.
 * Cuando integremos API real (Fase 4B), cambiar el status a 'queued' acá y
 * poner el envío detrás de una cola con retries.
 */
export const sendWhatsAppFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        templateId: z.string().uuid().optional(),
        templateKind: z.enum(MESSAGE_TEMPLATE_KINDS).optional(),
        variables: z.record(z.string(), z.string()).default({}),
        // Alternativa: mensaje libre, ignora template
        rawBody: z.string().trim().max(1500).optional(),
        appointmentId: z.string().uuid().optional(),
        quoteId: z.string().uuid().optional(),
        // Sobrescribe teléfono del paciente si hace falta (segunda línea, etc.)
        recipientOverride: z.string().trim().optional(),
      })
      .refine((v) => v.templateId || v.templateKind || v.rawBody, {
        message: "Necesitas pasar template o rawBody.",
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      id: string;
      waUrl: string | null;
      body: string;
      recipient: string;
      /** true si se mandó de verdad por la Cloud API (no hay wa.me que abrir). */
      viaApi: boolean;
    }> => {
      const { supabase, userId } = context;
      // La demo no habla con Meta (y el insert en `messages` lo frena igual
      // el trigger `block_demo_writes`): cortar antes del envío real.
      await assertNotDemoClinic(supabase, data.clinicId);

      // Traer paciente para número y nombre, y el país de la clínica para
      // leer el número (BIL-11: sin país, un número local no se envía).
      const [{ data: patient, error: patientErr }, { data: clinic }] = await Promise.all([
        supabase
          .from("patients")
          .select("full_name, phone, birth_date, wa_opt_out_at")
          .eq("clinic_id", data.clinicId)
          .eq("id", data.patientId)
          .maybeSingle(),
        supabase.from("clinics").select("country, timezone").eq("id", data.clinicId).maybeSingle(),
      ]);
      if (patientErr)
        throw new Error(mensajeDb(patientErr, "No pudimos obtener los datos del paciente."));
      if (!patient) throw new Error("Paciente no encontrado.");

      // CON-09: la baja se respeta acá, no solo en la UI. Ni API ni wa.me,
      // tampoco con `recipientOverride` (la baja es del paciente, no del
      // número). Antes de registrar nada en `messages`.
      const bloqueo = motivoParaNoEnviarWhatsApp({
        waOptOutAt: patient.wa_opt_out_at,
        tipo: "proactivo",
      });
      if (bloqueo) throw new Error(bloqueo);

      // Paciente menor con tutor vigente: el mensaje va al tutor (CLI-11).
      const destinatario = data.recipientOverride
        ? null
        : await resolverDestinatario(supabase, {
            clinicId: data.clinicId,
            patientId: data.patientId,
            fechaNacimiento: patient.birth_date,
            telefono: patient.phone,
            email: null,
            timezone: clinic?.timezone ?? null,
          });
      const recipient = (data.recipientOverride ?? destinatario?.telefono ?? "").trim();
      if (!recipient) {
        throw new Error("El paciente no tiene teléfono cargado y no se pasó otro destino.");
      }
      const country = clinic?.country ?? null;
      // Antes de registrar nada: si el número no se puede leer con el país
      // de la clínica, no se manda ni por API ni por wa.me.
      if (!normalizeToWaMe(recipient, country)) {
        throw new Error(mensajeTelefonoInvalido(recipient, country));
      }

      // Resolver template
      let templateId: string | null = data.templateId ?? null;
      let templateKind: (typeof MESSAGE_TEMPLATE_KINDS)[number] | null = data.templateKind ?? null;
      let body: string;
      // Datos de la plantilla en Meta (nombre registrado + idioma), solo si
      // se resolvió un template real (rawBody no puede ir por Cloud API:
      // fuera de la ventana de 24h, Meta exige una plantilla pre-aprobada,
      // nunca texto libre).
      let metaTemplate: { name: string; language: string } | null = null;
      if (data.rawBody) {
        body = renderTemplate(data.rawBody, {
          ...data.variables,
          paciente: patient.full_name,
        });
      } else {
        let templateQuery = supabase
          .from("message_templates")
          .select("id, kind, body, meta_template_name, meta_language, meta_status")
          .eq("clinic_id", data.clinicId)
          .eq("channel", "whatsapp")
          .eq("is_active", true)
          .limit(1);
        if (data.templateId) {
          templateQuery = templateQuery.eq("id", data.templateId);
        } else if (data.templateKind) {
          templateQuery = templateQuery.eq("kind", data.templateKind);
        }
        const { data: template, error: templateErr } = await templateQuery.maybeSingle();
        if (templateErr)
          throw new Error(mensajeDb(templateErr, "No pudimos cargar la plantilla de WhatsApp."));
        if (!template) throw new Error("Template no encontrado o inactivo.");
        templateId = template.id;
        templateKind = template.kind as (typeof MESSAGE_TEMPLATE_KINDS)[number];
        body = renderTemplate(template.body, {
          ...data.variables,
          paciente: patient.full_name,
        });
        if (template.meta_status === "approved" && template.meta_template_name) {
          metaTemplate = { name: template.meta_template_name, language: template.meta_language };
        }
      }

      // Intento de envío real por Cloud API — helper compartido con
      // generatePortalLink (portal.functions.ts). Si falta WABA conectado,
      // plantilla aprobada, o el POST a Meta falla, cae a wa.me solo.
      const attempt = templateKind
        ? await tryMetaTemplateSend({
            supabase,
            clinicId: data.clinicId,
            templateKind,
            metaTemplate,
            recipientRaw: recipient,
            country,
            waOptOutAt: patient.wa_opt_out_at,
            variables: { ...data.variables, paciente: patient.full_name },
          })
        : { viaApi: false, externalId: null };
      const { viaApi, externalId } = attempt;

      const nowIso = new Date().toISOString();
      // "sent" solo cuando la Cloud API de Meta lo confirmó de verdad. El
      // fallback wa.me arma el link y devuelve la URL para que el cliente
      // haga window.open — hasta ahí solo sabemos que existe un link, no que
      // alguien lo mandó (auditoría UX, 30-ago: marcar "sent" acá era
      // engañoso, el staff podía creer que el paciente ya fue notificado sin
      // que nadie hubiera tocado "Enviar" en WhatsApp todavía). "queued" ya
      // existe en el enum desde el diseño original de la tabla.
      const { data: inserted, error: insertErr } = await supabase
        .from("messages")
        .insert({
          clinic_id: data.clinicId,
          patient_id: data.patientId,
          appointment_id: data.appointmentId ?? null,
          quote_id: data.quoteId ?? null,
          template_id: templateId,
          template_kind: templateKind,
          channel: "whatsapp",
          direction: "outbound",
          status: viaApi ? "sent" : "queued",
          recipient,
          body,
          external_id: externalId,
          sent_at: viaApi ? nowIso : null,
          sent_by: userId,
        })
        .select("id")
        .single();

      if (insertErr) throw new Error("No pudimos registrar el mensaje. " + insertErr.message);

      const waUrl = viaApi ? null : buildWaMeUrl(recipient, body, country);
      return { id: inserted.id, waUrl, body, recipient, viaApi };
    },
  );

/**
 * Envío real de email por template — mismo patrón que
 * sendWhatsAppFromTemplate (resuelve template, renderiza variables,
 * registra en `messages`), pero sin fallback tipo wa.me: si el envío
 * falla (sin RESEND_API_KEY, sandbox bloqueando, o error de Resend), se
 * registra igual con status "failed" para que quede en el historial por
 * qué no salió, y se le devuelve el motivo al staff.
 */
export const sendEmailFromTemplate = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        templateKind: z.enum(MESSAGE_TEMPLATE_KINDS),
        variables: z.record(z.string(), z.string()).default({}),
        appointmentId: z.string().uuid().optional(),
        quoteId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(
    async ({ data, context }): Promise<{ id: string; sent: boolean; reason: string | null }> => {
      const { supabase, userId } = context;

      const [{ data: patient, error: patientErr }, { data: clinic, error: clinicErr }] =
        await Promise.all([
          supabase
            .from("patients")
            .select("full_name, email, birth_date")
            .eq("clinic_id", data.clinicId)
            .eq("id", data.patientId)
            .maybeSingle(),
          supabase.from("clinics").select("name, timezone").eq("id", data.clinicId).maybeSingle(),
        ]);
      if (patientErr)
        throw new Error(mensajeDb(patientErr, "No pudimos obtener los datos del paciente."));
      if (clinicErr)
        throw new Error(mensajeDb(clinicErr, "No pudimos obtener los datos de la clínica."));
      if (!patient) throw new Error("Paciente no encontrado.");

      // Paciente menor con tutor vigente: el correo va al tutor (CLI-11).
      const destinatario = await resolverDestinatario(supabase, {
        clinicId: data.clinicId,
        patientId: data.patientId,
        fechaNacimiento: patient.birth_date,
        telefono: null,
        email: patient.email,
        timezone: clinic?.timezone ?? null,
      });
      const recipient = (destinatario.email ?? "").trim();
      if (!recipient) {
        throw new Error("El paciente no tiene email cargado.");
      }

      const { data: template, error: templateErr } = await supabase
        .from("message_templates")
        .select("id, subject, body")
        .eq("clinic_id", data.clinicId)
        .eq("channel", "email")
        .eq("kind", data.templateKind)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (templateErr)
        throw new Error(mensajeDb(templateErr, "No pudimos cargar la plantilla de email."));
      if (!template) throw new Error("No hay plantilla de email activa para este tipo de aviso.");

      const vars = { ...data.variables, paciente: patient.full_name, clinica: clinic?.name ?? "" };
      const subject = renderTemplate(template.subject ?? "", vars);
      // renderTemplateHtml (no renderTemplate): esto es HTML real que Resend
      // manda sin sanitizar — `paciente`/`clinica` vienen de campos que
      // recepción puede editar libremente (security-review 01-sep).
      const html = renderTemplateHtml(template.body, vars);

      const sandboxConfig = await loadEmailSandboxConfig(supabase, data.clinicId);
      const result = await sendEmail({ to: recipient, subject, html }, sandboxConfig);

      const nowIso = new Date().toISOString();
      const { data: inserted, error: insertErr } = await supabase
        .from("messages")
        .insert({
          clinic_id: data.clinicId,
          patient_id: data.patientId,
          appointment_id: data.appointmentId ?? null,
          quote_id: data.quoteId ?? null,
          template_id: template.id,
          template_kind: data.templateKind,
          channel: "email",
          direction: "outbound",
          status: result.ok ? "sent" : "failed",
          recipient,
          body: html,
          external_id: result.ok ? result.externalId : null,
          error: result.ok ? null : result.reason,
          sent_at: result.ok ? nowIso : null,
          sent_by: userId,
        })
        .select("id")
        .single();
      if (insertErr) throw new Error("No pudimos registrar el mensaje. " + insertErr.message);

      return { id: inserted.id, sent: result.ok, reason: result.ok ? null : result.reason };
    },
  );

const DEFAULT_TIMEZONE = "America/Santiago";
const HORA_48H_MS = 48 * 60 * 60 * 1000;
const HORA_3H_MS = 3 * 60 * 60 * 1000;
// Ventanas alrededor de cada hito: se revisa periódicamente (no a un
// segundo exacto), así que hace falta margen para no perderse una cita
// entre dos visitas a la página.
const MARGEN_MS = 4 * 60 * 60 * 1000;

function formatFechaHoraLocal(iso: string, timeZone: string): { fechaLarga: string; hora: string } {
  const date = new Date(iso);
  const fechaLarga = new Intl.DateTimeFormat("es-CL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  const hora = new Intl.DateTimeFormat("es-CL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { fechaLarga, hora };
}

export interface PendingReminder {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  treatmentLabel: string;
  professionalName: string;
  startsAt: string;
  fechaLarga: string;
  hora: string;
  /** Cuál de los dos avisos le falta a esta cita. */
  reminderKind: "appointment_reminder" | "appointment_checkin";
  /** Independiente por canal: WhatsApp y email no se tapan entre sí. */
  whatsappSent: boolean;
  emailSent: boolean;
}

/**
 * Cola de recordatorios: citas futuras que están entrando a la ventana de
 * 48h o de 3h y todavía no tienen un mensaje de ese tipo registrado. No hay
 * envío automático (sin Twilio, sin cron) — esto solo arma la lista para que
 * el staff la despache a mano con un click por fila, reusando
 * sendWhatsAppFromTemplate (mismo wa.me de siempre).
 */
export const listPendingReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PendingReminder[]> => {
    const { supabase } = context;
    const ahora = Date.now();
    const desde3h = new Date(ahora + HORA_3H_MS - MARGEN_MS).toISOString();
    const hasta48h = new Date(ahora + HORA_48H_MS + MARGEN_MS).toISOString();

    const { data: appts, error } = await supabase
      .from("appointments")
      .select("id, patient_id, professional_id, branch_id, treatment_label, starts_at")
      .eq("clinic_id", data.clinicId)
      .neq("status", "cancelada")
      .gte("starts_at", desde3h)
      .lte("starts_at", hasta48h)
      .order("starts_at", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las citas próximas."));

    const candidatas = (appts ?? [])
      .map((a) => {
        const faltaMs = new Date(a.starts_at).getTime() - ahora;
        // Más cerca de la ventana de 3h que de la de 48h → es el aviso corto.
        const reminderKind: PendingReminder["reminderKind"] =
          Math.abs(faltaMs - HORA_3H_MS) < Math.abs(faltaMs - HORA_48H_MS)
            ? "appointment_checkin"
            : "appointment_reminder";
        return { ...a, reminderKind };
      })
      .filter(
        (a) =>
          (a.reminderKind === "appointment_checkin" &&
            new Date(a.starts_at).getTime() - ahora <= HORA_3H_MS + MARGEN_MS) ||
          (a.reminderKind === "appointment_reminder" &&
            new Date(a.starts_at).getTime() - ahora >= HORA_3H_MS + MARGEN_MS),
      );
    if (candidatas.length === 0) return [];

    const appointmentIds = candidatas.map((a) => a.id);
    // channel entra al select y al dedupe: un recordatorio mandado por
    // WhatsApp no debe tapar el botón de email de esa misma cita, y
    // viceversa — son dos avisos independientes, no uno con dos caminos.
    const { data: enviados, error: msgError } = await supabase
      .from("messages")
      .select("appointment_id, template_kind, channel")
      .eq("clinic_id", data.clinicId)
      .in("appointment_id", appointmentIds)
      .in("template_kind", ["appointment_reminder", "appointment_checkin"])
      // "queued" cuenta como ya despachado para este dedupe — es el estado
      // real del fallback wa.me desde que dejó de marcarse "sent" a ciegas
      // (ver sendWhatsAppFromTemplate). Si no se incluyera, un recordatorio
      // ya mandado por wa.me volvería a ofrecerse como pendiente.
      .in("status", ["sent", "queued"]);
    if (msgError)
      throw new Error(mensajeDb(msgError, "No pudimos revisar los recordatorios ya enviados."));

    const enviadoPorCanal = new Set(
      (enviados ?? []).map((m) => `${m.appointment_id}:${m.template_kind}:${m.channel}`),
    );
    const pendientes = candidatas
      .map((a) => ({
        ...a,
        whatsappSent: enviadoPorCanal.has(`${a.id}:${a.reminderKind}:whatsapp`),
        emailSent: enviadoPorCanal.has(`${a.id}:${a.reminderKind}:email`),
      }))
      .filter((a) => !a.whatsappSent || !a.emailSent);
    if (pendientes.length === 0) return [];

    const patientIds = [...new Set(pendientes.map((a) => a.patient_id))];
    const professionalIds = [...new Set(pendientes.map((a) => a.professional_id))];
    const branchIds = [...new Set(pendientes.map((a) => a.branch_id))];

    const [
      { data: patients, error: pErr },
      { data: professionals, error: profErr },
      { data: branches, error: branchErr },
    ] = await Promise.all([
      supabase
        .from("patients")
        .select("id, full_name, phone, email, wa_opt_out_at")
        .in("id", patientIds.length ? patientIds : [""]),
      supabase
        .from("professionals")
        .select("id, full_name")
        .in("id", professionalIds.length ? professionalIds : [""]),
      supabase
        .from("branches")
        .select("id, timezone")
        .in("id", branchIds.length ? branchIds : [""]),
    ]);
    if (pErr) throw new Error(mensajeDb(pErr, "No pudimos cargar los datos de los pacientes."));
    if (profErr)
      throw new Error(mensajeDb(profErr, "No pudimos cargar los datos de los profesionales."));
    if (branchErr)
      throw new Error(mensajeDb(branchErr, "No pudimos cargar los datos de las sucursales."));

    const patientById = new Map((patients ?? []).map((p) => [p.id, p]));
    const profNameById = new Map((professionals ?? []).map((p) => [p.id, p.full_name]));
    const tzByBranch = new Map((branches ?? []).map((b) => [b.id, b.timezone]));
    // CON-09: quien pidió la baja de WhatsApp no vuelve a aparecer para ese canal.
    const pacientesDeBaja = new Set(
      (patients ?? []).filter((p) => p.wa_opt_out_at != null).map((p) => p.id),
    );

    const filas = pendientes.map((a) => {
      const patient = patientById.get(a.patient_id);
      const { fechaLarga, hora } = formatFechaHoraLocal(
        a.starts_at,
        tzByBranch.get(a.branch_id) || DEFAULT_TIMEZONE,
      );
      return {
        appointmentId: a.id,
        patientId: a.patient_id,
        patientName: patient?.full_name ?? "Paciente",
        patientPhone: patient?.phone ?? null,
        patientEmail: patient?.email ?? null,
        treatmentLabel: a.treatment_label || "Consulta",
        professionalName: profNameById.get(a.professional_id) ?? "—",
        startsAt: a.starts_at,
        fechaLarga,
        hora,
        reminderKind: a.reminderKind,
        whatsappSent: a.whatsappSent,
        emailSent: a.emailSent,
      };
    });
    return quitarBajasDeWhatsApp(filas, pacientesDeBaja);
  });

// ─────────────────────────────────────────────────────────────────────────
// Fase 1: cola de outreach (recall de higiene / pedido de reseña / saldo
// pendiente). A diferencia de listPendingReminders (ligada 1:1 a una cita
// futura), estos candidatos se calculan sobre histórico. Por decisión de
// Walter, NUNCA se mandan solos desde un cron — se arman acá y el staff los
// despacha a mano en /recordatorios con el mismo WhatsAppButton de siempre
// (que ahora intenta la API real y cae a wa.me si no hay número conectado).
// ─────────────────────────────────────────────────────────────────────────

const HYGIENE_RECALL_AFTER_MS = 182 * 24 * 60 * 60 * 1000; // ~6 meses
const HYGIENE_RECALL_COOLDOWN_MS = 150 * 24 * 60 * 60 * 1000; // no re-sugerir antes de esto
const REVIEW_REQUEST_MIN_DELAY_MS = 2 * 60 * 60 * 1000; // 2h después de la cita
const REVIEW_REQUEST_MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // no revivir visitas viejas
const PAYMENT_DUE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const QUOTE_FOLLOW_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // presupuesto enviado hace +7 días
const QUOTE_FOLLOW_UP_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // no repetir el nudge antes de esto
const BIRTHDAY_COOLDOWN_MS = 300 * 24 * 60 * 60 * 1000; // no repetir en el mismo año
const TREATMENT_FOLLOWUP_MIN_DELAY_MS = 2 * 24 * 60 * 60 * 1000; // 2 días después de completado
const TREATMENT_FOLLOWUP_MAX_WINDOW_MS = 10 * 24 * 60 * 60 * 1000; // no revivir tratamientos viejos
const TREATMENT_FOLLOWUP_COOLDOWN_MS = 10 * 24 * 60 * 60 * 1000; // no re-sugerir antes de esto
const REFERRAL_INVITE_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;
// Encuesta de satisfacción (nps_survey): tras un tratamiento completado, en
// una ventana un poco más amplia que treatment_followup (que es el saludo
// humano de 2-10 días) — la encuesta pide una calificación y conviene un par
// de días después de ese primer contacto. Cooldown largo: una encuesta por
// paciente cada 180 días, para no fatigar con pedidos de nota.
const NPS_SURVEY_MIN_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
const NPS_SURVEY_MAX_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
const NPS_SURVEY_COOLDOWN_MS = 180 * 24 * 60 * 60 * 1000;

export interface PendingOutreachItem {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  kind: OutreachTemplateKind;
  // hygiene_recall
  monthsSinceLastVisit?: number;
  // review_request (dedupe es por cita, no por paciente — cada visita puede pedir su propia reseña)
  appointmentId?: string;
  treatmentLabel?: string;
  /** Link directo de reseña de Google de la sucursal donde fue la cita, si está cargado (branches.google_review_url). Null cuando la sucursal no lo tiene. */
  googleReviewUrl?: string | null;
  // payment_due
  balanceCents?: number;
  currency?: string;
  // quote_follow_up (dedupe es por presupuesto, no por paciente)
  quoteId?: string;
  quoteNumber?: string;
  quoteTotalCents?: number;
  // referral_invite
  referralCode?: string;
}

/**
 * Candidatos de recall/reseña/saldo, ya filtrados por opt-in y por cooldown
 * (no repetir la misma sugerencia todos los días). Solo pacientes con
 * wa_opt_in=true y sin wa_opt_out_at — a diferencia de los recordatorios de
 * cita (transaccionales a una reserva que el paciente ya hizo), esto es
 * outreach proactivo y necesita consentimiento explícito.
 */
export const listPendingOutreach = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PendingOutreachItem[]> => {
    const { supabase } = context;
    const clinicId = data.clinicId;
    const ahora = Date.now();

    const [
      { data: optedInPatients, error: patErr },
      { data: finalizadas, error: apptErr },
      { data: futuras, error: futErr },
      { data: recentOutreach, error: msgErr },
      balances,
      { data: clinic, error: clinicErr },
      { data: sentQuotes, error: quoteErr },
      { data: completedItems, error: completedErr },
      { data: branchRows, error: branchErr },
    ] = await Promise.all([
      supabase
        .from("patients")
        .select("id, full_name, phone, birth_date, referral_code")
        .eq("clinic_id", clinicId)
        .eq("wa_opt_in", true)
        .is("wa_opt_out_at", null),
      supabase
        .from("appointments")
        .select("id, patient_id, branch_id, treatment_label, ends_at")
        .eq("clinic_id", clinicId)
        .eq("status", "finalizada")
        .order("ends_at", { ascending: false })
        .limit(2000),
      supabase
        .from("appointments")
        .select("patient_id")
        .eq("clinic_id", clinicId)
        .neq("status", "cancelada")
        .gt("starts_at", new Date(ahora).toISOString()),
      supabase
        .from("messages")
        .select("patient_id, appointment_id, quote_id, template_kind, created_at")
        .eq("clinic_id", clinicId)
        .in("template_kind", [...OUTREACH_TEMPLATE_KINDS])
        .order("created_at", { ascending: false })
        .limit(3000),
      // Auditoría de código 01-sep-2026: antes reimplementaba acá mismo el
      // cálculo de saldo que también hace getPatient — ver el comentario de
      // fetchPatientBalances (patients.functions.ts) sobre por qué se unificó.
      fetchPatientBalances(supabase, clinicId),
      supabase.from("clinics").select("currency").eq("id", clinicId).single(),
      supabase
        .from("quotes")
        .select("id, patient_id, number, total_cents, currency, sent_at")
        .eq("clinic_id", clinicId)
        .eq("status", "sent")
        .not("sent_at", "is", null),
      supabase
        .from("treatment_items")
        .select("name_snapshot, completed_at, treatment_plans!inner(patient_id, clinic_id)")
        .eq("clinic_id", clinicId)
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(2000),
      supabase.from("branches").select("id, google_review_url").eq("clinic_id", clinicId),
    ]);
    if (patErr)
      throw new Error(
        mensajeDb(patErr, "No pudimos cargar los pacientes con WhatsApp habilitado."),
      );
    if (apptErr)
      throw new Error(mensajeDb(apptErr, "No pudimos cargar el historial de citas finalizadas."));
    if (futErr)
      throw new Error(mensajeDb(futErr, "No pudimos revisar las citas futuras de los pacientes."));
    if (msgErr)
      throw new Error(
        mensajeDb(msgErr, "No pudimos revisar los mensajes de seguimiento ya enviados."),
      );
    if (completedErr)
      throw new Error(mensajeDb(completedErr, "No pudimos cargar los tratamientos completados."));
    if (clinicErr)
      throw new Error(mensajeDb(clinicErr, "No pudimos obtener los datos de la clínica."));
    if (quoteErr)
      throw new Error(mensajeDb(quoteErr, "No pudimos cargar los presupuestos enviados."));
    if (branchErr)
      throw new Error(mensajeDb(branchErr, "No pudimos cargar los datos de las sucursales."));

    const patientById = new Map((optedInPatients ?? []).map((p) => [p.id, p]));
    const patientsWithFuture = new Set((futuras ?? []).map((f) => f.patient_id));
    const reviewUrlByBranch = new Map(
      (branchRows ?? []).map((b) => [b.id, b.google_review_url as string | null]),
    );

    // Última visita finalizada por paciente (ya viene ordenado desc, nos quedamos con la primera ocurrencia).
    const lastVisitByPatient = new Map<string, string>();
    for (const a of finalizadas ?? []) {
      if (!lastVisitByPatient.has(a.patient_id)) lastVisitByPatient.set(a.patient_id, a.ends_at);
    }

    // Cooldown: último hygiene_recall/payment_due/birthday_greeting/
    // treatment_followup/referral_invite por paciente, último quote_follow_up
    // por presupuesto, review_request por cita.
    const lastHygieneRecallByPatient = new Map<string, string>();
    const lastPaymentDueByPatient = new Map<string, string>();
    const lastQuoteFollowUpByQuote = new Map<string, string>();
    const lastBirthdayByPatient = new Map<string, string>();
    const lastTreatmentFollowupByPatient = new Map<string, string>();
    const lastReferralInviteByPatient = new Map<string, string>();
    const lastNpsSurveyByPatient = new Map<string, string>();
    const reviewRequestedAppointments = new Set<string>();
    for (const m of recentOutreach ?? []) {
      if (m.template_kind === "hygiene_recall" && !lastHygieneRecallByPatient.has(m.patient_id)) {
        lastHygieneRecallByPatient.set(m.patient_id, m.created_at);
      }
      if (m.template_kind === "payment_due" && !lastPaymentDueByPatient.has(m.patient_id)) {
        lastPaymentDueByPatient.set(m.patient_id, m.created_at);
      }
      if (
        m.template_kind === "quote_follow_up" &&
        m.quote_id &&
        !lastQuoteFollowUpByQuote.has(m.quote_id)
      ) {
        lastQuoteFollowUpByQuote.set(m.quote_id, m.created_at);
      }
      if (m.template_kind === "birthday_greeting" && !lastBirthdayByPatient.has(m.patient_id)) {
        lastBirthdayByPatient.set(m.patient_id, m.created_at);
      }
      if (
        m.template_kind === "treatment_followup" &&
        !lastTreatmentFollowupByPatient.has(m.patient_id)
      ) {
        lastTreatmentFollowupByPatient.set(m.patient_id, m.created_at);
      }
      if (m.template_kind === "referral_invite" && !lastReferralInviteByPatient.has(m.patient_id)) {
        lastReferralInviteByPatient.set(m.patient_id, m.created_at);
      }
      if (m.template_kind === "nps_survey" && !lastNpsSurveyByPatient.has(m.patient_id)) {
        lastNpsSurveyByPatient.set(m.patient_id, m.created_at);
      }
      if (m.template_kind === "review_request" && m.appointment_id) {
        reviewRequestedAppointments.add(m.appointment_id);
      }
    }

    const items: PendingOutreachItem[] = [];

    // ── hygiene_recall ──
    for (const [patientId, lastVisitIso] of lastVisitByPatient) {
      const patient = patientById.get(patientId);
      if (!patient) continue; // sin opt-in, o no existe
      if (patientsWithFuture.has(patientId)) continue; // ya viene de vuelta
      const sinceMs = ahora - new Date(lastVisitIso).getTime();
      if (sinceMs < HYGIENE_RECALL_AFTER_MS) continue;
      const lastSent = lastHygieneRecallByPatient.get(patientId);
      if (lastSent && ahora - new Date(lastSent).getTime() < HYGIENE_RECALL_COOLDOWN_MS) continue;
      items.push({
        patientId,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "hygiene_recall",
        monthsSinceLastVisit: Math.floor(sinceMs / (30 * 24 * 60 * 60 * 1000)),
      });
    }

    // ── review_request ──
    for (const a of finalizadas ?? []) {
      const patient = patientById.get(a.patient_id);
      if (!patient) continue;
      const sinceMs = ahora - new Date(a.ends_at).getTime();
      if (sinceMs < REVIEW_REQUEST_MIN_DELAY_MS || sinceMs > REVIEW_REQUEST_MAX_WINDOW_MS) continue;
      if (reviewRequestedAppointments.has(a.id)) continue;
      items.push({
        patientId: a.patient_id,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "review_request",
        appointmentId: a.id,
        treatmentLabel: a.treatment_label || "Consulta",
        googleReviewUrl: (a.branch_id && reviewUrlByBranch.get(a.branch_id)) || null,
      });
    }

    // ── payment_due ──
    const currency = clinic?.currency ?? "CLP";
    for (const [patientId, { billedCents, paidCents }] of balances) {
      const balanceCents = billedCents - paidCents;
      if (balanceCents <= 0) continue;
      const patient = patientById.get(patientId);
      if (!patient) continue;
      const lastSent = lastPaymentDueByPatient.get(patientId);
      if (lastSent && ahora - new Date(lastSent).getTime() < PAYMENT_DUE_COOLDOWN_MS) continue;
      items.push({
        patientId,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "payment_due",
        balanceCents,
        currency,
      });
    }

    // ── quote_follow_up ──
    for (const q of sentQuotes ?? []) {
      if (!q.sent_at) continue; // ya filtrado por la query, pero TS no lo sabe
      const patient = patientById.get(q.patient_id);
      if (!patient) continue;
      const sinceMs = ahora - new Date(q.sent_at).getTime();
      if (sinceMs < QUOTE_FOLLOW_UP_AFTER_MS) continue;
      const lastSent = lastQuoteFollowUpByQuote.get(q.id);
      if (lastSent && ahora - new Date(lastSent).getTime() < QUOTE_FOLLOW_UP_COOLDOWN_MS) continue;
      items.push({
        patientId: q.patient_id,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "quote_follow_up",
        quoteId: q.id,
        quoteNumber: q.number,
        quoteTotalCents: q.total_cents,
        currency: q.currency,
      });
    }

    // ── birthday_greeting ── (marketing: solo pacientes opt-in, comparación
    // por mes/día en UTC — no hace falta precisión de huso horario para esto).
    const hoy = new Date(ahora);
    const mesHoy = hoy.getUTCMonth();
    const diaHoy = hoy.getUTCDate();
    for (const patient of optedInPatients ?? []) {
      if (!patient.birth_date) continue;
      const nacimiento = new Date(patient.birth_date);
      if (nacimiento.getUTCMonth() !== mesHoy || nacimiento.getUTCDate() !== diaHoy) continue;
      const lastSent = lastBirthdayByPatient.get(patient.id);
      if (lastSent && ahora - new Date(lastSent).getTime() < BIRTHDAY_COOLDOWN_MS) continue;
      items.push({
        patientId: patient.id,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "birthday_greeting",
      });
    }

    // ── treatment_followup ── (utility: seguimiento genérico de una visita
    // real, no instrucciones clínicas por tipo de procedimiento — eso lo
    // debería redactar un dentista, no fabricarlo acá). Un candidato por
    // paciente, el tratamiento completado más reciente (ya viene ordenado
    // desc, nos quedamos con la primera ocurrencia).
    const lastCompletedByPatient = new Map<string, { completedAt: string; label: string }>();
    for (const item of completedItems ?? []) {
      const patientId = (item as unknown as { treatment_plans: { patient_id: string } })
        .treatment_plans.patient_id;
      if (!lastCompletedByPatient.has(patientId)) {
        lastCompletedByPatient.set(patientId, {
          completedAt: (item as { completed_at: string }).completed_at,
          label: item.name_snapshot,
        });
      }
    }
    for (const [patientId, { completedAt, label }] of lastCompletedByPatient) {
      const patient = patientById.get(patientId);
      if (!patient) continue;
      const sinceMs = ahora - new Date(completedAt).getTime();
      if (sinceMs < TREATMENT_FOLLOWUP_MIN_DELAY_MS || sinceMs > TREATMENT_FOLLOWUP_MAX_WINDOW_MS) {
        continue;
      }
      const lastSent = lastTreatmentFollowupByPatient.get(patientId);
      if (lastSent && ahora - new Date(lastSent).getTime() < TREATMENT_FOLLOWUP_COOLDOWN_MS) {
        continue;
      }
      items.push({
        patientId,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "treatment_followup",
        treatmentLabel: label,
      });
    }

    // ── nps_survey ── (encuesta de satisfacción: misma fuente que el followup
    // —último tratamiento completado— pero ventana un poco más tardía y
    // cooldown largo. Pide una calificación; el paciente responde por el mismo
    // canal y el staff la lee en el historial, sin captura estructurada todavía.)
    for (const [patientId, { completedAt, label }] of lastCompletedByPatient) {
      const patient = patientById.get(patientId);
      if (!patient) continue;
      const sinceMs = ahora - new Date(completedAt).getTime();
      if (sinceMs < NPS_SURVEY_MIN_DELAY_MS || sinceMs > NPS_SURVEY_MAX_WINDOW_MS) continue;
      const lastSent = lastNpsSurveyByPatient.get(patientId);
      if (lastSent && ahora - new Date(lastSent).getTime() < NPS_SURVEY_COOLDOWN_MS) continue;
      items.push({
        patientId,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "nps_survey",
        treatmentLabel: label,
      });
    }

    // ── referral_invite ── (marketing: solo a quien ya vivió la clínica al
    // menos una vez — lastVisitByPatient ya filtra exactamente eso).
    for (const [patientId] of lastVisitByPatient) {
      const patient = patientById.get(patientId);
      if (!patient || !patient.referral_code) continue;
      const lastSent = lastReferralInviteByPatient.get(patientId);
      if (lastSent && ahora - new Date(lastSent).getTime() < REFERRAL_INVITE_COOLDOWN_MS) continue;
      items.push({
        patientId,
        patientName: patient.full_name,
        patientPhone: patient.phone,
        kind: "referral_invite",
        referralCode: patient.referral_code,
      });
    }

    return items;
  });

/** Prende/apaga el opt-in de WhatsApp del paciente. Lo apaga siempre puede cualquier operador; prenderlo requiere haberlo hablado con el paciente. */
export const setPatientWhatsAppOptIn = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), patientId: z.string().uuid(), optIn: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const nowIso = new Date().toISOString();
    const { error } = await context.supabase
      .from("patients")
      .update(
        data.optIn
          ? { wa_opt_in: true, wa_opt_in_at: nowIso, wa_opt_out_at: null }
          : { wa_opt_in: false, wa_opt_out_at: nowIso },
      )
      .eq("clinic_id", data.clinicId)
      .eq("id", data.patientId);
    if (error)
      throw new Error(
        mensajeDb(error, "No pudimos actualizar el consentimiento de WhatsApp del paciente."),
      );
  });

// Re-export para consumidores que solo importan de este módulo
export { MESSAGE_CHANNELS };
