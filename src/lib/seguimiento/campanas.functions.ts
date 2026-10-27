/**
 * Plantillas de mensajes (CRM-03), campañas (CRM-04) y medición de quién
 * volvió (CRM-05). Ola 8 · frente B.
 *
 * Permisos: plantillas las leen owner, admin, dentist y reception y las
 * escriben owner y admin; campañas, solo owner y admin. Lo exige la RLS
 * (estas funciones corren con el cliente del usuario); la pantalla repite el
 * gate con `settings:manage`.
 *
 * Correo: sale desde el servidor por tandas (`enviarTandaDeCampana`), con modo
 * de prueba, baja y tutor; idempotente por la clave única campaña + paciente y
 * el reclamo atómico de la base.
 * WhatsApp: nada sale solo. La campaña arma una cola y cada mensaje lo abre
 * una persona con wa.me (`abrirWhatsAppDeCampana`); ningún cron la toca y la
 * base rechaza marcar "abierto" sin un usuario.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotDemoClinic } from "@/lib/access/clinic-guards.server";
import { appOrigin } from "@/lib/app-origin.server";
import { mensajeDb } from "@/lib/db-errors";
import { bajaDisponible, firmarTokenDeBaja, urlPaginaDeBaja } from "@/lib/email/baja-token.server";
import { motivoParaNoEnviarWhatsApp } from "@/lib/messaging/baja-whatsapp";
import { sendEmail } from "@/lib/messaging/email.server";
import { loadEmailSandboxConfig } from "@/lib/messaging/messaging.functions";
import { buildWaMeUrl, mensajeTelefonoInvalido, normalizeToWaMe } from "@/lib/messaging/telefonos";
import { leerTodasLasPaginas } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  describirSegmento,
  ETIQUETA_OMISION,
  fueContactado,
  resumirElegibilidad,
  SegmentoCampanaSchema,
  TANDA_DE_CORREO,
  type CanalDeCampana,
  type EstadoDeCampana,
  type EstadoDeDestinatario,
  type ResumenDestinatarios,
  type SegmentoCampana,
} from "@/lib/seguimiento/campanas";
import { excedeTope, resolverDestinatarios } from "@/lib/seguimiento/campanas.server";
import { enviarTandaDeCorreo, type ResumenDeTanda } from "@/lib/seguimiento/envio-campana";
import {
  analizarMensaje,
  CANALES_DE_PLANTILLA,
  renderMensaje,
  valoresParaPaciente,
  type CanalDePlantilla,
} from "@/lib/seguimiento/plantillas";
import { medirRetorno, type ResultadoRetorno } from "@/lib/seguimiento/retorno";
import {
  clinicaDeSeguimiento,
  generadorDeLinkDeReserva,
} from "@/lib/seguimiento/seguimiento.server";

// ─── CRM-03 · Plantillas ─────────────────────────────────────────────────────

export interface PlantillaDeMensaje {
  id: string;
  name: string;
  channel: CanalDePlantilla;
  subject: string | null;
  body: string;
  active: boolean;
  updatedAt: string;
}

export const listPlantillasDeMensaje = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PlantillaDeMensaje[]> => {
    const { data: filas, error } = await context.supabase
      .from("outreach_templates")
      .select("id, name, channel, subject, body, active, updated_at")
      .eq("clinic_id", data.clinicId)
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(200);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las plantillas."));
    return (filas ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      channel: f.channel as CanalDePlantilla,
      subject: f.subject,
      body: f.body,
      active: f.active,
      updatedAt: f.updated_at,
    }));
  });

const PlantillaInput = z
  .object({
    clinicId: z.string().uuid(),
    id: z.string().uuid().nullable().default(null),
    nombre: z.string().trim().min(2, "Ponle un nombre a la plantilla.").max(80),
    canal: z.enum(CANALES_DE_PLANTILLA),
    asunto: z.string().trim().max(150).nullable().default(null),
    cuerpo: z.string().trim().min(2, "Escribe el texto del mensaje.").max(2000),
    activa: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.canal === "correo" && (!v.asunto || v.asunto.length < 2)) {
      ctx.addIssue({ code: "custom", message: "Un correo necesita asunto.", path: ["asunto"] });
    }
    const analisis = analizarMensaje(v.cuerpo, v.canal === "correo" ? v.asunto : null);
    for (const p of analisis.problemas) ctx.addIssue({ code: "custom", message: p });
  });

export const guardarPlantillaDeMensaje = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => PlantillaInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    const valores = {
      name: data.nombre,
      channel: data.canal,
      subject: data.canal === "correo" ? data.asunto : null,
      body: data.cuerpo,
      active: data.activa,
    };
    if (data.id) {
      const { data: fila, error } = await supabase
        .from("outreach_templates")
        .update(valores)
        .eq("id", data.id)
        .eq("clinic_id", data.clinicId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(mensajeDb(error, "No pudimos guardar la plantilla."));
      if (!fila) throw new Error("No tienes permisos para editar plantillas.");
      return { id: fila.id };
    }
    const { data: fila, error } = await supabase
      .from("outreach_templates")
      .insert({ ...valores, clinic_id: data.clinicId, created_by: userId })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDb(error, "No pudimos crear la plantilla."));
    return { id: fila.id };
  });

// ─── CRM-04 · Campañas ───────────────────────────────────────────────────────

export interface ConteoDeDestinatarios {
  pendiente: number;
  enviando: number;
  enviado: number;
  fallido: number;
  omitido: number;
  abierto: number;
}

export interface Campana {
  id: string;
  name: string;
  channel: CanalDeCampana;
  subject: string | null;
  body: string;
  segment: SegmentoCampana | null;
  segmentLabel: string | null;
  status: EstadoDeCampana;
  recipientsCount: number;
  confirmedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  conteo: ConteoDeDestinatarios;
}

const CONTEO_VACIO: ConteoDeDestinatarios = {
  pendiente: 0,
  enviando: 0,
  enviado: 0,
  fallido: 0,
  omitido: 0,
  abierto: 0,
};

function segmentoDe(json: Json): SegmentoCampana | null {
  const r = SegmentoCampanaSchema.safeParse(json);
  return r.success ? r.data : null;
}

export const listCampanas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Campana[]> => {
    const { supabase } = context;
    const { data: filas, error } = await supabase
      .from("outreach_campaigns")
      .select(
        "id, name, channel, subject, body, segment, segment_label, status, recipients_count, confirmed_at, finished_at, created_at",
      )
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las campañas."));
    const ids = (filas ?? []).map((f) => f.id);
    const conteos = new Map<string, ConteoDeDestinatarios>();
    if (ids.length) {
      const { filas: dest, error: errDest } = await leerTodasLasPaginas((d, h) =>
        supabase
          .from("outreach_campaign_recipients")
          .select("id, campaign_id, status")
          .eq("clinic_id", data.clinicId)
          .in("campaign_id", ids)
          .order("id", { ascending: true })
          .range(d, h),
      );
      if (errDest) throw new Error(mensajeDb(errDest, "No pudimos contar los destinatarios."));
      for (const r of dest) {
        const c = conteos.get(r.campaign_id) ?? { ...CONTEO_VACIO };
        c[r.status as EstadoDeDestinatario] += 1;
        conteos.set(r.campaign_id, c);
      }
    }
    return (filas ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      channel: f.channel as CanalDeCampana,
      subject: f.subject,
      body: f.body,
      segment: segmentoDe(f.segment),
      segmentLabel: f.segment_label,
      status: f.status as EstadoDeCampana,
      recipientsCount: f.recipients_count,
      confirmedAt: f.confirmed_at,
      finishedAt: f.finished_at,
      createdAt: f.created_at,
      conteo: conteos.get(f.id) ?? { ...CONTEO_VACIO },
    }));
  });

export interface DestinatarioDeCampana {
  id: string;
  patientId: string;
  patientName: string;
  destination: string;
  recipientFor: "paciente" | "tutor";
  status: EstadoDeDestinatario;
  reason: string | null;
  processedAt: string | null;
}

export const listDestinatariosDeCampana = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), campaignId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DestinatarioDeCampana[]> => {
    const { supabase } = context;
    const { filas, error } = await leerTodasLasPaginas((d, h) =>
      supabase
        .from("outreach_campaign_recipients")
        .select("id, patient_id, destination, recipient_for, status, reason, processed_at")
        .eq("clinic_id", data.clinicId)
        .eq("campaign_id", data.campaignId)
        .order("id", { ascending: true })
        .range(d, h),
    );
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los destinatarios."));
    const ids = [...new Set(filas.map((f) => f.patient_id))];
    const nombres = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: ps } = await supabase
        .from("patients")
        .select("id, full_name")
        .eq("clinic_id", data.clinicId)
        .in("id", ids.slice(i, i + 200));
      for (const p of ps ?? []) nombres.set(p.id, p.full_name);
    }
    return filas
      .map((f) => ({
        id: f.id,
        patientId: f.patient_id,
        patientName: nombres.get(f.patient_id) ?? "Paciente",
        destination: f.destination,
        recipientFor: f.recipient_for as "paciente" | "tutor",
        status: f.status as EstadoDeDestinatario,
        reason: f.reason,
        processedAt: f.processed_at,
      }))
      .sort((a, b) => a.patientName.localeCompare(b.patientName, "es"));
  });

const CampanaInput = z
  .object({
    clinicId: z.string().uuid(),
    id: z.string().uuid().nullable().default(null),
    nombre: z.string().trim().min(2, "Ponle un nombre a la campaña.").max(120),
    canal: z.enum(["correo", "whatsapp"]),
    plantillaId: z.string().uuid().nullable().default(null),
    asunto: z.string().trim().max(150).nullable().default(null),
    cuerpo: z.string().trim().min(2, "Escribe el mensaje.").max(2000),
    segmento: SegmentoCampanaSchema,
  })
  .superRefine((v, ctx) => {
    if (v.canal === "correo" && (!v.asunto || v.asunto.length < 2)) {
      ctx.addIssue({ code: "custom", message: "Un correo necesita asunto.", path: ["asunto"] });
    }
    const analisis = analizarMensaje(v.cuerpo, v.canal === "correo" ? v.asunto : null);
    for (const p of analisis.problemas) ctx.addIssue({ code: "custom", message: p });
  });

/** Crea o actualiza el borrador. Una campaña confirmada ya no se edita (lo frena la base). */
export const guardarBorradorDeCampana = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => CampanaInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    const valores = {
      name: data.nombre,
      channel: data.canal,
      template_id: data.plantillaId,
      subject: data.canal === "correo" ? data.asunto : null,
      body: data.cuerpo,
      segment: data.segmento as unknown as Json,
      segment_label: describirSegmento(data.segmento),
    };
    if (data.id) {
      const { data: fila, error } = await supabase
        .from("outreach_campaigns")
        .update(valores)
        .eq("id", data.id)
        .eq("clinic_id", data.clinicId)
        .eq("status", "borrador")
        .select("id")
        .maybeSingle();
      if (error) throw new Error(mensajeDb(error, "No pudimos guardar la campaña."));
      if (!fila) throw new Error("Solo se edita una campaña en borrador.");
      return { id: fila.id };
    }
    const { data: fila, error } = await supabase
      .from("outreach_campaigns")
      .insert({ ...valores, clinic_id: data.clinicId, created_by: userId, status: "borrador" })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDb(error, "No pudimos crear la campaña."));
    return { id: fila.id };
  });

