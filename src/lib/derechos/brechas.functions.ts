/**
 * Registro de incidentes de seguridad y brechas (SEG-06, Ley 21.719).
 *
 * Solo owner/admin (regla 15: la pantalla exige `team:manage`; acá se
 * vuelve a leer el rol; la RLS `can_manage_clinic` y `mfa_exige_aal2` son
 * las capas siguientes). Es una bitácora: se registra el incidente y se le
 * agregan seguimientos; nada se edita (lo impide la base).
 *
 * No se bloquea en modo solo lectura: registrar una brecha es una
 * obligación de la clínica, esté o no al día con la suscripción.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotDemoClinic, requireClinicRole } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import {
  CATEGORIAS_DE_DATOS,
  DECISIONES_NOTIFICAR,
  ESTADOS_DE_BRECHA,
  NIVELES_DE_RIESGO,
  type Incidente,
  type Seguimiento,
} from "@/lib/derechos/brechas";

export const MENSAJE_SIN_PERMISO_BRECHAS =
  "Solo el propietario o un administrador de la clínica ve y registra incidentes de seguridad.";

const instante = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now() + 5 * 60 * 1000, "La fecha no puede ser futura.");
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const listarBrechas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      zona: string;
      clinicaNombre: string;
      incidentes: Incidente[];
      seguimientos: Seguimiento[];
      autores: Record<string, string>;
    }> => {
      const { supabase, userId } = context;
      await requireClinicRole(
        supabase,
        data.clinicId,
        userId,
        ["owner", "admin"],
        MENSAJE_SIN_PERMISO_BRECHAS,
      );
      const [clinica, incidentes, seguimientos] = await Promise.all([
        supabase.from("clinics").select("name, timezone").eq("id", data.clinicId).maybeSingle(),
        supabase
          .from("security_incidents")
          .select("*")
          .eq("clinic_id", data.clinicId)
          .order("detected_at", { ascending: false })
          .limit(500),
        supabase
          .from("security_incident_updates")
          .select("*")
          .eq("clinic_id", data.clinicId)
          .order("created_at", { ascending: true })
          .limit(5000),
      ]);
      if (clinica.error || !clinica.data) throw new Error("No tienes permisos para esta clínica.");
      if (incidentes.error)
        throw new Error(mensajeDb(incidentes.error, "No pudimos cargar el registro."));
      if (seguimientos.error) {
        throw new Error(mensajeDb(seguimientos.error, "No pudimos cargar los seguimientos."));
      }

      const ids = [
        ...new Set(
          [...(incidentes.data ?? []), ...(seguimientos.data ?? [])]
            .map((x) => x.created_by)
            .filter((x): x is string => Boolean(x)),
        ),
      ];
      const { data: perfiles } = ids.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
        : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };

      return {
        zona: clinica.data.timezone || "America/Santiago",
        clinicaNombre: clinica.data.name,
        incidentes: (incidentes.data ?? []) as Incidente[],
        seguimientos: (seguimientos.data ?? []) as Seguimiento[],
        autores: Object.fromEntries(
          (perfiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "Integrante del equipo"]),
        ),
      };
    },
  );

export const registrarBrecha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        detectadoEl: instante,
        ocurridoEl: instante.optional().nullable(),
        titulo: z.string().trim().min(3, "Ponle un título corto.").max(160),
        descripcion: z
          .string()
          .trim()
          .min(10, "Describe qué pasó (al menos 10 caracteres).")
          .max(4000),
        categorias: z.array(z.enum(CATEGORIAS_DE_DATOS)).max(CATEGORIAS_DE_DATOS.length),
        titularesEstimados: z.number().int().min(0).max(10_000_000).nullable(),
        riesgo: z.enum(NIVELES_DE_RIESGO),
        evaluacion: textoOpcional(4000),
        medidas: textoOpcional(4000),
        notificarAgencia: z.enum(DECISIONES_NOTIFICAR),
        notificarTitulares: z.enum(DECISIONES_NOTIFICAR),
        fundamento: textoOpcional(2000),
        responsable: z.string().trim().min(2, "Indica quién es el responsable.").max(120),
      })
      .refine((v) => !v.ocurridoEl || Date.parse(v.ocurridoEl) <= Date.parse(v.detectadoEl), {
        message: "Ocurrió después de detectarse: revisa las fechas.",
        path: ["ocurridoEl"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicRole(
      supabase,
      data.clinicId,
      userId,
      ["owner", "admin"],
      MENSAJE_SIN_PERMISO_BRECHAS,
    );
    await assertNotDemoClinic(supabase, data.clinicId);
    const { data: fila, error } = await supabase
      .from("security_incidents")
      .insert({
        clinic_id: data.clinicId,
        detected_at: data.detectadoEl,
        occurred_at: data.ocurridoEl ?? null,
        title: data.titulo,
        description: data.descripcion,
        data_categories: data.categorias,
        affected_subjects_estimate: data.titularesEstimados,
        risk_level: data.riesgo,
        risk_assessment: data.evaluacion,
        measures: data.medidas,
        notify_agency: data.notificarAgencia,
        notify_subjects: data.notificarTitulares,
        notification_reason: data.fundamento,
        responsible_name: data.responsable,
      })
      .select("id")
      .single();
    if (error || !fila) throw new Error(mensajeDb(error, "No pudimos registrar el incidente."));
    return { id: fila.id };
  });

export const agregarSeguimientoBrecha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        incidentId: z.string().uuid(),
        nota: z.string().trim().min(3, "Escribe qué pasó o qué se hizo.").max(4000),
        estado: z.enum(ESTADOS_DE_BRECHA).nullable(),
        riesgo: z.enum(NIVELES_DE_RIESGO).nullable(),
        evaluacion: textoOpcional(4000),
        medidas: textoOpcional(4000),
        titularesEstimados: z.number().int().min(0).max(10_000_000).nullable(),
        categorias: z.array(z.enum(CATEGORIAS_DE_DATOS)).nullable(),
        notificarAgencia: z.enum(DECISIONES_NOTIFICAR).nullable(),
        notificarTitulares: z.enum(DECISIONES_NOTIFICAR).nullable(),
        fundamento: textoOpcional(2000),
        agenciaNotificadaEl: instante.nullable(),
        titularesNotificadosEl: instante.nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicRole(
      supabase,
      data.clinicId,
      userId,
      ["owner", "admin"],
      MENSAJE_SIN_PERMISO_BRECHAS,
    );
    await assertNotDemoClinic(supabase, data.clinicId);
    const { data: fila, error } = await supabase
      .from("security_incident_updates")
      .insert({
        clinic_id: data.clinicId,
        incident_id: data.incidentId,
        note: data.nota,
        status: data.estado,
        risk_level: data.riesgo,
        risk_assessment: data.evaluacion,
        measures: data.medidas,
        affected_subjects_estimate: data.titularesEstimados,
        data_categories: data.categorias,
        notify_agency: data.notificarAgencia,
        notify_subjects: data.notificarTitulares,
        notification_reason: data.fundamento,
        agency_notified_at: data.agenciaNotificadaEl,
        subjects_notified_at: data.titularesNotificadosEl,
      })
      .select("id")
      .single();
    if (error || !fila) throw new Error(mensajeDb(error, "No pudimos guardar el seguimiento."));
    return { id: fila.id };
  });
