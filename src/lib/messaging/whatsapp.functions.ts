import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import { throwIfRequiresLlamadaOSuscripcion } from "@/lib/billing.functions";
import { mensajeDb } from "@/lib/db-errors";
import { normalizeToWaMe } from "@/lib/messaging/messaging";
import {
  buildMetaTemplateParams,
  hasMetaTemplateMapping,
  type WhatsAppAccount,
  type WhatsAppAccountStatus,
} from "@/lib/messaging/whatsapp";
import { cifrarCredencial, nuevoPinWhatsApp } from "@/lib/messaging/credenciales-whatsapp.server";
import {
  cuerpoConVariables,
  estadoPlantillaDesdeMeta,
  IDIOMA_META,
  payloadPlantillaMeta,
  PLANTILLAS_META,
  type KindConPlantillaMeta,
} from "@/lib/messaging/meta-plantillas";

type WhatsAppAccountRow = {
  id: string;
  clinic_id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone: string | null;
  status: string;
  quality_rating: string | null;
  connected_at: string;
};

const ACCOUNT_COLUMNS =
  "id, clinic_id, waba_id, phone_number_id, display_phone, status, quality_rating, connected_at";

function mapAccount(row: WhatsAppAccountRow): WhatsAppAccount {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    displayPhone: row.display_phone,
    status: row.status as WhatsAppAccountStatus,
    qualityRating: row.quality_rating,
    connectedAt: row.connected_at,
  };
}

function metaApiVersion(): string {
  return process.env.WHATSAPP_API_VERSION || "v25.0";
}

/**
 * Config de plataforma para el Embedded Signup. El envío usa el token de
 * negocio de cada clínica (ver token-whatsapp.server.ts); acá solo hacen
 * falta el App ID y el App Secret para canjear el código de Meta. Si falta
 * algo, error legible en vez de un 401 críptico de Meta.
 */
function requireMetaAppConfig() {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret || !process.env.WHATSAPP_CREDENTIALS_KEY) {
    throw new Error(
      "WhatsApp no está configurado a nivel de plataforma todavía (falta enrolarse como Tech Provider en Meta). Contacta al equipo de Esmalia.",
    );
  }
  return { appId, appSecret };
}

// Los módulos .server se cargan con import dinámico: este archivo también
// llega al bundle del cliente (las server functions se referencian desde
// las rutas) y el plugin de TanStack Start bloquea imports estáticos de *.server.
async function tokenDeClinica(clinicId: string): Promise<string> {
  const { tokenWhatsAppDeClinica } = await import("@/lib/messaging/token-whatsapp.server");
  return tokenWhatsAppDeClinica(clinicId);
}

/** Error de la Graph API en texto legible, sin volcar el JSON entero. */
async function errorDeMeta(res: Response): Promise<string> {
  const texto = await res.text();
  try {
    const { error } = JSON.parse(texto) as {
      error?: { message?: string; error_user_msg?: string; code?: number };
    };
    return error?.error_user_msg || error?.message || texto;
  } catch {
    return texto;
  }
}

/**
 * Crea en la cuenta de WhatsApp de la clínica las plantillas que usa Esmalia
 * (meta-plantillas.ts) y deja anotado nombre y estado en message_templates.
 * Una plantilla que ya existe en Meta no es error: se toma su estado actual.
 * Nunca tira: devuelve cuántas quedaron registradas, para mostrarlo.
 */
export async function sincronizarPlantillasMeta(params: {
  clinicId: string;
  wabaId: string;
  token: string;
  userId: string;
}): Promise<{ registradas: number; fallidas: string[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const version = metaApiVersion();
  const fallidas: string[] = [];
  let registradas = 0;

  for (const kind of Object.keys(PLANTILLAS_META) as KindConPlantillaMeta[]) {
    const plantilla = PLANTILLAS_META[kind];
    let estado = "pending";
    try {
      const res = await fetch(
        `https://graph.facebook.com/${version}/${params.wabaId}/message_templates`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payloadPlantillaMeta(kind)),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as { status?: string };
        estado = estadoPlantillaDesdeMeta(json.status ?? "PENDING");
      } else {
        // ¿Ya existía? Se consulta su estado en vez de darla por fallida.
        const consulta = await fetch(
          `https://graph.facebook.com/${version}/${params.wabaId}/message_templates?name=${plantilla.nombre}&fields=name,status,language`,
          { headers: { Authorization: `Bearer ${params.token}` } },
        );
        const lista = consulta.ok
          ? ((await consulta.json()) as {
              data?: Array<{ name: string; status: string; language: string }>;
            })
          : { data: [] };
        const existente = lista.data?.find(
          (t) => t.name === plantilla.nombre && t.language === IDIOMA_META,
        );
        if (!existente) {
          fallidas.push(`${plantilla.nombre}: ${await errorDeMeta(res)}`);
          continue;
        }
        estado = estadoPlantillaDesdeMeta(existente.status);
      }

      const meta = {
        meta_template_name: plantilla.nombre,
        meta_language: IDIOMA_META,
        meta_status: estado,
        meta_category: plantilla.categoria.toLowerCase(),
      };
      const { data: filas } = await supabaseAdmin
        .from("message_templates")
        .update(meta)
        .eq("clinic_id", params.clinicId)
        .eq("kind", kind)
        .eq("channel", "whatsapp")
        .select("id");
      if (!filas?.length) {
        // La clínica no tenía plantilla de WhatsApp para este caso: se crea
        // con el mismo texto (sirve también para el envío manual).
        await supabaseAdmin.from("message_templates").insert({
          clinic_id: params.clinicId,
          kind,
          channel: "whatsapp",
          name: plantilla.nombre,
          body: cuerpoConVariables(kind),
          created_by: params.userId,
          ...meta,
        });
      }
      registradas += 1;
    } catch (err) {
      fallidas.push(`${plantilla.nombre}: ${(err as Error).message}`);
    }
  }
  return { registradas, fallidas };
}