export interface VistaPreviaDeCampana {
  resumen: ResumenDestinatarios;
  /** Etiquetas legibles de los motivos de omisión, con su cifra. */
  omitidos: { motivo: string; cantidad: number }[];
  /** Primeros destinatarios, para revisar. */
  muestra: { nombre: string; destino: string; para: "paciente" | "tutor" }[];
  /** El mensaje como lo verá el primer destinatario. */
  ejemplo: { asunto: string | null; cuerpo: string } | null;
  descripcion: string;
  tope: string | null;
}

async function vistaPrevia(
  supabase: Parameters<typeof resolverDestinatarios>[0],
  args: {
    clinicId: string;
    userId: string;
    canal: CanalDeCampana;
    segmento: SegmentoCampana;
    asunto: string | null;
    cuerpo: string;
  },
) {
  const clinica = await clinicaDeSeguimiento(supabase, args.clinicId);
  const evaluados = await resolverDestinatarios(supabase, {
    clinicId: args.clinicId,
    userId: args.userId,
    segmento: args.segmento,
    canal: args.canal,
    hoy: clinica.hoy,
    pais: clinica.pais,
  });
  return { clinica, evaluados };
}

export const previsualizarCampana = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        canal: z.enum(["correo", "whatsapp"]),
        segmento: SegmentoCampanaSchema,
        asunto: z.string().max(150).nullable().default(null),
        cuerpo: z.string().max(2000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<VistaPreviaDeCampana> => {
    const { clinica, evaluados } = await vistaPrevia(context.supabase, {
      ...data,
      userId: context.userId,
    });
    const resumen = resumirElegibilidad(evaluados);
    const elegibles = evaluados.filter((e) => e.elegibilidad.ok);
    const primero = elegibles[0];
    const linkDe = await generadorDeLinkDeReserva(context.supabase, data.clinicId);
    const valores = primero
      ? valoresParaPaciente({
          paciente: primero.paciente.nombre,
          clinica: clinica.nombre,
          telefonoClinica: clinica.telefono,
          linkReserva: linkDe ? linkDe(primero.paciente.id) : null,
        })
      : null;
    return {
      resumen,
      omitidos: Object.entries(resumen.omitidos).map(([m, n]) => ({
        motivo: ETIQUETA_OMISION[m as keyof typeof ETIQUETA_OMISION],
        cantidad: n ?? 0,
      })),
      muestra: elegibles.slice(0, 8).map((e) => ({
        nombre: e.paciente.nombre,
        destino: e.elegibilidad.ok ? e.elegibilidad.destino : "",
        para: e.elegibilidad.ok ? e.elegibilidad.para : "paciente",
      })),
      ejemplo:
        valores && data.cuerpo.trim()
          ? {
              asunto:
                data.canal === "correo" && data.asunto
                  ? renderMensaje(data.asunto, valores).replace(/\s+/g, " ").trim()
                  : null,
              cuerpo: renderMensaje(data.cuerpo, valores),
            }
          : null,
      descripcion: describirSegmento(data.segmento),
      tope: excedeTope(resumen.elegibles),
    };
  });

