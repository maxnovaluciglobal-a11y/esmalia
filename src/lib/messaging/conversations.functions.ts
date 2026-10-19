import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { motivoParaNoEnviarWhatsApp } from "@/lib/messaging/baja-whatsapp";
import { buildWaMeUrl, normalizeToWaMe } from "@/lib/messaging/messaging";
import { mensajeTelefonoInvalido } from "@/lib/messaging/telefonos";
import {
  agruparConversaciones,
  serviceWindow,
  type ConversationMessage,
  type ConversationSummary,
  type MessageDirection,
} from "@/lib/messaging/conversations";
import { sendMetaTextMessage } from "@/lib/messaging/whatsapp.functions";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Cuántos mensajes se leen para armar la bandeja. La query NO puede hacer
 * `DISTINCT ON (patient_id)` — PostgREST no lo expone — así que se traen los
 * N más recientes de la clínica y se agrupan en memoria.
 *
 * El recorte es por RECENCIA, que es justo el orden en el que la bandeja
 * muestra las conversaciones: lo que se pierde al tocar el techo son los
 * hilos más viejos, que igual quedarían al fondo. `truncated` avisa cuando
 * pasa, en vez de mentir con una lista corta.
 */
const VENTANA_BANDEJA = 1000;
/** Ventana chica para el badge del menú: no necesita el cuerpo del mensaje. */
const VENTANA_BADGE = 300;

export interface ConversationsPage {
  conversations: ConversationSummary[];
  /** true si se alcanzó el techo de mensajes leídos y puede faltar historia vieja. */
  truncated: boolean;
}

type FilaPaciente = {
  id: string;
  full_name: string;
  phone: string | null;
  wa_opt_in: boolean | null;
  wa_opt_out_at: string | null;
};

function nombrePaciente(p: FilaPaciente): string {
  return p.full_name.trim() || "Paciente sin nombre";
}

/**
 * Bandeja de conversaciones de la clínica: un hilo por paciente con mensajes,
 * ordenado por el más reciente.
 *
 * El control de acceso es la RLS de `messages` (SELECT solo para miembros de
 * la clínica), no un chequeo en este archivo — así una server function nueva
 * no puede olvidarse de validar y filtrar de más o de menos.
 */
export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ConversationsPage> => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("patient_id, direction, body, created_at")
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: false })
      .limit(VENTANA_BANDEJA);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las conversaciones."));

    const filas = rows ?? [];
    if (filas.length === 0) return { conversations: [], truncated: false };

    const patientIds = [...new Set(filas.map((r) => r.patient_id))];
    const { data: pacientes, error: errPac } = await context.supabase
      .from("patients")
      .select("id, full_name, phone, wa_opt_in, wa_opt_out_at")
      .eq("clinic_id", data.clinicId)
      .in("id", patientIds);
    if (errPac) throw new Error(mensajeDb(errPac, "No pudimos cargar los pacientes del hilo."));

    const fichas = new Map(
      (pacientes ?? []).map((p) => [
        p.id,
        {
          name: nombrePaciente(p as FilaPaciente),
          phone: p.phone,
          waOptIn: p.wa_opt_in !== false,
          waOptOutAt: p.wa_opt_out_at,
        },
      ]),
    );

    return {
      conversations: agruparConversaciones(
        filas.map((r) => ({
          patientId: r.patient_id,
          direction: r.direction as MessageDirection,
          body: r.body,
          createdAt: r.created_at,
        })),
        fichas,
      ),
      truncated: filas.length === VENTANA_BANDEJA,
    };
  });

/**
 * Solo el número para el badge del menú. Query aparte y más chica a propósito:
 * el badge se recalcula cada 2 minutos en TODA pestaña abierta, y no necesita
 * ni el cuerpo del mensaje ni la ficha del paciente.
 */
export const countConversacionesSinResponder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<number> => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("patient_id, direction")
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: false })
      .limit(VENTANA_BADGE);
    if (error) return 0; // el badge nunca rompe la navegación

    const visto = new Set<string>();
    let sinResponder = 0;
    for (const r of rows ?? []) {
      if (visto.has(r.patient_id)) continue;
      visto.add(r.patient_id);
      if (r.direction === "inbound") sinResponder += 1;
    }
    return sinResponder;
  });

export interface ConversationThread {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  waOptIn: boolean;
  waOptOutAt: string | null;
  messages: ConversationMessage[];
  /** Minutos restantes de la ventana de 24h de Meta; 0 = cerrada. */
  ventanaMinutos: number;
  /** true si la clínica tiene un número de WhatsApp conectado a la Cloud API. */
  apiConectada: boolean;
}

