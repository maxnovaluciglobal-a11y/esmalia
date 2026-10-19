import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

import { esPalabraDeBaja } from "@/lib/messaging/baja-whatsapp";
import { estadoPlantillaDesdeMeta } from "@/lib/messaging/meta-plantillas";
import { normalizeToWaMe } from "@/lib/messaging/messaging";
import { isClinicOpenNow } from "@/lib/messaging/whatsapp";
import { sendMetaTextMessage } from "@/lib/messaging/whatsapp.functions";
import { notifyClinicStaff, ROLES_BANDEJA } from "@/lib/messaging/notifications.functions";
import { esConfirmacionDePaciente } from "@/lib/messaging/patient-confirmation";
import { hoyEnLaClinica, interpretarMensajeDeAgenda } from "@/lib/messaging/intencion-de-agenda";
import { interpretarConIA } from "@/lib/messaging/intencion-de-agenda-ia";
import { avisoDeAgenda, type FuenteDeLectura } from "@/lib/messaging/aviso-de-agenda";
import { captureException } from "@/lib/sentry";
import type { Database } from "@/integrations/supabase/types";

type SupabaseAdminClient = SupabaseClient<Database>;

/**
 * Webhook de la WhatsApp Cloud API (Fase 1 + Fase 3). Meta llama esto sin
 * auth de Supabase — se valida con el handshake GET y la firma HMAC del
 * POST, y se escribe con supabaseAdmin (service_role) igual que
 * api.demo-reset.ts.
 *
 * GET  = verificación de suscripción (una vez, al configurar el webhook en
 *        Meta Business Manager).
 * POST = eventos reales: status callbacks (delivered/read/failed) y
 *        mensajes entrantes. Si el número coincide con un paciente: se
 *        guarda el mensaje, se avisa al equipo, y BAJA/STOP corta el opt-in
 *        (Fase 1). **NO confirma citas** — este archivo no toca
 *        `appointments` en ninguna línea; el auto-confirm por "SI" existió y
 *        se removió a propósito en `505eb7d`. Si es un desconocido: se
 *        captura como lead + auto-respuesta con texto libre, sin plantilla —
 *        válido porque el desconocido acaba de abrir la ventana de servicio
 *        de 24h al escribir primero (Fase 3).
 */
export const Route = createFileRoute("/api/whatsapp-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        if (!expected) {
          return new Response("WHATSAPP_WEBHOOK_VERIFY_TOKEN no configurado", { status: 500 });
        }
        if (mode !== "subscribe" || token !== expected || !challenge) {
          return new Response("forbidden", { status: 403 });
        }
        return new Response(challenge, { status: 200 });
      },

      POST: async ({ request }) => {
        const appSecret = process.env.WHATSAPP_APP_SECRET;
        if (!appSecret) {
          return new Response("WHATSAPP_APP_SECRET no configurado", { status: 500 });
        }

        const rawBody = await request.text();
        const signatureHeader = request.headers.get("x-hub-signature-256") ?? "";
        if (!isValidSignature(rawBody, signatureHeader, appSecret)) {
          return new Response("invalid signature", { status: 401 });
        }

        let payload: WhatsAppWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Nunca dejamos que un item roto tumbe el 200 general — Meta reintenta
        // agresivo si no confirmamos rápido, y un solo entry raro no debería
        // bloquear el resto.
        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value;
            if (!value) continue;
            if (change.field === "message_template_status_update") {
              try {
                await applyTemplateStatus(supabaseAdmin, entry.id, value);
              } catch (err) {
                console.error("[whatsapp-webhook] estado de plantilla:", (err as Error).message);
              }
              continue;
            }
            const phoneNumberId = value.metadata?.phone_number_id;
            if (!phoneNumberId) continue;

            try {
              const { data: account } = await supabaseAdmin
                .from("whatsapp_accounts")
                .select("clinic_id")
                .eq("phone_number_id", phoneNumberId)
                .maybeSingle();
              if (!account) continue; // número no reconocido, nada que hacer

              for (const status of value.statuses ?? []) {
                await applyStatusUpdate(supabaseAdmin, status);
              }
              const nameByWaId = new Map(
                (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]),
              );
              for (const message of value.messages ?? []) {
                await applyInboundMessage(
                  supabaseAdmin,
                  account.clinic_id,
                  message,
                  nameByWaId.get(message.from),
                );
              }
            } catch (err) {
              console.error("[whatsapp-webhook] error procesando entry:", (err as Error).message);
            }
          }
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