const SIN_PERMISOS_LLAMADA =
  "Para conectar WhatsApp oficial primero tienes que agendar la llamada de puesta en marcha o suscribirte.";

/** Estado de conexión de WhatsApp de la clínica. Null = nunca conectó. */
export const getWhatsAppAccountStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<WhatsAppAccount | null> => {
    const { data: row, error } = await context.supabase
      .from("whatsapp_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error)
      throw new Error(mensajeDb(error, "No pudimos obtener el estado de la conexión de WhatsApp."));
    return row ? mapAccount(row as WhatsAppAccountRow) : null;
  });

/**
 * Completa el Embedded Signup: recibe el `code` que devuelve el popup de
 * Meta (FB.login callback) más el waba_id/phone_number_id que llegan por
 * postMessage del evento WA_EMBEDDED_SIGNUP, y:
 *   1. Intercambia el code por un token de negocio (confirma que el signup
 *      es legítimo, no solo que el frontend dice que sí).
 *   2. Registra el número para Cloud API (`POST /{phone_number_id}/register`).
 *   3. Suscribe la app al WABA para recibir webhooks
 *      (`POST /{waba_id}/subscribed_apps`).
 *   4. Upsert en whatsapp_accounts.
 * El token de negocio de la clínica queda cifrado en whatsapp_credentials.
 */
export const completeWhatsAppEmbeddedSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        code: z.string().min(1),
        wabaId: z.string().min(1),
        phoneNumberId: z.string().min(1),
        displayPhone: z.string().trim().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<WhatsAppAccount> => {
    await assertNotDemoClinic(context.supabase, data.clinicId);
    await throwIfRequiresLlamadaOSuscripcion(context.supabase, data.clinicId, SIN_PERMISOS_LLAMADA);
    const { appId, appSecret } = requireMetaAppConfig();
    const version = metaApiVersion();

    // 1) Canje del código por el token de negocio de la clínica (vive 30 s:
    // por eso el canje es lo primero). Con ese token se hace todo lo demás.
    const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", data.code);
    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) {
      throw new Error(`No pudimos verificar la conexión con Meta. ${await errorDeMeta(tokenRes)}`);
    }
    const { access_token: businessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!businessToken) throw new Error("Meta no devolvió el acceso a tu cuenta de WhatsApp.");

    // 2) Suscribir la app al WABA para recibir estados y mensajes entrantes.
    const subscribeRes = await fetch(
      `https://graph.facebook.com/${version}/${data.wabaId}/subscribed_apps`,
      { method: "POST", headers: { Authorization: `Bearer ${businessToken}` } },
    );
    if (!subscribeRes.ok) {
      throw new Error(
        `No pudimos suscribir el webhook de tu cuenta. ${await errorDeMeta(subscribeRes)}`,
      );
    }

    // 3) Registrar el número para Cloud API con un PIN propio de la clínica.
    const { cifrarCredencial, nuevoPinWhatsApp } =
      await import("@/lib/messaging/credenciales-whatsapp.server");
    const pin = nuevoPinWhatsApp();
    const registerRes = await fetch(
      `https://graph.facebook.com/${version}/${data.phoneNumberId}/register`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${businessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      },
    );
    if (!registerRes.ok) {
      throw new Error(
        `No pudimos registrar el número en WhatsApp. ${await errorDeMeta(registerRes)}`,
      );
    }

    // 3b) Credenciales cifradas, solo legibles por el servidor.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: credErr } = await supabaseAdmin.from("whatsapp_credentials").upsert(
      {
        clinic_id: data.clinicId,
        waba_id: data.wabaId,
        business_token_enc: cifrarCredencial(businessToken),
        registration_pin_enc: cifrarCredencial(pin),
      },
      { onConflict: "clinic_id" },
    );
    if (credErr) throw new Error("No pudimos guardar el acceso a WhatsApp. " + credErr.message);

    // 4) Upsert. UNIQUE(clinic_id) hace que una reconexión reemplace la fila
    // anterior en vez de duplicar.
    const { data: row, error } = await context.supabase
      .from("whatsapp_accounts")
      .upsert(
        {
          clinic_id: data.clinicId,
          waba_id: data.wabaId,
          phone_number_id: data.phoneNumberId,
          display_phone: data.displayPhone ?? null,
          status: "connected",
        },
        { onConflict: "clinic_id" },
      )
      .select(ACCOUNT_COLUMNS)
      .single();
    if (error) throw new Error("No pudimos guardar la conexión. " + error.message);

    // 5) Plantillas en la cuenta de la clínica. Si alguna falla, la conexión
    // igual queda hecha: se reintenta desde /whatsapp.
    await sincronizarPlantillasMeta({
      clinicId: data.clinicId,
      wabaId: data.wabaId,
      token: businessToken,
      userId: context.userId,
    });

    return mapAccount(row as WhatsAppAccountRow);
  });