/**
 * Confirma la campaña: vuelve a calcular el grupo (lo que se vio es lo que
 * sale), exige que la cifra coincida con la que se mostró, registra los
 * destinatarios (uno por paciente, sin duplicar) y la pasa a "en curso".
 * No envía nada: el correo sale con `enviarTandaDeCampana` y WhatsApp se
 * despacha a mano.
 */
export const confirmarCampana = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        campaignId: z.string().uuid(),
        /** La cifra de destinatarios que vio quien confirma. */
        esperados: z.number().int().min(1),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<
      { ok: true; destinatarios: number } | { ok: false; destinatarios: number; motivo: string }
    > => {
      const { supabase } = context;
      await assertNotDemoClinic(supabase, data.clinicId);
      const { data: campana, error } = await supabase
        .from("outreach_campaigns")
        .select("id, channel, subject, body, segment, status")
        .eq("id", data.campaignId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      if (error) throw new Error(mensajeDb(error, "No pudimos cargar la campaña."));
      if (!campana) throw new Error("No tienes permisos para confirmar campañas.");
      if (campana.status !== "borrador") throw new Error("Esta campaña ya fue confirmada.");
      const segmento = segmentoDe(campana.segment);
      if (!segmento) throw new Error("El grupo de pacientes de la campaña no es válido.");

      const { evaluados } = await vistaPrevia(supabase, {
        clinicId: data.clinicId,
        userId: context.userId,
        canal: campana.channel as CanalDeCampana,
        segmento,
        asunto: campana.subject,
        cuerpo: campana.body,
      });
      const elegibles = evaluados.filter((e) => e.elegibilidad.ok);
      const tope = excedeTope(elegibles.length);
      if (tope) throw new Error(tope);
      if (elegibles.length === 0) throw new Error("La campaña no tiene a quién escribirle.");
      if (elegibles.length !== data.esperados) {
        return {
          ok: false,
          destinatarios: elegibles.length,
          motivo: `El grupo cambió desde la vista previa: ahora son ${elegibles.length} destinatarios. Revisa y vuelve a confirmar.`,
        };
      }

      const filas = elegibles.map((e) => ({
        clinic_id: data.clinicId,
        campaign_id: data.campaignId,
        patient_id: e.paciente.id,
        channel: campana.channel,
        destination: e.elegibilidad.ok ? e.elegibilidad.destino : "",
        recipient_for: e.elegibilidad.ok ? e.elegibilidad.para : "paciente",
      }));
      for (let i = 0; i < filas.length; i += 500) {
        // Clave única campaña + paciente: confirmar dos veces no duplica.
        const { error: errIns } = await supabase
          .from("outreach_campaign_recipients")
          .upsert(filas.slice(i, i + 500), {
            onConflict: "campaign_id,patient_id",
            ignoreDuplicates: true,
          });
        if (errIns) throw new Error(mensajeDb(errIns, "No pudimos registrar los destinatarios."));
      }
      const { count } = await supabase
        .from("outreach_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", data.campaignId);
      const { error: errUpd } = await supabase
        .from("outreach_campaigns")
        .update({ status: "confirmada", recipients_count: count ?? elegibles.length })
        .eq("id", data.campaignId)
        .eq("clinic_id", data.clinicId)
        .eq("status", "borrador");
      if (errUpd) throw new Error(mensajeDb(errUpd, "No pudimos confirmar la campaña."));
      return { ok: true, destinatarios: count ?? elegibles.length };
    },
  );

