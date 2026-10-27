import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  alertasDeAnamnesis,
  conciliarAlergias,
  leerCuestionario,
  leerDetallesDeAlergias,
  type AlertaClinica,
} from "@/lib/clinical/anamnesis";
import { mensajeDb } from "@/lib/db-errors";
import { requireFinanceViewRole } from "@/lib/finance/finance-reports.functions";
import { fetchPatientBalances } from "@/lib/patients/patients.functions";

/**
 * Datos del cajón de la cita en la agenda A+ (panel lateral): solo lo que la
 * recepción necesita antes de que el paciente entre, en dos llamadas chicas
 * y con su propio gate cada una.
 */

const entrada = z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() });

/**
 * Alertas clínicas críticas del paciente (alergias, anticoagulantes,
 * embarazo), las mismas que la cabecera de la ficha (`alertasDeAnamnesis`).
 *
 * No registra una lectura de ficha: es el mismo aviso que la agenda ya
 * muestra con el triángulo de alergias (`listAllergyAlerts`), no la
 * anamnesis completa. RLS de `patient_medical_history` deja leer solo a
 * owner/admin/dentist/assistant: para el resto la respuesta es vacía, y la
 * UI ni la pide (gate `clinical:view`).
 */
export const getAlertasClinicasDeCita = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => entrada.parse(input))
  .handler(async ({ data, context }): Promise<AlertaClinica[]> => {
    const { data: fila, error } = await context.supabase
      .from("patient_medical_history")
      .select("allergies, allergy_details, risk_questionnaire")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las alertas del paciente."));
    if (!fila) return [];
    const alergias = conciliarAlergias(
      fila.allergies ?? [],
      leerDetallesDeAlergias(fila.allergy_details),
    );
    return alertasDeAnamnesis({
      alergias,
      cuestionario: leerCuestionario(fila.risk_questionnaire),
    }).filter((a) => a.nivel === "critica");
  });

export interface ResumenFinancieroCita {
  /** Plan de tratamiento activo más reciente; null si no tiene. */
  plan: { nombre: string; totalCents: number; currency: string } | null;
  /** Facturado − pagado. null = sin nada facturado todavía (regla 11). */
  saldoCents: number | null;
}

/**
 * Plan activo y saldo del paciente para el cajón de la cita. Mismo gate que
 * el saldo del listado de la agenda (`getAppointmentPatientBalances`): rol
 * con `finance:view`, sin el chequeo de trial, porque es operación del
 * mostrador y no un informe. Regla 15: el gate de la UI tiene acá su par.
 */
export const getResumenFinancieroDeCita = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => entrada.parse(input))
  .handler(async ({ data, context }): Promise<ResumenFinancieroCita> => {
    await requireFinanceViewRole(context.supabase, data.clinicId, context.userId);

    const [{ data: planes, error }, saldos] = await Promise.all([
      context.supabase
        .from("treatment_plans")
        .select("name, total_cents, currency, status, created_at")
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .in("status", ["active", "on_hold"])
        .order("created_at", { ascending: false })
        .limit(5),
      fetchPatientBalances(context.supabase, data.clinicId, data.patientId),
    ]);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el plan del paciente."));

    const activo = (planes ?? []).find((p) => p.status === "active") ?? planes?.[0] ?? null;
    const saldo = saldos.get(data.patientId);
    return {
      plan: activo
        ? { nombre: activo.name, totalCents: activo.total_cents, currency: activo.currency }
        : null,
      saldoCents: saldo ? saldo.billedCents - saldo.paidCents : null,
    };
  });