function isValidSignature(rawBody: string, signatureHeader: string, appSecret: string): boolean {
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Tipo mínimo del payload de Meta — no vale la pena vendorear su SDK para esto. */
interface WhatsAppStatusEvent {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  errors?: Array<{ title?: string; message?: string }>;
}
interface WhatsAppInboundMessage {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
}
interface WhatsAppContact {
  wa_id: string;
  profile?: { name?: string };
}
interface WhatsAppWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        statuses?: WhatsAppStatusEvent[];
        messages?: WhatsAppInboundMessage[];
        contacts?: WhatsAppContact[];
        // field = "message_template_status_update"
        event?: string;
        message_template_name?: string;
        message_template_language?: string;
        reason?: string | null;
      };
      field?: string;
    }>;
  }>;
}

/**
 * Meta avisa cuando aprueba, rechaza o pausa una plantilla. El entry.id es
 * el WABA: se actualizan las plantillas con ese nombre de las clínicas que
 * tienen ese WABA conectado. Solo "approved" habilita el envío por la API.
 */
async function applyTemplateStatus(
  supabaseAdmin: SupabaseAdminClient,
  wabaId: string | undefined,
  value: { event?: string; message_template_name?: string; message_template_language?: string },
): Promise<void> {
  if (!wabaId || !value.message_template_name || !value.event) return;
  const { data: cuentas } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("clinic_id")
    .eq("waba_id", wabaId);
  const clinicIds = (cuentas ?? []).map((c) => c.clinic_id);
  if (clinicIds.length === 0) return;
  let query = supabaseAdmin
    .from("message_templates")
    .update({ meta_status: estadoPlantillaDesdeMeta(value.event) })
    .in("clinic_id", clinicIds)
    .eq("meta_template_name", value.message_template_name);
  if (value.message_template_language) {
    query = query.eq("meta_language", value.message_template_language);
  }
  await query;
}

/** Status callback: delivered/read/failed → actualiza la fila por external_id (wamid). */
async function applyStatusUpdate(
  supabaseAdmin: SupabaseAdminClient,
  status: WhatsAppStatusEvent,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const patch: Database["public"]["Tables"]["messages"]["Update"] = { status: status.status };
  if (status.status === "delivered") patch.delivered_at = nowIso;
  if (status.status === "read") patch.read_at = nowIso;
  if (status.status === "failed") {
    patch.error = status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? "Falló en Meta";
  }
  await supabaseAdmin.from("messages").update(patch).eq("external_id", status.id);
}

/**
 * Mensaje entrante: se guarda siempre en el historial (así el staff lo ve en
 * la ficha del paciente, incluso "SÍ"/"RE" — ninguno dispara un cambio de
 * estado automático). Confirmar una cita es acción exclusiva del profesional
 * asignado (o admin/owner en su nombre) desde la agenda — ver migración
 * 20260901130000_appointment_dentist_confirmation. Antes "SÍ" confirmaba la
 * próxima cita solo, sin que nadie de la clínica la validara; se sacó a
 * pedido de una clienta potencial. "BAJA", "STOP" o "NO MÁS" cortan el
 * opt-in (`esPalabraDeBaja`); "CANCELAR" ya no, ver `baja-whatsapp.ts`.
 */
