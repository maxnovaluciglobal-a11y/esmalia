import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotDemoClinic, requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import type { DatosPuestaEnMarcha } from "@/lib/panel/puesta-en-marcha";

/**
 * NAV-02 · Avance de la puesta en marcha. Par en el servidor del indicador
 * (regla 15): solo quien puede configurar la clínica (settings:manage) lo
 * lee y lo descarta. Las cuentas corren con la RLS del usuario y solo piden
 * conteos (`head: true`), nunca filas de pacientes.
 */
const SIN_DATOS = "No pudimos calcular el avance de la puesta en marcha.";

export const getPuestaEnMarcha = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<DatosPuestaEnMarcha> => {
    const { supabase, userId } = context;
    const clinicId = data.clinicId;
    await requireClinicPermission(supabase, clinicId, userId, "settings:manage");

    const contar = (tabla: "branch_hours" | "professional_schedules" | "clinic_members") =>
      supabase.from(tabla).select("id", { count: "exact", head: true }).eq("clinic_id", clinicId);

    const [
      clinica,
      horasSucursal,
      horasProfesional,
      integrantes,
      prestaciones,
      pacientes,
      lotes,
      citas,
      reserva,
      correos,
      suscripcion,
    ] = await Promise.all([
      supabase
        .from("clinics")
        .select("legal_name, tax_id, onboarding_call_at, setup_guide_dismissed_at")
        .eq("id", clinicId)
        .maybeSingle(),
      contar("branch_hours"),
      contar("professional_schedules"),
      contar("clinic_members"),
      supabase
        .from("procedures")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .gt("default_price_cents", 0),
      supabase
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .is("archived_at", null),
      supabase
        .from("import_batches")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("kind", "pacientes")
        .not("completed_at", "is", null)
        .is("reverted_at", null),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .limit(1),
      supabase
        .from("online_booking_settings")
        .select("enabled")
        .eq("clinic_id", clinicId)
        .maybeSingle(),
      supabase
        .from("patient_notification_settings")
        .select("confirmation_enabled, reminder_enabled")
        .eq("clinic_id", clinicId)
        .maybeSingle(),
      supabase.from("subscriptions").select("status").eq("clinic_id", clinicId).maybeSingle(),
    ]);

    const conError = [
      clinica,
      horasSucursal,
      horasProfesional,
      integrantes,
      prestaciones,
      pacientes,
      lotes,
      citas,
      reserva,
      correos,
      suscripcion,
    ].find((r) => r.error);
    if (conError?.error) throw new Error(mensajeDb(conError.error, SIN_DATOS));
    if (!clinica.data) throw new Error(SIN_DATOS);

    const c = clinica.data;
    // Igual que `requiereLlamadaOSuscripcion` (billing.ts): solo hace falta
    // la llamada en prueba y sin haberla agendado.
    const status = suscripcion.data?.status ?? null;
    const llamadaHecha = status !== "trialing" || Boolean(c.onboarding_call_at);

    return {
      datosDeLaClinica: Boolean(c.legal_name?.trim() && c.tax_id?.trim()),
      horariosDeSucursal: (horasSucursal.count ?? 0) > 0,
      horariosDeProfesionales: (horasProfesional.count ?? 0) > 0,
      integrantes: integrantes.count ?? 0,
      prestacionesConPrecio: prestaciones.count ?? 0,
      pacientes: pacientes.count ?? 0,
      importoPacientes: (lotes.count ?? 0) > 0,
      hayCitas: (citas.count ?? 0) > 0,
      reservaEnLinea: reserva.data?.enabled === true,
      correosAPacientes:
        correos.data?.confirmation_enabled === true || correos.data?.reminder_enabled === true,
      llamadaHecha,
      descartadoAt: c.setup_guide_dismissed_at ?? null,
    };
  });

/** Descartar el indicador (o volver a mostrarlo desde Ajustes). */
export const setPuestaEnMarchaDescartada = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), descartada: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage");
    await assertNotDemoClinic(supabase, data.clinicId);
    const { data: filas, error } = await supabase
      .from("clinics")
      .update({
        setup_guide_dismissed_at: data.descartada ? new Date().toISOString() : null,
        setup_guide_dismissed_by: data.descartada ? userId : null,
      })
      .eq("id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para cambiar esto."));
    if (!filas?.length) throw new Error("No tienes permisos para cambiar esto.");
    return { ok: true as const };
  });
