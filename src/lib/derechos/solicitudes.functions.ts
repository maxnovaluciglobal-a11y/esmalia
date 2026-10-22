/**
 * Bandeja de solicitudes del titular para la clínica (SEG-09, Ley 21.719).
 *
 * Solo owner/admin: la pantalla exige `team:manage` y cada función vuelve a
 * leer el rol (regla 15); la RLS (`can_manage_clinic`) es la tercera capa y
 * la política `mfa_exige_aal2`, la cuarta. Todas las escrituras van con el
 * cliente del usuario: el trigger de la base valida transiciones, estampa
 * quién respondió y escribe la bitácora.
 *
 * Responder no se bloquea en modo solo lectura (suscripción impaga): es una
 * obligación legal de la clínica con su paciente, igual que la baja de
 * correos (ver `ESCRITURA_EXENTA` en `solo-lectura.ts`).
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { assertNotDemoClinic, requireClinicRole } from "@/lib/access/clinic-guards.server";
import { appOrigin } from "@/lib/app-origin.server";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { mensajeDb } from "@/lib/db-errors";
import { correoRespuestaTitular } from "@/lib/derechos/correo-respuesta";
import {
  TIPOS_DE_SOLICITUD,
  asuntoRespuesta,
  fechaCivilEn,
  mensajeRespuesta,
  type CanalSolicitud,
  type EstadoSolicitud,
  type EventoSolicitud,
  type TipoSolicitud,
} from "@/lib/derechos/derechos";
import { destinatarioDelPaciente } from "@/lib/documentos/correo.server";
import { fecha } from "@/lib/formato-fecha";
import { sendEmail } from "@/lib/messaging/email.server";

type Cliente = SupabaseClient<Database>;

export const MENSAJE_SIN_PERMISO_DERECHOS =
  "Solo el propietario o un administrador de la clínica gestiona las solicitudes de los pacientes sobre sus datos.";

function exigirGestion(supabase: Cliente, clinicId: string, userId: string) {
  return requireClinicRole(
    supabase,
    clinicId,
    userId,
    ["owner", "admin"],
    MENSAJE_SIN_PERMISO_DERECHOS,
  );
}

async function zonaDeLaClinica(supabase: Cliente, clinicId: string) {
  const { data, error } = await supabase
    .from("clinics")
    .select("name, timezone")
    .eq("id", clinicId)
    .maybeSingle();
  if (error || !data) throw new Error("No tienes permisos para esta clínica.");
  return { nombre: data.name, zona: data.timezone || "America/Santiago" };
}

async function nombresDePerfiles(supabase: Cliente, ids: Array<string | null>) {
  const unicos = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unicos.length) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unicos);
  return new Map(
    (data ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "Integrante del equipo"] as const),
  );
}

export interface EventoDeSolicitud {
  id: string;
  event: EventoSolicitud;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface SolicitudDelTitular {
  id: string;
  patientId: string;
  patientName: string;
  kind: TipoSolicitud;
  channel: CanalSolicitud;
  detail: string | null;
  status: EstadoSolicitud;
  received_at: string;
  due_date: string;
  extended_due_date: string | null;
  extensionReason: string | null;
  response: string | null;
  respondedAt: string | null;
  respondedByName: string | null;
  registeredByName: string | null;
  correoEnviado: boolean;
  eventos: EventoDeSolicitud[];
}

/** Bandeja completa de la clínica (las más recientes 500). */
export const listarSolicitudesTitular = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ zona: string; hoy: string; solicitudes: SolicitudDelTitular[] }> => {
      const { supabase, userId } = context;
      await exigirGestion(supabase, data.clinicId, userId);
      const { zona } = await zonaDeLaClinica(supabase, data.clinicId);

      const { data: filas, error } = await supabase
        .from("data_subject_requests")
        .select(
          "id, patient_id, kind, channel, detail, status, received_at, due_date, extended_due_date, extension_reason, response, responded_at, responded_by, registered_by, response_message_id",
        )
        .eq("clinic_id", data.clinicId)
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(mensajeDb(error, "No pudimos cargar las solicitudes."));
      const rows = filas ?? [];

      const ids = rows.map((r) => r.id);
      const patientIds = [...new Set(rows.map((r) => r.patient_id))];
      const [eventos, pacientes] = await Promise.all([
        ids.length
          ? supabase
              .from("data_subject_request_events")
              .select("id, request_id, event, actor_id, note, created_at")
              .eq("clinic_id", data.clinicId)
              .in("request_id", ids)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        patientIds.length
          ? supabase
              .from("patients")
              .select("id, full_name")
              .eq("clinic_id", data.clinicId)
              .in("id", patientIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (eventos.error) throw new Error("No pudimos cargar la bitácora de las solicitudes.");
      if (pacientes.error) throw new Error("No pudimos cargar los nombres de los pacientes.");

      const nombres = await nombresDePerfiles(supabase, [
        ...rows.flatMap((r) => [r.responded_by, r.registered_by]),
        ...(eventos.data ?? []).map((e) => e.actor_id),
      ]);
      const nombrePaciente = new Map((pacientes.data ?? []).map((p) => [p.id, p.full_name]));
      const eventosPor = new Map<string, EventoDeSolicitud[]>();
      for (const e of eventos.data ?? []) {
        const lista = eventosPor.get(e.request_id) ?? [];
        lista.push({
          id: e.id,
          event: e.event as EventoSolicitud,
          actorName: e.actor_id ? (nombres.get(e.actor_id) ?? "Usuario eliminado") : null,
          note: e.note,
          createdAt: e.created_at,
        });
        eventosPor.set(e.request_id, lista);
      }

      return {
        zona,
        hoy: fechaCivilEn(new Date(), zona),
        solicitudes: rows.map((r) => ({
          id: r.id,
          patientId: r.patient_id,
          patientName: nombrePaciente.get(r.patient_id) ?? "Paciente",
          kind: r.kind as TipoSolicitud,
          channel: r.channel as CanalSolicitud,
          detail: r.detail,
          status: r.status as EstadoSolicitud,
          received_at: r.received_at,
          due_date: r.due_date,
          extended_due_date: r.extended_due_date,
          extensionReason: r.extension_reason,
          response: r.response,
          respondedAt: r.responded_at,
          respondedByName: r.responded_by ? (nombres.get(r.responded_by) ?? null) : null,
          registeredByName: r.registered_by ? (nombres.get(r.registered_by) ?? null) : null,
          correoEnviado: Boolean(r.response_message_id),
          eventos: eventosPor.get(r.id) ?? [],
        })),
      };
    },
  );

/** Registra una solicitud que llegó por otro canal (correo, en persona, carta). */
export const registrarSolicitudTitular = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        tipo: z.enum(TIPOS_DE_SOLICITUD),
        detalle: z.string().trim().min(5, "Describe lo que pide el paciente.").max(2000),
        /** Día en que llegó (YYYY-MM-DD, en el huso de la clínica). */
        recibidaEl: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);
    await assertNotDemoClinic(supabase, data.clinicId);
    const { zona } = await zonaDeLaClinica(supabase, data.clinicId);

    // Hoy: la hora real. Un día anterior: el mediodía de ese día en la
    // clínica (el plazo se cuenta por días, la hora no lo cambia).
    const hoy = fechaCivilEn(new Date(), zona);
    if (data.recibidaEl > hoy) throw new Error("La fecha de recepción no puede ser futura.");
    const recibida =
      data.recibidaEl === hoy ? new Date() : wallTimeInTzToUtc(`${data.recibidaEl}T12:00`, zona);

    const { data: fila, error } = await supabase
      .from("data_subject_requests")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        kind: data.tipo,
        channel: "clinica",
        detail: data.detalle,
        received_at: recibida.toISOString(),
      })
      .select("id")
      .single();
    if (error || !fila) throw new Error(mensajeDb(error, "No pudimos registrar la solicitud."));
    return { id: fila.id };
  });

