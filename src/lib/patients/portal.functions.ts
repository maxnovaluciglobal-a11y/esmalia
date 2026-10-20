import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leerCookieConAnterior } from "@/lib/compat/nombres-anteriores";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import { appOrigin } from "@/lib/app-origin.server";
import { throwIfRequiresLlamadaOSuscripcion } from "@/lib/billing.functions";
import { mensajeDb } from "@/lib/db-errors";
import { buildWaMeUrl, normalizeToWaMe } from "@/lib/messaging/messaging";
import {
  PORTAL_COOKIE_MAX_AGE_SECONDS,
  PORTAL_COOKIE_NAME,
  clinicIdFromExpiredToken,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenPayload,
} from "@/lib/patients/portal-token.server";
import { motivoParaNoEnviarWhatsApp } from "@/lib/messaging/baja-whatsapp";
import { tryMetaTemplateSend } from "@/lib/messaging/whatsapp.functions";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

// ────────────────────────────────────────────────────────────
// Cara clínica: generar link firmado + mandar por WhatsApp
// ────────────────────────────────────────────────────────────

const SIN_PERMISOS_PORTAL =
  "El portal del paciente se activa con tu puesta en marcha o al suscribirte. Agenda tu llamada o suscríbete desde /suscripcion.";

/** Genera link firmado del portal para un paciente. Solo staff de la clínica. */
export const generatePortalLink = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        // Tope bajado de 90 a 14 días — el trade-off del link sin login es
        // que quien lo abra ve PHI del paciente; una ventana de exposición
        // más corta limita el daño si el link se reenvía o se filtra.
        ttlDays: z.number().int().min(1).max(14).default(7),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      url: string;
      expiresInDays: number;
      waUrl: string | null;
      /** true si se mandó de verdad por la Cloud API (no hay wa.me que abrir). */
      viaApi: boolean;
      /** CON-09: el paciente pidió la baja de WhatsApp; no se arma envío. */
      dadoDeBajaWhatsApp?: boolean;
    }> => {
      const { supabase, userId } = context;
      // RLS ya cubre: el select fallará si el user no es miembro de la clínica.
      const { data: patient, error } = await supabase
        .from("patients")
        .select("id, full_name, phone, wa_opt_out_at")
        .eq("clinic_id", data.clinicId)
        .eq("id", data.patientId)
        .maybeSingle();
      if (error) throw new Error(mensajeDb(error, "No pudimos cargar los datos del paciente."));
      if (!patient) throw new Error("Paciente no encontrado o sin permisos.");

      await throwIfRequiresLlamadaOSuscripcion(supabase, data.clinicId, SIN_PERMISOS_PORTAL);
      await assertNotDemoClinic(supabase, data.clinicId);

      const token = await signPortalToken(
        { patientId: patient.id, clinicId: data.clinicId },
        data.ttlDays,
      );
      // Origen armado en el servidor (auditoría 10-oct-2026): con `baseUrl`
      // del cliente se podía firmar un link válido que apuntara a otro
      // dominio y quedarse con el token cuando el paciente lo abría.
      const url = `${appOrigin()}/portal/${token}`;

      const message =
        `Hola ${patient.full_name.split(" ")[0]}, este es tu acceso al portal de tu clínica. ` +
        `Puedes ver tus próximas citas y pedir hora aquí: ${url}\n\n` +
        `El link vence en ${data.ttlDays} día${data.ttlDays === 1 ? "" : "s"}.`;

      // Texto que queda en `messages` (historial de comunicaciones): a
      // propósito NO incluye el link completo (trae el JWT firmado adentro).
      // El link real se manda al paciente por wa.me/API en el momento —
      // acá solo queda una referencia de que se mandó, no el token en sí.
      // Higiene de secretos: recepción tiene acceso de escritura/lectura a
      // `messages` por diseño, y no hace falta que un token de acceso
      // completo quede persistido en un historial que puede tener más
      // lectores con el tiempo. Nadie lee el link de vuelta desde acá —
      // `PortalLinkButton` copia/reenvía desde la respuesta del server fn,
      // no desde este historial.
      const historyBody =
        `Link del portal enviado a ${patient.full_name.split(" ")[0]} ` +
        `(vence en ${data.ttlDays} día${data.ttlDays === 1 ? "" : "s"}).`;

      if (!patient.phone) {
        return { url, expiresInDays: data.ttlDays, waUrl: null, viaApi: false };
      }

      // CON-09: con la baja de WhatsApp no se manda nada (ni API ni wa.me).
      // El link se devuelve igual, como sin teléfono: quien lo copie a mano
      // decide por qué canal dárselo.
      if (motivoParaNoEnviarWhatsApp({ waOptOutAt: patient.wa_opt_out_at, tipo: "proactivo" })) {
        return {
          url,
          expiresInDays: data.ttlDays,
          waUrl: null,
          viaApi: false,
          dadoDeBajaWhatsApp: true,
        };
      }

      // Intento de envío real por Cloud API (mismo helper que
      // sendWhatsAppFromTemplate en messaging.functions.ts) + registro en
      // `messages` — antes este link jamás tocaba el historial del
      // paciente, ni siquiera en el flujo wa.me.
      const [{ data: template }, { data: clinic }] = await Promise.all([
        supabase
          .from("message_templates")
          .select("meta_template_name, meta_language, meta_status")
          .eq("clinic_id", data.clinicId)
          .eq("kind", "portal_invite")
          .eq("is_active", true)
          .maybeSingle(),
        supabase.from("clinics").select("name, country").eq("id", data.clinicId).maybeSingle(),
      ]);
      const country = clinic?.country ?? null;

      // BIL-11: un teléfono que no se puede leer con el país de la clínica
      // se trata igual que "sin teléfono": se devuelve el link para copiarlo
      // a mano y no se manda nada (ni API ni wa.me) a un número dudoso.
      if (!normalizeToWaMe(patient.phone, country)) {
        return { url, expiresInDays: data.ttlDays, waUrl: null, viaApi: false };
      }
      const metaTemplate =
        template?.meta_status === "approved" && template.meta_template_name
          ? { name: template.meta_template_name, language: template.meta_language }
          : null;

      const attempt = await tryMetaTemplateSend({
        supabase,
        clinicId: data.clinicId,
        templateKind: "portal_invite",
        metaTemplate,
        recipientRaw: patient.phone,
        country,
        waOptOutAt: patient.wa_opt_out_at,
        variables: {
          paciente: patient.full_name,
          dias: String(data.ttlDays),
          clinica: clinic?.name ?? "",
          link: url,
        },
      });

      // "sent" solo si Meta lo confirmó de verdad — mismo criterio que
      // sendWhatsAppFromTemplate (messaging.functions.ts): el fallback wa.me
      // solo arma el link, no confirma que alguien lo mandó todavía.
      const { error: insertErr } = await supabase.from("messages").insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        channel: "whatsapp",
        direction: "outbound",
        status: attempt.viaApi ? "sent" : "queued",
        template_kind: "portal_invite",
        recipient: patient.phone,
        body: historyBody,
        external_id: attempt.externalId,
        sent_at: attempt.viaApi ? new Date().toISOString() : null,
        sent_by: userId,
      });
      if (insertErr) throw new Error("No pudimos registrar el envío. " + insertErr.message);

      const waUrl = attempt.viaApi ? null : buildWaMeUrl(patient.phone, message, country);
      return { url, expiresInDays: data.ttlDays, waUrl, viaApi: attempt.viaApi };
    },
  );