async function applyInboundMessage(
  supabaseAdmin: SupabaseAdminClient,
  clinicId: string,
  message: WhatsAppInboundMessage,
  contactName: string | undefined,
): Promise<void> {
  // BIL-11: `message.from` es el wa_id de Meta, siempre internacional y sin
  // "+" ("5491123456789"). Los teléfonos de las fichas se leen con el país
  // de la clínica: así "11 15 2345-6789" de una clínica argentina y el
  // "549…" que manda Meta quedan iguales, y MX "521…" coincide con "52…".
  const [{ data: clinica }, { data: patients }] = await Promise.all([
    supabaseAdmin.from("clinics").select("country").eq("id", clinicId).maybeSingle(),
    supabaseAdmin
      .from("patients")
      .select("id, phone")
      .eq("clinic_id", clinicId)
      .not("phone", "is", null),
  ]);
  const pais = clinica?.country ?? null;
  const fromNormalized = normalizeToWaMe(`+${message.from}`, pais);
  if (!fromNormalized) return;

  const bodyText = message.type === "text" ? (message.text?.body ?? "") : "";

  const patient = (patients ?? []).find(
    (p) => p.phone && normalizeToWaMe(p.phone, pais) === fromNormalized,
  );
  if (!patient) {
    // Fase 3: desconocido — no es un paciente con ficha, es un lead.
    await handleUnknownSender(supabaseAdmin, clinicId, fromNormalized, bodyText, contactName);
    return;
  }
  const textoGuardado = bodyText || `[${message.type}]`;
  await supabaseAdmin.from("messages").insert({
    clinic_id: clinicId,
    patient_id: patient.id,
    channel: "whatsapp",
    direction: "inbound",
    status: "delivered",
    recipient: fromNormalized,
    body: textoGuardado,
    external_id: message.id,
  });

  const esBaja = esPalabraDeBaja(bodyText);
  if (esBaja) {
    await supabaseAdmin
      .from("patients")
      .update({ wa_opt_in: false, wa_opt_out_at: new Date().toISOString() })
      .eq("id", patient.id);
  }

  // Si el mensaje es un "ahí voy" limpio, se anota en el EJE DEL PACIENTE.
  // Nunca en `status` ni en `confirmed_at`: eso es del profesional y por
  // confundirlos hubo que remover esta función en `505eb7d`.
  const citaConfirmada = esBaja
    ? null
    : await anotarConfirmacionDelPaciente(supabaseAdmin, clinicId, patient.id, bodyText);

  // F4: si el mensaje pide, mueve o cancela una hora, se anota como solicitud
  // en vez de quedar como texto suelto que alguien tiene que releer. El orden
  // importa: baja y confirmación mandan, porque "STOP" es una baja y "sí" es
  // un aviso de asistencia, no un pedido de hora. "CANCELAR" ya no es baja
  // (CON-09): pelado cae al aviso genérico y con contexto ("quiero cancelar
  // mi hora") se lee como cancelación de cita.
  const solicitud =
    esBaja || citaConfirmada
      ? null
      : await anotarSolicitudDeAgenda(supabaseAdmin, clinicId, patient.id, bodyText);

  // Hasta acá el mensaje quedaba guardado y NADIE se enteraba: no había
  // pantalla que lo mostrara ni aviso que lo anunciara. El link apunta al
  // hilo ya abierto para que el aviso sea accionable de un click.
  const nombre = await nombreDePaciente(supabaseAdmin, patient.id);
  await notifyClinicStaff(supabaseAdmin, {
    clinicId,
    roles: ROLES_BANDEJA,
    kind: esBaja
      ? "patient_opt_out"
      : citaConfirmada
        ? "patient_confirmed_appointment"
        : solicitud
          ? "appointment_request"
          : "inbound_message",
    title: esBaja
      ? `${nombre} pidió la baja de WhatsApp`
      : citaConfirmada
        ? `${nombre} avisó que viene`
        : solicitud
          ? `${nombre}: ${solicitud.titulo}`
          : `${nombre} te escribió`,
    body: esBaja
      ? "Deja de recibir recordatorios automáticos. El mensaje quedó en su conversación."
      : citaConfirmada
        ? `Cita del ${citaConfirmada}. Sigue haciendo falta que el profesional la acepte para que quede confirmada.`
        : solicitud
          ? `${solicitud.detalle} — texto original: ${recorte(textoGuardado)}`
          : recorte(textoGuardado),
    // Una solicitud se resuelve en la agenda, no leyendo el hilo otra vez.
    link: solicitud ? "/agenda" : `/conversaciones?paciente=${patient.id}`,
    patientRef: patient.id,
  });
}

/** Mismo tope que el portal (`requestPortalAppointment`): 3 en 24 horas. */
const TOPE_SOLICITUDES_24H = 3;