/**
 * Envía una tanda de una campaña por correo (hasta `TANDA_DE_CORREO`). La
 * pantalla la llama en bucle mostrando el avance; cuando no queda nada
 * pendiente, la campaña se marca terminada.
 */
export const enviarTandaDeCampana = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), campaignId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ResumenDeTanda & { terminada: boolean }> => {
    const { supabase, userId } = context;
    await assertNotDemoClinic(supabase, data.clinicId);
    const { data: campana, error } = await supabase
      .from("outreach_campaigns")
      .select("id, channel, subject, body, status")
      .eq("id", data.campaignId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la campaña."));
    if (!campana) throw new Error("No tienes permisos para enviar campañas.");
    if (campana.status !== "confirmada") throw new Error("La campaña no está en curso.");

    const [clinica, sandbox, linkDe] = await Promise.all([
      clinicaDeSeguimiento(supabase, data.clinicId),
      loadEmailSandboxConfig(supabase, data.clinicId),
      generadorDeLinkDeReserva(supabase, data.clinicId),
    ]);
    const puedeBaja = bajaDisponible();

    const resumen = await enviarTandaDeCorreo(
      {
        canal: campana.channel as CanalDeCampana,
        clinica: clinica.nombre,
        appUrl: appOrigin(),
        asunto: campana.subject ?? "",
        cuerpo: campana.body,
        valoresBase: (paciente, patientId) =>
          valoresParaPaciente({
            paciente,
            clinica: clinica.nombre,
            telefonoClinica: clinica.telefono,
            linkReserva: linkDe ? linkDe(patientId) : null,
          }),
        reclamar: async (limite) => {
          const { data: filas, error: errRec } = await supabase.rpc("reclamar_envios_de_campana", {
            p_campaign_id: data.campaignId,
            p_limite: limite,
          });
          if (errRec) throw new Error(mensajeDb(errRec, "No pudimos tomar los destinatarios."));
          return (filas ?? []).map((f) => ({
            id: f.id,
            patientId: f.patient_id,
            destination: f.destination,
          }));
        },
        paciente: async (patientId) => {
          const { data: p } = await supabase
            .from("patients")
            .select("full_name, email_opt_out_at, archived_at")
            .eq("clinic_id", data.clinicId)
            .eq("id", patientId)
            .maybeSingle();
          return p
            ? { nombre: p.full_name, emailOptOutAt: p.email_opt_out_at, archivado: !!p.archived_at }
            : null;
        },
        enlaceDeBaja: async (patientId) =>
          puedeBaja
            ? urlPaginaDeBaja(appOrigin(), await firmarTokenDeBaja(patientId, "correos_paciente"))
            : null,
        enviar: async (correo) => {
          const r = await sendEmail(correo, sandbox);
          return r.ok ? { ok: true, externalId: r.externalId } : { ok: false, reason: r.reason };
        },
        registrar: async (m) => {
          const ahora = new Date().toISOString();
          const { data: fila } = await supabase
            .from("messages")
            .insert({
              clinic_id: data.clinicId,
              patient_id: m.patientId,
              template_kind: "custom",
              channel: "email",
              direction: "outbound",
              status: m.resultado.ok ? "sent" : "failed",
              recipient: m.destino,
              body: m.html,
              external_id: m.resultado.ok ? m.resultado.externalId : null,
              error: m.resultado.ok ? null : m.resultado.reason,
              sent_at: m.resultado.ok ? ahora : null,
              sent_by: userId,
            })
            .select("id")
            .maybeSingle();
          return fila?.id ?? null;
        },
        marcar: async (id, cambio) => {
          const { error: errMarca } = await supabase
            .from("outreach_campaign_recipients")
            .update({
              status: cambio.status,
              reason: cambio.reason,
              message_id: cambio.messageId,
            })
            .eq("id", id)
            .eq("clinic_id", data.clinicId);
          if (errMarca) throw new Error(mensajeDb(errMarca, "No pudimos registrar el envío."));
        },
      },
      TANDA_DE_CORREO,
    );

    let terminada = false;
    if (!resumen.quedan) {
      const { count } = await supabase
        .from("outreach_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", data.campaignId)
        .in("status", ["pendiente", "enviando"]);
      if ((count ?? 0) === 0) {
        await supabase
          .from("outreach_campaigns")
          .update({ status: "terminada" })
          .eq("id", data.campaignId)
          .eq("clinic_id", data.clinicId)
          .eq("status", "confirmada");
        terminada = true;
      }
    }
    return { ...resumen, terminada };
  });