/** Vuelve a crear o consultar las plantillas en Meta (botón en /whatsapp). */
export const resincronizarPlantillasWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertNotDemoClinic(context.supabase, data.clinicId);
    // Solo quien puede ver la conexión (RLS de whatsapp_accounts) llega acá.
    const { data: account, error } = await context.supabase
      .from("whatsapp_accounts")
      .select("waba_id, status")
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos consultar tu conexión de WhatsApp."));
    if (!account || account.status !== "connected") {
      throw new Error("Primero conecta el número de WhatsApp de tu clínica.");
    }
    const token = await tokenDeClinica(data.clinicId);
    return sincronizarPlantillasMeta({
      clinicId: data.clinicId,
      wabaId: account.waba_id,
      token,
      userId: context.userId,
    });
  });

/** Desconecta el número (soft: status='disabled', no borra la fila — mantiene auditoría). */
export const disconnectWhatsAppAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<void> => {
    const { error } = await context.supabase
      .from("whatsapp_accounts")
      .update({ status: "disabled" })
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos desconectar el número de WhatsApp."));
  });

export interface MetaSendResult {
  wamid: string;
}

/**
 * Envío de bajo nivel contra la Cloud API. NO es un createServerFn — es un
 * helper que llaman otras server functions (sendWhatsAppFromTemplate en
 * messaging.functions.ts) para el paso "mandar de verdad" cuando hay WABA
 * conectado y plantilla aprobada. Si cualquiera de esas condiciones falta,
 * el caller decide caer a wa.me — esta función solo sabe hablar con Meta.
 */
export async function sendMetaTemplateMessage(params: {
  clinicId: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  templateLanguage: string;
  bodyParams: string[];
}): Promise<MetaSendResult> {
  const token = await tokenDeClinica(params.clinicId);
  const version = metaApiVersion();

  const res = await fetch(
    `https://graph.facebook.com/${version}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.templateLanguage },
          components: [
            {
              type: "body",
              parameters: params.bodyParams.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta rechazó el envío: ${body}`);
  }

  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  const wamid = json.messages?.[0]?.id;
  if (!wamid) throw new Error("Meta no devolvió un id de mensaje.");
  return { wamid };
}

export interface MetaTemplateSendAttempt {
  /** true si se mandó de verdad por la Cloud API. false = hay que caer a wa.me. */
  viaApi: boolean;
  externalId: string | null;
}

/**
 * Intento de envío real, compartido por todo caller que ya resolvió un
 * template (sendWhatsAppFromTemplate en messaging.functions.ts,
 * generatePortalLink en portal.functions.ts — Fase 2). Nunca tira: si algo
 * falla o falta (sin WABA conectado, plantilla no aprobada, kind sin mapeo
 * de parámetros), devuelve `viaApi: false` para que el caller caiga a wa.me.
 */