/** Pasa a revisión, responde o rechaza fundadamente. */
export const actualizarSolicitudTitular = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        requestId: z.string().uuid(),
        accion: z.enum(["en_revision", "responder", "rechazar"]),
        respuesta: z.string().trim().max(8000).optional(),
      })
      .refine((v) => v.accion === "en_revision" || (v.respuesta ?? "").length >= 10, {
        message: "Escribe la respuesta al paciente (al menos 10 caracteres).",
        path: ["respuesta"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);
    const cambio =
      data.accion === "en_revision"
        ? { status: "en_revision" }
        : {
            status: data.accion === "responder" ? "respondida" : "rechazada",
            response: data.respuesta ?? "",
          };
    const { data: filas, error } = await supabase
      .from("data_subject_requests")
      .update(cambio)
      .eq("clinic_id", data.clinicId)
      .eq("id", data.requestId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar el cambio."));
    if (!filas?.length) throw new Error("Solicitud no encontrada o sin permisos.");
    return { ok: true };
  });

/** Prórroga única del plazo, con motivo (la base suma los días). */
export const prorrogarSolicitudTitular = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        requestId: z.string().uuid(),
        motivo: z.string().trim().min(10, "Explica el motivo de la prórroga.").max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);
    const { data: filas, error } = await supabase
      .from("data_subject_requests")
      // El valor lo reemplaza el trigger por due_date + 30; se manda uno
      // cualquiera para que la columna "cambie".
      .update({ extended_due_date: "2000-01-01", extension_reason: data.motivo })
      .eq("clinic_id", data.clinicId)
      .eq("id", data.requestId)
      .select("extended_due_date");
    if (error) throw new Error(mensajeDb(error, "No pudimos prorrogar el plazo."));
    if (!filas?.length) throw new Error("Solicitud no encontrada o sin permisos.");
    return { venceEl: filas[0].extended_due_date };
  });