/**
 * Corta todos los links del portal de un paciente ya emitidos (útil si un
 * link se filtró o se reenvió a quien no correspondía). Generar un link
 * nuevo después funciona sin pasos extra — su `iat` va a ser posterior.
 */
export const revokePortalAccess = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("patients")
      .update({ portal_revoked_at: new Date().toISOString() })
      .eq("clinic_id", data.clinicId)
      .eq("id", data.patientId);
    if (error) throw new Error("No tienes permisos para revocar el acceso de este paciente.");
    return { ok: true };
  });

// ────────────────────────────────────────────────────────────
// Cara paciente: middleware de sesión + fns del portal
// ────────────────────────────────────────────────────────────

function readPortalCookie(): string | null {
  const req = getRequest();
  const cookieHeader = req?.headers.get("cookie") ?? "";
  return leerCookieConAnterior(cookieHeader, PORTAL_COOKIE_NAME);
}

/** true si el token es de antes de la última revocación del paciente. */
async function isPortalTokenRevoked(payload: PortalTokenPayload): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("patients")
    .select("portal_revoked_at")
    .eq("id", payload.patientId)
    .eq("clinic_id", payload.clinicId)
    .maybeSingle();
  if (!data?.portal_revoked_at) return false;
  return payload.issuedAt <= new Date(data.portal_revoked_at);
}

async function requirePortalSession(): Promise<PortalTokenPayload> {
  const token = readPortalCookie();
  if (!token) throw new Error("Portal no autorizado.");
  let payload: PortalTokenPayload;
  try {
    payload = await verifyPortalToken(token);
  } catch {
    throw new Error("Sesión del portal vencida.");
  }
  if (await isPortalTokenRevoked(payload)) {
    throw new Error("Este link ya no es válido. Pídele a tu clínica uno nuevo.");
  }
  return payload;
}