/**
 * WhatsApp asistido: arma el mensaje de UN destinatario, lo registra en el
 * historial y devuelve el link wa.me para que la persona lo mande desde su
 * WhatsApp. Respeta la baja y el consentimiento al momento de abrirlo.
 */
export const abrirWhatsAppDeCampana = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), recipientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ waUrl: string }> => {
    const { supabase, userId } = context;
    await assertNotDemoClinic(supabase, data.clinicId);
    const { data: dest, error } = await supabase
      .from("outreach_campaign_recipients")
      .select("id, campaign_id, patient_id, destination, status, channel")
      .eq("id", data.recipientId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el destinatario."));
    if (!dest) throw new Error("No tienes permisos para despachar esta campaña.");
    if (dest.channel !== "whatsapp") throw new Error("Este destinatario no es de WhatsApp.");
    if (dest.status !== "pendiente" && dest.status !== "abierto") {
      throw new Error("Este destinatario ya no está en la cola.");
    }
    const [{ data: campana }, { data: paciente }, clinica, linkDe] = await Promise.all([
      supabase
        .from("outreach_campaigns")
        .select("body, status")
        .eq("id", dest.campaign_id)
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
      supabase
        .from("patients")
        .select("full_name, wa_opt_in, wa_opt_out_at")
        .eq("id", dest.patient_id)
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
      clinicaDeSeguimiento(supabase, data.clinicId),
      generadorDeLinkDeReserva(supabase, data.clinicId),
    ]);
    if (!campana || campana.status !== "confirmada")
      throw new Error("La campaña no está en curso.");
    if (!paciente) throw new Error("Paciente no encontrado.");

    const bloqueo =
      motivoParaNoEnviarWhatsApp({ waOptOutAt: paciente.wa_opt_out_at, tipo: "proactivo" }) ??
      (paciente.wa_opt_in
        ? null
        : "El paciente no aceptó recibir mensajes de WhatsApp de la clínica.");
    if (bloqueo) {
      if (dest.status === "pendiente") {
        await supabase
          .from("outreach_campaign_recipients")
          .update({ status: "omitido", reason: bloqueo.slice(0, 500) })
          .eq("id", dest.id)
          .eq("clinic_id", data.clinicId);
      }
      throw new Error(bloqueo);
    }
    if (!normalizeToWaMe(dest.destination, clinica.pais)) {
      throw new Error(mensajeTelefonoInvalido(dest.destination, clinica.pais));
    }

    const cuerpo = renderMensaje(
      campana.body,
      valoresParaPaciente({
        paciente: paciente.full_name,
        clinica: clinica.nombre,
        telefonoClinica: clinica.telefono,
        linkReserva: linkDe ? linkDe(dest.patient_id) : null,
      }),
    );
    const { data: mensaje, error: errMsg } = await supabase
      .from("messages")
      .insert({
        clinic_id: data.clinicId,
        patient_id: dest.patient_id,
        template_kind: "custom",
        channel: "whatsapp",
        direction: "outbound",
        // "queued": abrir el link no garantiza que la persona tocó Enviar.
        status: "queued",
        recipient: dest.destination,
        body: cuerpo,
        sent_by: userId,
      })
      .select("id")
      .single();
    if (errMsg) throw new Error(mensajeDb(errMsg, "No pudimos registrar el mensaje."));
    const { error: errUpd } = await supabase
      .from("outreach_campaign_recipients")
      .update({ status: "abierto", message_id: mensaje.id })
      .eq("id", dest.id)
      .eq("clinic_id", data.clinicId);
    if (errUpd) throw new Error(mensajeDb(errUpd, "No pudimos marcar el envío."));
    const waUrl = buildWaMeUrl(dest.destination, cuerpo, clinica.pais);
    if (!waUrl) throw new Error(mensajeTelefonoInvalido(dest.destination, clinica.pais));
    return { waUrl };
  });