/**
 * Envía la respuesta escrita al paciente por correo (o a su tutor si es
 * menor), respetando el modo de prueba del correo de la clínica. Queda en
 * `messages` y, si salió, en la solicitud y su bitácora.
 */
export const enviarRespuestaTitularPorCorreo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), requestId: z.string().uuid() }).parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      enviado: boolean;
      motivo: string | null;
      destinatario: string;
      redirigidoA: string | null;
    }> => {
      const { supabase, userId } = context;
      await exigirGestion(supabase, data.clinicId, userId);
      await assertNotDemoClinic(supabase, data.clinicId);
      const clinica = await zonaDeLaClinica(supabase, data.clinicId);

      const { data: s, error } = await supabase
        .from("data_subject_requests")
        .select("id, patient_id, kind, status, received_at, response, response_message_id")
        .eq("clinic_id", data.clinicId)
        .eq("id", data.requestId)
        .maybeSingle();
      if (error || !s) throw new Error("Solicitud no encontrada o sin permisos.");
      if (s.status !== "respondida" && s.status !== "rechazada") {
        throw new Error("Primero registra la respuesta.");
      }
      if (s.response_message_id) throw new Error("La respuesta ya se envió por correo.");

      // La respuesta a una solicitud sobre sus datos no es publicidad: sale
      // aunque el paciente se haya dado de baja de los correos.
      const destino = await destinatarioDelPaciente(supabase, {
        clinicId: data.clinicId,
        patientId: s.patient_id,
      });
      if (!destino.email) {
        throw new Error(
          destino.para === "tutor"
            ? "Ni el tutor ni el paciente tienen un correo cargado. Entrégale la respuesta por otro medio."
            : "El paciente no tiene un correo cargado. Entrégale la respuesta por otro medio.",
        );
      }

      const asunto = asuntoRespuesta(s.kind as TipoSolicitud, clinica.nombre);
      const correo = correoRespuestaTitular({
        appUrl: appOrigin(),
        asunto,
        clinica: clinica.nombre,
        mensaje: mensajeRespuesta({
          paciente: destino.nombre ?? destino.pacienteNombre,
          clinica: clinica.nombre,
          tipo: s.kind as TipoSolicitud,
          recibidaEl: fecha(s.received_at, clinica.zona),
          estado: s.status,
          respuesta: s.response ?? "",
        }),
      });

      const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
      const sandbox = await loadEmailSandboxConfig(supabase, data.clinicId);
      const resultado = await sendEmail(
        { to: destino.email, subject: correo.subject, html: correo.html, text: correo.text },
        sandbox,
      );

      const ahora = new Date().toISOString();
      const { data: mensaje, error: errMsg } = await supabase
        .from("messages")
        .insert({
          clinic_id: data.clinicId,
          patient_id: s.patient_id,
          template_kind: "custom",
          channel: "email",
          direction: "outbound",
          status: resultado.ok ? "sent" : "failed",
          recipient: destino.email,
          body: correo.html,
          external_id: resultado.ok ? resultado.externalId : null,
          error: resultado.ok ? null : resultado.reason,
          sent_at: resultado.ok ? ahora : null,
          sent_by: userId,
        })
        .select("id")
        .single();
      if (errMsg || !mensaje) {
        throw new Error(
          mensajeDb(
            errMsg,
            resultado.ok
              ? "El correo salió, pero no pudimos registrarlo en el historial."
              : "No pudimos registrar el intento de envío.",
          ),
        );
      }

      if (resultado.ok) {
        const { error: errVinculo } = await supabase
          .from("data_subject_requests")
          .update({ response_message_id: mensaje.id })
          .eq("clinic_id", data.clinicId)
          .eq("id", s.id);
        if (errVinculo) {
          throw new Error(
            mensajeDb(
              errVinculo,
              "El correo salió y quedó en los mensajes del paciente, pero no pudimos anotarlo en la solicitud.",
            ),
          );
        }
      }

      return {
        enviado: resultado.ok,
        motivo: resultado.ok ? null : resultado.reason,
        destinatario: destino.email,
        redirigidoA: resultado.ok && resultado.redirected ? resultado.recipient : null,
      };
    },
  );