/**
 * Registra un acceso al portal (audit trail). Best-effort: si falla no
 * rompe el flujo del paciente, solo queda un log en el server — igual
 * que `notificar()` en clinical-notes.functions.ts.
 */
async function logPortalAccess(
  clinicId: string,
  patientId: string,
  event: "session_opened" | "overview_viewed",
) {
  try {
    const req = getRequest();
    const ipHint = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = req?.headers.get("user-agent") ?? null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("portal_access_log").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      event,
      ip_hint: ipHint,
      user_agent: userAgent,
    });
  } catch (err) {
    console.error("[portal] no se pudo registrar el acceso", err);
  }
}

/**
 * Contacto de la clínica para mostrar en las pantallas de "tu link venció" —
 * antes las 3 (entrada por token, portal sin token, overview con sesión
 * vencida) mostraban "contactá a tu clínica" en texto plano, sin poder saber
 * cuál era la clínica (auditoría UX, 30-ago). Acepta un `token` explícito
 * (para /portal/$token, donde la cookie puede no existir todavía) o lo lee
 * de la cookie de sesión si no se pasa uno (para /portal/inicio). Nunca
 * lanza — si no hay nada que mostrar, el cliente se queda con el mensaje
 * genérico de siempre.
 */
export const getExpiredPortalContact = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().min(1).optional() }).parse(input))
  .handler(async ({ data }): Promise<{ clinicName: string; waUrl: string | null } | null> => {
    const token = data.token ?? readPortalCookie();
    if (!token) return null;
    const clinicId = await clinicIdFromExpiredToken(token);
    if (!clinicId) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: clinic }, { data: branch }] = await Promise.all([
      supabaseAdmin.from("clinics").select("name, country").eq("id", clinicId).maybeSingle(),
      supabaseAdmin
        .from("branches")
        .select("phone")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .not("phone", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!clinic) return null;

    const waUrl = branch?.phone
      ? buildWaMeUrl(
          branch.phone,
          "Hola, mi link del portal venció — ¿me pueden mandar uno nuevo?",
          clinic.country,
        )
      : null;
    return { clinicName: clinic.name, waUrl };
  });

/** Consume el token de la URL, valida, setea cookie. Se llama una vez al abrir /portal/[token]. */
export const openPortalSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().min(20) }).parse(input))
  .handler(async ({ data }) => {
    const payload = await verifyPortalToken(data.token);
    if (await isPortalTokenRevoked(payload)) {
      throw new Error("Este link ya no es válido. Pídele a tu clínica uno nuevo.");
    }
    // Secure solo en producción — localhost sirve por http y el flag lo
    // bloquearía. Path=/ porque los server functions viven en /_serverFn/*
    // que no está bajo /portal; el cookie tiene que viajar en cualquier
    // request server-fn para que requirePortalSession() lo lea.
    const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
    setResponseHeader(
      "Set-Cookie",
      `${PORTAL_COOKIE_NAME}=${encodeURIComponent(data.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PORTAL_COOKIE_MAX_AGE_SECONDS}${secureFlag}`,
    );
    await logPortalAccess(payload.clinicId, payload.patientId, "session_opened");
    return { ok: true, patientId: payload.patientId };
  });

/** Datos del paciente en el portal (nombre + próximas citas + planes activos). */
export const getMyPortalOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { patientId, clinicId } = await requirePortalSession();

  // Cliente admin: el portal no tiene JWT de Supabase, va con service_role
  // + filtros explícitos por clinic_id + patient_id.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await logPortalAccess(clinicId, patientId, "overview_viewed");

  const [
    { data: patient, error: pErr },
    { data: appts, error: aErr },
    { data: plans, error: plErr },
    { data: clinic, error: cErr },
  ] = await Promise.all([
    supabaseAdmin
      .from("patients")
      .select("id, full_name, phone, email")
      .eq("clinic_id", clinicId)
      .eq("id", patientId)
      .maybeSingle(),
    supabaseAdmin
      .from("appointments")
      .select("id, treatment_label, starts_at, ends_at, status, branch_id, professional_id")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelada")
      .order("starts_at", { ascending: true })
      .limit(10),
    supabaseAdmin
      .from("treatment_plans")
      .select("id, name, status, currency, total_cents")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(10),
    // Solo para marcar feriados (Nager.Date) en "Pedir una hora" — no es PHI.
    supabaseAdmin.from("clinics").select("country").eq("id", clinicId).maybeSingle(),
  ]);
  if (pErr) throw new Error(mensajeDb(pErr, "No pudimos cargar tus datos."));
  if (aErr) throw new Error(mensajeDb(aErr, "No pudimos cargar tus próximas citas."));
  if (plErr) throw new Error(mensajeDb(plErr, "No pudimos cargar tus planes de tratamiento."));
  if (cErr) throw new Error(mensajeDb(cErr, "No pudimos cargar los datos de la clínica."));
  if (!patient) throw new Error("Paciente no encontrado.");

  return {
    patient: { id: patient.id, name: patient.full_name },
    appointments: appts ?? [],
    plans: plans ?? [],
    clinic: { country: clinic?.country || "CL" },
  };
});