export const omitirDestinatario = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        recipientId: z.string().uuid(),
        motivo: z.string().trim().max(300).default("Omitido a mano"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: fila, error } = await context.supabase
      .from("outreach_campaign_recipients")
      .update({ status: "omitido", reason: data.motivo || "Omitido a mano" })
      .eq("id", data.recipientId)
      .eq("clinic_id", data.clinicId)
      .eq("status", "pendiente")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos omitir el destinatario."));
    if (!fila) throw new Error("El destinatario ya no está pendiente.");
    return { ok: true };
  });

export const cerrarCampana = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        campaignId: z.string().uuid(),
        estado: z.enum(["terminada", "cancelada"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: fila, error } = await context.supabase
      .from("outreach_campaigns")
      .update({ status: data.estado })
      .eq("id", data.campaignId)
      .eq("clinic_id", data.clinicId)
      .in("status", data.estado === "terminada" ? ["confirmada"] : ["borrador", "confirmada"])
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cerrar la campaña."));
    if (!fila) throw new Error("La campaña ya estaba cerrada.");
    return { ok: true };
  });

// ─── CRM-05 · Medir quién volvió ─────────────────────────────────────────────

export interface RetornoDeCampana {
  id: string;
  nombre: string;
  canal: CanalDeCampana | "recall";
  desde: string | null;
  resultado: ResultadoRetorno;
}