/**
 * Frena la creación de solicitudes repetidas.
 *
 * Escribir por WhatsApp es gratis y repetirse es lo NORMAL cuando nadie
 * contesta: un paciente que manda "quiero hora para el jueves" tres veces
 * generaría tres filas pendientes y la clínica llamaría tres veces. El portal
 * ya tenía este freno por una razón parecida (un link reenviado); este camino
 * se había quedado sin él.
 *
 * Dos cortes, y el primero es el que resuelve el caso real:
 *   1. Ya hay una solicitud PENDIENTE para esa misma fecha → es la misma pedida.
 *   2. Ya hay 3 solicitudes en 24 h → alguien está insistiendo mucho.
 *
 * Frenar la fila NO frena el aviso al equipo: el mensaje igual aparece en la
 * bandeja, así que nadie se queda sin enterarse. Ante un error de lectura se
 * deja pasar: perder una solicitud legítima es peor que anotar una de más.
 */
async function puedeAnotarOtraSolicitud(
  supabaseAdmin: SupabaseAdminClient,
  clinicId: string,
  patientId: string,
  fecha: string,
): Promise<boolean> {
  const { count: mismaFecha, error: errFecha } = await supabaseAdmin
    .from("appointment_requests")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .eq("preferred_date", fecha)
    .eq("status", "pending");
  if (errFecha) return true;
  if ((mismaFecha ?? 0) > 0) return false;

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recientes, error: errRecientes } = await supabaseAdmin
    .from("appointment_requests")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .gte("created_at", desde);
  if (errRecientes) return true;
  return (recientes ?? 0) < TOPE_SOLICITUDES_24H;
}

/**
 * Anota lo que el paciente pidió sobre su agenda, si se puede leer con
 * reglas. Devuelve null cuando no — y ese null es a propósito el lugar donde
 * entrará el modelo de lenguaje cuando existan las API keys (ver
 * `intencion-de-agenda.ts`). Mientras tanto el mensaje cae en el aviso
 * genérico de siempre, o sea que no se pierde nada.
 *
 * Sólo se crea una fila en `appointment_requests` para el caso `agendar`
 * **con fecha**: es el único donde el circuito que ya existe (el del portal)
 * puede resolverlo sin adivinar. Mover o cancelar tocan una cita concreta que
 * hay que elegir, y eso es decisión de la clínica, no del webhook.
 */
async function anotarSolicitudDeAgenda(
  supabaseAdmin: SupabaseAdminClient,
  clinicId: string,
  patientId: string,
  bodyText: string,
): Promise<{ titulo: string; detalle: string } | null> {
  // El huso de la clínica, no el del servidor: este handler corre en UTC y
  // "mañana" escrito a las 22:00 en Santiago cae al día siguiente en UTC.
  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("timezone")
    .eq("id", clinicId)
    .maybeSingle();
  const hoyClinica = hoyEnLaClinica(clinica?.timezone ?? "America/Santiago");
  // Reglas primero, siempre. El modelo solo entra en el 20% que las reglas
  // no pueden leer con confianza (`lectura === null`) — ver el encabezado de
  // `intencion-de-agenda-ia.ts`. Sin GEMINI_API_KEY/OPENAI_API_KEY cargada,
  // `interpretarConIA` devuelve null de inmediato y el comportamiento es
  // idéntico al de antes de esta función existir.
  // La fuente viaja hasta el aviso: si leyó Patty (el modelo), el equipo lo
  // ve escrito. No cambia nada más: la lectura de la IA sigue el mismo
  // camino que la de las reglas y nunca confirma ni mueve una cita.
  const porReglas = interpretarMensajeDeAgenda(bodyText, hoyClinica);
  const fuente: FuenteDeLectura = porReglas ? "reglas" : "ia";
  const lectura = porReglas ?? (await interpretarConIA(bodyText, hoyClinica));
  if (!lectura) return null;

  if (lectura.intencion === "agendar" && lectura.fecha) {
    if (await puedeAnotarOtraSolicitud(supabaseAdmin, clinicId, patientId, lectura.fecha)) {
      const { error } = await supabaseAdmin.from("appointment_requests").insert({
        clinic_id: clinicId,
        patient_id: patientId,
        preferred_date: lectura.fecha,
        reason: recorte(bodyText),
        source: "whatsapp",
        status: "pending",
      });
      // Si falla, el aviso igual sale: perder el aviso por no poder anotar la
      // solicitud sería peor que tener el aviso sin la fila.
      if (error) console.error("[whatsapp] no se pudo anotar la solicitud:", error.message);
    }
  }

  return avisoDeAgenda(lectura, fuente);
}