/** El hilo completo con un paciente, de más viejo a más nuevo (orden de lectura). */
export const listConversationThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ConversationThread> => {
    const [{ data: rows, error }, { data: paciente }, { data: cuenta }] = await Promise.all([
      context.supabase
        .from("messages")
        .select(
          "id, direction, channel, status, body, template_kind, created_at, sent_at, delivered_at, read_at, error",
        )
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .order("created_at", { ascending: false })
        .limit(200),
      context.supabase
        .from("patients")
        .select("id, full_name, phone, wa_opt_in, wa_opt_out_at")
        .eq("clinic_id", data.clinicId)
        .eq("id", data.patientId)
        .maybeSingle(),
      context.supabase
        .from("whatsapp_accounts")
        .select("id")
        .eq("clinic_id", data.clinicId)
        .eq("status", "connected")
        .maybeSingle(),
    ]);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la conversación."));
    if (!paciente) throw new Error("No encontramos al paciente en esta clínica.");

    // La query pide DESC (para que el `limit` recorte lo viejo, no lo nuevo)
    // y acá se da vuelta: el hilo se lee de arriba hacia abajo.
    const mensajes: ConversationMessage[] = (rows ?? [])
      .map((r) => ({
        id: r.id,
        direction: r.direction as MessageDirection,
        channel: r.channel as ConversationMessage["channel"],
        status: r.status as ConversationMessage["status"],
        body: r.body,
        templateKind: r.template_kind,
        createdAt: r.created_at,
        sentAt: r.sent_at,
        deliveredAt: r.delivered_at,
        readAt: r.read_at,
        error: r.error,
      }))
      .reverse();

    const ultimoEntrante = [...mensajes].reverse().find((m) => m.direction === "inbound") ?? null;

    return {
      patientId: paciente.id,
      patientName: nombrePaciente(paciente as FilaPaciente),
      patientPhone: paciente.phone,
      waOptIn: paciente.wa_opt_in !== false,
      waOptOutAt: paciente.wa_opt_out_at,
      messages: mensajes,
      ventanaMinutos: serviceWindow(ultimoEntrante?.createdAt ?? null).minutesLeft,
      apiConectada: Boolean(cuenta),
    };
  });

export interface ReplyResult {
  /** "api" = salió de verdad por la Cloud API. "wa_me" = hay que abrir el link. */
  via: "api" | "wa_me";
  waMeUrl: string | null;
  messageId: string;
}

/**
 * Responde a un paciente desde la bandeja.
 *
 * Dos caminos, y cuál se usa NO es una preferencia sino una regla de Meta:
 * texto libre por la Cloud API solo se puede mandar dentro de la ventana de
 * servicio de 24h que abre el propio paciente al escribir. Fuera de eso —o
 * sin WABA conectado— se cae a wa.me, que es un humano mandando desde su
 * propio WhatsApp y no tiene esa restricción.
 *
 * El mensaje se guarda en `messages` en los dos casos, con el mismo criterio
 * que ya usaba `sendWhatsAppFromTemplate`: si el staff apretó el botón,
 * asumimos que lo mandó. Sin esto la bandeja mostraría el hilo cortado.
 */
export const replyToConversation = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        body: z.string().trim().min(1, "El mensaje no puede estar vacío.").max(4096),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ReplyResult> => {
    const { supabase, userId } = context;
    await assertNotDemoClinic(supabase, data.clinicId);

    const [{ data: paciente, error: errPac }, { data: clinica }] = await Promise.all([
      supabase
        .from("patients")
        .select("id, phone, wa_opt_out_at")
        .eq("clinic_id", data.clinicId)
        .eq("id", data.patientId)
        .maybeSingle(),
      supabase.from("clinics").select("country").eq("id", data.clinicId).maybeSingle(),
    ]);
    if (errPac) throw new Error(mensajeDb(errPac, "No pudimos leer la ficha del paciente."));
    if (!paciente) throw new Error("No encontramos al paciente en esta clínica.");
    if (!paciente.phone) throw new Error("El paciente no tiene teléfono cargado en su ficha.");

    // BIL-11: el número se lee con el país de la clínica, nunca con Chile por defecto.
    const pais = clinica?.country ?? null;
    const destino = normalizeToWaMe(paciente.phone, pais);
    if (!destino) throw new Error(mensajeTelefonoInvalido(paciente.phone, pais));

    // La ventana se mide contra el último ENTRANTE real, no contra lo que
    // diga el cliente: el navegador no es fuente de verdad de una regla de Meta.
    const { data: ultimoEntrante } = await supabase
      .from("messages")
      .select("created_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const ventana = serviceWindow(ultimoEntrante?.created_at ?? null);

    // CON-09: a un paciente dado de baja solo se le contesta lo que él mismo
    // escribió, con la ventana de 24 h abierta. Fuera de eso, ni API ni wa.me.
    const bloqueo = motivoParaNoEnviarWhatsApp({
      waOptOutAt: paciente.wa_opt_out_at,
      tipo: "respuesta",
      ventanaAbierta: ventana.open,
    });
    if (bloqueo) throw new Error(bloqueo);

    let via: ReplyResult["via"] = "wa_me";
    let externalId: string | null = null;

    if (ventana.open) {
      const { data: cuenta } = await supabase
        .from("whatsapp_accounts")
        .select("phone_number_id")
        .eq("clinic_id", data.clinicId)
        .eq("status", "connected")
        .maybeSingle();
      if (cuenta) {
        try {
          const enviado = await sendMetaTextMessage({
            clinicId: data.clinicId,
            phoneNumberId: cuenta.phone_number_id,
            to: destino,
            body: data.body,
          });
          via = "api";
          externalId = enviado.wamid;
        } catch (err) {
          // Igual que tryMetaTemplateSend: un fallo de Meta degrada a wa.me
          // en vez de perder la respuesta que alguien ya escribió.
          console.error(
            "[conversaciones] respuesta por API falló, cae a wa.me:",
            (err as Error).message,
          );
        }
      }
    }

    const ahora = new Date().toISOString();
    const { data: insertado, error: errIns } = await supabase
      .from("messages")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        channel: "whatsapp",
        direction: "outbound",
        status: "sent",
        recipient: destino,
        body: data.body,
        external_id: externalId,
        sent_at: ahora,
        sent_by: userId,
      })
      .select("id")
      .single();
    if (errIns || !insertado) {
      throw new Error(mensajeDb(errIns, "No pudimos guardar la respuesta en el historial."));
    }

    return {
      via,
      waMeUrl: via === "wa_me" ? buildWaMeUrl(paciente.phone, data.body, pais) : null,
      messageId: insertado.id,
    };
  });