export async function tryMetaTemplateSend(params: {
  supabase: SupabaseClient<Database>;
  clinicId: string;
  templateKind: string;
  metaTemplate: { name: string; language: string } | null;
  recipientRaw: string;
  variables: Record<string, string>;
}): Promise<MetaTemplateSendAttempt> {
  if (!params.metaTemplate || !hasMetaTemplateMapping(params.templateKind)) {
    return { viaApi: false, externalId: null };
  }
  try {
    const { data: account } = await params.supabase
      .from("whatsapp_accounts")
      .select("phone_number_id, status")
      .eq("clinic_id", params.clinicId)
      .eq("status", "connected")
      .maybeSingle();
    const to = normalizeToWaMe(params.recipientRaw);
    if (!account || !to) return { viaApi: false, externalId: null };

    const bodyParams = buildMetaTemplateParams(params.templateKind, params.variables);
    const sent = await sendMetaTemplateMessage({
      clinicId: params.clinicId,
      phoneNumberId: account.phone_number_id,
      to,
      templateName: params.metaTemplate.name,
      templateLanguage: params.metaTemplate.language,
      bodyParams,
    });
    return { viaApi: true, externalId: sent.wamid };
  } catch (apiErr) {
    console.error("[whatsapp] envío por API falló, cae a wa.me:", (apiErr as Error).message);
    return { viaApi: false, externalId: null };
  }
}

/**
 * Texto libre (sin plantilla) — SOLO válido dentro de la ventana de servicio
 * de 24h que abre el propio cliente al escribir primero (regla de Meta: la
 * clínica puede responder lo que quiera mientras esa ventana esté abierta,
 * sin necesidad de plantilla aprobada). Usado por el webhook (Fase 3) para
 * la auto-respuesta a un desconocido que acaba de escribir — nunca para
 * abrir una conversación de la nada, eso siempre necesita plantilla.
 */
export async function sendMetaTextMessage(params: {
  clinicId: string;
  phoneNumberId: string;
  to: string;
  body: string;
}): Promise<MetaSendResult> {
  const token = await tokenDeClinica(params.clinicId);
  const version = metaApiVersion();

  const res = await fetch(
    `https://graph.facebook.com/${version}/${params.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "text",
        text: { body: params.body },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta rechazó el envío: ${body}`);
  }

  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  const wamid = json.messages?.[0]?.id;
  if (!wamid) throw new Error("Meta no devolvió un id de mensaje.");
  return { wamid };
}

export interface WhatsAppLead {
  id: string;
  phone: string;
  name: string | null;
  firstMessage: string;
  status: "new" | "contacted" | "converted" | "discarded";
  createdAt: string;
  /**
   * Cuándo el webhook logró mandar la auto-respuesta (Fase 3). Null si
   * todavía no se intentó, o si `sendMetaTextMessage` falló — en ese segundo
   * caso ya no vuelve a reintentarse solo, así que la UI usa esto para
   * avisar al staff (ver `LeadsSection` en whatsapp.tsx).
   */
  autoRepliedAt: string | null;
  /** Nombre del paciente que lo refirió (Fase 4), si el webhook detectó un código válido en el primer mensaje. */
  referredByName: string | null;
}

type WhatsAppLeadRow = {
  id: string;
  phone: string;
  name: string | null;
  first_message: string;
  status: string;
  created_at: string;
  auto_replied_at: string | null;
  referred_by_patient_id: string | null;
};

function mapLead(row: WhatsAppLeadRow, referredByName: string | null): WhatsAppLead {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    firstMessage: row.first_message,
    status: row.status as WhatsAppLead["status"],
    createdAt: row.created_at,
    autoRepliedAt: row.auto_replied_at,
    referredByName,
  };
}

/** Leads nuevos (desconocidos que escribieron y todavía nadie los gestionó). */
export const listWhatsAppLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<WhatsAppLead[]> => {
    const { data: rows, error } = await context.supabase
      .from("whatsapp_leads")
      .select(
        "id, phone, name, first_message, status, created_at, auto_replied_at, referred_by_patient_id",
      )
      .eq("clinic_id", data.clinicId)
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los leads de WhatsApp."));

    const referrerIds = [
      ...new Set(
        (rows ?? []).map((r) => r.referred_by_patient_id).filter((id): id is string => !!id),
      ),
    ];
    const { data: referrers } =
      referrerIds.length === 0
        ? { data: [] }
        : await context.supabase
            .from("patients")
            .select("id, full_name")
            .eq("clinic_id", data.clinicId)
            .in("id", referrerIds);
    const nameById = new Map((referrers ?? []).map((p) => [p.id, p.full_name]));

    return (rows ?? []).map((r) =>
      mapLead(
        r as WhatsAppLeadRow,
        r.referred_by_patient_id ? (nameById.get(r.referred_by_patient_id) ?? null) : null,
      ),
    );
  });

/** Marca un lead como contactado/convertido/descartado — nunca se borra, queda como historial. */
export const updateWhatsAppLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        id: z.string().uuid(),
        status: z.enum(["contacted", "converted", "discarded"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const { error } = await context.supabase
      .from("whatsapp_leads")
      .update({ status: data.status })
      .eq("clinic_id", data.clinicId)
      .eq("id", data.id);
    if (error) throw new Error(mensajeDb(error, "No pudimos actualizar el estado del lead."));
  });
