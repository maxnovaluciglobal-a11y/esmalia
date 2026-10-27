/**
 * REC-07 · Configuración de los correos automáticos al paciente y resumen
 * NPS (MKT-08). Solo owner/admin (`settings:manage`), en la UI
 * (`/notificaciones-a-pacientes`) y acá (regla 15); la RLS de la tabla exige
 * lo mismo (`can_manage_clinic`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotDemoClinic, requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

import {
  GuardarConfigSchema,
  leerConfig,
  normalizarHoras,
  resumenNps,
  type ConfigNotificaciones,
  type ResumenNps,
  type TipoDeCorreo,
} from "./reglas";

const SIN_PERMISO = "No tienes permisos para cambiar las notificaciones a pacientes.";
const DIAS_RESUMEN = 90;
const DIAS_ENVIOS = 30;

export interface ComentarioNps {
  nota: number;
  comentario: string;
  respondidoEl: string;
}

export interface EnviosDelMes {
  tipo: TipoDeCorreo;
  enviados: number;
  omitidos: number;
  conError: number;
}

export interface PantallaNotificaciones {
  config: ConfigNotificaciones;
  /** Link de reseña de alguna sucursal (Recordatorios): se usa si la clínica no cargó uno. */
  resenaDeSucursal: string | null;
  /** Modo de prueba del correo de la clínica: en "sandbox" no le llega nada a un paciente real. */
  modoCorreo: "sandbox" | "production";
  /** El interruptor general de Esmalia (`PATIENT_EMAILS_ENABLED`). */
  envioGlobalEncendido: boolean;
  nps: ResumenNps;
  comentarios: ComentarioNps[];
  envios: EnviosDelMes[];
  diasResumen: number;
  diasEnvios: number;
}

export const getNotificacionesPacientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PantallaNotificaciones> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISO);

    const ahora = Date.now();
    const desdeNps = new Date(ahora - DIAS_RESUMEN * 86_400_000).toISOString();
    const desdeEnvios = new Date(ahora - DIAS_ENVIOS * 86_400_000).toISOString();

    const [fila, sandbox, sucursales, encuestas, envios] = await Promise.all([
      supabase
        .from("patient_notification_settings")
        .select(
          "confirmation_enabled, confirmation_enabled_at, reminder_enabled, reminder_hours, intake_form_mode, nps_enabled, nps_enabled_at, nps_hours_after, google_review_url",
        )
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
      supabase
        .from("email_sandbox_config")
        .select("mode")
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
      supabase
        .from("branches")
        .select("google_review_url")
        .eq("clinic_id", data.clinicId)
        .not("google_review_url", "is", null)
        .limit(1),
      supabase
        .from("patient_nps_responses")
        .select("score, comment, responded_at")
        .eq("clinic_id", data.clinicId)
        .gte("sent_at", desdeNps)
        .order("sent_at", { ascending: false })
        .limit(2000),
      supabase
        .from("patient_email_dispatches")
        .select("kind, status")
        .eq("clinic_id", data.clinicId)
        .gte("created_at", desdeEnvios)
        .limit(5000),
    ]);
    if (fila.error) throw new Error(mensajeDb(fila.error, SIN_PERMISO));

    const filasNps = encuestas.data ?? [];
    const porTipo = new Map<TipoDeCorreo, EnviosDelMes>();
    for (const tipo of ["confirmation", "reminder", "nps"] as const) {
      porTipo.set(tipo, { tipo, enviados: 0, omitidos: 0, conError: 0 });
    }
    for (const e of envios.data ?? []) {
      const t = porTipo.get(e.kind as TipoDeCorreo);
      if (!t) continue;
      if (e.status === "sent") t.enviados++;
      else if (e.status === "skipped") t.omitidos++;
      else if (e.status === "error") t.conError++;
    }

    return {
      config: leerConfig(fila.data),
      resenaDeSucursal: sucursales.data?.[0]?.google_review_url?.trim() || null,
      modoCorreo: sandbox.data?.mode === "production" ? "production" : "sandbox",
      envioGlobalEncendido: process.env.PATIENT_EMAILS_ENABLED === "true",
      nps: resumenNps(filasNps),
      comentarios: filasNps
        .filter((f) => f.responded_at && f.score !== null && f.comment?.trim())
        .slice(0, 8)
        .map((f) => ({
          nota: f.score as number,
          comentario: (f.comment as string).trim(),
          respondidoEl: f.responded_at as string,
        })),
      envios: [...porTipo.values()],
      diasResumen: DIAS_RESUMEN,
      diasEnvios: DIAS_ENVIOS,
    };
  });

export const guardarNotificacionesPacientes = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => {
    const datos = GuardarConfigSchema.parse(input);
    return { ...datos, clinicId: datos.clinicId };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISO);
    await assertNotDemoClinic(supabase, data.clinicId);

    const { error } = await supabase.from("patient_notification_settings").upsert(
      {
        clinic_id: data.clinicId,
        confirmation_enabled: data.confirmacion,
        reminder_enabled: data.recordatorio,
        reminder_hours: normalizarHoras(data.horasRecordatorio),
        intake_form_mode: data.formulario,
        nps_enabled: data.encuesta,
        nps_hours_after: data.horasEncuesta,
        google_review_url: data.resenaGoogleUrl,
        updated_by: userId,
      },
      { onConflict: "clinic_id" },
    );
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    return { ok: true };
  });