export const medirRetornoDeContactos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        ventanaDias: z.number().int().min(7).max(180).default(60),
        /** Período de contactos del recall a medir (días hacia atrás). */
        periodoDias: z.number().int().min(7).max(365).default(180),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RetornoDeCampana[]> => {
    const { supabase } = context;
    const ahora = Date.now();
    const desdeRecall = new Date(ahora - data.periodoDias * 86_400_000).toISOString();

    const [campanas, recall] = await Promise.all([
      supabase
        .from("outreach_campaigns")
        .select("id, name, channel, confirmed_at")
        .eq("clinic_id", data.clinicId)
        .in("status", ["confirmada", "terminada"])
        .order("confirmed_at", { ascending: false })
        .limit(30),
      // Recall: los mensajes de control periódico (los de /recordatorios y los
      // de los controles pendientes). Un envío que falló no cuenta.
      leerTodasLasPaginas((d, h) =>
        supabase
          .from("messages")
          .select("id, patient_id, created_at")
          .eq("clinic_id", data.clinicId)
          .eq("template_kind", "hygiene_recall")
          .eq("direction", "outbound")
          .neq("status", "failed")
          .gte("created_at", desdeRecall)
          .order("id", { ascending: true })
          .range(d, h),
      ),
    ]);
    // Campañas: solo owner/admin las leen. Sin permiso, se mide solo el recall.
    const filasCampanas = campanas.error ? [] : (campanas.data ?? []);
    if (recall.error)
      throw new Error(
        mensajeDb(recall.error, "No pudimos leer los mensajes de control periódico."),
      );

    const contactosPorCampana = new Map<string, { patientId: string; contactadoEl: string }[]>();
    const ids = filasCampanas.map((c) => c.id);
    if (ids.length) {
      const { filas: dest, error } = await leerTodasLasPaginas((d, h) =>
        supabase
          .from("outreach_campaign_recipients")
          .select("id, campaign_id, patient_id, status, processed_at")
          .eq("clinic_id", data.clinicId)
          .in("campaign_id", ids)
          .order("id", { ascending: true })
          .range(d, h),
      );
      if (error) throw new Error(mensajeDb(error, "No pudimos leer los destinatarios."));
      for (const r of dest) {
        if (!fueContactado(r.status as EstadoDeDestinatario) || !r.processed_at) continue;
        const lista = contactosPorCampana.get(r.campaign_id) ?? [];
        lista.push({ patientId: r.patient_id, contactadoEl: r.processed_at });
        contactosPorCampana.set(r.campaign_id, lista);
      }
    }

    const contactosRecall = recall.filas.map((m) => ({
      patientId: m.patient_id,
      contactadoEl: m.created_at,
    }));
    const todosLosContactos = [...contactosRecall, ...[...contactosPorCampana.values()].flat()];
    const pacientes = [...new Set(todosLosContactos.map((c) => c.patientId))];
    const masAntiguo = todosLosContactos.reduce<string | null>(
      (min, c) => (min === null || c.contactadoEl < min ? c.contactadoEl : min),
      null,
    );

    const citas: { patientId: string; creadaEl: string; inicio: string; estado: string }[] = [];
    if (masAntiguo) {
      for (let i = 0; i < pacientes.length; i += 200) {
        const { filas, error } = await leerTodasLasPaginas((d, h) =>
          supabase
            .from("appointments")
            .select("id, patient_id, created_at, starts_at, status")
            .eq("clinic_id", data.clinicId)
            .in("patient_id", pacientes.slice(i, i + 200))
            .gte("created_at", masAntiguo)
            .order("id", { ascending: true })
            .range(d, h),
        );
        if (error) throw new Error(mensajeDb(error, "No pudimos leer las citas."));
        for (const c of filas) {
          citas.push({
            patientId: c.patient_id,
            creadaEl: c.created_at,
            inicio: c.starts_at,
            estado: c.status,
          });
        }
      }
    }

    const medir = (contactos: { patientId: string; contactadoEl: string }[]) =>
      medirRetorno({ contactos, citas, ventanaDias: data.ventanaDias, ahora });

    return [
      {
        id: "recall",
        nombre: "Control periódico",
        canal: "recall" as const,
        desde: desdeRecall,
        resultado: medir(contactosRecall),
      },
      ...filasCampanas.map((c) => ({
        id: c.id,
        nombre: c.name,
        canal: c.channel as CanalDeCampana,
        desde: c.confirmed_at,
        resultado: medir(contactosPorCampana.get(c.id) ?? []),
      })),
    ];
  });