/** Ventana en la que un "sí" suelto se puede atribuir a una cita concreta. */
const DIAS_ATRIBUIBLES = 30;

/**
 * Anota que el paciente avisó que viene a su próxima cita.
 *
 * Escribe SOLO `patient_confirmed_at`/`patient_confirmed_via`. `status`,
 * `confirmed_at` y `confirmed_by` no se tocan: son el visto bueno del
 * profesional y el paciente no tiene por qué poder moverlos. Ese es
 * exactamente el error que llevó a remover la confirmación automática.
 *
 * Devuelve la fecha legible de la cita anotada, o null si no había ninguna a
 * la que atribuir el mensaje (y entonces el aviso al equipo es el genérico).
 */
async function anotarConfirmacionDelPaciente(
  supabaseAdmin: SupabaseAdminClient,
  clinicId: string,
  patientId: string,
  bodyText: string,
): Promise<string | null> {
  if (!esConfirmacionDePaciente(bodyText)) return null;

  const ahora = new Date();
  const limite = new Date(ahora.getTime() + DIAS_ATRIBUIBLES * 24 * 60 * 60 * 1000);

  const { data: cita } = await supabaseAdmin
    .from("appointments")
    .select("id, starts_at, patient_confirmed_at")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .gt("starts_at", ahora.toISOString())
    .lt("starts_at", limite.toISOString())
    .not("status", "in", "(cancelada,ausente,finalizada)")
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Sin cita próxima el "sí" no se puede atribuir a nada. No se inventa.
  if (!cita) return null;
  // Ya estaba anotado: no se pisa la marca original ni se re-avisa al equipo.
  if (cita.patient_confirmed_at) return null;

  const { error } = await supabaseAdmin
    .from("appointments")
    .update({ patient_confirmed_at: ahora.toISOString(), patient_confirmed_via: "whatsapp" })
    .eq("id", cita.id);
  if (error) {
    console.error("[whatsapp-webhook] no se pudo anotar la confirmación:", error.message);
    return null;
  }

  return new Date(cita.starts_at).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Recorta el cuerpo del mensaje para que entre en el aviso sin desbordarlo. */
function recorte(texto: string, max = 140): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1)}…`;
}

async function nombreDePaciente(
  supabaseAdmin: SupabaseAdminClient,
  patientId: string,
): Promise<string> {
  const { data } = await supabaseAdmin
    .from("patients")
    .select("full_name")
    .eq("id", patientId)
    .maybeSingle();
  return data?.full_name?.trim() || "Un paciente";
}

/**
 * Fase 3 — captación: un número que no coincide con ningún paciente escribe
 * por primera vez (QR, bio de Instagram, Click-to-WhatsApp ad, o simplemente
 * alguien que guardó el número). `UNIQUE(clinic_id, phone)` en whatsapp_leads
 * hace que escribir varias veces sea UN lead, no varios — solo la primera
 * vez dispara la auto-respuesta, para no ser pesados.
 *
 * La auto-respuesta es texto libre (sendMetaTextMessage, sin plantilla): es
 * válida porque el desconocido acaba de abrir la ventana de servicio de 24h
 * al escribir primero — Meta permite responder lo que sea mientras esa
 * ventana esté abierta.
 */
async function handleUnknownSender(
  supabaseAdmin: SupabaseAdminClient,
  clinicId: string,
  fromNormalized: string,
  bodyText: string,
  contactName: string | undefined,
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_leads")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("phone", fromNormalized)
    .maybeSingle();

  if (existing) {
    // Ya lo conocíamos — no repetimos la auto-respuesta, no pisamos el
    // primer mensaje (queda como contexto de cuándo arrancó la conversación).
    await supabaseAdmin
      .from("whatsapp_leads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return;
  }

  // Fase 4 — referidos: los códigos son 6 hex uppercase (mismo formato que
  // genera el trigger generate_patient_referral_code). Si el primer mensaje
  // trae uno como palabra suelta y coincide con un paciente real de esta
  // clínica, queda linkeado — así el link wa.me pre-armado que el paciente
  // reenvía (con el código ya en el texto) conecta solo, sin que el
  // desconocido tenga que escribir nada especial.
  const referredByPatientId = await findReferrerByCode(supabaseAdmin, clinicId, bodyText);

  const { data: inserted, error } = await supabaseAdmin
    .from("whatsapp_leads")
    .insert({
      clinic_id: clinicId,
      phone: fromNormalized,
      name: contactName ?? null,
      first_message: bodyText || "[mensaje sin texto]",
      referred_by_patient_id: referredByPatientId,
    })
    .select("id")
    .single();
  if (error || !inserted) return;

  // Mismo problema que tenían los mensajes de pacientes: el lead se guardaba
  // en /whatsapp y nadie recibía un aviso. Un contacto nuevo que nadie mira
  // es captación perdida, que es lo único que este flujo existe para evitar.
  await notifyClinicStaff(supabaseAdmin, {
    clinicId,
    roles: ROLES_BANDEJA,
    kind: "whatsapp_lead",
    title: contactName ? `${contactName} escribió por primera vez` : "Contacto nuevo por WhatsApp",
    body: recorte(bodyText || "[mensaje sin texto]"),
    link: "/whatsapp",
  });

  try {
    const [{ data: account }, { data: branches }, { data: clinic }] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_accounts")
        .select("phone_number_id")
        .eq("clinic_id", clinicId)
        .eq("status", "connected")
        .maybeSingle(),
      supabaseAdmin
        .from("branches")
        .select("timezone, opens_at, closes_at, is_active")
        .eq("clinic_id", clinicId),
      supabaseAdmin.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
    ]);
    if (!account) return; // no debería pasar (el webhook ya resolvió a esta clínica), defensivo igual

    const abierto = isClinicOpenNow(
      (branches ?? []).map((b) => ({
        timezone: b.timezone,
        opensAt: b.opens_at,
        closesAt: b.closes_at,
        isActive: b.is_active,
      })),
    );
    const clinicaNombre = clinic?.name ?? "la clínica";
    const texto = abierto
      ? `¡Hola! Gracias por escribirnos a ${clinicaNombre}. En breve te responde alguien del equipo — cuéntanos qué necesitas mientras tanto.`
      : `¡Hola! Gracias por escribirnos a ${clinicaNombre}. Ahora mismo estamos fuera de horario de atención — déjanos tu consulta y te contactamos a primera hora.`;

    await sendMetaTextMessage({
      clinicId,
      phoneNumberId: account.phone_number_id,
      to: fromNormalized,
      body: texto,
    });
    await supabaseAdmin
      .from("whatsapp_leads")
      .update({ auto_replied_at: new Date().toISOString() })
      .eq("id", inserted.id);
  } catch (err) {
    // El lead ya quedó guardado — si la auto-respuesta falla, el staff lo ve
    // igual en /whatsapp, solo no recibió el mensaje automático. Reportamos a
    // Sentry porque antes esto era un fallo 100% silencioso (solo
    // console.error, que nadie mira en prod) — captación real perdida sin
    // que nadie se entere. La UI de /whatsapp también marca el lead como
    // "sin auto-respuesta" si pasan varios minutos sin `auto_replied_at`.
    console.error("[whatsapp-webhook] auto-respuesta a lead falló:", (err as Error).message);
    void captureException(err, {
      tags: { boundary: "whatsapp_webhook_lead_auto_reply" },
      extra: { clinicId, leadId: inserted.id },
    });
  }
}

const REFERRAL_CODE_PATTERN = /\b[0-9A-F]{6}\b/g;

/** Busca un código de referido (palabra suelta de 6 hex) en el texto y lo valida contra patients.referral_code de esta clínica. */
async function findReferrerByCode(
  supabaseAdmin: SupabaseAdminClient,
  clinicId: string,
  bodyText: string,
): Promise<string | null> {
  const candidates = [...bodyText.toUpperCase().matchAll(REFERRAL_CODE_PATTERN)].map((m) => m[0]);
  if (candidates.length === 0) return null;

  const { data: patients } = await supabaseAdmin
    .from("patients")
    .select("id, referral_code")
    .eq("clinic_id", clinicId)
    .in("referral_code", candidates);
  return patients?.[0]?.id ?? null;
}