/**
 * El paciente crea una solicitud de hora (entra a waitlist_entries con
 * status 'pending'). La clínica confirma manualmente asignando cita real.
 */
export const requestPortalAppointment = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        preferredDate: z.string().min(1),
        reason: z.string().trim().min(1, "Cuéntanos el motivo.").max(500),
        priority: z.enum(["baja", "media", "alta"]).default("media"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { patientId, clinicId } = await requirePortalSession();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Rate limit: el portal no tiene login, así que un link filtrado/reenviado
    // podría spammear esta tabla. Tope: 3 solicitudes por paciente en 24h.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabaseAdmin
      .from("appointment_requests")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .gte("created_at", since);
    if (countErr)
      throw new Error(mensajeDb(countErr, "No pudimos verificar tus solicitudes anteriores."));
    if ((count ?? 0) >= 3) {
      throw new Error(
        "Ya enviaste varias solicitudes hoy. La clínica te va a contactar pronto — evita duplicarlas.",
      );
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("appointment_requests")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        preferred_date: data.preferredDate,
        reason: data.reason,
        priority: data.priority,
        source: "portal",
      })
      .select("id")
      .single();
    if (error) throw new Error("No pudimos registrar tu solicitud. " + error.message);
    return { id: inserted.id };
  });

// ────────────────────────────────────────────────────────────
// Cara clínica: bandeja de solicitudes pendientes
// ────────────────────────────────────────────────────────────

export interface PendingAppointmentRequest {
  id: string;
  patientId: string;
  patientName: string;
  preferredDate: string;
  reason: string;
  priority: "baja" | "media" | "alta";
  createdAt: string;
}

/** Solicitudes pendientes del portal para la bandeja de agenda. RLS: solo staff de la clínica. */
export const listPendingAppointmentRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PendingAppointmentRequest[]> => {
    const { data: requests, error } = await context.supabase
      .from("appointment_requests")
      .select("id, patient_id, preferred_date, reason, priority, created_at")
      .eq("clinic_id", data.clinicId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las solicitudes pendientes."));
    if (!requests || requests.length === 0) return [];

    const patientIds = [...new Set(requests.map((r) => r.patient_id))];
    const { data: patients, error: pErr } = await context.supabase
      .from("patients")
      .select("id, full_name")
      .eq("clinic_id", data.clinicId)
      .in("id", patientIds);
    if (pErr) throw new Error(mensajeDb(pErr, "No pudimos cargar los datos de los pacientes."));
    const nameById = new Map((patients ?? []).map((p) => [p.id, p.full_name]));

    return requests.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      patientName: nameById.get(r.patient_id) ?? "Paciente",
      preferredDate: r.preferred_date,
      reason: r.reason,
      priority: r.priority as "baja" | "media" | "alta",
      createdAt: r.created_at,
    }));
  });

/** Marca una solicitud como rechazada. Requiere rol con permiso de agenda. */
export const declineAppointmentRequest = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), requestId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("appointment_requests")
      .update({
        status: "declined",
        handled_by: context.userId,
        handled_at: new Date().toISOString(),
      })
      .eq("clinic_id", data.clinicId)
      .eq("id", data.requestId);
    if (error) throw new Error(mensajeDb(error, "No pudimos rechazar la solicitud."));
    return { ok: true };
  });

/** Vincula una solicitud a la cita real recién creada y la cierra. */
export const markAppointmentRequestScheduled = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        requestId: z.string().uuid(),
        appointmentId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("appointment_requests")
      .update({
        status: "scheduled",
        scheduled_appointment_id: data.appointmentId,
        handled_by: context.userId,
        handled_at: new Date().toISOString(),
      })
      .eq("clinic_id", data.clinicId)
      .eq("id", data.requestId);
    if (error) throw new Error(mensajeDb(error, "No pudimos vincular la solicitud a la cita."));
    return { ok: true };
  });
